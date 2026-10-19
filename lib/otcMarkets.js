// OTC Markets' own view of an OTC symbol, for the stock monitor (the user, 2026-10-19): Yahoo's
// last-trade date isn't trusted alone for OTC rows (it froze on 2026-02-05 for a set of foreign
// ordinaries still quoted on OTC Markets), so a stale OTC row is asked here first.
//
// Uses the JSON backend behind www.otcmarkets.com (no published API - it may change; any
// unexpected answer is 'unknown', which leaves the row alone):
//   company/profile/full/<SYM>  -> 404 "Blank or not supported OTC symbol" when OTC Markets has
//                                  no such symbol; else securities[] with the tier (tierName)
//   stock/trade/inside/<SYM>    -> the inside quote (bidPrice / askPrice)
//
// otcStatus(symbol) -> { state, detail }:
//   gone     - not on OTC Markets any more (404), or on the Grey Market / Expert Market: no public
//              quotes (the table's delisted OTC rows are Grey Market; on 2026-10-19, 14 of the 134
//              stale OTC rows were Expert Market)
//   quoted   - an OTC tier (Pink, OTCQB, OTCQX, OTCID) with a bid or ask
//   unknown  - anything else (a tier without quotes - VGWEF -, an error, a changed answer)
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (stock-symbol-manager)',
  Accept: 'application/json',
  Origin: 'https://www.otcmarkets.com',
  Referer: 'https://www.otcmarkets.com/',
};
const BASE = 'https://backend.otcmarkets.com/otcapi';
const NO_PUBLIC_QUOTES = /^(grey market|expert market)$/i;

async function getJson(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS });
  if (res.status === 404) {
    await res.body?.cancel();
    return { notFound: true };
  }
  if (!res.ok) throw new Error(`OTC Markets HTTP ${res.status}`);
  return res.json();
}

async function otcStatus(symbol) {
  const s = encodeURIComponent(String(symbol).trim().toUpperCase());
  try {
    const profile = await getJson(`company/profile/full/${s}?symbol=${s}`);
    if (profile.notFound) return { state: 'gone', detail: 'not on OTC Markets' };
    const sec = (profile.securities || []).find((x) => String(x.symbol).toUpperCase() === decodeURIComponent(s));
    if (!sec || !sec.tierName) return { state: 'unknown', detail: 'no tier on OTC Markets' };
    if (NO_PUBLIC_QUOTES.test(sec.tierName)) return { state: 'gone', detail: `OTC Markets ${sec.tierName}` };
    const inside = await getJson(`stock/trade/inside/${s}?symbol=${s}`);
    const quoted = !inside.notFound && (Number(inside.bidPrice) > 0 || Number(inside.askPrice) > 0);
    return quoted
      ? { state: 'quoted', detail: `OTC Markets ${sec.tierName}, quoted` }
      : { state: 'unknown', detail: `OTC Markets ${sec.tierName}, no quote` };
  } catch (err) {
    return { state: 'unknown', detail: `OTC Markets: ${err.message}` };
  }
}

module.exports = { otcStatus };
