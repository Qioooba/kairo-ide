/**
 * Kairo IDE — E2E Test Report Generator
 *
 * Generates a comprehensive test report from Playwright JSON results
 * and API smoke test output. Run after executing all E2E tests.
 *
 * Usage: node test-report.cjs [--json results.json] [--output report.md]
 */
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'test-results');
const REPORT_FILE = path.join(RESULTS_DIR, 'e2e-report.md');
const JSON_FILE = path.join(RESULTS_DIR, 'results.json');

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let jsonFile = JSON_FILE;
let outputFile = REPORT_FILE;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json' && args[i + 1]) {
    jsonFile = args[++i];
  } else if (args[i] === '--output' && args[i + 1]) {
    outputFile = args[++i];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    sections: [],
  };

  // Try to read Playwright JSON results
  if (fs.existsSync(jsonFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
      report.sections.push(buildPlaywrightSection(data));
    } catch (err) {
      report.sections.push({
        title: 'Playwright Results',
        status: 'ERROR',
        message: `Failed to parse results: ${err.message}`,
      });
    }
  } else {
    report.sections.push({
      title: 'Playwright Results',
      status: 'SKIPPED',
      message: 'No Playwright JSON results found. Run tests first.',
    });
  }

  // Scan for test artifacts
  report.sections.push(buildArtifactsSection());

  // Build the report
  const markdown = buildMarkdown(report);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, markdown, 'utf-8');

  console.log(`\nE2E Test Report generated: ${outputFile}`);
  console.log(`  Sections: ${report.sections.length}`);
  console.log(`  Platform: ${report.platform}`);

  // Print summary to console
  console.log('\n' + '='.repeat(60));
  console.log('E2E TEST REPORT SUMMARY');
  console.log('='.repeat(60));
  for (const section of report.sections) {
    const statusIcon = section.status === 'PASS' ? '✅' :
      section.status === 'FAIL' ? '❌' :
      section.status === 'SKIPPED' ? '⏭️' : '⚠️';
    console.log(`  ${statusIcon} ${section.title}: ${section.summary || section.status}`);
  }
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Build Playwright section
// ---------------------------------------------------------------------------
function buildPlaywrightSection(data) {
  const section = {
    title: 'Playwright E2E Tests',
    status: 'UNKNOWN',
    summary: '',
    details: {},
  };

  if (!data || !data.suites) {
    section.status = 'EMPTY';
    section.summary = 'No test suites found';
    return section;
  }

  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const testResults = [];

  // Flatten all suites and tests
  function walkSuites(suites, indent = 0) {
    for (const suite of suites) {
      if (suite.suites) {
        walkSuites(suite.suites, indent + 1);
      }
      if (suite.specs) {
        for (const spec of suite.specs) {
          totalTests++;
          const tests = spec.tests || [];
          for (const t of tests) {
            const result = t.results && t.results.length > 0 ? t.results[0] : null;
            const status = result ? result.status : (t.expectedStatus || 'unknown');
            if (status === 'passed' || status === 'expected') passed++;
            else if (status === 'failed' || status === 'unexpected') failed++;
            else if (status === 'skipped') skipped++;

            testResults.push({
              title: t.title,
              status: status,
              duration: result ? result.duration : 0,
              errors: result && result.errors ? result.errors.map(e => e.message) : [],
            });
          }
        }
      }
    }
  }

  walkSuites(data.suites);

  section.summary = `${passed}/${totalTests} passed, ${failed} failed, ${skipped} skipped`;
  section.status = failed === 0 && totalTests > 0 ? 'PASS' : (totalTests === 0 ? 'EMPTY' : 'FAIL');
  section.details = {
    total: totalTests,
    passed,
    failed,
    skipped,
    passRate: totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) + '%' : 'N/A',
    results: testResults,
  };

  return section;
}

// ---------------------------------------------------------------------------
// Build artifacts section
// ---------------------------------------------------------------------------
function buildArtifactsSection() {
  const section = {
    title: 'Test Artifacts',
    status: 'INFO',
    summary: '',
    details: {},
  };

  const artifacts = [];

  // Check for screenshots
  const screenshotsDir = path.join(RESULTS_DIR);
  if (fs.existsSync(screenshotsDir)) {
    const files = fs.readdirSync(screenshotsDir, { recursive: true, withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => path.join(f.path || screenshotsDir, f.name));

    const pngs = files.filter(f => f.endsWith('.png'));
    const videos = files.filter(f => f.endsWith('.webm'));
    const traces = files.filter(f => f.endsWith('.zip'));

    if (pngs.length > 0) artifacts.push(`${pngs.length} screenshots`);
    if (videos.length > 0) artifacts.push(`${videos.length} videos`);
    if (traces.length > 0) artifacts.push(`${traces.length} traces`);
  }

  // Check for HTML report
  const htmlReport = path.join(RESULTS_DIR, 'report', 'index.html');
  if (fs.existsSync(htmlReport)) {
    artifacts.push('HTML report available');
  }

  section.summary = artifacts.length > 0 ? artifacts.join(', ') : 'No artifacts found';
  section.details.artifacts = artifacts;

  return section;
}

// ---------------------------------------------------------------------------
// Build Markdown
// ---------------------------------------------------------------------------
function buildMarkdown(report) {
  const lines = [];

  lines.push('# Kairo IDE — E2E Test Report');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Platform:** ${report.platform}`);
  lines.push(`**Node.js:** ${report.nodeVersion}`);
  lines.push('');

  lines.push('---');
  lines.push('');

  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    lines.push('');

    const statusIcon = section.status === 'PASS' ? '✅' :
      section.status === 'FAIL' ? '❌' :
      section.status === 'SKIPPED' ? '⏭️' : 'ℹ️';
    lines.push(`**Status:** ${statusIcon} ${section.status}`);
    lines.push(`**Summary:** ${section.summary}`);
    lines.push('');

    if (section.details) {
      const d = section.details;
      if (d.total !== undefined) {
        lines.push('| Metric | Value |');
        lines.push('|--------|-------|');
        lines.push(`| Total Tests | ${d.total} |`);
        lines.push(`| Passed | ${d.passed} |`);
        lines.push(`| Failed | ${d.failed} |`);
        lines.push(`| Skipped | ${d.skipped} |`);
        lines.push(`| Pass Rate | ${d.passRate} |`);
        lines.push('');
      }

      if (d.results && d.results.length > 0) {
        lines.push('### Test Results');
        lines.push('');
        lines.push('| # | Test | Status | Duration |');
        lines.push('|---|------|--------|----------|');
        d.results.forEach((r, i) => {
          const icon = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
          lines.push(`| ${i + 1} | ${r.title} | ${icon} ${r.status} | ${(r.duration / 1000).toFixed(1)}s |`);
          if (r.errors && r.errors.length > 0) {
            for (const err of r.errors) {
              lines.push(`| | Error: ${err.substring(0, 100)} | | |`);
            }
          }
        });
        lines.push('');
      }

      if (d.artifacts && d.artifacts.length > 0) {
        lines.push('### Artifacts');
        lines.push('');
        for (const a of d.artifacts) {
          lines.push(`- ${a}`);
        }
        lines.push('');
      }
    }

    if (section.message) {
      lines.push(`> ${section.message}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Test Coverage Summary
  lines.push('## Test Coverage Summary');
  lines.push('');
  lines.push('| Test Suite | File | Status |');
  lines.push('|------------|------|--------|');
  lines.push('| API Smoke | `api-smoke.cjs` | ✅ Defined |');
  lines.push('| Core E2E | `core-e2e.spec.ts` | ✅ Defined |');
  lines.push('| Desktop E2E | `desktop-e2e.spec.ts` | ✅ Defined |');
  lines.push('| Frontend E2E | `frontend-e2e.spec.ts` | ✅ Defined |');
  lines.push('| Boundary E2E | `boundary-e2e.spec.ts` | ✅ Defined |');
  lines.push('| Windows E2E | `windows-e2e.spec.ts` | ✅ Defined |');
  lines.push('| Standalone Smoke | `standalone-smoke.spec.ts` | ✅ Defined |');
  lines.push('| Agent E2E (Go) | `agent-e2e/agent_e2e_test.go` | ✅ Defined |');
  lines.push('| Visual Regression | `visual-regression.cjs` | ✅ Defined |');
  lines.push('| Accessibility | `a11y-scan.cjs` | ✅ Defined |');
  lines.push('| UI Full Chain | `ui-full-chain.cjs` | ✅ Defined |');
  lines.push('');

  // Legacy Project Fixtures
  lines.push('## Legacy Project Fixtures');
  lines.push('');
  lines.push('| File | Description |');
  lines.push('|------|-------------|');
  lines.push('| `fixtures/legacy-project/build.xml` | Ant build (Java 6 target) |');
  lines.push('| `fixtures/legacy-project/src/main/java/com/example/HelloServlet.java` | GBK-encoded Servlet |');
  lines.push('| `fixtures/legacy-project/src/main/java/com/example/UserDAO.java` | GBK-encoded DAO |');
  lines.push('| `fixtures/legacy-project/src/main/java/com/example/DBUtil.java` | GBK-encoded DB utility |');
  lines.push('| `fixtures/legacy-project/web/WEB-INF/web.xml` | Servlet 2.4 descriptor |');
  lines.push('| `fixtures/legacy-project/web/index.jsp` | JSP with Scriptlet/EL/TLD |');
  lines.push('| `fixtures/legacy-project/web/hello.jsp` | GBK-encoded JSP |');
  lines.push('| `fixtures/legacy-project/web/error.jsp` | Error page |');
  lines.push('| `fixtures/legacy-project/web/WEB-INF/custom.tld` | Custom TLD |');
  lines.push('| `fixtures/legacy-project/lib/servlet-api.jar.txt` | Mock servlet-api.jar |');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
main();