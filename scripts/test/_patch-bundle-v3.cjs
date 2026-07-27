const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const bundlePath = path.join(__dirname, '../../apps/desktop/lib/frontend/bundle.js');
const asarPath = path.join(__dirname, '../../dist/win-unpacked/resources/app.asar');
const orig = asar.extractFile(asarPath, 'apps/desktop/lib/frontend/bundle.js');
fs.writeFileSync(bundlePath, orig);
console.log('Restored original bundle');

let bundle = fs.readFileSync(bundlePath, 'utf8');

// =====================================================
// PATCH 1: Add command definitions inside the IIFE
// =====================================================
// The IIFE structure is:
//   (function(n){                    // parameter n
//     n.A={...};
//     ...
//     n.OPEN_DEBUG_DIAGNOSTICS={...} // last command
//   })                               // <-- we need to insert BEFORE this closing }
//   (Cn||(k2.KairoCommands=Cn={}))   // argument
const openDiagDef = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const defIdx = bundle.indexOf(openDiagDef);
if (defIdx < 0) { console.error('DEF NOT FOUND'); process.exit(1); }
const afterObj = defIdx + openDiagDef.length; // position right after the object's closing }
// At this point, the next char should be '}' which closes the IIFE function body
// We insert comma + new defs BEFORE that closing }
const charAtAfterObj = bundle[afterObj];
console.log('Char after OPEN_DEBUG_DIAGNOSTICS obj:', JSON.stringify(charAtAfterObj));
if (charAtAfterObj !== '}') {
  console.log('WARNING: expected } after object, context:', JSON.stringify(bundle.substring(afterObj, afterObj + 50)));
  // Maybe there's a semicolon? Let's find the next }
  let nextBrace = afterObj;
  while (nextBrace < afterObj + 10 && bundle[nextBrace] !== '}') nextBrace++;
  console.log('Found } at:', nextBrace, 'context:', JSON.stringify(bundle.substring(nextBrace, nextBrace + 50)));
}

const defNs = 'n';
const newDefs = ',' + defNs + '.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  defNs + '.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
// Insert at afterObj (right after OPEN_DEBUG_DIAGNOSTICS={...}'s closing }, BEFORE the IIFE body's })
// The character at afterObj is '}' (closing function body), so we insert newDefs before it
bundle = bundle.substring(0, afterObj) + newDefs + bundle.substring(afterObj);
console.log('✓ Added command definitions inside IIFE');

// =====================================================
// PATCH 2: Add registerCommand handlers after TOGGLE_TERMINAL
// =====================================================
const termPattern = 'registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})';
const termIdx = bundle.indexOf(termPattern);
if (termIdx < 0) { console.error('TOGGLE_TERMINAL NOT FOUND'); process.exit(1); }
const termEndIdx = termIdx + termPattern.length;
const regNs = 'Cn';
const newHandlers = ',registry.registerCommand(' + regNs + '.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),' +
  'registry.registerCommand(' + regNs + '.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
bundle = bundle.substring(0, termEndIdx) + newHandlers + bundle.substring(termEndIdx);
console.log('✓ Added command handlers');

// =====================================================
// PATCH 3: Add Help menu entries
// =====================================================
const oldHelpEntry = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
if (!bundle.includes(oldHelpEntry)) {
  const diag = bundle.indexOf('label:"Debug Diagnostics",order:"z1"');
  console.log('Debug Diagnostics at:', diag);
  console.log('Context:', bundle.substring(diag - 200, diag + 100));
  process.exit(1);
}
const newHelpEntries = 'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),' +
  'e.registerMenuAction(uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})';
bundle = bundle.replace(oldHelpEntry, newHelpEntries);
console.log('✓ Added Help menu entries');

// =====================================================
// VERIFY
// =====================================================
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

// Extra verification: check that the closing of the IIFE looks correct
// After our patch, it should be: ...n.TOGGLE_DEVTOOLS={...}}})(Cn||...
// (two closing braces: one for TOGGLE_DEVTOOLS object, one for IIFE body)
const iifeCloseCheck = 'TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}}})(Cn||';
if (bundle.includes(iifeCloseCheck)) {
  console.log('✓ IIFE structure correct');
} else {
  console.log('✗ IIFE structure may be broken');
  // Find where TOGGLE_DEVTOOLS is and show context
  const tdIdx = bundle.indexOf('TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle"');
  if (tdIdx >= 0) console.log('Context:', JSON.stringify(bundle.substring(tdIdx, tdIdx + 300)));
  ok = false;
}

if (ok) {
  fs.writeFileSync(bundlePath, bundle);
  console.log('\nBundle patched and saved successfully! Size:', bundle.length);
} else {
  console.error('\nChecks failed');
  process.exit(1);
}
