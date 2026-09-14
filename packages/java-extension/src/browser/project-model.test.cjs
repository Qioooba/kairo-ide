'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ProjectModelManager } = require('../../lib/browser/project-model');
const { JavaDocumentSync } = require('../../lib/browser/java-document-sync-core');

describe('PR13: ProjectModel 单一真相源 (T44 ~ T46)', () => {
  test('T44: ordered classpath consistency and dependency conflict diagnostics', () => {
    const manager = new ProjectModelManager({
      projectId: 'test-app',
      rootPath: '/workspace/test-app',
      classpath: [
        {
          path: '/workspace/test-app/lib/commons-lang-2.4.jar',
          kind: 'compile',
          source: 'web-inf-lib',
          resolved: true,
          classes: [
            'org.apache.commons.lang.StringUtils',
            'org.apache.commons.lang.WordUtils',
          ],
        },
        {
          path: '/workspace/test-app/lib/commons-lang-2.6.jar',
          kind: 'compile',
          source: 'web-inf-lib',
          resolved: true,
          classes: [
            'org.apache.commons.lang.StringUtils', // Conflicting class
            'org.apache.commons.lang.ArrayUtils',
          ],
        },
      ],
    });

    const snapshot = manager.getSnapshot();

    // 1. Strict order preserved
    assert.equal(snapshot.classpath.length, 2);
    assert.equal(snapshot.classpath[0].path, '/workspace/test-app/lib/commons-lang-2.4.jar');
    assert.equal(snapshot.classpath[1].path, '/workspace/test-app/lib/commons-lang-2.6.jar');

    // 2. Conflict diagnostics
    const conflictDiags = snapshot.diagnostics.filter(d => d.type === 'classpath_conflict');
    assert.equal(conflictDiags.length, 1);
    const diag = conflictDiags[0];
    assert.equal(diag.details.className, 'org.apache.commons.lang.StringUtils');
    assert.equal(diag.details.winningPath, '/workspace/test-app/lib/commons-lang-2.4.jar');
    assert.equal(diag.details.shadowedPath, '/workspace/test-app/lib/commons-lang-2.6.jar');
    assert.match(diag.message, /shadowed by earlier classpath entry/);
  });

  test('T45: directory and config changes monotonically bump revision for all consumers', () => {
    const manager = new ProjectModelManager({
      projectId: 'legacy-project',
      rootPath: '/workspace/legacy',
    });

    assert.equal(manager.getRevision(), 1);
    assert.equal(manager.validateRevision(1), true);

    const revisionEvents = [];
    const sub = manager.onRevisionChange(snap => {
      revisionEvents.push({ revision: snap.revision, outputDir: snap.outputDir, sourceRoots: snap.sourceRoots });
    });

    // 1. Update source roots -> revision 2
    manager.updateSourceRoots(['src/main/java', 'src/generated/java']);
    assert.equal(manager.getRevision(), 2);
    assert.equal(manager.validateRevision(1), false, 'Old revision 1 must be rejected');
    assert.equal(manager.validateRevision(2), true);

    // 2. Update output dir -> revision 3
    manager.updateOutputDir('target/classes');
    assert.equal(manager.getRevision(), 3);
    assert.equal(manager.validateRevision(2), false, 'Revision 2 is now stale');
    assert.equal(manager.validateRevision(3), true);

    // Verify notifications
    assert.equal(revisionEvents.length, 2);
    assert.equal(revisionEvents[0].revision, 2);
    assert.deepEqual(revisionEvents[0].sourceRoots, ['src/main/java', 'src/generated/java']);
    assert.equal(revisionEvents[1].revision, 3);
    assert.equal(revisionEvents[1].outputDir, 'target/classes');

    sub.dispose();
  });

  test('T46: workspace switch and language server restart isolate state without leaking old files', () => {
    const clientDidOpens = [];
    const mockClient = {
      state: () => 'ready',
      didOpen: (p) => clientDidOpens.push(p),
      didChange: () => {},
      didClose: () => {},
    };
    const mockLogger = { info: () => {}, warn: () => {}, error: () => {} };

    const docSync = new JavaDocumentSync(mockClient, mockLogger, 10);
    docSync.handleStateChange('ready');

    // 1. Open documents in old workspace
    docSync.openDocument({
      uri: 'file:///workspace-old/src/OldService.java',
      languageId: 'java',
      version: 1,
      text: 'public class OldService {}',
    });
    assert.equal(clientDidOpens.length, 1);
    assert.equal(clientDidOpens[0].uri, 'file:///workspace-old/src/OldService.java');

    // 2. User switches workspace
    const manager = new ProjectModelManager({
      projectId: 'old-project',
      rootPath: '/workspace-old',
      sourceRoots: ['src'],
    });

    // Switch workspace resets document sync and project model
    docSync.resetWorkspace();
    const newSnapshot = manager.switchWorkspace('/workspace-new', 'new-project');

    assert.equal(docSync.size, 0);
    assert.equal(newSnapshot.projectId, 'new-project');
    assert.equal(newSnapshot.rootPath, '/workspace-new');
    assert.equal(manager.getWorkspaceGeneration(), 2);
    assert.equal(manager.getRevision(), 1);

    // 3. Simulate language server restart (transitions ready -> restarting -> ready)
    clientDidOpens.length = 0;
    docSync.handleStateChange('starting');
    docSync.handleStateChange('ready');

    // Because old workspace documents were reset, zero old documents are re-sent to LS!
    assert.equal(clientDidOpens.length, 0, 'Old workspace documents must not be re-sent to language server');

    // 4. Open new document in new workspace
    docSync.openDocument({
      uri: 'file:///workspace-new/src/NewService.java',
      languageId: 'java',
      version: 1,
      text: 'public class NewService {}',
    });
    assert.equal(clientDidOpens.length, 1);
    assert.equal(clientDidOpens[0].uri, 'file:///workspace-new/src/NewService.java');

    docSync.dispose();
  });
});
