# Quick start

## 1. Describe the input in a shared module

```ts
// src/shared/InputSchema.ts
import { InputActions } from "@rbxts/input-actions";

export const InputSchema = InputActions.Schema({
	Gameplay: {
		Priority: 2000, // above the default PlayerModule contexts
		Sink: true, // lower contexts don't see keys bound here
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space, Gamepad: Enum.KeyCode.ButtonA }),
			Fire: InputActions.Bool({
				KeyboardAndMouse: Enum.KeyCode.MouseLeftButton,
				Gamepad: { KeyCode: Enum.KeyCode.ButtonR2, PressedThreshold: 0.6 },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S, Left: Enum.KeyCode.A, Right: Enum.KeyCode.D },
				Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable,
			}),
			Look: InputActions.Direction2D({
				KeyboardAndMouse: { KeyCode: Enum.KeyCode.MouseDelta, Scale: 0.02, Vector2Scale: new Vector2(1, -1) },
				Gamepad: Enum.KeyCode.Thumbstick2,
			}),
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: Enum.KeyCode.S, PrimaryModifier: Enum.KeyCode.LeftControl },
			}),
			Crouch: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.C }, { TrackPrevious: true }),
			Dash: InputActions.Bool(), // no hardware binding: driven from code
		},
	},
	Ui: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
});
```

- Each builder takes the bindings, as a record of name to binding, and options (`TrackPrevious`,
  `DisplayName`, `Enabled`). **A binding with keys is named after its device**: `KeyboardAndMouse`,
  `Gamepad` or `Touch` (the names the Input Action Manager gives its bindings, so its tree is
  adopted), and takes only that device's keys: a keyboard key on `Gamepad` is a compile error. Any
  other name is for `InputActions.Scriptable`, a binding you drive from code (`Virtual` above).
- **Every action has the three device bindings**, unbound when you leave one out: `Dash` has them
  too, and `Crouch.Bindings.Gamepad` is there for a player to bind.
- **Several bindings of one device** go in a namespace: `KeyboardAndMouse: { Main: <WASD>, Arrows:
  <the arrows> }`. `Bindings.KeyboardAndMouse` is then `Main`'s handle, and
  `Bindings.KeyboardAndMouse.Arrows` the extra's (see
  [Several bindings per device](Advanced.md#several-bindings-per-device)).
- `Script` and `UIButton1`, `UIButton2`, ... are taken: the package names its own bindings
  `<Action>Script` and `<Action>UIButton<n>`. A name `S` finds a binding named `S` or `<Action>S`,
  so `Jump` can't have a Scriptable named `JumpGamepad` (its Gamepad binding is `JumpGamepad`).
- A binding is a bare key (`Enum.KeyCode.Space`), an object (`{ KeyCode, PressedThreshold }`, or
  composite `{ Up, Down, Left, Right }`), or `InputActions.Scriptable`.
- One input source per binding: `KeyCode` and composite directions can't share one (IAS ignores the
  composites when `KeyCode` is set).
- The compiler rejects keys an action type can't use, another device's keys, and reserved keys
  (Escape, ButtonStart, F9, F11, F12, Print). See the tables in the
  [API reference](API.md#key-groups).

## 2. Create the handle on the client

```ts
// src/client/Input.ts
import { InputActions } from "@rbxts/input-actions";
import { InputSchema } from "shared/InputSchema";

export const Input = InputActions.Create(InputSchema);
```

`Create` waits for `game.Loaded`, then gets or creates everything in `ReplicatedStorage.Inputs`
(pass `{ Folder }` to use another). Call it once and share the handle.

## 3. Read the input

```ts
import { RunService } from "@rbxts/services";
import { Input } from "client/Input";

const { Jump, Move, Look, Crouch, Dash } = Input.Gameplay.Actions;

// events: the IAS signals, typed
Jump.Pressed.Connect(() => print("jump"));
Move.StateChanged.Connect((direction) => print(direction)); // Vector2

// polling, for continuous input
RunService.RenderStepped.Connect((deltaTime) => {
	const direction = Move.GetState();
	// MouseDelta (like MouseWheel and TouchDelta) reads as a rate: times the frame's time, pixels
	const turn = Look.GetState().mul(deltaTime);
	if (Crouch.IsJustPressed()) print("crouch"); // needs TrackPrevious: true
});

// gestures, on Bool actions: each returns a function that stops it
Jump.OnDoubleTap(() => print("double jump"));
Jump.OnHold(() => print("charged"), { Duration: 1, Progress: (fraction) => print(fraction) });

// driving actions from code
Dash.Fire(true);
Dash.Tap(); // true now, false next frame
Move.Bindings.Virtual.Fire(new Vector2(0, 1)); // an on-screen stick
```

## 4. Switch contexts

```ts
// the Ui context was declared with Enabled: false
const closeMenu = Input.Ui.Request(true);
const pauseGameplay = Input.Gameplay.Request(false);
// ...later
closeMenu();
pauseGameplay();
```

A `false` request always wins over `true` requests and the base state (`SetEnabled`). Disabling a
context releases its held actions (on the server too, for Server Authority contexts).

## 5. Let players rebind

```ts
const jump = Input.Gameplay.Actions.Jump;
const jumpKey = jump.Bindings.KeyboardAndMouse;
jumpKey.Set(Enum.KeyCode.F);
const cancel = jumpKey.Capture("KeyCode", (key) => print(`bound to ${key.Name}`));
// or keys held together, such as Ctrl+Shift+J: up to two modifiers and a key
jumpKey.CaptureChord((chord) => print(chord?.KeyCode), { Timeout: 5 });
// one field per action: the first key pressed picks the device (keyboard or gamepad)
jump.Capture((key, device) => print(`${key.Name} on ${device}`));
// the binding of the device the player uses ("KeyboardAndMouse", "Gamepad" or "Touch")
print(jump.Bindings[InputActions.PreferredDevice()].Get());
print(jump.Describe()); // that keybind as text: "Space", "Ctrl + S", "W / A / S / D"
// after a capture: the other bindings that now share the key
for (const conflict of Input.FindConflicts(jumpKey)) print(`also ${conflict.Path}`);

const save = Input.ExportBindings(); // store it (DataStore through a remote, etc.)
Input.ImportBindings(save); // on the next join
```

A binding's `Capture` takes its own device's keys only: `jump.Bindings.Gamepad.Capture` waits for
a gamepad button. Touch has no keys to press, so the `Touch` binding has no `Capture`: give it
`TouchPosition` (a tap), `TouchDelta` or `TouchPinch` with `Set`.

## 6. Show keybinds in UI

```ts
const label = new Instance("InputActionLabel"); // Roblox shows the keybind for the device in use
label.Parent = hints;
Input.Gameplay.Actions.Jump.AttachLabel(label); // returns a function that lets go
// or as text, for the device in use, refreshed when the player switches device
hint.Text = `Jump: ${Input.Gameplay.Actions.Jump.Describe()}`;
InputActions.PreferredDeviceChanged.Connect(() => (hint.Text = `Jump: ${Input.Gameplay.Actions.Jump.Describe()}`));
```

Next: the [Guide](Guide.md) has a recipe for each everyday task (a rebind menu, saves, buttons,
labels, Server Authority...), and [Advanced](Advanced.md) explains each feature in full.
