# @rbxts/input-actions on the Input Action System: design spec

The package becomes a typed wrapper over Roblox's Input Action System (IAS): `InputContext`,
`InputAction`, `InputBinding`. This is a breaking rewrite. Everything here was decided with the
package author; the facts marked **(probed)** were measured in Studio on 2026-09-30 (see
[Probed IAS behaviour](#probed-ias-behaviour)). The IAS reference is
[docs/Reference/RobloxInputActionSystem.md](../Reference/RobloxInputActionSystem.md).

**0.7.0: device bindings** (a breaking change, agreed with the author on 2026-10-03). An action's
key bindings are named after the devices of `Enum.PreferredInput` (`KeyboardAndMouse`, `Gamepad`,
`Touch`), each holds only its device's keys, and every action has the three (§3, §4); any other
binding is `InputActions.Scriptable`. A binding's `Capture`/`CaptureChord` take its device's keys
only, the `Touch` binding has none, Bool and Direction1D actions get a one-field `Capture` and
`CaptureChord` whose first key picks the device, captures hear the gamepad's sticks and triggers,
and `InputActions.PreferredDevice()` names the device in use (§6). Saves keep their format (§7).
Multiple controllers are out of scope (rare on Roblox). **Extra bindings per device** (agreed on
2026-10-04): a device takes a binding or a namespace, `{ Main: <binding>, <Extra>: <binding> }`,
so WASD plus the arrows, the stick plus the D-pad, or an Alternate column fit in a schema again;
the device's handle is the main binding's, with the declared extras on it, each a binding handle of
that device (§3, §4, §6), saved at `Context/Action/Device/Extra` (§7). **Usability features**
(agreed on 2026-10-03), for what a game (or an LLM writing its code) needs every day without
hand-rolling it: `InputActions.PreferredDeviceChanged`, `Describe()` (a keybind as text),
`FindConflicts` for rebinding menus, gestures on Bool actions (`OnTap`, `OnDoubleTap`, `OnHold`,
`OnLongPress`) (§6), and compile errors that say why in words (§3).

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
| `InputCatcher` | **Kept, unchanged in behaviour** (CAS sink; since 2026-02 a CAS sink also blocks IAS; GUI gets clicks first, so buttons and their `UIButton` bindings still work **(probed)**) |
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
Crouch.Bindings.Gamepad.Set(Enum.KeyCode.ButtonB); // every action has the three device bindings
Jump.Capture((key, device) => {}); // the first key pressed picks the device's binding
Jump.Bindings[InputActions.PreferredDevice()].Get();
InputActions.PreferredDeviceChanged.Connect((device) => {}); // re-render a menu or a hint
Jump.Bindings.KeyboardAndMouse.Describe(); // "Space"; Jump.Describe() for the device in use
Input.FindConflicts(Jump.Bindings.KeyboardAndMouse); // the other bindings that share a key
Jump.OnHold(() => {}, { Duration: 1, Progress: (fraction) => {} }); // also OnTap, OnDoubleTap, OnLongPress
const release = Input.Ui.Request(true);
const saved = Input.ExportBindings();

// either realm: best-effort, true / false / undefined (unknown)
InputActions.IsServerAuthority();

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
- **Binding names are devices (0.7.0).** A binding with keys is named after its device:
  `KeyboardAndMouse`, `Gamepad` or `Touch` (`Enum.PreferredInput`'s names, without `MicroGamepad`:
  the TV remote's keys are the Gamepad's; also the Input Action Manager's `<Action><Device>`
  names, so adoption keeps working). Any other name takes only `InputActions.Scriptable`
  (code-driven sources). A key binding under another name, or a Scriptable under a device's name,
  is a compile error, and `Schema` (and `Create`, for a schema made without it) throws naming it.
  So an action has one main binding per device; a second binding of the device (WASD and the
  arrows) is an extra, in the device's namespace ([Extra bindings per device](#extra-bindings-per-device-070)).
- Binding handles: a binding declared `InputActions.Scriptable` gets `Fire(value)`; a device's
  binding gets `Get`/`Set`/`Reset`/`Clear`, and no `Fire`. The `KeyboardAndMouse` and `Gamepad`
  ones add `Capture` (and `CaptureChord` on Bool and Direction1D actions); the `Touch` one has no
  captures (touch has no keys to press). `Bindings` always has the three device handles (§4).
- Unknown binding or action names are compile errors.
- **Performance trap:** validating bindings with a mapped type that compares against the whole
  `Enum.KeyCode` union ran tsc out of memory. `CheckBindings` maps over the bindings `B` only:
  for a device's name it checks a bare key with one conditional (`V extends BindingShape<T, D>`,
  the device's shape, with its key unions computed once in `KeyGroups.ts`) and an object against
  the device's object shapes plus the excess-property check (`Exclude<keyof V, AllKeys<TShape>>`),
  then, only when that fails, property by property over the object's own keys (the readable
  errors below); any other name must be `IScriptable`. A `string` key (computed names, which
  `Schema` checks at runtime) checks nothing more. Keep it that way: never a mapped type over the
  KeyCode union.
- The device check (`CheckDeviceBinding<V, T, D>`) distributes over a union, so each member is
  checked as it is: a value typed `BindingShape<T, D>`, or a conditional between a bare key and an
  object, compiles, as in 0.6 (hunt HD2-1: before, any union with an object member went to the
  object check, which a bare key fails). A key that fits gives back itself, not `unknown`, which
  would swallow the other members' checks.
- A Scriptable under a device's name is checked against `NotScriptable<D>`, since 0.7.0's readable
  errors a sentence (a string type, which the marker never is). The builders' parameter is
  `B & CheckBindings<B, T>`, and its intersection with `B`'s `IScriptable` made the all-optional
  composite shapes (Direction1D, 2D, 3D) ones the marker satisfies: it compiled there (hunt HD-3),
  which is why it is checked against something no binding shape is.
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
  have `PrimaryModifier`/`SecondaryModifier` (Button keys only, of the binding's own device).
- One input source per binding (IAS ignores composites and `UIButton` when `KeyCode` is set):
  `KeyCode` together with a composite direction is a compile error.
- A binding in the schema is either a bare key (shorthand for `{ KeyCode }`), an object shape, or
  `InputActions.Scriptable`. `UIButton` never appears in the schema (it is attached at runtime,
  §6).
- At runtime an **unbound** binding (no `KeyCode`, no composite) is legal: the Input Action Manager
  creates them, `Clear()` produces them, and every device the schema leaves out starts as one (§4).
  The type rules forbid writing `None` in the schema only.

### Keys per device (0.7.0)

Every key belongs to one device, by the key alone (`GetKeyDevice`; not by the `UserInputType`
that carried it, since VirtualInput sends gamepad KeyCodes as keyboard input, nor by
`PreferredInput`, which the same press switches). Two more runtime arrays (`as const`) list them;
the types derive from them with `Exclude`/`Extract`, once (`IKeyboardAndMouseKeys`, `IGamepadKeys`,
`ITouchKeys`: the keys a device's binding takes for each kind of slot), and the binding shapes take
one of those as a parameter (`IBoolBinding<K>`...; `BindingShape<T, D>`).

| Device | Keys |
|---|---|
| `Gamepad` | `ButtonA/B/X/Y`, `ButtonL1/R1/L2/R2/L3/R3`, `ButtonSelect`, `ButtonStart` (reserved: never allowed), `DPadLeft/Right/Up/Down`, `Thumbstick1`, `Thumbstick2` and their `Up/Down/Left/Right`, and the TV remote's `ButtonCenter`, `ButtonBack`, `ButtonUp`, `ButtonDown`, `ButtonLeft`, `ButtonRight` |
| `Touch` | `TouchPosition`, `TouchDelta`, `TouchPinch` |
| `KeyboardAndMouse` | every other key: keyboard keys, mouse buttons, `MouseWheel`, `MouseDelta`, `MousePosition`, `TrackpadPan`, `TrackpadPinch` |

- The per-type rules above hold within the device: a `Gamepad` Bool binding takes buttons and
  axes (triggers, stick directions), its Direction2D `KeyCode` a stick; `KeyboardAndMouse`'s
  Direction2D `KeyCode` takes `MouseDelta`/`TrackpadPan`; the `Touch` binding takes
  `TouchPosition` (Bool, ViewportPosition), `TouchPinch` (Direction1D) or `TouchDelta`
  (Direction2D), and has no Button keys, so no modifiers and no composite directions (its
  Direction3D binding stays unbound). A gamepad has no position: its ViewportPosition binding stays
  unbound too.
- `Enum.KeyCode.Touch` is `TouchPosition`'s deprecated name: the same item (the typings declare it
  `TouchPosition`, value 1034), so it is a Touch key like `TouchPosition`. The `devices` section
  checks `Enum.KeyCode.Touch === Enum.KeyCode.TouchPosition` at runtime.
- Checked in the types (schema, `Set`) and at runtime: `Set`, imports, `SanitizeBindings`,
  captures, and adopted bindings (a key of another device warns, naming the path and the device,
  and is left as it is, like the other rule breaks). The messages say which device the key is
  (`ButtonA is a Gamepad key: a KeyboardAndMouse binding takes keyboard and mouse keys`).

### Extra bindings per device (0.7.0)

```ts
Move: InputActions.Direction2D({
	KeyboardAndMouse: { Main: WASD, Arrows: ARROWS },          // a namespace
	Gamepad: { Main: K.Thumbstick1, DPad: { Up: K.DPadUp, Down: K.DPadDown } },
}),
Jump: InputActions.Bool({ KeyboardAndMouse: { Main: K.Space, Alt: {} }, Gamepad: K.ButtonA }),
move.Bindings.KeyboardAndMouse.Arrows.Capture("Up", cb);  // an extra: typed where declared
jump.Bindings.KeyboardAndMouse.Capture("KeyCode", cb);     // Main, as with the direct form
```

- A device takes a binding (as above) or a **namespace**: an object with a `Main` key, the
  device's main binding, beside **extras** named as you like. No binding has a `Main` property:
  every object shape carries `Main?: never` (as `EnumType?: never`), so the types tell the two
  apart, and at runtime `IsNamespace` does (a table with `Main`).
- Every binding of a namespace, `Main` included, takes the device's binding shapes (its keys, the
  action type's rules), or `{}`: a binding with no keys, which a player fills (an Alternate column
  starts so). `{}` is allowed in a namespace only; the direct form is as before (`{}` compiles only
  where a shape is all-optional). **Decided:** `Main` may be `{}` too, one rule for every binding of
  a namespace (a game that binds only the extras, or leaves the main one to the player). A `{}`
  the schema declares is the schema's binding: unlike a device the schema leaves out, it is no
  placeholder (§4), so another schema's keys don't fill it; a `Main: {}` that meets another root
  handle's placeholder fills it with no keys, and it stops being one.
- No binding of a namespace is `InputActions.Scriptable` (a Scriptable binding keeps a name of its
  own beside the devices): a compile error, and `Schema` throws.
- **Reserved extra names** (`RESERVED_EXTRA_NAMES` in `BindingRules.ts`, the type
  `ReservedExtraName` derived from it): `Main`; every member of a binding handle, internal ones
  included (`BINDING_HANDLE_MEMBERS`), since the extras hang off the main binding's handle by
  name; every binding property (`KeyCode`, `Up`... `EnumType`), which would make the namespace
  read as a binding; and a name with "/" or none at all. A compile error (`CheckNamespace` maps
  over the namespace's keys only, so no cost beyond the few names), and `Schema` and `Create`
  throw naming the path `Context/Action/Device/Extra` (`SchemaProblem`, which `CheckBuild` runs).
  The `device-extras` section checks the list against a live handle's members.
- Types: `CheckBindings` checks a device's value with `CheckDeviceValue`, a namespace with
  `CheckNamespace` (each binding as `CheckDeviceBinding`, `{}` as it is), anything else as before;
  `BindingSpec<T>` takes `IBindingNamespace<T>` so inference keeps the literal namespace.
- Handles: the device's handle is the main binding's; each declared extra is a property of it,
  typed `BindingHandleOf<T, D>` (its device's keys and captures; a `Touch` extra has none).
  `ActionHandle<D>` adds them beside `IActionHandle<T, B>` (`WithExtras`), not inside it: read
  through conditional types in `BindingHandles<T, B>`, `B` made `IBoolActionHandle<B>` no longer
  assignable to `InputActions.BoolAction` (`IBoolActionHandle<unknown>`).
- `Extras()`, on every device binding handle, lists the declared extras by name, as a table
  (`IExtraBindings<H>`, `{ readonly [name: string]: H | undefined }`), empty on an extra. Not a
  `ReadonlyMap`: roblox-ts types its methods with a `this` parameter, so `get` can't be called on
  the union of maps a handle picked by a device at runtime gives (`Bindings[device].Extras()`);
  and typing the maps alike for every device made tsc compare handles across devices (TS2590).
  A table read by name works on that union.

### Readable compile errors (0.7.0)

Where the types refuse something, the error says why in words, as the runtime's messages do
(agreed on 2026-10-03): `InputActions.Bool({ Gamepad: Enum.KeyCode.Space })` reads `Type 'Space'
is not assignable to type 'Space & "Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad
keys"'`. Before, it read `Type 'Space' is not assignable to type 'never'` (the key intersected
with the device's union of keys reduces to `never`), and a key the action type can't take failed
the constraint, whose error listed every key the type takes ("... 252 more ...").

- **A sentence as the type.** What a refused value is checked against is a string literal type
  (`${X["Name"]} is a ${KeyDeviceOf<X>} key: a ${D} binding takes ${IDeviceKeysText[D]}`):
  `@rbxts/types` gives every enum item a literal `Name`, and `IDeviceKeysText` (`KeyGroups.ts`)
  types the runtime's `DEVICE_KEYS_TEXT`, so the two can't drift. A string type is no binding, and
  intersected with an enum item or an object it is not reduced to `never`, so the error ends on
  the sentence. A number, a boolean or a string intersected with a string literal is `never`, and
  takes the whole binding with it (an object with a `never` unit-typed property reduces to
  `never`): those are checked against `{ readonly "<sentence>": never }` (`Sentence<M, X>`).
- **What says what** (the runtime's words, without the quotes TypeScript would print escaped):

  | Refused | Sentence |
  |---|---|
  | another device's key the slot takes (a bare key, a key in an object, a modifier, a direction) | `Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys` (`KeyProblem`, as `KeyRuleProblem`) |
  | a key the slot never takes | `MouseDelta is not allowed in KeyCode on a Bool action` |
  | an enum item that is no KeyCode | `a binding must be an Enum.KeyCode, an object or InputActions.Scriptable` |
  | keys under a name that isn't a device | `Keys is not a device: bindings with keys are named KeyboardAndMouse, Gamepad, Touch; any other binding must be InputActions.Scriptable` (`NotADevice`) |
  | Scriptable under a device, or in a namespace | `Gamepad is a device: its bindings hold keys, not InputActions.Scriptable; name a Scriptable binding beside the devices` (`NotScriptable`) |
  | a reserved extra name | `Get is a member of a binding handle, ...` / `KeyCode is a binding property, not an extra binding: ...` (`ExtraNameProblem`) |
  | an extra name with "/", or empty | `a/b: an extra binding's name can't contain /` |
  | a property the action type's bindings lack | `Typo is not a property of a Bool binding`; with a key or an object in it, `...; several bindings of one device go in { Main: <binding>, Alt: <binding> }` (as `Schema` says it) |
  | `KeyCode` beside a direction | `KeyCode and composite directions can't share a binding` |
  | `ResponseCurve` without a thumbstick `KeyCode` | `ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode` (`..., which a KeyboardAndMouse binding can't hold` on a device without sticks) |
  | a misspelt context option (`CheckContexts`) | `unknown option ServerAuthorty; a context has ServerAuthority, Priority, Sink, Enabled and Actions` |

- **Inference.** `BindingSpec<T>` (and a namespace's `NamespaceBindingSpec<T>`) also take any enum
  item and any object (`IAnyObject`), so what the checks refuse is inferred as written and refused
  in words; the action type's shapes stay in the union for the editor's completions. A value that
  is no enum item, object or Scriptable (a number) still fails the constraint, with TypeScript's
  own message (`Type 'number' is not assignable to type 'BindingSpec<Bool>'`).
- **Objects:** checked against the device's forms first, as before; one that fits, with no property
  they lack, gives back itself. One that doesn't is checked property by property
  (`ObjectProblems`, a mapped type over the object's own keys), each refused property against its
  sentence (`ObjectSentences`); with none refused, against the forms, whose error is readable then
  (`Property 'KeyCode' is missing`). The forms first: the sentences cost more, and most bindings fit.
- **Cost.** A message built from `X` in the true branch of `X extends <a slot's keys>` took tsc
  0.8 s per refused key: there `X` stands for `X & <the slot's keys>` (a substitution type), and
  the template literal expanded it. `FitsSlot<X, T, P>`, an alias of its own, keeps `X` out of that
  branch. The type rules took 2.76 s before (71k instantiations) and take about 2.35 s after, the
  features' rules included (98k): the old errors' elaborations over the 252-member unions cost more
  than the sentences.
- **Not readable: `Set`.** A binding handle's `Set` takes `BindingShape<T, D> | BindingPart<T, D>`,
  not a type parameter: a generic `Set<V>(binding: V & Check<V>)` would make handles of different
  devices no longer compare (`BindingHandle<A, Device>` takes any of the three; two conditional
  types over different devices aren't related), so its error lists the keys it takes. It checks
  again at runtime, with the sentence.

## 4. Schema, `Create`, and get-or-create

- `InputActions.Schema(contexts)` returns a frozen plain object `{ Contexts }`. The builders and
  `Schema` create no instances and may run on either realm.
- Context schema: `{ ServerAuthority?: boolean; Priority?: number; Sink?: boolean; Enabled?: boolean; Actions }`.
  Defaults are the IAS ones (Priority 1000, Sink false, Enabled true). Any other key is a compile
  error (`Schema`'s parameter is generic, so the type checks excess keys itself, as `CheckBindings`
  does), and `Schema` throws on it at runtime, naming it, as on an option of the wrong type: a
  misspelt `ServerAuthority` would otherwise make the context local without a word. The preset's
  options are checked the same way. `Priority` must be a whole number an `InputContext` holds
  (int32, -2147483648 to 2147483647): IAS reads `math.huge`, `NaN`, `1e12` or `2 ** 31` as
  -2147483648, the lowest priority there is, and 2.5 as 2, without a word **(probed, hunt HD4-5)**,
  so `Schema` refuses any other number rather than rounding it. An action's options are checked
  too, for a definition made without the builders or through a cast: `DisplayName` a string,
  `Enabled` and `TrackPrevious` booleans, each may be left out (hunt HD4-4: `DisplayName = {}`
  threw in the middle of `Create`, `Enabled = "no"` read as true).
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
  - A device's extra (0.7.0) is slot `<Device><Extra>`: found as `KeyboardAndMouseArrows` or
    `MoveKeyboardAndMouseArrows`, made as the latter, cloned from a template's binding of that
    name, and checked against its device's keys when adopted (a warning names the path
    `Context/Action/Device/Extra`). The main binding keeps its name (`MoveKeyboardAndMouse`), so a
    tree made for the direct form is adopted as before. `ActionSlots` (`Tree.ts`) lists an
    action's bindings: each device's main binding, right before its extras, the Scriptable slots,
    then the devices the schema leaves out.
  - A slot can't take a name whose binding (`S` or `A .. S`) would be one the package names itself
    (§6): `Script`, `UIButton<n>`, `<Action>Script`, `<Action>UIButton<n>`. Nor can one action have
    slots `S` and `A .. S`: both would match the binding `A .. S`. `Schema` (and `Create`) refuse
    them. Since every action has the three device bindings (below), a Scriptable slot named
    `<Action><Device>` (`JumpTouch` on Jump) collides with a device's even when the schema leaves
    that device out; the message then says the name is taken by the action's `Touch` binding.
    The extras' slots count too (`SlotCollision` takes `ActionSlots`): a Scriptable slot named
    `KeyboardAndMouseArrows` or `MoveKeyboardAndMouseArrows` beside the `KeyboardAndMouse` extra
    `Arrows` is refused, the message naming the extra by its device and name, and so is an extra
    whose slot would be a name the package gives its own bindings (`Script` on the `Gamepad` of an
    action named `Gamepad`).
- **Every action has the three device bindings (0.7.0).** A device the schema leaves out gets its
  binding all the same: the one found by name (`S` or `A .. S`, so the Manager's `JumpTouch` is
  adopted as the Touch binding, typed, rather than warned about as an extra), else one made with no
  keys (`<Action><Device>`, Automatic). IAS never prefers a binding without keys **(probed, P3,
  2026-10-03)**: an empty `Gamepad` or `Touch` binding beside a Space binding changes nothing for
  `PreferredBinding` or an `InputActionLabel` (keyboard, virtual pad, simulated phone), and an empty
  `Touch` binding doesn't beat a `UIButton` binding under the simulated phone. So a player can give
  a gamepad key to an action the game bound on the keyboard only, and a menu can index
  `Bindings[device]`. Its defaults are unbound: `Get()` returns `{}`, `Reset()` unbinds it.
  - `Create` twice on one folder with different schemas: when a later schema names a device whose
    binding an earlier root handle made unbound (its schema left the device out: a *placeholder*,
    `ISharedEntry.Placeholder`), the later schema fills it: the shared defaults become that
    schema's binding (every handle on it shares the defaults table, so the earlier handle's
    `Reset` and export follow). **The keys decide** what happens to the binding: one whose key
    slots are as they were made gets the later schema's values written, with what the player
    changed from the old defaults on top (a tuning or a name given with `Set` or a save's entry
    without a key, applied as `CarryChanges` carries a stand-in's rebinds), so a save loaded before
    the later `Create` ends as one loaded after it; one whose keys the player set (a rebind, a
    capture) stays as the player left it. Before hunt HD4-1 any difference counted as a rebind: a
    tuning or a name loaded first kept the binding unbound, and the export then saved
    `KeyCode: None`, unbinding the key in later sessions. A save that unbinds the binding outright
    (`KeyCode: None`, made in a session where it was bound) leaves the keys as they were made, so
    loaded before the later `Create` the fill still binds it; loaded after, it unbinds it. The
    defaults are a reading either way: of the binding once written,
    or, when the player rebound it, of a scratch binding the values are written onto, so a float a
    binding can't hold exactly (`PressedThreshold` 0.3) doesn't make `Reset` then the export save
    it (hunt HD-1). The earlier handle's `BindingsChanged` doesn't fire for it. The same
    holds at a Server Authority swap onto bindings another root handle made on the copy. In the
    other order the first schema's binding is simply adopted, as before. Without this, a second
    schema that names `Gamepad: ButtonA` would find the first one's empty binding and keep it
    ("what exists wins"). A fill changes the binding's keys, so IAS resets the action: it runs
    inside `AddingBindings` (§6), and an action held then is let go of as when a binding is added.
  - **Extras and the fill (decided):** a later schema's namespace fills a placeholder with its
    `Main` (a `Main: {}` fills it with no keys, and it stops being one); its extras are made as any
    binding the action lacks, by that `Create`. An extra is never a placeholder: it exists only
    where a schema declares it, so there is nothing to fill.
- **Extras and several root handles (decided):** each root handle gets or makes the extras its own
  schema declares, and has handles for those only. Two schemas that declare the same extra share
  its binding, with the first one's defaults ("what exists wins", as for any binding); an extra
  only one of them declares is that root handle's: the other's types and handles don't have it
  (its `Extras()` doesn't list it), its exports, imports and resets leave it alone (an import
  skips its path: "has no extra binding"), it warns about it in Studio no more than about another
  root handle's instances, and it goes with the last root handle that uses it. Simple and
  consistent with the device bindings: the alternative, giving every root handle on the action
  every extra any schema declared, would hand an earlier root handle bindings its type can't name.
- **Precedence: what exists wins.** An existing context keeps its `Priority`, `Sink`, `Enabled`;
  an existing action keeps `Enabled`/`DisplayName`; an existing binding keeps its keys, modifiers
  and tuning. The schema fills only what is missing.
- **Defaults are the tree right after `Create`.** `Reset()` returns a binding to that snapshot
  (designer values when they came from the folder, schema values otherwise).
- An existing action whose `Type` differs from the builder's type: **throw**, naming the path.
  `Create` makes every check that can throw before it changes anything (`CheckBuild`: these types,
  on the instances it would take up; everything `Schema` refuses, with `Schema`'s own checks
  (`SchemaProblem`, which both run) and its messages, for a schema made without `Schema`: a "/" in
  a name, which would split the save's paths and lose its rebinds in `SanitizeBindings` (hunt
  HD2-5), a misspelt option, which would make a `ServerAuthorty: true` context local without a
  word (hunt HD3-2), a binding that breaks the rules; an instance of a context's name that is no
  `InputContext`), so a `Create` that throws leaves the tree as it found it: it fills no other
  root handle's unbound binding, releases no held action (hunt HD-2), and makes no default folder
  (it is made once the checks pass).
- `Create`, `ForPlayer`, `ProvideToPlayers` and `SanitizeBindings` take the schema the same way,
  through two overloads. The first takes `ISchema<S>`, what `Schema` returns: `IInputSchema<S>`
  branded, checked by `Schema` already, so nothing is checked again. The second takes
  `ICheckedInputSchema<S>`: `IInputSchema<S>` whose `Contexts` is `S & CheckContexts<S>`, so a
  misspelt option in `{ Contexts }` written without `Schema` is a compile error too (hunt HD3-2).
  The exported `InputActions.InputSchema<S>` is that type: checking `S` against
  `CheckContexts<S>` fails for a generic `S` (a mapped type to `never` can't be proved of a type
  parameter), so a helper generic over the schema must take the checked type to pass it on, and
  then does. `ICheckedInputSchema` is an interface, not an intersection, so `S` is inferred as it
  is from one instantiation to another: from `IInputSchema<S> & { Contexts: CheckContexts<S> }` it
  was inferred as `S & CheckContexts<S>`, which `ServerHandle<S>` (a mapped type with an `as`
  clause) doesn't take, so a helper over `InputSchema<S>` couldn't return `ForPlayer`'s handles
  (hunt HD4-2). The first overload is there for a `Schema` call written inside the call: with the
  checked type as its context, a preset with no options in it (`UiNavigation()`) inferred its
  options from that check instead of from its argument, an unreadable error (hunt HD4-3; `NoInfer`
  didn't help). `Schema`'s result, written inside the call or kept in a variable, a preset, a
  schema kept in a variable and a widened `InputSchema<Record<string, ContextSchema>>` all
  compile; a misspelt option is refused inline, in a variable and through a helper. A call that
  matches neither overload reports both.
- An adopted binding whose keys break the §3 rules (another device's key included): `warn` with
  the path, and leave it as it is.
- Instances in the folder that the schema doesn't mention: left alone (IAS still runs them), not
  typed, one `warn` per instance in Studio (`RunService.IsStudio()`) naming them. Includes
  bindings whose names match no slot (e.g. the Manager's default `InputBinding` name), because they
  then run beside the package's own binding. A binding named after a device always matches a slot.
- `Create` twice on the same folder must work (adopts the same instances; creates nothing twice).
  The root handles share what they use, through a registry keyed by instance:
  - an instance the package made is destroyed when the last root handle using it is destroyed;
  - a context has one enabled state (base state and requests, §5), whichever handle changes it;
    each handle's requests end with it;
  - every handle on a binding has the same defaults (the first handle's snapshot);
  - a `Create` that gives an action a binding it lacks (a device's binding the folder didn't have,
    a Scriptable slot, a template's binding) or fills a placeholder releases the action if it is
    held, as any binding added does (§6, hunts HL4-4, HL4-5);
  - destroying one handle doesn't release input that another live handle's actions hold, but for
    the one case below. It lets go of what it holds itself, on a shared action too: a value its
    `Fire`/`Tap`/Scriptable slots left goes back to rest (the package records which root handles
    fired each held value, and the order of its Fires), unless the package fired a value after it
    (the action shows the last write, whatever the values). A value another live handle fired on
    the same binding too is theirs as well (IAS ignored the repeat) and stays. When bindings that
    go with it (those it made that no other handle uses: its attached buttons, its own slots, a
    template's bindings it cloned) go while the action is not at rest and nothing another handle
    fired holds it, the action is released: a destroyed held binding would leave it stuck on
    (buttons since validator round 3, the other bindings since hunt HL3-2). A value the other
    handles fired holds it only while the action shows the latest one they fired: a key or a button
    that wrote after it holds the action instead, and was left at its value (hunt HL4-1). IAS
    doesn't tell which binding holds an action, so that also lets go of a key held through a
    binding the other handles keep, until it is pressed again. On a copy under the player in a
    place that runs Server Authority the release is a same-frame pair on `<Action>Script`, before
    the bindings go. Anywhere else it is the `Enabled` toggle below, once they are gone: a pair
    there needed `<Action>Script` made in that frame when no handle had fired the action, and
    adding a binding to a held action releases it (§6), so the pair pressed and released it once
    more, a press the other handles heard (hunt HL4-3);
  - a Server Authority template stays disabled (§8) until the last handle using it is destroyed.
- `Input.Destroy()` disconnects everything, destroys what the package created, and leaves adopted
  instances in place. Adopted bindings get their defaults back (rebinds are undone, so a later
  `Create` starts from the same defaults); adopted contexts keep their base state. After `Destroy`
  the handles change nothing: `Fire`, `Tap`, `AttachButton`, `SetEnabled`, requests,
  `Set`/`Reset`/`Clear`/`Capture` and imports are ignored. Under Deferred signals, a delivery
  already queued when a handle's `BindableEvent` is destroyed still runs its listeners, whereas a
  disconnected connection's queued call is skipped (measured, label hunts 1 and 2: HL2-4). The
  package can't cancel deliveries to connections it doesn't hold without replacing its
  `RBXScriptSignal`s with custom objects (a breaking change), so it documents that an event fired
  before `Destroy` and not delivered yet still arrives; `WhenLinkedToServer` checks for `Destroy`
  inside its own connection.
- A binding `Destroy` removes while it holds its action (a key, a button, a template's binding the
  package gave an extra action) leaves the action stuck on **(probed)**, whatever its type. So once
  the bindings are gone, every action that stays (adopted, or the server's copy) and that no other
  live root handle uses is reset when its state is not at rest: `Enabled` toggled off and back on
  (one another root handle uses is released as above, by this toggle too off the server's copy).
  Under Server Authority the release pairs of §8 have let go of the server's copy already; the
  reset covers a local context, and the copy in a place without Server Authority, where no pair is
  fired.
- The root handle is a table of its own: the contexts by name beside the six public members
  (`FindConflicts` since 0.7.0), so a context name can shadow nothing internal. `Schema` (and
  `Create`) refuse those six names.

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
- Disabling a context releases its held actions (IAS fires `Released`) **(probed)**. Under Server
  Authority that release reaches only the client; the package releases through a Scriptable
  binding first (§8, "Releasing on the server").
- `ResetOnFocusLoss`: on `UserInputService.TextBoxFocused`, `UserInputService.WindowFocusReleased`
  and `GuiService.MenuOpened`, hold an internal `Request(false)` on every context for one frame, so
  keys whose release is swallowed can't stay stuck. It must not change the base state or
  `EnabledChanged` listeners' view beyond one false/true pair.
- Actions: `action.SetEnabled(boolean)` / `IsEnabled()` pass through to `InputAction.Enabled`
  (IAS resets the state when disabled; under Server Authority the package releases first, as for
  contexts).

## 6. Actions and bindings at runtime

Action handle (all types):

- **Handle signals are the package's own, not the IAS ones.** `StateChanged`, `Pressed`,
  `Released`, `EnabledChanged` and `BindingsChanged` are backed by `BindableEvent`s (so still typed
  `RBXScriptSignal`) and forward from whichever instance the handle currently wraps. A Server
  Authority context swaps from a local stand-in to the server's copy (§8); connections made before
  the swap must keep working after it. `Instance` always returns the current instance.
- `Instance: InputAction`, `Name`, `Type`.
- `GetState(): V`, `StateChanged: RBXScriptSignal<(value: V) => void>`. `StateChanged` never
  repeats the value it passed on last: once it passed one on, and from the Server Authority swap
  on, an IAS event repeating what the listeners have is dropped (on the Join path of the swap a
  joining handle heard the copy's own events before the swap told it the copy's state: hunt
  HL3-3). Until then anything is passed on, as for `Pressed`/`Released` below.
- `Fire(value: V)`: fires a Scriptable binding named `<Action>Script` that the package creates on
  first use. Values go straight into the action state: IAS applies no `Scale`, clamp or
  `Vector2Scale` to fired values **(probed)**.
- `SetEnabled`, `IsEnabled`.
- `Bindings`: typed record of binding handles: the three devices' always (`KeyboardAndMouse`,
  `Gamepad`, `Touch`), and the schema's Scriptable slots. A device's handle is its main binding's,
  with the extras its namespace declares as properties (§3): code written for the direct form
  works on the namespace form unchanged, and a menu's generic code needs no branch.
- `GetPreferredBinding(): InputBinding | undefined` (IAS `PreferredBinding`).
- `Describe(device?: Device): string` (0.7.0): the device's main binding as text (below), by default
  `PreferredDevice()`'s; every action type has it. A name that isn't a device throws.
- `AttachLabel(label: InputActionLabel): () => void` (0.6.1, every action type): sets
  `label.InputAction` to the action the handle wraps, and again at the Server Authority swap while
  the label still shows the instance the handle leaves, so it follows the stand-in onto the
  server's copy but not when pointed elsewhere meanwhile (hunt HL-2). A label is attached to one
  action at a time (`LABEL_OWNERS`): the last `AttachLabel`, from any handle, takes it over, and the
  earlier attachment lets go without touching it (hunt HL-1). The returned function, the label's
  `Destroying` and `Destroy` let go of it, clearing `InputAction` only while it still shows the
  action the package last pointed it at (or the handle's). Attaching a label twice keeps one
  attachment; each function lets go of the attachment it was returned with, so it does nothing
  once the label was taken over, even after it comes back to the same handle. The label is
  attached before `InputAction` is written: under Immediate signals the label's listeners run
  inside the write, and one that takes it over or destroys the root handle must find it attached
  (hunt HL2-1). A destroyed label (`Parent` locked, as for `AttachButton`) is left alone; anything
  but an InputActionLabel throws.
  `InputActionLabel` is a Studio beta (2026-08-06); measured in Studio 2026-10-03: it shows the
  preferred binding (`ResolvedText`/`ResolvedImageContent`) and follows a rebind; on the simulated
  phone an action with no touch binding shows nothing. With extras a device has several bindings,
  and the label still shows one (IAS's `PreferredBinding`); which one IAS picks among several
  bindings of the device in use is unverified.

Bool actions add `Pressed`, `Released` (IAS signals, passed on so that the two always alternate:
an IAS signal repeating the last one passed on is dropped, as a Server Authority copy once sent
`Released` twice in a row after the stand-in swap, 2026-10-02; until the first one or the swap,
anything is passed on, so a handle made while its action is held still hears that press's
`Pressed` if it is on its way; at the swap the last one told, or the state when the handle was
made, counts as the last one), `IsPressed()`, `Tap()` (fires `true`, then
`false` on the next frame; on a Server Authority copy, once the press shows in the state, at most
0.5 s later: that copy's state moves on simulation steps, and a release in the same step as the
press would reach the server as no press at all), and:

- `AttachButton(button: GuiButton): () => void`. Creates a new Automatic binding
  `<Action>UIButton<n>` (the lowest free `n`) with `UIButton = button`; the returned function
  removes it. Several buttons may be attached at once. Also removed when the button is destroyed;
  a button destroyed before the call gets no binding (a destroyed instance's `Parent` is locked
  **(probed)**, the only sign of it a script can read).
  - **Destroying a held binding leaves the action stuck on (probed).** When the binding is removed
    while the action's state is `true`, reset the action (toggle `InputAction.Enabled` off and back
    on) so it releases.
  - **Adding the binding releases a held action (probed, hunt HL4-5):** IAS resets an action's
    bindings when one is added, as for a key change (below), and a key still down holds it again
    only once pressed again. The package can't keep the press (a value fired in its place would
    hold the action after the key comes up), so the docs say so. On the server's copy the action
    is pressed again and stays held instead, and the package releases it (§8, hunt HL4-4).
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

Bool and Direction1D actions (the types whose `KeyCode` takes keys that can be pressed) add a
one-field capture for a rebinding menu, **0.7.0** (`IActionCapture`; the other types don't have it,
and it throws on them at runtime):

- `Capture(callback: (key, device) => void, options?): () => void`: waits for the next key that a
  `KeyboardAndMouse` or `Gamepad` binding of the action can hold in its `KeyCode`. The key's device
  picks the binding, which becomes that key alone: its composite directions give way, as with
  `Set`, and so do its modifiers, as with `CaptureChord` given one key (`ApplyChord`; hunt HD2-4:
  Ctrl+S captured with F is F, as the field's prompt and callback say, not Ctrl+F). A binding's
  `Capture("KeyCode", ...)` fills one slot and keeps the modifiers. Then
  `callback(key, device)`; `device` is `"KeyboardAndMouse" | "Gamepad"`. Touch input is ignored,
  and so is a key no binding of its device can take (a click on a Direction1D action). Same
  options and rules as the binding's `Capture` (below): `Cancel` keys from any device, typing and
  game-processed input, keys down at the start, sticks and triggers.
- `CaptureChord(callback: (chord | undefined, device | undefined) => void, options?)`: as the
  binding's `CaptureChord`, on whichever device's binding the first key that goes down belongs to;
  the other device's keys are ignored while any key of the chord is held, so no Shift + ButtonA.
  Once every key of a refused chord is up, the next first key picks again (a player who started on
  the keyboard can switch to the pad without cancelling). `callback(undefined, undefined)` when it
  ends with nothing applied.
- Both reuse the binding captures' code (`Capture.ts`: `CaptureKey`, `CaptureChord`, the
  `CaptureInput` stream), with a target picked per key.
- Both write the device's main binding, never one of its extras (a menu's extra column captures
  through the extra's own handle).
- `InputActions.PreferredDevice(): Device` (0.7.0): `UserInputService.PreferredInput` as the
  binding name that holds its keys, `MicroGamepad` as `"Gamepad"`. Roblox counts a gamepad as
  preferred as soon as one is plugged in, before any of its buttons is pressed **(measured with
  the virtual pad, 2026-10-03)**, and under the simulated phone it stays `Touch`. A two-column menu
  writes `action.Bindings[InputActions.PreferredDevice()]`; a game hides rebinding on `"Touch"`.
- `InputActions.PreferredDeviceChanged: RBXScriptSignal<(device: Device) => void>` (0.7.0): fires
  when `PreferredDevice()` changes. A `BindableEvent` made the first time the namespace member is
  read (the namespace `declare`s it, and a metatable's `__index` on its table answers it: the
  `PreferredInput` property signal is connected then, once for the module), the same signal object
  on every read. It compares the device it reads with the one it fired last (or read when made), so
  `MicroGamepad`/`Gamepad` switches fire nothing and no device fires twice in a row. On the server
  it is made but never connected: it never fires. Measured under the simulated phone (2026-10-03):
  a VirtualInput key press switches `PreferredInput` to `KeyboardAndMouse` (VirtualInput's gamepad
  KeyCodes too, sent as keys), a tap back to `Touch`, one property change each; elsewhere only a
  gamepad moves it (the virtual pad, plugged in and out: `Gamepad`, then `KeyboardAndMouse`).

Binding handle (non-Scriptable: a device's binding, main or extra):

- `Instance: InputBinding`, `Name` (the device; an extra's too).
- An extra (0.7.0) is a binding handle of its device like the main one: the same members, its
  device's keys and captures (none on `Touch`), its path `Context/Action/Device/Extra` in saves and
  `BindingsChanged`, its defaults the binding right after `Create`. `Extras()` lists a device's
  extras by name (§3); empty on an extra.
- `Describe(): string` (0.7.0): the binding as text (below).
- `Get()`: the current binding as plain data in the schema's shape (for settings UIs), typed
  `BindingData<A, D>`: the same forms as `BindingPart<A, D>`, so `Set(binding.Get())` compiles on
  every device binding (a menu's Cancel giving back the snapshot it took). Where the device has a
  key for none of the action type's forms (the gamepad's ViewportPosition binding), both are that
  form as it is, which can hold only the display: every binding takes a `DisplayName` (hunt HD4-6:
  `BindingData` kept the stick's form on the keyboard and mouse and touch, whose `ResponseCurve`
  `BindingPart` refused, and `BindingPart` was `never` on the gamepad's ViewportPosition binding).
- `Set(spec)`: typed as the action type's binding shape for the binding's device (§3), or part of
  one of its object forms (`BindingPart<A, D>`: every property optional, a stick's form only on
  the gamepad), validated at runtime (throws on a key or property the action type doesn't allow,
  or another device's key). Object specs **merge** into the binding, so one may leave the key out
  (`Set({ PressedThreshold: 0.9 })`); a bare key sets `KeyCode` and clears the composites. A
  `ResponseCurve` is checked against the `KeyCode` the binding has after the merge (the object's,
  else none after a composite direction, else the binding's), as an import checks it (hunt HD3-3).
  `ResponseCurve` is the only property whose check depends on the `KeyCode`: the thresholds act on
  an analog key and do nothing on another, and nothing refuses them there.
- **Writing bindings** (`Set`, `Reset`, `Clear`, `Capture`, `ImportBindings`, `ResetBindings`, the
  swap's carried rebinds, `Destroy` giving adopted bindings their defaults): the target values are
  worked out first, then only the properties that differ are written. A property written with the
  value it has changes nothing, but a key written away and back in one frame releases a held
  action (local) or leaves it stuck (under the player) **(probed)**, so `Set(K.Space)` on a Space
  binding, or importing the save already in effect, leaves a held action held. A value is written
  when it differs from what the binding reads at that point, `PressedThreshold` before
  `ReleasedThreshold`. `ReleasedThreshold` reads at most `PressedThreshold` and IAS keeps the value
  written **(probed)**, so a binding can store a value it doesn't show, and a target read back from a
  binding (the defaults snapshot, a save) holds only the reading. Three cases:
  - `Reset`, `ResetBindings`, imports, `Destroy` and the swap's carried rebinds give the binding the
    target's reading: `ReleasedThreshold` is written when the binding, its `PressedThreshold`
    written, would read otherwise. A stored value stays only when the binding reads the target with
    it, so `Reset` keeps a designer's 0.8 stored under a default `PressedThreshold` of 0.5, but
    brings back a default of 0.6 under 0.9 when a player stored 0.8 then lowered
    `PressedThreshold` (comparing with the binding as read before the write would skip that 0.6,
    which equals the clamped reading before it).
  - A `Set` or a schema binding that names `ReleasedThreshold` stores it, even where it reads as
    `PressedThreshold`.
  - A write that doesn't name it (`Set({ PressedThreshold: 0.9 })`, `Clear`, `Capture`, the swap
    when the stand-in kept it) leaves the stored value, which comes back into view when
    `PressedThreshold` is raised, rather than writing the clamped reading over it.
- **A change to a binding's keys** (`KeyCode`, a composite direction, a modifier) makes IAS reset
  every binding of the action, whichever binding changed **(probed)**: on a local context the
  action is released at once; keys still down and Scriptable values count again once pressed or
  fired again. Under the player (Server Authority) the client's state is pressed again instead and
  stays held, on the client and the server, until the new keys are pressed and released. So when a
  write changes the keys of an action that is not at rest (its state, or the latest value the
  package fired on it), the package forgets its held values on that action and, on a copy under
  the player in a place that runs Server Authority, fires the pair of §8 after the writes (not when
  `IsServerAuthority()` is `false`: the copy is local there, §8). States are read before any write
  of the batch, so one import releases an action once. A threshold, `Scale` or other tuning change
  leaves a held action held **(probed)**. Adding a binding to an action resets its bindings the
  same way **(probed, hunts HL4-3 to HL4-5)**: `AttachButton`, a `Create` that gives an action a
  binding it lacks, the swap moving a stand-in's binding onto a copy's action another root handle
  uses, and a `<Action>Script` made for the first `Fire`. Each of them (`AddingBindings`) reads the
  held value before its adds and, when it was not at rest, does as above after them: forgets the
  package's held values, and fires the pair on such a copy. A key change inside it (the swap
  writing a stand-in's rebinds onto an adopted binding, a later schema filling a placeholder, §4)
  is not released on its own: `WriteBindings` marks the action, and the one release at the end
  covers it, since two pairs on such a copy would press and release it once more. The first
  `Fire`'s value follows the pair: a press holds the action, a value at rest leaves it released.
  Without the pair a first `Fire(false)` while a key held the action on the server's copy left it
  held on both sides after the key came up **(probed, 2026-10-03)**: IAS pressed it again as
  `<Action>Script` was added, and a value at rest fired on a binding just made changes nothing.
- `Reset()`: back to the defaults snapshot (§4). `Clear(slot?)`: with no slot, unbinds: KeyCode,
  composites and modifiers become `None`. With a slot (`"KeyCode"`, `"Up"`, ...,
  `"PrimaryModifier"`, typed as for `Capture`), clears only that one, e.g. `Clear("PrimaryModifier")`
  turns Ctrl+S into S (`Set` can't write `None`).
- `Capture(slot, callback, options?): () => void`: waits for the next key that is legal for that
  slot of this binding (`"KeyCode"`, `"Up"`, ..., `"PrimaryModifier"`), applies it, then calls
  `callback(key)`. `options.Cancel?: Enum.KeyCode[]` keys that cancel. The returned function cancels.
  Uses `UserInputService.InputBegan`; ignores `gameProcessed` input (a GUI click, typing, a key a CAS
  binding sinks, such as an InputCatcher's or the legacy shift lock's: a CAS Sink blocks IAS for that
  key, so a binding on it couldn't fire either; under the legacy player scripts the ControlModule
  sinks the gamepad's `ButtonA` and `Thumbstick1` so, always: captures ignore them and IAS bindings
  on them don't fire, **measured with the virtual pad, 2026-10-03**; under the IAS player scripts
  bindings on `ButtonA`, `Thumbstick1` and `Thumbstick1Up` fire), except a Cancel key, heard even then so the player
  can always back out. Typing is no part of a capture: anything while a TextBox has focus, and within
  0.1 s after it lets go (however: a script's `ReleaseFocus` too, since the capture can't tell; hunt
  HC4-1) game-processed input (Return, Escape) and clicks or taps (a click away, which isn't
  game-processed), what ends the typing, which arrives once the focus is gone. Other keys count again
  at once (`ClassifyCaptureInput`; hunts HC-2, HC2-3, HC3-1, 0.6.1). Keys already down when a capture
  starts (`KeysDownNow`: keyboard, mouse buttons, gamepad buttons, and since 0.7.0 the stick
  directions and triggers pushed past halfway) count only once they have come up: a ContextActionService action runs before
  `InputBegan` fires, so the press of a CAS hotkey that starts a capture would otherwise reach it
  (hunt HC2-2). A finger down reads as mouse button 1 and arrives as `TouchPosition`: mouse button 1
  down at the start stands for both, and either coming up forgets both (hunt HC3-2). The wheel, mouse movement,
  touch drags and trackpad gestures raise only `InputChanged`, so `Capture` never takes them (from
  keyboard and mouse, a `Direction2D` `KeyCode` slot captures nothing); the docs say so, and point
  to `Set`.
- **Captures are device-locked (0.7.0).** A binding's `Capture` and `CaptureChord` take only its
  device's keys, classified by the KeyCode (`GetKeyDevice`), not by `UserInputType` or
  `PreferredInput`: VirtualInput sends gamepad KeyCodes (`ButtonA`...) as keyboard input, and the
  captures take them as the gamepad's, which lets the tests drive gamepad captures without a pad
  (`DPadUp` and `ButtonStart` throw in VirtualInput). Another device's key is ignored, not a cancel;
  in a chord it is no part of it (its release settles nothing). A `Cancel` key counts from any
  device (the game lists them). The `Touch` binding has no `Capture`/`CaptureChord` (its type) and
  they throw if called anyway: touch has no keys to press; give it a touch key with `Set`. So a
  tap no longer lands in a keyboard-and-mouse binding as `TouchPosition`.
- **Sticks and triggers in captures (0.7.0).** Captures also follow a gamepad's `InputChanged`
  (`CaptureInput` in `Capture.ts`): a stick's axis past 0.5 (IAS's default `PressedThreshold`)
  counts as `Thumbstick<n>Up/Down/Left/Right` going down, back under 0.2 (the default
  `ReleasedThreshold`) as it coming up. Both are read as IAS reads them, past its deadzone
  (`AnalogValues`): on a stick the radial one, `max(0, (|v| - 0.1) / 0.9)` on the stick's vector,
  then each axis; on a trigger the linear one, `max(0, (z - 0.1) / 0.9)`. So a capture counts a
  key exactly where IAS presses a binding on it, at a raw 0.55, and lets it come up where IAS
  releases it, at a raw 0.28 (PAD-1: they compared the raw `Position`, so a push from raw 0.5 to
  0.55 was captured but never pressed the action). That fills composite slots and Bool/Direction1D `KeyCode`
  slots (axis keys are legal there), and a chord can end on one. A Direction2D `KeyCode` slot of
  the Gamepad binding takes the whole stick (`Thumbstick1`/`Thumbstick2`) of the first stick pushed
  past 0.5 (`CapturedKey`). A stick's own `InputBegan`/`InputEnded`, if any, are ignored: only the
  axes count. A stick already pushed when the capture starts counts once it has come back. A pad's
  triggers (`ButtonL2`/`ButtonR2`) go down past halfway too (`Position.Z` past 0.5), at their
  `InputBegan` or an `InputChanged`, whichever shows it first: an `InputBegan` below halfway waits
  for an `InputChanged` past it, so a light pull is no key (hunt HD-4). They come up back under
  0.2 or at their `InputEnded`, whichever comes first. **Measured with the virtual pad
  (2026-10-03):** a trigger raises `InputChanged` at every change (`Position.Z`, raw),
  `InputBegan` only at 1 and `InputEnded` only back at 0 (also after a pull that never reached 1),
  so the `InputChanged` decides; a stick raises only `InputChanged` (`UserInputState.Change`), raw,
  `y` positive up. VirtualInput's `ButtonR2` arrives as keyboard input, with no position: it goes
  down and up with its `InputBegan`/`InputEnded`. The `device-capture` section's failure messages
  carry the pad events that came.
  Mouse movement, the wheel and touch gestures still never count.
- `CaptureChord(callback, options?): () => void` (0.6.1), on the KeyboardAndMouse and Gamepad
  bindings of Bool and Direction1D actions only (the types whose `KeyCode` takes keys that begin;
  typed through `BindingHandleOf<T, D>`, and it throws on the others at runtime). It follows the keys that begin while it waits (`InputBegan`, not
  `gameProcessed`), in order, and settles on the first `InputEnded` among them: the last key down is
  `KeyCode`, the ones before it `PrimaryModifier` then `SecondaryModifier`, which is the order IAS
  needs them pressed in. One key alone clears the modifiers. Applied in one write (one release of a
  held action, one `BindingsChanged`), then `callback(chord)`. A chord the binding can't hold (more
  than three keys, a modifier that isn't a Button key, a `KeyCode` the type can't take) is ignored,
  and the capture re-arms only once every key of it is up, so the last leftover released alone
  can't settle a chord. A key down before the capture began is no part of a chord. A key the game
  took (game-processed, not typing) while it is held in a chord makes the chord one the binding
  can't hold, so a chord with a sunk key is refused rather than recorded without it (hunt HC2-1).
  `options.Timeout` (seconds from the start, positive and finite, else it throws): when it runs out,
  the keys held then settle the chord the same way; with none held, or none the binding can hold,
  the capture ends with nothing applied. `callback(undefined)` when it ends with nothing applied (a
  `Cancel` key, the timeout); the returned function stops it without calling `callback`.

Scriptable binding handle: `Instance`, `Name`, `Fire(value: V)`.

**Keybinds as text (0.7.0).** `binding.Describe()` (`DescribeBinding` in `Describe.ts`): the
binding's `DisplayName` when it has one; else its modifiers, then its `KeyCode`, joined by `" + "`
(`"Ctrl + S"`), or its composite directions in reading order (Up, Left, Down, Right, Forward,
Backward) joined by `" / "` (`"W / A / S / D"`; with modifiers `"Shift + (W / A / S / D)"`, the
parentheses telling the chord from a list); `""` when it has no key (a binding with modifiers alone
has none). Only the slots the action type uses count, and the composites give way to a `KeyCode`,
as in IAS. Key names (`KeyText`): a table of readable names first, else
`UserInputService:GetStringForKeyCode` (keyboard-layout aware) upper-cased, else the enum's
`Name`. **Measured** (2026-10-03, every KeyCode, `default` and `touch`, a US layout): it gives a
character key's character (`Space` " ", digits, punctuation; a shifted symbol its base key:
`Hash` "3"), and the enum's `Name` for every other key (`LeftControl`, `Return`, `KeypadZero`,
`ButtonA`, `Thumbstick1`, `MouseLeftButton`, `MouseWheel`, `TouchPosition`...), never "". So the
table names those: `Space`, `Enter`, `Esc`, `Ctrl`/`Shift`/`Alt`/`Meta`/`Super` (the right
ones `Right Ctrl`...), the locks, `Page Up`/`Page Down`, `Num 0`..`Num Enter` (the keypad's, also
where the function gives a character), the mouse (`Left Click`, `Mouse Wheel`, `Mouse Movement`,
`Mouse Position`, the trackpad's), touch (`Touch`, `Drag`, `Pinch`), and the gamepad by Xbox names,
as the KeyCodes are (`A`, `LB`, `RT`, `D-Pad Up`, `Left Stick`, `Left Stick Up`, `Left Stick Press`,
the TV remote's `Remote Center`...). `F5`, `Tab`, `Home`, `Up` keep their `Name`. No `Separator`
option: nothing in a menu needed it. Gamepad icons stay `UserInputService:GetImageForKeyCode`'s,
on the keys of `Get()`. `Describe` is a binding handle's member, so no extra can take its name.

**Conflicts (0.7.0).** `FindConflicts(binding)` on the root handle (every context) and on a context
handle (its own) (`Conflicts.ts`): the other device bindings of `binding`'s device whose keys meet
its keys, by path, each `{ Binding, Path, Key, Keys, Identical }` (`Binding` typed
`IBindingHandle<Enum.InputActionType, Device>`, any device binding's). A binding's keys are its
`KeyCode`, else its composite directions, and its modifiers. Two bindings conflict when a key presses
both, or one's key is the other's modifier: pressing Ctrl+S presses a binding on Ctrl, which goes
down first (decided beyond the spec, which named the `KeyCode` and the directions: a menu should
warn about a crouch on Ctrl that every Ctrl+S also presses). Two chords that only share a modifier
don't: neither presses the other. `Identical`: a key presses both with the same `PrimaryModifier`
and `SecondaryModifier`, so every press of it presses both; otherwise they overlap (IAS fires both
when the chord is pressed: a chord doesn't block its plain key; or two chords on one key; or the
modifier case). One entry per other binding, `Key` the first shared key in `binding`'s order and
`Keys` all of them, so a menu swaps or clears each binding once. `FindConflicts()` lists every
pair once, `{ Bindings, Paths, Key, Keys, Identical }`, sorted by path. Only keys count: not
whether the contexts are enabled or sink, nor Scriptable, button or unmentioned bindings, nor
another root handle's; a handle on the same instance (another root handle's) is `binding` itself.
Anything but a device's binding handle throws. `FindConflicts` is a root member (§4).

**Gestures (0.7.0, `Gestures.ts`).** Bool action handles have `OnTap(callback, { MaxDuration?
(0.25), WaitForDoubleTap?, Window? (0.3) })`, `OnDoubleTap(callback, { Window? (0.3), MaxDuration?
(0.25) })`, `OnHold(callback, { Duration, Progress?, Cancelled? })` and `OnLongPress(callback:
(heldFor) => void, { Duration })`, each returning a function that stops it; `Destroy` stops them
all (`ActionHandle._gestures`). Typed on `IBoolActionHandle` (so `BoolAction` has them); on
another action type they throw (`needs a Bool action`).

- Built on the handle's own `Pressed`/`Released` (which always alternate), one pair of
  connections per gesture so a callback that throws stops no other, timed with `os.clock` when each
  arrives. A gesture starts with the next press: a release whose press it didn't see is ignored.
- Tap: released within `MaxDuration`. `WaitForDoubleTap` holds it for `Window` after the release
  (a `task.delay`) and drops it at a press within the window, which is then a double tap's second
  press and no tap; `Window` on `OnTap` (beyond the spec) so a tap still excludes an `OnDoubleTap`
  given another window. A waiting tap is dropped when the action is not live by the end of its
  window (a menu opened). Double tap: fires at a press within `Window` after a tap; that press
  starts nothing new (a fourth quick press is the next double tap's second).
- Hold: fires once while held, at `Duration` (a `task.delay`, or a frame that finds it past, first
  wins). `Progress` gets 0 at the press, the fraction each frame while held (`EveryFrame`: a render
  step, or `PreAnimation` in a window that renders nothing; per-frame work only while a hold is in
  progress and has `Progress`), and 1 as it completes, then stays at 1 until the next press. An
  early end calls `Progress(0)` then `Cancelled()`. Long press: fires at the release of a press
  that lasted `Duration`, with the seconds held (beyond the spec: a charge-and-release wants them).
- Validation: durations positive and finite (`IsSeconds`), callbacks and `Progress`/`Cancelled`
  functions, `OnHold`/`OnLongPress` options present; else they throw, naming the method.
- **A reset ends a gesture without completing it** (decided): no tap, double tap or long press, and
  a hold's `Cancelled`. A release is a reset's when the action is not live as it arrives (the
  context or the action disabled, the focus-loss reset holding the contexts off for its frame), or
  when the package reset the action since the press began: `MarkReset(action)` (`Internal.ts`, a
  weak map of `os.clock` times read by `ResetSince`) is called before each reset the package
  makes, since under Immediate signals IAS's `Released` runs inside it: `ActionHandle.Release`
  (a context or action disabled, `ResetState`, `Destroy`), `ReleaseActions` (every action of a
  context being disabled, another root handle's too), `WriteBindings` (an action whose keys change
  while held), `AddingBindings` (taken back when it added nothing and changed no key),
  `ReleaseHeldValues` and `FinishLink` (the swap). A press that began after the mark is the
  player's again, so a mark never swallows a later real release.
- The swap: a press the copy doesn't show ends with `FinishLink`'s `Released`, a reset (the usual
  case: the moved binding's key holds the copy's action only once pressed again); a value a
  Scriptable binding held is fired again on the copy, a new press; a press the copy shows already
  (another root handle's input holds it there) goes on, no edge reaching the listeners.
- Destroy and a gesture's function stop it without calling anything, a hold in progress included;
  every listener checks the root handle's `IsDestroyed()` first, so a delivery already queued under
  Deferred signals calls nothing either. After `Destroy` a new gesture returns a function that does
  nothing.
- Several gestures on one action are independent (documented combinations: a tap begins a hold it
  cancels; a long press is a hold and a long press, no tap).
- Unverified: IAS's own release when the window loses focus (it can't be simulated from Luau): with
  `ResetOnFocusLoss` off it counts as the player's release; with it on, the reset's mark comes from
  `WindowFocusReleased`, whose order against IAS's release is unmeasured.

Root handle: one property per context, plus `ExportBindings()`, `ImportBindings(json)`,
`ResetBindings()`, `BindingsChanged: RBXScriptSignal<(path: string) => void>` (fires on
`Set`/`Reset`/`Clear`/`Capture`/`CaptureChord`/import, with the path `Context/Action/Slot`, a
device's extra `Context/Action/Device/Extra`), `FindConflicts(binding?)` (0.7.0, above),
`Destroy()`. Context handles also have `ExportBindings()`, `ImportBindings(json)`,
`ResetBindings()` and `FindConflicts(binding?)` for their own actions.

**IAS behaviours users must know (probed; put them in the docs):**

- Several bindings on one action are **not combined: the last one to change wins.** Holding A and
  B, then releasing A, releases the action. Same for Direction2D: the state is the last fired or
  moved binding's value. A device's main binding and its extras are several bindings too: holding
  W (WASD) and Up (the arrows' extra), then releasing W, reads at rest while Up is held.
- `GetState()` updates synchronously after a `Fire`; the events are deferred under
  `SignalBehavior = Deferred`.
- A repeated `Fire` of the same value does nothing. `Fire` on a disabled action or context is
  silently ignored.
- A fired value persists until something changes it.
- **Real input, measured with `VirtualInput` (2026-10-01):**
  - Last write wins for real keys too: holding R and F on one action, then releasing R, releases it.
  - **A chord does not block the plain key:** with `Ctrl+C` and plain `C` bound, `Ctrl` then `C`
    fires both. The modifier must be pressed first (`C` then `Ctrl` fires only the plain `C`), and
    releasing a modifier releases the chord. The package can't make chords exclusive.
  - `MouseWheel`, `MouseDelta`, `TouchDelta` (and trackpad pan/pinch) report a **rate**: the amount
    divided by that frame's time (one wheel notch reads about 190 at 190 fps, 64 at 60 fps), for one
    frame, then 0. Multiply by the frame's delta time to get notches or pixels. The `Scroll` preset
    is a rate too.
  - A sinking context blocks only the keys it binds; a CAS `Sink` blocks IAS for that key, `Pass`
    doesn't; a focused TextBox blocks key bindings.
  - A click on a GuiButton fires its `UIButton` binding and blocks a `MouseLeftButton` action;
    a click on empty space fires the `MouseLeftButton` action.
  - Opening the Roblox menu does **not** release held actions (the package's focus-loss reset
    does); losing window focus does, on the engine side.
  - **Gamepad UI navigation:** while a GuiButton is selected (`GuiService.SelectedObject`), the
    keyboard's Return activates it (`Activated` fires) but does **not** fire its `UIButton` binding,
    and Return and the arrows never reach IAS; the gamepad's ButtonA (and R2) drive the `UIButton`
    binding and never reach IAS. Thumbstick updates are unreliable while something is selected.
    So the docs tell a gamepad rebinding menu to clear `SelectedObject` while a capture runs:
    measured for IAS; for the captures (`InputBegan`, game-processed input ignored) unmeasured
    with a real pad. VirtualInput's `ButtonA` is keyboard input, which the selection doesn't take:
    with a button selected, a Gamepad binding's `Capture` takes it (`hunter-devices-2`).
  - Thumbstick deadzones are fixed: radial 0.1 with rescale on sticks, linear 0.1 on triggers;
    `PressedThreshold` applies to the rescaled value (measured with the virtual pad: a Bool on
    `ButtonR2` pressed at raw 0.561 and released at 0.251; a stick's direction pressed past raw
    0.55 and released under 0.28; `UserInputService` reports the raw value). A stick moving on both axes can fire
    `StateChanged` twice in one frame, with an intermediate value first.
  - Changing a binding's keys while its action is held releases the action on a local context,
    and leaves it stuck under the player (see the binding handle above).
  - An `InputCatcher` (a CAS sink over every input) doesn't block a click or tap on a GuiButton, nor
    its `UIButton` binding: GUI gets the input before CAS. It blocks `MouseLeftButton` and the wheel.
  - A button with `Active = false` no longer fires `Activated`, but its `UIButton` binding still
    presses the action. `Visible = false` and `Interactable = false` stop both.

## 7. Saving keybinds as JSON

```json
{ "Version": 1, "Bindings": {
  "Gameplay/Jump/KeyboardAndMouse": { "KeyCode": "F" },
  "Gameplay/Move/KeyboardAndMouse": { "Up": "Up", "Down": "Down" },
  "Gameplay/Look/Gamepad": { "Scale": 0.02, "Vector2Scale": [1, -1] }
} }
```

- 0.7.0 keeps the format and the paths (`Context/Action/Device`): a 0.6 save's entries under the
  device names apply as before. The device bindings a schema leaves out are saved like the others
  (a player's gamepad key on a keyboard-only action). An entry under another name (0.6's `Mouse`,
  `Alternate`, or a Scriptable slot) is skipped with the reason `<Name> is not a device: a save
  holds the KeyboardAndMouse, Gamepad, Touch bindings`; one with another device's key, with the
  reason the rules give (`F is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys`).
  `SanitizeBindings` keeps the device paths of every action, and drops the same entries.
- **A device's extra** is saved at `Context/Action/Device/Extra` (one more segment); its main
  binding keeps `Context/Action/Device`, so a save made before a schema declared extras loads as it
  is, and the extras stay at their defaults. An import skips an extra its schema doesn't declare
  (`Gameplay/Move/KeyboardAndMouse has no extra binding Numpad: a device's extras are the ones its
  schema declares`, also through a root handle that shares the action but not the extra), a
  `.../Device/Main` path (`Main is the device's own binding, saved as Gameplay/Move/KeyboardAndMouse,
  not Gameplay/Move/KeyboardAndMouse/Main`), and a path of five segments or more (`unknown path`);
  an extra under a name that isn't a device gets the device reason. `SanitizeBindings` keeps the
  extras the schema declares (each checked against its device's keys) and drops the rest.

- `ExportBindings()` returns only what differs from the defaults snapshot, via
  `HttpService.JSONEncode`. Enums by `Name`; `Vector2`/`Vector3` as arrays.
- Saved properties: `KeyCode`, `Up`, `Down`, `Left`, `Right`, `Forward`, `Backward`,
  `PrimaryModifier`, `SecondaryModifier`, `Scale`, `Vector2Scale`, `Vector3Scale`, `ResponseCurve`,
  `PressedThreshold`, `ReleasedThreshold`. A cleared binding saves its keys as `"None"`.
- `ImportBindings(json)` returns `{ Applied: string[]; Skipped: { Path: string; Reason: string }[] }`
  and never throws:
  - bad JSON, a non-object, an unknown `Version`, or a save nested deeper than a save can be (8
    levels; a save has 4): nothing applied, everything stays default. The depth is measured before
    decoding, outside JSON strings: `HttpService:JSONDecode` on input nested a few hundred deep ends
    the whole process, `pcall` or not **(probed)**, and `SanitizeBindings` takes what a client
    sends;
  - it starts from the defaults (a binding missing from the save is reset to default);
  - unknown path, unknown property, unknown key name (`Enum.KeyCode.FromName` returns `nil`
    **(probed)**; `"Unknown"` resolves to `None`), a key not allowed for that slot, a number that
    is not finite as a float (the binding properties are floats: beyond ±3.4e38 a number becomes
    `inf` there, which JSON can't hold; `Set` refuses it too), a `ResponseCurve` whose binding would
    not end on a thumbstick `KeyCode` (the entry's `KeyCode`, else the default one; a composite
    direction clears it): that entry is skipped and stays default.
- `ExportBindings()` leaves out a `ResponseCurve` beside a `KeyCode` that is not a thumbstick (it
  acts on nothing there), so every export imports cleanly.
- `InputActions.SanitizeBindings(schema, json): string` runs the same validation against the
  schema alone (no instances; works on the server) and returns a clean JSON string, so a server can
  clean what a client sends before storing it.
  - The binding's default `KeyCode`, which the `ResponseCurve` check reads when the entry has no
    `KeyCode`, isn't the schema's to tell: a binding in the client's folder or template wins over
    the schema's (§4), such as the Input Action Manager's `LookGamepad` on `Thumbstick2` for a
    device the schema leaves out. Checking against the schema's `KeyCode` dropped a tuning the
    client exports and loads (hunt HD3-1). So `SanitizeBindings` passes no default: a
    `ResponseCurve` the entry doesn't settle itself (its `KeyCode`, or a composite direction) stays
    on a `Gamepad` binding, and the import checks it against the binding it finds. On a
    `KeyboardAndMouse` or `Touch` binding, which can't hold a thumbstick, it is dropped. What
    `SanitizeBindings` keeps but an import then skips is harmless: the import never throws.
  - Considered instead: the export writing the `KeyCode` beside a `ResponseCurve`, so the entry
    settles it. Rejected: the save would then hold a key the player never chose, and keep it after
    the game moves the default; and saves made before would still lose the tuning.

## 8. Server Authority

A context is Server Authority only when marked `ServerAuthority: true`. Keybinds stay on the
client; the server only reads action state, which IAS replicates on its own.

- **Server:** `InputActions.ProvideToPlayers(schema, options?)`: for each player, now and on
  `PlayerAdded`, put every Server Authority context into `player.<PlayerFolderName>` (default
  `Inputs`):
  - if `ReplicatedStorage.Inputs.<Context>` exists (the Manager's template), clone it, keeping its
    `Priority`/`Sink` and actions, and **destroy every `InputBinding` in the clone**;
  - otherwise build the context and its actions (name, `Type`, `DisplayName`) from the schema;
  - add actions the schema has and the clone lacks. Throws on a `Type` mismatch, as §4.
  - **The copy and all its actions are enabled**, whatever the template or the schema says: IAS on
    the server ignores the client's input for a context or action the server has disabled, even
    once the client enables its own **(probed)**. The client owns `Enabled` (below).
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
  - **The client owns `Enabled` on the copy.** The first time the package takes up a copy's context
    or action (on this client), it gives it the template's `Enabled` when the template has it (the
    context's as it was before the package disabled the template, below), else the schema's (IAS
    default `true`); the template's extra actions get the template's. From then on the instance's
    value is the client's state, as for any adopted context (§4): a later `Create` after `Destroy`
    keeps it. At the swap the copy takes the stand-in's, unless a live root handle already uses
    that instance.
  - Otherwise build a **local stand-in**: a client-only context (a clone of the template, or built
    from the schema) with its bindings, in a client-only folder. The handles work on it at once:
    input, `GetState`, events, `Fire`, rebinding, requests, `AttachButton`. Its state never reaches
    the server. Root handles waiting for the same copy (`PlayerFolderName` and context name) share
    one stand-in, adopted as `Create` twice adopts a folder's context (§4): one enabled state
    before the swap as after it, and one swap for all of them. A `Create` that finds the copy
    while other root handles still wait for it swaps them first, so the copy carries their state.
  - When the server's copy arrives, **swap**: add the bindings to the server's actions, carrying
    over everything the stand-in has now (rebinds, the context's base state and held requests, each
    action's `Enabled`, attached buttons, the last value fired on each Scriptable binding, so a held
    virtual stick stays held), point the handles at the server's instances, then disable and
    destroy the stand-in. A Bool action held at the swap may release once (stand-in disabled) and press again
    on the next input; `Pressed`/`Released` listeners see that. The stand-in's events still on
    their way are dropped, so at the swap each handle tells its listeners the copy's state
    (`Released`, `StateChanged` to rest) before the copy's own events: a value fired again reads
    as a release and a new press, never two `Pressed` in a row (nor two `Released`, nor a
    `StateChanged` repeating a value: the copy's own events repeating what the listeners have are
    dropped, §6; on the Join path a joining handle is on the copy before the Join's releases, and
    hears them before the swap tells it the copy's state, hunt HL3-3). After the swap, `Reset`
    still returns to the same defaults. When another root handle is on the same copy already (it
    swapped first, or found the copy there), its bindings of the same name are adopted rather than
    doubled (attached buttons are renamed). What the stand-in's binding changed from its defaults (rebinds,
    an import) is written onto the adopted one, which keeps its defaults, the first handle's
    snapshot (§4), so the stand-in handle's export reads the same after the swap, but for a change
    to a value those defaults hold already: that is a default now, as when a later schema fills an
    unbound binding a player rebound (§4). So a gamepad key a player gave a stand-in whose schema
    left `Gamepad` out drops out of its export when the other handle's schema has that key, and a
    later session without that schema loads no gamepad key there. Kept (hunt HD-5, disputed): an
    export base per root handle would have `Reset` then the export save the key again, and give
    two root handles on one binding two answers. A value the
    stand-in held on a Scriptable binding that the adopted one already holds stays held by both
    root handles (IAS ignores the repeated Fire), so destroying either leaves it to the other. A
    binding moved onto a copy's action that is not at rest (another root handle's input holds it)
    makes IAS reset it, as any binding added does (§6): the package lets go of it after the moves,
    with the pair below on such a copy (hunt HL4-4).
  - **Extras at the swap (decided):** a device's extras are bindings of the stand-in's action like
    the others: they move onto the copy's action with their rebinds and defaults, and the handles
    hung off the main binding's handle follow (`LinkTo` retargets them). One another root handle
    on the copy already made under the same name (its schema declares the same extra) is adopted,
    with the stand-in's rebinds written onto it, as for the device bindings; one only the
    stand-in's schema declares moves over and stays that root handle's (§4). The swap knows no more
    about extras than about any binding, so its rules (held values, `AddingBindings`, the labels)
    hold for them unchanged.
  - A copy whose action has another `Type`: `warn` naming the path, and stay on the stand-in (it
    keeps working).
  - Context handles of Server Authority contexts add `IsLinkedToServer(): boolean` and
    `LinkedToServer: RBXScriptSignal<() => void>` (fires once, at the swap, or never when the copy
    was there from the start and `IsLinkedToServer()` is already `true`), and (0.6.1)
    `WhenLinkedToServer(callback: (context: InputContext) => void): () => void`: calls back with the
    server's copy at once, in the caller's thread, when linked already, else once with
    `LinkedToServer`; the returned function and `Destroy` cancel a call still to come. At a swap,
    every root handle on the stand-in is marked linked before any of them fires, so listeners see
    the others linked under Immediate signals too (hunt HL-3).
  - **Listeners inside the swap (Immediate signals).** The swap runs in this order: release the
    held Scriptable values on every action of the stand-in (its listeners run, everything still
    on the stand-in, the copy untouched); drop the root handles destroyed meanwhile, and stop when
    none is left; take what the Scriptable bindings hold then (the package's records stay through
    the releases, so a value a listener fires there replaces the one it fires over and is carried
    over, and one it fires at rest drops it: hunt HL4-2); claim the copy, move the bindings and
    point every handle at the copy, which runs no listener (but the copy's own events, when a
    binding moved onto an action another root handle's input holds releases it); mark every
    handle linked; move the context's state (`EnabledChanged`, releases);
    move the labels and tell each handle's listeners the copy's state; destroy the stand-in; fire
    the held values again; `LinkedToServer`. So a listener that hears an event from the copy
    finds every handle on it and `IsLinkedToServer()` true (hunt HL2-2). A root handle a listener destroys takes no further
    part: one destroyed during the releases is dropped from the swap, so it takes no use of the
    copy that nothing would give back (that left the last live root handle's `Destroy` treating the
    action as shared, and a key held through its binding stayed held); one destroyed later gave
    its uses back itself, its handles skip the rest, and a held value only destroyed root handles
    held isn't fired again (hunt HL2-3). The copy is claimed (§8, `Enabled`) only after the
    releases: when every root handle was destroyed in them, the copy stays unclaimed, so the next
    `Create` takes it up first, with the template's or the schema's `Enabled`; a `Create` a
    listener makes there takes it up itself, and the swap joins it (its state wins, as for any
    root handle already on the copy). Claimed before the releases, the copy kept the server's
    `true` and the destroyed stand-in's action `Enabled` (hunt HL3-1).
  - After `Timeout` seconds (default 10) without the server's copy, `warn` once, naming the
    contexts, the expected path, and the likely causes: `ProvideToPlayers` was not called on the
    server, or it uses a different `PlayerFolderName`. Keep the stand-in, and still swap if the
    copy arrives later.
- **Client:** the template context in `ReplicatedStorage.Inputs` of a Server Authority context is
  disabled locally, so it does not process the same keys beside the stand-in or the player's copy.
- **Probed:** a client-created Scriptable binding under a server-created action drives the action,
  and the state reaches the server (`GetState`, `Pressed`, `StateChanged`, and `BindToSimulation`
  all see it). The server never sees the client's binding.
- **Releasing on the server (probed).** Disabling the context or the action on the client (or
  toggling the action's `Enabled`) releases only the client's state: the server keeps the last value
  it received, and the client's own state comes back when the context is enabled again. A value at
  rest written through a Scriptable binding reaches both sides: a same-frame pair, the held value
  then the value at rest, releases the action (the last write wins), even on a binding made and
  destroyed in that frame. A `Fire` while disabled is ignored, and a `Fire` right before a disable
  still reaches the server. So before anything resets an action on the server's copy (its context
  disabled by `SetEnabled`, `Request` or the focus-loss reset; `SetEnabled(false)` on the action; a
  held button binding removed; `Destroy`), the package fires the value at rest on its own held
  Scriptable bindings, or, when something else holds the action (a key, a button, a binding the
  package doesn't drive), fires that pair on `<Action>Script`. Actions shared by several root
  handles are released once. This covers every action of the copy, including those the schema
  doesn't mention (a template's extras, which the package gives the template's keys): those get the
  pair on a Scriptable binding made for it and destroyed in the same frame, when their context is
  disabled and when the last root handle using their keys is destroyed (and, left held, the reset
  of §4 once their bindings are gone).
- **In a place without Server Authority** a context under the player (the server's copy of a
  context marked `ServerAuthority: true`) is an ordinary local context **(probed, hunt round 3)**:
  a rebind while a key holds its action releases it once, and nothing sticks. So the package fires
  none of these pairs (releases, rebinds, `RawInputHandler.ControlSetEnabled`) when
  `IsServerAuthority()` is `false`: after a rebind IAS has released the action already, and the
  pair would press and release it once more. While the mode is `undefined` it fires them, as under
  Server Authority. `Tap` waits for the press to show only on such a copy too. `Destroy` still lets
  go of what it held there: a binding it removes while a key holds the action would leave the action
  stuck, so it resets the action, as on any local context (§4; hunt round 4).
- **Rebinding a held action (probed).** A change to the keys of any binding of an action on the
  copy, while the action is held, leaves it held on both sides (§6, binding handle). A pair fired
  before the change is undone by it when the binding still holds a key that is down; fired after
  the change, with the value read before it, it releases the action in every case measured (held
  key rebound, another binding rebound, a composite direction changed with its held key kept, a
  modifier added, a held Scriptable value), with one `Released` and no `Enabled` toggle. So the
  package fires it after the writes, on a binding made and destroyed in that frame.
- **Adding a binding to a held action (probed, hunt HL4-4).** A binding added to an action of the
  copy while it is held (`AttachButton`, a second `Create` adding a slot, the swap moving a
  stand-in's binding onto a copy's action another root handle's input holds, the `<Action>Script`
  the first `Fire` makes) resets it as a key
  change does: `Released` then `Pressed`, and it stays held on both sides after the key comes up.
  So the package fires the same pair after the add (`AddingBindings`), once per action for all the
  bindings added and keys changed in one go (a placeholder filled, rebinds carried by the swap),
  with the value read before it, and forgets its held values on that action. Not when `IsServerAuthority()` is `false`, where IAS has released the action already.
- `Workspace.AuthorityMode` cannot be read by scripts **(probed)**, but the mode shows in an engine
  error message **(probed 2026-10-01, game scripts at identity 2, both realms)**:
  `workspace.Terrain:CanSetNetworkOwnership()` (security None; creates nothing) returns
  `(false, reason)`, and the reason depends on the mode:

  | Realm | Under Server Authority | Otherwise |
  |---|---|---|
  | client | `Can not call Network Ownership API when workspace.AuthorityMode = Enums.AuthorityMode.Server.` | `Network Ownership API can only be called from the Server.` |
  | server | the same `AuthorityMode` message | `Network Ownership API cannot be used on Terrain` |

- **`InputActions.IsServerAuthority(): boolean | undefined`**, on both realms. `true` when the
  reason mentions `AuthorityMode`; `false` when it is one of the known messages for the other mode
  above; `undefined` in every other case (the call succeeded, threw, or returned a message not seen
  before, e.g. because Roblox reworded it). On the client before `game.Loaded`, `workspace.Terrain`
  is `nil` and the call throws **(probed)**: `undefined`, which the docs name as the other reason.
  The first `true` or `false` is cached (the mode can't change during a session); `undefined` is
  never cached. It never throws.
- **Warnings:** `Create` (client) and `ProvideToPlayers` (server) warn once per call when the schema
  marks a context `ServerAuthority: true` and `IsServerAuthority()` returns `false`, naming the
  contexts and saying the server will never receive their state. `undefined` stays silent.
- **Releases:** `false` also turns off the releases on the server ("Releasing on the server" above);
  `undefined` keeps them.
- **The user docs must explain it plainly**, replacing every statement that the package "can't
  tell" or "can't warn":
  - what `IsServerAuthority` reads: the engine's error message, quoted as in the table above;
  - that it is best-effort: if Roblox changes the wording it returns `undefined`, and the warning
    goes quiet rather than wrong;
  - that a context marked `ServerAuthority: true` in a place without Server Authority still works on
    the client (the server's copy replicates either way), but the server never receives its state;
  - that the `Timeout` warning only means the server's copy never arrived; it says nothing about
    the mode.
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
| `Scroll` | Direction1D | `MouseWheel` | composite `Up = Thumbstick2Up`, `Down = Thumbstick2Down` |

0.7.0: one binding per device, so `Scroll` keeps the wheel on the keyboard and mouse and drops the
`PageUp`/`PageDown` composite it had beside it (0.6's extra `Mouse` slot): the wheel is how a mouse
scrolls, and a game sets the composite with `Set` when it prefers the keys. Every preset action
also has its (unbound) `Touch` binding.

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
  default PlayerModule with IAS enabled; a local copy, git-ignored: copy it out of a Studio place
  with the IAS player scripts) as the reference:
  - Find the PlayerModule's contexts: `LocalPlayer.InputContexts` (Server Authority), else
    `StarterPlayer.PlayerModule.InputContexts` (IAS player scripts) **(probed locations)**. That
    choice is the ControlModule's, and holds for `CharacterContext` only. The CameraModule reads
    `StarterPlayer.PlayerModule.InputContexts` in every mode (`CameraInput.luau` reads
    `script.Parent.Parent.InputContexts`) and tunes only those bindings **(probed)**, so the camera
    actions always come from there.
  - Move vector: `CharacterContext.MoveAction:GetState()` (Vector2, X right, Y forward) as
    `Vector3(x, 0, -y)`, then the existing camera-relative logic.
  - Rotation / zoom: port `External/PlayerModule/CameraModule/CameraInput.luau`
    (`CameraRotationAction:GetState() * dt`, touch pitch adjustment, `CameraZoomAction`). Read only;
    don't change Roblox's bindings (its own CameraModule already applies sensitivity and invert).
  - `ControlSetEnabled(v)`: sets `CharacterContext.Enabled` to `v` (the PlayerModule never
    toggles that context itself). Under Server Authority, `ControlSetEnabled(false)` first releases
    the context's held actions on the server (§8): a temporary Scriptable binding fires the pair and
    is removed in the same frame; `RotationAction`, which carries a setting, is left alone. The
    value is remembered: `player.InputContexts` may arrive after the game's first call (the
    PlayerModule's `ActionController` says so), and until then the module's own contexts are read.
    When the `CharacterContext` read changes, the new one takes the remembered value and the one
    left behind gets back the `Enabled` it had before `ControlSetEnabled` changed it.
    `MouseInputSetEnabled(v)`: gates what `GetRotation`/`GetZoomDelta` return, without touching
    Roblox's instances.
  - Legacy fallback: when neither location has contexts (legacy player scripts), keep today's path
    (`PlayerModule:GetControls()` and the forked `CameraInput` module).

## 11. Code style

Follow `.github/prompts/style-guidelines.prompt.md` and `best-practices.prompt.md`: PascalCase
functions and public members, `camelCase` locals, `_camelCase` private class fields, `I`-prefixed
interfaces, `E`-prefixed `const enum`s, `CONSTANT_CASE` constants, types merged into their
namespace or class. roblox-ts limits: `Places/TestingPlace/.claude/rules/roblox-ts.md`.

## 12. Tests (in `Places/TestingPlace`)

- `bun run test:all` (from `Places/TestingPlace`) builds the package into the place
  (`scripts/link-package.mjs`), then runs every section in Studio under six projects:
  `default` (legacy player scripts), `ias` (IAS player scripts), `immediate` and `ias-immediate`
  (the same two with `SignalBehavior = Immediate`), `authority` (Server Authority) and `touch` (a
  simulated phone). The others run Deferred signals; Server Authority requires them.
  `getProject()` from `@flamework-experimental/testing` tells a test which one it runs under.
- **Real keyboard and mouse input:** `UserInputService:CreateVirtualInput()` (client and server,
  in Studio; the typings return `RBXObject`, so cast to `VirtualInput`) returns a `VirtualInput`
  that IAS treats as hardware: `SendKey`, `SendMouseButton`, `SendMouseDelta` (cursor locked only),
  `SendMousePosition`, `SendPointerAction` (`Wheel`, `Pan`, `Pinch`), `SendTextInput`. Rules:
  - every key or button a test presses is released in `defer`, also when the test fails (pressing
    a button that is already down throws, and a held key leaks into later tests);
  - `SendMouseButton` positions are screen positions, counted from the screen's corner. In GUI
    coordinates (`AbsolutePosition`, `InputObject.Position`) that corner is where a ScreenGui with
    `IgnoreGuiInset = true` and `ScreenInsets = None` starts: (0, -58) in a desktop window, the GUI
    inset (`GuiService:GetGuiInset()`), and (-47, -58) on the simulated iPhone 14, whose safe area
    moves GUI positions 47 px in from the left edge as well **(probed, hunt round 4)**. So a screen
    position is `AbsolutePosition` minus that corner; `AbsolutePosition + inset` alone puts a tap
    47 px left of its target on the phone;
  - input that would touch CoreGui throws (the top-left menu area, Escape and other keys Roblox
    reserves, and anything while the Roblox menu is open);
  - `SendMousePosition` doesn't register while the Studio window is unfocused (the
    `MousePosition` action reads (-1, -1)); don't depend on it, or skip with a clear message;
  - the window may not render (display off): GUI clicks have not been verified in that state;
    a test that needs layout must cope or skip with a message;
  - wheel notches zoom the player's camera too, and four in from the start put it in first person,
    which locks the cursor at the centre: every later click misses its button **(probed, hunt
    round 3)**. The test helper sends a test's notches back, last first, when the test ends.
- **Touch:** an extra pass, `bun run test:touch` (and part of `test:all`), runs the tests in a
  place made under a `touch` project with Studio simulating a phone:
  `studio exec --realm edit` calling
  `game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("iphone_14")` after
  `studio open` and before `studio run`, and `SetDeviceAsync("default")` afterwards **always**, also
  when the run fails or is interrupted, because the setting belongs to Studio. Only the Edit data
  model can set it, so a play session still running is stopped first (Ctrl+C ends `studio run`
  before it stops play), and `--keep` keeps the window but not the play session (hunt round 4).
  Under the simulated phone, `PreferredInput` is `Touch`, and `VirtualInput` mouse events arrive as
  touch: taps (`TouchPosition`), drags (`TouchDelta`, a rate), `UIButton` taps, `UIModifier`
  regions. One pointer only: no pinch, no multi-touch.
- **Window focus and the Roblox menu can't be simulated from Luau.** Keep driving those paths
  through Scriptable bindings and the TextBox focus path, as now. VirtualInput sends gamepad
  KeyCodes as keyboard input, which IAS's gamepad bindings don't take but the captures classify as
  the gamepad's (by KeyCode): the device-locked captures are tested that way.
- **Gamepad: the virtual pad** (`tools/virtual-pad`, a Rust service that plugs a virtual Xbox 360
  pad into Windows through ViGEmBus; `virtualPad()` in the tests). **The pad is opt-in, plugging it
  in included.** Every process on the machine sees a plugged-in pad (the user's Roblox Player too,
  whose UI switches to gamepad mode), and Steam's Xbox controller support (on, on the author's PC)
  turns a pad's buttons and sticks into keys and mouse input for whatever window is focused. So the
  service refuses `/connect` unless started with `--allow-plug`, and any pad state but the neutral
  one (and touch injection, and bringing a window to the front) unless started with
  `--allow-input` (which implies `--allow-plug`). `scripts/virtual-pad.mjs` passes them only when
  `VIRTUAL_PAD=1`, respectively `VIRTUAL_PAD_INPUT=1`, is set. `virtualPad()` then answers the
  reason ("the virtual pad is off: set VIRTUAL_PAD=1 ...", "pad input is off: set
  VIRTUAL_PAD_INPUT=1 after turning off Steam Input for Xbox controllers") and the gamepad tests
  `skip(reason)`. A test that only plugs the pad in (`virtualPad({ Input: false })`:
  `PreferredDevice()` reads `"Gamepad"` while it is in) needs `VIRTUAL_PAD=1` alone. By default no
  test plugs the pad in.
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
  stand-in); `IsServerAuthority()` in every project and realm (`false` under `default` and `ias`,
  `true` under `authority`) and the warning when a marked context meets `false`; and with
  `VirtualInput`: hardware bindings driven by real keys and clicks (Bool, composites, chords),
  rebinding then pressing the new key, `Capture` with a real key press (including cancel keys and
  illegal keys), sinking between the package's own contexts, the TextBox focus reset with a key
  held, `AttachButton` with a real click, the wheel as a rate, rebinding while a key or a fired
  value holds the action (local, and the server's copy under `authority`), and `RawInputHandler`'s
  rotation and zoom from real mouse input where the cursor can be locked; under `touch`:
  `PreferredBinding` switching to the touch binding, `AttachButton` with a tap, a
  `TouchPosition`/`UIModifier` binding.
- 0.7.0 adds the sections `devices` (shared: binding names, keys per device, the rules with a
  device, `SanitizeBindings` with device paths; client: the three device bindings on every action,
  `Set` and imports by device, adopted bindings, placeholder filling, `PreferredBinding` with
  unbound bindings, `PreferredDevice`) and `device-capture` (device-locked binding captures and the
  one-field action capture with real keys and VirtualInput's gamepad KeyCodes; sticks and triggers
  through the virtual pad, skipped unless pad input is on; the `PreferredDevice` test with the pad
  plugged in skips unless `VIRTUAL_PAD=1`), and `tests/type-rules/devices-type-rules.ts`. Extra
  bindings per device add `device-extras` (shared: namespaces against bindings, keys per device in
  them, reserved names, extras' names against the action's other bindings, `SanitizeBindings` with
  extra paths; client: the handles and `Extras()`, the reserved list against a live handle, captures
  on extras with real keys, saves and skip reasons, adoption, root handles with other or the same
  extras, the fill, a held action, the swap) and `tests/type-rules/device-extras-type-rules.ts`.
- 0.7.0's usability features add the sections `preferred-device` (no event for the same device;
  under `touch`, a key press and a tap; the virtual pad plugged in and out, with `VIRTUAL_PAD=1`),
  `describe` (key names, every KeyCode readable, bindings and actions as text, after rebinds and a
  real capture), `conflicts` (root and context handles, chords and modifiers, composites and extras,
  devices, unbound bindings, every pair, a real capture then a swap or a clear), `gestures` (real
  keys: each gesture, combinations, a context or action disabled, a request, a rebind and the
  focus-loss reset mid-gesture, the swap on a copy made by hand, `Destroy`, `Fire`/`Tap`, bad
  options) and `readable-errors` (shared: the runtime's sentences are the compile errors'), and
  `tests/type-rules/features-type-rules.ts` (the API's types, and each sentence pinned through
  `CheckBindings`/`CheckContexts`).
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
| `ReleasedThreshold = 0.8` with `PressedThreshold` 0.5; then `PressedThreshold = 0.9` | reads 0.5 (clamped when read, to `PressedThreshold`); then 0.8: the stored value was kept. `PressedThreshold` is never clamped |
| `Enum.KeyCode.FromName` | `"Space"` → Space; `"Unknown"` → `None`; `"Nope"` → `nil`, no error |
| `Workspace.AuthorityMode`, `Workspace.SignalBehavior` from a script | not readable |
| `workspace.Terrain:CanSetNetworkOwnership()` from game scripts | Server Authority, both realms: `false, Can not call Network Ownership API when workspace.AuthorityMode = Enums.AuthorityMode.Server.`; otherwise client `false, Network Ownership API can only be called from the Server.`, server `false, Network Ownership API cannot be used on Terrain` |
| `UserInputService:CreateVirtualInput()` from game scripts in Studio | a `VirtualInput` on the client and the server; IAS treats its input as hardware, also with the window in the background |
| `VirtualInput:SendKey` with gamepad KeyCodes | reaches UIS as Keyboard input, never IAS gamepad bindings; `DPadUp`, `ButtonStart`, `Escape` throw (reserved by CoreGui) |
| `SignalBehavior = Immediate` (set on Workspace by the project's patch; 2026-10-02) | a BindableEvent's handler, IAS's `Pressed` after a Scriptable binding's `Fire`, and a handle's `Pressed`/`Released` all run inside the `Fire` call; every test passes under both modes |
| Server Authority: the stand-in swap with a real key held, then released, then tapped (2026-10-02, `hunter-r1-real`) | once, IAS sent the copy's `Released` twice in a row (handle events `PRPRR`); the same test passed in the full runs before and in 5 runs right after. The handle now passes a repeated edge on once (§6) |
| Typing in the TextChatService chat bar (a CoreGui TextBox), as `GetFocusedTextBox` and `TextBoxFocusReleased` see it (hunts HC3, HC4, 2026-10-02) | not measured: the test place runs LegacyChatService and Slash focuses no TextBox there. If the chat bar isn't seen, a `Cancel` key typed into chat would cancel a capture |
| `StudioDeviceSimulatorService:SetDeviceAsync("iphone_14")` (edit realm, plugin level) before play | `PreferredInput = Touch`; `VirtualInput` mouse events arrive as touch (`TouchStarted`, `TouchPosition`, `TouchDelta`, `UIButton` taps, `UIModifier`); restore with `"default"` |
| Displays turned off during a play session | 0 render steps a second, Heartbeat 240 Hz; minimized: about 60 fps |
| A real key held when a TextBox takes focus, `ResetOnFocusLoss: false` (2026-10-01) | the action stays pressed while the TextBox has focus; the key-up comes as `gameProcessed` and releases it. `TextBox:ReleaseFocus()` lands a frame or two later: a key pressed at once still goes to the TextBox |
| `UserInputService.InputBegan` for a key bound in a sinking IAS context (2026-10-01) | `gameProcessed` is `false`: `Capture` takes keys already in use |
| `MouseWheel` on the `UiNavigation` preset's `Scroll` (`ClampMagnitudeToOne` left at its default) and on an unclamped binding, one notch (2026-10-01) | the same value, about the frame rate: the clamp ignores a single-key source. `MouseDelta` with `Scale 0.02`, `Vector2Scale (1, -1)`: scaled and flipped, not clamped |
| `VirtualInput:SendMouseDelta` (2026-10-01) | throws `cursor is not locked` until a frame after `MouseBehavior` reads `LockCenter`; in a window without focus the cursor never locks, and it keeps throwing |
| A Studio test window during a run (2026-10-01) | may receive `WindowFocusReleased` (the user working in another window), which the focus-loss reset answers by releasing held actions; VirtualInput input never focuses the window |
| Server Authority: client-made Scriptable binding under a server-made action | drives it; the server's `GetState`, `Pressed`, `StateChanged`, `BindToSimulation` all see the state |
| Server Authority: client disables the context while a binding holds the action | client `false`; the server keeps `true` (its `Enabled` stays `true`); re-enabled, the client is `true` again |
| Server Authority: client toggles the action's `Enabled` while held | the same: the server keeps the value, the client's comes back |
| Server Authority: a Scriptable binding fires the held value then the value at rest, in one frame, before a disable, an `Enabled` toggle, or its own `Destroy` | released on the client and the server, one `Released`, no extra `Pressed` |
| Server Authority: that pair fired while the context is disabled | ignored; the state comes back on re-enable |
| Server Authority: `Fire(true)` then the context disabled, in one frame | the server gets the press and keeps it; the client's comes back on re-enable |
| Server Authority: `GetState()` after a `Fire` on the server's copy | the fired value shows on the next simulation step |
| Server Authority: the server's copy of a context (or an action) is disabled on the server; the client enables its own and fires `true` through a Scriptable binding | the client's state is `true`; the server's stays `false`, while an action of an enabled context and action beside it reaches the server |
| `HttpService:JSONDecode` of `[` nested 300 deep (edit and play sessions), in `pcall` | the Studio process ends; 100 and 200 deep decode |
| A Studio play window that renders nothing: what fires between two Heartbeats, over 600 | usually `PreAnimation`, `PreSimulation`, `PostSimulation`; 9 to 87 ticks have only `Heartbeat` (the per-frame snapshot skips them; tests count frames by `PreAnimation` or a render step, since a window that renders may render in such a tick, and the snapshot then runs there) |
| Local context: a binding fires the value it already holds | ignored; after an action `Enabled` toggle it counts again |
| PlayerModule contexts | legacy scripts: none; IAS scripts: `StarterPlayer.PlayerModule.InputContexts`; Server Authority: `player.InputContexts` |
| A destroyed instance's `Parent` | writing `nil` (its value) succeeds; writing an instance errors `The Parent property of X is locked`; a live instance made its own parent errors `Attempt to set X as its own parent`; connecting to a destroyed instance's events works and reports `Connected` |
| Server Authority: which `CameraContext` the CameraModule tunes | `StarterPlayer.PlayerModule.InputContexts`: its `CameraRotationAction` bindings (`MouseBinding`, `TrackpadBinding`, `GamepadBinding`, `MicroGamepadBinding`) had `Scale` 0.36; the player's copy keeps 1 |
| A real key held, its binding's `KeyCode` changed; or another binding of the action rebound; or a modifier added; or a composite direction changed while its held key stays (2026-10-01, local context) | released at once, one `Released`; the old key's release changes nothing; the key counts again once pressed again |
| The same under the player, in a Server Authority place (a context the client made in `LocalPlayer`, standing in for the server's copy) | `Released` then `Pressed`: stays held after the key comes up, until the new keys are pressed and released |
| The same in a place without Server Authority: a context in `ReplicatedStorage`, one the client made in `LocalPlayer`, and the server's copy under the player (hunt round 3, 2026-10-01) | one `Released`, state `false`, nothing stuck after the key comes up: under the player is a local context there |
| A Scriptable binding holds `true`, a key binding of the action rebound (2026-10-01) | local: released, and the next `Fire(true)` presses again; under the player: stays held, and a later `Fire(false)` on that binding is ignored |
| Under the player: a pair (held value, value at rest) on a temporary Scriptable binding, before or after the key change (2026-10-01) | before: works when the held key left the binding, undone (held again, stuck) when it stays in it; after, with the value read before the change: released in every case above, one `Released`; an `Enabled` toggle adds nothing, and alone doesn't release. On a local context (also under the player without Server Authority) the same pair after the change adds a second `Pressed`/`Released` |
| A binding property written with the value it has; `KeyCode` written `None` and back in one frame; `PressedThreshold` or `Scale` changed on a held binding (2026-10-01) | nothing; released (local) or stuck (under the player); nothing, released with its key, on both |
| An `InputCatcher` (CAS sink, priority 5000) active, a real click or tap on a GuiButton with a `UIButton` binding (hunt, 2026-10-01) | the binding presses its action and `Activated` fires; a `MouseLeftButton` binding and the wheel are blocked |
| `Capture("KeyCode")` on a `Direction1D` binding, a real wheel notch (hunt, 2026-10-01) | ignored, the `KeyCode` stays `None`: the wheel raises `InputChanged`, not `InputBegan` |
| `workspace.Terrain:CanSetNetworkOwnership()` from a `ReplicatedFirst` LocalScript before `game.Loaded` (hunt, 2026-10-01) | errors: `Terrain` is `nil`; once loaded, the `AuthorityMode` message |
| A real click or tap on a GuiButton with `Active = false`, `Interactable = false` or `Visible = false`, with a `UIButton` binding, with and without an `InputCatcher` (hunt round 2, 2026-10-01) | `Active = false`: `Activated` doesn't fire, the binding still presses its action; `Interactable = false` or `Visible = false`: the binding doesn't press it |
| A real key holds an action, its binding destroyed: a Bool (a template's extra on the server's copy, in places without Server Authority) and a Direction2D (composite `W` under an adopted action) (hunt round 4, 2026-10-01) | the action stays held after the key comes up, with no `Released`; an `Enabled` toggle releases it |
| A real key (or a Scriptable binding) holds an action of a local context, and a binding is added to it: an `AttachButton` UIButton binding, a second `Create`'s slot, a Scriptable binding (label hunt HL4-5, 2026-10-03, every project) | released at once, one `Released` as the binding is parented; the key, still down, holds it again only once pressed again. A pair fired on a Scriptable binding made in that frame then presses and releases it once more (`R P R`, hunt HL4-3) |
| The same under the player in a Server Authority place: the server's copy, and a context the client made in `LocalPlayer` (hunt HL4-4) | `Released` then `Pressed`: held on the client and the server after the key comes up; the pair after the add (value read before it, then the value at rest) releases it, once |
| On the server's copy, a key holding `Jump`, the first `Fire(false)` (it makes `JumpScript`) without that pair (2026-10-03, `authority`) | `P`, `+JumpScript`, `R P`: held on the client and the server after the key comes up; the `Fire(false)` on the new binding changes nothing. A first `Fire(true)` there holds it until a `Fire(false)`, which releases both sides |
| Under Immediate signals, a listener that fires a Scriptable binding while the swap releases the stand-in's held values (hunt HL4-2) | its value lands on the stand-in; a binding moved to the copy counts its next `Fire` again, whatever it held before the move |
| Studio simulating the iPhone 14 (landscape): `GetGuiInset()`, the camera's viewport, ScreenGuis by `ScreenInsets` and `IgnoreGuiInset`, and where taps sent with `VirtualInput` land (hunt round 4, 2026-10-01) | inset (0, 58); viewport 749 x 368; `ScreenInsets = None` with `IgnoreGuiInset` at (-47, -58), 843 x 389 (the whole screen), every other setting at x = 0 (`TopbarSafeInsets`: 164); taps sent at (100, 150), (400, 150), (700, 300) land at `InputObject.Position` (53, 92), (353, 92), (653, 242): sent minus (47, 58). `GuiService:GetScreenResolution()` needs RobloxScript |
| The play session's server calls `http://127.0.0.1:47110` (the virtual-pad service) with HttpService (P1, 2026-10-03) | it reaches it: 3 ms from the server, about 0.2 s a call from the client through a RemoteFunction |
| The virtual pad plugged in, with no input (2026-10-03, `default`, `ias`, `touch`) | `GamepadConnected` (Gamepad1), and `PreferredInput` switches to `Gamepad` within 0.3 s; unplugging switches back as fast. Under the simulated phone, after a tap, it stays `Touch` |
| An empty InputBinding (no keys) beside bound ones (P3, 2026-10-03) | IAS never prefers it: empty `Gamepad`/`Touch` bindings beside a Space binding change nothing for `PreferredBinding` or an `InputActionLabel`; an empty `Touch` binding doesn't beat a `UIButton` binding under the simulated phone (the UIButton binding is preferred; its label reads `None`). A Space binding's label reads `" "` |
| Touch injected through Windows (`InitializeTouchInjection`, the virtual-pad service's experimental `/touch`) | reaches Studio as `MouseButton1` and `MouseMovement`, never as touch; touch stays on the device simulator and VirtualInput |
| The virtual pad's buttons (2026-10-03, Steam closed, Studio's run window focused; every project) | `InputBegan` with `Position.Z` 1 and `InputEnded` with 0, `UserInputType` `Gamepad1` |
| The virtual pad's triggers (same) | `InputChanged` at every change, `Position.Z` raw (no deadzone); `InputBegan` only at 1 (none at 0.98); `InputEnded` only back at 0 (none at 0.02), also after a pull that never reached 1. A trigger's first move after the pad is plugged in, from rest to about 0.45 to 0.6, raises nothing (each trigger, every time; 0.05, 0.3, 0.8 and 1 arrive, and later moves into that range do; cause unknown) |
| The virtual pad's sticks (same) | `InputChanged` only (`UserInputState.Change`), `Position` raw, `y` positive up; never `InputBegan` or `InputEnded` |
| `gameProcessed` for the virtual pad (same) | under the legacy player scripts `ButtonA` and `Thumbstick1` arrive game-processed (the ControlModule's CAS sink), and IAS bindings on them don't fire; nothing else does, the right stick and the triggers included. Under the IAS player scripts nothing arrives game-processed, and IAS bindings on `ButtonA`, `Thumbstick1` and `Thumbstick1Up` fire |
| IAS bindings on the virtual pad (same) | sticks: radial deadzone 0.1, rescaled (raw 0.3 reads 0.222, 0.6 reads 0.556); triggers: linear 0.1, rescaled (raw 0.6 reads 0.556); a Bool on `ButtonR2` pressed at raw 0.561 and released at 0.251; a Bool on `Thumbstick1Up` pressed by a move to raw 0.6 and released by one to 0.15 |
| Not measured yet: the virtual pad with Studio's window unfocused | the pad runs so far had the run's window focused |
| `UserInputService:GetStringForKeyCode` for every KeyCode (2026-10-03, `default` and `touch`, a US keyboard layout) | a character key's character: `Space` " ", letters and digits themselves, punctuation (`Comma` ","), a shifted symbol its base key (`Hash` "3", `At` "2", `Plus` "=", `Colon` ";"), `KeypadMinus` "-", `KeypadPlus` "+", `Print` "*"; every other key its enum `Name` (`None`, `Return`, `LeftControl`, `KeypadZero`, `F1`, `Up`, `ButtonA`, `DPadUp`, `Thumbstick1`, `Thumbstick1Up`, `MouseLeftButton`, `MouseWheel`, `MouseDelta`, `TouchPosition`, `ButtonCenter`...); never "" |
| `PreferredInput` and VirtualInput (2026-10-03) | under the simulated phone: `Touch` after a tap; a key press (also `ButtonX`, sent as a key) switches it to `KeyboardAndMouse`, a tap back to `Touch`, its property signal firing once per change; under `default` keys, clicks and `ButtonX` leave it `KeyboardAndMouse` |
