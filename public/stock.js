const TRANSLATIONS = {
  zh: {
    detailTitle: '公司資訊',
    backToList: '← 返回股票列表',
    stockNotFound: '找不到此股票代碼',
    labelSymbol: '股票代碼',
    labelCompany: '公司名稱',
    labelMarket: '交易市場',
    labelCategory: '類別',
    labelCusips: 'CUSIP',
    labelSector: '產業別',
    labelIndustry: '細分產業',
    labelCurrency: '幣別',
    labelLocation: '公司所在地',
    labelUrl: '官方網站',
    labelCeo: '執行長',
    labelDelisted: '已除牌',
    labelDescription: '公司簡介',
    yes: '是',
    no: '否',
    locale: 'zh-TW',
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
    afRetryAt: (time) => `系統會在 ${time} 自動重新查詢，本頁會自動更新。`,
    afRetriesExhausted: '自動重試已結束，仍無法取得；可稍後執行 scripts/fill-company-details.js 或 scripts/fill-cusip.js。',
  },
  en: {
    detailTitle: 'Company Info',
    backToList: '← Back to Stock List',
    stockNotFound: 'Stock symbol not found',
    labelSymbol: 'Stock Symbol',
    labelCompany: 'Company Name',
    labelMarket: 'Trading Market',
    labelCategory: 'Category',
    labelCusips: 'CUSIP',
    labelSector: 'Sector',
    labelIndustry: 'Industry',
    labelCurrency: 'Currency',
    labelLocation: 'Company Location',
    labelUrl: 'Website',
    labelCeo: 'CEO',
    labelDelisted: 'Delisted',
    labelDescription: 'Description',
    yes: 'Yes',
    no: 'No',
    locale: 'en-US',
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
    afRetryAt: (time) => `It will be looked up again automatically at ${time}; this page updates itself.`,
    afRetriesExhausted: 'Automatic retries are over and it is still missing; run scripts/fill-company-details.js or scripts/fill-cusip.js later.',
  },
};

let currentLang = localStorage.getItem('lang') || 'zh';

function t(key) {
  return TRANSLATIONS[currentLang][key];
}

const langSwitch = document.getElementById('lang-switch');
const pageHeading = document.getElementById('page-heading');
const notFoundSection = document.getElementById('not-found-section');
const detailSection = document.getElementById('detail-section');

const detailFields = {
  symbol: document.getElementById('detail-symbol'),
  company_name: document.getElementById('detail-company-name'),
  exchange: document.getElementById('detail-exchange'),
  category: document.getElementById('detail-category'),
  isdelisted: document.getElementById('detail-isdelisted'),
  cusips: document.getElementById('detail-cusips'),
  sector: document.getElementById('detail-sector'),
  industry: document.getElementById('detail-industry'),
  currency: document.getElementById('detail-currency'),
  company_location: document.getElementById('detail-company-location'),
  url: document.getElementById('detail-url'),
  ceo: document.getElementById('detail-ceo'),
  description: document.getElementById('detail-description'),
};

let currentStock = null;

function applyStaticTranslations() {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.title = t('detailTitle');
}

function renderStock(stock) {
  pageHeading.textContent = `${stock.stock_symbol} - ${stock.company_name}`;

  detailFields.symbol.textContent = stock.stock_symbol;
  detailFields.company_name.textContent = stock.company_name;
  detailFields.exchange.textContent = stock.exchange || '-';
  detailFields.category.textContent = stock.category || '-';
  detailFields.isdelisted.textContent = stock.isdelisted ? t('yes') : t('no');
  detailFields.cusips.textContent = stock.cusips || '-';
  detailFields.sector.textContent = stock.sector || '-';
  detailFields.industry.textContent = stock.industry || '-';
  detailFields.currency.textContent = stock.currency || '-';
  detailFields.company_location.textContent = stock.company_location || '-';
  detailFields.ceo.textContent = stock.ceo || '-';
  detailFields.description.textContent = stock.description || '-';

  detailFields.url.innerHTML = '';
  if (stock.urll) {
    const a = document.createElement('a');
    a.href = stock.urll;
    a.textContent = stock.urll;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    detailFields.url.appendChild(a);
  } else {
    detailFields.url.textContent = '-';
  }

  renderAutoFillNotice(stock.autofill);
}

// Why fields are still empty after an add, from by-symbol's `autofill` (only present for a
// stock added while this server has been running - see autoFillNewStock in routes/stocks.js).
// A copy of app.js's autoFillProblems, per this codebase's per-page duplication.
function autoFillProblems(report) {
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

function renderAutoFillNotice(report) {
  const notice = document.getElementById('autofill-notice');
  const problems = autoFillProblems(report);
  if (!problems.length) {
    notice.hidden = true;
    notice.replaceChildren();
    return;
  }
  const list = document.createElement('ul');
  for (const line of problems) {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  }
  const parts = [t('afTitle'), list];
  if (report.next_retry_at) {
    const time = new Date(report.next_retry_at).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
    parts.push(t('afRetryAt')(time));
  } else if (report.retries_exhausted) {
    parts.push(t('afRetriesExhausted'));
  }
  notice.replaceChildren(...parts);
  notice.hidden = false;
}

async function loadStock() {
  const symbol = decodeURIComponent(location.pathname.slice(1)).trim().toUpperCase();
  if (!symbol) {
    notFoundSection.hidden = false;
    return;
  }

  const res = await fetch(`/api/stocks/by-symbol/${encodeURIComponent(symbol)}`);
  if (!res.ok) {
    pageHeading.textContent = symbol;
    notFoundSection.hidden = false;
    detailSection.hidden = true;
    return;
  }

  currentStock = await res.json();
  notFoundSection.hidden = true;
  detailSection.hidden = false;
  renderStock(currentStock);
  scheduleAutoFillRefresh();
}

// A manual add looks up sector/CUSIP/etc. before answering (see POST /api/stocks), but a slow
// source can leave that running in the background, and anything not found is retried later.
// So: for a stock that's brand new and still missing details, re-fetch a few times; and when
// the server says when its next retry is, re-fetch just after it.
const AUTO_FILL_WINDOW_MS = 2 * 60 * 1000;
const AUTO_FILL_POLL_MS = 3000;
const AUTO_FILL_MAX_POLLS = 10;
const RETRY_GRACE_MS = 15 * 1000; // a retry's own lookup takes a few seconds
let autoFillPolls = 0;
let retryRefreshTimer = null;

function scheduleAutoFillRefresh() {
  const s = currentStock;
  const isFresh = Date.now() - new Date(s.created_at).getTime() < AUTO_FILL_WINDOW_MS;
  const stillMissing = !s.sector || !s.cusips;
  clearTimeout(retryRefreshTimer);
  const nextRetry = s.autofill && s.autofill.next_retry_at;
  if (nextRetry) {
    retryRefreshTimer = setTimeout(loadStock, Math.max(0, new Date(nextRetry).getTime() - Date.now()) + RETRY_GRACE_MS);
  } else if (isFresh && stillMissing && autoFillPolls < AUTO_FILL_MAX_POLLS) {
    autoFillPolls += 1;
    retryRefreshTimer = setTimeout(loadStock, AUTO_FILL_POLL_MS);
  }
}

langSwitch.addEventListener('change', () => {
  currentLang = langSwitch.value;
  localStorage.setItem('lang', currentLang);
  applyStaticTranslations();
  if (currentStock) renderStock(currentStock);
});

langSwitch.value = currentLang;
applyStaticTranslations();
loadStock();
