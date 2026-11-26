import moment from 'moment';

import { calendarDays, dateRange } from './src/calendar.js';
export { dateRange, MAX_DAYS } from './src/calendar.js';
export { printPreview } from './src/preview.js';
export const MAX_COMMITS = 10000;
export const MESSAGE = 'chore: generate synthetic calendar entry';
const WEEKEND_ACTIVITY = 0.60;
const BUCKETS = [[1, 2], [3, 5], [6, 9], [10, 15]];

// Mulberry32 with an unsigned 32-bit seed.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function chooseWeekendDays(available, random, occupied = new Set()) {
  const selected = [];
  for (const weekday of [0, 6]) {
    const days = available.filter(day => day.weekday === weekday);
    const alreadyActive = days.filter(day => occupied.has(day.date)).length;
    const needed = Math.max(0, Math.round(days.length * WEEKEND_ACTIVITY) - alreadyActive);
    const candidates = days.filter(day => !occupied.has(day.date))
      .map(day => ({ day, score: random() }))
      .sort((a, b) => a.score - b.score);
    selected.push(...candidates.slice(0, needed).map(({ day }) => day));
  }
  return selected;
}

function weekendCount(day, random) {
  return Math.min(day.capacity, random() < 0.25 ? 2 : 1);
}

function chooseQuietPeriods(days, random, weekdayCount) {
  if (days.length < 90) return [];
  const fullWeeks = days.slice(7, -14).filter(day => day.weekday === 0);
  const week = fullWeeks[randomInt(random, 0, fullWeeks.length - 1)];
  const periods = [{ start: week.index, length: 7 }];
  // Allow some ordinary days off while keeping at least 90% of weekdays active.
  let weekdayBudget = weekdayCount - Math.ceil(weekdayCount * 0.90) - 5 - 3;
  const holidays = Math.min(randomInt(random, 2, 3), Math.floor(days.length / 100));

  for (let holiday = 0; holiday < holidays; holiday++) {
    const candidates = [];
    for (const day of days.slice(7, -17)) {
      for (let length = 4; length <= 10; length++) {
        const end = day.index + length;
        const overlaps = periods.some(period =>
          day.index < period.start + period.length + 14 && end + 14 > period.start);
        const includesFullWeek = (7 - day.weekday) % 7 + 7 <= length;
        if (overlaps || includesFullWeek) continue;

        const weekdays = days.slice(day.index, end).filter(date => !date.weekend).length;
        const remainingHolidays = holidays - holiday - 1;
        if (weekdays + remainingHolidays * 2 <= weekdayBudget) {
          candidates.push({ start: day.index, length, weekdays });
        }
      }
    }

    if (!candidates.length) break;
    const period = candidates[randomInt(random, 0, candidates.length - 1)];
    periods.push(period);
    weekdayBudget -= period.weekdays;
  }

  for (const { start, length } of periods) {
    for (let index = start; index < start + length; index++) days[index].quiet = true;
  }
  return periods.sort((a, b) => a.start - b.start);
}

function assignCounts(days, random) {
  const ranked = days.map(day => ({ day, score: random() + day.activityBias }));
  ranked.sort((a, b) => a.day.weekend === b.day.weekend
    ? a.score - b.score
    : Number(b.day.weekend) - Number(a.day.weekend));

  const ends = [0.40, 0.75, 0.93, 1].map(fraction => Math.round(days.length * fraction));
  for (let bucket = 0, index = 0; bucket < BUCKETS.length; bucket++) {
    const [min, max] = BUCKETS[bucket];
    for (; index < ends[bucket]; index++) {
      const { day } = ranked[index];
      day.min = day.weekend ? 1 : Math.min(min, day.capacity);
      day.max = day.weekend ? 2 : max;
      day.count = day.weekend ? weekendCount(day, random) : Math.min(day.capacity, randomInt(random, min, max));
    }
  }
}

function adjustCounts(days, remaining, step, limit, random) {
  const eligible = days.filter(day => (limit(day) - day.count) * step > 0);
  while (remaining > 0 && eligible.length > 0) {
    const index = randomInt(random, 0, eligible.length - 1);
    const day = eligible[index];
    day.count += step;
    remaining--;
    if (day.count === limit(day)) {
      eligible[index] = eligible.at(-1);
      eligible.pop();
    }
  }
  return remaining;
}

function scaleCounts(days, total, random) {
  const max = days.reduce((sum, day) => sum + Math.min(day.capacity, day.weekend ? 2 : Infinity), 0);
  if (total < days.length || total > max) {
    throw new Error(`Available capacity is ${max} new commits in this plan. Reduce the total or extend the date range.`);
  }

  const difference = total - days.reduce((sum, day) => sum + day.count, 0);
  if (difference > 0) {
    const remaining = adjustCounts(days, difference, 1, day => Math.min(day.capacity, day.max), random);
    const extra = adjustCounts(days, remaining, 1,
      day => Math.min(day.capacity, day.weekend ? 2 : 15), random);
    adjustCounts(days, extra, 1, day => Math.min(day.capacity, day.weekend ? 2 : Infinity), random);
  } else if (difference < 0) {
    const remaining = adjustCounts(days, -difference, -1, day => day.min, random);
    adjustCounts(days, remaining, -1, () => 1, random);
  }
}

export function buildPlan({ total = 1066, seed = 42, entries = [], ...options } = {}) {
  if (!Number.isInteger(total) || total < 1 || total > MAX_COMMITS) throw new Error(`Commit count must be between 1 and ${MAX_COMMITS}.`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an integer between 0 and 4294967295.');
  const range = dateRange(options);
  const days = calendarDays(range, entries);
  const random = seededRandom(seed);
  let nextStretch = 0;
  let busy = random() < 0.5;
  for (const day of days) {
    if (day.index === nextStretch) {
      busy = !busy;
      nextStretch += randomInt(random, 14, 21);
    }
    day.activityBias = busy ? 0.20 : 0;
  }
  const weekdayCount = days.filter(day => !day.weekend).length;
  const quietPeriods = chooseQuietPeriods(days, random, weekdayCount);
  const available = days.filter(day => !day.quiet && day.capacity > 0);
  const weekdays = available.filter(day => !day.weekend)
    .map(day => ({ day, score: random() - day.activityBias / 2 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.round(weekdayCount * 0.925))
    .map(({ day }) => day);
  const weekends = chooseWeekendDays(available, random);
  let active = [...weekdays, ...weekends];
  if (active.length > total) {
    active = active.map(day => ({day, score:random()}))
      .sort((a,b) => a.score-b.score).slice(0,total).map(item => item.day);
  }
  const selected = new Set(active);
  let capacity = active.reduce((sum, day) => sum + day.capacity, 0);
  for (const day of available) {
    if (capacity >= total) break;
    if (!selected.has(day)) {
      active.push(day);
      capacity += day.capacity;
    }
  }
  assignCounts(active, random);
  scaleCounts(active, total, random);
  return { ...range, days, quietPeriods, total, seed, existingCount:entries.length, timestampSeed:randomInt(random,0,0xffffffff) };
}

export function buildWeekendBackfill(plan, entries) {
  const random = seededRandom(plan.seed);
  const days = calendarDays(plan, entries);
  const occupied = new Set(days.filter(day => day.existing).map(day => day.date));
  const available = days.filter(day => day.weekend && !plan.days[day.index].quiet && (day.capacity || day.existing));
  const selected = new Set(chooseWeekendDays(available, random, occupied));
  for (const day of days) {
    day.quiet = plan.days[day.index].quiet;
    if (selected.has(day)) day.count = weekendCount(day, random);
  }
  return { ...plan, days, total:days.reduce((sum, day) => sum + day.count, 0),
    existingCount:entries.length, timestampSeed:randomInt(random,0,0xffffffff) };
}

export function* plannedCommits({ days, timestampSeed }) {
  const random = seededRandom(timestampSeed);
  for (const day of days) {
    // Sample distinct indices into the day's unoccupied seconds without retries.
    const seconds = new Set();
    for (let index = day.seconds - day.count; index < day.seconds; index++) {
      const second = randomInt(random, 0, index);
      seconds.add(seconds.has(second) ? index : second);
    }
    let spanIndex = 0;
    let preceding = 0;
    for (const second of [...seconds].sort((a, b) => a - b)) {
      while (second >= preceding + day.spans[spanIndex].length) {
        preceding += day.spans[spanIndex++].length;
      }
      const span = day.spans[spanIndex];
      const time = (span.first + second - preceding) * 1000;
      // ISO offsets have minute precision. UTC preserves the instant for historical sub-minute zones.
      const offsetMinutes = span.offset % 60 ? 0 : span.offset / 60;
      const dateTime = moment.utc(time).utcOffset(offsetMinutes, false, true).toISOString(true);
      yield { dateTime, message:MESSAGE };
    }
  }
}
