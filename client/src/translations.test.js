import { TRANSLATIONS } from './translations';

// Both languages must have the same keys, of the same kind (text vs. function vs. map).
test('zh and en translations match', () => {
  const shape = (obj) => Object.keys(obj).sort().map((k) => `${k}:${typeof obj[k]}`);
  expect(shape(TRANSLATIONS.en)).toEqual(shape(TRANSLATIONS.zh));
  for (const key of ['afReasons', 'monitorCats', 'monitorNotes', 'monitorStatus', 'monitorFields']) {
    expect(Object.keys(TRANSLATIONS.en[key]).sort()).toEqual(Object.keys(TRANSLATIONS.zh[key]).sort());
  }
});
