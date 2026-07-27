const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '../../dist/win-unpacked/resources/app-extracted/apps/desktop/lib/frontend/bundle.js');
let bundle = fs.readFileSync(bundlePath, 'utf8');

// 1. Add command definitions after OPEN_DEBUG_DIAGNOSTICS
const cmdDefMarker = 'n.OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}}';
if (bundle.includes(cmdDefMarker)) {
  const newCmdDefs = 'n.OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"},n.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},n.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}}';
  bundle = bundle.replace(cmdDefMarker, newCmdDefs);
  console.log('Patched: command definitions added');
} else {
  console.error('ERROR: Command definitions marker not found!');
  process.exit(1);
}

// 2. Find the registerCommands method where the last command is registered (TOGGLE_TERMINAL)
// Look for: registry.registerCommand(n.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")}});
const toggleTerminalPattern = /registry\.registerCommand\(n\.TOGGLE_TERMINAL,\{execute:\(\)=>this\.commands\.executeCommand\(['"]terminal:new['"]\)\}\)/;
if (toggleTerminalPattern.test(bundle)) {
  const toggleTerminalReplacement = 'registry.registerCommand(n.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")}),registry.registerCommand(n.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("kairo-welcome",()=>undefined,()=>undefined)}}),registry.registerCommand(n.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
  bundle = bundle.replace(toggleTerminalPattern, toggleTerminalReplacement);
  console.log('Patched: command handlers added');
} else {
  console.error('ERROR: TOGGLE_TERMINAL registerCommand not found!');
  // Try to find a more lenient pattern
  const altIdx = bundle.indexOf('executeCommand("terminal:new")');
  if (altIdx >= 0) {
    console.log('Found "executeCommand(terminal:new)" at', altIdx);
    console.log('Context:', bundle.substring(altIdx - 100, altIdx + 150));
  }
}

// 3. Add menu items in the Help menu after Debug Diagnostics entry
// Look for the menu registration for OPEN_DEBUG_DIAGNOSTICS in the Help menu
const helpMenuMarker = 'commandId:n.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"';
if (bundle.includes(helpMenuMarker)) {
  const newMenuEntries = 'commandId:n.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),menus.registerMenuAction(q08.HELP,{commandId:n.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),menus.registerMenuAction(q08.HELP,{commandId:n.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"';
  bundle = bundle.replace(helpMenuMarker, newMenuEntries);
  console.log('Patched: Help menu entries added');
} else {
  console.error('ERROR: Help menu marker not found!');
  // Try alternate pattern
  const alt2 = bundle.indexOf('"Debug Diagnostics"');
  if (alt2 >= 0) {
    console.log('Found "Debug Diagnostics" at', alt2);
    console.log('Context:', bundle.substring(alt2 - 200, alt2 + 200));
  }
}

fs.writeFileSync(bundlePath, bundle);
console.log('Bundle patched successfully!');
