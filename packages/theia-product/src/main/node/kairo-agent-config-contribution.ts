/**
 * Kairo Agent Config — backend contribution.
 *
 * Exposes the Go Runtime Agent's URL and secret to the browser frontend.
 *
 * Two channels (both always registered when env is set):
 *   1. GET /kairo-agent-config.json — reliable same-origin fetch. Theia serves
 *      index.html via express.static/sendFile, so patching res.send alone often
 *      misses the HTML document (KAIRO-QA-002 root cause in browser mode).
 *   2. Best-effort HTML <script> injection into responses that use res.send /
 *      res.end with an HTML string containing </head> (Electron / some paths).
 *
 * Env vars read:
 *   KAIRO_AGENT_URL    — e.g. http://127.0.0.1:18080
 *   KAIRO_AGENT_SECRET — shared secret for X-Kairo-Secret header
 */

import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import type { Express, Request, Response, NextFunction } from 'express';

@injectable()
export class KairoAgentConfigContribution implements BackendApplicationContribution {
  configure(app: Express): void {
    const agentUrl = process.env.KAIRO_AGENT_URL || '';
    const agentSecret = process.env.KAIRO_AGENT_SECRET || '';

    // Always expose the endpoint so the frontend can discover whether an
    // agent was configured for this Theia process (empty url = not set).
    app.get('/kairo-agent-config.json', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ agentUrl, agentSecret });
    });

    if (!agentUrl) {
      return;
    }

    const scriptContent = [
      '(function(){',
      `  var u = ${JSON.stringify(agentUrl)};`,
      `  var s = ${JSON.stringify(agentSecret)};`,
      '  window.__kairo = {',
      '    agentBaseUrl: u,',
      '    getSecret: function() { return s; }',
      '  };',
      '  window.kairoConfig = {',
      '    agentUrl: u,',
      '    agentSecret: s,',
      '  };',
      '  window.__KAIRO_DEFAULT_RUNTIME_URL__ = u;',
      '})();',
    ].join('\n');

    const injectTag = `<script>${scriptContent}</script></head>`;

    const maybeInject = (body: unknown): unknown => {
      if (typeof body === 'string' && body.includes('</head>') && !body.includes('window.__kairo')) {
        return body.replace('</head>', injectTag);
      }
      if (Buffer.isBuffer(body)) {
        const text = body.toString('utf8');
        if (text.includes('</head>') && !text.includes('window.__kairo')) {
          return Buffer.from(text.replace('</head>', injectTag), 'utf8');
        }
      }
      return body;
    };

    // Best-effort: intercept res.send / res.end for in-memory HTML.
    // Static sendFile paths are covered by /kairo-agent-config.json instead.
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const originalSend = res.send.bind(res);
      const originalEnd = res.end.bind(res);

      res.send = function (body?: unknown): Response {
        return originalSend(maybeInject(body) as any);
      };

      (res as Response & { end: (...args: any[]) => any }).end = function (
        chunk?: unknown,
        encoding?: unknown,
        cb?: unknown,
      ): Response {
        if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
          chunk = maybeInject(chunk);
        }
        if (typeof encoding === 'function') {
          return originalEnd(chunk as any, encoding as any);
        }
        return originalEnd(chunk as any, encoding as any, cb as any);
      };

      next();
    });
  }
}
