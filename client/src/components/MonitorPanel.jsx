// Stock monitor tab (server: routes/monitor.js) - preview only: since 2026-10-16 (the user) the
// writing "Check & Update" run, its results page and the daily schedule are gone. A preview runs
// in the background on the server; this polls its status and shows the last one, filterable by
// category, with its CSV export.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { API, PAGE_SIZE } from '../lib/stocks';
import { MONITOR_CATEGORIES, MONITOR_GROUPS, describeNote, noteKind } from '../lib/monitorCategories';
import { Alert, Badge, Button, Card, Chip, Lines, Pagination, StockLink, Table, TD } from './ui';

const MONITOR_POLL_MS = 3000;
const STATUS_BADGE = { listed: 'green', delisted: 'red', unknown: 'gray' };
// Company detail columns (in old reports' item.changes) -> the form's field labels.
const DETAIL_LABEL = {
  sector: 'labelSector', industry: 'labelIndustry', currency: 'labelCurrency', company_location: 'labelLocation',
  companysite: 'labelUrl', description: 'labelDescription', ceo: 'labelCeo',
};

function describeValue(field, value, t) {
  if (field === 'isdelisted') return value ? t('yes') : t('no');
  // A description is a paragraph; the start is enough to see that it was rewritten.
  if (field === 'description' && value && String(value).length > 60) return `${String(value).slice(0, 60)}…`;
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function CategoryFilter({ items, category, onPick, view }) {
  const t = useT();
  const counts = {};
  for (const c of MONITOR_CATEGORIES) counts[c.key] = items.filter(c.test).length;
  return (
    <div className="mb-4 space-y-2.5 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <Chip id={`monitor-${view}-cat-all`} active={category === 'all'} count={items.length} onClick={() => onPick('all')}>{t('monitorCatAll')}</Chip>
      </div>
      {MONITOR_GROUPS.map((g) => {
        const cats = MONITOR_CATEGORIES.filter((c) => c.group === g.key && counts[c.key] > 0);
        if (!cats.length) return null;
        return (
          <div key={g.key} className="flex flex-wrap items-center gap-2">
            <span className="w-full text-xs font-medium text-slate-800 sm:w-40 dark:text-slate-100">{t(g.labelKey)}</span>
            {cats.map((c) => (
              <Chip key={c.key} id={`monitor-${view}-cat-${c.key}`} tone={c.tone} active={category === c.key} count={counts[c.key]} onClick={() => onPick(c.key)}>
                {t('monitorCats')[c.key]}
              </Chip>
            ))}
          </div>
        );
      })}
      <p className="text-xs text-slate-800 dark:text-slate-100">{t('monitorCatHint')}</p>
    </div>
  );
}

// The last preview's report: loads its items whenever a newer preview has finished.
function MonitorReport({ summary }) {
  const view = 'preview';
  const t = useT();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('all'); // MONITOR_CATEGORIES key, or 'all'
  const finishedAt = summary && summary.finishedAt;

  useEffect(() => {
    if (!finishedAt) return undefined;
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API}/monitor/report?mode=preview`).catch(() => null);
      const list = res && res.ok ? await res.json() : [];
      if (cancelled) return;
      // Rows that would change first, then rows that only carry a note.
      list.sort((a, b) => (b.changes.length > 0) - (a.changes.length > 0));
      setItems(list);
      setPage(1);
      setCategory('all');
    })();
    return () => { cancelled = true; };
  }, [finishedAt]);

  const activeCategory = MONITOR_CATEGORIES.find((c) => c.key === category);
  const shown = activeCategory ? items.filter(activeCategory.test) : items;
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const shownPage = Math.min(Math.max(1, page), totalPages);
  const first = (shownPage - 1) * PAGE_SIZE;
  const pickCategory = (key) => {
    setCategory(key);
    setPage(1);
  };
  const detailNames = (fields) => fields.map((f) => (DETAIL_LABEL[f] ? t(DETAIL_LABEL[f]) : f));
  // Rows the CSV export lists (old / new symbol + name, CUSIP) - see GET /api/monitor/export.csv.
  const pairCount = items.reduce((n, it) => n + (it.cusipConflict ? 1 : 0) + (it.movedTo ? 1 : 0) + (it.replacedBy ? 1 : 0), 0);

  return (
    <div id={`monitor-report-${view}`}>
      {pairCount > 0 && (
        <div className="mb-3 flex justify-end">
          <Button id={`monitor-export-${view}`} onClick={() => { window.location.href = `${API}/monitor/export.csv`; }} title={t('monitorExportHint')}>
            {t('monitorExportBtn')(pairCount)}
          </Button>
        </div>
      )}
      {items.length > 0 && <CategoryFilter items={items} category={category} onPick={pickCategory} view={view} />}
      <Table id={`monitor-table-${view}`} head={[t('labelSymbol'), t('labelCompany'), t('monitorThStatus'), t('monitorThChanges')]}>
        {shown.slice(first, first + PAGE_SIZE).map((item) => {
          // Changes and fills in the normal colour, notes that need a person in amber, errors in red.
          const lines = [
            ...item.changes.map((c, i) => <span key={`c${i}`}>{`${t('monitorFields')[c.field] || (DETAIL_LABEL[c.field] ? t(DETAIL_LABEL[c.field]) : c.field)}: ${describeValue(c.field, c.from, t)} → ${describeValue(c.field, c.to, t)}`}</span>),
            ...(item.filled && item.filled.details ? [<span key="fd" className="text-green-700 dark:text-green-300">{t('monitorFilledDetails')(detailNames(item.filled.details))}</span>] : []),
            ...(item.filled && item.filled.cusip ? [<span key="fc" className="text-green-700 dark:text-green-300">{t('monitorFilledCusip')(item.filled.cusip)}</span>] : []),
            ...item.notes.map((n, i) => (
              <span key={`n${i}`} className={noteKind(n).kind === 'otherNote' ? 'text-slate-800 dark:text-slate-100' : 'text-amber-700 dark:text-amber-300'}>{describeNote(n, t)}</span>
            )),
            ...(item.cusipConflict ? [<span key="cc" className="text-amber-700 dark:text-amber-300">{t('monitorCusipConflict')(item.cusipConflict)}</span>] : []),
            ...(item.error ? [<span key="e" className="text-red-600 dark:text-red-400">{item.error}</span>] : []),
            ...(item.fillError ? [<span key="fe" className="text-red-600 dark:text-red-400">{t('monitorFillError')(item.fillError.part, item.fillError.message)}</span>] : []),
          ];
          return (
            <tr key={item.id ?? `new-${item.stock_symbol}-${item.company_name}`}>
              <td className={TD}><StockLink symbol={item.stock_symbol} id={item.id} /></td>
              <td className={TD}>{item.company_name}</td>
              <td className={TD}><Badge tone={STATUS_BADGE[item.status] || 'gray'} title={item.reason}>{t('monitorStatus')[item.status] || item.status}</Badge></td>
              <td className={TD}><Lines lines={lines} /></td>
            </tr>
          );
        })}
      </Table>
      {shown.length === 0 && (
        <p id={`monitor-empty-state-${view}`} className="py-8 text-center text-sm text-slate-800 dark:text-slate-100">
          {items.length ? t('monitorCatEmpty') : t('monitorEmptyPreview')}
        </p>
      )}
      <Pagination page={shownPage} totalPages={totalPages} total={shown.length} onPage={setPage} idPrefix={`monitor-${view}-`} />
    </div>
  );
}


export default function MonitorPanel() {
  const t = useT();
  const [state, setState] = useState(null); // GET /api/monitor/status
  const [message, setMessage] = useState(''); // starting / stopping / failed, until the next poll
  const [starting, setStarting] = useState(false);
  const [stopClicked, setStopClicked] = useState(false);
  const timer = useRef(null);

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
  }, []);

  // Also picks up a preview still going from before a page reload.
  useEffect(() => {
    poll();
    return () => clearTimeout(timer.current);
  }, [poll]);

  async function start() {
    setStarting(true);
    setMessage(t('monitorStarting'));
    try {
      const res = await fetch(`${API}/monitor/run`, { method: 'POST' });
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

  const summary = state && state.reports && state.reports.preview;
  const running = Boolean(state && state.running);
  let statusLines = [];
  if (message) statusLines = [message];
  else if (state) {
    if (running) {
      const p = state.progress || {};
      statusLines.push(state.stopRequested ? t('monitorStopping') : t('monitorRunning')(false, p.phase || 'loading', p.done || 0, p.total || 0));
    } else if (state.lastError) {
      statusLines.push(t('monitorFailed')(state.lastError));
    }
    if (summary && !running) {
      statusLines.push((summary.stopped ? t('monitorStoppedNote')(summary) : '') + t('monitorSummary')(summary, t('monitorFields')));
    }
  }
  const progress = running && state.progress && state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : null;

  const actions = (
    <>
      <Button id="monitor-preview-btn" variant="primary" disabled={running || starting} onClick={start}>{t('monitorPreviewBtn')}</Button>
      {running && <Button id="monitor-stop-btn" variant="danger" disabled={stopClicked || Boolean(state.stopRequested)} onClick={stop}>{t('monitorStopBtn')}</Button>}
    </>
  );

  return (
    <Card title={t('monitorTitle')} actions={actions}>
      <p className="mb-3 text-sm text-slate-800 dark:text-slate-100">{t('monitorHelp')}</p>
      {statusLines.length > 0 && (
        <Alert id="monitor-status" tone={state && state.lastError && !running ? 'error' : 'info'} live="polite" className="mb-4">
          <Lines lines={statusLines} />
        </Alert>
      )}
      {progress !== null && (
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      <MonitorReport summary={summary} />
    </Card>
  );
}
