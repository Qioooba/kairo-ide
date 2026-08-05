/**
 * Patch Search Center resolveScope in packaged app.asar.
 *   node scripts/test/patch-search-scope-asar.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const repoRoot = path.resolve(__dirname, '..', '..');
const asarPath = path.join(repoRoot, 'apps', 'desktop', 'dist', 'run', 'resources', 'app.asar');
const workDir = path.join(repoRoot, 'artifacts', 'asar-search-patch');

const forceRm = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  } catch (err) {
    // Windows sometimes leaves empty dirs locked; rename aside and continue.
    const junk = `${dir}.old-${Date.now()}`;
    try { fs.renameSync(dir, junk); } catch (_) { /* ignore */ }
  }
};

forceRm(workDir);
fs.mkdirSync(workDir, { recursive: true });
asar.extractAll(asarPath, workDir);

const bundlePath = path.join(workDir, 'lib', 'frontend', 'bundle.js');
let c = fs.readFileSync(bundlePath, 'utf8');

function rep(from, to, label) {
  if (c.includes(to) && !c.includes(from)) {
    console.log('already:', label);
    return;
  }
  if (!c.includes(from)) {
    throw new Error('missing patch target: ' + label);
  }
  c = c.replace(from, to);
  console.log('applied:', label);
}

rep(
  `if (scope === "current-file" || scope === "selection") {
            if (fsPath) {
              const relative4 = toWorkspaceRelative(workspaceRoot, fsPath);
              if (relative4) {
                return {
                  ...query,
                  scope,
                  include: mergeGlobs(query.include, [relative4.replace(/\\\\/g, "/")])
                };
              }
            }
          }`,
  `if (scope === "current-file" || scope === "selection") {
            if (fsPath) {
              const relative4 = toWorkspaceRelative(workspaceRoot, fsPath);
              if (relative4) {
                const file = relative4.replace(/\\\\/g, "/");
                return {
                  ...query,
                  scope,
                  include: [file]
                };
              }
            }
          }`,
  'current-file scope'
);

rep(
  `if ((scope === "directory" || scope === "module") && fsPath) {
            const dir = fsPath.replace(/[\\\\/][^\\\\/]+$/, "");
            const relativeDir = toWorkspaceRelative(workspaceRoot, dir);
            if (relativeDir) {
              const pattern = \`\${relativeDir.replace(/\\\\/g, "/")}/**\`;
              return {
                ...query,
                scope,
                include: mergeGlobs(query.include, [pattern])
              };
            }
          }`,
  `if ((scope === "directory" || scope === "module") && fsPath) {
            const dir = fsPath.replace(/[\\\\/][^\\\\/]+$/, "");
            const relativeDir = toWorkspaceRelative(workspaceRoot, dir);
            if (relativeDir) {
              const base = relativeDir.replace(/\\\\/g, "/");
              const masks = query.include?.length ? query.include : ["*"];
              const include = masks.map((mask) => {
                const m = mask.replace(/\\\\/g, "/");
                if (m.includes("/")) return m;
                return \`\${base}/**/\${m}\`;
              });
              return {
                ...query,
                scope,
                include
              };
            }
          }`,
  'directory scope'
);

fs.writeFileSync(bundlePath, c);
asar.createPackage(workDir, asarPath).then(() => {
  console.log('packed', asarPath, fs.statSync(asarPath).size);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
