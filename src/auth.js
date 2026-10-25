const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("crypto")
const { get, run } = require("./db")

const SESSION_COOKIE = "es_session"
const SESSION_DAYS = 30

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `scrypt:${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split(":")
  if (scheme !== "scrypt" || !salt || !hash) return false
  const expected = Buffer.from(hash, "hex")
  const actual = scryptSync(password, salt, expected.length)
  return timingSafeEqual(expected, actual)
}

const hashToken = token => createHash("sha256").update(token).digest("hex")

function parseCookies(header) {
  const out = {}
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/** Creates a session for the user and returns the Set-Cookie header value. */
function startSession(userId) {
  const token = randomBytes(32).toString("hex")
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  run("DELETE FROM sessions WHERE expires_at <= ?", new Date().toISOString())
  run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", hashToken(token), userId, expires.toISOString())
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}`
}

/** Deletes the request's session and returns a Set-Cookie header that clears it. */
function endSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", hashToken(token))
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
}

/** Returns the signed-in user for this request, or null. */
function getUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (!token) return null
  const row = get(
    `SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    hashToken(token), new Date().toISOString(),
  )
  return row ? { id: row.id, email: row.email } : null
}

module.exports = { hashPassword, verifyPassword, startSession, endSession, getUser, SESSION_COOKIE }
