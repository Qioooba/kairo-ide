const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const origPath = path.join(repoRoot, 'apps', 'browser', 'lib', 'frontend', 'bundle.js');
const destPath = path.join(repoRoot, 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');
fs.copyFileSync(origPath, destPath);
console.log('Copied original bundle from apps/browser');

let bundle = fs.readFileSync(destPath, 'utf8');

// PATCH 1: Command definitions inside IIFE (namespace n)
const openDiagDef = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const defIdx = bundle.indexOf(openDiagDef);
const afterObj = defIdx + openDiagDef.length;
const newDefs = ',n.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  'n.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
bundle = bundle.substring(0, afterObj) + newDefs + bundle.substring(afterObj);
console.log('✓ Added command definitions');

// PATCH 2: Command handlers using e.registerCommand (NOT registry.registerCommand!)
const termPattern = 'e.registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})';
const termIdx = bundle.indexOf(termPattern);
if (termIdx < 0) { console.error('TOGGLE_TERMINAL pattern not found'); process.exit(1); }
const termEndIdx = termIdx + termPattern.length;
// Verify next char is } (closing registerCommands method body)
console.log('After TOGGLE_TERMINAL:', JSON.stringify(bundle.substring(termEndIdx, termEndIdx + 50)));
const newHandlers = ',e.registerCommand(Cn.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),' +
  'e.registerCommand(Cn.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
bundle = bundle.substring(0, termEndIdx) + newHandlers + bundle.substring(termEndIdx);
console.log('✓ Added command handlers with correct e.registerCommand');

// PATCH 3: Help menu entries
const oldHelpEntry = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
if (!bundle.includes(oldHelpEntry)) { console.error('Help entry not found'); process.exit(1); }
const newHelpEntries = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
bundle = bundle.replace(oldHelpEntry, newHelpEntries);
console.log('✓ Added Help menu entries');

// Verify no references to undefined "registry"
if (bundle.includes('registry.registerCommand(Cn.SHOW_WELCOME') || bundle.includes('registry.registerCommand(Cn.TOGGLE_DEVTOOLS')) {
  console.error('✗ Still has registry.registerCommand - fix failed');
  process.exit(1);
}
console.log('✓ No stale registry.registerCommand references');

// Verify IIFE structure
const iifePattern = /TOGGLE_DEVTOOLS=\{id:"kairo\.devtools\.toggle"[^}]*\}\}\)\(Cn\|\|/;
if (iifePattern.test(bundle)) {
  console.log('✓ IIFE structure correct');
} else {
  console.error('✗ IIFE structure broken');
  process.exit(1);
}

fs.writeFileSync(destPath, bundle);
console.log('Bundle saved! Size:', bundle.length);
