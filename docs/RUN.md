# Run — Kairo IDE

How to run Kairo IDE in its three deployment forms.

## Form A — Desktop (Windows / macOS)

After installation, double-click the application icon, or:

```bash
# macOS
open /Applications/Kairo.app
# Windows
%LOCALAPPDATA%\Kairo\Kairo.exe
```

First run:

1. Kairo opens to the **Welcome** view.
2. Click **Open Folder** and pick your project root.
3. The **Project Import Wizard** runs a read-only scan and shows
   what it found. Adjust if needed, then **Continue**.
4. Pick a JDK (or click **Import JDK** to register a Java 6
   JDK). Pick a Tomcat (6.0.53 is bundled; you can also
   import your own).
5. Click **Open Workspace**.

The first time you run a project, the Runtime Agent
auto-downloads:

- A modern JRE (for JDT LS) — ~50 MB.
- Apache Tomcat 6.0.53 — ~10 MB.

Both are stored under `bundled/` inside the install directory
and are reused on subsequent runs.

## Form B — Localhost browser (Windows / macOS / Linux)

```bash
kairo-server --bind 127.0.0.1 --port 3000
```

Then open `http://localhost:3000` in Chrome, Edge, or Safari.

The server runs the Theia app and the Runtime Agent in the
same process. There is no auth in the localhost browser form
by default; pass `--require-auth` to require login even on
loopback.

## Form C — Remote Linux server

```bash
# On the server
kairo-server \
  --bind 10.0.1.50 \
  --port 443 \
  --tls-cert /etc/kairo/tls.crt \
  --tls-key  /etc/kairo/tls.key \
  --data-dir /var/lib/kairo \
  --audit-dir /var/log/kairo
```

On the client (Windows or macOS), open
`https://kairo.example.internal/` in Chrome. Log in with your
Kairo account.

The first user to log in becomes the **bootstrap admin**. That
admin creates other accounts.

## Server systemd unit (example)

```ini
# /etc/systemd/system/kairo.service
[Unit]
Description=Kairo IDE server
After=network.target

[Service]
Type=simple
User=kairo
Group=kairo
WorkingDirectory=/opt/kairo
ExecStart=/opt/kairo/bin/kairo-server \
  --bind 0.0.0.0 \
  --port 8443 \
  --tls-cert /etc/kairo/tls.crt \
  --tls-key /etc/kairo/tls.key \
  --data-dir /var/lib/kairo \
  --audit-dir /var/log/kairo
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/kairo /var/log/kairo /opt/kairo/bundled
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
```

## Environment variables (run time)

See `docs/BUILD.md` §"Environment variables". `KAIRO_RUNTIME_PORT`
and `KAIRO_RUNTIME_BIND` are the most common ones to set when
running the agent standalone.

## What's where on disk

```
install-root/
├── bin/                    # kairo-server, kairo-runtime, kairo-admin
├── lib/                    # Theia + extensions
├── bundled/
│   ├── tomcat6/            # downloaded on first use
│   ├── eclipse-jdt-ls/     # downloaded on first use
│   └── plugins/            # bundled LegacyFlow plugins
├── docs/                   # local copy of docs/
├── third-party-notices.txt
└── LICENSE
```

User state lives in `${KAIRO_USER_CONFIG_DIR}/`, e.g.:

- macOS: `~/Library/Application Support/Kairo/`
- Windows: `%APPDATA%\Kairo\`
- Linux:   `$XDG_CONFIG_HOME/kairo/`  (or `~/.config/kairo/`)

## Diagnostic center

Help → **Diagnostic Center** (or `Ctrl+Shift+D` then
**Generate bundle**) produces a tarball with:

- Last 1000 lines from each component's log.
- Workspace config (sanitized — secrets are stripped).
- OS, Go version, Node version, Java versions found.
- Disk usage, memory usage, open file count.

It does **not** contain source files, secrets, or `.env`
files. The user is told what was excluded before download.
