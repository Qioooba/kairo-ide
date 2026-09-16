path = r'G:\spaces\kairo-ide\runtime-agent\internal\tomcat6\tomcat6_test.go'
with open(path, encoding='utf-8') as f:
    content = f.read()

# Fix Python single-quote strings in Go code
# os.MkdirAll(filepath.Join(javaHome, 'bin'), 0755)
content = content.replace("os.MkdirAll(filepath.Join(javaHome, 'bin'), 0755)",
                          'os.MkdirAll(filepath.Join(javaHome, "bin"), 0755)')

# filepath.Join(base, 'webapps', 'ROOT')
content = content.replace("filepath.Join(base, 'webapps', 'ROOT')",
                          'filepath.Join(base, "webapps", "ROOT")')

# Encoding:     'GBK',
content = content.replace("Encoding:     'GBK',", 'Encoding:     "GBK",')

with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
print('Fixed quotes in encoding tests')
