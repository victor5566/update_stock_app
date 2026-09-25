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
