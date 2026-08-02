@echo off
setlocal
set ROOT=%~dp0..
set BRIDGE=%ROOT%\bundled\kairo-jdi-bridge
set SRC=%BRIDGE%\src\main\java
set OUT=%BRIDGE%\build\classes
set JAR=%ROOT%\bundled\kairo-jdi-bridge.jar
set JAVA_HOME_DIR=E:\Tools\jdk17
if defined JAVA_HOME set JAVA_HOME_DIR=%JAVA_HOME%
set JAVAC=%JAVA_HOME_DIR%\bin\javac.exe
set JARBIN=%JAVA_HOME_DIR%\bin\jar.exe

if not exist "%JAVAC%" (
  echo ERROR: javac not found at %JAVAC%
  exit /b 1
)

echo Building kairo-jdi-bridge...
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%" 2>nul
mkdir "%BRIDGE%\build" 2>nul

dir /s /b "%SRC%\*.java" > "%BRIDGE%\build\sources.txt"
"%JAVAC%" -encoding UTF-8 --release 17 -d "%OUT%" @"%BRIDGE%\build\sources.txt"
if errorlevel 1 (
  echo ERROR: javac failed
  exit /b 1
)

echo Main-Class: com.kairo.debug.KairoJdiBridge> "%BRIDGE%\build\MANIFEST.MF"
cd /d "%OUT%"
"%JARBIN%" cfm "%JAR%" "%BRIDGE%\build\MANIFEST.MF" .
if errorlevel 1 (
  echo ERROR: jar failed
  exit /b 1
)
echo SUCCESS: %JAR%
dir "%JAR%"
exit /b 0
