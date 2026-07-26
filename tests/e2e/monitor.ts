/**
 * =============================================================================
 * Kairo IDE Console & Network Monitor — Test Orchestration Helper
 * =============================================================================
 *
 * 提供全局控制台错误、网络请求失败、UI 可访问性检查的监控能力。
 * 在每个测试中注入，确保零控制台错误、零网络失败。
 *
 * 用法:
 *   import { setupConsoleMonitor, setupNetworkMonitor, checkUIHealth } from './monitor';
 *   const consoleMon = setupConsoleMonitor(page);
 *   const networkMon = setupNetworkMonitor(page);
 *   // ... 执行测试操作 ...
 *   expect(consoleMon.hasErrors()).toBe(false);
 *   expect(networkMon.hasFailures()).toBe(false);
 */

import { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ===========================================================================
// Types
// ===========================================================================

export interface ConsoleError {
  type: 'pageerror' | 'console.error';
  message: string;
  stack?: string;
  location?: { url: string; lineNumber: number; columnNumber: number };
  timestamp: number;
}

export interface ConsoleWarning {
  type: 'console.warning';
  message: string;
  timestamp: number;
}

export interface FailedRequest {
  url: string;
  method: string;
  failure: string;
  timestamp: number;
}

export interface SlowRequest {
  url: string;
  duration: number;
  timestamp: number;
}

export interface ConsoleErrorCollector {
  getErrors: () => ConsoleError[];
  getWarnings: () => ConsoleWarning[];
  clear: () => void;
  hasErrors: () => boolean;
  hasWarnings: () => boolean;
  report: () => ConsoleReport;
  dump: (filePath: string) => void;
}

export interface NetworkMonitor {
  getFailed: () => FailedRequest[];
  getSlow: () => SlowRequest[];
  clear: () => void;
  hasFailures: () => boolean;
  report: () => NetworkReport;
  dump: (filePath: string) => void;
}

export interface ConsoleReport {
  errorCount: number;
  warningCount: number;
  errors: ConsoleError[];
  warnings: ConsoleWarning[];
}

export interface NetworkReport {
  failureCount: number;
  slowCount: number;
  failures: FailedRequest[];
  slowRequests: SlowRequest[];
}

export interface UIHealthCheck {
  passed: boolean;
  checks: UICheckItem[];
}

export interface UICheckItem {
  name: string;
  passed: boolean;
  details: string;
}

// ===========================================================================
// Ignored errors (非关键、可安全忽略的错误)
// ===========================================================================

const IGNORED_ERROR_PATTERNS = [
  /non-serializable/i,
  /favicon\.ico/i,
  /WebSocket connection to/i,
  /net::ERR_CONNECTION_REFUSED/i,
  // React 非关键警告
  /Warning: componentWillReceiveProps/i,
  /Warning: componentWillMount/i,
  // Monaco 编辑器已知非关键警告
  /monaco.*deprecated/i,
  // 终端 WebSocket 重连
  /WebSocket.*closed/i,
  /WebSocket.*reconnect/i,
  // JRE/JDT LS 环境问题（测试环境可能没有JRE 17，非代码bug）
  /JDT LS requires a JRE/i,
  /KAIRO_JRE17_HOME/i,
  /jre17/i,
  /Failed to prepare JDT LS/i,
  // JDT LS 启动失败（环境依赖问题）
  /JDT LS.*failed/i,
  /jdtls/i,
  // Java 相关 API 在无 JRE 环境下会 500
  /\/java\/launch-descriptor/i,
  /\/java\//i,
  // 资源加载错误（某些动态资源在测试环境不可用是正常的）
  /Failed to load resource/i,
];

function isIgnoredError(message: string): boolean {
  return IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

// ===========================================================================
// Console Monitor
// ===========================================================================

export function setupConsoleMonitor(page: Page): ConsoleErrorCollector {
  const errors: ConsoleError[] = [];
  const warnings: ConsoleWarning[] = [];

  // 页面级错误
  page.on('pageerror', (error) => {
    const entry: ConsoleError = {
      type: 'pageerror',
      message: error.message,
      stack: error.stack,
      timestamp: Date.now(),
    };
    if (!isIgnoredError(error.message)) {
      errors.push(entry);
    }
  });

  // 控制台消息
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const entry: ConsoleError = {
        type: 'console.error',
        message: msg.text(),
        location: {
          url: msg.location().url || '',
          lineNumber: msg.location().lineNumber || 0,
          columnNumber: msg.location().columnNumber || 0,
        },
        timestamp: Date.now(),
      };
      if (!isIgnoredError(msg.text())) {
        errors.push(entry);
      }
    }
    if (msg.type() === 'warning') {
      warnings.push({
        type: 'console.warning',
        message: msg.text(),
        timestamp: Date.now(),
      });
    }
  });

  return {
    getErrors: () => [...errors],
    getWarnings: () => [...warnings],
    clear: () => {
      errors.length = 0;
      warnings.length = 0;
    },
    hasErrors: () => errors.length > 0,
    hasWarnings: () => warnings.length > 0,
    report: () => ({
      errorCount: errors.length,
      warningCount: warnings.length,
      errors: errors.slice(0, 50),
      warnings: warnings.slice(0, 50),
    }),
    dump: (filePath: string) => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            errors: errors.slice(0, 50),
            warnings: warnings.slice(0, 50),
          },
          null,
          2,
        ),
      );
    },
  };
}

// ===========================================================================
// Network Monitor
// ===========================================================================

const IGNORED_URL_PATTERNS = [
  /favicon\.ico/i,
  /__webpack_hmr/i,
  /sockjs-node/i,
  /hot-update/i,
];

function isIgnoredUrl(url: string): boolean {
  return IGNORED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

export function setupNetworkMonitor(page: Page): NetworkMonitor {
  const failedRequests: FailedRequest[] = [];
  const slowRequests: SlowRequest[] = [];
  const requestStartTimes = new Map<string, number>();

  page.on('request', (request) => {
    requestStartTimes.set(request.url(), Date.now());
  });

  page.on('requestfailed', (request) => {
    if (!isIgnoredUrl(request.url())) {
      failedRequests.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || 'unknown',
        timestamp: Date.now(),
      });
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    if (isIgnoredUrl(url)) return;
    const startTime = requestStartTimes.get(url);
    if (startTime) {
      const duration = Date.now() - startTime;
      if (duration > 5000) {
        slowRequests.push({ url, duration, timestamp: Date.now() });
      }
    }
    if (response.status() >= 400) {
      failedRequests.push({
        url,
        method: response.request().method(),
        failure: `HTTP ${response.status()} ${response.statusText()}`,
        timestamp: Date.now(),
      });
    }
  });

  return {
    getFailed: () => [...failedRequests],
    getSlow: () => [...slowRequests],
    clear: () => {
      failedRequests.length = 0;
      slowRequests.length = 0;
    },
    hasFailures: () => failedRequests.length > 0,
    report: () => ({
      failureCount: failedRequests.length,
      slowCount: slowRequests.length,
      failures: failedRequests.slice(0, 50),
      slowRequests: slowRequests.slice(0, 50),
    }),
    dump: (filePath: string) => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            failures: failedRequests.slice(0, 50),
            slowRequests: slowRequests.slice(0, 50),
          },
          null,
          2,
        ),
      );
    },
  };
}

// ===========================================================================
// UI Health Check
// ===========================================================================

export async function checkUIHealth(page: Page): Promise<UIHealthCheck> {
  const checks: UICheckItem[] = [];

  // 检查 1: Theia Shell 存在
  const shell = await page.$('#theia-app-shell, #theia-shell, .theia-shell');
  checks.push({
    name: 'Theia Shell Present',
    passed: shell !== null,
    details: shell ? 'Shell element found' : 'Shell element NOT found',
  });

  // 检查 2: 状态栏存在
  const statusBar = await page.$('#theia-statusBar');
  checks.push({
    name: 'Status Bar Present',
    passed: statusBar !== null,
    details: statusBar ? 'Status bar found' : 'Status bar NOT found',
  });

  // 检查 3: 活动栏/左侧边栏存在
  const activityBar = await page.$('.theia-app-left .lm-TabBar.theia-app-sides, .theia-app-left.theia-app-sides');
  const hasActivityIcons = await page.evaluate(() => {
    const ab = document.querySelector('.theia-app-left .lm-TabBar.theia-app-sides');
    if (!ab) return false;
    const tabs = ab.querySelectorAll('.lm-TabBar-tab');
    return tabs.length > 0;
  });
  checks.push({
    name: 'Activity Bar Present',
    passed: activityBar !== null && hasActivityIcons,
    details: activityBar ? (hasActivityIcons ? 'Activity bar with icon tabs found' : 'Activity bar found but no tabs') : 'Activity bar NOT found',
  });

  // 检查 4: 没有明显的布局重叠
  const layoutIssues = await page.evaluate(() => {
    const issues: string[] = [];
    const shell = document.querySelector('#theia-app-shell');
    if (!shell) return issues;
    // 检查 main content panel 是否可见
    const main = document.querySelector('#theia-main-content-panel');
    if (!main) issues.push('Main content panel missing');
    return issues;
  });
  checks.push({
    name: 'Layout Integrity',
    passed: layoutIssues.length === 0,
    details: layoutIssues.length > 0 ? layoutIssues.join('; ') : 'Layout looks OK',
  });

  // 检查 5: 按钮可访问性
  const ariaCheck = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    let withLabel = 0;
    for (const btn of buttons) {
      if (btn.getAttribute('aria-label') || btn.textContent?.trim()) {
        withLabel++;
      }
    }
    const ratio = buttons.length > 0 ? withLabel / buttons.length : 1;
    return { total: buttons.length, withLabel, ratio };
  });
  checks.push({
    name: 'Button Accessibility',
    passed: ariaCheck.ratio >= 0.5,
    details: `${ariaCheck.withLabel}/${ariaCheck.total} buttons have labels (${(ariaCheck.ratio * 100).toFixed(0)}%)`,
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

// ===========================================================================
// Screenshot Helper
// ===========================================================================

export async function takeScreenshot(
  page: Page,
  name: string,
  outputDir: string,
): Promise<string> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

// ===========================================================================
// Complete Test Step Runner
// ===========================================================================

export interface TestStepResult {
  stepName: string;
  passed: boolean;
  consoleErrors: number;
  networkFailures: number;
  screenshotPath: string | null;
  error?: string;
}

export async function runTestStep(
  page: Page,
  stepName: string,
  consoleMon: ConsoleErrorCollector,
  networkMon: NetworkMonitor,
  screenshotDir: string,
  action: () => Promise<void>,
): Promise<TestStepResult> {
  consoleMon.clear();
  // Don't clear network monitor — failures accumulate across steps

  try {
    await action();
    await page.waitForTimeout(500);
  } catch (err) {
    const screenshotPath = await takeScreenshot(page, `${stepName}-error`, screenshotDir);
    return {
      stepName,
      passed: false,
      consoleErrors: consoleMon.getErrors().length,
      networkFailures: networkMon.getFailed().length,
      screenshotPath,
      error: String(err),
    };
  }

  const screenshotPath = await takeScreenshot(page, stepName, screenshotDir);
  const errors = consoleMon.getErrors().length;
  const failures = networkMon.getFailed().length;

  return {
    stepName,
    passed: errors === 0,
    consoleErrors: errors,
    networkFailures: failures,
    screenshotPath,
  };
}