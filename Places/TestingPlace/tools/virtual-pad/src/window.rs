//! The test's own Studio window, for touch: where its client area is on the screen, and keeping it
//! on top of every other window, so that a touch at a point of it lands on it. Only a window whose
//! title holds the text the caller gives, and only when exactly one does.

use serde::Deserialize;
use serde_json::json;
use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClientRect, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    HWND_NOTOPMOST, HWND_TOPMOST, IsIconic, IsWindow, IsWindowVisible, SW_RESTORE, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SetForegroundWindow, SetWindowPos, ShowWindow,
};
use windows_sys::core::BOOL;

use crate::Reply;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Find {
    /// Text the window's title holds, such as the place file's name
    title: String,
    /// Puts the window on top of every other window (until /window/release) and asks Windows to
    /// make it the foreground window
    #[serde(default)]
    front: bool,
}

impl Find {
    /// Whether the request brings the window to the front (a focus change: needs `--allow-input`)
    pub fn front(&self) -> bool {
        self.front
    }
}

/// The window kept on top, as a number (a handle is a pointer)
#[derive(Default)]
pub struct Windows {
    raised: Option<usize>,
}

impl Windows {
    pub fn find(&mut self, find: Find) -> Reply {
        if find.title.trim().is_empty() {
            return Err((400, "title is empty".into()));
        }
        let matches: Vec<(HWND, String)> = top_windows()
            .into_iter()
            .filter(|(_, title)| title.contains(&find.title))
            .collect();
        let [(window, title)] = matches.as_slice() else {
            let titles: Vec<&String> = matches.iter().map(|(_, title)| title).collect();
            return Err((
                409,
                format!(
                    "{} windows' titles hold {:?}: {titles:?}",
                    titles.len(),
                    find.title
                ),
            ));
        };
        let window = *window;
        // Safety: plain calls on a window handle; the out-parameters are live locals
        unsafe {
            if find.front {
                if IsIconic(window) != 0 {
                    ShowWindow(window, SW_RESTORE);
                }
                SetWindowPos(
                    window,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                self.raised = Some(window as usize);
                SetForegroundWindow(window);
            }
            let mut process = 0;
            GetWindowThreadProcessId(window, &mut process);
            let mut client = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            GetClientRect(window, &mut client);
            let mut corner = POINT { x: 0, y: 0 };
            ClientToScreen(window, &mut corner);
            Ok(json!({
                "title": title,
                "process": process,
                "client": {
                    "x": corner.x,
                    "y": corner.y,
                    "width": client.right - client.left,
                    "height": client.bottom - client.top,
                },
                "foreground": GetForegroundWindow() == window,
                "onTop": self.raised == Some(window as usize),
            }))
        }
    }

    /// Lets the window kept on top go back among the others
    pub fn release(&mut self) -> Reply {
        let Some(window) = self.raised.take() else {
            return Ok(json!({ "released": false }));
        };
        let window = window as HWND;
        // Safety: a plain call; a window closed since is checked first
        unsafe {
            if IsWindow(window) != 0 {
                SetWindowPos(
                    window,
                    HWND_NOTOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
        Ok(json!({ "released": true }))
    }
}

/// The visible top-level windows that have a title, with it
fn top_windows() -> Vec<(HWND, String)> {
    unsafe extern "system" fn visit(window: HWND, found: LPARAM) -> BOOL {
        // Safety: `found` is the Vec passed to EnumWindows below, alive during the call
        unsafe {
            if IsWindowVisible(window) != 0 {
                let mut text = [0u16; 512];
                let length = GetWindowTextW(window, text.as_mut_ptr(), text.len() as i32);
                if length > 0 {
                    let title = String::from_utf16_lossy(&text[..length as usize]);
                    (*(found as *mut Vec<(HWND, String)>)).push((window, title));
                }
            }
        }
        1
    }
    let mut found: Vec<(HWND, String)> = Vec::new();
    // Safety: the callback only pushes to `found`, which outlives the call
    unsafe { EnumWindows(Some(visit), &mut found as *mut _ as LPARAM) };
    found
}
