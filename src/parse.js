// Reads transaction lines out of statement text, e.g.
//   "25 Jun City Garage Express Johannesburg ZA 19.00"
//   "07 Jul ShopNow Online London GB 249.00Cr"
//   "25 Sep 35.00"   (a fee whose description isn't readable text in the PDF)

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
const LINE_RE = /^(\d{1,2}\s+[A-Za-z]{3})(?:\s+(.+?))?\s+(\d[\d\s,]*\.\d{2})\s*(Cr)?$/i
const STATEMENT_DATE_RE = /Statement Date\s*:?\s*(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/i
const NOT_A_TRANSACTION = /^(page|statement|closing balance|opening balance|card total|available balance)/i
const NO_DESCRIPTION = "No description on statement (often a bank fee)"

const monthOf = name => MONTHS[name.slice(0, 1).toUpperCase() + name.slice(1, 3).toLowerCase()]

function toIso(dateStr, year) {
  const m = dateStr.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})$/)
  if (!m) return null
  const mon = monthOf(m[2])
  const day = Number(m[1])
  if (!mon || day < 1 || day > 31) return null
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Finds "Statement Date 25 Sep 2026" in the text, if the statement prints one. */
function findStatementDate(lines) {
  for (const line of lines) {
    const m = String(line).match(STATEMENT_DATE_RE)
    if (m && monthOf(m[2])) return { year: Number(m[3]), month: monthOf(m[2]) }
  }
  return null
}

/**
 * Returns [{date, desc, amount, isCredit}] for every line that looks like a transaction.
 * When the statement prints its own date, that decides the year: transactions in a later
 * month than the statement date belong to the previous year (a Dec–Jan statement).
 */
function parseStatementLines(lines, year) {
  const statementDate = findStatementDate(lines)
  const out = []
  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, " ").trim()
    const m = line && line.match(LINE_RE)
    if (!m) continue
    let txnYear = year
    if (statementDate) {
      const mon = monthOf(m[1].trim().split(" ")[1])
      txnYear = mon > statementDate.month ? statementDate.year - 1 : statementDate.year
    }
    const date = toIso(m[1], txnYear)
    const desc = (m[2] || "").trim() || NO_DESCRIPTION
    const amount = parseFloat(m[3].replace(/[\s,]/g, ""))
    if (!date || !Number.isFinite(amount) || NOT_A_TRANSACTION.test(desc)) continue
    out.push({ date, desc, amount, isCredit: Boolean(m[4]) })
  }
  return out
}

module.exports = { parseStatementLines, findStatementDate, toIso, NO_DESCRIPTION }
