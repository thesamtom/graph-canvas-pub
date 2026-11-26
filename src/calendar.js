import moment from 'moment';

export const MAX_DAYS = 1827;
const DAY = 86400;

function formatter(timezone, fields) {
  if (typeof timezone !== 'string' || !timezone || /^[+-]/.test(timezone)) {
    throw new Error('Enter an IANA timezone, such as Europe/London or UTC.');
  }
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, ...fields });
  } catch {
    throw new Error('Unknown IANA timezone. Enter a name such as Europe/London or UTC.');
  }
}

export function dateRange({ timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now(), startDate, endDate } = {}) {
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid planner clock.');
  const local = formatter(timezone, { year:'numeric', month:'2-digit', day:'2-digit' });
  const today = local.format(now);
  endDate ??= today;
  const end = moment.utc(endDate, 'YYYY-MM-DD', true);
  if (!end.isValid() || end.format('YYYY-MM-DD') !== endDate) throw new Error('Enter a real end date in YYYY-MM-DD format.');
  startDate ??= end.clone().subtract(364, 'days').format('YYYY-MM-DD');
  const start = moment.utc(startDate, 'YYYY-MM-DD', true);
  if (!start.isValid() || start.format('YYYY-MM-DD') !== startDate) throw new Error('Enter a real start date in YYYY-MM-DD format.');
  if (endDate < startDate) throw new Error('End date must be on or after the start date.');
  if (endDate > today) throw new Error('The selected range includes a future date in this timezone.');
  const duration = end.diff(start, 'days') + 1;
  if (duration > MAX_DAYS) throw new Error(`Select at most ${MAX_DAYS} calendar days per run.`);
  return { timezone: local.resolvedOptions().timeZone, now, startDate, endDate, duration };
}

// Split the UTC timeline at offset changes before intersecting it with local work hours.
// This handles skipped dates and repeated local hours without guessing a date's offset.
function offsetSegments(timezone, start, end) {
  const format = formatter(timezone, { timeZoneName:'longOffset', hour:'numeric' });
  function offsetAt(second) {
    const zone = format.formatToParts(second * 1000).find(part => part.type === 'timeZoneName').value;
    if (zone === 'GMT') return 0;
    const [hours, minutes = 0, seconds = 0] = zone.slice(4).split(':').map(Number);
    return (zone[3] === '-' ? -1 : 1) * (hours * 3600 + minutes * 60 + seconds);
  }
  let from = start;
  let offset = offsetAt(start);
  const segments = [];
  for (let sample = start; sample < end;) {
    const next = Math.min(end, sample + DAY / 2);
    const nextOffset = offsetAt(next);
    if (nextOffset !== offset) {
      let low = sample;
      let high = next;
      while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2);
        if (offsetAt(mid) === offset) low = mid;
        else high = mid;
      }
      segments.push({ from, until:high, offset });
      from = high;
      offset = nextOffset;
    }
    sample = next;
  }
  segments.push({ from, until:end + 1, offset });
  return segments;
}

export function calendarDays({startDate, endDate, now, timezone, duration}, entries) {
  const start = moment.utc(startDate).unix();
  const end = moment.utc(endDate).unix();
  const zones = offsetSegments(timezone, start - 2 * DAY, end + 2 * DAY);
  const local = formatter(timezone, { year:'numeric', month:'2-digit', day:'2-digit' });
  const occupied = new Map();
  for (const entry of entries) {
    if (typeof entry !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(entry) || !moment.parseZone(entry, moment.ISO_8601, true).isValid()) throw new Error('Invalid ledger timestamp.');
    const time = Date.parse(entry);
    const date = local.format(time);
    if (!occupied.has(date)) occupied.set(date, []);
    occupied.get(date).push(Math.floor(time / 1000));
  }
  return Array.from({ length:duration }, (_, index) => {
    const midnight = start + index * DAY;
    const civil = moment.unix(midnight).utc();
    const date = civil.format('YYYY-MM-DD');
    const blocked = (occupied.get(date) ?? []).sort((a,b) => a-b);
    const spans = [];
    for (const { from, until, offset } of zones) {
      // Git's raw timestamp format uses nonnegative Unix seconds.
      let first = Math.max(0, from, midnight + 9 * 3600 - offset);
      const last = Math.min(until - 1, Math.floor(now / 1000), midnight + 22 * 3600 - offset);
      for (const second of blocked) {
        if (second < first || second > last) continue;
        if (first < second) spans.push({ first, length:second-first, offset });
        first = second + 1;
      }
      if (first <= last) spans.push({ first, length:last-first+1, offset });
    }
    const weekday = civil.day();
    const weekend = weekday === 0 || weekday === 6;
    const seconds = spans.reduce((count, span) => count + span.length, 0);
    const capacity = weekend ? Math.min(seconds, Math.max(0, 2 - blocked.length)) : seconds;
    return { index, date, weekday, weekend, spans, seconds, capacity, existing:blocked.length, count:0 };
  });
}
