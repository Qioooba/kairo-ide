package com.example.legacy;

import java.io.IOException;
import java.util.ResourceBundle;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * I18nServlet — reads a GBK-encoded properties file and
 * renders a localized greeting. Demonstrates that the IDE
 * must preserve GBK on save and load it correctly on read.
 */
public class I18nServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {
        ResourceBundle bundle = ResourceBundle.getBundle("messages");
        String greeting = bundle.getString("greeting");
        resp.setContentType("text/plain; charset=GBK");
        resp.getWriter().println(greeting);
    }
}
