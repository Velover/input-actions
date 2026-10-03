//! When the service stops: Ctrl+C or a closed console, a stdin pipe that closes, or the end of the
//! process that started it. Each only asks; the main loop then lifts the touch contacts, unplugs
//! the pad and returns.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_INVALID_PARAMETER, FILETIME, GetLastError, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{FILE_TYPE_PIPE, GetFileType};
use windows_sys::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE, SetConsoleCtrlHandler};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetProcessTimes, INFINITE, OpenProcess,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};
use windows_sys::core::BOOL;

static STOP: AtomicBool = AtomicBool::new(false);
static CLEANED_UP: AtomicBool = AtomicBool::new(false);

/// How long a console event waits for the cleanup: Windows ends the process when the handler of a
/// close, logoff or shutdown event returns, and gives it about 5 s
const CLEANUP_WAIT: Duration = Duration::from_secs(4);

pub fn stop_requested() -> bool {
    STOP.load(Ordering::SeqCst)
}

pub fn request_stop(why: &str) {
    if !STOP.swap(true, Ordering::SeqCst) {
        eprintln!("virtual-pad: stopping: {why}");
    }
}

/// Called once the pad is unplugged and the contacts lifted
pub fn cleaned_up() {
    CLEANED_UP.store(true, Ordering::SeqCst);
}

/// Starts watching for the reasons to stop
pub fn watch() {
    // Safety: the handler is a plain function that lives as long as the process. A process can
    // inherit "ignore Ctrl+C" from the one that started it (a new process group sets it), and
    // Ctrl+C then never reaches a handler: the first call turns Ctrl+C back on.
    unsafe {
        SetConsoleCtrlHandler(None, 0);
        SetConsoleCtrlHandler(Some(on_console_event), 1);
    }
    watch_stdin();
    watch_parent();
}

/// Ctrl+C, Ctrl+Break, a closed console, a logoff or a shutdown
unsafe extern "system" fn on_console_event(_event: u32) -> BOOL {
    request_stop("console event (Ctrl+C or the console closing)");
    let deadline = Instant::now() + CLEANUP_WAIT;
    while !CLEANED_UP.load(Ordering::SeqCst) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    1
}

/// A stdin that is a pipe (the run that started it) is read until it closes. A console or NUL as
/// stdin is left alone: Ctrl+C stops it then.
fn watch_stdin() {
    // Safety: plain calls; the handle is the process's own and isn't closed here
    let is_pipe = unsafe {
        let stdin = GetStdHandle(STD_INPUT_HANDLE);
        !stdin.is_null() && stdin != INVALID_HANDLE_VALUE && GetFileType(stdin) == FILE_TYPE_PIPE
    };
    if !is_pipe {
        return;
    }
    thread::spawn(|| {
        let mut buffer = [0u8; 256];
        let mut stdin = std::io::stdin();
        while let Ok(read) = stdin.read(&mut buffer) {
            if read == 0 {
                break;
            }
        }
        request_stop("stdin closed");
    });
}

/// Stops when the process that started this one ends
fn watch_parent() {
    let Some(parent) = parent_process() else {
        return;
    };
    // A handle is a pointer, which threads can't share; the number can
    let parent = parent as usize;
    thread::spawn(move || {
        // Safety: the handle stays open for the life of the process
        unsafe { WaitForSingleObject(parent as HANDLE, INFINITE) };
        request_stop("the process that started it ended");
    });
}

/// The process that started this one, opened to wait on; `None` when it can't be found or opened.
/// A parent already gone stops the service: its id may belong to a later process by now.
fn parent_process() -> Option<HANDLE> {
    // Safety: the snapshot and process handles are checked and closed here; `entry` is sized
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let me = GetCurrentProcessId();
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut parent_id = None;
        let mut found = Process32FirstW(snapshot, &mut entry);
        while found != 0 {
            if entry.th32ProcessID == me {
                parent_id = Some(entry.th32ParentProcessID);
                break;
            }
            found = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);

        let access = PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION;
        let parent = OpenProcess(access, 0, parent_id?);
        if parent.is_null() {
            // No such process; any other error (access denied) leaves the parent unwatched
            if GetLastError() == ERROR_INVALID_PARAMETER {
                request_stop("the process that started it is gone");
            }
            return None;
        }
        if started(parent) > started(GetCurrentProcess()) {
            CloseHandle(parent);
            request_stop("the process that started it is gone");
            return None;
        }
        Some(parent)
    }
}

/// When a process started, in Windows' 100 ns ticks; 0 when it can't be read
fn started(process: HANDLE) -> u64 {
    let mut times = [FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    }; 4];
    let [created, exited, kernel, user] = &mut times;
    // Safety: four live FILETIMEs
    if unsafe { GetProcessTimes(process, created, exited, kernel, user) } == 0 {
        return 0;
    }
    (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime)
}
