package com.example;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletException;
import java.io.IOException;
import java.io.PrintWriter;

public class HelloServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        response.setContentType("text/html; charset=GBK");
        PrintWriter out = response.getWriter();
        String name = request.getParameter("name");
        if (name == null) {
            name = "世界";
        }
        out.println("<html><body>");
        out.println("<h1>你好, " + name + "!</h1>");
        out.println("<p>当前时间: " + new java.util.Date() + "</p>");
        out.println("</body></html>");
    }

    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        doGet(request, response);
    }
}