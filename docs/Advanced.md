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
  opens can have its release swallowed, and stay stuck. By default `Create` holds every context
  disabled for one frame on `UserInputService.TextBoxFocused`, `WindowFocusReleased` and
  `GuiService.MenuOpened`. Listeners see one `false`/`true` pair on contexts that were enabled, and
  the base state doesn't change. Turn it off with `Create(schema, { ResetOnFocusLoss: false })`.
- Actions have `SetEnabled`/`IsEnabled` too, which pass through to `InputAction.Enabled`; IAS resets
  an action's state when it is disabled (and the package releases it on the server first, as for
  contexts).

## Get-or-create in detail

- `Create` looks in `ReplicatedStorage.Inputs` (created client-side when missing), or in
  `options.Folder`. Contexts can live anywhere in the DataModel.
- An existing action whose `Type` differs from the builder's type throws, naming the path
  (`Gameplay/Jump`). Nothing `Create` made before the throw is left behind.
- An adopted binding whose keys break the type rules is left as it is, with a `warn` naming it.
- Instances the schema doesn't mention are left alone (IAS still runs them) and are not typed. In
  Studio, each gets one `warn`. That includes bindings whose names match no slot, such as the
  Manager's default name `InputBinding`, because they run beside the package's own binding.
- `Create` twice on the same folder adopts the same instances and creates nothing twice. The
  handles then share them: a context has one enabled state (base state and requests) whichever
  handle changes it, every handle on a binding has the same defaults, and destroying one handle
  leaves what another still uses (instances, held input, requests). What the package made goes
  with the last handle.
- On an action another handle still uses, `Destroy` lets go of what the destroyed handle held
  itself: a value its `Fire`, `Tap` or Scriptable slots left goes back to rest, unless the package
  fired a value after it (IAS shows the last write), even an equal one on another binding. A value
  another live handle fired too, on the same binding, stays: IAS ignored that repeat, but the value
  is that handle's as well. Its attached buttons go too; as when a held button is detached, the
  action is released if it is pressed and nothing the other handles fired holds it.
- `Input.Destroy()` disconnects everything, releases what the package was holding, and destroys
  what it created. Adopted instances stay: adopted contexts get their base state back, and adopted
  bindings their defaults (rebinds are undone, so a later `Create` starts from the same defaults).
  After `Destroy` the handles change nothing: `Fire`, `AttachButton`, requests, rebinding and
  imports are ignored.

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
  [below](#ias-behaviours-to-know)).

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
server under Server Authority).

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

- `Set` takes the same shapes as the schema and follows the same rules, checked at compile time and
  again at runtime: it throws, naming the path, on a key or property the action type doesn't allow.
- An object merges into the binding. One input source per binding still holds: a `KeyCode` in the
  object clears the composite directions, and a composite direction clears the `KeyCode`.
- `Reset` returns to the defaults, which are the tree right after `Create`: the designer's values
  when the binding came from the folder, the schema's otherwise.
- `Get` returns the current binding as plain data in the schema's shape, with tuning properties only
  when they differ from the IAS defaults. An unbound binding returns `{}`.
- `Clear(slot)` clears one slot; it is how a modifier comes off (`Set` can't write `None`):
  `Clear("PrimaryModifier")` turns Ctrl+S into S. `Clear()` with no slot unbinds everything,
  modifiers included.
- `Capture(slot, callback, { Cancel })` waits for the next key legal for that slot (`"KeyCode"`,
  `"Up"`..., `"PrimaryModifier"`), applies it, then calls `callback(key)`. Mouse buttons and touch
  count as `MouseLeftButton`/`MouseRightButton`/`MouseMiddleButton`/`TouchPosition`. Keys in `Cancel`
  stop it without a change; the returned function stops it too. Input the game already processed
  (`gameProcessed`) is ignored.
- `BindingsChanged` fires on `Set`, `Reset`, `Clear` and `Capture`, and for every binding an import
  or `ResetBindings` changed.

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
  "Gameplay/Look/Mouse": { "Scale": 0.02, "Vector2Scale": [1, -1] }
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
  Bad JSON, a non-object or an unknown `Version` applies nothing. `"Unknown"` is read as `"None"`.
- A `ResponseCurve` left beside a key that isn't a thumbstick acts on nothing and isn't saved, so
  every export imports cleanly.
- A context handle's `ImportBindings` applies only its own paths and skips the others.

On the server, clean what a client sends before storing it:

```ts
const clean = InputActions.SanitizeBindings(InputSchema, jsonFromClient); // a clean JSON string
```

`SanitizeBindings` runs the import checks against the schema alone: no instances, so it works on
the server.

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
```

**The package can't tell whether the place runs Server Authority.** `Workspace.AuthorityMode` can't
be read by scripts, so nothing warns you when it is off. A context marked `ServerAuthority: true` in
a place without Server Authority still works on the client (the server's copy replicates either
way), but the server never receives its state: `ForPlayer(...).GetState()` stays at rest. Turn on
Server Authority in the place's Workspace settings when you mark contexts this way.

- **Server:** `ProvideToPlayers(schema, options?)` puts every Server Authority context into
  `player.Inputs` (option `PlayerFolderName`), for each player now and as they join. When
  `ReplicatedStorage.Inputs.<Context>` exists (the Manager's template), it is cloned with its
  Priority, Sink, Enabled and actions, and without its bindings. Otherwise the context is built from
  the schema. Actions the schema has and the template lacks are added, and a `Type` mismatch throws.
  It returns a function that stops providing.
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
    base state and held requests, and each Scriptable binding fires its last value again, so a held
    virtual stick stays held. Then the stand-in is disabled and destroyed, and `LinkedToServer`
    fires once. A Bool action held at the swap may release once and press again on the next input.
    Listeners hear that: at the swap each handle passes on the copy's state (a `Released`, and a
    `StateChanged` to the value at rest, when the copy doesn't show the stand-in's value yet), then
    the copy's own events, so a value fired again reads as a release and a new press, never as two
    presses in a row. `Reset` still returns to the same defaults.
  - The handles' signals (`StateChanged`, `Pressed`, `Released`, `EnabledChanged`,
    `BindingsChanged`) are the package's own and forward from whichever instance a handle wraps, so
    connections made before the swap keep working. Read `Instance` when you need it: it changes at
    the swap.
  - After `Timeout` seconds (default 10) without the copy, `Create` warns once, naming the contexts
    and the path it expects. The usual causes: `ProvideToPlayers` isn't called on the server, or it
    uses another `PlayerFolderName`. The stand-in keeps working, and the swap still happens if the
    copy arrives later. The warning only means the copy never arrived; it says nothing about the
    authority mode.
  - The template context in `ReplicatedStorage.Inputs` is disabled locally, so it doesn't process
    the same keys beside the stand-in or the player's copy.
- Keybinds and saves work as usual; only the state goes to the server.
- `PlayerFolderName` can't be `InputContexts`: under Server Authority, Roblox's PlayerModule keeps
  its own contexts in `player.InputContexts`.
- Root handles that start on a stand-in swap together, and a `Create` that finds the copy while
  other handles still wait for it swaps them first, so the copy takes their enabled state. After
  that, every handle shares the copy's instances and its enabled state; nothing is doubled.
- A server's copy whose action has another `Type` than the schema's: `Create` warns, naming the
  path, and the context stays on its (working) stand-in.

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
| `Scroll` | Direction1D | `MouseWheel` (slot `Mouse`), composite `PageUp`/`PageDown` | composite `Thumbstick2Up`/`Thumbstick2Down` |

With the **legacy** player scripts, the default camera scripts sink `Left`/`Right` through
ContextActionService, and a CAS sink blocks IAS: the arrow-key composite of `Navigate` gets no left
or right there. `RawInputHandler`'s legacy fork does the same. The IAS player scripts
(`Workspace.PlayerScriptsUseInputActionSystem = Enabled`) don't.

## IAS behaviours to know

These were measured in Studio (with `SignalBehavior = Deferred`) and hold for any IAS code, with or
without this package:

- **Several bindings on one action are not combined: the last one to change wins.** Holding A and
  B, then releasing A, releases the action. The same goes for Direction2D: the state is the value of
  the binding that fired or moved last.
- `GetState()` updates synchronously after a `Fire`; the events (`Pressed`, `StateChanged`) are
  deferred under `SignalBehavior = Deferred`. Under Server Authority, contexts under the player are
  simulated: the fired value shows in `GetState()` on the next simulation step. The handles' own
  signals forward the IAS ones, so under Deferred a listener connected right after a `Fire` can
  still receive that `Fire`'s event.
- A repeated `Fire` of the same value does nothing. `Fire` on a disabled action or context is
  silently ignored.
- Under Server Authority, disabling a context or action on the client doesn't release the server's
  state (see [Releasing on the server](#releasing-on-the-server)).
- A fired value persists until something changes it.
- IAS applies no `Scale`, clamp or `Vector2Scale` to fired values.
- Destroying a binding while it holds an action leaves the action stuck on, with no `Released`.
- Since 2026-02, a ContextActionService binding that sinks an input also blocks IAS for it (this is
  how `InputCatcher` still blocks everything). With the legacy player scripts, the default controls
  sink keys through CAS; the IAS player scripts don't.

The full IAS reference the package was built against is in
[Reference/RobloxInputActionSystem.md](Reference/RobloxInputActionSystem.md).
