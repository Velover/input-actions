# Testing place for @rbxts/input-actions

A roblox-ts place on Flamework v2 whose only job is to test the package in the repository root
(`../../src`) inside Studio. The template's coin example has been removed.

## Testing the package

- `bun run test:all` builds the package from `../../` and copies it into
  `node_modules/@rbxts/input-actions` (`scripts/link-package.mjs`, also `bun run link`), then runs
  every test section in Studio, in two groups of sections (see [Tests](#tests)), under six Rojo
  projects:
  - `default` (`default.project.json`): legacy player scripts;
  - `ias` (`tests/ias.project.json`): `Workspace.PlayerScriptsUseInputActionSystem = Enabled`;
  - `immediate` (`tests/immediate.project.json`): legacy player scripts, with
    `Workspace.SignalBehavior = Immediate`;
  - `ias-immediate` (`tests/ias-immediate.project.json`): the IAS player scripts, with Immediate
    signals;
  - `authority` (`tests/authority.project.json`): Server Authority on (with the IAS player scripts,
    next-generation replication, fixed simulation, streaming, deferred signals);
  - `touch` (`tests/touch.project.json`): the IAS player scripts, with Studio simulating a phone
    (see [The touch pass](#the-touch-pass)).
- Signals are Deferred everywhere else: `tests/place.rbxlx` sets it, and Server Authority requires
  it, so there is no Immediate `authority`. The `signal-behavior` section checks that each place
  runs the mode its project sets (no script can read the property: a BindableEvent's handler runs
  inside `Fire` only under Immediate).
- `bun run test`, `test:ias`, `test:authority` and `test:touch` run one project, and
  `test:immediate` runs the two Immediate ones. `getProject()` from `@flamework-experimental/testing`
  returns the project's name inside the place. What each project sets is in
  `src/shared/fixtures/projects.ts` (`usesIasPlayerScripts()`, `usesLegacyPlayerScripts()`,
  `expectedSignalBehavior()`): test that rather than project names.
- The package is not in `package.json`: the link script puts it in `node_modules`, and every test
  run refreshes it. Import it as `@rbxts/input-actions`.
- The design the package implements: `../../docs/Design/IAS-Rework.md`.
- The sections: `schema`, `rules`, `sanitize`, `presets`, `authority-mode`
  (`IsServerAuthority`), `signal-behavior` (the project's signal mode; IAS's and the handles' events
  under it, on the client), `devices` (0.7.0: binding names, keys per device; the client's part:
  the three device bindings on every action, `Set` and saves by device, `PreferredDevice`),
  `device-extras` (0.7.0's extra bindings per device: namespaces, reserved extra names, the extras'
  binding names, `SanitizeBindings` with extra paths; the client's part: the handles and
  `Extras()`, captures on extras with real keys, saves, adoption, root handles with other extras,
  the fill, a held action, the swap on a copy made by hand), `readable-errors` (0.7.0: the
  runtime refuses a binding in the compile errors' sentences) (shared);
  `create`, `actions`, `track-previous`, `contexts`,
  `attach-button`, `attach-label` (`AttachLabel`, `WhenLinkedToServer`), `rebinding`,
  `capture-chord` (`CaptureChord` with real keys), `device-capture` (device-locked captures and the
  action's one-field `Capture`/`CaptureChord` with real keys and VirtualInput's gamepad KeyCodes;
  sticks and triggers through the virtual pad, which skip unless pad input is on), `saves`, `mouse`, `input-catcher`, `raw-input`, `server-authority`,
  `shared-handles` (several `Create`s on one folder, `Destroy`), `sa-release` (what reaches the
  server when the client resets an action; authority only), `real-input` (real keys and mouse
  through VirtualInput), `rebind-held` (changing a binding while its action is held, on a local
  context and on the server's copy), `touch` (taps on the simulated phone; touch only),
  `preferred-device` (0.7.0's `PreferredDeviceChanged`: nothing for the same device; a key press and
  a tap under `touch`; the virtual pad plugged in, opt-in), `describe` (keybinds as text: key names
  for every KeyCode, bindings and actions, after rebinds and a real capture), `conflicts`
  (`FindConflicts` on root and context handles, every pair, a real capture then a clear),
  `gestures` (`OnTap`, `OnDoubleTap`, `OnHold`, `OnLongPress` with real keys; a context or the
  action disabled, a request, a rebind, the focus-loss reset and the swap on a copy made by hand
  mid-gesture; `Destroy`; bad options) (client);
  `server-authority` (server). The `validator-r*`, `hunter-r*`, `hunter-chord*`, `hunter-label*` and
  `hunter-devices*` sections are reviewers' adversarial tests, kept as regression tests. Fixtures
  are in `src/shared/fixtures/` (`schemas.ts`; `extras.ts`, the `device-extras` schema;
  `projects.ts`, what each project sets; `authority.ts`, the mode each project
  expects and the warnings' wording; and
  `validator-r4.ts`, `validator-r5.ts`, `validator-r6.ts` and `hunter-r2-fixture.ts` for those
  rounds' sections). Project-specific tests skip under the other projects (`getProject()`, then
  `return skip("the authority project only")`), so the summary counts them as skipped.
- **Real keyboard and mouse input:** `src/client/tests/virtual.ts` wraps
  `UserInputService:CreateVirtualInput()` (Studio only; the typings return `RBXObject`, so it is
  cast to `VirtualInput`), whose input IAS treats as hardware, also with the window in the
  background. `realInput()` gives a test a `RealInput` (`Press`, `Release`, `Tap`, `MouseDown`,
  `MouseUp`, `Click`, `Wheel`, `MouseDelta`), or the reason there is none. What a test presses is
  released when the test ends, pass or fail: pressing a key or button that is already down throws,
  and a held key would leak into later tests. Rules:
  - mouse positions are screen positions, counted from the screen's corner: a GUI position plus the
    GUI inset (58 px here) and, under the simulated phone, the safe area on the left (47 px on the
    iPhone 14; measured in hunt round 4, where `AbsolutePosition + inset` put taps 47 px left of
    their target). `toScreen(guiPosition)` converts, from where a ScreenGui with `IgnoreGuiInset`
    and `ScreenInsets = None` starts; use `screenCenter(guiObject)` for a GUI object, and
    `emptyPoint()` for a point over the 3D world clear of CoreGui and the touch controls;
  - input that would touch CoreGui throws: the top-left menu area, Escape and other keys Roblox
    reserves (VirtualInput sends gamepad KeyCodes as keyboard input, and `DPadUp`, `ButtonStart`
    throw), and anything while the Roblox menu is open;
  - a mouse press sent right after a release landed can be lost: no `InputBegan`, the cursor doesn't
    move, nothing is pressed (measured on 2026-10-03: a press on empty space sent at once after a
    click's `Activated` was lost 5 times in 13, never a frame or two later; real-input's
    "AttachButton with a real click" failed so in about a third of the full runs).
    `RealInput.MouseDown` waits two frames after the test's last `MouseUp`;
  - `pointerReport(point)` says, for a failure message, what could have taken or moved a click
    there: the cursor's behaviour and the buttons down, the camera's distance, the GUI under the
    point, CAS actions on the left button, enabled IAS contexts that bind it or sink;
  - `SendMouseDelta` registers only while the cursor is locked: `moveLockedMouse(real, delta)` in
    `real-input.ts` locks it through `MouseController`, and returns false when it never locks, for
    the test to skip. `SendMousePosition` doesn't register while the window is unfocused, so no
    test depends on it;
  - a window that renders nothing (display off) has no GUI layout: `clickProblem(guiObject)` says
    so, and the test skips;
  - `Wheel` notches zoom the player's camera too (measured under `default`: 12.5 studs, then 7.8,
    4.7, 2.5, and first person at the fourth notch in). First person locks the cursor at the
    centre, and every later click then misses its button, with errors that look unrelated.
    `RealInput` sends a test's notches back, last first, when the test ends (a notch the other way
    right after one cancels it at once). Don't send more than three notches in a row the same way
    within a test, and send wheel input through `Wheel`, not through `Device`;
  - Legacy player scripts (`default`) sink `Left`, `Right`, `I`, `O` (camera) and toggle shift lock
    on `LeftShift` through CAS: real-input tests use other keys;
  - other sections leave contexts running: once the client's `server-authority` section has run,
    the server's template `ReplicatedStorage.InputActionsTestTemplates.SaGameplay` is enabled again
    (`Destroy` gives an adopted template its `Enabled` back) and sinks `F` and `H` below its
    Priority 1700 (probed in device hunt round 3, where a Priority 10 context lost `H` whenever that
    section ran first). Give a context that takes real keys a Priority above 2000;
  - under `authority`, the state of a copy under the player (the server's copy, or a context a test
    makes in `LocalPlayer`) moves on simulation steps, 60 Hz, while a frame is about 5 ms: wait for a
    change there with `eventually`, not a fixed few frames (hunt round 4 saw `frames(3)` end before
    a release showed). A fixed wait is for checking that something does *not* happen;
  - the Studio window may lose focus during a run (the user working in another window), and the
    focus-loss reset of every root handle made with the default `ResetOnFocusLoss` then releases what
    a test holds. A test that holds keys and doesn't test that reset can create its input with
    `ResetOnFocusLoss: false`; `real.FocusNote()` adds to a failure message whether the window lost
    focus during the test.
- **Real gamepad input (buttons, sticks and triggers measured on 2026-10-03, with Steam closed and
  Studio's run window focused; with the window unfocused, unmeasured):**
  `tools/virtual-pad` is a Rust service that plugs a virtual Xbox 360 pad into Windows through the
  ViGEmBus driver and sets its state over HTTP on `127.0.0.1:47110` (the API is at the top of its
  `src/main.rs`). `bun run test` starts it before the projects run and stops it after them
  (`scripts/virtual-pad.mjs`; a service already running is used and left running), building it with
  `cargo build --release` when its sources are newer; without cargo or the driver the run warns and
  goes on. It plugs no pad until a test asks, and unplugs it when it stops (Ctrl+C, its stdin
  closing, its parent ending; ViGEmBus unplugs a killed one's pad itself). HttpService works on
  the server only, so `src/server/tests/virtual-pad.ts` forwards the client's calls through
  `ReplicatedStorage.InputActionsVirtualPad` (about 0.2 s a call from the client; 3 ms from the
  server), and `virtualPad()` in `src/client/tests/virtual-pad.ts` gives a test a `VirtualPad`
  (`Connect`, `Disconnect`, `Press`, `Release`, `Tap`, `SetStick`, `SetTrigger`, `Reset`, by
  Roblox KeyCodes) or the reason there is none. What a test holds is released and the pad unplugged
  when the test ends, pass or fail.
  - **The pad is opt-in, plugging it in included.** Every process on the machine sees a plugged-in
    pad, the user's Roblox Player too, whose UI switches to gamepad mode; and while Steam's "Enable
    Steam Input for Xbox controllers" is on, Steam turns the pad's buttons and sticks into keys and
    mouse input for whatever window is focused. So the service refuses `/connect` unless it was
    started with `--allow-plug`, and any pad state but the neutral one (and touch injection, and
    `/window` with `front`) unless it was started with `--allow-input` (which implies
    `--allow-plug`). `scripts/virtual-pad.mjs` passes `--allow-plug` only when the environment
    variable `VIRTUAL_PAD=1` is set, and `--allow-input` only when `VIRTUAL_PAD_INPUT=1` is (turn
    Steam Input for Xbox controllers off, or exit Steam, first). Without them `virtualPad()` answers
    the reason ("the virtual pad is off (VIRTUAL_PAD=1)", or "pad input is off (VIRTUAL_PAD_INPUT=1,
    Steam Input off)": short, see [Tests](#tests)) and the gamepad tests `skip` with it; `virtualPad({ Input: false })` is for a test that only plugs the pad in, which
    needs `VIRTUAL_PAD=1` alone. `/health` reports `plug` and `input`. A service already running is
    used as it is: when it allows less than the variables ask for, the run warns.
  - Measured on 2026-10-03 (`default`, `ias`, `touch`):
    - plugging the pad in, with no input, fires `GamepadConnected` (Gamepad1) and switches
      `PreferredInput` to `Gamepad` within 0.3 s; every action without a gamepad binding then has no
      `PreferredBinding` and its `InputActionLabel` shows nothing. Unplugging switches back as fast.
      Under `touch`, after a tap (`MouseEnabled`, `KeyboardEnabled` then read false) plugging in
      leaves `PreferredInput` at `Touch` and `GamepadEnabled` false;
    - IAS never prefers an empty `InputBinding` (no KeyCode, no composite): empty bindings named
      `Gamepad` or `Touch` beside a Space binding change nothing, and an empty `Touch` binding doesn't
      beat a UIButton binding (under `touch` the UIButton binding is preferred; its label reads
      `None`). A Space binding's label reads `" "`;
    - Steam's Xbox controller support is on here, so while Steam runs, its desktop configuration also
      turns the pad's buttons and sticks into keys and mouse input for the focused window: pad input
      runs only with Steam closed (check `Get-Process steam` first; never start Steam).
  - Measured with pad input on (2026-10-03, Steam closed, the run's window focused; every project):
    - buttons: `InputBegan` with `Position.Z` 1, `InputEnded` with 0, `UserInputType` `Gamepad1`;
    - sticks: `InputChanged` only (`Change`), `Position` raw (no deadzone), y positive up;
    - triggers: `InputChanged` at every change (`Position.Z`, raw), `InputBegan` only at 1,
      `InputEnded` only back at 0 (also after a pull that never reached 1). A trigger's first move
      after `Connect`, from rest to about 0.45 to 0.6, raises nothing: start a trigger at 0.3 or
      0.8 (`SetTrigger`'s doc comment);
    - the legacy player scripts (`default`, `immediate`) sink `ButtonA` and `Thumbstick1` through
      CAS (the ControlModule): they arrive game-processed, captures ignore them and IAS bindings on
      them don't fire. Pad tests use the right stick there (`freeStick()` in `device-capture.ts`).
      Under the IAS player scripts nothing arrives game-processed, and IAS bindings on `ButtonA`,
      `Thumbstick1` and `Thumbstick1Up` fire;
    - IAS reads sticks past a radial deadzone of 0.1 and triggers past a linear 0.1, rescaled: a Bool
      on `ButtonR2` pressed at raw 0.561 and released at 0.251. The captures read them the same way
      (PAD-1), so test thresholds with margins: raw 0.52 is no key, 0.6 is;
    - `padEvents()` and `eventuallyPad()` in `device-capture.ts` put the pad's last events in a
      failure message.
  - Run the pad sections with pad input from Git Bash:
    `VIRTUAL_PAD_INPUT=1 bun run test --keep-awake --realm client --sections device-capture,devices,hunter-devices --project <files>`
    (the project files, comma-separated, as `test:all` gives them).
- **Touch from Windows (`POST /touch`, `POST /window`) reaches Studio as mouse input:** injected
  touches (InitializeTouchInjection) arrive as `MouseButton1` and `MouseMovement`, never as touch,
  whether injection started before Studio or during the session; `TouchEnabled` stays false; of two
  contacts only the first arrives (a drag), so no `TouchPinch`. A tap lands 1:1 at a fixed offset
  from GUI coordinates: `POST /window` (`{title, front}`) finds the run's window, keeps it on top so
  the touch lands on it, and gives its client area in screen pixels. Starting injection makes
  Windows report a touch screen to every process (`SM_DIGITIZER` 140 to 205, `SM_MAXIMUMTOUCHES` 1
  to 10) until the service exits, so only a test that asks starts it. Use `VirtualInput` under
  the `touch` project for touch instead.
- **Skipping:** a test that can't run here (another project, no VirtualInput, a cursor that never
  locked, a window that renders nothing) calls `skip(reason)` from `@flamework-experimental/testing`,
  as `return skip(reason)` at the top level of its body. It ends the test, and each realm's summary
  counts it as skipped and lists it with its reason; it fails nothing unless the run has
  `--fail-on-skip`, which `test:all` can't use (every project skips the others' tests). A plain
  `return` counts as a pass, so it is only for a test whose checks so far are the test, such as the
  wheel half of `hunter-r1`'s UiNavigation test under `touch`. Keep `skip` out of `pcall`,
  `expectThrows`, `eventually` and spawned threads.
- Gamepad input, window focus and the Roblox menu can't be simulated from Luau: those paths are
  driven through Scriptable bindings (`Fire`) and the TextBox focus path (the virtual pad above,
  with pad input on, for gamepads). VirtualInput's gamepad KeyCodes (`ButtonX`, sent as keys) don't
  press IAS gamepad bindings, but the captures classify a key by its KeyCode, so they drive the
  device-locked gamepad captures (`device-capture`).
- The server's `server-authority` provider hosts `ReplicatedStorage.InputActionsTestServer`, a
  RemoteFunction the client's section calls to have `SA_SCHEMA` (`"sa"`) or `SA_LATE_SCHEMA`
  (`"late"`, provided only after the client's `Create`, to test the stand-in swap) provided, and to
  read the server's state (`"playerModule"` reads Roblox's own `player.InputContexts` actions,
  `"copyState"` any action of the player's copy, including ones the schema doesn't mention).
- `tests/type-rules/type-rules.ts` holds the compile-time rules (`@ts-expect-error` cases), beside
  the later files listed in `tests/type-rules/tsconfig.json` (`features-type-rules.ts` also pins
  each readable compile error's sentence, through the package's internal `CheckBindings` type).
  roblox-ts refuses those directives, so plain `tsc -p tests/type-rules` checks them
  (`bun run typecheck`; about 2.35 s of `tsc`, 2026-10-03); `bun run build` and `bun run test` run
  it, and an unused directive fails them.
- **With the display off, Studio renders nothing.** `RenderStepped` and `BindToRenderStep` never
  fire while Heartbeat keeps running at about 240 Hz; it renders again as soon as the display is
  back on. Measured on 2026-10-01 by turning the displays off during a play session: 0 render steps
  a second while off, about 150-180 while on. Long unattended runs hit this when the machine idles
  with its screen off, so `bun run test:all` passes `--keep-awake`, which `scripts/test.mjs` holds
  from its start to its end (flamework-test alone holds it only while each of its calls lasts, and
  the touch pass starts Studio between them); give any other unattended run the flag too.
  Minimizing the window does not stop rendering: a play session minimized as it opened kept
  rendering at about 60 fps (about 200 fps when visible). The render cadence never follows
  Heartbeat. The package's per-frame work (`src/Internal/EveryFrame.ts`) runs once per frame, at
  the render step or else at
  `PreAnimation`, so tests must hold either way; code that only binds to a render step may never
  run in a test. Such a window also has Heartbeat ticks with no `PreAnimation`, `PreSimulation` or
  `PostSimulation` (measured: 9 to 87 of 600 ticks, with nothing else running). The package's
  per-frame work skips them unless a render step lands in one (a window that renders may render in
  such a tick, and the work then runs there), so a test must not count a Heartbeat as a frame: step
  with `frame()` from `src/client/tests/helpers.ts`, which waits for a Heartbeat that follows a
  render step or a `PreAnimation`, the ticks in which the per-frame work runs.
- To try package code in a live session, go through a test (a temporary section run with
  `--sections`): `studio exec` can't `require` the package's modules directly.
- To try Luau in a live session: `rojo build -o probe.rbxl`, then
  `node_modules/.bin/flamework-test patch probe.rbxl --original tests/place.rbxlx [--project tests/authority.project.json]`,
  `studio open <patched file>`, `studio play`, `studio exec --realm client|server --script <file.luau>`,
  `studio stop`, `studio close`.

## The touch pass

`bun run test:touch` (and the last part of `bun run test:all`) runs every section with Studio
simulating an iPhone 14, so `UserInputService.PreferredInput` is `Touch` and VirtualInput's mouse
events arrive as touch: taps (`TouchPosition`), drags (`TouchDelta`), `UIButton` taps, `UIModifier`
regions. One finger only: no pinch, no multi-touch. Tests that need a mouse skip under it, and the
`touch` section runs only under it.

`flamework-test test` has no step between opening a window and playing, so `scripts/test.mjs` hands
every project named in `DEVICE_PROJECTS` (`scripts/device-test.mjs`) to `runOnDevice`, after the
other projects:

1. `flamework-test patch` makes `test.touch.rbxl` under `tests/touch.project.json`;
2. a window left open on that file by an earlier run is closed;
3. Studio is started on the file, and the run waits (up to 180 s) for it to show on the MCP proxy;
4. `flamework-test studio exec --studio test.touch.rbxl --realm edit` calls
   `game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("iphone_14")`;
5. `flamework-test studio run --studio test.touch.rbxl --realm both` runs the tests, and stops the
   play session (`--sections`, `--realm`, `--timeout`, `--list`, `--json`, `--fail-on-skip` and
   `--keep-awake` are passed on; `--keep` is not, see step 7);
6. **always**, also after a failure, a timeout or Ctrl+C, `SetDeviceAsync("default")` sets the
   device back, and the run says so (`Studio's device is back to default`). Only the Edit data model
   can set it (`Edit datamodel is not available in Play mode`), so a play session still running is
   stopped first (`studio status`, then `studio stop`): after Ctrl+C the CLI may still be stopping
   it;
7. the window is closed by ending the Studio process the run started. With `--keep` it stays open,
   in Edit: the play session can't be kept, since the device can't be set back during one (hunt
   round 4 found `--keep` left the phone simulated).

The device is Studio's setting, not the place's: left set, it follows into every other Studio
window. A run killed outright (a closed terminal, a tool's time limit) never reaches step 6, so
the run writes a marker, `input-actions-testing-device.json` in the system temp folder, just before
step 4, and removes it once step 6 has set the device back. Every `bun run test` looks for it after
building `test.rbxl` and before any project runs: when it is there, the run opens a window of its
own on a copy, `test.device-restore.rbxl`, sets the device back there, closes it, and goes on; when
that fails, it stops and says how to fix it by hand. Outside the `touch` project, the `real-input`
section's first test also fails when a click arrives as a tap.

If a run reports `STUDIO MAY STILL SIMULATE iphone_14`, set it back by hand, in any open Studio
window, then delete the marker:

- in the command bar (View > Command Bar), run
  `game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("default")`;
- or, while a window of `test.touch.rbxl` is open,
  `bunx flamework-test studio exec --studio test.touch.rbxl --realm edit --code 'game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("default") return game:GetService("StudioDeviceSimulatorService"):GetDeviceAsync()'`,
  which should print `default`.

Ctrl+C during the touch pass stops the CLI's current step; the script itself carries on to stop the
play session, set the device back and close the window, then rebuilds `out/` and exits with 130.
The window helpers come from flamework-test's own `cli/src/studio.ts` (finding Studio, telling a
play session, and closing a window by the process that opened it). The Flamework packages are
pinned exactly, so that module moves only on an upgrade: check the imports then (2.0.0-alpha.6 made
`runCloseScript` async).

## Stack

- roblox-ts 3.0.0 (`rbxtsc`) compiles `src/` to Luau in `out/`. TypeScript is pinned to 5.5.3, the
  version roblox-ts 3.0.0 bundles.
- Rojo 7.7 (`aftman.toml`) builds the place from `default.project.json`.
- **Flamework v2 alpha**, all five pinned exactly; upgrade them together, to one release:
  - `@flamework-experimental/core`, `networking` and `testing` 2.0.0-alpha.6, `components`
    2.0.0-alpha.5;
  - `@flamework-experimental/transformer` 2.0.0-alpha.7, the tsconfig plugin.
  - Since 2026-10-01 Studio runs its MCP server's Luau sandboxed, and a place built with testing
    2.0.0-alpha.5 or earlier fails every Studio run with `cannot invoke 'FlameworkTests'`: keep
    `testing` at alpha.6 or later.
  - `testing` is in every build, not only test builds: both entry points include its
    `TestingPlugin`, which stays inert without the `testing` scope. A mismatched version breaks
    the game too.
- Not v1: `@flamework/*` and `rbxts-transformer-flamework` are v1, and the Flamework website
  (flamework.fireboltofdeath.dev) documents v1. Don't use v1 docs, or v1's API from memory.
- Package manager: bun, one lockfile (`bun.lock`).

## Flamework docs

The guides for the installed version ship inside core, in
`node_modules/@flamework-experimental/core/docs/guide/`. They are the reference for this version:
read the matching guide before you write Flamework code you are not sure of. Most of their install
commands use npm; use bun here.

| Guide                     | For                                                                         |
| ------------------------- | --------------------------------------------------------------------------- |
| `01-getting-started.md`   | install, tsconfig, Rojo mapping, entry points, common errors                |
| `02-modules.md`           | modules, ignition, `Dependency<T>()`                                        |
| `03-providers.md`         | `@Provider`, registration by folder, injection, lazy providers, `loadOrder` |
| `04-lifecycle-events.md`  | `onInit`, `onStart`, `onTick`, `onPhysics`, `onRender` and their order      |
| `05-components.md`        | components, attributes, instance trees, links, streaming, `Components`      |
| `06-networking.md`        | events, functions, middleware, serialization                                |
| `07-macros.md`            | `Flamework.id`/`createGuard`/`env`, `requireModules`, macros of your own    |
| `08-plugins.md`           | plugins                                                                     |
| `09-project-structure.md` | layout, `flamework.config.json`, obfuscation, `.env`, what to commit        |
| `10-migrating-from-v1.md` | porting v1 code, or advice written for v1                                   |
| `11-scopes.md`            | build scopes                                                                |
| `12-testing.md`           | tests that run inside the place                                             |

## Commands

- `bun install`.
- `bun run build` runs `rbxtsc`. It is the check: it must exit 0 and print no `error TS` and no
  Flamework warning. Colour codes can split `error TS` and `[Flamework]` even in a log, so search
  a log for `error` and `Flamework`.
- `bun run watch` rebuilds on change. It keeps the `flamework.config.json` and `.env` it started
  with, so restart it after changing either.
- `bun run serve` runs `rojo serve` to sync into Studio, and `bun run place` builds `place.rbxl`.
  Build first: the project maps `out/` and `include/`.
- `bun run test` runs the tests in Studio; see [Tests](#tests).
- `bun run format` runs Prettier on `src/`: tabs, a width of 100, trailing commas.
- Add packages with `bun add <name>`, or `bun add -d <name>` for build tools. Add a
  `@flamework-experimental/*` package with `bun add --exact`, at the version of the release the
  others come from (the monorepo's
  [CHANGELOG](https://github.com/Velover/ExperimentalFlameworkV2/blob/HEAD/CHANGELOG.md) heads
  each release with the versions it changed, which differ per package; one it leaves out keeps its
  earlier version). It needs no mapping: `default.project.json` maps the whole scope.
- The template this place came from is
  [FlameworkV2Template, branch `testing`](https://github.com/Velover/FlameworkV2Template/tree/testing);
  last brought in at `a74ebbe` (testing 2.0.0-alpha.6). Its later commits show what to bring in next.

## Where things live

| Path                           | Realm  | Holds                                                               |
| ------------------------------ | ------ | ------------------------------------------------------------------- |
| `src/server/runtime.server.ts` | server | the entry point: builds and ignites the server's module             |
| `src/server/services/`         | server | `@Provider` classes, registered by `registerProviders`              |
| `src/server/components/`       | server | `@Component` classes, registered by `ComponentPlugin.fromPath`      |
| `src/server/network.ts`        | server | the server's `Events` and `Functions`, with their middleware        |
| `src/server/middleware/`       | server | networking middleware                                               |
| `src/client/runtime.client.ts` | client | the entry point: builds and ignites the client's module             |
| `src/client/controllers/`      | client | `@Provider` classes, registered by `registerProviders`              |
| `src/client/components/`       | client | `@Component` classes, registered by `ComponentPlugin.fromPath`      |
| `src/client/network.ts`        | client | the client's `Events` and `Functions`                               |
| `src/shared/network.ts`        | both   | the network declarations: `GlobalEvents`, `GlobalFunctions`         |
| `src/shared/`                  | both   | plain modules both realms import, such as `tags.ts` and `levels.ts` |

- In the place: `src/server` is `ServerScriptService.TS`, `src/client` is
  `StarterPlayer.StarterPlayerScripts.TS`, and `src/shared` is `ReplicatedStorage.TS`.
- Components for both realms go in `src/shared/components/`, registered from both entry points.
- Generated and git-ignored, never edited: `out/`, `include/` (including `include/flamework/`) and
  `flamework.build`. `flamework.config.json` is config: commit it and keep its `$schema` line.

## Tests

- `bun run test` (`scripts/test.mjs`) builds with `FLAMEWORK_SCOPES=testing` and makes `test.rbxl`.
  `flamework-test` then lays that over `tests/place.rbxlx` and runs every section in Studio, on the
  server and then on the client. It needs Studio's "MCP server" setting on, and `lune`. Each realm's
  summary counts passed, failed and skipped tests, and lists each skip with its reason. A failure
  exits non-zero; a skip does not, unless the run has `--fail-on-skip`. Give a run nobody watches
  `--keep-awake` (`test:all` has it): while the display sleeps, RenderStepped stops.
- Each realm's run may take 600 s (`--timeout 600s`, which `scripts/test.mjs` passes unless the
  command line gives its own). flamework-test's own 120 s is too short: the client's run under
  `authority` takes about 160 s, since its real-input tests wait on the server. A run past the limit
  reports `did not finish within ... (--timeout)` and no results for that realm.
- **A realm's result must stay under 100,000 characters.** flamework-test reads each realm's
  result (JSON: every test's name, status, time and skip reason) as the answer of one
  `execute_luau` call, and Studio's MCP cuts an answer at 100,000 characters, adding
  `... (truncated)`: the run then reports `the task result was not JSON` and fails that realm,
  every test passed or not. Measured on 2026-10-03 with the `hunter-devices` section added: the
  client's result of every section was 99,848 characters under `ias` and past the cut under
  `default` and `touch`; with the virtual pad's skip reasons (41 tests) shortened, 99,142 and
  99,908. So a run without `--sections` (or `--list`) is split: `scripts/test.mjs` reads the
  sections from the test folders (`defineTests("name"`) and runs them in `SECTION_GROUPS` (2)
  groups of about as many tests each, one Studio session per group and project, each with its own
  summaries. With `--realm server` or `--realm client` it reads that realm's folders only (the
  realm's own and `src/shared/tests`): flamework-test running one realm fails it on a `--sections`
  entry the realm doesn't have (`MISS matched nothing`, hunt HD2-2). A run with `--sections` is one
  run, as given: keep such a list well under the cut, and with `--realm`, to that realm's sections.
- Tests live in `src/server/tests`, `src/client/tests` and `src/shared/tests` (both realms). Each
  test file is a `@Provider({ activeIn: ["testing"] })` that calls `defineTests` in `onStart`;
  `src/server/tests/players.ts` is a plain module of helpers beside them. The entry points register
  those folders only under the `testing` scope. When something known only at run time rules a test
  out, it calls `skip(reason)`, which the summary lists; a plain `return` would count as a pass.
  `.claude/rules/testing.md` has the details.
- Whether the tests pass or fail, `bun run test` ends by rebuilding `out/` with `FLAMEWORK_SCOPES`
  set to nothing, so `rojo serve` and `bun run place` never ship the test host. Never put the scope
  in `.env` or `.env.local`: every other build reads them. A run stopped with Ctrl+C skips the
  rebuild, so `out/` keeps the test build: run `bun run build`. `flamework-test` still stops its
  play session and closes its Studio window, in the seconds after the prompt comes back (the touch
  pass: [The touch pass](#the-touch-pass)). Every run leaves `test.rbxl` and `test.patched.rbxl`
  behind; they are git-ignored.

## Flamework v2 rules

- Every singleton is `@Provider()` from core, on both realms. There is no `@Service` or
  `@Controller`: the entry point that registers a folder decides the realm.
- Only classes under a registered folder exist at runtime. A new folder needs its own
  `registerProviders("src/...")` or `ComponentPlugin.fromPath("src/...")` line in the entry point of
  each realm that uses it. The argument is a string literal and a source path, not a Rojo path.
- A registered folder must exist, spelled as on disk (case included), and hold a module. The build
  still passes without one, but warns at the call: `there is no such file or folder`, or
  `nothing in that folder compiles to a module`. A missing folder makes the call wait forever at
  runtime, warning after 5 s that it `is still waiting for its folder`. An empty folder is copied
  into the place and registers nothing, but git keeps no empty folder, so a fresh clone lacks it and
  waits.
- Registered folders must not overlap (`src/server` and `src/server/services`): ignition raises
  `provider ID was registered more than once`.
- Registration requires every ModuleScript under a registered folder at startup. A module that
  errors at its top level fails ignition. Keep modules that are neither providers nor components
  outside those folders, as `network.ts` and `middleware/` are. The exception is a plain helper
  that does nothing as it loads and serves only that folder, such as `src/server/tests/players.ts`.
- Classes are found whether exported or not, if declared at the top level of a file or namespace.
  Export them anyway when another file, or a test, imports them.
- Inject providers through the constructor. `Dependency<T>()` is for code without a constructor,
  once the module has ignited; never call it at a module's top level.
- Components attach only after every provider's `onStart` has run to its first yield. In a
  provider's `onStart`, `getAllComponents<T>()` finds none yet: use `onComponentAdded<T>()`.
- Settings go in `flamework.config.json`, one section per package. The tsconfig plugin entry holds
  only `"transform"` (and `"configFile"`, to move that file); the build refuses any other key.

## Gotchas

- Most of Flamework's API is macros that the transformer fills in. Without the transformer they
  are silently `nil`: read the emitted Luau in `out/` when an argument is unexpectedly missing.
- Keep TypeScript at the version roblox-ts bundles. Any other version makes every build warn
  `TypeScript version differs`, and the editor checks with a different compiler than the build.
- `default.project.json` maps all of `node_modules/@flamework-experimental` in one line, which needs
  transformer 2.0.0-alpha.5 or later (older ones put their JSON schemas in ReplicatedStorage). The
  place gets an empty `transformer` Folder, and core's guides as two empty Folders, `core.docs`
  and `core.docs.guide`: all expected.
- The build is not incremental, so an upgraded transformer just rebuilds. With `incremental` on,
  the first build after an upgrade stops with
  `Project was compiled on different version of Flamework` and names the tsbuildinfo to delete;
  delete it and build again.
- Line endings are LF everywhere: `.gitattributes` sets `eol=lf`, which overrides `core.autocrlf`.
- Shared modules run on both realms, and `Players.LocalPlayer` is undefined on the server. Guard
  realm-specific top-level code with `RunService.IsServer()`/`IsClient()`.
