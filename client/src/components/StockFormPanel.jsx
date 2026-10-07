// Add Stock tab - adding only (per the user, no edit mode here; existing stocks are changed in
// the "Update data" tab).
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { API, autoFillProblems, retryNote } from '../lib/stocks';
import { Alert, Button, Card, Field, Input, StockLink } from './ui';

export default function StockFormPanel({ onSaved }) {
  const t = useT();
  const [symbol, setSymbol] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [market, setMarket] = useState('');
  const [error, setError] = useState(null); // { text, linkSymbol?, linkId? }
  const [hint, setHint] = useState(null); // { message, stock?, lines?, tone }
  const [submitting, setSubmitting] = useState(false);
  const symbolInputRef = useRef(null);
  // What the last lookup put into the name/market inputs, so a later lookup (symbol changed)
  // may overwrite them - but never overwrite something the user typed themselves.
  const autoFilled = useRef({ company_name: '', exchange: '' });
  // Latest values for async callbacks (a lookup may finish after the user typed on).
  const latest = useRef({});
  latest.current = { symbol, companyName, market };

  function resetForm() {
    setSymbol('');
    setCompanyName('');
    setMarket('');
    setError(null);
    setHint(null);
    autoFilled.current = { company_name: '', exchange: '' };
  }

  // Once a symbol is committed, warn right away if it's a duplicate, otherwise pre-fill company
  // name / market (NASDAQ Trader's listing, then Yahoo).
  async function lookupSymbolForAdd() {
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
    if (now.symbol.trim().toUpperCase() !== sym) return;

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
    const payload = { stock_symbol: symbol.trim(), company_name: companyName.trim(), exchange: market.trim() };
    const upperSymbol = payload.stock_symbol.toUpperCase();

    // An add waits for the company-info / CUSIP lookup (a few seconds).
    setHint({ message: t('addingStock')(upperSymbol), tone: 'info' });
    setSubmitting(true);
    let res;
    try {
      res = await fetch(`${API}/stocks`, {
        method: 'POST',
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
      // symbol_name_taken: another (usually delisted) row already has this symbol + name - the
      // table's unique index. Otherwise existing_symbol is the spelling actually held ("BRK.B"
      // when "BRK-B" was typed).
      if (data.code === 'symbol_name_taken') setError({ text: t('symbolNameTaken')(data.existing_symbol, data.existing_delisted), linkSymbol: data.existing_symbol, linkId: data.existing_id });
      else if (res.status === 409) setError({ text: t('duplicateSymbol')(data.existing_symbol || upperSymbol), linkSymbol: data.existing_symbol || upperSymbol });
      else setError({ text: data.errors?.join(', ') || t('operationFailed') });
      return;
    }

    resetForm();
    const sym = data.stock_symbol;
    if (!data.autofill) setHint({ message: t('addedStock')(sym), stock: data, tone: 'success' });
    else if (data.autofill.pending) setHint({ message: t('addedPending')(sym), stock: data, tone: 'warn' });
    else {
      const problems = autoFillProblems(data.autofill, t);
      const note = problems.length ? retryNote(data.autofill, t) : null;
      setHint(problems.length
        ? { message: t('addedSomeMissing')(sym), stock: data, lines: note ? [...problems, note] : problems, tone: 'warn' }
        : { message: t('addedAllFound')(sym), stock: data, tone: 'success' });
    }
    onSaved();
  }

  return (
    <Card title={t('addTitle')}>
      <p className="mb-4 text-sm text-slate-800 dark:text-slate-100">{t('addHelp')}</p>
      <form id="stock-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
        <Field htmlFor="stock-symbol" label={t('labelSymbol')}>
          <Input id="stock-symbol" className="uppercase" placeholder="AAPL" required ref={symbolInputRef} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </Field>
        <Field htmlFor="company-name" label={t('labelCompany')}>
          <Input id="company-name" placeholder="Apple Inc." required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </Field>
        <Field htmlFor="trading-market" label={t('labelMarket')}>
          <Input id="trading-market" list="exchange-datalist" placeholder="NASDAQ" autoComplete="off" required value={market} onChange={(e) => setMarket(e.target.value)} />
        </Field>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" id="submit-btn" variant="primary" disabled={submitting}>{t('addBtn')}</Button>
        </div>
        {error && (
          <Alert id="form-error" tone="error" className="sm:col-span-3">
            {error.text}{error.linkSymbol && <StockLink symbol={error.linkSymbol} id={error.linkId} />}
          </Alert>
        )}
        {hint && (
          <Alert id="form-hint" tone={hint.tone} live="polite" className="sm:col-span-3">
            {hint.message}
            {hint.stock && <StockLink symbol={hint.stock.stock_symbol} id={hint.stock.id} />}
            {hint.lines && <ul className="mt-1 list-disc pl-5">{hint.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>}
          </Alert>
        )}
      </form>
    </Card>
  );
}
