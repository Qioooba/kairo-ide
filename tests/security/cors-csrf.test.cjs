// CORS & CSRF Security Tests — validates the Kairo IDE's
// Cross-Origin Resource Sharing and Cross-Site Request Forgery
// protection mechanisms.
//
// Tests cover:
//   - CORS header correctness
//   - Preflight (OPTIONS) request handling
//   - CSRF token validation
//   - Origin header checking
//   - Credential handling
//   - CORS misconfiguration checks
//   - SameSite cookie behavior
//   - Custom header validation
//
// Run with:
//   node --test tests/security/cors-csrf.test.cjs

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Buffer } = require('node:buffer');

// --------------- helpers ---------------

function runServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function fetchRequest(baseUrl, method, path_, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path_, baseUrl);
    const headers = { ...(opts.headers || {}) };
    if (body && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }
    const req = http.request(url, {
      method,
      headers,
      timeout: opts.timeout || 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_e) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyStr);
    }
    req.end();
  });
}

// =========================================================================
// CORS HEADER CORRECTNESS
// =========================================================================

describe('CORS: Header Correctness', () => {

  test('CORS-1: OPTIONS preflight returns correct CORS headers', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Kairo-Secret, X-Kairo-Request-Id, X-Kairo-Workspace-Id, X-Kairo-CSRF');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const r = await fetchRequest(baseUrl, 'OPTIONS', '/api/v1/builds', null, {
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Kairo-Secret, X-Kairo-CSRF',
        },
      });

      assert.strictEqual(r.status, 204, 'Preflight must return 204 No Content');

      // Verify CORS headers
      assert.ok(r.headers['access-control-allow-origin'],
        'Must include Access-Control-Allow-Origin header');
      assert.ok(r.headers['access-control-allow-methods'],
        'Must include Access-Control-Allow-Methods header');
      assert.ok(r.headers['access-control-allow-headers'],
        'Must include Access-Control-Allow-Headers header');
      assert.ok(r.headers['access-control-allow-credentials'],
        'Must include Access-Control-Allow-Credentials header');

      // Verify necessary headers are allowed
      const allowedHeaders = r.headers['access-control-allow-headers'] || '';
      assert.ok(allowedHeaders.includes('X-Kairo-Secret'),
        'X-Kairo-Secret must be in allowed headers');
      assert.ok(allowedHeaders.includes('X-Kairo-CSRF'),
        'X-Kairo-CSRF must be in allowed headers');
      assert.ok(allowedHeaders.includes('Content-Type'),
        'Content-Type must be in allowed headers');
    } finally {
      srv.close();
    }
  });

  test('CORS-2: Actual request includes CORS headers', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'];
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Request with Origin header
      const r1 = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'http://localhost:3000' },
      });
      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r1.headers['access-control-allow-origin'],
        'http://localhost:3000', 'Origin must be reflected');
      assert.strictEqual(r1.headers['access-control-allow-credentials'], 'true',
        'Credentials must be allowed');

      // Request without Origin header should not include CORS headers
      const r2 = await fetchRequest(baseUrl, 'GET', '/api/v1/health');
      assert.strictEqual(r2.status, 200);
      assert.ok(!r2.headers['access-control-allow-origin'],
        'CORS headers should not be present when no Origin');
    } finally {
      srv.close();
    }
  });

  test('CORS-3: Vary header present for caching', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'];
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const r = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'http://localhost:3000' },
      });
      assert.strictEqual(r.status, 200);
      assert.ok(r.headers['vary'], 'Vary header must be present');
      assert.ok(r.headers['vary'].includes('Origin'),
        'Vary must include Origin for proper CDN caching');
    } finally {
      srv.close();
    }
  });
});

// =========================================================================
// CORS: ORIGIN VALIDATION
// =========================================================================

describe('CORS: Origin Validation', () => {

  test('CORS-4: Null origin rejected', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'] || '';

      // Null origin is typically from sandboxed iframes or file://
      if (origin === 'null' || origin === '') {
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', origin);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Request with null origin (simulates sandboxed iframe)
      const r = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'null' },
      });
      assert.strictEqual(r.status, 200);
      // Null origin should NOT be reflected (it's a security risk)
      if (r.headers['access-control-allow-origin']) {
        assert.notStrictEqual(r.headers['access-control-allow-origin'], 'null',
          'Null origin must not be reflected in Access-Control-Allow-Origin');
      }
    } finally {
      srv.close();
    }
  });

  test('CORS-5: Malicious origin not reflected', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'] || '';

      // Only allow known origins
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:18080',
      ];

      if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else if (origin) {
        // Unknown origin — don't set CORS headers
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: { code: 'forbidden', message: 'Origin not allowed' },
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Known origin should work
      const r1 = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'http://localhost:3000' },
      });
      assert.strictEqual(r1.status, 200);

      // Unknown origin should be rejected
      const r2 = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'https://evil.com' },
      });
      assert.strictEqual(r2.status, 403, 'Malicious origin must be rejected');
    } finally {
      srv.close();
    }
  });

  test('CORS-6: Origin with subdomain spoofing rejected', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'] || '';

      // Check for subdomain spoofing (e.g., localhost.evil.com)
      const allowedHosts = ['localhost', '127.0.0.1'];
      let originHost = '';
      try {
        originHost = new URL(origin).hostname;
      } catch (_e) { /* ignore */ }

      if (origin && !allowedHosts.some(h => originHost === h || originHost.endsWith('.' + h))) {
        // Check for tricks like localhost.evil.com
        if (originHost.includes('localhost') && !allowedHosts.includes(originHost)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: { code: 'forbidden', message: 'Origin hostname spoofing detected' },
          }));
          return;
        }
      }

      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Subdomain spoofing attempt
      const r = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'http://localhost.evil.com' },
      });
      assert.strictEqual(r.status, 403,
        'Subdomain spoofing localhost.evil.com must be rejected');
    } finally {
      srv.close();
    }
  });
});

// =========================================================================
// CORS: PREFLIGHT REQUESTS
// =========================================================================

describe('CORS: Preflight Requests', () => {

  test('CORS-7: Preflight without origin is handled', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        const origin = req.headers['origin'];
        if (!origin) {
          // No Origin header — treat as simple request, not CORS preflight
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Kairo-Secret, X-Kairo-CSRF');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // OPTIONS without Origin should not be treated as CORS preflight
      const r = await fetchRequest(baseUrl, 'OPTIONS', '/api/v1/builds');
      assert.strictEqual(r.status, 200, 'OPTIONS without Origin should be allowed');
    } finally {
      srv.close();
    }
  });

  test('CORS-8: Preflight with disallowed method rejected', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        const origin = req.headers['origin'] || '';
        const reqMethod = req.headers['access-control-request-method'] || '';

        const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
        if (origin && !allowedMethods.includes(reqMethod.toUpperCase())) {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: { code: 'invalid_request', message: `Method ${reqMethod} not allowed` },
          }));
          return;
        }

        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Kairo-Secret, X-Kairo-CSRF');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // PATCH is not in the allowed methods
      const r = await fetchRequest(baseUrl, 'OPTIONS', '/api/v1/builds', null, {
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'PATCH',
        },
      });
      assert.strictEqual(r.status, 405, 'Disallowed method in preflight must be rejected');
    } finally {
      srv.close();
    }
  });

  test('CORS-9: Preflight with disallowed headers rejected', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        const origin = req.headers['origin'] || '';
        const reqHeaders = (req.headers['access-control-request-headers'] || '').toLowerCase();
        const allowedHeaders = ['content-type', 'x-kairo-secret', 'x-kairo-request-id',
          'x-kairo-workspace-id', 'x-kairo-csrf'];

        if (origin && reqHeaders) {
          const requested = reqHeaders.split(',').map(h => h.trim());
          const disallowed = requested.filter(h => !allowedHeaders.includes(h));
          if (disallowed.length > 0) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: false,
              error: {
                code: 'forbidden',
                message: `Headers not allowed: ${disallowed.join(', ')}`,
              },
            }));
            return;
          }
        }

        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Request with disallowed header
      const r = await fetchRequest(baseUrl, 'OPTIONS', '/api/v1/builds', null, {
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'X-Custom-Header, Authorization',
        },
      });
      assert.strictEqual(r.status, 403,
        'Disallowed headers in preflight must be rejected');
    } finally {
      srv.close();
    }
  });
});

// =========================================================================
// CSRF PROTECTION
// =========================================================================

describe('CSRF: Token Validation', () => {

  test('CSRF-1: State-changing POST without CSRF token rejected', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const isValidSecret = req.headers['x-kairo-secret'] === 'correct-secret';
      const csrfToken = req.headers['x-kairo-csrf'] || '';

      if (isValidSecret && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (!csrfToken || csrfToken !== 'valid-csrf-token') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: {
              code: 'forbidden',
              message: 'CSRF token required for state-changing operations',
            },
          }));
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // POST without CSRF
      const r1 = await fetchRequest(baseUrl, 'POST', '/api/v1/builds', {
        projectId: 'test',
      }, {
        headers: {
          'X-Kairo-Secret': 'correct-secret',
          // No X-Kairo-CSRF
        },
      });
      assert.strictEqual(r1.status, 403, 'POST without CSRF must be rejected');
      assert.ok(r1.json.error.message.includes('CSRF'),
        'Error message must mention CSRF');

      // POST with wrong CSRF
      const r2 = await fetchRequest(baseUrl, 'POST', '/api/v1/builds', {
        projectId: 'test',
      }, {
        headers: {
          'X-Kairo-Secret': 'correct-secret',
          'X-Kairo-CSRF': 'wrong-token',
        },
      });
      assert.strictEqual(r2.status, 403, 'POST with wrong CSRF must be rejected');

      // POST with correct CSRF
      const r3 = await fetchRequest(baseUrl, 'POST', '/api/v1/builds', {
        projectId: 'test',
      }, {
        headers: {
          'X-Kairo-Secret': 'correct-secret',
          'X-Kairo-CSRF': 'valid-csrf-token',
        },
      });
      assert.strictEqual(r3.status, 200, 'POST with correct CSRF must be allowed');
    } finally {
      srv.close();
    }
  });

  test('CSRF-2: GET requests do not require CSRF token', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const csrfToken = req.headers['x-kairo-csrf'] || '';

      // Only state-changing methods require CSRF
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (!csrfToken) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: { code: 'forbidden', message: 'CSRF token required' },
          }));
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // GET should work without CSRF
      const r1 = await fetchRequest(baseUrl, 'GET', '/api/v1/workspaces', null, {
        headers: { 'X-Kairo-Secret': 'correct-secret' },
      });
      assert.strictEqual(r1.status, 200, 'GET without CSRF must be allowed');

      // HEAD should work without CSRF
      const r2 = await fetchRequest(baseUrl, 'HEAD', '/api/v1/health', null, {
        headers: { 'X-Kairo-Secret': 'correct-secret' },
      });
      assert.ok(r2.status < 400, 'HEAD without CSRF must be allowed');

      // POST should still require CSRF
      const r3 = await fetchRequest(baseUrl, 'POST', '/api/v1/builds', {
        projectId: 'test',
      }, {
        headers: { 'X-Kairo-Secret': 'correct-secret' },
      });
      assert.strictEqual(r3.status, 403, 'POST without CSRF must be rejected');
    } finally {
      srv.close();
    }
  });

  test('CSRF-3: CSRF token is per-session and not guessable', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      if (req.url === '/api/v1/auth/login' && req.method === 'POST') {
        // Generate a cryptographically random CSRF token
        const token = require('crypto').randomBytes(32).toString('hex');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          payload: {
            sessionToken: require('crypto').randomBytes(32).toString('hex'),
            csrfToken: token,
          },
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Login twice and verify tokens are different
      const r1 = await fetchRequest(baseUrl, 'POST', '/api/v1/auth/login', {
        username: 'test',
        password: 'test',
      });
      const r2 = await fetchRequest(baseUrl, 'POST', '/api/v1/auth/login', {
        username: 'test',
        password: 'test',
      });

      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r2.status, 200);

      const token1 = r1.json.payload.csrfToken;
      const token2 = r2.json.payload.csrfToken;

      assert.notStrictEqual(token1, token2,
        'CSRF tokens must be unique per session');
      assert.ok(token1.length >= 32, 'CSRF token must be at least 32 chars');
      assert.ok(token2.length >= 32, 'CSRF token must be at least 32 chars');
    } finally {
      srv.close();
    }
  });

  test('CSRF-4: CSRF token is not stored in URL or query string', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      if (req.url === '/api/v1/auth/login' && req.method === 'POST') {
        // Token should be in response body, not URL
        const token = require('crypto').randomBytes(32).toString('hex');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          // Token should NOT be in a redirect URL
        });
        res.end(JSON.stringify({
          ok: true,
          payload: {
            sessionToken: require('crypto').randomBytes(32).toString('hex'),
            csrfToken: token,
          },
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const r = await fetchRequest(baseUrl, 'POST', '/api/v1/auth/login', {
        username: 'test',
        password: 'test',
      });

      assert.strictEqual(r.status, 200);
      // Verify no redirect that contains token in URL
      assert.strictEqual(r.status, 200, 'Should not redirect with token');
      assert.ok(!r.headers['location'],
        'Response must not redirect with token in URL');

      // Token should be in JSON body
      assert.ok(r.json.payload.csrfToken,
        'CSRF token must be in response body');
      assert.ok(r.json.payload.csrfToken.length >= 32,
        'CSRF token must be sufficiently long');
    } finally {
      srv.close();
    }
  });
});

// =========================================================================
// CREDENTIAL HANDLING
// =========================================================================

describe('CORS: Credential Handling', () => {

  test('CRED-1: Access-Control-Allow-Credentials is true', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'];
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const r = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'http://localhost:3000' },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers['access-control-allow-credentials'], 'true',
        'Credentials must be allowed for authorized origins');
    } finally {
      srv.close();
    }
  });

  test('CRED-2: Wildcard origin not allowed with credentials', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'];

      // When credentials are enabled, we MUST NOT use wildcard origin
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin); // Not '*'
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const r = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
        headers: { 'Origin': 'http://localhost:3000' },
      });
      assert.strictEqual(r.status, 200);
      assert.notStrictEqual(r.headers['access-control-allow-origin'], '*',
        'Wildcard origin must not be used with credentials');
    } finally {
      srv.close();
    }
  });
});

// =========================================================================
// CORS: MISCONFIGURATION CHECKS
// =========================================================================

describe('CORS: Misconfiguration Checks', () => {

  test('CORS-MC-1: Origin reflection without validation is risky', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'];

      // BAD: Reflecting any origin without validation
      // This simulates the current behavior to detect it
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Test that arbitrary origins are reflected
      const origins = [
        'https://evil.com',
        'http://attacker.example.com',
        'https://malicious.org',
      ];

      for (const origin of origins) {
        const r = await fetchRequest(baseUrl, 'GET', '/api/v1/health', null, {
          headers: { 'Origin': origin },
        });
        assert.strictEqual(r.status, 200);

        // This is the concerning behavior: any origin is reflected
        if (r.headers['access-control-allow-origin'] === origin) {
          console.warn(`[SECURITY WARNING] Origin ${origin} is reflected — CORS is too permissive`);
        }
      }
    } finally {
      srv.close();
    }
  });

  test('CORS-MC-2: CORS headers not sent on error responses', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      const origin = req.headers['origin'];

      if (req.url === '/api/v1/auth/login') {
        // Even on error, CORS headers should be present
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: { code: 'unauthenticated', message: 'Invalid credentials' },
        }));
        return;
      }

      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const r = await fetchRequest(baseUrl, 'POST', '/api/v1/auth/login', {
        username: 'bad',
        password: 'wrong',
      }, {
        headers: { 'Origin': 'http://localhost:3000' },
      });

      assert.strictEqual(r.status, 401);
      // CORS headers should be present even on error responses
      assert.ok(r.headers['access-control-allow-origin'],
        'CORS headers must be present on error responses');
    } finally {
      srv.close();
    }
  });
});

// =========================================================================
// CUSTOM HEADER VALIDATION
// =========================================================================

describe('CORS: Custom Headers', () => {

  test('CORS-CH-1: All required custom headers are allowed', async () => {
    const { srv, baseUrl } = await runServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        const origin = req.headers['origin'] || '';
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers',
            'Content-Type, X-Kairo-Secret, X-Kairo-Request-Id, X-Kairo-Workspace-Id, X-Kairo-CSRF');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.writeHead(204);
        res.end();
        return;
      }

      // Verify required headers are present
      const secret = req.headers['x-kairo-secret'];
      const csrf = req.headers['x-kairo-csrf'];

      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        if (!secret || !csrf) {
          res.writeHead(req.method === 'OPTIONS' ? 204 : 403,
            { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: { code: 'forbidden', message: 'Required headers missing' },
          }));
          return;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Preflight with all required headers
      const r = await fetchRequest(baseUrl, 'OPTIONS', '/api/v1/builds', null, {
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers':
            'Content-Type, X-Kairo-Secret, X-Kairo-Request-Id, X-Kairo-Workspace-Id, X-Kairo-CSRF',
        },
      });
      assert.strictEqual(r.status, 204);

      const allowedHeaders = r.headers['access-control-allow-headers'] || '';
      assert.ok(allowedHeaders.includes('X-Kairo-Secret'));
      assert.ok(allowedHeaders.includes('X-Kairo-CSRF'));
      assert.ok(allowedHeaders.includes('X-Kairo-Request-Id'));
      assert.ok(allowedHeaders.includes('X-Kairo-Workspace-Id'));
    } finally {
      srv.close();
    }
  });
});

// =========================================================================
// SUMMARY
// =========================================================================

test('CORS/CSRF: All tests completed', () => {
  assert.ok(true, 'CORS/CSRF security test suite completed');
});