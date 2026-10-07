// Add / edit tab. editingStock: the row whose Edit button was clicked in the list (null = add).
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { API, autoFillProblems, retryNote } from '../lib/stocks';
import { Alert, Button, Card, Field, Input, StockLink } from './ui';

export default function StockFormPanel({ editingStock, onExitEdit, onSaved }) {
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

  return (
    <Card title={editingStock ? t('editTitle')(editingStock.stock_symbol) : t('addTitle')}>
      {!editingStock && <p className="mb-4 text-sm text-slate-800 dark:text-slate-100">{t('addHelp')}</p>}
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
          <Button type="submit" id="submit-btn" variant="primary" disabled={submitting}>{editingStock ? t('saveBtn') : t('addBtn')}</Button>
          {editingStock && <Button id="cancel-btn" onClick={resetForm}>{t('cancel')}</Button>}
        </div>
        {error && (
          <Alert id="form-error" tone="error" className="sm:col-span-3">
            {error.text}{error.linkSymbol && <StockLink symbol={error.linkSymbol} />}
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
