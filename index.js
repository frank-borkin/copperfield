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

io.on('connection', (socket) => {
    socket.on('register', (instance) => {
        console.log("registered " + instance);
        const now = new Date();
        timers[instance] = date.addHours(now, 1);
        setInterval(sendStatus, 1000, instance);
    });

    function sendStatus(instance) {
        var now = new Date();
        var timeLeft = date.subtract(timers[instance], now).toSeconds();
        socket.broadcast.emit('status' + instance, {
            time: padStart(Math.floor(timeLeft / 3600), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 / 60), 2, '0') + ':' + padStart(Math.floor(timeLeft % 3600 % 60), 2, '0'),
            bgType: "pic",
            bgPath: "backgrounds/21.jpg"
        });
    }
});