# @rbxts/input-actions

A typed wrapper over Roblox's [Input Action System](https://create.roblox.com/docs/input/input-action-system)
(IAS) for roblox-ts. You describe your contexts, actions and bindings once as a schema; the package
gets or creates the `InputContext` / `InputAction` / `InputBinding` instances and hands back typed
handles. On top of IAS it adds rebinding with a JSON save format, rebind-menu helpers, gestures,
per-frame "just pressed" tracking, context requests, on-screen buttons, keybind labels and Server
Authority support.

**New here? Read the [Guide](docs/Guide.md)**: the model in a few lines, then a recipe for each
everyday task. All the docs: [docs/README.md](docs/README.md).

- **Typed from the schema.** `Move.GetState()` is a `Vector2`, `Jump.Pressed` exists only on Bool
  actions, and a binding IAS can't use is a compile error that says why:
  `Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys`.
- **Device bindings.** An action's bindings are named after the devices, `KeyboardAndMouse`,
  `Gamepad` and `Touch`, each taking only its device's keys, and every action has the three, so a
  player can give a gamepad button to an action bound on the keyboard only. A device takes extra
  bindings through a namespace, `{ Main: WASD, Arrows: ARROWS }`, each a typed handle
  (`Move.Bindings.KeyboardAndMouse.Arrows`). `InputActions.PreferredDevice()` names the device in
  use.
- **Works with the Input Action Manager.** Contexts it made in `ReplicatedStorage.Inputs` are
  adopted by name (`JumpKeyboardAndMouse`, `JumpGamepad`...), and what the designer set wins.
- **Rebinding:** `Set`, `Reset`, `Clear`, `Capture` (one key) and `CaptureChord` (keys held
  together, such as Ctrl+Shift+J), on one device's binding and with its keys, sticks and triggers
  included; a one-field `action.Capture` where the first key pressed picks the device;
  `ExportBindings` / `ImportBindings`, which save only what the player changed, and
  `SanitizeBindings` to clean a save on the server.
- **Rebind menus:** `Describe()` gives a keybind as text (`"Ctrl + S"`, `"W / A / S / D"`, in the
  player's keyboard layout); `FindConflicts` lists the bindings that share a key with one just
  captured; `InputActions.PreferredDeviceChanged` fires when the player switches device.
- **Gestures** on Bool actions: `OnTap`, `OnDoubleTap`, `OnHold` (with a progress fraction each
  frame) and `OnLongPress`.
- **UI:** `AttachButton` turns a GuiButton into an on-screen button for a Bool action, and
  `AttachLabel` points Roblox's `InputActionLabel` at any action. Nothing React-specific.
- **Contexts:** a base state plus `Request(true | false)` holds; focus loss (TextBox, window, menu)
  releases held keys.
- **Server Authority:** opt in per context with `ServerAuthority: true`. The server provides those
  contexts to each player and reads the state; the keybinds stay on the client.
  `InputActions.IsServerAuthority()` tells, best-effort, whether the place runs Server Authority,
  and `Create` and `ProvideToPlayers` warn when a marked context meets a place without it
  ([details](docs/Advanced.md#is-server-authority-on)).
- Kept from 0.5: `MouseController`, `InputCatcher`, `RawInputHandler`.

## Installation

```bash
bun add @rbxts/input-actions
# or: npm install @rbxts/input-actions
```

Only `@rbxts/services` is a dependency.

## Quick start

```ts
// shared/InputSchema.ts: plain data, safe to require on client and server
import { InputActions } from "@rbxts/input-actions";

export const InputSchema = InputActions.Schema({
	Gameplay: {
		Priority: 2000,
		Sink: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space, Gamepad: Enum.KeyCode.ButtonA }),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S, Left: Enum.KeyCode.A, Right: Enum.KeyCode.D },
				Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable, // driven from code, e.g. an on-screen stick
			}),
			Crouch: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.C }, { TrackPrevious: true }),
		},
	},
	Ui: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
});
```

```ts
// client
import { InputActions } from "@rbxts/input-actions";
import { InputSchema } from "shared/InputSchema";

const Input = InputActions.Create(InputSchema);
const { Jump, Move, Crouch } = Input.Gameplay.Actions;

Jump.Pressed.Connect(() => print("jump"));
const direction = Move.GetState(); // Vector2
if (Crouch.IsJustPressed()) print("crouched this frame");

Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F); // rebind
Jump.Capture((key, device) => print(`${key?.Name} on ${device}`)); // the next key, either device
const save = Input.ExportBindings(); // JSON of what differs from the defaults
const release = Input.Ui.Request(true); // open the menu context until release()
```

## Upgrading from 0.6

0.7.0 breaks schemas that name bindings freely:

- **Binding names are devices.** A binding with keys is named `KeyboardAndMouse`, `Gamepad` or
  `Touch`, and takes only that device's keys: rename `Mouse`, `Keyboard`, `Pad`... `Schema` throws
  on any other name, naming it. **A second binding of a device becomes an extra** in the device's
  namespace, `{ Main: <binding>, <Name>: <binding> }`, under a name of your own:

  ```ts
  // const K = Enum.KeyCode; 0.6:
  Move: InputActions.Direction2D({
  	Keyboard: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
  	Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
  	Pad: K.Thumbstick1,
  }),
  Jump: InputActions.Bool({ Keyboard: K.Space, Alternate: K.F }),
  // 0.7
  Move: InputActions.Direction2D({
  	KeyboardAndMouse: {
  		Main: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
  		Arrows: { Up: K.Up, Down: K.Down, Left: K.Left, Right: K.Right },
  	},
  	Gamepad: K.Thumbstick1,
  }),
  Jump: InputActions.Bool({ KeyboardAndMouse: { Main: K.Space, Alternate: K.F } }),
  ```

  `Move.Bindings.Arrows` becomes `Move.Bindings.KeyboardAndMouse.Arrows`; `Move.Bindings.KeyboardAndMouse`
  is still `Main`'s handle. An extra can't be named `Main`, after a binding handle's member (`Get`,
  `Set`, `Capture`...) or a binding property (`KeyCode`, `Up`...). See
  [Several bindings per device](docs/Advanced.md#several-bindings-per-device).
- **Every other binding is `InputActions.Scriptable`** (driven from code); a Scriptable under a
  device's name is refused.
- **Every action has the three device bindings**, unbound when the schema leaves one out:
  `Bindings.Gamepad` exists on a keyboard-only action, and `Get()` returns `{}` there.
- **Captures are per device.** `Bindings.Gamepad.Capture` takes gamepad keys only,
  `Bindings.KeyboardAndMouse.Capture` keyboard and mouse keys; another device's keys are ignored,
  and `Cancel` keys count from any device.
  The `Touch` binding has no `Capture`: set touch keys with `Set`. `action.Capture` and
  `action.CaptureChord` (Bool and Direction1D actions) give a menu one field per action.
- **`Capture` calls back on a cancel.** A `Cancel` key now calls `callback(undefined)`, as
  `CaptureChord` does (in 0.6 it called nothing), so its callback is typed
  `(key: Enum.KeyCode | undefined) => void`: check for `undefined` before using the key
  (`if (key !== undefined) print(key.Name)`), and close a rebind prompt there. The function a
  capture returns still stops it without calling back.
- **Saves** keep their format. Entries under the device names load as before; others are skipped
  with a reason (`Mouse is not a device: ...`). An extra saves at `Context/Action/Device/Extra`. To
  keep a 0.6 save's rebinds, rename its paths on the JSON string before importing it (an entry whose
  keys aren't that device's is still skipped). Every 0.6 binding name needs its own rename: each one
  that became a device (`Keyboard`, `Pad`) and each one that became an extra (`Arrows`, `Alternate`,
  under the device it now belongs to). For the example above:

  ```ts
  const [renamed] = json.gsub('"([^"/]+/[^"/]+)/Keyboard":', '"%1/KeyboardAndMouse":');
  const [padded] = renamed.gsub('"([^"/]+/[^"/]+)/Pad":', '"%1/Gamepad":');
  const [arrows] = padded.gsub('"([^"/]+/[^"/]+)/Arrows":', '"%1/KeyboardAndMouse/Arrows":');
  const [migrated] = arrows.gsub('"([^"/]+/[^"/]+)/Alternate":', '"%1/KeyboardAndMouse/Alternate":');
  Input.ImportBindings(migrated);
  ```
- **Bindings in the folder or a template** are adopted by the new names only (`JumpKeyboardAndMouse`,
  `JumpGamepad`, `JumpTouch`, or the bare device name; an extra as `<Action><Device><Extra>`,
  `MoveKeyboardAndMouseArrows`). One named after an old slot (`JumpKeyboard`, `MoveArrows`) keeps
  running beside the package's new binding, with a warning in Studio: rename or delete it.
- **Types:** `InputActions.InputSchema<S>` is now the checked schema type: a helper generic over the
  schema takes `InputSchema<S>` to pass it to `Create`, `ForPlayer`, `ProvideToPlayers` or
  `SanitizeBindings` (one typed `{ Contexts: S }` no longer can). `InputActions.BindingHandle<A>` is
  the keyboard-and-mouse or gamepad binding; type a variable that may hold the `Touch` one
  `InputActions.BindingHandle<A, InputActions.Device>`.
- The `UiNavigation` preset's `Scroll` is the wheel on the keyboard and mouse (its `Mouse` slot and
  the `PageUp`/`PageDown` composite are gone; for both, declare the action yourself with an extra).

## Documentation

- [Guide](docs/Guide.md): the model, and a recipe for each everyday task. Start here.
- [Quick start](docs/QuickStart.md): a schema, the handle, reading input, step by step
- [Introduction](docs/Introduction.md): how the package sits on IAS, and what changed from 0.5
- [Advanced](docs/Advanced.md): each feature in full, and the IAS behaviours to know
- [Edge cases](docs/EdgeCases.md): several `Create`s on one folder, held actions whose bindings
  change, the Server Authority swap step by step
- [API reference](docs/API.md)
- Kept utilities: [MouseController](docs/Components/MouseController.md),
  [InputCatcher](docs/Components/InputCatcher.md), [RawInputHandler](docs/Components/RawInputHandler.md)
- [Examples](https://github.com/Velover/input-actions/tree/master/examples) (in the repository only, not in the npm package)

## License

MIT License - see the [LICENSE](LICENSE) file for details.
