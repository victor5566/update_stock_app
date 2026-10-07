import { MONITOR_CATEGORIES, describeNote, noteKind } from './monitorCategories';
import { TRANSLATIONS } from '../translations';

const t = (key) => TRANSLATIONS.zh[key];

// The strings planRow() in lib/stockMonitor.js produces - if one changes there, change it here
// and in NOTE_PATTERNS.
test('server note strings are categorized and translated', () => {
  expect(noteKind('symbol is trading under another company (Tradr 2X Long FLY Daily ETF) - left delisted'))
    .toEqual({ kind: 'recycled', arg: 'Tradr 2X Long FLY Daily ETF' });
  expect(noteKind('symbol is trading, but another live row already has it').kind).toBe('duplicate');
  expect(noteKind('name differs: Logan Capital Large Cap Growth ETF')).toEqual({ kind: 'nameDiffers', arg: 'Logan Capital Large Cap Growth ETF' });
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

test('every category has a label in both languages', () => {
  for (const lang of ['zh', 'en']) {
    for (const c of MONITOR_CATEGORIES) expect(TRANSLATIONS[lang].monitorCats[c.key]).toBeTruthy();
  }
});
