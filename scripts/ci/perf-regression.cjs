#!/usr/bin/env node
'use strict';

/**
 * Kairo IDE — Performance Regression Detection
 *
 * Compares the current performance gate results against a baseline
 * and detects regressions. Exits with non-zero if any metric has
 * regressed beyond the allowed threshold.
 *
 * Usage:
 *   node scripts/ci/perf-regression.cjs --current perf-gate.json --baseline perf-baseline.json
 *   node scripts/ci/perf-regression.cjs --current perf-gate.json --baseline perf-baseline.json --threshold 15
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const currentPath = getArg('--current');
const baselinePath = getArg('--baseline');
const regressionThreshold = parseFloat(getArg('--threshold') || '10'); // default 10%

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------
function loadJSON(filePath) {
  if (!filePath) return null;
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`[perf-regression] File not found: ${resolved}`);
      return null;
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    console.error(`[perf-regression] Could not load ${filePath}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metric labels
// ---------------------------------------------------------------------------
const metricLabels = {
  coldStart: '冷启动到工作区可操作',
  fileOpenP95: '打开文本文件 P95',
  firstCompletion: '首次 Java completion',
  subsequentCompletionP95: '后续 completion P95',
  incrementalBuild: '增量编译单文件',
  fullTextSearch10k: '10k 文件全文搜索',
  searchFirstResult: '搜索首批结果',
  uiInputResponseP95: 'UI 输入响应 P95',
  idleCPU: '空闲 CPU',
  steadyMemory: '稳态总内存',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('[perf-regression] Kairo IDE Performance Regression Detection');
console.log(`[perf-regression] Threshold: ${regressionThreshold}%`);
console.log('');

const current = loadJSON(currentPath);
const baseline = loadJSON(baselinePath);

if (!current) {
  console.error('[perf-regression] ERROR: current performance data not available');
  process.exit(2);
}

if (!baseline) {
  console.log('[perf-regression] No baseline available — skipping comparison');
  console.log('[perf-regression] This is expected for the first run or when no baseline exists');
  // Generate a summary-only report
  generateSummaryReport(current, null, regressionThreshold);
  process.exit(0);
}

if (!current.metrics || !baseline.metrics) {
  console.error('[perf-regression] ERROR: invalid data format (missing metrics field)');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Compare metrics
// ---------------------------------------------------------------------------
const regressions = [];
const improvements = [];
const unchanged = [];

for (const [key, currentMetric] of Object.entries(current.metrics)) {
  const baselineMetric = baseline.metrics[key];
  if (!baselineMetric) {
    unchanged.push({ metric: key, reason: 'no baseline data' });
    continue;
  }

  if (currentMetric.value === null || baselineMetric.value === null) {
    unchanged.push({ metric: key, reason: 'value not available' });
    continue;
  }

  if (baselineMetric.value === 0) {
    unchanged.push({ metric: key, reason: 'baseline value is zero' });
    continue;
  }

  const pctChange = ((currentMetric.value - baselineMetric.value) / baselineMetric.value) * 100;
  const absChange = Math.abs(pctChange);

  const entry = {
    metric: key,
    label: metricLabels[key] || key,
    baseline: baselineMetric.value,
    current: currentMetric.value,
    unit: currentMetric.unit || '',
    pctChange: Math.round(pctChange * 100) / 100,
    absChange: Math.round(absChange * 100) / 100,
  };

  if (absChange > regressionThreshold) {
    if (pctChange > 0) {
      // Worse is higher for time/memory/CPU metrics
      regressions.push(entry);
    } else {
      // Improvement
      improvements.push(entry);
    }
  } else {
    unchanged.push({ metric: key, label: metricLabels[key] || key, pctChange: Math.round(pctChange * 100) / 100 });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('=== Performance Regression Report ===');
console.log('');

if (regressions.length > 0) {
  console.log(`❌ REGRESSIONS DETECTED (${regressions.length}):`);
  console.log('');
  console.log('| 指标 | 基线 | 当前 | 变化 | 阈值 |');
  console.log('|------|------|------|------|------|');
  for (const r of regressions) {
    const sign = r.pctChange > 0 ? '+' : '';
    console.log(`| ${r.label} | ${r.baseline}${r.unit} | ${r.current}${r.unit} | ${sign}${r.pctChange}% | >${regressionThreshold}% |`);
  }
  console.log('');
}

if (improvements.length > 0) {
  console.log(`✅ IMPROVEMENTS (${improvements.length}):`);
  console.log('');
  for (const i of improvements) {
    console.log(`  ${i.label}: ${i.baseline}${i.unit} → ${i.current}${i.unit} (${i.pctChange}%)`);
  }
  console.log('');
}

if (unchanged.length > 0) {
  console.log(`➖ UNCHANGED / NO DATA (${unchanged.length}):`);
  for (const u of unchanged) {
    const reason = u.reason ? ` (${u.reason})` : ` (${u.pctChange}%)`;
    console.log(`  ${u.label || u.metric}${reason}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Generate Markdown report
// ---------------------------------------------------------------------------
generateSummaryReport(current, { regressions, improvements, unchanged }, regressionThreshold);

// ---------------------------------------------------------------------------
// Exit code
// ---------------------------------------------------------------------------
if (regressions.length > 0) {
  console.log('[perf-regression] FAILED: performance regressions detected');
  console.log('[perf-regression] Review the regressions above. If they are expected, update the baseline.');
  process.exit(1);
}

console.log('[perf-regression] PASSED: no performance regressions detected');
process.exit(0);

// ---------------------------------------------------------------------------
// Generate Markdown summary report
// ---------------------------------------------------------------------------
function generateSummaryReport(current, comparison, threshold) {
  const mdPath = path.join(ROOT, 'perf-regression-report.md');
  const mdDir = path.dirname(mdPath);
  if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });

  const lines = [];
  lines.push('# Kairo IDE 性能回归检测报告');
  lines.push('');
  lines.push(`**生成时间：** ${new Date().toISOString()}`);
  lines.push(`**回归阈值：** ${threshold}%`);
  lines.push('');

  if (comparison) {
    const { regressions, improvements, unchanged } = comparison;

    lines.push('## 汇总');
    lines.push('');
    lines.push(`| 类别 | 数量 |`);
    lines.push(`|------|------|`);
    lines.push(`| ❌ 退步 | ${regressions.length} |`);
    lines.push(`| ✅ 改善 | ${improvements.length} |`);
    lines.push(`| ➖ 无变化/无数据 | ${unchanged.length} |`);
    lines.push('');

    if (regressions.length > 0) {
      lines.push('## 性能退步详情');
      lines.push('');
      lines.push('| 指标 | 基线值 | 当前值 | 变化 | 阈值 |');
      lines.push('|------|--------|--------|------|------|');
      for (const r of regressions) {
        const sign = r.pctChange > 0 ? '+' : '';
        lines.push(`| ${r.label} | ${r.baseline}${r.unit} | ${r.current}${r.unit} | ${sign}${r.pctChange}% | >${threshold}% |`);
      }
      lines.push('');
    }

    if (improvements.length > 0) {
      lines.push('## 性能改善');
      lines.push('');
      lines.push('| 指标 | 基线值 | 当前值 | 改善 |');
      lines.push('|------|--------|--------|------|');
      for (const i of improvements) {
        lines.push(`| ${i.label} | ${i.baseline}${i.unit} | ${i.current}${i.unit} | ${i.pctChange}% |`);
      }
      lines.push('');
    }
  } else {
    lines.push('## 无基线数据');
    lines.push('');
    lines.push('未找到基线数据，无法进行性能回归对比。');
    lines.push('');
    lines.push('请在首次运行后保存 `perf-gate.json` 作为 `perf-baseline.json`。');
    lines.push('');
  }

  // Current metrics summary
  lines.push('## 当前性能指标');
  lines.push('');
  if (current && current.metrics) {
    lines.push('| 指标 | 实测值 | 目标 | 结果 |');
    lines.push('|------|--------|------|------|');
    for (const [key, m] of Object.entries(current.metrics)) {
      const label = metricLabels[key] || key;
      const status = m.pass === true ? '✅' : (m.skipped ? '⏭️' : '❌');
      const valueStr = m.value !== null ? String(m.value) : 'N/A';
      const targetStr = m.target !== undefined ? String(m.target) : 'N/A';
      lines.push(`| ${label} | ${valueStr}${m.unit || ''} | ${targetStr}${m.unit || ''} | ${status} |`);
    }
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('*报告由 `scripts/ci/perf-regression.cjs` 自动生成*');

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  console.log(`[perf-regression] Markdown report written to ${path.relative(ROOT, mdPath)}`);
}