#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const origPath = path.join(repoRoot, 'apps', 'browser', 'lib', 'frontend', 'bundle.js');
const destPath = path.join(repoRoot, 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');

fs.copyFileSync(origPath, destPath);
console.log('[patch-v6] Copied original bundle from apps/browser');

let bundle = fs.readFileSync(destPath, 'utf8');
let patchCount = 0;

// ============================================================
// PATCH 1: KairoCommands IIFE - add SHOW_WELCOME and TOGGLE_DEVTOOLS
// ============================================================
const openDiagDef = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const defIdx = bundle.indexOf(openDiagDef);
if (defIdx < 0) { console.error('[patch-v6] FATAL: OPEN_DEBUG_DIAGNOSTICS definition not found'); process.exit(1); }
const afterObj = defIdx + openDiagDef.length;
const newDefs = ',n.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  'n.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
bundle = bundle.substring(0, afterObj) + newDefs + bundle.substring(afterObj);
console.log('[patch-v6] ✓ Added SHOW_WELCOME and TOGGLE_DEVTOOLS command definitions');
patchCount++;

// ============================================================
// PATCH 2: Command handlers in registerCommands - add SHOW_WELCOME and TOGGLE_DEVTOOLS
// ============================================================
const termPattern = 'e.registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})';
const termIdx = bundle.indexOf(termPattern);
if (termIdx < 0) { console.error('[patch-v6] FATAL: TOGGLE_TERMINAL handler pattern not found'); process.exit(1); }
const termEndIdx = termIdx + termPattern.length;
const afterTerm = bundle.substring(termEndIdx, termEndIdx + 10);
if (!afterTerm.startsWith('}')) {
    console.warn('[patch-v6] WARNING: After TOGGLE_TERMINAL expected } but got:', JSON.stringify(afterTerm));
}
const newHandlers = ',e.registerCommand(Cn.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),' +
  'e.registerCommand(Cn.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
bundle = bundle.substring(0, termEndIdx) + newHandlers + bundle.substring(termEndIdx);
console.log('[patch-v6] ✓ Added SHOW_WELCOME and TOGGLE_DEVTOOLS command handlers');
patchCount++;

// ============================================================
// PATCH 3: Help menu entries
// ============================================================
const oldHelpEntry = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
if (!bundle.includes(oldHelpEntry)) { console.error('[patch-v6] FATAL: Help menu entry not found'); process.exit(1); }
const newHelpEntries = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
bundle = bundle.replace(oldHelpEntry, newHelpEntries);
console.log('[patch-v6] ✓ Added Help menu entries (Welcome, Toggle DevTools)');
patchCount++;

// ============================================================
// PATCH 4: Terminal default layout init error -> warn
//   Theia creates a default terminal on startup; if it fails
//   (e.g. no workspace open yet), it logs ERROR. This is not
//   a fatal condition - downgrade to warn.
// ============================================================
const termErrOld = 'console.error("Failed to initialize terminal in default layout",t)';
const termErrNew = 'console.warn("Failed to initialize terminal in default layout",t)';
if (!bundle.includes(termErrOld)) {
    console.error('[patch-v6] FATAL: Terminal error pattern not found'); process.exit(1);
}
bundle = bundle.replace(termErrOld, termErrNew);
console.log('[patch-v6] ✓ Downgraded terminal init error to warn');
patchCount++;

// ============================================================
// PATCH 5: JDT LS onProjectChanged - add robust retry logic for
//   "project not found" and "belongs to workspace X" race
//   conditions after import. Also parse the correct workspace
//   ID from "belongs to workspace ws_xxx" errors and retry
//   with the correct workspace.
//   Original: single try/catch that immediately logs error.
//   Patched: retry loop with 12 attempts, 2000ms delay,
//   extract correct workspace ID from error messages, wait
//   for workspace context to be ready.
// ============================================================
const jdtOldMethod = 'async onProjectChanged(e,t){try{let i=this.workspaceContext.requireContext(),r=e.workspaceId||i.workspaceId;if(this.logger.info(`Project changed: ${e.projectId}, ensuring JDT LS is prepared`),await this.runtime.request(`POST /api/v1/workspaces/${r}/java/prepare`,{projectId:e.projectId}),!this.isCurrentActivation(e,t))return;let o=await this.runtime.request(`GET /api/v1/workspaces/${r}/java/launch-descriptor`,void 0,{query:{projectId:e.projectId}});if(!this.isCurrentActivation(e,t))return;this.launchDescriptor=o,this.logger.info(`Launch descriptor received for project ${e.projectId}`),await this.startLanguageClient(o,e.projectId,t)}catch(i){this.logger.error(`Failed to prepare JDT LS for project ${e.projectId}: ${String(i)}`)}}';

if (!bundle.includes(jdtOldMethod)) {
    console.error('[patch-v6] FATAL: JDT onProjectChanged method pattern not found');
    console.error('[patch-v6] The bundle may have been updated. Please verify the method signature.');
    process.exit(1);
}

const jdtNewMethod = 'async onProjectChanged(e,t){const RETRY_MAX=12,RETRY_DELAY=2000;let lastErr;let forcedWsId=e.workspaceId||null;for(let attempt=0;attempt<=RETRY_MAX;attempt++){if(!this.isCurrentActivation(e,t))return;if(this.restartTimer){clearTimeout(this.restartTimer);this.restartTimer=void 0}this.restartAttempts=0;try{if(attempt===0){await new Promise(r=>setTimeout(r,5000))}else{this.logger.info(`JDT LS prepare retry ${attempt}/${RETRY_MAX} for project ${e.projectId}${forcedWsId?" (ws="+forcedWsId+")":""}`);await new Promise(r=>setTimeout(r,RETRY_DELAY))}if(!this.isCurrentActivation(e,t))return;let i=this.workspaceContext.requireContext(),r=forcedWsId||e.workspaceId||i.workspaceId;this.logger.info(`Project changed: ${e.projectId}, ensuring JDT LS is prepared (workspace=${r})`);await this.runtime.request(`POST /api/v1/workspaces/${r}/java/prepare`,{projectId:e.projectId});if(!this.isCurrentActivation(e,t))return;let o=await this.runtime.request(`GET /api/v1/workspaces/${r}/java/launch-descriptor`,void 0,{query:{projectId:e.projectId}});if(!this.isCurrentActivation(e,t))return;this.launchDescriptor=o,this.logger.info(`Launch descriptor received for project ${e.projectId}`),await this.startLanguageClient(o,e.projectId,t);return}catch(err){lastErr=err;const errMsg=String(err);const belongsMatch=/belongs to workspace (ws_[a-z0-9]+)/.exec(errMsg);if(belongsMatch&&belongsMatch[1]){forcedWsId=belongsMatch[1];this.logger.info(`JDT LS: project belongs to workspace ${forcedWsId}, will retry with correct workspace ID`)}const isRetryable=errMsg.includes("not found")||errMsg.includes("404")||errMsg.includes("belongs to workspace")||errMsg.includes("connection got disposed")||errMsg.includes("Pending response rejected")||errMsg.includes("connection is disposed")||errMsg.includes("Backend service not available");if(!isRetryable||attempt>=RETRY_MAX){this.logger.error(`Failed to prepare JDT LS for project ${e.projectId}: ${errMsg}`);return}this.logger.warn(`JDT LS prepare attempt ${attempt+1} failed for ${e.projectId} (${errMsg.slice(0,100)}), retrying...`)}}if(lastErr){this.logger.warn(`JDT LS prepare exhausted retries for project ${e.projectId}, waiting for workspace context change to retry: ${String(lastErr).slice(0,200)}`)}}';

bundle = bundle.replace(jdtOldMethod, jdtNewMethod);
console.log('[patch-v6] ✓ Patched JDT LS onProjectChanged with robust retry logic (12 attempts, 2000ms delay, workspace ID extraction)');
patchCount++;

// ============================================================
// PATCH 6: FileService.activateProvider - add retry delay
//   before throwing ENOPRO. Theia fires onWillActivateFileSystemProvider
//   and immediately checks for the provider; if registration happens
//   asynchronously (e.g. during workspace switch or jdt:// provider
//   registration after JDT LS starts), ENOPRO fires even though
//   the provider will be registered shortly after.
//   Add 10 retries with 500ms delay each (5 seconds total) to allow
//   async registration, and resolve silently on timeout.
// ============================================================
const enoproOld = 'async activateProvider(e){let t=this.providers.get(e);if(t)return t;let i=this.activations.get(e);if(!i){let r=new K7n.Deferred;this.activations.set(e,i=r.promise),g7.WaitUntilEvent.fire(this.onWillActivateFileSystemProviderEmitter,{scheme:e}).then(()=>{if(t=this.providers.get(e),t)r.resolve(t);else{let o=new Error;throw o.name="ENOPRO",o.message=`No file system provider found for scheme ${e}`,o}}).catch(o=>r.reject(o))}return i}';
if (!bundle.includes(enoproOld)) {
    console.error('[patch-v6] FATAL: activateProvider pattern not found');
    process.exit(1);
}
const enoproNew = 'async activateProvider(e){let t=this.providers.get(e);if(t)return t;let i=this.activations.get(e);if(!i){let r=new K7n.Deferred;this.activations.set(e,i=r.promise);let totalAttempts=0;const checkProvider=(retryCount)=>{totalAttempts++;t=this.providers.get(e);if(t){r.resolve(t);return}if(retryCount<60){setTimeout(()=>checkProvider(retryCount+1),500);return}console.warn(`[FileService] No file system provider found for scheme ${e} after ${totalAttempts} attempts (~30s); waiting indefinitely for provider to register`);const keepWaiting=()=>{t=this.providers.get(e);if(t){r.resolve(t);return}setTimeout(keepWaiting,1000)};setTimeout(keepWaiting,1000)};g7.WaitUntilEvent.fire(this.onWillActivateFileSystemProviderEmitter,{scheme:e}).then(()=>setTimeout(()=>checkProvider(0),100)).catch(o=>r.reject(o))}return i}';
bundle = bundle.replace(enoproOld, enoproNew);
console.log('[patch-v6] ✓ Patched FileService.activateProvider with 60x500ms fast retry + indefinite slow polling for async providers (jdt://)');
patchCount++;

// ============================================================
// PATCH 7: JavaLanguageClient - fix markRpcFailed to not
//   permanently disable the proxy for transient connection errors.
//   Also wrap start/stop/fetchState with retry logic that recreates
//   the proxy and retries on "connection got disposed" errors.
//
//   Original markRpcFailed: this.rpcFailed=!0,this.rpcProxy=void 0,
//     this.logger.warn(`[JavaLanguageClient] backend RPC failed...`)
//   Patched: check if error is transient; if so only reset proxy
//     (don't set rpcFailed=true) and warn; if permanent, set rpcFailed.
//
//   Original start: calls proxy.$start, on any catch calls markRpcFailed
//     then falls through to backend (which is undefined in Electron).
//   Patched start/stop/fetchState: retry up to 5 times with 1s base delay.
// ============================================================

// Patch markRpcFailed to distinguish transient from permanent errors
const markRpcOld = 'markRpcFailed(e){this.rpcFailed=!0,this.rpcProxy=void 0,this.logger.warn(`[JavaLanguageClient] backend RPC failed, falling back to in-process service: ${String(e)}`)}';
if (!bundle.includes(markRpcOld)) {
    console.error('[patch-v6] FATAL: markRpcFailed pattern not found');
    process.exit(1);
}
const markRpcNew = 'markRpcFailed(e){const msg=String(e);const isTransient=msg.includes("connection got disposed")||msg.includes("Pending response rejected")||msg.includes("WebSocket is not open")||msg.includes("connection closing");if(isTransient){this.rpcProxy=void 0;this.logger.warn(`[JavaLanguageClient] backend RPC connection transient error (will retry): ${msg.slice(0,200)}`);return}this.rpcFailed=!0,this.rpcProxy=void 0,this.logger.warn(`[JavaLanguageClient] backend RPC failed, falling back to in-process service: ${msg.slice(0,200)}`)}';
bundle = bundle.replace(markRpcOld, markRpcNew);
console.log('[patch-v6] ✓ Patched markRpcFailed to handle transient connection errors');
patchCount++;

// Patch proxy() to not permanently set rpcFailed when createProxy throws -
// the connection may just not be ready yet (e.g. during workspace startup)
const proxyOld = 'proxy(){if(!(this.rpcFailed||!this.connectionProvider)){if(!this.rpcProxy)try{this.rpcProxy=this.connectionProvider.createProxy(pPt,this)}catch(e){this.logger.warn(`[JavaLanguageClient] backend proxy unavailable, using in-process service: ${String(e)}`),this.rpcFailed=!0;return}return this.rpcProxy}}';
if (!bundle.includes(proxyOld)) {
    console.error('[patch-v6] FATAL: proxy() pattern not found');
    process.exit(1);
}
const proxyNew = 'proxy(){if(!this.connectionProvider){return}if(this.rpcFailed){return}if(!this.rpcProxy)try{this.rpcProxy=this.connectionProvider.createProxy(pPt,this)}catch(e){this.rpcProxy=void 0;if(String(e).includes("connection")||String(e).includes("WebSocket")||String(e).includes("disposed")){this.logger.warn(`[JavaLanguageClient] backend proxy not ready yet: ${String(e).slice(0,150)}`)}else{this.logger.warn(`[JavaLanguageClient] backend proxy unavailable: ${String(e).slice(0,150)}`);this.rpcFailed=!0}return}return this.rpcProxy}';
bundle = bundle.replace(proxyOld, proxyNew);
console.log('[patch-v6] ✓ Patched proxy() to not permanently fail on connection errors');
patchCount++;

// Patch start() to retry on transient errors
const startOld = 'async start(e){let t=this.proxy();if(t)try{return await t.$start(e)}catch(r){this.markRpcFailed(r)}if(!this.backend)return{ok:!1,reason:"Backend service not available"};let i=this.backend.inspect(e.home);if(!i.ok)return this.logger.warn(`[JavaLanguageClient] cannot start: ${i.reason}`),{ok:!1,reason:i.reason};try{return await this.backend.start(e),{ok:!0}}catch(r){return this.logger.error(`[JavaLanguageClient] start failed: ${String(r)}`),{ok:!1,reason:String(r)}}}';
if (!bundle.includes(startOld)) {
    console.error('[patch-v6] FATAL: start() pattern not found');
    process.exit(1);
}
const startNew = 'async start(e){for(let attempt=0;attempt<=2;attempt++){this.rpcFailed=!1;let t=this.proxy();if(t)try{return await t.$start(e)}catch(r){if(!String(r).includes("disposed")&&!String(r).includes("Pending response rejected")||attempt>=2){this.markRpcFailed(r);break}this.rpcProxy=void 0;await new Promise(res=>setTimeout(res,1000*(attempt+1)))}}if(!this.backend)return{ok:!1,reason:"Backend service not available"};let i=this.backend.inspect(e.home);if(!i.ok)return this.logger.warn(`[JavaLanguageClient] cannot start: ${i.reason}`),{ok:!1,reason:i.reason};try{return await this.backend.start(e),{ok:!0}}catch(r){return this.logger.error(`[JavaLanguageClient] start failed: ${String(r)}`),{ok:!1,reason:String(r)}}}';
bundle = bundle.replace(startOld, startNew);
console.log('[patch-v6] ✓ Patched JavaLanguageClient.start() with retry logic');
patchCount++;

// Patch fetchState() to retry on transient errors
const fetchStateOld = 'async fetchState(){let e=this.proxy();if(e)try{let t=await e.$state();return this.lastKnownState=t,t}catch(t){this.markRpcFailed(t)}return this.backend?this.backend.state():this.lastKnownState}';
if (!bundle.includes(fetchStateOld)) {
    console.error('[patch-v6] FATAL: fetchState() pattern not found');
    process.exit(1);
}
const fetchStateNew = 'async fetchState(){for(let attempt=0;attempt<=2;attempt++){this.rpcFailed=!1;let e=this.proxy();if(e)try{let t=await e.$state();return this.lastKnownState=t,t}catch(t){if(!String(t).includes("disposed")&&!String(t).includes("Pending response rejected")||attempt>=2){this.markRpcFailed(t);break}this.rpcProxy=void 0;await new Promise(res=>setTimeout(res,1000*(attempt+1)))}}return this.backend?this.backend.state():this.lastKnownState}';
bundle = bundle.replace(fetchStateOld, fetchStateNew);
console.log('[patch-v6] ✓ Patched JavaLanguageClient.fetchState() with retry logic');
patchCount++;

// ============================================================
// PATCH 8: startLanguageClientNow - re-throw transient connection
//   errors so that onProjectChanged's outer retry loop can handle
//   them. Without this, connection-disposed errors are caught and
//   logged inside startLanguageClientNow (triggering scheduleRestart
//   which has only 3 attempts with short delays) instead of being
//   retried by the more robust onProjectChanged retry loop (12 attempts
//   with 2s delays).
// ============================================================
const slcNowOld = 'async startLanguageClientNow(e,t,i){try{if(!this.desiredProject||i!==this.activationToken||this.disposed)return;let r=gNi(e);if(!e.workingDir||!r){this.logger.error(`Launch descriptor for project ${t} is missing workingDir or workspace data dir; cannot start JDT LS`);return}let o=bNi(e.workingDir),s=vNi(e),a=`${o}|${r}|${s??""}`,l=await this.javaClient.fetchState();if(!this.desiredProject||i!==this.activationToken||this.disposed)return;if(l==="starting"||l==="initializing"||l==="ready"){if(this.lastStartKey===a){this.logger.info(`JDT LS already ${l} for ${o}, not restarting`);return}if(await this.javaClient.stop(),!this.desiredProject||i!==this.activationToken||this.disposed)return}let c=await this.javaClient.start({rootUri:o,workspaceDataDir:r,home:s});c.ok?(this.lastStartKey=a,this.logger.info(`JDT LS start requested for ${o}`)):(this.logger.error(`JDT LS failed to start for project ${t}: ${c.reason}`),this.scheduleRestart())}catch(r){this.logger.error(`Failed to start JDT LS for project ${t}: ${String(r)}`),this.scheduleRestart()}}';
if (!bundle.includes(slcNowOld)) {
    console.error('[patch-v6] FATAL: startLanguageClientNow pattern not found');
    process.exit(1);
}
const slcNowNew = 'async startLanguageClientNow(e,t,i){try{if(!this.desiredProject||i!==this.activationToken||this.disposed)return;let r=gNi(e);if(!e.workingDir||!r){this.logger.error(`Launch descriptor for project ${t} is missing workingDir or workspace data dir; cannot start JDT LS`);return}let o=bNi(e.workingDir),s=vNi(e),a=`${o}|${r}|${s??""}`,l=await this.javaClient.fetchState();if(!this.desiredProject||i!==this.activationToken||this.disposed)return;if(l==="starting"||l==="initializing"||l==="ready"){if(this.lastStartKey===a){this.logger.info(`JDT LS already ${l} for ${o}, not restarting`);return}if(await this.javaClient.stop(),!this.desiredProject||i!==this.activationToken||this.disposed)return}let c=await this.javaClient.start({rootUri:o,workspaceDataDir:r,home:s});if(c.ok){this.lastStartKey=a,this.logger.info(`JDT LS start requested for ${o}`)}else{const errStr=String(c.reason);const isConnErr=errStr.includes("connection got disposed")||errStr.includes("Pending response rejected")||errStr.includes("Backend service not available")||errStr.includes("WebSocket is not open");if(isConnErr){this.logger.warn(`JDT LS connection transient error for ${t}, will retry: ${errStr.slice(0,200)}`);throw new Error(errStr)}this.logger.error(`JDT LS failed to start for project ${t}: ${c.reason}`),this.scheduleRestart()}}catch(r){const errStr=String(r);const isConnErr=errStr.includes("connection got disposed")||errStr.includes("Pending response rejected")||errStr.includes("connection is disposed")||errStr.includes("Backend service not available")||errStr.includes("WebSocket is not open");if(isConnErr){this.logger.warn(`JDT LS connection transient error for ${t}, will retry: ${errStr.slice(0,200)}`);throw r}this.logger.error(`Failed to start JDT LS for project ${t}: ${errStr}`),this.scheduleRestart()}}';
bundle = bundle.replace(slcNowOld, slcNowNew);
console.log('[patch-v6] ✓ Patched startLanguageClientNow to re-throw transient connection errors');
patchCount++;

// ============================================================
// PATCH 9: Add .catch to scheduleRestart's startLanguageClient
//   call to prevent unhandled promise rejections when transient
//   errors are thrown during restart attempts.
// ============================================================
const schedRestartOld = 'this.restartInFlight=!0,this.startLanguageClient(t,e.projectId,r).finally(async';
if (!bundle.includes(schedRestartOld)) {
    console.error('[patch-v6] FATAL: scheduleRestart pattern not found');
    process.exit(1);
}
const schedRestartNew = 'this.restartInFlight=!0,this.startLanguageClient(t,e.projectId,r).catch(()=>{}).finally(async';
bundle = bundle.replace(schedRestartOld, schedRestartNew);
console.log('[patch-v6] ✓ Added .catch to scheduleRestart startLanguageClient call');
patchCount++;

// ============================================================
// Verification
// ============================================================
if (bundle.includes('registry.registerCommand(Cn.SHOW_WELCOME') || bundle.includes('registry.registerCommand(Cn.TOGGLE_DEVTOOLS')) {
    console.error('[patch-v6] ✗ Stale registry.registerCommand references found - patch may be corrupt');
    process.exit(1);
}
console.log('[patch-v6] ✓ No stale registry.registerCommand references');

if (!bundle.includes('RETRY_MAX=12') || !bundle.includes('JDT LS prepare retry')) {
    console.error('[patch-v6] ✗ JDT retry patch verification failed');
    process.exit(1);
}
if (!bundle.includes('belongs to workspace')) {
    console.error('[patch-v6] ✗ JDT workspace ID extraction patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ JDT retry patch verified (12 retries, workspace extraction)');

if (!bundle.includes('console.warn("Failed to initialize terminal in default layout",t)')) {
    console.error('[patch-v6] ✗ Terminal warn patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ Terminal warn patch verified');

if (!bundle.includes('const checkProvider=') || !bundle.includes('waiting indefinitely for provider')) {
    console.error('[patch-v6] ✗ ENOPRO retry patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ ENOPRO retry patch verified (60 fast retries + indefinite slow polling)');

if (!bundle.includes('isTransient=msg.includes') || !bundle.includes('connection got disposed')) {
    console.error('[patch-v6] ✗ markRpcFailed transient patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ markRpcFailed transient error handling verified');

if (!bundle.includes('for(let attempt=0;attempt<=2;attempt++){this.rpcFailed=!1;let t=this.proxy()')) {
    console.error('[patch-v6] ✗ start() retry patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ start() retry logic verified');

if (!bundle.includes('for(let attempt=0;attempt<=2;attempt++){this.rpcFailed=!1;let e=this.proxy()')) {
    console.error('[patch-v6] ✗ fetchState() retry patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ fetchState() retry logic verified');

if (!bundle.includes('backend proxy not ready yet')) {
    console.error('[patch-v6] ✗ proxy() retry patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ proxy() not-permanent-fail verified');

if (!bundle.includes('JDT LS connection transient error')) {
    console.error('[patch-v6] ✗ startLanguageClientNow throw-on-transient patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ startLanguageClientNow transient error re-throw verified');

if (!bundle.includes('.catch(()=>{}).finally(async')) {
    console.error('[patch-v6] ✗ scheduleRestart catch patch verification failed');
    process.exit(1);
}
console.log('[patch-v6] ✓ scheduleRestart .catch() verified');

// Write patched bundle
fs.writeFileSync(destPath, bundle);
console.log(`[patch-v6] All ${patchCount} patches applied successfully. Bundle saved to ${destPath}`);
console.log(`[patch-v6] Bundle size: ${(bundle.length / 1024 / 1024).toFixed(2)} MB`);
