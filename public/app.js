const API_BASE = '/api/stocks';

const TRANSLATIONS = {
  zh: {
    pageTitle: '美股股票代碼維護系統',
    labelSymbol: '股票代碼',
    labelCompany: '公司名稱',
    labelMarket: '交易市場',
    selectPlaceholder: '請選擇',
    cancel: '取消',
    listTitle: '股票列表',
    searchPlaceholder: '搜尋代碼或公司名稱',
    allMarkets: '全部市場',
    exportCsvBtn: '匯出 CSV',
    thSymbol: '股票代碼',
    thCompany: '公司名稱',
    thMarket: '交易市場',
    thUpdated: '更新時間',
    thActions: '操作',
    emptyState: '目前沒有資料',
    prevPage: '上一頁',
    nextPage: '下一頁',
    pageIndicator: (page, total) => `第 ${page} / ${total} 頁`,
    addTitle: '新增股票',
    editTitle: (symbol) => `編輯股票：${symbol}`,
    addBtn: '新增',
    saveBtn: '儲存更新',
    editBtn: '編輯',
    deleteBtn: '刪除',
    confirmDelete: (symbol, company) => `確定要刪除 ${symbol}（${company}）嗎？`,
    deleteFailed: '刪除失敗',
    operationFailed: '操作失敗',
    duplicateSymbol: (symbol) => `股票代碼 ${symbol} 已存在，不能重複新增。查看：`,
    yahooLookupRunning: (symbol) => `正在從 Yahoo 查詢 ${symbol}…`,
    yahooLookupFilled: (symbol, source) => `已從${source === 'nasdaq_trader' ? ' NASDAQ Trader 官方清單' : ' Yahoo'}帶入 ${symbol} 的公司名稱與交易市場，請確認後新增`,
    yahooLookupNotFound: (symbol) => `NASDAQ Trader 官方清單與 Yahoo 都查無 ${symbol}，請手動填寫公司名稱與交易市場`,
    addedStock: (symbol) => `已新增 ${symbol}，公司資訊會在幾秒內自動補齊。查看：`,
    locale: 'zh-TW',
    renameSectionTitle: '修改公司名稱',
    renameCurrentName: '目前公司名稱',
    renameNewNameLabel: '新公司名稱',
    lookupBtn: '查詢',
    clearBtn: '清空',
    renameSubmitBtn: '更新名稱',
    renameNotFound: '找不到此股票代碼',
    renameSameName: '新名稱與目前名稱相同',
    renameSuccess: '公司名稱已更新',
    historyTitle: '公司名稱異動記錄',
    historyThOld: '舊名稱',
    historyThNew: '新名稱',
    historyThDate: '異動時間',
    historyEmpty: '尚無異動記錄',
    symbolSectionTitle: '修改股票代碼',
    symbolCurrentLabel: '目前股票代碼',
    symbolNewLabel: '新股票代碼',
    symbolSubmitBtn: '更新代碼',
    symbolSameSymbol: '新代碼與目前代碼相同',
    symbolHistoryTitle: '股票代碼異動記錄',
    symbolHistoryThOld: '舊代碼',
    symbolHistoryThNew: '新代碼',
    manualAddLogTitle: '新增紀錄（手動輸入）',
    manualAddLogThDate: '新增時間',
    manualAddLogEmpty: '尚無手動新增紀錄',
    removalCandidatesTitle: '移除候選清單',
    removalReasonTh: '原因',
    removalCheckedAtTh: '檢查時間',
    removalCandidatesEmpty: '目前沒有移除候選',
    removalReasonNotFound: '查無資料',
    removalReasonNotEquity: '非普通股',
    removalReasonUnsupportedExchange: '交易所無法對應',
    removalRefreshBtn: '重新檢測',
    removalRefreshRunning: '檢測並更新中，約需數十秒…',
    removalRefreshDone: (removals, applied) => `檢測完成：已更新 ${applied} 筆股票資訊，${removals} 筆移除候選`,
    removalRefreshPartial: (failed) => `（注意：${failed} 批 Yahoo 查詢失敗，這些股票本次未檢查）`,
    removalRefreshNoListing: '（注意：NASDAQ Trader 清單無法下載，本次不更新上市股票的名稱與市場）',
    removalRefreshFailed: (msg) => `檢測失敗：${msg}`,
    removalRefreshUnavailable: '伺服器不支援重新檢測，請重新啟動伺服器（npm start）',
    deletionLogTitle: '已刪除股票紀錄',
    deletionLogThDate: '刪除時間',
    deletionLogEmpty: '目前沒有刪除紀錄',
    deleteSectionTitle: '刪除股票',
  },
  en: {
    pageTitle: 'US Stock Symbol Maintenance System',
    labelSymbol: 'Stock Symbol',
    labelCompany: 'Company Name',
    labelMarket: 'Trading Market',
    selectPlaceholder: 'Please select',
    cancel: 'Cancel',
    listTitle: 'Stock List',
    searchPlaceholder: 'Search symbol or company name',
    allMarkets: 'All Markets',
    exportCsvBtn: 'Export CSV',
    thSymbol: 'Stock Symbol',
    thCompany: 'Company Name',
    thMarket: 'Trading Market',
    thUpdated: 'Updated At',
    thActions: 'Actions',
    emptyState: 'No data yet',
    prevPage: 'Previous',
    nextPage: 'Next',
    pageIndicator: (page, total) => `Page ${page} of ${total}`,
    addTitle: 'Add Stock',
    editTitle: (symbol) => `Edit Stock: ${symbol}`,
    addBtn: 'Add',
    saveBtn: 'Save Changes',
    editBtn: 'Edit',
    deleteBtn: 'Delete',
    confirmDelete: (symbol, company) => `Delete ${symbol} (${company})? This cannot be undone.`,
    deleteFailed: 'Delete failed',
    operationFailed: 'Operation failed',
    duplicateSymbol: (symbol) => `Stock symbol ${symbol} already exists and cannot be added again. View: `,
    yahooLookupRunning: (symbol) => `Looking up ${symbol} on Yahoo…`,
    yahooLookupFilled: (symbol, source) => `Filled in ${symbol}'s company name and market from ${source === 'nasdaq_trader' ? "NASDAQ Trader's official listing" : 'Yahoo'} - check them, then add`,
    yahooLookupNotFound: (symbol) => `${symbol} not found on NASDAQ Trader's listing or Yahoo - fill in the company name and market manually`,
    addedStock: (symbol) => `Added ${symbol}; company info fills in automatically within a few seconds. View: `,
    locale: 'en-US',
    renameSectionTitle: 'Update Company Name',
    renameCurrentName: 'Current Company Name',
    renameNewNameLabel: 'New Company Name',
    lookupBtn: 'Lookup',
    clearBtn: 'Clear',
    renameSubmitBtn: 'Update Name',
    renameNotFound: 'Stock symbol not found',
    renameSameName: 'New name is the same as the current name',
    renameSuccess: 'Company name updated',
    historyTitle: 'Company Name Change History',
    historyThOld: 'Old Name',
    historyThNew: 'New Name',
    historyThDate: 'Changed At',
    historyEmpty: 'No changes yet',
    symbolSectionTitle: 'Update Stock Symbol',
    symbolCurrentLabel: 'Current Stock Symbol',
    symbolNewLabel: 'New Stock Symbol',
    symbolSubmitBtn: 'Update Symbol',
    symbolSameSymbol: 'New symbol is the same as the current symbol',
    symbolHistoryTitle: 'Stock Symbol Change History',
    symbolHistoryThOld: 'Old Symbol',
    symbolHistoryThNew: 'New Symbol',
    manualAddLogTitle: 'Addition Log (Manual Entries Only)',
    manualAddLogThDate: 'Added At',
    manualAddLogEmpty: 'No manual additions yet',
    removalCandidatesTitle: 'Removal Candidates',
    removalReasonTh: 'Reason',
    removalCheckedAtTh: 'Checked At',
    removalCandidatesEmpty: 'No removal candidates',
    removalReasonNotFound: 'Not found on Yahoo Finance',
    removalReasonNotEquity: 'Not a common equity',
    removalReasonUnsupportedExchange: 'Unsupported exchange',
    removalRefreshBtn: 'Re-check',
    removalRefreshRunning: 'Checking and updating, takes about half a minute…',
    removalRefreshDone: (removals, applied) => `Check complete: updated ${applied} stocks, ${removals} removal candidates`,
    removalRefreshPartial: (failed) => ` (warning: ${failed} Yahoo batch(es) failed - those stocks weren't checked)`,
    removalRefreshNoListing: ' (warning: NASDAQ Trader listing unavailable - no name/market updates for listed stocks this run)',
    removalRefreshFailed: (msg) => `Check failed: ${msg}`,
    removalRefreshUnavailable: 'Server does not support re-checking yet - restart it (npm start)',
    deletionLogTitle: 'Deleted Stocks Log',
    deletionLogThDate: 'Deleted At',
    deletionLogEmpty: 'No deletions yet',
    deleteSectionTitle: 'Delete Stock',
  },
};

let currentLang = localStorage.getItem('lang') || 'zh';
let editingStock = null;
let lastStocks = [];

function t(key) {
  return TRANSLATIONS[currentLang][key];
}

const form = document.getElementById('stock-form');
const formTitle = document.getElementById('form-title');
const stockIdInput = document.getElementById('stock-id');
const stockSymbolInput = document.getElementById('stock-symbol');
const companyNameInput = document.getElementById('company-name');
const tradingMarketInput = document.getElementById('trading-market');
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');
const formError = document.getElementById('form-error');
const formHint = document.getElementById('form-hint');

const exchangeDatalist = document.getElementById('exchange-datalist');

const searchInput = document.getElementById('search-input');
const marketFilter = document.getElementById('market-filter');
const exportCsvBtn = document.getElementById('export-csv-btn');
const tableBody = document.getElementById('stock-table-body');
const emptyState = document.getElementById('empty-state');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const pageIndicator = document.getElementById('page-indicator');
const langSwitch = document.getElementById('lang-switch');

const renameForm = document.getElementById('rename-form');
const renameSymbolInput = document.getElementById('rename-symbol');
const renameLookupBtn = document.getElementById('rename-lookup-btn');
const renameCurrentNameInput = document.getElementById('rename-current-name');
const renameNewNameInput = document.getElementById('rename-new-name');
const renameSubmitBtn = document.getElementById('rename-submit-btn');
const renameClearBtn = document.getElementById('rename-clear-btn');
const renameError = document.getElementById('rename-error');

const historyTableBody = document.getElementById('history-table-body');
const historyEmptyState = document.getElementById('history-empty-state');
const historyPrevPageBtn = document.getElementById('history-prev-page-btn');
const historyNextPageBtn = document.getElementById('history-next-page-btn');
const historyPageIndicator = document.getElementById('history-page-indicator');

const symbolForm = document.getElementById('symbol-form');
const symbolLookupInput = document.getElementById('symbol-lookup');
const symbolLookupBtn = document.getElementById('symbol-lookup-btn');
const symbolCompanyNameInput = document.getElementById('symbol-company-name');
const symbolNewInput = document.getElementById('symbol-new');
const symbolSubmitBtn = document.getElementById('symbol-submit-btn');
const symbolClearBtn = document.getElementById('symbol-clear-btn');
const symbolError = document.getElementById('symbol-error');

const stockDatalist = document.getElementById('stock-datalist');

const symbolHistoryTableBody = document.getElementById('symbol-history-table-body');
const symbolHistoryEmptyState = document.getElementById('symbol-history-empty-state');
const symbolHistoryPrevPageBtn = document.getElementById('symbol-history-prev-page-btn');
const symbolHistoryNextPageBtn = document.getElementById('symbol-history-next-page-btn');
const symbolHistoryPageIndicator = document.getElementById('symbol-history-page-indicator');

const manualAddLogTableBody = document.getElementById('manual-add-log-table-body');
const manualAddLogEmptyState = document.getElementById('manual-add-log-empty-state');
const manualAddLogPrevPageBtn = document.getElementById('manual-add-log-prev-page-btn');
const manualAddLogNextPageBtn = document.getElementById('manual-add-log-next-page-btn');
const manualAddLogPageIndicator = document.getElementById('manual-add-log-page-indicator');

const removalCandidatesTableBody = document.getElementById('removal-candidates-table-body');
const removalCandidatesEmptyState = document.getElementById('removal-candidates-empty-state');
const removalPrevPageBtn = document.getElementById('removal-prev-page-btn');
const removalNextPageBtn = document.getElementById('removal-next-page-btn');
const removalPageIndicator = document.getElementById('removal-page-indicator');
const removalRefreshBtn = document.getElementById('removal-refresh-btn');
const removalRefreshStatus = document.getElementById('removal-refresh-status');

const deleteForm = document.getElementById('delete-form');
const deleteSymbolInput = document.getElementById('delete-symbol');
const deleteCompanyNameInput = document.getElementById('delete-company-name');
const deleteMarketInput = document.getElementById('delete-market');
const deleteLookupBtn = document.getElementById('delete-lookup-btn');
const deleteSubmitBtn = document.getElementById('delete-submit-btn');
const deleteClearBtn = document.getElementById('delete-clear-btn');
const deleteError = document.getElementById('delete-error');

const deletionLogTableBody = document.getElementById('deletion-log-table-body');
const deletionLogEmptyState = document.getElementById('deletion-log-empty-state');
const deletionPrevPageBtn = document.getElementById('deletion-prev-page-btn');
const deletionNextPageBtn = document.getElementById('deletion-next-page-btn');
const deletionPageIndicator = document.getElementById('deletion-page-indicator');

let renameTargetStock = null;
let symbolTargetStock = null;
let lastHistory = [];
let historyPage = 1;
let lastSymbolHistory = [];
let symbolHistoryPage = 1;
let lastManualAddLog = [];
let manualAddLogPage = 1;
let lastRemovalCandidates = [];
let removalPage = 1;
let lastDeletionLog = [];
let deletionPage = 1;
let deleteTargetStock = null;
let allStocks = [];
let currentPage = 1;
const PAGE_SIZE = 15;
let debounceTimer;

function applyStaticTranslations() {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

function updateFormHeader() {
  if (editingStock) {
    formTitle.textContent = t('editTitle')(editingStock.stock_symbol);
    submitBtn.textContent = t('saveBtn');
  } else {
    formTitle.textContent = t('addTitle');
    submitBtn.textContent = t('addBtn');
  }
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

// Warning for adding a symbol that's already in the list, with a link to its detail page.
function showDuplicateError(symbol) {
  const link = document.createElement('a');
  link.href = `/${encodeURIComponent(symbol.toLowerCase())}`;
  link.textContent = symbol;
  formError.replaceChildren(t('duplicateSymbol')(symbol), link);
  formError.hidden = false;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = '';
}

// Neutral (non-error) message under the add form; `symbol` appends a link to its detail page.
function showHint(message, symbol) {
  const parts = [message];
  if (symbol) {
    const link = document.createElement('a');
    link.href = `/${encodeURIComponent(symbol.toLowerCase())}`;
    link.textContent = symbol;
    parts.push(link);
  }
  formHint.replaceChildren(...parts);
  formHint.hidden = false;
}

function clearHint() {
  formHint.hidden = true;
  formHint.textContent = '';
}

// What the last Yahoo lookup put into the name/market inputs, so a later lookup (symbol
// changed) may overwrite them - but never overwrite something the user typed themselves.
let yahooFilled = { company_name: '', exchange: '' };

// Add mode only: once a symbol is entered, warn right away if it's a duplicate, otherwise
// pre-fill company name / market from Yahoo.
async function lookupSymbolForAdd() {
  if (stockIdInput.value) return;
  const symbol = stockSymbolInput.value.trim().toUpperCase();
  clearError();
  clearHint();
  if (!symbol) return;

  if (allStocks.some((s) => s.stock_symbol === symbol)) {
    showDuplicateError(symbol);
    return;
  }

  showHint(t('yahooLookupRunning')(symbol));
  let data = null;
  let existingSymbol = null;
  try {
    const res = await fetch(`${API_BASE}/yahoo-lookup/${encodeURIComponent(symbol)}`);
    if (res.ok) data = await res.json();
    // 409: we already hold it under another spelling ("BRK-B" typed, "BRK.B" held)
    else if (res.status === 409) existingSymbol = (await res.json()).existing_symbol || symbol;
  } catch {
    // treated the same as not found
  }
  // The user may have typed a different symbol (or submitted) while this was in flight.
  if (stockIdInput.value || stockSymbolInput.value.trim().toUpperCase() !== symbol) return;

  if (existingSymbol) {
    clearHint();
    showDuplicateError(existingSymbol);
    return;
  }
  if (!data) {
    showHint(t('yahooLookupNotFound')(symbol));
    return;
  }
  for (const [input, key] of [[companyNameInput, 'company_name'], [tradingMarketInput, 'exchange']]) {
    if (!input.value.trim() || input.value === yahooFilled[key]) {
      input.value = data[key] || '';
      yahooFilled[key] = input.value;
    }
  }
  showHint(t('yahooLookupFilled')(symbol, data.source));
}

function resetForm() {
  form.reset();
  stockIdInput.value = '';
  editingStock = null;
  cancelBtn.hidden = true;
  yahooFilled = { company_name: '', exchange: '' };
  updateFormHeader();
  clearError();
  clearHint();
}

function enterEditMode(stock) {
  stockIdInput.value = stock.id;
  stockSymbolInput.value = stock.stock_symbol;
  companyNameInput.value = stock.company_name;
  tradingMarketInput.value = stock.exchange;
  editingStock = stock;
  cancelBtn.hidden = false;
  updateFormHeader();
  clearError();
  clearHint();
  stockSymbolInput.focus();
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString(t('locale'));
}

async function fetchStocks() {
  const params = new URLSearchParams();
  if (marketFilter.value) params.set('market', marketFilter.value);
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());

  const res = await fetch(`${API_BASE}?${params.toString()}`);
  lastStocks = await res.json();
  currentPage = 1;
  renderTable(lastStocks);
  await fetchAllStocksForDatalist();
}

async function fetchAllStocksForDatalist() {
  const res = await fetch(API_BASE);
  allStocks = await res.json();
  populateStockDatalist();
}

function populateStockDatalist() {
  stockDatalist.innerHTML = '';
  const exchanges = new Set();
  for (const stock of allStocks) {
    const option = document.createElement('option');
    option.value = stock.stock_symbol;
    option.label = stock.company_name;
    stockDatalist.appendChild(option);
    if (stock.exchange) exchanges.add(stock.exchange);
  }

  exchangeDatalist.innerHTML = '';
  for (const exchange of [...exchanges].sort()) {
    const option = document.createElement('option');
    option.value = exchange;
    exchangeDatalist.appendChild(option);
  }

  // Market filter is a <select>, not a datalist input: once a datalist input held "OTC" the
  // browser only suggested values matching "OTC", so there was no way back to the other
  // markets without clearing it by hand. Keep the first "All Markets" option, rebuild the
  // rest from the markets actually present, and keep the current choice selected.
  const selected = marketFilter.value;
  while (marketFilter.options.length > 1) marketFilter.remove(1);
  for (const exchange of [...exchanges].sort()) {
    marketFilter.add(new Option(exchange, exchange));
  }
  marketFilter.value = exchanges.has(selected) ? selected : '';
}

function renderTable(stocks) {
  tableBody.innerHTML = '';
  emptyState.hidden = stocks.length > 0;

  const totalPages = Math.max(1, Math.ceil(stocks.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageStocks = stocks.slice(start, start + PAGE_SIZE);

  for (const stock of pageStocks) {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td><a class="stock-symbol-link" href="/${encodeURIComponent(stock.stock_symbol.toLowerCase())}">${escapeHtml(stock.stock_symbol)}</a></td>
      <td>${escapeHtml(stock.company_name)}</td>
      <td>${escapeHtml(stock.exchange)}</td>
      <td>${formatDate(stock.updated_at)}</td>
      <td class="row-actions">
        <button class="btn-edit" data-id="${stock.id}">${t('editBtn')}</button>
        <button class="btn-delete" data-id="${stock.id}">${t('deleteBtn')}</button>
      </td>
    `;

    tr.querySelector('.btn-edit').addEventListener('click', () => enterEditMode(stock));
    tr.querySelector('.btn-delete').addEventListener('click', () => deleteStock(stock));

    tableBody.appendChild(tr);
  }

  pageIndicator.textContent = t('pageIndicator')(currentPage, totalPages);
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}


async function deleteStock(stock) {
  const confirmed = confirm(t('confirmDelete')(stock.stock_symbol, stock.company_name));
  if (!confirmed) return;

  const res = await fetch(`${API_BASE}/${stock.id}`, { method: 'DELETE' });
  if (res.status === 204) {
    if (stockIdInput.value === String(stock.id)) resetForm();
    fetchStocks();
    fetchHistory();
    fetchSymbolHistory();
    fetchManualAddLog();
    fetchRemovalCandidates();
    fetchDeletionLog();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.errors?.join(', ') || t('deleteFailed'));
  }
}

function showRenameError(message) {
  renameError.textContent = message;
  renameError.hidden = false;
}

function clearRenameError() {
  renameError.hidden = true;
  renameError.textContent = '';
}

function resetRenameForm() {
  renameSymbolInput.value = '';
  renameTargetStock = null;
  renameCurrentNameInput.value = '';
  renameNewNameInput.value = '';
  renameNewNameInput.disabled = true;
  renameSubmitBtn.disabled = true;
  clearRenameError();
}

async function lookupRenameSymbol() {
  clearRenameError();
  const symbol = renameSymbolInput.value.trim().toUpperCase();
  if (!symbol) return;

  const res = await fetch(`${API_BASE}/by-symbol/${encodeURIComponent(symbol)}`);
  if (res.status === 404) {
    renameTargetStock = null;
    renameCurrentNameInput.value = '';
    renameNewNameInput.value = '';
    renameNewNameInput.disabled = true;
    renameSubmitBtn.disabled = true;
    showRenameError(t('renameNotFound'));
    return;
  }

  const stock = await res.json();
  renameTargetStock = stock;
  renameCurrentNameInput.value = stock.company_name;
  renameNewNameInput.value = '';
  renameNewNameInput.disabled = false;
  renameSubmitBtn.disabled = false;
  renameNewNameInput.focus();
}

async function fetchHistory() {
  const res = await fetch('/api/company-name-history');
  lastHistory = await res.json();
  historyPage = 1;
  renderHistory(lastHistory);
}

function renderHistory(history) {
  historyTableBody.innerHTML = '';
  historyEmptyState.hidden = history.length > 0;

  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  historyPage = Math.min(Math.max(1, historyPage), totalPages);

  const start = (historyPage - 1) * PAGE_SIZE;
  const pageItems = history.slice(start, start + PAGE_SIZE);

  for (const entry of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(entry.stock_symbol)}</td>
      <td>${escapeHtml(entry.old_company_name)}</td>
      <td>${escapeHtml(entry.new_company_name)}</td>
      <td>${formatDate(entry.changed_at)}</td>
    `;
    historyTableBody.appendChild(tr);
  }

  historyPageIndicator.textContent = t('pageIndicator')(historyPage, totalPages);
  historyPrevPageBtn.disabled = historyPage <= 1;
  historyNextPageBtn.disabled = historyPage >= totalPages;
}

historyPrevPageBtn.addEventListener('click', () => {
  historyPage -= 1;
  renderHistory(lastHistory);
});

historyNextPageBtn.addEventListener('click', () => {
  historyPage += 1;
  renderHistory(lastHistory);
});

renameSymbolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    lookupRenameSymbol();
  }
});

renameLookupBtn.addEventListener('click', lookupRenameSymbol);
renameClearBtn.addEventListener('click', resetRenameForm);

renameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearRenameError();

  if (!renameTargetStock) {
    showRenameError(t('renameNotFound'));
    return;
  }

  const newName = renameNewNameInput.value.trim();
  if (!newName) return;
  if (newName === renameTargetStock.company_name) {
    showRenameError(t('renameSameName'));
    return;
  }

  const res = await fetch(`${API_BASE}/${renameTargetStock.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_name: newName }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showRenameError(data.errors?.join(', ') || t('operationFailed'));
    return;
  }

  renameForm.reset();
  resetRenameForm();
  fetchStocks();
  fetchHistory();
});

function showSymbolError(message) {
  symbolError.textContent = message;
  symbolError.hidden = false;
}

function clearSymbolError() {
  symbolError.hidden = true;
  symbolError.textContent = '';
}

function resetSymbolForm() {
  symbolLookupInput.value = '';
  symbolTargetStock = null;
  symbolCompanyNameInput.value = '';
  symbolNewInput.value = '';
  symbolNewInput.disabled = true;
  symbolSubmitBtn.disabled = true;
  clearSymbolError();
}

async function lookupSymbol() {
  clearSymbolError();
  const symbol = symbolLookupInput.value.trim().toUpperCase();
  if (!symbol) return;

  const res = await fetch(`${API_BASE}/by-symbol/${encodeURIComponent(symbol)}`);
  if (res.status === 404) {
    symbolTargetStock = null;
    symbolCompanyNameInput.value = '';
    symbolNewInput.value = '';
    symbolNewInput.disabled = true;
    symbolSubmitBtn.disabled = true;
    showSymbolError(t('renameNotFound'));
    return;
  }

  const stock = await res.json();
  symbolTargetStock = stock;
  symbolCompanyNameInput.value = stock.company_name;
  symbolNewInput.value = '';
  symbolNewInput.disabled = false;
  symbolSubmitBtn.disabled = false;
  symbolNewInput.focus();
}

async function fetchSymbolHistory() {
  const res = await fetch('/api/stock-symbol-history');
  lastSymbolHistory = await res.json();
  symbolHistoryPage = 1;
  renderSymbolHistory(lastSymbolHistory);
}

function renderSymbolHistory(history) {
  symbolHistoryTableBody.innerHTML = '';
  symbolHistoryEmptyState.hidden = history.length > 0;

  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  symbolHistoryPage = Math.min(Math.max(1, symbolHistoryPage), totalPages);

  const start = (symbolHistoryPage - 1) * PAGE_SIZE;
  const pageItems = history.slice(start, start + PAGE_SIZE);

  for (const entry of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(entry.company_name)}</td>
      <td>${escapeHtml(entry.old_stock_symbol)}</td>
      <td>${escapeHtml(entry.new_stock_symbol)}</td>
      <td>${formatDate(entry.changed_at)}</td>
    `;
    symbolHistoryTableBody.appendChild(tr);
  }

  symbolHistoryPageIndicator.textContent = t('pageIndicator')(symbolHistoryPage, totalPages);
  symbolHistoryPrevPageBtn.disabled = symbolHistoryPage <= 1;
  symbolHistoryNextPageBtn.disabled = symbolHistoryPage >= totalPages;
}

symbolHistoryPrevPageBtn.addEventListener('click', () => {
  symbolHistoryPage -= 1;
  renderSymbolHistory(lastSymbolHistory);
});

symbolHistoryNextPageBtn.addEventListener('click', () => {
  symbolHistoryPage += 1;
  renderSymbolHistory(lastSymbolHistory);
});

async function fetchManualAddLog() {
  const res = await fetch(`${API_BASE}?source=manual`);
  lastManualAddLog = await res.json();
  manualAddLogPage = 1;
  renderManualAddLog(lastManualAddLog);
}

function renderManualAddLog(log) {
  manualAddLogTableBody.innerHTML = '';
  manualAddLogEmptyState.hidden = log.length > 0;

  const totalPages = Math.max(1, Math.ceil(log.length / PAGE_SIZE));
  manualAddLogPage = Math.min(Math.max(1, manualAddLogPage), totalPages);

  const start = (manualAddLogPage - 1) * PAGE_SIZE;
  const pageItems = log.slice(start, start + PAGE_SIZE);

  for (const stock of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(stock.stock_symbol)}</td>
      <td>${escapeHtml(stock.company_name)}</td>
      <td>${escapeHtml(stock.exchange)}</td>
      <td>${formatDate(stock.created_at)}</td>
    `;
    manualAddLogTableBody.appendChild(tr);
  }

  manualAddLogPageIndicator.textContent = t('pageIndicator')(manualAddLogPage, totalPages);
  manualAddLogPrevPageBtn.disabled = manualAddLogPage <= 1;
  manualAddLogNextPageBtn.disabled = manualAddLogPage >= totalPages;
}

manualAddLogPrevPageBtn.addEventListener('click', () => {
  manualAddLogPage -= 1;
  renderManualAddLog(lastManualAddLog);
});

manualAddLogNextPageBtn.addEventListener('click', () => {
  manualAddLogPage += 1;
  renderManualAddLog(lastManualAddLog);
});

function removalReasonLabel(reason) {
  if (reason === 'not_found_on_yahoo') return t('removalReasonNotFound');
  if (reason === 'no_longer_equity') return t('removalReasonNotEquity');
  if (reason === 'unsupported_exchange') return t('removalReasonUnsupportedExchange');
  return reason;
}

const REFRESH_POLL_MS = 3000;

// Runs the Yahoo status check server-side (same as scripts/check-stock-status.js), then
// reloads the removal candidates once it finishes.
async function startRemovalRefresh() {
  removalRefreshBtn.disabled = true;
  removalRefreshStatus.textContent = t('removalRefreshRunning');
  let res;
  try {
    res = await fetch('/api/removal-candidates/refresh', { method: 'POST' });
  } catch (err) {
    showRemovalRefreshError(err.message);
    return;
  }
  // 409 just means a run is already in progress - poll it the same way.
  if (!res.ok && res.status !== 409) {
    showRemovalRefreshError(res.status === 404 ? null : `HTTP ${res.status}`);
    return;
  }
  pollRemovalRefresh();
}

// message null = the endpoint doesn't exist (server still running pre-button code).
function showRemovalRefreshError(message) {
  removalRefreshBtn.disabled = false;
  removalRefreshStatus.textContent = message === null
    ? t('removalRefreshUnavailable')
    : t('removalRefreshFailed')(message);
}

// silent: used on page load, where there may be no run to report on - don't show errors then.
async function pollRemovalRefresh({ silent = false } = {}) {
  let state;
  try {
    const res = await fetch('/api/removal-candidates/refresh-status');
    if (!res.ok) {
      if (!silent) showRemovalRefreshError(res.status === 404 ? null : `HTTP ${res.status}`);
      return;
    }
    state = await res.json();
  } catch (err) {
    if (!silent) showRemovalRefreshError(err.message);
    return;
  }

  if (state.running) {
    removalRefreshBtn.disabled = true;
    removalRefreshStatus.textContent = t('removalRefreshRunning');
    setTimeout(pollRemovalRefresh, REFRESH_POLL_MS);
    return;
  }

  removalRefreshBtn.disabled = false;
  if (state.error) {
    removalRefreshStatus.textContent = t('removalRefreshFailed')(state.error);
  } else if (state.result) {
    removalRefreshStatus.textContent = t('removalRefreshDone')(state.result.removalCount, state.result.applied ?? 0)
      + (state.result.failedBatches ? t('removalRefreshPartial')(state.result.failedBatches) : '')
      + (state.result.listingAvailable === false ? t('removalRefreshNoListing') : '');
    fetchRemovalCandidates();
    // The re-check applies name/market changes directly, so the list and history changed too.
    if (state.result.applied) {
      fetchStocks();
      fetchHistory();
    }
  }
}

async function fetchRemovalCandidates() {
  const res = await fetch('/api/removal-candidates');
  lastRemovalCandidates = await res.json();
  removalPage = 1;
  renderRemovalCandidates(lastRemovalCandidates);
}

function renderRemovalCandidates(candidates) {
  removalCandidatesTableBody.innerHTML = '';
  removalCandidatesEmptyState.hidden = candidates.length > 0;

  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  removalPage = Math.min(Math.max(1, removalPage), totalPages);

  const start = (removalPage - 1) * PAGE_SIZE;
  const pageItems = candidates.slice(start, start + PAGE_SIZE);

  for (const c of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.stock_symbol)}</td>
      <td>${escapeHtml(c.company_name)}</td>
      <td>${escapeHtml(c.exchange)}</td>
      <td>${escapeHtml(removalReasonLabel(c.reason))}</td>
      <td>${formatDate(c.checked_at)}</td>
    `;
    removalCandidatesTableBody.appendChild(tr);
  }

  removalPageIndicator.textContent = t('pageIndicator')(removalPage, totalPages);
  removalPrevPageBtn.disabled = removalPage <= 1;
  removalNextPageBtn.disabled = removalPage >= totalPages;
}

removalRefreshBtn.addEventListener('click', startRemovalRefresh);

removalPrevPageBtn.addEventListener('click', () => {
  removalPage -= 1;
  renderRemovalCandidates(lastRemovalCandidates);
});

removalNextPageBtn.addEventListener('click', () => {
  removalPage += 1;
  renderRemovalCandidates(lastRemovalCandidates);
});

function showDeleteError(message) {
  deleteError.textContent = message;
  deleteError.hidden = false;
}

function clearDeleteError() {
  deleteError.hidden = true;
  deleteError.textContent = '';
}

function resetDeleteForm() {
  deleteSymbolInput.value = '';
  deleteTargetStock = null;
  deleteCompanyNameInput.value = '';
  deleteMarketInput.value = '';
  deleteSubmitBtn.disabled = true;
  clearDeleteError();
}

async function lookupDeleteSymbol() {
  clearDeleteError();
  const symbol = deleteSymbolInput.value.trim().toUpperCase();
  if (!symbol) return;

  const res = await fetch(`${API_BASE}/by-symbol/${encodeURIComponent(symbol)}`);
  if (res.status === 404) {
    deleteTargetStock = null;
    deleteCompanyNameInput.value = '';
    deleteMarketInput.value = '';
    deleteSubmitBtn.disabled = true;
    showDeleteError(t('renameNotFound'));
    return;
  }

  const stock = await res.json();
  deleteTargetStock = stock;
  deleteCompanyNameInput.value = stock.company_name;
  deleteMarketInput.value = stock.exchange;
  deleteSubmitBtn.disabled = false;
}

deleteSymbolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    lookupDeleteSymbol();
  }
});

deleteLookupBtn.addEventListener('click', lookupDeleteSymbol);
deleteClearBtn.addEventListener('click', resetDeleteForm);

deleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearDeleteError();

  if (!deleteTargetStock) {
    showDeleteError(t('renameNotFound'));
    return;
  }

  const confirmed = confirm(t('confirmDelete')(deleteTargetStock.stock_symbol, deleteTargetStock.company_name));
  if (!confirmed) return;

  const res = await fetch(`${API_BASE}/${deleteTargetStock.id}`, { method: 'DELETE' });

  if (res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    showDeleteError(data.errors?.join(', ') || t('deleteFailed'));
    return;
  }

  if (stockIdInput.value === String(deleteTargetStock.id)) resetForm();
  resetDeleteForm();
  fetchStocks();
  fetchHistory();
  fetchSymbolHistory();
  fetchManualAddLog();
  fetchRemovalCandidates();
  fetchDeletionLog();
});

async function fetchDeletionLog() {
  const res = await fetch('/api/stock-deletion-log');
  lastDeletionLog = await res.json();
  deletionPage = 1;
  renderDeletionLog(lastDeletionLog);
}

function renderDeletionLog(log) {
  deletionLogTableBody.innerHTML = '';
  deletionLogEmptyState.hidden = log.length > 0;

  const totalPages = Math.max(1, Math.ceil(log.length / PAGE_SIZE));
  deletionPage = Math.min(Math.max(1, deletionPage), totalPages);

  const start = (deletionPage - 1) * PAGE_SIZE;
  const pageItems = log.slice(start, start + PAGE_SIZE);

  for (const entry of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(entry.stock_symbol)}</td>
      <td>${escapeHtml(entry.company_name)}</td>
      <td>${escapeHtml(entry.exchange)}</td>
      <td>${formatDate(entry.deleted_at)}</td>
    `;
    deletionLogTableBody.appendChild(tr);
  }

  deletionPageIndicator.textContent = t('pageIndicator')(deletionPage, totalPages);
  deletionPrevPageBtn.disabled = deletionPage <= 1;
  deletionNextPageBtn.disabled = deletionPage >= totalPages;
}

deletionPrevPageBtn.addEventListener('click', () => {
  deletionPage -= 1;
  renderDeletionLog(lastDeletionLog);
});

deletionNextPageBtn.addEventListener('click', () => {
  deletionPage += 1;
  renderDeletionLog(lastDeletionLog);
});

symbolLookupInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    lookupSymbol();
  }
});

symbolLookupBtn.addEventListener('click', lookupSymbol);
symbolClearBtn.addEventListener('click', resetSymbolForm);

symbolForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearSymbolError();

  if (!symbolTargetStock) {
    showSymbolError(t('renameNotFound'));
    return;
  }

  const newSymbol = symbolNewInput.value.trim().toUpperCase();
  if (!newSymbol) return;
  if (newSymbol === symbolTargetStock.stock_symbol) {
    showSymbolError(t('symbolSameSymbol'));
    return;
  }

  const res = await fetch(`${API_BASE}/${symbolTargetStock.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock_symbol: newSymbol }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showSymbolError(data.errors?.join(', ') || t('operationFailed'));
    return;
  }

  symbolForm.reset();
  resetSymbolForm();
  fetchStocks();
  fetchSymbolHistory();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  clearHint();

  const payload = {
    stock_symbol: stockSymbolInput.value.trim(),
    company_name: companyNameInput.value.trim(),
    exchange: tradingMarketInput.value.trim(),
  };

  const id = stockIdInput.value;
  const isEdit = Boolean(id);

  const upperSymbol = payload.stock_symbol.toUpperCase();
  if (!isEdit && allStocks.some((s) => s.stock_symbol === upperSymbol)) {
    showDuplicateError(upperSymbol);
    return;
  }

  const res = await fetch(isEdit ? `${API_BASE}/${id}` : API_BASE, {
    method: isEdit ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 409) {
      // existing_symbol: the spelling we actually hold ("BRK.B" when "BRK-B" was typed)
      showDuplicateError(data.existing_symbol || upperSymbol);
    } else {
      showError(data.errors?.join(', ') || t('operationFailed'));
    }
    return;
  }

  resetForm();
  if (!isEdit) showHint(t('addedStock')(data.stock_symbol), data.stock_symbol);
  fetchStocks();
  fetchHistory();
  fetchSymbolHistory();
  if (!isEdit) fetchManualAddLog();
});

// 'change' fires once the symbol is committed (blur / Enter / datalist pick), not per keystroke.
stockSymbolInput.addEventListener('change', lookupSymbolForAdd);

cancelBtn.addEventListener('click', resetForm);

searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchStocks, 300);
});

marketFilter.addEventListener('change', fetchStocks);

// Exports exactly what the list currently shows: same market / search filters as
// fetchStocks(), all columns, served as a download by GET /api/stocks/export.csv.
exportCsvBtn.addEventListener('click', () => {
  const params = new URLSearchParams();
  if (marketFilter.value) params.set('market', marketFilter.value);
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  window.location.href = `${API_BASE}/export.csv?${params.toString()}`;
});

prevPageBtn.addEventListener('click', () => {
  currentPage -= 1;
  renderTable(lastStocks);
});

nextPageBtn.addEventListener('click', () => {
  currentPage += 1;
  renderTable(lastStocks);
});

langSwitch.addEventListener('change', () => {
  currentLang = langSwitch.value;
  localStorage.setItem('lang', currentLang);
  applyStaticTranslations();
  updateFormHeader();
  renderTable(lastStocks);
  renderHistory(lastHistory);
  renderSymbolHistory(lastSymbolHistory);
  renderManualAddLog(lastManualAddLog);
  renderRemovalCandidates(lastRemovalCandidates);
  renderDeletionLog(lastDeletionLog);
});

langSwitch.value = currentLang;
applyStaticTranslations();
updateFormHeader();
resetRenameForm();
resetSymbolForm();
resetDeleteForm();
fetchStocks();
fetchHistory();
fetchSymbolHistory();
fetchManualAddLog();
fetchRemovalCandidates();
fetchDeletionLog();
pollRemovalRefresh({ silent: true }); // pick up a check still running from before a page reload
