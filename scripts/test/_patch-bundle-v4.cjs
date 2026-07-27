const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

// Copy original from apps/browser (the source frontend bundle)
const origPath = path.join(repoRoot, 'apps', 'browser', 'lib', 'frontend', 'bundle.js');
const destPath = path.join(repoRoot, 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');
fs.copyFileSync(origPath, destPath);
console.log('Copied original bundle from apps/browser, size:', fs.statSync(destPath).size);

let bundle = fs.readFileSync(destPath, 'utf8');

// PATCH 1: Add command definitions inside the KairoCommands IIFE
const openDiagDef = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const defIdx = bundle.indexOf(openDiagDef);
if (defIdx < 0) { console.error('DEF NOT FOUND'); process.exit(1); }
const afterObj = defIdx + openDiagDef.length;
console.log('Char after OPEN_DEBUG_DIAGNOSTICS obj:', JSON.stringify(bundle[afterObj]));
console.log('Context after obj:', JSON.stringify(bundle.substring(afterObj, afterObj + 60)));

const newDefs = ',n.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  'n.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
// Insert after the object's closing }, before the IIFE body's closing }
bundle = bundle.substring(0, afterObj) + newDefs + bundle.substring(afterObj);
console.log('✓ Added command definitions');

// PATCH 2: Add command handlers after TOGGLE_TERMINAL's registerCommand
const termPattern = 'registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})';
const termIdx = bundle.indexOf(termPattern);
if (termIdx < 0) { console.error('TOGGLE_TERMINAL NOT FOUND'); process.exit(1); }
const termEndIdx = termIdx + termPattern.length;
const newHandlers = ',registry.registerCommand(Cn.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),' +
  'registry.registerCommand(Cn.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
bundle = bundle.substring(0, termEndIdx) + newHandlers + bundle.substring(termEndIdx);
console.log('✓ Added command handlers');

// PATCH 3: Add Help menu entries
const oldHelpEntry = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
if (!bundle.includes(oldHelpEntry)) {
  console.error('Help entry NOT FOUND');
  const diag = bundle.indexOf('label:"Debug Diagnostics",order:"z1"');
  console.log('Context around Debug Diagnostics:', bundle.substring(diag - 200, diag + 100));
  process.exit(1);
}
const newHelpEntries = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
bundle = bundle.replace(oldHelpEntry, newHelpEntries);
console.log('✓ Added Help menu entries');

// Verify IIFE structure - should end with: ...TOGGLE_DEVTOOLS={...}}})(Cn||
// i.e. } closes TOGGLE_DEVTOOLS object, } closes IIFE body, ) closes IIFE call, ( starts argument
const iifePattern = /TOGGLE_DEVTOOLS=\{id:"kairo\.devtools\.toggle"[^}]*\}\}\)\(Cn\|\|/;
if (iifePattern.test(bundle)) {
  console.log('✓ IIFE structure verified');
} else {
  const tdIdx = bundle.indexOf('TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle"');
  console.log('IIFE check FAILED, context:', JSON.stringify(bundle.substring(tdIdx, tdIdx + 250)));
  process.exit(1);
}

fs.writeFileSync(destPath, bundle);
console.log('Bundle saved successfully! Size:', bundle.length);
