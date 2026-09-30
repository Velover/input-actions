# @rbxts/input-actions on the Input Action System: design spec

The package becomes a typed wrapper over Roblox's Input Action System (IAS): `InputContext`,
`InputAction`, `InputBinding`. This is a breaking rewrite. Everything here was decided with the
package author; the facts marked **(probed)** were measured in Studio on 2026-09-30 (see
[Probed IAS behaviour](#probed-ias-behaviour)). The IAS reference is
[docs/Reference/RobloxInputActionSystem.md](../Reference/RobloxInputActionSystem.md).

## 1. What stays, what goes

| Now | After |
|---|---|
| `ActionsController`, `InputManagerController` (+ `InputEvent`, `InputEventData`, `InputSignal`) | Removed. IAS actions, wrapped by typed handles |
| `InputContextController` / `InputContext` class | Removed. IAS `InputContext`, wrapped |
| `InputConfigController`, `ThumbstickHelper` | Removed. Binding thresholds / `ResponseCurve` |
| `KeyCombinationController` | Removed. `PrimaryModifier` / `SecondaryModifier` |
| `InputEchoController`, `HapticFeedbackController` | Removed |
| `DeviceTypeHandler`, `EInputType`, `EDeviceType`, `EInputDeviceType`, `IInputMap` | Removed. `UserInputService.PreferredInput`, `InputAction.PreferredBinding` |
| `EDefaultInputAction` + default UI context | Removed. `InputActions.Presets.UiNavigation()` |
| `ECustomKey`, `InputKeyCode`, `IActionData`, `EInputBufferIndex`, `EInputEventSubscriptionType`, `EVibrationPreset` | Removed |
| `InputKeyCodeHelper` (custom key icons) | Removed (no icons) |
| `InputActionsInitializationHelper` | Removed |
| `MouseController`, `EMouseLockAction`, `EMouseLockActionPriority` | **Kept.** `MouseDebugMode` becomes `MouseController.SetForceUnlockAction(action)` |
| `InputCatcher` | **Kept, unchanged in behaviour** (CAS sink; since 2026-02 a CAS sink also blocks IAS) |
| `RawInputHandler` | **Kept, same public API**, reworked to read the IAS PlayerModule (see §10) |

- Dependencies: only `@rbxts/services`. Drop `@rbxts/tool_pack` (reimplement the two array helpers
  `MouseController` uses).
- Client only, except the Server Authority functions in §8, which run on the server.

## 2. Public API at a glance

```ts
import { InputActions } from "@rbxts/input-actions";

// shared/InputSchema.ts: plain data, safe to require on client and server. Creates no instances.
export const InputSchema = InputActions.Schema({
	Gameplay: {
		ServerAuthority: true, // optional, see §8
		Priority: 2000,
		Sink: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space, Gamepad: Enum.KeyCode.ButtonA }),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S, Left: Enum.KeyCode.A, Right: Enum.KeyCode.D },
				Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable,
			}),
			Crouch: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.C }, { TrackPrevious: true }),
			Dash: InputActions.Bool(), // no hardware bindings: driven from code
		},
	},
	Ui: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
});

// client
export const Input = InputActions.Create(InputSchema);
const { Jump, Move, Crouch, Dash } = Input.Gameplay.Actions;
Jump.Pressed.Connect(() => {});
Move.GetState(); // Vector2
Crouch.IsJustPressed();
Dash.Fire(true);
Move.Bindings.Virtual.Fire(new Vector2(0, 1));
Jump.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.F);
const release = Input.Ui.Request(true);
const saved = Input.ExportBindings();

// server (Server Authority contexts only)
InputActions.ProvideToPlayers(InputSchema);
InputActions.ForPlayer(InputSchema, player).Gameplay.Actions.Move.GetState();
```

## 3. Typing (verified with tsc against `@rbxts/types` 1.0.955)

The type design was prototyped and type-checked. Use these files as the starting point for
`src/InputActions` types; they are complete, compile in about a second, and hold `@ts-expect-error`
cases for every rule below:

- `C:\Users\cobau\AppData\Local\Temp\claude\c--Projects-TS-NPM-input-actions-package-rbxts\31358b02-106e-45f4-bae5-fcd487a42282\scratchpad\typing\proto2.tsx`
  (key groups, binding shapes, builders, handles, TrackPrevious, the React hook written in a user
  project);
- `...\scratchpad\typing\proto3.tsx` (`Schema`, `ServerAuthority`, `ForPlayer`).

Rules and lessons:

- One builder per action type: `Bool`, `Direction1D`, `Direction2D`, `Direction3D`,
  `ViewportPosition`. Signature: `Bool(bindings?, options?)`, with
  `const B extends Record<string, BindingSpec<T>> = {}` and `const TP extends boolean = false`.
  `options`: `{ TrackPrevious?: TP; DisplayName?: string; Enabled?: boolean }`.
- The value type follows the action type everywhere: `GetState`, `StateChanged`, `Fire`,
  `GetPrevious`. Bool = `boolean`, Direction1D = `number`, Direction2D = `Vector2`, Direction3D =
  `Vector3`, ViewportPosition = `Vector2`.
- `Pressed`, `Released`, `IsPressed`, `Tap`, `AttachButton` exist only on Bool actions.
  `GetPrevious`/`HasChanged` only with `TrackPrevious: true`; `IsJustPressed`/`IsJustReleased`
  only on tracked Bool actions.
- Binding handles: a binding declared `InputActions.Scriptable` gets `Fire(value)`; every other
  binding gets `Set`/`Reset`/`Clear`/`Capture`, and no `Fire`.
- Unknown binding or action names are compile errors.
- **Performance trap:** validating bindings with a mapped type that compares against the whole
  `Enum.KeyCode` union ran tsc out of memory. The prototype's `CheckBindings` compares against
  `EnumItem` and uses `Exclude<keyof B[K], AllKeys<TShape>>`: keep it that way.
- **Enum items matching all-optional shapes:** the composite shapes are all-optional, so a bare
  enum item matched them structurally. Every object shape carries `EnumType?: never`.
- `InputActions.BoolAction` is exported: the type of any Bool action handle, for helpers written in
  user projects (the React hook in §6 takes it).

### Key groups and per-type rules

Define the groups once, as runtime arrays (`as const`), and derive the types from them. The same
arrays validate at runtime: `Set`, `ImportBindings`, `SanitizeBindings`, `Capture`, and bindings
adopted from existing instances.

| Group | Keys |
|---|---|
| Reserved (never allowed) | `Escape`, `ButtonStart`, `F9`, `F11`, `F12`, `Print` |
| Deprecated (never allowed) | `None` (= `Unknown`), `MouseBackButton`, `MouseNoButton`, `MouseX`, `MouseY` |
| MouseButton | `MouseLeftButton`, `MouseRightButton`, `MouseMiddleButton` |
| Axis (single-axis analog, 0..1) | `ButtonL2`, `ButtonR2`, `Thumbstick1Up/Down/Left/Right`, `Thumbstick2Up/Down/Left/Right` |
| Stick | `Thumbstick1`, `Thumbstick2` |
| Delta1D | `MouseWheel`, `TrackpadPinch`, `TouchPinch` |
| Delta2D | `MouseDelta`, `TouchDelta`, `TrackpadPan` |
| Position | `MousePosition`, `TouchPosition` |
| Button | every other `Enum.KeyCode` (keyboard keys, gamepad buttons, TV-remote buttons) |

| Action type | `KeyCode` accepts | Composite directions accept | Other binding properties |
|---|---|---|---|
| Bool | Button, MouseButton, Axis, `TouchPosition` | not allowed | `PressedThreshold`, `ReleasedThreshold` |
| Direction1D | Button, Axis, Delta1D | `Up`/`Down`: Button, Axis | `Scale`, `ClampMagnitudeToOne` |
| Direction2D | Stick, Delta2D | `Up`/`Down`/`Left`/`Right`: Button, Axis | `Scale`, `ClampMagnitudeToOne`, `Vector2Scale`, `ResponseCurve` (Stick only) |
| Direction3D | not allowed | all six: Button, Axis | `Scale`, `ClampMagnitudeToOne`, `Vector3Scale` |
| ViewportPosition | Position | not allowed | none |

- Every binding may have `DisplayName`, `DisplayImage`; every binding except ViewportPosition may
  have `PrimaryModifier`/`SecondaryModifier` (Button keys only).
- One input source per binding (IAS ignores composites and `UIButton` when `KeyCode` is set):
  `KeyCode` together with a composite direction is a compile error.
- A binding in the schema is either a bare key (shorthand for `{ KeyCode }`), an object shape, or
  `InputActions.Scriptable`. `UIButton` never appears in the schema (it is attached at runtime,
  §6).
- At runtime an **unbound** binding (no `KeyCode`, no composite) is legal: the Input Action Manager
  creates them, and `Clear()` produces them. The type rules forbid writing `None` in the schema only.

## 4. Schema, `Create`, and get-or-create

- `InputActions.Schema(contexts)` returns a frozen plain object `{ Contexts }`. The builders and
  `Schema` create no instances and may run on either realm.
- Context schema: `{ ServerAuthority?: boolean; Priority?: number; Sink?: boolean; Enabled?: boolean; Actions }`.
  Defaults are the IAS ones (Priority 1000, Sink false, Enabled true).
- `InputActions.Create(schema, options?)` runs on the client only (throws on the server) and
  returns the typed handle. Options:
  - `Folder?: Instance`: where non-Server-Authority contexts are found or created. Default:
    `ReplicatedStorage.Inputs`, created (client-side) when missing. It is the folder the Input Action
    Manager writes. Wait for `game.Loaded` before looking.
  - `PlayerFolderName?: string`: default `"Inputs"`, the folder under the player for Server
    Authority contexts (§8).
  - `Timeout?: number`: seconds before `Create` warns that the server's copy of a Server
    Authority context has not arrived; default 10. It never throws and never blocks (§8).
  - `ResetOnFocusLoss?: boolean`: default `true` (§5).
- **Get-or-create, matched by name** under the folder:
  - Context named as the schema key; action named as the schema key.
  - A binding for slot `S` of action `A` matches a child `InputBinding` named `S` **or** `A .. S`
    (the Input Action Manager names bindings `<Action><Device>`, e.g. `JumpKeyboardAndMouse`,
    `JumpGamepad`, `JumpTouch`; see `Places/GamePlace.rbxl`). Bindings the package creates are
    named `A .. S`.
- **Precedence: what exists wins.** An existing context keeps its `Priority`, `Sink`, `Enabled`;
  an existing action keeps `Enabled`/`DisplayName`; an existing binding keeps its keys, modifiers
  and tuning. The schema fills only what is missing.
- **Defaults are the tree right after `Create`.** `Reset()` returns a binding to that snapshot
  (designer values when they came from the folder, schema values otherwise).
- An existing action whose `Type` differs from the builder's type: **throw**, naming the path.
- An adopted binding whose keys break the §3 rules: `warn` with the path, and leave it as it is.
- Instances in the folder that the schema doesn't mention: left alone (IAS still runs them), not
  typed, one `warn` per instance in Studio (`RunService.IsStudio()`) naming them. Includes
  bindings whose names match no slot (e.g. the Manager's default `InputBinding` name), because they
  then run beside the package's own binding.
- `Create` twice on the same folder must work (adopts the same instances; creates nothing twice).
- `Input.Destroy()` disconnects everything, destroys what the package created, and leaves adopted
  instances in place.

## 5. Contexts at runtime

```ts
Input.Ui.SetEnabled(true);            // base state
Input.Ui.IsEnabled();
Input.Ui.EnabledChanged.Connect((enabled: boolean) => {});
const release = Input.Gameplay.Request(false); // held until release() is called
Input.Ui.Instance;                    // the InputContext: set Priority/Sink on it directly
```

- Effective `Enabled` = `false` if any `Request(false)` is held; else `true` if any `Request(true)`
  is held; else the base state. The base state starts as the instance's `Enabled` after
  get-or-create. Calling a release function twice is a no-op.
- The wrapper owns `InputContext.Enabled` and writes it whenever the effective value changes.
- Disabling a context releases its held actions (IAS fires `Released`) **(probed)**.
- `ResetOnFocusLoss`: on `UserInputService.TextBoxFocused`, `UserInputService.WindowFocusReleased`
  and `GuiService.MenuOpened`, hold an internal `Request(false)` on every context for one frame, so
  keys whose release is swallowed can't stay stuck. It must not change the base state or
  `EnabledChanged` listeners' view beyond one false/true pair.
- Actions: `action.SetEnabled(boolean)` / `IsEnabled()` pass through to `InputAction.Enabled`
  (IAS resets the state when disabled).

## 6. Actions and bindings at runtime

Action handle (all types):

- **Handle signals are the package's own, not the IAS ones.** `StateChanged`, `Pressed`,
  `Released`, `EnabledChanged` and `BindingsChanged` are backed by `BindableEvent`s (so still typed
  `RBXScriptSignal`) and forward from whichever instance the handle currently wraps. A Server
  Authority context swaps from a local stand-in to the server's copy (§8); connections made before
  the swap must keep working after it. `Instance` always returns the current instance.
- `Instance: InputAction`, `Name`, `Type`.
- `GetState(): V`, `StateChanged: RBXScriptSignal<(value: V) => void>`.
- `Fire(value: V)`: fires a Scriptable binding named `<Action>Script` that the package creates on
  first use. Values go straight into the action state: IAS applies no `Scale`, clamp or
  `Vector2Scale` to fired values **(probed)**.
- `SetEnabled`, `IsEnabled`.
- `Bindings`: typed record of binding handles, one per schema slot.
- `GetPreferredBinding(): InputBinding | undefined` (IAS `PreferredBinding`).

Bool actions add `Pressed`, `Released` (IAS signals), `IsPressed()`, `Tap()` (fires `true`, then
`false` on the next frame), and:

- `AttachButton(button: GuiButton): () => void`. Creates a new Automatic binding
  `<Action>UIButton<n>` with `UIButton = button`; the returned function removes it. Several buttons
  may be attached at once. Also removed when the button is destroyed.
  - **Destroying a held binding leaves the action stuck on (probed).** When the binding is removed
    while the action's state is `true`, reset the action (toggle `InputAction.Enabled` off and back
    on) so it releases.
  - The package contains **nothing React-specific**. A user project writes its own hook, e.g.:
    ```ts
    export function useInputButton(action: InputActions.BoolAction) {
    	const [button, setButton] = useState<GuiButton>();
    	useEffect(() => {
    		if (button === undefined) return;
    		return action.AttachButton(button);
    	}, [action, button]);
    	return setButton; // pass as `ref`
    }
    ```

`TrackPrevious: true` adds `GetPrevious(): V`, `HasChanged(): boolean`, and on Bool actions
`IsJustPressed()`, `IsJustReleased()`:

- One snapshot per frame, at `RunService.BindToRenderStep` priority `Enum.RenderPriority.First`
  (after input is processed), so every read within a frame agrees.
- `IsJustPressed` is also true when the action was pressed and released between two snapshots:
  count `Pressed`/`Released` events since the last snapshot. IAS delivers both events for a
  same-frame true/false pair **(probed)**. A tap that lands after the snapshot counts on the next
  frame.
- Actions without `TrackPrevious` do no per-frame work.

Binding handle (non-Scriptable):

- `Instance: InputBinding`, `Name`.
- `Get()`: the current binding as plain data in the schema's shape (for settings UIs).
- `Set(spec)`: typed as the action type's binding shape (§3), validated at runtime (throws on a
  key or property the action type doesn't allow). Object specs **merge** into the binding; a
  bare key sets `KeyCode` and clears the composites.
- `Reset()`: back to the defaults snapshot (§4). `Clear()`: unbinds (KeyCode and composites
  `None`).
- `Capture(slot, callback, options?): () => void`: waits for the next key that is legal for that
  slot of this binding (`"KeyCode"`, `"Up"`, ..., `"PrimaryModifier"`), applies it, then calls
  `callback(key)`. `options.Cancel?: Enum.KeyCode[]` keys that cancel. The returned function cancels.
  Uses `UserInputService.InputBegan`; ignores `gameProcessed` input.

Scriptable binding handle: `Instance`, `Name`, `Fire(value: V)`.

Root handle: one property per context, plus `ExportBindings()`, `ImportBindings(json)`,
`ResetBindings()`, `BindingsChanged: RBXScriptSignal<(path: string) => void>` (fires on
`Set`/`Reset`/`Clear`/`Capture`/import, with the path `Context/Action/Slot`), `Destroy()`.
Context handles also have `ExportBindings()`, `ImportBindings(json)`, `ResetBindings()` for their
own actions.

**IAS behaviours users must know (probed; put them in the docs):**

- Several bindings on one action are **not combined: the last one to change wins.** Holding A and
  B, then releasing A, releases the action. Same for Direction2D: the state is the last fired or
  moved binding's value.
- `GetState()` updates synchronously after a `Fire`; the events are deferred under
  `SignalBehavior = Deferred`.
- A repeated `Fire` of the same value does nothing. `Fire` on a disabled action or context is
  silently ignored.
- A fired value persists until something changes it.

## 7. Saving keybinds as JSON

```json
{ "Version": 1, "Bindings": {
  "Gameplay/Jump/KeyboardAndMouse": { "KeyCode": "F" },
  "Gameplay/Move/KeyboardAndMouse": { "Up": "Up", "Down": "Down" },
  "Gameplay/Look/Mouse": { "Scale": 0.02, "Vector2Scale": [1, -1] }
} }
```

- `ExportBindings()` returns only what differs from the defaults snapshot, via
  `HttpService.JSONEncode`. Enums by `Name`; `Vector2`/`Vector3` as arrays.
- Saved properties: `KeyCode`, `Up`, `Down`, `Left`, `Right`, `Forward`, `Backward`,
  `PrimaryModifier`, `SecondaryModifier`, `Scale`, `Vector2Scale`, `Vector3Scale`, `ResponseCurve`,
  `PressedThreshold`, `ReleasedThreshold`. A cleared binding saves its keys as `"None"`.
- `ImportBindings(json)` returns `{ Applied: string[]; Skipped: { Path: string; Reason: string }[] }`
  and never throws:
  - bad JSON, a non-object, or an unknown `Version`: nothing applied, everything stays default;
  - it starts from the defaults (a binding missing from the save is reset to default);
  - unknown path, unknown property, unknown key name (`Enum.KeyCode.FromName` returns `nil`
    **(probed)**; `"Unknown"` resolves to `None`), a key not allowed for that slot, a number that
    is not finite: that entry is skipped and stays default.
- `InputActions.SanitizeBindings(schema, json): string` runs the same validation against the
  schema alone (no instances; works on the server) and returns a clean JSON string, so a server can
  clean what a client sends before storing it.

## 8. Server Authority

A context is Server Authority only when marked `ServerAuthority: true`. Keybinds stay on the
client; the server only reads action state, which IAS replicates on its own.

- **Server:** `InputActions.ProvideToPlayers(schema, options?)`: for each player, now and on
  `PlayerAdded`, put every Server Authority context into `player.<PlayerFolderName>` (default
  `Inputs`):
  - if `ReplicatedStorage.Inputs.<Context>` exists (the Manager's template), clone it, keeping its
    `Priority`/`Sink`/`Enabled` and actions, and **destroy every `InputBinding` in the clone**;
  - otherwise build the context and its actions (name, `Type`, `Enabled`) from the schema;
  - add actions the schema has and the clone lacks. Throws on a `Type` mismatch, as §4.
  - Returns a function that stops providing.
- **Server:** `InputActions.ForPlayer(schema, player)`: typed handles over that player's copy, only
  for contexts marked `ServerAuthority: true` (the type filters them). Each action has `Instance`,
  `GetState(): V`, `StateChanged`; Bool actions add `Pressed`/`Released`. No bindings and no
  `Fire`. Waits for the player's folder when called before `ProvideToPlayers` has placed it.
- **Client: `Create` never waits for the server.** For each Server Authority context:
  - If `LocalPlayer.<PlayerFolderName>.<Context>` is already there, use it: add the bindings
    **locally** under the server's actions (defaults from the template
    `ReplicatedStorage.Inputs.<Context>.<Action>` bindings when present, else the schema), then saved
    rebinds, as usual.
  - Otherwise build a **local stand-in**: a client-only context (a clone of the template, or built
    from the schema) with its bindings, in a client-only folder. The handles work on it at once:
    input, `GetState`, events, `Fire`, rebinding, requests, `AttachButton`. Its state never reaches
    the server.
  - When the server's copy arrives, **swap**: add the bindings to the server's actions, carrying
    over everything the stand-in has now (rebinds, the context's base state and held requests,
    attached buttons, the last value fired on each Scriptable binding, so a held virtual stick
    stays held), point the handles at the server's instances, then disable and destroy the
    stand-in. A Bool action held at the swap may release once (stand-in disabled) and press again
    on the next input; `Pressed`/`Released` listeners see that. After the swap, `Reset` still
    returns to the same defaults.
  - Context handles of Server Authority contexts add `IsLinkedToServer(): boolean` and
    `LinkedToServer: RBXScriptSignal<() => void>` (fires once, at the swap, or never when the copy
    was there from the start and `IsLinkedToServer()` is already `true`).
  - After `Timeout` seconds (default 10) without the server's copy, `warn` once, naming the
    contexts, the expected path, and the likely causes: `ProvideToPlayers` was not called on the
    server, or it uses a different `PlayerFolderName`. Keep the stand-in, and still swap if the
    copy arrives later.
- **Client:** the template context in `ReplicatedStorage.Inputs` of a Server Authority context is
  disabled locally, so it does not process the same keys beside the stand-in or the player's copy.
- **Probed:** a client-created Scriptable binding under a server-created action drives the action,
  and the state reaches the server (`GetState`, `Pressed`, `StateChanged`, and `BindToSimulation`
  all see it). The server never sees the client's binding. Disabling the context on the client
  releases the state on the server too, while the server's `Enabled` stays `true`.
- `Workspace.AuthorityMode` cannot be read by scripts **(probed)**. Don't try to detect the mode.
  **The user docs must say so plainly:** the package cannot tell whether the place runs Server
  Authority, so it cannot warn when it is off. A context marked `ServerAuthority: true` in a place
  without Server Authority still works on the client (the server's copy replicates either way), but
  the server never receives its state. The `Timeout` warning only means the server's copy never
  arrived; it says nothing about the mode.
- Roblox's own PlayerModule puts its contexts in `player.InputContexts` under Server Authority
  (`CameraContext` P=100, `CharacterContext` P=150, `VehicleContext` P=200 Sink, `TransformerContext`
  P=300 Sink) **(probed)**. The package's folder name must not collide with it.

## 9. Presets

`InputActions.Presets.UiNavigation(options?)` returns a context schema (options: `Priority`,
`Sink`, `Enabled`, `ServerAuthority`). Actions:

| Action | Type | KeyboardAndMouse | Gamepad |
|---|---|---|---|
| `Navigate` | Direction2D | composite arrows | composite DPad |
| `Accept` | Bool | `Return` | `ButtonA` |
| `Cancel` | Bool | `B` (Escape is reserved; Backspace belongs to CoreGui) | `ButtonB` |
| `NextPage` | Bool | `E` | `ButtonR1` |
| `PreviousPage` | Bool | `Q` | `ButtonL1` |
| `Scroll` | Direction1D | `MouseWheel` (slot `Mouse`), composite `Up = PageUp`, `Down = PageDown` | composite `Up = Thumbstick2Up`, `Down = Thumbstick2Down` |

Its type must be as precise as a hand-written schema (`Input.Ui.Actions.Navigate.GetState()` is
`Vector2`). Document that the legacy camera scripts (and `RawInputHandler`'s legacy fork) sink
`Left`/`Right` through CAS, which blocks the arrow-key composite under legacy player scripts.

## 10. Kept modules

- **`MouseController`:** unchanged behaviour (lock stack, strict mode, `MouseLockAction`), minus
  the `ActionsController`/`EDefaultInputAction` dependency: `SetForceUnlockAction(action?: BoolAction)`
  unlocks the mouse while that action is pressed.
- **`InputCatcher`:** unchanged. Move the keycode list it needs into its own file.
- **`RawInputHandler`:** keep the public API (`Initialize`, `GetMoveVector(relativeCamera?,
  normalized?, followFullRotation?)`, `GetRotation()`, `GetZoomDelta()`, `ControlSetEnabled`,
  `MouseInputSetEnabled`). Rework it for the IAS PlayerModule, using `External/PlayerModule/` (the
  default PlayerModule with IAS enabled) as the reference:
  - Find the PlayerModule's contexts: `LocalPlayer.InputContexts` (Server Authority), else
    `StarterPlayer.PlayerModule.InputContexts` (IAS player scripts) **(probed locations)**.
  - Move vector: `CharacterContext.MoveAction:GetState()` (Vector2, X right, Y forward) as
    `Vector3(x, 0, -y)`, then the existing camera-relative logic.
  - Rotation / zoom: port `External/PlayerModule/CameraModule/CameraInput.luau`
    (`CameraRotationAction:GetState() * dt`, touch pitch adjustment, `CameraZoomAction`). Read only;
    don't change Roblox's bindings (its own CameraModule already applies sensitivity and invert).
  - `ControlSetEnabled(v)`: sets `CharacterContext.Enabled` to `v` (the PlayerModule never
    toggles that context itself). `MouseInputSetEnabled(v)`: gates what `GetRotation`/`GetZoomDelta`
    return, without touching Roblox's instances.
  - Legacy fallback: when neither location has contexts (legacy player scripts), keep today's path
    (`PlayerModule:GetControls()` and the forked `CameraInput` module).

## 11. Code style

Follow `.github/prompts/style-guidelines.prompt.md` and `best-practices.prompt.md`: PascalCase
functions and public members, `camelCase` locals, `_camelCase` private class fields, `I`-prefixed
interfaces, `E`-prefixed `const enum`s, `CONSTANT_CASE` constants, types merged into their
namespace or class. roblox-ts limits: `Places/TestingPlace/.claude/rules/roblox-ts.md`.

## 12. Tests (in `Places/TestingPlace`)

- `bun run test:all` (from `Places/TestingPlace`) builds the package into the place
  (`scripts/link-package.mjs`), then runs every section in Studio under three projects:
  `default` (legacy player scripts), `ias` (IAS player scripts) and `authority` (Server Authority).
  `getProject()` from `@flamework-experimental/testing` tells a test which one it runs under.
- Hardware input can't be simulated. Drive actions through Scriptable bindings (`Fire`), and check
  hardware bindings structurally (instance properties).
- The server's sections run before the client's in one play session. For Server Authority,
  the server's sections can leave a `RemoteFunction` behind that the client's tests call to read
  server-side state.
- Cover at least: builders and schema; get-or-create (fresh folder, Manager-shaped folder with
  `<Action><Device>` names, type mismatch throws, extras left alone, `Create` twice); every value
  type through `Fire`; `Pressed`/`Released`; TrackPrevious (including a same-frame tap); context
  base state + requests + focus-loss reset; `AttachButton` (created, removed, destroyed button,
  held-while-removed reset); rebinding (`Set` merge, validation throws, `Reset`, `Clear`, `Get`);
  export/import round trip and every skip reason; `SanitizeBindings`; presets; `MouseController`;
  `RawInputHandler` under `ias` and `authority`; Server Authority end to end; the Server Authority
  stand-in (a client `Create` before the server's copy exists, then the copy arrives: connections
  made before the swap keep firing, rebinds, requests and held Scriptable values carry over,
  `LinkedToServer` fires once; with a short `Timeout` and no copy, one warning and a working
  stand-in).
- Compile-time rules: a test-place file of `@ts-expect-error` cases (from the prototype), so the
  place build fails if a rule stops holding.

## Probed IAS behaviour

Measured in Studio on 2026-09-30 through `flamework-test studio exec`, default and Server Authority
places, `SignalBehavior = Deferred`:

| Probe | Result |
|---|---|
| `GetState()` right after `binding:Fire(true)` | `true` (synchronous); `Pressed` arrives after `task.wait()` |
| `Fire(true)` twice | one `Pressed` |
| `Fire(true)` then `Fire(false)` in one frame | state `false`; one `Pressed`, one `Released`, two `StateChanged` |
| Bool, bindings A and B fired true, then A false | state `false` (last write wins) |
| Direction2D, A = (1,0) then B = (0,1) | (0,1); then B = 0 gives (0,0) although A is (1,0) |
| `Scale = 2` then `Fire(0.5)` | 0.5: not scaled. `ClampMagnitudeToOne`, `Vector2Scale` not applied either |
| `Fire` on an Automatic binding | throws `InputBinding:Fire() can only be called when Type is Scriptable` |
| `Fire(0.5)` on a Bool binding | throws `...should be called with a bool state` |
| Context disabled while held | state `false`, one `Released` |
| `Fire(true)` while context disabled | no error, ignored; state stays `false` after re-enable |
| `Fire` while action disabled | ignored; state `false` after re-enable |
| Fired state after 10 frames | persists |
| Context parented to `nil`; action with no context | both work |
| Held Scriptable binding destroyed | state stays `true`, no `Released` |
| `PreferredBinding` with Scriptable + Space + ButtonA (keyboard) | the Space binding |
| `Enum.KeyCode.FromName` | `"Space"` → Space; `"Unknown"` → `None`; `"Nope"` → `nil`, no error |
| `Workspace.AuthorityMode`, `Workspace.SignalBehavior` from a script | not readable |
| Server Authority: client-made Scriptable binding under a server-made action | drives it; the server's `GetState`, `Pressed`, `StateChanged`, `BindToSimulation` all see the state |
| Server Authority: client disables the context | state released on the server too; server `Enabled` stays `true` |
| PlayerModule contexts | legacy scripts: none; IAS scripts: `StarterPlayer.PlayerModule.InputContexts`; Server Authority: `player.InputContexts` |
