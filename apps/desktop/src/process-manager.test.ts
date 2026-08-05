/**
 * Tests for the desktop ProcessManager.
 *
 * Run with:
 *   npx ts-node --require source-map-support/register --test apps/desktop/src/process-manager.test.ts
 *   or: pnpm --filter @kairo/desktop test
 */

import * as assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { spawn, ChildProcess } from 'child_process';
import { ProcessManager, isPidAlive } from './process-manager';

// Helper: spawn a short-lived process that exits immediately.
function spawnShortLived(label: string): ChildProcess {
  const isWin = process.platform === 'win32';
  const proc = spawn(isWin ? 'cmd.exe' : 'sleep', isWin ? ['/c', 'exit 0'] : ['0.1'], {
    stdio: 'ignore',
  });
  return proc;
}

// Helper: spawn a long-running process that we can kill.
function spawnLongLived(label: string): ChildProcess {
  // Use Node itself — `timeout`/`sleep` via cmd.exe is unreliable on
  // locked-down Windows (exits 1 immediately; breaks isPidAlive waits).
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
}

describe('ProcessManager', () => {
  let pm: ProcessManager;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    pm = new ProcessManager((msg) => logs.push(msg));
  });

  afterEach(async () => {
    // Force-kill any remaining processes (sync handle kill first).
    const all = pm.getAll();
    for (const info of all) {
      if (info.process && !info.process.killed) {
        try { info.process.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  });

  describe('registration', () => {
    it('should register a spawned process', () => {
      const proc = spawnShortLived('test-register');
      pm.register('test', proc);

      const info = pm.get('test');
      assert.ok(info);
      assert.strictEqual(info?.label, 'test');
      assert.ok(info?.pid !== null);
      assert.strictEqual(info?.exitCode, null);
      assert.strictEqual(info?.shutdownRequested, false);
    });

    it('should track exit code when process exits', async () => {
      const proc = spawnShortLived('test-exit');
      pm.register('test-exit', proc);

      // Wait for the process to exit.
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
      });

      // Give the exit handler a moment to fire.
      await new Promise((r) => setTimeout(r, 100));

      const info = pm.get('test-exit');
      assert.ok(info);
      assert.strictEqual(info?.exitCode, 0);
    });

    it('should register a process by PID', () => {
      pm.registerByPid('test-pid', 12345);
      const info = pm.get('test-pid');
      assert.ok(info);
      assert.strictEqual(info?.pid, 12345);
      assert.strictEqual(info?.process, null);
    });

    it('should update PID when re-registering by PID', () => {
      pm.registerByPid('test-pid', 12345);
      pm.registerByPid('test-pid', 54321);
      const info = pm.get('test-pid');
      assert.strictEqual(info?.pid, 54321);
    });

    it('should unregister a process', () => {
      const proc = spawnShortLived('test-unreg');
      pm.register('test-unreg', proc);
      pm.unregister('test-unreg');
      assert.strictEqual(pm.get('test-unreg'), undefined);
    });
  });

  describe('getAll / getAllPids', () => {
    it('should return all tracked processes', () => {
      pm.registerByPid('a', 100);
      pm.registerByPid('b', 200);
      pm.registerByPid('c', 300);

      const all = pm.getAll();
      assert.strictEqual(all.length, 3);

      const pids = pm.getAllPids();
      assert.deepStrictEqual(pids.sort(), [100, 200, 300]);
    });
  });

  describe('zombie detection', () => {
    it('should not detect zombie for a process that was not asked to shut down', () => {
      const proc = spawnLongLived('test-no-zombie');
      pm.register('test-no-zombie', proc);
      assert.strictEqual(pm.isZombie('test-no-zombie'), false);

      // Cleanup.
      proc.kill('SIGKILL');
    });

    it('should detect zombie for a process that did not exit after shutdown', () => {
      const proc = spawnLongLived('test-zombie');
      pm.register('test-zombie', proc);

      // Mark as shutdown requested without actually killing.
      const info = pm.get('test-zombie');
      if (info) info.shutdownRequested = true;

      assert.strictEqual(pm.isZombie('test-zombie'), true);

      // Cleanup.
      proc.kill('SIGKILL');
    });

    it('should return empty array when no zombies', () => {
      const zombies = pm.getZombies();
      assert.strictEqual(zombies.length, 0);
    });
  });

  describe('shutdownOne', () => {
    it('should return success for an already-exited process', async () => {
      const proc = spawnShortLived('test-already-dead');
      pm.register('test-already-dead', proc);

      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
      });
      await new Promise((r) => setTimeout(r, 100));

      const result = await pm.shutdownOne('test-already-dead');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.wasZombie, false);
    });

    it('should return success for an unknown process', async () => {
      const result = await pm.shutdownOne('nonexistent');
      assert.strictEqual(result.success, true);
    });

    it('should kill a long-running process with SIGTERM escalation', { timeout: 15_000 }, async () => {
      const proc = spawnLongLived('test-kill');
      pm.register('test-kill', proc);

      const result = await pm.shutdownOne('test-kill', {
        termTimeoutMs: 2_000,
        killTimeoutMs: 3_000,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.wasZombie, false);
      assert.ok(result.exitCode !== null || result.exitSignal !== null);
    });

    it('should kill by PID when ChildProcess handle was cleared', { timeout: 15_000 }, async () => {
      const proc = spawnLongLived('test-pid-only');
      pm.register('test-pid-only', proc);
      const pid = proc.pid!;
      assert.ok(pid > 0);

      // Simulate main.ts nulling the ChildProcess ref before escalation.
      const info = pm.get('test-pid-only');
      assert.ok(info);
      info!.process = null;

      const result = await pm.shutdownOne('test-pid-only', {
        termTimeoutMs: 2_000,
        killTimeoutMs: 3_000,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(isPidAlive(pid), false);
    });

    it('should not let a previous process exit clobber a re-registered label', async () => {
      const first = spawnLongLived('test-rereg-1');
      pm.register('agent', first);
      const gen1 = pm.get('agent')!.generation;

      const second = spawnLongLived('test-rereg-2');
      pm.register('agent', second);
      const gen2 = pm.get('agent')!.generation;
      assert.notStrictEqual(gen1, gen2);
      assert.strictEqual(pm.get('agent')?.pid, second.pid);

      // Kill the first process; its exit must not mark the new registration exited.
      await new Promise<void>((resolve) => {
        first.on('exit', () => resolve());
        first.kill('SIGKILL');
      });
      await new Promise((r) => setTimeout(r, 100));

      const info = pm.get('agent');
      assert.ok(info);
      assert.strictEqual(info!.generation, gen2);
      assert.strictEqual(info!.pid, second.pid);
      // Still the live second process (exitCode uncleared).
      assert.strictEqual(info!.exitCode, null);
      assert.strictEqual(info!.process, second);

      second.kill('SIGKILL');
    });
  });

  describe('shutdownAll', () => {
    it('should shut down multiple processes in order', { timeout: 20_000 }, async () => {
      const proc1 = spawnLongLived('test-shutdown-1');
      const proc2 = spawnLongLived('test-shutdown-2');
      pm.register('agent', proc1);
      pm.register('theia', proc2);

      const results = await pm.shutdownAll({
        termTimeoutMs: 1_000,
        killTimeoutMs: 2_000,
      });

      assert.strictEqual(results.length, 2);
      // Theia should be shut down first (before agent in shutdown order).
      assert.strictEqual(results[0].label, 'theia');
      assert.strictEqual(results[1].label, 'agent');
      for (const r of results) {
        assert.strictEqual(r.success, true);
      }
    });
  });

  describe('getDiagnostics', () => {
    it('should return diagnostic string for tracked processes', () => {
      pm.registerByPid('agent', 100);
      pm.registerByPid('theia', 200);

      const diag = pm.getDiagnostics();
      assert.ok(diag.includes('agent'));
      assert.ok(diag.includes('theia'));
      assert.ok(diag.includes('pid=100'));
      assert.ok(diag.includes('pid=200'));
    });

    it('should mark zombie processes', () => {
      pm.registerByPid('agent', 100);
      const info = pm.get('agent');
      if (info) info.shutdownRequested = true;

      const diag = pm.getDiagnostics();
      // The registerByPid doesn't set a process, so isZombie checks
      // process !== null. Since registerByPid sets process: null,
      // it won't be flagged as zombie. Let's test with a real process.
      const proc = spawnLongLived('test-diag-zombie');
      pm.register('test-diag-zombie', proc);
      const info2 = pm.get('test-diag-zombie');
      if (info2) info2.shutdownRequested = true;

      const diag2 = pm.getDiagnostics();
      assert.ok(diag2.includes('[ZOMBIE]'));

      proc.kill('SIGKILL');
    });
  });
});

describe('isPidAlive', () => {
  it('should return true for the current process PID', () => {
    assert.strictEqual(isPidAlive(process.pid), true);
  });

  it('should return false for a non-existent PID', () => {
    // Use a PID that is very unlikely to exist.
    assert.strictEqual(isPidAlive(99999), false);
  });
});