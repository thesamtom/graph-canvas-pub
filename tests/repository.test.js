import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRepositoryManager, parseRepositoryUrl, validateAccess, validateTarget, verifyAccess, git } from '../src/repository.js';

const url = 'https://github.com/example/sandbox.git';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'canvas-target-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const sourceRoot = join(root, 'source');
  await mkdir(sourceRoot);
  const bare = join(root, 'target.git');
  execFileSync('git', ['init', '--quiet', '--bare', bare]);
  const manager = createRepositoryManager({ sourceRoot, transport: () => bare, authorize: async () => 123 });
  return { root, sourceRoot, bare, manager };
}

test('accepts GitHub HTTPS and SSH transports and rejects ambiguous or credential-bearing URLs', () => {
  for (const value of [url, 'git@github.com:Example/Sandbox', 'ssh://git@github.com/example/sandbox.git']) {
    assert.equal(parseRepositoryUrl(value).slug, 'example/sandbox');
  }
  for (const value of ['', 'sandbox', 'https://token@github.com/example/sandbox', 'https://other.com/example/sandbox',
    url + '?token=x', url + '#main', 'https://github.com/../foo', 'https://github.com/example/.git', url + '\n',
    'ssh://evil@github.com/example/sandbox', 'https://github.com/example/../../x']) {
    assert.throws(() => parseRepositoryUrl(value));
  }
});

test('requires verified private visibility, canonical identity and write permission', () => {
  const row = [123, 'Example/Sandbox', 'private', true, false, false];
  assert.equal(validateAccess('example/sandbox', row), 123);
  for (const [index, value] of [[0, null], [1, 'other/redirect'], [2, null], [2, 'public'], [2, 'internal'], [3, false], [4, true], [5, true]]) {
    assert.throws(() => validateAccess('example/sandbox', row.with(index, value)));
  }
});

test('reserves both Graph Canvas repositories and the current source fork', async t => {
  const { manager, sourceRoot } = await fixture(t);
  execFileSync('git', ['init', '--quiet', sourceRoot]);
  execFileSync('git', ['-C', sourceRoot, 'remote', 'add', 'origin', 'git@github.com:example/source-fork.git']);
  for (const repository of ['https://github.com/thesamtom/graph-canvas', 'git@github.com:thesamtom/graph-canvas-pub.git', 'https://github.com/example/source-fork']) {
    await assert.rejects(manager.prepareTarget(repository), /source repository/);
  }
});

test('isolates an empty clone, reopens it and rejects changed push or fetch destinations', async t => {
  const { manager, sourceRoot, bare } = await fixture(t);
  const target = await manager.prepareTarget(url);
  assert.equal(target.repositoryId, 123);
  assert.equal(dirname(target.directory), await realpath(join(sourceRoot, 'workspace')));
  await verifyAccess(target);
  assert.equal((await manager.openTarget(url)).directory, target.directory);
  for (const key of ['remote.origin.pushurl', 'remote.origin.url']) {
    await git(target, ['config', key, bare + '-other']);
    await assert.rejects(validateTarget(target), /remote changed/);
    await git(target, ['config', '--unset', key]);
  }
});

test('refuses a workspace junction before cloning', async t => {
  const { manager, root, sourceRoot } = await fixture(t);
  const external = join(root, 'external');
  await mkdir(external);
  await symlink(external, join(sourceRoot, 'workspace'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(manager.prepareTarget(url), /isolation/);
});

test('write access preflight for a branch with commits leaves the bare remote empty', async t => {
  const { manager, bare } = await fixture(t);
  const target = await manager.prepareTarget(url);
  await git(target, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Fixture']);
  await verifyAccess(target);
  assert.equal(execFileSync('git', ['--git-dir', bare, 'for-each-ref'], { encoding: 'utf8' }), '');
});

test('denied GitHub access stops target preparation before checkout', async t => {
  const { sourceRoot, bare } = await fixture(t);
  const manager = createRepositoryManager({ sourceRoot, transport: () => bare, authorize: async () => { throw new Error('Private visibility unverified'); } });
  await assert.rejects(manager.prepareTarget(url), /visibility/);
  await assert.rejects(manager.openTarget(url), /No existing workspace/);
});
