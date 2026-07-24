<%@ page contentType="text/html;charset=GBK" language="java" %>
<%@ page import="java.util.Date,java.text.SimpleDateFormat" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>
<%@ taglib prefix="custom" uri="/WEB-INF/custom.tld" %>
<%
    // Scriptlet: 获取当前时间
    SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
    String currentTime = sdf.format(new Date());

    // Scriptlet: 获取请求参数
    String name = request.getParameter("name");
    if (name == null || name.trim().length() == 0) {
        name = "访客";
    }

    // Scriptlet: 模拟从数据库获取数据
    String[] menuItems = {"首页", "用户管理", "订单管理", "报表统计", "系统设置"};
%>
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=GBK">
    <title>遗留信息管理系统</title>
    <style type="text/css">
        body { font-family: "宋体", SimSun, serif; font-size: 14px; margin: 0; padding: 0; }
        .header { background-color: #2c3e50; color: white; padding: 10px 20px; }
        .header h1 { margin: 0; font-size: 20px; }
        .menu { background-color: #34495e; padding: 5px 20px; }
        .menu a { color: #ecf0f1; text-decoration: none; margin-right: 15px; font-size: 13px; }
        .menu a:hover { color: #3498db; }
        .content { padding: 20px; }
        .footer { background-color: #2c3e50; color: #95a5a6; padding: 10px 20px; text-align: center; font-size: 12px; }
        .info-box { background-color: #ecf0f1; border: 1px solid #bdc3c7; padding: 10px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>遗留信息管理系统 v1.0</h1>
    </div>

    <div class="menu">
        <c:forEach var="item" items="<%=menuItems%>">
            <a href="?page=${item}">
                <c:out value="${item}"/>
            </a>
        </c:forEach>
    </div>

    <div class="content">
        <h2>欢迎使用本系统</h2>

        <%-- EL表达式: 显示欢迎信息 --%>
        <div class="info-box">
            <p>你好, <strong><c:out value="${param.name}" default="访客"/></strong>!</p>
            <p>当前时间: <fmt:formatDate value="<%=new Date()%>" pattern="yyyy-MM-dd HH:mm:ss"/></p>
            <p>您的IP地址: <%= request.getRemoteAddr() %></p>
        </div>

        <%-- Scriptlet: 条件判断 --%>
        <%
            String role = (String) session.getAttribute("role");
            if (role == null) {
                role = "guest";
            }
        %>

        <%-- EL表达式: 角色判断 --%>
        <c:choose>
            <c:when test="${sessionScope.role == 'admin'}">
                <p>管理员，您可以管理所有功能。</p>
            </c:when>
            <c:when test="${sessionScope.role == 'user'}">
                <p>普通用户，您可以查看和编辑自己的数据。</p>
            </c:when>
            <c:otherwise>
                <p>请先 <a href="login.jsp">登录</a> 系统。</p>
            </c:otherwise>
        </c:choose>

        <%-- 自定义标签 --%>
        <custom:dataTable table="t_user" rows="10" />

        <h3>系统公告</h3>
        <%
            // Scriptlet: 模拟公告列表
            String[] notices = {
                "系统将于每周日凌晨2:00-4:00进行维护",
                "请及时更新您的密码，确保账户安全",
                "新版本v2.0计划于下月发布"
            };
            for (int i = 0; i < notices.length; i++) {
        %>
            <div class="info-box">
                <strong>公告 <%= (i + 1) %>:</strong> <%= notices[i] %>
            </div>
        <%
            }
        %>
    </div>

    <div class="footer">
        <p>&copy; 2008-2010 遗留信息管理系统. All rights reserved.</p>
        <p>Powered by Java 1.6 + Tomcat 6</p>
    </div>
</body>
</html>