#!/usr/bin/env node
import { parseArgs } from 'node:util';

const help = `Graph Canvas 2.0.0   •   Synthetic Git calendar simulator

  npm start                        Open the interactive wizard
  graph-canvas generate            Configure and preview a calendar
  graph-canvas generate --dry-run  Preview only (offline without --repo)
  graph-canvas status --repo URL   Inspect the latest local run
  graph-canvas resume --repo URL   Continue a saved run or retry its push

Generation options
  --repo URL                  Dedicated private GitHub repository
  --start YYYY-MM-DD          First local date (inclusive)
  --end YYYY-MM-DD            Last local date (inclusive)
  --timezone AREA/CITY        Defaults to the system timezone
  --total N   --seed N        Defaults to 1066 commits and seed 42
  --name NAME --email EMAIL   Identity for generated commits
  --clock ISO                 Reuse the clock printed by a dry run
  --yes --approve DIGEST      Approve the exact repository preview
Recovery options
  --yes                       Resume local generation
  --push                      Confirm push of a completed run
General
  --help   --version
Use "node index.js" in place of "graph-canvas" from a source checkout.`;

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Install Node.js 22 or newer.');
  const args = process.argv.slice(2);
  const command = args[0]?.startsWith('-') ? 'generate' : args.shift() ?? 'generate';
  const options = Object.fromEntries(
    ['repo','start','end','timezone','total','seed','clock','name','email','approve']
      .map(key => [key, { type: 'string' }]));
  for (const key of ['dry-run','yes','push','help','version']) options[key] = { type: 'boolean' };
  let values;
  try { ({ values } = parseArgs({ args, options })); }
  catch { throw Error('Invalid command options. Run node index.js --help for usage.'); }
  if (values.help) console.log(help);
  else if (values.version) console.log('2.0.0');
  else {
    if (!['generate','resume','status'].includes(command)) throw Error('Choose generate, resume, or status. See --help.');
    const allowed = command === 'status' ? ['repo'] : command === 'resume' ? ['repo','yes','push']
      : Object.keys(options).filter(key => key !== 'push');
    if (Object.keys(values).some(key => !allowed.includes(key))) throw Error('This option does not apply to the selected command. See --help.');
    if ((values['dry-run'] && (values.yes || values.approve)) || (values.push && values.yes))
      throw Error('Preview, local generation, and remote push are separate actions. Choose one.');
    const { launch } = await import('./src/wizard.js');
    await launch(command, values);
  }
} catch (error) {
  console.error('\nGraph Canvas — ' + (error.name === 'AbortError' ? 'Cancelled.' : error.message));
  process.exitCode = error.name === 'AbortError' ? 130 : 1;
}
