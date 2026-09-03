package com.example.kairo;

/**
 * Caller of FormalGreeter — used for Go To, usages, hippie, signature help, and surround.
 */
public class Caller {
    public static void main(String[] args) {
        FormalGreeter g = new FormalGreeter();
        String who = "guest";
        System.out.println(who);
        g.shout("kairo");
        String green = "green";
        System.out.println(g.greet(green));
        FormalGreeter greeter = make();
        System.out.println(greeter);
    }

    static FormalGreeter make() {
        FormalGreeter greeter = new FormalGreeter();
        return greeter;
    }
}
