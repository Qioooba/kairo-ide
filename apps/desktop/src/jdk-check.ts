/**
 * JDK pre-launch detection for Kairo IDE desktop.
 *
 * Mirrors the detection priority of the Go Runtime Agent's
 * jdkmanager.Detect() so that the Electron main process can
 * surface a friendly setup dialog BEFORE the long agent
 * health-check timeout.
 *
 * Priority (same as jdkmanager/manager.go):
 *   1. KAIRO_JDK_HOME env var
 *   2. bundled/jdk17/ directory
 *   3. JAVA_HOME env var
 *   4. java on PATH
 *   5. Common install locations
 */

import { execSync } from 'child_process';
import { dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ──────────────────────────────────────────────────────

export interface JDKDetectionResult {
  found: boolean;
  javaPath?: string;   // Full path to java / java.exe
  javaHome?: string;   // JAVA_HOME equivalent (parent of bin/)
  version?: string;    // e.g. "17.0.9" or "21.0.1"
  major?: number;      // e.g. 17, 21
  /** List of paths that were searched. */
  searchedPaths?: string[];
}

export type JDKDialogChoice = 'continue' | 'quit';

// ─── Constants ──────────────────────────────────────────────────

const MIN_JDK_MAJOR = 17;

const javaExe = process.platform === 'win32' ? 'java.exe' : 'java';

function commonJDKPaths(): string[] {
  if (process.platform === 'win32') {
    // Search the most common JDK install locations on Windows,
    // covering both Oracle and Eclipse Adoptium / Temurin layouts.
    const base = 'C:\\Program Files';
    const versions = ['17', '21', '22', '23', '24', '25'];
    const paths: string[] = [];
    for (const v of versions) {
      paths.push(path.join(base, 'Java', `jdk-${v}`, 'bin', javaExe));
      paths.push(path.join(base, 'Eclipse Adoptium', `jdk-${v}`, 'bin', javaExe));
      // Some layouts use the full version in the directory name.
      // We scan the parent directory for matching folders.
    }
    // Scan for versioned directories that may not be an exact match.
    for (const dir of [path.join(base, 'Java'), path.join(base, 'Eclipse Adoptium')]) {
      try {
        for (const entry of fs.readdirSync(dir)) {
          const lower = entry.toLowerCase();
          if (lower.startsWith('jdk-') || lower.startsWith('jre-')) {
            const javaPath = path.join(dir, entry, 'bin', javaExe);
            if (!paths.includes(javaPath)) {
              paths.push(javaPath);
            }
          }
        }
      } catch { /* directory may not exist */ }
    }
    return paths;
  }

  if (process.platform === 'darwin') {
    return [
      '/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java',
      '/usr/local/opt/openjdk@17/bin/java',
      '/opt/homebrew/opt/openjdk@17/bin/java',
      '/opt/homebrew/opt/openjdk@21/bin/java',
    ];
  }

  // Linux
  return [
    '/usr/lib/jvm/java-17-openjdk/bin/java',
    '/usr/lib/jvm/java-21-openjdk/bin/java',
    '/usr/lib/jvm/java-17-oracle/bin/java',
    '/usr/lib/jvm/java-21-oracle/bin/java',
    '/usr/lib/jvm/jdk-17/bin/java',
    '/usr/lib/jvm/jdk-21/bin/java',
  ];
}

// ─── Version parsing ────────────────────────────────────────────

/**
 * Run `java -version` and parse the output.
 *
 * java -version writes to stderr, not stdout, on all platforms.
 * We use execSync with stdio: 'pipe' to capture both streams.
 */
export function probeJavaVersion(javaPath: string): JDKDetectionResult {
  if (!fs.existsSync(javaPath)) {
    return { found: false };
  }

  try {
    // java -version writes to stderr on all platforms.
    // Use 2>&1 to redirect stderr → stdout so execSync captures it.
    const output = execSync(`"${javaPath}" -version 2>&1`, {
      timeout: 10_000,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    const version = parseJavaVersionString(output);
    const major = parseMajorVersion(version);
    if (version && major >= MIN_JDK_MAJOR) {
      const javaHome = path.dirname(path.dirname(javaPath)); // javaPath/bin/java → home
      return {
        found: true,
        javaPath,
        javaHome,
        version,
        major,
      };
    }
    // Version parsed but too old.
    return { found: false, version, major };
  } catch {
    // Binary exists but crashed or timed out.
    return { found: false };
  }
}

/** Regex matches: openjdk version "17.0.9" | java version "21.0.1" | version "24" */
const javaVersionRE = /(?:openjdk|java)\s+version\s+"([^"]+)"/i;

/**
 * Try to extract a version string from text. If the primary regex fails,
 * fall back to simpler patterns (e.g. 'version "24").
 */
function parseJavaVersionString(text: string): string {
  const m = javaVersionRE.exec(text);
  if (m) return m[1];

  // Fallback: just "version" followed by a quoted string.
  const fallback = /version\s+"([^"]+)"/i.exec(text);
  if (fallback) return fallback[1];

  return '';
}

/**
 * Parse the major version from a Java version string.
 * Handles:
 *   "1.8.0_391" → 8
 *   "17.0.9"    → 17
 *   "21.0.1"    → 21
 *   "24"        → 24
 *   "25-ea"     → 25
 */
export function parseMajorVersion(version: string): number {
  if (!version) return 0;

  // "1.8.0_391" → 8
  if (version.startsWith('1.')) {
    const parts = version.split('.');
    if (parts.length >= 2) {
      const minor = parseInt(parts[1], 10);
      if (!isNaN(minor)) return minor;
    }
  }

  // "17.0.9" → 17, "24" → 24, "25-ea" → 25
  const firstPart = version.split(/[.\-_]/)[0];
  const major = parseInt(firstPart, 10);
  return isNaN(major) ? 0 : major;
}

// ─── Detection ──────────────────────────────────────────────────

/**
 * Detect a JDK 17+ installation, following the same priority as
 * the Go Runtime Agent's jdkmanager.Detect().
 */
export function detectJDK17Plus(bundledDir?: string): JDKDetectionResult {
  const searchedPaths: string[] = [];

  function tryPath(candidate: string): JDKDetectionResult | null {
    searchedPaths.push(candidate);
    const result = probeJavaVersion(candidate);
    if (result.found) return result;
    return null;
  }

  // 1. KAIRO_JDK_HOME
  const kairoJdkHome = process.env.KAIRO_JDK_HOME;
  if (kairoJdkHome) {
    const r = tryPath(path.join(kairoJdkHome, 'bin', javaExe));
    if (r) return { ...r, searchedPaths };
  }

  // 2. bundled/jdk17/
  if (bundledDir) {
    const r = tryPath(path.join(bundledDir, 'jdk17', 'bin', javaExe));
    if (r) return { ...r, searchedPaths };
  }

  // 3. JAVA_HOME
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const r = tryPath(path.join(javaHome, 'bin', javaExe));
    if (r) return { ...r, searchedPaths };
  }

  // 4. PATH
  if (process.platform === 'win32') {
    // On Windows, `where java` returns the first match.
    try {
      const whereResult = execSync('where java', { encoding: 'utf-8', timeout: 5_000 });
      const lines = whereResult.trim().split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          const r = tryPath(trimmed);
          if (r) return { ...r, searchedPaths };
        }
      }
    } catch { /* java not on PATH */ }
  } else {
    try {
      const whichResult = execSync('which java', { encoding: 'utf-8', timeout: 5_000 }).trim();
      if (whichResult) {
        const r = tryPath(whichResult);
        if (r) return { ...r, searchedPaths };
      }
    } catch { /* java not on PATH */ }
  }

  // 5. Common install locations
  for (const p of commonJDKPaths()) {
    const r = tryPath(p);
    if (r) return { ...r, searchedPaths };
  }

  return { found: false, searchedPaths };
}

// ─── Dialog ─────────────────────────────────────────────────────

/**
 * Show a native dialog when no JDK 17+ is detected.
 * Returns 'continue' (user chose to proceed or selected a JDK) or 'quit'.
 */
export async function showJDKSetupDialog(
  _result: JDKDetectionResult,
): Promise<JDKDialogChoice> {
  const searchedInfo = (_result.searchedPaths || [])
    .map((p) => `  • ${p}`)
    .join('\n');

  const message = [
    'Kairo IDE 需要 JDK 17 或更高版本来运行 Java 语言服务和调试器。',
    '',
    '当前系统未检测到 JDK 17+。',
    '',
    '已搜索以下位置：',
    searchedInfo || '  (无)',
    '',
    '请选择如何处理：',
  ].join('\n');

  // Step 1: Ask user what they want to do.
  const choice = await dialog.showMessageBox({
    type: 'warning',
    title: 'Kairo IDE — JDK 环境检测',
    message: '未检测到 JDK 17+',
    detail: message,
    buttons: ['手动选择 JDK', '暂时跳过', '退出'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (choice.response === 2) {
    // User clicked "退出"
    return 'quit';
  }

  if (choice.response === 1) {
    // User clicked "暂时跳过"
    return 'continue';
  }

  // choice.response === 0 — "手动选择 JDK"
  // Step 2: Open file picker for java.exe / java.
  const fileResult = await dialog.showOpenDialog({
    title: '选择 java 可执行文件',
    filters: [
      {
        name: 'Java 可执行文件',
        extensions: process.platform === 'win32' ? ['exe'] : ['*'],
      },
    ],
    properties: ['openFile'],
    defaultPath: process.platform === 'win32'
      ? 'C:\\Program Files\\Java'
      : '/usr/lib/jvm',
  });

  if (fileResult.canceled || fileResult.filePaths.length === 0) {
    // User cancelled the file picker — go back to the first dialog.
    return showJDKSetupDialog(_result);
  }

  const selectedPath = fileResult.filePaths[0];

  // Verify the selected file is a valid JDK 17+.
  const probe = probeJavaVersion(selectedPath);
  if (!probe.found) {
    // The selected binary is not a valid JDK 17+.
    const retryChoice = await dialog.showMessageBox({
      type: 'error',
      title: 'Kairo IDE — JDK 验证失败',
      message: '选择的 Java 版本不符合要求',
      detail: probe.version
        ? `检测到 Java ${probe.version}（主版本 ${probe.major}），需要 JDK 17 或更高版本。`
        : '无法从所选文件检测到有效的 Java 版本。请确保选择的是 JDK 17+ 的 java 可执行文件。',
      buttons: ['重新选择', '暂时跳过', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    if (retryChoice.response === 2) return 'quit';
    if (retryChoice.response === 1) return 'continue';
    // Retry file selection.
    return showJDKSetupDialog(_result);
  }

  // Valid JDK found — set KAIRO_JDK_HOME.
  process.env.KAIRO_JDK_HOME = probe.javaHome;
  console.log(`[kairo] User selected JDK ${probe.version} at ${probe.javaPath}`);
  console.log(`[kairo] KAIRO_JDK_HOME set to ${probe.javaHome}`);

  return 'continue';
}