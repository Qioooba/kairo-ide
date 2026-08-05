const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const repoRoot = path.resolve(__dirname, '../..');
const asarPath = path.join(repoRoot, 'dist', 'win-unpacked', 'resources', 'app.asar');
const bundleDest = path.join(repoRoot, 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');

// Extract fresh bundle from original asar (before any patches)
// But wait, the asar might have been partially modified. Let me check if there's a backup or use the dist2/dist3.
// Actually, we can copy from dist2 or dist3 if they exist.
const dist2bundle = path.join(repoRoot, 'dist', 'win-unpacked', 'resources', 'app-extracted', 'apps', 'desktop', 'lib', 'frontend', 'bundle.js');
if (fs.existsSync(dist2bundle)) {
  // Check if it's the original (not patched by our previous script)
  const b = fs.readFileSync(dist2bundle, 'utf8');
  if (!b.includes('SHOW_WELCOME')) {
    fs.copyFileSync(dist2bundle, bundleDest);
    console.log('Restored bundle from app-extracted (original)');
  } else {
    console.log('app-extracted bundle was already patched, looking elsewhere...');
  }
} else {
  // Extract from asar directly
  const buf = asar.extractFile(asarPath, 'apps/desktop/lib/frontend/bundle.js');
  fs.writeFileSync(bundleDest, buf);
  console.log('Extracted fresh bundle from asar');
}
