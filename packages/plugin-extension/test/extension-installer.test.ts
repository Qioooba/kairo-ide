/**
 * End-to-end test: VS Code Extension installation lifecycle.
 *
 * Tests the complete flow:
 *   1. Create a minimal .vsix file programmatically
 *   2. Install it via installFromVsix()
 *   3. Verify extension appears in scanInstalledExtensions()
 *   4. Test enable/disable
 *   5. Uninstall and verify cleanup
 *
 * Run: node --require ts-node/register --test test/extension-installer.test.ts
 */

require('../../../tests/setup-tmp.cjs'); // KAIRO_TMP override
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';

// We need to import AdmZip to create a .vsix
import AdmZip from 'adm-zip';

// Import our modules under test
import { installFromVsix, uninstallExtension, setExtensionEnabled, loadExtensionManifest, saveExtensionManifest } from '../src/node/kairo-extension-installer';
import { scanInstalledExtensions } from '../src/node/kairo-extension-scanner';
import { isAllowlisted } from '../src/node/kairo-allowlist';
import {
  KAIRO_EXTENSIONS_DIR_NAME,
  KAIRO_EXTENSIONS_SUBDIR,
  KAIRO_EXTENSIONS_MANIFEST,
} from '../src/common/kairo-extension-model';

const TEST_EXTENSION_ID = 'kairo-test.java-properties';
const TEST_EXTENSION_VERSION = '1.0.0';
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'sample-extension');
const TMP_DIR = path.join(os.tmpdir(), 'kairo-plugin-test-' + Date.now());

// Create a minimal .vsix from the fixture
function createTestVsix(): string {
  const vsixPath = path.join(TMP_DIR, 'test-extension.vsix');
  const zip = new AdmZip();

  // Add all fixture files under extension/ prefix
  const files = walkDir(FIXTURES_DIR);
  for (const file of files) {
    const relativePath = path.relative(FIXTURES_DIR, file);
    zip.addLocalFile(file, path.dirname(`extension/${relativePath}`));
  }

  // Add [Content_Types].xml
  const contentTypes = '<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="json" ContentType="application/json"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n</Types>';
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'));

  // Add extension.vsixmanifest
  const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>\n<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">\n  <Metadata>\n    <Identity Id="${TEST_EXTENSION_ID}" Version="${TEST_EXTENSION_VERSION}" Publisher="kairo-test" />\n    <DisplayName>Java Properties</DisplayName>\n    <Description>Syntax highlighting for .properties files</Description>\n  </Metadata>\n  <Installation>\n    <InstallationTarget Id="Microsoft.VisualStudio.Code" />\n  </Installation>\n  <Dependencies/>\n  <Assets>\n    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" />\n  </Assets>\n</PackageManifest>`;
  zip.addFile('extension.vsixmanifest', Buffer.from(vsixManifest, 'utf-8'));

  zip.writeZip(vsixPath);
  return vsixPath;
}

function walkDir(dir: string): string[] {
  const result: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkDir(fullPath));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

describe('VS Code Extension Installation', () => {
  let vsixPath: string;
  let originalManifest: string;

  before(() => {
    // Create temp directory
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }

    // Backup any existing manifest
    const manifestPath = path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_EXTENSIONS_MANIFEST);
    if (fs.existsSync(manifestPath)) {
      originalManifest = fs.readFileSync(manifestPath, 'utf-8');
    }

    // Create the test .vsix
    vsixPath = createTestVsix();
    console.log(`Test .vsix created: ${vsixPath}`);
  });

  after(() => {
    // Clean up: remove test extension if installed
    try {
      uninstallExtension(TEST_EXTENSION_ID);
    } catch { /* ok if not installed */ }

    // Restore original manifest
    if (originalManifest) {
      const manifestPath = path.join(os.homedir(), KAIRO_EXTENSIONS_DIR_NAME, KAIRO_EXTENSIONS_MANIFEST);
      fs.writeFileSync(manifestPath, originalManifest, 'utf-8');
    }

    // Clean up temp files
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('creates a valid .vsix file', () => {
    assert.ok(fs.existsSync(vsixPath), '.vsix file should exist');
    const stats = fs.statSync(vsixPath);
    assert.ok(stats.size > 0, '.vsix file should not be empty');
    assert.ok(vsixPath.endsWith('.vsix'), 'should have .vsix extension');
  });

  it('installs from .vsix successfully', () => {
    const result = installFromVsix(vsixPath);
    assert.strictEqual(result.success, true, `Install should succeed: ${!result.success ? result.error : ''}`);
    if (result.success) {
      assert.strictEqual(result.extension.id, TEST_EXTENSION_ID);
      assert.strictEqual(result.extension.publisher, 'kairo-test');
      assert.strictEqual(result.extension.name, 'java-properties');
      assert.strictEqual(result.extension.version, TEST_EXTENSION_VERSION);
      assert.strictEqual(result.extension.displayName, 'Java Properties Syntax Highlighting');
      assert.strictEqual(result.extension.enabled, true);
      assert.strictEqual(result.extension.categories.length, 1);
      assert.strictEqual(result.extension.categories[0], 'Programming Languages');
      assert.ok(result.extension.extensionPath.includes('kairo-test.java-properties-1.0.0'));
      assert.ok(fs.existsSync(result.extension.extensionPath), 'extension directory should exist');
      assert.ok(fs.existsSync(path.join(result.extension.extensionPath, 'package.json')), 'package.json should exist');
      assert.ok(fs.existsSync(path.join(result.extension.extensionPath, 'syntaxes', 'properties.tmLanguage.json')), 'grammar file should exist');
    }
  });

  it('rejects duplicate installation', () => {
    const result = installFromVsix(vsixPath);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.includes('already installed'));
    }
  });

  it('rejects invalid file', () => {
    // Test with a non-existent file
    const result = installFromVsix(path.join(TMP_DIR, 'nonexistent.vsix'));
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error.includes('File not found'));
    }
  });

  it('rejects non-vsix file', () => {
    const txtPath = path.join(TMP_DIR, 'test.txt');
    fs.writeFileSync(txtPath, 'not a vsix');
    const result = installFromVsix(txtPath);
    assert.strictEqual(result.success, false, 'should reject non-vsix file');
    // The error could be either "Failed to open" or "Missing extension/package.json"
    assert.ok(result.error.length > 0, 'should have an error message');
  });

  it('scans installed extensions and finds the test extension', () => {
    const extensions = scanInstalledExtensions();
    const testExt = extensions.find(e => e.id === TEST_EXTENSION_ID);
    assert.ok(testExt, 'test extension should be in scan results');
    if (testExt) {
      assert.strictEqual(testExt.version, TEST_EXTENSION_VERSION);
      assert.strictEqual(testExt.publisher, 'kairo-test');
      assert.strictEqual(testExt.name, 'java-properties');
      assert.strictEqual(testExt.enabled, true);
      assert.strictEqual(testExt.categories.length, 1);
      assert.strictEqual(testExt.activationEvents.length, 1);
      assert.strictEqual(testExt.activationEvents[0], 'onLanguage:properties');
      assert.strictEqual(testExt.engineVersion, '^1.73.0');
    }
  });

  it('disables the extension', () => {
    setExtensionEnabled(TEST_EXTENSION_ID, false);
    const extensions = scanInstalledExtensions();
    const testExt = extensions.find(e => e.id === TEST_EXTENSION_ID);
    assert.ok(testExt, 'extension should still exist after disable');
    assert.strictEqual(testExt!.enabled, false, 'extension should be disabled');
  });

  it('re-enables the extension', () => {
    setExtensionEnabled(TEST_EXTENSION_ID, true);
    const extensions = scanInstalledExtensions();
    const testExt = extensions.find(e => e.id === TEST_EXTENSION_ID);
    assert.ok(testExt, 'extension should still exist after re-enable');
    assert.strictEqual(testExt!.enabled, true, 'extension should be enabled');
  });

  it('uninstalls the extension', () => {
    uninstallExtension(TEST_EXTENSION_ID);
    const extensions = scanInstalledExtensions();
    const testExt = extensions.find(e => e.id === TEST_EXTENSION_ID);
    assert.strictEqual(testExt, undefined, 'extension should be removed after uninstall');
  });

  it('throws on uninstall of non-existent extension', () => {
    assert.throws(
      () => uninstallExtension('nonexistent.publisher.ext'),
      /not installed/
    );
  });

  it('verify .vsix content is read correctly', () => {
    // Re-install for this test
    installFromVsix(vsixPath);
    const extensions = scanInstalledExtensions();
    const testExt = extensions.find(e => e.id === TEST_EXTENSION_ID);
    assert.ok(testExt, 'should be reinstalled');
    assert.strictEqual(testExt!.displayName, 'Java Properties Syntax Highlighting');
    assert.strictEqual(testExt!.description, 'Syntax highlighting for .properties files (Java properties format)');
    // Clean up
    uninstallExtension(TEST_EXTENSION_ID);
  });

  it('verifies extension contributes are valid for plugin-ext consumption', () => {
    // Install
    const result = installFromVsix(vsixPath);
    assert.strictEqual(result.success, true);
    if (!result.success) { return; }

    const extPath = result.extension.extensionPath;
    const pkgJsonPath = path.join(extPath, 'package.json');
    assert.ok(fs.existsSync(pkgJsonPath), 'package.json must exist');

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

    // Verify contributes.languages
    assert.ok(pkg.contributes, 'package.json must have contributes');
    assert.ok(Array.isArray(pkg.contributes.languages), 'must have languages contributes');
    const lang = pkg.contributes.languages[0];
    assert.strictEqual(lang.id, 'properties', 'language id must be "properties"');
    assert.ok(lang.extensions.includes('.properties'), 'must support .properties extension');
    assert.ok(lang.configuration, 'must have language configuration reference');

    // Verify language configuration file
    const langConfigPath = path.join(extPath, lang.configuration);
    assert.ok(fs.existsSync(langConfigPath), 'language-configuration.json must exist');
    const langConfig = JSON.parse(fs.readFileSync(langConfigPath, 'utf-8'));
    assert.strictEqual(langConfig.comments.lineComment, '#', 'line comment must be #');
    assert.ok(Array.isArray(langConfig.brackets), 'must have bracket pairs');

    // Verify grammars
    assert.ok(Array.isArray(pkg.contributes.grammars), 'must have grammars contributes');
    const grammar = pkg.contributes.grammars[0];
    assert.strictEqual(grammar.language, 'properties', 'grammar language must be "properties"');
    assert.strictEqual(grammar.scopeName, 'source.properties', 'scopeName must be "source.properties"');
    assert.ok(grammar.path, 'grammar must have a path');

    // Verify TextMate grammar file
    const grammarPath = path.join(extPath, grammar.path);
    assert.ok(fs.existsSync(grammarPath), 'grammar file must exist');
    const tmGrammar = JSON.parse(fs.readFileSync(grammarPath, 'utf-8'));
    assert.strictEqual(tmGrammar.scopeName, 'source.properties', 'grammar scopeName mismatch');
    assert.ok(Array.isArray(tmGrammar.patterns), 'grammar must have patterns');
    assert.ok(tmGrammar.repository, 'grammar must have repository');
    assert.ok(tmGrammar.repository.comment, 'grammar must have comment rule');
    assert.ok(tmGrammar.repository['key-value'], 'grammar must have key-value rule');

    // Verify activationEvents
    assert.ok(Array.isArray(pkg.activationEvents), 'must have activationEvents');
    assert.ok(pkg.activationEvents.includes('onLanguage:properties'), 'must activate on properties language');

    // Verify engine compatibility
    assert.ok(pkg.engines, 'must have engines');
    assert.ok(pkg.engines.vscode, 'must have vscode engine');
    assert.ok(pkg.engines.vscode.startsWith('^1.'), 'engine must be ^1.x');

    // Clean up
    uninstallExtension(TEST_EXTENSION_ID);
  });

  it('verifies engine version compatibility check', () => {
    // Install and get the extension
    installFromVsix(vsixPath);
    const extensions = scanInstalledExtensions();
    const testExt = extensions.find(e => e.id === TEST_EXTENSION_ID);
    assert.ok(testExt, 'extension should be installed');
    assert.strictEqual(testExt!.engineVersion, '^1.73.0', 'engine version must be ^1.73.0');

    // Verify the compatibility report is generated
    const { generateCompatibilityReport } = require('../src/node/kairo-compatibility');
    const report = generateCompatibilityReport(testExt!);
    assert.ok(report, 'compatibility report must be generated');
    assert.strictEqual(report.extensionId, TEST_EXTENSION_ID);
    assert.ok(report.score >= 0.7, `score should be >= 0.7 for a language extension, got ${report.score}`);
    assert.strictEqual(report.assessment, 'compatible', 'language extension should be compatible');
    assert.strictEqual(report.engineIssues.length, 0, 'no engine issues for ^1.73.0');
    assert.strictEqual(report.conflicts.length, 0, 'no conflicts with Kairo built-ins');

    // Clean up
    uninstallExtension(TEST_EXTENSION_ID);
  });
});

describe('Allowlist', () => {
  it('recognizes allowlisted extensions', () => {
    assert.strictEqual(isAllowlisted('redhat.java'), true);
    assert.strictEqual(isAllowlisted('EditorConfig.EditorConfig'), true);
    assert.strictEqual(isAllowlisted('vscjava.vscode-maven'), true);
  });

  it('rejects unknown extensions', () => {
    assert.strictEqual(isAllowlisted('unknown.publisher.ext'), false);
    assert.strictEqual(isAllowlisted('completely.random'), false);
  });
});