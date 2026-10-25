if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";
}

const CATEGORIES = [
  { id:'eating',    name:'Eating Out',      color:'var(--eating)' },
  { id:'clothing',  name:'Clothing',        color:'var(--clothing)' },
  { id:'business',  name:'Business',        color:'var(--business)' },
  { id:'petrol',    name:'Petrol',          color:'var(--petrol)' },
  { id:'online',    name:'Online Shopping', color:'var(--online)' },
  { id:'other',     name:'Other',           color:'var(--other)' },
  { id:'ignore',    name:'Ignore',          color:'var(--ignore)' },
];

const MONTH_NAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

let transactions = []; // {id, date (ISO), account, desc, amount, isCredit, category}
let selectedId = null;
let filterFrom = '';
let filterTo = '';
let sampleCount = 0;

const txnListEl = document.getElementById('txnList');
const categoriesEl = document.getElementById('categories');
const unsortedTotalEl = document.getElementById('unsortedTotal');
const summaryStripEl = document.getElementById('summaryStrip');
const statusLine = document.getElementById('statusLine');
const currencyInput = document.getElementById('currencySymbol');
const accountTagInput = document.getElementById('accountTagInput');
const yearInput = document.getElementById('yearInput');
const accountList = document.getElementById('accountList');
const filterFromEl = document.getElementById('filterFrom');
const filterToEl = document.getElementById('filterTo');
const monthChipsEl = document.getElementById('monthChips');
const filterSummaryEl = document.getElementById('filterSummary');
const dzLabel = document.getElementById('dzLabel');
const preloadedNote = document.getElementById('preloadedNote');
const exportCsvBtn = document.getElementById('exportCsvBtn');

function sym(){ return currencyInput.value.trim() || 'R'; }

function fmt(n){
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-ZA', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return n < 0 ? `${sym()}${s} Cr` : `${sym()}${s}`;
}

function setStatus(msg, isErr){
  statusLine.textContent = msg;
  statusLine.className = 'status-line' + (isErr ? ' err' : '');
}

// ---------- Server ----------
// Every change is sent to the server straight away; the indicator shows whether it landed.
const saveIndicator = document.getElementById('saveIndicator');
let pending = 0;

function showSaveState(){
  if (pending > 0) { saveIndicator.textContent = 'saving…'; saveIndicator.className = 'save-indicator saving'; }
  else if (saveIndicator.className !== 'save-indicator err') { saveIndicator.textContent = 'saved'; saveIndicator.className = 'save-indicator saved'; }
}

async function api(method, path, body){
  pending++;
  showSaveState();
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    saveIndicator.className = 'save-indicator';
    return data;
  } catch (err) {
    saveIndicator.textContent = 'not saved — ' + (err.message || 'server unreachable');
    saveIndicator.className = 'save-indicator err';
    throw err;
  } finally {
    pending--;
    showSaveState();
  }
}

/** Runs a change that has already been applied on screen; if the server refuses it, reload the truth. */
async function sync(method, path, body){
  try { return await api(method, path, body); }
  catch (err) {
    setStatus(`Couldn't save that change: ${err.message}. Reloaded what's on the server.`, true);
    await reloadState();
    throw err;
  }
}

async function reloadState(){
  const state = await api('GET', '/api/state');
  transactions = state.transactions;
  sampleCount = state.sampleCount;
  return state;
}

// ---------- Filtering ----------
function visibleTransactions(){
  return transactions.filter(t => {
    if (filterFrom && t.date < filterFrom) return false;
    if (filterTo && t.date > filterTo) return false;
    return true;
  });
}

function distinctAccounts(){
  return [...new Set(transactions.map(t => t.account).filter(Boolean))].sort();
}

function distinctMonths(){
  const set = new Set();
  transactions.forEach(t => { if (t.date) set.add(t.date.slice(0,7)); });
  return [...set].sort();
}

function monthBounds(ym){
  const [y,m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(lastDay).padStart(2,'0')}`;
  return { from, to };
}

function refreshFilterControls(){
  const accounts = distinctAccounts();
  // account datalist for tagging new uploads only (no filter dropdown — both accounts always combine)
  accountList.innerHTML = '';
  accounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    accountList.appendChild(opt);
  });
  // month chips
  monthChipsEl.innerHTML = '';
  distinctMonths().forEach(ym => {
    const { from, to } = monthBounds(ym);
    const [y,m] = ym.split('-').map(Number);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'month-chip' + (filterFrom === from && filterTo === to ? ' active' : '');
    chip.textContent = `${MONTH_NAMES[m]} ${y}`;
    chip.addEventListener('click', () => {
      filterFrom = from; filterTo = to;
      filterFromEl.value = from; filterToEl.value = to;
      renderAll();
    });
    monthChipsEl.appendChild(chip);
  });
}

function renderFilterSummary(){
  const vis = visibleTransactions();
  let range = 'all dates';
  if (filterFrom && filterTo) range = `${filterFrom} to ${filterTo}`;
  else if (filterFrom) range = `from ${filterFrom}`;
  else if (filterTo) range = `up to ${filterTo}`;
  filterSummaryEl.innerHTML = `Showing <strong>${range}</strong> &middot; both accounts combined &middot; <strong>${vis.length}</strong> of ${transactions.length} transactions`;
  const q = new URLSearchParams({ format: 'csv' });
  if (filterFrom) q.set('from', filterFrom);
  if (filterTo) q.set('to', filterTo);
  exportCsvBtn.href = `/api/export?${q}`;
}

// ---------- Rendering ----------
function renderAll(){
  refreshFilterControls();
  renderFilterSummary();
  renderUnsorted();
  renderCategories();
  renderSummary();
}

function renderUnsorted(){
  txnListEl.innerHTML = '';
  const unsorted = visibleTransactions().filter(t => !t.category)
    .sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let net = 0;
  unsorted.forEach(t => {
    net += t.isCredit ? -t.amount : t.amount;
    txnListEl.appendChild(buildCard(t));
  });
  unsortedTotalEl.textContent = fmt(net);
}

function buildCard(t){
  const card = document.createElement('div');
  card.className = 'txn-card' + (t.id === selectedId ? ' selected' : '');
  card.draggable = true;
  card.dataset.id = t.id;

  const row1 = document.createElement('div');
  row1.className = 'row1';
  const desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = t.desc;
  desc.title = t.desc;
  const amt = document.createElement('span');
  amt.className = 'amt ' + (t.isCredit ? 'credit' : 'debit');
  amt.textContent = (t.isCredit ? '−' : '') + sym() + t.amount.toFixed(2);
  row1.appendChild(desc);
  row1.appendChild(amt);

  const row2 = document.createElement('div');
  row2.className = 'row2';
  const dateAcc = document.createElement('span');
  dateAcc.className = 'acc';
  dateAcc.textContent = `${t.date}${t.account ? ' · ' + t.account : ''}`;
  dateAcc.title = dateAcc.textContent;
  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = 'Remove';
  del.addEventListener('click', (e) => { e.stopPropagation(); removeTxn(t.id); });
  row2.appendChild(dateAcc);
  row2.appendChild(del);

  card.appendChild(row1);
  card.appendChild(row2);

  card.addEventListener('click', () => onCardClick(t.id));
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', t.id);
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  return card;
}

function renderCategories(){
  categoriesEl.innerHTML = '';
  const vis = visibleTransactions();
  CATEGORIES.forEach(cat => {
    const box = document.createElement('div');
    box.className = 'category-box';
    box.style.setProperty('--cat-color', cat.color);
    box.dataset.cat = cat.id;

    const items = vis.filter(t => t.category === cat.id)
      .sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const net = items.reduce((s,t) => s + (t.isCredit ? -t.amount : t.amount), 0);

    const head = document.createElement('div');
    head.className = 'category-head';
    head.innerHTML = `
      <div class="name">${cat.name}</div>
      <div class="total${net < 0 ? ' credit-total' : ''}">${fmt(net)}</div>
      <div class="count">${items.length} transaction${items.length === 1 ? '' : 's'}</div>
    `;

    const itemsEl = document.createElement('div');
    itemsEl.className = 'category-items';
    items.forEach(t => itemsEl.appendChild(buildMiniCard(t)));

    box.appendChild(head);
    box.appendChild(itemsEl);

    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag-over'); });
    box.addEventListener('dragleave', () => box.classList.remove('drag-over'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      assignTxn(id, cat.id);
    });
    box.addEventListener('click', (e) => {
      if (e.target.closest('.mini-card')) return;
      if (selectedId) { assignTxn(selectedId, cat.id); }
    });

    categoriesEl.appendChild(box);
  });
}

function buildMiniCard(t){
  const el = document.createElement('div');
  el.className = 'mini-card';
  const desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = t.desc;
  desc.title = `${t.desc} — ${t.date} — tap to send back to Unsorted`;
  const amt = document.createElement('span');
  amt.className = 'amt ' + (t.isCredit ? 'credit' : 'debit');
  amt.textContent = (t.isCredit ? '−' : '') + sym() + t.amount.toFixed(2);
  el.appendChild(desc);
  el.appendChild(amt);
  el.addEventListener('click', () => unassignTxn(t.id));
  return el;
}

function renderSummary(){
  const vis = visibleTransactions();
  const totalNet = vis.reduce((s,t) => s + (t.isCredit ? -t.amount : t.amount), 0);
  const sortedNet = vis.filter(t=>t.category).reduce((s,t) => s + (t.isCredit ? -t.amount : t.amount), 0);
  const unsortedNet = totalNet - sortedNet;
  summaryStripEl.innerHTML = `
    <div class="item"><div class="label">In this view</div><div class="val">${vis.length}</div></div>
    <div class="item"><div class="label">Sorted net</div><div class="val">${fmt(sortedNet)}</div></div>
    <div class="item"><div class="label">Unsorted net</div><div class="val">${fmt(unsortedNet)}</div></div>
    <div class="item"><div class="label">View net</div><div class="val">${fmt(totalNet)}</div></div>
    <div class="item"><div class="label">All transactions loaded</div><div class="val">${transactions.length}</div></div>
  `;
}

// ---------- Actions ----------
function onCardClick(id){
  selectedId = (selectedId === id) ? null : id;
  renderUnsorted();
}
function assignTxn(id, catId){
  const t = transactions.find(t => String(t.id) === String(id));
  if (!t) return;
  t.category = catId;
  if (selectedId === t.id) selectedId = null;
  renderAll();
  sync('PATCH', `/api/transactions/${encodeURIComponent(t.id)}`, { category: catId }).then(renderAll, renderAll);
}
function unassignTxn(id){
  const t = transactions.find(t => t.id === id);
  if (!t) return;
  t.category = null;
  renderAll();
  sync('PATCH', `/api/transactions/${encodeURIComponent(t.id)}`, { category: null }).then(renderAll, renderAll);
}
function removeTxn(id){
  transactions = transactions.filter(t => t.id !== id);
  if (selectedId === id) selectedId = null;
  renderAll();
  sync('DELETE', `/api/transactions/${encodeURIComponent(id)}`).then(renderAll, renderAll);
}

// ---------- Reading statements ----------
// The server parses the lines and skips anything already in the pool.
async function importLines(lines, source, filename){
  const result = await api('POST', '/api/import/lines', {
    lines,
    source,
    filename,
    year: parseInt(yearInput.value, 10) || 2026,
    account: accountTagInput.value.trim() || 'Unlabelled account',
  });
  transactions.push(...result.transactions);
  return result;
}

async function parsePdf(file){
  setStatus('Reading PDF…');
  const allLines = await extractPdfLines(pdfjsLib, await file.arrayBuffer());
  const { found, skipped } = await importLines(allLines, 'pdf', file.name);
  if (found === 0 && skipped === 0){
    setStatus('Couldn\'t find transaction lines automatically — try pasting the statement text instead.', true);
  } else {
    setStatus(`Added ${found} new transaction${found === 1 ? '' : 's'} from the PDF${skipped ? ` (${skipped} already in the pool, skipped)` : ''}.`);
  }
  renderAll();
}

// ---------- Wiring: upload ----------
const dropzoneFile = document.getElementById('dropzoneFile');
const fileInput = document.getElementById('fileInput');

fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (f) handleFile(f);
  fileInput.value = '';
});
['dragover','dragenter'].forEach(evt => dropzoneFile.addEventListener(evt, (e) => {
  e.preventDefault(); dropzoneFile.classList.add('drag-over');
}));
['dragleave','drop'].forEach(evt => dropzoneFile.addEventListener(evt, (e) => {
  e.preventDefault(); dropzoneFile.classList.remove('drag-over');
}));
dropzoneFile.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

function handleFile(f){
  if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')){
    setStatus('Please upload a PDF file.', true);
    return;
  }
  if (!window.pdfjsLib){
    setStatus('The PDF reader didn\'t load (run "npm install" in the app folder). Paste the text instead for now.', true);
    return;
  }
  dzLabel.textContent = f.name;
  parsePdf(f).catch(err => {
    console.error(err);
    setStatus('Something went wrong reading that PDF. Try pasting the text instead.', true);
  });
}

// ---------- Wiring: paste ----------
const pasteToggle = document.getElementById('pasteToggle');
const pasteArea = document.getElementById('pasteArea');
const pasteText = document.getElementById('pasteText');
const parsePasteBtn = document.getElementById('parsePasteBtn');

pasteToggle.addEventListener('click', () => {
  pasteArea.classList.toggle('open');
  pasteToggle.textContent = pasteArea.classList.contains('open')
    ? 'hide paste box ↑'
    : 'or paste statement text instead →';
});
parsePasteBtn.addEventListener('click', async () => {
  const lines = pasteText.value.split('\n');
  try {
    const { found, skipped } = await importLines(lines, 'paste');
    if (found === 0 && skipped === 0){
      setStatus('No transaction lines recognised in that text. Each line should read like "25 Jun City Garage Express Johannesburg ZA 19.00".', true);
    } else {
      setStatus(`Added ${found} new transaction${found === 1 ? '' : 's'} from pasted text${skipped ? ` (${skipped} already in the pool, skipped)` : ''}.`);
      pasteText.value = '';
    }
    renderAll();
  } catch (err) {
    setStatus(`Couldn't add those transactions: ${err.message}`, true);
  }
});

// ---------- Wiring: manual add ----------
const manualToggleBtn = document.getElementById('manualToggleBtn');
const manualForm = document.getElementById('manualForm');
const manualAddBtn = document.getElementById('manualAddBtn');
const manualCancelBtn = document.getElementById('manualCancelBtn');

manualToggleBtn.addEventListener('click', () => {
  manualForm.classList.toggle('open');
});
manualCancelBtn.addEventListener('click', () => manualForm.classList.remove('open'));
manualAddBtn.addEventListener('click', async () => {
  const date = manualForm.querySelector('[name="date"]').value;
  const desc = manualForm.querySelector('[name="desc"]').value.trim();
  const amountRaw = manualForm.querySelector('[name="amount"]').value.trim();
  const isCredit = manualForm.querySelector('[name="isCredit"]').checked;
  const amount = parseFloat(amountRaw.replace(/[^\d.]/g,''));
  const account = accountTagInput.value.trim() || 'Unlabelled account';
  if (!date || !desc || isNaN(amount)){
    setStatus('Enter a date, description, and a numeric amount.', true);
    return;
  }
  try {
    const created = await api('POST', '/api/transactions', { date, account, desc, amount, isCredit });
    transactions.push(created);
  } catch (err) {
    setStatus(`Couldn't add that transaction: ${err.message}`, true);
    return;
  }
  manualForm.querySelector('[name="date"]').value = '';
  manualForm.querySelector('[name="desc"]').value = '';
  manualForm.querySelector('[name="amount"]').value = '';
  manualForm.querySelector('[name="isCredit"]').checked = false;
  setStatus('Transaction added.');
  renderAll();
});

// ---------- Confirm-armed destructive buttons ----------
function armConfirm(btn, confirmLabel, onConfirm, guard){
  let originalLabel = btn.textContent;
  let armed = false;
  let revertTimer = null;
  btn.addEventListener('click', () => {
    if (!armed){
      if (guard && !guard()) return;
      armed = true;
      originalLabel = btn.textContent;
      btn.textContent = confirmLabel;
      btn.classList.add('btn-armed');
      revertTimer = setTimeout(() => {
        armed = false;
        btn.textContent = originalLabel;
        btn.classList.remove('btn-armed');
      }, 4000);
      return;
    }
    clearTimeout(revertTimer);
    armed = false;
    btn.textContent = originalLabel;
    btn.classList.remove('btn-armed');
    onConfirm();
  });
}

const restoreOriginalBtn = document.getElementById('restoreOriginalBtn');
armConfirm(restoreOriginalBtn, 'Click again to confirm — this discards all changes', async () => {
  try {
    const result = await api('POST', '/api/transactions/restore-sample', { confirm: true });
    transactions = result.transactions;
    selectedId = null;
    setStatus(`Restored the original ${result.count} transactions. All categorisation and manual edits were cleared.`);
  } catch (err) {
    setStatus(`Couldn't restore: ${err.message}`, true);
  }
  renderAll();
});

const resetCategoriesBtn = document.getElementById('resetCategoriesBtn');
armConfirm(
  resetCategoriesBtn,
  'Click again to confirm reset',
  async () => {
    visibleTransactions().forEach(t => { t.category = null; });
    selectedId = null;
    renderAll();
    try {
      await sync('POST', '/api/transactions/reset-categories', { from: filterFrom, to: filterTo });
      setStatus('Categories reset for everything in the current filtered view.');
    } catch (err) { /* sync already reported it */ }
    renderAll();
  },
  () => {
    const assignedCount = visibleTransactions().filter(t => t.category).length;
    if (assignedCount === 0) { setStatus('Nothing sorted in the current view — there\'s nothing to reset.'); return false; }
    return true;
  }
);

const clearAllBtn = document.getElementById('clearAllBtn');
armConfirm(clearAllBtn, 'Click again to confirm — erases every account, every date', async () => {
  try {
    await api('POST', '/api/transactions/clear', { confirm: true });
    transactions = [];
    selectedId = null;
    setStatus('Cleared everything. Upload a statement or add transactions manually.');
  } catch (err) {
    setStatus(`Couldn't clear: ${err.message}`, true);
  }
  renderAll();
});

// ---------- Filter wiring ----------
filterFromEl.addEventListener('change', () => { filterFrom = filterFromEl.value; renderAll(); });
filterToEl.addEventListener('change', () => { filterTo = filterToEl.value; renderAll(); });
document.getElementById('clearFilterBtn').addEventListener('click', () => {
  filterFrom = ''; filterTo = '';
  filterFromEl.value = ''; filterToEl.value = '';
  renderAll();
});

// ---------- Settings (remembered per account on the server) ----------
let settingsTimer = null;
function saveSettingsSoon(){
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    const year = parseInt(yearInput.value, 10);
    api('PUT', '/api/settings', {
      currencySymbol: sym(),
      defaultAccount: accountTagInput.value.trim(),
      ...(year >= 2000 && year <= 2100 ? { defaultYear: year } : {}),
    }).catch(err => setStatus(`Couldn't save settings: ${err.message}`, true));
  }, 600);
}
currencyInput.addEventListener('input', () => { renderAll(); saveSettingsSoon(); });
accountTagInput.addEventListener('change', saveSettingsSoon);
yearInput.addEventListener('change', saveSettingsSoon);

// ---------- Backup: import a file exported from this app (or the original artifact) ----------
const importInput = document.getElementById('importInput');

importInput.addEventListener('change', () => {
  const file = importInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!Array.isArray(payload.transactions)) throw new Error('No transactions found in that file.');
      const result = await api('POST', '/api/import/backup', { transactions: payload.transactions, currency: payload.currency, filename: file.name });
      transactions = result.transactions;
      currencyInput.value = result.settings.currencySymbol;
      selectedId = null;
      setStatus(`Imported ${result.count} transactions from file. Everything you had before was replaced.`);
      renderAll();
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't read that file — make sure it's a file exported from this tool. (${err.message})`, true);
    }
  };
  reader.readAsText(file);
  importInput.value = '';
});

// ---------- Account ----------
document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { location.href = '/login'; }
});

// ---------- Init ----------
(async function init(){
  try {
    const state = await reloadState();
    document.getElementById('userEmail').textContent = state.user.email;
    currencyInput.value = state.settings.currencySymbol;
    accountTagInput.value = state.settings.defaultAccount;
    yearInput.value = state.settings.defaultYear;
    restoreOriginalBtn.textContent = `Restore original ${sampleCount} transactions`;
    restoreOriginalBtn.hidden = sampleCount === 0;

    if (transactions.length) {
      const accounts = distinctAccounts();
      preloadedNote.textContent = `${transactions.length} transactions loaded from your database across ${accounts.length} account${accounts.length === 1 ? '' : 's'} (${accounts.join(', ')}). Every change saves automatically. Use the filter panel below to work through one date range at a time.`;
      preloadedNote.hidden = false;
    }
    setStatus(`Loaded ${transactions.length} transactions.`);
  } catch (err) {
    setStatus(`Couldn't reach the server: ${err.message}. Is it running?`, true);
  }
  renderAll();
})();
