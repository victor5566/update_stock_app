// The lookup-before-edit forms of the "Update data" tab: Lookup (GET by-symbol) enables the
// rest, submit PUTs one field. Each form's differences are in LOOKUP_FORMS - add an entry there
// for a new one.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { API, cx } from '../lib/stocks';
import { Alert, Button, Card, Field, Input, StockLink } from './ui';

export const LOOKUP_FORMS = {
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

export default function LookupEditForm({ name, onSuggest, onUpdated }) {
  const t = useT();
  const config = LOOKUP_FORMS[name];
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(null); // the stock found by Lookup
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // the stock just updated
  const newInputRef = useRef(null);
  const wide = config.info.length === 2;
  const span = wide ? 'sm:col-span-4' : 'sm:col-span-3';

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
      // 409: the new symbol is held by another live row (existing_symbol: the spelling held), or
      // the new symbol + name is another row's (symbol_name_taken - the table's unique index).
      if (data.code === 'symbol_name_taken') {
        setError(<>{t('symbolNameTaken')(data.existing_symbol, data.existing_delisted)}<StockLink symbol={data.existing_symbol} id={data.existing_id} /></>);
      } else if (res.status === 409) {
        const held = data.existing_symbol || value;
        setError(<>{t('symbolInUse')(held)}<StockLink symbol={held} /></>);
      } else {
        setError(data.errors?.join(', ') || t('operationFailed'));
      }
      return;
    }
    reset();
    setDone(data);
    onUpdated();
  }

  return (
    <Card title={t(config.titleKey)}>
      <form id={`${name}-form`} onSubmit={handleSubmit} className={cx('grid gap-4', wide ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <Field htmlFor={`${name}-symbol`} label={t(config.symbolLabelKey)}>
          <Input
            id={`${name}-symbol`}
            className="uppercase"
            list="stock-datalist"
            placeholder="AAPL"
            autoComplete="off"
            required
            value={query}
            onChange={(e) => { setQuery(e.target.value); onSuggest(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }}
          />
        </Field>
        {config.info.map((f) => (
          <Field key={f.id} htmlFor={f.id} label={t(f.labelKey)}>
            <Input id={f.id} disabled value={target ? f.get(target) : ''} />
          </Field>
        ))}
        <Field htmlFor={config.newField.id} label={t(config.newField.labelKey)}>
          <Input
            id={config.newField.id}
            className={config.newField.className}
            list={config.newField.list}
            placeholder={config.newField.placeholder}
            autoComplete={config.newField.list ? 'off' : undefined}
            required
            disabled={!target}
            ref={newInputRef}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
        </Field>
        <div className={cx('flex flex-wrap gap-2', span)}>
          <Button id={`${name}-lookup-btn`} onClick={lookup}>{t('lookupBtn')}</Button>
          <Button type="submit" id={`${name}-submit-btn`} variant="primary" disabled={!target}>{t(config.submitKey)}</Button>
          <Button id={`${name}-clear-btn`} onClick={() => { reset(); setDone(null); }}>{t('clearBtn')}</Button>
        </div>
        {error && <Alert id={`${name}-error`} tone="error" className={span}>{error}</Alert>}
        {done && (
          <Alert id={`${name}-done`} tone="success" className={span}>
            {t('updatedOk')(done.stock_symbol)}<StockLink symbol={done.stock_symbol} id={done.id} />
          </Alert>
        )}
      </form>
    </Card>
  );
}
