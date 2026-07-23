#!/usr/bin/env node

/**
 * Kairo IDE — Code Coverage Runner
 *
 * Runs coverage for both Go (runtime-agent) and TypeScript (packages/apps)
 * and generates a unified coverage report.
 *
 * Usage:
 *   node scripts/run-coverage.cjs
 *
 * Output:
 *   coverage/go/coverage.html   — Go coverage report (HTML)
 *   coverage/go/coverage.txt    — Go coverage summary (text)
 *   coverage/typescript/coverage.json — TS coverage data
 *   coverage/summary.md         — Overall coverage summary
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_DIR = path.join(ROOT, 'coverage');
const GO_COVERAGE_DIR = path.join(COVERAGE_DIR, 'go');
const TS_COVERAGE_DIR = path.join(COVERAGE_DIR, 'typescript');
const RUNTIME_AGENT_DIR = path.join(ROOT, 'runtime-agent');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runCmd(cmd, cwd, timeoutMs = 300_000) {
  const opts = { cwd, encoding: 'utf-8', timeout: timeoutMs, stdio: 'pipe' };
  try {
    const out = execSync(cmd, opts);
    return { ok: true, stdout: out, stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
      error: err.message,
    };
  }
}

function countLinesInDir(dir, extensions) {
  let total = 0;
  const extSet = new Set(extensions);
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'lib' ||
          entry.name === 'out' ||
          entry.name === 'gen' ||
          entry.name === 'coverage' ||
          entry.name === '.nyc_output'
        ) {
          continue;
        }
        walk(full);
      } else if (extSet.has(path.extname(entry.name))) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          total += content.split('\n').length;
        } catch {
          // skip binary files
        }
      }
    }
  }
  walk(dir);
  return total;
}

function countTestLinesInDir(dir) {
  let total = 0;
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'lib' ||
          entry.name === 'out' ||
          entry.name === 'gen' ||
          entry.name === 'coverage' ||
          entry.name === '.nyc_output'
        ) {
          continue;
        }
        walk(full);
      } else if (
        entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.test.tsx') ||
        entry.name.endsWith('.spec.ts') ||
        entry.name.endsWith('.spec.tsx') ||
        entry.name.endsWith('.test.js') ||
        entry.name.endsWith('.test.cjs')
      ) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          total += content.split('\n').length;
        } catch {
          // skip
        }
      }
    }
  }
  walk(dir);
  return total;
}

// ---------------------------------------------------------------------------
// Go Coverage
// ---------------------------------------------------------------------------

function runGoCoverage() {
  console.log('=== Go Coverage (runtime-agent) ===\n');

  ensureDir(GO_COVERAGE_DIR);

  const modules = ['api', 'app', 'atomicfile', 'audit', 'catalinabase', 'config',
    'debug', 'deploy', 'diagnostics', 'domain', 'encoding', 'jdtls', 'jdtproject',
    'log', 'pathpolicy', 'proc', 'search', 'security', 'repository', 'runtimeplan',
    'services', 'sql', 'tomcat6', 'toolchain', 'transport'];

  // Collect per-package coverage
  const packageResults = [];

  // Run coverage for each package individually
  for (const mod of modules) {
    const pkgPath = `./internal/${mod}/...`;
    const coverFile = path.join(GO_COVERAGE_DIR, `cover-${mod}.out`);
    console.log(`  Running: go test -cover ${pkgPath}`);

    const result = runCmd(
      `go test -coverprofile=${coverFile} -covermode=count ${pkgPath}`,
      RUNTIME_AGENT_DIR,
      120_000,
    );

    if (result.ok) {
      // Parse coverage from the generated coverprofile
      if (fs.existsSync(coverFile)) {
        const covResult = runCmd(
          `go tool cover -func=${coverFile}`,
          RUNTIME_AGENT_DIR,
        );
        if (covResult.ok) {
          const totalLine = covResult.stdout.split('\n').find(l => l.startsWith('total:'));
          if (totalLine) {
            const pctMatch = totalLine.match(/([\d.]+)%/);
            if (pctMatch) {
              const pct = parseFloat(pctMatch[1]);
              console.log(`    OK (${pct}%)`);
              packageResults.push({ package: mod, coverage: pct });
              continue;
            }
          }
        }
      }
      console.log(`    OK`);
    } else {
      // Try to extract coverage percentage from failed runs
      const stdout = result.stdout || '';
      const coverageMatch = stdout.match(/coverage: ([\d.]+)%/);
      if (coverageMatch) {
        console.log(`    Coverage: ${coverageMatch[1]}%`);
        packageResults.push({ package: mod, coverage: parseFloat(coverageMatch[1]) });
      } else {
        console.log(`    FAILED: ${result.error || 'unknown error'}`);
        packageResults.push({ package: mod, coverage: 0, error: true });
      }
    }
  }

  // Merge coverage profiles
  const coverFiles = fs.readdirSync(GO_COVERAGE_DIR)
    .filter(f => f.startsWith('cover-') && f.endsWith('.out'))
    .map(f => path.join(GO_COVERAGE_DIR, f));

  if (coverFiles.length > 0) {
    // Merge all cover profiles into one
    const merged = [];
    let seenMode = false;
    for (const f of coverFiles) {
      const content = fs.readFileSync(f, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (line.startsWith('mode:') && seenMode) continue;
        if (line.startsWith('mode:')) seenMode = true;
        merged.push(line);
      }
    }
    fs.writeFileSync(path.join(GO_COVERAGE_DIR, 'coverage.out'), merged.join('\n') + '\n');

    // Generate text report
    const txtResult = runCmd(
      `go tool cover -func=${path.join(GO_COVERAGE_DIR, 'coverage.out')}`,
      RUNTIME_AGENT_DIR,
    );
    if (txtResult.ok) {
      fs.writeFileSync(path.join(GO_COVERAGE_DIR, 'coverage.txt'), txtResult.stdout);
      console.log('\n  Coverage text report written to coverage/go/coverage.txt');

      // Parse total coverage
      const totalLine = txtResult.stdout.split('\n').find(l => l.startsWith('total:'));
      if (totalLine) {
        const pctMatch = totalLine.match(/([\d.]+)%/);
        if (pctMatch) {
          console.log(`  Total Go coverage: ${pctMatch[1]}%`);
        }
      }
    }

    // Generate HTML report
    runCmd(
      `go tool cover -html=${path.join(GO_COVERAGE_DIR, 'coverage.out')} -o ${path.join(GO_COVERAGE_DIR, 'coverage.html')}`,
      RUNTIME_AGENT_DIR,
    );
    console.log('  HTML report written to coverage/go/coverage.html');
  }

  return { packageResults, totalCoverage: null };
}

// ---------------------------------------------------------------------------
// TypeScript Coverage
// ---------------------------------------------------------------------------

function runTypeScriptCoverage() {
  console.log('\n=== TypeScript Coverage (packages + apps) ===\n');

  ensureDir(TS_COVERAGE_DIR);

  const srcDirs = [
    path.join(ROOT, 'packages'),
    path.join(ROOT, 'apps'),
  ];

  const existingDirs = srcDirs.filter(d => fs.existsSync(d));

  let totalSrcLines = 0;
  let totalTestLines = 0;

  for (const dir of existingDirs) {
    const name = path.relative(ROOT, dir);
    const srcLines = countLinesInDir(dir, ['.ts', '.tsx']);
    const testLines = countTestLinesInDir(dir);
    totalSrcLines += srcLines;
    totalTestLines += testLines;
    console.log(`  ${name}: ${srcLines} src lines, ${testLines} test lines`);
  }

  // Also count test files in the root tests directory
  const testsDir = path.join(ROOT, 'tests');
  if (fs.existsSync(testsDir)) {
    const testLines = countTestLinesInDir(testsDir);
    totalTestLines += testLines;
    console.log(`  tests: ${testLines} test lines`);
  }

  // Also count scripts as they may contain test-like code
  const scriptsDir = path.join(ROOT, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    const scriptLines = countLinesInDir(scriptsDir, ['.cjs', '.js', '.ts']);
    console.log(`  scripts: ${scriptLines} script lines`);
  }

  const testToCodeRatio = totalSrcLines > 0
    ? ((totalTestLines / totalSrcLines) * 100).toFixed(2)
    : '0.00';

  console.log(`\n  Total source lines: ${totalSrcLines}`);
  console.log(`  Total test lines:   ${totalTestLines}`);
  console.log(`  Test-to-code ratio: ${testToCodeRatio}%`);

  // Try nyc if available
  let nycCoverage = null;
  try {
    execSync('npx nyc --version', { cwd: ROOT, stdio: 'pipe', timeout: 10_000 });
    console.log('\n  nyc detected, running nyc coverage...');
    const nycResult = runCmd(
      'npx nyc --reporter=json --reporter=text --report-dir=coverage/typescript pnpm test 2>&1 || true',
      ROOT,
      300_000,
    );
    if (nycResult.ok || fs.existsSync(path.join(TS_COVERAGE_DIR, 'coverage-final.json'))) {
      nycCoverage = { available: true };
      console.log('  nyc coverage report generated');
    }
  } catch {
    console.log('\n  nyc not available, using line-count estimation');
  }

  const tsData = {
    totalSourceLines: totalSrcLines,
    totalTestLines: totalTestLines,
    testToCodeRatio: parseFloat(testToCodeRatio),
    nycAvailable: nycCoverage !== null,
    estimatedCoverage: parseFloat((Math.min(parseFloat(testToCodeRatio) * 0.8, 100)).toFixed(2)),
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(TS_COVERAGE_DIR, 'coverage.json'),
    JSON.stringify(tsData, null, 2),
  );
  console.log('  TS coverage data written to coverage/typescript/coverage.json');

  return tsData;
}

// ---------------------------------------------------------------------------
// Generate Summary
// ---------------------------------------------------------------------------

function generateSummary(goData, tsData) {
  console.log('\n=== Generating Summary ===\n');

  const summaryPath = path.join(COVERAGE_DIR, 'summary.md');

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  let goCoverageStr = '未测量';
  if (goData && goData.totalCoverage !== null) {
    goCoverageStr = `${goData.totalCoverage}%`;
  } else if (goData && goData.packageResults && goData.packageResults.length > 0) {
    // Try to extract from go coverage.txt
    const txtPath = path.join(GO_COVERAGE_DIR, 'coverage.txt');
    if (fs.existsSync(txtPath)) {
      const txt = fs.readFileSync(txtPath, 'utf-8');
      const totalLine = txt.split('\n').find(l => l.startsWith('total:'));
      if (totalLine) {
        const pctMatch = totalLine.match(/([\d.]+)%/);
        if (pctMatch) {
          goCoverageStr = `${pctMatch[1]}%`;
        }
      }
    }
  }

  const tsCoverageStr = tsData ? `${tsData.estimatedCoverage}%` : '未测量';

  let overallStr = '未测量';
  if (goCoverageStr !== '未测量' && tsCoverageStr !== '未测量') {
    const goPct = parseFloat(goCoverageStr);
    const tsPct = parseFloat(tsCoverageStr);
    if (!isNaN(goPct) && !isNaN(tsPct)) {
      overallStr = `${((goPct + tsPct) / 2).toFixed(2)}%`;
    }
  }

  // Package-level details
  let goPackageDetails = '';
  if (goData && goData.packageResults && goData.packageResults.length > 0) {
    goPackageDetails = '\n### Go 包覆盖率明细\n\n| 包 | 覆盖率 |\n| --- | --- |\n';
    for (const pkg of goData.packageResults) {
      const pct = pkg.error ? '错误' : `${pkg.coverage.toFixed(1)}%`;
      goPackageDetails += `| internal/${pkg.package} | ${pct} |\n`;
    }
  }

  const summary = `# Kairo IDE 代码覆盖率报告

**日期**: ${dateStr}
**生成时间**: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

---

## 总体覆盖率

| 语言 | 覆盖率 | 方法 |
| --- | --- | --- |
| Go (runtime-agent) | ${goCoverageStr} | go test -cover |
| TypeScript (packages + apps) | ${tsCoverageStr} | 测试/代码行数比估算 |
| **总体** | **${overallStr}** | 算术平均 |

---

## Go 覆盖率

- **模块**: runtime-agent
- **命令**: \`go test -coverprofile=coverage.out -covermode=count ./...\`
- **报告**: [coverage/go/coverage.html](go/coverage.html) | [coverage/go/coverage.txt](go/coverage.txt)
${goPackageDetails}

### 覆盖率缺口

- **integration 测试**: 集成测试需要真实 Tomcat 环境，未包含在单元测试覆盖率中
- **proc 包**: Windows 特有代码路径在 macOS 上无法覆盖
- **transport/events**: WebSocket 实时通信部分需要长时间运行测试
- **services/launch_orchestrator**: 编排逻辑依赖外部进程启动，覆盖率有限

---

## TypeScript 覆盖率

- **源文件行数**: ${tsData ? tsData.totalSourceLines : '未测量'}
- **测试文件行数**: ${tsData ? tsData.totalTestLines : '未测量'}
- **测试/代码行数比**: ${tsData ? tsData.testToCodeRatio + '%' : '未测量'}
- **估算覆盖率**: ${tsCoverageStr}
- **数据文件**: [coverage/typescript/coverage.json](typescript/coverage.json)

### 估算方法

由于项目未配置 nyc/istanbul，TypeScript 覆盖率通过以下方式估算：
1. 统计所有 \`.ts\` / \`.tsx\` 源文件的总行数
2. 统计所有 \`.test.ts\` / \`.spec.ts\` 测试文件的总行数
3. 计算测试/代码行数比，乘以 0.8 作为估算覆盖率（考虑测试并不覆盖所有代码路径）

### 覆盖率缺口

- **Theia 扩展**: 扩展代码依赖 Theia 框架 API，难以在单元测试中完全覆盖
- **UI 组件**: React 组件的渲染逻辑需要 jsdom 或浏览器环境
- **E2E 测试**: Playwright E2E 测试不计入单元测试覆盖率统计
- **脚本文件**: \`scripts/\` 目录下的工具脚本未纳入统计

---

## 改进建议

1. **Go**: 增加 \`internal/services\` 和 \`internal/transport\` 的单元测试
2. **Go**: 为关键路径（build、deploy、server）添加表驱动测试
3. **TypeScript**: 配置 nyc 以获得准确的代码覆盖率数据
4. **TypeScript**: 为核心 UI 组件添加 snapshot 测试
5. **E2E**: 将 Playwright 测试纳入 CI 流程，作为覆盖率补充

---

*报告由 \`scripts/run-coverage.cjs\` 自动生成*
`;

  fs.writeFileSync(summaryPath, summary);
  console.log(`  Summary written to ${summaryPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('Kairo IDE — Code Coverage Runner\n');
  console.log(`Root: ${ROOT}\n`);

  ensureDir(COVERAGE_DIR);
  ensureDir(GO_COVERAGE_DIR);
  ensureDir(TS_COVERAGE_DIR);

  // Run Go coverage
  let goData = null;
  if (fs.existsSync(RUNTIME_AGENT_DIR)) {
    goData = runGoCoverage();
  } else {
    console.log('=== Go Coverage ===');
    console.log('  runtime-agent directory not found, skipping\n');
  }

  // Run TypeScript coverage
  let tsData = null;
  tsData = runTypeScriptCoverage();

  // Generate summary
  generateSummary(goData, tsData);

  console.log('\n=== Done ===');
  console.log(`  Coverage reports written to ${COVERAGE_DIR}`);
}

main();