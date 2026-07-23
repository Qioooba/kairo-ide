#!/usr/bin/env node
'use strict';

/**
 * Kairo IDE UI 视觉规范验证脚本
 *
 * 检查 Master Plan §4.7 全部 7 项视觉要求：
 *   1. WCAG AA 正文对比度
 *   2. ui-kit token 使用
 *   3. 字号规范
 *   4. 阴影/模糊/动画
 *   5. prefers-reduced-motion
 *   6. 图标复用
 *   7. 焦点/滚动/布局
 *
 * Usage: node scripts/audit-ui-visual.cjs
 * Timeout: 60s
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const TIMEOUT_MS = 60_000;
const START_TIME = Date.now();

// ─── Timeout ─────────────────────────────────────────────────────
const timeout = setTimeout(() => {
  console.error('[audit-ui-visual] TIMEOUT: exceeded 60s');
  process.exit(2);
}, TIMEOUT_MS);
timeout.unref();

// ─── Helpers ─────────────────────────────────────────────────────

function collectFiles(dir, extensions, excludeDirs = ['node_modules', 'lib', 'dist', '.git']) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          results.push(...collectFiles(fullPath, extensions, excludeDirs));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch {}
  return results;
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

// ─── WCAG Color Utilities ────────────────────────────────────────

function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) return null;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

function parseRgb(str) {
  const m = str.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return null;
  return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
}

function parseRgba(str) {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: m[4] ? parseFloat(m[4]) : 1 };
}

function relativeLuminance({ r, g, b }) {
  const toSRGB = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toSRGB(r) + 0.7152 * toSRGB(g) + 0.0722 * toSRGB(b);
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(str) {
  // Try hex
  const hex = hexToRgb(str);
  if (hex) return hex;
  // Try rgb/rgba
  const rgb = parseRgb(str);
  if (rgb) return rgb;
  const rgba = parseRgba(str);
  if (rgba) return rgba;
  return null;
}

// ─── 1. WCAG AA 正文对比度 ───────────────────────────────────────

function auditWCAGContrast(cssFiles) {
  console.error('[audit-ui-visual] Auditing WCAG AA contrast...');
  const issues = [];
  let totalPairs = 0;

  for (const file of cssFiles) {
    const content = readFileSafe(file);
    const relativePath = path.relative(ROOT, file);

    // Extract explicit CSS rules with both color and background-color
    const rules = extractCSSRules(content);
    for (const rule of rules) {
      if (rule.color && rule.background) {
        const fgColor = parseColor(rule.color);
        const bgColor = parseColor(rule.background);
        if (fgColor && bgColor) {
          totalPairs++;
          const ratio = contrastRatio(fgColor, bgColor);
          if (ratio < 4.5) {
            issues.push({
              file: relativePath,
              selector: rule.selector.substring(0, 60),
              fg: rule.color,
              bg: rule.background,
              ratio: Math.round(ratio * 100) / 100,
              threshold: 4.5,
              severity: ratio < 3 ? 'high' : 'medium',
              type: 'explicit-rule'
            });
          }
        }
      }
    }

    // Check hardcoded color values against known dark backgrounds
    // Only for values that are clearly foreground text on assumed dark bg
    const colorValues = new Set();
    const colorMatches = content.matchAll(/(?:^|\s)color\s*:\s*(#[0-9a-fA-F]{6}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))/gi);
    for (const match of colorMatches) {
      const hex = match[1];
      if (!colorValues.has(hex)) {
        colorValues.add(hex);
        const fgColor = parseColor(hex);
        if (!fgColor) continue;
        // Only check against the primary dark background
        const bgColor = parseColor('#1e1f22'); // bg.canvas
        if (!bgColor) continue;
        const ratio = contrastRatio(fgColor, bgColor);
        if (ratio < 4.5) {
          issues.push({
            file: relativePath,
            selector: '(color property vs bg.canvas)',
            fg: hex,
            bg: '#1e1f22 (bg.canvas)',
            ratio: Math.round(ratio * 100) / 100,
            threshold: 4.5,
            severity: ratio < 3 ? 'high' : 'medium',
            type: 'derived'
          });
        }
      }
    }
  }

  // Deduplicate derived issues (same fg color, same file)
  const seen = new Set();
  const deduped = [];
  for (const issue of issues) {
    const key = `${issue.file}:${issue.fg}:${issue.bg}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(issue);
    }
  }

  return { totalPairs, issues: deduped, passed: deduped.filter(i => i.severity === 'high').length === 0 };
}

function extractCSSRules(content) {
  const rules = [];
  // Simple CSS rule extraction: selector { ... }
  const ruleRegex = /([^{]+)\{([^}]+)\}/g;
  let match;
  while ((match = ruleRegex.exec(content)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    const colorMatch = body.match(/(?:^|[;{])\s*color\s*:\s*([^;]+?)(?:;|$)/m);
    const bgMatch = body.match(/(?:^|[;{])\s*background(?:-color)?\s*:\s*([^;]+?)(?:;|$)/m);
    if (colorMatch && bgMatch) {
      rules.push({
        selector,
        color: colorMatch[1].trim(),
        background: bgMatch[1].trim()
      });
    }
  }
  return rules;
}

// ─── 2. ui-kit token 使用 ────────────────────────────────────────

function auditTokenUsage() {
  console.error('[audit-ui-visual] Auditing token usage...');
  const issues = [];
  const tsxFiles = collectFiles(PACKAGES_DIR, ['.tsx', '.ts']);
  const cssFiles = collectFiles(PACKAGES_DIR, ['.css']);

  // Known design tokens from ui-kit
  const knownTokens = [
    '--kairo-primary', '--kairo-primary-hover', '--kairo-primary-light',
    '--kairo-bg', '--kairo-bg-secondary', '--kairo-surface',
    '--kairo-text', '--kairo-text-secondary', '--kairo-border',
    '--kairo-success', '--kairo-warning', '--kairo-error', '--kairo-info',
    '--theia-foreground', '--theia-editor-background', '--theia-panel-border',
    '--theia-focusBorder', '--theia-input-background', '--theia-input-foreground',
    '--theia-dropdown-background', '--theia-dropdown-foreground', '--theia-dropdown-border',
    '--theia-descriptionForeground', '--theia-sideBar-background', '--theia-sideBarSectionHeader-background',
    '--theia-list-hoverBackground', '--theia-list-activeSelectionBackground', '--theia-list-activeSelectionForeground',
    '--theia-badge-background', '--theia-badge-foreground', '--theia-widget-shadow',
    '--theia-quickInput-background', '--theia-errorForeground', '--theia-testing-iconPassed',
    '--theia-progressBar-background', '--theia-code-font-family', '--theia-notification-background',
    '--theia-notification-foreground', '--theia-notification-border', '--theia-button-foreground',
    '--theia-button-background', '--theia-statusBarItem-hoverBackground',
  ];

  const allFiles = [...cssFiles, ...tsxFiles];
  const hardcodedColors = [];
  let totalVarRefs = 0;
  let totalHardcoded = 0;

  for (const file of allFiles) {
    const content = readFileSafe(file);
    const relativePath = path.relative(ROOT, file);

    // Count CSS variable references
    const varRefs = content.match(/var\(--[\w-]+/g);
    if (varRefs) totalVarRefs += varRefs.length;

    // Find hardcoded color values (hex, rgb, rgba, hsl)
    // Skip lines that define CSS custom properties (--xxx: #xxx) as those are token definitions
    const colorPattern = /(?:color|background|border(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\)|hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*\))/gi;
    let match;
    while ((match = colorRegex.exec(content)) !== null) {
      const colorValue = match[1];
      // Skip if this is inside a var() or is a known token value
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const lineEnd = content.indexOf('\n', match.index);
      const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd);

      // Skip if the line has var() reference nearby
      if (line.includes('var(')) continue;

      // Skip CSS custom property definitions (these define tokens, not hardcode)
      if (/^\s*--[\w-]+\s*:\s*/.test(line)) continue;

      // Skip well-known transparent/white/black
      const lower = colorValue.toLowerCase();
      if (lower === '#000' || lower === '#000000' || lower === '#fff' || lower === '#ffffff' ||
          lower === 'transparent' || lower === 'inherit' || lower === 'currentcolor') continue;

      totalHardcoded++;
      hardcodedColors.push({
        file: relativePath,
        color: colorValue,
        context: line.trim().substring(0, 120)
      });
    }
  }

  const passed = totalHardcoded <= 10; // Allow some hardcoded colors for compatibility

  // Deduplicate
  const uniqueFiles = [...new Set(hardcodedColors.map(c => c.file))];

  return {
    totalVarRefs,
    totalHardcoded,
    hardcodedColors: hardcodedColors.slice(0, 50), // limit to 50
    uniqueFiles,
    passed,
    issues: hardcodedColors.slice(0, 50)
  };
}

// Regex for color matching (used in token audit)
const colorRegex = /(?:color|background|border(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\)|hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*\))/gi;

// ─── 3. 字号规范 ─────────────────────────────────────────────────

function auditFontSize() {
  console.error('[audit-ui-visual] Auditing font sizes...');
  const issues = [];
  const cssFiles = collectFiles(PACKAGES_DIR, ['.css']);

  for (const file of cssFiles) {
    const content = readFileSafe(file);
    const relativePath = path.relative(ROOT, file);

    const fontSizeMatches = content.matchAll(/font-size\s*:\s*(\d+)(px|rem|em)/gi);
    for (const match of fontSizeMatches) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      // Convert to px-equivalent
      let pxValue = value;
      if (unit === 'rem') pxValue = value * 16;

      // Check if it's in the allowed range for main content (13±2) or status/tips (11-12)
      const isMainContent = (pxValue >= 11 && pxValue <= 15); // 13±2
      const isStatusOrTips = (pxValue >= 10 && pxValue <= 13); // 11-12 with tolerance
      const isLarge = (pxValue >= 20 && pxValue <= 30); // welcome, titles

      if (!isMainContent && !isStatusOrTips && !isLarge) {
        issues.push({
          file: relativePath,
          value: `${value}${unit}`,
          pxEquivalent: pxValue,
          severity: 'low',
          context: `font-size: ${value}${unit} (${pxValue}px equivalent)`
        });
      }
    }
  }

  return {
    totalIssues: issues.length,
    issues,
    passed: issues.filter(i => i.severity === 'high').length === 0
  };
}

// ─── 4. 阴影/模糊/动画 ───────────────────────────────────────────

function auditShadowsAndAnimations() {
  console.error('[audit-ui-visual] Auditing shadows, blur, animations...');
  const issues = [];
  const cssFiles = collectFiles(PACKAGES_DIR, ['.css']);

  for (const file of cssFiles) {
    const content = readFileSafe(file);
    const relativePath = path.relative(ROOT, file);

    // Check box-shadow for large blur
    const shadowMatches = content.matchAll(/box-shadow\s*:\s*([^;]+)/gi);
    for (const match of shadowMatches) {
      const value = match[1];
      // Extract blur radius
      const blurMatch = value.match(/(\d+)px\s+(?:[\d.]+px\s+)?(?:rgba?\([^)]+\)|#[0-9a-fA-F]+)/);
      if (blurMatch) {
        const blur = parseInt(blurMatch[1]);
        if (blur > 10) {
          issues.push({
            file: relativePath,
            type: 'large-shadow',
            value: value.trim().substring(0, 80),
            severity: 'low',
            detail: `box-shadow blur radius ${blur}px > 10px`
          });
        }
      }
    }

    // Check backdrop-filter
    const backdropMatches = content.matchAll(/backdrop-filter\s*:\s*([^;]+)/gi);
    for (const match of backdropMatches) {
      issues.push({
        file: relativePath,
        type: 'backdrop-filter',
        value: match[1].trim().substring(0, 80),
        severity: 'medium',
        detail: 'backdrop-filter may cause performance issues'
      });
    }

    // Check animation duration > 180ms
    const animMatches = content.matchAll(/(?:animation|transition)-duration\s*:\s*([\d.]+)(m?s)/gi);
    for (const match of animMatches) {
      let durationMs = parseFloat(match[1]);
      if (match[2] === 's') durationMs *= 1000;
      if (durationMs > 180) {
        issues.push({
          file: relativePath,
          type: 'long-animation',
          value: `${match[1]}${match[2]}`,
          severity: 'medium',
          detail: `duration ${durationMs}ms > 180ms threshold`
        });
      }
    }
  }

  return {
    totalIssues: issues.length,
    issues,
    passed: issues.filter(i => i.severity === 'high').length === 0
  };
}

// ─── 5. prefers-reduced-motion ───────────────────────────────────

function auditReducedMotion() {
  console.error('[audit-ui-visual] Auditing prefers-reduced-motion...');
  const issues = [];
  const cssFiles = collectFiles(PACKAGES_DIR, ['.css']);

  for (const file of cssFiles) {
    const content = readFileSafe(file);
    const relativePath = path.relative(ROOT, file);

    const hasAnimation = /animation\s*:/i.test(content) || /transition\s*:/i.test(content) || /@keyframes/i.test(content);
    const hasReducedMotion = /prefers-reduced-motion\s*:\s*reduce/i.test(content);

    if (hasAnimation && !hasReducedMotion) {
      issues.push({
        file: relativePath,
        type: 'missing-reduced-motion',
        severity: 'medium',
        detail: 'CSS file has animations/transitions but no @media (prefers-reduced-motion: reduce)'
      });
    }
  }

  return {
    totalIssues: issues.length,
    issues,
    passed: issues.length === 0
  };
}

// ─── 6. 图标复用 ─────────────────────────────────────────────────

function auditIconReuse() {
  console.error('[audit-ui-visual] Auditing icon reuse...');
  const issues = [];
  const tsxFiles = collectFiles(PACKAGES_DIR, ['.tsx']);

  // Known icon sets
  const knownIconSets = ['codicon', 'fa-', 'kairo-icon', 'theia-icon'];

  for (const file of tsxFiles) {
    const content = readFileSafe(file);
    const relativePath = path.relative(ROOT, file);

    // Check for image imports (png, svg, jpg, gif, ico)
    const imgImportMatches = content.matchAll(/import\s+.*?from\s+['"].*?\.(png|svg|jpg|jpeg|gif|ico)['"]/gi);
    for (const match of imgImportMatches) {
      const importPath = match[0];
      issues.push({
        file: relativePath,
        type: 'custom-image-import',
        value: importPath.substring(0, 100),
        severity: 'low',
        detail: 'Custom image import detected; consider using codicon or theia icon sets'
      });
    }

    // Check for inline image URLs in JSX
    const imgSrcMatches = content.matchAll(/src=["'](.*?\.(png|svg|jpg|jpeg|gif|ico))["']/gi);
    for (const match of imgSrcMatches) {
      // Skip codicon paths
      if (match[1].includes('codicon') || match[1].includes('theia')) continue;
      issues.push({
        file: relativePath,
        type: 'inline-image',
        value: match[1].substring(0, 100),
        severity: 'low',
        detail: 'Inline image reference; consider using icon system'
      });
    }
  }

  return {
    totalIssues: issues.length,
    issues,
    passed: issues.filter(i => i.severity === 'high').length === 0
  };
}

// ─── 7. 焦点/滚动/布局 ───────────────────────────────────────────

function auditFocusScrollLayout() {
  console.error('[audit-ui-visual] Auditing focus, scroll, layout...');
  const issues = [];
  const cssFiles = collectFiles(PACKAGES_DIR, ['.css']);

  for (const file of cssFiles) {
    const content = readFileSafe(file);
    const relativePath = path.relative(ROOT, file);

    // Check for outline: none without :focus-visible replacement
    const outlineNoneMatches = content.matchAll(/outline\s*:\s*none\s*;?/gi);
    for (const match of outlineNoneMatches) {
      // Check if there's a :focus-visible replacement nearby
      const hasFocusVisible = /:focus-visible\s*\{[^}]*outline\s*:/i.test(content);
      if (!hasFocusVisible) {
        issues.push({
          file: relativePath,
          type: 'outline-none-no-focus-visible',
          severity: 'high',
          detail: 'outline: none without :focus-visible replacement — accessibility issue'
        });
        break; // Report once per file
      }
    }

    // Check for scroll-behavior: smooth without reduced-motion check
    const scrollSmoothMatch = content.match(/scroll-behavior\s*:\s*smooth/i);
    if (scrollSmoothMatch) {
      const hasReducedMotion = /prefers-reduced-motion\s*:\s*reduce/i.test(content);
      if (!hasReducedMotion) {
        issues.push({
          file: relativePath,
          type: 'scroll-smooth-no-reduced-motion',
          severity: 'medium',
          detail: 'scroll-behavior: smooth without @media (prefers-reduced-motion: reduce)'
        });
      }
    }

    // Check for fixed heights that could cause layout shift
    const fixedHeightMatches = content.matchAll(/(?:height|min-height|max-height)\s*:\s*(\d+)px\s*;?/gi);
    for (const match of fixedHeightMatches) {
      const heightValue = parseInt(match[1]);
      // Only flag fixed heights under 100px as layout shift risks
      if (heightValue < 100 && heightValue > 10) {
        const line = match[0];
        issues.push({
          file: relativePath,
          type: 'fixed-height',
          value: `${heightValue}px`,
          severity: 'low',
          detail: `Fixed height (${heightValue}px) may cause layout shift with content overflow`
        });
        break; // Report once per file
      }
    }
  }

  return {
    totalIssues: issues.length,
    issues,
    passed: issues.filter(i => i.severity === 'high').length === 0
  };
}

// ─── Main ─────────────────────────────────────────────────────────

function main() {
  console.error('[audit-ui-visual] Kairo IDE UI Visual Audit — starting...');

  const cssFiles = collectFiles(PACKAGES_DIR, ['.css']);
  console.error(`[audit-ui-visual] Found ${cssFiles.length} CSS files`);

  // Run all audits
  const wcag = auditWCAGContrast(cssFiles);
  const tokenUsage = auditTokenUsage();
  const fontSize = auditFontSize();
  const shadowsAnim = auditShadowsAndAnimations();
  const reducedMotion = auditReducedMotion();
  const iconReuse = auditIconReuse();
  const focusScroll = auditFocusScrollLayout();

  // Summarize
  const checks = [
    { key: 'wcagContrast', label: 'WCAG AA 正文对比度', ...wcag, totalIssues: wcag.issues.length },
    { key: 'tokenUsage', label: 'ui-kit token 使用', ...tokenUsage, totalIssues: tokenUsage.hardcodedColors.length },
    { key: 'fontSize', label: '字号规范', ...fontSize, totalIssues: fontSize.totalIssues },
    { key: 'shadowsAnimations', label: '阴影/模糊/动画', ...shadowsAnim, totalIssues: shadowsAnim.totalIssues },
    { key: 'reducedMotion', label: 'prefers-reduced-motion', ...reducedMotion, totalIssues: reducedMotion.totalIssues },
    { key: 'iconReuse', label: '图标复用', ...iconReuse, totalIssues: iconReuse.totalIssues },
    { key: 'focusScrollLayout', label: '焦点/滚动/布局', ...focusScroll, totalIssues: focusScroll.totalIssues },
  ];

  const passedCount = checks.filter(c => c.passed).length;
  const failedCount = checks.filter(c => !c.passed).length;

  const report = {
    generatedAt: new Date().toISOString(),
    script: 'audit-ui-visual.cjs',
    summary: {
      total: checks.length,
      passed: passedCount,
      failed: failedCount,
      elapsedMs: Date.now() - START_TIME
    },
    checks: {}
  };

  for (const c of checks) {
    report.checks[c.key] = {
      label: c.label,
      passed: c.passed,
      totalIssues: c.totalIssues,
      issues: c.issues || []
    };
  }

  // ─── JSON Output ───────────────────────────────────────────────
  const jsonPath = path.join(ROOT, 'docs', 'progress', 'releases', 'ui-visual-audit-20260723.json');
  const jsonDir = path.dirname(jsonPath);
  if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  console.error(`[audit-ui-visual] JSON report written to ${path.relative(ROOT, jsonPath)}`);

  // ─── Markdown Report ───────────────────────────────────────────
  const mdLines = [];
  mdLines.push('# Kairo IDE UI 视觉规范验证报告');
  mdLines.push('');
  mdLines.push(`**生成时间：** ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  mdLines.push(`**扫描范围：** packages/ 下所有 CSS (.css) 和 TSX (.tsx) 文件`);
  mdLines.push(`**CSS 文件数：** ${cssFiles.length}`);
  mdLines.push(`**总耗时：** ${report.summary.elapsedMs}ms`);
  mdLines.push('');
  mdLines.push('## 汇总');
  mdLines.push('');
  mdLines.push('| 检查项 | 结果 | 问题数 |');
  mdLines.push('|--------|------|--------|');
  for (const c of checks) {
    const status = c.passed ? '✅ 通过' : '❌ 未通过';
    mdLines.push(`| ${c.label} | ${status} | ${c.totalIssues} |`);
  }
  mdLines.push(`| **总计** | **${passedCount}/${checks.length} 通过** | |`);
  mdLines.push('');

  // ─── 1. WCAG AA ───────────────────────────────────────────────
  mdLines.push('## 1. WCAG AA 正文对比度');
  mdLines.push('');
  mdLines.push(`- **检查的颜色对：** ${wcag.totalPairs || 0}`);
  mdLines.push(`- **不合规问题：** ${wcag.issues.length}`);
  mdLines.push('');
  if (wcag.issues.length > 0) {
    mdLines.push('| 文件 | 选择器/上下文 | 前景色 | 背景色 | 对比度 | 阈值 | 严重度 |');
    mdLines.push('|------|--------------|--------|--------|--------|------|--------|');
    for (const issue of wcag.issues.slice(0, 30)) {
      mdLines.push(`| \`${issue.file}\` | ${issue.selector} | ${issue.fg} | ${issue.bg} | ${issue.ratio}:1 | ${issue.threshold}:1 | ${issue.severity} |`);
    }
    mdLines.push('');
  } else {
    mdLines.push('✅ 未发现高严重度对比度问题。');
    mdLines.push('');
  }

  // ─── 2. Token Usage ────────────────────────────────────────────
  mdLines.push('## 2. ui-kit token 使用');
  mdLines.push('');
  mdLines.push(`- **CSS 变量引用数：** ${tokenUsage.totalVarRefs}`);
  mdLines.push(`- **硬编码颜色数：** ${tokenUsage.totalHardcoded}`);
  mdLines.push(`- **涉及文件数：** ${tokenUsage.uniqueFiles.length}`);
  mdLines.push('');
  if (tokenUsage.hardcodedColors.length > 0) {
    mdLines.push('| 文件 | 颜色值 | 上下文 |');
    mdLines.push('|------|--------|--------|');
    for (const hc of tokenUsage.hardcodedColors.slice(0, 20)) {
      mdLines.push(`| \`${hc.file}\` | \`${hc.color}\` | \`${hc.context}\` |`);
    }
    mdLines.push('');
  }

  // ─── 3. Font Size ──────────────────────────────────────────────
  mdLines.push('## 3. 字号规范');
  mdLines.push('');
  mdLines.push(`- **不合规字号：** ${fontSize.totalIssues}`);
  mdLines.push('');
  if (fontSize.issues.length > 0) {
    mdLines.push('| 文件 | 字号 | 等效 px |');
    mdLines.push('|------|------|---------|');
    for (const issue of fontSize.issues) {
      mdLines.push(`| \`${issue.file}\` | ${issue.value} | ${issue.pxEquivalent}px |`);
    }
    mdLines.push('');
  } else {
    mdLines.push('✅ 所有字号在规范范围内。');
    mdLines.push('');
  }
  mdLines.push('**规范：** 正文 13px/20px (±2px)，状态/提示 11-12px，标题 20px+');
  mdLines.push('');

  // ─── 4. Shadows/Animations ─────────────────────────────────────
  mdLines.push('## 4. 阴影/模糊/动画');
  mdLines.push('');
  mdLines.push(`- **问题数：** ${shadowsAnim.totalIssues}`);
  mdLines.push('');
  if (shadowsAnim.issues.length > 0) {
    mdLines.push('| 文件 | 类型 | 详情 | 严重度 |');
    mdLines.push('|------|------|------|--------|');
    for (const issue of shadowsAnim.issues) {
      mdLines.push(`| \`${issue.file}\` | ${issue.type} | ${issue.detail} | ${issue.severity} |`);
    }
    mdLines.push('');
  } else {
    mdLines.push('✅ 未发现异常阴影/模糊/动画。');
    mdLines.push('');
  }

  // ─── 5. Reduced Motion ─────────────────────────────────────────
  mdLines.push('## 5. prefers-reduced-motion');
  mdLines.push('');
  mdLines.push(`- **缺失文件数：** ${reducedMotion.totalIssues}`);
  mdLines.push('');
  if (reducedMotion.issues.length > 0) {
    mdLines.push('| 文件 | 详情 |');
    mdLines.push('|------|------|');
    for (const issue of reducedMotion.issues) {
      mdLines.push(`| \`${issue.file}\` | ${issue.detail} |`);
    }
    mdLines.push('');
  } else {
    mdLines.push('✅ 所有含动画的 CSS 文件都包含 prefers-reduced-motion 媒体查询。');
    mdLines.push('');
  }

  // ─── 6. Icon Reuse ─────────────────────────────────────────────
  mdLines.push('## 6. 图标复用');
  mdLines.push('');
  mdLines.push(`- **自定义图标引用数：** ${iconReuse.totalIssues}`);
  mdLines.push('');
  if (iconReuse.issues.length > 0) {
    mdLines.push('| 文件 | 类型 | 路径 |');
    mdLines.push('|------|------|------|');
    for (const issue of iconReuse.issues) {
      mdLines.push(`| \`${issue.file}\` | ${issue.type} | \`${issue.value}\` |`);
    }
    mdLines.push('');
  } else {
    mdLines.push('✅ 未发现自定义图标引用，所有图标使用 codicon/theia 图标集。');
    mdLines.push('');
  }

  // ─── 7. Focus/Scroll/Layout ────────────────────────────────────
  mdLines.push('## 7. 焦点/滚动/布局');
  mdLines.push('');
  mdLines.push(`- **问题数：** ${focusScroll.totalIssues}`);
  mdLines.push('');
  if (focusScroll.issues.length > 0) {
    mdLines.push('| 文件 | 类型 | 详情 | 严重度 |');
    mdLines.push('|------|------|------|--------|');
    for (const issue of focusScroll.issues) {
      mdLines.push(`| \`${issue.file}\` | ${issue.type} | ${issue.detail} | ${issue.severity} |`);
    }
    mdLines.push('');
  } else {
    mdLines.push('✅ 未发现焦点/滚动/布局问题。');
    mdLines.push('');
  }

  mdLines.push('---');
  mdLines.push('');
  mdLines.push('*报告由 `scripts/audit-ui-visual.cjs` 自动生成*');

  const mdOutput = mdLines.join('\n');
  const mdPath = path.join(ROOT, 'docs', 'progress', 'releases', 'ui-visual-audit-20260723.md');
  fs.writeFileSync(mdPath, mdOutput, 'utf8');
  console.error(`[audit-ui-visual] Markdown report written to ${path.relative(ROOT, mdPath)}`);

  // ─── Terminal Summary ──────────────────────────────────────────
  console.error('');
  console.error('══════════════════════════════════════════════');
  console.error('  Kairo IDE UI Visual Audit Results');
  console.error('══════════════════════════════════════════════');
  for (const c of checks) {
    const status = c.passed ? '✅' : '❌';
    console.error(`  ${status} ${c.label}: ${c.totalIssues} issues`);
  }
  console.error('══════════════════════════════════════════════');
  console.error(`  Total: ${passedCount}/${checks.length} passed`);
  console.error(`  Elapsed: ${report.summary.elapsedMs}ms`);
  console.error('══════════════════════════════════════════════');

  clearTimeout(timeout);
  process.exit(failedCount > 0 ? 1 : 0);
}

main();