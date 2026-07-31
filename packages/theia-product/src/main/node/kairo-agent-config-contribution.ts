/**
 * Kairo Agent Config — backend contribution.
 *
 * Injects the Go Runtime Agent's URL and secret into the frontend
 * HTML so that BOTH the Electron shell (via preload) AND regular
 * browsers can connect to the agent. Without this middleware,
 * regular browsers cannot discover the agent's dynamic port and
 * secret — they would fall back to the hardcoded default port
 * 18080, which is rarely where the agent actually listens.
 *
 * The middleware intercepts every HTML response and injects a
 * <script> tag that sets `window.__kairo` (the same shape the
 * Electron preload script exposes) before any other script runs.
 *
 * Env vars read:
 *   KAIRO_AGENT_URL    — e.g. http://127.0.0.1:18080
 *   KAIRO_AGENT_SECRET — shared secret for X-Kairo-Secret header
 */

import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import type { Express } from 'express';

@injectable()
export class KairoAgentConfigContribution implements BackendApplicationContribution {
  configure(app: Express): void {
    const agentUrl = process.env.KAIRO_AGENT_URL || '';
    const agentSecret = process.env.KAIRO_AGENT_SECRET || '';

    if (!agentUrl) {
      // No agent URL configured — this is fine for dev/test where
      // the frontend falls back to the default port.
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

    // Intercept HTML responses and inject the config script.
    app.use((req, res, next) => {
      const originalSend = res.send.bind(res);
      res.send = function (body?: unknown): any {
        if (typeof body === 'string' && body.includes('</head>')) {
          body = body.replace('</head>', injectTag);
        }
        return originalSend(body);
      };
      next();
    });
  }
}