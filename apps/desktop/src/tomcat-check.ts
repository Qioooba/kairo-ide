/**
 * Tomcat 6 home detection / persistence for Kairo IDE desktop.
 *
 * Mirrors host-jdk.json: user picks (or we detect) a Catalina home once,
 * persist to userData/host-tomcat.json, and the Go agent + Node manager
 * read the same file / KAIRO_TOMCAT6_HOME on later launches.
 */

import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface PersistedTomcatConfig {
  catalinaHome: string;
  updatedAt?: string;
}

export type TomcatDialogChoice = 'continue' | 'quit';

const PERSISTED_TOMCAT_FILENAME = 'host-tomcat.json';

function catalinaScriptName(): string {
  return process.platform === 'win32' ? 'catalina.bat' : 'catalina.sh';
}

/** True when `home` looks like a Tomcat 6+ install root. */
export function isValidTomcatHome(home: string | undefined): boolean {
  if (!home?.trim()) return false;
  const root = home.trim();
  const script = path.join(root, 'bin', catalinaScriptName());
  const bootstrap = path.join(root, 'bin', 'bootstrap.jar');
  return fs.existsSync(script) || fs.existsSync(bootstrap);
}

export function getPersistedTomcatConfigPath(): string | undefined {
  const override = process.env.KAIRO_TOMCAT_CONFIG?.trim();
  if (override) return override;
  try {
    return path.join(app.getPath('userData'), PERSISTED_TOMCAT_FILENAME);
  } catch {
    return undefined;
  }
}

export function loadPersistedTomcatHome(): string | undefined {
  const cfgPath = getPersistedTomcatConfigPath();
  if (!cfgPath || !fs.existsSync(cfgPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as PersistedTomcatConfig;
    if (!raw?.catalinaHome || typeof raw.catalinaHome !== 'string') return undefined;
    if (!isValidTomcatHome(raw.catalinaHome)) return undefined;
    return raw.catalinaHome;
  } catch {
    return undefined;
  }
}

export function savePersistedTomcatHome(catalinaHome: string): void {
  if (!isValidTomcatHome(catalinaHome)) return;
  const cfgPath = getPersistedTomcatConfigPath();
  if (!cfgPath) {
    console.warn('[kairo] Cannot persist Tomcat home — config path unavailable');
    return;
  }
  try {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    const data: PersistedTomcatConfig = {
      catalinaHome,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(cfgPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[kairo] Persisted Tomcat home to ${cfgPath}`);
  } catch (err) {
    console.warn('[kairo] Failed to persist Tomcat home:', err);
  }
}

export function applyTomcatEnv(catalinaHome: string): void {
  if (!isValidTomcatHome(catalinaHome)) return;
  process.env.KAIRO_TOMCAT6_HOME = catalinaHome;
}

/** Prefer env → persisted → bundled/tomcat6/* layouts. */
export function detectTomcatHome(bundledDir?: string): string | undefined {
  const fromEnv = process.env.KAIRO_TOMCAT6_HOME?.trim();
  if (isValidTomcatHome(fromEnv)) return fromEnv;

  const persisted = loadPersistedTomcatHome();
  if (persisted) return persisted;

  if (!bundledDir) return undefined;
  const candidates = [
    path.join(bundledDir, 'tomcat6', 'apache-tomcat-6.0.53'),
    path.join(bundledDir, 'tomcat6'),
  ];
  for (const c of candidates) {
    if (isValidTomcatHome(c)) return c;
  }
  try {
    const tomcatDir = path.join(bundledDir, 'tomcat6');
    if (!fs.existsSync(tomcatDir)) return undefined;
    for (const name of fs.readdirSync(tomcatDir)) {
      const candidate = path.join(tomcatDir, name);
      if (isValidTomcatHome(candidate)) return candidate;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Prompt when no Tomcat 6 home is available. Returns continue after
 * a valid pick / skip, or quit.
 */
export async function showTomcatSetupDialog(): Promise<TomcatDialogChoice> {
  const choice = await dialog.showMessageBox({
    type: 'warning',
    title: 'Kairo IDE — Tomcat 环境检测',
    message: '未检测到 Tomcat 6',
    detail: [
      '启动 / 调试 Web 项目需要 Tomcat 6（CATALINA_HOME）。',
      '',
      '请选择如何处理：',
    ].join('\n'),
    buttons: ['手动选择 Tomcat', '暂时跳过', '退出'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (choice.response === 2) return 'quit';
  if (choice.response === 1) return 'continue';

  const fileResult = await dialog.showOpenDialog({
    title: '选择 Tomcat 安装目录（含 bin/catalina.*）',
    properties: ['openDirectory'],
    defaultPath: process.platform === 'win32' ? 'C:\\' : '/usr/share',
  });

  if (fileResult.canceled || fileResult.filePaths.length === 0) {
    return showTomcatSetupDialog();
  }

  const selected = fileResult.filePaths[0];
  if (!isValidTomcatHome(selected)) {
    const retry = await dialog.showMessageBox({
      type: 'error',
      title: 'Kairo IDE — Tomcat 验证失败',
      message: '选择的目录不是有效的 Tomcat 安装',
      detail: `需要包含 bin/${catalinaScriptName()} 或 bin/bootstrap.jar。\n所选路径：${selected}`,
      buttons: ['重新选择', '暂时跳过', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (retry.response === 2) return 'quit';
    if (retry.response === 1) return 'continue';
    return showTomcatSetupDialog();
  }

  applyTomcatEnv(selected);
  savePersistedTomcatHome(selected);
  console.log(`[kairo] User selected Tomcat at ${selected}`);
  return 'continue';
}
