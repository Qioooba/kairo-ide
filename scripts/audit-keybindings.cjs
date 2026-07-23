/**
 * Kairo IDE 快捷键审计脚本
 *
 * 执行 3 项检查：
 *   1. 冲突检测 — 扫描所有 keybinding 注册，发现多个命令绑定到同一组合键
 *   2. macOS 系统保留键保护 — 检查是否使用了 macOS 系统保留键
 *   3. UI tooltip 快捷键一致性 — 检查命令标签中是否提及了实际注册的快捷键
 *
 * 用法: node scripts/audit-keybindings.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ───────────────────────────────────────────────────

const PACKAGES_DIR = path.join(__dirname, '..', 'packages');
const SCRIPTS_DIR = __dirname;

/** macOS 系统保留键组合。 */
const MACOS_RESERVED_KEYS = [
  { key: 'cmd+tab', description: 'App Switcher (系统级)' },
  { key: 'cmd+space', description: 'Spotlight (系统级)' },
  { key: 'cmd+option+esc', description: 'Force Quit (系统级)' },
  { key: 'cmd+shift+3', description: 'Screenshot (系统级)' },
  { key: 'cmd+shift+4', description: 'Screenshot Selection (系统级)' },
  { key: 'cmd+shift+5', description: 'Screenshot Recording (系统级)' },
  { key: 'cmd+q', description: 'Quit App (系统级)' },
  { key: 'cmd+h', description: 'Hide App (系统级)' },
  { key: 'cmd+m', description: 'Minimize Window (系统级)' },
  { key: 'cmd+option+h', description: 'Hide Others (系统级)' },
  { key: 'cmd+option+m', description: 'Minimize All (系统级)' },
  { key: 'ctrl+shift+power', description: 'Sleep Display (系统级)' },
  { key: 'ctrl+cmd+q', description: 'Lock Screen (系统级)' },
  { key: 'shift+cmd+q', description: 'Log Out (系统级)' },
  { key: 'cmd+comma', description: 'Preferences (系统约定)' },
];

/**
 * 正常化 keybinding 字符串为可比较格式。
 * 将 ctrlcmd 展开为 platform-specific 形式。
 */
function normalizeKeybinding(keybinding) {
  return keybinding
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ctrlcmd/g, 'ctrl')
    .replace(/cmd/g, 'cmd')
    .replace(/ctrl/g, 'ctrl')
    .replace(/shift/g, 'shift')
    .replace(/alt/g, 'alt')
    .replace(/option/g, 'alt')
    .replace(/\+/g, '+')
    .split('+')
    .sort()
    .join('+');
}

/**
 * 正常化 keybinding 为 macOS 形式（ctrlcmd → cmd）。
 */
function normalizeMacKeybinding(keybinding) {
  return keybinding
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ctrlcmd/g, 'cmd')
    .replace(/\+/g, '+')
    .split('+')
    .sort()
    .join('+');
}

// ── 扫描 keybinding 注册 ────────────────────────────────────────

/**
 * 从 TypeScript 源文件中提取所有 keybinding 注册。
 * 支持多种模式:
 *   - keybindings.registerKeybinding({ command: '...', keybinding: '...', when: '...' })
 *   - keybinding: 'ctrlcmd+something'
 *   - keybinding: isOSX ? 'cmd+x' : 'ctrl+x'
 */
function extractKeybindings(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const results = [];

  // 模式 1: keybindings.registerKeybinding({ ... })
  // 匹配多行对象字面量
  const registerRe = /keybindings\.registerKeybinding\(\s*\{([^}]+)\}/gs;
  let match;
  while ((match = registerRe.exec(content)) !== null) {
    const block = match[1];
    const commandMatch = /command\s*:\s*['"]([^'"]+)['"]/.exec(block);
    const keybindingMatch = /keybinding\s*:\s*([^,\n}]+)/.exec(block);
    const whenMatch = /when\s*:\s*['"]([^'"]*)['"]/.exec(block);

    if (commandMatch && keybindingMatch) {
      let kb = keybindingMatch[1].trim();
      // 处理 isOSX ? 'cmd+x' : 'ctrl+x' 模式
      if (kb.includes('isOSX')) {
        const macMatch = /['"]([^'"]+)['"]/.exec(kb.split('?')[1]);
        const winMatch = /['"]([^'"]+)['"]/.exec(kb.split(':')[1]);
        if (macMatch) kb = macMatch[1];
        else if (winMatch) kb = winMatch[1];
      } else {
        kb = kb.replace(/['"]/g, '');
      }

      results.push({
        command: commandMatch[1],
        keybinding: kb,
        when: whenMatch ? whenMatch[1] : '',
        context: whenMatch ? whenMatch[1] : '(none)',
        file: path.relative(SCRIPTS_DIR, filePath),
      });
    }
  }

  // 模式 2: 单行 keybinding: 'ctrlcmd+something'
  const simpleRe = /keybinding\s*:\s*['"]([^'"]+)['"]\s*[,}]/g;
  // This is already captured by the block pattern above in most cases

  return results;
}

/**
 * 查找所有 TypeScript 源文件。
 */
function findSourceFiles(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git') continue;
        results.push(...findSourceFiles(fullPath));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}

// ── 检查 1: 冲突检测 ────────────────────────────────────────────

function checkConflicts(allBindings) {
  const byKey = new Map();

  for (const binding of allBindings) {
    const normalized = normalizeKeybinding(binding.keybinding);
    if (!byKey.has(normalized)) {
      byKey.set(normalized, []);
    }
    byKey.get(normalized).push(binding);
  }

  const conflicts = [];
  for (const [key, bindings] of byKey) {
    if (bindings.length <= 1) continue;

    // 检查是否真冲突（相同 context）还是误报（不同 context）
    const contexts = new Set(bindings.map(b => b.when || '(none)'));
    const isRealConflict = contexts.size === 1;

    conflicts.push({
      keybinding: bindings[0].keybinding,
      normalized: key,
      bindings: bindings.map(b => ({
        command: b.command,
        context: b.when || '(none)',
        file: b.file,
      })),
      isRealConflict,
      contextCount: contexts.size,
    });
  }

  return conflicts;
}

// ── 检查 2: macOS 系统保留键 ─────────────────────────────────────

function checkMacReservedKeys(allBindings) {
  const warnings = [];

  for (const binding of allBindings) {
    const normalized = normalizeMacKeybinding(binding.keybinding);

    for (const reserved of MACOS_RESERVED_KEYS) {
      const reservedNormalized = normalizeMacKeybinding(reserved.key);
      if (normalized === reservedNormalized) {
        warnings.push({
          keybinding: binding.keybinding,
          command: binding.command,
          reservedKey: reserved.key,
          description: reserved.description,
          file: binding.file,
          when: binding.when || '(none)',
        });
      }
    }
  }

  return warnings;
}

// ── 检查 3: UI tooltip 快捷键一致性 ───────────────────────────────

/**
 * 扫描 TSX 文件中的命令标签，检查是否与注册的快捷键匹配。
 * 这是 best-effort 检查：查找如 `label: 'Java: Show Call Hierarchy (F12)'` 的模式。
 */
function checkUITooltipConsistency(allBindings, sourceFiles) {
  const inconsistencies = [];

  // 构建命令 → 快捷键映射
  const cmdToKeybinding = new Map();
  for (const binding of allBindings) {
    const existing = cmdToKeybinding.get(binding.command);
    if (!existing) {
      cmdToKeybinding.set(binding.command, []);
    }
    cmdToKeybinding.get(binding.command).push(binding.keybinding);
  }

  // 扫描 TSX 文件查找命令标签
  for (const filePath of sourceFiles) {
    if (!filePath.endsWith('.tsx')) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // 查找 label 属性中的快捷键提示
      // 模式: label: '... (快捷键)'
      const labelRe = /label\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = labelRe.exec(content)) !== null) {
        const label = match[1];

        // 尝试匹配命令 ID
        const commandRe = /id\s*:\s*['"]([^'"]+)['"]/g;
        let cmdMatch;
        commandRe.lastIndex = 0;
        while ((cmdMatch = commandRe.exec(content)) !== null) {
          const commandId = cmdMatch[1];
          const keybindings = cmdToKeybinding.get(commandId);
          if (!keybindings) continue;

          // 检查 label 中是否包含快捷键提示
          const hasShortcut = /\([^)]+\)/.test(label);
          if (hasShortcut) {
            // 提取 label 中的快捷键
            const shortcutInLabel = label.match(/\(([^)]+)\)/)[1].toLowerCase();
            const matchesBinding = keybindings.some(kb =>
              kb.toLowerCase().includes(shortcutInLabel) ||
              shortcutInLabel.includes(kb.toLowerCase()),
            );

            if (!matchesBinding) {
              inconsistencies.push({
                command: commandId,
                label,
                labelShortcut: label.match(/\(([^)]+)\)/)[1],
                registeredKeybindings: keybindings,
                file: path.relative(SCRIPTS_DIR, filePath),
              });
            }
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return inconsistencies;
}

// ── 主流程 ──────────────────────────────────────────────────────

function main() {
  console.log('═'.repeat(70));
  console.log('  Kairo IDE 快捷键审计');
  console.log('═'.repeat(70));
  console.log();

  // 查找所有源文件
  const sourceFiles = findSourceFiles(PACKAGES_DIR);
  console.log(`扫描源文件: ${sourceFiles.length} 个`);

  // 提取所有 keybinding 注册
  const allBindings = [];
  for (const filePath of sourceFiles) {
    const bindings = extractKeybindings(filePath);
    allBindings.push(...bindings);
  }

  console.log(`发现 keybinding 注册: ${allBindings.length} 个`);
  console.log();

  // ── 检查 1: 冲突检测 ──────────────────────────────────────────
  console.log('─'.repeat(70));
  console.log('  检查 1: 快捷键冲突检测');
  console.log('─'.repeat(70));
  console.log();

  const conflicts = checkConflicts(allBindings);

  if (conflicts.length === 0) {
    console.log('  ✅ 未发现快捷键冲突');
  } else {
    const realConflicts = conflicts.filter(c => c.isRealConflict);
    const falsePositives = conflicts.filter(c => !c.isRealConflict);

    console.log(`  ⚠️  发现 ${conflicts.length} 个快捷键冲突`);
    console.log(`    - 真实冲突 (相同 context): ${realConflicts.length} 个`);
    console.log(`    - 误报 (不同 context): ${falsePositives.length} 个`);
    console.log();

    if (realConflicts.length > 0) {
      console.log('  ❌ 真实冲突:');
      console.log();
      for (const conflict of realConflicts) {
        console.log(`    快捷键: ${conflict.keybinding}`);
        console.log(`    冲突命令:`);
        for (const b of conflict.bindings) {
          console.log(`      - ${b.command} (context: ${b.context})`);
          console.log(`        文件: ${b.file}`);
        }
        console.log();
      }
    }

    if (falsePositives.length > 0) {
      console.log('  ℹ️  误报 (不同 context，可能安全):');
      console.log();
      for (const conflict of falsePositives) {
        console.log(`    快捷键: ${conflict.keybinding} (${conflict.contextCount} 个不同 context)`);
        for (const b of conflict.bindings) {
          console.log(`      - ${b.command} (context: ${b.context})`);
        }
        console.log();
      }
    }
  }

  // ── 检查 2: macOS 系统保留键 ──────────────────────────────────
  console.log('─'.repeat(70));
  console.log('  检查 2: macOS 系统保留键保护');
  console.log('─'.repeat(70));
  console.log();

  const macWarnings = checkMacReservedKeys(allBindings);

  if (macWarnings.length === 0) {
    console.log('  ✅ 未使用 macOS 系统保留键');
  } else {
    console.log(`  ⚠️  发现 ${macWarnings.length} 个使用了 macOS 系统保留键:`);
    console.log();
    for (const warning of macWarnings) {
      console.log(`    快捷键: ${warning.keybinding}`);
      console.log(`    命令: ${warning.command}`);
      console.log(`    系统保留: ${warning.reservedKey} — ${warning.description}`);
      console.log(`    文件: ${warning.file}`);
      console.log(`    Context: ${warning.when}`);
      console.log();
    }
  }

  // ── 检查 3: UI tooltip 快捷键一致性 ───────────────────────────
  console.log('─'.repeat(70));
  console.log('  检查 3: UI tooltip 快捷键一致性');
  console.log('─'.repeat(70));
  console.log();

  const inconsistencies = checkUITooltipConsistency(allBindings, sourceFiles);

  if (inconsistencies.length === 0) {
    console.log('  ✅ 未发现 UI tooltip 快捷键不一致');
  } else {
    console.log(`  ⚠️  发现 ${inconsistencies.length} 个 UI tooltip 快捷键不一致:`);
    console.log();
    for (const inc of inconsistencies) {
      console.log(`    命令: ${inc.command}`);
      console.log(`    Label: "${inc.label}"`);
      console.log(`    Label 中快捷键: ${inc.labelShortcut}`);
      console.log(`    实际注册快捷键: ${inc.registeredKeybindings.join(', ')}`);
      console.log(`    文件: ${inc.file}`);
      console.log();
    }
  }

  // ── 汇总 ──────────────────────────────────────────────────────
  console.log('═'.repeat(70));
  console.log('  审计汇总');
  console.log('═'.repeat(70));
  console.log();
  console.log(`  总 keybinding 注册数: ${allBindings.length}`);
  console.log(`  冲突数: ${conflicts.length} (真实: ${conflicts.filter(c => c.isRealConflict).length}, 误报: ${conflicts.filter(c => !c.isRealConflict).length})`);
  console.log(`  macOS 保留键使用: ${macWarnings.length}`);
  console.log(`  UI tooltip 不一致: ${inconsistencies.length}`);
  console.log();

  // 列出所有注册的快捷键
  console.log('─'.repeat(70));
  console.log('  所有注册的快捷键');
  console.log('─'.repeat(70));
  console.log();

  // 按 command 排序
  const sorted = [...allBindings].sort((a, b) => a.command.localeCompare(b.command));
  console.log('  ' + '命令'.padEnd(50) + '快捷键'.padEnd(20) + 'Context');
  console.log('  ' + '─'.repeat(50) + ' ' + '─'.repeat(20) + ' ' + '─'.repeat(20));
  for (const binding of sorted) {
    const cmd = binding.command.length > 48 ? binding.command.substring(0, 45) + '...' : binding.command;
    const kb = binding.keybinding.length > 18 ? binding.keybinding.substring(0, 15) + '...' : binding.keybinding;
    const ctx = (binding.when || '(none)').length > 18 ? (binding.when || '(none)').substring(0, 15) + '...' : (binding.when || '(none)');
    console.log(`  ${cmd.padEnd(50)} ${kb.padEnd(20)} ${ctx}`);
  }
}

main();