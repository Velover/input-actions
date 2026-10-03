# Advanced usage

- [Contexts](#contexts)
- [Get-or-create in detail](#get-or-create-in-detail)
- [Driving actions from code](#driving-actions-from-code)
- [On-screen buttons](#on-screen-buttons)
- [TrackPrevious](#trackprevious)
- [Rebinding](#rebinding)
- [Saving keybinds](#saving-keybinds)
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
  [Releasing on the server](#releasing-on-the-server)).
- **Focus loss.** A key held when a TextBox takes focus, the window loses focus or the Roblox menu
  opens can have its release swallowed, and stay stuck: IAS itself keeps a held action pressed when a
  TextBox takes focus or the Roblox menu opens (measured). By default `Create` holds every context
  disabled for one frame on `UserInputService.TextBoxFocused`, `WindowFocusReleased` and
  `GuiService.MenuOpened`, which releases them. Listeners see one `false`/`true` pair on contexts
  that were enabled, and the base state doesn't change. Turn it off with
  `Create(schema, { ResetOnFocusLoss: false })`.
- Actions have `SetEnabled`/`IsEnabled` too, which pass through to `InputAction.Enabled`; IAS resets
  an action's state when it is disabled (and the package releases it on the server first, as for
  contexts).

## Get-or-create in detail

- `Create` looks in `ReplicatedStorage.Inputs` (created client-side when missing), or in
  `options.Folder`. Contexts can live anywhere in the DataModel.
- An existing action whose `Type` differs from the builder's type throws, naming the path
  (`Gameplay/Jump`). Nothing `Create` made before the throw is left behind.
- An adopted binding whose keys break the type rules (another device's key included) is left as it
  is, with a `warn` naming it.
- Every action gets the three device bindings: the folder's (`JumpTouch`, say, adopted as the Touch
  binding even when the schema leaves Touch out), else one made with no keys. IAS never prefers a
  binding without keys, so an unbound one changes nothing for `GetPreferredBinding()` or a keybind
  label.
- Instances the schema doesn't mention are left alone (IAS still runs them) and are not typed. In
  Studio, each gets one `warn`. That includes bindings whose names match no slot, such as the
  Manager's default name `InputBinding`, because they run beside the package's own binding.
- `Create` twice on the same folder adopts the same instances and creates nothing twice. The
  handles then share them: a context has one enabled state (base state and requests) whichever
  handle changes it, every handle on a binding has the same defaults, and destroying one handle
  leaves what another still uses (instances, held input, requests). What the package made goes
  with the last handle. When a later schema names a device an earlier one left out, it fills that
  device's unbound binding: its keys become the defaults of every handle on it (a player's rebind
  made meanwhile stays). A `Create` that gives an action a binding it didn't have (a Scriptable
  slot, or a template's binding) or fills one releases the action if it is held, as `AttachButton`
  does (see [IAS behaviours to know](#ias-behaviours-to-know)).
- On an action another handle still uses, `Destroy` lets go of what the destroyed handle held
  itself: a value its `Fire`, `Tap` or Scriptable slots left goes back to rest, unless the package
  fired a value after it (IAS shows the last write), even an equal one on another binding. A value
  another live handle fired too, on the same binding, stays: IAS ignored that repeat, but the value
  is that handle's as well. Its attached buttons go too, and so do the bindings only it has (its
  own slots, the template's bindings it cloned). A binding destroyed while it holds its action
  would leave the action stuck on, so, as when a held button is detached, the action is released
  if it is not at rest and nothing the other handles fired holds it. A value they fired holds it
  only while the action shows the last one they fired: a key or a button that wrote after it
  holds the action instead. IAS doesn't tell which binding holds an action, so that also lets go
  of a key held through a binding the other handles keep, until the key is pressed again. On the
  server's copy the release is the pair of [Releasing on the server](#releasing-on-the-server);
  elsewhere it is an `InputAction.Enabled` toggle once the bindings are gone, as below, after which
  a value the other handles fired before counts again when fired again.
- `Input.Destroy()` disconnects everything, releases what the package was holding, and destroys
  what it created. Adopted instances stay: adopted contexts get their base state back, and adopted
  bindings their defaults (rebinds are undone, so a later `Create` starts from the same defaults).
  After `Destroy` the handles change nothing: `Fire`, `AttachButton`, requests, rebinding and
  imports are ignored. Under Deferred signals, an event a handle fired before `Destroy` that
  Roblox had not delivered yet, such as the `LinkedToServer` of a swap in the same frame, still
  reaches the listeners connected then: destroying a signal doesn't take back a delivery on its
  way, while disconnecting a connection does. Disconnect your own connections first when such a
  late call matters; a `WhenLinkedToServer` callback never runs after `Destroy`.
- A binding `Destroy` removes while a key or a button holds its action would leave the action stuck
  on in IAS. So an action that stays after `Destroy` (an adopted one, or one of the server's copy)
  and is still not at rest once the package's bindings are gone is reset (`InputAction.Enabled`
  toggled), whatever its type: a key held through the package's binding doesn't keep a `Move` or a
  `Jump` held after the handle is gone. An action another handle still uses is released instead,
  as above.

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
is pressed again (see [IAS behaviours to know](#ias-behaviours-to-know)).

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

Roblox's `InputActionLabel` (a `GuiObject`, a Studio beta announced on 2026-08-06) shows an action's
keybind for the device in use: the preferred binding's `DisplayImage`, else the platform's key image
(a chord as icons joined by `+`), else its `DisplayName`, else the key's name. It follows device
switches and rebinds by itself. `AttachLabel` points one at an action, on every action type:

```ts
const label = new Instance("InputActionLabel");
label.Size = UDim2.fromOffset(120, 40);
label.Parent = hintFrame;
const detach = Input.Gameplay.Actions.Jump.AttachLabel(label);
```

- The label follows the action onto the server's copy of a Server Authority context at the swap,
  while it still shows the stand-in's action: one pointed elsewhere meanwhile stays there. Setting
  `label.InputAction = action.Instance` yourself would leave it on the destroyed stand-in.
- A label is attached to one action at a time: the last `AttachLabel`, from any action or root
  handle, takes it over, and the earlier attachment's function and `Destroy` then leave it alone.
  Each function lets go of its own attachment only: once the label was taken over, it does
  nothing, even after the label is attached to its action again.
- The returned function, the label's destruction and the root handle's `Destroy` let go of it. Letting
  go clears `label.InputAction`, unless something else pointed it elsewhere meanwhile. Attaching
  the same label twice keeps one attachment; a label destroyed already is left alone.
- The label shows nothing for a device whose binding is unbound (Jump with keyboard and gamepad
  keys, on a phone: its `Touch` binding has none, and IAS never prefers a binding without keys).
  Give the bindings `DisplayName` or `DisplayImage` in the schema to change what it shows.
- A hook is one line, as for buttons: `useEffect(() => label && action.AttachLabel(label), [action, label])`.

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
- `Capture(slot, callback, { Cancel })` waits for the next key of the binding's device legal for
  that slot (`"KeyCode"`, `"Up"`..., `"PrimaryModifier"`), applies it, then calls `callback(key)`.
  Mouse buttons count as `MouseLeftButton`/`MouseRightButton`/`MouseMiddleButton`. **Captures are
  per device:** `Bindings.Gamepad.Capture` takes gamepad keys only and
  `Bindings.KeyboardAndMouse.Capture` keyboard and mouse keys only; another device's key is ignored
  (it doesn't cancel). A key's device is the key's own, not the device that sent it nor
  `PreferredInput`. Keys in `Cancel` stop it without a change, from any device (Backspace can
  cancel a gamepad rebind, ButtonB a keyboard one); the returned function stops it too. Input the game already processed
  (`gameProcessed`) is ignored: a click or tap on GUI, typing in a TextBox, and keys a
  ContextActionService binding sinks, such as an active `InputCatcher`'s or the legacy shift lock's
  on Shift (when the player turned shift lock on). Those keys couldn't drive an IAS binding either,
  since a CAS sink blocks IAS. A `Cancel` key is heard even then, so the player can always back out.
  Typing is no part of a capture, `Cancel` keys included: nothing counts while a TextBox has focus,
  and for 0.1 s after it loses focus, however it loses it (a script's `ReleaseFocus` too), clicks,
  taps and input the game processed don't count either, since what ends the typing (Return, Escape,
  a click or tap away) arrives just after the focus is gone. Other keys count again at once. Block gameplay during a rebind with `Request(false)`, not with an
  `InputCatcher`. The press that starts a capture, a click or tap included, is no part of it: keys
  already down when it starts count only once they have come up and gone down again, so a hotkey
  that both starts and cancels a rebind doesn't cancel it with the press that started it. A key another IAS binding uses, even in a sinking context, is not game-processed
  and is captured (measured with real keys). The captured key also does whatever it
  is bound to while it is pressed.
- **`Capture` takes only input that goes down:** keys, gamepad buttons and mouse buttons
  (`UserInputService.InputBegan`), and on the gamepad its sticks and triggers. **A stick pushed past
  halfway** counts as its direction going down (`Thumbstick1Up`, `Thumbstick2Left`...), and back
  under 0.2 as it coming up: that fills a composite direction, a Bool or Direction1D `KeyCode`, or
  ends a chord. A `Direction2D` `KeyCode` slot of the Gamepad binding takes the whole stick
  (`Thumbstick1` or `Thumbstick2`) of the first one pushed. A stick already pushed when the capture
  starts counts once it has come back. **The triggers** (`ButtonL2`, `ButtonR2`) count as they go
  down past halfway. The mouse wheel, mouse movement, touch drags and trackpad pan and pinch only
  change, so a capture never takes them: a wheel notch doesn't land in a `Direction1D` slot
  (measured), and from keyboard and mouse a `Direction2D` `KeyCode` slot, which takes only those
  deltas, captures nothing. Offer those as choices in your settings UI and apply them with `Set`
  (`Set(Enum.KeyCode.MouseWheel)`).
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
and the key (or chord) goes into that device's binding's `KeyCode`:

```ts
const jump = Input.Gameplay.Actions.Jump;
showPrompt("Press a key or a button for Jump");
const stop = jump.Capture(
	(key, device) => {
		hidePrompt();
		print(`Jump is now ${key.Name} on ${device}`); // device: "KeyboardAndMouse" | "Gamepad"
	},
	{ Cancel: [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB] },
);
```

- A keyboard key or a mouse button goes into `Bindings.KeyboardAndMouse`, a gamepad button, a
  trigger or a stick's direction into `Bindings.Gamepad`; the other device's binding is untouched.
  The `KeyCode` replaces the binding's composite directions, as with `Set`. Touch input is
  ignored, and so is a key no binding of its device can take (a click, on a Direction1D action).
- `CaptureChord` does the same with keys held together: the first key that goes down picks the
  device, and the other device's keys are ignored while any key of the chord is held, so there is
  no `Shift + ButtonA`. When a chord is refused (four keys...) and every key of it is up, the next
  first key picks again. Its callback gets `(chord, device)`, or `(undefined, undefined)` when it
  ends with nothing applied.
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
pressed. `examples/RebindingMenu.ts` in the repository has both menus.

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
  timeout. Calling the returned function stops the capture without calling `callback`.
- As with `Capture`, the keys also do whatever they are bound to while they are pressed: disable
  the gameplay contexts while the rebinding UI is open (`Request(false)`). Input the game already
  processed is ignored as for `Capture` (see above): with an `InputCatcher` grabbing input, no key
  is captured, but a `Cancel` key still ends it.
- For a helper generic over the action type, type the handle `InputActions.ChordBindingHandle<A>`
  (`A extends Bool | Direction1D`): a `BindingHandle<A>` of a generic `A` doesn't have
  `CaptureChord`.
- **Rebinding a held action releases it.** When a binding's keys change (`KeyCode`, a composite
  direction or a modifier, through any of the calls above, an import or `ResetBindings`) while its
  action is held, the action is released, whatever holds it: a key, a button, a value fired from
  code. IAS does that on a local context, even when the binding that changed isn't the one holding
  the action (it resets every binding of the action). On the server's copy of a Server Authority
  context IAS would keep the action held, on the client and the server, so the package releases it
  there, on both sides (see [Releasing on the server](#releasing-on-the-server)). A key still down
  counts again once it is pressed again, and a value fired from code must be fired again.
- Only what changes is written. A `Set` or an import that leaves a binding's keys as they are (a
  threshold, a scale, the key it already has, the save already in effect) leaves a held action
  held.

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
  for the bindings the schema leaves out. A 0.6 save loads as it is where its bindings were named
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
cleaning it.

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
returned function cancels a call still to come, and so does `Destroy`. Under Immediate signals the
swap's events run inside it: the copy's state, the held values fired again, the labels moving and
`LinkedToServer` come once every root handle on the stand-in wraps the copy and
`IsLinkedToServer()` is `true`. Before them come the releases of the held values, with everything
still on the stand-in: a root handle a listener destroys there takes no part in the swap, and when
none is left the copy stays untouched, for the next `Create` to take up with the template's or the
schema's `Enabled`. A value a listener fires there through a Scriptable binding is carried over as
well, and wins over the one it replaced; one it fires at rest stays at rest.

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
  its own (probed), so a menu context declared `Enabled: false` would never reach the server. The
  copy and its actions are enabled on the server; on the client, the first time the package takes
  them up, they get the template's `Enabled` (as the designer left it), else the schema's. From then
  on enable and disable them through the handles (`SetEnabled`, `Request`) as for any context; the
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
    server. Root handles made before the copy arrives (`Create` twice, with the same
    `PlayerFolderName`) share one stand-in, as they share the copy later: one enabled state, and
    one swap for all of them.
  - When the server's copy arrives, the handles **swap** to it. The bindings move under the
    server's actions with everything they have (rebinds, attached buttons), the context keeps its
    base state and held requests, the actions their `Enabled`, and each Scriptable binding fires its
    last value again, so a held
    virtual stick stays held. Then the stand-in is disabled and destroyed, and `LinkedToServer`
    fires once. A Bool action held at the swap may release once and press again on the next input.
    Listeners hear that: at the swap each handle passes on the copy's state (a `Released`, and a
    `StateChanged` to the value at rest, when the copy doesn't show the stand-in's value yet), then
    the copy's own events, so a value fired again reads as a release and a new press, never as two
    presses in a row, and `StateChanged` never repeats a value. `Reset` still returns to the same
    defaults.
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
- Keybinds and saves work as usual; only the state goes to the server.
- `PlayerFolderName` can't be `InputContexts`: under Server Authority, Roblox's PlayerModule keeps
  its own contexts in `player.InputContexts`.
- Root handles that start on a stand-in swap together, and a `Create` that finds the copy while
  other handles still wait for it swaps them first, so the copy takes their enabled state. After
  that, every handle shares the copy's instances and its enabled state; nothing is doubled.
- A handle that swaps onto a copy another handle already uses (its schema has actions the copy
  gained later) shares that handle's bindings of the same name instead of adding its own; attached
  buttons are renamed. Its rebinds and imports made on the stand-in are written onto the shared
  binding, which keeps the first handle's defaults, as with `Create` twice. A value both handles
  hold on the same Scriptable binding stays held until neither does. A binding of its own that it
  brings onto an action the other handle's input holds releases that action, as `AttachButton`
  does.
- A server's copy whose action has another `Type` than the schema's: `Create` warns, naming the
  path, and the context stays on its (working) stand-in.

### Is Server Authority on?

Scripts can't read `Workspace.AuthorityMode`, but the engine names the mode in an error message,
and `InputActions.IsServerAuthority()` reads it, on either realm:

```ts
InputActions.IsServerAuthority(); // true, false, or undefined (it can't tell)
```

**The message.** `workspace.Terrain:CanSetNetworkOwnership()` asks whether a script may set the
network owner of the terrain. It changes nothing, and always answers `false` with a reason, which
depends on the mode (measured on 2026-10-01 from game scripts):

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
  the call throws (measured from a `ReplicatedFirst` LocalScript: an error on the first frames,
  the `AuthorityMode` message once loaded). Ask after `game.Loaded`; `Create` waits for it first.
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
  [Releasing on the server](#releasing-on-the-server)). With `false` it doesn't: without Server
  Authority the server's copy is an ordinary local context. With `undefined` it does, as under
  Server Authority.
- The `Timeout` warning is another matter: it only means the server's copy never arrived. It says
  nothing about the mode.

### Releasing on the server

Disabling a context or an action on the client releases the client's state only: the server keeps
the last value it received, and the client's own state comes back when the context is enabled again
(probed). A value at rest written through a Scriptable binding reaches both sides, because the last
write wins. So before anything resets an action on the server's copy, the package releases it that
way:

- when the context is disabled (`SetEnabled(false)`, `Request(false)`, the focus-loss reset), the
  action is disabled (`SetEnabled(false)`), a held button binding is removed, or on `Destroy`;
- through the Scriptable bindings it drives when they hold a value (`Fire`'s `<Action>Script`, the
  schema's Scriptable slots), else, when something else holds the action (a key, a button, a binding
  you made), with a same-frame pair on `<Action>Script`: the held value, then the value at rest.
- Actions of the server's copy that the schema doesn't mention (a template's extra actions, which
  get the template's keys) are released the same way when the context is disabled, and on the
  last `Destroy`, which removes those keys: the pair goes through a binding made for it and
  removed in the same frame.

The server sees one `Released`. If you disable a context by writing `InputContext.Enabled` yourself,
or disable an action through its instance, the server keeps the state: go through the handles.
`RawInputHandler.ControlSetEnabled(false)` does the same for the PlayerModule's `CharacterContext`.

**Rebinding a held action.** On the server's copy, a change to a binding's keys while the action is
held (any binding of the action, not only the one holding it) leaves it held, on the client and the
server, until the new keys are pressed and released: IAS resets the action's bindings, and the
client's state is pressed again (probed). A local context is released instead. So after `Set`,
`Reset`, `Clear`, `Capture`, `ImportBindings` or `ResetBindings` changes the keys of a held action,
the package fires the same-frame pair, the value it held before the change then the value at rest,
through a binding made for it and removed in the same frame. It goes after the change, because a
release before it would be undone by it; an import that changes several bindings of one action
releases it once. The values the package fired on that action are forgotten: IAS reset them too.
Write keys through the binding handles: a key you write on the instance yourself leaves the action
held.

**Adding a binding to a held action** does the same on the server's copy (measured): IAS resets the
action's bindings, and the client's state is pressed again and stays held, on both sides, after the
key comes up. So the package fires the same pair after it adds a binding to an action that is held:
`AttachButton`, a `Create` that gives an action a binding it lacked (a device's binding, a
Scriptable slot, a template's binding) or fills a device's unbound binding, the swap moving a
stand-in's binding onto an action another handle's input holds on the copy (one pair for all of
it), and the first `Fire` on an action, which makes its `<Action>Script` binding (the fired value
lands after the pair: a press holds the action, a value at rest leaves it released). A binding you
add to the instance yourself leaves the action held.

**In a place without Server Authority** (`IsServerAuthority()` is `false`), a context marked
`ServerAuthority: true` still runs on the server's copy under the player, but that copy is an
ordinary local context there: a rebind while a key holds its action releases it once, as on any
local context (measured), and the server never receives its state. So the package fires none of the
pairs above on it. After a rebind, IAS has released the action already, and a pair would press and
release it once more. While the mode is unknown (`undefined`), the package fires them, as under
Server Authority. `Destroy` still lets go of what it held on that copy: an action a key holds when
its binding goes is reset, as on any local context.

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
  state by the frame's delta time (see [IAS behaviours to know](#ias-behaviours-to-know)). Since
  0.7.0 an action has one keyboard-and-mouse binding, and `Scroll`'s is the wheel; for
  `PageUp`/`PageDown` instead, `Scroll.Bindings.KeyboardAndMouse.Set({ Up: PageUp, Down: PageDown })`.
- Every action of the preset also has its `Touch` binding, unbound.
- While Roblox's own gamepad UI navigation has a GUI object selected (`GuiService.SelectedObject`),
  `Return` and the arrow keys never reach IAS, so `Accept` and the keyboard's `Navigate` don't fire;
  `Return` activates the selected button instead. Use the preset for menus that don't select GUI
  objects, or deselect them.

## IAS behaviours to know

These were measured in Studio (with `SignalBehavior = Deferred`; real keyboard, mouse and touch
input through `VirtualInput` and the device simulator, and a gamepad, on 2026-10-01) and hold for any
IAS code, with or without this package. The package's tests run under both `Deferred` and
`Immediate`:

- **Several bindings on one action are not combined: the last one to change wins.** Holding A and
  B, then releasing A, releases the action, with real keys as with `Fire`. The same goes for
  Direction2D: the state is the value of the binding that fired or moved last.
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
- **Sinking:** a context with `Sink` blocks lower contexts only for the keys it binds itself. Since
  2026-02, a ContextActionService binding that returns `Sink` blocks IAS for its keys (this is how
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
  value. A stick moving on both axes can fire `StateChanged` twice in one frame, with an
  intermediate value first.
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
  state (see [Releasing on the server](#releasing-on-the-server)).
- A fired value persists until something changes it.
- IAS applies no `Scale`, clamp or `Vector2Scale` to fired values.
- Destroying a binding while it holds an action leaves the action stuck on, with no `Released`.
- **Adding a binding to a held action releases it**, as a change to a binding's keys does: IAS
  resets the action's bindings. On a local context the action is released at once, with one
  `Released`; a key still down holds it again only once it is pressed again, and a value fired from
  code must be fired again. `AttachButton` adds a binding, and so does a `Create` that gives an
  action a binding it didn't have (a device's, a Scriptable slot, a template's), and the first
  `Fire` on an action (it makes `<Action>Script`; the value it fires lands after the release); a
  `Create` that fills a device's unbound binding changes its keys. The package can't keep the
  press: a value
  it fired in its place would hold the action after the key comes up. On the server's copy of a
  Server Authority context IAS keeps the action held instead, on the client and the server, so the
  package releases it there (see [Releasing on the server](#releasing-on-the-server)).

The full IAS reference the package was built against is in
[Reference/RobloxInputActionSystem.md](Reference/RobloxInputActionSystem.md).
