const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

// Each run gets its own throwaway database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "expensesort-test-"))
// A small stand-in for the owner's private statement data, readable only by the test account.
const PRIVATE_SAMPLE = [
  { date: "2026-03-05", account: "Cheque Account", desc: "Corner Bistro Main Road", amount: 120, isCredit: false },
  { date: "2026-03-06", account: "Cheque Account", desc: "Northside Fuel Stop", amount: 400, isCredit: false },
  { date: "2026-03-07", account: "Credit Card", desc: "ShopNow Online", amount: 250.5, isCredit: false },
  { date: "2026-03-09", account: "Credit Card", desc: "Refund ShopNow Online", amount: 99, isCredit: true },
  { date: "2026-03-12", account: "Cheque Account", desc: "Salary Example Employer Ltd", amount: 15000, isCredit: true },
]
const PRIVATE_FILE = path.join(process.env.DATA_DIR, "private-sample-transactions.json")
fs.writeFileSync(PRIVATE_FILE, JSON.stringify(PRIVATE_SAMPLE))
fs.writeFileSync(path.join(process.env.DATA_DIR, "sample-owner.txt"), "me@example.com\n")
const DEMO_COUNT = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "demo-transactions.json"), "utf8")).length
const { server } = require("../server")
const { parseStatementLines } = require("../src/parse")
const { close } = require("../src/db")

let base
let cookie = ""

async function call(method, url, body, { auth = true } = {}) {
  const res = await fetch(base + url, {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get("set-cookie")
  if (setCookie && auth) cookie = setCookie.split(";")[0]
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body: json, text, headers: res.headers }
}

test.before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(() => {
  server.close()
  close()
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
})

test("parser reads debit and credit lines and skips balances", () => {
  const rows = parseStatementLines([
    "25 Jun City Garage Express Johannesburg ZA 19.00",
    "07 Jul ShopNow Online London GB 249.00Cr",
    "01 Jul Closing Balance 1 234.56",
    "12 Aug Big purchase 12 345.67",
    "not a transaction",
  ], 2026)
  assert.deepEqual(rows, [
    { date: "2026-06-25", desc: "City Garage Express Johannesburg ZA", amount: 19, isCredit: false },
    { date: "2026-07-07", desc: "ShopNow Online London GB", amount: 249, isCredit: true },
    { date: "2026-08-12", desc: "Big purchase", amount: 12345.67, isCredit: false },
  ])
})

test("parser keeps fee lines with no readable description", () => {
  const rows = parseStatementLines(["25 Sep 35.00", "21 Sep 2.00", "Card Total 4 000.00"], 2026)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].amount, 35)
  assert.match(rows[0].desc, /No description/)
})

test("parser takes the year from the statement date, across New Year", () => {
  const rows = parseStatementLines(["Statement Date 25 Jan 2027", "28 Dec Shop A 10.00", "03 Jan Shop B 20.00"], 2020)
  assert.deepEqual(rows.map(r => r.date), ["2026-12-28", "2027-01-03"])
})

test("PDF reader ignores sideways margin text and joins slightly offset columns", async () => {
  const { extractPdfLines } = require("../public/pdf-lines.js")
  const item = (str, x, y, rotated = false) => ({ str, transform: [rotated ? 0 : 9, rotated ? 9 : 0, rotated ? -9 : 0, rotated ? 0 : 9, x, y] })
  const fakePdfjs = {
    getDocument: () => ({ promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({ getTextContent: async () => ({ items: [
        item("13 Sep", 22, 132.96), item("Example Shop", 59, 132.96), item("909.28", 346, 131.4),
        item("CSFZFN4 :", 560, 132.5, true), item("Amount: 54.50", 59, 122.4),
      ] }) }),
    }) }),
  }
  assert.deepEqual(await extractPdfLines(fakePdfjs, new Uint8Array()), ["13 Sep Example Shop 909.28", "Amount: 54.50"])
})

test("pages and API require sign-in", async () => {
  const page = await call("GET", "/", undefined, { auth: false })
  assert.equal(page.status, 302)
  assert.equal(page.headers.get("location"), "/login")
  const api = await call("GET", "/api/state", undefined, { auth: false })
  assert.equal(api.status, 401)
})

test("only the owner's account gets the statement transactions", async () => {
  const res = await call("POST", "/api/auth/signup", { email: "stranger@example.com", password: "secret9" })
  assert.equal(res.status, 201)
  const state = await call("GET", "/api/state")
  assert.equal(state.body.transactions.length, 0)
  assert.equal(state.body.sampleCount, 0)
  assert.equal((await call("POST", "/api/transactions/restore-sample", { confirm: true })).status, 403)
  assert.equal((await call("GET", "/api/transactions")).body.length, 0)
  cookie = ""
})

test("without private data (a shared copy), every new account gets the demo data", async () => {
  const hidden = PRIVATE_FILE + ".hidden"
  fs.renameSync(PRIVATE_FILE, hidden)
  try {
    await call("POST", "/api/auth/signup", { email: "friend@example.com", password: "secret8" })
    const state = await call("GET", "/api/state")
    assert.equal(state.body.transactions.length, DEMO_COUNT)
    assert.equal(state.body.sampleCount, DEMO_COUNT)
    assert.ok(state.body.transactions.every(t => t.account.startsWith("Demo ")))
  } finally {
    fs.renameSync(hidden, PRIVATE_FILE)
    cookie = ""
  }
})

test("signup loads the sample transactions for the owner", async () => {
  const res = await call("POST", "/api/auth/signup", { email: "Me@Example.com", password: "secret1" })
  assert.equal(res.status, 201)
  assert.equal(res.body.user.email, "me@example.com")
  const state = await call("GET", "/api/state")
  assert.equal(state.status, 200)
  assert.equal(state.body.transactions.length, PRIVATE_SAMPLE.length)
  assert.equal(state.body.sampleCount, PRIVATE_SAMPLE.length)
  assert.equal(state.body.settings.currencySymbol, "R")
  const dup = await call("POST", "/api/auth/signup", { email: "me@example.com", password: "secret1" }, { auth: false })
  assert.equal(dup.status, 409)
})

test("login rejects wrong password and accepts the right one", async () => {
  assert.equal((await call("POST", "/api/auth/login", { email: "me@example.com", password: "nope" }, { auth: false })).status, 401)
  assert.equal((await call("POST", "/api/auth/login", { email: "me@example.com", password: "secret1" })).status, 200)
})

test("categorise, uncategorise, edit and delete a transaction", async () => {
  const [first, second] = (await call("GET", "/api/transactions")).body
  let res = await call("PATCH", `/api/transactions/${first.id}`, { category: "petrol" })
  assert.equal(res.status, 200)
  assert.equal(res.body.category, "petrol")
  assert.equal((await call("PATCH", `/api/transactions/${first.id}`, { category: "bogus" })).status, 400)

  res = await call("POST", "/api/transactions/categorise", { ids: [first.id, second.id], category: "eating" })
  assert.equal(res.body.updated, 2)
  const eating = (await call("GET", "/api/transactions?category=eating")).body
  assert.deepEqual(eating.map(t => t.id).sort(), [first.id, second.id].sort())

  res = await call("PATCH", `/api/transactions/${first.id}`, { desc: "Renamed", amount: 12.345 })
  assert.equal(res.body.desc, "Renamed")
  assert.equal(res.body.amount, 12.35)

  assert.equal((await call("DELETE", `/api/transactions/${second.id}`)).status, 200)
  assert.equal((await call("DELETE", `/api/transactions/${second.id}`)).status, 404)
})

test("statement import adds new lines and skips ones already there", async () => {
  const lines = ["25 Oct Test Cafe Johannesburg ZA 55.50", "26 Oct Refund Shop 10.00Cr"]
  let res = await call("POST", "/api/import/lines", { lines, year: 2026, account: "Test Card", source: "paste" })
  assert.equal(res.status, 200)
  assert.equal(res.body.found, 2)
  assert.equal(res.body.skipped, 0)
  assert.equal(res.body.transactions[0].account, "Test Card")
  res = await call("POST", "/api/import/lines", { lines, year: 2026, account: "Test Card" })
  assert.equal(res.body.found, 0)
  assert.equal(res.body.skipped, 2)
  const imports = (await call("GET", "/api/imports")).body
  assert.equal(imports.length, 2)
})

test("identical charges on one statement are all kept, and re-importing adds none", async () => {
  const lines = ["08 Sep Example Market Shenzhen CN 490.64", "08 Sep Example Market Shenzhen CN 490.64",
    "08 Sep Example Market Shenzhen CN 490.64"]
  let res = await call("POST", "/api/import/lines", { lines, year: 2027, account: "Test Card" })
  assert.equal(res.body.found, 3)
  res = await call("POST", "/api/import/lines", { lines, year: 2027, account: "Test Card" })
  assert.equal(res.body.found, 0)
  assert.equal(res.body.skipped, 3)
  // One copy missing (like the old reader's mistake): a re-import fills in just that one
  const [one] = (await call("GET", "/api/transactions?from=2027-09-08&to=2027-09-08")).body
  await call("DELETE", `/api/transactions/${one.id}`)
  res = await call("POST", "/api/import/lines", { lines, year: 2027, account: "Test Card" })
  assert.equal(res.body.found, 1)
  assert.equal(res.body.skipped, 2)
  const all = (await call("GET", "/api/transactions?from=2027-09-08&to=2027-09-08")).body
  for (const t of all) await call("DELETE", `/api/transactions/${t.id}`)
})

test("summary nets debits against credits per category", async () => {
  const oct = (await call("GET", "/api/transactions?from=2026-10-01&to=2026-10-31")).body
  await call("POST", "/api/transactions/categorise", { ids: oct.map(t => t.id), category: "other" })
  const s = (await call("GET", "/api/summary?from=2026-10-01&to=2026-10-31")).body
  assert.equal(s.count, 2)
  assert.equal(s.byCategory.other.net, 45.5)
  assert.equal(s.unsorted.count, 0)
  assert.equal(s.byMonth["2026-10"].net, 45.5)
})

test("reset-categories only touches the given date range", async () => {
  const res = await call("POST", "/api/transactions/reset-categories", { from: "2026-10-01", to: "2026-10-31" })
  assert.equal(res.body.updated, 2)
  const eating = (await call("GET", "/api/transactions?category=eating")).body
  assert.equal(eating.length, 1) // the March one from the earlier test is untouched
})

test("export as JSON and CSV, then restore from the JSON backup", async () => {
  const json = await call("GET", "/api/export?format=json")
  assert.equal(json.status, 200)
  assert.match(json.headers.get("content-disposition"), /attachment/)
  const backup = json.body
  const csv = await call("GET", "/api/export?format=csv&from=2026-10-01")
  assert.match(csv.text, /Date,Account,Description,Amount,Type,Signed amount,Category/)
  assert.match(csv.text, /Test Cafe/)

  assert.equal((await call("POST", "/api/transactions/clear", {})).status, 400)
  assert.equal((await call("POST", "/api/transactions/clear", { confirm: true })).body.deleted, backup.transactions.length)
  assert.equal((await call("GET", "/api/transactions")).body.length, 0)

  const res = await call("POST", "/api/import/backup", { transactions: backup.transactions, currency: "$" })
  assert.equal(res.body.count, backup.transactions.length)
  assert.equal(res.body.settings.currencySymbol, "$")
  assert.equal((await call("GET", "/api/transactions?category=eating")).body.length, 1)
})

test("restore-sample brings back the original transactions", async () => {
  const res = await call("POST", "/api/transactions/restore-sample", { confirm: true })
  assert.equal(res.body.count, PRIVATE_SAMPLE.length)
  assert.ok(res.body.transactions.every(t => t.category === null))
})

test("settings save and validate", async () => {
  const res = await call("PUT", "/api/settings", { currencySymbol: "R", defaultAccount: "Cheque Account", defaultYear: 2025 })
  assert.deepEqual(res.body, { currencySymbol: "R", defaultAccount: "Cheque Account", defaultYear: 2025 })
  assert.equal((await call("PUT", "/api/settings", { defaultYear: 1900 })).status, 400)
})

test("non-JSON writes are refused (CSRF guard)", async () => {
  const res = await fetch(base + "/api/transactions/clear", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: "confirm=true",
  })
  assert.equal(res.status, 415)
})

test("accounts can't see each other's data", async () => {
  const mine = (await call("GET", "/api/transactions")).body[0]
  const own = cookie
  await call("POST", "/api/auth/signup", { email: "other@example.com", password: "secret2", loadSample: false })
  assert.equal((await call("GET", "/api/transactions")).body.length, 0)
  assert.equal((await call("PATCH", `/api/transactions/${mine.id}`, { category: "ignore" })).status, 404)
  cookie = own
})

test("password change and logout", async () => {
  let res = await call("POST", "/api/auth/password", { currentPassword: "wrong", newPassword: "newpass1" })
  assert.equal(res.status, 400)
  res = await call("POST", "/api/auth/password", { currentPassword: "secret1", newPassword: "newpass1" })
  assert.equal(res.status, 200)
  await call("POST", "/api/auth/logout", {})
  assert.equal((await call("GET", "/api/state")).status, 401)
  assert.equal((await call("POST", "/api/auth/login", { email: "me@example.com", password: "newpass1" })).status, 200)
})

test("static files and path traversal", async () => {
  assert.equal((await call("GET", "/login", undefined, { auth: false })).status, 200)
  assert.equal((await call("GET", "/styles.css")).status, 200)
  assert.equal((await call("GET", "/vendor/pdf.min.js")).status, 200)
  assert.notEqual((await call("GET", "/..%2fpackage.json")).status, 200)
})
