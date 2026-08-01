// tests/setup-tmp.cjs
//
// 作用: 在 Kairo 测试启动时加载, 把 os.tmpdir() 重定向到 $KAIRO_TMP (默认 <repo-root>/tmp),
//       避免污染 C:\Users\Qi\AppData\Local\Temp (即 userprofile Temp)。
//
// 用法 (二选一):
//
//   (A) 在每个 .test.cjs / .test.ts 顶部第一行加:
//         require('<相对路径>/tests/setup-tmp.cjs');
//       (具体路径由 `node scripts/add-setup-tmp-require.cjs` 脚本自动注入)
//
//   (B) 通过 Node 启动参数全局加载:
//         node -r ./tests/setup-tmp.cjs xxx.test.cjs
//       见 package.json 的 test 脚本
//
// 配置:
//   $env:KAIRO_TMP = "<自定义路径>"   显式覆盖, 例如 E:\AI\kairo-ide\tmp
//   不设则默认 <repo-root>/tmp
//
// 副作用:
//   - os.tmpdir() 返回值被改写 (monkey-patch)
//   - process.env.KAIRO_TMP 被设置
//
// 注意: 不影响解构式 require, 例如
//       const { tmpdir } = require('os');   // 拷贝的是原函数引用
// 幸运的是 Kairo 测试代码全部是 os.tmpdir() method call, 没有解构用法。

'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let _kairoTmp = null;

function _findRepoRoot(start) {
  // 向上找, 找含 package.json 且 name="kairo-ide" 的最近祖先
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const p = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (p.name === 'kairo-ide') return dir;
      } catch { /* ignore */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveKairoTmp() {
  if (_kairoTmp) return _kairoTmp;
  if (process.env.KAIRO_TMP && process.env.KAIRO_TMP.trim() !== '') {
    _kairoTmp = process.env.KAIRO_TMP;
  } else {
    const repoRoot = _findRepoRoot(__dirname) || path.resolve(__dirname, '..');
    _kairoTmp = path.join(repoRoot, 'tmp');
  }
  fs.mkdirSync(_kairoTmp, { recursive: true });
  process.env.KAIRO_TMP = _kairoTmp;
  return _kairoTmp;
}

function applyKairoTmp() {
  const t = resolveKairoTmp();
  // Monkey-patch os.tmpdir, 让所有 os.tmpdir() 调用都返回 KAIRO_TMP
  // Node 内部 fs.mkdtempSync 等也会走 os.tmpdir()
  Object.defineProperty(os, 'tmpdir', {
    value: function tmpdir() { return t; },
    writable: true,
    configurable: true
  });
}

applyKairoTmp();

module.exports = {
  getKairoTmp: resolveKairoTmp,
  applyKairoTmp,
  KAIRO_TMP: resolveKairoTmp()
};
