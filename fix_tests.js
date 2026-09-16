const fs = require('fs');
const path = 'G:/spaces/kairo-ide/runtime-agent/internal/tomcat6/tomcat6_test.go';
let content = fs.readFileSync(path, 'utf8');

// Fix single-quote string literals in Go code
// Python wrote strings with single-quotes where Go needs double-quotes

// strings.Join(args, ' ') -> strings.Join(args, " ")
content = content.split("strings.Join(args, ' ')").join('strings.Join(args, " ")');

// []string{'-Dfile.encoding=UTF-8', ... -> []string{"-Dfile.encoding=UTF-8", ...
content = content.split("'-Dfile.encoding=UTF-8'").join('"-Dfile.encoding=UTF-8"');
content = content.split("'-Dsun.stdout.encoding=UTF-8'").join('"-Dsun.stdout.encoding=UTF-8"');
content = content.split("'-Dsun.stderr.encoding=UTF-8'").join('"-Dsun.stderr.encoding=UTF-8"');

content = content.split("'-Dfile.encoding=GBK'").join('"-Dfile.encoding=GBK"');
content = content.split("'-Dsun.stdout.encoding=GBK'").join('"-Dsun.stdout.encoding=GBK"');
content = content.split("'-Dsun.stderr.encoding=GBK'").join('"-Dsun.stderr.encoding=GBK"');

// t.Errorf('expected %q... -> t.Errorf("expected %q...
content = content.split("t.Errorf('expected %q in args, got: %v', want, args)").join('t.Errorf("expected %q in args, got: %v", want, args)');

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed encoding tests');
