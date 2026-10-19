import { MONITOR_CATEGORIES, describeNote, isApplyResult, noteKind } from './monitorCategories';
import { TRANSLATIONS } from '../translations';

const t = (key) => TRANSLATIONS.en[key];

// The strings planRow() in lib/stockMonitor.js produces - if one changes there, change it here
// and in NOTE_PATTERNS.
test('server note strings are categorized and translated', () => {
  expect(noteKind('symbol is trading under another company (Tradr 2X Long FLY Daily ETF) - left delisted'))
    .toMatchObject({ kind: 'recycled', arg: 'Tradr 2X Long FLY Daily ETF' });
  expect(noteKind('symbol is trading, but another live row already has it').kind).toBe('duplicate');
  expect(noteKind('name differs: Logan Capital Large Cap Growth ETF')).toMatchObject({ kind: 'nameDiffers', arg: 'Logan Capital Large Cap Growth ETF' });
  expect(noteKind('something new').kind).toBe('otherNote');
  expect(describeNote('name differs: X Corp', t)).toContain('X Corp');
  expect(describeNote('something new', t)).toBe('something new');
});

test('a row can be in several categories', () => {
  const item = {
    changes: [{ field: 'company_name', from: 'A', to: 'B' }, { field: 'category', from: null, to: 'OTC Markets OTCPK - PNK' }],
    notes: [],
  };
  const keys = MONITOR_CATEGORIES.filter((c) => c.test(item)).map((c) => c.key);
  expect(keys).toEqual(['name', 'category']);
});

test('every category has a label', () => {
  for (const c of MONITOR_CATEGORIES) expect(TRANSLATIONS.en.monitorCats[c.key]).toBeTruthy();
});

test('a rename blocked by the (symbol, name) index is its own category', () => {
  const note = 'name already used by another row with this symbol (id 8837, delisted): ADC Therapeutics SA - nothing changed';
  expect(noteKind(note)).toMatchObject({ kind: 'nameTaken', args: ['8837', ', delisted', 'ADC Therapeutics SA'] });
  const text = describeNote(note, t);
  expect(text).toContain('ADC Therapeutics SA');
  expect(text).toContain('8837');
  expect(text).toContain('delisted');
  expect(describeNote('name already used by another row with this symbol (id 5): X Corp - nothing changed', t)).not.toContain('delisted');
});

test('an applying run lists changed and filled rows, not note-only rows', () => {
  const base = { changes: [], notes: [] };
  const filled = { ...base, filled: { details: ['sector'], cusip: '037833100' } };
  expect(MONITOR_CATEGORIES.filter((c) => c.test(filled)).map((c) => c.key)).toEqual(['detailsFilled', 'cusipFilled']);
  const conflict = { ...base, cusipConflict: { cusip: '037833100', id: 1, stock_symbol: 'AAPL' } };
  expect(MONITOR_CATEGORIES.filter((c) => c.test(conflict)).map((c) => c.key)).toEqual(['cusipConflict']);
  expect(MONITOR_CATEGORIES.find((c) => c.key === 'error').test({ ...base, fillError: { part: 'cusip', message: 'timeout' } })).toBe(true);
  expect(isApplyResult(filled)).toBe(true);
  expect(isApplyResult(conflict)).toBe(true);
  expect(isApplyResult({ ...base, changes: [{ field: 'exchange', from: 'PNK', to: 'OTC' }] })).toBe(true);
  expect(isApplyResult({ ...base, notes: ['name differs: X Corp'] })).toBe(false);
  expect(t('monitorCusipConflict')(conflict.cusipConflict)).toContain('AAPL');
});

test("an old ticker's row delisted so its CUSIP can go to the new ticker", () => {
  const note = 'symbol changed to AXNX (id 135147) - this old row marked delisted, CUSIP G6146G117 now on the new row';
  expect(noteKind(note)).toMatchObject({ kind: 'tickerChanged', args: ['AXNX', '135147', 'G6146G117'] });
  const text = describeNote(note, t);
  expect(text).toContain('AXNX');
  expect(text).toContain('G6146G117');
  const item = { changes: [{ field: 'isdelisted', from: false, to: true }], notes: [note] };
  expect(MONITOR_CATEGORIES.filter((c) => c.test(item)).map((c) => c.key)).toEqual(['delist', 'tickerChanged']);
});

test('a rename / ticker change: old row delisted with its name kept, a new row added', () => {
  const old = 'replaced by RNTZ "Rantizo" (renamed) - this row marked delisted (name kept); a new row is added for it';
  expect(noteKind(old)).toMatchObject({ kind: 'replacedBy', args: ['RNTZ', 'Rantizo', 'renamed', 'a new row is added for it'] });
  const moved = 'replaced by AXNX "Axonex AI Group Limited" (new ticker) - this row marked delisted (name kept); AXNX already has a row';
  expect(noteKind(moved)).toMatchObject({ kind: 'replacedBy', args: ['AXNX', 'Axonex AI Group Limited', 'new ticker', 'AXNX already has a row'] });
  const added = 'new row replacing id 157378 (RNTZ "SKK Holdings Limited Class A")';
  expect(noteKind(added)).toMatchObject({ kind: 'newRowFor', args: ['157378', 'RNTZ', 'SKK Holdings Limited Class A'] });
  expect(describeNote(old, t)).toContain('Rantizo');
  expect(describeNote(moved, t)).toContain('AXNX');
  expect(describeNote(added, t)).toContain('157378');
  expect(MONITOR_CATEGORIES.filter((c) => c.test({ changes: [{ field: 'isdelisted', from: false, to: true }], notes: [old] })).map((c) => c.key)).toEqual(['delist', 'replacedBy']);
  const newRow = { changes: [{ field: 'stock_symbol', from: null, to: 'RNTZ' }, { field: 'company_name', from: null, to: 'Rantizo' }], notes: [added] };
  expect(MONITOR_CATEGORIES.filter((c) => c.test(newRow)).map((c) => c.key)).toEqual(['name', 'newRow']);
  expect(isApplyResult(newRow)).toBe(true);
});

test('a delisted row renamed to free its name for the listed row', () => {
  const note = 'renamed so the listed row with this symbol (id 124802) can use its name: ADC Therapeutics SA';
  expect(noteKind(note)).toMatchObject({ kind: 'nameFreed', args: ['124802', 'ADC Therapeutics SA'] });
  const text = describeNote(note, t);
  expect(text).toContain('124802');
  expect(text).toContain('ADC Therapeutics SA');
  const item = { changes: [{ field: 'company_name', from: 'ADC Therapeutics SA', to: 'ADC Therapeutics SA (old)' }], notes: [note] };
  expect(MONITOR_CATEGORIES.filter((c) => c.test(item)).map((c) => c.key)).toEqual(['name', 'nameFreed']);
});
