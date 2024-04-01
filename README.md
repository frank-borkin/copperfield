# Copperfield

Copperfield is OSS Escape Room Management.

# Getting Started

## How to run (Dev / Test)

-   Sign up to auth0.com
-   (optional) Sign up to logtail
-   Copy the example files in config/
-   Drop the appropriate files into media/

```
$ npm ci
$ npm start
```

Optionally, specify a port by supplying the `PORT` env variable.

Clients should go to http://server:3000/room.html?instance=0. Due to _reasons_ Chrome won't autoplay videos unless you click on them first. There are 3 workarounds for this:

-   Use firefox.
-   Go to chrome://settings/content/sound and add the server to "Allow to play sounds"
-   Start chrome with `chrome.exe --autoplay-policy=no-user-gesture-required`

## How to run (Production)

Ideally, use the docker image. Create config and media folders, then bind mount them. If you have an account on [logtail](https://logs.betterstack.com/) then provide a key and do fun things. If not, logs will just go to the console.

```
docker run -e LOGTAIL_TOKEN=changeme --mount type=bind,source="$(pwd)"/config,target=/usr/src/app/config --mount type=bind,source="$(pwd)"/media,target=/usr/src/app/public/media -p 3000:3000  frankborkin/copperfield
```

Even better, use volumes and k8s.

# Usage

Click the buttons.

# How it works

A Copperfield system consists of 3 parts:

-   A server instance. That's what this code is, there's a docker image at frankborkin/copperfield. It's possible for the server to be a cluster rather than a single instance.
    -   The server keeps track of the game states, and holds info about what each game is and it's media.
-   The GM screen.
    -   It's just a static bit of HTML, and is used for auth (via auth0), starting and stopping games, sending clues, etc.
    -   The GM can look at multiple games at the same time, and mutiple GM's can manage the same game at the same time. This provides lots of flexability, but also opportunity for mistakes.
-   The room screen.
    -   This is what's shown in game - typically the intro/exit vids, clues, etc.

Data is transferred over websockets, media over http. Only the server requires an open port, and so could be hosted externally (although we'd strongly suggest an additional layer of auth in this case).
