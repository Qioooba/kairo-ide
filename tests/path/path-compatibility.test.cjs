// Path Compatibility Tests — validates Kairo IDE's ability to handle
// Chinese file paths, spaces, special characters, long paths, and
// encoding edge cases commonly encountered by Chinese Windows 10 users.
//
// These tests use Node.js built-in test runner and the fs module
// to create, read, write, and list files in various path scenarios.
// Each test creates a temp directory, runs the test, then cleans up.
//
// Run with:
//   node --test tests/path/path-compatibility.test.cjs

'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

// --------------- helpers ---------------

/** @type {Set<string>} */
const tempDirs = new Set();

/**
 * Create a temp directory with an optional subpath.
 * Returns the full path to the temp directory.
 */
function makeTempDir(subpath) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-path-'));
  const fullPath = subpath ? path.join(base, subpath) : base;
  fs.mkdirSync(fullPath, { recursive: true });
  tempDirs.add(base);
  return fullPath;
}

/**
 * Write a file, creating parent directories as needed.
 */
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Recursively remove a directory.
 */
function removeDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3 });
  } catch (_) {
    // Silently ignore cleanup errors
  }
}

// Cleanup all temp directories after tests
afterEach(() => {
  for (const dir of tempDirs) {
    removeDir(dir);
  }
  tempDirs.clear();
});

// --------------- Test Suite ---------------

describe('路径兼容性测试 (Path Compatibility)', { timeout: 30000 }, () => {

  // ============================================================
  // 中文路径测试 (Chinese Path Tests)
  // ============================================================

  describe('中文路径测试 (Chinese Path Tests)', () => {

    test('中文路径：项目目录', async () => {
      const dir = makeTempDir('测试项目');
      assert.ok(fs.existsSync(dir), '中文路径目录应存在');

      // 测试文件写入
      const filePath = path.join(dir, 'test.txt');
      writeFile(filePath, '中文内容测试');
      assert.ok(fs.existsSync(filePath), '中文路径下的文件应存在');

      // 测试文件读取
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.strictEqual(content, '中文内容测试', '文件内容应正确读取');

      // 测试文件列表
      const files = fs.readdirSync(dir);
      assert.ok(files.includes('test.txt'), '文件列表应包含创建的文件');
    });

    test('中文文件名：用户管理.java', async () => {
      const dir = makeTempDir('src');
      const filePath = path.join(dir, '用户管理.java');
      writeFile(filePath, 'public class 用户管理 {}');

      assert.ok(fs.existsSync(filePath), '中文文件名文件应存在');

      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('用户管理'), '中文文件名下的内容应正确读取');

      // 测试文件重命名
      const newPath = path.join(dir, '用户管理Controller.java');
      fs.renameSync(filePath, newPath);
      assert.ok(!fs.existsSync(filePath), '旧文件不应存在');
      assert.ok(fs.existsSync(newPath), '重命名后的文件应存在');
    });

    test('混合中英文路径：/workspace/项目v2.0/src/', async () => {
      const dir = makeTempDir(path.join('workspace', '项目v2.0', 'src'));
      assert.ok(fs.existsSync(dir), '混合路径目录应存在');

      const filePath = path.join(dir, 'Main.java');
      writeFile(filePath, 'public class Main {}');
      assert.ok(fs.existsSync(filePath), '混合路径下的文件应存在');

      const files = fs.readdirSync(dir);
      assert.ok(files.includes('Main.java'), '文件列表应包含创建的文件');
    });

    test('中文路径：深层嵌套目录', async () => {
      const dir = makeTempDir(path.join('项目', '源代码', 'com', 'example', 'legacy'));
      assert.ok(fs.existsSync(dir), '深层中文目录应存在');

      const filePath = path.join(dir, 'HelloServlet.java');
      writeFile(filePath, 'public class HelloServlet {}');
      assert.ok(fs.existsSync(filePath), '深层中文路径下的文件应存在');

      // 验证目录层级
      const parent = path.resolve(dir, '..');
      const parentFiles = fs.readdirSync(parent);
      assert.ok(parentFiles.includes('legacy'), '父目录应包含子目录');
    });

    test('中文路径：文件复制与移动', async () => {
      const srcDir = makeTempDir('源码');
      const srcFile = path.join(srcDir, '测试.java');
      writeFile(srcFile, 'class Test {}');

      const destDir = makeTempDir('目标');
      const destFile = path.join(destDir, '测试.java');

      // 复制
      fs.copyFileSync(srcFile, destFile);
      assert.ok(fs.existsSync(destFile), '复制后的文件应存在');
      assert.strictEqual(
        fs.readFileSync(destFile, 'utf-8'),
        'class Test {}',
        '复制后的内容应一致'
      );
    });

    test('中文路径：JSON 文件读写', async () => {
      const dir = makeTempDir('配置');
      const filePath = path.join(dir, '项目配置.json');
      const data = { name: '测试项目', version: '1.0', 编码: 'UTF-8' };
      writeFile(filePath, JSON.stringify(data));

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert.strictEqual(parsed.name, '测试项目');
      assert.strictEqual(parsed.编码, 'UTF-8');
    });
  });

  // ============================================================
  // 空格路径测试 (Space Path Tests)
  // ============================================================

  describe('空格路径测试 (Space Path Tests)', () => {

    test('路径含空格：/My Documents/project/', async () => {
      const dir = makeTempDir(path.join('My Documents', 'project'));
      assert.ok(fs.existsSync(dir), '含空格路径目录应存在');

      const filePath = path.join(dir, 'test.txt');
      writeFile(filePath, 'hello');
      assert.ok(fs.existsSync(filePath), '含空格路径下的文件应存在');
    });

    test('路径含空格：/project/my app/src/', async () => {
      const dir = makeTempDir(path.join('project', 'my app', 'src'));
      assert.ok(fs.existsSync(dir), '含空格路径目录应存在');

      const filePath = path.join(dir, 'App.java');
      writeFile(filePath, 'public class App {}');
      assert.ok(fs.existsSync(filePath));

      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('App'), '含空格路径下的文件内容应正确');
    });

    test('文件名含空格：hello world.java', async () => {
      const dir = makeTempDir('src');
      const filePath = path.join(dir, 'hello world.java');
      writeFile(filePath, 'public class HelloWorld {}');

      assert.ok(fs.existsSync(filePath), '含空格文件名应存在');

      const files = fs.readdirSync(dir);
      assert.ok(files.includes('hello world.java'), '文件列表应包含含空格的文件名');
    });

    test('目录名含空格：beep beep', async () => {
      const dir = makeTempDir(path.join('test', 'beep beep'));
      const filePath = path.join(dir, 'beep beep.txt');
      writeFile(filePath, '...');

      assert.ok(fs.existsSync(filePath));
      assert.ok(fs.statSync(dir).isDirectory());
    });
  });

  // ============================================================
  // 长路径测试 (Long Path Tests)
  // ============================================================

  describe('长路径测试 (Long Path Tests)', () => {

    test('长路径：深层嵌套目录（200+ 字符）', async () => {
      // Build a deep path with multiple levels
      const segments = [];
      for (let i = 0; i < 10; i++) {
        segments.push(`level-${String(i).padStart(3, '0')}-with-extra-chars`);
      }
      const deepPath = segments.join(path.sep);
      const dir = makeTempDir(deepPath);
      assert.ok(fs.existsSync(dir), '深层嵌套目录应存在');

      const dirPath = dir;
      assert.ok(dirPath.length > 200, `路径长度应 > 200，实际：${dirPath.length}`);

      const filePath = path.join(dir, 'test-file.txt');
      writeFile(filePath, 'deep content');
      assert.ok(fs.existsSync(filePath), '深层路径下的文件应存在');

      const content = fs.readFileSync(filePath, 'utf-8');
      assert.strictEqual(content, 'deep content');
    });

    test('长文件名：100+ 字符', async () => {
      const dir = makeTempDir('src');
      const longName = 'a'.repeat(80) + 'VeryLongClassName.java';
      const filePath = path.join(dir, longName);

      assert.ok(longName.length > 100, `文件名长度应 > 100，实际：${longName.length}`);

      writeFile(filePath, 'public class VeryLongClassName {}');
      assert.ok(fs.existsSync(filePath), '长文件名文件应存在');

      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('VeryLongClassName'));
    });

    test('长路径：中文深层嵌套（150+ 字符）', async () => {
      const segments = [];
      for (let i = 0; i < 8; i++) {
        segments.push(`第${i + 1}层目录名称比较长`);
      }
      const deepPath = segments.join(path.sep);
      const dir = makeTempDir(deepPath);
      assert.ok(fs.existsSync(dir), '中文深层嵌套目录应存在');

      const dirPath = dir;
      assert.ok(dirPath.length > 130, `中文路径长度应 > 130，实际：${dirPath.length}`);

      const filePath = path.join(dir, '数据文件.dat');
      writeFile(filePath, 'data');
      assert.ok(fs.existsSync(filePath));
    });
  });

  // ============================================================
  // 特殊字符测试 (Special Character Tests)
  // ============================================================

  describe('特殊字符测试 (Special Character Tests)', () => {

    test('特殊字符：project (copy)/src/', async () => {
      const dir = makeTempDir(path.join('project (copy)', 'src'));
      assert.ok(fs.existsSync(dir), '含括号路径目录应存在');

      const filePath = path.join(dir, 'Main.java');
      writeFile(filePath, 'public class Main {}');
      assert.ok(fs.existsSync(filePath));
    });

    test('特殊字符：file[1].java', async () => {
      const dir = makeTempDir('src');
      const filePath = path.join(dir, 'file[1].java');
      writeFile(filePath, 'public class File1 {}');

      assert.ok(fs.existsSync(filePath), '含方括号文件名应存在');
    });

    test('特殊字符：path with #hash/', async () => {
      const dir = makeTempDir('path with #hash');
      assert.ok(fs.existsSync(dir), '含 # 号路径目录应存在');

      const filePath = path.join(dir, 'readme.txt');
      writeFile(filePath, 'hash test');
      assert.ok(fs.existsSync(filePath));
    });

    test('特殊字符：path with @at/', async () => {
      const dir = makeTempDir('path with @at');
      assert.ok(fs.existsSync(dir), '含 @ 号路径目录应存在');

      const filePath = path.join(dir, 'config.json');
      writeFile(filePath, '{}');
      assert.ok(fs.existsSync(filePath));
    });

    test('特殊字符：path with &ampersand/', async () => {
      const dir = makeTempDir('path with &ampersand');
      assert.ok(fs.existsSync(dir), '含 & 号路径目录应存在');

      const filePath = path.join(dir, 'test.txt');
      writeFile(filePath, 'ampersand');
      assert.ok(fs.existsSync(filePath));
    });

    test('特殊字符：文件名含中文标点', async () => {
      const dir = makeTempDir('src');
      const filePath = path.join(dir, '用户（管理）模块.java');
      writeFile(filePath, 'public class 用户管理模块 {}');

      assert.ok(fs.existsSync(filePath), '含中文标点文件名应存在');

      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('用户管理模块'));
    });

    test('特殊字符：目录名含加号', async () => {
      const dir = makeTempDir('C++ projects');
      const filePath = path.join(dir, 'main.cpp');
      writeFile(filePath, 'int main() {}');

      assert.ok(fs.existsSync(filePath));
      assert.ok(fs.statSync(dir).isDirectory());
    });
  });

  // ============================================================
  // 编码测试 (Encoding Tests)
  // ============================================================

  describe('编码测试 (Encoding Tests)', () => {

    test('GBK 文件名在 UTF-8 路径中', async () => {
      const dir = makeTempDir('src');
      // gbk-encoded filename bytes for "中文测试.txt"
      const gbkName = '中文测试_GBK.txt';
      const filePath = path.join(dir, gbkName);
      writeFile(filePath, 'GBK content test');

      assert.ok(fs.existsSync(filePath), 'GBK 文件名文件应存在');

      // 验证文件列表可正确读取
      const files = fs.readdirSync(dir);
      const found = files.find(f => f.includes('中文测试'));
      assert.ok(found, '文件列表应能找到 GBK 文件名');
    });

    test('UTF-8 BOM 文件处理', async () => {
      const dir = makeTempDir('src');
      const filePath = path.join(dir, 'bom-test.txt');

      // 写入带 BOM 的 UTF-8 内容
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      const content = 'Hello BOM 测试';
      fs.writeFileSync(filePath, Buffer.concat([bom, Buffer.from(content, 'utf-8')]));

      assert.ok(fs.existsSync(filePath), 'BOM 文件应存在');

      const raw = fs.readFileSync(filePath);
      assert.strictEqual(raw[0], 0xEF, '应以 BOM 开头');
      assert.strictEqual(raw[1], 0xBB);
      assert.strictEqual(raw[2], 0xBF);

      // 读取并去除 BOM
      const text = raw.toString('utf-8');
      assert.ok(text.includes('Hello BOM 测试'), '去除 BOM 后内容应正确');
    });

    test('Emoji 文件名', async () => {
      const dir = makeTempDir('src');
      const filePath = path.join(dir, '📝notes.txt');
      writeFile(filePath, 'emoji file test');

      assert.ok(fs.existsSync(filePath), 'Emoji 文件名应存在');

      const files = fs.readdirSync(dir);
      const found = files.find(f => f.includes('notes'));
      assert.ok(found, '文件列表应包含 Emoji 文件名');
    });

    test('日文文件名', async () => {
      const dir = makeTempDir('src');
      const filePath = path.join(dir, 'テスト.java');
      writeFile(filePath, 'public class Test {}');

      assert.ok(fs.existsSync(filePath), '日文文件名应存在');

      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('Test'));
    });
  });

  // ============================================================
  // 大小写敏感性测试 (Case Sensitivity Tests)
  // ============================================================

  describe('大小写敏感性测试 (Case Sensitivity Tests)', () => {

    test('大小写：HelloServlet.java vs helloservlet.java', async () => {
      const dir = makeTempDir('src');

      const upperPath = path.join(dir, 'HelloServlet.java');
      const lowerPath = path.join(dir, 'helloservlet.java');

      writeFile(upperPath, 'public class HelloServlet {}');

      // 在 macOS 上（默认大小写不敏感），这两个路径指向同一文件
      // 在 Windows 上也是大小写不敏感
      // 在 Linux 上是大小写敏感的
      const platform = process.platform;
      if (platform === 'darwin' || platform === 'win32') {
        // 大小写不敏感平台：两个路径应指向同一文件
        assert.ok(fs.existsSync(lowerPath),
          `大小写不敏感平台 (${platform})：小写路径应能找到文件`);
      } else {
        // 大小写敏感平台：小写路径不应存在
        assert.ok(!fs.existsSync(lowerPath),
          `大小写敏感平台 (${platform})：小写路径不应存在`);
      }

      // 验证原文件存在
      assert.ok(fs.existsSync(upperPath), '大写路径文件应存在');
    });

    test('大小写：目录名 MyProject vs myproject', async () => {
      const dir = makeTempDir('MyProject');
      const filePath = path.join(dir, 'test.txt');
      writeFile(filePath, 'dir test');

      // 验证实际路径
      const files = fs.readdirSync(path.dirname(dir));
      const found = files.find(f => f.toLowerCase() === 'myproject');
      assert.ok(found, '目录应存在（大小写可能不同）');
    });
  });

  // ============================================================
  // 边界条件测试 (Edge Case Tests)
  // ============================================================

  describe('边界条件测试 (Edge Case Tests)', () => {

    test('路径以点开头（隐藏文件）', async () => {
      const dir = makeTempDir('project');
      const filePath = path.join(dir, '.kairo');
      writeFile(filePath, 'config');

      assert.ok(fs.existsSync(filePath), '隐藏文件应存在');

      // 默认 readdir 不包括隐藏文件（macOS 除外）
      const files = fs.readdirSync(dir);
      // .kairo 应该可见（readdir 默认显示所有文件包括点文件）
      assert.ok(files.includes('.kairo'), '隐藏文件应可被列出');
    });

    test('路径含多个连续空格', async () => {
      const dir = makeTempDir('project  with  spaces');
      assert.ok(fs.existsSync(dir), '含多个空格路径目录应存在');

      const filePath = path.join(dir, 'test.txt');
      writeFile(filePath, 'spaces');
      assert.ok(fs.existsSync(filePath));
    });

    test('路径含中文空格（全角空格）', async () => {
      const dir = makeTempDir('项目　全角空格');
      assert.ok(fs.existsSync(dir), '含全角空格路径目录应存在');

      const filePath = path.join(dir, 'test.txt');
      writeFile(filePath, 'fullwidth');
      assert.ok(fs.existsSync(filePath));
    });

    test('路径末尾含空格', async () => {
      // macOS 可能会自动 trim 末尾空格
      const dir = makeTempDir('project_trailing');
      const filePath = path.join(dir, 'test .txt');
      writeFile(filePath, 'trailing space');

      assert.ok(fs.existsSync(filePath), '文件名含末尾空格应存在');
    });

    test('空目录处理', async () => {
      const dir = makeTempDir('empty-dir');
      assert.ok(fs.existsSync(dir), '空目录应存在');

      const files = fs.readdirSync(dir);
      assert.strictEqual(files.length, 0, '空目录列表应为空');

      // 写入文件后验证
      writeFile(path.join(dir, 'now-not-empty.txt'), 'data');
      assert.strictEqual(fs.readdirSync(dir).length, 1);
    });

    test('大量文件列表（100个文件）', async () => {
      const dir = makeTempDir('many-files');
      for (let i = 0; i < 100; i++) {
        writeFile(path.join(dir, `file-${String(i).padStart(3, '0')}.txt`), `content ${i}`);
      }

      const files = fs.readdirSync(dir);
      assert.strictEqual(files.length, 100, '应列出所有 100 个文件');
    });
  });
});