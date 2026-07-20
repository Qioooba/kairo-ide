//go:build windows
// +build windows

package proc

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// Windows API constants used for process identity verification and Job
// Object management.
const (
	ctrlBreakEvent = 1

	processTerminate               = 0x0001
	processQueryLimitedInfo        = 0x1000
	processQueryInfo               = 0x0400
	stillActive             uint32 = 259

	// Job Object limits and flags.
	// JobObjectExtendedLimitInformation (== 9) is the JobObjectInformationClass
	// value passed to SetInformationJobObject to configure extended limits.
	jobObjectExtendedLimitInformationClass = 9
	jobObjectLimitKillOnJobClose           = 0x2000

	// CreateProcess flags inherited from the existing implementation.
	createNewProcessGroup = 0x00000200

	// OpenProcess access mask used for AssignProcessToJobObject.
	processSetQuota = 0x0100
)

var (
	modkernel32 = syscall.NewLazyDLL("kernel32.dll")

	procGenerateConsoleCtrlEvent   = modkernel32.NewProc("GenerateConsoleCtrlEvent")
	procOpenProcess                = modkernel32.NewProc("OpenProcess")
	procGetExitCodeProcess         = modkernel32.NewProc("GetExitCodeProcess")
	procCloseHandle                = modkernel32.NewProc("CloseHandle")
	procTerminateProcess           = modkernel32.NewProc("TerminateProcess")
	procQueryFullProcessImageNameW = modkernel32.NewProc("QueryFullProcessImageNameW")
	procGetProcessTimes            = modkernel32.NewProc("GetProcessTimes")
	procCreateJobObjectW           = modkernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject    = modkernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject   = modkernel32.NewProc("AssignProcessToJobObject")
)

// jobObjectBasicLimitInformation is the JOBOBJECT_BASIC_LIMIT_INFORMATION
// struct. The Go layout omits the trailing LimitFlags field; we write to
// it via unsafe pointer arithmetic in setJobLimitFlags to keep the struct
// definition simple and portable.
type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	PerProcessMemoryLimit   uintptr
	PerJobMemoryLimit       uintptr
	SchedulingClass         uint32
}

// jobObjectExtendedLimitInformationStruct is the JOBOBJECT_EXTENDED_LIMIT_INFORMATION
// struct used by SetInformationJobObject to enable
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. We only need the BasicLimitInformation
// portion (the first 48 bytes on x64) to set the LimitFlags field.
type jobObjectExtendedLimitInformationStruct struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                struct {
		ReadOperationCount  uint64
		WriteOperationCount uint64
		OtherOperationCount uint64
		ReadTransferCount   uint64
		WriteTransferCount  uint64
		OtherTransferCount  uint64
	}
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

// agentJob is a process-wide Job Object that holds every Kairo-managed
// Tomcat process. When the Agent process exits (cleanly or via crash),
// Windows closes the Job Object handle and kills all assigned processes
// because JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is set. This guarantees the
// product rule from ADR-0011 Section 9: no Kairo-managed Tomcat outlives
// the Agent that started it.
var (
	agentJobOnce sync.Once
	agentJob     syscall.Handle
	agentJobErr  error
)

// initAgentJob lazily creates the process-wide Job Object. It is safe to
// call from concurrent goroutines.
func initAgentJob() {
	agentJobOnce.Do(func() {
		h, _, err := procCreateJobObjectW.Call(0, 0)
		if h == 0 {
			agentJobErr = fmt.Errorf("CreateJobObjectW failed: %w", err)
			return
		}
		info := jobObjectExtendedLimitInformationStruct{}
		info.BasicLimitInformation.SchedulingClass = 0
		// Set JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so that all processes
		// in the job are terminated when the last handle to the job is
		// closed (i.e. when the Agent process exits).
		// We encode the flag directly in the LimitFlags field of
		// BasicLimitInformation, which is the first uint32-sized field
		// after SchedulingClass in the layout above. Since Go does not
		// expose LimitFlags directly here, we rely on the field layout
		// being: PerProcessUserTimeLimit (int64), PerJobUserTimeLimit
		// (int64), PerProcessMemoryLimit (uintptr), PerJobMemoryLimit
		// (uintptr), SchedulingClass (uint32), LimitFlags (uint32).
		// To keep this code portable across architectures we re-derive
		// the LimitFlags address via unsafe.Pointer arithmetic on the
		// BasicLimitInformation struct.
		setJobLimitFlags(&info.BasicLimitInformation, jobObjectLimitKillOnJobClose)

		_, _, err = procSetInformationJobObject.Call(
			h,
			uintptr(jobObjectExtendedLimitInformationClass),
			uintptr(unsafe.Pointer(&info)),
			unsafe.Sizeof(info),
		)
		if err != nil && err != syscall.Errno(0) {
			procCloseHandle.Call(h)
			agentJobErr = fmt.Errorf("SetInformationJobObject failed: %w", err)
			return
		}
		agentJob = syscall.Handle(h)
	})
}

// setJobLimitFlags writes the LimitFlags value into the
// JOBOBJECT_BASIC_LIMIT_INFORMATION struct referenced by info. The struct
// layout is fixed by the Windows ABI; LimitFlags sits immediately after
// SchedulingClass.
func setJobLimitFlags(info *jobObjectBasicLimitInformation, flags uint32) {
	// Layout (x64): int64, int64, uintptr, uintptr, uint32 (SchedulingClass),
	// uint32 (LimitFlags). We compute the address of LimitFlags via
	// unsafe arithmetic and store flags there.
	base := uintptr(unsafe.Pointer(info))
	schedulingClassOffset := unsafe.Offsetof(info.SchedulingClass)
	limitFlagsAddr := (*uint32)(unsafe.Pointer(base + schedulingClassOffset + 4))
	*limitFlagsAddr = flags
}

// assignToAgentJob adds the process referenced by pid to the agent-wide
// Job Object so that it is automatically killed if the Agent exits.
func assignToAgentJob(pid int) error {
	if pid <= 0 {
		return nil
	}
	initAgentJob()
	if agentJobErr != nil {
		return agentJobErr
	}
	if agentJob == 0 {
		return fmt.Errorf("agent Job Object not initialized")
	}
	h, _, err := procOpenProcess.Call(
		uintptr(processSetQuota|processTerminate),
		0,
		uintptr(pid),
	)
	if h == 0 {
		return fmt.Errorf("OpenProcess for job assignment failed: %w", err)
	}
	defer procCloseHandle.Call(h)
	r1, _, err := procAssignProcessToJobObject.Call(uintptr(agentJob), h)
	if r1 == 0 {
		return fmt.Errorf("AssignProcessToJobObject failed: %w", err)
	}
	return nil
}

func sysProcAttrForOS() *syscall.SysProcAttr {
	// CREATE_NEW_PROCESS_GROUP allows GenerateConsoleCtrlEvent to signal
	// the Tomcat process group independently of the Agent's console.
	// Job Object assignment is done explicitly in Start() after
	// cmd.Start() returns, because SysProcAttr does not expose
	// AssignProcessToJobObject directly in Go's syscall package on
	// all versions.
	return &syscall.SysProcAttr{
		CreationFlags: createNewProcessGroup,
	}
}

// afterStartHook is invoked by the cross-platform Start() implementation
// after a process has been successfully launched. On Windows this assigns
// the new process to the agent-wide Job Object so that it is killed when
// the Agent exits.
func afterStartHook(pid int) error {
	return assignToAgentJob(pid)
}

func terminateProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	r1, _, _ := procGenerateConsoleCtrlEvent.Call(uintptr(ctrlBreakEvent), uintptr(pid))
	if r1 == 0 {
		// GenerateConsoleCtrlEvent failed: fall through to terminateOne
		// so we do not silently lose the stop signal. The previous
		// implementation returned nil here, hiding real failures.
		return terminateOne(pid)
	}
	return nil
}

func killProcessGroup(pid int) error {
	if pid <= 0 {
		return nil
	}
	// taskkill /T kills the entire process tree rooted at pid. We
	// capture stderr so that failures are observable rather than
	// discarded as in the previous implementation.
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Fall back to direct TerminateProcess on the root pid. If
		// even that fails, surface the taskkill output to the caller
		// so the failure is not silently swallowed.
		termErr := terminateOne(pid)
		if termErr != nil {
			return fmt.Errorf("taskkill failed (%v): %s; TerminateProcess also failed: %v",
				err, strings.TrimSpace(string(out)), termErr)
		}
		return nil
	}
	return nil
}

func terminateOne(pid int) error {
	h, _, _ := procOpenProcess.Call(uintptr(processTerminate), 0, uintptr(pid))
	if h == 0 {
		return syscall.EINVAL
	}
	defer procCloseHandle.Call(h)
	r1, _, _ := procTerminateProcess.Call(h, 1)
	if r1 == 0 {
		return syscall.EINVAL
	}
	return nil
}

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, _, _ := procOpenProcess.Call(uintptr(processQueryInfo), 0, uintptr(pid))
	if h == 0 {
		return false
	}
	defer procCloseHandle.Call(h)
	var code uint32
	r1, _, _ := procGetExitCodeProcess.Call(h, uintptr(unsafe.Pointer(&code)))
	if r1 == 0 {
		return false
	}
	return code == stillActive
}

// verifyProcessIdentity performs a complete OS-level identity check before
// the Agent is allowed to signal a Kairo-managed process. It verifies:
//
//  1. PID is still alive.
//  2. Executable path matches the one recorded when the process was
//     started (defeats PID reuse where the same PID now points to a
//     different binary).
//  3. Process start time matches the recorded StartTime (defeats PID
//     reuse where the original process exited and the PID was recycled
//     for an unrelated process, even one with the same executable name).
//
// CatalinaBase and MarkerToken are checked at the Go level via
// identityMatches() in proc.go; they are not re-derived from the OS here.
// Reading another process's environment block on Windows requires
// PROCESS_VM_READ plus PEB traversal, which is fragile and would not
// meaningfully improve safety given the executable + start-time checks
// above and the product rule that forbids cross-Agent re-attach.
func verifyProcessIdentity(pid int, identity domain.ProcessIdentity) bool {
	if pid <= 0 {
		return false
	}
	if !isProcessAlive(pid) {
		return false
	}

	// Open with QUERY_LIMITED_INFORMATION (available on Vista+) which is
	// sufficient for QueryFullProcessImageNameW and GetProcessTimes and
	// does not require PROCESS_VM_READ.
	h, _, _ := procOpenProcess.Call(uintptr(processQueryLimitedInfo), 0, uintptr(pid))
	if h == 0 {
		// Fall back to the older QUERY_INFO access mask for older OSes.
		h2, _, _ := procOpenProcess.Call(uintptr(processQueryInfo), 0, uintptr(pid))
		if h2 == 0 {
			return false
		}
		h = h2
	}
	defer procCloseHandle.Call(h)

	if !verifyExecutablePath(h, identity.Executable) {
		return false
	}
	if !verifyProcessStartTime(h, identity.StartTime) {
		return false
	}
	return true
}

// verifyExecutablePath queries the canonical image path of the process
// referenced by handle h and compares it (case-insensitively, after
// symlink resolution) to expected.
func verifyExecutablePath(h uintptr, expected string) bool {
	if expected == "" {
		return false
	}
	expectedResolved, err := filepath.EvalSymlinks(expected)
	if err != nil {
		expectedResolved = expected
	}
	expectedLower := strings.ToLower(filepath.Clean(expectedResolved))

	buf := make([]uint16, 1024)
	size := uint32(len(buf))
	r1, _, _ := procQueryFullProcessImageNameW.Call(
		h,
		0,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if r1 == 0 {
		return false
	}
	actual := syscall.UTF16ToString(buf[:size])
	actualLower := strings.ToLower(filepath.Clean(actual))
	return actualLower == expectedLower
}

// verifyProcessStartTime queries the creation time of the process
// referenced by handle h and compares it to expected. A 2-second tolerance
// accounts for clock-skew between the OS-reported CreationTime and the
// Go time.Now() captured at start.
func verifyProcessStartTime(h uintptr, expected time.Time) bool {
	if expected.IsZero() {
		return false
	}
	var creation, exit, kernel, user syscall.Filetime
	r1, _, _ := procGetProcessTimes.Call(
		h,
		uintptr(unsafe.Pointer(&creation)),
		uintptr(unsafe.Pointer(&exit)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	if r1 == 0 {
		return false
	}
	// syscall.Filetime.Nanoseconds() returns ns since the Unix epoch
	// (it internally subtracts the Windows epoch offset).
	actual := time.Unix(0, creation.Nanoseconds())
	// 2-second tolerance to absorb scheduling/skew between the moment
	// cmd.Start() returned and the OS-recorded CreationTime.
	diff := actual.Sub(expected)
	if diff < 0 {
		diff = -diff
	}
	return diff <= 2*time.Second
}
