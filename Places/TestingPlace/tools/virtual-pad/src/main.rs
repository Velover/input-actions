//! virtual-pad: a local HTTP service for the Studio tests of @rbxts/input-actions.
//!
//! Roblox's VirtualInput can't send gamepad input, so this plugs a virtual Xbox 360 pad into
//! Windows through the ViGEmBus driver and sets its state as the tests ask. It also injects touch
//! (experimental). It listens on 127.0.0.1 only: `virtual-pad [--port 47110]`.
//!
//! The API takes and returns JSON. A POST must say `Content-Type: application/json`, and every
//! request's Host must be 127.0.0.1 or localhost: a web page can send neither, so the browser can't
//! drive it. An error answers `{"error": "..."}` with a 4xx or 5xx status.
//!
//! - `GET /health`: `{"service": "virtual-pad", "bus": "ok" | why not, "connected": bool}`
//! - `POST /connect`: plugs the pad in, and answers once XInput shows it at the neutral state
//!   (nothing happens if it is in): `{"connected": true, "userIndex": 0..3 | null}`, its XInput
//!   slot, null when XInput didn't show it within 2 s
//! - `POST /disconnect`: unplugs it (nothing happens if it is out)
//! - `POST /state`: sets the whole state; a field left out is neutral. 409 while unplugged.
//!   `{"buttons": ["A", "DPadUp"], "leftTrigger": 0..1, "rightTrigger": 0..1,
//!   "leftStick": [x, y], "rightStick": [x, y]}`, the axes -1..1 with y up. The buttons: A, B,
//!   X, Y, LB, RB, Back, Start, Guide, LeftThumb, RightThumb, DPadUp, DPadDown, DPadLeft,
//!   DPadRight. Guide opens the Xbox Game Bar: don't press it.
//! - `GET /state`: `{"connected": bool, "state": {...}}`, the state last set
//! - `POST /reset`: the neutral state
//! - `GET /touch`: whether touch injection is initialised, the contacts down, and what Windows says
//!   about touch (`GetSystemMetrics(SM_DIGITIZER)`, `SM_MAXIMUMTOUCHES`)
//! - `POST /touch/init`: initialises touch injection without touching anything; answers the
//!   metrics before and after
//! - `POST /touch`: `{"id": 0..9, "x": px, "y": px, "phase": "down" | "move" | "up"}`, or an array
//!   of them, injected as one frame. Screen pixels; an up lifts where the contact last was, so it
//!   needs no position. A touch lands on whatever window is at that point of the screen.
//! - `POST /touch/reset`: lifts every contact
//! - `POST /window`: `{"title": text, "front": bool}`, the one visible window whose title holds the
//!   text (409 for none or several): `{title, process, client: {x, y, width, height}, foreground,
//!   onTop}`, its client area in screen pixels. With `front`, it is kept on top of every other window,
//!   so that touches land on it, and Windows is asked to make it the foreground window.
//! - `POST /window/release`: lets the window kept on top go back among the others
//! - `POST /quit`: stops the service
//!
//! It unplugs the pad, lifts every contact and exits on Ctrl+C or a closed console, when its stdin
//! is a pipe that closes, when the process that started it ends, and on `/quit`. Killed outright,
//! it leaves no pad either: ViGEmBus unplugs the pads of a handle when the handle closes.
//!
//! Steam takes the pad too when its Xbox controller support is on ("Enable Steam Input for Xbox
//! controllers"): outside a Steam game, its desktop configuration then turns the pad's buttons and
//! sticks into keys and mouse input for the focused window, besides what XInput reports.

mod lifetime;
mod pad;
mod touch;
mod window;

use std::io::Read;
use std::time::Duration;

use serde_json::{Value, json};
use tiny_http::{Header, Method, Request, Response, Server};
use windows_sys::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};

use crate::pad::{Pad, PadState};
use crate::touch::{Touch, parse_frame};
use crate::window::{Find, Windows};

/// The port when none is given; the tests' fixture (`src/shared/fixtures/virtual-pad.ts`) and
/// `scripts/virtual-pad.mjs` use it too
const DEFAULT_PORT: u16 = 47110;

/// How long the loop waits for a request before it looks at the exit conditions and the touch
/// contacts held
const TICK: Duration = Duration::from_millis(20);

/// The largest body read
const MAX_BODY: u64 = 64 * 1024;

/// What a request answers: a JSON body, or a status with the reason
pub type Reply = Result<Value, (u16, String)>;

fn main() {
    let port = match parse_port() {
        Ok(port) => port,
        Err(why) => {
            eprintln!("virtual-pad: {why}\nusage: virtual-pad [--port {DEFAULT_PORT}]");
            std::process::exit(2);
        }
    };
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(server) => server,
        Err(error) => {
            eprintln!("virtual-pad: can't listen on 127.0.0.1:{port}: {error}");
            std::process::exit(3);
        }
    };
    lifetime::watch();
    // Screen positions in physical pixels, on every monitor whatever its scaling
    // Safety: a plain call
    unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };

    let bus = Pad::bus_status();
    if bus != "ok" {
        eprintln!("virtual-pad: {bus}; /connect will fail");
    }
    println!("virtual-pad: listening on http://127.0.0.1:{port}");

    let mut service = Service {
        port,
        bus,
        pad: Pad::default(),
        touch: Touch::default(),
        windows: Windows::default(),
    };
    while !lifetime::stop_requested() {
        match server.recv_timeout(TICK) {
            Ok(Some(request)) => service.answer(request),
            Ok(None) => {}
            Err(error) => {
                eprintln!("virtual-pad: the server failed: {error}");
                break;
            }
        }
        service.touch.hold();
    }

    // Lift every contact, unplug the pad and let the window kept on top go before the process ends
    if let Err((_, why)) = service.touch.lift_all() {
        eprintln!("virtual-pad: {why}");
    }
    let _ = service.pad.disconnect();
    let _ = service.windows.release();
    lifetime::cleaned_up();
    println!("virtual-pad: stopped");
}

/// `--port N` (or `--port=N`), or the default
fn parse_port() -> Result<u16, String> {
    let mut args = std::env::args().skip(1);
    let mut port = DEFAULT_PORT;
    while let Some(arg) = args.next() {
        let value = if arg == "--port" {
            args.next().ok_or("--port needs a value")?
        } else if let Some(value) = arg.strip_prefix("--port=") {
            value.to_string()
        } else {
            return Err(format!("unknown argument {arg:?}"));
        };
        port = value
            .parse()
            .map_err(|_| format!("{value:?} is not a port"))?;
    }
    Ok(port)
}

struct Service {
    port: u16,
    /// "ok", or why ViGEmBus can't be reached, as found at startup
    bus: String,
    pad: Pad,
    touch: Touch,
    windows: Windows,
}

impl Service {
    fn answer(&mut self, mut request: Request) {
        let reply = self.route(&mut request);
        let (status, body) = match reply {
            Ok(body) => (200, body),
            Err((status, why)) => (status, json!({ "error": why })),
        };
        let content_type = Header::from_bytes("Content-Type", "application/json").unwrap();
        let response = Response::from_string(body.to_string())
            .with_status_code(status)
            .with_header(content_type);
        if let Err(error) = request.respond(response) {
            eprintln!("virtual-pad: couldn't answer: {error}");
        }
    }

    fn route(&mut self, request: &mut Request) -> Reply {
        let host = header(request, "Host").unwrap_or_default();
        let local = [
            format!("127.0.0.1:{}", self.port),
            format!("localhost:{}", self.port),
        ];
        if !local.contains(&host.to_ascii_lowercase()) {
            return Err((403, format!("Host {host:?} is not 127.0.0.1:{}", self.port)));
        }
        let path = request.url().split('?').next().unwrap_or("").to_string();
        let method = request.method().clone();
        if method == Method::Post {
            let content_type = header(request, "Content-Type").unwrap_or_default();
            if !content_type
                .to_ascii_lowercase()
                .starts_with("application/json")
            {
                return Err((
                    415,
                    "a POST must have Content-Type: application/json".into(),
                ));
            }
        }
        let body = read_body(request)?;

        match (&method, path.as_str()) {
            (Method::Get, "/health") => Ok(json!({
                "service": "virtual-pad",
                "version": env!("CARGO_PKG_VERSION"),
                "bus": self.bus,
                "connected": self.pad.is_connected(),
            })),
            (Method::Post, "/connect") => self.pad.connect(),
            (Method::Post, "/disconnect") => self.pad.disconnect(),
            (Method::Get, "/state") => Ok(self.pad.state()),
            (Method::Post, "/state") => self.pad.set(parse::<PadState>(&body)?),
            (Method::Post, "/reset") => self.pad.reset(),
            (Method::Get, "/touch") => Ok(self.touch.status()),
            (Method::Post, "/touch/init") => self.touch.init(),
            (Method::Post, "/touch") => {
                let contacts = parse_frame(parse(&body)?).map_err(|why| (400, why))?;
                self.touch.apply(contacts)
            }
            (Method::Post, "/touch/reset") => self.touch.lift_all(),
            (Method::Post, "/window") => self.windows.find(parse::<Find>(&body)?),
            (Method::Post, "/window/release") => self.windows.release(),
            (Method::Post, "/quit") => {
                lifetime::request_stop("asked to quit");
                Ok(json!({ "stopping": true }))
            }
            (_, "/health" | "/connect" | "/disconnect" | "/state" | "/reset" | "/touch")
            | (_, "/touch/init" | "/touch/reset" | "/window" | "/window/release" | "/quit") => {
                Err((405, format!("{path} doesn't take {method}")))
            }
            _ => Err((404, format!("no {path} here"))),
        }
    }
}

fn header(request: &Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str().to_string())
}

fn read_body(request: &mut Request) -> Result<String, (u16, String)> {
    let mut body = String::new();
    request
        .as_reader()
        .take(MAX_BODY)
        .read_to_string(&mut body)
        .map_err(|error| (400, format!("couldn't read the body: {error}")))?;
    Ok(body)
}

/// The body as `T`; an empty body is `{}`
fn parse<T: serde::de::DeserializeOwned>(body: &str) -> Result<T, (u16, String)> {
    let body = if body.trim().is_empty() { "{}" } else { body };
    serde_json::from_str(body).map_err(|error| (400, format!("bad body: {error}")))
}
