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
timers = Array();
state = Array();

io.on('connection', (socket) => {
    socket.on('register', (instance, callback) => {
        const now = new Date();
        timers[instance] = date.addHours(now, 1);
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
            games: ['An Hour to Kill', 'The Crazy Cat Lady', 'Rob the Bank']
        });
    });

    function sendStatus(instance) {
        if (state[instance] == 'running') {
            var now = new Date();
            var timeLeft = date.subtract(timers[instance], now).toSeconds();
        }
        socket.broadcast.emit('status' + instance, { //broadcast to room
            time: padStart(Math.floor(timeLeft / 3600), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 / 60), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 % 60), 2, '0')
        });
    }
});