// Per-stock detail page (stock.html, served by server.js for /<symbol>). Uses shared.js.

// A manual add looks up sector/CUSIP/etc. before answering, but a slow source can leave that
// running in the background, and anything not found is retried later. So: for a stock that's
// brand new and still missing details, re-fetch a few times; and when the server says when its
// next retry is, re-fetch just after it.
const AUTO_FILL_WINDOW_MS = 2 * 60 * 1000;
const AUTO_FILL_POLL_MS = 3000;
const AUTO_FILL_MAX_POLLS = 10;
const RETRY_GRACE_MS = 15 * 1000; // a retry's own lookup takes a few seconds

function AutoFillNotice({ report }) {
  const t = useT();
  const problems = autoFillProblems(report, t);
  if (!problems.length) return null;
  const note = retryNote(report, t, 'afRetryAtDetail');
  return h(Alert, { id: 'autofill-notice', tone: 'warn', className: 'mb-6' },
    h('div', { className: 'font-medium' }, t('afTitle')),
    h('ul', { className: 'mt-1 list-disc pl-5' }, problems.map((line, i) => h('li', { key: i }, line))),
    note && h('div', { className: 'mt-1' }, note));
}

function DetailRow({ label, id, children, wide }) {
  return h('div', { className: cx('py-3 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-4', wide && 'sm:col-span-2') },
    h('dt', { className: 'text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400' }, label),
    h('dd', { id, className: 'mt-1 break-words text-sm text-slate-900 sm:mt-0 dark:text-slate-100' }, children));
}

function StockPage() {
  const [lang, setLang] = useLang('detailTitle');
  const t = (key) => TRANSLATIONS[lang][key];
  const [stock, setStock] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const autoFillPolls = useRef(0);
  const refreshTimer = useRef(null);

  // /<symbol> shows that symbol's preferred row; links from the list add ?id=, since a symbol
  // can have several rows (a recycled ticker keeps its delisted row).
  const symbol = decodeURIComponent(window.location.pathname.slice(1)).trim();
  const id = new URLSearchParams(window.location.search).get('id');

  const loadStock = useCallback(async () => {
    if (!symbol && !id) {
      setNotFound(true);
      return;
    }
    let res;
    try {
      res = await fetch(/^\d+$/.test(id || '') ? `${API}/stocks/${id}` : `${API}/stocks/by-symbol/${encodeURIComponent(symbol)}`);
    } catch {
      return; // network trouble - keep what's shown
    }
    if (!res.ok) {
      setStock(null);
      setNotFound(true);
      return;
    }
    const s = await res.json();
    setNotFound(false);
    setStock(s);

    clearTimeout(refreshTimer.current);
    const isFresh = Date.now() - new Date(s.created_at).getTime() < AUTO_FILL_WINDOW_MS;
    const stillMissing = !s.sector || !s.cusips;
    const nextRetry = s.autofill && s.autofill.next_retry_at;
    if (nextRetry) {
      refreshTimer.current = setTimeout(loadStock, Math.max(0, new Date(nextRetry).getTime() - Date.now()) + RETRY_GRACE_MS);
    } else if (isFresh && stillMissing && autoFillPolls.current < AUTO_FILL_MAX_POLLS) {
      autoFillPolls.current += 1;
      refreshTimer.current = setTimeout(loadStock, AUTO_FILL_POLL_MS);
    }
  }, [symbol, id]);

  useEffect(() => {
    loadStock();
    return () => clearTimeout(refreshTimer.current);
  }, [loadStock]);

  let title = '…';
  if (stock) title = `${stock.stock_symbol} - ${stock.company_name}`;
  else if (notFound) title = symbol || t('stockNotFound');
  const dash = (v) => v || '-';

  return h(LangContext.Provider, { value: lang },
    h(PageHeader, { title, subtitle: h('a', { href: '/', className: 'text-blue-600 hover:underline dark:text-blue-400' }, t('backToList')), lang, setLang }),
    h('main', { className: 'mx-auto max-w-4xl px-4 py-6 sm:px-6' },
      notFound && h(Card, { id: 'not-found-section' }, h('p', { className: 'text-sm text-slate-600 dark:text-slate-300' }, t('stockNotFound'))),
      !stock && !notFound && h('p', { className: 'text-sm text-slate-500' }, t('loading')),
      stock && h(Card, {
        id: 'detail-section',
        title: h('span', { className: 'flex flex-wrap items-center gap-2' },
          h('span', { className: 'font-mono' }, stock.stock_symbol),
          stock.isdelisted ? h(Badge, { tone: 'red' }, t('delisted')) : h(Badge, { tone: 'green' }, t('listed')),
          stock.exchange && h(Badge, { tone: 'blue' }, stock.exchange)),
      },
        h(AutoFillNotice, { report: stock.autofill }),
        h('dl', { className: 'grid divide-y divide-slate-100 sm:grid-cols-2 sm:gap-x-8 dark:divide-slate-800' },
          h(DetailRow, { label: t('labelSymbol'), id: 'detail-symbol' }, stock.stock_symbol),
          h(DetailRow, { label: t('labelCompany'), id: 'detail-company-name' }, stock.company_name),
          h(DetailRow, { label: t('labelMarket'), id: 'detail-exchange' }, dash(stock.exchange)),
          h(DetailRow, { label: t('labelCategory'), id: 'detail-category' }, dash(stock.category)),
          h(DetailRow, { label: t('labelDelisted'), id: 'detail-isdelisted' }, stock.isdelisted ? t('yes') : t('no')),
          h(DetailRow, { label: t('labelCusips'), id: 'detail-cusips' }, h('span', { className: 'font-mono' }, dash(stock.cusips))),
          h(DetailRow, { label: t('labelSector'), id: 'detail-sector' }, dash(stock.sector)),
          h(DetailRow, { label: t('labelIndustry'), id: 'detail-industry' }, dash(stock.industry)),
          h(DetailRow, { label: t('labelCurrency'), id: 'detail-currency' }, dash(stock.currency)),
          h(DetailRow, { label: t('labelCeo'), id: 'detail-ceo' }, dash(stock.ceo)),
          h(DetailRow, { label: t('labelLocation'), id: 'detail-company-location', wide: true }, dash(stock.company_location)),
          h(DetailRow, { label: t('labelUrl'), id: 'detail-url', wide: true }, stock.urll
            ? h('a', { href: stock.urll, target: '_blank', rel: 'noopener noreferrer', className: 'text-blue-600 hover:underline dark:text-blue-400' }, stock.urll)
            : '-'),
          h(DetailRow, { label: t('labelDescription'), id: 'detail-description', wide: true },
            h('p', { className: 'whitespace-pre-wrap leading-relaxed' }, dash(stock.description)))))));
}

ReactDOM.createRoot(document.getElementById('root')).render(h(StockPage));
