/**
 * Build .vsix — creates a valid .vsix package from a local extension directory.
 *
 * A .vsix file is a ZIP archive containing:
 *   - extension/               (all extension files)
 *   - [Content_Types].xml
 *   - extension.vsixmanifest
 *
 * This script is used to generate test fixtures for the extension installer.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use Node.js built-in zlib + archiver-like approach, or adm-zip
import AdmZip from 'adm-zip';

function buildVsix(extensionDir: string, outputPath: string): void {
  const zip = new AdmZip();

  // Read package.json to get extension metadata
  const pkg = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf-8'));
  const extensionId = `${pkg.publisher}.${pkg.name}`;
  const version = pkg.version || '1.0.0';

  // Add all files under extension/ prefix
  const files = walkDir(extensionDir);
  for (const file of files) {
    const relativePath = path.relative(extensionDir, file);
    const entryName = `extension/${relativePath}`;
    zip.addLocalFile(file, path.dirname(entryName));
  }

  // Add [Content_Types].xml
  const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`;
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'));

  // Add extension.vsixmanifest
  const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Id="${extensionId}" Version="${version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName || pkg.name}</DisplayName>
    <Description>${pkg.description || ''}</Description>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" />
  </Assets>
</PackageManifest>`;
  zip.addFile('extension.vsixmanifest', Buffer.from(vsixManifest, 'utf-8'));

  zip.writeZip(outputPath);
  console.log(`.vsix created: ${outputPath} (${files.length} files)`);
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

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node build-vsix.js <extension-dir> <output-path>');
  process.exit(1);
}

const [extDir, outputPath] = args;
buildVsix(extDir, outputPath);