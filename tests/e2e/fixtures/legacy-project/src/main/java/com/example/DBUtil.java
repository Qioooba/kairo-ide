package com.example;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.sql.SQLException;

/**
 * ݿ⹤ - GBK
 * ṩJDBCӵĻȡͷ
 * ϵͳеģʽ
 */
public class DBUtil {

    private static final String DRIVER_CLASS = "com.mysql.jdbc.Driver";

    static {
        try {
            Class.forName(DRIVER_CLASS);
        } catch (ClassNotFoundException e) {
            System.err.println("MySQL JDBC: " + e.getMessage());
        }
    }

    /**
     * ȡݿ
     * @param url JDBC URL
     * @return ݿ
     * @throws SQLException ӳ
     */
    public static Connection getConnection(String url) throws SQLException {
        String user = "root";
        String password = "root";
        return DriverManager.getConnection(url, user, password);
    }

    /**
     * ȡݿӣԶʱرģʽ
     */
    public static Connection getConnection(String url, String user, String password) throws SQLException {
        Connection conn = DriverManager.getConnection(url, user, password);
        conn.setAutoCommit(false);
        return conn;
    }

    /**
     * رݿԴ
     * @param rs  
     * @param stmt 
     * @param conn 
     */
    public static void close(ResultSet rs, Statement stmt, Connection conn) {
        try {
            if (rs != null) {
                rs.close();
            }
        } catch (SQLException e) {
            System.err.println("رResultSetʧ: " + e.getMessage());
        }

        try {
            if (stmt != null) {
                stmt.close();
            }
        } catch (SQLException e) {
            System.err.println("رStatementʧ: " + e.getMessage());
        }

        try {
            if (conn != null) {
                conn.close();
            }
        } catch (SQLException e) {
            System.err.println("رConnectionʧ: " + e.getMessage());
        }
    }

    /**
     * ûع
     */
    public static void rollback(Connection conn) {
        if (conn != null) {
            try {
                conn.rollback();
            } catch (SQLException e) {
                System.err.println("عʧ: " + e.getMessage());
            }
        }
    }

    /**
     * ύ
     */
    public static void commit(Connection conn) {
        if (conn != null) {
            try {
                conn.commit();
            } catch (SQLException e) {
                System.err.println("ύʧ: " + e.getMessage());
            }
        }
    }
}