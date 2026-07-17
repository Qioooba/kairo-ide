<%@ page contentType="text/html;charset=GBK" language="java" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="k" tagdir="/WEB-INF/tags" %>
<!DOCTYPE html>
<html>
<head><title>你好，Kairo</title></head>
<body>
<h1>你好，欢迎使用 Kairo IDE</h1>
<p>当前时间：<%= new java.util.Date() %></p>
<c:if test="${not empty param.name}">
  <p>Hello, <c:out value="${param.name}"/>!</p>
</c:if>
<k:hello who="${param.name == null ? 'world' : param.name}"/>
</body>
</html>
