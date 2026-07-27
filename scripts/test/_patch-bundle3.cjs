const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '../../apps/desktop/lib/frontend/bundle.js');
let bundle = fs.readFileSync(bundlePath, 'utf8');
console.log('Bundle length:', bundle.length);

// Pattern 1: Add command definitions
// Find: n.OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}}
// We need to find the exact namespace variable (Cn or n or whatever)
const defMarker = 'OPEN_DEBUG_DIAGNOSTICS={id:"kairo:open-debug-diagnostics",label:"Kairo: Open Debug Diagnostics"}';
const defIdx = bundle.indexOf(defMarker);
if (defIdx < 0) {
  console.error('Could not find OPEN_DEBUG_DIAGNOSTICS definition');
  process.exit(1);
}
// Find the namespace prefix by going back
let nsEnd = defIdx;
while (nsEnd > 0 && bundle[nsEnd - 1] !== '.') nsEnd--;
let nsStart = nsEnd - 1;
while (nsStart > 0 && /[a-zA-Z0-9_$]/.test(bundle[nsStart - 1])) nsStart--;
const ns = bundle.substring(nsStart, nsEnd);
console.log('Namespace for KairoCommands:', ns);

// Find the closing "}})(Cn||(k2.KairoCommands=Cn={}))" after defMarker
const closePattern = '}})(' + ns + '||(';
const closeIdx = bundle.indexOf(closePattern, defIdx);
if (closeIdx < 0) {
  // Try alternate close pattern
  const altClose = bundle.indexOf('}))', defIdx);
  console.log('Close at (alt):', altClose);
  console.log('Context:', bundle.substring(altClose - 30, altClose + 60));
  process.exit(1);
}
console.log('Namespace close at:', closeIdx);

// Insert new command definitions before the closing
const newCmds = ',' + ns + '.SHOW_WELCOME={id:"kairo.welcome.show",label:"Help: Welcome",category:"Help"},' +
  ns + '.TOGGLE_DEVTOOLS={id:"kairo.devtools.toggle",label:"Help: Toggle Developer Tools",category:"Help"}';
bundle = bundle.substring(0, closeIdx) + newCmds + bundle.substring(closeIdx);
console.log('Added command definitions');

// Pattern 2: Add command handlers after TOGGLE_TERMINAL registerCommand
// Find: e.registerCommand(Cn.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})
const termMarker = ns + '.TOGGLE_TERMINAL,{execute:()=>this.commands.executeCommand("terminal:new")})}';
const termIdx = bundle.indexOf(termMarker);
if (termIdx < 0) {
  console.error('Could not find TOGGLE_TERMINAL handler');
  process.exit(1);
}
// The closing is })}, find it
const termEndIdx = bundle.indexOf('}', termIdx);
// Actually the pattern ends with })}, let me find the exact end
const termCloseSearch = bundle.substring(termIdx, termIdx + 200);
console.log('TOGGLE_TERMINAL context:', termCloseSearch.substring(0, 150));
// Find where the registerCommand call ends (the closing of the block that contains it)
// It should be followed by async registerViewContainers
const rvcIdx = bundle.indexOf('async registerViewContainers', termIdx);
if (rvcIdx < 0) {
  console.error('Could not find registerViewContainers after TOGGLE_TERMINAL');
  process.exit(1);
}
console.log('registerViewContainers at:', rvcIdx);
// Go back to find the closing } of registerCommands
// Insert new registerCommand calls just before registerViewContainers
const welcomeFactoryId = 'kairo-welcome'; // KAIRO_WELCOME_FACTORY_ID
const newHandlers = ',registry.registerCommand(' + ns + '.SHOW_WELCOME,{execute:()=>{void this.revealOrCreateMain("' + welcomeFactoryId + '",()=>undefined,()=>undefined)}}),' +
  'registry.registerCommand(' + ns + '.TOGGLE_DEVTOOLS,{execute:()=>{try{const ipc=window.kairoIPC;if(ipc&&typeof ipc.toggleDevTools==="function"){ipc.toggleDevTools()}else{console.warn("[kairo] kairoIPC.toggleDevTools not available")}}catch(err){console.warn("[kairo] failed to toggle DevTools:",err)}}})';
// Insert before registerViewContainers
bundle = bundle.substring(0, rvcIdx) + newHandlers + bundle.substring(rvcIdx);
console.log('Added command handlers');

// Pattern 3: Add Help menu items
// Find: uPt.CommonMenus.HELP,{commandId:Cn.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}
// First find the CommonMenus variable for HELP
const helpMarker = '.CommonMenus.HELP,{commandId:' + ns + '.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}';
const helpIdx = bundle.indexOf(helpMarker);
if (helpIdx < 0) {
  // Try simpler search
  const simpleHelp = 'label:"Debug Diagnostics",order:"z1"';
  const helpIdx2 = bundle.indexOf(simpleHelp);
  console.log('Help marker (simple) at:', helpIdx2);
  console.log('Context:', bundle.substring(helpIdx2 - 200, helpIdx2 + 50));
} else {
  console.log('Help menu marker at:', helpIdx);
  // Find CommonMenus variable name
  let cmStart = helpIdx;
  while (cmStart > 0 && bundle[cmStart - 1] !== '.') cmStart--;
  let cmVarStart = cmStart - 1;
  while (cmVarStart > 0 && /[a-zA-Z0-9_$]/.test(bundle[cmVarStart - 1])) cmVarStart--;
  const cmVar = bundle.substring(cmVarStart, cmStart);
  console.log('CommonMenus variable:', cmVar);
  
  // Replace to insert Welcome and DevTools before Debug Diagnostics
  const oldHelpEntry = cmVar + '.CommonMenus.HELP,{commandId:' + ns + '.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}';
  const newHelpEntries = cmVar + '.CommonMenus.HELP,{commandId:' + ns + '.SHOW_WELCOME.id,label:"Welcome",order:"a1"}),' +
    'menus.registerMenuAction(' + cmVar + '.CommonMenus.HELP,{commandId:' + ns + '.TOGGLE_DEVTOOLS.id,label:"Toggle Developer Tools",order:"z0"}),' +
    'menus.registerMenuAction(' + cmVar + '.CommonMenus.HELP,{commandId:' + ns + '.OPEN_DEBUG_DIAGNOSTICS.id,label:"Debug Diagnostics",order:"z1"}';
  bundle = bundle.replace(oldHelpEntry, newHelpEntries);
  console.log('Added Help menu entries');
}

fs.writeFileSync(bundlePath, bundle);
console.log('Bundle patched successfully!');
