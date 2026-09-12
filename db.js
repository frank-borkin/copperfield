// SQLite persistence for game records.
//
// Stores one row per game "run" (an instance that has started), and one row per
// checklist/tick-item event with the time remaining at the moment it was ticked.
//
// The database file lives in the config directory: config/copperfield.db

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbPath = join(__dirname, 'config', 'copperfield.db')
const db = new Database(dbPath)

// Better durability/concurrency for a long-running server.
db.pragma('journal_mode = WAL')

db.exec(`
    CREATE TABLE IF NOT EXISTS games (
        run_id       INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id  TEXT    NOT NULL,
        game_name    TEXT,
        start_time   TEXT    NOT NULL,
        finish_time  TEXT,
        outcome      TEXT
    );

    CREATE TABLE IF NOT EXISTS tick_events (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id            INTEGER,
        instance_id       TEXT    NOT NULL,
        item_label        TEXT    NOT NULL,
        value             INTEGER NOT NULL,
        time_left_seconds REAL    NOT NULL,
        event_time        TEXT    NOT NULL,
        FOREIGN KEY (run_id) REFERENCES games(run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tick_events_run_id ON tick_events(run_id);
`)

const insertGameStmt = db.prepare(`
    INSERT INTO games (instance_id, game_name, start_time)
    VALUES (@instanceId, @gameName, @startTime)
`)

const finishGameStmt = db.prepare(`
    UPDATE games
    SET finish_time = @finishTime, outcome = @outcome
    WHERE run_id = @runId
`)

const insertTickStmt = db.prepare(`
    INSERT INTO tick_events
        (run_id, instance_id, item_label, value, time_left_seconds, event_time)
    VALUES
        (@runId, @instanceId, @itemLabel, @value, @timeLeftSeconds, @eventTime)
`)

/**
 * Record the start of a game run. Returns the new run_id.
 */
export function recordGameStart({ instanceId, gameName, startTime = new Date() }) {
    const info = insertGameStmt.run({
        instanceId: String(instanceId),
        gameName: gameName ?? null,
        startTime: new Date(startTime).toISOString(),
    })
    return info.lastInsertRowid
}

/**
 * Record the finish of a game run (win or fail).
 */
export function recordGameFinish({ runId, outcome, finishTime = new Date() }) {
    if (runId == null) return
    finishGameStmt.run({
        runId,
        outcome: outcome ?? null,
        finishTime: new Date(finishTime).toISOString(),
    })
}

/**
 * Record a checklist/tick-item event with the time remaining when it happened.
 */
export function recordTickEvent({
    runId,
    instanceId,
    itemLabel,
    value,
    timeLeftSeconds,
    eventTime = new Date(),
}) {
    insertTickStmt.run({
        runId: runId ?? null,
        instanceId: String(instanceId),
        itemLabel: String(itemLabel),
        value: value ? 1 : 0,
        timeLeftSeconds,
        eventTime: new Date(eventTime).toISOString(),
    })
}

const avgTickTimesStmt = db.prepare(`
    SELECT item_label AS label, AVG(time_left_seconds) AS avg_seconds
    FROM tick_events
    WHERE instance_id = @instanceId AND value = 1
    GROUP BY item_label
`)

/**
 * Average recorded time-remaining (seconds) per checklist item for an instance,
 * over completion events (value = 1). Returns a { label: avgSeconds } map.
 * Labels with no recorded completions are simply absent from the map.
 */
export function getAverageTickTimes(instanceId) {
    var out = {}
    var rows = avgTickTimesStmt.all({ instanceId: String(instanceId) })
    rows.forEach(function (r) {
        out[r.label] = r.avg_seconds
    })
    return out
}

export default db
