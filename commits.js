import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MESSAGE as message } from './plan.js';
import { git, validateTarget, verifyAccess } from './src/repository.js';
import { LEDGER, STATE, atomicJson, digest, emptyLedger, entriesOf, exclusively, readJson,
  validId, validTimestamp, validateLedger } from './src/storage.js';

const statuses = ['planned','in-progress','interrupted','failed','completed-locally','pushed'];
const ledgerPath = target => join(target.directory, LEDGER);
const gitDir = target => join(target.directory, '.git');
const statePath = target => join(gitDir(target), STATE);
const headOf = target => git(target, ['rev-parse','--verify','HEAD'], {allowFailure:true});
async function branchOf(target) {
  const ref = await git(target,['symbolic-ref','--quiet','HEAD'],{allowFailure:true});
  if (!ref.startsWith('refs/heads/')) throw new Error('Check out a local branch in the target repository.');
  return ref.slice('refs/heads/'.length);
}
const legacyMessages = new Set(['update layout','fix spacing','refactor component','tweak styles','update data','cleanup']);
const configKey = ({startDate,endDate,timezone,total,seed}) => digest([startDate,endDate,timezone,total,seed]);
const immutable = run => [run.id, run.repository, run.repositoryId, run.url, run.branch, run.base, run.baseline,
  run.config, run.identity, run.schedule, run.key];

function validatePlan(config, identity, schedule) {
  if (!config || !Number.isSafeInteger(config.now) || !Number.isSafeInteger(config.seed) ||
      config.seed < 0 || config.seed > 4294967295 || !Number.isSafeInteger(config.total) ||
      config.total < 1 || !Array.isArray(schedule) || schedule.length !== config.total ||
      !/^\d{4}-\d\d-\d\d$/.test(config.startDate) || !/^\d{4}-\d\d-\d\d$/.test(config.endDate) ||
      !identity?.name?.trim() || !/^[^\s<>@]+@[^\s<>@]+$/.test(identity.email) ||
      /[<>\x00-\x1f\x7f]/.test(identity.name + identity.email)) throw new Error('Invalid saved plan or Git identity.');
  const fmt = new Intl.DateTimeFormat('en-CA', {timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
  let last = -Infinity;
  for (const item of schedule) {
    if (!validTimestamp(item?.dateTime) || item.message !== message) throw new Error('Invalid synthetic schedule.');
    const time = Date.parse(item.dateTime);
    const local = fmt.format(time);
    if (local < config.startDate || local > config.endDate || time <= last || time > config.now || time > Date.now()) {
      throw new Error('Schedule contains an invalid, duplicate, unordered or future timestamp.');
    }
    last = time;
  }
}

export async function loadRun(target) {
  await validateTarget(target);
  const run = await readJson(statePath(target), 'saved plan');
  if (run === undefined) return null;
  if (!validId(run?.id) || run.version !== 2 || run.repository !== target.slug || run.url !== target.url ||
      !Array.isArray(run.schedule) || !statuses.includes(run.status) || run.checksum !== digest(immutable(run)) ||
      !Number.isInteger(run.completed) || run.completed < 0 || run.completed > run.schedule.length ||
      run.key !== configKey(run.config)) throw new Error('Saved plan validation failed. Inspect the target clone before continuing.');
  validatePlan(run.config, run.identity, run.schedule);
  return run;
}

async function checkOperation(target) {
  for (const name of ['MERGE_HEAD','REVERT_HEAD','CHERRY_PICK_HEAD','rebase-merge','rebase-apply','sequencer','BISECT_START']) {
    try { await lstat(join(gitDir(target),name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Finish the in-progress Git operation before generating commits.');
  }
}

async function cleanLedger(target) {
  await checkOperation(target);
  if (await git(target,['diff','--cached','--name-only'])) throw new Error('The staging area contains changes. Commit or unstage them first.');
  if (await git(target,['status','--porcelain','--untracked-files=all','--',LEDGER])) {
    throw new Error('The Graph Canvas ledger has local changes. Inspect the target clone before continuing.');
  }
  if (await git(target,['check-ignore',LEDGER],{allowFailure:true})) throw new Error('The target ignores the Graph Canvas ledger.');
  const data = await readJson(ledgerPath(target),'Graph Canvas ledger');
  if (data === undefined) return emptyLedger();
  if (!(await git(target,['ls-files','--',LEDGER]))) throw new Error('The existing ledger is untracked.');
  return validateLedger(data);
}

async function legacyEntries(target, head) {
  if (!head) return [];
  const listing = await git(target,['ls-tree','-l',head,'--','data.json']);
  // Ignore application data, symbolic links and large unrelated assets.
  const match = /^100(?:644|755) blob [a-f0-9]+\s+(\d+)\tdata\.json$/.exec(listing);
  if (!match || Number(match[1]) > 4 * 1024 * 1024) return [];
  let entries;
  try { entries = JSON.parse(await git(target,['show',head + ':data.json'])); }
  catch { return []; }
  if (!Array.isArray(entries) || !entries.length || !entries.every(validTimestamp)) return [];
  const history = await git(target,['log','--reverse','--full-diff','--no-renames',
    '--format=%at%x09%ct%x09%s','--name-only',head,'--','data.json']);
  const rows = history.split(/\r?\n/).filter(Boolean);
  if (rows.length !== entries.length * 2) return [];
  for (const [index,entry] of entries.entries()) {
    const [author,committer,subject] = rows[index*2].split('\t');
    if (author !== committer || Number(author)*1000 !== Date.parse(entry) ||
        !legacyMessages.has(subject) || rows[index*2+1] !== 'data.json') return [];
  }
  return entries;
}

export async function snapshot(target) {
  await validateTarget(target);
  const ledger = await cleanLedger(target);
  const head = await headOf(target);
  const legacy = await legacyEntries(target,head);
  return {branch:await branchOf(target), head, entries:[...legacy,...entriesOf(ledger)],
    legacyCount:legacy.length, baseline:digest([ledger,legacy])};
}

async function remoteHead(target, branch) {
  const result = await git(target,['ls-remote','--heads','origin','refs/heads/' + branch]);
  return result.split(/\s/)[0];
}

export async function approve(target, preview, config, identity, schedule) {
  await validateTarget(target);
  await verifyAccess(target);
  return exclusively(gitDir(target), async () => {
    const old = await loadRun(target);
    if (old && old.status !== 'pushed') throw new Error('A saved run already exists. Use resume to finish generation or push it.');
    const current = await snapshot(target);
    if (current.head !== preview.head || current.branch !== preview.branch || current.baseline !== preview.baseline) {
      throw new Error('Branch, history or ledger changed since preview. Generate a fresh preview.');
    }
    validatePlan(config,identity,schedule);
    const ledger = await cleanLedger(target);
    const key = configKey(config);
    if (ledger.runs.some(run => run.key === key)) throw new Error('Duplicate run. This range, timezone, total and seed already exist in the target ledger.');
    const occupied = new Set(current.entries.map(Date.parse));
    if (schedule.some(item => occupied.has(Date.parse(item.dateTime)))) throw new Error('Preview overlaps existing ledger timestamps.');
    if (await remoteHead(target,current.branch) !== current.head) throw new Error('Local and remote branch tips differ. Reconcile them before approving this run.');
    const run = {version:2,id:randomUUID(),repository:target.slug,repositoryId:target.repositoryId,url:target.url,branch:current.branch,
      base:current.head,baseline:current.baseline,key,config,identity,schedule,
      head:current.head,completed:0,pending:false,status:'planned'};
    run.checksum = digest(immutable(run));
    await atomicJson(statePath(target),run);
    return run;
  });
}

function append(ledger,run,index) {
  let record = ledger.runs.at(-1);
  if (record?.id !== run.id) {
    record = {id:run.id,key:run.key,timestamps:[]};
    ledger.runs.push(record);
  }
  record.timestamps.push(run.schedule[index].dateTime);
}

const subject = (run,index) => message + '\n\nGraph-Canvas-Run: ' + run.id + '\nGraph-Canvas-Entry: ' + (index + 1);

async function readBase(target,run) {
  if (!run.base || !(await git(target,['ls-tree',run.base,'--',LEDGER]))) return emptyLedger();
  try { return validateLedger(JSON.parse(await git(target,['show',run.base + ':' + LEDGER]))); }
  catch { throw new Error('Cannot validate the ledger at the saved starting commit.'); }
}

// A process may stop between replacing the file, staging it and committing it.
// Undo only the exact next ledger image described by the saved write intent.
async function undoPending(target,run,previous) {
  const expected = structuredClone(previous);
  append(expected,run,run.completed);
  const working = await readJson(ledgerPath(target),'pending ledger');
  const matchesNext = digest(working ?? null) === digest(expected);
  const matchesPrior = digest(working ?? emptyLedger()) === digest(previous);
  if (!matchesNext && !matchesPrior) throw new Error('Pending ledger differs from the saved run. Inspect the target clone.');
  const staged = await git(target,['diff','--cached','--name-only']);
  if (staged && staged !== LEDGER) throw new Error('Unrelated staged changes prevent recovery.');
  if (staged) {
    const content = await git(target,['show',':' + LEDGER]);
    if (digest(JSON.parse(content)) !== digest(expected)) throw new Error('Staged ledger differs from the saved run.');
  }
  if (!matchesNext && !staged) return;
  if (run.head && await git(target,['ls-tree',run.head,'--',LEDGER])) {
    await git(target,['restore','--source=' + run.head,'--staged','--worktree','--',LEDGER]);
  } else {
    await git(target,['rm','--cached','--ignore-unmatch','--',LEDGER]);
    await rm(ledgerPath(target),{force:true});
  }
}

async function reconcile(target,run) {
  if (await branchOf(target) !== run.branch) throw new Error('Checked-out branch differs from the approved branch.');
  await checkOperation(target);
  const head = await headOf(target);
  const ledger = await readBase(target,run);
  if (digest([ledger,await legacyEntries(target,run.base)]) !== run.baseline) {
    throw new Error('Starting ledger differs from the approved preview.');
  }
  const revision = run.base ? run.base + '..HEAD' : 'HEAD';
  const history = head ? await git(target,['log','--reverse','--format=%H%x09%P%x09%at%x09%ct%x09%ae%x09%ce%x09%an%x09%cn%x09%s%x09%(trailers:key=Graph-Canvas-Run,valueonly,separator=%x2c)%x09%(trailers:key=Graph-Canvas-Entry,valueonly,separator=%x2c)','--name-only',revision]) : '';
  const rows = history.split(/\r?\n/).filter(Boolean);
  const count = rows.length / 2;
  if (!Number.isInteger(count) || count < run.completed || count > run.completed + Number(run.pending) || count > run.schedule.length) {
    throw new Error('Git history differs from the saved plan. Inspect unrelated or missing commits.');
  }
  let parent = run.base;
  let checkpoint = parent;
  for (let i=0; i<count; i++) {
    const [hash,parents,authorTime,committerTime,authorEmail,committerEmail,author,committer,title,id,entry] = rows[i*2].split('\t');
    const seconds = String(Date.parse(run.schedule[i].dateTime)/1000);
    if (parents !== parent || authorTime !== seconds || committerTime !== seconds ||
        authorEmail !== run.identity.email || committerEmail !== authorEmail || author !== run.identity.name ||
        committer !== author || title !== message || id !== run.id || entry !== String(i+1) || rows[i*2+1] !== LEDGER) {
      throw new Error('Commit history or identity differs from the approved synthetic plan.');
    }
    append(ledger,run,i);
    parent = hash;
    if (i+1 === run.completed) checkpoint = hash;
  }
  if (parent !== head || checkpoint !== run.head) throw new Error('Saved commit checkpoint differs from Git history.');
  if (run.pending && count === run.completed) await undoPending(target,run,ledger);
  if (digest(await cleanLedger(target)) !== digest(ledger)) throw new Error('Current ledger differs from approved history.');
  run.completed = count;
  run.head = head;
  run.pending = false;
  return ledger;
}

async function checkedRun(target,requested) {
  const saved = await loadRun(target);
  if (!saved || saved.id !== requested?.id) throw new Error('Cannot find the requested approved run.');
  if (saved.repositoryId !== target.repositoryId) throw new Error('The GitHub repository identity differs from the approved target.');
  return saved;
}

export async function execute(target,requested,{signal,onProgress} = {}) {
  await validateTarget(target);
  await verifyAccess(target);
  return exclusively(gitDir(target), async () => {
    const run = await checkedRun(target,requested);
    const ledger = await reconcile(target,run);
    if (run.status === 'pushed') return run;
    run.status = 'in-progress';
    await atomicJson(statePath(target),run);
    try {
      while (run.completed < run.schedule.length) {
        if (signal?.aborted) throw new Error('Generation interrupted. Use resume to continue.');
        if (await branchOf(target) !== run.branch || await headOf(target) !== run.head) throw new Error('Branch or HEAD changed during generation.');
        const index = run.completed;
        const date = run.schedule[index].dateTime;
        if (Date.parse(date) > Date.now()) throw new Error('The next synthetic timestamp is in the future.');
        if (await git(target,['diff','--cached','--name-only']) || await git(target,['status','--porcelain','--untracked-files=all','--',LEDGER])) {
          throw new Error('Staging area or ledger changed during generation.');
        }
        run.pending = true;
        await atomicJson(statePath(target),run);
        append(ledger,run,index);
        await atomicJson(ledgerPath(target),ledger);
        await git(target,['add','--',LEDGER]);
        const env = {};
        for (const role of ['AUTHOR','COMMITTER']) {
          env['GIT_' + role + '_DATE'] = date;
          env['GIT_' + role + '_EMAIL'] = run.identity.email;
          env['GIT_' + role + '_NAME'] = run.identity.name;
        }
        await git(target,['commit','--only','--message',subject(run,index),'--',LEDGER],{env});
        run.head = await headOf(target);
        run.completed++;
        run.pending = false;
        await atomicJson(statePath(target),run);
        onProgress?.(run.completed,run.schedule.length);
      }
      run.status = 'completed-locally';
    } catch (error) {
      run.status = signal?.aborted ? 'interrupted' : 'failed';
      await atomicJson(statePath(target),run);
      // Only clean up when HEAD, branch, ledger and saved write intent agree.
      if (run.pending) await reconcile(target,run);
      await atomicJson(statePath(target),run);
      throw new Error(error.message + ' Completed ' + run.completed + '/' + run.config.total + '. Use resume to recover.');
    }
    await atomicJson(statePath(target),run);
    return run;
  });
}

export async function pushRun(target,requested) {
  await validateTarget(target);
  await verifyAccess(target);
  return exclusively(gitDir(target),async () => {
    const run = await checkedRun(target,requested);
    await reconcile(target,run);
    if (run.completed !== run.config.total) throw new Error('Finish generating this run before pushing.');
    await validateTarget(target);
    if (await branchOf(target) !== run.branch || await headOf(target) !== run.head) {
      throw new Error('Branch or HEAD changed before push. Review the target clone.');
    }
    const remote = await remoteHead(target,run.branch);
    if (remote !== run.head) {
      if (remote !== run.base) throw new Error('Remote branch changed. Local commits are preserved. Inspect the remote before retrying.');
      try {
        await git(target,['push','--no-force','--no-follow-tags','--recurse-submodules=no','origin',run.head + ':refs/heads/' + run.branch]);
      } catch {
        throw new Error('Push failed. Local commits are preserved. Check connectivity, credentials and branch permissions, then retry with resume.');
      }
    }
    run.status = 'pushed';
    await atomicJson(statePath(target),run);
    return run;
  });
}
