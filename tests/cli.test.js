import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch } from '../src/wizard.js';
import { createRepositoryManager } from '../src/repository.js';

test('CLI metadata, offline preview and invalid option handling', () => {
  function cli(...args) { return spawnSync(process.execPath, ['index.js', ...args], {encoding:'utf8'}); }
  assert.equal(cli('--version').stdout.trim(), '2.0.0');
  assert.match(cli('--help').stdout, /resume/);
  assert.match(cli('generate','--dry-run','--start','2024-02-29','--end','2024-02-29','--total','1').stdout, /New commits\s+1/);
  assert.equal(cli('generate','--dry-run','--yes').status, 1);
  assert.equal(cli('generate','--push').status, 1);
  assert.equal(cli('generate','--yes').status, 1);
});

test('repository preview approval, local completion, status and separately confirmed push', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-cli-test-'));
  t.after(() => rm(root, {recursive:true, force:true, maxRetries:4, retryDelay:100}));
  const remote = join(root, 'private.git');
  const refs = () => execFileSync('git',['--git-dir',remote,'for-each-ref','--format=%(refname)'],{encoding:'utf8'}).trim();
  execFileSync('git',['init','--bare','--quiet','--initial-branch=main',remote]);
  const manager = createRepositoryManager({sourceRoot:root, transport:() => remote, authorize:async () => 491});
  const adapter = { selectNew:manager.prepareTarget, selectExisting:manager.openTarget };
  const options = {repo:'https://github.com/example/demo', start:'2024-02-29', end:'2024-02-29',
    timezone:'UTC', total:'2', name:'Calendar Test', email:'test@example.invalid', clock:'2024-03-01T00:00:00Z'};
  const lines = [];
  t.mock.method(console, 'log', (...values) => lines.push(values.join(' ')));
  await launch('generate',{...options,'dry-run':true},adapter);
  const token = /--approve ([0-9a-f]{64})/.exec(lines.join('\n'))?.[1];
  assert.ok(token);
  assert.equal(refs(),'');
  await assert.rejects(launch('generate',{...options,yes:true,approve:'stale'},adapter),/does not match/);
  await launch('generate',{...options,yes:true,approve:token},adapter);
  assert.equal(refs(),'');
  await launch('status',{repo:options.repo},adapter);
  assert.match(lines.join('\n'),/completed-locally/);
  await launch('resume',{repo:options.repo,push:true},adapter);
  assert.equal(refs(),'refs/heads/main');
  assert.match(lines.join('\n'),/Pushed/);
});
