package com.example.legacy;

import java.io.IOException;
import java.util.Date;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * HelloServlet - the canonical first Servlet a developer writes
 * against a legacy Java Web project.
 *
 * The Kairo IDE uses this as the smoke-test endpoint for the
 * debug E2E: we hit /hello?name=Kairo and assert that the
 * variable view shows `name`.
 */
public class HelloServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {
        String name = req.getParameter("name");
        if (name == null || name.isEmpty()) {
            name = "world";
        }
        resp.setContentType("text/html; charset=GBK");
        resp.getWriter().println("<!doctype html>");
        resp.getWriter().println("<html><body>");
        resp.getWriter().println("<h1>\u4f60\u597d, " + name + "</h1>");
        resp.getWriter().println("<p>It is now " + new Date() + "</p>");
        resp.getWriter().println("</body></html>");
    }
}
