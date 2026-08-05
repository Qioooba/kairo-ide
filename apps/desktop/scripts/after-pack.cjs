'use strict';

/**
 * afterPack — mirror native binaries into resources/app.asar.unpacked.
 *
 * Why not asarUnpack in package.json?
 * electron-builder's asarUnpack path filter throws when workspace-linked
 * deps (e.g. @kairo/protocol) resolve outside apps/desktop/. Copying
 * natives here keeps .node/.dll/.exe on a real filesystem path that
 * Electron resolves preferentially over the asar copy.
 */

const fs = require('fs');
const path = require('path');

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      n += copyRecursive(s, d);
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d);
      n += 1;
    }
  }
  return n;
}

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const unpackedRoot = path.join(context.appOutDir, 'resources', 'app.asar.unpacked');

  const jobs = [
    {
      from: path.join(projectDir, 'lib', 'backend', 'native'),
      to: path.join(unpackedRoot, 'lib', 'backend', 'native'),
      label: 'backend/native',
    },
    {
      from: path.join(projectDir, 'lib', 'prebuilds'),
      to: path.join(unpackedRoot, 'lib', 'prebuilds'),
      label: 'prebuilds',
    },
  ];

  for (const job of jobs) {
    if (!fs.existsSync(job.from)) {
      console.warn(`[after-pack] SKIP missing ${job.label}: ${job.from}`);
      continue;
    }
    const count = copyRecursive(job.from, job.to);
    console.log(`[after-pack] ${job.label}: ${count} file(s) -> ${job.to}`);
  }
};
