const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const repoRoot = path.resolve(__dirname, '../..');
const unpackedDir = path.join(repoRoot, 'dist', 'win-unpacked');
const extractDir = path.join(unpackedDir, 'resources', 'app-extracted');
const asarPath = path.join(unpackedDir, 'resources', 'app.asar');

if (!fs.existsSync(extractDir)) {
  console.error('app-extracted not found!');
  process.exit(1);
}

(async () => {
  // First fix the path issue (same as fix-asar-paths.cjs would do)
  // Actually, let's just pack and then run fix-asar-paths separately
  await asar.createPackage(extractDir, asarPath, { unpacked: false });
  const size = fs.statSync(asarPath).size;
  console.log(`Repacked asar: ${(size/1024/1024).toFixed(1)} MB`);
})();
