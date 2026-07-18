<%@ page contentType="text/html;charset=GBK" language="java" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<!DOCTYPE html>
<html>
<head><title>CHANGED! Kairo</title></head>
<body>
<h1>CHANGED，欢迎使用 Kairo IDE</h1>
<p>当前时间：<%= new java.util.Date() %></p>
<c:if test="${not empty param.name}">
  <p>Hello, <c:out value="${param.name}"/></p>
</c:if>
</body>
</html>