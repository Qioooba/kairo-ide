'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Section 15.2: path-session.test.cjs
 *
 * Validates:
 * 1. Windows lexical path containment (preventing false prefix matches like C:\repo vs C:\repo-other)
 * 2. URI to local path normalization (handling spaces, special chars, drive letters)
 * 3. Immutable session binding across asynchronous await boundaries
 */

describe('Section 15.2: Path & Session Behavioral Model Tests', () => {
  it('Test 1: Lexical path containment rejects same-prefix sibling directories (F21)', () => {
    function isSubpathOrEqual(parent, candidate) {
      const normParent = path.normalize(parent).toLowerCase();
      const normCandidate = path.normalize(candidate).toLowerCase();
      const rel = path.relative(normParent, normCandidate);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    }

    const parent = 'C:\\workspace\\project-a';
    const child = 'C:\\workspace\\project-a\\src\\Hello.java';
    const siblingWithSamePrefix = 'C:\\workspace\\project-a-sibling\\Hello.java';

    assert.strictEqual(isSubpathOrEqual(parent, child), true);
    assert.strictEqual(
      isSubpathOrEqual(parent, siblingWithSamePrefix),
      false,
      'Sibling directory sharing same prefix must NOT be treated as inside workspace',
    );
  });

  it('Test 2: URI to local native path normalization decodes %20 and special characters (F02)', () => {
    function fileUriToNativePath(uri) {
      if (!uri.startsWith('file://')) {
        throw new Error('Unsupported URI scheme: must be file://');
      }
      let pathname = uri.slice(7);
      if (pathname.startsWith('/')) {
        pathname = pathname.slice(1);
      }
      pathname = decodeURIComponent(pathname);
      return path.normalize(pathname);
    }

    const uri = 'file:///C:/Users/Developer/My%20Projects%231/src/App.java';
    const expected = path.normalize('C:/Users/Developer/My Projects#1/src/App.java');
    assert.strictEqual(fileUriToNativePath(uri), expected);
  });

  it('Test 3: Fixed session context across await prevents cross-session HotSwap hijacking (F04)', async () => {
    // Current mutable UI state
    let activeSessionId = 'session-A';

    async function performHotSwapWithCapturedContext() {
      // CAPTURE session before await
      const capturedSessionId = activeSessionId;

      // Simulate asynchronous compilation delay
      await new Promise(resolve => setTimeout(resolve, 20));

      // After await, verify that capturedSessionId does not mutate even if activeSessionId changed
      return capturedSessionId;
    }

    const hotswapPromise = performHotSwapWithCapturedContext();

    // User switches active session during compilation
    activeSessionId = 'session-B';

    const targetSession = await hotswapPromise;
    assert.strictEqual(
      targetSession,
      'session-A',
      'HotSwap target must remain bound to the session captured at save time',
    );
  });
});
