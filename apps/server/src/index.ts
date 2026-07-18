/**
 * Kairo IDE — server entry.
 *
 * Hosts the Theia app + the Go Runtime Agent in the same
 * process. Reverse-proxies the agent under /api so the
 * browser-side client can talk to it without CORS.
 *
 * In a production deployment, place this behind a real
 * reverse proxy (nginx, Caddy) for TLS termination and
 * rate limiting. The built-in TLS support here is a
 * convenience for single-binary deployments.
 */

import { createServer, request as httpRequest, Server } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import type { AddressInfo } from 'net';

const args = parseArgs(process.argv.slice(2));
const BIND = args.bind ?? '127.0.0.1';
const PORT = Number(args.port ?? 8443);
const TLS_CERT = args['tls-cert'];
const TLS_KEY = args['tls-key'];
const DATA_DIR = args['data-dir'] ?? '/var/lib/kairo';
const RUNTIME_PORT_OVERRIDE = args['runtime-port'] ? Number(args['runtime-port']) : undefined;

let runtimeProc: ChildProcess | undefined;
let shuttingDown = false;

/**
 * Locate the kairo-runtime binary. Previously this resolved to
 * apps/bin/kairo-runtime, which never exists in any of our
 * layouts (CI builds to runtime-agent/bin, dev runs from source,
 * packages ship under extraResources/bin). Check the candidates
 * a developer would actually have on disk.
 */
function runtimeBinary(): string {
  const candidates: string[] = [
    process.env.KAIRO_RUNTIME_BIN,
    join(process.cwd(), 'runtime-agent', 'bin', 'kairo-runtime'),
    resolve(__dirname, '..', '..', 'runtime-agent', 'bin', 'kairo-runtime'),
    resolve(__dirname, '..', 'bin', 'kairo-runtime'),
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  // Fall back to the dev-layout path so the eventual spawn()
  // emits a clear ENOENT rather than a silent mis-route.
  return join(process.cwd(), 'runtime-agent', 'bin', 'kairo-runtime');
}

/**
 * Pick a free loopback port for the agent. Previously we did
 * `18099 + Math.floor(Math.random() * 100)` with no port-busy
 * check, so two server instances (or anything else bound in
 * that range) would race and the agent would fail to start.
 */
function pickFreePort(preferred?: number): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rejectP);
    srv.listen(preferred ?? 0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo | null;
      const port = addr?.port ?? 0;
      srv.close(() => resolveP(port));
    });
  });
}

function startRuntime(runtimePort: number): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const bin = runtimeBinary();
    if (!existsSync(bin)) {
      rejectP(new Error(`kairo-runtime binary not found at ${bin}. Build it with \`cd runtime-agent && go build -o bin/kairo-runtime ./cmd/kairo-runtime\`, or set KAIRO_RUNTIME_BIN.`));
      return;
    }
    runtimeProc = spawn(bin, [
      '--bind', '127.0.0.1',
      '--port', String(runtimePort),
      '--log-level', 'info',
      '--require-auth',
      '--data-dir', DATA_DIR,
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, KAIRO_DATA_DIR: DATA_DIR },
    });
    runtimeProc.on('error', rejectP);
    runtimeProc.on('exit', code => {
      console.error(`[kairo] runtime exited with code ${code}`);
      runtimeProc = undefined;
      if (!shuttingDown) {
        // If the agent dies unexpectedly we can't serve /api/*
        // anymore. Surface this and exit rather than 502-looping
        // every request forever.
        console.error('[kairo] runtime died unexpectedly, shutting down');
        shutdown(1);
      }
    });
    // Wait for /api/v1/health.
    const start = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${runtimePort}/api/v1/health`);
        if (res.ok) return resolveP();
      } catch (_) { /* not yet */ }
      if (Date.now() - start > 30_000) return rejectP(new Error('runtime did not start'));
      setTimeout(tick, 200);
    };
    tick();
  });
}

// Hop-by-hop headers that must not be forwarded by a proxy.
// RFC 7230 §6.1.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);

function stripHop(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Stream a regular HTTP request to the agent and pipe the
 * response back. Previously this buffered the entire request
 * body and entire response in memory — fine for tiny JSON but
 * it broke large file uploads/downloads and held every byte of
 * every /api/* request in the JS heap.
 */
function proxyHttp(req: import('http').IncomingMessage, res: import('http').ServerResponse, targetUrl: string): void {
  const u = new URL(targetUrl);
  const upstream = httpRequest({
    hostname: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
    method: req.method,
    headers: { ...stripHop(req.headers as Record<string, string | string[] | undefined>), host: u.host },
  }, up => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', err => {
    if (!res.headersSent) res.statusCode = 502;
    res.end(`proxy error: ${(err as Error).message}`);
  });
  // Surface client-side errors (client dropped the connection)
  // so we don't keep an upstream pipe open for nothing.
  req.on('error', err => {
    upstream.destroy(err instanceof Error ? err : new Error(String(err)));
    if (!res.headersSent) res.destroy();
  });
  req.pipe(upstream);
}

/**
 * Proxy a WebSocket upgrade to the agent. Previously the server
 * had no `upgrade` handler at all, so /api/v1/events (the
 * diagnostic event stream) was unreachable from the browser
 * when using the server form.
 */
function proxyUpgrade(req: import('http').IncomingMessage, socket: import('net').Socket, head: Buffer, runtimePort: number): void {
  if (!req.url) {
    socket.destroy();
    return;
  }
  const u = new URL(`http://127.0.0.1:${runtimePort}${req.url}`);
  const upstream = httpRequest({
    hostname: u.hostname,
    port: u.port,
    path: u.pathname + u.search,
    method: 'GET',
    headers: { ...stripHop(req.headers as Record<string, string | string[] | undefined>), host: u.host },
  });
  upstream.on('upgrade', (upRes, upSock, upHead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${k}: ${item}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push('', '');
    socket.write(lines.join('\r\n'));
    if (upHead.length) socket.unshift(upHead);
    upSock.pipe(socket);
    socket.pipe(upSock);
    const teardown = (err?: Error) => {
      if (err) console.error('[kairo] ws proxy error:', err.message);
      upSock.destroy();
      socket.destroy();
    };
    upSock.on('error', teardown);
    socket.on('error', teardown);
    upSock.on('close', () => socket.destroy());
    socket.on('close', () => upSock.destroy());
  });
  upstream.on('error', err => {
    console.error('[kairo] ws upstream error:', err.message);
    socket.destroy();
  });
  if (head && head.length) upstream.write(head);
  upstream.end();
}

function buildServer(runtimePort: number): Server {
  const handler = (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    if (req.url?.startsWith('/api/')) {
      proxyHttp(req, res, `http://127.0.0.1:${runtimePort}${req.url}`);
      return;
    }
    // Otherwise serve the Theia app.
    // (Real impl: serve the built bundle from apps/browser/lib.)
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><body><h1>Kairo IDE</h1>'
      + '<p>Server entry ready. The bundled Theia frontend is served from /static/.</p>'
      + '<p>Runtime agent listening on 127.0.0.1:' + runtimePort + '.</p>'
      + '</body></html>');
  };
  let server: Server;
  if (TLS_CERT && TLS_KEY) {
    // --tls-cert/--tls-key were parsed but never applied; every
    // "production" deployment via this entry was plain HTTP.
    let cert: Buffer;
    let key: Buffer;
    try {
      cert = readFileSync(TLS_CERT);
      key = readFileSync(TLS_KEY);
    } catch (err) {
      console.error(`[kairo] failed to load TLS cert/key: ${(err as Error).message}`);
      process.exit(1);
    }
    server = createHttpsServer({ cert, key }, handler);
  } else {
    if (BIND !== '127.0.0.1' && BIND !== 'localhost') {
      console.error('[kairo] WARNING: serving plain HTTP on a non-loopback interface. Pass --tls-cert and --tls-key.');
    }
    server = createServer(handler);
  }
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api/')) {
      proxyUpgrade(req, socket as import('net').Socket, head, runtimePort);
    } else {
      // Theia's own WebSocket upgrade (services, terminal, etc.)
      // is handled by Theia itself in a real deployment. Here
      // we only proxy /api/* to the agent.
      socket.destroy();
    }
  });
  return server;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out[key] = argv[i + 1];
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (runtimeProc) {
    try { runtimeProc.kill('SIGTERM'); } catch { /* already gone */ }
    // Give the agent up to 5s to flush, then SIGKILL.
    const killTimer = setTimeout(() => {
      try { runtimeProc?.kill('SIGKILL'); } catch { /* already gone */ }
    }, 5_000);
    killTimer.unref();
  }
  if (server) {
    server.close(() => process.exit(code));
    // If server.close stalls (lingering keep-alive conns), force exit.
    const forceTimer = setTimeout(() => process.exit(code), 8_000);
    forceTimer.unref();
  } else {
    process.exit(code);
  }
}

let server: Server | undefined;

async function main() {
  const runtimePort = RUNTIME_PORT_OVERRIDE ?? await pickFreePort(18099);
  await startRuntime(runtimePort);
  server = buildServer(runtimePort);
  server.listen(PORT, BIND, () => {
    const scheme = TLS_CERT && TLS_KEY ? 'https' : 'http';
    console.log(`[kairo] listening on ${scheme}://${BIND}:${PORT} (runtime at 127.0.0.1:${runtimePort})`);
  });
}

main().catch(err => {
  console.error('[kairo] fatal:', err);
  process.exit(1);
});

// SIGTERM was handled; SIGINT (Ctrl-C) was not, which meant
// every Ctrl-C in dev orphaned the agent process.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => shutdown(0));
}
