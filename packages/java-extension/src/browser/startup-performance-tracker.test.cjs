'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  StartupStageTracker,
  WorkspaceFileManifestCache,
  ResourceBudgetManager,
  DEFAULT_WORKSPACE_EXCLUDES,
  DEFAULT_4GB_BUDGET,
} = require('../../lib/browser/startup-performance-tracker');

/* ========================================================================== */
/*  1. Phased Startup Lifecycle (P0 ~ P4)                                     */
/* ========================================================================== */

describe('PR15 — Phased Startup Lifecycle (P0 ~ P4)', () => {
  let tracker;
  const baseTime = 1700000000000;

  beforeEach(() => {
    tracker = new StartupStageTracker(baseTime);
  });

  it('starts at processStart milestone', () => {
    assert.strictEqual(tracker.isStageReached('processStart'), true);
    assert.strictEqual(tracker.getStageDuration('processStart'), 0);
  });

  it('advances sequentially through P0 -> P1 -> P2 -> P3 -> P4', () => {
    const reachedStages = [];
    tracker.onDidReachStage(m => reachedStages.push(m.stage));

    // P0: Shell visible
    tracker.markStage('firstVisible', { renderer: 'monaco' });
    assert.strictEqual(tracker.isStageReached('firstVisible'), true);

    // P1: Basic editor ready (text editing available)
    tracker.markStage('editorReady', { openFiles: 1 });
    assert.strictEqual(tracker.isStageReached('editorReady'), true);

    // P2: ProjectModel ready
    tracker.markStage('projectModelReady', { revision: 1 });
    assert.strictEqual(tracker.isStageReached('projectModelReady'), true);

    // P3: Java semantic language services ready
    tracker.markStage('javaReady', { jdtLsPid: 4567 });
    assert.strictEqual(tracker.isStageReached('javaReady'), true);

    // P4: Debug and server ready
    tracker.markStage('debugReady');
    tracker.markStage('serverReady', { tomcatPort: 8080 });

    assert.deepEqual(reachedStages, [
      'firstVisible',
      'editorReady',
      'projectModelReady',
      'javaReady',
      'debugReady',
      'serverReady',
    ]);

    const report = tracker.generateReport();
    assert.strictEqual(report.milestones.length, 7); // processStart + 6 stages
    assert.strictEqual(typeof report.totalDurationMs, 'number');
    assert.strictEqual(report.failedStages, undefined);
  });

  it('non-blocking invariant: P3 (javaReady) failure does not block P1 (editorReady) or P2', () => {
    // P0 and P1 complete
    tracker.markStage('firstVisible');
    tracker.markStage('editorReady');
    tracker.markStage('projectModelReady');

    // P3 fails (e.g. JDT LS timeout or missing JDK)
    tracker.failStage('javaReady', 'JDT LS failed to initialize within 30000ms');

    assert.strictEqual(tracker.isStageReached('editorReady'), true, 'P1 editor must remain ready');
    assert.strictEqual(tracker.isStageReached('projectModelReady'), true, 'P2 project model must remain ready');
    assert.strictEqual(tracker.isStageReached('javaReady'), false, 'P3 must NOT be marked as reached');

    const failureReason = tracker.getStageFailure('javaReady');
    assert.ok(failureReason.includes('failed to initialize'));

    const report = tracker.generateReport();
    assert.strictEqual(report.failedStages?.javaReady, 'JDT LS failed to initialize within 30000ms');
  });

  it('reset clears milestones and restarts sequence', () => {
    tracker.markStage('firstVisible');
    tracker.markStage('editorReady');
    assert.strictEqual(tracker.isStageReached('editorReady'), true);

    tracker.reset(baseTime + 1000);
    assert.strictEqual(tracker.isStageReached('editorReady'), false);
    assert.strictEqual(tracker.isStageReached('processStart'), true);
  });
});

/* ========================================================================== */
/*  2. Workspace File Manifest Cache                                          */
/* ========================================================================== */

describe('PR15 — Workspace File Manifest Cache', () => {
  let cache;

  beforeEach(() => {
    cache = new WorkspaceFileManifestCache(5000);
  });

  it('filters default excluded directories', () => {
    for (const exclude of DEFAULT_WORKSPACE_EXCLUDES) {
      assert.strictEqual(cache.shouldIgnore(`${exclude}/some-file.txt`), true);
      assert.strictEqual(cache.shouldIgnore(`subfolder/${exclude}/some-file.txt`), true);
    }

    // Source files should not be ignored
    assert.strictEqual(cache.shouldIgnore('src/main/java/com/example/App.java'), false);
    assert.strictEqual(cache.shouldIgnore('WebContent/WEB-INF/web.xml'), false);
    assert.strictEqual(cache.shouldIgnore('index.jsp'), false);
  });

  it('batch populates files and tracks hit/miss statistics', () => {
    const files = [];
    for (let i = 0; i < 500; i++) {
      files.push({
        relativePath: `src/pkg/File${i}.java`,
        size: 1024,
        mtime: 1700000000000 + i,
        isDirectory: false,
      });
    }
    // Also include some files in ignored directories
    files.push({
      relativePath: 'target/classes/File0.class',
      size: 512,
      mtime: 1700000000000,
      isDirectory: false,
    });
    files.push({
      relativePath: '.git/HEAD',
      size: 32,
      mtime: 1700000000000,
      isDirectory: false,
    });

    const accepted = cache.batchPopulate(files);
    assert.strictEqual(accepted, 500, '500 source files accepted, 2 ignored rejected');

    // Hits
    const found = cache.getFile('src/pkg/File42.java');
    assert.ok(found);
    assert.strictEqual(found.relativePath, 'src/pkg/File42.java');

    // Misses
    const missing = cache.getFile('src/pkg/NonExistent.java');
    assert.strictEqual(missing, undefined);

    const stats = cache.getStats();
    assert.strictEqual(stats.totalFiles, 500);
    assert.strictEqual(stats.hitCount, 1);
    assert.strictEqual(stats.missCount, 1);
    assert.strictEqual(stats.hitRate, 0.5);
  });

  it('supports incremental update, rename, and deletion', () => {
    cache.addOrUpdateFile({
      relativePath: 'src/Hello.java',
      size: 100,
      mtime: 1000,
      isDirectory: false,
    });

    assert.strictEqual(cache.getFile('src/Hello.java')?.size, 100);

    // Update
    cache.addOrUpdateFile({
      relativePath: 'src/Hello.java',
      size: 250,
      mtime: 2000,
      isDirectory: false,
    });
    assert.strictEqual(cache.getFile('src/Hello.java')?.size, 250);

    // Rename
    const renamed = cache.renameFile('src/Hello.java', 'src/World.java');
    assert.strictEqual(renamed, true);
    assert.strictEqual(cache.getFile('src/Hello.java'), undefined);
    assert.strictEqual(cache.getFile('src/World.java')?.size, 250);

    // Delete
    const removed = cache.removeFile('src/World.java');
    assert.strictEqual(removed, true);
    assert.strictEqual(cache.getFile('src/World.java'), undefined);
  });

  it('queries files by substring and regex', () => {
    cache.addOrUpdateFile({ relativePath: 'src/UserController.java', size: 10, mtime: 1, isDirectory: false });
    cache.addOrUpdateFile({ relativePath: 'src/UserServlet.java', size: 10, mtime: 1, isDirectory: false });
    cache.addOrUpdateFile({ relativePath: 'src/ProductServlet.java', size: 10, mtime: 1, isDirectory: false });
    cache.addOrUpdateFile({ relativePath: 'WebContent/user.jsp', size: 10, mtime: 1, isDirectory: false });

    const servlets = cache.queryFiles('Servlet');
    assert.strictEqual(servlets.length, 2);

    const jsps = cache.queryFiles(/\.jsp$/);
    assert.strictEqual(jsps.length, 1);
    assert.strictEqual(jsps[0].relativePath, 'WebContent/user.jsp');
  });

  it('enforces capacity limit and evicts oldest items (LRU)', () => {
    const tinyCache = new WorkspaceFileManifestCache(5);

    for (let i = 0; i < 8; i++) {
      tinyCache.addOrUpdateFile({
        relativePath: `file${i}.txt`,
        size: 10,
        mtime: 1,
        isDirectory: false,
      });
    }

    const stats = tinyCache.getStats();
    assert.strictEqual(stats.totalFiles, 5, 'Total files capped at 5');
    assert.strictEqual(stats.evictionCount, 3, '3 oldest files evicted');
  });
});

/* ========================================================================== */
/*  3. Resource Budget Manager (4GB Environment Strategy)                     */
/* ========================================================================== */

describe('PR15 — Resource Budget Manager (4GB Environment Strategy)', () => {
  it('default configuration aligns with 4GB virtual desktop limits', () => {
    const manager = new ResourceBudgetManager();
    assert.strictEqual(manager.budgetConfig.maxMemoryMb, DEFAULT_4GB_BUDGET.maxMemoryMb);
    assert.strictEqual(manager.budgetConfig.maxConcurrentHeavyTasks, 2);
    assert.strictEqual(manager.budgetConfig.maxFileCacheEntries, 50000);
    assert.strictEqual(manager.budgetConfig.maxLogRingLines, 1000);
  });

  it('throttles heavy concurrent tasks and queues overflow', async () => {
    const manager = new ResourceBudgetManager({ maxConcurrentHeavyTasks: 2 });
    assert.strictEqual(manager.runningHeavyTasks, 0);

    // Slot 1 acquired
    const slot1 = await manager.acquireHeavyTaskSlot('compile-1');
    assert.strictEqual(manager.runningHeavyTasks, 1);

    // Slot 2 acquired
    const slot2 = await manager.acquireHeavyTaskSlot('search-1');
    assert.strictEqual(manager.runningHeavyTasks, 2);
    assert.strictEqual(manager.queuedHeavyTasks, 0);

    // Slot 3 waits in queue
    let slot3Acquired = false;
    const slot3Promise = manager.acquireHeavyTaskSlot('compile-2').then(s => {
      slot3Acquired = true;
      return s;
    });

    assert.strictEqual(manager.runningHeavyTasks, 2);
    assert.strictEqual(manager.queuedHeavyTasks, 1);
    assert.strictEqual(slot3Acquired, false);

    // Release slot 1 -> unblocks slot 3
    slot1.release();
    const slot3 = await slot3Promise;

    assert.strictEqual(slot3Acquired, true);
    assert.strictEqual(manager.runningHeavyTasks, 2);
    assert.strictEqual(manager.queuedHeavyTasks, 0);

    // Clean up
    slot2.release();
    slot3.release();
    assert.strictEqual(manager.runningHeavyTasks, 0);
  });

  it('checks memory budget and triggers warnings when usage exceeds threshold', () => {
    const manager = new ResourceBudgetManager({ maxMemoryMb: 3072 });

    // 2000 MB: safe
    const safe = manager.checkMemoryBudget(2000 * 1024 * 1024);
    assert.strictEqual(safe.withinBudget, true);
    assert.strictEqual(safe.usageMb, 2000);
    assert.strictEqual(safe.warning, undefined);

    // 3500 MB: warning
    const warn = manager.checkMemoryBudget(3500 * 1024 * 1024);
    assert.strictEqual(warn.withinBudget, false);
    assert.strictEqual(warn.usageMb, 3500);
    assert.ok(warn.warning?.includes('exceeds 4GB environment threshold'));
  });

  it('maintains a bounded log ring buffer', () => {
    const manager = new ResourceBudgetManager();
    const ring = [];

    for (let i = 0; i < 10; i++) {
      manager.appendBoundedLog(ring, `log line ${i}`, 5);
    }

    assert.strictEqual(ring.length, 5);
    assert.strictEqual(ring[0], 'log line 5');
    assert.strictEqual(ring[4], 'log line 9');
  });
});
