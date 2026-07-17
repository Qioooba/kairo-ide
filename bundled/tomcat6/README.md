# bundled/tomcat6

Apache Tomcat 6 is **not** vendored in this repository. See
`BLOCKERS.md` (B-002) for the reason.

When a workspace is opened with `serverRuntime.type: tomcat6`,
the agent downloads `apache-tomcat-6.0.53.tar.gz` from the
Apache archive, verifies the SHA-256, and unpacks it here.

`scripts/fetch-tomcat6.sh` does this manually for users who
want to pre-stage the bundle.

## What is in this directory after fetch

```
bundled/tomcat6/
├── apache-tomcat-6.0.53/         # the actual install
├── apache-tomcat-6.0.53.tar.gz   # the verified tarball
├── LICENSE                        # copied from the tarball
└── NOTICE                         # copied from the tarball
```

## First-run notice

Tomcat 6 is end-of-life. The IDE shows a clear "this is a
development convenience; do not expose this server to
untrusted networks" notice the first time it is enabled per
workspace, and refuses to bind Manager / AJP / JMX / JDWP
ports to a non-loopback address.
