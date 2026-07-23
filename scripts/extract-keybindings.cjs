#!/usr/bin/env node

/**
 * extract-keybindings.cjs — Kairo IDE keybinding extractor
 *
 * Scans all TypeScript files under packages/ for keybinding
 * registrations and outputs:
 *   1. JSON file: scripts/keybindings.json
 *   2. Markdown table: scripts/keybindings-table.md
 *
 * Usage:
 *   node scripts/extract-keybindings.cjs
 *
 * Timeout: 30s
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const OUTPUT_JSON = path.join(__dirname, 'keybindings.json');
const OUTPUT_MD = path.join(__dirname, 'keybindings-table.md');

// ---------------------------------------------------------------------------
// 1. Scan all .ts files under packages/ for keybinding patterns
// ---------------------------------------------------------------------------
function scanKeybindings() {
  const results = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue;
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          extractFromFile(content, full, results);
        } catch (err) {
          console.error(`  [warn] cannot read ${full}: ${err.message}`);
        }
      }
    }
  }

  walk(PACKAGES_DIR);
  return results;
}

function extractFromFile(content, filePath, results) {
  // Pattern 1: keybindings.registerKeybinding({ command: 'xxx', keybinding: 'yyy', when: 'zzz' })
  // We need to handle these across multiple lines
  const pattern1 = /keybindings\.registerKeybinding\s*\(\s*\{([^}]+)\}/gs;
  let match;
  while ((match = pattern1.exec(content)) !== null) {
    const block = match[1];
    const command = extractValue(block, 'command');
    const keybinding = extractValue(block, 'keybinding');
    const when = extractValue(block, 'when');
    if (command && keybinding) {
      results.push({ command, keybinding, when: when || '', file: path.relative(ROOT, filePath) });
    }
  }

  // Pattern 2: Super call — super.registerKeybindings(keybindings);
  // (handled by pattern 1)

  // Pattern 3: toggleCommandId in AbstractViewContribution super()
  // These map to the default keybinding from the toggle mechanism
  const pattern2 = /toggleCommandId\s*:\s*'([^']+)'/g;
  while ((match = pattern2.exec(content)) !== null) {
    const cmdId = match[1];
    // Check if we already have a keybinding for this command from pattern 1
    if (!results.some(r => r.command === cmdId)) {
      // These commands are toggled via the view contribution mechanism,
      // and their keybinding is the default toggle keybinding if any
      // (set via registerKeybindings). Skip if not explicitly bound.
    }
  }
}

function extractValue(block, key) {
  // Match: key: 'value' or key: "value"
  const re = new RegExp(`${key}\\s*:\\s*['\"]([^'\"]+)['\"]`);
  const m = block.match(re);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 2. Theia built-in keybindings (from known Theia 1.73.x defaults)
// ---------------------------------------------------------------------------
function getTheiaBuiltinKeybindings() {
  // These are the standard keybindings that come from Theia core packages.
  // They are defined in @theia/core, @theia/editor, @theia/monaco, etc.
  // We include the most commonly used ones here.
  return [
    // --- General ---
    { command: 'workbench.action.showCommands', keybinding: 'ctrlcmd+shift+p', when: '', label: 'Command Palette' },
    { command: 'workbench.action.quickOpen', keybinding: 'ctrlcmd+p', when: '', label: 'Quick Open' },
    { command: 'workbench.action.togglePanel', keybinding: 'ctrlcmd+j', when: '', label: 'Toggle Panel' },
    { command: 'workbench.action.toggleSidebar', keybinding: 'ctrlcmd+b', when: '', label: 'Toggle Sidebar' },
    { command: 'workbench.action.toggleMaximizedPanel', keybinding: 'ctrlcmd+shift+enter', when: '', label: 'Toggle Maximized Panel' },
    { command: 'workbench.action.closeActiveEditor', keybinding: 'ctrlcmd+w', when: '', label: 'Close Active Editor' },
    { command: 'workbench.action.closeAllEditors', keybinding: 'ctrlcmd+k ctrlcmd+w', when: '', label: 'Close All Editors' },
    { command: 'workbench.action.reopenClosedEditor', keybinding: 'ctrlcmd+shift+t', when: '', label: 'Reopen Closed Editor' },
    { command: 'workbench.action.navigateBack', keybinding: 'ctrlcmd+alt+-', when: '', label: 'Navigate Back' },
    { command: 'workbench.action.navigateForward', keybinding: 'ctrlcmd+shift+-', when: '', label: 'Navigate Forward' },
    { command: 'workbench.action.terminal.toggleTerminal', keybinding: 'ctrlcmd+`', when: '', label: 'Toggle Terminal' },
    { command: 'workspace:open', keybinding: 'ctrlcmd+o', when: '', label: 'Open Workspace' },
    { command: 'workspace:openFile', keybinding: 'ctrlcmd+o', when: '', label: 'Open File' },
    { command: 'keybindings:open', keybinding: 'ctrlcmd+k ctrlcmd+s', when: '', label: 'Open Keyboard Shortcuts' },

    // --- Editor ---
    { command: 'core.save', keybinding: 'ctrlcmd+s', when: 'editorFocus', label: 'Save' },
    { command: 'core.saveAll', keybinding: 'ctrlcmd+k s', when: '', label: 'Save All' },
    { command: 'core.undo', keybinding: 'ctrlcmd+z', when: 'editorFocus', label: 'Undo' },
    { command: 'core.redo', keybinding: 'ctrlcmd+shift+z', when: 'editorFocus', label: 'Redo' },
    { command: 'editor.action.clipboardCutAction', keybinding: 'ctrlcmd+x', when: 'editorFocus', label: 'Cut' },
    { command: 'editor.action.clipboardCopyAction', keybinding: 'ctrlcmd+c', when: 'editorFocus', label: 'Copy' },
    { command: 'editor.action.clipboardPasteAction', keybinding: 'ctrlcmd+v', when: 'editorFocus', label: 'Paste' },
    { command: 'actions.find', keybinding: 'ctrlcmd+f', when: 'editorFocus', label: 'Find in Editor' },
    { command: 'editor.action.startFindReplaceAction', keybinding: 'ctrlcmd+h', when: 'editorFocus', label: 'Find and Replace in Editor' },
    { command: 'editor.action.selectAll', keybinding: 'ctrlcmd+a', when: 'editorFocus', label: 'Select All' },
    { command: 'editor.action.commentLine', keybinding: 'ctrlcmd+/', when: 'editorFocus', label: 'Toggle Comment' },
    { command: 'editor.action.blockComment', keybinding: 'ctrlcmd+shift+/', when: 'editorFocus', label: 'Toggle Block Comment' },
    { command: 'editor.action.indentLines', keybinding: 'ctrlcmd+]', when: 'editorFocus', label: 'Indent' },
    { command: 'editor.action.outdentLines', keybinding: 'ctrlcmd+[', when: 'editorFocus', label: 'Outdent' },
    { command: 'editor.action.moveLinesUpAction', keybinding: 'alt+up', when: 'editorFocus', label: 'Move Line Up' },
    { command: 'editor.action.moveLinesDownAction', keybinding: 'alt+down', when: 'editorFocus', label: 'Move Line Down' },
    { command: 'editor.action.copyLinesUpAction', keybinding: 'shift+alt+up', when: 'editorFocus', label: 'Copy Line Up' },
    { command: 'editor.action.copyLinesDownAction', keybinding: 'shift+alt+down', when: 'editorFocus', label: 'Copy Line Down' },
    { command: 'editor.action.deleteLines', keybinding: 'ctrlcmd+shift+k', when: 'editorFocus', label: 'Delete Line' },
    { command: 'editor.action.insertLineBefore', keybinding: 'ctrlcmd+shift+enter', when: 'editorFocus', label: 'Insert Line Above' },
    { command: 'editor.action.insertLineAfter', keybinding: 'ctrlcmd+enter', when: 'editorFocus', label: 'Insert Line Below' },
    { command: 'editor.action.formatDocument', keybinding: 'shift+alt+f', when: 'editorFocus', label: 'Format Document' },
    { command: 'editor.action.rename', keybinding: 'f2', when: 'editorFocus', label: 'Rename Symbol' },
    { command: 'editor.action.quickFix', keybinding: 'ctrlcmd+.', when: 'editorFocus', label: 'Quick Fix' },
    { command: 'editor.action.goToMatchingBracket', keybinding: 'ctrlcmd+shift+\\', when: 'editorFocus', label: 'Go to Bracket' },
    { command: 'editor.action.triggerSuggest', keybinding: 'ctrlcmd+space', when: 'editorFocus', label: 'Trigger Suggest' },
    { command: 'editor.action.triggerParameterHints', keybinding: 'ctrlcmd+shift+space', when: 'editorFocus', label: 'Parameter Hints' },
    { command: 'editor.action.toggleWordWrap', keybinding: 'alt+z', when: 'editorFocus', label: 'Toggle Word Wrap' },
    { command: 'editor.action.fontZoomIn', keybinding: 'ctrlcmd+=', when: 'editorFocus', label: 'Zoom In' },
    { command: 'editor.action.fontZoomOut', keybinding: 'ctrlcmd+-', when: 'editorFocus', label: 'Zoom Out' },
    { command: 'editor.action.fontZoomReset', keybinding: 'ctrlcmd+0', when: 'editorFocus', label: 'Reset Zoom' },

    // --- Search ---
    { command: 'search.action.openSearch', keybinding: 'ctrlcmd+shift+f', when: '', label: 'Search in Workspace' },
    { command: 'search.action.replaceAll', keybinding: 'ctrlcmd+shift+h', when: 'searchViewletFocus', label: 'Replace in Workspace' },

    // --- Navigation (LSP) ---
    { command: 'editor.action.revealDefinition', keybinding: 'f12', when: 'editorFocus', label: 'Go to Definition' },
    { command: 'editor.action.peekDefinition', keybinding: 'alt+f12', when: 'editorFocus', label: 'Peek Definition' },
    { command: 'editor.action.revealDeclaration', keybinding: 'ctrlcmd+f12', when: 'editorFocus', label: 'Go to Declaration' },
    { command: 'editor.action.goToTypeDefinition', keybinding: 'ctrlcmd+shift+f12', when: 'editorFocus', label: 'Go to Type Definition' },
    { command: 'editor.action.referenceSearch.trigger', keybinding: 'shift+f12', when: 'editorFocus', label: 'Find References' },
    { command: 'editor.action.goToImplementation', keybinding: 'ctrlcmd+f12', when: 'editorFocus', label: 'Go to Implementation' },
    { command: 'editor.action.showHover', keybinding: 'ctrlcmd+k ctrlcmd+i', when: 'editorFocus', label: 'Show Hover' },
    { command: 'editor.action.marker.next', keybinding: 'f8', when: 'editorFocus', label: 'Next Problem' },
    { command: 'editor.action.marker.prev', keybinding: 'shift+f8', when: 'editorFocus', label: 'Previous Problem' },

    // --- Call/Type Hierarchy ---
    { command: 'references-view.showCallHierarchy', keybinding: 'shift+alt+h', when: 'editorFocus', label: 'Show Call Hierarchy' },
    { command: 'references-view.showTypeHierarchy', keybinding: 'shift+alt+t', when: 'editorFocus', label: 'Show Type Hierarchy' },

    // --- Debug ---
    { command: 'workbench.action.debug.start', keybinding: 'f5', when: '', label: 'Start Debugging' },
    { command: 'workbench.action.debug.continue', keybinding: 'f5', when: 'inDebugMode', label: 'Continue' },
    { command: 'workbench.action.debug.pause', keybinding: 'f6', when: 'inDebugMode', label: 'Pause' },
    { command: 'workbench.action.debug.stepOver', keybinding: 'f10', when: 'inDebugMode', label: 'Step Over' },
    { command: 'workbench.action.debug.stepInto', keybinding: 'f11', when: 'inDebugMode', label: 'Step Into' },
    { command: 'workbench.action.debug.stepOut', keybinding: 'shift+f11', when: 'inDebugMode', label: 'Step Out' },
    { command: 'workbench.action.debug.stop', keybinding: 'shift+f5', when: 'inDebugMode', label: 'Stop Debugging' },
    { command: 'workbench.action.debug.restart', keybinding: 'ctrlcmd+shift+f5', when: '', label: 'Restart Debugging' },
    { command: 'editor.debug.action.toggleBreakpoint', keybinding: 'f9', when: 'editorFocus', label: 'Toggle Breakpoint' },
    { command: 'workbench.action.debug.configure', keybinding: 'ctrlcmd+shift+d', when: '', label: 'Show Debug View' },

    // --- Git ---
    { command: 'git.stage', keybinding: 'ctrlcmd+shift+a g', when: 'scmViewletFocus', label: 'Stage' },
    { command: 'git.stageAll', keybinding: 'ctrlcmd+shift+a a', when: 'scmViewletFocus', label: 'Stage All' },
    { command: 'git.commit', keybinding: 'ctrlcmd+enter', when: 'scmInputFocus', label: 'Commit' },

    // --- Java Refactoring ---
    { command: 'java.action.organizeImports', keybinding: 'shift+alt+o', when: 'editorFocus', label: 'Organize Imports' },
    { command: 'java.action.refactor.extractMethod', keybinding: 'ctrlcmd+shift+alt+m', when: 'editorFocus', label: 'Extract Method' },
    { command: 'java.action.safeDelete', keybinding: 'alt+delete', when: 'editorFocus', label: 'Safe Delete' },
  ];
}

// ---------------------------------------------------------------------------
// 3. Normalize keybinding for display
// ---------------------------------------------------------------------------
function normalizeKeybinding(raw) {
  return raw
    .replace(/ctrlcmd/g, 'Ctrl')
    .replace(/cmd/g, 'Cmd')
    .replace(/ctrl/g, 'Ctrl')
    .replace(/shift/g, 'Shift')
    .replace(/alt/g, 'Alt')
    .replace(/enter/g, 'Enter')
    .replace(/space/g, 'Space')
    .replace(/backspace/g, 'Backspace')
    .replace(/escape/g, 'Esc')
    .replace(/delete/g, 'Delete')
    .replace(/up/g, '↑')
    .replace(/down/g, '↓')
    .replace(/left/g, '←')
    .replace(/right/g, '→')
    .replace(/\+/g, '+');
}

function toMacKeybinding(raw) {
  return raw
    .replace(/ctrlcmd/g, 'Cmd')
    .replace(/ctrl/g, 'Ctrl')
    .replace(/cmd/g, 'Cmd')
    .replace(/shift/g, 'Shift')
    .replace(/alt/g, 'Option')
    .replace(/enter/g, 'Enter')
    .replace(/space/g, 'Space')
    .replace(/backspace/g, 'Backspace')
    .replace(/escape/g, 'Esc')
    .replace(/delete/g, 'Delete')
    .replace(/up/g, '↑')
    .replace(/down/g, '↓')
    .replace(/left/g, '←')
    .replace(/right/g, '→')
    .replace(/\+/g, '+');
}

function toWinKeybinding(raw) {
  return raw
    .replace(/ctrlcmd/g, 'Ctrl')
    .replace(/cmd/g, 'Win')
    .replace(/ctrl/g, 'Ctrl')
    .replace(/shift/g, 'Shift')
    .replace(/alt/g, 'Alt')
    .replace(/enter/g, 'Enter')
    .replace(/space/g, 'Space')
    .replace(/backspace/g, 'Backspace')
    .replace(/escape/g, 'Esc')
    .replace(/delete/g, 'Delete')
    .replace(/up/g, '↑')
    .replace(/down/g, '↓')
    .replace(/left/g, '←')
    .replace(/right/g, '→')
    .replace(/\+/g, '+');
}

// ---------------------------------------------------------------------------
// 4. Generate Markdown table
// ---------------------------------------------------------------------------
function generateMarkdown(allBindings) {
  // Deduplicate by command
  const seen = new Set();
  const unique = [];
  for (const b of allBindings) {
    if (seen.has(b.command)) continue;
    seen.add(b.command);
    unique.push(b);
  }

  // Categorize
  const categories = {
    '通用 (General)': [],
    '搜索 (Search)': [],
    '编辑 (Editor)': [],
    '导航 (Navigation)': [],
    '调试 (Debug)': [],
    '构建 (Build)': [],
    '运行 (Run)': [],
    'Git': [],
    'Java 重构 (Refactoring)': [],
    '其他 (Other)': [],
  };

  for (const b of unique) {
    const cmd = b.command || '';
    const label = (b.label || '').toLowerCase();
    if (cmd.includes('search') || cmd.includes('find') || cmd.includes('Search') || cmd.startsWith('kairo.find')) {
      categories['搜索 (Search)'].push(b);
    } else if (cmd.includes('debug') || cmd.includes('breakpoint') || cmd.includes('Debug')) {
      categories['调试 (Debug)'].push(b);
    } else if (cmd.includes('build') || cmd.startsWith('kairo.build') || cmd.startsWith('kairo.cleanBuild')) {
      categories['构建 (Build)'].push(b);
    } else if (cmd.includes('server') || cmd.includes('Server') || cmd.includes('app.open') || cmd.includes('deploy')) {
      categories['运行 (Run)'].push(b);
    } else if (cmd.includes('git') || cmd.includes('scm') || cmd.includes('Git')) {
      categories['Git'].push(b);
    } else if (cmd.includes('editor.action') || cmd.includes('core.save') || cmd.includes('core.undo') || cmd.includes('core.redo') || cmd.includes('clipboard') || cmd.includes('comment') || cmd.includes('format') || cmd.includes('actions.find')) {
      categories['编辑 (Editor)'].push(b);
    } else if (cmd.includes('reveal') || cmd.includes('reference') || cmd.includes('implementation') || cmd.includes('hierarchy') || cmd.includes('marker') || cmd.includes('navigate') || cmd.includes('goTo')) {
      categories['导航 (Navigation)'].push(b);
    } else if (cmd.includes('rename') || cmd.includes('organize') || cmd.includes('extract') || cmd.includes('safeDelete') || cmd.includes('refactor')) {
      categories['Java 重构 (Refactoring)'].push(b);
    } else if (cmd.includes('workbench') || cmd.includes('terminal') || cmd.includes('keybindings') || cmd.includes('quickOpen') || cmd.includes('showCommands') || cmd.includes('togglePanel') || cmd.includes('toggleSidebar') || cmd.includes('zoom') || cmd.includes('closeActive') || cmd.includes('closeAll') || cmd.includes('reopen')) {
      categories['通用 (General)'].push(b);
    } else {
      categories['其他 (Other)'].push(b);
    }
  }

  let md = `# Kairo IDE 键盘快捷键参考

> 基于 Theia 1.73.x 的快捷键体系。Kairo IDE 自定义快捷键标记为 \`kairo.*\`。
> Windows/Linux 使用 Ctrl，macOS 使用 Cmd（⌘）。

`;

  for (const [cat, bindings] of Object.entries(categories)) {
    if (bindings.length === 0) continue;
    md += `## ${cat}\n\n`;
    md += '| 功能 | Windows/Linux | macOS | 命令 ID |\n';
    md += '|------|--------------|------|--------|\n';
    for (const b of bindings) {
      const label = b.label || b.command;
      const win = toWinKeybinding(b.keybinding);
      const mac = toMacKeybinding(b.keybinding);
      const cmd = b.command;
      md += `| ${label} | \`${win}\` | \`${mac}\` | \`${cmd}\` |\n`;
    }
    md += '\n';
  }

  return md;
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------
function main() {
  console.log('[extract-keybindings] Scanning packages/ for keybinding registrations...');

  const start = Date.now();
  const kairoBindings = scanKeybindings();
  const elapsed = Date.now() - start;
  console.log(`[extract-keybindings] Found ${kairoBindings.length} Kairo keybindings in ${elapsed}ms`);

  // Merge Kairo custom bindings with Theia built-in bindings
  // Kairo bindings override Theia built-in bindings with the same command
  const theiaBindings = getTheiaBuiltinKeybindings();
  const kairoCommands = new Set(kairoBindings.map(b => b.command));

  const allBindings = [
    ...kairoBindings.map(b => ({ ...b, label: b.command })),
    ...theiaBindings.filter(b => !kairoCommands.has(b.command)),
  ];

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const b of allBindings) {
    if (seen.has(b.command)) continue;
    seen.add(b.command);
    unique.push(b);
  }

  // Sort by command ID
  unique.sort((a, b) => a.command.localeCompare(b.command));

  // Write JSON
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(unique, null, 2), 'utf-8');
  console.log(`[extract-keybindings] Wrote ${unique.length} entries to ${OUTPUT_JSON}`);

  // Write Markdown
  const md = generateMarkdown(allBindings);
  fs.writeFileSync(OUTPUT_MD, md, 'utf-8');
  console.log(`[extract-keybindings] Wrote keyboard shortcuts table to ${OUTPUT_MD}`);

  console.log('[extract-keybindings] Done.');
}

main();