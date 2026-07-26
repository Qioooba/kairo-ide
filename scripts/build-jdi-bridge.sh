#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIDGE_DIR="$PROJECT_DIR/bundled/kairo-jdi-bridge"
OUTPUT_JAR="$PROJECT_DIR/bundled/kairo-jdi-bridge.jar"

echo "==> Building Kairo JDI Bridge..."

# Check if Maven is available
if command -v mvn &>/dev/null; then
    echo "==> Using Maven to build..."
    cd "$BRIDGE_DIR"
    mvn clean package -q -DskipTests
    # Find the built jar (shade plugin produces the shaded jar)
    JAR=$(find target -name "kairo-jdi-bridge*.jar" -not -name "*sources*" -not -name "*javadoc*" -not -name "original-*" | head -1)
    if [ -z "$JAR" ]; then
        echo "ERROR: Maven build did not produce a jar file"
        exit 1
    fi
    cp "$JAR" "$OUTPUT_JAR"
elif command -v javac &>/dev/null && command -v jar &>/dev/null; then
    echo "==> Maven not found, using javac + jar..."
    SRC_DIR="$BRIDGE_DIR/src/main/java"
    BUILD_DIR="$BRIDGE_DIR/build/classes"
    mkdir -p "$BUILD_DIR"

    # Find all Java source files
    find "$SRC_DIR" -name "*.java" > "$BRIDGE_DIR/build/sources.txt"

    # Compile (note: this requires jackson-databind on classpath)
    javac -d "$BUILD_DIR" --release 17 -cp "$PROJECT_DIR/bundled/jdtls/plugins/com.google.gson_2.13.2.jar" @"$BRIDGE_DIR/build/sources.txt" 2>&1 || {
        echo "WARNING: Manual compilation requires jackson-databind. If you have it, add to classpath."
        echo "Install Maven for automatic dependency resolution: https://maven.apache.org/"
        exit 1
    }

    # Create manifest and jar
    echo "Main-Class: com.kairo.debug.KairoJdiBridge" > "$BRIDGE_DIR/build/MANIFEST.MF"
    cd "$BUILD_DIR"
    jar cfm "$OUTPUT_JAR" "$BRIDGE_DIR/build/MANIFEST.MF" .
    cd "$PROJECT_DIR"
else
    echo "ERROR: Neither Maven nor javac+jar found. Install JDK 17+ with Maven."
    exit 1
fi

# Verify
if [ -f "$OUTPUT_JAR" ] && [ -s "$OUTPUT_JAR" ]; then
    echo "==> SUCCESS: kairo-jdi-bridge.jar built at $OUTPUT_JAR"
    ls -lh "$OUTPUT_JAR"
else
    echo "ERROR: Output jar is missing or empty"
    exit 1
fi