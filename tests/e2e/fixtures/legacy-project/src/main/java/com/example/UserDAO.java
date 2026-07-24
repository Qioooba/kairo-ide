package com.example;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/**
 * ûݷʲ - GBK
 * ʹJDBCֱӣдSQL
 * ϵͳдڵģʽ
 */
public class UserDAO {

    private static final String DRIVER = "com.mysql.jdbc.Driver";
    private static final String DEFAULT_URL = "jdbc:mysql://localhost:3306/legacy_db?useUnicode=true&characterEncoding=GBK";

    private String dbUrl;

    public UserDAO() {
        this.dbUrl = DEFAULT_URL;
    }

    public UserDAO(String dbUrl) {
        this.dbUrl = dbUrl;
    }

    /**
     * ȡû
     */
    public List getAllUsers() throws Exception {
        Connection conn = null;
        PreparedStatement stmt = null;
        ResultSet rs = null;
        List users = new ArrayList();

        try {
            conn = DBUtil.getConnection(dbUrl);
            String sql = "SELECT id, name, email FROM t_user WHERE status = 1 ORDER BY id";
            stmt = conn.prepareStatement(sql);
            rs = stmt.executeQuery();

            while (rs.next()) {
                String[] user = new String[3];
                user[0] = String.valueOf(rs.getInt("id"));
                user[1] = rs.getString("name");
                user[2] = rs.getString("email");
                users.add(user);
            }
        } catch (SQLException e) {
            throw new Exception("ѯûʧ: " + e.getMessage(), e);
        } finally {
            DBUtil.close(rs, stmt, conn);
        }

        return users;
    }

    /**
     * ûǷ
     */
    public boolean checkUserExists(String name) throws Exception {
        Connection conn = null;
        PreparedStatement stmt = null;
        ResultSet rs = null;

        try {
            conn = DBUtil.getConnection(dbUrl);
            String sql = "SELECT COUNT(*) FROM t_user WHERE name = ?";
            stmt = conn.prepareStatement(sql);
            stmt.setString(1, name);
            rs = stmt.executeQuery();

            if (rs.next()) {
                return rs.getInt(1) > 0;
            }
            return false;
        } catch (SQLException e) {
            throw new Exception("ûʧ: " + e.getMessage(), e);
        } finally {
            DBUtil.close(rs, stmt, conn);
        }
    }

    /**
     * û
     */
    public int insertUser(String name, String email) throws Exception {
        Connection conn = null;
        PreparedStatement stmt = null;

        try {
            conn = DBUtil.getConnection(dbUrl);
            String sql = "INSERT INTO t_user (name, email, status) VALUES (?, ?, 1)";
            stmt = conn.prepareStatement(sql);
            stmt.setString(1, name);
            stmt.setString(2, email);
            return stmt.executeUpdate();
        } catch (SQLException e) {
            throw new Exception("ûʧ: " + e.getMessage(), e);
        } finally {
            DBUtil.close(null, stmt, conn);
        }
    }

    /**
     * ɾû
     */
    public int deleteUser(int id) throws Exception {
        Connection conn = null;
        PreparedStatement stmt = null;

        try {
            conn = DBUtil.getConnection(dbUrl);
            String sql = "UPDATE t_user SET status = 0 WHERE id = ?";
            stmt = conn.prepareStatement(sql);
            stmt.setInt(1, id);
            return stmt.executeUpdate();
        } catch (SQLException e) {
            throw new Exception("ɾûʧ: " + e.getMessage(), e);
        } finally {
            DBUtil.close(null, stmt, conn);
        }
    }
}