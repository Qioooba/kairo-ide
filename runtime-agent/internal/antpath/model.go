package antpath

// BuildProject represents a parsed Ant build.xml file.
type BuildProject struct {
	Name       string
	Default    string
	Basedir    string
	Properties map[string]string
	Paths      map[string]*AntPath
	Imports    []Import
	Targets    map[string]*Target
	Warnings   []ResolveWarning
}

// AntPath represents an Ant <path id="..."> element.
type AntPath struct {
	ID       string
	Location []string
	Path     []string
	FileSets []FileSet
	PathRefs []string
}

// FileSet represents an Ant <fileset> element.
type FileSet struct {
	Dir      string
	Includes []string
	Excludes []string
}

// Import represents an Ant <import> element.
type Import struct {
	File     string
	Optional bool
}

// Target represents an Ant <target> element.
type Target struct {
	Name       string
	Depends    []string
	JavacTasks []JavacTask
}

// JavacTask represents an Ant <javac> task.
type JavacTask struct {
	SrcDir          string
	DestDir         string
	ClasspathRef    string
	Source          string
	Target          string
	InlineClasspath *AntPath
}

// ResolveResult is the output of classpath resolution.
type ResolveResult struct {
	Classpath   []string
	SourceRoots []string
	OutputDir   string
	WebInfLib   []string
	Warnings    []ResolveWarning
	Properties  map[string]string
}

// ResolveWarning represents a non-fatal issue during resolution.
type ResolveWarning struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
}