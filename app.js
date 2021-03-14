const Shotstack = require('shotstack-sdk');
const axios = require('axios');
const { DateTime } = require('luxon');
const { getVideoDurationInSeconds } = require('get-video-duration');
const express = require('express');
const http = require('http');

const defaultClient = Shotstack.ApiClient.instance;
const DeveloperKey = defaultClient.authentications['DeveloperKey'];
const api = new Shotstack.EndpointsApi();

let apiUrl = 'https://api.shotstack.io/stage';

if (!process.env.SHOTSTACK_KEY) {
    console.log('API Key is required. Set using: export SHOTSTACK_KEY=your_key_here\n');
    process.exit(1);
}

if (!process.env.YOUTUBE_KEY) {
    console.log('YouTube API Key not set. Set using: export YOUTUBE_KEY=your_key_here\n');
}

if (!process.env.API_KEY) {
    console.log('This instance unsecured. Please set an API key for it using: export API_KEY=your_key_here\n');
}

if (process.env.SHOTSTACK_HOST) {
    apiUrl = process.env.SHOTSTACK_HOST;
}

defaultClient.basePath = apiUrl;
DeveloperKey.apiKey = process.env.SHOTSTACK_KEY;

const CLIP_FRONT_TRIM = 0;
const CLIP_BACK_TRIM = 1;

const STATUS_MAP = {
    "queued": 20,
    "fetching": 30,
    "rendering": 50,
    "saving": 90,
    "done": 100
}

const statusMap = {};

async function createW3CVideo(url, date) {
    const dateTitle = DateTime.fromISO(date).toFormat('d LLLL yyyy');
    const dateISO = DateTime.fromISO(date).toISODate();
    const started = DateTime.now().toISO();

    const duration = await getVideoDurationInSeconds(url);

    // Setup the main background clip
    let backgroundAsset = new Shotstack.VideoAsset;
    backgroundAsset
        .setSrc(url)
        .setTrim(CLIP_FRONT_TRIM);

    let transitionIn = new Shotstack.Transition;
    transitionIn
        .setIn('fade');

    let backgroundClip = new Shotstack.Clip;
    backgroundClip
        .setAsset(backgroundAsset)
        .setStart(5.4)
        .setLength(duration - CLIP_BACK_TRIM)
        .setTransition(transitionIn);

    // Grab "W3C intro+outro.mov" from Google Drive
    let w3cAsset = new Shotstack.VideoAsset;
    w3cAsset
        .setSrc('https://drive.google.com/u/0/uc?id=1dBlf6M0MKqdKsUII2ndi4WZJ-7cj9jfm&export=download')
        .setVolume(1);

    let introClip = new Shotstack.Clip;
    introClip
        .setAsset(w3cAsset)
        .setStart(0)
        .setLength(5.4);

    let outroClip = new Shotstack.Clip;
    outroClip
        .setAsset(w3cAsset)
        .setStart(duration - CLIP_BACK_TRIM - 2)
        .setLength(11);

    let backgroundTrack = new Shotstack.Track;
    backgroundTrack
        .setClips([backgroundClip]);

    // Add overlays to a track
    let overlayTrack = new Shotstack.Track;
    overlayTrack
        .setClips([outroClip]);

    // Add overlays to a track
    let introTrack = new Shotstack.Track;
    introTrack
        .setClips([introClip]);

    let title = new Shotstack.HtmlAsset;
    title
        .setType('html')
        .setCss('div { font-family: Montserrat; color: #4d479b; font-size: 60px; text-transform: uppercase; }')
        .setHtml(`<div>${dateTitle}<div>`)
        .setPosition('bottom');

    let transition = new Shotstack.Transition;
    transition
        .setIn('fade')
        .setOut('fade');

    let titleClip = new Shotstack.Clip;
    titleClip
        .setAsset(title)
        .setStart(0.25)
        .setLength(5.35)
        .setTransition(transition);

    // Add titles to a track
    let titleTrack = new Shotstack.Track;
    titleTrack
        .setClips([titleClip]);

    // Setup the timeline and add the overlay track above the background track
    let timeline = new Shotstack.Timeline;
    timeline
        .setBackground('#FFFFFF')
        .setTracks([
            overlayTrack,
            backgroundTrack,
            titleTrack,
            introTrack
        ]);

    let output = new Shotstack.Output;
    output
        .setFormat('mp4')
        .setResolution('1080');

    let edit = new Shotstack.Edit;
    edit
        .setTimeline(timeline)
        .setOutput(output)
        .setDisk('mount');

    const data = await api.postRender(edit);
    
    let message = data.response.message;
    let id = data.response.id
    
    if (!id) {
        throw new Error('Error with submission to render: ' + message);
    }

    statusMap[id] = {
        started,
        inputUrl: url,
        status: "DURATION FOUND",
        videoDuration: duration
    }

    checkStatus(id, dateISO);
}

function checkStatus(id, dateISO) {
    setTimeout(x => {
        api.getRender(id).then((data) => {
            let status = data.response.status;
            let url = data.response.url;
        
            var progress = STATUS_MAP[status] || 0;
            statusMap[id].progress = `${progress}%`;
            statusMap[id].status = status.toUpperCase();
            statusMap[id].elapsed =  DateTime.now().diff(DateTime.fromISO(statusMap[id].started), ['hours', 'minutes', 'seconds']).toObject();
        
            if (status == 'done') {
                statusMap[id].renderUrl = url;

                if (process.env.YOUTUBE_KEY) {
                    axios
                    .post('https://hooks.zapier.com/hooks/catch/9730530/o7hge2m/', {
                        url: url,
                        date: dateISO,
                        key: process.env.YOUTUBE_KEY
                    })
                    .then(res => {
                        statusMap[id].status = 'UPLOADED';
                    })
                    .catch(error => {
                        statusMap[id].error = 'YouTube upload failed: ' + error;
                    })
                }
            } else if (status == 'failed') {
                statusMap[id].error = 'Processing failed: ' + data.response.error;
            } else {
                checkStatus(id, dateISO);
            }
        }, (error) => {
            statusMap[id].error = 'Request failed or not found: ' + error;
        });
    }, 1000);
}

const app = express();
app.use(express.json());

app.post('/w3c-video', async(req, res, next) => {
    try {
        if (process.env.API_KEY && req.headers['x-api-key'] !== process.env.API_KEY) {
            res.status(401).send();
        } else {
            const { url, dateCreated } = req.body;
            await createW3CVideo(url, dateCreated);
            res.status(204).send();
        }
    } catch (error) {
        return next(error)
    }
});

app.get('/status', function (req, res) {
    res.send(statusMap);
});

app.use(function (err, req, res, next) {
    res.status(500).json({error: err.stack})
    console.error(err.stack);
})

const server = http.createServer(app);
server.on('error', onError);

const port = normalizePort(process.env.PORT || '3000');
app.listen(port, () => {
  console.log(`Server running on port ${port}

Check http://localhost:${port}/status for current status
`);

});

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
  const integerPort = parseInt(val, 10);

  if (Number.isNaN(integerPort)) {
    // named pipe
    return val;
  }

  if (integerPort >= 0) {
    // port number
    return integerPort;
  }

  return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string'
    ? `Pipe ${port}`
    : `Port ${port}`;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}
