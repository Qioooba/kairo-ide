'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Pure remap of virtual Java diagnostic coords → JSP coords (JV-P1-2).
 * Mirrors mapDiagnosticToJsp without importing monaco.
 */
function mapDiag(
  jspContent,
  blockStart,
  blockContent,
  javaLine,
  javaChar,
  kind,
  wrapperLines,
  exprPrefixLen,
) {
  const before = jspContent.slice(0, blockStart);
  const parts = before.split('\n');
  const originLine = parts.length - 1;
  const originChar = parts[parts.length - 1]?.length ?? 0;
  const lineInBlock = javaLine - wrapperLines;
  if (lineInBlock < 0) return { line: originLine, character: originChar };
  let characterInBlock = javaChar;
  if (kind === 'expression' && lineInBlock === 0) {
    characterInBlock = Math.max(0, javaChar - exprPrefixLen);
  }
  if (lineInBlock === 0) {
    return { line: originLine, character: originChar + characterInBlock };
  }
  return { line: originLine + lineInBlock, character: characterInBlock };
}

describe('jsp scriptlet diagnostic remap (JV-P1-2)', () => {
  test('first line adds block start column offset', () => {
    const jsp = '    <% out.print(x); %>';
    const blockStart = jsp.indexOf(' out');
    const blockContent = jsp.slice(blockStart, jsp.indexOf('%>'));
    const mapped = mapDiag(jsp, blockStart, blockContent, 11, 5, 'scriptlet', 11, 0);
    assert.equal(mapped.line, 0);
    assert.equal(mapped.character, blockStart + 5);
  });

  test('expression subtracts Object __expr = prefix', () => {
    const prefix = 'Object __expr = ';
    const jsp = '<%=foo%>';
    const blockStart = jsp.indexOf('foo');
    const blockContent = 'foo';
    const mapped = mapDiag(jsp, blockStart, blockContent, 11, prefix.length + 1, 'expression', 11, prefix.length);
    assert.equal(mapped.line, 0);
    assert.equal(mapped.character, blockStart + 1);
  });
});

describe('completion range helpers (JV-P1-9)', () => {
  test('el/tld/properties sources no longer hardcode (1,1,1,1)', () => {
    const root = path.join(__dirname);
    for (const file of ['el-expression-provider.js', 'jsp-tld-completion.js', 'properties-language.js']) {
      const src = fs.readFileSync(path.join(root, '../../lib/browser', file), 'utf8');
      assert.doesNotMatch(
        src,
        /startLineNumber:\s*1,\s*startColumn:\s*1,\s*endLineNumber:\s*1,\s*endColumn:\s*1/,
        `${file} still has hardcoded (1,1,1,1) range`,
      );
      assert.match(src, /getWordUntilPosition/, `${file} should use getWordUntilPosition`);
    }
  });
});

describe('jsp debug breakpoint helpers (JV-P1-13)', () => {
  // Mirror pure helpers from jsp-debug-breakpoint.ts (avoid Monaco ESM import in CJS tests).
  function fsPathBasename(fsPath) {
    const normalized = fsPath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

  function joinFsPath(dir, fileName) {
    const trimmed = dir.replace(/[/\\]+$/, '');
    const sep = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
    return `${trimmed}${sep}${fileName}`;
  }

  const JSP_LINE_COMMENT_REGEX = /\/\/\s*(?:HTML\s*\/\/\s*)?(?:from\s+)?line\s+#?(\d+)/i;

  function parseServletLineMappings(text, javaFilePath) {
    const mappings = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = JSP_LINE_COMMENT_REGEX.exec(lines[i]);
      if (match) {
        const jspLine = parseInt(match[1], 10);
        if (jspLine > 0) {
          mappings.push({ jspLine, javaLine: i + 1, javaFile: javaFilePath });
        }
      }
    }
    return mappings;
  }

  function parseSmapLineMappings(text, javaFilePath) {
    const lineSection = /\*L\r?\n([\s\S]*?)(?:\*E|\*S\b|$)/.exec(text);
    if (!lineSection) return [];
    const mappings = [];
    const entryRe = /^(\d+)(?:#\d+)?(?:,(\d+))?:(\d+)(?:,(\d+))?$/;
    for (const raw of lineSection[1].split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = entryRe.exec(line);
      if (!m) continue;
      const inputStart = parseInt(m[1], 10);
      const inputCount = m[2] ? parseInt(m[2], 10) : 1;
      const outputStart = parseInt(m[3], 10);
      const outputInc = m[4] ? parseInt(m[4], 10) : 1;
      if (inputStart <= 0 || outputStart <= 0) continue;
      for (let i = 0; i < inputCount; i++) {
        mappings.push({
          jspLine: inputStart + i,
          javaLine: outputStart + i * outputInc,
          javaFile: javaFilePath,
        });
      }
    }
    return mappings;
  }

  function mapJavaLineToJspLine(text, javaLine) {
    const lines = text.split(/\r?\n/);
    const start = Math.min(Math.max(javaLine, 1), lines.length) - 1;
    for (let i = start; i >= 0; i--) {
      const match = JSP_LINE_COMMENT_REGEX.exec(lines[i]);
      if (match) return parseInt(match[1], 10);
    }
    return javaLine;
  }

  test('fsPathBasename handles Windows backslashes', () => {
    assert.equal(fsPathBasename('C:\\work\\index.jsp'), 'index.jsp');
    assert.equal(fsPathBasename('/tmp/foo/bar.jsp'), 'bar.jsp');
  });

  test('joinFsPath preserves Windows separator style', () => {
    assert.equal(joinFsPath('E:\\tomcat\\work', 'index_jsp.java'), 'E:\\tomcat\\work\\index_jsp.java');
    assert.equal(joinFsPath('/var/work/', 'index_jsp.java'), '/var/work/index_jsp.java');
  });

  test('parseServletLineMappings reads // line N comments', () => {
    const text = [
      'public void _jspService() {',
      '  // line 3',
      '  out.write("hi");',
      '  // line 7',
      '  out.print(x);',
      '}',
    ].join('\n');
    const maps = parseServletLineMappings(text, 'index_jsp.java');
    assert.equal(maps.length, 2);
    assert.equal(maps[0].jspLine, 3);
    assert.equal(maps[0].javaLine, 2);
    assert.equal(maps[1].jspLine, 7);
    assert.equal(maps[1].javaLine, 4);
  });

  test('parseSmapLineMappings reads *L section', () => {
    const text = [
      'class X {}',
      'Smap',
      '*S Jasper',
      '*F',
      '+ 1 index.jsp',
      'index.jsp',
      '*L',
      '1#1,2:10',
      '3#1:20',
      '*E',
    ].join('\n');
    const maps = parseSmapLineMappings(text, 'index_jsp.java');
    assert.ok(maps.length >= 3);
    assert.equal(maps[0].jspLine, 1);
    assert.equal(maps[0].javaLine, 10);
    assert.equal(maps[1].jspLine, 2);
    assert.equal(maps[1].javaLine, 11);
    assert.equal(maps[2].jspLine, 3);
    assert.equal(maps[2].javaLine, 20);
  });

  test('mapJavaLineToJspLine walks back to nearest marker', () => {
    const text = ['a', '// line 5', 'b', 'c', '// line 9', 'd'].join('\n');
    assert.equal(mapJavaLineToJspLine(text, 4), 5);
    assert.equal(mapJavaLineToJspLine(text, 6), 9);
  });

  test('source uses DI mapper, FileService, and robust path helpers', () => {
    const src = fs.readFileSync(path.join(__dirname, 'jsp-debug-breakpoint.ts'), 'utf8');
    assert.doesNotMatch(src, /registerJspBreakpointCommand\(\):\s*monaco\.IDisposable/);
    assert.match(src, /mapper:\s*JspDebugBreakpointMapper/);
    assert.match(src, /fileService\.readFile/);
    assert.doesNotMatch(src, /fetch\(resource/);
    assert.match(src, /export function fsPathBasename/);
    assert.match(src, /parseSmapLineMappings/);
    assert.match(src, /debugBreakpoint\.noMapping/);
  });
});

describe('xml dtd validator (JV-P1-15)', () => {
  // Mirror pure helpers from xml-dtd-validator.ts (avoid Monaco ESM import in CJS tests).
  function maskXmlCommentsAndCdata(content) {
    return content
      .replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length))
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, m => ' '.repeat(m.length));
  }

  function buildLineStarts(content) {
    const starts = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') starts.push(i + 1);
    }
    return starts;
  }

  function offsetToLineCol(lineStarts, offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    const lineIdx = Math.max(0, hi);
    return { line: lineIdx + 1, col: offset - lineStarts[lineIdx] + 1 };
  }

  const TAG_RE = /<\/?([a-zA-Z_][\w.:-]*)(\s[^>]*)?\/?>/g;
  const DOCTYPE_RE =
    /<!DOCTYPE\s+(\S+)(?:\s+PUBLIC\s+["']([^"']+)["']\s+["']([^"']+)["']|\s+SYSTEM\s+["']([^"']+)["']|\s+["']([^"']+)["'])?\s*>/gi;

  function validateXmlTags(content) {
    const markers = [];
    const masked = maskXmlCommentsAndCdata(content);
    const lineStarts = buildLineStarts(content);
    const tagStack = [];
    TAG_RE.lastIndex = 0;
    let tagMatch;
    while ((tagMatch = TAG_RE.exec(masked)) !== null) {
      const fullTag = tagMatch[0];
      const tagName = tagMatch[1];
      const isClosing = fullTag.startsWith('</');
      const isSelfClosing = fullTag.endsWith('/>') && !isClosing;
      const { line, col } = offsetToLineCol(lineStarts, tagMatch.index);
      if (isClosing) {
        if (tagStack.length === 0) {
          markers.push({ message: `多余的闭合标签 </${tagName}>` });
          continue;
        }
        const last = tagStack.pop();
        if (last.name !== tagName) {
          markers.push({ message: `标签不匹配: 期望 </${last.name}>` });
        }
      } else if (!isSelfClosing) {
        tagStack.push({ name: tagName, line, col });
      }
    }
    for (const unclosed of tagStack.reverse()) {
      markers.push({ message: `未闭合的标签 <${unclosed.name}>` });
    }
    return markers;
  }

  function collectLocalXmlRefs(content) {
    const refs = [];
    DOCTYPE_RE.lastIndex = 0;
    let m;
    while ((m = DOCTYPE_RE.exec(content)) !== null) {
      const dtdRef = m[3] || m[4] || m[5];
      if (dtdRef && !/^(https?:|urn:)/i.test(dtdRef)) {
        refs.push(dtdRef);
      }
    }
    return refs;
  }

  test('maskXmlCommentsAndCdata preserves length and hides tags', () => {
    const xml = '<root><!-- <bad> --><![CDATA[<also>]]><ok/></root>';
    const masked = maskXmlCommentsAndCdata(xml);
    assert.equal(masked.length, xml.length);
    assert.ok(!masked.includes('<bad>'));
    assert.ok(!masked.includes('<also>'));
    assert.ok(masked.includes('<ok/>'));
  });

  test('offsetToLineCol is O(log n) via lineStarts (no join rebuild)', () => {
    const content = 'a\nbb\nccc';
    const starts = buildLineStarts(content);
    assert.deepEqual(starts, [0, 2, 5]);
    assert.deepEqual(offsetToLineCol(starts, 0), { line: 1, col: 1 });
    assert.deepEqual(offsetToLineCol(starts, 3), { line: 2, col: 2 });
    assert.deepEqual(offsetToLineCol(starts, 5), { line: 3, col: 1 });
  });

  test('validateXmlContent ignores tags inside comments/CDATA', () => {
    const xml = '<root><!-- <unclosed> --><![CDATA[<x>]]></root>';
    assert.equal(validateXmlTags(xml).length, 0);
  });

  test('validateXmlContent does not treat HTML void tags specially', () => {
    const xml = '<root><br></root>';
    const markers = validateXmlTags(xml);
    assert.ok(markers.some(m => /未闭合|不匹配/.test(m.message)));
  });

  test('local DTD refs only collected for non-remote SYSTEM ids', () => {
    assert.deepEqual(collectLocalXmlRefs('<!DOCTYPE a SYSTEM "local.dtd"><a/>'), ['local.dtd']);
    assert.deepEqual(collectLocalXmlRefs('<!DOCTYPE a SYSTEM "http://example.com/a.dtd"><a/>'), []);
  });

  test('validator revalidates on change and checks existence', () => {
    const src = fs.readFileSync(path.join(__dirname, 'xml-dtd-validator.ts'), 'utf8');
    assert.match(src, /onDidChangeContent/);
    assert.match(src, /findMissingLocalRefs|localRefExists/);
    assert.match(src, /maskXmlCommentsAndCdata/);
    assert.match(src, /buildLineStarts/);
    assert.doesNotMatch(src, /VOID_TAGS/);
    assert.doesNotMatch(src, /可能不存在/);
  });
});

describe('tld scan skips (JV-P2-5)', () => {
  test('does not skip WEB-INF/lib', () => {
    const src = fs.readFileSync(path.join(__dirname, 'jsp-tld-completion.ts'), 'utf8');
    assert.match(src, /parentBase !== 'WEB-INF'/);
    assert.match(src, /for \(const root of roots\)/);
  });

  test('invalidates cache on TLD/JAR file changes', () => {
    const src = fs.readFileSync(path.join(__dirname, 'jsp-tld-completion.ts'), 'utf8');
    assert.match(src, /ensureWatchers/);
    assert.match(src, /onDidFilesChange/);
    assert.match(src, /\.tld/);
    assert.match(src, /WEB-INF\/lib/);
    assert.match(src, /invalidateCache\(\)/);
  });
});

describe('jsp navigation webapp paths (JV-P2-7)', () => {
  test('findWebappRoot exported and used for absolute paths', () => {
    const src = fs.readFileSync(path.join(__dirname, 'jsp-navigation.ts'), 'utf8');
    assert.match(src, /export function findWebappRoot/);
    assert.match(src, /path\.startsWith\('\/'\)/);
    assert.match(src, /fileService\.resolve/);
  });
});

describe('jsp scriptlet virtual URI lifecycle (JV-P2-1 / F17)', () => {
  test('completion manages ephemeral virtual docs via VirtualDocumentManager leases', () => {
    const src = fs.readFileSync(path.join(__dirname, 'jsp-scriptlet-java-completion.ts'), 'utf8');
    assert.match(src, /acquireLease/);
    assert.match(src, /lease\.dispose\(\)/);
    assert.match(src, /finally/);
  });
});

describe('jsp scriptlet diagnostics already-open (JV-P2-8)', () => {
  test('attaches existing models and language changes', () => {
    const src = fs.readFileSync(path.join(__dirname, 'jsp-scriptlet-diagnostics.ts'), 'utf8');
    assert.match(src, /monaco\.editor\.getModels\(\)/);
    assert.match(src, /onDidChangeModelLanguage/);
  });
});
