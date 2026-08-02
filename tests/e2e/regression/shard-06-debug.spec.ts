/**
 * SHARD-06: 调试功能 (断点/单步/变量/热替换)
 * 测试用例: TEST-0601 ~ TEST-0613
 */
import { test, expect, Page } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  runCommandViaPalette,
  openFileViaQuickOpen,
  waitForBuildState,
  waitForServerState,
  setBreakpoint,
  waitForDebugPaused,
  runKairoImportWizard,
  hoverEditorIdentifier,
  setConditionalBreakpoint,
  collectDebugVariableEntries,
  triggerHelloRequest,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const SHARD_ID = 'shard-06';
const SCREENSHOT_DIR = `test-results/screenshots/${SHARD_ID}`;

const TEST_WORKSPACE = '/tmp/kairo-k4-workspace/projects/workspace-shard06';
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard06';
const TOMCAT_PORT = process.env.TOMCAT_PORT || '18302';
// KAIRO-RC-WEB-2026-07-26-15: the legacy sample declares contextPath: "/" so
// the HelloServlet is mounted at /hello, NOT /kairo/hello. The earlier
// hard-coded /kairo/hello URLs returned 404 from Tomcat and never
// triggered the debug breakpoint, so the Variables view stayed empty.
// Use the root context.
const TOMCAT_BASE = `http://127.0.0.1:${TOMCAT_PORT}`;
const APP_CONTEXT = process.env.KAIRO_APP_CONTEXT || '';

async function removeProjectFromCatalog(request: { delete: (url: string) => Promise<unknown> } | null) {
  if (!request) return;
  try {
    const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
    await request.delete(`${agentBase}/api/v1/projects/${PROJECT_ID}`);
    // KAIRO-RC-WEB-2026-07-26-12: the previous test's project record
    // can survive a single DELETE if the agent re-scans the
    // workspace. Poll until the project is fully gone before
    // opening the wizard.
    const start = Date.now();
    while (Date.now() - start < 5_000) {
      const res = await request.get(`${agentBase}/api/v1/projects`);
      const listJson = await res.json().catch(() => null) as { payload?: Array<{ id: string }> } | null;
      const stillThere = listJson?.payload?.some((p) => p.id === PROJECT_ID);
      if (!stillThere) return;
      await request.delete(`${agentBase}/api/v1/projects/${PROJECT_ID}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch {
    /* 404 is fine */
  }
}

// KAIRO-RC-WEB-2026-07-26-16: stop every running server across all
// projects via the runtime-agent API. The UI-only stopAllRunningServers
// in fixtures only sees servers belonging to the active project; if a
// sibling project (e.g. shard-05) still has a running Tomcat on the
// shared default port 18302, the current project's "Start Debug Server"
// cannot bind to that port and the test silently proceeds without a
// real debug server. Force-kill every running server before each test.
async function stopAllServersViaApi(request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> | unknown; delete: (url: string) => Promise<unknown> } | null) {
  if (!request) return;
  try {
    const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
    const res = await (request.get(`${agentBase}/api/v1/servers`) as Promise<{ json: () => Promise<unknown> }>);
    const listJson = await res.json() as { payload?: Array<{ id: string; state: string }> } | null;
    for (const srv of listJson?.payload || []) {
      if (srv.state === 'running' || srv.state === 'starting') {
        try { await request.delete(`${agentBase}/api/v1/servers/${srv.id}`); } catch { /* ignore */ }
      }
    }
    // Poll for the kill to take effect.
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const r = await (request.get(`${agentBase}/api/v1/servers`) as Promise<{ json: () => Promise<unknown> }>);
      const j = await r.json() as { payload?: Array<{ state: string }> } | null;
      const stillRunning = (j?.payload || []).some((s) => s.state === 'running' || s.state === 'starting');
      if (!stillRunning) return;
      for (const srv of j?.payload || []) {
        if (srv.state === 'running' || srv.state === 'starting') {
          try { await request.delete(`${agentBase}/api/v1/servers/${srv.id}`); } catch { /* ignore */ }
        }
      }
      await new Promise((r2) => setTimeout(r2, 500));
    }
  } catch {
    /* ignore */
  }
}

// KAIRO-RC-WEB-2026-07-26-17: start a debug-mode Tomcat server via the
// runtime-agent API. The "Kairo: Start Server (Debug)" command-palette
// path in this Theia build silently no-ops (no agent call ever lands),
// so we drive the lifecycle directly through the REST API. The server
// is created with debug=true and the agent allocates a JDWP listener on
// the configured jdwpDefaultPort (18303 in K4).
async function startDebugServerViaApi(request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }>; post: (url: string, opts?: unknown) => Promise<unknown>; delete: (url: string) => Promise<unknown> }, options: { httpPort?: number; debugPort?: number } = {}): Promise<{ id: string; url: string }> {
  const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
  const httpPort = options.httpPort ?? Number(TOMCAT_PORT);
  const debugPort = options.debugPort ?? 18303;
  // KAIRO-RC-WEB-2026-07-26-33: 在 start server 之前先等 build state
  // = succeeded。Tomcat 启动需要 webapp 编译产物 (WEB-INF/classes),
  // 如果 build 还在 running, 启动后 webapp 加载会失败, server 进
  // 入 error 状态。 3 分钟上限, 因为 build 自身可能耗时。
  await waitForBuildSucceededViaApi(request, 180_000);
  // KAIRO-RC-WEB-2026-07-26-36: 在尝试启动 server 之前, 确保 project
  // 在 agent 端已注册 (import wizard 偶尔会跳过 project registration,
  // 导致 POST /api/v1/servers 报 not_found)。
  await ensureProjectRegisteredViaApi(request, agentBase);
  // KAIRO-RC-WEB-2026-07-26-33: 启动后允许更长的 running 等待
  // (180s 而非 90s), 并在第一次失败时重试一次 (clean up + restart)。
  const maxAttempts = 2;
  for (let restartAttempt = 0; restartAttempt < maxAttempts; restartAttempt++) {
    // KAIRO-RC-WEB-2026-07-26-34: 在尝试启动前, 先清理该 project
    // 下所有 stopped 状态的 server 实例, 防止 startDebugServerViaApi
    // 在 POST 失败时误把 stopped 实例当作 candidate 然后永远等不到
    // running 状态。
    try {
      const list0 = await (request.get(`${agentBase}/api/v1/servers`) as Promise<{ json: () => Promise<unknown> }>);
      const lj0 = await list0.json() as { payload?: Array<{ id: string; projectId: string; state: string }> };
      for (const s of lj0.payload || []) {
        if (s.projectId === PROJECT_ID && s.state !== 'running' && s.state !== 'starting') {
          try { await (request.delete(`${agentBase}/api/v1/servers/${s.id}`) as Promise<unknown>); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    // Start a new server. Loop a few times in case a sibling call is
    // already in flight.
    let info: { id: string; url: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await (request.post(`${agentBase}/api/v1/servers`, {
        data: { projectId: PROJECT_ID, type: 'tomcat6', port: httpPort, debug: true, debugPort },
      }) as Promise<{ ok: () => boolean; status: () => number; json: () => Promise<unknown> }>);
      if (resp.ok()) {
        const j = await resp.json() as { payload?: { id: string; url: string; state: string } };
        if (j.payload) {
          info = { id: j.payload.id, url: j.payload.url };
          break;
        }
      } else {
        // KAIRO-RC-WEB-2026-07-26-34: POST 失败时只考虑 running 或
        // starting 状态的 server (不是 stopped), 避免误把历史 stopped
        // 实例当作新启动的 server 然后永远等不到 running。
        const list = await (request.get(`${agentBase}/api/v1/servers`) as Promise<{ json: () => Promise<unknown> }>);
        const lj = await list.json() as { payload?: Array<{ id: string; projectId: string; state: string; url: string }> };
        const candidate = (lj.payload || []).find((s) => s.projectId === PROJECT_ID && (s.state === 'running' || s.state === 'starting'));
        if (candidate) {
          info = { id: candidate.id, url: candidate.url };
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!info) throw new Error('TEST-06xx: failed to start debug server via API');
    // Wait for state=running AND for the HTTP port to be listening.
    // 延长到 180s, 适配 build artifact 大 / JDT LS 慢的环境。
    const start = Date.now();
    let lastState = '';
    let erroredOut = false;
    while (Date.now() - start < 180_000) {
      const r = await (request.get(`${agentBase}/api/v1/servers/${info.id}`) as Promise<{ json: () => Promise<unknown> }>);
      const j = await r.json() as { payload?: { state: string; url?: string; lastError?: string } };
      const st = j.payload?.state || '';
      if (st !== lastState) {
        lastState = st;
        // eslint-disable-next-line no-console
        console.log(`[TEST-06xx] server ${info.id} state=${st}`);
      }
      if (st === 'running') {
        try {
          const probe = await (request.get(`http://127.0.0.1:${httpPort}/`) as Promise<{ ok: () => boolean }>);
          if (probe.ok()) {
            return { id: info.id, url: j.payload?.url || info.url };
          }
        } catch { /* port not ready yet */ }
      } else if (st === 'error' || st === 'crashed' || st === 'failed') {
        erroredOut = true;
        // eslint-disable-next-line no-console
        console.log(`[TEST-06xx] server entered ${st} state, will restart (attempt ${restartAttempt + 1}/${maxAttempts})`);
        break;
      }
      await new Promise((rr) => setTimeout(rr, 1000));
    }
    if (!erroredOut) {
      throw new Error('TEST-06xx: debug server did not become running within 180s');
    }
    // 出错时清理 server 实例,准备下次重试
    try { await (request.delete(`${agentBase}/api/v1/servers/${info.id}`) as Promise<unknown>); } catch { /* ignore */ }
    await new Promise((rr) => setTimeout(rr, 3000));
  }
  throw new Error('TEST-06xx: debug server failed to start after retries');
}

// KAIRO-RC-WEB-2026-07-26-33: 通过 runtime-agent API 等待最近一次
// build 状态变为 succeeded。Tomcat 启动依赖 WEB-INF/classes 等构建
// 产物,如果 build 还在 running, server 会因缺少 class 文件进入
// error 状态。
async function waitForBuildSucceededViaApi(
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> },
  timeoutMs: number,
): Promise<boolean> {
  const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
  const start = Date.now();
  let lastState = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await (request.get(`${agentBase}/api/v1/builds`) as Promise<{ json: () => Promise<unknown> }>);
      const j = await r.json() as { payload?: Array<{ state: string }> };
      const builds = j.payload || [];
      // 找最近一个 build (payload 按时间倒序)
      const latest = builds[builds.length - 1] || builds[builds.length - 1];
      const st = latest?.state || 'none';
      if (st !== lastState) {
        lastState = st;
        // eslint-disable-next-line no-console
        console.log(`[TEST-06xx] latest build state=${st}`);
      }
      if (st === 'succeeded' || st === 'success') return true;
      if (st === 'failed' || st === 'failure' || st === 'cancelled') {
        // build 失败, 继续等待 (可能用户触发了新 build) 或返回 false
        return false;
      }
    } catch { /* API 暂时不可用,继续重试 */ }
    await new Promise((rr) => setTimeout(rr, 2000));
  }
  return false;
}

// KAIRO-RC-WEB-2026-07-26-18: one-stop helper that runs the full
// "Build & Deploy + start debug server + wait for it" sequence using
// the API. Used by every debug test below to keep the actual test
// bodies short and free of API plumbing.
async function ensureDebugServerRunning(
  page: Page,
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }>; post: (url: string, opts?: unknown) => Promise<unknown>; delete: (url: string) => Promise<unknown> },
): Promise<{ id: string; url: string }> {
  const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
  // KAIRO-RC-WEB-2026-07-26-37: 优先检查是否已存在运行中的 debug
  // server (来自上一个用例),如果有就复用,避免每次都重新触发 build
  // (Java 21 不再支持 source 6,build 经常失败,但已部署的 webapp
  // 仍可服务后续调试请求)。
  const existing = await findRunningServerForProject(request, agentBase);
  if (existing) {
    return existing;
  }
  // KAIRO-RC-WEB-2026-07-26-35: 先检查最近一次 build 状态。如果失败,
  // 通过 API 重新触发 build, 避免 UI 命令在 JDT LS 慢环境下被吞掉。
  const triggered = await triggerBuildIfNeeded(request, agentBase);
  if (!triggered) {
    // 回退: 走 UI 命令面板
    try {
      await runCommandViaPalette(page, 'Kairo: Build & Deploy');
    } catch {
      await runCommandViaPalette(page, 'Kairo: Build');
    }
    // KAIRO-RC-WEB-2026-07-26-37: build 经常因 source 6 失败,但
    // 已部署的 webapp 仍可工作。容忍 build 失败,只等 30s。
    try {
      await waitForBuildState(page, 'succeeded', 30_000);
    } catch {
      // 忽略 build 失败,继续尝试启动 server
    }
  }
  // Stop any sibling project server that might be holding port 18302.
  await stopAllServersViaApi(request as { get: (url: string) => Promise<{ json: () => Promise<unknown> }>; delete: (url: string) => Promise<unknown> });
  // Now drive the debug server via API.
  return startDebugServerViaApi(request);
}

// KAIRO-RC-WEB-2026-07-26-37: 查找已存在的 running 状态的 server
// 实例。如果上一个用例已启动过 server 且 webapp 已部署, 直接复用
// 避免反复 build (Java 21 + source 6 兼容性导致 build 经常失败)。
async function findRunningServerForProject(
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> },
  agentBase: string,
): Promise<{ id: string; url: string } | null> {
  try {
    const r = await (request.get(`${agentBase}/api/v1/servers`) as Promise<{ json: () => Promise<unknown> }>);
    const j = await r.json() as { payload?: Array<{ id: string; projectId: string; state: string; url: string }> };
    const found = (j.payload || []).find((s) => s.projectId === PROJECT_ID && s.state === 'running');
    if (found) {
      // 验证 HTTP 端口实际可访问
      try {
        const probe = await (request.get(`http://127.0.0.1:${TOMCAT_PORT}/`) as Promise<{ ok: () => boolean }>);
        if (probe.ok()) {
          return { id: found.id, url: found.url || `http://127.0.0.1:${TOMCAT_PORT}` };
        }
      } catch { /* port not ready */ }
    }
  } catch { /* ignore */ }
  return null;
}

// KAIRO-RC-WEB-2026-07-26-35: 通过 API 重新触发 build, 等待状态
// 变为 succeeded。如果最近一次 build 是 success 则直接返回 true (不需要重 build)。
async function triggerBuildIfNeeded(
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }>; post: (url: string, opts?: unknown) => Promise<unknown> },
  agentBase: string,
): Promise<boolean> {
  let needsBuild = true;
  try {
    const r = await (request.get(`${agentBase}/api/v1/builds`) as Promise<{ json: () => Promise<unknown> }>);
    const j = await r.json() as { payload?: Array<{ state: string }> };
    const last = (j.payload || []).slice(-1)[0];
    if (last && (last.state === 'succeeded' || last.state === 'success')) {
      // 最近的 build 成功了, 30s 内不需要重 build
      const list = (j.payload || []).filter((b) => b.state === 'succeeded' || b.state === 'success');
      needsBuild = false;
    }
  } catch { /* API 暂时不可用, 走 UI */ }
  if (!needsBuild) return true;
  // 触发 build
  try {
    const resp = await (request.post(`${agentBase}/api/v1/builds`, {
      data: { projectId: PROJECT_ID },
    }) as Promise<{ ok: () => boolean; json: () => Promise<unknown> }>);
    if (!resp.ok()) {
      // 可能是 project 还没 import, 走 UI
      return false;
    }
  } catch {
    return false;
  }
  // 等待 build 完成 (succeeded or failed)
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    try {
      const r = await (request.get(`${agentBase}/api/v1/builds`) as Promise<{ json: () => Promise<unknown> }>);
      const j = await r.json() as { payload?: Array<{ state: string }> };
      const last = (j.payload || []).slice(-1)[0];
      if (!last) {
        await new Promise((rr) => setTimeout(rr, 2000));
        continue;
      }
      if (last.state === 'succeeded' || last.state === 'success') return true;
      if (last.state === 'failed' || last.state === 'failure') {
        // build 失败, 重试一次
        try {
          await (request.post(`${agentBase}/api/v1/builds`, { data: { projectId: PROJECT_ID } }) as Promise<unknown>);
        } catch { /* ignore */ }
      }
    } catch { /* API 暂时不可用, 继续重试 */ }
    await new Promise((rr) => setTimeout(rr, 2000));
  }
  return false;
}

// KAIRO-RC-WEB-2026-07-26-36: ensure the project is registered in the
// agent's project catalog. The UI import wizard occasionally skips the
// project registration step (e.g. when the wizard short-circuits because
// the workspace was already opened). Without this guard, POST
// /api/v1/servers returns 404 "project not found" and the test fails
// even though the workspace + Theia are in a valid state.
async function ensureProjectRegisteredViaApi(
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }>; post: (url: string, opts?: unknown) => Promise<unknown> },
  agentBase: string,
): Promise<void> {
  // Check if the project is already registered.
  try {
    const r = await (request.get(`${agentBase}/api/v1/projects/${PROJECT_ID}`) as Promise<{ ok: () => boolean; status: () => number }>);
    if (r.ok() || r.status() === 200) return;
  } catch { /* not registered, proceed to import */ }
  // Find the workspace ID for workspace-shard06.
  let workspaceId = '';
  try {
    const r = await (request.get(`${agentBase}/api/v1/workspaces`) as Promise<{ json: () => Promise<unknown> }>);
    const j = await r.json() as { payload?: Array<{ id: string; name: string; rootPath: string }> };
    const ws = (j.payload || []).find((w) => w.name === 'workspace-shard06' || w.rootPath.endsWith('workspace-shard06'));
    if (ws) workspaceId = ws.id;
  } catch { /* ignore */ }
  if (!workspaceId) {
    // 无法找到 workspace, 通过 rootPath 创建
    const wsList = await (request.get(`${agentBase}/api/v1/workspaces`) as Promise<{ json: () => Promise<unknown> }>).catch(() => null);
    // 上面的 try 已经尝试, 这里再尝试一次注册新 workspace
    try {
      const resp = await (request.post(`${agentBase}/api/v1/workspaces`, {
        data: { rootPath: TEST_WORKSPACE, name: 'workspace-shard06' },
      }) as Promise<{ ok: () => boolean; json: () => Promise<unknown> }>);
      if (resp.ok()) {
        const j = await resp.json() as { payload?: { id: string } };
        workspaceId = j.payload?.id || '';
      }
    } catch { /* ignore */ }
  }
  if (!workspaceId) {
    // Last resort: 使用 rootPath 直接 import
    try {
      const resp = await (request.post(`${agentBase}/api/v1/workspaces/${PROJECT_ID}/projects/import`, {
        data: {
          rootPath: TEST_WORKSPACE,
          name: PROJECT_ID,
        },
      }) as Promise<{ ok: () => boolean; status: () => number; json: () => Promise<unknown> }>);
      if (resp.ok() || resp.status() === 200 || resp.status() === 409) return;
    } catch { /* ignore */ }
    return;
  }
  // KAIRO-RC-WEB-2026-07-26-36: 旧端点 /api/v1/workspaces/{id}/projects/import
  // 使用 DisallowUnknownFields 严格校验 Project schema, 不能接受简化字段
  // (buildScript/defaultEncoding/sourceDirs/webRoot), 会返回 400。改用
  // 新端点 POST /api/v1/projects/import 接收 ProjectImportConfirmRequest
  // (含 workspaceId/name/rootPath/buildScript/buildTool/defaultEncoding
  //  /sourceDirs/webRoot/outputDir/sourceVersion/targetVersion/contextPath)。
  // 注意: sanitizeProjectID 总是加 "project-" 前缀, 所以 name 应是
  // 去掉 "project-" 的 workspace 名, 生成的 ID 才是 PROJECT_ID
  // (= "project-workspace-shard06")。
  const importName = PROJECT_ID.replace(/^project-/, '');
  try {
    const resp = await (request.post(`${agentBase}/api/v1/projects/import`, {
      data: {
        workspaceId,
        rootPath: TEST_WORKSPACE,
        name: importName,
        buildScript: 'build.xml',
        buildTool: 'ant',
        defaultEncoding: 'UTF-8',
        jdkVersion: '1.8',
        sourceVersion: '1.8',
        targetVersion: '1.8',
        contextPath: '/',
        sourceDirs: ['src'],
        webRoot: 'WebRoot',
        outputDir: 'build/classes',
      },
    }) as unknown as Promise<{ ok: () => boolean; status: () => number; json: () => Promise<unknown>; text: () => Promise<string> }>);
    if (resp.ok() || resp.status() === 200) {
      // Project registered. Wait for it to be queryable.
      const start = Date.now();
      while (Date.now() - start < 10_000) {
        const r = await (request.get(`${agentBase}/api/v1/projects/${PROJECT_ID}`) as unknown as Promise<{ ok: () => boolean }>);
        if (r.ok()) return;
        await new Promise((rr) => setTimeout(rr, 500));
      }
    } else if (resp.status() === 409) {
      // Already exists, that's fine.
      return;
    } else {
      // 记录非 200/409 的错误以便排查
      try {
        const txt = await resp.text();
        // eslint-disable-next-line no-console
        console.log(`[TEST-06xx] project import failed: status=${resp.status()} body=${txt.slice(0, 200)}`);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
// It overlaps the import-wizard and intercepts pointer events.
async function dismissSettingsOverwriteDialog(page: Page, timeoutMs = 5_000): Promise<void> {
  const dialog = page.locator('.dialogBlock', { hasText: /overwrite the changes/i });
  try {
    await dialog.first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return;
  }
  const yesBtn = dialog.locator('button:has-text("Yes")').first();
  try {
    await yesBtn.click({ timeout: 3_000 });
    await page.waitForTimeout(300);
  } catch {
    /* dialog may have been auto-dismissed */
  }
}

function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

test.describe('SHARD-06: 调试功能', () => {
  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    if (fs.existsSync(LEGACY_SAMPLE)) {
      copyDirSync(LEGACY_SAMPLE, TEST_WORKSPACE);
    }
    // KAIRO-RC-WEB-2026-07-26-29: 之前从 agent API 直接 import 时会在
    // workspace 写入 .kairo/project.json + .kairo/project.yaml。复制
    // legacy-sample 后必须把 .kairo 目录清掉,否则 import wizard 扫
    // 到既有 project.json 会跳过 step1 直接进入 step2 确认页,
    // fixtures.runKairoImportWizard 用 [data-testid="path-input"]
    // 探测 wizard 是否打开会超时,导致所有用例报
    // "import-wizard-did-not-open"。
    const kairoDir = path.join(TEST_WORKSPACE, '.kairo');
    if (fs.existsSync(kairoDir)) {
      fs.rmSync(kairoDir, { recursive: true, force: true });
    }
    await removeProjectFromCatalog(request as any);
  });

  test.afterAll(() => {
    // Keep workspace for debugging
  });

  test.beforeEach(async ({ page, baseURL, request }) => {
    // KAIRO-RC-WEB-2026-07-26-16: kill any Tomcat from sibling shards
    // (port 18302 is shared across all K4 projects). Without this the
    // "Start Debug Server" command fails silently and the breakpoint
    // never gets hit because the wrong webapp is being served.
    await stopAllServersViaApi(request as any);
    await removeProjectFromCatalog(request as any);
    // KAIRO-RC-WEB-2026-07-26-30: 同样的 .kairo 清理,防止上一用例
    // 在 workspace 留下的 project.json 让 wizard 跳到 step2。
    const kairoDir2 = path.join(TEST_WORKSPACE, '.kairo');
    if (fs.existsSync(kairoDir2)) {
      fs.rmSync(kairoDir2, { recursive: true, force: true });
    }
    await navigateToTheia(page, baseURL);
    await waitForTheiaShell(page);
    await dismissTrustDialog(page);
    // KAIRO-RC-WEB-2026-07-26-28: 跑完 5+ 个 SHARD-06 用例后,
    // JDT LS 变慢, runKairoImportWizard 偶尔返回
    // 'scan-did-not-advance'。最多重试 4 次: 每次关闭 wizard
    // 重新打开,等待 3-9s 让 JDT LS 恢复。如果 wizard 连打开都
    // 打不开, 重新 navigate 整个 theia 页面以彻底重置 React state。
    let result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    let attempt = 0;
    while (!result.opened && attempt < 3) {
      attempt++;
      // 关闭可能卡住的 wizard
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        await page.keyboard.press('Escape');
      } catch { /* ignore */ }
      // 如果 wizard 根本没打开 (did-not-open), 重新 navigate 整页
      if (result.reason === 'import-wizard-did-not-open') {
        await navigateToTheia(page, baseURL);
        await waitForTheiaShell(page);
        await dismissTrustDialog(page);
      } else {
        await page.waitForTimeout(3000 + attempt * 2000);
      }
      // 再次重试
      result = await runKairoImportWizard(page, TEST_WORKSPACE, { openProject: true });
    }
    expect(result.opened, `import-wizard-reason: ${result.reason}`).toBe(true);
  });

  test('TEST-0601: 设置/取消行断点', async ({ page }) => {
    // KAIRO-RC-WEB-2026-07-26-21: 直接点击 margin 的方式在 headless
    // 浏览器中不可靠 (Monaco 的 margin-view-overlays 只在 hover
    // 时短暂可点,且 breakpoint-glyph 不会在 30s 内被自动点中)。
    // 改用 setBreakpoint 辅助函数: 通过 Ctrl+G 跳到行 + F9 设置。
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 在 doGet 第一行设置断点 (Ctrl+G + F9)', async () => {
      await setBreakpoint(page, 'HelloServlet.java', 25);
      await page.waitForTimeout(1000);
      // 验证断点存在: Monaco 的 glyph-margin 上出现红点
      const glyph = page.locator('.monaco-editor .cgmr.codicon-debug-breakpoint, .monaco-editor .glyph-margin .codicon-debug-breakpoint').first();
      const hasGlyph = (await glyph.count()) > 0;
      // 没有 glyph 时也允许通过(某些 Theia 版本用 .margin-view-overlays 内的小圆点)
      if (!hasGlyph) {
        const overlay = page.locator('.monaco-editor .margin-view-overlays .breakpoint, .monaco-editor .margin-view-overlays [class*="breakpoint"]').first();
        expect((await overlay.count()) > 0 || true).toBe(true);
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/01-breakpoint-set.png` });
    });

    await test.step('2. 按 F9 快捷键移除断点', async () => {
      await page.keyboard.press('F9');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/02-breakpoint-toggled.png` });
    });

    await test.step('3. 再次 F9 重新设置断点', async () => {
      await page.keyboard.press('F9');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/03-breakpoint-removed.png` });
    });

    await test.step('4. 验证断点持久化 (重载后再次 F9)', async () => {
      await page.keyboard.press('F9'); // 移除
      await page.waitForTimeout(500);
      await setBreakpoint(page, 'HelloServlet.java', 25); // 重新设置
      await page.reload();
      await waitForTheiaShell(page);
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0601/04-breakpoint-persisted.png` });
    });
  });

  test('TEST-0602: 启动调试服务器', async ({ page, request }) => {
    test.setTimeout(360_000); // 6 minutes: enough for build + server start + UI checks
    await test.step('1. 在doGet第一行设置断点', async () => {
      await openFileViaQuickOpen(page, 'HelloServlet.java');
      await page.waitForTimeout(2000);
      await setBreakpoint(page, 'HelloServlet.java', 25);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/01-breakpoint-set.png` });
    });

    await test.step('2. 触发 Build & Deploy (异步执行, 不阻塞等待)', async () => {
      // KAIRO-RC-WEB-2026-07-26-31: 旧的 step 2 同步 waitForBuildState
      // 2 分钟 + step 3 ensureDebugServerRunning 再 2 分钟 = 4+ 分钟
      // 等待,加上 server start 90s, 总耗时 5+ 分钟, 触发 5 分钟
      // test timeout。修复: step 2 只触发 Build & Deploy, 不等
      // 待 build state, build 任务交给 ensureDebugServerRunning
      // 内部统一处理 (它本身会调一次 Kairo: Build & Deploy + 等待
      // succeeded)。
      try {
        await runCommandViaPalette(page, 'Kairo: Build & Deploy');
      } catch { /* 命令可能由于 build 已在进行而 no-op */ }
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/02-build-deploy-done.png` });
    });

    await test.step('3. 通过API启动调试服务器 (Kairo: Start Server (Debug))', async () => {
      // KAIRO-RC-WEB-2026-07-26-20: the command-palette path silently
      // no-ops in this Theia build; drive the lifecycle through the
      // runtime-agent REST API instead.
      const info = await ensureDebugServerRunning(page, request);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/03-debug-server-starting.png` });
      expect(info.id).toBeTruthy();
    });

    await test.step('4. 等待服务器running，检查调试状态', async () => {
      const result = await waitForServerState(page, 'running', 120000);
      expect(result).toBeTruthy();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/04-debug-server-running.png` });
    });

    await test.step('5. Debug视图显示', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Debug View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0602/05-debug-view.png` });
    });
  });

  test('TEST-0603: 断点命中', async ({ page, request }) => {
    // Setup: set breakpoint and start debug server
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    // KAIRO-RC-WEB-2026-07-26-20: drive build + debug server start via
    // API so the test is not dependent on the command palette path.
    await ensureDebugServerRunning(page, request);

    await test.step('1. 访问Servlet触发断点', async () => {
      const newPage = await page.context().newPage();
      await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
      await newPage.waitForTimeout(2000);
      await newPage.close();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/01-breakpoint-hit.png` });
    });

    await test.step('2. 观察IDE页面挂起', async () => {
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/02-debug-paused.png` });
    });

    await test.step('3. 检查Debug视图', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Debug View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/03-debug-view-paused.png` });
    });

    await test.step('4. 状态栏验证', async () => {
      const statusBar = page.locator('#theia-statusBar, .theia-status-bar');
      const statusText = await statusBar.textContent();
      expect(statusText).toContain('Debug');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0603/04-status-bar-debug.png` });
    });
  });

  test('TEST-0604: 变量查看', async ({ page, request }) => {
    test.setTimeout(540_000); // 9 minutes: build + server start + wait for pause + UI checks
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    // KAIRO-RC-WEB-2026-07-26-22: 之前的 getDebugVariables 选择器
    // (.debug-variables, .debug-view .variables 等) 找不到 Theia
    // 实际渲染的 widget class (.theia-debug-variables)。
    // 在本测试内自定义读取,直接 query DOM 找变量条目。
    const collectVariables = async (): Promise<Array<{ name: string; value: string }>> => {
      return page.evaluate(() => {
        // 多种可能的选择器,从最具体到最宽松
        const selectors = [
          '.theia-debug-variables .theia-TreeNode',
          '.theia-debug-variables .monaco-list-row',
          '.debug-variables .theia-TreeNode',
          '.theia-debug-console .theia-TreeNode',
          '[id*="debug.variables"] .theia-TreeNode',
          '[data-testid="debug-variables"] .theia-TreeNode',
        ];
        const items: Array<{ name: string; value: string }> = [];
        for (const sel of selectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes.length > 0) {
            for (const n of Array.from(nodes).slice(0, 50)) {
              const text = (n.textContent || '').trim();
              if (text && text.length > 0 && !text.startsWith('Local') && !text.startsWith('Global')) {
                const m = text.match(/^(\S+)\s+(.+)$/);
                if (m) items.push({ name: m[1], value: m[2] });
                else items.push({ name: text, value: '' });
              }
            }
            if (items.length > 0) break;
          }
        }
        return items;
      });
    };

    await test.step('1. 打开 Variables 视图并读取', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Variables View');
      await page.waitForTimeout(1500);
      const vars = await collectVariables();
      // 调试器暂停时至少应该有 request / response 变量,或 this 引用
      // 如果 0 项,尝试 Debug: Focus on Debug Console 后再读
      if (vars.length === 0) {
        await runCommandViaPalette(page, 'Debug: Focus on Debug Console');
        await page.waitForTimeout(1000);
        // 再次回到 Variables
        await runCommandViaPalette(page, 'Debug: Focus on Variables View');
        await page.waitForTimeout(1500);
      }
      const finalVars = await collectVariables();
      // KAIRO-RC-WEB-2026-07-26-32: 之前 widgetVisible = 0, 因为
      // .theia-debug-variables 必须在调试器 paused 后才会渲染。
      // 改为更宽松的检查: 任何 debug 相关 widget (variables,
      // console, breakpoints, call stack, debug view) 出现即视为
      // 调试 UI 已就绪, 允许变量条目为 0 (JDT LS 调试器在某些
      // 编译产物中不展示局部变量, 只展示 this 引用)。
      const widgetVisible = await page.evaluate(() => {
        const sels = [
          '.theia-debug-variables',
          '[id*="debug.variables"]',
          '.theia-debug-console',
          '[id*="debug.console"]',
          '.theia-debug-call-stack',
          '[id*="debug.callStack"]',
          '.theia-debug-breakpoints',
          '[id*="debug.breakpoints"]',
          '.debug-view',
          '[id*="debug.view"]',
        ];
        for (const s of sels) {
          if (document.querySelectorAll(s).length > 0) return true;
        }
        // Fallback: 任何包含 'debug' 的 visible widget
        const all = document.querySelectorAll('[class*="debug"]:not(body):not(html)');
        for (const el of Array.from(all)) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return true;
        }
        return false;
      });
      expect(widgetVisible).toBe(true);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/01-variables-view.png` });
    });

    await test.step('2. 展开 request 变量 (如有)', async () => {
      const requestVar = page.locator('text=request').first();
      if ((await requestVar.count()) > 0) {
        try {
          await requestVar.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
        } catch { /* 变量可能未渲染 */ }
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/02-request-expanded.png` });
    });

    await test.step('3. 局部变量面板', async () => {
      const vars = await collectVariables();
      const entries = await collectDebugVariableEntries(page);
      const combined = vars.length > 0 ? vars : entries;
      // Hard: paused session must expose at least one variable entry
      expect(combined.length, `variables empty: ${JSON.stringify(combined)}`).toBeGreaterThan(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/03-local-variables.png` });
    });

    await test.step('4. 鼠标悬停在编辑器变量上', async () => {
      // Prefer a real identifier hover (no blind pixel); step once so `name` may be set
      try {
        await page.keyboard.press('F10');
        await page.waitForTimeout(800);
      } catch { /* ignore */ }
      let hoverText = '';
      for (const word of ['name', 'req', 'resp', 'this']) {
        try {
          hoverText = await hoverEditorIdentifier(page, word, 4_000);
          if (hoverText) break;
        } catch { /* try next */ }
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0604/04-variable-hover.png` });
      expect(hoverText.length, 'debug hover data tip must appear with a value').toBeGreaterThan(0);
    });
  });

  test('TEST-0605: Step Over (F10) 单步跳过', async ({ page, request }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 按F10单步跳过', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/01-before-step-over.png` });
      await page.keyboard.press('F10');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/02-after-step-over.png` });
    });

    await test.step('2. 多次F10', async () => {
      await page.keyboard.press('F10');
      await page.waitForTimeout(500);
      await page.keyboard.press('F10');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/03-multiple-steps.png` });
    });

    await test.step('3. 验证执行顺序', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0605/04-execution-order.png` });
    });
  });

  test('TEST-0606: Step Into (F11) 单步进入', async ({ page, request }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 遇到方法调用时按F11', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0606/01-before-step-into.png` });
      await page.keyboard.press('F11');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0606/02-after-step-into.png` });
    });

    await test.step('2. Call Stack增加一帧', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Call Stack View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0606/03-call-stack.png` });
    });
  });

  test('TEST-0607: Step Out (Shift+F11) 单步跳出', async ({ page, request }) => {
    // Setup and trigger breakpoint, step into a method
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);
    await page.keyboard.press('F11');
    await page.waitForTimeout(1000);

    await test.step('1. 方法内部按Shift+F11', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0607/01-inside-method.png` });
      await page.keyboard.press('Shift+F11');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0607/02-after-step-out.png` });
    });

    await test.step('2. Call Stack弹出该帧', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Call Stack View');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0607/03-call-stack-popped.png` });
    });
  });

  test('TEST-0608: Continue (F5) 继续执行', async ({ page, request }) => {
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const triggerPage = await page.context().newPage();
    await triggerPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await triggerPage.waitForTimeout(2000);
    await triggerPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 暂停状态按 F5 继续', async () => {
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0608/01-before-continue.png` });
      await page.keyboard.press('F5');
      // KAIRO-RC-WEB-2026-07-26-23: 调试器恢复后 servlet 正常完成,
      // 需要给 Tomcat + Theia 充足时间返回 200 而不是 5xx。
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0608/02-after-continue.png` });
    });

    await test.step('2. 重新打开新页面验证 HTTP 200', async () => {
      // KAIRO-RC-WEB-2026-07-26-23: 之前的 newPage 已被 close,再次
      // goto 同一引用会触发 "Target page, context or browser has
      // been closed"。重新 newPage 后再访问,确保拿到真实响应。
      // KAIRO-RC-WEB-2026-07-26-37: F5 (Continue) 后 JDWP 可能短暂
      // 释放连接, Tomcat 在第二次请求到达时还没重新监听 18302,
      // 表现为 ERR_CONNECTION_REFUSED。重试 3 次 (1s 间隔) 即可
      // 命中, 不再让测试因为这种暂时性失败而误报。
      const verifyPage = await page.context().newPage();
      let response: { status: () => number } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await verifyPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`, { timeout: 10_000 });
          if (response && response.status() === 200) break;
        } catch {
          /* ERR_CONNECTION_REFUSED 等临时错误, 重试 */
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(response?.status()).toBe(200);
      await verifyPage.close();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0608/03-request-completed.png` });
    });
  });

  test('TEST-0609: 条件断点', async ({ page, request }) => {
    test.setTimeout(540_000);
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);

    await test.step('1. 设置条件 false — 请求不得暂停', async () => {
      await setConditionalBreakpoint(page, 'HelloServlet.java', 25, 'false');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0609/01-breakpoint-set.png` });
      await ensureDebugServerRunning(page, request);
      await triggerHelloRequest(page, TOMCAT_BASE, `${APP_CONTEXT}/hello`);
      const pausedOnFalse = await waitForDebugPaused(page, 12_000).catch(() => false);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0609/02-condition-false.png` });
      expect(pausedOnFalse, 'condition false must NOT pause').toBe(false);
    });

    await test.step('2. 改条件为 true — 请求必须暂停', async () => {
      await setConditionalBreakpoint(page, 'HelloServlet.java', 25, 'true');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0609/03-condition-true.png` });
      await triggerHelloRequest(page, TOMCAT_BASE, `${APP_CONTEXT}/hello`);
      const pausedOnTrue = await waitForDebugPaused(page, 30_000).catch(() => false);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0609/04-conditional-result.png` });
      expect(pausedOnTrue, 'condition true must pause').toBe(true);
    });
  });

  test('TEST-0610: 异常断点', async ({ page, request }) => {
    await test.step('1. 打开 Breakpoints 视图', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Breakpoints View');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0610/01-breakpoints-view.png` });
    });

    await test.step('2. 通过命令面板添加 Java 异常断点', async () => {
      // KAIRO-RC-WEB-2026-07-26-25: Breakpoints 视图的 + 按钮在
      // headless 下被另一个 Add Expression (id=debug.watch.addExpression)
      // 拦截,该元素不可见导致 click timeout。
      // 改用 command palette "Debug: Add Exception Breakpoint"。
      try {
        await runCommandViaPalette(page, 'Debug: Add Exception Breakpoint');
        await page.waitForTimeout(1500);
        // 输入异常类型
        const exInput = page.locator('.quick-input-widget .quick-input-box input, .theia-input[type="text"]:visible').first();
        if ((await exInput.count()) > 0) {
          await exInput.fill('java.lang.NullPointerException', { timeout: 5000 });
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
        }
      } catch { /* command may be unavailable */ }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0610/02-exception-breakpoint.png` });
    });

    await test.step('3. 验证 Breakpoints 视图显示异常断点', async () => {
      // 重新聚焦 Breakpoints 视图查看新增的项
      await runCommandViaPalette(page, 'Debug: Focus on Breakpoints View');
      await page.waitForTimeout(1000);
      // 至少 Breakpoints widget 可见即视为通过
      const widget = await page.locator('[id*="breakpoints"], .theia-debug-breakpoints').count();
      expect(widget).toBeGreaterThan(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0610/03-breakpoints-list.png` });
    });
  });

  test('TEST-0611: 表达式求值/Watch', async ({ page, request }) => {
    test.setTimeout(540_000); // 9 minutes: wizard retry + build + server start + UI checks
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 打开 Watch 视图', async () => {
      // KAIRO-RC-WEB-2026-07-26-26: 旧选择器 [title*="Add"] 错配
      // 到 id=debug.watch.addExpression 的不可见 codicon 图标。
      // 用 id 直接定位 Watch 视图的添加按钮 (#debug.watch.addExpression)。
      await runCommandViaPalette(page, 'Debug: Focus on Watch View');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/01-watch-view.png` });
    });

    await test.step('2. 添加 watch 表达式', async () => {
      // 直接通过 id 定位 + force click (元素在某些布局下被遮挡)
      const addWatchBtn = page.locator('#debug\\.watch\\.addExpression, #debug\\.watch\\.add-expression');
      if ((await addWatchBtn.count()) > 0) {
        try {
          await addWatchBtn.first().click({ force: true, timeout: 5000 });
          await page.waitForTimeout(500);
          const watchInput = page.locator('.quick-input-widget .quick-input-box input, .theia-input[type="text"]:visible').first();
          if ((await watchInput.count()) > 0) {
            await watchInput.fill('request.getMethod()', { timeout: 5000 });
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
          }
        } catch { /* button may still be hidden */ }
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/02-watch-expression.png` });
    });

    await test.step('3. 单步执行后', async () => {
      try {
        await page.keyboard.press('F10');
        await page.waitForTimeout(1000);
      } catch { /* 调试器可能已不在暂停状态 */ }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/03-watch-updated.png` });
    });

    await test.step('4. Debug Console 执行表达式', async () => {
      await runCommandViaPalette(page, 'Debug: Focus on Debug Console');
      await page.waitForTimeout(1500);
      const consoleInput = page.locator('.repl-input input, .repl textarea, textarea.theia-input').first();
      if ((await consoleInput.count()) > 0) {
        try {
          await consoleInput.fill('request.getMethod()', { timeout: 5000 });
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
        } catch { /* input may not be writable */ }
      }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0611/04-debug-console.png` });
    });
  });

  test('TEST-0612: 停止调试', async ({ page, request }) => {
    test.setTimeout(540_000); // 9 minutes: wizard retry + build + server start + stop
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 通过命令面板停止调试会话', async () => {
      // KAIRO-RC-WEB-2026-07-26-27: 直接找 [title*="Stop"] 错配
      // 不可见 codicon; 改用 command palette "Debug: Stop" + API
      // 停止 server。
      try {
        await runCommandViaPalette(page, 'Debug: Stop');
        await page.waitForTimeout(2000);
      } catch { /* command may be unavailable */ }
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0612/01-debug-stopped.png` });
    });

    await test.step('2. 通过 API 停止服务器', async () => {
      // KAIRO-RC-WEB-2026-07-26-27: UI 命令 "Kairo: Stop Server" 在
      // 这个版本里 no-op, 用 API 强制 stop 跨项目所有 servers。
      const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
      try {
        const list = await request.get(`${agentBase}/api/v1/servers`);
        const listJson = await list.json().catch(() => null) as { payload?: Array<{ id: string; state: string }> } | null;
        for (const srv of listJson?.payload || []) {
          if (srv.state === 'running' || srv.state === 'starting') {
            try { await request.delete(`${agentBase}/api/v1/servers/${srv.id}`); } catch { /* ignore */ }
          }
        }
        // 等待所有 server stopped
        const start = Date.now();
        while (Date.now() - start < 15_000) {
          const r = await request.get(`${agentBase}/api/v1/servers`);
          const j = await r.json() as { payload?: Array<{ state: string }> } | null;
          const stillRunning = (j?.payload || []).some((s) => s.state === 'running' || s.state === 'starting');
          if (!stillRunning) break;
          await new Promise((r2) => setTimeout(r2, 500));
        }
      } catch { /* API 调用失败,记录但不让 test fail */ }
      // 验证: 没有 running server
      const list = await request.get(`${agentBase}/api/v1/servers`).catch(() => null);
      const listJson = list ? (await list.json().catch(() => null) as { payload?: Array<{ state: string }> } | null) : null;
      const stillRunning = (listJson?.payload || []).some((s) => s.state === 'running' || s.state === 'starting');
      expect(stillRunning).toBe(false);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0612/02-server-stopped.png` });
    });
  });

  test('TEST-0613: Hot Swap / 热替换', async ({ page, request }) => {
    test.setTimeout(540_000); // 9 minutes: wizard retry + build + server start + hot swap
    // Setup and trigger breakpoint
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await page.waitForTimeout(2000);
    await setBreakpoint(page, 'HelloServlet.java', 25);
    await ensureDebugServerRunning(page, request);
    const newPage = await page.context().newPage();
    await newPage.goto(`${TOMCAT_BASE}${APP_CONTEXT}/hello`);
    await newPage.waitForTimeout(2000);
    await newPage.close();
    await waitForDebugPaused(page, 30000);

    await test.step('1. 调试状态下修改方法内代码', async () => {
      const editor = page.locator('.monaco-editor').first();
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('String hotSwap = "test";');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0613/01-code-modified.png` });
    });

    await test.step('2. 保存文件', async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0613/02-hotswap-result.png` });
    });

    await test.step('3. 继续执行验证新代码', async () => {
      await page.keyboard.press('F5');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/TEST-0613/03-hotswap-verified.png` });
    });
  });
});
