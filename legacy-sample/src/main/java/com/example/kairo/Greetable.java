package com.example.kairo;

/**
 * Contract for greeters used by chapter 13 Java language tests.
 */
public interface Greetable {
    String DEFAULT_NAME = "guest";

    String greet(String who);
}
