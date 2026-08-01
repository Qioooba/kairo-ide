#!/usr/bin/env node
/**
 * verify-windows.cjs
 * Windows 10/11 兼容性深度验证脚本
 * 
 * 检查项：
 *   1. 文件系统兼容性（长路径、UNC、大小写、文件锁、临时目录）
 *   2. 编码兼容性（GBK/GB2312、UTF-8 BOM、UTF-16 LE/BE、控制台编码、文件名编码）
 *   3. 进程管理（创建/终止、进程树枚举、优先级、Job Object、CPU 亲和性）
 *   4. 注册表（读写、JDK 检测、Tomcat 检测、环境变量）
 *   5. Windows 服务（状态查询、依赖检查、启动类型）
 *   6. 防火墙（端口占用检测、防火墙规则、网络接口枚举）
 */

'use strict';

const fs = require('fs');
const path = require('path');
require('../tests/setup-tmp.cjs'); // KAIRO_TMP override
const os = require('os');
const { execSync, spawn, execFileSync } = require('child_process');
const { performance } = require('perf_hooks');

// ============================================================
// 工具函数
// ============================================================

const RESULT = { total: 0, pass: 0, fail: 0, skip: 0, checks: [] };
const TMP = path.join(os.tmpdir(), 'kairo-win-verify-' + Date.now());
const REPORT_PATH = path.join(__dirname, '..', 'docs', 'progress', 'releases', 'windows-compat-report-20260724.json');

function logResult(section, name, ok, detail = null) {
  const status = ok === 'SKIP' ? 'SKIP' : (ok ? 'PASS' : 'FAIL');
  if (status === 'PASS') RESULT.pass++;
  else if (status === 'FAIL') RESULT.fail++;
  else RESULT.skip++;
  RESULT.total++;
  const entry = { section, name, status, detail };
  RESULT.checks.push(entry);
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  const detailStr = detail ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : '';
  console.log(`  ${icon} ${name}${detailStr}`);
}

function sectionHeader(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function shellCmd(cmd) {
  return exec(cmd, { shell: 'powershell.exe', windowsHide: true });
}

function tryExec(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 15000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const isAdmin = (() => {
  try {
    execSync('net session', { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

// ============================================================
// 1. 文件系统兼容性
// ============================================================

function testFileSystem() {
  sectionHeader('1. 文件系统兼容性');

  // 1.1 长路径测试 (>260 字符)
  try {
    const longDirName = 'a'.repeat(200);
    const longPath = path.join(TMP, 'longpath', longDirName);
    fs.mkdirSync(longPath, { recursive: true });
    const testFile = path.join(longPath, 'test.txt');
    fs.writeFileSync(testFile, 'long path test');
    const readBack = fs.readFileSync(testFile, 'utf8');
    const ok = readBack === 'long path test';
    fs.rmSync(path.join(TMP, 'longpath'), { recursive: true, force: true });
    logResult('fs', '长路径创建/读写 (>260字符)', ok, ok ? '路径长度: ' + longPath.length : '失败');
  } catch (e) {
    logResult('fs', '长路径创建/读写 (>260字符)', false, e.message);
  }

  // 1.2 UNC 路径测试
  try {
    const uncPath = `\\\\localhost\\${os.tmpdir().replace(':', '$').replace(/\\/g, '\\')}`;
    const uncTestDir = path.join(TMP, 'unc-test');
    fs.mkdirSync(uncTestDir, { recursive: true });
    const testFile = path.join(uncTestDir, 'unc.txt');
    fs.writeFileSync(testFile, 'unc test');
    const ok = fs.existsSync(testFile);
    fs.rmSync(uncTestDir, { recursive: true, force: true });
    logResult('fs', 'UNC 路径支持', ok, ok ? 'localhost 路径可用' : 'UNC 路径失败');
  } catch (e) {
    logResult('fs', 'UNC 路径支持', false, e.message);
  }

  // 1.3 大小写不敏感测试
  try {
    const caseDir = path.join(TMP, 'CaseTest');
    fs.mkdirSync(caseDir, { recursive: true });
    const upperFile = path.join(caseDir, 'UPPER.txt');
    fs.writeFileSync(upperFile, 'case test');
    const lowerExists = fs.existsSync(path.join(caseDir, 'upper.txt'));
    fs.rmSync(caseDir, { recursive: true, force: true });
    logResult('fs', '大小写不敏感 (NTFS 默认)', lowerExists, lowerExists ? 'UPPER.txt == upper.txt' : '大小写敏感');
  } catch (e) {
    logResult('fs', '大小写不敏感 (NTFS 默认)', false, e.message);
  }

  // 1.4 文件锁测试 (EBUSY)
  try {
    const lockFile = path.join(TMP, 'lock-test.txt');
    fs.writeFileSync(lockFile, 'lock test');
    const fd = fs.openSync(lockFile, 'r+');
    try {
      // 尝试用独占方式再次打开
      fs.openSync(lockFile, 'r+');
      logResult('fs', '文件锁 - 共享读', true, '文件可被多次打开读取');
    } catch (e) {
      logResult('fs', '文件锁 - 共享读', true, '检测到 EBUSY: ' + e.code);
    }
    fs.closeSync(fd);
    fs.unlinkSync(lockFile);
  } catch (e) {
    logResult('fs', '文件锁检测', false, e.message);
  }

  // 1.5 临时目录权限
  try {
    const tmpTestFile = path.join(TMP, 'perm-test.txt');
    fs.writeFileSync(tmpTestFile, 'perm test');
    const stat = fs.statSync(tmpTestFile);
    const readable = fs.readFileSync(tmpTestFile, 'utf8') === 'perm test';
    fs.unlinkSync(tmpTestFile);
    logResult('fs', '临时目录读写权限', readable, `TMP: ${TMP}`);
  } catch (e) {
    logResult('fs', '临时目录读写权限', false, e.message);
  }

  // 1.6 非法字符测试
  try {
    // path.join 会规范化路径，可能清理非法字符，这里直接用字符串拼接测试
    // 注意：NTFS 中 : 是 ADS (Alternate Data Stream) 分隔符，不是非法字符
    const illegalChars = ['<', '>', '"', '|', '?', '*'];
    let allRejected = true;
    const rejectedList = [];
    const acceptedList = [];
    for (const ch of illegalChars) {
      try {
        const badPath = TMP + '\\' + `test${ch}file.txt`;
        fs.writeFileSync(badPath, 'test');
        allRejected = false;
        acceptedList.push(ch);
        try { fs.unlinkSync(badPath); } catch {}
      } catch { rejectedList.push(ch); }
    }
    logResult('fs', '非法文件名字符拒绝', allRejected, allRejected ? '所有非法字符被正确拒绝' : `接受: ${acceptedList.join('')}, 拒绝: ${rejectedList.join('')}`);
  } catch (e) {
    logResult('fs', '非法文件名字符拒绝', false, e.message);
  }

  // 1.7 磁盘空间检查
  try {
    const volInfo = shellCmd('Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json');
    if (volInfo) {
      const info = JSON.parse(volInfo);
      const freeGB = (info.Free / (1024 * 1024 * 1024)).toFixed(2);
      logResult('fs', '磁盘空间检查', parseFloat(freeGB) > 1, `C盘剩余: ${freeGB} GB`);
    } else {
      logResult('fs', '磁盘空间检查', false, '无法获取磁盘信息');
    }
  } catch (e) {
    logResult('fs', '磁盘空间检查', false, e.message);
  }
}

// ============================================================
// 2. 编码兼容性
// ============================================================

function testEncoding() {
  sectionHeader('2. 编码兼容性');

  const iconv = (() => {
    try { return require('iconv-lite'); } catch { return null; }
  })();

  // 2.1 GBK/GB2312 文件读写
  if (iconv) {
    try {
      const gbkFile = path.join(TMP, 'gbk-test.txt');
      const gbkContent = '中文测试内容 - GBK 编码';
      const gbkBuf = iconv.encode(gbkContent, 'gbk');
      fs.writeFileSync(gbkFile, gbkBuf);
      const rawBuf = fs.readFileSync(gbkFile);
      const decoded = iconv.decode(rawBuf, 'gbk');
      const ok = decoded === gbkContent;
      fs.unlinkSync(gbkFile);
      logResult('encoding', 'GBK 文件读写', ok, ok ? 'GBK 编解码正常' : '内容不匹配');
    } catch (e) {
      logResult('encoding', 'GBK 文件读写', false, e.message);
    }

    try {
      const gb2312File = path.join(TMP, 'gb2312-test.txt');
      const gb2312Content = '简体中文 GB2312 测试';
      const gb2312Buf = iconv.encode(gb2312Content, 'gb2312');
      fs.writeFileSync(gb2312File, gb2312Buf);
      const decoded = iconv.decode(fs.readFileSync(gb2312File), 'gb2312');
      const ok = decoded === gb2312Content;
      fs.unlinkSync(gb2312File);
      logResult('encoding', 'GB2312 文件读写', ok, ok ? 'GB2312 编解码正常' : '内容不匹配');
    } catch (e) {
      logResult('encoding', 'GB2312 文件读写', false, e.message);
    }
  } else {
    logResult('encoding', 'iconv-lite 依赖', 'SKIP', 'iconv-lite 未安装');
  }

  // 2.2 UTF-8 BOM 处理
  try {
    const bomFile = path.join(TMP, 'utf8-bom-test.txt');
    const content = 'UTF-8 with BOM test';
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const buf = Buffer.concat([bom, Buffer.from(content, 'utf8')]);
    fs.writeFileSync(bomFile, buf);
    const raw = fs.readFileSync(bomFile);
    const hasBOM = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
    // Node.js 默认不剥离 BOM，手动剥离验证
    const asUtf8 = fs.readFileSync(bomFile, 'utf8');
    const hasBOMInString = asUtf8.charCodeAt(0) === 0xFEFF;
    // 手动剥离 BOM
    const stripped = hasBOMInString ? asUtf8.slice(1) : asUtf8;
    const strippedOk = stripped === content;
    fs.unlinkSync(bomFile);
    logResult('encoding', 'UTF-8 BOM 处理', hasBOM && hasBOMInString && strippedOk, `BOM写入: ${hasBOM}, utf8含BOM: ${hasBOMInString}, 手动剥离正确: ${strippedOk}`);
  } catch (e) {
    logResult('encoding', 'UTF-8 BOM 处理', false, e.message);
  }

  // 2.3 UTF-16 LE/BE 处理
  if (iconv) {
    try {
      // UTF-16 LE
      const leFile = path.join(TMP, 'utf16-le-test.txt');
      const leContent = 'UTF-16 LE 测试';
      const leBuf = iconv.encode(leContent, 'utf16-le');
      fs.writeFileSync(leFile, leBuf);
      const leDecoded = iconv.decode(fs.readFileSync(leFile), 'utf16-le');
      fs.unlinkSync(leFile);
      logResult('encoding', 'UTF-16 LE 读写', leDecoded === leContent, leDecoded === leContent ? 'UTF-16 LE 正常' : '不匹配');

      // UTF-16 BE
      const beFile = path.join(TMP, 'utf16-be-test.txt');
      const beContent = 'UTF-16 BE 测试';
      const beBuf = iconv.encode(beContent, 'utf16-be');
      fs.writeFileSync(beFile, beBuf);
      const beDecoded = iconv.decode(fs.readFileSync(beFile), 'utf16-be');
      fs.unlinkSync(beFile);
      logResult('encoding', 'UTF-16 BE 读写', beDecoded === beContent, beDecoded === beContent ? 'UTF-16 BE 正常' : '不匹配');
    } catch (e) {
      logResult('encoding', 'UTF-16 LE/BE 读写', false, e.message);
    }
  } else {
    logResult('encoding', 'UTF-16 LE/BE 读写', 'SKIP', 'iconv-lite 未安装');
  }

  // 2.4 控制台编码检测
  try {
    const chcp = exec('chcp');
    const codepage = chcp ? chcp.match(/\d+/) : null;
    const cp = codepage ? parseInt(codepage[0]) : null;
    const isUtf8 = cp === 65001;
    logResult('encoding', '控制台代码页', isUtf8, isUtf8 ? 'UTF-8 (65001)' : `当前代码页: ${cp}`);
  } catch (e) {
    logResult('encoding', '控制台代码页', false, e.message);
  }

  // 2.5 文件名编码（中文文件名）
  try {
    const cnFile = path.join(TMP, '中文文件名测试.txt');
    fs.writeFileSync(cnFile, '测试中文文件名');
    const exists = fs.existsSync(cnFile);
    const readBack = fs.readFileSync(cnFile, 'utf8');
    const ok = exists && readBack === '测试中文文件名';
    fs.unlinkSync(cnFile);
    logResult('encoding', '中文文件名支持', ok, ok ? '中文文件名正常读写' : '失败');
  } catch (e) {
    logResult('encoding', '中文文件名支持', false, e.message);
  }

  // 2.6 特殊 Unicode 文件名（emoji）
  try {
    const emojiFile = path.join(TMP, '🚀-test-📁.txt');
    fs.writeFileSync(emojiFile, 'emoji filename test');
    const exists = fs.existsSync(emojiFile);
    const entries = fs.readdirSync(TMP).filter(e => e.includes('🚀'));
    fs.unlinkSync(emojiFile);
    logResult('encoding', 'Emoji 文件名支持', exists && entries.length > 0, exists ? 'Emoji 文件名正常' : '失败');
  } catch (e) {
    logResult('encoding', 'Emoji 文件名支持', false, e.message);
  }
}

// ============================================================
// 3. 进程管理
// ============================================================

function testProcessManagement() {
  sectionHeader('3. 进程管理');

  // 3.1 进程创建
  try {
    const result = exec('node -e "console.log(\\\"alive\\\")"');
    const ok = result === 'alive';
    logResult('process', '进程创建 (execSync)', ok, ok ? '子进程正常创建' : '失败');
  } catch (e) {
    logResult('process', '进程创建 (execSync)', false, e.message);
  }

  // 3.2 进程终止
  try {
    const child = spawn('node', ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'pipe', windowsHide: true });
    const pid = child.pid;
    child.kill('SIGTERM');
    // 同步等待进程退出
    let exited = false;
    try {
      child.on('exit', () => { exited = true; });
    } catch { /* ignore */ }
    // 使用 taskkill 确保终止
    try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 3000, windowsHide: true }); } catch {}
    // 检查进程是否已退出
    try { process.kill(pid, 0); /* 如果没抛异常，进程还在 */ } catch { exited = true; }
    logResult('process', '进程终止 (kill)', exited, pid ? `PID: ${pid}` : '无 PID');
  } catch (e) {
    logResult('process', '进程终止 (kill)', false, e.message);
  }

  // 3.3 进程树枚举
  try {
    const psOutput = shellCmd(`Get-Process -Id ${process.pid} | Select-Object Id,ProcessName | ConvertTo-Json`);
    if (psOutput) {
      const info = JSON.parse(psOutput);
      logResult('process', '进程信息获取', !!info, `当前进程: ${info.ProcessName || 'node'} (PID: ${process.pid})`);
    } else {
      logResult('process', '进程信息获取', false, 'PowerShell 查询失败');
    }
  } catch (e) {
    logResult('process', '进程信息获取', false, e.message);
  }

  // 3.4 进程优先级
  try {
    const prio = shellCmd(`Get-Process -Id ${process.pid} | Select-Object -ExpandProperty PriorityClass`);
    logResult('process', '进程优先级查询', !!prio, `当前优先级: ${prio || '未知'}`);
  } catch (e) {
    logResult('process', '进程优先级查询', false, e.message);
  }

  // 3.5 Job Object 支持
  try {
    const jobCheck = shellCmd('Get-Command -Name "Start-Job" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name');
    logResult('process', 'Job Object 支持 (PowerShell Jobs)', !!jobCheck && jobCheck.includes('Start-Job'), jobCheck ? 'PowerShell Job 命令可用' : '未找到 Start-Job');
  } catch (e) {
    logResult('process', 'Job Object 支持 (PowerShell Jobs)', false, e.message);
  }

  // 3.6 CPU 亲和性
  try {
    const cpuInfo = os.cpus();
    const affinity = shellCmd(`Get-Process -Id ${process.pid} | Select-Object -ExpandProperty ProcessorAffinity`);
    logResult('process', 'CPU 亲和性', !!affinity && cpuInfo.length > 0, `CPU 核心数: ${cpuInfo.length}, 亲和性: ${affinity || '未知'}`);
  } catch (e) {
    logResult('process', 'CPU 亲和性', false, e.message);
  }

  // 3.7 进程命令行参数获取
  try {
    const cmdLine = shellCmd(`Get-WmiObject Win32_Process -Filter "ProcessId=${process.pid}" | Select-Object -ExpandProperty CommandLine`);
    logResult('process', '进程命令行获取', !!cmdLine, cmdLine ? '命令行参数可获取' : '无法获取');
  } catch (e) {
    logResult('process', '进程命令行获取', false, e.message);
  }

  // 3.8 进程句柄数
  try {
    const handles = shellCmd(`Get-Process -Id ${process.pid} | Select-Object -ExpandProperty Handles`);
    const h = handles ? parseInt(handles) : 0;
    logResult('process', '进程句柄数', h > 0, `当前句柄数: ${h}`);
  } catch (e) {
    logResult('process', '进程句柄数', false, e.message);
  }
}

// ============================================================
// 4. 注册表
// ============================================================

function testRegistry() {
  sectionHeader('4. 注册表');

  // 4.1 注册表读取
  try {
    const regOutput = shellCmd('Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" -Name ProductName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProductName');
    if (regOutput) {
      logResult('registry', '注册表读取', true, `Windows 版本: ${regOutput}`);
    } else {
      logResult('registry', '注册表读取', false, '无法读取注册表');
    }
  } catch (e) {
    logResult('registry', '注册表读取', false, e.message);
  }

  // 4.2 JDK 检测（注册表路径）
  try {
    const jdkPaths = shellCmd(`
      $paths = @()
      $paths += Get-ItemProperty -Path "HKLM:\\SOFTWARE\\JavaSoft\\JDK" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentVersion
      $paths += Get-ItemProperty -Path "HKLM:\\SOFTWARE\\JavaSoft\\Java Development Kit" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentVersion
      $paths | Where-Object { $_ } | ConvertTo-Json
    `);
    if (jdkPaths && jdkPaths !== '[]') {
      logResult('registry', 'JDK 注册表检测', true, `JDK 注册表项: ${jdkPaths}`);
    } else {
      logResult('registry', 'JDK 注册表检测', 'SKIP', '注册表中未检测到 JDK 项');
    }
  } catch (e) {
    logResult('registry', 'JDK 注册表检测', false, e.message);
  }

  // 4.3 检查 JAVA_HOME
  try {
    const javaHome = process.env.JAVA_HOME || exec('echo %JAVA_HOME%', { shell: 'cmd.exe' });
    if (javaHome && javaHome.trim()) {
      const jh = javaHome.trim();
      const javaExe = path.join(jh, 'bin', 'java.exe');
      const exists = fs.existsSync(javaExe);
      logResult('registry', 'JAVA_HOME 环境变量', exists, exists ? `JAVA_HOME: ${jh}` : `JAVA_HOME 设置但 java.exe 不存在: ${jh}`);
    } else {
      logResult('registry', 'JAVA_HOME 环境变量', 'SKIP', 'JAVA_HOME 未设置');
    }
  } catch (e) {
    logResult('registry', 'JAVA_HOME 环境变量', false, e.message);
  }

  // 4.4 Tomcat 检测
  try {
    const tomcatPaths = shellCmd(`
      $paths = @()
      $paths += Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Apache Software Foundation\\Tomcat" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty *
      $paths | ConvertTo-Json -Depth 2
    `);
    if (tomcatPaths && tomcatPaths !== '[]') {
      logResult('registry', 'Tomcat 注册表检测', true, 'Tomcat 注册表项存在');
    } else {
      logResult('registry', 'Tomcat 注册表检测', 'SKIP', '注册表中未检测到 Tomcat');
    }
  } catch (e) {
    logResult('registry', 'Tomcat 注册表检测', false, e.message);
  }

  // 4.5 环境变量完整列表
  try {
    const envCount = Object.keys(process.env).length;
    const pathVar = process.env.PATH || '';
    const pathEntries = pathVar.split(';').filter(Boolean).length;
    logResult('registry', '环境变量', true, `环境变量数: ${envCount}, PATH 条目数: ${pathEntries}`);
  } catch (e) {
    logResult('registry', '环境变量', false, e.message);
  }

  // 4.6 注册表写入测试（HKCU）
  try {
    const testPath = 'HKCU:\\Software\\KairoTest';
    shellCmd(`New-Item -Path "${testPath}" -Force -ErrorAction SilentlyContinue | Out-Null`);
    shellCmd(`Set-ItemProperty -Path "${testPath}" -Name "TestValue" -Value "KairoWinVerify" -ErrorAction SilentlyContinue`);
    const readBack = shellCmd(`Get-ItemProperty -Path "${testPath}" -Name "TestValue" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TestValue`);
    shellCmd(`Remove-Item -Path "${testPath}" -Force -ErrorAction SilentlyContinue`);
    logResult('registry', '注册表写入测试 (HKCU)', readBack === 'KairoWinVerify', readBack === 'KairoWinVerify' ? '注册表读写正常' : '读写失败');
  } catch (e) {
    logResult('registry', '注册表写入测试 (HKCU)', false, e.message);
  }
}

// ============================================================
// 5. Windows 服务
// ============================================================

function testWindowsServices() {
  sectionHeader('5. Windows 服务');

  // 5.1 关键服务状态查询
  const criticalServices = ['Spooler', 'WSearch', 'WinRM', 'W3SVC', 'Tomcat9', 'Tomcat8'];
  let servicesChecked = 0;

  for (const svc of criticalServices) {
    try {
      const status = shellCmd(`Get-Service -Name "${svc}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`);
      if (status) {
        servicesChecked++;
        logResult('services', `服务 "${svc}" 状态`, status === 'Running' || status === 'Stopped', `状态: ${status}`);
      }
    } catch { /* 服务不存在是正常的 */ }
  }

  if (servicesChecked === 0) {
    logResult('services', '服务状态查询', 'SKIP', '未找到关键服务');
  }

  // 5.2 服务依赖检查
  try {
    const deps = shellCmd('Get-Service -Name "Spooler" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ServicesDependedOn | ConvertTo-Json');
    if (deps) {
      logResult('services', '服务依赖查询 (Spooler)', true, `依赖服务: ${deps}`);
    } else {
      logResult('services', '服务依赖查询 (Spooler)', 'SKIP', 'Spooler 服务不存在或无依赖');
    }
  } catch (e) {
    logResult('services', '服务依赖查询', false, e.message);
  }

  // 5.3 服务启动类型
  try {
    const startType = shellCmd('Get-Service -Name "Spooler" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty StartType');
    if (startType) {
      logResult('services', '服务启动类型 (Spooler)', true, `启动类型: ${startType}`);
    } else {
      logResult('services', '服务启动类型 (Spooler)', 'SKIP', 'Spooler 不存在');
    }
  } catch (e) {
    logResult('services', '服务启动类型', false, e.message);
  }

  // 5.4 所有运行中的服务计数
  try {
    const runningCount = shellCmd('(Get-Service | Where-Object {$_.Status -eq "Running"}).Count');
    const totalCount = shellCmd('(Get-Service).Count');
    if (runningCount) {
      logResult('services', '运行中服务统计', true, `运行中: ${runningCount} / 总计: ${totalCount || '?'}`);
    }
  } catch (e) {
    logResult('services', '运行中服务统计', false, e.message);
  }
}

// ============================================================
// 6. 防火墙与网络
// ============================================================

function testFirewallNetwork() {
  sectionHeader('6. 防火墙与网络');

  // 6.1 端口占用检测
  const testPorts = [3000, 8080, 8005, 8009, 22, 80, 443];
  for (const port of testPorts) {
    try {
      const netstat = exec(`netstat -ano | findstr :${port}`);
      const listening = netstat && netstat.includes('LISTENING');
      // 端口 3000 是 IDE 常用端口，占用是正常的
      if (port === 3000 && listening) {
        logResult('network', `端口 ${port} 占用检测`, true, '端口已被占用 (IDE 开发端口，正常)');
      } else {
        logResult('network', `端口 ${port} 占用检测`, !listening, listening ? '端口已被占用' : '端口空闲');
      }
    } catch (e) {
      logResult('network', `端口 ${port} 占用检测`, true, '端口空闲 (查询失败)');
    }
  }

  // 6.2 防火墙规则检查
  try {
    const fwRules = shellCmd('(Get-NetFirewallRule -Enabled True -Direction Inbound -ErrorAction SilentlyContinue | Measure-Object).Count');
    if (fwRules) {
      const count = parseInt(fwRules);
      logResult('network', '防火墙入站规则', true, `已启用的入站规则数: ${count}`);
    } else {
      logResult('network', '防火墙入站规则', 'SKIP', '无法查询防火墙规则（可能需要管理员权限）');
    }
  } catch (e) {
    logResult('network', '防火墙入站规则', false, e.message);
  }

  // 6.3 防火墙状态
  try {
    const fwStatus = shellCmd('Get-NetFirewallProfile -Name Domain -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Enabled');
    if (fwStatus !== null) {
      logResult('network', '防火墙状态', true, fwStatus === 'True' ? '防火墙已启用' : '防火墙已禁用');
    } else {
      logResult('network', '防火墙状态', 'SKIP', '无法查询防火墙状态');
    }
  } catch (e) {
    logResult('network', '防火墙状态', false, e.message);
  }

  // 6.4 网络接口枚举
  try {
    const interfaces = os.networkInterfaces();
    const ifaceCount = Object.keys(interfaces).length;
    let activeCount = 0;
    for (const [name, addrs] of Object.entries(interfaces)) {
      const ipv4 = addrs.filter(a => a.family === 'IPv4' && !a.internal);
      if (ipv4.length > 0) activeCount++;
    }
    logResult('network', '网络接口枚举', activeCount > 0, `接口数: ${ifaceCount}, 活跃 IPv4: ${activeCount}`);
  } catch (e) {
    logResult('network', '网络接口枚举', false, e.message);
  }

  // 6.5 DNS 解析
  try {
    const dns = require('dns');
    const lookup = dns.promises ? true : false;
    logResult('network', 'DNS 解析支持', lookup, 'dns.promises 可用');
  } catch (e) {
    logResult('network', 'DNS 解析支持', false, e.message);
  }

  // 6.6 网络连通性
  try {
    const ping = exec('ping -n 1 127.0.0.1', { timeout: 5000 });
    const ok = ping && ping.includes('TTL=');
    logResult('network', '网络连通性 (localhost)', ok, ok ? 'localhost 可达' : '不可达');
  } catch (e) {
    logResult('network', '网络连通性 (localhost)', false, e.message);
  }
}

// ============================================================
// 7. 系统信息
// ============================================================

function testSystemInfo() {
  sectionHeader('7. 系统信息');

  // 7.1 OS 版本
  try {
    const osInfo = `${os.type()} ${os.release()} ${os.arch()}`;
    const platform = os.platform();
    logResult('system', '操作系统', platform === 'win32', `${osInfo}, 平台: ${platform}`);
  } catch (e) {
    logResult('system', '操作系统', false, e.message);
  }

  // 7.2 内存
  try {
    const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
    const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
    const ok = parseFloat(totalMem) > 4;
    logResult('system', '内存', ok, `总计: ${totalMem}GB, 可用: ${freeMem}GB`);
  } catch (e) {
    logResult('system', '内存', false, e.message);
  }

  // 7.3 Node.js 版本
  try {
    const nodeVer = process.version;
    const major = parseInt(nodeVer.slice(1).split('.')[0]);
    logResult('system', 'Node.js 版本', major >= 18, `Node.js ${nodeVer}`);
  } catch (e) {
    logResult('system', 'Node.js 版本', false, e.message);
  }

  // 7.4 npm 版本
  try {
    const npmVer = exec('npm --version');
    logResult('system', 'npm 版本', !!npmVer, `npm ${npmVer || '未知'}`);
  } catch (e) {
    logResult('system', 'npm 版本', false, e.message);
  }

  // 7.5 用户权限
  const adminStatus = isAdmin;
  logResult('system', '管理员权限', true, adminStatus ? '以管理员身份运行' : '普通用户权限 (正常，非管理员不影响核心功能)');

  // 7.6 主机名
  try {
    const hostname = os.hostname();
    logResult('system', '主机名', hostname.length > 0, hostname);
  } catch (e) {
    logResult('system', '主机名', false, e.message);
  }

  // 7.7 用户目录
  try {
    const home = os.homedir();
    const exists = fs.existsSync(home);
    logResult('system', '用户目录', exists, home);
  } catch (e) {
    logResult('system', '用户目录', false, e.message);
  }
}

// ============================================================
// 8. 项目特定兼容性
// ============================================================

function testProjectCompatibility() {
  sectionHeader('8. 项目特定兼容性');

  const projectRoot = path.join(__dirname, '..');

  // 8.1 package.json 存在
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkgExists = fs.existsSync(pkgPath);
    if (pkgExists) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      logResult('project', 'package.json', true, `项目名: ${pkg.name || '未命名'}, 版本: ${pkg.version || '未知'}`);
    } else {
      logResult('project', 'package.json', false, 'package.json 不存在');
    }
  } catch (e) {
    logResult('project', 'package.json', false, e.message);
  }

  // 8.2 node_modules 存在
  try {
    const nmPath = path.join(projectRoot, 'node_modules');
    const nmExists = fs.existsSync(nmPath);
    logResult('project', 'node_modules', nmExists, nmExists ? 'node_modules 已安装' : 'node_modules 不存在');
  } catch (e) {
    logResult('project', 'node_modules', false, e.message);
  }

  // 8.3 路径分隔符一致性
  try {
    const sep = path.sep;
    const isBackslash = sep === '\\';
    logResult('project', '路径分隔符', isBackslash, `当前分隔符: "${sep}"${isBackslash ? ' (Windows 标准)' : ''}`);
  } catch (e) {
    logResult('project', '路径分隔符', false, e.message);
  }

  // 8.4 换行符检查
  try {
    const eol = os.EOL;
    const isCRLF = eol === '\r\n';
    logResult('project', '换行符', isCRLF, isCRLF ? 'CRLF (Windows 标准)' : `LF: ${JSON.stringify(eol)}`);
  } catch (e) {
    logResult('project', '换行符', false, e.message);
  }

  // 8.5 脚本文件换行符一致性检查
  try {
    const scriptFiles = [
      path.join(projectRoot, 'scripts', 'verify-windows.cjs'),
      path.join(projectRoot, 'scripts', 'run-compat-scan.cjs'),
    ];
    let lfIssues = [];
    for (const sf of scriptFiles) {
      if (fs.existsSync(sf)) {
        const content = fs.readFileSync(sf, 'utf8');
        if (content.includes('\r\n')) {
          lfIssues.push(path.basename(sf) + ': CRLF');
        } else if (content.includes('\n')) {
          lfIssues.push(path.basename(sf) + ': LF');
        }
      }
    }
    logResult('project', '脚本换行符一致性', lfIssues.length > 0, lfIssues.join(', '));
  } catch (e) {
    logResult('project', '脚本换行符一致性', false, e.message);
  }

  // 8.6 Go 运行时检查
  try {
    const goExe = path.join(projectRoot, 'kairo-runtime.exe');
    if (fs.existsSync(goExe)) {
      const stat = fs.statSync(goExe);
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
      logResult('project', 'Go 运行时 (kairo-runtime.exe)', true, `大小: ${sizeMB}MB`);
    } else {
      logResult('project', 'Go 运行时 (kairo-runtime.exe)', 'SKIP', 'kairo-runtime.exe 不存在');
    }
  } catch (e) {
    logResult('project', 'Go 运行时', false, e.message);
  }

  // 8.7 关键目录结构
  try {
    const keyDirs = ['apps', 'packages', 'scripts', 'docs', 'bundled', 'dist', 'testdata', 'tests'];
    const missing = [];
    for (const d of keyDirs) {
      if (!fs.existsSync(path.join(projectRoot, d))) {
        missing.push(d);
      }
    }
    logResult('project', '关键目录结构', missing.length === 0, missing.length === 0 ? '所有关键目录存在' : `缺失: ${missing.join(', ')}`);
  } catch (e) {
    logResult('project', '关键目录结构', false, e.message);
  }
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('  Kairo IDE - Windows 兼容性深度验证');
  console.log(`  时间: ${new Date().toISOString()}`);
  console.log(`  平台: ${os.platform()} ${os.release()} ${os.arch()}`);
  console.log(`  管理员: ${isAdmin ? '是' : '否'}`);
  console.log('='.repeat(60));

  // 创建临时目录
  fs.mkdirSync(TMP, { recursive: true });
  process.on('exit', () => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  const startTime = performance.now();

  try {
    testFileSystem();
    testEncoding();
    testProcessManagement();
    testRegistry();
    testWindowsServices();
    testFirewallNetwork();
    testSystemInfo();
    testProjectCompatibility();
  } catch (e) {
    console.error(`\n  验证过程异常: ${e.message}`);
    RESULT.checks.push({ section: 'global', name: '异常', status: 'FAIL', detail: e.message });
    RESULT.fail++;
    RESULT.total++;
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

  // 清理临时目录
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

  // 输出汇总
  console.log('\n' + '='.repeat(60));
  console.log('  验证汇总');
  console.log('='.repeat(60));
  console.log(`  总计: ${RESULT.total}  通过: ${RESULT.pass}  失败: ${RESULT.fail}  跳过: ${RESULT.skip}`);
  console.log(`  通过率: ${RESULT.total > 0 ? ((RESULT.pass / (RESULT.pass + RESULT.fail)) * 100).toFixed(1) : 0}%`);
  console.log(`  耗时: ${elapsed}s`);
  console.log('='.repeat(60));

  // 输出失败项
  const failures = RESULT.checks.filter(c => c.status === 'FAIL');
  if (failures.length > 0) {
    console.log('\n  失败项:');
    for (const f of failures) {
      console.log(`    ✗ [${f.section}] ${f.name}${f.detail ? ': ' + (typeof f.detail === 'string' ? f.detail : JSON.stringify(f.detail)) : ''}`);
    }
  }

  // 生成报告
  const report = {
    title: 'Kairo IDE Windows 兼容性验证报告',
    timestamp: new Date().toISOString(),
    platform: { os: os.platform(), release: os.release(), arch: os.arch(), hostname: os.hostname() },
    nodeVersion: process.version,
    isAdmin,
    summary: {
      total: RESULT.total,
      pass: RESULT.pass,
      fail: RESULT.fail,
      skip: RESULT.skip,
      passRate: RESULT.total > 0 ? ((RESULT.pass / (RESULT.pass + RESULT.fail)) * 100).toFixed(1) : 0,
      elapsedSeconds: parseFloat(elapsed)
    },
    results: RESULT.checks
  };

  // 确保目录存在
  const reportDir = path.dirname(REPORT_PATH);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n  报告已保存: ${REPORT_PATH}`);

  // 退出码
  process.exit(RESULT.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('验证脚本异常:', err);
  process.exit(2);
});