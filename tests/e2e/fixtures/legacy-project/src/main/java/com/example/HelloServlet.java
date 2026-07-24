package com.example;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletException;
import javax.servlet.ServletConfig;
import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.Date;

/**
 * 遗留系统主Servlet - GBK编码
 * 该系统使用JDK 1.6编译，运行在Tomcat 6上
 */
public class HelloServlet extends HttpServlet {

    private String appName;
    private String dbUrl;

    public void init(ServletConfig config) throws ServletException {
        super.init(config);
        appName = config.getInitParameter("appName");
        if (appName == null) {
            appName = "Ϣϵͳ";
        }
        dbUrl = config.getInitParameter("dbUrl");
    }

    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        request.setCharacterEncoding("GBK");
        response.setContentType("text/html; charset=GBK");
        PrintWriter out = response.getWriter();

        String action = request.getParameter("action");
        String name = request.getParameter("name");
        if (name == null || name.trim().length() == 0) {
            name = "";
        }

        out.println("<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3.org/TR/html4/loose.dtd\">");
        out.println("<html>");
        out.println("<head><title>" + appName + "</title></head>");
        out.println("<body>");

        out.println("<h1>ӭʹ " + appName + "</h1>");
        out.println("<p>ǰʱ䣺" + new Date() + "</p>");
        out.println("<p>ã" + name + "</p>");

        if ("list".equals(action)) {
            out.println("<h2>ûб</h2>");
            // 查询数据库
            UserDAO dao = new UserDAO();
            try {
                java.util.List users = dao.getAllUsers();
                out.println("<table border='1'>");
                out.println("<tr><th>ID</th><th></th><th></th></tr>");
                for (int i = 0; i < users.size(); i++) {
                    String[] user = (String[]) users.get(i);
                    out.println("<tr><td>" + user[0] + "</td><td>" + user[1] + "</td><td>" + user[2] + "</td></tr>");
                }
                out.println("</table>");
            } catch (Exception e) {
                out.println("<p style='color:red'>ݿѯʧܣ" + e.getMessage() + "</p>");
            }
        }

        out.println("</body></html>");
    }

    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        doGet(request, response);
    }

    public void destroy() {
        appName = null;
        dbUrl = null;
    }
}