#!/usr/bin/env node

/**
 * Kairo IDE Visual Regression Runner
 *
 * Runs Playwright screenshot tests against the running Theia Browser IDE.
 * On first run, creates baseline screenshots. On subsequent runs, compares
 * against baselines and reports failures.
 *
 * Usage:
 *   node scripts/run-visual-regression.cjs [--update-snapshots]
 *
 * Prerequisites:
 *   Theia Browser IDE must be running on http://localhost:3000
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SPEC_FILE = path.join(PROJECT_ROOT, 'tests', 'screenshots', 'visual-regression.spec.ts');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'tests', 'screenshots', 'screenshots');
const REPORT_DIR = path.join(PROJECT_ROOT, 'docs', 'progress', 'releases');
const REPORT_FILE = path.join(REPORT_DIR, 'visual-regression-20260723.md');
const TIMEOUT_MS = 120_000;

const SCENARIOS = [
  { id: 'V-01', name: 'Welcome page' },
  { id: 'V-02', name: 'Explorer with project' },
  { id: 'V-03', name: 'Search Center' },
  { id: 'V-04', name: 'Search Everywhere' },
  { id: 'V-05', name: 'Find File popup' },
  { id: 'V-06', name: 'Problems panel' },
  { id: 'V-07', name: 'Git Changes view' },
  { id: 'V-08', name: 'Settings UI' },
  { id: 'V-09', name: 'Status bar' },
  { id: 'V-10', name: 'Dark theme' },
];

function log(msg) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${msg}`);
}

function fail(msg) {
  console.error(`  FAIL  ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function hasBaseline() {
  if (!fs.existsSync(SCREENSHOT_DIR)) return false;
  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
  return files.length > 0;
}

function checkPlaywrightAvailable() {
  try {
    execSync('npx playwright --version', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runPlaywrightTests(updateSnapshots) {
  const args = [
    'playwright', 'test',
    '--config', path.join(PROJECT_ROOT, 'tests', 'screenshots', 'playwright.config.ts'),
    '--timeout', String(TIMEOUT_MS),
  ];

  if (updateSnapshots) {
    args.push('--update-snapshots');
  }

  log(`Running: npx ${args.join(' ')}`);

  const result = spawnSync('npx', args, {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    timeout: TIMEOUT_MS + 30_000,
    env: { ...process.env },
  });

  return {
    exitCode: result.status,
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
  };
}

function generateDryRunReport() {
  ensureDir(REPORT_DIR);

  const lines = [
    '# Kairo IDE Visual Regression Report',
    '',
    `**生成时间：** ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    `**状态：** BASELINE NEEDED（首次运行）`,
    '',
    '## 说明',
    '',
    'Playwright 无法在当前环境中运行（无显示 / 无浏览器），生成了干运行报告。',
    '以下为所有 10 个截图场景的预期基线。',
    '',
    '## 运行命令',
    '',
    '```bash',
    'cd /Users/qi/Documents/spaces/kairo-ide',
    '',
    '# 首次运行（生成基线）：',
    'node scripts/run-visual-regression.cjs --update-snapshots',
    '',
    '# 后续运行（对比基线）：',
    'node scripts/run-visual-regression.cjs',
    '```',
    '',
    '## 截图场景',
    '',
    '| # | ID | 场景 | 选择器 | 触发方式 | 状态 |',
    '|----|------|------|--------|----------|------|',
  ];

  SCENARIOS.forEach((s, i) => {
    const selectors = {
      'V-01': '.kairo-welcome-body',
      'V-02': '整个页面',
      'V-03': '.kairo-search-center',
      'V-04': '.kairo-search-everywhere-widget',
      'V-05': '.kairo-find-modal-backdrop',
      'V-06': '整个页面',
      'V-07': '整个页面',
      'V-08': '.theia-settings',
      'V-09': '#theia-statusBar',
      'V-10': '整个页面',
    };
    const triggers = {
      'V-01': '导航到 http://localhost:3000',
      'V-02': '打开项目后截图',
      'V-03': 'Ctrl+Shift+F',
      'V-04': 'Shift+Shift',
      'V-05': 'Meta+Shift+O',
      'V-06': '切换到 Problems 面板',
      'V-07': '切换到 Git Changes 视图',
      'V-08': 'Meta+,',
      'V-09': '等待状态栏渲染',
      'V-10': '切换深色主题后截图',
    };
    lines.push(`| ${i + 1} | ${s.id} | ${s.name} | \`${selectors[s.id]}\` | ${triggers[s.id]} | BASELINE NEEDED |`);
  });

  lines.push('');
  lines.push('## 预期截图文件');
  lines.push('');
  lines.push('```');
  SCENARIOS.forEach(s => {
    const filename = s.name.toLowerCase().replace(/\s+/g, '-') + '.png';
    lines.push(`tests/screenshots/screenshots/${filename}`);
  });
  lines.push('```');
  lines.push('');
  lines.push('## 注意事项');
  lines.push('');
  lines.push('1. 首次运行需要 `--update-snapshots` 参数来生成基线截图');
  lines.push('2. 后续运行会自动对比基线，差异超过 maxDiffPixels 阈值会报 FAIL');
  lines.push('3. 确保 Theia Browser IDE 在 `http://localhost:3000` 上运行');
  lines.push('4. 推荐使用 1440x900 视口尺寸');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*报告由 `scripts/run-visual-regression.cjs` 自动生成*');

  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf-8');
  log(`干运行报告已生成: ${REPORT_FILE}`);
}

function generateReport(status, details) {
  ensureDir(REPORT_DIR);

  const lines = [
    '# Kairo IDE Visual Regression Report',
    '',
    `**生成时间：** ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    `**状态：** ${status}`,
    '',
    '## 截图场景',
    '',
    '| # | ID | 场景 | 文件名 | 状态 |',
    '|----|------|------|--------|------|',
  ];

  SCENARIOS.forEach((s, i) => {
    const filename = s.name.toLowerCase().replace(/\s+/g, '-') + '.png';
    const scenarioStatus = details.scenarios[s.id] || 'NOT RUN';
    lines.push(`| ${i + 1} | ${s.id} | ${s.name} | \`${filename}\` | ${scenarioStatus} |`);
  });

  lines.push('');
  lines.push(`## 结果汇总`);
  lines.push('');
  lines.push(`- **通过：** ${details.passed || 0}`);
  lines.push(`- **失败：** ${details.failed || 0}`);
  lines.push(`- **未运行：** ${details.skipped || 0}`);
  lines.push(`- **基线截图：** ${details.baselineCount || 0}`);
  lines.push('');

  if (details.note) {
    lines.push('## 备注');
    lines.push('');
    lines.push(details.note);
    lines.push('');
  }

  lines.push('## 运行命令');
  lines.push('');
  lines.push('```bash');
  lines.push('# 首次运行（生成基线）：');
  lines.push('node scripts/run-visual-regression.cjs --update-snapshots');
  lines.push('');
  lines.push('# 后续运行（对比基线）：');
  lines.push('node scripts/run-visual-regression.cjs');
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*报告由 `scripts/run-visual-regression.cjs` 自动生成*');

  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf-8');
  log(`报告已生成: ${REPORT_FILE}`);
}

function parsePlaywrightOutput(stdout) {
  const scenarios = {};
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const lines = stdout.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(✓|✘|-) .* › (V-\d+):/);
    if (match) {
      const symbol = match[1];
      const id = match[2];
      if (symbol === '✓') {
        scenarios[id] = 'PASS';
        passed++;
      } else if (symbol === '✘') {
        scenarios[id] = 'FAIL';
        failed++;
      } else if (symbol === '-') {
        scenarios[id] = 'SKIPPED';
        skipped++;
      }
    }
  }

  // Count baselines
  let baselineCount = 0;
  if (fs.existsSync(SCREENSHOT_DIR)) {
    try {
      const snapDir = path.join(SCREENSHOT_DIR, 'visual-regression.spec.ts-snapshots');
      if (fs.existsSync(snapDir)) {
        baselineCount = fs.readdirSync(snapDir).filter(f => f.endsWith('.png')).length;
      }
    } catch {}
  }

  return { scenarios, passed, failed, skipped, baselineCount };
}

function main() {
  const updateSnapshots = process.argv.includes('--update-snapshots');

  ensureDir(SCREENSHOT_DIR);
  ensureDir(REPORT_DIR);

  log('Kairo IDE Visual Regression Runner');
  log(`Spec: ${SPEC_FILE}`);
  log(`Screenshots: ${SCREENSHOT_DIR}`);

  if (!checkPlaywrightAvailable()) {
    log('Playwright 不可用，生成干运行报告...');
    generateDryRunReport();
    process.exit(0);
  }

  const isFirstRun = !hasBaseline();
  if (isFirstRun) {
    log('首次运行：将生成基线截图');
  } else {
    log('基线已存在：将对比截图');
  }

  const effectiveUpdate = updateSnapshots || isFirstRun;
  const result = runPlaywrightTests(effectiveUpdate);

  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }

  const details = parsePlaywrightOutput(result.stdout);

  if (result.exitCode === 0) {
    log('所有视觉回归测试通过');
    generateReport('PASS', details);
    process.exit(0);
  } else {
    fail(`视觉回归测试失败 (exit code: ${result.exitCode})`);

    let note = '部分测试失败。请检查差异截图。';
    if (isFirstRun) {
      note = '首次基线运行。部分测试需要 Theia 完整运行环境（如 Search Center、Settings UI 等）。确保 Theia Browser IDE 在 http://localhost:3000 上运行后重新执行。';
    }

    generateReport('PARTIAL', { ...details, note });
    process.exit(1);
  }
}

main();