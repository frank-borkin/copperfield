import * as Sentry from '@sentry/node'
if (process.env.SENTRY_TOKEN) {
    Sentry.init({
        dsn: process.env.SENTRY_TOKEN,
        integrations: [nodeProfilingIntegration()],
        // Performance Monitoring
        tracesSampleRate: 1.0, //  Capture 100% of the transactions
        // Set sampling rate for profiling - this is relative to tracesSampleRate
        profilesSampleRate: 1.0,
    })
}

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { join } from 'path'
import { Logtail } from '@logtail/node'
import { LogtailTransport } from '@logtail/winston'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import {
    format as _format,
    transports as _transports,
    createLogger,
} from 'winston'
import * as date from 'date-and-time'
import express from 'express'
import padStart from 'string.prototype.padstart'
import path from 'path'
import {
    recordGameStart,
    recordGameFinish,
    recordTickEvent,
} from './db.js'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const { combine, timestamp, printf, colorize, align, json, errors } = _format

// Gives us something like [2024-04-01 04:15:34.906] MyGame SomeGM Clue sent Try the key in another lock.
var winston_transports = []
winston_transports.push(
    new _transports.Console({
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

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(errors({ stack: true }), timestamp(), json()),
    transports: winston_transports,
})

//Setup express
const port = process.env.PORT || 3000
const app = express()

if (process.env.SENTRY_TOKEN) {
    Sentry.setupExpressErrorHandler(app)
    //    app.use(Handlers.requestHandler())
    //    app.use(Handlers.tracingHandler())
    //    app.use(Handlers.errorHandler())
}

// Serve the large, effectively-immutable media (mp3/mp4) with aggressive
// caching. Only these extensions are matched, so HTML/CSS/JS keep the default
// behaviour and remain editable without stale-cache problems.
//
// etag is disabled for media: Express/send emits *weak* ETags by default, and
// weak validators are not allowed for range requests. That stops the browser
// from caching and reusing byte ranges for <video>/<audio>, forcing a refetch
// on every seek. With etag off it falls back to Last-Modified + immutable,
// which range requests can cache.
const mediaCache = express.static(join(__dirname, 'public'), {
    etag: false,
    maxAge: '365d',
    immutable: true,
})

app.use((req, res, next) => {
    if (/\.(mp3|mp4)$/i.test(req.path)) {
        return mediaCache(req, res, next)
    }
    return next()
})

// Everything else (HTML, CSS, JS, images) uses Express defaults so edits are
// picked up normally.
app.use(express.static(join(__dirname, 'public')))
const server = require('http').createServer(app)
const io = require('socket.io')(server)
server.listen(port, () => {
    logger.info(`Server started v${process.env.npm_package_version}`)
})

// State management.
var timers = Array() //of date objects. Per instance
var state = Array() //The states are intro, reset, running, win, fail and post. The actions are intro, reset, start, end (lose), finish (win) and post (end vid completed). Pause/resume were removed. per instance
var clues = Array() //Current clue or empty string. Per instance
var audioclues = Array()
var log = Array() //Current game log
var timeouts = Array() //To deal with multiple clues in flight
var instances = Array()
var num_clues = Array()
var win_time = Array() //Seconds
var tick_items = Array() //Completion state { label: bool }. Per instance
var shown_items = Array() //Visibility state { label: bool }. Per instance
var run_id = Array() //DB run id for the current game run, per instance
const games = require('./config/games.json')

// Populate the instances array with the game instances we have on this site. The ID's may not be sequential.
games.forEach(function (g) {
    g.instances.forEach(function (i) {
        i.tickItems = g.tickItems || {}
        instances.push(i)
    })
})

instances.forEach((i) => (i.timerStarted = false))

// Build the initial checklist *completion* state for an instance as a
// { label: false } map. Every configured item starts uncompleted. The bool in
// the config (instance.tickItems values) is a separate concern (room-screen
// visibility) and does not affect completion state.
function initialTickItems(instance) {
    var out = {}
    var items = instance.tickItems || {}
    Object.keys(items).forEach(function (label) {
        out[label] = false
    })
    return out
}

// Build the initial *visibility* state for an instance as a { label: bool }
// map, seeded from the config (instance.tickItems values). This controls
// whether the room screen shows each item, and is reset on game reset.
function initialShownItems(instance) {
    var out = {}
    var items = instance.tickItems || {}
    Object.keys(items).forEach(function (label) {
        out[label] = !!items[label]
    })
    return out
}

function getTimeLeft(instance) {
    var timeLeft = instances[instance].gameLength //Default
    if (state[instance] == 'running') {
        var now = new Date()
        timeLeft = date.subtract(now, timers[instance]).toSeconds().value
        if (timeLeft <= 0) {
            state[instance] = 'fail'
            // Record the loss once, at the moment the timer runs out.
            recordGameFinish({ runId: run_id[instance], outcome: 'fail' })
            run_id[instance] = null
        }
    } else if (state[instance] == 'win' || state[instance] == 'post') {
        timeLeft = win_time[instance]
    } else if (state[instance] == 'fail') {
        timeLeft = 0
    }
    return timeLeft //In seconds
}

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
                clueColour: instances[i].clueColour,
                clockTop: instances[i].clockTop,
                clockLeft: instances[i].clockLeft,
                itemsTop: instances[i].itemsTop,
                itemsLeft: instances[i].itemsLeft,
                clueSound: instances[i].clueSound,
                introVideo: instances[i].introVideo,
                winVideo: instances[i].winVideo,
                loseVideo: instances[i].loseVideo,
                tickItems: instances[i].tickItems || [],
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
        var timeLeft = getTimeLeft(data.instance)
        const mins = Math.floor(timeLeft / 60)
        const seconds = Math.floor(timeLeft - mins * 60)

        if (
            data.action == 'intro' &&
            (state[data.instance] == 'reset' || state[data.instance] == 'post')
        ) {
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
            if (
                // Stops the vid from messing with the state if the GM already reset the game
                state[data.instance] == 'win' ||
                state[data.instance] == 'fail'
            ) {
                state[data.instance] = 'post'
                setTimeout(() => {
                    state[data.instance] = 'reset'
                    log[data.instance] = ''
                    tick_items[data.instance] = initialTickItems(instances[data.instance])
                    shown_items[data.instance] = initialShownItems(instances[data.instance])
                    logger.info('Game auto reset', {
                        gm: 'System',
                        game: games[data.instance].name,
                    })
                }, 120000) // 2 mins
            }
        }
        if (data.action == 'start') {
            state[data.instance] = 'running'
            // Set the end time of the game to gameLength seconds from now.
            // We do this _after_ the intro finishes
            timers[data.instance] = date.addSeconds(
                new Date(),
                instances[data.instance].gameLength
            )
            run_id[data.instance] = recordGameStart({
                instanceId: instances[data.instance].id,
                gameName: games[data.instance].name,
            })
            logger.info('Game started', {
                gm: data.gm,
                game: games[data.instance].name,
            })
        }
        if (data.action == 'finish') {
            state[data.instance] = 'win'
            var now = new Date()
            win_time[data.instance] = date
                .subtract(now, timers[data.instance])
                .toSeconds().value
            recordGameFinish({ runId: run_id[data.instance], outcome: 'win' })
            run_id[data.instance] = null
            logger.info('Team Won', {
                gm: data.gm,
                game: games[data.instance].name,
                time_left: `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')}`,
                time_left_secs: timeLeft,
                clues_used: num_clues[data.instance],
            })
            log[data.instance] =
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} team won.<br>${log[data.instance]}`
        }
        if (data.action == 'reset') {
            if (state[data.instance] != 'running') {
                state[data.instance] = 'reset'
                log[data.instance] = ''
                tick_items[data.instance] = initialTickItems(instances[data.instance])
                shown_items[data.instance] = initialShownItems(instances[data.instance])
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
            log[data.instance] =
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} added 60 seconds.<br>${log[data.instance]}`
        }
        if (data.action == 'removetime') {
            console.log(timers[data.instance])
            timers[data.instance] = date.addSeconds(timers[data.instance], -60)
            logger.info('Removed time', {
                gm: data.gm,
                game: games[data.instance].name,
            })
            log[data.instance] =
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} removed 60 seconds.<br>${log[data.instance]}`
        }
    })

    // Am empty string clears the screen, anything else is a clue
    socket.on('clue', (data) => {
        clearTimeout(timeouts[data.instance]) //If we send 2 clues within 60s we need to make sure the first doesn't clean out the second.
        clues[data.instance] = data.clue
        var timeLeft = getTimeLeft(data.instance)
        const mins = Math.floor(timeLeft / 60)
        const seconds = Math.floor(timeLeft - mins * 60)

        if (data.clue == '') {
            logger.info('Clue cleared', {
                gm: data.gm,
                game: games[data.instance].name,
            })
            log[data.instance] =
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} cleared clue<br>${log[data.instance]}`
        } else {
            logger.info('Clue sent', {
                gm: data.gm,
                game: games[data.instance].name,
                clue: data.clue,
            })
            log[data.instance] =
                `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} sent clue: ${data.clue}<br>${log[data.instance]}`
            num_clues[data.instance]++
        }
        timeouts[data.instance] = setTimeout(() => {
            clues[data.instance] = ''
            logger.info('Clue auto-cleared', {
                gm: 'System',
                game: games[data.instance].name,
            })
        }, 60000) //60s
    })

    socket.on('audioclue', (data) => {
        audioclues[data.instance] = data.audioclue
        var timeLeft = getTimeLeft(data.instance)
        const mins = Math.floor(timeLeft / 60)
        const seconds = Math.floor(timeLeft - mins * 60)
        logger.info('Audio clue sent', {
            gm: data.gm,
            game: games[data.instance].name,
            clue: data.audioclue,
        })
        log[data.instance] =
            `${padStart(mins, 2, '0')}:${padStart(seconds, 2, '0')} ${data.gm} sent audioclue: ${data.audioclue}<br>${log[data.instance]}`
        num_clues[data.instance]++
    })

    socket.on('tickitem', (data) => {
        // data.item is the checklist item label (key into the tickItems map).
        tick_items[data.instance][data.item] = data.value
        var timeLeft = getTimeLeft(data.instance)
        recordTickEvent({
            runId: run_id[data.instance],
            instanceId: instances[data.instance].id,
            itemLabel: data.item,
            value: data.value,
            timeLeftSeconds: timeLeft,
        })
    })

    socket.on('showitem', (data) => {
        // data.item is the checklist item label. Toggles room-screen visibility.
        shown_items[data.instance][data.item] = data.value
    })

    function sendStatus(instance) {
        var timeLeft = getTimeLeft(instance)
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
            audioclue: audioclues[instance],
            state: state[instance],
            log: log[instance],
            tick_items: tick_items[instance],
            shown_items: shown_items[instance]
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
            clues[j] = ''
            audioclues[j] = ''
            num_clues[j] = 0
            win_time[j] = 0
            run_id[j] = null
            tick_items[j] = initialTickItems(instances[j])
            shown_items[j] = initialShownItems(instances[j])
            setInterval(sendStatus, 1000, instances[j].id)
        }
    }
})
