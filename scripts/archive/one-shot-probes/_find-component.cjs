const fs = require('fs');
const c = fs.readFileSync('G:/spaces/kairo-ide/apps/browser/lib/frontend/bundle.js', 'utf8');

// Find the wizard component by looking for "Import Legacy Java Project"
const wizardTitle = 'Import Legacy Java Project';
const wizIdx = c.indexOf(wizardTitle);
if (wizIdx < 0) { console.log('Wizard title not found'); process.exit(1); }

// Go BACK to find the start of the module/function containing this string
// The wizard widget will be in a define/require module. Let's look for the component function
// Search backwards for patterns like "data-testid\":\"wizard-title\"" which is near the top
const wizTitleMarker = 'data-testid":"wizard-title"';
let searchFrom = wizIdx;
let markerIdx = -1;
while (true) {
  const idx = c.lastIndexOf(wizTitleMarker, searchFrom);
  if (idx < 0) break;
  markerIdx = idx;
  searchFrom = idx - 1;
}
if (markerIdx < 0) { console.log('wizard-title marker not found'); process.exit(1); }

// Now look at the destructuring of props at the function start
// Go back further to find the component function signature
// In minified React components with hooks, the pattern is something like:
// var Xt=mn.memo(({fileDialogService:e,projectService:t,...})=>{...
// Let's search backwards for the destructured props pattern

const componentStart = Math.max(0, markerIdx - 15000);
const componentSection = c.slice(componentStart, markerIdx + 500);

// Find patterns like .memo( or =>{ or function( that indicate the component
// Look for destructured parameters near "data-testid"
const propPattern = /\{[^}]*fileDialogService[^}]*workspaceService[^}]*\}/g;
let match;
while ((match = propPattern.exec(componentSection)) !== null) {
  console.log('--- Found props destructuring ---');
  console.log('Position:', componentStart + match.index);
  console.log(match[0]);
  console.log();
}

// Also search for workspaceService variable
const wsPattern = /workspaceService[:=][a-zA-Z_$][a-zA-Z0-9_$]*/g;
while ((match = wsPattern.exec(componentSection)) !== null) {
  console.log('workspaceService at pos', componentStart + match.index, ':', match[0]);
}
