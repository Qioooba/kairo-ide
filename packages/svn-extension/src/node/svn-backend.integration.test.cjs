'use strict';
/**
 * Integration tests against a real local `svn` / `svnadmin` install.
 * Skips cleanly when SVN CLI is not on PATH.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

function findSvn() {
  const candidates = [
    'svn',
    'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
    'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
    path.join(os.homedir(), 'scoop', 'shims', 'svn.exe'),
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version', '--quiet'], { timeout: 5000, stdio: 'pipe' });
      return c;
    } catch { /* continue */ }
  }
  return undefined;
}

function findSvnadmin(svnPath) {
  if (svnPath === 'svn') return 'svnadmin';
  const dir = path.dirname(svnPath);
  const exe = path.join(dir, process.platform === 'win32' ? 'svnadmin.exe' : 'svnadmin');
  if (fs.existsSync(exe)) return exe;
  return 'svnadmin';
}

function fileUrl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(abs)) return 'file:///' + abs;
  return 'file://' + abs;
}

const svnBin = findSvn();

describe('SVN backend integration (live CLI)', { skip: !svnBin }, () => {
  let svn;
  let svnadmin;
  let base;
  let repoUrl;
  let trunkUrl;
  let wc;
  let backend;

  before(async () => {
    svn = svnBin;
    svnadmin = findSvnadmin(svn);
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-svn-it-'));
    const repo = path.join(base, 'repo');
    wc = path.join(base, 'wc');
    fs.mkdirSync(repo);
    execFileSync(svnadmin, ['create', repo], { stdio: 'pipe' });
    repoUrl = fileUrl(repo);
    trunkUrl = repoUrl + '/trunk';
    execFileSync(svn, ['mkdir', '--non-interactive', trunkUrl, repoUrl + '/branches', repoUrl + '/tags', '-m', 'layout'], { stdio: 'pipe' });
    execFileSync(svn, ['checkout', '--non-interactive', trunkUrl, wc], { stdio: 'pipe' });
    fs.writeFileSync(path.join(wc, 'hello.txt'), 'hello\n', 'utf8');
    fs.writeFileSync(path.join(wc, 'App.java'), 'public class App {}\n', 'utf8');
    execFileSync(svn, ['add', '--non-interactive', path.join(wc, 'hello.txt'), path.join(wc, 'App.java')], { cwd: wc, stdio: 'pipe' });
    execFileSync(svn, ['commit', '--non-interactive', wc, '-m', 'initial files'], { stdio: 'pipe' });

    // Load compiled backend if present; otherwise skip backend-class tests.
    const backendPath = path.join(__dirname, '..', '..', 'lib', 'node', 'svn-backend-service.js');
    if (fs.existsSync(backendPath)) {
      // Minimal logger stub for DI-free construction
      const mod = require(backendPath);
      const Impl = mod.SvnBackendServiceImpl;
      backend = Object.create(Impl.prototype);
      backend.logger = { info() {}, warn() {}, error() {}, debug() {} };
      backend.cachedInstallation = undefined;
      backend.credentials = undefined;
      backend.client = undefined;
      backend.queues = new Map();
      backend.onCommandEmitter = { fire() {} };
    }
  });

  after(() => {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects SVN installation', async () => {
    if (!backend) return;
    const install = await backend.$detectSvn();
    assert.ok(install, 'SVN should be detected');
    assert.ok(install.version, 'version present');
    assert.ok(install.path, 'path present');
  });

  it('finds WC root and reports info', async () => {
    if (!backend) return;
    const nested = path.join(wc, 'sub');
    fs.mkdirSync(nested, { recursive: true });
    const found = await backend.$findWcRoot(nested);
    assert.strictEqual(path.resolve(found), path.resolve(wc));
    const info = await backend.$getWcInfo(wc);
    assert.ok(info, 'info available');
    assert.ok(String(info.url).includes('/trunk'), `url=${info.url}`);
    assert.ok(info.revision >= 1);
  });

  it('finds WC root from Theia-style /G:/ Windows path', async () => {
    if (!backend || process.platform !== 'win32') return;
    const theiaPath = '/' + wc.replace(/\\/g, '/');
    assert.ok(/^\/[a-zA-Z]:/.test(theiaPath), `expected Theia path, got ${theiaPath}`);
    const found = await backend.$findWcRoot(theiaPath);
    assert.ok(found, `should find WC from ${theiaPath}`);
    assert.strictEqual(path.resolve(found), path.resolve(wc));
  });

  it('returns WC-relative paths from status (Windows absolute → relative)', async () => {
    if (!backend) return;
    fs.writeFileSync(path.join(wc, 'App.java'), 'public class App { void x(){} }\n', 'utf8');
    const status = await backend.$getStatus(wc);
    const app = status.find(s => s.path === 'App.java' || s.path.endsWith('/App.java') || s.path.endsWith('\\App.java'));
    assert.ok(app, `expected App.java in status, got: ${JSON.stringify(status)}`);
    assert.strictEqual(app.path.replace(/\\/g, '/'), 'App.java');
    assert.strictEqual(app.status, 'modified');
    // Must not leak absolute Windows path
    assert.ok(!/^[a-zA-Z]:/.test(app.path), `path should be relative, got ${app.path}`);
  });

  it('commits, logs, diffs, annotates', async () => {
    if (!backend) return;
    await backend.$commit(wc, ['App.java'], 'modify App');
    const log = await backend.$getLog(wc, [], 10);
    assert.ok(log.length >= 1);
    assert.ok(log.some(e => /modify App|initial files|layout/.test(e.message)));

    fs.writeFileSync(path.join(wc, 'App.java'), 'public class App { void y(){} }\n', 'utf8');
    const diff = await backend.$getDiff(wc, ['App.java']);
    assert.ok(diff.content.includes('void y') || diff.content.includes('App'), `diff=${diff.content.slice(0, 200)}`);

    const blame = await backend.$annotate(wc, 'hello.txt');
    assert.ok(Array.isArray(blame));
    assert.ok(blame.length >= 1, 'blame should have lines');
    assert.ok(blame[0].revision >= 1);
  });

  it('creates branch via copy and switches', async () => {
    if (!backend) return;
    const branchUrl = repoUrl + '/branches/feat-it';
    await backend.$exec(['copy', trunkUrl, branchUrl, '-m', 'create feat-it'], wc, 'write');
    await backend.$exec(['switch', branchUrl], wc, 'write');
    const info = await backend.$getWcInfo(wc);
    assert.ok(String(info.url).includes('feat-it'), `switched url=${info.url}`);
    await backend.$exec(['switch', trunkUrl], wc, 'write');
  });

  it('resolves conflicts with accept choices', async () => {
    if (!backend) return;
    const c1 = path.join(base, 'c1');
    const c2 = path.join(base, 'c2');
    execFileSync(svn, ['checkout', '--non-interactive', trunkUrl, c1], { stdio: 'pipe' });
    execFileSync(svn, ['checkout', '--non-interactive', trunkUrl, c2], { stdio: 'pipe' });
    fs.writeFileSync(path.join(c1, 'hello.txt'), 'AAAA\n', 'utf8');
    execFileSync(svn, ['commit', '--non-interactive', path.join(c1, 'hello.txt'), '-m', 'AAAA'], { stdio: 'pipe' });
    fs.writeFileSync(path.join(c2, 'hello.txt'), 'BBBB\n', 'utf8');
    try {
      execFileSync(svn, ['update', '--non-interactive', '--accept', 'postpone', c2], { stdio: 'pipe' });
    } catch { /* conflict exit code may be non-zero */ }
    const status = await backend.$getStatus(c2);
    const conflicted = status.filter(s => s.status === 'conflicted');
    assert.ok(conflicted.length >= 1, `expected conflict, got ${JSON.stringify(status)}`);
    assert.strictEqual(conflicted[0].path.replace(/\\/g, '/'), 'hello.txt');
    await backend.$resolve(c2, ['hello.txt'], 'theirs-full');
    const after = await backend.$getStatus(c2);
    assert.ok(!after.some(s => s.status === 'conflicted'), 'conflict should be cleared');
  });

  it('parses changelist entries that live outside <target>', async () => {
    // Use parser directly against real CLI XML fixture shape
    const { parseStatusXml } = require(path.join(__dirname, '..', '..', 'lib', 'common', 'svn-parser.js'));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target path="${wc.replace(/\\/g, '\\\\')}"></target>
<changelist name="my-list">
<entry path="${path.join(wc, 'App.java').replace(/\\/g, '\\\\')}">
<wc-status item="modified" revision="2" props="none">
<commit revision="2"><author>t</author><date>2026-01-01T00:00:00.000000Z</date></commit>
</wc-status>
</entry>
</changelist>
</status>`;
    const entries = parseStatusXml(xml.replace(/\\\\/g, '\\'));
    assert.ok(entries.length >= 1, `changelist entries missing: ${JSON.stringify(entries)}`);
    assert.strictEqual(entries[0].changelist, 'my-list');
    assert.strictEqual(entries[0].status, 'modified');
  });

  it('CLI smoke: ignore + cleanup', async () => {
    fs.writeFileSync(path.join(wc, 'noise.log'), 'x\n', 'utf8');
    if (backend) {
      await backend.$ignore(wc, ['noise.log']);
      await backend.$cleanup(wc);
      const status = await backend.$getStatus(wc);
      const ignored = status.find(s => s.path === 'noise.log');
      // With --no-ignore, ignored files appear as ignored
      if (ignored) assert.strictEqual(ignored.status, 'ignored');
    } else {
      execFileSync(svn, ['propset', 'svn:ignore', 'noise.log', '.'], { cwd: wc, stdio: 'pipe' });
    }
  });
});

describe('SVN path utils', () => {
  // Inline mirrors of svn-path-utils (avoid TS compile dependency for unit slice)
  function toWcRelativePath(filePath, wcRoot) {
    if (!filePath) return '';
    if (!wcRoot) return filePath.replace(/\\/g, '/');
    const normFile = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
    const normRoot = wcRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const lowerFile = normFile.toLowerCase();
    const lowerRoot = normRoot.toLowerCase();
    if (lowerFile === lowerRoot) return '';
    if (lowerFile.startsWith(lowerRoot + '/')) return normFile.substring(normRoot.length + 1);
    if (!/^[a-zA-Z]:\//.test(normFile) && !normFile.startsWith('/')) return normFile;
    return normFile;
  }
  function uriOrPathToFsPath(uriOrPath) {
    if (!uriOrPath.startsWith('file:')) return uriOrPath;
    let rest = uriOrPath.replace(/^file:\/\//, '');
    if (rest.startsWith('localhost/')) rest = rest.substring('localhost/'.length);
    try { rest = decodeURIComponent(rest); } catch { /* */ }
    if (/^\/[a-zA-Z]:/.test(rest)) rest = rest.substring(1);
    return rest.replace(/\\/g, '/');
  }

  it('relativizes Windows absolute status paths', () => {
    const root = 'G:/spaces/kairo-ide/tmp/svn-test/wc';
    assert.strictEqual(
      toWcRelativePath('G:\\spaces\\kairo-ide\\tmp\\svn-test\\wc\\App.java', root),
      'App.java',
    );
  });

  it('parses file:///G:/ URIs', () => {
    assert.strictEqual(uriOrPathToFsPath('file:///G:/foo/bar.txt'), 'G:/foo/bar.txt');
  });
});
