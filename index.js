// Setup basic express server
const express = require('express')
const app = express()
const path = require('path')
const server = require('http').createServer(app)
const io = require('socket.io')(server)
const port = process.env.PORT || 3000
const date = require('date-and-time')
const padStart = require('string.prototype.padstart')
const winston = require('winston')

const { combine, timestamp, printf, colorize, align, json, errors } =
    winston.format

const { Logtail } = require('@logtail/node')

const { LogtailTransport } = require('@logtail/winston')

const logtail = new Logtail(process.env.LOGTAIL_TOKEN)

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'user-service' },
    format: combine(errors({ stack: true }), timestamp(), json()),
    transports: [
        new winston.transports.Console({
            format: combine(
                colorize({ all: true }),
                timestamp({
                    format: 'YYYY-MM-DD hh:mm:ss.SSS',
                }),
                align(),
                printf(({ message, timestamp, ...metadata }) => {
                    let out = `[${timestamp}]`
                    if (metadata?.game) {
                        out = out + ' ' + metadata.game
                    }
                    if (metadata?.gm) {
                        out = out + ' ' + metadata.gm
                    }
                    out = out + ' ' + message
                    if (metadata?.clue) {
                        out = out + ' ' + metadata.clue
                    }
                    return out
                })
            ),
        }),
        new LogtailTransport(logtail),
    ],
})

server.listen(port, () => {
    logger.info('Server started')
})

// Routing
app.use(express.static(path.join(__dirname, 'public')))
var timers = Array() //of date objects. Per instance
var state = Array() //The states are intro, reset, running, win and fail. The actions are intro, reset, start, end (lose) and finish (win). Pause/resume were removed. per instance
var clues = Array() //Current clue or empty string. Per instance
var instances = Array()
const games = require('./config/games.json')
//const sites = require('./config/sites.json');

games.forEach(function (g) {
    g.instances.forEach(function (i) {
        instances.push(i)
    })
})

io.on('connection', (socket) => {
    socket.on('register', (instance, callback) => {
        socket.username = instance
        var i = 0
        for (var j = 0; j < instances.length; j++) {
            if (instances[j].id == instance) {
                i = j
                break
            }
        }
        socket.join('instance' + instance)
        callback &&
            callback({
                status: 'ok',
                bgType: instances[i].bgType,
                bgPath: instances[i].bgPath,
                clueSound: instances[i].clueSound,
                introVideo: instances[i].introVideo,
                winVideo: instances[i].winVideo,
                loseVideo: instances[i].loseVideo,
            })
    })

    socket.on('gm', (callback) => {
        instances.forEach(function (i) {
            socket.join('instance' + i.id)
        })
        callback &&
            callback({
                status: 'ok',
                games: games,
            })
    })

    socket.on('action', (data) => {
        if (data.action == 'intro') {
            state[data.instance] = 'intro'
            logger.info('Intro started', {
                gm: data.gm,
                game: games[data.instance].name,
            })
        }
        if (data.action == 'post') {
            state[data.instance] = 'post'
        }
        if (data.action == 'start') {
            state[data.instance] = 'running'
            timers[data.instance] = date.addSeconds(new Date(), 30 * 60) //Set the time to 1 hour from now - TODO, use gameTime
            logger.info('Game started', {
                gm: data.gm,
                game: games[data.instance].name,
            })
        }
        if (data.action == 'finish') {
            state[data.instance] = 'win'
            logger.info('Team Won', {
                gm: data.gm,
                game: games[data.instance].name,
            })
        }
        if (data.action == 'reset') {
            state[data.instance] = 'reset'
            logger.info('Game reset', {
                gm: data.gm,
                game: games[data.instance].name,
            })
        }
    })

    socket.on('clue', (data) => {
        clues[data.instance] = data.clue
        if (data.clue == '') {
            logger.info('Clue cleared', {
                gm: data.gm,
                game: games[data.instance].name,
            })
        } else {
            logger.info('Clue sent', {
                gm: data.gm,
                game: games[data.instance].name,
                clue: data.clue,
            })
        }
        setTimeout(() => {
            clues[data.instance] = ''
        }, 30000) //30s
    })

    function sendStatus(instance) {
        var timeLeft = 3600
        if (state[instance] == 'running') {
            var now = new Date()
            timeLeft = date.subtract(timers[instance], now).toSeconds()
            if (timeLeft <= 0) {
                state[instance] = 'fail'
            }
        }
        socket.to('instance' + instance).emit('status', {
            //broadcast to room
            instance: instance,
            time:
                padStart(Math.floor(timeLeft / 3600), 2, '0') +
                ':' +
                padStart(Math.floor((timeLeft % 3600) / 60), 2, '0') +
                ':' +
                padStart(Math.floor((timeLeft % 3600) % 60), 2, '0'),
            secondsLeft: timeLeft,
            clue: clues[instance],
            state: state[instance],
        })
    }

    for (var j = 0; j < instances.length; j++) {
        if (instances[j].timerStarted == false) {
            instances[j].timerStarted = true
            state[j] = 'reset'
            setInterval(sendStatus, 1000, instances[j].id)
        }
    }
})
