/**
 * Kairo Agent Config — backend contribution.
 *
 * Exposes the Go Runtime Agent's URL to the browser frontend.
 * The session secret is NEVER returned over unauthenticated channels,
 * embedded in HTML/inline script, or placed on window.kairoConfig
 * (XSS / view-source would otherwise yield full agent RCE).
 *
 * Secret delivery by mode:
 *   - Desktop Electron window: preload (`window.__kairo.getSecret`)
 *     holds the secret in a closure. HTML injection is skipped
 *     (KAIRO_AGENT_SECRET_VIA_PRELOAD=1 from the launcher).
 *   - Browser / headless desktop: no preload — the frontend fetches
 *     the secret once via same-origin GET /kairo-agent-secret.
 *     HTML injection sets agentUrl only.
 *
 * Channels:
 *   1. GET /kairo-agent-config.json — agentUrl only (never secret).
 *   2. GET /kairo-agent-secret — secret only, same-origin requests
 *      (Origin/Referer must match Host). Cache-Control: no-store.
 *   3. Best-effort HTML <script> injection into res.send / res.end
 *      bodies that contain </head> — agentUrl only (never secret).
 *
 * Env vars:
 *   KAIRO_AGENT_URL                — e.g. http://127.0.0.1:18080
 *   KAIRO_AGENT_SECRET             — served via /kairo-agent-secret
 *   KAIRO_AGENT_SECRET_VIA_PRELOAD — '1' → skip HTML injection
 */

import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import type { Express, Request, Response, NextFunction } from 'express';

/**
 * True when HTML injection should be skipped entirely because the
 * Electron preload already exposes URL + getSecret.
 */
export function shouldSkipHtmlAgentConfigInjection(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.KAIRO_AGENT_SECRET_VIA_PRELOAD === '1') return true;
  // Desktop Electron window path sets VIA_PRELOAD; headless sets
  // KAIRO_HEADLESS=1 and still needs URL injection (secret via endpoint).
  if (env.KAIRO_DESKTOP === '1' && env.KAIRO_HEADLESS !== '1') return true;
  return false;
}

/** @deprecated use shouldSkipHtmlAgentConfigInjection */
export function shouldInjectAgentSecret(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !shouldSkipHtmlAgentConfigInjection(env);
}

/**
 * Reject secret delivery when the request lacks a same-origin
 * Origin/Referer (blocks curl and cross-site fetches).
 */
export function isSameOriginAgentSecretRequest(req: Request): boolean {
  const host = req.get('host');
  if (!host) {
    return false;
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = req.get('referer');
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

/** Build the inline script body (no surrounding <script> tags). Never embeds secret. */
export function buildAgentConfigInjectScript(agentUrl: string): string {
  const lines = [
    '(function(){',
    `  var u = ${JSON.stringify(agentUrl)};`,
    '  if (!window.__kairo) {',
    '    window.__kairo = { agentBaseUrl: u };',
    '  } else if (!window.__kairo.agentBaseUrl) {',
    '    window.__kairo.agentBaseUrl = u;',
    '  }',
    '  window.kairoConfig = Object.assign({}, window.kairoConfig || {}, { agentUrl: u });',
    '  if (!window.__KAIRO_DEFAULT_RUNTIME_URL__) {',
    '    window.__KAIRO_DEFAULT_RUNTIME_URL__ = u;',
    '  }',
    '})();',
  ];
  return lines.join('\n');
}

@injectable()
export class KairoAgentConfigContribution implements BackendApplicationContribution {
  configure(app: Express): void {
    const agentUrl = process.env.KAIRO_AGENT_URL || '';
    const agentSecret = process.env.KAIRO_AGENT_SECRET || '';
    const skipHtmlInjection = shouldSkipHtmlAgentConfigInjection(process.env);

    // Always expose the endpoint so the frontend can discover whether an
    // agent was configured for this Theia process (empty url = not set).
    // Never include the secret — unauthenticated same-origin GET.
    app.get('/kairo-agent-config.json', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ agentUrl });
    });

    app.get('/kairo-agent-secret', (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!isSameOriginAgentSecretRequest(req)) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (!agentSecret) {
        res.status(404).json({ error: 'not configured' });
        return;
      }
      res.json({ secret: agentSecret });
    });

    if (!agentUrl || skipHtmlInjection) {
      return;
    }

    const scriptContent = buildAgentConfigInjectScript(agentUrl);
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
    // Static sendFile paths discover agentUrl via /kairo-agent-config.json
    // or this injection; secret comes from /kairo-agent-secret.
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
