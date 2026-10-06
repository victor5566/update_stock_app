// Shared by both pages (index.html -> app.js, stock.html -> stock.js): translations, API helpers
// and the small UI components, styled with Tailwind CSS (compiled by `npm run build` into
// build/app.css). React comes from its UMD builds (served by server.js under /vendor/) - no
// bundler, no JSX: h() is React.createElement.
const h = React.createElement;
const { useState, useEffect, useRef, useCallback, useContext, createContext, Fragment } = React;

const API = '/api';
const PAGE_SIZE = 15;

const TRANSLATIONS = {
  zh: {
    locale: 'zh-TW',
    pageTitle: '股票代碼維護系統',
    detailTitle: '公司資訊',
    subtitle: 'company_profiles',
    backToList: '← 返回股票列表',
    tabList: '股票列表',
    tabForm: '新增／編輯',
    tabEdit: '修改資料',
    tabMonitor: '股票偵測',
    labelSymbol: '股票代碼',
    labelCompany: '公司名稱',
    labelMarket: '交易市場',
    labelCategory: '類別',
    labelDelisted: '已下市',
    labelCusips: 'CUSIP',
    labelSector: '產業別',
    labelIndustry: '細分產業',
    labelCurrency: '幣別',
    labelLocation: '公司所在地',
    labelUrl: '官方網站',
    labelCeo: '執行長',
    labelDescription: '公司簡介',
    labelUpdated: '更新時間',
    labelActions: '操作',
    listed: '上市',
    delisted: '已下市',
    yes: '是',
    no: '否',
    cancel: '取消',
    searchPlaceholder: '搜尋代碼或公司名稱',
    allMarkets: '全部市場',
    exportCsvBtn: '匯出 CSV',
    emptyState: '目前沒有資料',
    loading: '載入中…',
    prevPage: '上一頁',
    nextPage: '下一頁',
    pageIndicator: (page, totalPages, total) => `第 ${page} / ${totalPages} 頁（共 ${total.toLocaleString('zh-TW')} 筆）`,
    addTitle: '新增股票',
    addHelp: '輸入股票代碼後，會自動從 NASDAQ Trader 與 Yahoo 帶入公司名稱與交易市場。新增後，系統會即時查詢產業、地址、官網、CEO、簡介與 CUSIP。',
    editTitle: (symbol) => `編輯股票：${symbol}`,
    addBtn: '新增',
    saveBtn: '儲存更新',
    editBtn: '編輯',
    operationFailed: '操作失敗',
    duplicateSymbol: (symbol) => `股票代碼 ${symbol} 已存在，不能重複新增。查看：`,
    yahooLookupRunning: (symbol) => `正在查詢 ${symbol}…`,
    yahooLookupFilled: (symbol, source) => `已從${source === 'nasdaq_trader' ? ' NASDAQ Trader 官方清單' : ' Yahoo'}帶入 ${symbol} 的公司名稱與交易市場，請確認後新增`,
    yahooLookupNotFound: (symbol) => `NASDAQ Trader 官方清單與 Yahoo 都查無 ${symbol}，請手動填寫公司名稱與交易市場`,
    addingStock: (symbol) => `正在新增 ${symbol}，並即時查詢公司資料與 CUSIP（約需數秒）…`,
    addedStock: (symbol) => `已新增 ${symbol}。查看：`,
    addedAllFound: (symbol) => `已新增 ${symbol}，公司資料與 CUSIP 均已取得。查看：`,
    addedSomeMissing: (symbol) => `已新增 ${symbol}，但部分資料目前無法取得，原因如下。查看：`,
    addedPending: (symbol) => `已新增 ${symbol}。資料來源回應較慢，查詢仍在背景進行，稍後請到詳細頁查看結果：`,
    afTitle: '部分資料目前無法取得：',
    afDetailsLabel: '公司資料（產業、地址、官網、CEO、簡介）：',
    afDetailsNotFound: 'Yahoo Finance 目前沒有這檔股票的公司資料。新上市股票常見，Yahoo 通常數小時到數天後才會建立。',
    afCusipLabel: 'CUSIP：',
    afCusipNoSource: '所有來源都查不到——',
    afCusipConflict: (cusip, source, symbol) => `查到 ${cusip}（來源 ${source}），但這個號碼已屬於 ${symbol}。兩檔股票不可能共用同一個 CUSIP，為避免寫入錯誤資料而未寫入，需人工確認哪一邊正確。`,
    afError: (message) => `查詢失敗（${message}），可能是網路或來源網站暫時異常。`,
    afReasons: {
      no_contact: () => '未設定 SEC_EDGAR_CONTACT，無法查詢 SEC',
      no_cik: () => '此代碼不在 SEC 的公司代碼清單中（外國公司、OTC 股票，或剛上市尚未收錄）',
      skipped_non_common: () => '特別股／債券／權證／單位的 CUSIP 不會出現在 SEC 13G 申報中，因此不查 SEC',
      skipped_multi_class: () => '此公司有多個股票類別，SEC 13G 申報無法區分是哪一類，因此不查 SEC',
      no_13g: () => '尚無關於此公司的 13G 持股申報（新上市公司，或沒有機構持股超過 5%）',
      unusable_13g: () => '有 13G 申報，但申報的發行人名稱或 CUSIP 無法確認',
      conflicting_13g: () => '13G 申報中的 CUSIP 彼此不一致，無法判斷哪個正確',
      not_found: () => '查無此代碼',
      name_mismatch: (detail) => `頁面上的證券名稱${detail ? `（${detail}）` : ''}與公司名稱不符，可能是此代碼前一家公司的資料`,
      no_cusip_on_page: () => '頁面上沒有 CUSIP',
      invalid_check_digit: () => '查到的 CUSIP 檢查碼錯誤',
      error: (detail) => `連線失敗（${detail}）`,
    },
    afRetryAt: (time) => `系統會在 ${time} 自動重新查詢。`,
    afRetryAtDetail: (time) => `系統會在 ${time} 自動重新查詢，本頁會自動更新。`,
    afRetriesExhausted: '自動重試已結束，仍無法取得；可稍後執行 scripts/fill-company-details.js 或 scripts/fill-cusip.js。',
    editSectionHelp: '先輸入股票代碼並按「查詢」，再填入新的值。',
    renameSectionTitle: '修改公司名稱',
    renameCurrentName: '目前公司名稱',
    renameNewNameLabel: '新公司名稱',
    renameSubmitBtn: '更新名稱',
    symbolSectionTitle: '修改股票代碼',
    symbolCurrentLabel: '目前股票代碼',
    symbolNewLabel: '新股票代碼',
    symbolSubmitBtn: '更新代碼',
    marketSectionTitle: '修改交易市場',
    marketCurrentLabel: '目前交易市場',
    marketNewLabel: '新交易市場',
    marketSubmitBtn: '更新市場',
    lookupBtn: '查詢',
    clearBtn: '清空',
    stockNotFound: '找不到此股票代碼',
    renameSameName: '新名稱與目前名稱相同',
    symbolSameSymbol: '新代碼與目前代碼相同',
    marketSameMarket: '新市場與目前市場相同',
    updatedOk: (symbol) => `已更新 ${symbol}。查看：`,
    monitorTitle: '股票偵測與自動更新',
    monitorHelp: '確認每檔股票上市或下市，更新名稱、市場、Category、幣別，並補上缺少的公司資料與 CUSIP。不會刪除任何股票。',
    monitorPreviewBtn: '預覽（不寫入）',
    monitorApplyBtn: '偵測並更新',
    monitorStopBtn: '中止',
    monitorConfirmApply: '將檢查全部股票並直接寫入資料庫（不會刪除任何股票），約需數分鐘。確定要執行嗎？',
    monitorStarting: '啟動中…',
    monitorStopping: '正在中止，會在目前這筆處理完後停止…',
    monitorAlreadyRunning: '已有偵測正在執行',
    monitorFailed: (msg) => `偵測失敗：${msg}`,
    monitorRunning: (apply, phase, done, total) => `${apply ? '偵測並更新中' : '預覽中'}：${({ loading: '讀取資料', quotes: '取得 Yahoo 報價', updating: '比對與更新', details: '補公司資料', cusip: '補 CUSIP' })[phase] || phase}${total ? ` ${done.toLocaleString()}/${total.toLocaleString()}` : ''}…`,
    monitorStoppedNote: (r) => (r.stoppedDuringQuotes ? '【已中止：在取得報價階段停止，未寫入任何變更】' : `【已中止${r.apply ? '，中止前的變更已寫入' : ''}】`),
    monitorSummary: (r, fields) => `上次${r.apply ? '偵測並更新' : '預覽（未寫入）'}（${new Date(r.finishedAt).toLocaleString('zh-TW')}${r.trigger === 'schedule' ? '，排程' : ''}）：檢查 ${r.counts.checked.toLocaleString()} 筆，上市 ${r.counts.listed.toLocaleString()}、下市 ${r.counts.delisted.toLocaleString()}、無法判斷 ${r.counts.unknown.toLocaleString()}。`
      + `欄位變更：${Object.entries(r.fieldCounts).map(([f, n]) => `${fields[f] || f} ${n}`).join('、') || '無'}${r.apply ? `（已更新 ${r.counts.updated} 筆${r.counts.errors ? `，失敗 ${r.counts.errors}` : ''}）` : ''}。`
      + `公司資料：${r.apply ? `補了 ${r.details.filled}/${r.details.tried} 筆，` : ''}尚缺 ${r.details.missing.toLocaleString()} 筆。CUSIP：${r.apply ? `補了 ${r.cusip.filled}/${r.cusip.tried} 筆，` : ''}尚缺 ${r.cusip.missing.toLocaleString()} 筆。`
      + `${r.listingAvailable ? '' : '（注意：NASDAQ Trader 清單無法下載）'}${r.failedQuotes ? `（注意：${r.failedQuotes} 個代號 Yahoo 查詢失敗，狀態未變更）` : ''}`,
    monitorNext: (time) => `下次排程：${new Date(time).toLocaleString('zh-TW')}`,
    monitorThStatus: '狀態',
    monitorThChanges: '變更內容／說明',
    monitorEmpty: '尚無偵測結果',
    monitorStatus: { listed: '上市', delisted: '下市', unknown: '無法判斷' },
    monitorFields: { company_name: '名稱', exchange: '市場', isdelisted: '下市', category: 'Category', currency: '幣別' },
  },
  en: {
    locale: 'en-US',
    pageTitle: 'Stock Symbol Maintenance',
    detailTitle: 'Company Info',
    subtitle: 'company_profiles',
    backToList: '← Back to Stock List',
    tabList: 'Stock List',
    tabForm: 'Add / Edit',
    tabEdit: 'Update Data',
    tabMonitor: 'Stock Monitor',
    labelSymbol: 'Stock Symbol',
    labelCompany: 'Company Name',
    labelMarket: 'Trading Market',
    labelCategory: 'Category',
    labelDelisted: 'Delisted',
    labelCusips: 'CUSIP',
    labelSector: 'Sector',
    labelIndustry: 'Industry',
    labelCurrency: 'Currency',
    labelLocation: 'Company Location',
    labelUrl: 'Website',
    labelCeo: 'CEO',
    labelDescription: 'Description',
    labelUpdated: 'Updated At',
    labelActions: 'Actions',
    listed: 'Listed',
    delisted: 'Delisted',
    yes: 'Yes',
    no: 'No',
    cancel: 'Cancel',
    searchPlaceholder: 'Search symbol or company name',
    allMarkets: 'All Markets',
    exportCsvBtn: 'Export CSV',
    emptyState: 'No data yet',
    loading: 'Loading…',
    prevPage: 'Previous',
    nextPage: 'Next',
    pageIndicator: (page, totalPages, total) => `Page ${page} of ${totalPages} (${total.toLocaleString('en-US')} stocks)`,
    addTitle: 'Add Stock',
    addHelp: "Enter a stock symbol and the company name and market are filled in from NASDAQ Trader and Yahoo. After the add, the server looks up sector, address, website, CEO, description and CUSIP right away.",
    editTitle: (symbol) => `Edit Stock: ${symbol}`,
    addBtn: 'Add',
    saveBtn: 'Save Changes',
    editBtn: 'Edit',
    operationFailed: 'Operation failed',
    duplicateSymbol: (symbol) => `Stock symbol ${symbol} already exists and cannot be added again. View: `,
    yahooLookupRunning: (symbol) => `Looking up ${symbol}…`,
    yahooLookupFilled: (symbol, source) => `Filled in ${symbol}'s company name and market from ${source === 'nasdaq_trader' ? "NASDAQ Trader's official listing" : 'Yahoo'} - check them, then add`,
    yahooLookupNotFound: (symbol) => `${symbol} not found on NASDAQ Trader's listing or Yahoo - fill in the company name and market manually`,
    addingStock: (symbol) => `Adding ${symbol} and looking up its company info and CUSIP (takes a few seconds)…`,
    addedStock: (symbol) => `Added ${symbol}. View: `,
    addedAllFound: (symbol) => `Added ${symbol}; company info and CUSIP were both found. View: `,
    addedSomeMissing: (symbol) => `Added ${symbol}, but some data isn't available yet - reasons below. View: `,
    addedPending: (symbol) => `Added ${symbol}. The data sources are slow to answer; the lookup continues in the background - check the detail page shortly: `,
    afTitle: "Some data isn't available yet:",
    afDetailsLabel: 'Company info (sector, address, website, CEO, description): ',
    afDetailsNotFound: 'Yahoo Finance has no company profile for this stock yet. Common for new listings - Yahoo usually adds one within hours to days.',
    afCusipLabel: 'CUSIP: ',
    afCusipNoSource: 'no source had it - ',
    afCusipConflict: (cusip, source, symbol) => `found ${cusip} (from ${source}), but that number already belongs to ${symbol}. Two stocks can't share a CUSIP, so it wasn't written - someone needs to check which one is right.`,
    afError: (message) => `lookup failed (${message}) - the network or the source site may be having trouble.`,
    afReasons: {
      no_contact: () => 'SEC_EDGAR_CONTACT is not set, so SEC cannot be queried',
      no_cik: () => "this symbol isn't in SEC's company ticker list (foreign company, OTC stock, or too new to be listed)",
      skipped_non_common: () => "preferreds / notes / warrants / units have CUSIPs that SEC 13G filings don't carry, so SEC was skipped",
      skipped_multi_class: () => "this company has several share classes and its 13G filings don't say which, so SEC was skipped",
      no_13g: () => 'no 13G ownership filing about this company yet (newly listed, or no institution holds over 5%)',
      unusable_13g: () => "13G filings exist, but their issuer name or CUSIP couldn't be confirmed",
      conflicting_13g: () => "the 13G filings disagree on the CUSIP, so it can't be told which is right",
      not_found: () => 'symbol not found',
      name_mismatch: (detail) => `the security name on the page${detail ? ` (${detail})` : ''} doesn't match the company - probably the symbol's previous owner`,
      no_cusip_on_page: () => 'the page has no CUSIP',
      invalid_check_digit: () => 'the CUSIP found has a wrong check digit',
      error: (detail) => `request failed (${detail})`,
    },
    afRetryAt: (time) => `It will be looked up again automatically at ${time}.`,
    afRetryAtDetail: (time) => `It will be looked up again automatically at ${time}; this page updates itself.`,
    afRetriesExhausted: 'Automatic retries are over and it is still missing; run scripts/fill-company-details.js or scripts/fill-cusip.js later.',
    editSectionHelp: 'Enter a stock symbol and click Lookup first, then fill in the new value.',
    renameSectionTitle: 'Update Company Name',
    renameCurrentName: 'Current Company Name',
    renameNewNameLabel: 'New Company Name',
    renameSubmitBtn: 'Update Name',
    symbolSectionTitle: 'Update Stock Symbol',
    symbolCurrentLabel: 'Current Stock Symbol',
    symbolNewLabel: 'New Stock Symbol',
    symbolSubmitBtn: 'Update Symbol',
    marketSectionTitle: 'Update Trading Market',
    marketCurrentLabel: 'Current Trading Market',
    marketNewLabel: 'New Trading Market',
    marketSubmitBtn: 'Update Market',
    lookupBtn: 'Lookup',
    clearBtn: 'Clear',
    stockNotFound: 'Stock symbol not found',
    renameSameName: 'New name is the same as the current name',
    symbolSameSymbol: 'New symbol is the same as the current symbol',
    marketSameMarket: 'New market is the same as the current market',
    updatedOk: (symbol) => `Updated ${symbol}. View: `,
    monitorTitle: 'Stock Monitor & Auto Update',
    monitorHelp: 'Checks whether each stock is listed or delisted, updates name, market, category and currency, and fills in missing company info and CUSIPs. Never deletes a stock.',
    monitorPreviewBtn: 'Preview (no writes)',
    monitorApplyBtn: 'Check & Update',
    monitorStopBtn: 'Stop',
    monitorConfirmApply: 'This checks every stock and writes changes to the database (nothing is deleted). It takes a few minutes. Continue?',
    monitorStarting: 'Starting…',
    monitorStopping: 'Stopping after the current row…',
    monitorAlreadyRunning: 'A check is already running',
    monitorFailed: (msg) => `Check failed: ${msg}`,
    monitorRunning: (apply, phase, done, total) => `${apply ? 'Checking & updating' : 'Previewing'}: ${({ loading: 'loading rows', quotes: 'fetching Yahoo quotes', updating: 'comparing & updating', details: 'filling company info', cusip: 'filling CUSIPs' })[phase] || phase}${total ? ` ${done.toLocaleString()}/${total.toLocaleString()}` : ''}…`,
    monitorStoppedNote: (r) => (r.stoppedDuringQuotes ? '[Stopped while fetching quotes - nothing was written] ' : `[Stopped${r.apply ? ' - changes made before the stop were written' : ''}] `),
    monitorSummary: (r, fields) => `Last ${r.apply ? 'check & update' : 'preview (nothing written)'} (${new Date(r.finishedAt).toLocaleString('en-US')}${r.trigger === 'schedule' ? ', scheduled' : ''}): checked ${r.counts.checked.toLocaleString()} - listed ${r.counts.listed.toLocaleString()}, delisted ${r.counts.delisted.toLocaleString()}, unknown ${r.counts.unknown.toLocaleString()}. `
      + `Field changes: ${Object.entries(r.fieldCounts).map(([f, n]) => `${fields[f] || f} ${n}`).join(', ') || 'none'}${r.apply ? ` (${r.counts.updated} rows updated${r.counts.errors ? `, ${r.counts.errors} failed` : ''})` : ''}. `
      + `Company info: ${r.apply ? `filled ${r.details.filled}/${r.details.tried}, ` : ''}${r.details.missing.toLocaleString()} still missing. CUSIP: ${r.apply ? `filled ${r.cusip.filled}/${r.cusip.tried}, ` : ''}${r.cusip.missing.toLocaleString()} still missing.`
      + `${r.listingAvailable ? '' : ' (warning: NASDAQ Trader listing unavailable)'}${r.failedQuotes ? ` (warning: ${r.failedQuotes} symbols failed on Yahoo - status left alone)` : ''}`,
    monitorNext: (time) => `Next scheduled run: ${new Date(time).toLocaleString('en-US')}`,
    monitorThStatus: 'Status',
    monitorThChanges: 'Changes / Notes',
    monitorEmpty: 'No results yet',
    monitorStatus: { listed: 'Listed', delisted: 'Delisted', unknown: 'Unknown' },
    monitorFields: { company_name: 'Name', exchange: 'Market', isdelisted: 'Delisted', category: 'Category', currency: 'Currency' },
  },
};

// --- Language: kept in localStorage (which can throw in private windows) ---
const LangContext = createContext('zh');

function useT() {
  const lang = useContext(LangContext);
  return (key) => TRANSLATIONS[lang][key];
}

function useLang(titleKey) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('lang') === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  });
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    document.title = TRANSLATIONS[lang][titleKey];
    try {
      localStorage.setItem('lang', lang);
    } catch {
      // the choice just isn't remembered
    }
  }, [lang, titleKey]);
  return [lang, setLang];
}

// --- Helpers ---
const cx = (...classes) => classes.filter(Boolean).join(' ');

// Detail page link. With an id it opens that exact row - a symbol can have several (a recycled
// ticker keeps its delisted row).
function stockHref(symbol, id) {
  return `/${encodeURIComponent(symbol.toLowerCase())}${id ? `?id=${id}` : ''}`;
}

// Lines joined with <br>, passed as separate children so React needs no keys.
function withBreaks(lines) {
  return lines.flatMap((line, i) => (i ? [h('br'), line] : [line]));
}

// Why fields are still empty after an add - `report` is the `autofill` object from
// POST /api/stocks, GET /api/stocks/:id or by-symbol (see autoFillNewStock in routes/stocks.js).
function autoFillProblems(report, t) {
  const lines = [];
  if (!report || report.pending) return lines;
  const { details, cusip } = report;
  if (details.status === 'not_found') lines.push(t('afDetailsLabel') + t('afDetailsNotFound'));
  else if (details.status === 'error') lines.push(t('afDetailsLabel') + t('afError')(details.message));
  if (cusip.status === 'conflict') {
    lines.push(t('afCusipLabel') + t('afCusipConflict')(cusip.cusip, cusip.source, cusip.conflict_symbol));
  } else if (cusip.status === 'error') {
    lines.push(t('afCusipLabel') + t('afError')(cusip.message));
  } else if (cusip.status === 'not_found') {
    const reasons = (cusip.reasons || []).map((r) => {
      const describe = t('afReasons')[r.code];
      return `${r.source}: ${describe ? describe(r.detail) : r.code}`;
    });
    lines.push(t('afCusipLabel') + t('afCusipNoSource') + reasons.join('; '));
  }
  return lines;
}

function retryNote(report, t, key = 'afRetryAt') {
  if (report.next_retry_at) {
    const time = new Date(report.next_retry_at).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
    return t(key)(time);
  }
  return report.retries_exhausted ? t('afRetriesExhausted') : null;
}

// --- UI components (Tailwind) ---
function Card({ title, actions, children, className, id }) {
  return h('section', { id, className: cx('min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900', className) },
    (title || actions) && h('div', { className: 'mb-4 flex flex-wrap items-center justify-between gap-3' },
      title && h('h2', { className: 'text-base font-semibold text-slate-900 dark:text-slate-100' }, title),
      actions && h('div', { className: 'flex flex-wrap items-center gap-2' }, actions)),
    children);
}

const BUTTON_VARIANTS = {
  primary: 'bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus-visible:outline-blue-600',
  secondary: 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  subtle: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:outline-red-600',
};

function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }) {
  return h('button', {
    type,
    className: cx(
      'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm',
      BUTTON_VARIANTS[variant],
      className,
    ),
    ...props,
  });
}

const CONTROL = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-400';

const Input = React.forwardRef(function Input({ className, ...props }, ref) {
  return h('input', { ref, className: cx(CONTROL, className), ...props });
});

function Select({ className, children, ...props }) {
  return h('select', { className: cx(CONTROL, 'pr-8', className), ...props }, children);
}

function Field({ label, htmlFor, children, className }) {
  return h('div', { className: cx('flex flex-col gap-1.5', className) },
    h('label', { htmlFor, className: 'text-xs font-medium text-slate-600 dark:text-slate-400' }, label),
    children);
}

const ALERT_TONES = {
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
  info: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
};

function Alert({ tone = 'info', children, id, className, live }) {
  return h('div', { id, role: tone === 'error' ? 'alert' : 'status', 'aria-live': live, className: cx('rounded-lg border px-3 py-2 text-sm leading-relaxed', ALERT_TONES[tone], className) }, children);
}

const BADGE_TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300',
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300',
};

function Badge({ tone = 'gray', children, title }) {
  return h('span', { title, className: cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE_TONES[tone]) }, children);
}

function StockLink({ symbol, id, className }) {
  return h('a', { href: stockHref(symbol, id), className: cx('font-medium text-blue-600 hover:underline dark:text-blue-400', className) }, symbol);
}

function Pagination({ page, totalPages, total, onPage, idPrefix = '' }) {
  const t = useT();
  return h('div', { className: 'mt-4 flex flex-wrap items-center justify-between gap-3' },
    h('span', { id: `${idPrefix}page-indicator`, className: 'text-sm text-slate-500 dark:text-slate-400' }, t('pageIndicator')(page, totalPages, total)),
    h('div', { className: 'flex gap-2' },
      h(Button, { id: `${idPrefix}prev-page-btn`, size: 'sm', disabled: page <= 1, onClick: () => onPage(page - 1) }, t('prevPage')),
      h(Button, { id: `${idPrefix}next-page-btn`, size: 'sm', disabled: page >= totalPages, onClick: () => onPage(page + 1) }, t('nextPage'))));
}

// Table pieces, so both tables look the same.
const TH = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
const TD = 'px-3 py-2.5 align-top text-slate-700 dark:text-slate-300';

function Table({ id, head, children }) {
  return h('div', { className: 'overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800' },
    h('table', { id, className: 'min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800' },
      h('thead', { className: 'bg-slate-50 dark:bg-slate-800/60' }, h('tr', null, ...head.map((label) => h('th', { key: label, className: TH }, label)))),
      h('tbody', { className: 'divide-y divide-slate-100 dark:divide-slate-800' }, children)));
}

function LangSelect({ lang, setLang }) {
  return h('select', {
    id: 'lang-switch',
    'aria-label': 'Language',
    value: lang,
    onChange: (e) => setLang(e.target.value),
    className: 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
  }, h('option', { value: 'zh' }, '中文'), h('option', { value: 'en' }, 'English'));
}

function PageHeader({ title, subtitle, lang, setLang }) {
  return h('header', { className: 'border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80' },
    h('div', { className: 'mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6' },
      h('div', { className: 'min-w-0' },
        h('h1', { id: 'page-heading', className: 'truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white' }, title),
        subtitle && h('div', { className: 'mt-0.5 text-sm text-slate-500 dark:text-slate-400' }, subtitle)),
      h(LangSelect, { lang, setLang })));
}
