'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');

// Inline the parser functions for testing (Node.js native test runner)
// These are ported from svn-parser.ts

function parseStatusXml(xml) {
  const entries = [];
  const regex = /<entry\s+path="([^"]*)"\s*>/g;
  const statusRegex = /<wc-status\s+item="([^"]*)"\s+props="([^"]*)"\s+revision="([^"]*)"(?:\s+wc-locked="([^"]*)")?/;

  let match;
  while ((match = regex.exec(xml)) !== null) {
    const path = match[1];
    const rest = xml.substring(match.index);
    const statusMatch = rest.match(statusRegex);
    if (statusMatch) {
      entries.push({
        path,
        item: statusMatch[1],
        props: statusMatch[2],
        revision: parseInt(statusMatch[3], 10),
        locked: statusMatch[4] === 'true',
      });
    }
  }
  return entries;
}

function parseInfoXml(xml) {
  const entryRegex = /<entry[^>]*path="([^"]*)"[^>]*>/;
  const entryMatch = xml.match(entryRegex);
  const path = entryMatch ? entryMatch[1] : '';

  const repoRegex = /<url>([^<]*)<\/url>/;
  const rootRegex = /<root>([^<]*)<\/root>/;
  const uuidRegex = /<uuid>([^<]*)<\/uuid>/;
  const revRegex = /<commit[^>]*revision="(\d+)"/;
  const authorRegex = /<author>([^<]*)<\/author>/;
  const dateRegex = /<date>([^<]*)<\/date>/;
  const kindRegex = /kind="([^"]*)"/;
  const wcRootRegex = /<wcroot-abspath>([^<]*)<\/wcroot-abspath>/;
  const scheduleRegex = /<schedule>([^<]*)<\/schedule>/;
  const depthRegex = /<depth>([^<]*)<\/depth>/;

  const repoMatch = xml.match(repoRegex);
  const rootMatch = xml.match(rootRegex);
  const uuidMatch = xml.match(uuidRegex);
  const revMatch = xml.match(revRegex);
  const authorMatch = xml.match(authorRegex);
  const dateMatch = xml.match(dateRegex);
  const kindMatch = xml.match(kindRegex);
  const wcRootMatch = xml.match(wcRootRegex);
  const scheduleMatch = xml.match(scheduleRegex);
  const depthMatch = xml.match(depthRegex);

  return {
    path,
    url: repoMatch ? repoMatch[1] : '',
    root: rootMatch ? rootMatch[1] : '',
    uuid: uuidMatch ? uuidMatch[1] : '',
    revision: revMatch ? parseInt(revMatch[1], 10) : 0,
    lastChangedAuthor: authorMatch ? authorMatch[1] : '',
    lastChangedDate: dateMatch ? new Date(dateMatch[1]) : new Date(0),
    kind: kindMatch ? kindMatch[1] : 'dir',
    wcRoot: wcRootMatch ? wcRootMatch[1] : '',
    schedule: scheduleMatch ? scheduleMatch[1] : '',
    depth: depthMatch ? depthMatch[1] : 'infinity',
  };
}

function parseLogXml(xml) {
  const entries = [];
  const entryRegex = /<logentry\s+revision="(\d+)">([\s\S]*?)<\/logentry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const revision = parseInt(match[1], 10);
    const body = match[2];

    const authorMatch = body.match(/<author>([^<]*)<\/author>/);
    const dateMatch = body.match(/<date>([^<]*)<\/date>/);
    const msgMatch = body.match(/<msg>([\s\S]*?)<\/msg>/);

    const paths = [];
    const pathRegex = /<path[^>]*action="([^"]*)"[^>]*>([^<]*)<\/path>/g;
    let pathMatch;
    while ((pathMatch = pathRegex.exec(body)) !== null) {
      paths.push({ action: pathMatch[1], path: pathMatch[2] });
    }

    entries.push({
      revision,
      author: authorMatch ? authorMatch[1] : '',
      date: dateMatch ? new Date(dateMatch[1]) : new Date(0),
      message: msgMatch ? msgMatch[1].trim() : '',
      changedPaths: paths,
    });
  }
  return entries;
}

function parseBlameXml(xml) {
  const entries = [];
  const entryRegex = /<entry\s+line-number="(\d+)"[^>]*>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const lineNumber = parseInt(match[1], 10);
    const body = match[2];

    const commitMatch = body.match(/<commit\s+revision="(\d+)"/);
    const authorMatch = body.match(/<author>([^<]*)<\/author>/);
    const dateMatch = body.match(/<date>([^<]*)<\/date>/);

    entries.push({
      lineNumber,
      revision: commitMatch ? parseInt(commitMatch[1], 10) : 0,
      author: authorMatch ? authorMatch[1] : '',
      date: dateMatch ? new Date(dateMatch[1]) : new Date(0),
    });
  }
  return entries;
}

function parseVersionString(stdout) {
  const match = stdout.match(/svn, version (\d+\.\d+\.\d+)/);
  return match ? match[1] : 'unknown';
}

// Tests

describe('SVN Parser Tests', () => {
  describe('parseStatusXml', () => {
    it('should parse a single modified entry', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src/main.c">
      <wc-status item="modified" props="none" revision="42">
      </wc-status>
    </entry>
  </target>
</status>`;
      const result = parseStatusXml(xml);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].path, 'src/main.c');
      assert.strictEqual(result[0].item, 'modified');
      assert.strictEqual(result[0].revision, 42);
    });

    it('should parse multiple entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target path=".">
<entry path="src/main.c">
<wc-status item="modified" props="none" revision="42">
</wc-status>
</entry>
<entry path="src/helper.c">
<wc-status item="added" props="none" revision="0">
</wc-status>
</entry>
<entry path="src/old.c">
<wc-status item="deleted" props="none" revision="42">
</wc-status>
</entry>
<entry path="src/unknown.txt">
<wc-status item="unversioned" props="none" revision="0">
</wc-status>
</entry>
</target>
</status>`;
      const result = parseStatusXml(xml);
      assert.strictEqual(result.length, 4);
      assert.strictEqual(result[0].item, 'modified');
      assert.strictEqual(result[1].item, 'added');
      assert.strictEqual(result[2].item, 'deleted');
      assert.strictEqual(result[3].item, 'unversioned');
    });

    it('should handle locked status', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="locked.txt">
      <wc-status item="normal" props="none" revision="42" wc-locked="true">
      </wc-status>
    </entry>
  </target>
</status>`;
      const result = parseStatusXml(xml);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].locked, true);
    });

    it('should return empty array for empty status', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
  </target>
</status>`;
      const result = parseStatusXml(xml);
      assert.strictEqual(result.length, 0);
    });
  });

  describe('parseInfoXml', () => {
    it('should parse info entry correctly', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry kind="dir" path="." revision="42">
    <url>https://svn.example.com/repo/trunk</url>
    <relative-url>^/trunk</relative-url>
    <repository>
      <root>https://svn.example.com/repo</root>
      <uuid>abc123-def456</uuid>
    </repository>
    <wc-info>
      <wcroot-abspath>/home/user/project</wcroot-abspath>
      <schedule>normal</schedule>
      <depth>infinity</depth>
    </wc-info>
    <commit revision="42">
      <author>jdoe</author>
      <date>2024-01-15T10:30:00.000000Z</date>
    </commit>
  </entry>
</info>`;
      const result = parseInfoXml(xml);
      assert.strictEqual(result.url, 'https://svn.example.com/repo/trunk');
      assert.strictEqual(result.revision, 42);
      assert.strictEqual(result.lastChangedAuthor, 'jdoe');
      assert.strictEqual(result.kind, 'dir');
      assert.strictEqual(result.schedule, 'normal');
      assert.strictEqual(result.uuid, 'abc123-def456');
    });
  });

  describe('parseLogXml', () => {
    it('should parse log entries with paths', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="100">
    <author>jdoe</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Fix bug in login module</msg>
    <paths>
      <path action="M" prop-mods="false" text-mods="true" kind="file">/trunk/src/login.c</path>
      <path action="A" prop-mods="false" text-mods="false" kind="file">/trunk/src/login.h</path>
    </paths>
  </logentry>
  <logentry revision="99">
    <author>asmith</author>
    <date>2024-01-14T08:00:00.000000Z</date>
    <msg>Initial commit</msg>
  </logentry>
</log>`;
      const result = parseLogXml(xml);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].revision, 100);
      assert.strictEqual(result[0].author, 'jdoe');
      assert.strictEqual(result[0].message, 'Fix bug in login module');
      assert.strictEqual(result[0].changedPaths.length, 2);
      assert.strictEqual(result[0].changedPaths[0].action, 'M');
      assert.strictEqual(result[0].changedPaths[1].action, 'A');
      assert.strictEqual(result[1].revision, 99);
      assert.strictEqual(result[1].changedPaths.length, 0);
    });

    it('should handle multi-line messages', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="10">
    <author>dev</author>
    <date>2024-01-01T00:00:00.000000Z</date>
    <msg>Multi-line
commit message
with details</msg>
  </logentry>
</log>`;
      const result = parseLogXml(xml);
      assert.strictEqual(result[0].message, 'Multi-line\ncommit message\nwith details');
    });
  });

  describe('parseBlameXml', () => {
    it('should parse blame entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="main.c">
    <entry line-number="1">
      <commit revision="42">
        <author>jdoe</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry line-number="2">
      <commit revision="40">
        <author>asmith</author>
        <date>2024-01-14T08:00:00.000000Z</date>
      </commit>
    </entry>
  </target>
</blame>`;
      const result = parseBlameXml(xml);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].lineNumber, 1);
      assert.strictEqual(result[0].revision, 42);
      assert.strictEqual(result[0].author, 'jdoe');
      assert.strictEqual(result[1].lineNumber, 2);
      assert.strictEqual(result[1].revision, 40);
    });
  });

  describe('parseVersionString', () => {
    it('should parse version correctly', () => {
      const stdout = 'svn, version 1.14.2 (r1899510)\n   compiled Feb 12 2023, 10:00:00 on x86_64-apple-darwin';
      assert.strictEqual(parseVersionString(stdout), '1.14.2');
    });

    it('should return unknown for unrecognized output', () => {
      assert.strictEqual(parseVersionString('not svn output'), 'unknown');
    });
  });
});