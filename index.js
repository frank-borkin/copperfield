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
var state = Array(); //The states are reset, running and stopped. The actions are reset, start, end (lose) and finish (win). Pause/resume were removed. per instance
var clues = Array(); //Current clue or empty string. Per instance
var instances = [{ id: 0, bgType: "pic", bgPath: "backgrounds/21.jpg", game: 0, timerStarted: false }, { id: 1, bgType: "pic", bgPath: "backgrounds/21.jpg", game: 1, timerStarted: false }, { id: 2, bgType: "pic", bgPath: "backgrounds/21.jpg", game: 1, timerStarted: false }, { id: 3, bgType: "pic", bgPath: "backgrounds/21.jpg", game: 2, timerStarted: false }]
const games = [{ id: 0, name: 'An Hour to Kill', nodes: 1, instances: [{ id: 0, name: 'HTK' }] }, { id: 1, name: 'The Crazy Cat Lady', nodes: 2, instances: [{ id: 1, name: 'Left' }, { id: 2, name: 'Right' }] }, { id: 2, name: 'Rob the Bank', nodes: 1, instances: [{ id: 3, name: 'RTB' }] }];

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
            bgPath: instances[i].bgPath
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
        if (data.action == 'start') {
            state[data.game] = 'running';
            timers[data.game] = date.addHours(new Date(), 1);
        }
        if (data.action == 'finish') {
            state[data.game] = 'stopped';
        }
        if (data.action == 'reset') {
            state[data.game] = 'reset';
        }
    });

    socket.on('clue', (data) => {
        clues[data.instance] = data.clue;
        setTimeout(() => { clues[data.instance] = ''; }, 30000); //30s
    });

    function sendStatus(instance) {
        var timeLeft = 3600;
        if (state[instance] == 'running') {
            var now = new Date();
            timeLeft = date.subtract(timers[instance], now).toSeconds();
            if (timeLeft <= 0) { state[instance] = 'end' }
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