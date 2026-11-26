import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import moment from 'moment';

export const LEDGER = 'graph-canvas-ledger.json';
export const STATE = 'graph-canvas-run.json';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const emptyLedger = () => ({ format: 'graph-canvas/v2', runs: [] });
export const entriesOf = ledger => ledger.runs.flatMap(run => run.timestamps);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const validId = id => typeof id === 'string' && uuid.test(id);
export const validTimestamp = stamp => typeof stamp === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?(?:Z|[+-]\d\d:\d\d)$/.test(stamp) &&
  moment.parseZone(stamp, moment.ISO_8601, true).isValid();

export function validateLedger(ledger) {
  const keys = new Set();
  const ids = new Set();
  const seconds = new Set();
  if (ledger?.format !== 'graph-canvas/v2' || !Array.isArray(ledger.runs)) {
    throw new Error('Invalid Graph Canvas ledger. The namespaced file is already in use or damaged.');
  }
  for (const run of ledger.runs) {
    if (!validId(run?.id) || ids.has(run.id) || !/^[a-f0-9]{64}$/.test(run.key) ||
        keys.has(run.key) || !Array.isArray(run.timestamps) || !run.timestamps.length) {
      throw new Error('Invalid Graph Canvas ledger run.');
    }
    ids.add(run.id);
    keys.add(run.key);
    let last = -Infinity;
    for (const stamp of run.timestamps) {
      const time = Date.parse(stamp);
      if (!validTimestamp(stamp) || time <= last || seconds.has(time)) {
        throw new Error('Invalid or duplicate timestamp in the Graph Canvas ledger.');
      }
      seconds.add(time);
      last = time;
    }
  }
  return ledger;
}

export async function readJson(path, label) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error();
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read ${label}. A regular file containing valid JSON is required.`);
  }
}

async function retry(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt === 8 || !['EACCES', 'EBUSY', 'EPERM'].includes(error.code)) throw error;
      await delay(25 * 2 ** attempt);
    }
  }
}

export async function atomicJson(path, value) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', {flag:'wx', mode:0o600});
    await retry(() => rename(tmp, path));
  } finally {
    await retry(() => rm(tmp, {force:true}));
  }
}

export async function exclusively(directory, operation) {
  const path = join(directory, 'graph-canvas.lock');
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another run holds graph-canvas.lock. If its process has stopped, remove only this lock from the target .git directory and resume.');
    throw error;
  }
  try {
    await lock.writeFile(String(process.pid));
    return await operation();
  } finally {
    await lock.close();
    await retry(() => rm(path));
  }
}
