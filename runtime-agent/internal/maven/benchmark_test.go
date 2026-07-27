package maven

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- pom.xml parsing benchmarks ---

func BenchmarkDetect(b *testing.B) {
	dir := b.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>test-app</artifactId>
  <version>1.0.0</version>
  <packaging>war</packaging>
  <name>Test Application</name>
  <description>A test Maven project</description>
  <dependencies>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>servlet-api</artifactId>
      <version>2.5</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
  <build>
    <directory>target</directory>
    <outputDirectory>target/classes</outputDirectory>
  </build>
</project>`
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(dir)
	}
}

func BenchmarkDetect_LargePOM(b *testing.B) {
	dir := b.TempDir()
	var deps []string
	for i := 0; i < 50; i++ {
		deps = append(deps, `    <dependency>
      <groupId>com.example</groupId>
      <artifactId>lib-`+string(rune('A'+i%26))+`</artifactId>
      <version>1.0.0</version>
      <scope>compile</scope>
    </dependency>`)
	}
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>large-app</artifactId>
  <version>1.0.0</version>
  <dependencies>
` + strings.Join(deps, "\n") + `
  </dependencies>
</project>`
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(dir)
	}
}

func BenchmarkDetect_NoPOM(b *testing.B) {
	dir := b.TempDir()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(dir)
	}
}

func BenchmarkXMLUnmarshal_POM(b *testing.B) {
	data := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>com.example</groupId>
  <artifactId>test-app</artifactId>
  <version>1.0.0</version>
  <packaging>war</packaging>
  <dependencies>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>javax.servlet</groupId>
      <artifactId>servlet-api</artifactId>
      <version>2.5</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>
</project>`)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var pom pomXML
		xml.Unmarshal(data, &pom)
	}
}

func BenchmarkDetectConflicts(b *testing.B) {
	deps := make([]Dependency, 50)
	for i := range deps {
		deps[i] = Dependency{
			GroupID:    "com.example",
			ArtifactID: "lib-" + string(rune('A'+i%26)),
			Version:    "1.0.0",
			Scope:      "compile",
		}
	}
	// Add some conflicts
	deps[0].Version = "1.0.0"
	deps[1] = Dependency{GroupID: "com.example", ArtifactID: "lib-A", Version: "2.0.0", Scope: "compile"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		DetectConflicts(deps)
	}
}

func BenchmarkBuildDependencyTree(b *testing.B) {
	deps := make([]Dependency, 100)
	for i := range deps {
		deps[i] = Dependency{
			GroupID:    "com.example",
			ArtifactID: "lib-" + string(rune('A'+i%26)),
			Version:    "1.0.0",
			Scope:      "compile",
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		buildDependencyTree(deps)
	}
}

func BenchmarkParseMavenDependencyTree(b *testing.B) {
	output := strings.Repeat(`[INFO] +- com.example:lib-A:jar:1.0.0:compile
[INFO] |  +- com.example:lib-B:jar:1.0.0:compile
[INFO] |  |  \- com.example:lib-C:jar:1.0.0:compile
[INFO] |  \- com.example:lib-D:jar:1.0.0:compile
`, 20)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		parseMavenDependencyTree(output)
	}
}

func BenchmarkGenerateEffectivePOM(b *testing.B) {
	dir := b.TempDir()
	pomContent := `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>parent</artifactId>
    <version>1.0.0</version>
  </parent>
  <artifactId>child</artifactId>
  <packaging>war</packaging>
  <properties>
    <java.version>1.8</java.version>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.8.1</version>
      </plugin>
    </plugins>
  </build>
</project>`
	os.WriteFile(filepath.Join(dir, "pom.xml"), []byte(pomContent), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		GenerateEffectivePOM(EffectivePOMRequest{RootPath: dir})
	}
}

func BenchmarkFindMaven_NoMaven(b *testing.B) {
	dir := b.TempDir()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		findMaven(dir)
	}
}

func BenchmarkIsExecutable(b *testing.B) {
	dir := b.TempDir()
	p := filepath.Join(dir, "test-file")
	os.WriteFile(p, []byte("content"), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		isExecutable(p)
	}
}

func BenchmarkUniqueStrings(b *testing.B) {
	input := []string{"a", "b", "c", "a", "b", "d", "e", "c", "f", "a", "g", "b", "h", "c", "i"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		uniqueStrings(input)
	}
}