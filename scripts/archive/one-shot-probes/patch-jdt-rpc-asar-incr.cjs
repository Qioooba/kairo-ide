/**
 * Incremental JDT RPC asar patch (keep proxy / already-open).
 * Expects artifacts/asar-jdt-rpc-patch already extracted.
 *   node scripts/test/patch-jdt-rpc-asar-incr.cjs
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
  if (!c.includes(from)) throw new Error('missing: ' + label);
  console.log('applied:', label);
  return c.replace(from, to);
}

let c = fs.readFileSync(bundlePath, 'utf8');

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
  'keep rpcProxy on transient'
);

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
  if (c.includes(from)) {
    c = c.replace(from, to);
    lifeApplied++;
  }
}
console.log(lifeApplied ? `applied: lifecycle already-open x${lifeApplied}` : 'already: lifecycle already-open');

// Frontend contribution settings (nice-to-have)
if (c.includes('implementationsCodeLens: { enabled: true },\n                    configuration: {')) {
  c = rep(
    c,
    `                    implementationsCodeLens: { enabled: true },
                    configuration: {
                      checkProjectSettingsExclusions: false,
                      updateBuildConfiguration: "interactive"
                    },`,
    `                    implementationsCodeLens: { enabled: true },
                    symbols: { includeSourceMethodDeclarations: true },
                    configuration: {
                      checkProjectSettingsExclusions: false,
                      updateBuildConfiguration: "interactive"
                    },`,
    'frontend JDT includeSourceMethodDeclarations'
  );
} else {
  console.log('skip/already: frontend symbols setting');
}

fs.writeFileSync(bundlePath, c);

// ── Backend main.js (actual JdtLsManager used by desktop) ──
const backendPath = path.join(workDir, 'lib', 'backend', 'main.js');
let b = fs.readFileSync(backendPath, 'utf8');

function repB(from, to, label) {
  if (b.includes(to) && !b.includes(from)) {
    console.log('already:', label);
    return;
  }
  if (!b.includes(from)) throw new Error('missing backend: ' + label);
  b = b.replace(from, to);
  console.log('applied:', label);
}

repB(
  `implementationsCodeLens:{enabled:!0},configuration:{checkProjectSettingsExclusions:!1,updateBuildConfiguration:"interactive"}`,
  `implementationsCodeLens:{enabled:!0},symbols:{includeSourceMethodDeclarations:!0},configuration:{checkProjectSettingsExclusions:!1,updateBuildConfiguration:"interactive"}`,
  'backend includeSourceMethodDeclarations'
);

// Backend didOpen/didChange no-op when not ready (source already fixed; asar may lag)
repB(
  `didOpen(e){if(!this.connection||this.state!=="ready")throw new Error(\`JDT LS not ready (state=\${this.state})\`);this.connection.sendNotification("textDocument/didOpen"`,
  `didOpen(e){if(!this.connection||this.state!=="ready")return;this.connection.sendNotification("textDocument/didOpen"`,
  'backend didOpen no-op'
);

repB(
  `didChange(e){if(!this.connection||this.state!=="ready")throw new Error(\`JDT LS not ready (state=\${this.state})\`);this.connection.sendNotification("textDocument/didChange"`,
  `didChange(e){if(!this.connection||this.state!=="ready")return;this.connection.sendNotification("textDocument/didChange"`,
  'backend didChange no-op'
);

// Handle workspace/configuration so JDT does not poison RPC
repB(
  `this.connection.onRequest("window/workDoneProgress/create",()=>null),this.connection.onRequest("client/registerCapability",()=>null),this.connection.onRequest("client/unregisterCapability",()=>null),this.connection.onNotification("$/progress"`,
  `this.connection.onRequest("window/workDoneProgress/create",()=>null),this.connection.onRequest("client/registerCapability",()=>null),this.connection.onRequest("client/unregisterCapability",()=>null),this.connection.onRequest("workspace/configuration",(e)=>((e==null?void 0:e.items)??[]).map((n)=>{const i={completion:{enabled:!0,guessMethodArguments:!0},import:{enabled:!0},format:{enabled:!0},references:{includeDecompiledSources:!0},signatureHelp:{enabled:!0},implementationsCodeLens:{enabled:!0},symbols:{includeSourceMethodDeclarations:!0},configuration:{checkProjectSettingsExclusions:!1,updateBuildConfiguration:"interactive"},trace:{server:process.env.KAIRO_JDT_TRACE==="verbose"?"verbose":"off"}};if(!n.section||n.section==="java")return i;if(n.section.startsWith("java.")){let r=i;for(const o of n.section.slice(5).split(".")){if(!r||typeof r!="object"||!(o in r))return null;r=r[o]}return r}return null})),this.connection.onNotification("$/progress"`,
  'backend workspace/configuration handler'
);

// Push didChangeConfiguration after initialized
repB(
  `this.connection.sendNotification("initialized",{}),this.setState("ready"),this.fire({kind:"initialized",result:c})`,
  `this.connection.sendNotification("initialized",{}),this.connection.sendNotification("workspace/didChangeConfiguration",{settings:{java:{completion:{enabled:!0,guessMethodArguments:!0},import:{enabled:!0},format:{enabled:!0},references:{includeDecompiledSources:!0},signatureHelp:{enabled:!0},implementationsCodeLens:{enabled:!0},symbols:{includeSourceMethodDeclarations:!0},configuration:{checkProjectSettingsExclusions:!1,updateBuildConfiguration:"interactive"},trace:{server:process.env.KAIRO_JDT_TRACE==="verbose"?"verbose":"off"}}}}),this.setState("ready"),this.fire({kind:"initialized",result:c})`,
  'backend didChangeConfiguration after init'
);

fs.writeFileSync(backendPath, b);

// Frontend: do not poison RPC on Unhandled method workspace/configuration
c = fs.readFileSync(bundlePath, 'utf8');
c = rep(
  c,
  `          if (this.isLifecycleNotReadyError(err)) {
            this.logger.info(\`[JavaLanguageClient] backend not ready yet (keeping RPC): \${String(err).slice(0, 200)}\`);
            return;
          }
          if (this.isTransientConnectionError(err)) {`,
  `          if (this.isLifecycleNotReadyError(err)) {
            this.logger.info(\`[JavaLanguageClient] backend not ready yet (keeping RPC): \${String(err).slice(0, 200)}\`);
            return;
          }
          if (String(err).includes("Unhandled method") || String(err).includes("workspace/configuration")) {
            this.logger.warn(\`[JavaLanguageClient] unhandled LSP method (keeping RPC): \${String(err).slice(0, 200)}\`);
            return;
          }
          if (this.isTransientConnectionError(err)) {`,
  'frontend keep RPC on Unhandled method'
);
fs.writeFileSync(bundlePath, c);

console.log('writing asar...');
asar.createPackage(workDir, asarPath).then(() => {
  console.log('packed', asarPath, fs.statSync(asarPath).size);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
