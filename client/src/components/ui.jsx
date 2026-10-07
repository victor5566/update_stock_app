// Small UI building blocks styled with Tailwind CSS. Reuse these rather than restyling inline,
// so every page looks the same. Tailwind only generates classes it finds written out in
// src/, so keep class names as complete strings (no 'bg-' + color).
import { Fragment, forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n';
import { cx, stockHref } from '../lib/stocks';

export function Card({ title, actions, children, className, id }) {
  return (
    <section id={id} className={cx('min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const BUTTON_VARIANTS = {
  primary: 'bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus-visible:outline-blue-600',
  secondary: 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  subtle: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:outline-red-600',
};

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

const CONTROL = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-400';

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx(CONTROL, className)} {...props} />;
});

export function Select({ className, children, ...props }) {
  return <select className={cx(CONTROL, 'pr-8', className)} {...props}>{children}</select>;
}

export function Field({ label, htmlFor, children, className }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</label>
      {children}
    </div>
  );
}

const ALERT_TONES = {
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
  info: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
};

export function Alert({ tone = 'info', children, id, className, live }) {
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'status'} aria-live={live} className={cx('rounded-lg border px-3 py-2 text-sm leading-relaxed', ALERT_TONES[tone], className)}>
      {children}
    </div>
  );
}

const BADGE_TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300',
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
};

export function Badge({ tone = 'gray', children, title }) {
  return (
    <span title={title} className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE_TONES[tone])}>
      {children}
    </span>
  );
}

const CHIP_TONES = {
  green: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  red: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300',
  gray: 'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  blue: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
};

// A toggle chip with a count, e.g. the stock monitor's category filters.
export function Chip({ tone = 'gray', active, count, onClick, children, id }) {
  return (
    <button
      type="button"
      id={id}
      aria-pressed={Boolean(active)}
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
        active ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : cx(CHIP_TONES[tone], 'hover:brightness-95'),
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cx('rounded-full px-1.5 text-[11px] tabular-nums', active ? 'bg-white/20 dark:bg-slate-900/10' : 'bg-white/70 dark:bg-black/20')}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

export function StockLink({ symbol, id, className }) {
  return (
    <Link to={stockHref(symbol, id)} className={cx('font-medium text-blue-600 hover:underline dark:text-blue-400', className)}>
      {symbol}
    </Link>
  );
}

export function Pagination({ page, totalPages, total, onPage, idPrefix = '' }) {
  const t = useT();
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span id={`${idPrefix}page-indicator`} className="text-sm text-slate-600 dark:text-slate-300">{t('pageIndicator')(page, totalPages, total)}</span>
      <div className="flex gap-2">
        <Button id={`${idPrefix}prev-page-btn`} size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('prevPage')}</Button>
        <Button id={`${idPrefix}next-page-btn`} size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>{t('nextPage')}</Button>
      </div>
    </div>
  );
}

// Table pieces, so every table looks the same.
export const TH = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300';
export const TD = 'px-3 py-2.5 align-top text-slate-800 dark:text-slate-200';

export function Table({ id, head, children }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table id={id} className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
        <thead className="bg-slate-50 dark:bg-slate-800/60">
          <tr>{head.map((label) => <th key={label} className={TH}>{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}

// Lines separated by <br>.
export function Lines({ lines }) {
  return lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{line}</Fragment>);
}

export function LangSelect({ lang, setLang }) {
  return (
    <select
      id="lang-switch"
      aria-label="Language"
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    >
      <option value="zh">中文</option>
      <option value="en">English</option>
    </select>
  );
}

export function PageHeader({ title, subtitle, lang, setLang }) {
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h1 id="page-heading" className="truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{subtitle}</div>}
        </div>
        <LangSelect lang={lang} setLang={setLang} />
      </div>
    </header>
  );
}
