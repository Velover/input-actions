//! The virtual Xbox 360 pad: plugged into ViGEmBus on /connect, its state set on /state.

use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use vigem_client::{Client, TargetId, XButtons, XGamepad, Xbox360Wired};
use windows_sys::Win32::Foundation::ERROR_NO_MORE_ITEMS;
use windows_sys::Win32::UI::Input::XboxController::{XINPUT_STATE, XInputGetState};

use crate::Reply;

/// The buttons, by the names the API takes, and their XInput bits
const BUTTONS: [(&str, u16); 15] = [
    ("A", XButtons::A),
    ("B", XButtons::B),
    ("X", XButtons::X),
    ("Y", XButtons::Y),
    ("LB", XButtons::LB),
    ("RB", XButtons::RB),
    ("Back", XButtons::BACK),
    ("Start", XButtons::START),
    ("Guide", XButtons::GUIDE),
    ("LeftThumb", XButtons::LTHUMB),
    ("RightThumb", XButtons::RTHUMB),
    ("DPadUp", XButtons::UP),
    ("DPadDown", XButtons::DOWN),
    ("DPadLeft", XButtons::LEFT),
    ("DPadRight", XButtons::RIGHT),
];

/// How long a new pad may take to accept its first report, and to show in XInput at the neutral state
const READY_TIMEOUT: Duration = Duration::from_secs(2);

/// The whole state of the pad, as /state takes and returns it. A field left out is neutral.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct PadState {
    /// The buttons held, by name
    pub buttons: Vec<String>,
    /// 0 (released) to 1 (pulled all the way)
    pub left_trigger: f64,
    pub right_trigger: f64,
    /// `[x, y]`, each -1 to 1, y up (as XInput and Roblox's thumbstick positions have it)
    pub left_stick: [f64; 2],
    pub right_stick: [f64; 2],
}

impl PadState {
    /// The XInput report for this state, or why it isn't a valid state
    fn report(&self) -> Result<XGamepad, String> {
        let mut buttons = 0;
        for name in &self.buttons {
            let Some((_, bit)) = BUTTONS.iter().find(|(known, _)| known == name) else {
                let known: Vec<&str> = BUTTONS.iter().map(|(known, _)| *known).collect();
                return Err(format!(
                    "no button {name:?}; the buttons are {}",
                    known.join(", ")
                ));
            };
            buttons |= bit;
        }
        Ok(XGamepad {
            buttons: XButtons(buttons),
            left_trigger: trigger(self.left_trigger, "leftTrigger")?,
            right_trigger: trigger(self.right_trigger, "rightTrigger")?,
            thumb_lx: axis(self.left_stick[0], "leftStick")?,
            thumb_ly: axis(self.left_stick[1], "leftStick")?,
            thumb_rx: axis(self.right_stick[0], "rightStick")?,
            thumb_ry: axis(self.right_stick[1], "rightStick")?,
        })
    }
}

fn trigger(value: f64, field: &str) -> Result<u8, String> {
    if !(0.0..=1.0).contains(&value) {
        return Err(format!("{field} is {value}: a trigger goes from 0 to 1"));
    }
    Ok((value * 255.0).round() as u8)
}

fn axis(value: f64, field: &str) -> Result<i16, String> {
    if !(-1.0..=1.0).contains(&value) {
        return Err(format!(
            "{field} has {value}: a stick's axes go from -1 to 1"
        ));
    }
    Ok((value * 32767.0).round() as i16)
}

fn describe(error: vigem_client::Error) -> String {
    match error {
        vigem_client::Error::BusNotFound => "ViGEmBus is not installed (no bus found)".into(),
        error => format!("ViGEmBus: {error}"),
    }
}

/// The pad: plugged in while `target` is there
#[derive(Default)]
pub struct Pad {
    target: Option<Xbox360Wired<Client>>,
    state: PadState,
}

impl Pad {
    /// "ok" when ViGEmBus can be reached, else why not
    pub fn bus_status() -> String {
        match Client::connect() {
            Ok(_) => "ok".into(),
            Err(error) => describe(error),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.target.is_some()
    }

    /// Plugs the pad in at the neutral state; a pad already in keeps its state
    pub fn connect(&mut self) -> Reply {
        if let Some(target) = self.target.as_mut() {
            return Ok(json!({ "connected": true, "userIndex": target.get_user_index().ok() }));
        }
        let client = Client::connect().map_err(|error| (503, describe(error)))?;
        let mut target = Xbox360Wired::new(client, TargetId::XBOX360_WIRED);
        let failed = |error| (500, format!("plugging the pad in failed: {error}"));
        target.plugin().map_err(failed)?;
        // From here a failure drops `target`, which unplugs it
        target.wait_ready().map_err(failed)?;
        let index = settle(&mut target).map_err(failed)?;
        self.state = PadState::default();
        self.target = Some(target);
        // userIndex is null when XInput never showed the pad at the neutral state
        Ok(json!({ "connected": true, "userIndex": index }))
    }

    pub fn disconnect(&mut self) -> Reply {
        // Unplugged here to report a failure; dropping the target tries again
        if let Some(mut target) = self.target.take()
            && let Err(error) = target.unplug()
        {
            eprintln!("virtual-pad: unplugging failed: {error}");
        }
        self.state = PadState::default();
        Ok(json!({ "connected": false }))
    }

    pub fn state(&self) -> Value {
        json!({ "connected": self.is_connected(), "state": self.state })
    }

    pub fn set(&mut self, state: PadState) -> Reply {
        let report = state.report().map_err(|why| (400, why))?;
        let Some(target) = self.target.as_mut() else {
            return Err((409, "the pad is not plugged in: POST /connect first".into()));
        };
        submit(target, &report)
            .map_err(|error| (500, format!("updating the pad failed: {error}")))?;
        self.state = state;
        Ok(self.state())
    }

    pub fn reset(&mut self) -> Reply {
        if self.target.is_none() {
            self.state = PadState::default();
            return Ok(self.state());
        }
        self.set(PadState::default())
    }
}

/// A report under every threshold, the left trigger at 1 of 255, sent before a neutral one: ViGEmBus
/// passes on only a report that differs from the one before, and a new pad's "one before" is
/// neutral, so a neutral report alone never arrives
const NUDGE: XGamepad = XGamepad {
    buttons: XButtons(0),
    left_trigger: 1,
    right_trigger: 0,
    thumb_lx: 0,
    thumb_ly: 0,
    thumb_rx: 0,
    thumb_ry: 0,
};

/// For a pad just plugged in: sends the neutral report until XInput shows it, and answers the
/// pad's XInput slot (0 to 3). Until a report arrives, XInput shows the new pad with small stick
/// values (seen every time: -3356, -1869 on the left stick, -3255, -848 on the right). `None` when
/// XInput doesn't show the pad neutral within READY_TIMEOUT.
fn settle(target: &mut Xbox360Wired<Client>) -> Result<Option<u32>, vigem_client::Error> {
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        submit(target, &NUDGE)?;
        submit(target, &XGamepad::default())?;
        if let Ok(index) = target.get_user_index()
            && reads_neutral(index)
        {
            return Ok(Some(index));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        thread::sleep(Duration::from_millis(20));
    }
}

/// Whether XInput shows the pad in this slot at the neutral state
fn reads_neutral(index: u32) -> bool {
    let mut state = XINPUT_STATE::default();
    // Safety: a live XINPUT_STATE to write to
    if unsafe { XInputGetState(index, &mut state) } != 0 {
        return false;
    }
    let pad = state.Gamepad;
    let axes = [pad.sThumbLX, pad.sThumbLY, pad.sThumbRX, pad.sThumbRY];
    pad.wButtons == 0 && pad.bLeftTrigger == 0 && pad.bRightTrigger == 0 && axes == [0; 4]
}

/// Sends a report. ViGEmBus hands a report to the pad's driver only through a read the driver has
/// waiting; with none waiting (right after plug-in, or reports faster than the driver reads) it
/// drops the report and answers ERROR_NO_MORE_ITEMS. That, and a pad not ready yet, are retried.
fn submit(target: &mut Xbox360Wired<Client>, report: &XGamepad) -> Result<(), vigem_client::Error> {
    use vigem_client::Error::{TargetNotReady, WinError};
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        match target.update(report) {
            Err(TargetNotReady | WinError(ERROR_NO_MORE_ITEMS)) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(2))
            }
            result => return result,
        }
    }
}
