path = r'G:\open-id\runtime-agent\irternal\tomcat6\tomcat6.go'
with open(path, encoding='utf-8') as f:
    lines = f.readlines()

addopens_close = -1
for i in range(100, min(len(lines), 500)):
    if 'addOpens := []string{' in lines[i]:
        for j in range(i+1, len(lines)):
            if lines[j].strip() == '}' and j > i:
                addopens_close = j
                break
        break

print(f"addOpens closes at line {addopens_close+1}")

start = -1
for i in range(addopens_close+1, min(len(lines), 600)):
    if 'args = []string{' in lines[i]:
        start = i
        break

end = -1
if start != -1:
    for i in range(start+1, len(lines)):
        if lines[i].strip() == '}':
            end = i
            break

print(f"args block: lines {start+1} to {end+1}")
for i in range(start, min(end+1, start+30)):
    print(f"  {i+1}: {repr(lines[i])}")

new_block = (
    '\targs = []string{\n'
    '\t\t"-classpath", classpathStr,\n'
'    '\t\t"-Dcatalina.home=\" + cfg.CatalinaHome,\n'
    '\t\t"-Dcatalina.base=\" + cfg.CatalinaBase,\n'
    '\t\t"-Djava.util.logging.config.file=\" + filepath.Join(cfg.CatalinaBase, "conf", "logging.properties"),\n'
    '\t}\n'
    '\t// KAIRO-ENCODING: Default to UTF-8, allow per-project override via Encoding field.\n'
    '\tencoding := cfg.Encoding\n'
    '\tif encoding == "" {\n'
    '\t\tencoding = "UTF-8"\n'
    '\t}\n'
    '\targs = append(args,\n'
    '\t\t"-Dfile.encoding=\"+encoding,\n'
    '\t\t"-Dsun.stdout.encoding=\"+encoding,\n'
    '\t\t"-Dsun.stderr.encoding=\"+encoding,\n'
    '\t)\n')

new_lines = lines[:start] + [new_block] + lines[end+1:]
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(new_lines)
print(f"Done, written {len(new_lines)} lines")
