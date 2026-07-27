const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '../../apps/desktop/lib/frontend/bundle.js');
let bundle = fs.readFileSync(bundlePath, 'utf8');

// 1. Find the namespace used in registerCommands (look for Cn.OPEN_DEBUG_DIAGNOSTICS in registerMenus)
// The pattern is: commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id
let regNs = null;
const cmdIdPattern = /commandId:([a-zA-Z0-9_$]+)\.OPEN_DEBUG_DIAGNOSTICS\.id/;
const cmdIdMatch = cmdIdPattern.exec(bundle);
if (cmdIdMatch) {
  regNs = cmdIdMatch[1];
  console.log('RegisterCommands namespace:', regNs);
} else {
  console.error('Could not find registerCommands namespace');
  process.exit(1);
}

// 2. Find the definition namespace (look for: .OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics"...)
const defPattern = /([a-zA-Z0-9_$]+)\.OPEN_DEBUG_DIAGNOSTICS=\{id:"kairo:open-debug-diagnostics"/;
const defMatch = defPattern.exec(bundle);
let defNs = null;
if (defMatch) {
  defNs = defMatch[1];
  console.log('Definition namespace:', defNs);
}

// 3. Add command definitions
// Find the close of the KairoCommands namespace: }})(Cn||(k2.KairoCommands=Cn={}))
const defIdx = defMatch.index;
// Find the "}}(" after the def
const closeAfterDef = bundle.indexOf('}})', defIdx);
console.log('Definition close at:', closeAfterDef);
console.log('Context:', bundle.substring(closeAfterDef, closeAfterDef + 80));

// Insert before the close
const newCmds = ',' + defNs + '.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  defNs + '.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
bundle = bundle.substring(0, closeAfterDef) + newCmds + bundle.substring(closeAfterDef);
console.log('Added command definitions');

// 4. Add command handlers after TOGGLE_TERMINAL
// Find: registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})
const termRegPattern = new RegExp('registerCommand\\(' + regNs.replace(/\$/g, '\\$') + '\\.TOGGLE_TERMINAL,\\{execute:\\(\\)=>this\\.commands\\.executeCommand\\("terminal:new"\\)\\}\\)');
const termMatch = termRegPattern.exec(bundle);
if (termMatch) {
  const termEndIdx = termMatch.index + termMatch[0].length;
  console.log('TOGGLE_TERMINAL handler ends at:', termEndIdx);
  const newHandlers = ',registry.registerCommand(' + regNs + '.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),' +
    'registry.registerCommand(' + regNs + '.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
  bundle = bundle.substring(0, termEndIdx) + newHandlers + bundle.substring(termEndIdx);
  console.log('Added command handlers');
} else {
  console.error('Could not find TOGGLE_TERMINAL handler');
  // Debug: search for TOGGLE_TERMINAL
  const ttIdx = bundle.indexOf('TOGGLE_TERMINAL');
  console.log('TOGGLE_TERMINAL at:', ttIdx);
  console.log('Context:', bundle.substring(ttIdx - 50, ttIdx + 150));
}

// 5. Add Help menu items
// Find the Help menu registration: CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}
const helpPattern = new RegExp('CommonMenus\\.HELP,\\{commandId:' + regNs.replace(/\$/g, '\\$') + '\\.OPEN_DEBUG_DIAGNOSTICS\\.id,label:"Debug Diagnostics",order:"z1"\\}');
const helpMatch = helpPattern.exec(bundle);
if (helpMatch) {
  // Find the variable for CommonMenus
  let cmIdx = helpMatch.index;
  while (cmIdx > 0 && bundle[cmIdx - 1] !== '(' && bundle[cmIdx - 1] !== ',') cmIdx--;
  // go back more to find the variable
  const beforeCm = bundle.substring(Math.max(0, helpMatch.index - 30), helpMatch.index);
  console.log('Before CommonMenus.HELP:', beforeCm);
  // Extract the variable name from the context
  const cmVarMatch = /([a-zA-Z0-9_$]+)\.CommonMenus/.exec(beforeCm);
  const cmVar = cmVarMatch ? cmVarMatch[1] : 'JE';
  console.log('CommonMenus variable:', cmVar);
  
  const oldHelp = cmVar + '.CommonMenus.HELP,{commandId:' + regNs + '.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}';
  const newHelp = cmVar + '.CommonMenus.HELP,{commandId:' + regNs + '.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),' +
    'e.registerMenuAction(' + cmVar + '.CommonMenus.HELP,{commandId:' + regNs + '.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),' +
    'e.registerMenuAction(' + cmVar + '.CommonMenus.HELP,{commandId:' + regNs + '.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}';
  bundle = bundle.replace(oldHelp, newHelp);
  console.log('Added Help menu entries');
} else {
  console.error('Could not find Help menu entry');
  const diagHelp = bundle.indexOf('label:"Debug Diagnostics",order:"z1"');
  if (diagHelp >= 0) {
    console.log('Debug Diagnostics menu at:', diagHelp);
    console.log('Context:', bundle.substring(diagHelp - 200, diagHelp + 50));
  }
}

fs.writeFileSync(bundlePath, bundle);
console.log('Bundle patched!');
