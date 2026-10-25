// Turns a statement PDF into text lines, one per printed row. Used by the page (via a <script> tag)
// and by scripts/import-pdf.js (via require), so both read PDFs exactly the same way.
(function (root) {
  // Text whose baseline is within this many points counts as the same printed row.
  // FNB rows are ~10.5pt apart; small offsets between columns are well under this.
  const ROW_TOLERANCE = 2.5

  async function extractPdfLines(pdfjsLib, data) {
    // isEvalSupported:false closes CVE-2024-4367 (script injection via crafted PDF fonts) in pdf.js 3.x.
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
    const lines = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent()
      const items = content.items.filter(it => {
        if (!it.str || !it.str.trim()) return false
        // Skip sideways text, like the reference code FNB prints down the page margin.
        const [, b, c] = it.transform
        return Math.abs(b) < 0.01 && Math.abs(c) < 0.01
      })
      items.sort((a, b) => b.transform[5] - a.transform[5])

      const rows = []
      for (const it of items) {
        const y = it.transform[5]
        const row = rows[rows.length - 1]
        if (row && row.y - y <= ROW_TOLERANCE) row.items.push(it)
        else rows.push({ y, items: [it] })
      }
      for (const row of rows) {
        const text = row.items.sort((a, b) => a.transform[4] - b.transform[4])
          .map(it => it.str).join(' ').replace(/\s+/g, ' ').trim()
        if (text) lines.push(text)
      }
    }
    return lines
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { extractPdfLines }
  else root.extractPdfLines = extractPdfLines
})(this)
