import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const managed = new WeakMap();
const sourceRepositories = ['thesamtom/graph-canvas', 'thesamtom/graph-canvas-pub'];
const redirects = /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|SHALLOW_FILE|REPLACE_REF_BASE)$/i;

export function parseRepositoryUrl(input) {
  const match = typeof input === 'string' && /^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9._-]{1,104})$/i.exec(input);
  const repo = match?.[3].replace(/\.git$/i, '');
  if (!repo || repo.length > 100 || /^\.+$/.test(repo) || /\s/.test(input)) {
    throw new Error('Enter a GitHub HTTPS or SSH repository URL without credentials, query parameters, or a trailing slash.');
  }
  const slug = `${match[2]}/${repo}`.toLowerCase();
  return { slug, url: match[1].toLowerCase().startsWith('https') ? `https://github.com/${slug}.git` : `git@github.com:${slug}.git` };
}

function environment(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (redirects.test(key)) throw new Error(`Unset ${key} before using the isolated Git workspace.`);
    if (!/^GIT_/i.test(key)) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (!/^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)$/.test(key)) throw new Error('Unsupported Git environment override.');
    env[key] = value;
  }
  return { ...env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' };
}

async function runGit(cwd, args, { env, allowFailure = false } = {}) {
  const childEnv = environment(env);
  try {
    const result = await exec('git', args, { cwd, env: childEnv, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    return result.stdout.trimEnd();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Git is required. Install Git and reopen your terminal.');
    if (allowFailure && Number.isInteger(error.code)) return '';
    if (/authentication failed|permission denied|could not read Username/i.test(error.stderr)) throw new Error('Git authentication failed. Check your credential manager or SSH key.');
    if (/repository .*not found/i.test(error.stderr)) throw new Error('Repository unavailable. Check its URL and your Git access.');
    if (args[0] === 'push') throw new Error('Git push failed. Check connectivity, branch protection, and remote changes. Local commits are preserved.');
    if (['ls-remote', 'clone', 'fetch'].includes(args[0])) throw new Error('Cannot reach the repository. Check network connectivity, credentials, and repository access.');
    throw new Error(`Git operation failed (${args[0]}). Check the target workspace and Git configuration.`);
  }
}

export async function checkEnvironment() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Graph Canvas requires Node.js 22 or newer.');
  return { node: process.version, git: await runGit(project, ['--version']) };
}

async function githubAccess({ slug }) {
  let result;
  try {
    result = await exec('gh', ['api', '--hostname', 'github.com', `repos/${slug}`, '--jq',
      '[.id, .full_name, .visibility, .permissions.push, .archived, .disabled] | @json'],
    { env: environment(), windowsHide: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Install GitHub CLI (gh) and run gh auth login to verify private visibility and write access.');
    throw new Error('GitHub could not verify repository access. Check the URL, your network, and gh auth status for github.com.');
  }
  const id = validateAccess(slug, JSON.parse(result.stdout));
  try {
    const { stdout } = await exec('gh', ['api', '--hostname', 'github.com', 'user', '--jq', '.login'], { env: environment(), windowsHide: true });
    const login = stdout.trim();
    if (!/^[a-z0-9-]+$/i.test(login)) throw new Error();
    return { id, login };
  } catch { throw new Error('GitHub could not verify the signed-in account. Check gh auth status for github.com.'); }
}

export function validateAccess(slug, [id, name, visibility, push, archived, disabled]) {
  if (name?.toLowerCase() !== slug || !Number.isSafeInteger(id)) throw new Error('GitHub returned a different repository. Enter its current URL.');
  if (visibility !== 'private') throw new Error('Private visibility is required. Create a dedicated private GitHub repository.');
  if (push !== true || archived || disabled) throw new Error('The authenticated GitHub account needs write access to an active repository.');
  return id;
}

async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function directoryAt(path) {
  if (!(await stat(path))?.isDirectory() || relative(path, await realpath(path))) {
    throw new Error('Workspace isolation check failed. Use a regular directory without symbolic links or junctions.');
  }
}

function owner(target) {
  if (!managed.has(target)) throw new Error('Select the repository through the Graph Canvas workspace.');
  return managed.get(target);
}

function sourceSlug(value) {
  try {
    if (value.startsWith('git@')) return parseRepositoryUrl(value).slug;
    const url = new URL(value);
    if (url.hostname.toLowerCase() === 'github.com') {
      return parseRepositoryUrl(`https://github.com${url.pathname.replace(/\/$/, '')}`).slug;
    }
  } catch { /* Local paths and other Git hosts do not name a GitHub repository. */ }
}

export function git(target, args, options) {
  owner(target);
  return runGit(target.directory, args, options);
}

async function authorizeTarget(target) {
  const info = owner(target);
  const result = await info.authorize(target);
  const id = result?.id ?? result;
  if (info.repositoryId && info.repositoryId !== id) throw new Error('The GitHub repository identity changed.');
  info.repositoryId = id;
  info.login = result?.login;
}

async function verifyTransport(target) {
  await git(target, ['ls-remote', '--', 'origin', 'HEAD']);
  if (await git(target, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFailure: true })) {
    const branch = await git(target, ['symbolic-ref', '--quiet', 'HEAD']);
    try {
      await git(target, ['push', '--dry-run', '--no-verify', '--no-follow-tags', '--recurse-submodules=no', 'origin', `HEAD:${branch}`]);
    } catch { throw new Error('Git could not verify write access with a dry-run push. Check Git credentials, connectivity, and whether the local branch is behind.'); }
  }
}

export async function verifyAccess(target) {
  await validateTarget(target);
  await authorizeTarget(target);
  await verifyTransport(target);
}

export async function validateTarget(target) {
  const { workspace, remote } = owner(target);
  await directoryAt(workspace);
  await directoryAt(target.directory);
  const gitdir = join(target.directory, '.git');
  await directoryAt(gitdir);
  for (const [flag, path] of [['--show-toplevel', target.directory], ['--absolute-git-dir', gitdir], ['--git-common-dir', gitdir]]) {
    const value = await git(target, ['rev-parse', '--path-format=absolute', flag]);
    if (relative(path, await realpath(value))) throw new Error('The selected Git worktree or Git directory is outside the isolated clone.');
  }
  for (const flags of [[], ['--push']]) {
    const value = await git(target, ['remote', 'get-url', ...flags, '--all', 'origin']);
    if (value !== remote) throw new Error('The target remote changed. Restore its original URL before continuing.');
  }
  if ((await git(target, ['config', '--bool', '--get', 'remote.origin.mirror'], { allowFailure: true })) === 'true') throw new Error('Mirror remotes cannot be used for generation.');
}

export async function detectIdentity(target) {
  return {
    name: await git(target, ['config', '--get', 'user.name'], { allowFailure: true }),
    email: await git(target, ['config', '--get', 'user.email'], { allowFailure: true }),
  };
}

export function createRepositoryManager({ sourceRoot = project, transport = parsed => parsed.url, authorize = githubAccess } = {}) {
  async function select(url, clone) {
    const parsed = parseRepositoryUrl(url);
    const root = await realpath(sourceRoot);
    const reserved = new Set(sourceRepositories);
    const remotes = await runGit(root, ['remote'], { allowFailure: true });
    for (const name of remotes.split(/\r?\n/).filter(Boolean)) {
      for (const flags of [[], ['--push']]) {
        const urls = await runGit(root, ['remote', 'get-url', ...flags, '--all', name]);
        for (const value of urls.split(/\r?\n/)) {
          const slug = sourceSlug(value);
          if (slug) reserved.add(slug);
        }
      }
    }
    if (reserved.has(parsed.slug)) throw new Error('Choose a separate private repository. The Graph Canvas source repository cannot be a target.');
    const remote = transport(parsed);
    const workspace = join(root, 'workspace');
    const key = createHash('sha256').update(parsed.slug).digest('hex').slice(0, 16);
    const directory = join(workspace, `repo-${key}`);
    const info = { workspace, remote, authorize };
    const target = Object.freeze({ ...parsed, directory, get repositoryId() { return info.repositoryId; }, get login() { return info.login; } });
    managed.set(target, info);
    if (clone) {
      await authorizeTarget(target);
      await mkdir(workspace, { recursive: true });
    } else if (!await stat(directory)) {
      throw new Error('No existing workspace for this repository. Run generate first.');
    }
    await directoryAt(workspace);
    if (clone && !await stat(directory)) {
      const effective = await runGit(workspace, ['ls-remote', '--get-url', '--', remote]);
      if (effective !== remote) throw new Error('Git URL rewriting changed the clone destination. Use an unmodified repository URL.');
      const temp = await mkdtemp(join(workspace, '.clone-'));
      try {
        await runGit(workspace, ['clone', '--no-hardlinks', '--no-recurse-submodules', '--', remote, temp]);
        await rename(temp, directory);
      } finally {
        if (resolve(temp).startsWith(resolve(workspace) + (process.platform === 'win32' ? '\\' : '/'))) await rm(temp, { force: true, recursive: true });
      }
    }
    await validateTarget(target);
    if (clone) await verifyTransport(target);
    return target;
  }
  return { prepareTarget: url => select(url, true), openTarget: url => select(url, false) };
}

export const { prepareTarget, openTarget } = createRepositoryManager();
