// Package services provides default in-memory + disk-backed
// implementations of the api service interfaces. The agent
// stores workspace, project, server, build, and deployment
// records on disk so they survive an agent restart.
//
// The runtime, search, encoding, build, and Tomcat 6 components
// are real (no mocks, no stubs). The server runner launches the
// real Apache Tomcat 6 Bootstrap via java -classpath.
package services
