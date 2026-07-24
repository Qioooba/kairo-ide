<%@ page contentType="text/html;charset=GBK" language="java" %>
<%@ page isErrorPage="true" %>
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=GBK">
    <title>错误页面</title>
    <style>
        body { font-family: "宋体", SimSun, serif; font-size: 14px; padding: 20px; }
        .error-box { border: 2px solid #e74c3c; background-color: #fadbd8; padding: 20px; margin: 20px 0; }
        .error-title { color: #c0392b; font-size: 18px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="error-box">
        <div class="error-title">系统错误</div>
        <p>很抱歉，系统发生了错误。请稍后重试。</p>
        <%
            if (exception != null) {
                out.println("<p>错误信息: " + exception.getMessage() + "</p>");
            }
        %>
        <p>HTTP状态码: <%= request.getAttribute("javax.servlet.error.status_code") %></p>
    </div>
    <p><a href="index.jsp">返回首页</a></p>
</body>
</html>