import { createHash } from 'node:crypto';
import { buildPlan, plannedCommits, printPreview } from '../plan.js';
import { snapshot, approve, execute, pushRun, loadRun } from '../commits.js';
import { prepareTarget, openTarget, checkEnvironment, detectIdentity } from './repository.js';
import { dateRange } from '../plan.js';
import { ask, confirm, progressDisplay, summary } from './terminal.js';

const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function getClock(value) {
  if (value === undefined) return Date.now();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || ms > Date.now())
    throw Error('Use a valid past ISO timestamp with an offset for --clock.');
  return ms;
}

function integer(value, label) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw Error('Enter a whole number for ' + label + '.');
  return Number(value);
}

async function readIdentity(target, values, interactive) {
  const detected = await detectIdentity(target);
  let name = values.name ?? detected.name ?? '';
  let email = values.email ?? detected.email ?? '';
  if (interactive) {
    console.log('\nGitHub attributes eligible commits to an associated email, including a GitHub noreply address.');
    if (!(name && email && await confirm('Use ' + name + ' <' + email + '> for these synthetic commits?'))) {
      name = await ask('Your Git author name', name);
      email = await ask('Your GitHub-associated email', email);
    }
  }
  if (!name.trim() || /[\x00-\x1f\x7f<>]/.test(name) || !/^[^\s<>@\x00-\x1f]+@[^\s<>@\x00-\x1f]+$/.test(email))
    throw Error('Supply a Git author name and valid email using --name and --email or the wizard.');
  return { name: name.trim(), email };
}

async function configure(values, entries, interactive) {
  const clock = getClock(values.clock);
  const defaults = dateRange({ timezone: systemZone(), now: clock });
  let startDate = values.start, endDate = values.end, timezone = values.timezone || systemZone();
  let total = values.total, seed = values.seed ?? '42';
  if (interactive) {
    startDate = await ask('First date (YYYY-MM-DD)', startDate || defaults.startDate);
    endDate = await ask('Last date (inclusive)', endDate || defaults.endDate);
    timezone = await ask('IANA timezone', timezone);
  }
  const range = dateRange({ startDate, endDate, timezone, now: clock });
  if (interactive) {
    console.log('\nSelected duration: ' + range.duration + ' calendar days.');
    total = await ask('Number of new synthetic commits', total ?? String(Math.min(1066, range.duration)));
    seed = await ask('Simulation seed', seed);
  }
  const config = { startDate: range.startDate, endDate: range.endDate, timezone: range.timezone,
    now: clock, total: integer(total ?? '1066', 'total'), seed: integer(seed, 'seed') };
  const plan = buildPlan({ ...config, entries });
  return { config, plan, schedule: [...plannedCommits(plan)] };
}

async function generateLocally(target, run) {
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    console.error('\nStopping at a commit boundary. Keep this workspace to resume.');
  };
  process.on('SIGINT', stop);
  try {
    console.log('\nGenerating synthetic commits on ' + target.slug + ' / ' + run.branch);
    await execute(target, run, { signal: controller.signal, onProgress: progressDisplay(run.completed) });
  } finally {
    process.off('SIGINT', stop);
  }
}

async function finish(target, run, push) {
  if (push) {
    console.log('Push destination: ' + target.slug + ' / ' + run.branch);
    await pushRun(target, run);
    run = await loadRun(target);
  }
  summary(target, run);
}

async function recover(command, values, interactive, selectExisting) {
  const url = values.repo || await ask('Dedicated GitHub repository URL');
  const target = await selectExisting(url);
  let run = await loadRun(target);
  if (!run) throw Error('No approved run exists in this local workspace.');
  if (command === 'status' || run.status === 'pushed') { summary(target, run); return; }
  console.log('Saved run ' + run.id + '   ' + run.completed + '/' + run.config.total + '   ' + target.slug + ' / ' + run.branch);
  if (run.status !== 'completed-locally') {
    if (values.push) throw Error('Complete local generation using resume before requesting a push.');
    if (!values.yes && !(interactive && await confirm('Resume this approved local schedule?'))) {
      console.log('Resume with --yes to continue local generation.'); return;
    }
    await generateLocally(target, run);
    run = await loadRun(target);
  }
  const push = values.push || (interactive && await confirm('Push synthetic commits to ' + target.slug + ' / ' + run.branch + '?'));
  await finish(target, run, push);
}

export async function launch(command, values, { selectNew = prepareTarget, selectExisting = openTarget } = {}) {
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (command !== 'generate') return recover(command, values, terminal && !values.yes && !values.push, selectExisting);
  const interactive = terminal && !values['dry-run'] && !values.yes && !values.approve;
  if (!interactive && !values['dry-run'] && !(values.yes && values.approve))
    throw Error('Open a terminal for the wizard. For automation, preview with --dry-run, then supply --yes and --approve DIGEST.');
  console.log('\nGRAPH CANVAS  2.0.0\nGit contribution calendar simulator\n');
  const env = await checkEnvironment();
  console.log('Node ' + env.node + '   |   ' + env.git);
  let settings = { ...values };
  let regenerate = false;
  let target, base, identity, url;
  for (;;) {
    if (!regenerate) {
      if (interactive) console.log('\nUse a dedicated private GitHub repository that you own or have permission to modify.');
      url = interactive ? await ask('Private GitHub repository URL', settings.repo) : settings.repo;
      if (!url && !values['dry-run']) throw Error('A dedicated private --repo URL is required.');
      try {
        target = url ? await selectNew(url) : null;
        base = target ? await snapshot(target) : { entries: [] };
        if (target) identity = await readIdentity(target, settings, interactive);
      } catch (error) {
        if (!interactive || error.name === 'AbortError') throw error;
        console.error(error.message);
        if (!await confirm('Return to repository setup?')) return;
        settings = { ...settings, repo: undefined, name: undefined, email: undefined };
        continue;
      }
    }
    let draft;
    try { draft = await configure(settings, base.entries, interactive && !regenerate); }
    catch (error) {
      if (!interactive || error.name === 'AbortError') throw error;
      console.error(error.message);
      if (!await confirm('Edit the configuration?')) return;
      settings = { repo: url };
      regenerate = false;
      continue;
    }
    const { config, plan, schedule } = draft;
    printPreview(plan, target?.slug ?? 'Offline simulation');
    if (base.legacyCount) console.log('Recognized version 1 ledger entries: ' + base.legacyCount);
    if (target) console.log('Target branch: ' + base.branch + '   |   Author: ' + identity.name + ' <' + identity.email + '>');
    const digest = createHash('sha256').update(JSON.stringify([target?.slug, target?.repositoryId,
      base.branch, base.head, base.baseline, base.entries, identity, config, schedule])).digest('hex');
    if (values['dry-run']) {
      if (target) console.log('\nTo approve this preview, repeat these options using --yes --approve ' + digest +
        ' --clock ' + new Date(config.now).toISOString() + ' in place of --dry-run.');
      return;
    }
    if (interactive) {
      const choice = (await ask('Add ' + config.total + ' local synthetic commits to ' + target.slug +
        '? [y] generate / [e] edit / [r] new seed / [N] cancel')).toLowerCase();
      if (choice === 'e' || choice === 'r') {
        settings = { repo: url, ...identity, start: config.startDate, end: config.endDate,
          timezone: config.timezone, total: String(config.total), clock: new Date(config.now).toISOString(),
          seed: String(choice === 'r' ? (config.seed + 1) >>> 0 : config.seed) };
        regenerate = choice === 'r';
        continue;
      }
      if (!['y','yes'].includes(choice)) { console.log('Cancelled before generation.'); return; }
    } else if (values.approve !== digest) throw Error('Approval does not match this preview. Repeat the repository dry run and reuse its clock and digest.');
    let run = await approve(target, base, config, identity, schedule);
    await generateLocally(target, run);
    run = await loadRun(target);
    await finish(target, run, interactive && await confirm('Push these synthetic commits to ' + target.slug + ' / ' + run.branch + '?'));
    return;
  }
}
