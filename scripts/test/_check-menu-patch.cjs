const fs = require('fs');
const b = fs.readFileSync('g:/spaces/kairo-ide/apps/desktop/lib/frontend/bundle.js', 'utf8');
const idx = b.indexOf('SHOW_WELCOME.id,label:"Welcome"');
if (idx >= 0) {
  console.log('Welcome menu entry at:', idx);
  console.log(b.substring(idx - 200, idx + 300));
} else {
  console.log('SHOW_WELCOME.id not found');
}
