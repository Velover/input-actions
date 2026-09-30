# API reference

```ts
import { InputActions, MouseController, EMouseLockAction, InputCatcher, RawInputHandler } from "@rbxts/input-actions";
```

- [InputActions](#inputactions)
  - [Builders](#builders) · [Schema](#schema) · [Create](#create) · [Server](#server) ·
    [SanitizeBindings](#sanitizebindings) · [Presets](#presets) · [Types](#types)
- [Handles](#handles): [root](#root-handle) · [context](#context-handle) · [action](#action-handle) ·
  [binding](#binding-handle) · [server](#server-handles)
- [Binding shapes](#binding-shapes) · [Key groups](#key-groups)
- [MouseController](Components/MouseController.md) · [InputCatcher](Components/InputCatcher.md) ·
  [RawInputHandler](Components/RawInputHandler.md)

## InputActions

### Builders

```ts
InputActions.Bool(bindings?, options?)
InputActions.Direction1D(bindings?, options?)
InputActions.Direction2D(bindings?, options?)
InputActions.Direction3D(bindings?, options?)
InputActions.ViewportPosition(bindings?, options?)
InputActions.Scriptable
```

- `bindings`: a record of slot name to binding: a bare key, an object shape, or
  `InputActions.Scriptable` (a binding driven only by `Fire`). See [Binding shapes](#binding-shapes).
  Unknown properties and keys the action type can't use are compile errors.
- `options`: `{ TrackPrevious?: boolean; DisplayName?: string; Enabled?: boolean }`. `DisplayName`
  and `Enabled` are used when the action is created; an existing action keeps its own. (On the
  server's copy of a Server Authority context, which is always enabled on the server, the client
  gives the action the template's or this `Enabled` the first time: see
  [Server Authority](Advanced.md#server-authority).)
- Returns a frozen action definition. Builders create no instances.

### Schema

```ts
InputActions.Schema(contexts): { readonly Contexts }
```

`contexts` is a record of context name to
`{ ServerAuthority?: boolean; Priority?: number; Sink?: boolean; Enabled?: boolean; Actions }`. The
defaults are the IAS ones (Priority 1000, Sink false, Enabled true). Any other key is a compile error,
and `Schema` throws on it at runtime too (a misspelt `ServerAuthority` would make the context local),
as on an option of the wrong type. `Schema` checks the bindings at runtime too, and throws on names
the handles can't hold: a context named like one of the root
handle's five members, a name with `/`, or a slot whose binding would take the name of one the
package makes itself (`Script`, `UIButton<n>`, `<Action>Script`, `<Action>UIButton<n>`: see
[`Fire`](#action-handle) and `AttachButton`), or two slots `S` and `<Action>S` on one action (both
would find the binding `<Action>S`). The result is frozen and creates no instances: require it on both realms.

### Create

```ts
InputActions.Create(schema, options?): InputActions.Handle<S>
```

Client only (throws on the server). Waits for `game.Loaded`, gets or creates the tree, and returns
the [root handle](#root-handle).

| Option | Default | |
| --- | --- | --- |
| `Folder` | `ReplicatedStorage.Inputs` (created when missing) | where non-Server-Authority contexts are found or created |
| `PlayerFolderName` | `"Inputs"` | the folder under the player holding Server Authority contexts; never `"InputContexts"` |
| `Timeout` | `10` | seconds before it warns that the server's copy of a Server Authority context hasn't arrived (meanwhile the context runs on a local stand-in); it never throws or waits |
| `ResetOnFocusLoss` | `true` | hold every context disabled for one frame on TextBox focus, window focus loss and menu open |

Throws when an existing action's `Type` differs from the schema, or when a child named like a
context or action is not an `InputContext`/`InputAction`. See
[Get-or-create](Introduction.md#get-or-create).

### Server

```ts
InputActions.ProvideToPlayers(schema, options?): () => void
InputActions.ForPlayer(schema, player, options?): InputActions.ServerHandle<S>
```

- `ProvideToPlayers` (server only) puts every `ServerAuthority: true` context into
  `player.<PlayerFolderName>` for each player, now and on `PlayerAdded`, always enabled (the client
  owns `Enabled`). Options: `Folder` (templates; default `ReplicatedStorage.Inputs`),
  `PlayerFolderName` (default `"Inputs"`). Returns a function that stops providing.
- `ForPlayer` returns [server handles](#server-handles). Options: `PlayerFolderName`, `Timeout`
  (default 10 s, then it throws naming the missing contexts).

See [Server Authority](Advanced.md#server-authority).

### SanitizeBindings

```ts
InputActions.SanitizeBindings(schema, json): string
```

Runs the `ImportBindings` checks against the schema alone and returns a save with only the valid
entries. Works without instances, on either realm. A save nested deeper than a save can be is refused
before it is decoded (JSON nested a few hundred levels deep crashes `HttpService:JSONDecode`), so it
is safe on what a client sends.

### Presets

```ts
InputActions.Presets.UiNavigation(options?)
```

A context schema with `Navigate`, `Accept`, `Cancel`, `NextPage`, `PreviousPage` and `Scroll`.
Options: `Priority`, `Sink`, `Enabled`, `ServerAuthority`. See
[UI navigation preset](Advanced.md#ui-navigation-preset).

### Types

| Type | |
| --- | --- |
| `InputActions.BoolAction` | any Bool action handle, for helpers in your project |
| `InputActions.Action<A>` | any action handle of type `A` |
| `InputActions.ActionHandle<D>` | the handle of an action definition |
| `InputActions.BindingHandle<A>`, `ScriptableBindingHandle<A>` | binding handles |
| `InputActions.ContextHandle<C>` | a context handle |
| `InputActions.Handle<S>` | what `Create` returns |
| `InputActions.ServerHandle<S>`, `ServerAction<A>` | what `ForPlayer` returns |
| `InputActions.ContextSchema`, `InputSchema<S>`, `ActionDefinition<A, B, TP>`, `ActionOptions` | schema data |
| `InputActions.ActionValue<A>` | `boolean`, `number`, `Vector2`, `Vector3` or `Vector2` |
| `InputActions.BindingShape<A>`, `BindingData<A>` | what `Set` takes and `Get` returns |
| `InputActions.CaptureSlot<A>`, `CaptureOptions` | `Capture`'s arguments |
| `InputActions.ImportResult`, `SkippedBinding` | what `ImportBindings` returns |
| `InputActions.CreateOptions`, `ProvideOptions`, `ForPlayerOptions` | options |
| `InputActions.ButtonKey`, `MouseButtonKey`, `AxisKey`, `StickKey`, `Delta1DKey`, `Delta2DKey`, `PositionKey`, `BoolKey`, `Direction1DKey`, `Direction2DKey`, `CompositeKey`, `ModifierKey` | the [key groups](#key-groups) |

## Handles

### Root handle

What `Create` returns: one property per context, by name, plus:

| Member | |
| --- | --- |
| `BindingsChanged: RBXScriptSignal<(path: string) => void>` | a binding changed through `Set`/`Reset`/`Clear`/`Capture`, an import or a reset; `path` is `Context/Action/Slot` |
| `ExportBindings(): string` | the saved rebinds of every context ([format](Advanced.md#saving-keybinds)) |
| `ImportBindings(json): { Applied; Skipped }` | resets to the defaults, then applies the save; never throws |
| `ResetBindings()` | every binding back to its defaults |
| `Destroy()` | disconnects, releases what it held, destroys what it created once no other handle uses it; adopted instances stay (adopted bindings get their defaults back); later calls on the handles change nothing. On an action another root handle still uses, it releases only what it held itself (see [Get-or-create](Advanced.md#get-or-create-in-detail)) |

### Context handle

| Member | |
| --- | --- |
| `Instance: InputContext` | the context it wraps now; set `Priority` and `Sink` on it directly |
| `Name: string` | |
| `Actions` | the action handles, by name |
| `SetEnabled(enabled)` | sets the base state |
| `IsEnabled(): boolean` | the effective state |
| `Request(enabled): () => void` | holds the context on or off until the returned function is called; a `false` request wins |
| `EnabledChanged: RBXScriptSignal<(enabled: boolean) => void>` | the effective state changed |
| `ExportBindings()`, `ImportBindings(json)`, `ResetBindings()` | as on the root, for this context's bindings |

Contexts marked `ServerAuthority: true` add:

| Member | |
| --- | --- |
| `IsLinkedToServer(): boolean` | whether the handle wraps the server's copy, or a local stand-in until it arrives |
| `LinkedToServer: RBXScriptSignal<() => void>` | fires once, when the stand-in gives way to the server's copy; never when the copy was there at `Create` |

The handles' signals (`StateChanged`, `Pressed`, `Released`, `EnabledChanged`, `BindingsChanged`)
are the package's own: they forward from whichever instance a handle wraps, so they keep working
across that swap. See [Server Authority](Advanced.md#server-authority).

### Action handle

All action types:

| Member | |
| --- | --- |
| `Instance: InputAction`, `Name: string`, `Type: Enum.InputActionType` | `Instance` is the action it wraps now |
| `GetState(): V` | the current value (`boolean`, `number`, `Vector2`, `Vector3`) |
| `StateChanged: RBXScriptSignal<(value: V) => void>` | forwards the IAS signal |
| `Fire(value: V)` | drives the action through a Scriptable binding `<Action>Script`, made on first use |
| `SetEnabled(enabled)`, `IsEnabled()` | `InputAction.Enabled`; disabling resets the state (on the server too, under Server Authority) |
| `GetPreferredBinding(): InputBinding \| undefined` | `InputAction.PreferredBinding` |
| `Bindings` | the binding handles, by slot name |

Bool actions add:

| Member | |
| --- | --- |
| `Pressed`, `Released: RBXScriptSignal<() => void>` | forward the IAS signals |
| `IsPressed(): boolean` | |
| `Tap()` | `Fire(true)`, then `Fire(false)` on the next frame (on a Server Authority context, once the press shows in the state, so the server sees it) |
| `AttachButton(button: GuiButton): () => void` | adds a UIButton binding `<Action>UIButton<n>`; the function (or destroying the button) removes it. A button destroyed already gets none |

Actions with `TrackPrevious: true` add `GetPrevious(): V` and `HasChanged(): boolean`; tracked Bool
actions also add `IsJustPressed()` and `IsJustReleased()`. See [TrackPrevious](Advanced.md#trackprevious).

### Binding handle

A slot with keys:

| Member | |
| --- | --- |
| `Instance: InputBinding`, `Name: string` | `Name` is the slot name |
| `Get(): BindingData<A>` | the binding as plain data in the schema's shape |
| `Set(binding: BindingShape<A>)` | rebinds; objects merge; throws on what the action type doesn't allow, and on a number a float can't hold (beyond ±3.4e38) |
| `Reset()` | back to the binding right after `Create` |
| `Clear(slot?)` | unbinds: `KeyCode`, composites and modifiers become `None`; with a slot (as for `Capture`), clears only that one |
| `Capture(slot, callback, options?): () => void` | waits for the next legal key for `slot`, applies it, calls `callback(key)`; `options.Cancel` keys stop it |

A slot declared `InputActions.Scriptable`: `Instance`, `Name`, `Fire(value: V)`.

### Server handles

`ForPlayer` returns one property per Server Authority context: `{ Instance, Name, Actions }`. Each
action has `Instance`, `Name`, `GetState(): V` and `StateChanged`; Bool actions add `Pressed` and
`Released`. There are no bindings and no `Fire`.

## Binding shapes

Every binding may set `DisplayName` and `DisplayImage` (an image URI). Every binding except
ViewportPosition may set `PrimaryModifier`/`SecondaryModifier` (Button keys).

| Action type | Bare key / `KeyCode` | Composite directions | Other properties |
| --- | --- | --- | --- |
| Bool | Button, MouseButton, Axis, `TouchPosition` | none | `PressedThreshold`, `ReleasedThreshold` |
| Direction1D | Button, Axis, Delta1D | `Up`, `Down`: Button, Axis | `Scale`, `ClampMagnitudeToOne` |
| Direction2D | Stick, Delta2D | `Up`, `Down`, `Left`, `Right`: Button, Axis | `Scale`, `ClampMagnitudeToOne`, `Vector2Scale`, `ResponseCurve` (Stick only) |
| Direction3D | none | all six (`Forward`, `Backward` too): Button, Axis | `Scale`, `ClampMagnitudeToOne`, `Vector3Scale` |
| ViewportPosition | Position | none | none |

`KeyCode` and composite directions can't share a binding. `UIButton` never appears in a schema:
use `AttachButton`. At runtime an unbound binding (no key at all) is legal: the Input Action Manager
makes them and `Clear()` produces them.

## Key groups

| Group | Keys |
| --- | --- |
| Reserved (never allowed) | `Escape`, `ButtonStart`, `F9`, `F11`, `F12`, `Print` |
| Deprecated (never allowed) | `None` (= `Unknown`), `MouseBackButton`, `MouseNoButton`, `MouseX`, `MouseY` |
| MouseButton | `MouseLeftButton`, `MouseRightButton`, `MouseMiddleButton` |
| Axis (0..1) | `ButtonL2`, `ButtonR2`, `Thumbstick1Up/Down/Left/Right`, `Thumbstick2Up/Down/Left/Right` |
| Stick | `Thumbstick1`, `Thumbstick2` |
| Delta1D | `MouseWheel`, `TrackpadPinch`, `TouchPinch` |
| Delta2D | `MouseDelta`, `TouchDelta`, `TrackpadPan` |
| Position | `MousePosition`, `TouchPosition` |
| Button | every other `Enum.KeyCode`: keyboard keys, gamepad and TV-remote buttons |
