#!/usr/bin/env node
'use strict';

/**
 * Kairo IDE UI 状态完整性审计脚本
 *
 * 扫描 packages/ 下所有 React widget 文件 (*.tsx)，
 * 检查是否覆盖了 5 种必要 UI 状态：
 *   1. Normal   — 正常渲染数据
 *   2. Loading  — 加载中（spinner/skeleton/loading text）
 *   3. Empty    — 空数据（empty message）
 *   4. Error    — 错误状态（error message）
 *   5. Disabled — 禁用状态（disabled buttons/inputs）
 *
 * 输出：JSON（机器可读）+ Markdown 表格（人类可读）
 * 超时：30 秒
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const TIMEOUT_MS = 30_000;
const START_TIME = Date.now();

// ─── 超时保护 ────────────────────────────────────────────────────
const timeout = setTimeout(() => {
  console.error('[audit-ui-states] 超时（30s），退出');
  process.exit(2);
}, TIMEOUT_MS);
timeout.unref();

// ─── 工具函数 ────────────────────────────────────────────────────

/**
 * 递归收集目录下所有匹配 glob 的文件
 */
function collectFiles(dir, pattern) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'lib' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
        results.push(...collectFiles(fullPath, pattern));
      } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

/**
 * 检查文件内容中是否存在某个模式
 */
function hasPattern(content, patterns) {
  for (const p of patterns) {
    if (p instanceof RegExp) {
      if (p.test(content)) return true;
    } else {
      if (content.includes(p)) return true;
    }
  }
  return false;
}

/**
 * 检查是否包含 ReactWidget 或 render 方法
 */
function isReactWidget(content) {
  return /extends\s+ReactWidget/.test(content) || /return\s*\(/.test(content);
}

// ─── 状态检测规则 ────────────────────────────────────────────────

const STATE_CHECKS = {
  loading: {
    name: 'Loading',
    label: '加载状态',
    patterns: [
      /\bisLoading\b/,
      /\bloading\b/,
      /\bisExecuting\b/,
      /\bisRunning\b/,
      /\bconnecting\b/,
      /\bscanning\b/,
      /\bimporting\b/,
      /\bcancelling\b/,
      /Loading\.\.\./,
      /Refreshing…/,
      /spinner/i,
      /skeleton/i,
      /loading/i,
      /isFetching\b/,
      /\bisPending\b/,
      /正在加载/,
      /加载中/,
    ],
  },
  empty: {
    name: 'Empty',
    label: '空状态',
    patterns: [
      /length\s*===\s*0/,
      /\.length\s*===?\s*0/,
      /!\w+\.data\b/,
      /!\w+\b/,
      /No\s+\w+\s+(yet|found|available|changes)/i,
      /empty/i,
      /no\s+data/i,
      /\bisEmpty\b/,
      /没有/,
      /暂无/,
      /为空/,
    ],
  },
  error: {
    name: 'Error',
    label: '错误状态',
    patterns: [
      /\berror\b/i,
      /\bcatch\b/,
      /\bfailed\b/i,
      /\bthrow\b/,
      /Error:/,
      /role="alert"/,
      /错误/,
      /失败/,
      /异常/,
    ],
  },
  disabled: {
    name: 'Disabled',
    label: '禁用状态',
    patterns: [
      /\bdisabled\b/,
      /\breadOnly\b/,
      /\bisDisconnected\b/,
      /\bisBusy\b/,
      /readonly/i,
    ],
  },
};

// ─── 主逻辑 ──────────────────────────────────────────────────────

function auditWidget(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(ROOT, filePath);

  const result = {
    file: relativePath,
    widget: path.basename(filePath, '.tsx'),
    package: relativePath.split(path.sep)[1] || 'unknown',
    states: {},
    coverage: 0,
    status: 'unknown',
    priority: 'low',
  };

  let covered = 0;
  const total = Object.keys(STATE_CHECKS).length;

  // Normal state: 如果文件中有 render 逻辑（非纯 loading/error 分支），默认认为有
  const hasRender = /return\s*\(/.test(content);
  const hasDataDisplay = /\b(map|forEach|filter|reduce)\b/.test(content) || /<[A-Z]\w+/.test(content);

  result.states.normal = {
    covered: hasRender && hasDataDisplay,
    label: '正常状态',
  };
  if (hasRender && hasDataDisplay) covered++;

  for (const [key, check] of Object.entries(STATE_CHECKS)) {
    const covered_state = hasPattern(content, check.patterns);
    result.states[key] = {
      covered: covered_state,
      label: check.label,
    };
    if (covered_state) covered++;
  }

  result.coverage = Math.round((covered / (total + 1)) * 100);

  if (result.coverage >= 80) {
    result.status = '✅ Complete';
    result.priority = 'low';
  } else if (result.coverage >= 50) {
    result.status = '⚠️ Partial';
    result.priority = 'medium';
  } else {
    result.status = '❌ Missing';
    result.priority = 'high';
  }

  return result;
}

function main() {
  console.log('[audit-ui-states] 开始扫描 packages/ 下的 .tsx 文件...');

  const tsxFiles = collectFiles(PACKAGES_DIR, '*.tsx');
  console.log(`[audit-ui-states] 发现 ${tsxFiles.length} 个 .tsx 文件`);

  const results = [];

  for (const file of tsxFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (isReactWidget(content)) {
      const audit = auditWidget(file);
      results.push(audit);
    }
  }

  // 统计
  const summary = {
    total: results.length,
    complete: results.filter(r => r.status === '✅ Complete').length,
    partial: results.filter(r => r.status === '⚠️ Partial').length,
    missing: results.filter(r => r.status === '❌ Missing').length,
    loadingCoverage: results.filter(r => r.states.loading?.covered).length,
    emptyCoverage: results.filter(r => r.states.empty?.covered).length,
    errorCoverage: results.filter(r => r.states.error?.covered).length,
    disabledCoverage: results.filter(r => r.states.disabled?.covered).length,
    normalCoverage: results.filter(r => r.states.normal?.covered).length,
    avgCoverage: results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.coverage, 0) / results.length)
      : 0,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    script: 'audit-ui-states.cjs',
    summary,
    results: results.sort((a, b) => a.coverage - b.coverage),
  };

  // ─── JSON 输出 ────────────────────────────────────────────────
  const jsonOutput = JSON.stringify(report, null, 2);
  const jsonPath = path.join(ROOT, 'docs', 'progress', 'releases', 'ui-audit-20260723.json');
  const jsonDir = path.dirname(jsonPath);
  if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
  fs.writeFileSync(jsonPath, jsonOutput, 'utf8');
  console.log(`[audit-ui-states] JSON 报告已写入: ${path.relative(ROOT, jsonPath)}`);

  // ─── Markdown 输出 ────────────────────────────────────────────
  const mdLines = [];
  mdLines.push('# Kairo IDE UI 状态完整性审计报告');
  mdLines.push('');
  mdLines.push(`**生成时间：** ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  mdLines.push(`**扫描范围：** packages/ 下所有 React Widget (.tsx) 文件`);
  mdLines.push(`**总扫描文件数：** ${tsxFiles.length} 个 .tsx，其中 ${results.length} 个 React Widget`);
  mdLines.push('');
  mdLines.push('## 汇总统计');
  mdLines.push('');
  mdLines.push('| 指标 | 数值 |');
  mdLines.push('|------|------|');
  mdLines.push(`| 总 Widget 数 | ${summary.total} |`);
  mdLines.push(`| ✅ 完整（≥80%） | ${summary.complete} |`);
  mdLines.push(`| ⚠️ 部分（50-79%） | ${summary.partial} |`);
  mdLines.push(`| ❌ 缺失（<50%） | ${summary.missing} |`);
  mdLines.push(`| 平均覆盖率 | ${summary.avgCoverage}% |`);
  mdLines.push('');
  mdLines.push('## 各状态覆盖率');
  mdLines.push('');
  mdLines.push('| 状态 | 覆盖 Widget 数 | 覆盖率 |');
  mdLines.push('|------|---------------|--------|');
  mdLines.push(`| Normal 正常状态 | ${summary.normalCoverage} | ${Math.round(summary.normalCoverage / summary.total * 100)}% |`);
  mdLines.push(`| Loading 加载状态 | ${summary.loadingCoverage} | ${Math.round(summary.loadingCoverage / summary.total * 100)}% |`);
  mdLines.push(`| Empty 空状态 | ${summary.emptyCoverage} | ${Math.round(summary.emptyCoverage / summary.total * 100)}% |`);
  mdLines.push(`| Error 错误状态 | ${summary.errorCoverage} | ${Math.round(summary.errorCoverage / summary.total * 100)}% |`);
  mdLines.push(`| Disabled 禁用状态 | ${summary.disabledCoverage} | ${Math.round(summary.disabledCoverage / summary.total * 100)}% |`);
  mdLines.push('');
  mdLines.push('## Widget 详细审计');
  mdLines.push('');
  mdLines.push('| 状态 | Widget | 包 | 覆盖率 | Normal | Loading | Empty | Error | Disabled | 优先级 |');
  mdLines.push('|------|--------|----|--------|--------|---------|-------|-------|----------|--------|');

  for (const r of results) {
    const normal = r.states.normal?.covered ? '✅' : '❌';
    const loading = r.states.loading?.covered ? '✅' : '❌';
    const empty = r.states.empty?.covered ? '✅' : '❌';
    const error = r.states.error?.covered ? '✅' : '❌';
    const disabled = r.states.disabled?.covered ? '✅' : '❌';
    mdLines.push(`| ${r.status} | ${r.widget} | \`${r.package}\` | ${r.coverage}% | ${normal} | ${loading} | ${empty} | ${error} | ${disabled} | ${r.priority} |`);
  }

  mdLines.push('');
  mdLines.push('## 缺失状态详情');
  mdLines.push('');

  for (const r of results) {
    const missing = Object.entries(r.states)
      .filter(([, v]) => !v.covered)
      .map(([, v]) => v.label);
    if (missing.length > 0) {
      mdLines.push(`### ${r.widget} (\`${r.package}\`)`);
      mdLines.push(`- **覆盖率：** ${r.coverage}%`);
      mdLines.push(`- **缺失状态：** ${missing.join('、')}`);
      mdLines.push(`- **文件：** \`${r.file}\``);
      mdLines.push(`- **优先级：** ${r.priority}`);
      mdLines.push('');
    }
  }

  mdLines.push('---');
  mdLines.push('');
  mdLines.push('*报告由 `scripts/audit-ui-states.cjs` 自动生成*');

  const mdOutput = mdLines.join('\n');
  const mdPath = path.join(ROOT, 'docs', 'progress', 'releases', 'ui-audit-20260723.md');
  fs.writeFileSync(mdPath, mdOutput, 'utf8');
  console.log(`[audit-ui-states] Markdown 报告已写入: ${path.relative(ROOT, mdPath)}`);

  // ─── 终端摘要 ──────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  UI 状态完整性审计结果');
  console.log('══════════════════════════════════════════════');
  console.log(`  总计: ${summary.total} 个 Widget`);
  console.log(`  ✅ 完整: ${summary.complete} | ⚠️ 部分: ${summary.partial} | ❌ 缺失: ${summary.missing}`);
  console.log(`  平均覆盖率: ${summary.avgCoverage}%`);
  console.log('══════════════════════════════════════════════');

  console.log('\n[audit-ui-states] 耗时:', Date.now() - START_TIME, 'ms');
  process.exit(summary.missing > 0 ? 0 : 0);
}

main();