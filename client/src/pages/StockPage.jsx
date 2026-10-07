// Per-stock detail page: /<symbol>, or /<symbol>?id=<company_profile_id> for an exact row
// (a symbol can have several rows - a recycled ticker keeps its delisted row).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LangContext, useLang, useT } from '../i18n';
import { TRANSLATIONS } from '../translations';
import { API, autoFillProblems, cx, retryNote } from '../lib/stocks';
import { Alert, Badge, Card, PageHeader } from '../components/ui';

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
  return (
    <Alert id="autofill-notice" tone="warn" className="mb-6">
      <div className="font-medium">{t('afTitle')}</div>
      <ul className="mt-1 list-disc pl-5">{problems.map((line, i) => <li key={i}>{line}</li>)}</ul>
      {note && <div className="mt-1">{note}</div>}
    </Alert>
  );
}

function DetailRow({ label, id, children, wide }) {
  return (
    <div className={cx('py-3 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-4', wide && 'sm:col-span-2')}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-700 dark:text-slate-300">{label}</dt>
      <dd id={id} className="mt-1 break-words text-sm text-slate-900 sm:mt-0 dark:text-slate-100">{children}</dd>
    </div>
  );
}

export default function StockPage() {
  const [lang, setLang] = useLang('detailTitle');
  const t = (key) => TRANSLATIONS[lang][key];
  const { symbol: rawSymbol = '' } = useParams();
  const [searchParams] = useSearchParams();
  const symbol = rawSymbol.trim();
  const id = searchParams.get('id');
  const [stock, setStock] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const autoFillPolls = useRef(0);
  const refreshTimer = useRef(null);

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
  const backLink = <Link to="/" className="text-blue-600 hover:underline dark:text-blue-400">{t('backToList')}</Link>;

  return (
    <LangContext.Provider value={lang}>
      <PageHeader title={title} subtitle={backLink} lang={lang} setLang={setLang} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {notFound && (
          <Card id="not-found-section"><p className="text-sm text-slate-700 dark:text-slate-300">{t('stockNotFound')}</p></Card>
        )}
        {!stock && !notFound && <p className="text-sm text-slate-600">{t('loading')}</p>}
        {stock && (
          <Card
            id="detail-section"
            title={(
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{stock.stock_symbol}</span>
                {stock.isdelisted ? <Badge tone="red">{t('delisted')}</Badge> : <Badge tone="green">{t('listed')}</Badge>}
                {stock.exchange && <Badge tone="blue">{stock.exchange}</Badge>}
              </span>
            )}
          >
            <AutoFillNotice report={stock.autofill} />
            <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:gap-x-8 dark:divide-slate-800">
              <DetailRow label={t('labelSymbol')} id="detail-symbol">{stock.stock_symbol}</DetailRow>
              <DetailRow label={t('labelCompany')} id="detail-company-name">{stock.company_name}</DetailRow>
              <DetailRow label={t('labelMarket')} id="detail-exchange">{dash(stock.exchange)}</DetailRow>
              <DetailRow label={t('labelCategory')} id="detail-category">{dash(stock.category)}</DetailRow>
              <DetailRow label={t('labelDelisted')} id="detail-isdelisted">{stock.isdelisted ? t('yes') : t('no')}</DetailRow>
              <DetailRow label={t('labelCusips')} id="detail-cusips"><span className="font-mono">{dash(stock.cusips)}</span></DetailRow>
              <DetailRow label={t('labelSector')} id="detail-sector">{dash(stock.sector)}</DetailRow>
              <DetailRow label={t('labelIndustry')} id="detail-industry">{dash(stock.industry)}</DetailRow>
              <DetailRow label={t('labelCurrency')} id="detail-currency">{dash(stock.currency)}</DetailRow>
              <DetailRow label={t('labelCeo')} id="detail-ceo">{dash(stock.ceo)}</DetailRow>
              <DetailRow label={t('labelLocation')} id="detail-company-location" wide>{dash(stock.company_location)}</DetailRow>
              <DetailRow label={t('labelUrl')} id="detail-url" wide>
                {stock.urll
                  ? <a href={stock.urll} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">{stock.urll}</a>
                  : '-'}
              </DetailRow>
              <DetailRow label={t('labelDescription')} id="detail-description" wide>
                <p className="whitespace-pre-wrap leading-relaxed">{dash(stock.description)}</p>
              </DetailRow>
            </dl>
          </Card>
        )}
      </main>
    </LangContext.Provider>
  );
}
