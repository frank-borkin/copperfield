// Setup basic express server
const express = require('express');
const app = express();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;
const date = require('date-and-time');
const padStart = require('string.prototype.padstart');

server.listen(port, () => {
    console.log('Server listening at port %d', port);
});

// Routing
app.use(express.static(path.join(__dirname, 'public')));
var timers = Array(); //of date objects. Per instance
var state = Array(); //The states are intro, reset, running, win and fail. The actions are intro, reset, start, end (lose) and finish (win). Pause/resume were removed. per instance
var clues = Array(); //Current clue or empty string. Per instance
var instances = Array();
var logs = Array();
const games = require('./config/games.json');
//const sites = require('./config/sites.json');

games.forEach(function(g) {
    g.instances.forEach(function(i) {
        instances.push(i);
    })
})


io.on('connection', (socket) => {

    socket.on('register', (instance, callback) => {
        socket.username = instance;
        var i = 0;
        for (var j = 0; j < instances.length; j++) {
            if (instances[j].id == instance) {
                i = j;
                break;
            }
        }
        socket.join("instance" + instance);
        callback && callback({
            status: "ok",
            bgType: instances[i].bgType,
            bgPath: instances[i].bgPath,
            clueSound: instances[i].clueSound,
            introVideo: instances[i].introVideo,
            winVideo: instances[i].winVideo,
            loseVideo: instances[i].loseVideo
        });
    });

    socket.on('gm', (callback) => {
        instances.forEach(function(i) {
            socket.join("instance" + i.id);
        })
        callback && callback({
            status: "ok",
            games: games
        });
    });

    socket.on('action', (data) => {
        const now = new Date().toISOString()
        if (data.action == 'intro') {
            state[data.instance] = 'intro';
            logs[data.instance] += `${now} ${data.gm} Intro started\n`;
        }
        if (data.action == 'post') {
            state[data.instance] = 'post';
        }
        if (data.action == 'start') {
            state[data.instance] = 'running';
            timers[data.instance] = date.addSeconds(new Date(), 30 * 60); //Set the time to 1 hour from now - TODO, use gameTime
            logs[data.instance] += `${now} ${data.gm} Game started\n`;
        }
        if (data.action == 'finish') {
            state[data.instance] = 'win';
            logs[data.instance] += `${now} ${data.gm} Team Won\n`;
            console.log(logs[data.instance]);
            logs[data.instance] = "";
        }
        if (data.action == 'reset') {
            state[data.instance] = 'reset';
            logs[data.instance] += `${now} ${data.gm} Game reset\n`;
        }
    });

    socket.on('clue', (data) => {
        const now = new Date().toISOString()
        clues[data.instance] = data.clue;
        if (data.clue == "") {
            logs[data.instance] += `${now} ${data.gm} Clue cleared\n`;
        }
        else
        { logs[data.instance] += `${now} ${data.gm} Clue sent - ${data.clue}\n`; }
        setTimeout(() => { clues[data.instance] = ''; }, 30000); //30s
    });

    function sendStatus(instance) {
        var timeLeft = 3600;
        if (state[instance] == 'running') {
            var now = new Date();
            timeLeft = date.subtract(timers[instance], now).toSeconds();
            if (timeLeft <= 0) { state[instance] = 'fail' }
        }
        socket.to("instance" + instance).emit('status', { //broadcast to room
            instance: instance,
            time: padStart(Math.floor(timeLeft / 3600), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 / 60), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 % 60), 2, '0'),
            secondsLeft: timeLeft,
            clue: clues[instance],
            state: state[instance]
        });
    }

    for (var j = 0; j < instances.length; j++) {
        if (instances[j].timerStarted == false) {
            instances[j].timerStarted = true;
            state[j] = 'reset';
            setInterval(sendStatus, 1000, instances[j].id);
        }
    }
});