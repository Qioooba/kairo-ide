const fs = require('fs');
const b = fs.readFileSync('g:/spaces/kairo-ide/apps/desktop/lib/frontend/bundle.js', 'utf8');

// Check Welcome command def
let idx = b.indexOf('SHOW_WELCOME');
console.log('SHOW_WELCOME at:', idx);
if (idx >= 0) console.log('Cmd def:', b.substring(idx - 80, idx + 250));

// Check DevTools handler
idx = b.indexOf('toggleDevTools');
console.log('\ntoggleDevTools at:', idx);
if (idx >= 0) console.log('Handler:', b.substring(idx - 80, idx + 350));

// Check Welcome menu
idx = b.indexOf('label:"Welcome"');
console.log('\nWelcome menu at:', idx);
if (idx >= 0) console.log('Menu:', b.substring(idx - 150, idx + 250));
