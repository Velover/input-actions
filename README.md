# @rbxts/input-actions

A typed wrapper over Roblox's [Input Action System](https://create.roblox.com/docs/input/input-action-system)
(IAS) for roblox-ts. You describe your contexts, actions and bindings once as a schema; the package
gets or creates the `InputContext` / `InputAction` / `InputBinding` instances and hands back typed
handles. Its extras: rebinding with a JSON save format, per-frame "just pressed" tracking, context
requests, on-screen buttons and Server Authority support.

- **Typed from the schema.** `Move.GetState()` is a `Vector2`, `Jump.Pressed` exists only on Bool
  actions, and a binding IAS can't use (a mouse delta on a Bool action, Escape, a thumbstick as a
  composite direction) is a compile error.
- **Works with the Input Action Manager.** Contexts the Manager made in `ReplicatedStorage.Inputs`
  are adopted by name (`JumpKeyboardAndMouse`, `JumpGamepad`...), and what the designer set wins.
- **Rebinding:** `Set`, `Reset`, `Clear`, `Capture`, and `ExportBindings` / `ImportBindings` that
  save only what the player changed. `SanitizeBindings` cleans a save on the server.
- **Contexts:** a base state plus `Request(true | false)` holds; focus loss (TextBox, window, menu)
  releases held keys.
- **Server Authority:** opt in per context with `ServerAuthority: true`. The server provides those
  contexts to each player and reads the state; the keybinds stay on the client.
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
const save = Input.ExportBindings(); // JSON of what differs from the defaults
const release = Input.Ui.Request(true); // open the menu context until release()
```

## Documentation

- [Introduction](docs/Introduction.md): the model, and what changed from 0.5
- [Quick start](docs/QuickStart.md): a schema, the handle, reading input
- [Advanced](docs/Advanced.md): contexts, rebinding and saves, on-screen buttons, TrackPrevious,
  Server Authority, and the IAS behaviours to know
- [API reference](docs/API.md)
- Kept utilities: [MouseController](docs/Components/MouseController.md),
  [InputCatcher](docs/Components/InputCatcher.md), [RawInputHandler](docs/Components/RawInputHandler.md)
- [Examples](examples/)

## License

MIT License - see the [LICENSE](LICENSE) file for details.
