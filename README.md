# w3c-video-upload

OpenActive W3C Community Group video formatting and upload, using Shotstack

## Installation

```bash
npm install
```

## Set your API key

The demos use the **staging** endpoint by default so use your provided **staging** key:

```bash
export SHOTSTACK_KEY=your_key_here
```

Windows users (Command Prompt):

```bash
set SHOTSTACK_KEY=your_key_here
```

You can [get an API key](http://shotstack.io/) via the Shotstack web site.

## Run an example

To run, update the `CLIP_URL` and `CLIP_DATE` constants in `app.js` and then:

```bash
node start 
```
