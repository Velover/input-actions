# Guide

The everyday tasks, as recipes to copy. Read [the model](#the-model) first. Each recipe links to the
full rules in [Advanced](Advanced.md), and the [API reference](API.md) lists every member.

- [The model](#the-model)
- Recipes: [1. Define actions](#1-define-actions) · [2. Read input](#2-read-input) ·
  [3. A rebind menu](#3-a-rebind-menu) · [4. Save and load](#4-save-and-load) ·
  [5. On-screen buttons](#5-on-screen-buttons) · [6. Keybind labels](#6-keybind-labels) ·
  [7. Server Authority](#7-server-authority) · [8. Chords](#8-chords) ·
  [9. Turn gameplay off while a menu is open](#9-turn-gameplay-off-while-a-menu-is-open)
- [Don't](#dont)

## The model

```
InputActions.Schema({ ... })        plain data in a shared module; makes no instances
InputActions.Create(schema)         client: gets or creates the IAS instances, returns the root handle
  Input.Gameplay                    a context handle
  Input.Gameplay.Actions.Jump       an action handle
  Jump.Bindings.Gamepad             a binding handle: the device's main binding
  Jump.Bindings.Gamepad.Alt         a binding handle: an extra binding of that device
```

- A **context** groups the actions you turn on and off together: gameplay, a menu, a vehicle. Its
  `Priority` orders it against other contexts, and `Sink` keeps lower contexts from the keys it binds.
- An **action** is one intent, such as Jump or Move. Its builder fixes its value: `Bool` (boolean),
  `Direction1D` (number), `Direction2D` (Vector2), `Direction3D` (Vector3), `ViewportPosition`
  (Vector2, in pixels).
- A **binding** drives an action. Every action has three **device bindings**, `KeyboardAndMouse`,
  `Gamepad` and `Touch`, each holding only its device's keys; one the schema leaves out is there,
  unbound, for the player to fill. A device can hold **extras** beside its main binding:
  `{ Main: <WASD>, Arrows: <the arrows> }`. A binding under any other name is
  `InputActions.Scriptable`, driven from code with `Fire`.
- The **schema** is plain data: require it on both realms. **`Create`** runs on the client. It gets
  or creates the instances in `ReplicatedStorage.Inputs`, adopting what the Input Action Manager
  made there, and returns the **root handle**. Each handle's `Instance` is the IAS object it wraps.

**Client and server.** Reading input, rebinding, saves, buttons and labels all run on the client.
By default the server sees none of it, as with any client input: send it what it needs through your
remotes. **Server Authority** is for places that run it (`Workspace.AuthorityMode = Server`) and
whose server must read the input itself, such as the character's movement or abilities it
simulates. Mark those contexts `ServerAuthority: true`: the server reads each player's state, and
the keybinds stay on the client ([recipe 7](#7-server-authority)). Leave the other contexts (menus,
camera, HUD) unmarked.

## 1. Define actions

```ts
// src/shared/InputSchema.ts: plain data, required on the client and the server
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

export const InputSchema = InputActions.Schema({
	Gameplay: {
		Priority: 2000, // above the PlayerModule's contexts
		Sink: true, // lower contexts don't get the keys bound here
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.Space, Alt: {} }, // Alt: an Alternate key the player fills
				Gamepad: { Main: K.ButtonA, Alt: {} },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: K.Thumbstick1,
				Virtual: InputActions.Scriptable, // an on-screen stick, driven from code
			}),
			Interact: InputActions.Bool({ KeyboardAndMouse: K.E, Gamepad: K.ButtonX }),
			Shoot: InputActions.Bool({ KeyboardAndMouse: K.MouseLeftButton, Gamepad: K.ButtonR2 }),
			Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }, { TrackPrevious: true }),
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl }, // Ctrl+S
			}),
		},
	},
	Menu: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
});
```

```ts
// src/client/Input.ts: one Create for the whole client
import { InputActions } from "@rbxts/input-actions";
import { InputSchema } from "shared/InputSchema";

export const Input = InputActions.Create(InputSchema); // waits for game.Loaded
```

- A binding with keys is named after its device and takes only that device's keys. A wrong key is
  a compile error that says why: `Gamepad: K.Space` gives
  `Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys`.
- A binding is a key (`K.Space`), an object (`{ KeyCode, PressedThreshold }`, or the composite
  `{ Up, Down, Left, Right }`), or, inside a device's `{ Main, ... }`, `{}` for one with no keys.
- `Crouch` has the three device bindings too: `Crouch.Bindings.Gamepad` is there, unbound.
- `TrackPrevious: true` adds `IsJustPressed()`, `IsJustReleased()`, `GetPrevious()` and
  `HasChanged()`.
- `Escape`, `ButtonStart`, `F9`, `F11`, `F12` and `Print` are reserved: compile errors. The full
  rules: [Quick start](QuickStart.md#1-describe-the-input-in-a-shared-module), [Builders](API.md#builders).
- The `Menu` preset holds `Navigate`, `Accept`, `Cancel`, `NextPage`, `PreviousPage` and `Scroll`
  ([UI navigation preset](Advanced.md#ui-navigation-preset)).

## 2. Read input

```ts
// src/client/Gameplay.client.ts
import { RunService } from "@rbxts/services";
import { Input } from "client/Input";

const { Jump, Move, Interact, Shoot, Crouch } = Input.Gameplay.Actions;

// events
Jump.Pressed.Connect(() => print("jump"));
Move.StateChanged.Connect((direction) => print(direction)); // Vector2

// state, read each frame
RunService.RenderStepped.Connect(() => {
	const direction = Move.GetState(); // Vector2: X right, Y forward
	if (Shoot.IsPressed()) print(`shooting while moving ${direction}`);
	if (Crouch.IsJustPressed()) print("crouched this frame"); // needs TrackPrevious: true
});

// gestures, on Bool actions: each returns a function that stops it
Jump.OnDoubleTap(() => print("double jump"));
Interact.OnTap(() => print("look at it"));
Interact.OnHold(() => print("door opened"), {
	Duration: 0.8,
	Progress: (fraction) => print(fraction), // each frame while held, 0 to 1: fill a bar
	Cancelled: () => print("let go too soon"),
});
const stopCharging = Shoot.OnLongPress((heldFor) => print(`charged shot: ${heldFor} s`), { Duration: 0.5 });

// from code: an on-screen stick fires its offset, and the value at rest when the finger lifts
Move.Bindings.Virtual.Fire(new Vector2(0, 1));
Move.Bindings.Virtual.Fire(Vector2.zero);
```

- `GetState()` is the value now; the events tell you when it changes. `IsJustPressed()` also
  counts a press and release within one frame.
- Gestures on one action each see every press: a quick press on `Interact` is a tap, and starts a
  hold that it cancels (`Cancelled` runs). `OnTap(callback, { WaitForDoubleTap: true })` waits out
  the double-tap window, so a tap and a double tap on one action exclude each other.
  `stopCharging()` stops that gesture; `Input.Destroy()` stops them all.
- Mouse movement, the wheel and touch drags read as rates: multiply `GetState()` by the frame's delta
  time.
- A value fired from code stays until something changes it.
- More: [TrackPrevious](Advanced.md#trackprevious), [Gestures](Advanced.md#gestures),
  [Driving actions from code](Advanced.md#driving-actions-from-code).

## 3. A rebind menu

A settings screen with a row per action and a column per device. Gameplay is off while the menu is
open ([recipe 9](#9-turn-gameplay-off-while-a-menu-is-open)).

```ts
// src/client/RebindMenu.ts
import { InputActions } from "@rbxts/input-actions";
import { GuiService } from "@rbxts/services";
import { Input } from "client/Input";

type AnyBinding = InputActions.BindingHandle<Enum.InputActionType, InputActions.Device>;

/** The columns: the devices with keys to press (touch has none) */
const COLUMNS = ["KeyboardAndMouse", "Gamepad"] as const;
/** Keys that end a capture without a change, from either device */
const CANCEL = [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB];
const { Jump, Interact, Shoot, QuickSave } = Input.Gameplay.Actions;
/** The rows: Bool and Direction1D actions have a one-field capture */
const ROWS: InputActions.CaptureAction[] = [Jump, Interact, Shoot, QuickSave];

function Text(binding: AnyBinding | undefined) {
	const text = binding?.Describe() ?? ""; // "Space", "Ctrl + S", "RT"; "" when unbound
	return text === "" ? "-" : text;
}

/** Each row: a device's main key / its Alternate (the `Alt` extra), the device in use in brackets */
function Render(device: InputActions.Device) {
	if (device === "Touch") {
		print("Plug in a keyboard or a gamepad to rebind"); // touch has no keys to capture
		return;
	}
	for (const action of ROWS) {
		const cells = COLUMNS.map((column) => {
			const main = action.Bindings[column];
			const text = `${Text(main)} / ${Text(main.Extras().Alt)}`;
			return column === device ? `[${text}]` : text;
		});
		print(`${action.Name}: ${cells.join(" | ")}`);
	}
}
InputActions.PreferredDeviceChanged.Connect(Render); // a key after a tap, a gamepad plugged in
Input.BindingsChanged.Connect(() => Render(InputActions.PreferredDevice())); // a rebind, reset or import
Render(InputActions.PreferredDevice());

/** Around a capture: no GUI object selected, and the menu's own actions off */
function BeginCapture(): () => void {
	const selected = GuiService.SelectedObject;
	GuiService.SelectedObject = undefined; // a selected button takes the gamepad's ButtonA
	const resumeMenu = Input.Menu.Request(false); // the keys pressed would also fire Accept, Cancel...
	return () => {
		resumeMenu();
		GuiService.SelectedObject = selected;
	};
}

/** After a capture: the other gameplay bindings of the device that now share its key lose it */
function FreeKey(binding: AnyBinding) {
	for (const conflict of Input.Gameplay.FindConflicts(binding)) {
		if (conflict.Slot === "PrimaryModifier" || conflict.Slot === "SecondaryModifier") {
			// a chord's modifier (Ctrl given to Crouch, QuickSave on Ctrl+S): cleared, the chord
			// would be its plain key, S, and clash with Move's S. Show it; the player decides
			warn(`${conflict.Key.Name} is also held for ${conflict.Path} (${conflict.Binding.Describe()})`);
			continue;
		}
		warn(`${conflict.Key.Name} was also ${conflict.Path}`); // show it in the menu
		conflict.Binding.Clear(conflict.Slot); // that key alone: Move's WASD keeps W, A and D
	}
}

/** One field per action ("press a key or a button for Jump"): the first key picks the device */
export function RebindAction(action: InputActions.CaptureAction): () => void {
	const finish = BeginCapture();
	const stop = action.CaptureChord(
		(chord, device) => {
			finish();
			if (chord !== undefined && device !== undefined) FreeKey(action.Bindings[device]);
		},
		{ Cancel: CANCEL, Timeout: 5 },
	);
	return () => {
		stop(); // the menu closed: the callback isn't called
		finish();
	};
}

/** One cell: a device's main key or its Alternate; only that device's keys count */
export function RebindCell(
	action: InputActions.CaptureAction,
	device: InputActions.CapturableDevice,
	alternate: boolean,
): () => void {
	const binding = alternate ? action.Bindings[device].Extras().Alt : action.Bindings[device];
	if (binding === undefined) return () => {}; // no Alternate on this row
	const finish = BeginCapture();
	const stop = binding.CaptureChord(
		(chord) => {
			finish();
			if (chord !== undefined) FreeKey(binding);
		},
		{ Cancel: CANCEL, Timeout: 5 },
	);
	return () => {
		stop();
		finish();
	};
}
```

- **Captures and cancel.** `CaptureChord` takes one key, or keys held together (Ctrl+Shift+S,
  LB + A), and settles when the first comes up. `Capture` takes one key as it goes down. Both call
  back with `undefined` when the capture ends without a change: a `Cancel` key, or (`CaptureChord`
  only) the `Timeout` with no keys held. The function a capture returns stops it without calling
  back.
- The one-field `action.Capture` and `action.CaptureChord` write the device's **main** binding; an
  Alternate cell captures through the extra's handle. A binding's captures take only its device's
  keys; `Cancel` keys count from either device.
- A key pressed during a capture also fires whatever it is bound to: keep the contexts that use it
  off (gameplay is off in the menu; `BeginCapture` turns off the menu's own).
- **Conflicts.** After a capture, `FreeKey` takes the key from the other bindings:
  `Clear(conflict.Slot)` clears the one slot that holds it (Move's `Down` when S goes to Jump),
  where `Clear()` would empty all its keys, every direction of a composite too. A key that is
  another chord's modifier is only shown: clearing it would turn QuickSave's Ctrl+S into plain S,
  a new conflict with Move's S (to free it anyway, unbind the whole chord with `Clear()`). A menu
  may warn instead, or swap (give the other binding the old key with `Set`).
  `Input.Gameplay.FindConflicts` looks in that context only, so the menu's `Accept` on `ButtonA` is
  no conflict for `Jump`: the two contexts are never on together. The root handle's
  `Input.FindConflicts` looks in every context. `conflict.Identical` is false when the bindings only
  overlap: `QuickSave`'s Ctrl+S and `Move`'s S both fire on Ctrl then S.
- **Touch has nothing to capture.** Offer the touch keys as choices and apply them with `Set`:
  `Jump.Bindings.Touch.Set(Enum.KeyCode.TouchPosition)` (a tap). The wheel and mouse movement can't be
  captured either: apply them with `Set` too.
- Direction2D and Direction3D actions have no one-field capture: capture a slot,
  `Move.Bindings.KeyboardAndMouse.Capture("Up", callback)`.
- More: [Rebinding](Advanced.md#rebinding), [Conflicts](Advanced.md#conflicts),
  [Several bindings per device](Advanced.md#several-bindings-per-device).

## 4. Save and load

```ts
// src/server/Keybinds.server.ts
import { InputActions } from "@rbxts/input-actions";
import { ReplicatedStorage } from "@rbxts/services";
import { InputSchema } from "shared/InputSchema";

const remotes = new Instance("Folder");
remotes.Name = "Keybinds";
const saveRemote = new Instance("RemoteEvent");
saveRemote.Name = "Save";
saveRemote.Parent = remotes;
const loadRemote = new Instance("RemoteFunction");
loadRemote.Name = "Load";
loadRemote.Parent = remotes;
remotes.Parent = ReplicatedStorage;

const saves = new Map<Player, string>(); // read and write your DataStore here instead

saveRemote.OnServerEvent.Connect((player, json) => {
	if (!typeIs(json, "string") || json.size() > 50000) return;
	saves.set(player, InputActions.SanitizeBindings(InputSchema, json)); // keeps the valid entries only
});
loadRemote.OnServerInvoke = (player) => saves.get(player);
```

```ts
// src/client/Keybinds.ts
import { ReplicatedStorage } from "@rbxts/services";
import { Input } from "client/Input";

const remotes = ReplicatedStorage.WaitForChild("Keybinds");
const saveRemote = remotes.WaitForChild("Save") as RemoteEvent;
const loadRemote = remotes.WaitForChild("Load") as RemoteFunction;

// once, on join: the import starts from the defaults, then applies the save
const save = loadRemote.InvokeServer();
if (typeIs(save, "string")) {
	const result = Input.ImportBindings(save); // never throws
	for (const skipped of result.Skipped) warn(`${skipped.Path} not loaded: ${skipped.Reason}`);
}

/** Call it when the rebind menu closes */
export function SaveKeybinds() {
	saveRemote.FireServer(Input.ExportBindings()); // JSON of what differs from the defaults
}
```

- `ExportBindings` saves only what the player changed, by path (`Gameplay/Jump/KeyboardAndMouse`;
  an extra adds its name, `.../KeyboardAndMouse/Alt`).
- `ImportBindings` skips a bad entry with a reason; its binding stays at its default.
- `SanitizeBindings` checks a save against the schema alone, so it runs on the server. Never
  `JSONDecode` a client's save yourself: input nested a few hundred levels deep ends the server
  process.
- `Input.ResetBindings()` puts every binding back to its default.
- More: [Saving keybinds](Advanced.md#saving-keybinds).

## 5. On-screen buttons

```ts
// src/client/TouchButtons.client.ts
import { InputActions } from "@rbxts/input-actions";
import { Players } from "@rbxts/services";
import { Input } from "client/Input";

const gui = new Instance("ScreenGui");
gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
const button = new Instance("TextButton");
button.Text = "Jump";
button.Size = UDim2.fromOffset(90, 90);
button.Position = new UDim2(1, -110, 1, -110);
button.Parent = gui;

// pressed while a finger (or the mouse) is down on the button
const detach = Input.Gameplay.Actions.Jump.AttachButton(button); // detach(), or destroying the button, removes it

// shown on a touch screen only: a hidden button doesn't press the action
const show = (device: InputActions.Device) => (button.Visible = device === "Touch");
show(InputActions.PreferredDevice());
InputActions.PreferredDeviceChanged.Connect(show);
```

- `AttachButton` is on Bool actions; an action can have several buttons.
- A click on the button doesn't reach `MouseLeftButton` bindings.
- To pause a button, hide it or set `Interactable = false`. `Active = false` doesn't stop it.
- An on-screen stick fires a Scriptable binding ([recipe 2](#2-read-input)).
- More, and a React hook: [On-screen buttons](Advanced.md#on-screen-buttons).

## 6. Keybind labels

```ts
// src/client/Hints.client.ts
import { InputActions } from "@rbxts/input-actions";
import { Players, UserInputService } from "@rbxts/services";
import { Input } from "client/Input";

const { Interact } = Input.Gameplay.Actions;
const gui = new Instance("ScreenGui");
gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");

// as text: "Hold E", "Hold X", for the device in use, refreshed on a switch and on a rebind
const hint = new Instance("TextLabel");
hint.Size = UDim2.fromOffset(200, 40);
hint.Parent = gui;
const refresh = () => (hint.Text = `Hold ${Interact.Describe()}`);
refresh();
InputActions.PreferredDeviceChanged.Connect(refresh);
Input.BindingsChanged.Connect(refresh);

// or Roblox's InputActionLabel (a Studio beta), which shows icons and follows both by itself
const label = new Instance("InputActionLabel");
label.Size = UDim2.fromOffset(120, 40);
label.Parent = gui;
const detach = Interact.AttachLabel(label); // detach() lets go of it

// a gamepad icon in your own ImageLabel
const icon = new Instance("ImageLabel");
const key = Interact.Bindings.Gamepad.Get().KeyCode;
if (key !== undefined) icon.Image = UserInputService.GetImageForKeyCode(key);
```

- `action.Describe(device?)` reads the device's main binding, by default the device in use, as it
  is now: `"Space"`, `"Ctrl + S"`, `"W / A / S / D"`, `""` when unbound. A key that types a character
  reads as on the player's keyboard layout. `binding.Describe()` reads one binding, an extra too.
- `AttachLabel` works on every action type, and follows the action to the server's copy under
  Server Authority: don't set `label.InputAction` yourself. A label shows nothing for a device whose
  binding is unbound (`Interact` on a phone: its `Touch` binding has no key).
- More: [Keybind labels](Advanced.md#keybind-labels), [Keybinds as text](Advanced.md#keybinds-as-text).

## 7. Server Authority

Turn on Server Authority in the place (`Workspace.AuthorityMode = Server`), then mark the contexts
the server reads:

```ts
// src/shared/CharacterSchema.ts
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

export const CharacterSchema = InputActions.Schema({
	Character: {
		ServerAuthority: true, // the server reads this context's state
		Priority: 2000,
		Sink: true,
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: K.Thumbstick1,
			}),
			Dash: InputActions.Bool({ KeyboardAndMouse: K.Q, Gamepad: K.ButtonX }),
		},
	},
	Hud: { Actions: { Map: InputActions.Bool({ KeyboardAndMouse: K.M }) } }, // client only
});
```

```ts
// src/server/Character.server.ts
import { InputActions } from "@rbxts/input-actions";
import { Players, RunService } from "@rbxts/services";
import { CharacterSchema } from "shared/CharacterSchema";

InputActions.ProvideToPlayers(CharacterSchema); // puts Character under each player, now and as they join

const inputs = new Map<Player, InputActions.ServerHandle<typeof CharacterSchema.Contexts>>();
function Watch(player: Player) {
	const input = InputActions.ForPlayer(CharacterSchema, player); // waits for the player's copy
	inputs.set(player, input);
	input.Character.Actions.Dash.Pressed.Connect(() => print(`${player.Name} dashed`));
}
Players.PlayerAdded.Connect(Watch);
for (const player of Players.GetPlayers()) task.spawn(Watch, player);
Players.PlayerRemoving.Connect((player) => inputs.delete(player));

// read the state in the simulation step
RunService.BindToSimulation(() => {
	for (const [player, input] of inputs) {
		const move = input.Character.Actions.Move.GetState(); // Vector2
		if (move.Magnitude > 0) print(`${player.Name} moves ${move}`);
	}
});
```

```ts
// src/client/Character.client.ts
import { InputActions } from "@rbxts/input-actions";
import { CharacterSchema } from "shared/CharacterSchema";

const Input = InputActions.Create(CharacterSchema); // the same call as without Server Authority
Input.Character.WhenLinkedToServer(() => print("the server receives Character's state now"));
Input.Character.Actions.Dash.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.E); // keybinds stay on the client
```

- `Create` never waits for the server. Until the server's copy of `Character` arrives, the context
  runs on a local stand-in: everything works, but the server doesn't see it. `WhenLinkedToServer`
  calls back once the handles are on the copy (at once when they are already).
- The server's handles have `GetState()`, `StateChanged`, and `Pressed`/`Released` on Bool actions:
  no bindings, no `Fire`, no gestures.
- Turn contexts and actions on and off on the client, through the handles (`Request`,
  `SetEnabled`): the package then releases held actions on the server too.
- In a place without Server Authority a marked context still works on the client, but the server
  never gets its state; `Create` and `ProvideToPlayers` warn when they can tell.
- `Instance` changes at the swap to the server's copy; the handles' signals keep working.
- More: [Server Authority](Advanced.md#server-authority), and the swap in detail in
  [Edge cases](EdgeCases.md#the-server-authority-swap).

## 8. Chords

```ts
// src/client/QuickSave.ts
import { Input } from "client/Input";

const { QuickSave } = Input.Gameplay.Actions; // Ctrl+S in the schema
QuickSave.Pressed.Connect(() => print("saved")); // Ctrl, then S

/** Lets the player record a chord: up to two modifiers and a key, held together, then let go */
export function RecordQuickSave(): () => void {
	const keys = QuickSave.Bindings.KeyboardAndMouse;
	return keys.CaptureChord(
		(chord) => print(chord === undefined ? "unchanged" : `Quick save is now ${keys.Describe()}`),
		{ Cancel: [Enum.KeyCode.Backspace], Timeout: 5 },
	);
}

/** Ctrl+S becomes plain S */
export function DropModifier() {
	QuickSave.Bindings.KeyboardAndMouse.Clear("PrimaryModifier");
}
```

- IAS needs the modifier pressed first, and letting go of it releases the chord.
- Modifiers are keyboard keys and gamepad buttons (`LB + A` works); mouse buttons, triggers and
  stick directions can't be modifiers.
- `CaptureChord` is on the keyboard-and-mouse and gamepad bindings of Bool and Direction1D actions,
  and on those actions ([recipe 3](#3-a-rebind-menu)).
- **A chord doesn't block its plain key:** Ctrl then S also fires `Move`'s S, and `FindConflicts`
  lists the pair with `Identical: false`. Choose a key nothing uses plain, or check the modifier in
  the plain action's handler (`UserInputService.IsKeyDown(Enum.KeyCode.LeftControl)`).
- More: [Capturing a chord](Advanced.md#capturing-a-chord).

## 9. Turn gameplay off while a menu is open

```ts
// src/client/Menu.ts
import { Input } from "client/Input";

/** Opens the menu: the Menu context on and gameplay off, until Cancel (B, or ButtonB) closes it */
export function OpenMenu() {
	const closeMenu = Input.Menu.Request(true); // the schema declares Menu with Enabled: false
	const resumeGameplay = Input.Gameplay.Request(false); // releases what is held: no stuck Move
	Input.Menu.Actions.Cancel.Pressed.Once(() => {
		closeMenu();
		resumeGameplay();
	});
}
```

- A context is off while any `Request(false)` is held, else on while any `Request(true)` is held,
  else at its base state (`SetEnabled`). So a menu and a cutscene can each hold gameplay off, and
  it comes back once both let go. Calling a release function twice does nothing.
- Turning a context off releases its held actions: `Released` fires (under Server Authority, on the
  server too).
- Focus loss is handled for you: a TextBox taking focus, the window losing focus or the Roblox menu
  opening releases every held action.
- More: [Contexts](Advanced.md#contexts).

## Don't

- **Don't make IAS instances in code for what the schema declares, or write their keys or
  `Enabled` yourself.** Declare them in the schema and go through the handles (`Set`, `SetEnabled`,
  `Request`, `AttachButton`): they save rebinds, release held actions and follow the Server
  Authority swap. A tree made in Studio with the Input Action Manager is fine: `Create` adopts it by
  name.
- **Don't bind the same keys through ContextActionService.** A CAS binding that returns `Sink`
  blocks IAS for its keys; one that passes runs beside it.
- **Don't call `Create` more than once per folder** unless you need several root handles: call it
  once and share the handle. Several root handles share the instances, with rules of their own
  ([Edge cases](EdgeCases.md#several-root-handles-on-one-folder)).
- **Don't look for a capture on touch.** The `Touch` binding has none: offer `TouchPosition`,
  `TouchDelta` or `TouchPinch` with `Set`, or an on-screen button.
- **Don't capture gamepad keys while a GUI object is selected.** Roblox's UI navigation gives
  `ButtonA` to the selected button: set `GuiService.SelectedObject = undefined` first.
- **Don't block input with an `InputCatcher` during a rebind.** The capture then hears only its
  `Cancel` keys. Turn contexts off with `Request(false)`.
- **Don't expect a chord to block its plain key** ([recipe 8](#8-chords)).
- **Don't read mouse movement, the wheel or touch drags as amounts.** They are rates: multiply by
  the frame's delta time.
- **Don't keep an `Instance` across the Server Authority swap.** Keep the handle, and attach labels
  with `AttachLabel`.
- **Don't decode a client's save on the server.** Clean it with `SanitizeBindings`.
