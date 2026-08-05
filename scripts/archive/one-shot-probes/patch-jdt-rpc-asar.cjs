/**
 * Patch packaged asar with JDT RPC + import-wizard URI fixes.
 *   node scripts/test/patch-jdt-rpc-asar.cjs
 *
 * Idempotent: safe to re-run on an already-patched extract/asar.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const repoRoot = path.resolve(__dirname, '..', '..');
const asarPath = path.join(repoRoot, 'apps', 'desktop', 'dist', 'run', 'resources', 'app.asar');
const workDir = path.join(repoRoot, 'artifacts', 'asar-jdt-rpc-patch');
const bundlePath = path.join(workDir, 'lib', 'frontend', 'bundle.js');

function rep(c, from, to, label) {
  if (c.includes(to) && !c.includes(from)) {
    console.log('already:', label);
    return c;
  }
  if (!c.includes(from)) {
    throw new Error('missing: ' + label);
  }
  console.log('applied:', label);
  return c.replace(from, to);
}

async function main() {
  console.log('extracting', asarPath);
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      break;
    } catch (err) {
      if (i === 4) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await asar.extractAll(asarPath, workDir);

  let c = fs.readFileSync(bundlePath, 'utf8');

  // --- Patch set A: lifecycle not-ready must not poison RPC ---
  if (!c.includes('isLifecycleNotReadyError(err)')) {
    c = rep(
      c,
      `markRpcFailed(err) {
          if (this.isTransientConnectionError(err)) {
            this.rpcProxy = void 0;
            this.logger.warn(\`[JavaLanguageClient] backend RPC connection transient error (will retry on next call): \${String(err).slice(0, 200)}\`);
            return;
          }
          this.rpcFailed = true;
          this.rpcProxy = void 0;
          this.logger.warn(\`[JavaLanguageClient] backend RPC failed, falling back to in-process service: \${String(err).slice(0, 200)}\`);
        }`,
      `isLifecycleNotReadyError(err) {
          const msg = String(err);
          return msg.includes("JDT LS not ready") || /state=(uninitialized|starting|initializing|stopping|stopped)/i.test(msg);
        }
        markRpcFailed(err) {
          if (this.isLifecycleNotReadyError(err)) {
            this.logger.info(\`[JavaLanguageClient] backend not ready yet (keeping RPC): \${String(err).slice(0, 200)}\`);
            return;
          }
          if (this.isTransientConnectionError(err)) {
            this.logger.warn(\`[JavaLanguageClient] backend RPC connection transient error (will retry on next call): \${String(err).slice(0, 200)}\`);
            return;
          }
          this.rpcFailed = true;
          this.rpcProxy = void 0;
          this.logger.warn(\`[JavaLanguageClient] backend RPC failed, falling back to in-process service: \${String(err).slice(0, 200)}\`);
        }`,
      'markRpcFailed lifecycle guard + keep proxy on transient'
    );
  } else {
    // Patch set B: already has lifecycle guard but still clears rpcProxy on transient
    c = rep(
      c,
      `          if (this.isTransientConnectionError(err)) {
            this.rpcProxy = void 0;
            this.logger.warn(\`[JavaLanguageClient] backend RPC connection transient error (will retry on next call): \${String(err).slice(0, 200)}\`);
            return;
          }`,
      `          if (this.isTransientConnectionError(err)) {
            this.logger.warn(\`[JavaLanguageClient] backend RPC connection transient error (will retry on next call): \${String(err).slice(0, 200)}\`);
            return;
          }`,
      'keep rpcProxy on transient (avoid already-open)'
    );
  }

  // Treat "already open" as transient
  c = rep(
    c,
    `        isTransientConnectionError(err) {
          const msg = String(err);
          return msg.includes("connection got disposed") || msg.includes("connection is disposed") || msg.includes("WebSocket is not open") || msg.includes("connection closing") || msg.includes("Pending response rejected");
        }`,
    `        isTransientConnectionError(err) {
          const msg = String(err);
          return msg.includes("connection got disposed") || msg.includes("connection is disposed") || msg.includes("WebSocket is not open") || msg.includes("connection closing") || msg.includes("Pending response rejected") || msg.includes("already open");
        }`,
    'isTransientConnectionError already-open'
  );

  // proxy() createProxy catch: already-open must not set rpcFailed
  c = rep(
    c,
    `            } catch (err) {
              this.rpcProxy = void 0;
              const msg = String(err);
              if (msg.includes("connection") || msg.includes("WebSocket") || msg.includes("disposed")) {
                this.logger.warn(\`[JavaLanguageClient] backend proxy not ready yet: \${msg.slice(0, 150)}\`);
              } else {
                this.logger.warn(\`[JavaLanguageClient] backend proxy unavailable: \${msg.slice(0, 150)}\`);
                this.rpcFailed = true;
              }
              return void 0;
            }`,
    `            } catch (err) {
              const msg = String(err);
              if (msg.includes("already open") || msg.includes("connection") || msg.includes("WebSocket") || msg.includes("disposed")) {
                this.logger.warn(\`[JavaLanguageClient] backend proxy not ready yet: \${msg.slice(0, 150)}\`);
              } else {
                this.logger.warn(\`[JavaLanguageClient] backend proxy unavailable: \${msg.slice(0, 150)}\`);
                this.rpcFailed = true;
              }
              return void 0;
            }`,
    'proxy createProxy already-open soft-fail'
  );

  if (!c.includes('this.updateConnectionStatus(state2)')) {
    c = rep(
      c,
      `onStateEvent(state2) {
          this.onStateEmitter.fire(state2);
        }`,
      `onStateEvent(state2) {
          this.updateConnectionStatus(state2);
          this.onStateEmitter.fire(state2);
        }`,
      'onStateEvent updates status'
    );
  } else {
    console.log('already: onStateEvent updates status');
  }

  if (c.includes('didOpen(params) {\n          if (!this.connection || this.state !== "ready") {\n            return;')) {
    console.log('already: didOpen no-op when not ready');
  } else {
    c = rep(
      c,
      `didOpen(params) {
          if (!this.connection || this.state !== "ready") {
            throw new Error(\`JDT LS not ready (state=\${this.state})\`);
          }
          this.connection.sendNotification("textDocument/didOpen", {`,
      `didOpen(params) {
          if (!this.connection || this.state !== "ready") {
            return;
          }
          this.connection.sendNotification("textDocument/didOpen", {`,
      'didOpen no-op when not ready'
    );
  }

  if (c.includes('didChange(params) {\n          if (!this.connection || this.state !== "ready") {\n            return;')) {
    console.log('already: didChange no-op when not ready');
  } else {
    c = rep(
      c,
      `didChange(params) {
          if (!this.connection || this.state !== "ready") {
            throw new Error(\`JDT LS not ready (state=\${this.state})\`);
          }
          this.connection.sendNotification("textDocument/didChange", {`,
      `didChange(params) {
          if (!this.connection || this.state !== "ready") {
            return;
          }
          this.connection.sendNotification("textDocument/didChange", {`,
      'didChange no-op when not ready'
    );
  }

  // Import wizard file:// URI (only if still bare)
  if (c.includes('await workspaceService.open(new import_uri57.default(importedSummary.root));')) {
    c = rep(
      c,
      `await workspaceService.open(new import_uri57.default(importedSummary.root));`,
      `await workspaceService.open(new import_uri57.default((() => { const root = String(importedSummary.root).replace(/\\\\/g, "/"); return root.startsWith("file:") ? root : ("file:///" + root.replace(/^\\/+/, "")); })()));`,
      'import wizard file:// URI'
    );
  } else {
    console.log('already: import wizard file:// URI');
  }

  // withRetry not-ready (only if still the old form)
  if (c.includes('[JavaLanguageClient] JDT LS not ready yet, retrying')) {
    console.log('already: withRetry not-ready retry');
  } else {
    c = rep(
      c,
      `              if (this.isPermanentRpcFailure(err)) break;
              if (!this.isTransientConnectionError(err) || attempt >= retries) break;
              const delay3 = Math.min(baseDelay * 2 ** attempt, 5e3);
              this.logger.info(\`[JavaLanguageClient] RPC transient error, retrying in \${delay3}ms (attempt \${attempt + 1}/\${retries})\`);`,
      `              if (this.isPermanentRpcFailure(err)) break;
              if (this.isLifecycleNotReadyError(err) && attempt < retries) {
                const delay3 = Math.min(baseDelay * 2 ** attempt, 5e3);
                this.logger.info(\`[JavaLanguageClient] JDT LS not ready yet, retrying in \${delay3}ms (attempt \${attempt + 1}/\${retries})\`);
                await new Promise((r9) => setTimeout(r9, delay3));
                continue;
              }
              if (!this.isTransientConnectionError(err) || attempt >= retries) break;
              const delay3 = Math.min(baseDelay * 2 ** attempt, 5e3);
              this.logger.info(\`[JavaLanguageClient] RPC transient error, retrying in \${delay3}ms (attempt \${attempt + 1}/\${retries})\`);`,
      'withRetry not-ready retry'
    );
  }

  // Lifecycle: treat already open as transient in start path (two variants)
  const lifePairs = [
    [
      `const isTransient = errMsg.includes("connection got disposed") || errMsg.includes("Pending response rejected") || errMsg.includes("Backend service not available") || errMsg.includes("WebSocket is not open");`,
      `const isTransient = errMsg.includes("connection got disposed") || errMsg.includes("Pending response rejected") || errMsg.includes("Backend service not available") || errMsg.includes("WebSocket is not open") || errMsg.includes("already open");`,
    ],
    [
      `const isTransient = errMsg.includes("connection got disposed") || errMsg.includes("Pending response rejected") || errMsg.includes("connection is disposed") || errMsg.includes("Backend service not available") || errMsg.includes("WebSocket is not open");`,
      `const isTransient = errMsg.includes("connection got disposed") || errMsg.includes("Pending response rejected") || errMsg.includes("connection is disposed") || errMsg.includes("Backend service not available") || errMsg.includes("WebSocket is not open") || errMsg.includes("already open");`,
    ],
  ];
  let lifeApplied = 0;
  for (const [from, to] of lifePairs) {
    if (c.includes(to) && !c.includes(from)) continue;
    if (!c.includes(from)) continue;
    c = c.replace(from, to);
    lifeApplied++;
  }
  console.log(lifeApplied ? `applied: lifecycle already-open transient x${lifeApplied}` : 'already: lifecycle already-open transient');

  fs.writeFileSync(bundlePath, c);
  console.log('writing asar...');
  await asar.createPackage(workDir, asarPath);
  console.log('packed', asarPath, fs.statSync(asarPath).size);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
