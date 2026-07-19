# bundled/

This directory holds the **off-line binaries** the Kairo IDE
needs at first launch — before the runtime agent has any
chance to download them itself. It is intended for
**offline / air-gapped** developer machines and for the
Windows release build pipeline.

## What's in here (after preparation)

```
bundled/
├── tomcat6/                # Apache Tomcat 6.0.53 (JDK 1.6 web container)
│   ├── bin/
│   ├── lib/
│   ├── conf/
│   └── ...
├── eclipse-jdt-ls/         # Eclipse JDT Language Server (Java 6+ support)
│   ├── plugins/
│   ├── config_linux|config_mac|config_win/
│   └── ...
└── .manifest.json          # tracks what was materialised + from where
```

## How it gets populated

A developer on a fresh checkout runs:

```powershell
pnpm bundled:prepare
# which is just:
#   pwsh scripts/prepare-bundled.ps1
```

The script materialises both directories. The resolution
order for each is:

| Variable                  | Used for | Fallback (Windows)                 |
|---------------------------|----------|------------------------------------|
| `KAIRO_TOMCAT6_HOME`      | Tomcat 6 | `E:\Apps\Tomcat6\apache-tomcat-6.0.53` |
| `KAIRO_JDT_LS_HOME`       | JDT LS   | `E:\Apps\eclipse-jdt-ls`               |

For each target the script tries, in order:

1. **NTFS junction** (no admin required, zero copy)
2. **Symbolic link** (admin / Developer Mode required)
3. **Recursive copy** (last resort; large but always works)

Both targets are skipped if the destination already exists.
Use `-Force` to overwrite:

```powershell
pwsh scripts/prepare-bundled.ps1 -Force
```

## Automatic invocation

`apps/desktop/package.json`'s `prebuild` script invokes
`pnpm bundled:prepare` automatically before `pnpm build`,
`pnpm build:win`, `pnpm build:mac`, and `pnpm build:linux`.
CI / release builds rely on the env-var form
(`KAIRO_TOMCAT6_HOME` + `KAIRO_JDT_LS_HOME`) to avoid baking
local paths into the build.

## Manual fall-back

If you don't have a pre-installed Tomcat 6 / JDT LS and you
also don't have network access during preparation, you can
populate the directory by hand:

1. Download `apache-tomcat-6.0.53.tar.gz` from
   <https://archive.apache.org/dist/tomcat/tomcat-6/v6.0.53/bin/>
   and extract it into `bundled/tomcat6/`.
2. Download the latest JDT LS from
   <https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz>
   and extract it into `bundled/eclipse-jdt-ls/`.
3. Drop a `bundled/.manifest.json` (any JSON object — the
   agent only inspects `tomcat6.home` and `jdtls.home`).

The script is **idempotent**; re-running after manual
population is a no-op.

## Why is this directory empty in the repo?

Because the binaries are big (Tomcat 6 alone is ~10 MB, JDT
LS is ~50 MB) and licensing requires us to keep them as
runtime resources, not source. The script is the canonical
way to materialise them on each developer's machine.
