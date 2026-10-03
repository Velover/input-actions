# Advanced usage

Each feature in full. For the everyday tasks as recipes, start with the [Guide](Guide.md). Rare
situations (several `Create`s on one folder, the Server Authority swap step by step, what happens to
a held action when its bindings change) are in [Edge cases](EdgeCases.md).

- [Contexts](#contexts)
- [Get-or-create in detail](#get-or-create-in-detail)
- [Driving actions from code](#driving-actions-from-code)
- [On-screen buttons](#on-screen-buttons)
- [Keybind labels](#keybind-labels)
- [TrackPrevious](#trackprevious)
- [Gestures](#gestures)
- [Rebinding](#rebinding)
- [Saving keybinds](#saving-keybinds)
- [Several bindings per device](#several-bindings-per-device)
- [Server Authority](#server-authority)
- [UI navigation preset](#ui-navigation-preset)
- [IAS behaviours to know](#ias-behaviours-to-know)

## Contexts

```ts
Input.Ui.SetEnabled(true); // the base state
Input.Ui.IsEnabled(); // the effective state
Input.Ui.EnabledChanged.Connect((enabled) => {});
const release = Input.Gameplay.Request(false); // held until release() is called
Input.Ui.Instance.Priority = 3500; // the InputContext itself, for Priority and Sink
```

- The effective state is `false` while any `Request(false)` is held, else `true` while any
  `Request(true)` is held, else the base state. The base state starts as the instance's `Enabled`
  after get-or-create. Calling a release function twice does nothing.
- The handle owns `InputContext.Enabled`: set it through the handle, not on the instance.
- Disabling a context releases its held actions: IAS fires `Released`. Under Server Authority the
  package makes that release reach the server too (see
  [Releasing on the server](EdgeCases.md#releasing-on-the-server)).
- **Focus loss.** A key held when a TextBox takes focus, the window loses focus or the Roblox menu
  opens can have its release swallowed, and stay stuck: IAS itself keeps a held action pressed when a
  TextBox takes focus or the Roblox menu opens. By default `Create` holds every context disabled for
  one frame on `UserInputService.TextBoxFocused`, `WindowFocusReleased` and `GuiService.MenuOpened`,
  which releases them. Listeners see one `false`/`true` pair on contexts that were enabled, and the
  base state doesn't change. Turn it off with `Create(schema, { ResetOnFocusLoss: false })`.
- Actions have `SetEnabled`/`IsEnabled` too, which pass through to `InputAction.Enabled`; IAS resets
  an action's state when it is disabled (and the package releases it on the server first, as for
  contexts).

## Get-or-create in detail

- `Create` looks in `ReplicatedStorage.Inputs` (created client-side when missing), or in
  `options.Folder`. Contexts can live anywhere in the DataModel.
- An existing action whose `Type` differs from the builder's type throws, naming the path
  (`Gameplay/Jump`). `Create` checks this before it changes anything, so a `Create` that throws
  leaves the folder as it was: it fills no unbound binding and releases no held action.
- An adopted binding whose keys break the type rules (another device's key included) is left as it
  is, with a `warn` naming it.
- Every action gets the three device bindings: the folder's (`JumpTouch`, say, adopted as the Touch
  binding even when the schema leaves Touch out), else one made with no keys. IAS never prefers a
  binding without keys, so an unbound one changes nothing for `GetPreferredBinding()` or a keybind
  label. A device's extras are found as `<Action><Device><Extra>` or `<Device><Extra>`
  (`MoveKeyboardAndMouseArrows`), else made (see [Several bindings per device](#several-bindings-per-device)).
- Instances the schema doesn't mention are left alone (IAS still runs them) and are not typed. In
  Studio, each gets one `warn`. That includes bindings whose names match no slot, such as the
  Manager's default name `InputBinding`, because they run beside the package's own binding.
- `Create` twice on the same folder adopts the same instances and creates nothing twice: the root
  handles share them, with one enabled state per context and one set of defaults per binding. How
  a later schema fills what an earlier one left out, and what destroying one of them lets go of:
  [Several root handles on one folder](EdgeCases.md#several-root-handles-on-one-folder).
- `Input.Destroy()` disconnects everything, releases what the package was holding, and destroys
  what it created. Adopted instances stay: adopted contexts get their base state back, and adopted
  bindings their defaults (rebinds are undone, so a later `Create` starts from the same defaults).
  After `Destroy` the handles change nothing: `Fire`, `AttachButton`, requests, rebinding and
  imports are ignored, and a `WhenLinkedToServer` callback never runs. An event fired just before
  it can still arrive, and an action still held once its bindings are gone is reset (see
  [Destroy](EdgeCases.md#destroy)).

## Driving actions from code

```ts
Dash.Fire(true); // through a Scriptable binding `<Action>Script` made on first use
Move.Bindings.Virtual.Fire(new Vector2(0, 1)); // a slot declared InputActions.Scriptable
Jump.Tap(); // Fire(true), then Fire(false) on the next frame
```

- The value goes straight into the action state: IAS applies no `Scale`, clamp or `Vector2Scale` to
  fired values.
- On the server's copy of a Server Authority context the state moves on simulation steps, which
  can be several frames apart. `Tap` waits for its press to show in the state before it releases,
  so the server sees the press; your own quick true/false pairs should do the same.
- A fired value stays until something changes it: fire the value at rest (`false`, `0`,
  `Vector2.zero`) when your on-screen control is released.
- Several bindings on one action are not combined: the last one to change wins (see
  [below](#ias-behaviours-to-know)). That holds between a Scriptable binding and the device ones.

## On-screen buttons

```ts
const detach = Jump.AttachButton(jumpButton); // a GuiButton
detach(); // or destroy the button
```

`AttachButton` (Bool actions only) adds an Automatic binding `<Action>UIButton<n>` (the lowest free
`n`) with `UIButton = button`. Several buttons can be attached at once. A button that is already
destroyed gets no binding, and the function returned does nothing. Destroying a binding while
it holds the action leaves the action stuck on in IAS, so when the binding goes while the action is
pressed, the package resets the action (toggles `InputAction.Enabled`, after releasing it on the
server under Server Authority). Adding the binding releases an action that is held at that moment
(IAS resets an action's bindings when one is added): a key still down holds it again only once it
is pressed again (see [Held actions and binding changes](EdgeCases.md#held-actions-and-binding-changes)).

- The action is pressed while the mouse button (or the finger) is down on the button, and released
  when it comes up. A click on the button doesn't reach `MouseLeftButton` bindings.
- To keep the button from pressing the action for a while, hide it (`Visible = false`) or set
  `Interactable = false` on it; to stop for good, call the function `AttachButton` returned.
  `Active = false` is not enough: it stops the button's `Activated`, not its binding.
- On a touch device the binding is the action's touch binding: `GetPreferredBinding()` returns it
  once the player touches the screen, and the keyboard's binding after a key press.
- With gamepad UI navigation, the gamepad's `ButtonA` on a selected button fires its binding. The
  keyboard's `Return` on a selected button only fires `Activated`, not the binding.

The package has nothing React-specific. A hook in your project can look like this:

```tsx
import { useEffect, useState } from "@rbxts/react";
import { InputActions } from "@rbxts/input-actions";

export function useInputButton(action: InputActions.BoolAction) {
	const [button, setButton] = useState<GuiButton>();
	useEffect(() => {
		if (button === undefined) return;
		return action.AttachButton(button);
	}, [action, button]);
	return setButton; // pass as `ref`
}

// <textbutton ref={useInputButton(Input.Gameplay.Actions.Jump)} Text="Jump" />
```

`InputActions.BoolAction` accepts any Bool action handle, tracked or not.

## Keybind labels

Roblox's `InputActionLabel` (a `GuiObject`, a Studio beta) shows an action's keybind for the device
in use: the preferred binding's `DisplayImage`, else the platform's key image (a chord as icons
joined by `+`), else its `DisplayName`, else the key's name. It follows device switches and rebinds
by itself. `AttachLabel` points one at an action, on every action type:

```ts
const label = new Instance("InputActionLabel");
label.Size = UDim2.fromOffset(120, 40);
label.Parent = hintFrame;
const detach = Input.Gameplay.Actions.Jump.AttachLabel(label);
```

- The label follows the action onto the server's copy of a Server Authority context at the swap.
  Setting `label.InputAction = action.Instance` yourself would leave it on the destroyed stand-in.
- A label is attached to one action at a time: the last `AttachLabel`, from any action or root
  handle, takes it over (see [Labels attached more than once](EdgeCases.md#labels-attached-more-than-once)).
- The returned function, the label's destruction and the root handle's `Destroy` let go of it. Letting
  go clears `label.InputAction`, unless something else pointed it elsewhere meanwhile. Attaching
  the same label twice keeps one attachment; a label destroyed already is left alone.
- The label shows nothing for a device whose binding is unbound (Jump with keyboard and gamepad
  keys, on a phone: its `Touch` binding has none, and IAS never prefers a binding without keys).
  Give the bindings `DisplayName` or `DisplayImage` in the schema to change what it shows.
- A hook is one line, as for buttons: `useEffect(() => label && action.AttachLabel(label), [action, label])`.
- For a keybind as text, which needs no beta, see [Keybinds as text](#keybinds-as-text).

## TrackPrevious

```ts
Crouch: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.C }, { TrackPrevious: true }),
Steer: InputActions.Direction1D({ Gamepad: Enum.KeyCode.ButtonR2 }, { TrackPrevious: true }),
```

Tracked actions add `GetPrevious()` and `HasChanged()`, and tracked Bool actions add
`IsJustPressed()` and `IsJustReleased()`. On other actions these methods don't exist, and calling
them is a compile error.

- One snapshot is taken per frame, at `BindToRenderStep` priority `Enum.RenderPriority.First`, after
  input is processed. Every read within a frame agrees. A client that renders nothing (for example
  a Studio window that isn't drawn) fires no render step, so the snapshot is taken on
  `RunService.PreAnimation` in those frames, still before the simulation and Heartbeat.
- `IsJustPressed` is also true when the action was pressed and released between two snapshots: the
  package counts `Pressed`/`Released`. A tap that lands after this frame's snapshot counts on the
  next frame.
- Actions without `TrackPrevious` do no per-frame work.

## Gestures

Bool actions have four gestures, each a callback on a pattern of presses:

```ts
const { Interact, Dash, Charge } = Input.Gameplay.Actions; // Bool actions
Interact.OnHold(() => openDoor(), {
	Duration: 0.8, // seconds held
	Progress: (fraction) => (bar.Size = UDim2.fromScale(fraction, 1)), // 0 at the press, 1 when done
	Cancelled: () => print("let go too soon"),
});
Dash.OnDoubleTap(() => dash());
Dash.OnTap(() => step(), { WaitForDoubleTap: true }); // a tap that isn't half of a double tap
const stop = Charge.OnLongPress((heldFor) => shoot(math.min(heldFor, 2)), { Duration: 0.3 });
stop(); // each returns a function that stops it; Input.Destroy() stops them all
```

- `OnTap(callback, { MaxDuration?, WaitForDoubleTap?, Window? })`: a press released within
  `MaxDuration` (default 0.25 s). With `WaitForDoubleTap`, it waits until `Window` (default 0.3
  s, as `OnDoubleTap`'s) has passed after the release without a second press; a tap that waits is
  dropped when the action or its context is disabled by then. A second press counts as within the
  window by when it arrives, as for `OnDoubleTap`: one that arrives later, in a frame that ran long
  before the window's timer could, fires the waiting tap first.
- `OnDoubleTap(callback, { Window?, MaxDuration? })`: fires at the second press, when it comes within
  `Window` (0.3 s) after a tap (a press released within `MaxDuration`, 0.25 s). The second press
  starts nothing new: a fourth quick press is the next double tap's second.
- `OnHold(callback, { Duration, Progress?, Cancelled? })`: fires once, while the press is still
  held, when it has lasted `Duration` (hold to interact, a charge that goes off by itself).
  `Progress` gets 0 at the press, then the fraction of `Duration` held each frame, and 1 as it
  completes; it is then left at 1 until the next press. When the press ends first, `Progress(0)`
  then `Cancelled()`. A release that arrives once the press has lasted `Duration`, before the hold's
  timer or a frame could run (a frame that ran long), completes the hold: the press was long
  enough.
- `OnLongPress(callback, { Duration })`: fires on the release of a press that lasted at least
  `Duration`, with the seconds it lasted (charge and release). A shorter press is no long press, and
  may be a tap.
- Durations are positive, finite seconds; anything else throws, and so does a callback that isn't a
  function. On a Direction1D, Direction2D, Direction3D or ViewportPosition action they are compile
  errors (and throw). The server's handles (`ForPlayer`) have none: read `Pressed` and
  `Released` there.
- They are built on the presses and releases the handle's `Pressed` and `Released` pass on, which
  always alternate, timed with `os.clock` as each arrives at the handle. A gesture starts with the
  next press: a press already in progress when you connect it is no part of it. Presses from code
  count too: `Tap()` is a tap, and `Fire(true)` then `Fire(false)` a press that long. There is no
  per-frame work, but a Hold's `Progress` while it is held.
- **Several gestures on one action** are independent: each sees every press, and each release the
  same way. A quick press is a tap and begins a hold that it cancels (`Cancelled` runs); a long one
  is a hold and a long press, and no tap. A plain `OnTap` hears both taps of a double tap; with
  `WaitForDoubleTap` and the same `Window` as `OnDoubleTap`, the two exclude each other: a tap
  fires only once the window has passed without a second press, and the double tap's second press
  is no tap. A gesture's callback that turns the context off (a tap that opens a menu,
  [recipe 9](Guide.md#9-turn-gameplay-off-while-a-menu-is-open)) changes nothing for the other
  gestures on that release: it was the player's.
- **A release the player didn't make ends a gesture without completing it:** the context disabled
  (`SetEnabled`, `Request`, the focus-loss reset), the action disabled, a rebind or a binding added
  while it is held (IAS resets the action), another root handle's `Destroy` letting go of an action
  the two share, and the Server Authority swap when the server's copy doesn't carry the press. No
  tap, double tap or long press comes of it, and a hold in progress calls `Cancelled`. How the
  package tells such a release:
  [Gestures and releases the player didn't make](EdgeCases.md#gestures-and-releases-the-player-didnt-make).
- The function a gesture returns and `Destroy` stop it without calling anything, a hold in progress
  included, also when called from the gesture's own `Progress`: a hold stopped from `Progress(1)`
  doesn't complete, and one whose root handle is destroyed from `Progress(0)` isn't cancelled.
  After `Destroy`, a new gesture does nothing.

## Rebinding

```ts
const keys = Input.Gameplay.Actions.Move.Bindings.KeyboardAndMouse;
keys.Get(); // { Up: W, Down: S, Left: A, Right: D }
keys.Set({ Up: Enum.KeyCode.Up, Down: Enum.KeyCode.Down }); // Left and Right stay
keys.Set(Enum.KeyCode.MouseDelta); // a bare key: sets KeyCode, clears the composites
keys.Reset(); // back to the binding right after Create
keys.Clear("Up"); // one slot: Up becomes None
keys.Clear(); // unbound: KeyCode, composites and modifiers become None
Input.BindingsChanged.Connect((path) => print(path)); // "Gameplay/Move/KeyboardAndMouse"
```

- **An action's bindings are its devices'**: `KeyboardAndMouse`, `Gamepad` and `Touch`, and each
  takes only its device's keys (see [Keys per device](API.md#keys-per-device)). Every action has
  the three: one the schema leaves out starts unbound (`Get()` returns `{}`, `Reset()` unbinds it
  again), so a player can give a gamepad button to an action you bound on the keyboard only, and
  the save keeps it.
- `Set` takes the same shapes as the schema and follows the same rules, checked at compile time and
  again at runtime: it throws, naming the path, on a key or property the action type doesn't allow,
  and on another device's key (`ButtonA is a Gamepad key: a KeyboardAndMouse binding takes keyboard
  and mouse keys`).
- An object merges into the binding. One input source per binding still holds: a `KeyCode` in the
  object clears the composite directions, and a composite direction clears the `KeyCode`.
- An object may leave the key out: `Set({ PressedThreshold: 0.9 })` tunes the key the binding has,
  and `Set({ ResponseCurve: 2 })` the stick. A `ResponseCurve` needs the binding to end on a
  thumbstick after the merge (the object's `KeyCode`, else the binding's): `Set` throws otherwise,
  as an import skips it. The types still refuse what the action type doesn't have, and a
  `ResponseCurve` on a keyboard-and-mouse or touch binding.
- `Reset` returns to the defaults, which are the tree right after `Create`: the designer's values
  when the binding came from the folder, the schema's otherwise.
- `Get` returns the current binding as plain data in the schema's shape, with tuning properties only
  when they differ from the IAS defaults. An unbound binding returns `{}`.
- `Clear(slot)` clears one slot; it is how a modifier comes off (`Set` can't write `None`):
  `Clear("PrimaryModifier")` turns Ctrl+S into S. `Clear()` with no slot unbinds everything,
  modifiers included.
- A chord (a key with `PrimaryModifier`/`SecondaryModifier`) doesn't keep another action bound to
  its plain key from firing: Ctrl+S on `QuickSave` and S on `Move` both fire on Ctrl then S. IAS
  needs the modifier pressed first, and releasing it releases the chord. See
  [IAS behaviours to know](#ias-behaviours-to-know).
- **Rebinding a held action releases it.** When a binding's keys change (`KeyCode`, a composite
  direction or a modifier, through any of the calls here, an import or `ResetBindings`) while its
  action is held, the action is released, whatever holds it: a key, a button, a value fired from
  code. A key still down counts again once it is pressed again, and a value fired from code must be
  fired again. On the server's copy of a Server Authority context the package makes that release
  itself, on both sides (see [Held actions and binding changes](EdgeCases.md#held-actions-and-binding-changes)).
- Only what changes is written. A `Set` or an import that leaves a binding's keys as they are (a
  threshold, a scale, the key it already has, the save already in effect) leaves a held action
  held.
- `Capture(slot, callback, { Cancel })` waits for the next key of the binding's device legal for
  that slot (`"KeyCode"`, `"Up"`..., `"PrimaryModifier"`), applies it, then calls `callback(key)`.
  Mouse buttons count as `MouseLeftButton`/`MouseRightButton`/`MouseMiddleButton`. **Captures are
  per device:** `Bindings.Gamepad.Capture` takes gamepad keys only and
  `Bindings.KeyboardAndMouse.Capture` keyboard and mouse keys only; another device's key is ignored
  (it doesn't cancel). A key's device is the key's own, not the device that sent it nor
  `PreferredInput`. Keys in `Cancel` end it without a change, from any device (Backspace can
  cancel a gamepad rebind, ButtonB a keyboard one): **`callback` gets `undefined` then**, as with
  `CaptureChord`, so the prompt shown for the capture closes in one place (`hidePrompt(); if (key
  !== undefined) ...`). The returned function stops it without calling `callback` (your code
  closed the prompt already).
- **Input the game already processed** (`gameProcessed`) is ignored: a click or tap on GUI, typing
  in a TextBox, and keys a ContextActionService binding sinks, such as an active `InputCatcher`'s or
  the legacy shift lock's on Shift (when the player turned shift lock on). Those keys couldn't drive
  an IAS binding either, since a CAS sink blocks IAS. A `Cancel` key is heard even then, so the
  player can always back out. Block gameplay during a rebind with `Request(false)`, not with an
  `InputCatcher`. A key another IAS binding uses, even in a sinking context, is not game-processed
  and is captured. Under the legacy player scripts the gamepad's `ButtonA` and left stick are sunk
  that way (see [Captures](EdgeCases.md#captures)).
- **Typing** is no part of a capture, `Cancel` keys included: nothing counts while a TextBox has
  focus, and for 0.1 s after it loses focus, however it loses it (a script's `ReleaseFocus` too),
  clicks, taps and input the game processed don't count either, since what ends the typing
  (Return, Escape, a click or tap away) arrives just after the focus is gone. Other keys count again
  at once.
- **The press that starts a capture**, a click or tap included, is no part of it: keys already down
  when it starts count only once they have come up and gone down again, so a hotkey that both
  starts and cancels a rebind doesn't cancel it with the press that started it. The captured key
  also does whatever it is bound to while it is pressed.
- **A gamepad menu: unselect its GUI while a capture runs.** While Roblox's gamepad UI navigation
  has a GUI object selected (`GuiService.SelectedObject`), the pad's `ButtonA` (and `R2`) drive
  that button and never reach IAS (see [IAS behaviours to know](#ias-behaviours-to-know)). A
  capture ignores input the game processed, so it likely misses them too. Set
  `GuiService.SelectedObject = undefined` as the capture starts, and select the menu's button again
  once it ends.
- **`Capture` takes only input that goes down:** keys, gamepad buttons and mouse buttons
  (`UserInputService.InputBegan`), and on the gamepad its sticks and triggers. **A stick pushed past
  halfway** counts as its direction going down (`Thumbstick1Up`, `Thumbstick2Left`...), and back
  under 0.2 as it coming up: that fills a composite direction, a Bool or Direction1D `KeyCode`, or
  ends a chord. Halfway is as IAS reads the stick, past its deadzone (see
  [IAS behaviours to know](#ias-behaviours-to-know)): a capture counts a direction exactly where a
  binding on it would press, at a raw push of about 0.55, and lets it come up at about 0.28. A
  `Direction2D` `KeyCode` slot of the Gamepad binding takes the whole stick (`Thumbstick1` or
  `Thumbstick2`) of the first one pushed. A stick already pushed when the capture starts counts once
  it has come back. **The triggers** (`ButtonL2`, `ButtonR2`) count as they go down past halfway the
  same way (a lighter pull is no key), and come up back under 0.2. The mouse wheel, mouse
  movement, touch drags and trackpad pan and pinch only change, so a capture never takes them: a
  wheel notch doesn't land in a `Direction1D` slot, and from keyboard and mouse a `Direction2D`
  `KeyCode` slot, which takes only those deltas, captures nothing. Offer those as choices in your
  settings UI and apply them with `Set` (`Set(Enum.KeyCode.MouseWheel)`).
- **Touch has nothing to capture.** A finger has no keys to press: the `Touch` binding has no
  `Capture` or `CaptureChord` (calling one anyway throws), and a tap is never captured by the other
  bindings either (a finger held down is no part of a chord: a key pressed meanwhile counts
  alone). Offer the touch keys (`TouchPosition` for a tap, `TouchDelta` for a drag,
  `TouchPinch`) as choices and apply them with `Set`, or attach on-screen buttons with
  `AttachButton`.
- `BindingsChanged` fires on `Set`, `Reset`, `Clear`, `Capture` and `CaptureChord` (the action's
  too, with the path of the binding they changed), and for every binding an import or
  `ResetBindings` changed.

### One field per action

A rebinding menu usually has one field per action, not one per device. Bool and Direction1D
actions have `Capture` and `CaptureChord` of their own: **the first key pressed picks the device**,
and that device's binding becomes the key (or the chord):

```ts
const jump = Input.Gameplay.Actions.Jump;
showPrompt("Press a key or a button for Jump");
const stop = jump.CaptureChord(
	(chord, device) => {
		hidePrompt(); // also on a Cancel key: the callback gets (undefined, undefined)
		if (chord !== undefined) print(`Jump is now ${chord.KeyCode.Name} on ${device}`);
	},
	{ Cancel: [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB] },
);
// or one key, as it goes down; on a Cancel key it gets (undefined, undefined) too
jump.Capture((key, device) => {
	if (key !== undefined) print(`Jump is now ${key.Name} on ${device}`);
});
```

- A keyboard key or a mouse button goes into `Bindings.KeyboardAndMouse`, a gamepad button, a
  trigger or a stick's direction into `Bindings.Gamepad`; the other device's binding is untouched.
  The binding becomes that key alone: the key replaces its composite directions, as with `Set`,
  and its modifiers come off, as with `CaptureChord` given one key. Quick save on Ctrl+S captured
  with F is F. A binding's own `Capture("KeyCode", ...)` changes the key only and keeps the
  modifiers. Touch input is ignored, and so is a key no binding of its device can take (a click,
  on a Direction1D action).
- `Capture` calls back with `(key, device)` once it captured a key, and with `(undefined,
  undefined)` on a `Cancel` key.
- `CaptureChord` does the same with keys held together: the first key that goes down picks the
  device, and the other device's keys are ignored while any key of the chord is held, so there is
  no `Shift + ButtonA`. When a chord is refused (four keys...) and every key of it is up, the next
  first key picks again. Its callback gets `(chord, device)`, or `(undefined, undefined)` when it
  ends with nothing applied (a `Cancel` key, the `Timeout`). One key pressed and released alone is
  a chord of that key.
- Everything else is as for a binding's captures: `Cancel` keys from any device, `Timeout`,
  typing and game-processed input, keys down at the start. Direction2D, Direction3D and
  ViewportPosition actions don't have them: their `KeyCode` takes no key that can be pressed (or
  there is none); capture their bindings' slots instead.

### A menu with a column per device

To show and rebind each device's keys, index `Bindings` by device, and pick the column the player
uses with `InputActions.PreferredDevice()` (`"KeyboardAndMouse"`, `"Gamepad"` or `"Touch"`, from
`UserInputService.PreferredInput`; the TV remote counts as `"Gamepad"`):

```ts
for (const device of ["KeyboardAndMouse", "Gamepad"] as const) {
	const binding = Input.Gameplay.Actions.Jump.Bindings[device];
	print(device, binding.Get().KeyCode); // undefined when unbound
}
const device = InputActions.PreferredDevice();
if (device === "Touch") hideRebinding(); // nothing to capture on a phone
else highlightColumn(device);
```

Roblox counts a gamepad as preferred as soon as one is plugged in, before any of its buttons is
pressed. **Re-render on `InputActions.PreferredDeviceChanged`**, which fires with the new device
when the player switches (a key after a tap, a gamepad plugged in), never twice in a row for the
same device; `MicroGamepad` and `Gamepad` both read `"Gamepad"`. On the server it never fires.

```ts
InputActions.PreferredDeviceChanged.Connect((device) => {
	if (device === "Touch") hideRebinding();
	else highlightColumn(device);
});
```

The [Guide's rebind menu](Guide.md#3-a-rebind-menu) puts it together, and
`examples/RebindingMenu.ts` in the repository has both menus.

### Keybinds as text

```ts
const { Jump, QuickSave, Move } = Input.Gameplay.Actions;
Jump.Bindings.KeyboardAndMouse.Describe(); // "Space"
QuickSave.Bindings.KeyboardAndMouse.Describe(); // "Ctrl + S"
Move.Bindings.KeyboardAndMouse.Describe(); // "W / A / S / D"
Move.Bindings.KeyboardAndMouse.Arrows.Describe(); // "Up / Left / Down / Right"
Jump.Describe(); // the device the player uses; Jump.Describe("Gamepad") is "A"
```

- `binding.Describe()` gives the binding's `DisplayName` when it has one (the schema's, or
  `Set({ DisplayName })`); else its modifiers then its key, joined by `" + "`, or its composite
  directions in reading order (Up, Left, Down, Right, then Forward, Backward) joined by `" / "`, with
  modifiers as `"Shift + (W / A / S / D)"`; and `""` when it has no key. It reads the binding as it
  is now, after any rebind.
- `action.Describe(device?)` describes the device's **main** binding (not an extra), on every action
  type; by default the device the player uses (`InputActions.PreferredDevice()`), so a hint follows
  the device. Refresh it on `PreferredDeviceChanged` and `BindingsChanged`.
- Key names: a key that types a character reads as on the player's keyboard layout
  (`UserInputService:GetStringForKeyCode`: Q reads "A" on AZERTY). For every other key that function
  gives the enum's name, so they have readable names of their own: `Enter`, `Ctrl`, `Shift`, `Alt`
  (`Right Ctrl`...), `Caps Lock`, `Page Up`, `Num 1`...; `Left Click`, `Right Click`,
  `Middle Click`, `Mouse Wheel`, `Mouse Movement`; `Touch`, `Drag`, `Pinch`; gamepad keys by their
  Xbox names, as the KeyCodes are: `A`, `B`, `X`, `Y`, `LB`, `RB`, `LT`, `RT`, `D-Pad Up`,
  `Left Stick`, `Left Stick Up`, `Left Stick Press`... `F5`, `Tab`, `Home` keep their names.
- For the platform's gamepad icons, pass the keys of `binding.Get()` to
  `UserInputService:GetImageForKeyCode`, or let an `InputActionLabel` show the keybind
  ([Keybind labels](#keybind-labels)).

### Conflicts

After a capture, a menu asks which other bindings now share the key, then warns, swaps or clears:

```ts
jump.Capture((key, device) => {
	if (device === undefined) return; // a Cancel key: nothing changed
	for (const conflict of Input.FindConflicts(jump.Bindings[device])) {
		// conflict: { Binding, Path, Key, Keys, Slot, Slots, Identical }
		warn(`${conflict.Key.Name} is also ${conflict.Path}`);
		conflict.Binding.Clear(conflict.Slot); // frees the key alone: Move's WASD keeps W, A and D
	}
});
for (const pair of Input.FindConflicts()) warn(`${pair.Paths[0]} and ${pair.Paths[1]} share ${pair.Key.Name}`);
```

- `FindConflicts(binding)` lists the other bindings of the binding's device that share a key with it,
  by path: on the root handle in every context, on a context handle in its own. They share a key
  when a key presses both (in a `KeyCode` or a composite direction: plain W and WASD), or one's key is
  the other's modifier (Ctrl+S presses a binding on Ctrl, which goes down first). Two chords that
  only share a modifier (Ctrl+S, Ctrl+D) don't: neither presses the other.
- **One push or touch can press two different keys.** A stick pushed up moves a binding on the whole
  stick (`Thumbstick1`) and presses one on its direction (`Thumbstick1Up`): they share the
  direction. On touch, a drag (`TouchDelta`) and a pinch (`TouchPinch`) hold fingers on the
  screen, which press a binding on `TouchPosition` (a tap) and move one that follows the finger:
  they share the drag or the pinch. A drag and a pinch share nothing, nor do the two sticks. On the
  keyboard and mouse every key is its own: moving the mouse presses nothing.
- Each entry has the other binding's handle (`Binding`, any action type's: `Get`, `Set`, `Reset`,
  `Clear`, `Describe`), its `Path` (`Context/Action/Device`, or `.../Device/Extra`), the first key
  they share (`Key`, in the given binding's order) and all of them (`Keys`), the other binding's slot
  that holds `Key` (`Slot`: `"KeyCode"`, a direction such as `"Down"`, or a modifier) and all its
  slots that hold one of `Keys` (`Slots`), and `Identical`: true when one key is in both with the
  same modifiers, so every press of it presses both; false when they only overlap: a chord and its
  plain key (IAS presses both when the chord is pressed: a chord doesn't block its plain key), two
  chords on one key, a key that is the other's modifier, a stick and its direction, or a drag or a
  pinch and `TouchPosition`.
- **Free the key, not the binding:** `conflict.Binding.Clear(conflict.Slot)` clears the one slot
  that holds it (S captured for Jump takes S out of Move's WASD, where `Clear()` would unbind all of
  Move; Ctrl captured for Crouch takes the modifier off Quick save's Ctrl+S, which becomes S). For
  a key held in several slots, clear each of `Slots`. To swap instead, `Set` the other binding's
  slot to the key this binding had.
- `FindConflicts()` with no argument lists every pair once, sorted by path:
  `{ Bindings, Paths, Key, Keys, Slots, Identical }`, where `Slots` holds each binding's slots that
  hold a shared key, in the order of `Paths`.
- Only keys count: not whether the contexts are enabled or sink (a menu context's Accept and
  gameplay's Jump both on Space conflict on the root handle; ask the context handle for one
  context). Unbound bindings conflict with nothing, nor do Scriptable bindings, attached buttons,
  the bindings the schema doesn't mention, or another root handle's.

### Capturing a chord

`Capture` takes one key: a player who holds Ctrl and presses S gets plain `LeftControl`.
`CaptureChord` takes keys held together, on the keyboard-and-mouse and gamepad bindings of Bool and
Direction1D actions (the action types whose `KeyCode` takes keys that can be pressed; the others
don't have it), and on those actions themselves ([One field per action](#one-field-per-action)).
A binding's chord takes its device's keys only (ButtonL1 + ButtonX on the gamepad's):

```ts
const keys = Input.Gameplay.Actions.QuickSave.Bindings.KeyboardAndMouse;
showPrompt("Hold the keys, then let go");
keys.CaptureChord(
	(chord) => {
		hidePrompt();
		if (chord === undefined) return; // cancelled, or the timeout with nothing to record
		print(chord.KeyCode, chord.PrimaryModifier, chord.SecondaryModifier);
	},
	{ Cancel: [Enum.KeyCode.Backspace], Timeout: 5 },
);
```

- It follows the keys that go down, in order, and settles when the first of them comes up: the last
  key down becomes `KeyCode`, and the keys held before it `PrimaryModifier` and `SecondaryModifier`,
  in the order they went down. That is also the order IAS wants them pressed in. Ctrl, then G, then
  H gives H with Ctrl and G; which key comes up first doesn't matter. One key alone gives that key,
  and clears the binding's modifiers.
- It is written in one write: a held action is released once, and `BindingsChanged` fires once.
  Composite directions give way to the `KeyCode`, as with `Set`. `callback` gets what was applied.
- A chord the binding can't hold is ignored: more than three keys, a modifier that isn't a Button key
  (a mouse button, a trigger, a stick's direction), or a last key the action type can't use. The capture then
  waits for every key of it to come up before the next chord counts, so letting go of the keys one
  by one doesn't record the last of them alone.
- A key already down when the capture began isn't part of a chord: holding W to walk, then pressing
  H, records H.
- A key the game takes while it is held in a chord (one a ContextActionService action sinks, such as
  the legacy camera's `Left`, or a click on GUI) makes the chord one the binding can't hold: Ctrl+Left
  is ignored, not recorded as `LeftControl` alone.
- `Timeout` (seconds, from the start): when it runs out, the keys held at that moment settle the
  chord, as if one had come up, so a player who keeps holding doesn't keep the capture waiting.
  With no keys held, or a chord the binding can't hold, the capture ends with nothing applied.
- `callback` gets `undefined` when the capture ends with nothing applied: a `Cancel` key, or the
  timeout (as `Capture`'s does on a `Cancel` key). Calling the returned function stops the capture
  without calling `callback`.
- As with `Capture`, the keys also do whatever they are bound to while they are pressed: disable
  the gameplay contexts while the rebinding UI is open (`Request(false)`). Input the game already
  processed is ignored as for `Capture` (see above): with an `InputCatcher` grabbing input, no key
  is captured, but a `Cancel` key still ends it.
- For a helper generic over the action type, type the handle `InputActions.ChordBindingHandle<A>`
  (`A extends Bool | Direction1D`): a `BindingHandle<A>` of a generic `A` doesn't have
  `CaptureChord`.

## Saving keybinds

```ts
const json = Input.ExportBindings(); // or Input.Gameplay.ExportBindings() for one context
const result = Input.ImportBindings(json); // { Applied: string[]; Skipped: { Path; Reason }[] }
Input.ResetBindings();
```

```json
{ "Version": 1, "Bindings": {
  "Gameplay/Jump/KeyboardAndMouse": { "KeyCode": "F" },
  "Gameplay/Move/KeyboardAndMouse": { "Up": "Up", "Down": "Down" },
  "Gameplay/Look/Gamepad": { "Scale": 0.02, "Vector2Scale": [1, -1] }
} }
```

- Only what differs from the defaults is saved. Enums are saved by name, and vectors as arrays. A
  cleared binding saves its keys as `"None"`.
- Saved properties: `KeyCode`, `Up`, `Down`, `Left`, `Right`, `Forward`, `Backward`,
  `PrimaryModifier`, `SecondaryModifier`, `Scale`, `Vector2Scale`, `Vector3Scale`, `ResponseCurve`,
  `PressedThreshold`, `ReleasedThreshold`. Display names are not saved.
- `ImportBindings` never throws. It starts from the defaults (a binding missing from the save is
  reset), then applies each valid entry. An entry is skipped, and its binding stays at its default,
  for an unknown path, an unknown property, an unknown key name, a key not allowed for that
  property, a number that isn't finite (the binding properties are floats: beyond ±3.4e38 a number
  would become infinite there, so it counts as not finite, for `Set` too), a `KeyCode` together
  with a composite direction, or a `ResponseCurve` on a binding that doesn't end on a thumbstick
  `KeyCode` (as `Set` refuses it).
  Bad JSON, a non-object, an unknown `Version`, or a save nested deeper than a save can be applies
  nothing. `"Unknown"` is read as `"None"`.
- A `ResponseCurve` left beside a key that isn't a thumbstick acts on nothing and isn't saved, so
  every export imports cleanly.
- A context handle's `ImportBindings` applies only its own paths and skips the others.
- Paths end with the device (`Context/Action/KeyboardAndMouse`, `.../Gamepad`, `.../Touch`), also
  for the bindings the schema leaves out; a device's extra adds its name
  (`Context/Action/KeyboardAndMouse/Arrows`, see [Several bindings per device](#several-bindings-per-device)).
  A 0.6 save loads as it is where its bindings were named
  after the devices; an entry under another name (`Mouse`, `Alternate`, a Scriptable slot) is
  skipped with the reason `Mouse is not a device: ...`, and one with another device's key with the
  reason the rules give.

On the server, clean what a client sends before storing it:

```ts
const clean = InputActions.SanitizeBindings(InputSchema, jsonFromClient); // a clean JSON string
```

`SanitizeBindings` runs the import checks against the schema alone: no instances, so it works on
the server. Both it and `ImportBindings` measure how deep a save nests before decoding it, and refuse
one deeper than a save can be: `HttpService:JSONDecode` on input nested a few hundred levels deep
ends the whole server process, `pcall` or not, so never decode what a client sends yourself before
cleaning it. It can't see the client's bindings, which shows in one case: a `ResponseCurve` saved
without a `KeyCode` (see [Saves cleaned on the server](EdgeCases.md#saves-cleaned-on-the-server)).

## Several bindings per device

An action has one binding per device by default. For more (WASD beside the arrows, the stick
beside the D-pad, a Primary/Alternate column in a settings menu), give the device a **namespace**:
an object with `Main`, its main binding, and **extras** under names of your own:

```ts
const K = Enum.KeyCode;
export const InputSchema = InputActions.Schema({
	Gameplay: {
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
					Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
				},
				Gamepad: {
					Main: K.Thumbstick1,
					DPad: { Up: K.DPadUp, Down: K.DPadDown, Left: K.DPadLeft, Right: K.DPadRight },
				},
			}),
			// an Alternate column: {} is a binding with no keys, for the player to fill
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.Space, Alt: {} },
				Gamepad: { Main: K.ButtonA, Alt: {} },
			}),
			Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }), // one binding: the direct form, as before
		},
	},
});
```

- `Main` is what the direct form gives (`KeyboardAndMouse: K.Space` is `KeyboardAndMouse: { Main:
  K.Space }`). Each binding of a namespace takes the device's keys and the action type's rules,
  checked at compile time and by `Schema`; `{}` is a binding with no keys (`Main` may be one too).
- Names: anything but `Main`, a member of a binding handle (`Get`, `Set`, `Capture`, `Extras`...),
  a binding property (`KeyCode`, `Up`, `Scale`...) or a name with `/`; a compile error, and `Schema`
  throws naming it. No binding of a namespace is `InputActions.Scriptable`: a Scriptable binding
  keeps a name of its own beside the devices.
- **Handles.** `Bindings.KeyboardAndMouse` is still the main binding's handle, so code written for
  one binding per device keeps working; the extras are properties of it, typed where declared, each
  a full binding handle of the device:

  ```ts
  const keys = Input.Gameplay.Actions.Move.Bindings.KeyboardAndMouse;
  keys.Set({ Up: K.I }); // Main
  keys.Arrows.Set({ Up: K.Eight }); // the extra: keyboard and mouse keys only
  keys.Arrows.Reset(); // back to the schema's arrows
  Input.Gameplay.Actions.Move.Bindings.Gamepad.DPad.Get(); // { Up: DPadUp, ... }
  ```

- **Captures** on an extra are locked to its device, as on the main binding:
  `Jump.Bindings.Gamepad.Alt.Capture("KeyCode", ...)` takes a gamepad button, never a key; a
  `Touch` extra has none. The one-field `Jump.Capture` and
  `Jump.CaptureChord` write the device's **main** binding, never an extra: a menu's Alternate
  column captures through the extra's handle.

  ```ts
  // a two-column menu: Primary and Alternate, on the device the player uses
  const device = InputActions.PreferredDevice();
  if (device !== "Touch") {
  	const binding = Jump.Bindings[device];
  	binding.Capture("KeyCode", onKey); // Primary
  	binding.Alt.Capture("KeyCode", onKey); // Alternate
  }
  ```

- **`Extras()`** lists a device's extras by name, for code that doesn't know the schema
  (`binding.Extras().Alt`, or all of them with `pairs`, in no order: sort the names). It is a
  table, so it also works on a handle picked by a device at runtime, and on a row type such as
  `InputActions.CaptureAction`, whose type knows no extras: `action.Bindings[device].Extras().Alt`
  is undefined on an action without that column.
- **Several bindings of an action aren't combined**: the last one to change wins, between a main
  binding and its extras too (holding W and Up, then releasing W, reads at rest while Up is held).
  A keybind label shows one binding of the device in use (which one, when it has several, is IAS's
  choice).
- **Instances.** An extra is made as `<Action><Device><Extra>` (`MoveKeyboardAndMouseArrows`) and
  adopted by that name or `<Device><Extra>`, as the device bindings are; the main binding keeps its
  name (`MoveKeyboardAndMouse`), so an existing tree is adopted as before. A Scriptable slot can't
  take an extra's binding name (`KeyboardAndMouseArrows` beside the extra `Arrows`).
- **Saves.** An extra saves at `Context/Action/Device/Extra` (`Gameplay/Move/KeyboardAndMouse/Arrows`);
  the main binding keeps `Context/Action/Device`, so saves made before you added extras still load,
  the extras at their defaults. An entry for an extra the schema doesn't declare is skipped with
  the reason `Gameplay/Move/KeyboardAndMouse has no extra binding Numpad: ...`; `SanitizeBindings`
  keeps the declared extras and drops the rest. `BindingsChanged` passes the same path.
- **Several root handles** (`Create` twice on one folder) each get the extras their own schema
  declares (see [Several root handles on one folder](EdgeCases.md#several-root-handles-on-one-folder)).
- **Server Authority.** The extras move from the stand-in to the server's copy with the other
  bindings at the swap, with their rebinds and defaults.

## Server Authority

With `Workspace.AuthorityMode = Server`, input contexts must live under the `Player`, and IAS sends
the action state to the server. Mark the contexts the server needs:

```ts
export const InputSchema = InputActions.Schema({
	Gameplay: {
		ServerAuthority: true,
		Actions: {
			Move: InputActions.Direction2D({ KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S } }),
			Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space }),
		},
	},
	Menu: { Actions: { Open: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.M }) } }, // client only
});
```

```ts
// server
InputActions.ProvideToPlayers(InputSchema);

RunService.BindToSimulation(() => {
	for (const player of Players.GetPlayers()) {
		const input = InputActions.ForPlayer(InputSchema, player); // cache it per player in real code
		const move = input.Gameplay.Actions.Move.GetState(); // Vector2
	}
});

// client: unchanged
const Input = InputActions.Create(InputSchema);
Input.Gameplay.LinkedToServer.Connect(() => print("now on the server's copy"));
// or: called at once if the copy is there already, else when it arrives
Input.Gameplay.WhenLinkedToServer((context) => print(`on ${context.GetFullName()}`));
```

`LinkedToServer` fires only at the swap, never when the copy was there at `Create`.
`WhenLinkedToServer(callback)` covers both: it calls `callback` with the server's copy at once (in
the caller's thread) when the handle wraps it already, else once when the stand-in gives way. The
returned function cancels a call still to come, and so does `Destroy`.

A context marked `ServerAuthority: true` in a place without Server Authority still works on the
client (the server's copy replicates either way), but the server never receives its state:
`ForPlayer(...).GetState()` stays at rest. Turn on Server Authority in the place's Workspace settings
when you mark contexts this way. The package warns you when it can tell that you haven't (see
[Is Server Authority on?](#is-server-authority-on)).

- **Server:** `ProvideToPlayers(schema, options?)` puts every Server Authority context into
  `player.Inputs` (option `PlayerFolderName`), for each player now and as they join. When
  `ReplicatedStorage.Inputs.<Context>` exists (the Manager's template), it is cloned with its
  Priority, Sink and actions, and without its bindings. Otherwise the context is built from the
  schema. Actions the schema has and the template lacks are added, and a `Type` mismatch throws.
  It returns a function that stops providing.
- **The server's copy is always enabled, and the client owns `Enabled`.** IAS on the server ignores
  the client's input for a context or action the server has disabled, even after the client enables
  its own, so a menu context declared `Enabled: false` would never reach the server. The copy and
  its actions are enabled on the server; on the client, the first time the package takes them up,
  they get the template's `Enabled` (as the designer left it), else the schema's. From then on
  enable and disable them through the handles (`SetEnabled`, `Request`) as for any context; the
  server reads the state the client sends.
- **Server:** `ForPlayer(schema, player)` returns handles over that player's copy, only for contexts
  marked `ServerAuthority: true` (the type hides the others): `Instance`, `GetState()`,
  `StateChanged`, and `Pressed`/`Released` on Bool actions. There are no bindings and no `Fire`. It
  waits (up to `Timeout`, default 10 s) for the contexts.
- **Client: `Create` never waits for the server.**
  - When `LocalPlayer.Inputs.<Context>` is already there, it adds the bindings **locally** under
    the server's actions: the template's bindings when it has them, the schema's otherwise. The
    server never sees them. `IsLinkedToServer()` is `true` from the start.
  - Otherwise the context runs on a **local stand-in**: a client-only context (a clone of the
    template, or built from the schema) with its bindings. Everything works on it at once: input,
    `GetState`, events, `Fire`, rebinding, requests, `AttachButton`. Its state never reaches the
    server.
  - When the server's copy arrives, the handles **swap** to it. The bindings move under the
    server's actions with everything they have (rebinds, attached buttons), the context keeps its
    base state and held requests, the actions their `Enabled`, and each Scriptable binding fires its
    last value again, so a held virtual stick stays held. Then the stand-in is disabled and
    destroyed, and `LinkedToServer` fires once. A Bool action held at the swap may release once and
    press again on the next input; listeners never hear two presses in a row, and `StateChanged`
    never repeats a value. `Reset` still returns to the same defaults. The swap step by step:
    [The Server Authority swap](EdgeCases.md#the-server-authority-swap).
  - The handles' signals (`StateChanged`, `Pressed`, `Released`, `EnabledChanged`,
    `BindingsChanged`) are the package's own and forward from whichever instance a handle wraps, so
    connections made before the swap keep working. Read `Instance` when you need it: it changes at
    the swap.
  - After `Timeout` seconds (default 10) without the copy, `Create` warns once, naming the contexts
    and the path it expects. The usual causes: `ProvideToPlayers` isn't called on the server, or it
    uses another `PlayerFolderName`. The stand-in keeps working, and the swap still happens if the
    copy arrives later. The warning only means the copy never arrived; it says nothing about the
    authority mode, which has a warning of its own (see
    [Is Server Authority on?](#is-server-authority-on)).
  - The template context in `ReplicatedStorage.Inputs` is disabled locally, so it doesn't process
    the same keys beside the stand-in or the player's copy.
- **Disabling releases on the server too.** Disabling a context or an action on the client releases
  the client's state only: the server would keep the last value it received. So when a handle
  disables it (`SetEnabled(false)`, `Request(false)`, the focus-loss reset), when a held button
  binding goes, and on `Destroy`, the package releases the action on the server first. Disabling it
  through the instance (`InputContext.Enabled = false`) leaves the server holding it: go through the
  handles. See [Releasing on the server](EdgeCases.md#releasing-on-the-server).
- Keybinds and saves work as usual; only the state goes to the server.
- `PlayerFolderName` can't be `InputContexts`: under Server Authority, Roblox's PlayerModule keeps
  its own contexts in `player.InputContexts`.
- Several root handles on one copy, and a copy whose actions don't match the schema, are in
  [The Server Authority swap](EdgeCases.md#the-server-authority-swap).

### Is Server Authority on?

Scripts can't read `Workspace.AuthorityMode`, but the engine names the mode in an error message,
and `InputActions.IsServerAuthority()` reads it, on either realm:

```ts
InputActions.IsServerAuthority(); // true, false, or undefined (it can't tell)
```

**The message.** `workspace.Terrain:CanSetNetworkOwnership()` asks whether a script may set the
network owner of the terrain. It changes nothing, and always answers `false` with a reason, which
depends on the mode:

| Realm | Under Server Authority | Otherwise |
| --- | --- | --- |
| client | `Can not call Network Ownership API when workspace.AuthorityMode = Enums.AuthorityMode.Server.` | `Network Ownership API can only be called from the Server.` |
| server | the same message | `Network Ownership API cannot be used on Terrain` |

Under Server Authority the network ownership API is refused as a whole, with a message that names
`workspace.AuthorityMode`. Otherwise the client gets the usual "server only" refusal, and the
server the refusal for terrain, which can't have a network owner.

**The function.** `IsServerAuthority()` makes that call inside `pcall` and reads the reason:

- `true` when it mentions `AuthorityMode`;
- `false` when it is one of the two messages for the other mode;
- `undefined` in every other case: the call threw, succeeded, or gave a message it doesn't know.

The first `true` or `false` is kept for the session (the mode can't change while it runs);
`undefined` is not kept, so a later call asks again. It never throws or yields.

**When it is `undefined`:**

- On the client before the game has loaded. `workspace.Terrain` is `nil` until `game.Loaded`, so
  the call throws. Ask after `game.Loaded`; `Create` waits for it first.
- If Roblox rewords one of the messages. **It is best-effort:** it reads the wording of an engine
  message, which may change without notice, and a message it doesn't know gives `undefined`, not a
  guess.

What the package does with it:

- `Create` (client) and `ProvideToPlayers` (server) warn once per call when the schema marks
  contexts `ServerAuthority: true` and `IsServerAuthority()` is `false`. The warning names those
  contexts and says the server will never receive their state.
- When it is `undefined` they stay silent: the warning goes quiet rather than wrong. So no warning
  doesn't prove Server Authority is on; `true` does.
- It decides whether the package releases actions under the player on the server too (see
  [Releasing on the server](EdgeCases.md#releasing-on-the-server)). With `false` it doesn't: without
  Server Authority the server's copy is an ordinary local context. With `undefined` it does, as
  under Server Authority.
- The `Timeout` warning is another matter: it only means the server's copy never arrived. It says
  nothing about the mode.

## UI navigation preset

`InputActions.Presets.UiNavigation(options?)` returns a context schema (options: `Priority`, `Sink`,
`Enabled`, `ServerAuthority`) typed as precisely as a hand-written one:

| Action | Type | KeyboardAndMouse | Gamepad |
| --- | --- | --- | --- |
| `Navigate` | Direction2D | composite arrows | composite DPad |
| `Accept` | Bool | `Return` | `ButtonA` |
| `Cancel` | Bool | `B` (Escape is reserved, Backspace belongs to CoreGui) | `ButtonB` |
| `NextPage` | Bool | `E` | `ButtonR1` |
| `PreviousPage` | Bool | `Q` | `ButtonL1` |
| `Scroll` | Direction1D | `MouseWheel` | composite `Thumbstick2Up`/`Thumbstick2Down` |

With the **legacy** player scripts, the default camera scripts sink `Left`/`Right` through
ContextActionService, and a CAS sink blocks IAS: the arrow-key composite of `Navigate` gets no left
or right there. `RawInputHandler`'s legacy fork does the same. The IAS player scripts
(`Workspace.PlayerScriptsUseInputActionSystem = Enabled`) don't.

- `Scroll` reads as a rate: the wheel gives notches per second for one frame, then 0. Multiply its
  state by the frame's delta time (see [IAS behaviours to know](#ias-behaviours-to-know)). An action
  has one keyboard-and-mouse binding unless it declares extras, and `Scroll`'s is the wheel; for
  `PageUp`/`PageDown` instead, `Scroll.Bindings.KeyboardAndMouse.Set({ Up: PageUp, Down: PageDown })`.
- Every action of the preset also has its `Touch` binding, unbound.
- While Roblox's own gamepad UI navigation has a GUI object selected (`GuiService.SelectedObject`),
  `Return` and the arrow keys never reach IAS, so `Accept` and the keyboard's `Navigate` don't fire;
  `Return` activates the selected button instead. Use the preset for menus that don't select GUI
  objects, or deselect them.

## IAS behaviours to know

These hold for any IAS code, with or without this package, under `SignalBehavior = Deferred` unless
said otherwise; the package works under both `Deferred` and `Immediate`:

- **Several bindings on one action are not combined: the last one to change wins.** Holding A and
  B, then releasing A, releases the action, with real keys as with `Fire`. The same goes for
  Direction2D: the state is the value of the binding that fired or moved last. A device's main
  binding and its extras are several bindings too.
- **A chord doesn't block its plain key.** With `Ctrl+C` on one action and plain `C` on another,
  pressing `Ctrl` then `C` fires both. The modifier must go down first (`C` then `Ctrl` fires only
  the plain `C`), and letting go of the modifier releases the chord while `C` stays held. The package
  can't make chords exclusive: if the plain action must not fire, check the modifier in its handler
  (`UserInputService.IsKeyDown(Enum.KeyCode.LeftControl)`).
- **Mouse wheel, mouse movement and touch drags read as rates.** `MouseWheel`, `MouseDelta`,
  `TouchDelta` (and trackpad pan and pinch) give the amount divided by that frame's time, for one
  frame, then 0: one wheel notch reads about 190 at 190 fps, 64 at 60 fps. Multiply `GetState()` by
  the frame's delta time to get notches or pixels. Treat the `Scroll` preset as a rate too: its
  wheel is one, and its stick (or a `PageUp`/`PageDown` composite you set) holds at most 1 while
  held, which times delta time gives one unit a second. `ClampMagnitudeToOne` doesn't clamp the wheel or the mouse
  movement (it acts on composites), and `Scale`/`Vector2Scale` apply as usual.
- **Sinking:** a context with `Sink` blocks lower contexts only for the keys it binds itself. A
  ContextActionService binding that returns `Sink` blocks IAS for its keys (this is how
  `InputCatcher` blocks your actions); one that returns `Pass` doesn't. GUI gets clicks and taps
  before ContextActionService, so a CAS sink never blocks a button, nor its `UIButton` binding
  (`AttachButton`). With the legacy player
  scripts, the default camera sinks `Left`, `Right`, `I` and `O` through CAS; the IAS player
  scripts don't.
- **TextBoxes:** a focused TextBox keeps new key presses from key bindings. A key already held when
  it takes focus stays pressed in IAS until it comes up, which is why the package's focus-loss reset
  releases it (see [Contexts](#contexts)).
- **Clicks on GUI:** a click on a GuiButton fires that button's `UIButton` binding and keeps the click
  from a `MouseLeftButton` action; a click on empty space goes to the `MouseLeftButton` action.
- **The Roblox menu doesn't release held actions**; the package's focus-loss reset does. Losing
  window focus releases them on the engine side as well.
- **Gamepad UI navigation:** while a GuiButton is selected (`GuiService.SelectedObject`), the
  keyboard's `Return` activates it (`Activated` fires) but doesn't fire its `UIButton` binding, and
  `Return` and the arrow keys never reach IAS. The gamepad's `ButtonA` (and `R2`) drive the selected
  button's `UIButton` binding and never reach IAS either. Thumbstick updates are unreliable while
  something is selected.
- **Thumbstick deadzones are fixed:** a radial deadzone of 0.1 with rescaling on sticks, and a
  linear 0.1 on triggers; there is no property for them. `PressedThreshold` applies to the rescaled
  value, so the default thresholds press past a raw push of about 0.55 and release under about 0.28.
  `UserInputService`'s `InputObject.Position` is the raw value (see
  [What Roblox sends for a pad](EdgeCases.md#what-roblox-sends-for-a-pad)). A stick moving on both
  axes can fire `StateChanged` twice in one frame, with an intermediate value first.
- `GetState()` updates synchronously after a `Fire`; the events (`Pressed`, `StateChanged`) are
  deferred under `SignalBehavior = Deferred`, and run inside the `Fire` call under `Immediate`.
  Under Server Authority (which requires Deferred), contexts under the player are simulated: the
  fired value shows in `GetState()` on the next simulation step. The handles' own signals forward
  the IAS ones, so under Deferred a listener connected right after a `Fire` can still receive that
  `Fire`'s event, and under Immediate a handle's `Pressed` has run by the time `Fire` returns. A
  handle's `Pressed` and `Released` always alternate: on a Server Authority copy IAS has sent
  `Released` twice in a row, and the handle passes such a repeat on once. Likewise a handle's
  `StateChanged` never repeats the value it passed on last.
- A repeated `Fire` of the same value does nothing. `Fire` on a disabled action or context is
  silently ignored.
- Under Server Authority, disabling a context or action on the client doesn't release the server's
  state (see [Releasing on the server](EdgeCases.md#releasing-on-the-server)).
- A fired value persists until something changes it.
- IAS applies no `Scale`, clamp or `Vector2Scale` to fired values.
- Destroying a binding while it holds an action leaves the action stuck on, with no `Released`.
- **Adding a binding to a held action releases it**, as a change to a binding's keys does: IAS
  resets the action's bindings. A key still down holds it again only once it is pressed again.
  `AttachButton`, a `Create` that adds a binding and the first `Fire` on an action add one (see
  [Held actions and binding changes](EdgeCases.md#held-actions-and-binding-changes), also for the
  server's copy).

The IAS reference the package was built against (maintainer material) is in
[Reference/RobloxInputActionSystem.md](Reference/RobloxInputActionSystem.md).
