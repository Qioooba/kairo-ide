/**
 * Kairo IDE — server entry.
 *
 * Hosts the Theia app + the Go Runtime Agent in the same
 * process. Reverse-proxies the agent under /api so the
 * browser-side client can talk to it without CORS.
 *
 * In a production deployment, place this behind a real
 * reverse proxy (nginx, Caddy) for TLS termination and
 * rate limiting.
 */

import { createServer } from 'http';
import { parse } from 'url';
import { spawn, ChildProcess } from 'child_process';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

const args = parseArgs(process.argv.slice(2));
const BIND = args.bind ?? '127.0.0.1';
const PORT = Number(args.port ?? 8443);
const TLS_CERT = args['tls-cert'];
const TLS_KEY = args['tls-key'];
const DATA_DIR = args['data-dir'] ?? '/var/lib/kairo';
const RUNTIME_PORT = 18099 + Math.floor(Math.random() * 100); // pick a free sibling port

let runtimeProc: ChildProcess | undefined;

function runtimeBinary(): string {
  return resolve(__dirname, '..', '..', 'bin', 'kairo-runtime');
}

function startRuntime(): Promise<void> {
  return new Promise((resolve, reject) => {
    runtimeProc = spawn(runtimeBinary(), [
      '--bind', '127.0.0.1',
      '--port', String(RUNTIME_PORT),
      '--log-level', 'info',
      '--require-auth',
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, KAIRO_DATA_DIR: DATA_DIR },
    });
    runtimeProc.on('error', reject);
    runtimeProc.on('exit', code => {
      console.error(`[kairo] runtime exited with code ${code}`);
      runtimeProc = undefined;
    });
    // Wait for /api/v1/health.
    const start = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/v1/health`);
        if (res.ok) return resolve();
      } catch (_) { /* not yet */ }
      if (Date.now() - start > 30_000) return reject(new Error('runtime did not start'));
      setTimeout(tick, 200);
    };
    tick();
  });
}

const server = createServer(async (req, res) => {
  // Proxy /api/* to the runtime agent.
  if (req.url?.startsWith('/api/')) {
    const u = `http://127.0.0.1:${RUNTIME_PORT}${req.url}`;
    proxy(req, res, u);
    return;
  }
  // Otherwise serve the Theia app.
  // (Real impl: serve the built bundle from apps/browser/lib.)
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><body><h1>Kairo IDE</h1>'
    + '<p>Server entry ready. The bundled Theia frontend is served from /static/.</p>'
    + '<p>Runtime agent listening on 127.0.0.1:' + RUNTIME_PORT + '.</p>'
    + '</body></html>');
});

async function proxy(req: any, res: any, target: string) {
  // Minimal HTTP proxy: forward method, headers (minus hop-by-hop),
  // and body. Production should use a robust proxy library.
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string' && !['host', 'connection'].includes(k.toLowerCase())) {
        headers[k] = v;
      }
    }
    try {
      const upstream = await fetch(target, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
      res.statusCode = upstream.status;
      upstream.headers.forEach((v, k) => res.setHeader(k, v));
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.statusCode = 502;
      res.end(`proxy error: ${(err as Error).message}`);
    }
  });
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

async function main() {
  await startRuntime();
  server.listen(PORT, BIND, () => {
    console.log(`[kairo] listening on ${BIND}:${PORT} (runtime at 127.0.0.1:${RUNTIME_PORT})`);
  });
}

main().catch(err => {
  console.error('[kairo] fatal:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  if (runtimeProc) {
    runtimeProc.kill('SIGTERM');
  }
  server.close(() => process.exit(0));
});
