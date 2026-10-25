const fs = require("fs")
const path = require("path")
const { randomUUID } = require("crypto")
const { all, get, run, transaction, dataDir } = require("./db")
const { hashPassword, verifyPassword, startSession, endSession, getUser } = require("./auth")
const { parseStatementLines } = require("./parse")

const CATEGORIES = [
  { id: "eating", name: "Eating Out" },
  { id: "clothing", name: "Clothing" },
  { id: "business", name: "Business" },
  { id: "petrol", name: "Petrol" },
  { id: "online", name: "Online Shopping" },
  { id: "other", name: "Other" },
  { id: "ignore", name: "Ignore" },
]
const CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id))
const DEMO_FILE = path.join(__dirname, "..", "seed", "demo-transactions.json")

/**
 * Starter transactions for an account. Real statement data lives in the git-ignored data folder
 * (data/private-sample-transactions.json) and is only given to the email in data/sample-owner.txt
 * (or SAMPLE_OWNER_EMAIL). Without a private file, every account gets the fictional demo data.
 */
function sampleFor(email) {
  const privateFile = path.join(dataDir(), "private-sample-transactions.json")
  if (!fs.existsSync(privateFile)) return JSON.parse(fs.readFileSync(DEMO_FILE, "utf8"))
  const ownerFile = path.join(dataDir(), "sample-owner.txt")
  const owner = process.env.SAMPLE_OWNER_EMAIL || (fs.existsSync(ownerFile) ? fs.readFileSync(ownerFile, "utf8") : "")
  if (!owner.trim() || String(email).toLowerCase() !== owner.trim().toLowerCase()) return []
  return JSON.parse(fs.readFileSync(privateFile, "utf8"))
}
const MAX_BODY = 20 * 1024 * 1024

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ---------- Helpers ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers })
  res.end(body === undefined ? "" : JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    // JSON-only bodies: a cross-site <form> can't send this content type, which blocks CSRF.
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
      return reject(new HttpError(415, "Send the request body as JSON."))
    }
    let size = 0
    const chunks = []
    req.on("data", chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Request is too large."))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8")
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new HttpError(400, "Request body is not valid JSON."))
      }
    })
    req.on("error", reject)
  })
}

const isIsoDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

function cleanText(value, field, { required = true, max = 300 } = {}) {
  const s = value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim()
  if (required && !s) throw new HttpError(400, `${field} is required.`)
  if (s.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`)
  return s
}

function cleanAmount(value) {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(/[^\d.]/g, ""))
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "Amount must be a number of 0 or more.")
  return Math.round(n * 100) / 100
}

function cleanCategory(value) {
  if (value === null || value === undefined || value === "") return null
  if (!CATEGORY_IDS.has(value)) throw new HttpError(400, `Unknown category "${value}".`)
  return value
}

/** Validates one incoming transaction into a row ready to insert. */
function cleanTxn(t, defaults = {}) {
  if (!t || typeof t !== "object") throw new HttpError(400, "Each transaction must be an object.")
  if (!isIsoDate(t.date)) throw new HttpError(400, "Date must be in YYYY-MM-DD format.")
  return {
    date: t.date,
    account: cleanText(t.account || defaults.account || "Unlabelled account", "Account", { max: 100 }),
    description: cleanText(t.desc ?? t.description, "Description"),
    amount: cleanAmount(t.amount),
    is_credit: Boolean(t.isCredit ?? t.is_credit),
    category: cleanCategory(t.category),
  }
}

/** Shapes a database row the way the page uses transactions. */
const toClient = r => ({
  id: r.id,
  date: r.date,
  account: r.account,
  desc: r.description,
  amount: r.amount,
  isCredit: Boolean(r.is_credit),
  category: r.category,
})

function insertTxn(userId, row, source, importId = null) {
  const id = randomUUID()
  run(
    `INSERT INTO transactions (id, user_id, date, account, description, amount, is_credit, category, source, import_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, row.date, row.account, row.description, row.amount, row.is_credit, row.category, source, importId,
  )
  return id
}

function countExisting(userId, row) {
  return Number(get(
    `SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND date = ? AND description = ? AND is_credit = ? AND ABS(amount - ?) < 0.001`,
    userId, row.date, row.description, row.is_credit, row.amount,
  ).n)
}

/**
 * Adds parsed statement lines, skipping ones already in the pool. Identical charges on the
 * same statement (e.g. three R490.64 payments on one day) are all real: if the pool already
 * holds k copies, only copies beyond k are added, so re-importing a statement is safe.
 */
function importStatementLines(userId, lines, { year, account, source, filename = null }) {
  const parsed = parseStatementLines(lines, year)
  return transaction(() => {
    const importId = randomUUID()
    run("INSERT INTO imports (id, user_id, filename, source, account) VALUES (?, ?, ?, ?, ?)", importId, userId, filename, source, account)
    const existing = new Map()
    const seen = new Map()
    const ids = []
    let skipped = 0
    for (const p of parsed) {
      const row = cleanTxn({ ...p, account })
      const key = [row.date, row.description, row.is_credit, row.amount].join("|")
      if (!existing.has(key)) existing.set(key, countExisting(userId, row))
      seen.set(key, (seen.get(key) || 0) + 1)
      if (seen.get(key) <= existing.get(key)) { skipped++; continue }
      ids.push(insertTxn(userId, row, source, importId))
    }
    run("UPDATE imports SET records_added = ?, records_skipped = ? WHERE id = ?", ids.length, skipped, importId)
    return { importId, found: ids.length, skipped, transactions: ids.map(id => toClient(get("SELECT * FROM transactions WHERE id = ?", id))) }
  })
}

function rangeWhere(query, params) {
  let sql = ""
  if (isIsoDate(query.get("from"))) { sql += " AND date >= ?"; params.push(query.get("from")) }
  if (isIsoDate(query.get("to"))) { sql += " AND date <= ?"; params.push(query.get("to")) }
  return sql
}

function listTxns(userId, query = new URLSearchParams()) {
  const params = [userId]
  let sql = "SELECT * FROM transactions WHERE user_id = ?" + rangeWhere(query, params)
  const category = query.get("category")
  if (category === "unsorted") sql += " AND category IS NULL"
  else if (category) { sql += " AND category = ?"; params.push(category) }
  if (query.get("account")) { sql += " AND account = ?"; params.push(query.get("account")) }
  if (query.get("q")) { sql += " AND description LIKE ? ESCAPE '\\'"; params.push(`%${query.get("q").replace(/[\\%_]/g, c => `\\${c}`)}%`) }
  sql += " ORDER BY date, created_at, rowid"
  return all(sql, ...params).map(toClient)
}

function loadSample(userId, email) {
  const sample = sampleFor(email)
  for (const t of sample) insertTxn(userId, cleanTxn(t), "sample")
  return sample.length
}

function getSettings(userId) {
  let s = get("SELECT currency_symbol, default_account, default_year FROM user_settings WHERE user_id = ?", userId)
  if (!s) {
    run("INSERT INTO user_settings (user_id) VALUES (?)", userId)
    s = get("SELECT currency_symbol, default_account, default_year FROM user_settings WHERE user_id = ?", userId)
  }
  return { currencySymbol: s.currency_symbol, defaultAccount: s.default_account, defaultYear: s.default_year }
}

const net = t => (t.isCredit ? -t.amount : t.amount)
const round2 = n => Math.round(n * 100) / 100

function summary(userId, query) {
  const txns = listTxns(userId, query)
  const byCategory = Object.fromEntries(CATEGORIES.map(c => [c.id, { name: c.name, net: 0, count: 0 }]))
  const unsorted = { net: 0, count: 0 }
  const byMonth = {}
  for (const t of txns) {
    const bucket = t.category ? byCategory[t.category] : unsorted
    bucket.net += net(t)
    bucket.count++
    const ym = t.date.slice(0, 7)
    byMonth[ym] ??= { net: 0, count: 0, byCategory: {} }
    byMonth[ym].net += net(t)
    byMonth[ym].count++
    const key = t.category || "unsorted"
    byMonth[ym].byCategory[key] = (byMonth[ym].byCategory[key] || 0) + net(t)
  }
  for (const b of [...Object.values(byCategory), unsorted, ...Object.values(byMonth)]) b.net = round2(b.net)
  for (const m of Object.values(byMonth)) for (const k of Object.keys(m.byCategory)) m.byCategory[k] = round2(m.byCategory[k])
  const totalNet = round2(txns.reduce((s, t) => s + net(t), 0))
  return {
    count: txns.length,
    totalNet,
    sortedNet: round2(totalNet - unsorted.net),
    unsorted,
    byCategory,
    byMonth,
    accounts: [...new Set(txns.map(t => t.account))].sort(),
  }
}

const csvCell = v => {
  const s = String(v ?? "")
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ---------- Routes ----------

const routes = []
const route = (method, pattern, handler, { auth = true } = {}) => {
  const keys = []
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)" }) + "$")
  routes.push({ method, re, keys, handler, auth })
}

// Auth

route("POST", "/api/auth/signup", async (req, res) => {
  const body = await readJson(req)
  const email = cleanText(body.email, "Email", { max: 200 }).toLowerCase()
  const password = String(body.password || "")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.")
  if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters.")
  if (get("SELECT 1 FROM users WHERE email = ?", email)) throw new HttpError(409, "An account with that email already exists.")

  const id = randomUUID()
  transaction(() => {
    run("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)", id, email, hashPassword(password))
    getSettings(id)
    if (body.loadSample !== false) loadSample(id, email)
  })
  send(res, 201, { user: { id, email } }, { "Set-Cookie": startSession(id) })
}, { auth: false })

route("POST", "/api/auth/login", async (req, res) => {
  const body = await readJson(req)
  const email = String(body.email || "").trim().toLowerCase()
  const user = get("SELECT id, email, password_hash FROM users WHERE email = ?", email)
  if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) {
    throw new HttpError(401, "Wrong email or password.")
  }
  send(res, 200, { user: { id: user.id, email: user.email } }, { "Set-Cookie": startSession(user.id) })
}, { auth: false })

route("POST", "/api/auth/logout", (req, res) => {
  send(res, 200, { ok: true }, { "Set-Cookie": endSession(req) })
}, { auth: false })

route("GET", "/api/auth/me", (req, res, { user }) => send(res, 200, { user }))

route("POST", "/api/auth/password", async (req, res, { user }) => {
  const body = await readJson(req)
  const row = get("SELECT password_hash FROM users WHERE id = ?", user.id)
  if (!verifyPassword(String(body.currentPassword || ""), row.password_hash)) throw new HttpError(400, "Current password is wrong.")
  if (String(body.newPassword || "").length < 6) throw new HttpError(400, "New password must be at least 6 characters.")
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(String(body.newPassword)), user.id)
  run("DELETE FROM sessions WHERE user_id = ?", user.id)
  send(res, 200, { ok: true }, { "Set-Cookie": startSession(user.id) })
})

// Everything the page needs on load

route("GET", "/api/state", (req, res, { user }) => {
  send(res, 200, {
    user,
    settings: getSettings(user.id),
    categories: CATEGORIES,
    transactions: listTxns(user.id),
    sampleCount: sampleFor(user.email).length,
  })
})

// Settings

route("GET", "/api/settings", (req, res, { user }) => send(res, 200, getSettings(user.id)))

route("PUT", "/api/settings", async (req, res, { user }) => {
  const body = await readJson(req)
  getSettings(user.id)
  if (body.currencySymbol !== undefined) {
    run("UPDATE user_settings SET currency_symbol = ? WHERE user_id = ?", cleanText(body.currencySymbol, "Currency symbol", { max: 3 }), user.id)
  }
  if (body.defaultAccount !== undefined) {
    run("UPDATE user_settings SET default_account = ? WHERE user_id = ?", cleanText(body.defaultAccount, "Account", { required: false, max: 100 }), user.id)
  }
  if (body.defaultYear !== undefined) {
    const year = Number(body.defaultYear)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, "Year must be between 2000 and 2100.")
    run("UPDATE user_settings SET default_year = ? WHERE user_id = ?", year, user.id)
  }
  run("UPDATE user_settings SET updated_at = ? WHERE user_id = ?", new Date().toISOString(), user.id)
  send(res, 200, getSettings(user.id))
})

route("GET", "/api/categories", (req, res) => send(res, 200, CATEGORIES))

// Transactions

route("GET", "/api/transactions", (req, res, { user, query }) => send(res, 200, listTxns(user.id, query)))

route("POST", "/api/transactions", async (req, res, { user }) => {
  const row = cleanTxn(await readJson(req))
  const id = insertTxn(user.id, row, "manual")
  send(res, 201, toClient(get("SELECT * FROM transactions WHERE id = ?", id)))
})

route("PATCH", "/api/transactions/:id", async (req, res, { user, params }) => {
  const body = await readJson(req)
  const existing = get("SELECT * FROM transactions WHERE id = ? AND user_id = ?", params.id, user.id)
  if (!existing) throw new HttpError(404, "Transaction not found.")
  const merged = cleanTxn({ ...toClient(existing), ...body })
  run(
    `UPDATE transactions SET date = ?, account = ?, description = ?, amount = ?, is_credit = ?, category = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    merged.date, merged.account, merged.description, merged.amount, merged.is_credit, merged.category,
    new Date().toISOString(), params.id, user.id,
  )
  send(res, 200, toClient(get("SELECT * FROM transactions WHERE id = ?", params.id)))
})

route("DELETE", "/api/transactions/:id", (req, res, { user, params }) => {
  const { changes } = run("DELETE FROM transactions WHERE id = ? AND user_id = ?", params.id, user.id)
  if (!Number(changes)) throw new HttpError(404, "Transaction not found.")
  send(res, 200, { ok: true })
})

/** Sets (or clears, with category null) the category of many transactions at once. */
route("POST", "/api/transactions/categorise", async (req, res, { user }) => {
  const body = await readJson(req)
  if (!Array.isArray(body.ids) || body.ids.length === 0) throw new HttpError(400, "ids must be a non-empty list.")
  const category = cleanCategory(body.category)
  const now = new Date().toISOString()
  const updated = transaction(() => body.ids.reduce((n, id) =>
    n + Number(run("UPDATE transactions SET category = ?, updated_at = ? WHERE id = ? AND user_id = ?", category, now, String(id), user.id).changes), 0))
  send(res, 200, { updated })
})

/** Un-sorts everything in a date range (or everything, with no range). */
route("POST", "/api/transactions/reset-categories", async (req, res, { user }) => {
  const body = await readJson(req)
  const params = [new Date().toISOString(), user.id]
  const where = rangeWhere(new URLSearchParams({ from: body.from || "", to: body.to || "" }), params)
  const { changes } = run(`UPDATE transactions SET category = NULL, updated_at = ? WHERE user_id = ? AND category IS NOT NULL${where}`, ...params)
  send(res, 200, { updated: Number(changes) })
})

route("POST", "/api/transactions/clear", async (req, res, { user }) => {
  const body = await readJson(req)
  if (body.confirm !== true) throw new HttpError(400, 'Send {"confirm": true} to erase every transaction.')
  const { changes } = run("DELETE FROM transactions WHERE user_id = ?", user.id)
  send(res, 200, { deleted: Number(changes) })
})

/** Throws everything away and reloads the original sample transactions. */
route("POST", "/api/transactions/restore-sample", async (req, res, { user }) => {
  const body = await readJson(req)
  if (sampleFor(user.email).length === 0) throw new HttpError(403, "The original statement transactions aren't available on this account.")
  if (body.confirm !== true) throw new HttpError(400, 'Send {"confirm": true} to discard your changes.')
  const count = transaction(() => {
    run("DELETE FROM transactions WHERE user_id = ?", user.id)
    return loadSample(user.id, user.email)
  })
  send(res, 200, { count, transactions: listTxns(user.id) })
})

// Imports

/** Parses statement text lines (from a PDF or pasted text) and adds the new transactions. */
route("POST", "/api/import/lines", async (req, res, { user }) => {
  const body = await readJson(req)
  if (!Array.isArray(body.lines)) throw new HttpError(400, "lines must be a list of text lines.")
  const settings = getSettings(user.id)
  const year = Number(body.year) || settings.defaultYear
  if (year < 2000 || year > 2100) throw new HttpError(400, "Year must be between 2000 and 2100.")
  const account = cleanText(body.account || "Unlabelled account", "Account", { max: 100 })
  const source = body.source === "pdf" ? "pdf" : "paste"
  const filename = cleanText(body.filename, "Filename", { required: false, max: 255 }) || null

  const { found, skipped, transactions } = importStatementLines(user.id, body.lines.map(String), { year, account, source, filename })
  send(res, 200, { found, skipped, transactions })
})

/** Restores a backup file exported from this app (or the original artifact): replaces all transactions. */
route("POST", "/api/import/backup", async (req, res, { user }) => {
  const body = await readJson(req)
  if (!Array.isArray(body.transactions)) throw new HttpError(400, "No transactions found in that file.")
  const rows = body.transactions.map(t => cleanTxn(t))
  transaction(() => {
    run("DELETE FROM transactions WHERE user_id = ?", user.id)
    const importId = randomUUID()
    run("INSERT INTO imports (id, user_id, filename, source, records_added) VALUES (?, ?, ?, 'backup', ?)",
      importId, user.id, cleanText(body.filename, "Filename", { required: false, max: 255 }) || null, rows.length)
    for (const row of rows) insertTxn(user.id, row, "backup", importId)
    if (body.currency) run("UPDATE user_settings SET currency_symbol = ? WHERE user_id = ?", cleanText(body.currency, "Currency", { max: 3 }), user.id)
  })
  send(res, 200, { count: rows.length, settings: getSettings(user.id), transactions: listTxns(user.id) })
})

route("GET", "/api/imports", (req, res, { user }) => {
  send(res, 200, all("SELECT * FROM imports WHERE user_id = ? ORDER BY created_at DESC", user.id))
})

// Reports & export

route("GET", "/api/summary", (req, res, { user, query }) => send(res, 200, summary(user.id, query)))

route("GET", "/api/export", (req, res, { user, query }) => {
  const txns = listTxns(user.id, query)
  const stamp = new Date().toISOString().slice(0, 10)
  if (query.get("format") === "csv") {
    const names = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]))
    const lines = [["Date", "Account", "Description", "Amount", "Type", "Signed amount", "Category"].join(",")]
    for (const t of txns) {
      lines.push([t.date, t.account, t.desc, t.amount.toFixed(2), t.isCredit ? "Credit" : "Debit",
        (t.isCredit ? -t.amount : t.amount).toFixed(2), t.category ? names[t.category] : "Unsorted"].map(csvCell).join(","))
    }
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="statement-sorter_${stamp}.csv"`,
    })
    return res.end("﻿" + lines.join("\r\n"))
  }
  const payload = { exportedAt: new Date().toISOString(), currency: getSettings(user.id).currencySymbol, transactions: txns }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="statement-sorter_all-data_${stamp}.json"`,
  })
  res.end(JSON.stringify(payload, null, 2))
})

// ---------- Dispatcher ----------

/** Handles an /api request. Returns false if no route matched the path. */
async function handleApi(req, res, url) {
  const candidates = routes.filter(r => r.re.test(url.pathname))
  if (candidates.length === 0) return false
  const r = candidates.find(c => c.method === req.method)
  if (!r) return send(res, 405, { error: "Method not allowed." }), true

  try {
    const user = getUser(req)
    if (r.auth && !user) throw new HttpError(401, "Unauthorized")
    const m = url.pathname.match(r.re)
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    await r.handler(req, res, { user, params, query: url.searchParams })
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message })
    else {
      console.error(err)
      send(res, 500, { error: "Something went wrong on the server." })
    }
  }
  return true
}

module.exports = { handleApi, importStatementLines, CATEGORIES }
