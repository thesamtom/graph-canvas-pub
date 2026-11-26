import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export async function ask(label, fallback = '') {
  if (!stdin.isTTY || !stdout.isTTY) throw Error('Open a terminal for the wizard or use the command options in --help.');
  const rl = createInterface({ input: stdin, output: stdout });
  const controller = new AbortController();
  const abort = () => controller.abort();
  rl.once('SIGINT', abort);
  rl.once('close', abort);
  try {
    const reply = await rl.question(label + (fallback ? ' [' + fallback + ']' : '') + ' > ', { signal: controller.signal });
    return reply.trim() || fallback;
  } finally { rl.close(); }
}

export async function confirm(label) {
  return /^(y|yes)$/i.test(await ask(label + ' (y/N)'));
}

export function progressDisplay(startCount, started = Date.now()) {
  let previous = 0;
  return (completed, total) => {
    const time = Date.now();
    if (completed !== total && completed !== startCount + 1 && time - previous < (stdout.isTTY ? 250 : 2000)) return;
    previous = time;
    const elapsed = (time - started) / 1000;
    const rate = (completed - startCount) / elapsed;
    const eta = completed - startCount >= 2 && rate > 0 ? Math.ceil((total - completed) / rate) + 's' : 'estimating';
    const percent = Math.floor(completed * 100 / total);
    const bars = Math.floor(percent / 5);
    const line = '[' + '='.repeat(bars) + ' '.repeat(20 - bars) + '] ' + percent + '%  ' + completed + '/' + total +
      '  Elapsed ' + Math.floor(elapsed) + 's  ETA ' + eta;
    if (stdout.isTTY) {
      stdout.clearLine(0);
      stdout.cursorTo(0);
      stdout.write(line + (completed === total ? '\n' : ''));
    } else console.log(line);
  };
}

export function summary(target, run) {
  console.log('\nGRAPH CANVAS   /   Run summary\n');
  console.log([
    ['Repository', target.slug], ['Branch', run.branch], ['Run', run.id],
    ['Calendar', run.config.startDate + ' through ' + run.config.endDate],
    ['Timezone', run.config.timezone], ['Local commits', run.completed + ' / ' + run.config.total],
    ['Run status', run.status], ['Remote status', run.status === 'pushed' ? 'Pushed' : 'Push unconfirmed'],
    ['Workspace', target.directory], ['GitHub', 'https://github.com/' + target.slug],
    ...(target.login ? [['Profile', 'https://github.com/' + target.login]] : []),
  ].map(([key,value]) => key.padEnd(15) + value).join('\n'));
  console.log('\nThese commits represent synthetic activity. Describe them as simulations when sharing.\nGitHub controls contribution eligibility and display. Private activity visibility depends on your profile settings.');
}
