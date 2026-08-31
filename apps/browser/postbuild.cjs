// Deterministic post-build verification for @kairo/browser.
//
// Generated JavaScript is deliberately never rewritten here. Runtime fixes
// belong in source modules or esbuild.mjs, where clean checkouts and source
// maps see the same code. This step only copies static assets and verifies
// architectural boundaries that esbuild cannot express as import rules.
'use strict';

const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, 'lib', 'frontend');
const backendMain = path.join(__dirname, 'lib', 'backend', 'main.js');

function copyRequiredAsset(name) {
  const source = path.join(__dirname, 'resources', name);
  const target = path.join(frontendDir, name);
  if (!fs.existsSync(source)) {
    throw new Error(`[postbuild] required asset is missing: ${source}`);
  }
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`[postbuild] ${name} -> ${path.relative(__dirname, target)}`);
}

/**
 * The Node backend must stay on the common/node side of the dependency graph.
 * A browser import once pulled ApplicationShell and React into this bundle and
 * was hidden by prepending a jsdom polyfill. Reject that architecture instead.
 */
function verifyBackendIsDomFree(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[postbuild] backend boundary target is missing: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  // Theia embeds package metadata, so dependency-name strings such as
  // "react-dom" are not evidence of executable browser code.
  const forbiddenRuntimeMarkers = [
    'ApplicationShell',
    'document.createElement',
    '__REACT_DEVTOOLS_GLOBAL_HOOK__',
    '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  ];
  const found = forbiddenRuntimeMarkers.filter(marker => content.includes(marker));
  if (found.length > 0) {
    throw new Error(`[postbuild] backend contains browser runtime code: ${found.join(', ')}`);
  }
  console.log('[postbuild] backend dependency boundary verified (DOM-free)');
}

copyRequiredAsset('favicon.ico');
verifyBackendIsDomFree(backendMain);
