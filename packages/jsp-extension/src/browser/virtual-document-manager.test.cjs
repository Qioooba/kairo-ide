'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { VirtualDocumentManager } = require('../../lib/browser/virtual-document-manager');

describe('VirtualDocumentManager (F17 / T38, T39)', () => {
  function createMockClient() {
    const events = [];
    return {
      events,
      didOpen(params) {
        events.push({ type: 'didOpen', ...params });
      },
      didChange(params) {
        events.push({ type: 'didChange', ...params });
      },
      didClose(uri) {
        events.push({ type: 'didClose', uri });
      },
    };
  }

  test('T38: concurrent leases and diagnostics do not cross-close and issue only 1 didOpen', async () => {
    const client = createMockClient();
    const manager = new VirtualDocumentManager(client);

    const virtualUri = 'jsp-virtual://block_0.java';
    const jspUri = 'file:///workspace/test.jsp';
    const textV1 = 'public class Virtual_0 { void f() { int x = 1; } }';

    // 1. Initial background diagnostics sync
    await manager.syncDocument(virtualUri, textV1, 'java', jspUri);

    assert.equal(manager.isDocumentOpen(virtualUri), true);
    assert.equal(client.events.length, 1);
    assert.equal(client.events[0].type, 'didOpen');
    assert.equal(client.events[0].uri, virtualUri);
    assert.equal(client.events[0].version, 1);

    // 2. 20 concurrent completion requests acquire leases concurrently
    const leases = await Promise.all(
      Array.from({ length: 20 }, () =>
        manager.acquireLease(virtualUri, textV1, 'java', jspUri)
      )
    );

    // No extra didOpen should have been sent since doc was already open
    assert.equal(client.events.filter(e => e.type === 'didOpen').length, 1);
    assert.equal(manager.getActiveLeaseCount(virtualUri), 20);

    // All leases are current
    for (const lease of leases) {
      assert.equal(lease.isCurrent(), true);
    }

    // 3. Dispose 19 out of 20 leases — none should trigger didClose
    for (let i = 0; i < 19; i++) {
      leases[i].dispose();
    }
    assert.equal(manager.getActiveLeaseCount(virtualUri), 1);
    assert.equal(manager.isDocumentOpen(virtualUri), true);
    assert.equal(client.events.some(e => e.type === 'didClose'), false, 'premature didClose triggered while lease active');

    // 4. Dispose the final lease — doc remains open for diagnostics/editing until explicit closeDocument/closeAllForJsp
    leases[19].dispose();
    assert.equal(manager.getActiveLeaseCount(virtualUri), 0);
    assert.equal(manager.isDocumentOpen(virtualUri), true);
    assert.equal(client.events.some(e => e.type === 'didClose'), false);

    // 5. Explicitly closing document or parent JSP closes doc and fires didClose exactly once
    await manager.closeAllForJsp(jspUri);
    assert.equal(manager.isDocumentOpen(virtualUri), false);
    const didCloseEvents = client.events.filter(e => e.type === 'didClose');
    assert.equal(didCloseEvents.length, 1);
    assert.equal(didCloseEvents[0].uri, virtualUri);
  });

  test('T38: content change sends didChange without didClose/didOpen cycle', async () => {
    const client = createMockClient();
    const manager = new VirtualDocumentManager(client);

    const virtualUri = 'jsp-virtual://block_1.java';
    const textV1 = 'class Test { int a; }';
    const textV2 = 'class Test { int a; int b; }';

    await manager.syncDocument(virtualUri, textV1, 'java');
    assert.equal(client.events.length, 1);
    assert.equal(client.events[0].type, 'didOpen');

    // Sync updated content
    await manager.syncDocument(virtualUri, textV2, 'java');
    assert.equal(client.events.length, 2);
    assert.equal(client.events[1].type, 'didChange');
    assert.equal(client.events[1].version, 2);
    assert.equal(client.events[1].changes[0].text, textV2);
  });

  test('T39: generation invalidation discards late completion response when document is closed or reset', async () => {
    const client = createMockClient();
    const manager = new VirtualDocumentManager(client);

    const virtualUri = 'jsp-virtual://block_2.java';
    const jspUri = 'file:///workspace/demo.jsp';
    const text = 'class Foo { void bar() {} }';

    // Acquire lease for an in-flight completion
    const lease = await manager.acquireLease(virtualUri, text, 'java', jspUri);
    assert.equal(lease.isCurrent(), true);

    // Simulated async completion delay
    let appliedEdits = false;
    async function simulateLateLspResponse() {
      // Wait for document reset
      await new Promise(resolve => setTimeout(resolve, 20));
      // T39 Check:
      if (lease.isCurrent()) {
        appliedEdits = true;
      }
    }

    const promise = simulateLateLspResponse();

    // While completion was in flight, user closes JSP model or block is removed
    await manager.closeDocument(virtualUri);

    await promise;

    // The late response must have been rejected because lease is no longer current
    assert.equal(lease.isCurrent(), false);
    assert.equal(appliedEdits, false, 'Late completion applied edits on closed virtual document!');
    lease.dispose();
  });

  test('closeAllForJsp does not accidentally close substring matching JSPs like test.jsp2', async () => {
    const client = createMockClient();
    const manager = new VirtualDocumentManager(client);

    const jsp1 = 'file:///workspace/test.jsp';
    const jsp2 = 'file:///workspace/test.jsp2';
    const vUri1 = 'jsp-scriptlet://file:///workspace/test.jsp#block0';
    const vUri2 = 'jsp-scriptlet://file:///workspace/test.jsp2#block0';

    await manager.syncDocument(vUri1, 'class A {}', 'java', jsp1);
    await manager.syncDocument(vUri2, 'class B {}', 'java', jsp2);

    assert.equal(manager.isDocumentOpen(vUri1), true);
    assert.equal(manager.isDocumentOpen(vUri2), true);

    // Close all for jsp1
    await manager.closeAllForJsp(jsp1);

    // jsp1 should be closed, but jsp2 must remain open!
    assert.equal(manager.isDocumentOpen(vUri1), false);
    assert.equal(manager.isDocumentOpen(vUri2), true, 'test.jsp2 was erroneously closed when closing test.jsp!');
  });
});

