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
var timers = Array();
var state = Array();
var instances = Array();
const dbResult = { games: [{ id: 1, name: 'An Hour to Kill', nodes: 1, instances: [1] }, { id: 2, name: 'The Crazy Cat Lady', nodes: 2, instances: [2, 3] }, { id: 3, name: 'Rob the Bank', nodes: 1, instances: [4] }] };

io.on('connection', (socket) => {
    socket.on('register', (instance, callback) => {
        state[instance] = 'reset';
        setInterval(sendStatus, 1000, instance);
        callback && callback({
            status: "ok",
            bgType: "pic",
            bgPath: "backgrounds/21.jpg"
        });
    });

    socket.on('gm', (callback) => {
        callback && callback({
            status: "ok",
            games: dbResult.games
        });
    });

    socket.on('state', (data) => {
        state[data.game] = data.state;
        if (state[data.game] == 'running') {
            timers[data.game] = date.addHours(new Date(), 1);
        }
    });

    function sendStatus(instance) {
        var timeLeft = 0;
        if (state[instance] == 'running') {
            var now = new Date();
            timeLeft = date.subtract(timers[instance], now).toSeconds();
        }
        socket.broadcast.emit('status' + instance, { //broadcast to room
            time: padStart(Math.floor(timeLeft / 3600), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 / 60), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 % 60), 2, '0')
        });
    }
});