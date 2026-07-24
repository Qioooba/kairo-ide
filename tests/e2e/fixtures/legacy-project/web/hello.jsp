<%@ page contentType="text/html;charset=GBK" language="java" %>
<%@ page import="java.util.*" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%
    // GBK编码的遗留JSP文件
    // 包含Scriptlet、EL表达式和TLD标签
    String title = "你好, 世界!";
    String[] colors = {"红色", "绿色", "蓝色", "黄色", "紫色"};
    List<String> colorList = java.util.Arrays.asList(colors);
    pageContext.setAttribute("colorList", colorList);
%>
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=GBK">
    <title><%= title %></title>
</head>
<body>
    <h1><%= title %></h1>
    <p>当前时间: <%= new Date() %></p>

    <h2>颜色列表</h2>
    <ul>
        <c:forEach var="color" items="${colorList}">
            <li>${color}</li>
        </c:forEach>
    </ul>

    <h2>请求信息</h2>
    <p>请求方法: <%= request.getMethod() %></p>
    <p>请求URI: <%= request.getRequestURI() %></p>
    <p>查询字符串: <c:out value="${pageContext.request.queryString}" default="(无)"/></p>

    <h2>中文测试</h2>
    <p>这是一段中文字符测试: 床前明月光，疑是地上霜。举头望明月，低头思故乡。</p>
    <p>特殊字符测试: ① ② ③ ④ ⑤ ★ ☆ ♠ ♣ ♥ ♦</p>

    <h2>会话信息</h2>
    <p>会话ID: <%= session.getId() %></p>
    <p>创建时间: <%= new Date(session.getCreationTime()) %></p>
</body>
</html>