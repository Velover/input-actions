# RawInputHandler

Reads the default PlayerModule's input: the character's move vector, and the camera's rotation and
zoom input. It suits custom character controllers and cameras that keep Roblox's default controls.

```ts
import { RawInputHandler } from "@rbxts/input-actions";
import { RunService } from "@rbxts/services";

RawInputHandler.Initialize();

RunService.RenderStepped.Connect(() => {
	const move = RawInputHandler.GetMoveVector(true, true); // camera-relative, unit length
	const rotation = RawInputHandler.GetRotation(); // this frame's camera rotation input
	const zoom = RawInputHandler.GetZoomDelta();
});
```

## API

| Member | |
| --- | --- |
| `Initialize()` | finds the PlayerModule's input and starts reading it every frame; waits for `game.Loaded`; calling it again does nothing |
| `GetMoveVector(relativeCamera?, normalized?, followFullRotation?): Vector3` | the move input, `X` right and `-Z` forward. `relativeCamera` rotates it by the camera's yaw; `followFullRotation` also applies pitch and roll; `normalized` returns the unit vector |
| `GetRotation(): Vector2` | this frame's camera rotation input |
| `GetZoomDelta(): number` | this frame's zoom input |
| `ControlSetEnabled(enabled)` | turns the character controls on or off |
| `MouseInputSetEnabled(enabled)` | turns the camera input on or off |
| `IsUsingInputActionSystem(): boolean` | whether it found the IAS player scripts |

## IAS player scripts and the legacy fallback

- **IAS player scripts** (`Workspace.PlayerScriptsUseInputActionSystem = Enabled`): it reads the
  contexts the PlayerModule itself reads. The character's (`CharacterContext`) come from
  `LocalPlayer.InputContexts` under Server Authority, else from
  `StarterPlayer.PlayerModule.InputContexts`. The camera's (`CameraContext`) always come from
  `StarterPlayer.PlayerModule.InputContexts`: Roblox's CameraModule reads those in every mode, and
  tunes only those (the player's copy keeps the default sensitivity and invert).
  - The move vector is `CharacterContext.MoveAction` (`Vector2`, X right, Y forward) as
    `Vector3(x, 0, -y)`. It includes the touch thumbsticks and click-to-move, which the PlayerModule
    feeds through Scriptable bindings.
  - Rotation is `CameraContext.CameraRotationAction` times the frame's delta time (with the touch
    pitch adjustment of Roblox's `CameraInput`), and zoom is `CameraZoomAction` times delta time.
    Roblox's CameraModule already applies the sensitivity and invert settings to those bindings,
    and disables those actions when it turns camera input off; this module only reads them.
  - `ControlSetEnabled` sets `CharacterContext.Enabled` (the PlayerModule never toggles that
    context itself). Under Server Authority, disabling it on the client alone would leave the
    server's actions held (the character would keep walking there), so `ControlSetEnabled(false)`
    first releases them: a temporary Scriptable binding fires the held value then the value at
    rest, and is removed in the same frame. `RotationAction`, which carries a setting, is left
    alone. The value is remembered: when `LocalPlayer.InputContexts` arrives after the call (until
    then the module's own contexts are read), its `CharacterContext` takes it, and the one read
    before gets its own `Enabled` back. `MouseInputSetEnabled` only gates what
    `GetRotation`/`GetZoomDelta` return; Roblox's instances are left alone.
- **Legacy player scripts:** it uses `PlayerModule:GetControls()` for the move vector and
  `ControlSetEnabled`, and a fork of the legacy `CameraInput` module for rotation and zoom. That fork
  binds camera keys through ContextActionService, which sinks `Left`/`Right` (see the
  [UI navigation preset](../Advanced.md#ui-navigation-preset)).

The per-frame read runs at render priority `Input + 1`. In frames where the client renders nothing
(a Studio window that isn't drawn), it runs on `RunService.PreAnimation` instead.
