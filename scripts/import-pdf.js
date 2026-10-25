// Imports a statement PDF into an account, reading it exactly the way the app does.
// Usage: npm run import-pdf -- <email> <statement.pdf> [--account "Credit Card"] [--year 2026] [--dry-run]
// --dry-run prints what was read (and its totals) without saving anything.
const fs = require("fs")
const path = require("path")
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js")
const { extractPdfLines } = require("../public/pdf-lines.js")
const { parseStatementLines, findStatementDate } = require("../src/parse")
const { importStatementLines } = require("../src/api")
const { get } = require("../src/db")

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args.splice(i, 2)[1]
}
const accountArg = flag("--account")
const yearArg = flag("--year")
const dryRun = args.includes("--dry-run") && args.splice(args.indexOf("--dry-run"), 1)
const [email, file] = args
if (!email || !file) {
  console.error('Usage: npm run import-pdf -- <email> <statement.pdf> [--account "Credit Card"] [--year 2026] [--dry-run]')
  process.exit(1)
}

;(async () => {
  const user = get("SELECT id FROM users WHERE email = ?", email.trim().toLowerCase())
  if (!user) throw new Error(`No account found for ${email}.`)
  const settings = get("SELECT default_year, default_account FROM user_settings WHERE user_id = ?", user.id)
  const account = accountArg || settings?.default_account || "Unlabelled account"
  const year = Number(yearArg) || settings?.default_year || new Date().getFullYear()

  const lines = await extractPdfLines(pdfjsLib, new Uint8Array(fs.readFileSync(file)))
  const parsed = parseStatementLines(lines, year)
  const debits = parsed.filter(t => !t.isCredit).reduce((s, t) => s + t.amount, 0)
  const credits = parsed.filter(t => t.isCredit).reduce((s, t) => s + t.amount, 0)
  const sd = findStatementDate(lines)
  console.log(`Read ${parsed.length} transactions from ${path.basename(file)}${sd ? ` (statement date ${sd.year}-${String(sd.month).padStart(2, "0")})` : ""}`)
  console.log(`  debits  R${debits.toFixed(2)} (${parsed.filter(t => !t.isCredit).length})`)
  console.log(`  credits R${credits.toFixed(2)} (${parsed.filter(t => t.isCredit).length})`)

  if (dryRun) {
    for (const t of parsed) console.log(`  ${t.date}  ${t.isCredit ? "Cr " : "   "}${t.amount.toFixed(2).padStart(10)}  ${t.desc}`)
    return
  }
  const result = importStatementLines(user.id, lines, { year, account, source: "pdf", filename: path.basename(file) })
  console.log(`Added ${result.found} to ${email} (${result.skipped} already there, skipped).`)
  for (const t of result.transactions) console.log(`  + ${t.date}  ${t.isCredit ? "Cr " : "   "}${t.amount.toFixed(2).padStart(10)}  ${t.desc}`)
})().catch(err => {
  console.error(err.message)
  process.exit(1)
})
