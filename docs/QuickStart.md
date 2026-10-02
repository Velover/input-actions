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
				Mouse: Enum.KeyCode.MouseLeftButton,
				Gamepad: { KeyCode: Enum.KeyCode.ButtonR2, PressedThreshold: 0.6 },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S, Left: Enum.KeyCode.A, Right: Enum.KeyCode.D },
				Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable,
			}),
			Look: InputActions.Direction2D({
				Mouse: { KeyCode: Enum.KeyCode.MouseDelta, Scale: 0.02, Vector2Scale: new Vector2(1, -1) },
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

- Each builder takes the bindings, as a record of **slot name** to binding, and options
  (`TrackPrevious`, `DisplayName`, `Enabled`). The slot names are yours; use the Input Action
  Manager's device names (`KeyboardAndMouse`, `Gamepad`, `Touch`) to adopt its bindings. `Script`
  and `UIButton1`, `UIButton2`, ... are taken: the package names its own bindings `<Action>Script`
  and `<Action>UIButton<n>`. A slot `S` finds a binding named `S` or `<Action>S`, so one action
  can't have both `Pad` and `JumpPad` (on `Jump`).
- A binding is a bare key (`Enum.KeyCode.Space`), an object (`{ KeyCode, PressedThreshold }`, or
  composite `{ Up, Down, Left, Right }`), or `InputActions.Scriptable`.
- One input source per binding: `KeyCode` and composite directions can't share one (IAS ignores the
  composites when `KeyCode` is set). Put them in separate slots.
- The compiler rejects keys an action type can't use, and reserved keys (Escape, ButtonStart, F9,
  F11, F12, Print). See the tables in the [API reference](API.md#key-groups).

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
const jumpKey = Input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
jumpKey.Set(Enum.KeyCode.F);
const cancel = jumpKey.Capture("KeyCode", (key) => print(`bound to ${key.Name}`));
// or keys held together, such as Ctrl+Shift+J: up to two modifiers and a key
jumpKey.CaptureChord((chord) => print(chord?.KeyCode), { Timeout: 5 });

const save = Input.ExportBindings(); // store it (DataStore through a remote, etc.)
Input.ImportBindings(save); // on the next join
```

Next: [Advanced](Advanced.md) for rebinding UIs, saves, on-screen buttons, TrackPrevious and Server
Authority.
