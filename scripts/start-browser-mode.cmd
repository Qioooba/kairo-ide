@echo off
REM ============================================================
REM  Kairo IDE — 浏览器模式启动脚本
REM ============================================================
REM  仅启动后端服务,不打开桌面窗口。
REM  IDE 通过浏览器访问 http://127.0.0.1:<port>
REM
REM  用法:
REM    双击本文件即可启动
REM    或在命令行: start-browser-mode.cmd
REM
REM  原理:
REM    本脚本启动 Kairo-Server.exe。
REM    Kairo-Server.exe 与 Kairo.exe 是完全相同的二进制文件,
REM    只是文件名不同。当进程名为 Kairo-Server.exe 时,
REM    自动进入 headless 模式,不打开桌面窗口。
REM
REM  与桌面版的关系:
REM    - Kairo.exe       = 桌面版 (双击打开窗口)
REM    - Kairo-Server.exe = 浏览器版 (双击启动后台服务)
REM    - 两者可同时运行,共享同一个代理
REM ============================================================

setlocal enabledelayedexpansion

REM 切换到脚本所在目录
cd /d "%~dp0"

REM 优先使用 Kairo-Server.exe,回退到 Kairo.exe --headless
set KAIRO_CMD=
if exist "Kairo-Server.exe" (
    set KAIRO_CMD=Kairo-Server.exe
) else if exist "Kairo.exe" (
    set KAIRO_CMD=Kairo.exe --headless
    echo [INFO] 未找到 Kairo-Server.exe,使用 Kairo.exe --headless
) else (
    echo [ERROR] 未找到 Kairo.exe 或 Kairo-Server.exe
    echo         请将本脚本放在 Kairo 解压目录中
    echo         当前目录: %CD%
    pause
    exit /b 1
)

REM 检查 JDK
set JAVA_FOUND=0
for %%e in (java.exe javaw.exe) do (
    where %%e >nul 2>&1
    if !errorlevel! equ 0 (
        set JAVA_FOUND=1
        echo [OK] Java 已检测到
    )
)
if !JAVA_FOUND! equ 0 (
    if defined JAVA_HOME (
        if exist "%JAVA_HOME%\bin\java.exe" (
            set JAVA_FOUND=1
            echo [OK] Java 已检测到 ^(JAVA_HOME=%JAVA_HOME%^)
        )
    )
)
if !JAVA_FOUND! equ 0 (
    echo [WARN] 未检测到 Java。Java 功能将不可用。
    echo        请安装 JDK 17+ 或设置 JAVA_HOME 环境变量
    echo.
)

echo.
echo ============================================================
echo   Kairo IDE — 浏览器模式
echo ============================================================
echo.
echo   正在启动后端服务...
echo   服务启动后请在浏览器中打开显示的地址
echo   按 Ctrl+C 停止所有服务
echo.
echo ============================================================
echo.

REM 启动浏览器模式
%KAIRO_CMD%

REM 如果 Kairo 退出,显示信息
echo.
echo [INFO] Kairo 服务已停止
pause