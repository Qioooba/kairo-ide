// kairo-server-launcher.go — Kairo-Server.exe 微型包装器
//
// 编译后仅 ~2MB，替代 201MB 的 Kairo.exe 完整副本。
// 功能: 在同目录下找到 Kairo.exe，用 --headless 参数启动它。
//
// 信号处理: 捕获 Ctrl+C / 关闭控制台，确保 Kairo.exe 子进程也被终止。
//
// 编译: go build -ldflags="-s -w" -o kairo-server.exe kairo-server-launcher.go

package main

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	// 获取当前 exe 所在目录
	exePath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ERROR] 无法获取当前路径: %v\n", err)
		os.Exit(1)
	}
	exeDir := filepath.Dir(exePath)

	// 在同目录下找 Kairo.exe
	kairoExe := filepath.Join(exeDir, "Kairo.exe")
	if _, err := os.Stat(kairoExe); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "[ERROR] 未找到 Kairo.exe\n")
		fmt.Fprintf(os.Stderr, "        请将 Kairo-Server.exe 放在 Kairo.exe 同目录下\n")
		fmt.Fprintf(os.Stderr, "        当前目录: %s\n", exeDir)
		os.Exit(1)
	}

	// 将额外的命令行参数透传给 Kairo.exe
	args := append([]string{"--headless"}, os.Args[1:]...)

	// 启动 Kairo.exe --headless
	cmd := exec.Command(kairoExe, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Windows: 隐藏 Kairo-Server.exe 自身的控制台窗口（如果存在）
	// Kairo.exe 是 GUI 程序，不会有控制台窗口
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}

	fmt.Println("============================================================")
	fmt.Println("  Kairo IDE — 浏览器模式")
	fmt.Println("============================================================")
	fmt.Println()
	fmt.Println("  正在启动后端服务...")
	fmt.Println("  服务启动后请在浏览器中打开显示的地址")
	fmt.Println("  按 Ctrl+C 停止所有服务")
	fmt.Println()
	fmt.Println("============================================================")
	fmt.Println()

	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "[ERROR] 启动 Kairo.exe 失败: %v\n", err)
		os.Exit(1)
	}

	// 确保退出时清理子进程
	killChild := func() {
		if cmd.Process != nil {
			// 先尝试优雅终止
			_ = cmd.Process.Signal(syscall.SIGTERM)
			// 等待 2 秒后强制终止
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			select {
			case <-done:
			default:
				cmd.Process.Kill()
			}
		}
	}
	defer killChild()

	// 监听 Ctrl+C 和关闭控制台信号
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		killChild()
		os.Exit(0)
	}()

	// 等待 Kairo.exe 退出
	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "[ERROR] Kairo.exe 异常退出: %v\n", err)
		os.Exit(1)
	}

	fmt.Println()
	fmt.Println("[INFO] Kairo 服务已停止")
}