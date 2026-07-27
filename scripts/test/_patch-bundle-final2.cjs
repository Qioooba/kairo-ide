const fs = require('fs');
const path = require('path');
const bundlePath = path.join(__dirname, '../../apps/desktop/lib/frontend/bundle.js');

// First restore from asar
const asar = require('@electron/asar');
const asarPath = path.join(__dirname, '../../dist/win-unpacked/resources/app.asar');
const orig = asar.extractFile(asarPath, 'apps/desktop/lib/frontend/bundle.js');
fs.writeFileSync(bundlePath, orig);
console.log('Restored original bundle');

let bundle = fs.readFileSync(bundlePath, 'utf8');

// Based on our analysis, we know the exact patterns:
// - Def namespace: n (in the IIFE)
// - Registry namespace in registerCommands: Cn
// - Menus parameter: e
// - CommonMenus variable: uPt
// These were all confirmed by the debug output

// 1. Add command definitions - insert after OPEN_DEBUG_DIAGNOSTICS={...}
const openDiagDef = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const defIdx = bundle.indexOf(openDiagDef);
const afterDef = defIdx + openDiagDef.length;
// After def is "})(Cn||..." - we insert after the first "}" which is at afterDef
// The char at afterDef is "}" so we add comma + new defs after it
const defNs = 'n';
const newDefs = ',' + defNs + '.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  defNs + '.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
bundle = bundle.substring(0, afterDef + 1) + newDefs + bundle.substring(afterDef + 1);
console.log('✓ Added command definitions');

// 2. Add command handlers after TOGGLE_TERMINAL
const termPattern = 'registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})';
const termIdx = bundle.indexOf(termPattern);
if (termIdx < 0) {
  console.error('Cannot find TOGGLE_TERMINAL!');
  process.exit(1);
}
const termEndIdx = termIdx + termPattern.length;
const regNs = 'Cn';
const newHandlers = ',registry.registerCommand(' + regNs + '.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),' +
  'registry.registerCommand(' + regNs + '.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
bundle = bundle.substring(0, termEndIdx) + newHandlers + bundle.substring(termEndIdx);
console.log('✓ Added command handlers');

// 3. Fix the Help menu entries - replace the existing Debug Diagnostics entry
const oldHelpEntry = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
const newHelpEntries = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
if (!bundle.includes(oldHelpEntry)) {
  // Try to find it with looser match
  const diagMenu = bundle.indexOf('label:"Debug Diagnostics",order:"z1"');
  console.log('Debug Diagnostics at:', diagMenu);
  console.log('Context:', bundle.substring(diagMenu - 200, diagMenu + 100));
  process.exit(1);
}
bundle = bundle.replace(oldHelpEntry, newHelpEntries);
console.log('✓ Added Help menu entries');

// Verify
const checks = [
  'n.SHOW_WELCOME={id:"kairo.welcome.show"',
  'n.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle"',
  'registerCommand(Cn.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome"',
  'registerCommand(Cn.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC',
  'commandId:Cn.SHOW_WELCOME.id,label:"Welcome"',
  'commandId:Cn.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools"',
  'ipc.toggleDevTools()',
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.SHOW_WELCOME',
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.TOGGLE_DEVTOOLS',
];
let ok = true;
for (const check of checks) {
  const found = bundle.includes(check);
  console.log(found ? '✓' : '✗', check.substring(0, 100));
  if (!found) ok = false;
}

if (ok) {
  fs.writeFileSync(bundlePath, bundle);
  console.log('\nBundle patched and saved successfully!');
} else {
  console.error('\nSome checks failed, not saving');
  process.exit(1);
}
