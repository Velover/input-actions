//! Touch injection (experimental): Windows' InitializeTouchInjection and InjectTouchInput, at
//! screen pixels. A touch lands on whatever window is at that point of the screen. Roblox Studio
//! gets it as mouse input, not touch (measured 2026-10-03): only the first contact, as MouseButton1.
//!
//! Every frame injected holds every contact that is down. A contact held still is injected again
//! every `HOLD_FRAME` where it is, since Windows cancels a press and hold that gets no frames.

use std::collections::BTreeMap;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{Value, json};
use windows_sys::Win32::Foundation::{ERROR_NOT_READY, GetLastError, POINT, RECT};
use windows_sys::Win32::UI::Input::Pointer::{
    InitializeTouchInjection, InjectTouchInput, POINTER_FLAG_DOWN, POINTER_FLAG_INCONTACT,
    POINTER_FLAG_INRANGE, POINTER_FLAG_UP, POINTER_FLAG_UPDATE, POINTER_FLAGS, POINTER_TOUCH_INFO,
    TOUCH_FEEDBACK_DEFAULT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, PT_TOUCH, SM_DIGITIZER, SM_MAXIMUMTOUCHES, TOUCH_FLAG_NONE,
    TOUCH_MASK_CONTACTAREA, TOUCH_MASK_ORIENTATION, TOUCH_MASK_PRESSURE,
};

use crate::Reply;

/// How many contacts can be down at once; their ids go from 0 to one less
const MAX_CONTACTS: u32 = 10;

/// How often a contact that is down is injected again where it is
const HOLD_FRAME: Duration = Duration::from_millis(100);

/// The frame's flags for a contact, by what it does
const DOWN: POINTER_FLAGS = POINTER_FLAG_DOWN | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT;
const MOVE: POINTER_FLAGS = POINTER_FLAG_UPDATE | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT;
const UP: POINTER_FLAGS = POINTER_FLAG_UP;

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Down,
    Move,
    Up,
}

/// One contact's part of a frame. An up needs no position: it lifts where the contact last was.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contact {
    id: u32,
    x: Option<i32>,
    y: Option<i32>,
    phase: Phase,
}

/// What POST /touch takes: one contact, or an array of several that change in the same frame (a
/// pinch)
pub fn parse_frame(body: Value) -> Result<Vec<Contact>, String> {
    let contacts = if body.is_array() {
        serde_json::from_value(body)
    } else {
        serde_json::from_value(body).map(|contact| vec![contact])
    };
    contacts.map_err(|error| format!("bad contact: {error}"))
}

/// What Windows says about touch on this PC
fn metrics() -> Value {
    // Safety: plain calls with no pointers
    let (digitizer, max_touches) = unsafe {
        (
            GetSystemMetrics(SM_DIGITIZER),
            GetSystemMetrics(SM_MAXIMUMTOUCHES),
        )
    };
    json!({ "digitizer": digitizer, "maxTouches": max_touches })
}

#[derive(Default)]
pub struct Touch {
    initialized: bool,
    /// The contacts down, by id, and where they are
    down: BTreeMap<u32, (i32, i32)>,
    last_frame: Option<Instant>,
}

impl Touch {
    pub fn status(&self) -> Value {
        let down: Vec<Value> = self
            .down
            .iter()
            .map(|(id, (x, y))| json!({ "id": id, "x": x, "y": y }))
            .collect();
        json!({ "initialized": self.initialized, "down": down, "windows": metrics() })
    }

    pub fn init(&mut self) -> Reply {
        if self.initialized {
            return Ok(self.status());
        }
        let before = metrics();
        // Safety: a plain call with no pointers
        if unsafe { InitializeTouchInjection(MAX_CONTACTS, TOUCH_FEEDBACK_DEFAULT) } == 0 {
            let error = unsafe { GetLastError() };
            return Err((
                500,
                format!("InitializeTouchInjection failed: Windows error {error}"),
            ));
        }
        self.initialized = true;
        Ok(json!({ "initialized": true, "before": before, "after": metrics() }))
    }

    /// Injects one frame: the contacts given, and every other contact down where it is
    pub fn apply(&mut self, contacts: Vec<Contact>) -> Reply {
        if contacts.is_empty() {
            return Err((400, "no contacts".into()));
        }
        let mut next = self.down.clone();
        let mut frame = Vec::new();
        for (index, contact) in contacts.iter().enumerate() {
            let id = contact.id;
            if id >= MAX_CONTACTS {
                return Err((
                    400,
                    format!("contact {id}: the ids go from 0 to {}", MAX_CONTACTS - 1),
                ));
            }
            if contacts[..index].iter().any(|earlier| earlier.id == id) {
                return Err((400, format!("contact {id} is in the frame twice")));
            }
            let at = contact.x.zip(contact.y);
            let (flags, position) = match (contact.phase, at, self.down.get(&id)) {
                (Phase::Down, _, Some(_)) => {
                    return Err((409, format!("contact {id} is down already")));
                }
                (Phase::Move | Phase::Up, _, None) => {
                    return Err((409, format!("contact {id} is not down")));
                }
                (Phase::Down | Phase::Move, None, _) => {
                    return Err((400, format!("contact {id}: a down or a move needs x and y")));
                }
                (Phase::Down, Some(at), None) => (DOWN, at),
                (Phase::Move, Some(at), Some(_)) => (MOVE, at),
                (Phase::Up, Some(at), Some(&last)) if at != last => {
                    return Err((
                        400,
                        format!("contact {id} lifts where it is, {last:?}: move it first"),
                    ));
                }
                (Phase::Up, _, Some(&last)) => (UP, last),
            };
            if flags == UP {
                next.remove(&id);
            } else {
                next.insert(id, position);
            }
            frame.push(pointer(id, position, flags));
        }
        for (&id, &position) in &self.down {
            if !contacts.iter().any(|contact| contact.id == id) {
                frame.push(pointer(id, position, MOVE));
            }
        }

        self.init()?;
        inject(&frame).map_err(|why| (500, why))?;
        self.down = next;
        self.last_frame = Some(Instant::now());
        Ok(self.status())
    }

    /// Injects the contacts down again where they are, once `HOLD_FRAME` has passed
    pub fn hold(&mut self) {
        if self.down.is_empty()
            || self
                .last_frame
                .is_some_and(|last| last.elapsed() < HOLD_FRAME)
        {
            return;
        }
        let frame: Vec<_> = self
            .down
            .iter()
            .map(|(&id, &at)| pointer(id, at, MOVE))
            .collect();
        if let Err(why) = inject(&frame) {
            // Windows has cancelled them
            eprintln!("virtual-pad: holding the contacts failed, so they are gone: {why}");
            self.down.clear();
        }
        self.last_frame = Some(Instant::now());
    }

    /// Lifts every contact down
    pub fn lift_all(&mut self) -> Reply {
        if !self.down.is_empty() {
            let frame: Vec<_> = self
                .down
                .iter()
                .map(|(&id, &at)| pointer(id, at, UP))
                .collect();
            self.down.clear();
            inject(&frame).map_err(|why| (500, format!("lifting the contacts failed: {why}")))?;
        }
        Ok(self.status())
    }
}

fn pointer(id: u32, (x, y): (i32, i32), flags: POINTER_FLAGS) -> POINTER_TOUCH_INFO {
    let mut info = POINTER_TOUCH_INFO::default();
    info.pointerInfo.pointerType = PT_TOUCH;
    info.pointerInfo.pointerId = id;
    info.pointerInfo.pointerFlags = flags;
    info.pointerInfo.ptPixelLocation = POINT { x, y };
    info.touchFlags = TOUCH_FLAG_NONE;
    info.touchMask = TOUCH_MASK_CONTACTAREA | TOUCH_MASK_ORIENTATION | TOUCH_MASK_PRESSURE;
    info.rcContact = RECT {
        left: x - 2,
        top: y - 2,
        right: x + 2,
        bottom: y + 2,
    };
    info.orientation = 90;
    info.pressure = 32000;
    info
}

/// Injects a frame, again after a millisecond when Windows says two came too close together
fn inject(frame: &[POINTER_TOUCH_INFO]) -> Result<(), String> {
    let mut attempts = 0;
    loop {
        // Safety: `frame` is a live slice of `frame.len()` contacts
        if unsafe { InjectTouchInput(frame.len() as u32, frame.as_ptr()) } != 0 {
            return Ok(());
        }
        let error = unsafe { GetLastError() };
        attempts += 1;
        if error != ERROR_NOT_READY || attempts == 3 {
            return Err(format!("InjectTouchInput failed: Windows error {error}"));
        }
        thread::sleep(Duration::from_millis(1));
    }
}
