const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '../../dist/win-unpacked/resources/app-extracted/apps/desktop/lib/frontend/bundle.js');
let bundle = fs.readFileSync(bundlePath, 'utf8');

// First, let's revert the previous partial patch (command def was added but handlers/menus weren't)
// Actually let's just re-read the original and do it properly
// Since we modified the command defs already, let's work with current state.

// Find the exact TOGGLE_TERMINAL pattern
const termIdx = bundle.indexOf('Cn.TOGGLE_TERMINAL');
console.log('TOGGLE_TERMINAL at:', termIdx);
if (termIdx >= 0) {
  console.log('Context:', bundle.substring(termIdx, termIdx + 200));
}

// Find Help menu registration (search for CommonMenus.HELP)
const helpSearch = 'CommonMenus.FILE_OPEN';
const fileOpenIdx = bundle.indexOf(helpSearch);
console.log('\nFILE_OPEN at:', fileOpenIdx);
if (fileOpenIdx >= 0) {
  console.log('Context:', bundle.substring(fileOpenIdx, fileOpenIdx + 500));
}

// Look for order:"z1"
const z1regex = /order:"z1"/g;
let match;
while ((match = z1regex.exec(bundle)) !== null) {
  console.log('\norder:"z1" at:', match.index);
  console.log('Context:', bundle.substring(Math.max(0, match.index - 200), match.index + 100));
}
