# Kairo Sample Project

A minimal Java Web project for Kairo IDE E2E testing.

## Project Structure

- `src/com/example/HelloServlet.java` — Simple Servlet (GBK encoded)
- `WebContent/WEB-INF/web.xml` — Standard web.xml (Servlet 2.5)
- `WebContent/index.jsp` — JSP with EL expressions (GBK encoded)
- `WebContent/css/style.css` — Simple stylesheet
- `build.xml` — Ant build file

## Build

```bash
ant build
```

## Deploy

Deploy the generated WAR file (`dist/sample.war`) to Tomcat 6.

## Test

```bash
curl http://localhost:8080/sample/hello?name=Kairo
```