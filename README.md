# @rbxts/input-actions

A typed wrapper over Roblox's [Input Action System](https://create.roblox.com/docs/input/input-action-system)
(IAS) for roblox-ts. You describe your contexts, actions and bindings once as a schema; the package
gets or creates the `InputContext` / `InputAction` / `InputBinding` instances and hands back typed
handles. Its extras: rebinding with a JSON save format, per-frame "just pressed" tracking, context
requests, on-screen buttons, keybind labels and Server Authority support.

- **Typed from the schema.** `Move.GetState()` is a `Vector2`, `Jump.Pressed` exists only on Bool
  actions, and a binding IAS can't use (a mouse delta on a Bool action, Escape, a thumbstick as a
  composite direction) is a compile error.
- **Device bindings.** An action's bindings are named after the devices, `KeyboardAndMouse`,
  `Gamepad` and `Touch`, and each takes only its device's keys (a keyboard key on the gamepad's
  binding is a compile error). Every action has the three, so a player can give a gamepad button to
  an action the game bound on the keyboard only. `InputActions.PreferredDevice()` names the device
  in use.
- **Works with the Input Action Manager.** Contexts the Manager made in `ReplicatedStorage.Inputs`
  are adopted by name (`JumpKeyboardAndMouse`, `JumpGamepad`...), and what the designer set wins.
- **Rebinding:** `Set`, `Reset`, `Clear`, `Capture` (one key), `CaptureChord` (keys held together,
  such as Ctrl+Shift+J, with an optional timeout), each on one device's binding and taking that
  device's keys, sticks and triggers included; a one-field `action.Capture` where the first key
  pressed picks the device; and `ExportBindings` / `ImportBindings` that save only what the player
  changed. `SanitizeBindings` cleans a save on the server.
- **UI:** `AttachButton` turns a GuiButton into an on-screen button for a Bool action, and
  `AttachLabel` points Roblox's `InputActionLabel` at any action to show its keybind for the device
  in use. Both return a function that undoes them; nothing React-specific is in the package.
- **Contexts:** a base state plus `Request(true | false)` holds; focus loss (TextBox, window, menu)
  releases held keys.
- **Server Authority:** opt in per context with `ServerAuthority: true`. The server provides those
  contexts to each player and reads the state; the keybinds stay on the client. Until the server's
  copy arrives the client runs on a local stand-in; `WhenLinkedToServer` calls back once it has.
  `InputActions.IsServerAuthority()` tells, best-effort, whether the place runs Server Authority.
  Scripts can't read `Workspace.AuthorityMode`, so it reads the error message
  `workspace.Terrain:CanSetNetworkOwnership()` gives, which names the mode. It answers `undefined`
  when it can't tell: on the client before the game has loaded (there is no `Terrain` yet), or if
  Roblox rewords the message. `Create` and `ProvideToPlayers` warn when a marked context meets a
  place without it ([details](docs/Advanced.md#is-server-authority-on)).
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
Jump.Capture((key, device) => print(`${key.Name} on ${device}`)); // the next key, either device
const save = Input.ExportBindings(); // JSON of what differs from the defaults
const release = Input.Ui.Request(true); // open the menu context until release()
```

## Upgrading from 0.6

0.7.0 breaks schemas that name bindings freely:

- **Binding names are devices.** A binding with keys is named `KeyboardAndMouse`, `Gamepad` or
  `Touch`, and takes only that device's keys: rename `Mouse`, `Keyboard`, `Pad`, `Alternate`... A
  second binding on the same device (WASD beside the arrows) is no longer possible: pick one, or let
  the player rebind. `Schema` throws on any other name, naming it.
- **Every other binding is `InputActions.Scriptable`** (driven from code); a Scriptable under a
  device's name is refused.
- **Every action has the three device bindings**, unbound when the schema leaves one out:
  `Bindings.Gamepad` exists on a keyboard-only action, and `Get()` returns `{}` there.
- **Captures are per device.** `Bindings.Gamepad.Capture` takes gamepad keys only (VirtualInput's
  and real ones), `Bindings.KeyboardAndMouse.Capture` keyboard and mouse keys; other devices' keys
  are ignored, and `Cancel` keys count from any device. The `Touch` binding has no `Capture` (a tap
  is never captured: set touch keys with `Set`). `action.Capture` and `action.CaptureChord` (Bool
  and Direction1D actions) give a menu one field per action.
- **Saves** keep their format: entries under the device names load as before; others are skipped
  with a reason (`Mouse is not a device: ...`). To keep a 0.6 save's rebinds, rename its paths to
  the device each old slot became before importing it, on the JSON string itself (one old slot per
  device: two entries under one path keep only one); an entry whose keys aren't that device's is
  still skipped, with a reason:

  ```ts
  const [renamed] = json.gsub('"([^"/]+/[^"/]+)/Keyboard":', '"%1/KeyboardAndMouse":');
  const [migrated] = renamed.gsub('"([^"/]+/[^"/]+)/Pad":', '"%1/Gamepad":');
  Input.ImportBindings(migrated);
  ```
- **Bindings in the folder or a template** are adopted by the new names only (`JumpKeyboardAndMouse`,
  `JumpGamepad`, `JumpTouch`, or the bare device name). One named after an old slot (`JumpKeyboard`)
  is no longer adopted: it keeps running beside the package's new binding, with only a warning in
  Studio. Rename or delete such bindings.
- **Types:** `InputActions.InputSchema<S>` is now the checked schema type (a misspelt context option
  is a compile error there too): a helper generic over the schema takes `InputSchema<S>` to pass it
  to `Create`, `ForPlayer`, `ProvideToPlayers` or `SanitizeBindings`; one typed `{ Contexts: S }`
  no longer can. `InputActions.BindingHandle<A>` is the keyboard-and-mouse or gamepad binding (the
  ones with `Capture`): type a variable that may hold the `Touch` one
  `InputActions.BindingHandle<A, InputActions.Device>`.
- The `UiNavigation` preset's `Scroll` is the wheel on the keyboard and mouse (its `Mouse` slot and
  the `PageUp`/`PageDown` composite are gone).

## Documentation

- [Introduction](docs/Introduction.md): the model, and what changed from 0.5
- [Quick start](docs/QuickStart.md): a schema, the handle, reading input
- [Advanced](docs/Advanced.md): contexts, rebinding and saves, on-screen buttons, TrackPrevious,
  Server Authority, and the IAS behaviours to know
- [API reference](docs/API.md)
- Kept utilities: [MouseController](docs/Components/MouseController.md),
  [InputCatcher](docs/Components/InputCatcher.md), [RawInputHandler](docs/Components/RawInputHandler.md)
- [Examples](https://github.com/Velover/input-actions/tree/master/examples) (in the repository only, not in the npm package)

## License

MIT License - see the [LICENSE](LICENSE) file for details.
