// EndpointMap ↔ Go routes smoke comparison (S2 / Batch 3).
//
// Catches the class of "TS protocol declares an endpoint the agent never
// registered" bugs (and the reverse for core /api/v1 paths). This is a
// static source scan — not a live HTTP probe — so it runs offline in CI.
//
// Run with:
//   pnpm --filter @kairo/protocol test
//   (or) node --test src/endpoint-map-routes.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL_SRC = path.resolve(__dirname, 'index.ts');
const GO_SERVER_SRC = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'runtime-agent',
  'internal',
  'api',
  'server.go',
);

/** Extract EndpointMap keys like `GET /api/v1/builds` from protocol index.ts. */
function parseEndpointMap(src) {
  const endpoints = new Set();
  // Match quoted keys inside EndpointMap: 'METHOD /api/v1/...'
  const re = /['"`]((?:GET|POST|PUT|DELETE|PATCH)\s+\/api\/v1\/[^'"`]+)['"`]\s*:/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    endpoints.add(m[1].replace(/\s+/g, ' ').trim());
  }
  return endpoints;
}

/**
 * Extract Go mux path templates from router.HandleFunc registrations.
 * Path params `{id}` are normalized to `{*}` for comparison with TS `{buildId}`.
 */
function parseGoRoutes(src) {
  const routes = new Set();
  const re = /HandleFunc\(\s*"(\/api\/v1\/[^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    routes.add(normalizePath(m[1]));
  }
  return routes;
}

function normalizePath(p) {
  // Strip trailing slash for comparison (except bare /api/v1)
  let out = p.replace(/\/+$/, '') || p;
  // Collapse path params to a placeholder
  out = out.replace(/\{[^}]+\}/g, '{param}');
  return out;
}

function endpointPath(ep) {
  // 'GET /api/v1/builds/{buildId}' → /api/v1/builds/{param}
  const space = ep.indexOf(' ');
  const p = space >= 0 ? ep.slice(space + 1) : ep;
  return normalizePath(p);
}

test('protocol EndpointMap and Go server.go share core /api/v1 routes', () => {
  assert.ok(fs.existsSync(PROTOCOL_SRC), `missing ${PROTOCOL_SRC}`);
  assert.ok(fs.existsSync(GO_SERVER_SRC), `missing ${GO_SERVER_SRC}`);

  const tsEndpoints = parseEndpointMap(fs.readFileSync(PROTOCOL_SRC, 'utf8'));
  const goRoutes = parseGoRoutes(fs.readFileSync(GO_SERVER_SRC, 'utf8'));

  assert.ok(tsEndpoints.size > 20, `expected many EndpointMap entries, got ${tsEndpoints.size}`);
  assert.ok(goRoutes.size > 20, `expected many Go routes, got ${goRoutes.size}`);

  // Core routes that MUST exist on both sides (Batch 3 / S2 focus).
  const required = [
    'GET /api/v1/health',
    'POST /api/v1/maven/detect',
    'POST /api/v1/maven/run',
    'GET /api/v1/maven/dependencies',
    'POST /api/v1/build/custom',
    'POST /api/v1/build/custom/{buildId}/cancel',
    'GET /api/v1/build/custom/{buildId}',
    'POST /api/v1/jvm/compile-incremental',
    'POST /api/v1/jvm/compile',
    'POST /api/v1/jvm/redefine',
    'POST /api/v1/java/detect',
    'POST /api/v1/java/run',
    'GET /api/v1/jdtls/distribution',
    'POST /api/v1/jdtls/project',
    'GET /api/v1/builds/{buildId}',
  ];

  const missingFromTs = [];
  const missingFromGo = [];
  for (const ep of required) {
    if (![...tsEndpoints].some(e => e === ep || endpointPath(e) === endpointPath(ep))) {
      missingFromTs.push(ep);
    }
    const want = endpointPath(ep);
    // Go registers prefix routes like /api/v1/build/custom/ for subs —
    // match exact or a registered prefix parent.
    const goHas =
      goRoutes.has(want) ||
      goRoutes.has(want.replace(/\/\{param\}$/, '')) ||
      goRoutes.has(want + '/') ||
      [...goRoutes].some(g => want.startsWith(g.replace(/\/$/, '') + '/') || g === want);
    if (!goHas) {
      missingFromGo.push(ep);
    }
  }

  assert.deepEqual(missingFromTs, [], `EndpointMap missing required endpoints: ${missingFromTs.join(', ')}`);
  assert.deepEqual(missingFromGo, [], `Go server.go missing required routes: ${missingFromGo.join(', ')}`);
});

test('EndpointMap DTO fields include requestId on envelope types', () => {
  const src = fs.readFileSync(PROTOCOL_SRC, 'utf8');
  assert.match(src, /requestId:\s*string/);
  assert.match(src, /correlationId/);
  assert.match(src, /BuildResult/);
  assert.match(src, /DeploymentResult/);
});

test('every EndpointMap path has a Go HandleFunc with the same path prefix', () => {
  const tsEndpoints = parseEndpointMap(fs.readFileSync(PROTOCOL_SRC, 'utf8'));
  const goRoutes = parseGoRoutes(fs.readFileSync(GO_SERVER_SRC, 'utf8'));

  // Known intentional gaps (protocol ahead of Go, or vice versa) — keep the
  // list short and explicit so new drift is still caught.
  const knownTsOnlyPrefixes = new Set([
    // (empty — BD-P1-4 HotSwap / JDT LS distribution routes are wired)
  ]);

  const orphanTs = [];
  for (const ep of tsEndpoints) {
    const p = endpointPath(ep);
    if (knownTsOnlyPrefixes.has(p)) continue;
    const covered = [...goRoutes].some(g => {
      const gBase = g.replace(/\/$/, '');
      const pBase = p.replace(/\/\{param\}/g, '').replace(/\/$/, '');
      return p === g || p.startsWith(gBase + '/') || gBase === pBase || pBase.startsWith(gBase);
    });
    if (!covered) orphanTs.push(ep);
  }

  assert.deepEqual(
    orphanTs,
    [],
    `EndpointMap entries with no Go HandleFunc prefix (add to knownTsOnlyPrefixes if intentional):\n${orphanTs.join('\n')}`,
  );
});
