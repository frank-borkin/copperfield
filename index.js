const { Logtail } = require('@logtail/node')
const { LogtailTransport } = require('@logtail/winston')
const Sentry = require('@sentry/node')
const { nodeProfilingIntegration } = require('@sentry/profiling-node')
const date = require('date-and-time')
const express = require('express')
const padStart = require('string.prototype.padstart')
const path = require('path')
const winston = require('winston')

const { combine, timestamp, printf, colorize, align, json, errors } =
    winston.format

// Gives us something like [2024-04-01 04:15:34.906] MyGame SomeGM Clue sent Try the key in another lock.
var winston_transports = []
winston_transports.push(
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
                if (metadata?.time_left) {
                    out = out + ' ' + metadata.time_left
                }
                return out
            })
        ),
    })
)

// Only send to logtail if we're given a token
if (process.env.LOGTAIL_TOKEN) {
    winston_transports.push(
        new LogtailTransport(new Logtail(process.env.LOGTAIL_TOKEN))
    )
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(errors({ stack: true }), timestamp(), json()),
    transports: winston_transports,
})

//Setup express
const port = process.env.PORT || 3000
const app = express()

//Setup Sentry
if (process.env.SENTRY_TOKEN) {
    Sentry.init({
        dsn: process.env.SENTRY_TOKEN,
        integrations: [
            // enable HTTP calls tracing
            new Sentry.Integrations.Http({ tracing: true }),
            // enable Express.js middleware tracing
            new Sentry.Integrations.Express({ app }),
            nodeProfilingIntegration(),
        ],
        // Performance Monitoring
        tracesSampleRate: 1.0, //  Capture 100% of the transactions
        // Set sampling rate for profiling - this is relative to tracesSampleRate
        profilesSampleRate: 1.0,
    })

    app.use(Sentry.Handlers.requestHandler())
    app.use(Sentry.Handlers.tracingHandler())
    app.use(Sentry.Handlers.errorHandler())
}

app.use(express.static(path.join(__dirname, 'public')))
const server = require('http').createServer(app)
const io = require('socket.io')(server)
server.listen(port, () => {
    logger.info('Server started')
})

// State management.
var timers = Array() //of date objects. Per instance
var state = Array() //The states are intro, reset, running, win and fail. The actions are intro, reset, start, end (lose) and finish (win). Pause/resume were removed. per instance
var clues = Array() //Current clue or empty string. Per instance
var log = Array() //Current game log
var instances = Array()
var num_clues = Array()
const games = require('./config/games.json')
//const sites = require('./config/sites.json');

// Populate the instances array with the game instances we have on this site. The ID's may not be sequential.
games.forEach(function (g) {
    g.instances.forEach(function (i) {
        instances.push(i)
    })
})

io.on('connection', (socket) => {
    // When a room client connects
    socket.on('register', (instance, callback) => {
        // Find the instance number in the instances array, get the index into i
        // TODO Cleaner way of doing this
        socket.username = instance
        var i = 0
        for (var j = 0; j < instances.length; j++) {
            if (instances[j].id == instance) {
                i = j
                break
            }
        }
        // Socket name is instance0, instance1, etc
        socket.join('instance' + instance)
        // Tell the client the things it needs to know initially
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

    // When a GM connect
    socket.on('gm', (callback) => {
        // Connect them to each of the instances on site
        instances.forEach(function (i) {
            socket.join('instance' + i.id)
        })
        // And give them the game list
        callback &&
            callback({
                status: 'ok',
                games: games,
            })
    })

    // This is a bit of a FSM
    socket.on('action', (data) => {
        var timeLeft = instances[data.instance].gameLength //Default
        if (state[data.instance] == 'running') {
            var now = new Date()
            timeLeft = date.subtract(timers[data.instance], now).toSeconds()
            if (timeLeft <= 0) {
                timeLeft = 0
            }
        }
        const mins = Math.floor(timeLeft / 60)
        const seconds = Math.floor(timeLeft - mins * 60)

        if (data.action == 'intro') {
            state[data.instance] = 'intro'
            logger.info('Intro started', {
                gm: data.gm,
                game: games[data.instance].name,
            })
            let gl_mins = instances[data.instance].gameLength / 60
            log[data.instance] = `${gl_mins}:00 ${data.gm} started game.<br>`
            num_clues[data.instance] = 0
        }
        if (data.action == 'post') {
            state[data.instance] = 'post'
        }
        if (data.action == 'start') {
            state[data.instance] = 'running'
            // Set the end time of the game to gamelength seconds from now.
            // We do this _after_ the intro finishes
            timers[data.instance] = date.addSeconds(
                new Date(),
                instances[data.instance].gameLength
            )
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
                time_left: `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')}`,
                time_left_secs: timeLeft,
                clues_used: num_clues[data.instance],
            })
            log[data.instance] +=
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} team won.<br>`
        }
        if (data.action == 'reset') {
            if (state[data.instance] != 'running') {
                state[data.instance] = 'reset'
                logger.info('Game reset', {
                    gm: data.gm,
                    game: games[data.instance].name,
                })
            }
        }
        if (data.action == 'addtime') {
            console.log(timers[data.instance])
            timers[data.instance] = date.addSeconds(timers[data.instance], 60)
            logger.info('Added time', {
                gm: data.gm,
                game: games[data.instance].name,
            })
            log[data.instance] +=
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} added 60 seconds.<br>`
        }
        if (data.action == 'removetime') {
            console.log(timers[data.instance])
            timers[data.instance] = date.addSeconds(timers[data.instance], -60)
            logger.info('Removed time', {
                gm: data.gm,
                game: games[data.instance].name,
            })
            log[data.instance] +=
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} removed 60 seconds.<br>`
        }
    })

    // Am empty string clears the screen, anything else is a clue
    socket.on('clue', (data) => {
        clues[data.instance] = data.clue
        var timeLeft = instances[data.instance].gameLength //Default
        if (state[data.instance] == 'running') {
            var now = new Date()
            timeLeft = date.subtract(timers[data.instance], now).toSeconds()
            if (timeLeft <= 0) {
                timeLeft = 0
            }
        }
        const mins = Math.floor(timeLeft / 60)
        const seconds = Math.floor(timeLeft - mins * 60)

        if (data.clue == '') {
            logger.info('Clue cleared', {
                gm: data.gm,
                game: games[data.instance].name,
            })
            log[data.instance] +=
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} cleared clue<br>`
        } else {
            logger.info('Clue sent', {
                gm: data.gm,
                game: games[data.instance].name,
                clue: data.clue,
            })
            log[data.instance] +=
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} sent clue: ${data.clue}<br>`
            num_clues[data.instance]++
        }
        setTimeout(() => {
            clues[data.instance] = ''
            logger.info('Clue auto-cleared', {
                gm: data.gm,
                game: games[data.instance].name,
            })
        }, 30000) //30s
    })

    function sendStatus(instance) {
        var timeLeft = instances[instance].gamelength //Default
        if (state[instance] == 'running') {
            var now = new Date()
            timeLeft = date.subtract(timers[instance], now).toSeconds()
            if (timeLeft <= 0) {
                state[instance] = 'fail'
            }
        }
        // Socket name is instance0, instance1, etc
        socket.to('instance' + instance).emit('status', {
            instance: instance,
            // We build the clock on our side as a string
            time:
                padStart(Math.floor(timeLeft / 3600), 2, '0') +
                ':' +
                padStart(Math.floor((timeLeft % 3600) / 60), 2, '0') +
                ':' +
                padStart(Math.floor((timeLeft % 3600) % 60), 2, '0'),
            secondsLeft: timeLeft,
            clue: clues[instance],
            state: state[instance],
            log: log[instance],
        })
    }

    for (var j = 0; j < instances.length; j++) {
        // Send updates every second. Ensure we're only doing it once per instance.
        // Set things to some sane starting position.
        if (instances[j].timerStarted == false) {
            instances[j].timerStarted = true
            state[j] = 'reset'
            timers[j] = new Date()
            log[j] = ''
            num_clues[j] = 0
            setInterval(sendStatus, 1000, instances[j].id)
        }
    }
})
