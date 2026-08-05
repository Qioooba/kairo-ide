/**
 * Patch packaged app.asar Search Center UX for main-area popup.
 * Usage: node scripts/test/patch-search-asar.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const repoRoot = path.resolve(__dirname, '..', '..');
const asarPath = path.join(repoRoot, 'apps', 'desktop', 'dist', 'run', 'resources', 'app.asar');
const workDir = path.join(repoRoot, 'artifacts', 'asar-search-patch');
const bundlePath = path.join(workDir, 'lib', 'frontend', 'bundle.js');

console.log('extracting asar...');
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
asar.extractAll(asarPath, workDir);

let c = fs.readFileSync(bundlePath, 'utf8');

function mustReplace(from, to, label) {
  if (c.includes(to) && !c.includes(from)) {
    console.log('already applied:', label);
    return;
  }
  if (!c.includes(from)) {
    throw new Error('missing patch target: ' + label + ' :: ' + from.slice(0, 100).replace(/\s+/g, ' '));
  }
  c = c.replace(from, to);
  console.log('applied:', label);
}

mustReplace(
  `await this.model.searchStream({
            ...scoped,
            workspaceId: context.workspaceId,
            contextLines: 2
          });`,
  `await this.model.searchStream({
            ...scoped,
            workspaceId: context.workspaceId,
            rootPath: context.workspaceRoot,
            contextLines: 2
          });`,
  'rootPath'
);

// Prefer current (already partially patched) or original click handlers.
if (c.includes('onClick: () => void openSelected(match3, true),')) {
  mustReplace(
    `onMouseEnter: () => {
                      setSelectedIndex(item2.flatIndex);
                      void openSelected(match3, true);
                    },
                    onClick: () => void openSelected(match3, true),
                    onDoubleClick: () => {
                      void openSelected(match3);
                      onClose();
                    },
                    onFocus: () => {
                      setSelectedIndex(item2.flatIndex);
                      void openSelected(match3, true);
                    },
                    "data-testid": "search-result"`,
    `onMouseEnter: () => {
                      setSelectedIndex(item2.flatIndex);
                    },
                    onClick: () => {
                      setSelectedIndex(item2.flatIndex);
                    },
                    onDoubleClick: () => {
                      void openSelected(match3);
                      onClose();
                    },
                    onFocus: () => {
                      setSelectedIndex(item2.flatIndex);
                    },
                    "data-testid": "search-result"`,
    'click-select-only (from preserveFocus)'
  );
} else {
  mustReplace(
    `onMouseEnter: () => {
                      setSelectedIndex(item2.flatIndex);
                      void openSelected(match3, true);
                    },
                    onClick: () => void openSelected(match3),
                    onFocus: () => {
                      setSelectedIndex(item2.flatIndex);
                      void openSelected(match3, true);
                    },
                    "data-testid": "search-result"`,
    `onMouseEnter: () => {
                      setSelectedIndex(item2.flatIndex);
                    },
                    onClick: () => {
                      setSelectedIndex(item2.flatIndex);
                    },
                    onDoubleClick: () => {
                      void openSelected(match3);
                      onClose();
                    },
                    onFocus: () => {
                      setSelectedIndex(item2.flatIndex);
                    },
                    "data-testid": "search-result"`,
    'click-select-only (from original)'
  );
}

mustReplace(
  `onSelectIndex: (index3) => {
                if (flatItems[index3]?.kind === "match") {
                  setSelectedIndex(index3);
                  if (flatItems[index3].match) {
                    void openSelected(flatItems[index3].match, true);
                  }
                }
              }`,
  `onSelectIndex: (index3) => {
                if (flatItems[index3]?.kind === "match") {
                  setSelectedIndex(index3);
                }
              }`,
  'onSelectIndex'
);

fs.writeFileSync(bundlePath, c);
const bak = asarPath + '.bak-search';
if (!fs.existsSync(bak)) fs.copyFileSync(asarPath, bak);
asar.createPackage(workDir, asarPath).then(() => {
  console.log('packed', asarPath, fs.statSync(asarPath).size);
}).catch((e) => { console.error(e); process.exit(1); });
