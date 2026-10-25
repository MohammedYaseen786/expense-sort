const path = require("path")
const fs = require("fs")
const { DatabaseSync } = require("node:sqlite")
const { SCHEMA } = require("./schema")

// Local SQLite database using Node's built-in `node:sqlite` module (Node 22.13+).

let db = null

function dataDir() {
  return process.env.DATA_DIR || path.join(__dirname, "..", "data")
}

function getDb() {
  if (db) return db
  fs.mkdirSync(dataDir(), { recursive: true })
  db = new DatabaseSync(path.join(dataDir(), "expensesort.db"))
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA foreign_keys = ON;")
  db.exec(SCHEMA)
  return db
}

function close() {
  if (db) db.close()
  db = null
}

const toSql = v => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v)

function all(sql, ...params) {
  return getDb().prepare(sql).all(...params.map(toSql))
}

function get(sql, ...params) {
  return getDb().prepare(sql).get(...params.map(toSql))
}

function run(sql, ...params) {
  return getDb().prepare(sql).run(...params.map(toSql))
}

/** Runs fn inside a transaction; rolls back if it throws. */
function transaction(fn) {
  const d = getDb()
  d.exec("BEGIN")
  try {
    const result = fn()
    d.exec("COMMIT")
    return result
  } catch (err) {
    d.exec("ROLLBACK")
    throw err
  }
}

module.exports = { getDb, close, all, get, run, transaction, dataDir }
