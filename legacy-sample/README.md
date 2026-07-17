# Kairo Legacy Sample

A small, complete legacy Java Web project used by the Kairo
IDE for E2E and integration testing. It is **not** a hello-world
toy; it covers the realistic quirks the IDE must handle:

- **GBK-encoded JSP** (`WebRoot/hello.jsp`).
- **UTF-8 JSP** (`WebRoot/utf8.jsp`).
- **ISO-8859-1 properties** with `\uXXXX` escapes
  (`src/main/resources/messages.properties`).
- **Java sources with Javadoc and Chinese in code**
  (`src/main/java/com/example/legacy/HelloServlet.java`).
- **Ant build** (`build.xml`).
- **Custom taglib** (`WebRoot/WEB-INF/tags/k.tld`,
  `WebRoot/WEB-INF/tags/hello.tag`).
- **Project config** in `.legacyflow/project.yaml`.

## Running with the Kairo IDE

1. Open the workspace at this folder in Kairo.
2. Import a JDK 6 toolchain via the wizard, or use
   `--release 6` emulation (the IDE will warn).
3. Start the server; the IDE picks Tomcat 6.0.53 and
   deploys to the configured `dist/webapp` directory.
4. Open `http://127.0.0.1:18080/kairo-sample/hello` in a browser.

## Compiling manually

```bash
cd legacy-sample
ant compile         # produces build/classes
ant package         # produces dist/webapp
```

## What the IDE should do

- Detect the Ant build, the `web.xml` location, the JSP
  encoding, and the resource path on first scan.
- Suggest ports that do not clash with the agent (18080).
- Preserve the GBK bytes in `hello.jsp` across save / load.
- Allow setting a breakpoint in `HelloServlet.doGet`,
  starting the server with JDWP, and stepping through the
  request.
