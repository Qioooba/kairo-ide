path = r'G:\spaces\kairo-ide\runtime-agent\internal\tomcat6\tomcat6.go'
with open(path, encoding='utf-8') as f:
    content = f.read()

func_start = content.find('func BuildCommand(cfg Config)')
func_end_marker = content.find('func buildEnv(')

# Find the opening {
brace_count = 0
func_body_start = -1
for i in range(func_start, len(content)):
    if content[i] == '{':
        brace_count += 1
        func_body_start = i + 1
        break

# The function ends at the matching closing }
brace_count = 0
func_body_end = -1
for i in range(func_body_start, len(content)):
    if content[i] == '{':
        brace_count += 1
    elif content[i] == '}':
        brace_count -= 1
        if brace_count == 0:
            func_body_end = i
            break

print(f'Function body: {func_body_start} to {func_body_end}')

new_body = '''
	if err := cfg.Validate(); err != nil {
		return "", nil, nil, err
	}

	java := filepath.Join(cfg.JavaHome, "bin", "java")
	if runtime.GOOS == "windows" {
		java += ".exe"
	}

	cp := BootstrapClasspath(cfg.CatalinaHome)
	classpathStr := strings.Join(cp, string(filepath.ListSeparator))

	// KAIRO-RC-WEB-2026-07-26: Tomcat 6 WebappClassLoader reflects
	// into java.base to clear ThreadLocals on undeploy. Java 9+
	// blocks that by default and the webapp reload crashes with
	// InaccessibleObjectException, leaving the HTTP listener up but
	// every request hanging on a half-loaded context. Auto-add the
	// --add-opens flags so the bundled tomcat6 still works on the
	// modern JDK that ships with our test environment. These are
	// no-op on Java 8, so always applying them is safe.
	addOpens := []string{
		"--add-opens=java.base/java.lang=ALL-UNNAMED",
		"--add-opens=java.base/java.util=ALL-UNNAMED",
		"--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
		"--add-opens=java.base/sun.security.x509=ALL-UNNAMED",
	}

	args = []string{
		"-classpath", classpathStr,
		"-Dcatalina.home=" + cfg.CatalinaHome,
		"-Dcatalina.base=" + cfg.CatalinaBase,
		"-Djava.util.logging.config.file=" + filepath.Join(cfg.CatalinaBase, "conf", "logging.properties"),
	}
	// KAIRO-ENCODING: Default to UTF-8, allow per-project override via Encoding field.
	encoding := cfg.Encoding
	if encoding == "" {
		encoding = "UTF-8"
	}
	args = append(args,
		"-Dfile.encoding="+encoding,
		"-Dsun.stdout.encoding="+encoding,
		"-Dsun.stderr.encoding="+encoding,
	)
	args = append(args, addOpens...)
	if cfg.DebugPort > 0 {
		suspend := "n"
		if cfg.DebugSuspend {
			suspend = "y"
		}
		args = append(args, fmt.Sprintf(
			"-agentlib:jdwp=transport=dt_socket,server=y,suspend=%s,address=127.0.0.1:%d",
			suspend, cfg.DebugPort,
		))
	}
	args = append(args, cfg.JVMOptions...)
	args = append(args, "org.apache.catalina.startup.Bootstrap", "start")

	env = buildEnv(cfg)
	return java, args, env, nil
'''

new_content = content[:func_start] + 'func BuildCommand(cfg Config) (executable string, args []string, env []string, err error) {' + new_body + content[func_body_end+1:]
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(new_content)
print('Done, written', len(new_content), 'chars')
