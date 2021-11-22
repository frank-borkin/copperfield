// Setup basic express server
const express = require('express');
const app = express();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;
const date = require('date-and-time');

server.listen(port, () => {
    console.log('Server listening at port %d', port);
});

// Routing
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.on('register', (instance) => {
        console.log("registered " + instance);
        setInterval(sendStatus, 1000, instance);
    });

    function sendStatus(instance) {
        const now = new Date();
        socket.broadcast.emit('status' + instance, {
            time: date.format(now, 'HH:mm:ss'),
            bgType: "pic",
            bgPath: "backgrounds/21.jpg"
        });
    }
});