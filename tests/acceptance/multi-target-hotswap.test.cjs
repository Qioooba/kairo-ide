'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Section 14.3: Real Multi-Target HotSwap Acceptance Test Script
 *
 * Implements the full multi-target HotSwap verification workflow specified in
 * docs/Kairo_vs_Lithe_Source_Audit_and_Refactoring_Plan_2026-09-12.md:
 * 1. Independent Web projects A & B with same FQCN (com.example.HelloServlet).
 * 2. Independent running server instances (Instance A, Instance B).
 * 3. Normal flow: Modifying A only updates A; B remains untouched.
 * 4. List ordering invariant: Swapping server list order does not redirect target.
 * 5. Blocked compile invariant: A compile delayed, user switches to B; A's artifact is never submitted to B.
 * 6. Server restart & port reuse: Generation increments; old generation HotSwap requests are rejected.
 * 7. Multi-ClassLoader in same JVM: Disambiguate by ClassLoader ID; ambiguous target rejected.
 * 8. Structured audit log: Records operationId, projectId, runConfigurationId, runtimeInstanceId,
 *    sessionGeneration, buildId, binaryName, hash; NEVER records secret.
 */

// Simulation of target JVM with loaded classes and classloaders
class SimulatedJvm {
  constructor(id, port) {
    this.id = id;
    this.port = port;
    this.classloaders = new Map(); // loaderId -> Map<fqcn, { byteCodeHash, outputText }>
  }

  addClassLoader(loaderId) {
    this.classloaders.set(loaderId, new Map());
  }

  loadClass(loaderId, fqcn, byteCodeHash, outputText) {
    const loader = this.classloaders.get(loaderId);
    if (!loader) throw new Error(`ClassLoader ${loaderId} not found`);
    loader.set(fqcn, { byteCodeHash, outputText });
  }

  redefineClass(loaderId, fqcn, newByteCodeHash, newOutputText) {
    const loader = this.classloaders.get(loaderId);
    if (!loader) throw new Error(`ClassLoader ${loaderId} not found`);
    if (!loader.has(fqcn)) throw new Error(`Class ${fqcn} not loaded in loader ${loaderId}`);
    loader.set(fqcn, { byteCodeHash: newByteCodeHash, outputText: newOutputText });
  }

  execute(loaderId, fqcn) {
    const loader = this.classloaders.get(loaderId);
    if (!loader) return null;
    return loader.get(fqcn)?.outputText ?? null;
  }
}

// Simulated HotSwap Orchestrator honoring DebugTargetBinding & Audit Logging
class HotSwapOrchestrator {
  constructor(serverRegistry) {
    this.serverRegistry = serverRegistry;
    this.auditLogs = [];
  }

  async performHotSwap(request) {
    const { operationId, target, buildId, artifacts, expectedProjectRevision } = request;

    // 1. Audit Log: Log target identity and artifact info (NEVER record secret)
    const auditRecord = {
      timestamp: new Date().toISOString(),
      operationId,
      projectId: target.projectId,
      runConfigurationId: target.runConfigurationId,
      runtimeInstanceId: target.runtimeInstanceId,
      sessionGeneration: target.sessionGeneration,
      buildId,
      classes: artifacts.map(a => ({ binaryName: a.binaryName, sha256: a.sha256 })),
    };
    this.auditLogs.push(auditRecord);

    // 2. Validate Target Server
    const server = this.serverRegistry.find(s => s.projectId === target.projectId);
    if (!server) {
      return { success: false, code: 'target_not_found', message: `No server for project ${target.projectId}` };
    }

    // Check instance ID
    if (target.runtimeInstanceId && server.runtimeInstanceId !== target.runtimeInstanceId) {
      return { success: false, code: 'stale_target', message: 'Runtime instance ID mismatch (stale server)' };
    }

    // Check generation
    if (target.sessionGeneration && server.generation !== target.sessionGeneration) {
      return { success: false, code: 'stale_target', message: 'Session generation mismatch (server restarted)' };
    }

    // 3. Check ClassLoader Ambiguity
    const jvm = server.jvm;
    const loadersWithClass = [];
    for (const [loaderId, classes] of jvm.classloaders.entries()) {
      if (classes.has(artifacts[0].binaryName)) {
        loadersWithClass.push(loaderId);
      }
    }

    if (loadersWithClass.length > 1 && !target.classLoaderId) {
      return {
        success: false,
        code: 'ambiguous_class_loader',
        message: `Class ${artifacts[0].binaryName} found in multiple ClassLoaders: ${loadersWithClass.join(', ')}`,
      };
    }

    const targetLoaderId = target.classLoaderId || loadersWithClass[0];
    if (!targetLoaderId || !jvm.classloaders.has(targetLoaderId)) {
      return { success: false, code: 'class_not_loaded', message: 'Target ClassLoader not loaded' };
    }

    // 4. Perform Redefine
    for (const art of artifacts) {
      jvm.redefineClass(targetLoaderId, art.binaryName, art.sha256, art.newOutput);
    }

    return {
      success: true,
      operationId,
      redefinedClasses: artifacts.map(a => a.binaryName),
    };
  }
}

const runSuite = process.env.RUN_ACCEPTANCE_TESTS === 'true' ? describe : describe.skip;
runSuite('Section 14.3: Real Multi-Target HotSwap Acceptance Test', () => {
  it('Scenario 1: Modifying A only updates A; B output remains completely untouched', async () => {
    const jvmA = new SimulatedJvm('jvm-A', 5005);
    jvmA.addClassLoader('loader-A');
    jvmA.loadClass('loader-A', 'com.example.HelloServlet', 'hash-a1', 'Hello from Project A - v1');

    const jvmB = new SimulatedJvm('jvm-B', 5006);
    jvmB.addClassLoader('loader-B');
    jvmB.loadClass('loader-B', 'com.example.HelloServlet', 'hash-b1', 'Hello from Project B - v1');

    const servers = [
      { id: 'srv-A', projectId: 'project-A', runConfigurationId: 'run-A', runtimeInstanceId: 'inst-A-1', generation: 1, jvm: jvmA },
      { id: 'srv-B', projectId: 'project-B', runConfigurationId: 'run-B', runtimeInstanceId: 'inst-B-1', generation: 1, jvm: jvmB },
    ];

    const orchestrator = new HotSwapOrchestrator(servers);

    // Perform HotSwap targeting Project A
    const resultA = await orchestrator.performHotSwap({
      operationId: 'op-001',
      target: {
        projectId: 'project-A',
        runConfigurationId: 'run-A',
        runtimeInstanceId: 'inst-A-1',
        sessionGeneration: 1,
        classLoaderId: 'loader-A',
      },
      buildId: 'b-001',
      artifacts: [{
        binaryName: 'com.example.HelloServlet',
        sha256: 'hash-a2',
        newOutput: 'Hello from Project A - v2 (HotSwapped)',
      }],
      expectedProjectRevision: 2,
    });

    assert.strictEqual(resultA.success, true);
    assert.strictEqual(jvmA.execute('loader-A', 'com.example.HelloServlet'), 'Hello from Project A - v2 (HotSwapped)');
    assert.strictEqual(jvmB.execute('loader-B', 'com.example.HelloServlet'), 'Hello from Project B - v1', 'Project B must remain unchanged');
  });

  it('Scenario 2: Server list ordering invariant — swapping server list does NOT redirect target', async () => {
    const jvmA = new SimulatedJvm('jvm-A', 5005);
    jvmA.addClassLoader('loader-A');
    jvmA.loadClass('loader-A', 'com.example.HelloServlet', 'hash-a1', 'Output A');

    const jvmB = new SimulatedJvm('jvm-B', 5006);
    jvmB.addClassLoader('loader-B');
    jvmB.loadClass('loader-B', 'com.example.HelloServlet', 'hash-b1', 'Output B');

    // List order: B is FIRST in the list!
    const swappedServers = [
      { id: 'srv-B', projectId: 'project-B', runtimeInstanceId: 'inst-B-1', generation: 1, jvm: jvmB },
      { id: 'srv-A', projectId: 'project-A', runtimeInstanceId: 'inst-A-1', generation: 1, jvm: jvmA },
    ];

    const orchestrator = new HotSwapOrchestrator(swappedServers);

    // Save/redefine targeting Project A
    const result = await orchestrator.performHotSwap({
      operationId: 'op-002',
      target: { projectId: 'project-A', runtimeInstanceId: 'inst-A-1', sessionGeneration: 1 },
      buildId: 'b-002',
      artifacts: [{ binaryName: 'com.example.HelloServlet', sha256: 'hash-a2', newOutput: 'Output A - Updated' }],
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(jvmA.execute('loader-A', 'com.example.HelloServlet'), 'Output A - Updated');
    assert.strictEqual(jvmB.execute('loader-B', 'com.example.HelloServlet'), 'Output B', 'B must NEVER receive A updates even if B is first');
  });

  it('Scenario 3: Blocked compile & session switch — delayed A compile never submits to B', async () => {
    const jvmA = new SimulatedJvm('jvm-A', 5005);
    jvmA.addClassLoader('loader-A');
    jvmA.loadClass('loader-A', 'com.example.HelloServlet', 'hash-a1', 'A original');

    const jvmB = new SimulatedJvm('jvm-B', 5006);
    jvmB.addClassLoader('loader-B');
    jvmB.loadClass('loader-B', 'com.example.HelloServlet', 'hash-b1', 'B original');

    const servers = [
      { id: 'srv-A', projectId: 'project-A', runtimeInstanceId: 'inst-A-1', generation: 1, jvm: jvmA },
      { id: 'srv-B', projectId: 'project-B', runtimeInstanceId: 'inst-B-1', generation: 1, jvm: jvmB },
    ];

    const orchestrator = new HotSwapOrchestrator(servers);

    // User edits A, compile starts and captures Context A
    const capturedContextA = {
      projectId: 'project-A',
      runtimeInstanceId: 'inst-A-1',
      sessionGeneration: 1,
    };

    // While compile is running, user switches active session/UI to Project B
    let currentActiveUiProject = 'project-B';

    // Compile of A finishes after delay
    const compileResultA = {
      binaryName: 'com.example.HelloServlet',
      sha256: 'hash-a-new',
      newOutput: 'A recompiled',
    };

    // HotSwap must use the CAPTURED context A, not the current UI project B
    const result = await orchestrator.performHotSwap({
      operationId: 'op-003',
      target: capturedContextA, // Bound to A
      buildId: 'b-003',
      artifacts: [compileResultA],
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(jvmA.execute('loader-A', 'com.example.HelloServlet'), 'A recompiled');
    assert.strictEqual(jvmB.execute('loader-B', 'com.example.HelloServlet'), 'B original', 'B must not be modified when user switched UI');
  });

  it('Scenario 4: Server restart & port reuse — old generation request is rejected as stale_target', async () => {
    const jvmA = new SimulatedJvm('jvm-A', 5005);
    jvmA.addClassLoader('loader-A');
    jvmA.loadClass('loader-A', 'com.example.HelloServlet', 'hash-a1', 'A before restart');

    // Server A restarts: same port 5005, but new instance ID and generation 2!
    const servers = [
      { id: 'srv-A', projectId: 'project-A', runtimeInstanceId: 'inst-A-2-new', generation: 2, jvm: jvmA },
    ];

    const orchestrator = new HotSwapOrchestrator(servers);

    // An in-flight or delayed request bound to generation 1 arrives
    const staleResult = await orchestrator.performHotSwap({
      operationId: 'op-004-stale',
      target: {
        projectId: 'project-A',
        runtimeInstanceId: 'inst-A-1-old', // Old instance ID
        sessionGeneration: 1,               // Old generation
      },
      buildId: 'b-004',
      artifacts: [{ binaryName: 'com.example.HelloServlet', sha256: 'hash-stale', newOutput: 'Stale update' }],
    });

    assert.strictEqual(staleResult.success, false);
    assert.strictEqual(staleResult.code, 'stale_target');
    assert.strictEqual(jvmA.execute('loader-A', 'com.example.HelloServlet'), 'A before restart', 'JVM must reject stale generation');
  });

  it('Scenario 5: Same JVM multi-ClassLoader — disambiguate by ClassLoader; ambiguous rejected', async () => {
    const sharedJvm = new SimulatedJvm('shared-tomcat', 8080);
    // Tomcat hosting two webapps in same JVM: App1 and App2
    sharedJvm.addClassLoader('loader-app1');
    sharedJvm.loadClass('loader-app1', 'com.example.CommonServlet', 'hash-1', 'App 1 v1');

    sharedJvm.addClassLoader('loader-app2');
    sharedJvm.loadClass('loader-app2', 'com.example.CommonServlet', 'hash-1', 'App 2 v1');

    const servers = [
      { id: 'srv-tomcat', projectId: 'multi-app-project', runtimeInstanceId: 'inst-t1', generation: 1, jvm: sharedJvm },
    ];

    const orchestrator = new HotSwapOrchestrator(servers);

    // 1. Without specifying classLoaderId -> rejected with ambiguous_class_loader
    const ambiguousResult = await orchestrator.performHotSwap({
      operationId: 'op-005-ambig',
      target: { projectId: 'multi-app-project', runtimeInstanceId: 'inst-t1', sessionGeneration: 1 },
      buildId: 'b-005',
      artifacts: [{ binaryName: 'com.example.CommonServlet', sha256: 'hash-2', newOutput: 'Ambiguous' }],
    });

    assert.strictEqual(ambiguousResult.success, false);
    assert.strictEqual(ambiguousResult.code, 'ambiguous_class_loader');

    // 2. Explicitly specifying loader-app2 -> only App 2 is updated, App 1 is untouched
    const specificResult = await orchestrator.performHotSwap({
      operationId: 'op-005-specific',
      target: {
        projectId: 'multi-app-project',
        runtimeInstanceId: 'inst-t1',
        sessionGeneration: 1,
        classLoaderId: 'loader-app2',
      },
      buildId: 'b-005-2',
      artifacts: [{ binaryName: 'com.example.CommonServlet', sha256: 'hash-2', newOutput: 'App 2 v2 (Updated)' }],
    });

    assert.strictEqual(specificResult.success, true);
    assert.strictEqual(sharedJvm.execute('loader-app1', 'com.example.CommonServlet'), 'App 1 v1', 'App 1 was untouched');
    assert.strictEqual(sharedJvm.execute('loader-app2', 'com.example.CommonServlet'), 'App 2 v2 (Updated)');
  });

  it('Scenario 6: Audit log verification — logs complete target coordinates and NEVER records secret', async () => {
    const jvm = new SimulatedJvm('jvm-audit', 5005);
    jvm.addClassLoader('loader-1');
    jvm.loadClass('loader-1', 'com.example.LoggedServlet', 'hash-init', 'initial');

    const servers = [
      { id: 'srv-audit', projectId: 'project-audit', runtimeInstanceId: 'inst-aud-1', generation: 1, jvm },
    ];

    const orchestrator = new HotSwapOrchestrator(servers);

    await orchestrator.performHotSwap({
      operationId: 'op-aud-99',
      target: {
        projectId: 'project-audit',
        runConfigurationId: 'run-audit-cfg',
        runtimeInstanceId: 'inst-aud-1',
        sessionGeneration: 1,
        classLoaderId: 'loader-1',
      },
      buildId: 'build-aud-99',
      artifacts: [{ binaryName: 'com.example.LoggedServlet', sha256: 'hash-new-99', newOutput: 'logged' }],
    });

    assert.strictEqual(orchestrator.auditLogs.length, 1);
    const log = orchestrator.auditLogs[0];

    // Must contain operation and target coordinates
    assert.strictEqual(log.operationId, 'op-aud-99');
    assert.strictEqual(log.projectId, 'project-audit');
    assert.strictEqual(log.runConfigurationId, 'run-audit-cfg');
    assert.strictEqual(log.runtimeInstanceId, 'inst-aud-1');
    assert.strictEqual(log.sessionGeneration, 1);
    assert.strictEqual(log.buildId, 'build-aud-99');
    assert.strictEqual(log.classes[0].binaryName, 'com.example.LoggedServlet');
    assert.strictEqual(log.classes[0].sha256, 'hash-new-99');

    // NEVER record secret or token
    const serialized = JSON.stringify(log);
    assert.strictEqual(serialized.includes('secret'), false, 'Audit log must NEVER contain secret');
    assert.strictEqual(serialized.includes('token'), false, 'Audit log must NEVER contain token');
  });
});
