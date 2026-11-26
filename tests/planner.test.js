import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, plannedCommits, buildWeekendBackfill, printPreview } from '../plan.js';

const base = { startDate: '2024-01-01', timezone: 'UTC', seed: 42, now: Date.parse('2026-07-15T12:00:00Z') };
for (const [endDate, length] of [['2024-01-01', 1], ['2024-01-07', 7], ['2024-01-30', 30], ['2024-12-30', 365], ['2025-01-01', 367]]) {
  test(`inclusive ${length}-day range with exact totals`, () => {
    const options = { ...base, endDate, total: length === 1 ? 8 : length };
    const plan = buildPlan(options);
    const schedule = [...plannedCommits(plan)];
    assert.equal(plan.days.length, length);
    assert.equal(schedule.length, options.total);
    assert.equal(new Set(schedule.map(item => Date.parse(item.dateTime))).size, options.total);
    assert.deepEqual(schedule, [...plannedCommits(buildPlan(options))]);
    assert.deepEqual(schedule, [...plannedCommits(plan)]);
    if (length <= 30) assert.equal(plan.quietPeriods.length, 0);
    if (length >= 365) assert.ok(plan.days.some(day => day.date === '2024-02-29'));
    assert.ok(plan.days.every(day => !day.quiet || !day.count));
    assert.ok(schedule.every(item => item.message.includes('synthetic')));
  });
}
test('rejects invalid dates, ranges, numeric inputs and timezone', () => {
  for (const args of [{endDate:'2024-02-30'}, {endDate:'2024-2-01'}, {endDate:'2023-12-01'}, {endDate:'2026-07-16'}, {startDate:'2010-01-01'}, {timezone:'Mars/Base'}, {timezone:'+05:30'}, {total:0}, {total:10001}, {seed:-1}]) {
    assert.throws(() => buildPlan({ ...base, endDate:'2024-02-29', total:1, ...args }));
  }
});
test('respects local wall time on both sides of daylight-saving transitions', () => {
  for (const [date, offset] of [['2024-03-09','-05:00'], ['2024-03-10','-04:00'], ['2024-11-02','-04:00'], ['2024-11-03','-05:00']]) {
    const plan = buildPlan({ ...base, startDate:date, endDate:date, timezone:'America/New_York', total:2 });
    for (const {dateTime} of plannedCommits(plan)) {
      assert.equal(dateTime.slice(0,10), date);
      assert.equal(dateTime.slice(-6), offset);
      assert.ok(dateTime.slice(11,19) >= '09:00:00' && dateTime.slice(11,19) <= '22:00:00');
    }
  }
});
test('today capacity respects local clock and already occupied instants', () => {
  const opts = { ...base, startDate:'2024-01-01', endDate:'2024-01-01', timezone:'Asia/Kathmandu', total:1, now:Date.parse('2024-01-01T03:15:01Z') };
  const entries = ['2024-01-01T03:15:00Z'];
  const plan = buildPlan({ ...opts, entries });
  assert.equal(plan.existingCount, 1);
  assert.equal(Date.parse([...plannedCommits(plan)][0].dateTime), opts.now);
  assert.throws(() => buildPlan({ ...opts, entries, total:2 }), /capacity/);
  assert.throws(() => buildPlan({ ...opts, now:opts.now-2000 }), /capacity/);
});
test('short runs thin active dates and backfill skips occupied dates', () => {
  const plan = buildPlan({ ...base, endDate:'2024-06-30', total:1 });
  assert.equal(plan.days.filter(day => day.count).length, 1);
  const weekend = buildWeekendBackfill(plan, ['2024-01-06T12:00:00Z']);
  assert.ok(weekend.days.every(day => !day.count || day.weekend && day.date !== '2024-01-06'));
});
test('an existing weekend entry leaves only one slot on that date', () => {
  const options = { ...base, startDate:'2024-01-06', endDate:'2024-01-06', entries:['2024-01-06T13:00:00Z'] };
  assert.equal(buildPlan({ ...options, total:1 }).days[0].capacity, 1);
  assert.throws(() => buildPlan({ ...options, total:2 }), /capacity/);
});
test('a skipped local civil date has no synthetic timestamps', () => {
  const options = { ...base, startDate:'2011-12-29', endDate:'2011-12-31', timezone:'Pacific/Apia', total:5 };
  const plan = buildPlan(options);
  assert.equal(plan.days[1].date, '2011-12-30');
  assert.equal(plan.days[1].capacity, 0);
  assert.ok([...plannedCommits(plan)].every(item => !item.dateTime.startsWith('2011-12-30')));
});
test('dynamic preview reports the actual repository, range and ledger', t => {
  const output = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  printPreview(buildPlan({...base, endDate:'2024-01-02', total:1, entries:['2024-01-01T12:00:00Z']}), 'user/sandbox');
  assert.match(output.join('\n'), /user\/sandbox/);
  assert.match(output.join('\n'), /existing.*1/i);
  assert.match(output.join('\n'), /inactive.*1/i);
});
