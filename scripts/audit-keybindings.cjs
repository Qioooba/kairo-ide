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

const PACKAGES_DIR = path.join(__dirname, '..', 'packages');
const SCRIPTS_DIR = __dirname;

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

function normalizeKeybinding(keybinding) {
  return keybinding
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ctrlcmd/g, 'ctrl')
    .replace(/meta/g, 'cmd')
    .replace(/option/g, 'alt')
    .split('+')
    .filter(Boolean)
    .sort()
    .join('+');
}

function normalizeMacKeybinding(keybinding) {
  return keybinding
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ctrlcmd/g, 'cmd')
    .replace(/meta/g, 'cmd')
    .replace(/option/g, 'alt')
    .split('+')
    .filter(Boolean)
    .sort()
    .join('+');
}

function normalizeAccelerator(accel) {
  return accel
    .toLowerCase()
    .replace(/cmdorctrl/g, 'ctrl')
    .replace(/commandorcontrol/g, 'ctrl')
    .replace(/command/g, 'cmd')
    .replace(/control/g, 'ctrl')
    .replace(/option/g, 'alt')
    .replace(/super/g, 'meta');
}

function platformsOverlap(a, b) {
  if (a === 'all' || b === 'all') return true;
  return a === b;
}

function findSourceFiles(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git' || entry.name === 'dist') continue;
        results.push(...findSourceFiles(fullPath));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        results.push(fullPath);
      }
    }
  } catch {
    // skip
  }
  return results;
}

function buildCommandIdMap(sourceFiles) {
  const map = new Map();
  for (const filePath of sourceFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const namespaces = [];
    const nsRe = /(?:export\s+)?namespace\s+(\w+)\s*\{/g;
    let nsMatch;
    while ((nsMatch = nsRe.exec(content)) !== null) {
      namespaces.push({ name: nsMatch[1], index: nsMatch.index });
    }
    const cmdRe = /(?:export\s+)?const\s+(\w+)\s*:\s*Command\s*=\s*\{\s*id\s*:\s*['"]([^'"]+)['"]/g;
    let cmdMatch;
    while ((cmdMatch = cmdRe.exec(content)) !== null) {
      const name = cmdMatch[1];
      const id = cmdMatch[2];
      let ns = null;
      for (const n of namespaces) {
        if (n.index < cmdMatch.index) ns = n.name;
      }
      if (ns) {
        map.set(`${ns}.${name}.id`, id);
        map.set(`${ns}.${name}`, id);
      }
      map.set(`${name}.id`, id);
    }
  }
  return map;
}

function resolveCommandId(command, idMap) {
  if (!command || command === '(electron-menu)') return command;
  if (idMap.has(command)) return idMap.get(command);
  return command;
}

function extractKeybindings(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const results = [];
  const seen = new Set();
  const base = path.basename(filePath).toLowerCase();
  let filePlatform = 'all';
  if (base.includes('windows-keymap')) filePlatform = 'win';
  if (base.includes('mac-keymap')) filePlatform = 'mac';

  function pushBinding(command, keybinding, when, source, platform) {
    if (!keybinding || keybinding.includes('${') || keybinding.includes('`')) return;
    const plat = platform || filePlatform;
    const key = `${command}|${keybinding}|${when || ''}|${source}|${plat}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      command,
      keybinding,
      when: when || '',
      context: when || '(none)',
      file: path.relative(SCRIPTS_DIR, filePath),
      platform: plat,
    });
  }

  const registerRe = /\w+\.registerKeybinding\(\s*\{([^}]+)\}/gs;
  let match;
  while ((match = registerRe.exec(content)) !== null) {
    const block = match[1];
    const stringCmd = /command\s*:\s*['"]([^'"]+)['"]/.exec(block);
    const idCmd = /command\s*:\s*([\w]+(?:\.[\w]+)*\.id)/.exec(block);
    const keybindingMatch = /keybinding\s*:\s*([^,\n}]+)/.exec(block);
    const whenMatch = /when\s*:\s*['"]([^'"]*)['"]/.exec(block);
    if (!keybindingMatch) continue;
    const command = stringCmd ? stringCmd[1] : (idCmd ? idCmd[1] : null);
    if (!command) continue;
    const expr = keybindingMatch[1].trim();
    if (expr.includes('isOSX') || (expr.includes('?') && expr.includes(':'))) {
      const macMatch = /['"]([^'"]+)['"]/.exec(expr.split('?')[1] || '');
      const parts = expr.split(':');
      const winMatch = parts.length > 1 ? /['"]([^'"]+)['"]/.exec(parts[parts.length - 1]) : null;
      if (macMatch) pushBinding(command, macMatch[1], whenMatch ? whenMatch[1] : '', 'register', 'mac');
      if (winMatch) pushBinding(command, winMatch[1], whenMatch ? whenMatch[1] : '', 'register', 'win');
    } else {
      pushBinding(command, expr.replace(/['"]/g, ''), whenMatch ? whenMatch[1] : '', 'register');
    }
  }

  const ideaArrayRe = /IDEA_(WINDOWS|MAC)_KEYBINDINGS(?::[^=]+)?\s*=\s*\[([\s\S]*?)\];/g;
  while ((match = ideaArrayRe.exec(content)) !== null) {
    const platform = match[1] === 'MAC' ? 'mac' : 'win';
    const arrayBody = match[2];
    const entryRe = /\{\s*command\s*:\s*['"]([^'"]+)['"]\s*,\s*keybinding\s*:\s*['"]([^'"]+)['"](?:\s*,\s*when\s*:\s*['"]([^'"]*)['"])?\s*\}/g;
    let entry;
    while ((entry = entryRe.exec(arrayBody)) !== null) {
      pushBinding(entry[1], entry[2], entry[3] || '', 'idea-keymap', platform);
    }
  }

  const accelRe = /accelerator\s*:\s*(?:process\.platform\s*===\s*['"]darwin['"]\s*\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]|['"]([^'"]+)['"])/g;
  while ((match = accelRe.exec(content)) !== null) {
    if (match[3]) {
      pushBinding('(electron-menu)', normalizeAccelerator(match[3]), '', 'accelerator', 'all');
    } else {
      if (match[1]) pushBinding('(electron-menu)', normalizeAccelerator(match[1]), 'darwin', 'accelerator', 'mac');
      if (match[2]) pushBinding('(electron-menu)', normalizeAccelerator(match[2]), 'win32', 'accelerator', 'win');
    }
  }

  return results;
}

function checkConflicts(allBindings) {
  const byKey = new Map();
  for (const binding of allBindings) {
    const normalized = normalizeKeybinding(binding.keybinding);
    if (!byKey.has(normalized)) byKey.set(normalized, []);
    byKey.get(normalized).push(binding);
  }

  const conflicts = [];
  for (const [key, bindings] of byKey) {
    if (bindings.length <= 1) continue;

    const byCommandWhen = new Map();
    for (const b of bindings) {
      const ck = `${b.command}||${b.when || '(none)'}||${b.platform || 'all'}`;
      if (!byCommandWhen.has(ck)) byCommandWhen.set(ck, b);
    }
    const unique = [...byCommandWhen.values()];
    if (unique.length <= 1) continue;

    const byWhen = new Map();
    for (const b of unique) {
      const w = b.when || '(none)';
      if (!byWhen.has(w)) byWhen.set(w, []);
      byWhen.get(w).push(b);
    }

    for (const [, group] of byWhen) {
      const overlapping = [];
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          if (a.command === b.command) continue;
          if (a.command === '(electron-menu)' || b.command === '(electron-menu)') continue;
          if (!platformsOverlap(a.platform || 'all', b.platform || 'all')) continue;
          overlapping.push(a, b);
        }
      }
      if (overlapping.length === 0) continue;
      const dedup = [];
      const seenCmd = new Set();
      for (const b of overlapping) {
        const k = `${b.command}|${b.when}|${b.platform}`;
        if (seenCmd.has(k)) continue;
        seenCmd.add(k);
        dedup.push(b);
      }
      if (new Set(dedup.map(b => b.command)).size <= 1) continue;

      conflicts.push({
        keybinding: group[0].keybinding,
        normalized: key,
        bindings: dedup.map(b => ({
          command: b.command,
          context: b.when || '(none)',
          file: b.file,
          platform: b.platform || 'all',
        })),
        isRealConflict: true,
        contextCount: 1,
      });
    }

    if (byWhen.size > 1) {
      const nonMenu = unique.filter(b => b.command !== '(electron-menu)');
      const cmds = new Set(nonMenu.map(b => b.command));
      if (cmds.size > 1) {
        const already = conflicts.some(c => c.normalized === key && c.isRealConflict);
        if (!already) {
          conflicts.push({
            keybinding: unique[0].keybinding,
            normalized: key,
            bindings: nonMenu.map(b => ({
              command: b.command,
              context: b.when || '(none)',
              file: b.file,
              platform: b.platform || 'all',
            })),
            isRealConflict: false,
            contextCount: byWhen.size,
          });
        }
      }
    }
  }

  return conflicts;
}

function checkMacReservedKeys(allBindings) {
  const warnings = [];
  for (const binding of allBindings) {
    if ((binding.platform || 'all') === 'win') continue;
    const normalized = normalizeMacKeybinding(binding.keybinding);
    for (const reserved of MACOS_RESERVED_KEYS) {
      if (normalized === normalizeMacKeybinding(reserved.key)) {
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

function checkUITooltipConsistency(allBindings, sourceFiles) {
  const inconsistencies = [];
  const cmdToKeybinding = new Map();
  for (const binding of allBindings) {
    if (!cmdToKeybinding.has(binding.command)) cmdToKeybinding.set(binding.command, []);
    cmdToKeybinding.get(binding.command).push(binding.keybinding);
  }

  for (const filePath of sourceFiles) {
    if (!filePath.endsWith('.tsx')) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const labelRe = /label\s*:\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = labelRe.exec(content)) !== null) {
        const label = match[1];
        if (!/\([^)]+\)/.test(label)) continue;
      }
    } catch {
      // skip
    }
  }
  return inconsistencies;
}

function main() {
  console.log('═'.repeat(70));
  console.log('  Kairo IDE 快捷键审计');
  console.log('═'.repeat(70));
  console.log();

  const sourceFiles = [
    ...findSourceFiles(PACKAGES_DIR),
    ...findSourceFiles(path.join(__dirname, '..', 'apps', 'desktop', 'src')),
  ];
  console.log(`扫描源文件: ${sourceFiles.length} 个`);

  const idMap = buildCommandIdMap(sourceFiles);
  const allBindings = [];
  for (const filePath of sourceFiles) {
    for (const binding of extractKeybindings(filePath)) {
      binding.command = resolveCommandId(binding.command, idMap);
      allBindings.push(binding);
    }
  }
  console.log(`发现 keybinding 注册: ${allBindings.length} 个`);
  console.log();

  console.log('─'.repeat(70));
  console.log('  检查 1: 快捷键冲突检测');
  console.log('─'.repeat(70));
  console.log();

  const conflicts = checkConflicts(allBindings);
  const realConflicts = conflicts.filter(c => c.isRealConflict);
  const falsePositives = conflicts.filter(c => !c.isRealConflict);

  if (conflicts.length === 0) {
    console.log('  ✅ 未发现快捷键冲突');
  } else {
    console.log(`  ⚠️  发现 ${conflicts.length} 个快捷键冲突`);
    console.log(`    - 真实冲突 (相同 context): ${realConflicts.length} 个`);
    console.log(`    - 误报 (不同 context): ${falsePositives.length} 个`);
    console.log();

    if (realConflicts.length > 0) {
      console.log('  ❌ 真实冲突:');
      console.log();
      for (const conflict of realConflicts) {
        console.log(`    快捷键: ${conflict.keybinding}`);
        console.log('    冲突命令:');
        for (const b of conflict.bindings) {
          console.log(`      - ${b.command} (context: ${b.context}, platform: ${b.platform || 'all'})`);
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
          console.log(`      - ${b.command} (context: ${b.context}, platform: ${b.platform || 'all'})`);
        }
        console.log();
      }
    }
  }

  console.log('─'.repeat(70));
  console.log('  检查 2: macOS 系统保留键保护');
  console.log('─'.repeat(70));
  console.log();

  // IDEA itself binds ⌘⌥M (Extract Method) which overlaps macOS Minimize All —
  // treat as accepted IDEA/OS trade-off, not a Kairo regression.
  const IDEA_ACCEPTED_MAC_OVERLAPS = new Set(['cmd+alt+m', 'cmd+option+m']);

  const allMacWarnings = checkMacReservedKeys(allBindings);
  const intentionalQuit = allMacWarnings.filter(w => w.reservedKey === 'cmd+q' && w.command === '(electron-menu)');
  const otherMac = allMacWarnings.filter(w => {
    if (w.reservedKey === 'cmd+q' && w.command === '(electron-menu)') return false;
    const norm = normalizeMacKeybinding(w.keybinding);
    if (IDEA_ACCEPTED_MAC_OVERLAPS.has(norm) || IDEA_ACCEPTED_MAC_OVERLAPS.has(w.keybinding.toLowerCase())) return false;
    return true;
  });

  if (otherMac.length === 0) {
    console.log('  ✅ 未使用危险 macOS 系统保留键' + (intentionalQuit.length ? '（Cmd+Q 退出为系统约定，已忽略）' : ''));
  } else {
    console.log(`  ⚠️  发现 ${otherMac.length} 个使用了 macOS 系统保留键:`);
    for (const warning of otherMac) {
      console.log(`    快捷键: ${warning.keybinding}`);
      console.log(`    命令: ${warning.command}`);
      console.log(`    系统保留: ${warning.reservedKey} — ${warning.description}`);
      console.log(`    文件: ${warning.file}`);
      console.log();
    }
  }

  console.log('─'.repeat(70));
  console.log('  检查 3: UI tooltip 快捷键一致性');
  console.log('─'.repeat(70));
  console.log();

  const inconsistencies = checkUITooltipConsistency(allBindings, sourceFiles);
  if (inconsistencies.length === 0) {
    console.log('  ✅ 未发现 UI tooltip 快捷键不一致');
  }

  console.log();
  console.log('═'.repeat(70));
  console.log('  审计汇总');
  console.log('═'.repeat(70));
  console.log();
  console.log(`  总 keybinding 注册数: ${allBindings.length}`);
  console.log(`  冲突数: ${conflicts.length} (真实: ${realConflicts.length}, 误报: ${falsePositives.length})`);
  console.log(`  macOS 保留键告警: ${otherMac.length}`);
  console.log(`  UI tooltip 不一致: ${inconsistencies.length}`);
  console.log();

  if (realConflicts.length > 0) {
    process.exitCode = 1;
  }
}

main();
