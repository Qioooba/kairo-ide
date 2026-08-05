const fs = require('fs');
const path = require('path');

const projectPath = path.join(__dirname, '..', '..', 'test-workspace', 'gbk-legacy-project');

const gbkJavaContent = [
'package com.example;',
'',
'import java.io.IOException;',
'import java.util.Date;',
'import javax.servlet.ServletException;',
'import javax.servlet.http.HttpServlet;',
'import javax.servlet.http.HttpServletRequest;',
'import javax.servlet.http.HttpServletResponse;',
'',
'/**',
' * 中文注释测试类 - GBK编码',
' * 这是一个用于测试Kairo IDE GBK编码支持的Servlet',
' * 功能说明：处理用户问候请求，返回中文页面',
' * 创建日期：2026年7月27日',
' */',
'public class GbkTestServlet extends HttpServlet {',
'',
'    private static final long serialVersionUID = 1L;',
'',
'    /**',
'     * 处理GET请求',
'     * @param req 请求对象 - 包含用户参数',
'     * @param resp 响应对象 - 输出HTML页面',
'     */',
'    @Override',
'    protected void doGet(HttpServletRequest req, HttpServletResponse resp)',
'            throws ServletException, IOException {',
'        // 获取用户名参数',
'        String userName = req.getParameter("name");',
'        if (userName == null || userName.isEmpty()) {',
'            userName = "访客";',
'        }',
'',
'        // 设置响应编码为GBK',
'        resp.setContentType("text/html; charset=GBK");',
'        resp.setCharacterEncoding("GBK");',
'',
'        // 输出HTML页面',
'        resp.getWriter().println("<!DOCTYPE html>");',
'        resp.getWriter().println("<html>");',
'        resp.getWriter().println("<head><title>中文测试页面</title></head>");',
'        resp.getWriter().println("<body>");',
'        resp.getWriter().println("<h1>你好，" + userName + "！</h1>");',
'        resp.getWriter().println("<p>当前时间：" + new Date() + "</p>");',
'        resp.getWriter().println("<p>这是一个GBK编码的测试页面，用于验证Kairo IDE的中文支持。</p>");',
'        resp.getWriter().println("<ul>");',
'        resp.getWriter().println("<li>项目：传统Java Web项目</li>");',
'        resp.getWriter().println("<li>JDK版本：1.6</li>");',
'        resp.getWriter().println("<li>服务器：Tomcat 6.0</li>");',
'        resp.getWriter().println("<li>编码：GBK</li>");',
'        resp.getWriter().println("</ul>");',
'        resp.getWriter().println("</body>");',
'        resp.getWriter().println("</html>");',
'    }',
'}',
''
].join('\r\n');

const buildXmlContent = [
'<?xml version="1.0" encoding="GBK"?>',
'<project name="GBK测试项目" default="war" basedir=".">',
'    <description>这是一个GBK编码的Ant构建文件</description>',
'',
'    <property name="src.dir" value="src"/>',
'    <property name="web.dir" value="WebRoot"/>',
'    <property name="build.dir" value="WebRoot/WEB-INF/classes"/>',
'    <property name="lib.dir" value="WebRoot/WEB-INF/lib"/>',
'    <property name="dist.dir" value="dist"/>',
'',
'    <path id="classpath">',
'        <fileset dir="WebRoot/WEB-INF/lib" includes="*.jar"/>',
'    </path>',
'',
'    <target name="init">',
'        <mkdir dir="WebRoot/WEB-INF/classes"/>',
'        <mkdir dir="dist"/>',
'    </target>',
'',
'    <target name="clean" description="清理编译输出">',
'        <delete dir="WebRoot/WEB-INF/classes"/>',
'        <delete dir="dist"/>',
'    </target>',
'',
'    <target name="compile" depends="init" description="编译Java源代码">',
'        <javac srcdir="src" destdir="WebRoot/WEB-INF/classes"',
'               encoding="GBK" source="1.6" target="1.6" debug="true">',
'            <classpath refid="classpath"/>',
'        </javac>',
'    </target>',
'',
'    <target name="war" depends="compile" description="打包WAR文件">',
'        <war destfile="dist/gbk-test.war" webxml="WebRoot/WEB-INF/web.xml">',
'            <fileset dir="WebRoot"/>',
'            <lib dir="WebRoot/WEB-INF/lib"/>',
'            <classes dir="WebRoot/WEB-INF/classes"/>',
'        </war>',
'    </target>',
'</project>',
''
].join('\r\n');

const webXmlContent = [
'<?xml version="1.0" encoding="GBK"?>',
'<web-app xmlns="http://java.sun.com/xml/ns/javaee"',
'         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
'         xsi:schemaLocation="http://java.sun.com/xml/ns/javaee http://java.sun.com/xml/ns/javaee/web-app_2_5.xsd"',
'         version="2.5">',
'',
'    <display-name>GBK编码测试项目</display-name>',
'    <description>用于测试Kairo IDE GBK支持的Web应用</description>',
'',
'    <servlet>',
'        <servlet-name>GbkTestServlet</servlet-name>',
'        <servlet-class>com.example.GbkTestServlet</servlet-class>',
'    </servlet>',
'',
'    <servlet-mapping>',
'        <servlet-name>GbkTestServlet</servlet-name>',
'        <url-pattern>/hello</url-pattern>',
'    </servlet-mapping>',
'',
'    <welcome-file-list>',
'        <welcome-file>index.jsp</welcome-file>',
'    </welcome-file-list>',
'</web-app>',
''
].join('\r\n');

const indexJspContent = [
'<%@ page language="java" contentType="text/html; charset=GBK" pageEncoding="GBK"%>',
'<!DOCTYPE html>',
'<html>',
'<head>',
'    <title>首页 - GBK测试</title>',
'</head>',
'<body>',
'    <h1>欢迎来到GBK测试项目</h1>',
'    <p>这是首页，用于验证JSP页面的GBK编码支持。</p>',
'    <ul>',
'        <li><a href="hello?name=张三">张三的问候页面</a></li>',
'        <li><a href="hello?name=李四">李四的问候页面</a></li>',
'        <li><a href="hello?name=Kairo">Kairo IDE测试</a></li>',
'    </ul>',
'    <hr/>',
'    <p>当前服务器时间：<%= new java.util.Date() %></p>',
'</body>',
'</html>',
''
].join('\r\n');

function writeGBK(filePath, content) {
    try {
        const iconv = require('iconv-lite');
        const gbkBuf = iconv.encode(content, 'gbk');
        fs.writeFileSync(filePath, gbkBuf);
        console.log('Wrote (GBK via iconv-lite):', filePath);
    } catch (e) {
        console.log('iconv-lite not available, writing UTF-8 with note...');
        fs.writeFileSync(filePath, '\ufeff' + content, 'utf8');
        console.log('Wrote (UTF-8 BOM):', filePath, '(NOTE: install iconv-lite for true GBK)');
    }
}

// Ensure directories exist
fs.mkdirSync(path.join(projectPath, 'src', 'com', 'example'), { recursive: true });
fs.mkdirSync(path.join(projectPath, 'WebRoot', 'WEB-INF', 'lib'), { recursive: true });

// Write files
writeGBK(path.join(projectPath, 'src', 'com', 'example', 'GbkTestServlet.java'), gbkJavaContent);
writeGBK(path.join(projectPath, 'build.xml'), buildXmlContent);
writeGBK(path.join(projectPath, 'WebRoot', 'WEB-INF', 'web.xml'), webXmlContent);
writeGBK(path.join(projectPath, 'WebRoot', 'index.jsp'), indexJspContent);

// Copy servlet API jar
const libSrc = path.join(__dirname, '..', '..', 'legacy-sample', 'lib', 'javax.servlet-api-4.0.1.jar');
const libDest = path.join(projectPath, 'WebRoot', 'WEB-INF', 'lib', 'javax.servlet-api-4.0.1.jar');
if (fs.existsSync(libSrc)) {
    fs.copyFileSync(libSrc, libDest);
    console.log('Copied servlet-api.jar');
} else {
    console.log('servlet-api.jar not found at', libSrc);
}

console.log('GBK test project created at:', projectPath);
