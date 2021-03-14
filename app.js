const Shotstack = require('shotstack-sdk');
const axios = require('axios');
const { DateTime } = require('luxon');
const { getVideoDurationInSeconds } = require('get-video-duration');
const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

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

async function createW3CVideo(requestId, url, date) {
    const dateTitle = DateTime.fromISO(date).toFormat('d LLLL yyyy');
    const dateISO = DateTime.fromISO(date).toISODate();

    statusMap[requestId].status = 'GET DURATION';
    statusMap[requestId].progress = '0%';
    statusMap[requestId].inputUrl = url;
    statusMap[requestId].videoDateISO = dateISO;

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
        .setCallback('https://w3c-video-upload.herokuapp.com/complete')
        .setDisk('mount');

    const data = await api.postRender(edit);
    
    let message = data.response.message;
    let id = data.response.id
    
    if (!id) {
        throw new Error('Error with submission to render: ' + message);
    }

    statusMap[requestId].id = id;
    statusMap[requestId].status = "DURATION FOUND";
    statusMap[requestId].videoDuration = duration;
    statusMap[requestId].progress = `10%`;

    checkStatus(requestId, id, dateISO);
}

function checkStatus(requestId, id, dateISO, completed) {
    // If callback happens after polling has reported completion, do not complete twice
    if (statusMap[requestId].progress === 'DONE' || statusMap[requestId].progress === 'UPLOADED') return;

    api.getRender(id).then((data) => {
        const status = data.response.status;
        const url = data.response.url;

        const now = completed ? DateTime.fromISO(completed) : DateTime.now();
        const elapsed = now.diff(DateTime.fromISO(statusMap[requestId].started), ['hours', 'minutes', 'seconds']).toObject();
    
        var progress = STATUS_MAP[status] || 0;
        statusMap[requestId].progress = `${progress}%`;
        statusMap[requestId].status = status.toUpperCase();
        statusMap[requestId].elapsed =  elapsed;
    
        if (status == 'done') {
            statusMap[requestId].renderUrl = url;

            if (process.env.YOUTUBE_KEY) {
                axios
                .post('https://hooks.zapier.com/hooks/catch/9730530/o7hge2m/', {
                    url: url,
                    date: dateISO,
                    key: process.env.YOUTUBE_KEY
                })
                .then(res => {
                    statusMap[requestId].status = 'UPLOADED';
                })
                .catch(error => {
                    statusMap[requestId].error = 'YouTube upload failed: ' + error;
                })
            }
        } else if (status == 'failed') {
            statusMap[requestId].error = 'Processing failed: ' + data.response.error;
        } else {
            // Poll every 5 seconds for the first minute - to catch errors and help with debugging - then wait for callback
            const EVERY_FIVE_SECONDS = 1000 * 5;
            if (elapsed.hours === 0 && elapsed.minutes === 0) {
                setTimeout(x => {
                    checkStatus(requestId, id, dateISO);
                }, EVERY_FIVE_SECONDS);
            }
        }
    }, (error) => {
        statusMap[requestId].error = 'Request failed or not found: ' + error;
    });
}

const app = express();
app.use(express.json());

app.post('/w3c-video', async(req, res, next) => {
    if (process.env.API_KEY && req.headers['x-api-key'] !== process.env.API_KEY) {
        res.status(401).send();
    } else {
        const requestId = uuidv4();
        const started = DateTime.now().toISO();
        statusMap[requestId] = {
            started,
            status: "NEW REQUEST"
        }
        try {
            const { url, dateCreated } = req.body;
            res.status(204).send();
            await createW3CVideo(requestId, url, dateCreated);
        } catch (error) {
            statusMap[requestId].status = "ERROR";
            statusMap[requestId].error = error.stack;
        }
    }
});

app.post('/complete', async(req, res, next) => {
    try {
        const { id, completed } = req.body;
        res.status(204).send();
        Object.entries(statusMap).filter(([key, value]) => value.id === id).forEach(([requestId, obj]) => {
            checkStatus(requestId, obj.id, obj.videoDateISO, completed);
        });
    } catch (error) {
        console.error(error.stack);
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
