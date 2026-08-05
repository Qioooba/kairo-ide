const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '../../apps/desktop/lib/frontend/bundle.js');
// Use fresh copy from asar
const asar = require('@electron/asar');
const asarPath = path.join(__dirname, '../../dist/win-unpacked/resources/app.asar');
const origBundle = asar.extractFile(asarPath, 'apps/desktop/lib/frontend/bundle.js');
fs.writeFileSync(bundlePath, origBundle);
console.log('Restored bundle from asar, size:', origBundle.length);

let bundle = fs.readFileSync(bundlePath, 'utf8');

// We need to add 3 things:
// 1. Command definitions for SHOW_WELCOME and TOGGLE_DEVTOOLS
// 2. Command handlers (registerCommand) for these
// 3. Help menu entries for these

// First, find the exact spot to add command definitions.
// We'll find OPEN_DEBUG_DIAGNOSTICS definition and add after its closing brace
const openDiagDef = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const defIdx = bundle.indexOf(openDiagDef);
if (defIdx < 0) {
  console.error('Cannot find OPEN_DEBUG_DIAGNOSTICS definition');
  process.exit(1);
}
console.log('OPEN_DEBUG_DIAGNOSTICS def at:', defIdx);

// After this definition is the closing of the IIFE. We need to find the "}})" 
// pattern that comes after. The definition ends with "}", so the sequence is:
// ...Diagnostics"}})(<ns>||(k2.KairoCommands=<ns>={}))
// We want to insert before the closing "})(", i.e., after the first "}" that closes OPEN_DEBUG_DIAGNOSTICS
// Look ahead from defIdx + openDiagDef.length
const afterDef = defIdx + openDiagDef.length;
// The pattern right after should be "})(Cn||" or similar
const afterDefStr = bundle.substring(afterDef, afterDef + 80);
console.log('After def:', JSON.stringify(afterDefStr));

// Find where to insert: the "}})" closes the object passed to the IIFE and calls it.
// We need to insert comma + new commands BEFORE the "})" part.
// The IIFE pattern is: (function(ns){ ns.A={...}; ns.B={...} })(ns || (exports.Ns = ns = {}))
// So after OPEN_DEBUG_DIAGNOSTICS={...}, there are two closing chars:
//   "}" closes the namespace object literal
//   ")" closes the function call
// We insert between "}" and ")"

// Actually, let me find "))(" pattern after the def
let closeIdx = bundle.indexOf('}))', afterDef);
if (closeIdx < 0 || closeIdx > afterDef + 200) {
  // try single "})("
  closeIdx = bundle.indexOf('})(', afterDef);
  if (closeIdx < 0) closeIdx = afterDef + afterDefStr.indexOf('})(');
  console.log('closeIdx (alt):', closeIdx);
}
console.log('closeIdx:', closeIdx, 'context:', JSON.stringify(bundle.substring(closeIdx, closeIdx + 60)));

// Get the namespace variable from the IIFE parameter
const iifeStart = bundle.lastIndexOf('(function(', defIdx);
console.log('IIFE start at:', iifeStart);
// Let's extract the parameter name
const iifeHeader = bundle.substring(iifeStart, iifeStart + 200);
const paramMatch = iifeHeader.match(/\(function\(([^)]+)\)/);
const iifeParam = paramMatch ? paramMatch[1] : null;
console.log('IIFE parameter:', iifeParam);

// Also find the external namespace used (the one in the argument to the IIFE)
// Look for "})(Xn||" pattern
const iifeArgMatch = bundle.substring(closeIdx, closeIdx + 80).match(/\}\)\(([a-zA-Z0-9_$]+)\|\|/);
const iifeArgNs = iifeArgMatch ? iifeArgMatch[1] : null;
console.log('IIFE argument namespace:', iifeArgNs);

// The namespace we use for definitions should be the same as used for other commands.
// Let's find what namespace prefix is used before OPEN_DEBUG_DIAGNOSTICS
const beforeDef = bundle.substring(defIdx - 30, defIdx);
console.log('Before OPEN_DEBUG_DIAGNOSTICS:', JSON.stringify(beforeDef));
const nsMatch = beforeDef.match(/([a-zA-Z0-9_$]+)\.OPEN_DEBUG_DIAGNOSTICS/);
const defNs = nsMatch ? nsMatch[1] : iifeParam;
console.log('Definition namespace (from prefix):', defNs);

// Insert new command definitions after OPEN_DEBUG_DIAGNOSTICS={...}
// The position is right after the closing "}" of OPEN_DEBUG_DIAGNOSTICS, which is at afterDef
// Wait no - afterDef is after the "}" already? Let's check:
const charAtAfterDef = bundle[afterDef];
console.log('Char at afterDef:', JSON.stringify(charAtAfterDef));
// If it's "}", then we need to insert after that
let insertDefPos = afterDef;
if (charAtAfterDef === '}') insertDefPos = afterDef + 1;
console.log('Insert defs at:', insertDefPos, 'char:', JSON.stringify(bundle[insertDefPos]));

const newDefs = ',' + defNs + '.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  defNs + '.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
bundle = bundle.substring(0, insertDefPos) + newDefs + bundle.substring(insertDefPos);
console.log('Added command definitions');

// Now find registerCommand for TOGGLE_TERMINAL to add handlers after it
// The handler looks like: registerCommand(<ns>.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})
// Let's find this in the UPDATED bundle
const toggleTermPattern = /registerCommand\(([a-zA-Z0-9_$]+)\.TOGGLE_TERMINAL,\{execute:\(\)=>this\.commands\.executeCommand\("terminal:new"\)\}\)/;
const termMatch = toggleTermPattern.exec(bundle);
if (!termMatch) {
  console.error('Cannot find TOGGLE_TERMINAL registerCommand');
  // Try looser search
  const ttIdx = bundle.indexOf('TOGGLE_TERMINAL');
  console.log('TOGGLE_TERMINAL at:', ttIdx);
  console.log('Context:', bundle.substring(ttIdx - 100, ttIdx + 200));
  process.exit(1);
}
const regNs = termMatch[1];
const termEndIdx = termMatch.index + termMatch[0].length;
console.log('TOGGLE_TERMINAL handler at:', termMatch.index, 'ends at:', termEndIdx, 'registry ns:', regNs);
console.log('Context after handler:', JSON.stringify(bundle.substring(termEndIdx, termEndIdx + 100)));

// Insert new registerCommand calls after TOGGLE_TERMINAL's handler
const newHandlers = ',registry.registerCommand(' + regNs + '.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),' +
  'registry.registerCommand(' + regNs + '.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
bundle = bundle.substring(0, termEndIdx) + newHandlers + bundle.substring(termEndIdx);
console.log('Added command handlers');

// Now find the Help menu entry for OPEN_DEBUG_DIAGNOSTICS and add Welcome/DevTools before it
// It should be: CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}
// Let's find label:"Debug Diagnostics",order:"z1"
const diagMenuLabel = 'label:"Debug Diagnostics",order:"z1"';
const diagMenuIdx = bundle.indexOf(diagMenuLabel);
if (diagMenuIdx < 0) {
  console.error('Cannot find Debug Diagnostics menu entry');
  process.exit(1);
}
console.log('Debug Diagnostics menu at:', diagMenuIdx);
// Find the start of this registerMenuAction call
// Go back to find "registerMenuAction("
const rmaStart = bundle.lastIndexOf('registerMenuAction(', diagMenuIdx);
console.log('registerMenuAction start at:', rmaStart);
// Extract what's before: it should be "...e.registerMenuAction(uPt.CommonMenus.HELP,{"
const beforeMenu = bundle.substring(rmaStart - 100, rmaStart);
console.log('Before registerMenuAction:', JSON.stringify(beforeMenu));
// Find the variable for CommonMenus (e.g., uPt)
const cmVarMatch = beforeMenu.match(/([a-zA-Z0-9_$]+)\.CommonMenus$/);
const cmVar = cmVarMatch ? cmVarMatch[1] : null;
// Also find the function parameter name for menus (e.g., "e" in registerMenus(e){)
const menusParamMatch = beforeMenu.match(/[^a-zA-Z0-9_$]([a-zA-Z0-9_$]+)\.registerMenuAction\($/);
const menusParam = menusParamMatch ? menusParamMatch[1] : null;
console.log('CommonMenus variable:', cmVar, 'menus parameter:', menusParam);

// Find the end of this registerMenuAction call - it ends with "});" after diagMenuLabel
let menuEntryEnd = bundle.indexOf('});', diagMenuIdx);
// Actually look for "})," or "});"
let searchFrom = diagMenuIdx;
while (searchFrom < diagMenuIdx + 200) {
  const candidate = bundle.indexOf('}', searchFrom);
  if (candidate < 0) break;
  const afterBrace = bundle[candidate + 1];
  if (afterBrace === ',' || afterBrace === ')' || afterBrace === ';') {
    menuEntryEnd = candidate + 2; // include "}," or "})"
    break;
  }
  searchFrom = candidate + 1;
}
console.log('Menu entry ends at:', menuEntryEnd, 'context:', JSON.stringify(bundle.substring(menuEntryEnd - 20, menuEntryEnd + 20)));

// Actually, let me find the full existing entry to replace
// The pattern is: registerMenuAction(<menusParam>.<cmVar>.CommonMenus.HELP,{commandId:<regNs>.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"})
// I need to insert Welcome and DevTools entries BEFORE this entry, keeping the existing entry
const existingEntryStart = rmaStart;
// Find the closing "})" or "}," for this entry
let entryCloseParen = bundle.indexOf(')', diagMenuIdx + diagMenuLabel.length);
// Verify it's the close of registerMenuAction
const existingEntry = bundle.substring(existingEntryStart, entryCloseParen + 1);
console.log('Existing menu entry:', existingEntry);

// Replace the existing entry with: Welcome entry + DevTools entry + existing entry
const welcomeEntry = 'registerMenuAction(' + menusParam + '.' + cmVar + '.CommonMenus.HELP,{commandId:' + regNs + '.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),';
const devtoolsEntry = menusParam + '.registerMenuAction(' + menusParam + '.' + cmVar + '.CommonMenus.HELP,{commandId:' + regNs + '.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),';
// Find where the entry starts exactly (it might start with a dot if chained)
let entryStartExact = existingEntryStart;
// If previous char is '.', we need to include the variable name
const prevChar = bundle[entryStartExact - 1];
if (prevChar === '.') {
  // Go back to find the variable name start
  let varStart = entryStartExact - 1;
  while (varStart > 0 && /[a-zA-Z0-9_$]/.test(bundle[varStart - 1])) varStart--;
  entryStartExact = varStart;
}
console.log('Exact entry start at:', entryStartExact, 'context:', JSON.stringify(bundle.substring(entryStartExact - 5, entryStartExact + 50)));

// Build replacement
const fullOldEntry = bundle.substring(entryStartExact, entryCloseParen + 1);
console.log('Full old entry:', fullOldEntry.substring(0, 200));
const fullNewEntry = welcomeEntry + devtoolsEntry + fullOldEntry;
bundle = bundle.substring(0, entryStartExact) + fullNewEntry + bundle.substring(entryCloseParen + 1);
console.log('Added Help menu entries');

// Verify key patterns exist
const checks = [
  'SHOW_WELCOME={id:"kairo.welcome.show"',
  'TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle"',
  'registerCommand(' + regNs + '.SHOW_WELCOME',
  'registerCommand(' + regNs + '.TOGGLE_DEVTOOLS',
  'commandId:' + regNs + '.SHOW_WELCOME.id',
  'commandId:' + regNs + '.TOGGLE_DEVTOOLS.id',
  'toggleDevTools()',
  'kairoIPC',
];
for (const check of checks) {
  const found = bundle.includes(check);
  console.log(found ? '✓' : '✗', check.substring(0, 80));
  if (!found) {
    // Find similar text
    const idx = bundle.indexOf(check.split(',')[0].split('(')[0].substring(0, 20));
    if (idx >= 0) console.log('  Found partial at', idx, ':', JSON.stringify(bundle.substring(idx, idx + 100)));
  }
}

fs.writeFileSync(bundlePath, bundle);
console.log('Bundle patched successfully! New size:', bundle.length);
