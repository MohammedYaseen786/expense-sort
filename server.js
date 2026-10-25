const http = require("http")
const fs = require("fs")
const path = require("path")
const { handleApi } = require("./src/api")
const { getUser } = require("./src/auth")
const { getDb } = require("./src/db")

const PORT = Number(process.env.PORT) || 3100
const HOST = process.env.HOST || "127.0.0.1"
const PUBLIC_DIR = path.join(__dirname, "public")
const PDFJS_DIR = path.join(__dirname, "node_modules", "pdfjs-dist", "build")

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
}

// Pages that need a signed-in user, and the login pages that don't.
const PAGES = { "/": "index.html", "/index.html": "index.html" }
const PUBLIC_PAGES = { "/login": "login.html", "/signup": "login.html" }

function sendFile(res, file, extraHeaders = {}) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      return res.end("Not found")
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", ...extraHeaders })
    res.end(data)
  })
}

function redirect(res, location) {
  res.writeHead(302, { Location: location })
  res.end()
}

/** Resolves a URL path inside dir, refusing anything that escapes it. */
function safeJoin(dir, urlPath) {
  const file = path.normalize(path.join(dir, decodeURIComponent(urlPath)))
  return file.startsWith(dir + path.sep) ? file : null
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost")
  const { pathname } = url

  if (pathname.startsWith("/api/")) {
    if (await handleApi(req, res, url)) return
    res.writeHead(404, { "Content-Type": "application/json" })
    return res.end(JSON.stringify({ error: "Not found." }))
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405)
    return res.end()
  }

  const noStore = { "Cache-Control": "no-store" }
  if (PAGES[pathname]) {
    if (!getUser(req)) return redirect(res, "/login")
    return sendFile(res, path.join(PUBLIC_DIR, PAGES[pathname]), noStore)
  }
  if (PUBLIC_PAGES[pathname]) {
    if (getUser(req)) return redirect(res, "/")
    return sendFile(res, path.join(PUBLIC_DIR, PUBLIC_PAGES[pathname]), noStore)
  }

  if (pathname === "/vendor/pdf.min.js" || pathname === "/vendor/pdf.worker.min.js") {
    return sendFile(res, path.join(PDFJS_DIR, path.basename(pathname)), { "Cache-Control": "max-age=86400" })
  }

  const file = safeJoin(PUBLIC_DIR, pathname)
  if (!file) {
    res.writeHead(400)
    return res.end()
  }
  sendFile(res, file)
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})

if (require.main === module) {
  getDb() // create the database and tables up front so a bad setup fails at startup
  server.listen(PORT, HOST, () => {
    const shown = PORT === 80 ? `http://${HOST}` : `http://${HOST}:${PORT}`
    console.log(`[${new Date().toISOString()}] Statement Sorter running on ${shown}`)
  })
}

module.exports = { server }
