const Shotstack = require('shotstack-sdk');
const axios = require('axios');
const { DateTime } = require('luxon');
const { getVideoDurationInSeconds } = require('get-video-duration');
const cliProgress = require('cli-progress');

const defaultClient = Shotstack.ApiClient.instance;
const DeveloperKey = defaultClient.authentications['DeveloperKey'];
const api = new Shotstack.EndpointsApi();

let apiUrl = 'https://api.shotstack.io/stage';

if (!process.env.SHOTSTACK_KEY) {
    console.log('API Key is required. Set using: export SHOTSTACK_KEY=your_key_here');
    process.exit(1);
}

if (!process.env.YOUTUBE_KEY) {
    console.log('YouTube API Key not set. Set using: export YOUTUBE_KEY=your_key_here');
}

if (process.env.SHOTSTACK_HOST) {
    apiUrl = process.env.SHOTSTACK_HOST;
}

defaultClient.basePath = apiUrl;
DeveloperKey.apiKey = process.env.SHOTSTACK_KEY;

const CLIP_URL = 'https://us02web.zoom.us/rec/download/sOVeUAef-w1dpgEki5elXfSwlszB9tiLBGROg5fQWId5ogCmw_Yd4SDoRiFpmnlV8v21c9l4ZFCZZ1Ch.RtnqwTYyBKfvfwbb';
const CLIP_DATE = "2021-03-10";
const CLIP_FRONT_TRIM = 0;
const CLIP_BACK_TRIM = 1;

const STATUS_MAP = {
    "queued": 10,
    "fetching": 20,
    "rendering": 50,
    "saving": 90,
    "done": 100
}

createW3CVideo(CLIP_URL, CLIP_DATE)

function createW3CVideo(url, date) {
    const dateTitle = DateTime.fromISO(date).toFormat('d LLLL yyyy');
    const dateISO = DateTime.fromISO(date).toISODate();

    console.log(`Getting video duration...`);

    getVideoDurationInSeconds(url).then((duration) => {
        console.log(`  Video duration is ${duration} seconds\n`);

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

        api.postRender(edit).then((data) => {
            let message = data.response.message;
            let id = data.response.id
            
            console.log(message);
            console.log('  Request ID: ' + id + '\n');

            // create a new progress bar instance and use shades_classic theme
            const bar = new cliProgress.SingleBar({
                format: 'Render Progress |' + '{bar}' + '| Status: {status} | Elapsed time: {duration_formatted}',
                hideCursor: true
            }, cliProgress.Presets.shades_classic);
            bar.start(100, 0, {
                status: "-"
            });
            checkStatus(id, bar, dateISO);
        }, (error) => {
            console.error('Request failed: ', error);
            process.exit(1);
        });
    });
}

function checkStatus(id, bar, dateISO) {
    setTimeout(x => {
        api.getRender(id).then((data) => {
            let status = data.response.status;
            let url = data.response.url;
        
            var progress = STATUS_MAP[status] || 0;
            bar.update(progress, {
                status: status.toUpperCase(),
            });
        
            if (status == 'done') {
                bar.stop();
                console.log('\n>> Video URL: ' + url + '\n');

                if (process.env.YOUTUBE_KEY) {
                    axios
                    .post('https://hooks.zapier.com/hooks/catch/9730530/o7hge2m/', {
                        url: url,
                        date: dateISO,
                        key: process.env.YOUTUBE_KEY
                    })
                    .then(res => {
                        console.log(`YouTube video upload of the above URL has been requested from Zapier`)
                    })
                    .catch(error => {
                        console.error(error)
                    })
                }
            } else if (status == 'failed') {
                bar.stop();
                console.log('\n>> Something went wrong, rendering has terminated and will not continue.');
            } else {
                checkStatus(id, bar, dateISO);
            }
        }, (error) => {
            console.error('Request failed or not found: ', error);
            process.exit(1);
        });
    }, 1000);
}
