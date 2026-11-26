import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRepositoryManager, git } from '../src/repository.js';
import { approve, execute, loadRun, pushRun, snapshot } from '../commits.js';
import { LEDGER, STATE } from '../src/storage.js';

const config = {startDate:'2024-01-01',endDate:'2024-01-01',timezone:'UTC',total:3,seed:41,now:Date.parse('2024-02-01T00:00Z')};
const identity = {name:'Calendar Fixture',email:'calendar@example.invalid'};
const schedule = [1,2,3].map(i => ({dateTime:'2024-01-01T09:00:0' + i + '.000Z',message:'chore: generate synthetic calendar entry'}));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'graph-canvas-test-'));
  const remote = join(root,'remote.git');
  t.after(async () => {
    assert.equal(dirname(resolve(root)),resolve(tmpdir()));
    assert.ok(basename(root).startsWith('graph-canvas-test-'));
    await rm(root,{force:true,recursive:true,maxRetries:4,retryDelay:100});
  });
  execFileSync('git',['init','--quiet','--bare','--initial-branch=main',remote]);
  const manager = createRepositoryManager({sourceRoot:root,transport:()=>remote,authorize:async()=>1234});
  const target = await manager.prepareTarget('https://github.com/example/calendar.git');
  return {target,remote,approve:async()=>approve(target,await snapshot(target),config,identity,schedule)};
}

test('interruption, resume, failed push and retry preserve exact local and remote history', async t => {
  const f = await fixture(t);
  const {target,remote} = f;
  const plan = await f.approve();
  const controller = new AbortController();
  await assert.rejects(execute(target,plan,{signal:controller.signal,onProgress(){ controller.abort(); }}),/interrupted/);
  assert.equal((await loadRun(target)).completed,1);
  assert.equal((await loadRun(target)).status,'interrupted');
  await assert.rejects(f.approve(),/saved run/);
  const local = await execute(target,plan);
  assert.equal(local.status,'completed-locally');
  assert.equal(await git(target,['rev-list','--count','HEAD']),'3');
  assert.equal((await snapshot(target)).entries.length,3);
  assert.equal(await git(target,['ls-remote','--heads','origin']),'');
  execFileSync('git',['--git-dir',remote,'config','receive.denyCurrentBranch','refuse']);
  execFileSync('git',['--git-dir',remote,'config','core.bare','false']);
  await assert.rejects(pushRun(target,local),/Push failed/);
  assert.equal((await loadRun(target)).status,'completed-locally');
  execFileSync('git',['--git-dir',remote,'config','core.bare','true']);
  assert.equal((await pushRun(target,local)).status,'pushed');
  assert.equal((await pushRun(target,local)).status,'pushed');
  await assert.rejects(f.approve(),/Duplicate run/);
});

test('partial commit failure cleans pending writes and resumes',async t=>{
  const f = await fixture(t);
  const plan = await f.approve();
  const lock = join(f.target.directory,'.git','index.lock');
  await assert.rejects(execute(f.target,plan,{onProgress: n=>{
    if(n === 1) writeFileSync(lock,'');
  }}),/recover|failed/i);
  await rm(lock);
  assert.equal((await loadRun(f.target)).completed,1);
  assert.equal((await execute(f.target,plan)).completed,3);
});

test('saved plan, branch, clean staging, ledger and lock validations',async t=>{
  const f = await fixture(t);
  const {target} = f;
  await writeFile(join(target.directory,LEDGER),'{}');
  await assert.rejects(snapshot(target),/ledger/);
  await rm(join(target.directory,LEDGER));
  const other = join(target.directory,'other.txt');
  await writeFile(other,'unrelated');
  await git(target,['add','other.txt']);
  await assert.rejects(snapshot(target),/staging/);
  await git(target,['rm','--cached','other.txt']);
  const plan = await f.approve();
  const lock = join(target.directory,'.git','graph-canvas.lock');
  await writeFile(lock,'100');
  await assert.rejects(execute(target,plan),/lock/);
  await rm(lock);
  await git(target,['symbolic-ref','HEAD','refs/heads/changed']);
  await assert.rejects(execute(target,plan),/branch/);
  await git(target,['symbolic-ref','HEAD','refs/heads/main']);
  const path = join(target.directory,'.git',STATE);
  const saved = JSON.parse(await readFile(path,'utf8'));
  saved.config.total++;
  await writeFile(path,JSON.stringify(saved));
  await assert.rejects(loadRun(target),/validation/);
  assert.equal(await readFile(other,'utf8'),'unrelated');
});

test('legacy history recognition ignores unrelated JSON and requires a single changed path',async t=>{
  const {target} = await fixture(t);
  const path = join(target.directory,'data.json');
  const env = {};
  for (const role of ['AUTHOR','COMMITTER']) {
    env['GIT_' + role + '_NAME'] = identity.name;
    env['GIT_' + role + '_EMAIL'] = identity.email;
  }
  for (const [index,item] of schedule.entries()) {
    env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = item.dateTime;
    await writeFile(path,JSON.stringify(schedule.slice(0,index+1).map(s=>s.dateTime)));
    await git(target,['add','data.json']);
    if (index === 2) {
      await writeFile(join(target.directory,'unrelated.txt'),'application work');
      await git(target,['add','unrelated.txt']);
    }
    await git(target,['commit','-m','cleanup'],{env});
    const current = await snapshot(target);
    assert.equal(current.legacyCount,index === 2 ? 0 : index+1);
  }
});

test('resume recovers a commit made immediately before the progress checkpoint',async t=>{
  const f = await fixture(t);
  const plan = await f.approve();
  const path = join(f.target.directory,'.git',STATE);
  const controller = new AbortController();
  const stale = structuredClone(plan);
  stale.pending = true;
  stale.status = 'in-progress';
  await assert.rejects(execute(f.target,plan,{signal:controller.signal,onProgress(){ controller.abort(); }}),/interrupted/);
  await writeFile(path,JSON.stringify(stale));
  assert.equal((await execute(f.target,plan)).completed,3);
  assert.equal(await git(f.target,['rev-list','--count','HEAD']),'3');
});

test('existing application files survive generation and remote divergence blocks push', async t => {
  const {target, remote} = await fixture(t);
  const app = join(target.directory,'data.json');
  await writeFile(app,'{"application":true}\n');
  const args = ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m'];
  await git(target,['add','data.json']);
  await git(target,[...args,'initialize application data']);
  await git(target,['push','origin','HEAD:refs/heads/main']);
  const preview = await snapshot(target);
  assert.deepEqual(preview.entries,[]);
  const run = await approve(target,preview,config,identity,schedule);
  await execute(target,run);
  assert.equal(await readFile(app,'utf8'),'{"application":true}\n');
  // Simulate deletion of the remote branch by an administrator.
  execFileSync('git',['--git-dir',remote,'update-ref','-d','refs/heads/main']);
  await assert.rejects(pushRun(target,run),/Remote branch changed/);
  assert.equal((await loadRun(target)).status,'completed-locally');
  await git(target,[...args,'unrelated local commit','--allow-empty']);
  await assert.rejects(pushRun(target,run),/history/);
});
