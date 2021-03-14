# w3c-video-upload

OpenActive W3C Community Group video formatting and upload, using Shotstack

## Installation

```bash
npm install
```

## Set your API key

The demos use the **staging** endpoint by default so use your provided **staging** key:

```bash
export SHOTSTACK_KEY=your_shotstack_key_here
```

Windows users (Command Prompt):

```bash
set SHOTSTACK_KEY=your_key_here
```

You can [get an API key](http://shotstack.io/) via the Shotstack web site.

## Run an example

To run start:

```bash
node start 
```

Then `POST` to `/v3c-video`:

```json
{
    "url": "https://us02web.zoom.us/rec/download/sOVeUAef-w1dpgEki5elXfSwlszB9tiLBGROg5fQWId5ogCmw_Yd4SDoRiFpmnlV8v21c9l4ZFCZZ1Ch.RtnqwTYyBKfvfwbb",
    "dateCreated": "2021-03-10"
}
```
