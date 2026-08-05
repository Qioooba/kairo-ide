/**
 * Thin main-path lifecycle tests (no Electron).
 *
 * Run with:
 *   pnpm --filter @kairo/desktop test
 */

import * as assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ChildLifecycle,
  commandLineLooksLikeKairoRuntime,
  readAgentStatePid,
  shouldKillReusedAgent,
  verifyKairoRuntimePid,
} from './child-lifecycle';
import { isPidAlive, killProcessTree } from './process-manager';

function spawnLongLived(): ChildProcess {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
}

async function waitAlive(pid: number, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPidAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`PID ${pid} never became alive`);
}

describe('ChildLifecycle helpers', () => {
  it('shouldKillReusedAgent defaults true; KAIRO_KEEP_REUSED_AGENT=1 opts out', () => {
    assert.strictEqual(shouldKillReusedAgent({}), true);
    assert.strictEqual(shouldKillReusedAgent({ KAIRO_KEEP_REUSED_AGENT: '0' }), true);
    assert.strictEqual(shouldKillReusedAgent({ KAIRO_KEEP_REUSED_AGENT: '1' }), false);
  });

  it('commandLineLooksLikeKairoRuntime matches binary name', () => {
    assert.strictEqual(
      commandLineLooksLikeKairoRuntime('C:\\app\\kairo-runtime.exe --port 0'),
      true,
    );
    assert.strictEqual(commandLineLooksLikeKairoRuntime('/usr/bin/node -e idle'), false);
  });

  it('readAgentStatePid parses agent-state.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-agent-state-'));
    const statePath = path.join(dir, 'agent-state.json');
    fs.writeFileSync(statePath, JSON.stringify({ port: 1, pid: 99991 }), 'utf8');
    try {
      assert.strictEqual(readAgentStatePid(statePath), 99991);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifyKairoRuntimePid refuses unknown cmdline', () => {
    const result = verifyKairoRuntimePid(1, () => 'C:\\Windows\\System32\\notepad.exe');
    assert.strictEqual(result.ok, false);
  });

  it('verifyKairoRuntimePid accepts kairo-runtime cmdline', () => {
    const result = verifyKairoRuntimePid(42, () => '/opt/kairo/kairo-runtime --bind 127.0.0.1');
    assert.strictEqual(result.ok, true);
  });
});

describe('ChildLifecycle', () => {
  let life: ChildLifecycle;
  let prevKeepEnv: string | undefined;

  beforeEach(() => {
    life = new ChildLifecycle();
    prevKeepEnv = process.env.KAIRO_KEEP_REUSED_AGENT;
    delete process.env.KAIRO_KEEP_REUSED_AGENT;
  });

  afterEach(async () => {
    if (prevKeepEnv === undefined) {
      delete process.env.KAIRO_KEEP_REUSED_AGENT;
    } else {
      process.env.KAIRO_KEEP_REUSED_AGENT = prevKeepEnv;
    }
    // Sync kill only — avoid fire-and-forget taskkill racing the next test's PIDs.
    for (const info of life.manager.getAll()) {
      if (info.process && !info.process.killed) {
        try { info.process.kill('SIGKILL'); } catch { /* ignore */ }
      }
      if (info.pid !== null && isPidAlive(info.pid)) {
        try { killProcessTree(info.pid, 'SIGKILL'); } catch { /* ignore */ }
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  });

  it('stops a reused agent by default (agentStartedByUs=false)', {
    timeout: 15_000,
  }, async () => {
    const proc = spawnLongLived();
    life.register('agent', proc);
    life.agentStartedByUs = false;
    life.readCmdline = () => 'G:\\spaces\\kairo-ide\\dist\\kairo-runtime.exe --port 0';
    await waitAlive(proc.pid!);

    const result = await life.stopAgent({
      termTimeoutMs: 2_000,
      killTimeoutMs: 3_000,
    });
    assert.ok(result);
    assert.strictEqual(result!.success, true);
    assert.strictEqual(isPidAlive(proc.pid!), false);
  });

  it('leaves a reused agent running when KAIRO_KEEP_REUSED_AGENT=1', async () => {
    process.env.KAIRO_KEEP_REUSED_AGENT = '1';
    const proc = spawnLongLived();
    life.register('agent', proc);
    life.agentStartedByUs = false;
    await waitAlive(proc.pid!);

    const result = await life.stopAgent({ termTimeoutMs: 500, killTimeoutMs: 500 });
    assert.strictEqual(result, null);
    assert.strictEqual(isPidAlive(proc.pid!), true);
  });

  it('refuses reused-agent kill when cmdline is not kairo-runtime', {
    timeout: 15_000,
  }, async () => {
    const proc = spawnLongLived();
    life.register('agent', proc);
    life.agentStartedByUs = false;
    life.readCmdline = () => 'C:\\Windows\\System32\\notepad.exe';
    await waitAlive(proc.pid!);

    const result = await life.stopAgent({
      termTimeoutMs: 500,
      killTimeoutMs: 500,
    });
    assert.strictEqual(result, null);
    assert.strictEqual(isPidAlive(proc.pid!), true);
  });

  it('stops an agent we started', { timeout: 15_000 }, async () => {
    const proc = spawnLongLived();
    life.register('agent', proc);
    life.agentStartedByUs = true;
    await waitAlive(proc.pid!);

    const result = await life.stopAgent({
      termTimeoutMs: 2_000,
      killTimeoutMs: 3_000,
    });
    assert.ok(result);
    assert.strictEqual(result!.success, true);
    assert.strictEqual(result!.wasZombie, false);
  });

  it('stopOwned stops reused agent by default', { timeout: 15_000 }, async () => {
    const theia = spawnLongLived();
    const agent = spawnLongLived();
    life.register('theia', theia);
    life.register('agent', agent);
    life.agentStartedByUs = false;
    life.readCmdline = () => 'G:\\spaces\\kairo-ide\\dist\\kairo-runtime.exe --port 0';
    const agentPid = agent.pid!;
    await waitAlive(theia.pid!);
    await waitAlive(agentPid);

    const results = await life.stopOwned({
      termTimeoutMs: 1_000,
      killTimeoutMs: 2_000,
    });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].label, 'theia');
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[1].label, 'agent');
    assert.strictEqual(results[1].success, true);
    assert.strictEqual(isPidAlive(agentPid), false);
  });

  it('forceKillOwnedSync kills by PID even after ChildProcess ref cleared', async () => {
    const theia = spawnLongLived();
    life.register('theia', theia);
    const pid = theia.pid!;
    await waitAlive(pid);

    // Simulate main.ts crash path: null the handle but keep PID in registry.
    const info = life.manager.get('theia');
    assert.ok(info);
    info!.process = null;

    life.forceKillOwnedSync();
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(isPidAlive(pid), false);
  });

  it('forceKillOwnedSync kills reused agent by default', async () => {
    const agent = spawnLongLived();
    life.register('agent', agent);
    life.agentStartedByUs = false;
    life.readCmdline = () => 'G:\\spaces\\kairo-ide\\dist\\kairo-runtime.exe --port 0';
    const pid = agent.pid!;
    await waitAlive(pid);

    life.forceKillOwnedSync();
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(isPidAlive(pid), false);
  });
});
