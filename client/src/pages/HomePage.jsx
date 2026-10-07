// Main page: tabs for the stock list, add / edit, the lookup-before-edit forms and the stock
// monitor. The tab is kept in the URL hash (#list, #form, #edit, #monitor).
import { useCallback, useEffect, useRef, useState } from 'react';
import { LangContext, useLang } from '../i18n';
import { TRANSLATIONS } from '../translations';
import { API, PAGE_SIZE, cx } from '../lib/stocks';
import { PageHeader } from '../components/ui';
import StockListPanel from '../components/StockListPanel';
import StockFormPanel from '../components/StockFormPanel';
import LookupEditForm from '../components/LookupEditForm';
import MonitorPanel from '../components/MonitorPanel';

const TABS = ['list', 'form', 'edit', 'monitor'];

function tabFromHash() {
  const tab = window.location.hash.slice(1);
  return TABS.includes(tab) ? tab : 'list';
}

export default function HomePage() {
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
    if (window.location.hash !== `#${next}`) window.history.replaceState(window.history.state, '', `#${next}`);
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

  const tabButton = (id, label) => (
    <button
      key={id}
      type="button"
      id={`tab-${id}`}
      role="tab"
      aria-selected={tab === id}
      onClick={() => showTab(id)}
      className={cx(
        'whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition',
        tab === id
          ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
          : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-200',
      )}
    >
      {label}
    </button>
  );

  // Panels stay mounted (just hidden) so a half-filled form or a running monitor poll survives
  // switching tabs.
  const panel = (id, children) => (
    <div id={`panel-${id}`} role="tabpanel" hidden={tab !== id}
      // `grid` would override the hidden attribute's display:none, so a hidden panel gets `hidden` instead.
      className={tab === id ? 'grid gap-6' : 'hidden'}>{children}</div>
  );

  return (
    <LangContext.Provider value={lang}>
      <PageHeader title={t('pageTitle')} subtitle={t('subtitle')} lang={lang} setLang={setLang} />
      <datalist id="stock-datalist">
        {suggestions.map((s) => <option key={s.id ?? s.stock_symbol} value={s.stock_symbol} label={s.company_name} />)}
      </datalist>
      <datalist id="exchange-datalist">
        {markets.map((m) => <option key={m} value={m} />)}
      </datalist>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <nav role="tablist" className="mb-6 flex gap-6 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
          {tabButton('list', t('tabList'))}
          {tabButton('form', editingStock ? t('editTitle')(editingStock.stock_symbol) : t('tabForm'))}
          {tabButton('edit', t('tabEdit'))}
          {tabButton('monitor', t('tabMonitor'))}
        </nav>
        {panel('list', (
          <StockListPanel
            stockPage={stockPage}
            loading={loading}
            search={search}
            marketFilter={marketFilter}
            markets={markets}
            onSearch={handleSearch}
            onMarketFilter={(value) => { setMarketFilter(value); fetchStocks({ marketFilter: value }); }}
            onPage={(page) => fetchStocks({ page })}
            onEdit={(stock) => { setEditingStock(stock); showTab('form'); }}
          />
        ))}
        {panel('form', (
          <StockFormPanel
            editingStock={editingStock}
            onExitEdit={() => setEditingStock(null)}
            onSaved={({ isEdit }) => { fetchStocks({ keepPage: isEdit }); fetchMarkets(); }}
          />
        ))}
        {panel('edit', (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">{t('editSectionHelp')}</p>
            <LookupEditForm name="rename" onSuggest={suggestSymbols} onUpdated={refreshList} />
            <LookupEditForm name="symbol" onSuggest={suggestSymbols} onUpdated={refreshList} />
            <LookupEditForm name="market" onSuggest={suggestSymbols} onUpdated={() => { refreshList(); fetchMarkets(); }} />
          </>
        ))}
        {panel('monitor', <MonitorPanel onApplied={() => { refreshList(); fetchMarkets(); }} />)}
      </main>
    </LangContext.Provider>
  );
}
