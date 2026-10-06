// Main page (index.html): stock list, add / edit, the three lookup-before-edit forms and the
// stock monitor, as tabs. Uses the helpers and components from shared.js.
const MONITOR_POLL_MS = 3000;
const TABS = ['list', 'form', 'edit', 'monitor'];

function tabFromHash() {
  const tab = window.location.hash.slice(1);
  return TABS.includes(tab) ? tab : 'list';
}

// --- Stock list (paged on the server: the table has ~79k rows) ---
function StockListPanel({ stockPage, loading, search, marketFilter, markets, onSearch, onMarketFilter, onPage, onEdit }) {
  const t = useT();
  const { rows, total, page } = stockPage;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Exports exactly what the list shows: same filters (all pages), all columns.
  function exportCsv() {
    const params = new URLSearchParams();
    if (marketFilter) params.set('market', marketFilter);
    if (search.trim()) params.set('q', search.trim());
    window.location.href = `${API}/stocks/export.csv?${params.toString()}`;
  }

  return h(Card, { title: t('tabList') },
    h('div', { className: 'mb-4 grid gap-3 sm:grid-cols-[1fr_14rem_auto]' },
      h(Input, { type: 'search', id: 'search-input', placeholder: t('searchPlaceholder'), value: search, onChange: (e) => onSearch(e.target.value) }),
      // A <select>, not a datalist input: once a datalist input held "OTC" the browser only
      // suggested values matching "OTC", with no way back to the other markets.
      h(Select, { id: 'market-filter', value: marketFilter, onChange: (e) => onMarketFilter(e.target.value) },
        h('option', { value: '' }, t('allMarkets')),
        ...markets.map((m) => h('option', { key: m, value: m }, m))),
      h(Button, { id: 'export-csv-btn', onClick: exportCsv }, t('exportCsvBtn'))),
    h(Table, { id: 'stock-table', head: [t('labelSymbol'), t('labelCompany'), t('labelMarket'), t('labelDelisted'), t('labelUpdated'), t('labelActions')] },
      rows.map((stock) => h('tr', { key: stock.id, className: 'hover:bg-slate-50 dark:hover:bg-slate-800/40' },
        h('td', { className: TD }, h(StockLink, { symbol: stock.stock_symbol, id: stock.id })),
        h('td', { className: cx(TD, 'text-slate-900 dark:text-slate-100') }, stock.company_name),
        h('td', { className: TD }, stock.exchange),
        h('td', { className: TD }, stock.isdelisted ? h(Badge, { tone: 'red' }, t('delisted')) : h(Badge, { tone: 'green' }, t('listed'))),
        h('td', { className: cx(TD, 'whitespace-nowrap text-xs') }, stock.updated_at ? new Date(stock.updated_at).toLocaleString(t('locale')) : ''),
        h('td', { className: TD }, h(Button, { size: 'sm', variant: 'subtle', className: 'btn-edit', onClick: () => onEdit(stock) }, t('editBtn')))))),
    rows.length === 0 && h('p', { id: 'empty-state', className: 'py-8 text-center text-sm text-slate-500' }, loading ? t('loading') : t('emptyState')),
    h(Pagination, { page, totalPages, total, onPage }));
}

// --- Add / edit form ---
// editingStock: the row whose Edit button was clicked (null = add mode).
function StockFormPanel({ editingStock, onExitEdit, onSaved }) {
  const t = useT();
  const [symbol, setSymbol] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [market, setMarket] = useState('');
  const [error, setError] = useState(null); // { text, linkSymbol? }
  const [hint, setHint] = useState(null); // { message, stock?, lines?, tone }
  const [submitting, setSubmitting] = useState(false);
  const symbolInputRef = useRef(null);
  // What the last lookup put into the name/market inputs, so a later lookup (symbol changed)
  // may overwrite them - but never overwrite something the user typed themselves.
  const autoFilled = useRef({ company_name: '', exchange: '' });
  // Latest values for async callbacks (a lookup may finish after the user typed on).
  const latest = useRef({});
  latest.current = { symbol, companyName, market, editingStock };

  useEffect(() => {
    if (!editingStock) return;
    setSymbol(editingStock.stock_symbol);
    setCompanyName(editingStock.company_name);
    setMarket(editingStock.exchange || '');
    setError(null);
    setHint(null);
    symbolInputRef.current.focus();
  }, [editingStock]);

  function resetForm() {
    setSymbol('');
    setCompanyName('');
    setMarket('');
    setError(null);
    setHint(null);
    autoFilled.current = { company_name: '', exchange: '' };
    onExitEdit();
  }

  // Add mode only: once a symbol is committed, warn right away if it's a duplicate, otherwise
  // pre-fill company name / market (NASDAQ Trader's listing, then Yahoo).
  async function lookupSymbolForAdd() {
    if (latest.current.editingStock) return;
    const sym = latest.current.symbol.trim().toUpperCase();
    setError(null);
    setHint(null);
    if (!sym) return;

    setHint({ message: t('yahooLookupRunning')(sym), tone: 'info' });
    let data = null;
    let existingSymbol = null;
    try {
      const res = await fetch(`${API}/stocks/yahoo-lookup/${encodeURIComponent(sym)}`);
      if (res.ok) data = await res.json();
      // 409: already held (possibly as another spelling: "BRK-B" typed, "BRK.B" held)
      else if (res.status === 409) existingSymbol = (await res.json()).existing_symbol || sym;
    } catch {
      // treated the same as not found
    }
    const now = latest.current;
    if (now.editingStock || now.symbol.trim().toUpperCase() !== sym) return;

    if (existingSymbol) {
      setHint(null);
      setError({ text: t('duplicateSymbol')(existingSymbol), linkSymbol: existingSymbol });
      return;
    }
    if (!data) {
      setHint({ message: t('yahooLookupNotFound')(sym), tone: 'warn' });
      return;
    }
    if (!now.companyName.trim() || now.companyName === autoFilled.current.company_name) {
      autoFilled.current.company_name = data.company_name || '';
      setCompanyName(autoFilled.current.company_name);
    }
    if (!now.market.trim() || now.market === autoFilled.current.exchange) {
      autoFilled.current.exchange = data.exchange || '';
      setMarket(autoFilled.current.exchange);
    }
    setHint({ message: t('yahooLookupFilled')(sym, data.source), tone: 'info' });
  }

  // The DOM 'change' event fires once the symbol is committed (blur), not per keystroke like
  // React's onChange - so listen to it directly.
  useEffect(() => {
    const input = symbolInputRef.current;
    input.addEventListener('change', lookupSymbolForAdd);
    return () => input.removeEventListener('change', lookupSymbolForAdd);
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setHint(null);
    const payload = { stock_symbol: symbol.trim(), company_name: companyName.trim(), exchange: market.trim() };
    const isEdit = Boolean(editingStock);
    const upperSymbol = payload.stock_symbol.toUpperCase();
    // The server uppercases a submitted symbol, so only send it when it actually changed -
    // otherwise saving any edit of a mixed-case row ("ACIC_old") would rename it.
    if (isEdit && upperSymbol === editingStock.stock_symbol.toUpperCase()) delete payload.stock_symbol;

    // An add waits for the company-info / CUSIP lookup (a few seconds).
    if (!isEdit) setHint({ message: t('addingStock')(upperSymbol), tone: 'info' });
    setSubmitting(true);
    let res;
    try {
      res = await fetch(isEdit ? `${API}/stocks/${editingStock.id}` : `${API}/stocks`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setHint(null);
      setError({ text: t('operationFailed') });
      return;
    } finally {
      setSubmitting(false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setHint(null);
      // existing_symbol: the spelling actually held ("BRK.B" when "BRK-B" was typed)
      if (res.status === 409) setError({ text: t('duplicateSymbol')(data.existing_symbol || upperSymbol), linkSymbol: data.existing_symbol || upperSymbol });
      else setError({ text: data.errors?.join(', ') || t('operationFailed') });
      return;
    }

    resetForm();
    const sym = data.stock_symbol;
    if (isEdit) setHint({ message: t('updatedOk')(sym), stock: data, tone: 'success' });
    else if (!data.autofill) setHint({ message: t('addedStock')(sym), stock: data, tone: 'success' });
    else if (data.autofill.pending) setHint({ message: t('addedPending')(sym), stock: data, tone: 'warn' });
    else {
      const problems = autoFillProblems(data.autofill, t);
      const note = problems.length ? retryNote(data.autofill, t) : null;
      setHint(problems.length
        ? { message: t('addedSomeMissing')(sym), stock: data, lines: note ? [...problems, note] : problems, tone: 'warn' }
        : { message: t('addedAllFound')(sym), stock: data, tone: 'success' });
    }
    onSaved({ isEdit });
  }

  return h(Card, { title: editingStock ? t('editTitle')(editingStock.stock_symbol) : t('addTitle') },
    !editingStock && h('p', { className: 'mb-4 text-sm text-slate-500 dark:text-slate-400' }, t('addHelp')),
    h('form', { id: 'stock-form', onSubmit: handleSubmit, className: 'grid gap-4 sm:grid-cols-3' },
      h(Field, { htmlFor: 'stock-symbol', label: t('labelSymbol') },
        h(Input, { id: 'stock-symbol', className: 'uppercase', placeholder: 'AAPL', required: true, ref: symbolInputRef, value: symbol, onChange: (e) => setSymbol(e.target.value) })),
      h(Field, { htmlFor: 'company-name', label: t('labelCompany') },
        h(Input, { id: 'company-name', placeholder: 'Apple Inc.', required: true, value: companyName, onChange: (e) => setCompanyName(e.target.value) })),
      h(Field, { htmlFor: 'trading-market', label: t('labelMarket') },
        h(Input, { id: 'trading-market', list: 'exchange-datalist', placeholder: 'NASDAQ', autoComplete: 'off', required: true, value: market, onChange: (e) => setMarket(e.target.value) })),
      h('div', { className: 'flex gap-2 sm:col-span-3' },
        h(Button, { type: 'submit', id: 'submit-btn', variant: 'primary', disabled: submitting }, editingStock ? t('saveBtn') : t('addBtn')),
        editingStock && h(Button, { id: 'cancel-btn', onClick: resetForm }, t('cancel'))),
      error && h(Alert, { id: 'form-error', tone: 'error', className: 'sm:col-span-3' },
        error.text, error.linkSymbol && h(StockLink, { symbol: error.linkSymbol })),
      hint && h(Alert, { id: 'form-hint', tone: hint.tone, live: 'polite', className: 'sm:col-span-3' },
        hint.message,
        hint.stock && h(StockLink, { symbol: hint.stock.stock_symbol, id: hint.stock.id }),
        hint.lines && h('ul', { className: 'mt-1 list-disc pl-5' }, hint.lines.map((line, i) => h('li', { key: i }, line))))));
}

// --- The three lookup-before-edit forms: Lookup (GET by-symbol) enables the rest, submit PUTs
// one field. Each form's differences are in LOOKUP_FORMS.
const LOOKUP_FORMS = {
  rename: {
    titleKey: 'renameSectionTitle',
    symbolLabelKey: 'labelSymbol',
    info: [{ id: 'rename-current-name', labelKey: 'renameCurrentName', get: (s) => s.company_name }],
    newField: { id: 'rename-new-name', labelKey: 'renameNewNameLabel' },
    submitKey: 'renameSubmitBtn',
    normalize: (v) => v.trim(),
    isSame: (v, s) => v === s.company_name,
    sameKey: 'renameSameName',
    payload: (v) => ({ company_name: v }),
  },
  symbol: {
    titleKey: 'symbolSectionTitle',
    symbolLabelKey: 'symbolCurrentLabel',
    info: [{ id: 'symbol-company-name', labelKey: 'labelCompany', get: (s) => s.company_name }],
    newField: { id: 'symbol-new', labelKey: 'symbolNewLabel', className: 'uppercase' },
    submitKey: 'symbolSubmitBtn',
    normalize: (v) => v.trim().toUpperCase(),
    isSame: (v, s) => v === s.stock_symbol,
    sameKey: 'symbolSameSymbol',
    payload: (v) => ({ stock_symbol: v }),
  },
  market: {
    titleKey: 'marketSectionTitle',
    symbolLabelKey: 'labelSymbol',
    info: [
      { id: 'market-company-name', labelKey: 'labelCompany', get: (s) => s.company_name },
      { id: 'market-current', labelKey: 'marketCurrentLabel', get: (s) => s.exchange || '' },
    ],
    newField: { id: 'market-new', labelKey: 'marketNewLabel', list: 'exchange-datalist', placeholder: 'NYSE' },
    submitKey: 'marketSubmitBtn',
    normalize: (v) => v.trim(),
    isSame: (v, s) => v === (s.exchange || ''),
    sameKey: 'marketSameMarket',
    payload: (v) => ({ exchange: v }),
  },
};

function LookupEditForm({ name, onSuggest, onUpdated }) {
  const t = useT();
  const config = LOOKUP_FORMS[name];
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(null); // the stock found by Lookup
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // the stock just updated
  const newInputRef = useRef(null);

  useEffect(() => {
    if (target) newInputRef.current.focus();
  }, [target]);

  function reset() {
    setQuery('');
    setTarget(null);
    setNewValue('');
    setError('');
  }

  async function lookup() {
    setError('');
    setDone(null);
    const symbol = query.trim();
    if (!symbol) return;
    let res;
    try {
      res = await fetch(`${API}/stocks/by-symbol/${encodeURIComponent(symbol)}`);
    } catch {
      setError(t('operationFailed'));
      return;
    }
    if (!res.ok) {
      setTarget(null);
      setNewValue('');
      setError(res.status === 404 ? t('stockNotFound') : t('operationFailed'));
      return;
    }
    setTarget(await res.json());
    setNewValue('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!target) {
      setError(t('stockNotFound'));
      return;
    }
    const value = config.normalize(newValue);
    if (!value) return;
    if (config.isSame(value, target)) {
      setError(t(config.sameKey));
      return;
    }
    let res;
    try {
      res = await fetch(`${API}/stocks/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.payload(value)),
      });
    } catch {
      setError(t('operationFailed'));
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.errors?.join(', ') || t('operationFailed'));
      return;
    }
    reset();
    setDone(data);
    onUpdated();
  }

  const columns = config.info.length === 2 ? 'sm:grid-cols-4' : 'sm:grid-cols-3';
  return h(Card, { title: t(config.titleKey) },
    h('form', { id: `${name}-form`, onSubmit: handleSubmit, className: cx('grid gap-4', columns) },
      h(Field, { htmlFor: `${name}-symbol`, label: t(config.symbolLabelKey) },
        h(Input, {
          id: `${name}-symbol`, className: 'uppercase', list: 'stock-datalist', placeholder: 'AAPL', autoComplete: 'off', required: true,
          value: query,
          onChange: (e) => { setQuery(e.target.value); onSuggest(e.target.value); },
          onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } },
        })),
      ...config.info.map((f) => h(Field, { key: f.id, htmlFor: f.id, label: t(f.labelKey) },
        h(Input, { id: f.id, disabled: true, value: target ? f.get(target) : '' }))),
      h(Field, { htmlFor: config.newField.id, label: t(config.newField.labelKey) },
        h(Input, {
          id: config.newField.id, className: config.newField.className, list: config.newField.list, placeholder: config.newField.placeholder,
          autoComplete: config.newField.list ? 'off' : undefined, required: true, disabled: !target, ref: newInputRef,
          value: newValue, onChange: (e) => setNewValue(e.target.value),
        })),
      h('div', { className: cx('flex flex-wrap gap-2', config.info.length === 2 ? 'sm:col-span-4' : 'sm:col-span-3') },
        h(Button, { id: `${name}-lookup-btn`, onClick: lookup }, t('lookupBtn')),
        h(Button, { type: 'submit', id: `${name}-submit-btn`, variant: 'primary', disabled: !target }, t(config.submitKey)),
        h(Button, { id: `${name}-clear-btn`, onClick: () => { reset(); setDone(null); } }, t('clearBtn'))),
      error && h(Alert, { id: `${name}-error`, tone: 'error', className: config.info.length === 2 ? 'sm:col-span-4' : 'sm:col-span-3' }, error),
      done && h(Alert, { id: `${name}-done`, tone: 'success', className: config.info.length === 2 ? 'sm:col-span-4' : 'sm:col-span-3' },
        t('updatedOk')(done.stock_symbol), h(StockLink, { symbol: done.stock_symbol, id: done.id }))));
}

// --- Stock monitor (routes/monitor.js): runs in the background on the server; poll its status ---
function describeMonitorValue(field, value, t) {
  if (field === 'isdelisted') return value ? t('yes') : t('no');
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

const MONITOR_BADGE = { listed: 'green', delisted: 'red', unknown: 'gray' };

function MonitorPanel({ onApplied }) {
  const t = useT();
  const [state, setState] = useState(null); // GET /api/monitor/status
  const [message, setMessage] = useState(''); // starting / stopping / failed, until the next poll
  const [starting, setStarting] = useState(false);
  const [stopClicked, setStopClicked] = useState(false);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const reportShown = useRef(null); // finishedAt of the report whose items are loaded
  const timer = useRef(null);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  const poll = useCallback(async () => {
    clearTimeout(timer.current);
    let s;
    try {
      const res = await fetch(`${API}/monitor/status`);
      if (!res.ok) return;
      s = await res.json();
    } catch {
      return;
    }
    setState(s);
    setMessage('');
    setStarting(false);
    if (s.running) {
      timer.current = setTimeout(poll, MONITOR_POLL_MS);
      return;
    }
    setStopClicked(false);
    const report = s.lastReport;
    if (report && report.finishedAt !== reportShown.current) {
      reportShown.current = report.finishedAt;
      const itemsRes = await fetch(`${API}/monitor/report`).catch(() => null);
      const list = itemsRes && itemsRes.ok ? await itemsRes.json() : [];
      // Changed rows first, then rows that only carry a note.
      list.sort((a, b) => (b.changes.length > 0) - (a.changes.length > 0));
      setItems(list);
      setPage(1);
      if (report.apply) onAppliedRef.current();
    }
  }, []);

  // Also picks up a run still going from before a page reload.
  useEffect(() => {
    poll();
    return () => clearTimeout(timer.current);
  }, [poll]);

  async function start(apply) {
    if (apply && !window.confirm(t('monitorConfirmApply'))) return;
    setStarting(true);
    setMessage(t('monitorStarting'));
    try {
      const res = await fetch(`${API}/monitor/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply }),
      });
      if (res.status === 409) setMessage(t('monitorAlreadyRunning'));
    } catch (err) {
      setMessage(t('monitorFailed')(err.message));
    }
    poll();
  }

  async function stop() {
    setStopClicked(true);
    setMessage(t('monitorStopping'));
    try {
      await fetch(`${API}/monitor/stop`, { method: 'POST' });
    } catch {
      // the next poll shows the real state
    }
  }

  const running = Boolean(state && state.running);
  let statusLines = [];
  if (message) statusLines = [message];
  else if (state) {
    if (running) {
      const p = state.progress || {};
      statusLines.push(state.stopRequested ? t('monitorStopping') : t('monitorRunning')(state.apply, p.phase || 'loading', p.done || 0, p.total || 0));
    } else if (state.lastError) {
      statusLines.push(t('monitorFailed')(state.lastError));
    }
    if (!running && state.lastReport) {
      statusLines.push((state.lastReport.stopped ? t('monitorStoppedNote')(state.lastReport) : '') + t('monitorSummary')(state.lastReport, t('monitorFields')));
    }
    if (state.nextScheduledAt) statusLines.push(t('monitorNext')(state.nextScheduledAt));
  }
  const progress = running && state.progress && state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : null;

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const shownPage = Math.min(Math.max(1, page), totalPages);
  const first = (shownPage - 1) * PAGE_SIZE;

  return h(Card, {
    title: t('monitorTitle'),
    actions: [
      h(Button, { key: 'preview', id: 'monitor-preview-btn', disabled: running || starting, onClick: () => start(false) }, t('monitorPreviewBtn')),
      h(Button, { key: 'apply', id: 'monitor-apply-btn', variant: 'primary', disabled: running || starting, onClick: () => start(true) }, t('monitorApplyBtn')),
      running && h(Button, { key: 'stop', id: 'monitor-stop-btn', variant: 'danger', disabled: stopClicked || Boolean(state.stopRequested), onClick: stop }, t('monitorStopBtn')),
    ],
  },
    h('p', { className: 'mb-3 text-sm text-slate-500 dark:text-slate-400' }, t('monitorHelp')),
    statusLines.length > 0 && h(Alert, { id: 'monitor-status', tone: state && state.lastError && !running ? 'error' : 'info', live: 'polite', className: 'mb-4' }, ...withBreaks(statusLines)),
    progress !== null && h('div', { className: 'mb-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800' },
      h('div', { className: 'h-full rounded-full bg-blue-600 transition-all', style: { width: `${progress}%` } })),
    h(Table, { id: 'monitor-table', head: [t('labelSymbol'), t('labelCompany'), t('monitorThStatus'), t('monitorThChanges')] },
      items.slice(first, first + PAGE_SIZE).map((item) => {
        const lines = [
          ...item.changes.map((c) => `${t('monitorFields')[c.field] || c.field}: ${describeMonitorValue(c.field, c.from, t)} → ${describeMonitorValue(c.field, c.to, t)}`),
          ...item.notes,
          ...(item.error ? [item.error] : []),
        ];
        return h('tr', { key: item.id },
          h('td', { className: TD }, h(StockLink, { symbol: item.stock_symbol, id: item.id })),
          h('td', { className: TD }, item.company_name),
          h('td', { className: TD }, h(Badge, { tone: MONITOR_BADGE[item.status] || 'gray', title: item.reason }, t('monitorStatus')[item.status] || item.status)),
          h('td', { className: cx(TD, item.changes.length ? '' : 'text-slate-500 dark:text-slate-400') }, ...withBreaks(lines)));
      })),
    items.length === 0 && h('p', { id: 'monitor-empty-state', className: 'py-8 text-center text-sm text-slate-500' }, t('monitorEmpty')),
    h(Pagination, { page: shownPage, totalPages, total: items.length, onPage: setPage, idPrefix: 'monitor-' }));
}

// --- The page ---
function App() {
  const [lang, setLang] = useLang('pageTitle');
  const t = (key) => TRANSLATIONS[lang][key];
  const [tab, setTab] = useState(tabFromHash);
  const [markets, setMarkets] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState('');
  // The list page shown: { rows, total, page, pageSize } from GET /api/stocks.
  const [stockPage, setStockPage] = useState({ rows: [], total: 0, page: 1, pageSize: PAGE_SIZE });
  const [loading, setLoading] = useState(true);
  const [editingStock, setEditingStock] = useState(null);

  // Latest filters/page for fetches started from timers and callbacks.
  const listState = useRef({});
  listState.current = { search, marketFilter, page: stockPage.page };
  const requestSeq = useRef(0);
  const searchTimer = useRef(null);
  const suggestTimer = useRef(null);
  const suggestQuery = useRef('');

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function showTab(next) {
    setTab(next);
    if (window.location.hash !== `#${next}`) window.history.replaceState(null, '', `#${next}`);
  }

  // keepPage: stay on the current page (after an edit) instead of going back to page 1.
  // overrides: filter values just chosen, before React has re-rendered with them.
  const fetchStocks = useCallback(async ({ keepPage = false, page, ...overrides } = {}) => {
    const f = { ...listState.current, ...overrides };
    const params = new URLSearchParams();
    if (f.marketFilter) params.set('market', f.marketFilter);
    if (f.search.trim()) params.set('q', f.search.trim());
    params.set('page', page || (keepPage ? f.page : 1));
    params.set('pageSize', PAGE_SIZE);
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`${API}/stocks?${params.toString()}`);
      const data = await res.json();
      // Ignore an answer that a newer request has overtaken.
      if (seq === requestSeq.current && res.ok) setStockPage(data);
    } catch {
      // keep showing the last page
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  const fetchMarkets = useCallback(async () => {
    try {
      const res = await fetch(`${API}/stocks/markets`);
      if (!res.ok) return;
      const list = await res.json();
      setMarkets(list);
      setMarketFilter((selected) => (list.includes(selected) ? selected : ''));
    } catch {
      // keep the old options
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
    fetchStocks();
  }, [fetchMarkets, fetchStocks]);

  function handleSearch(value) {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchStocks({ search: value }), 300);
  }

  // Symbol autocomplete for the lookup forms: the table is too big to preload into a datalist.
  function suggestSymbols(value) {
    clearTimeout(suggestTimer.current);
    const q = value.trim();
    suggestQuery.current = q;
    if (!q) return;
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/stocks/suggest?q=${encodeURIComponent(q)}`);
        if (!res.ok || suggestQuery.current !== q) return;
        setSuggestions(await res.json());
      } catch {
        // no suggestions this time
      }
    }, 250);
  }

  const refreshList = () => fetchStocks({ keepPage: true });
  const tabButton = (id, label) => h('button', {
    key: id,
    type: 'button',
    id: `tab-${id}`,
    role: 'tab',
    'aria-selected': tab === id,
    onClick: () => showTab(id),
    className: cx(
      'whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition',
      tab === id
        ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
    ),
  }, label);
  // Panels stay mounted (just hidden) so a half-filled form or a running monitor poll survives
  // switching tabs.
  const panel = (id, child) => h('div', { key: id, id: `panel-${id}`, role: 'tabpanel', hidden: tab !== id, className: 'grid gap-6' }, child);

  return h(LangContext.Provider, { value: lang },
    h(PageHeader, { title: t('pageTitle'), subtitle: t('subtitle'), lang, setLang }),
    h('datalist', { id: 'stock-datalist' },
      suggestions.map((s) => h('option', { key: s.id ?? s.stock_symbol, value: s.stock_symbol, label: s.company_name }))),
    h('datalist', { id: 'exchange-datalist' }, markets.map((m) => h('option', { key: m, value: m }))),
    h('main', { className: 'mx-auto max-w-6xl px-4 py-6 sm:px-6' },
      h('nav', { role: 'tablist', className: 'mb-6 flex gap-6 overflow-x-auto border-b border-slate-200 dark:border-slate-800' },
        tabButton('list', t('tabList')),
        tabButton('form', editingStock ? t('editTitle')(editingStock.stock_symbol) : t('tabForm')),
        tabButton('edit', t('tabEdit')),
        tabButton('monitor', t('tabMonitor'))),
      panel('list', h(StockListPanel, {
        stockPage, loading, search, marketFilter, markets,
        onSearch: handleSearch,
        onMarketFilter: (value) => { setMarketFilter(value); fetchStocks({ marketFilter: value }); },
        onPage: (page) => fetchStocks({ page }),
        onEdit: (stock) => { setEditingStock(stock); showTab('form'); },
      })),
      panel('form', h(StockFormPanel, {
        editingStock,
        onExitEdit: () => setEditingStock(null),
        onSaved: ({ isEdit }) => { fetchStocks({ keepPage: isEdit }); fetchMarkets(); },
      })),
      panel('edit', [
        h('p', { key: 'help', className: 'text-sm text-slate-500 dark:text-slate-400' }, t('editSectionHelp')),
        h(LookupEditForm, { key: 'rename', name: 'rename', onSuggest: suggestSymbols, onUpdated: refreshList }),
        h(LookupEditForm, { key: 'symbol', name: 'symbol', onSuggest: suggestSymbols, onUpdated: refreshList }),
        h(LookupEditForm, { key: 'market', name: 'market', onSuggest: suggestSymbols, onUpdated: () => { refreshList(); fetchMarkets(); } }),
      ]),
      panel('monitor', h(MonitorPanel, { onApplied: () => { refreshList(); fetchMarkets(); } }))));
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
