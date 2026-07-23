<%@ page language="java" contentType="text/html; charset=GBK" pageEncoding="GBK"%>
<!DOCTYPE html>
<html>
<head>
    <title>Kairo Sample Project</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <h1>欢迎使用 Kairo IDE</h1>
    <p>这是一个示例项目</p>
    <%
        String greeting = "Hello from JSP!";
        out.println("<p>" + greeting + "</p>");
    %>
    <p>EL 表达式测试: ${1 + 1}</p>
    <a href="hello?name=Kairo">访问 HelloServlet</a>
</body>
</html>