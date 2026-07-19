# W1 Hint — pnpm build:win @parcel/watcher node-gyp 失败

> 这是 orchestrator 给 W1 的加速 hint。W1 在
> `feature/windows-wave2-product-vertical-slice` 跑
> `pnpm --filter @kairo/desktop build:win` 时撞到
> `@parcel/watcher` 的 `node-gyp` rebuild 失败，缺
> Visual Studio Build Tools。W1 已经试 `npmRebuild:false` 但
> 还没 commit，估计在等重新 build 验证。

## 根因

`@electron/rebuild` 默认会**强制 rebuild** 所有含 native binding
的依赖到当前 Electron ABI。`@parcel/watcher@2.5.6` 有 prebuilt
binary，但 prebuilt 是 Node ABI 的，Electron ABI 匹配不上，所以
`@electron/rebuild` 试图从源码重 build → 触发 node-gyp → 缺
MSVC。

W1 加的 `build.npmRebuild: false` **应该** 关掉它。但 W1 还要
确认：

1. `build.npmRebuild: false` 在 electron-builder 25.1.8 是否
   真的生效（曾经有过 bug 报告说它只在某些路径生效）
2. `electron-builder install-app-deps` 也可能独立触发 rebuild

## 3 个修复方向（按推荐顺序）

### 方向 A：彻底跳过 native rebuild（推荐，最快）

`apps/desktop/electron-builder.yml` 或 `package.json#build`
加：

```yaml
npmRebuild: false
electronRebuild: false   # 旧字段别名，跟 npmRebuild 二选一
```

并且**`pnpm install` 加 `--ignore-scripts`** 跳过所有依赖的
install scripts（不只 rebuild）：

```bash
pnpm install --frozen-lockfile --ignore-scripts
```

如果 prebuilt binary 跟 Electron ABI 不匹配，运行时 parcel
watcher 报错 → 这时再考虑方向 B。

### 方向 B：装 Visual Studio Build Tools（重型，1-2GB）

用 winget：

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

需要管理员权限。你 user memory 写过 "winget 非管理员装桌面工具
常失败 -1978335230"，所以可能要管理员 PowerShell 跑。

代价：

- 1-2 GB 磁盘
- 5-10 分钟安装
- 需要重启 shell 让 cl.exe 进 PATH

如果方向 A 失败，方向 B 是最稳的"工业级"方案，但 Phase 0
不一定非走这条路。

### 方向 C：跳过 parcel/watcher，改用 chokidar 或 fs.watch

`apps/browser` 用 parcel watcher 是 dev-only（监听文件
变化）。production NSIS 包运行后**不需要** parcel watcher。
可以在 `apps/browser` 的 package.json 里把 parcel 改成
chokidar，或者直接禁掉 dev-mode 的 file watching。

代价：

- 改 dev 体验（但 Phase 0 只验 production build，不验 dev HMR）
- 1-2 小时改 + 测试

## W1 现在的最优路径

**W1 已经把 `npmRebuild: false` 加进 package.json 但还没
commit**。我建议：

1. 立即 commit 现在的 `npmRebuild: false` 改动（一个独立 commit
   "fix(desktop): disable electron-builder native module rebuild"）
2. 重跑 `pnpm --filter @kairo/desktop build:win`
3. 如果还是失败 → 试 `--ignore-scripts` 跑 pnpm install + 再 build
4. 如果还是失败 → 把失败原样写进 evidence，标记 **Phase 0
   partial**，把方向 B（装 VS Build Tools）作为下一轮前置
5. 不要反复重试超过 2 次同一路径

## 不要做的事

- 不要装 Visual Studio Build Tools 来"重试"（重型 + 需要管理员
  + 5-10 分钟，浪费 Phase 0 时间预算）
- 不要修改 pnpm-lock.yaml 重 resolve（这会动 §3.3 shared-risk
  `pnpm-lock.yaml`，触发越界）
- 不要 retry 同一个 `build:win` 命令超过 2 次没改任何配置

## 紧急决策点

如果方向 A 失败（最可能 5 分钟内见分晓），W1 应该：

- 标记 Phase 0 第 0.10 项 (NSIS package) 为 **partial**
- 保留失败证据到 `artifacts/windows-wave2/package/FAILURE.md`
- 把方向 B 写入 `WINDOWS_WAVE2_CONTRACT_REQUESTS.md` 作为一个
  新的**环境前置请求**（不归 Mac Core，归 Windows dev box）
- Phase 0 报告里诚实写 "NSIS build: blocked on Visual Studio
  Build Tools installation"，其他项继续

orchestrator 已经在看这个文件，W1 不需要等 hint。
