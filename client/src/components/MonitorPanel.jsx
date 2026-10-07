// Stock monitor tab (server: routes/monitor.js). A check runs in the background on the server;
// this polls its status, then shows the report, filterable by category.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { API, PAGE_SIZE, cx } from '../lib/stocks';
import { MONITOR_CATEGORIES, MONITOR_GROUPS, describeNote, noteKind } from '../lib/monitorCategories';
import { Alert, Badge, Button, Card, Chip, Lines, Pagination, StockLink, Table, TD } from './ui';

const MONITOR_POLL_MS = 3000;
const STATUS_BADGE = { listed: 'green', delisted: 'red', unknown: 'gray' };

function describeValue(field, value, t) {
  if (field === 'isdelisted') return value ? t('yes') : t('no');
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function CategoryFilter({ items, category, onPick }) {
  const t = useT();
  const counts = {};
  for (const c of MONITOR_CATEGORIES) counts[c.key] = items.filter(c.test).length;
  return (
    <div id="monitor-categories" className="mb-4 space-y-2.5 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <Chip id="monitor-cat-all" active={category === 'all'} count={items.length} onClick={() => onPick('all')}>{t('monitorCatAll')}</Chip>
      </div>
      {MONITOR_GROUPS.map((g) => {
        const cats = MONITOR_CATEGORIES.filter((c) => c.group === g.key && counts[c.key] > 0);
        if (!cats.length) return null;
        return (
          <div key={g.key} className="flex flex-wrap items-center gap-2">
            <span className="w-full text-xs font-medium text-slate-500 sm:w-40 dark:text-slate-400">{t(g.labelKey)}</span>
            {cats.map((c) => (
              <Chip key={c.key} id={`monitor-cat-${c.key}`} tone={c.tone} active={category === c.key} count={counts[c.key]} onClick={() => onPick(c.key)}>
                {t('monitorCats')[c.key]}
              </Chip>
            ))}
          </div>
        );
      })}
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('monitorCatHint')}</p>
    </div>
  );
}

export default function MonitorPanel({ onApplied }) {
  const t = useT();
  const [state, setState] = useState(null); // GET /api/monitor/status
  const [message, setMessage] = useState(''); // starting / stopping / failed, until the next poll
  const [starting, setStarting] = useState(false);
  const [stopClicked, setStopClicked] = useState(false);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('all'); // MONITOR_CATEGORIES key, or 'all'
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
      setCategory('all');
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

  const activeCategory = MONITOR_CATEGORIES.find((c) => c.key === category);
  const shown = activeCategory ? items.filter(activeCategory.test) : items;
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const shownPage = Math.min(Math.max(1, page), totalPages);
  const first = (shownPage - 1) * PAGE_SIZE;
  const pickCategory = (key) => {
    setCategory(key);
    setPage(1);
  };

  const actions = (
    <>
      <Button id="monitor-preview-btn" disabled={running || starting} onClick={() => start(false)}>{t('monitorPreviewBtn')}</Button>
      <Button id="monitor-apply-btn" variant="primary" disabled={running || starting} onClick={() => start(true)}>{t('monitorApplyBtn')}</Button>
      {running && <Button id="monitor-stop-btn" variant="danger" disabled={stopClicked || Boolean(state.stopRequested)} onClick={stop}>{t('monitorStopBtn')}</Button>}
    </>
  );

  return (
    <Card title={t('monitorTitle')} actions={actions}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{t('monitorHelp')}</p>
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
      {items.length > 0 && <CategoryFilter items={items} category={category} onPick={pickCategory} />}
      <Table id="monitor-table" head={[t('labelSymbol'), t('labelCompany'), t('monitorThStatus'), t('monitorThChanges')]}>
        {shown.slice(first, first + PAGE_SIZE).map((item) => {
          // Changes in the normal colour, notes that need a person in amber, errors in red.
          const lines = [
            ...item.changes.map((c, i) => <span key={`c${i}`}>{`${t('monitorFields')[c.field] || c.field}: ${describeValue(c.field, c.from, t)} → ${describeValue(c.field, c.to, t)}`}</span>),
            ...item.notes.map((n, i) => (
              <span key={`n${i}`} className={noteKind(n).kind === 'otherNote' ? 'text-slate-500 dark:text-slate-400' : 'text-amber-700 dark:text-amber-300'}>{describeNote(n, t)}</span>
            )),
            ...(item.error ? [<span key="e" className="text-red-600 dark:text-red-400">{item.error}</span>] : []),
          ];
          return (
            <tr key={item.id}>
              <td className={TD}><StockLink symbol={item.stock_symbol} id={item.id} /></td>
              <td className={TD}>{item.company_name}</td>
              <td className={TD}><Badge tone={STATUS_BADGE[item.status] || 'gray'} title={item.reason}>{t('monitorStatus')[item.status] || item.status}</Badge></td>
              <td className={cx(TD)}><Lines lines={lines} /></td>
            </tr>
          );
        })}
      </Table>
      {shown.length === 0 && (
        <p id="monitor-empty-state" className="py-8 text-center text-sm text-slate-500">{items.length ? t('monitorCatEmpty') : t('monitorEmpty')}</p>
      )}
      <Pagination page={shownPage} totalPages={totalPages} total={shown.length} onPage={setPage} idPrefix="monitor-" />
    </Card>
  );
}
