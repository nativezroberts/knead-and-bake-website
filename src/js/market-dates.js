/**
 * Market Dates — computes next market Saturday dynamically,
 * handles skip dates, and fetches announcements from the API.
 */

const API_BASE = window.__API_BASE || '';
const MARKET_TIMEZONE = 'America/Chicago';
const MARKET_END_HOUR = 13; // 1 PM CST
const CUTOFF_DAY_OFFSET = 0; // Saturday (market day)
const CUTOFF_HOUR = 9; // 9 AM CST

function getCSTDate(date = new Date()) {
  const str = date.toLocaleString('en-US', { timeZone: MARKET_TIMEZONE });
  return new Date(str);
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNextSaturday(fromDate) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 6=Sat

  if (day === 6) {
    // It's Saturday — check if market is still ongoing
    const now = getCSTDate();
    if (now.getHours() < MARKET_END_HOUR) return d;
    // After market hours, return next Saturday
    d.setDate(d.getDate() + 7);
    return d;
  }

  const daysUntilSat = (6 - day + 7) % 7;
  d.setDate(d.getDate() + daysUntilSat);
  return d;
}

function getNextAvailableMarketDate(skipDates = []) {
  const skipSet = new Set(skipDates);
  const now = getCSTDate();
  let candidate = getNextSaturday(now);

  for (let i = 0; i < 52; i++) {
    const dateStr = toYMD(candidate);
    if (!skipSet.has(dateStr)) return candidate;
    candidate = new Date(candidate);
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

function getPreorderCutoff(saturdayDate) {
  const cutoff = new Date(saturdayDate);
  cutoff.setDate(cutoff.getDate() + CUTOFF_DAY_OFFSET); // Thursday
  cutoff.setHours(CUTOFF_HOUR, 0, 0, 0);
  return cutoff;
}

function isPreorderOpen(saturdayDate) {
  const cutoff = getPreorderCutoff(saturdayDate);
  const now = getCSTDate();
  return now < cutoff;
}

function formatMarketDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: MARKET_TIMEZONE,
  });
}

function formatCutoffDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: MARKET_TIMEZONE,
  }) + ' at 9:00 AM';
}

function getSkipReason(skipDates, dateStr) {
  // skipDates can be an array of strings or objects with { date, reason }
  if (!Array.isArray(skipDates)) return '';
  for (const s of skipDates) {
    if (typeof s === 'object' && s.date === dateStr) return s.reason || '';
    if (typeof s === 'string' && s === dateStr) return '';
  }
  return '';
}

function extractSkipDateStrings(skipDates) {
  if (!Array.isArray(skipDates)) return [];
  return skipDates.map(s => typeof s === 'object' ? s.date : s);
}

export async function getMarketInfo() {
  let skipDates = [];
  let announcements = [];

  try {
    const res = await fetch(`${API_BASE}/api/market-config`);
    if (res.ok) {
      const data = await res.json();
      skipDates = data.skipDates || [];
      announcements = data.announcements || [];
    }
  } catch (e) {
    console.warn('[MarketDates] Failed to fetch market config, using defaults', e);
  }

  const skipDateStrings = extractSkipDateStrings(skipDates);
  const now = getCSTDate();
  const rawNextSaturday = getNextSaturday(now);
  const rawNextSaturdayStr = toYMD(rawNextSaturday);
  const skippedThisWeek = skipDateStrings.includes(rawNextSaturdayStr);
  const skipReason = skippedThisWeek ? getSkipReason(skipDates, rawNextSaturdayStr) : '';

  const nextMarketDate = getNextAvailableMarketDate(skipDateStrings);
  const cutoffDate = getPreorderCutoff(nextMarketDate);

  return {
    nextMarket: {
      date: formatMarketDate(nextMarketDate),
      dateISO: toYMD(nextMarketDate),
      time: '9:00 AM \u2013 1:00 PM',
      location: 'Castell Street Market, New Braunfels',
      preorderCutoff: formatCutoffDate(cutoffDate),
    },
    preorderOpen: isPreorderOpen(nextMarketDate),
    announcements,
    skippedThisWeek,
    skipReason,
  };
}
