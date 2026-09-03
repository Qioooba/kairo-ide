package com.example.kairo;

/**
 * Formal greeter implementation.
 */
public class FormalGreeter implements Greetable {
    /** Upper-snake constant used as a greeting template. */
    public static final String GREETING_TEMPLATE = "hello";
    public static final String GREETING = GREETING_TEMPLATE;
    public static final int MAX_LEN = 32;

    @Override
    public String greet(String who) {
        return "Good day, " + who;
    }

    public void shout(String who) {
        System.out.println(greet(who).toUpperCase());
    }

    public String titled() {
        return DEFAULT_NAME;
    }
}
