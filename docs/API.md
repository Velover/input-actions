# API reference

```ts
import { InputActions, MouseController, EMouseLockAction, InputCatcher, RawInputHandler } from "@rbxts/input-actions";
```

- [InputActions](#inputactions)
  - [Builders](#builders) · [Schema](#schema) · [Create](#create) · [Server](#server) ·
    [IsServerAuthority](#isserverauthority) · [SanitizeBindings](#sanitizebindings) ·
    [Presets](#presets) · [Types](#types)
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
[Get-or-create](Introduction.md#get-or-create). Warns once when the schema marks contexts
`ServerAuthority: true` in a place that doesn't run Server Authority
([`IsServerAuthority()`](#isserverauthority) is `false`): their state would never reach the server.

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
- `ProvideToPlayers`, like `Create`, warns once when the schema marks contexts `ServerAuthority: true`
  and [`IsServerAuthority()`](#isserverauthority) is `false`.

See [Server Authority](Advanced.md#server-authority).

### IsServerAuthority

```ts
InputActions.IsServerAuthority(): boolean | undefined
```

Either realm. Whether the place runs Server Authority (`Workspace.AuthorityMode = Server`), which
scripts can't read directly. It reads the reason `workspace.Terrain:CanSetNetworkOwnership()` gives:

| Realm | Under Server Authority | Otherwise |
| --- | --- | --- |
| client | `Can not call Network Ownership API when workspace.AuthorityMode = Enums.AuthorityMode.Server.` | `Network Ownership API can only be called from the Server.` |
| server | the same message | `Network Ownership API cannot be used on Terrain` |

`true` when the reason mentions `AuthorityMode`; `false` for the two messages of the other mode;
`undefined` for anything else: the call succeeded or threw, or Roblox reworded the message. On the
client the call throws until the game has loaded (`workspace.Terrain` is `nil` before
`game.Loaded`), so ask after it, as `Create` does. Best-effort: it depends on that wording, and an
unknown message gives `undefined` rather than a guess. The first `true` or `false` is kept for the
session; `undefined` is not, so it asks again next time. Never throws or yields. Besides the
warnings of `Create` and `ProvideToPlayers`, the package reads it before releasing an action on the
server: with `false` it sends the server no release, since the server's copy is then a local context,
released on the client as any other. See
[Is Server Authority on?](Advanced.md#is-server-authority-on).

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
| `InputActions.BindingHandle<A>`, `ScriptableBindingHandle<A>` | binding handles (`BindingHandle` of a Bool or Direction1D action adds `CaptureChord`) |
| `InputActions.ChordBindingHandle<A>` | a binding handle with `CaptureChord`, for helpers generic over `A extends Bool | Direction1D` (a `BindingHandle<A>` of a generic `A` doesn't resolve to it) |
| `InputActions.ContextHandle<C>` | a context handle |
| `InputActions.Handle<S>` | what `Create` returns |
| `InputActions.ServerHandle<S>`, `ServerAction<A>` | what `ForPlayer` returns |
| `InputActions.ContextSchema`, `InputSchema<S>`, `ActionDefinition<A, B, TP>`, `ActionOptions` | schema data |
| `InputActions.ActionValue<A>` | `boolean`, `number`, `Vector2`, `Vector3` or `Vector2` |
| `InputActions.BindingShape<A>`, `BindingData<A>` | what `Set` takes and `Get` returns |
| `InputActions.CaptureSlot<A>`, `CaptureOptions` | `Capture`'s arguments |
| `InputActions.Chord`, `ChordCaptureOptions` | what `CaptureChord` passes its callback, and its options |
| `InputActions.ImportResult`, `SkippedBinding` | what `ImportBindings` returns |
| `InputActions.CreateOptions`, `ProvideOptions`, `ForPlayerOptions` | options |
| `InputActions.ButtonKey`, `MouseButtonKey`, `AxisKey`, `StickKey`, `Delta1DKey`, `Delta2DKey`, `PositionKey`, `BoolKey`, `Direction1DKey`, `Direction2DKey`, `CompositeKey`, `ModifierKey` | the [key groups](#key-groups) |

## Handles

### Root handle

What `Create` returns: one property per context, by name, plus:

| Member | |
| --- | --- |
| `BindingsChanged: RBXScriptSignal<(path: string) => void>` | a binding changed through `Set`/`Reset`/`Clear`/`Capture`/`CaptureChord`, an import or a reset; `path` is `Context/Action/Slot` |
| `ExportBindings(): string` | the saved rebinds of every context ([format](Advanced.md#saving-keybinds)) |
| `ImportBindings(json): { Applied; Skipped }` | resets to the defaults, then applies the save (a binding that ends as it was isn't touched); never throws |
| `ResetBindings()` | every binding back to its defaults |
| `Destroy()` | disconnects, releases what it held, destroys what it created once no other handle uses it; adopted instances stay (adopted bindings get their defaults back); later calls on the handles change nothing; under Deferred signals, an event fired before it and not delivered yet still arrives. On an action another root handle still uses, it releases only what it held itself, and the action when bindings only it had (its buttons, its own slots) go while the action is held and doesn't show the last value the other handles fired (see [Get-or-create](Advanced.md#get-or-create-in-detail)) |

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
| `WhenLinkedToServer(callback: (context: InputContext) => void): () => void` | calls `callback` with the server's copy at once (in the caller's thread) when the handle wraps it already, else once at the swap; the function (or `Destroy`) cancels a call still to come |

The handles' signals (`StateChanged`, `Pressed`, `Released`, `EnabledChanged`, `BindingsChanged`)
are the package's own: they forward from whichever instance a handle wraps, so they keep working
across that swap. See [Server Authority](Advanced.md#server-authority).

### Action handle

All action types:

| Member | |
| --- | --- |
| `Instance: InputAction`, `Name: string`, `Type: Enum.InputActionType` | `Instance` is the action it wraps now |
| `GetState(): V` | the current value (`boolean`, `number`, `Vector2`, `Vector3`) |
| `StateChanged: RBXScriptSignal<(value: V) => void>` | forwards the IAS signal; never repeats the value it passed on last (the Server Authority swap can bring such a repeat, which is dropped) |
| `Fire(value: V)` | drives the action through a Scriptable binding `<Action>Script`, made on first use |
| `SetEnabled(enabled)`, `IsEnabled()` | `InputAction.Enabled`; disabling resets the state (on the server too, under Server Authority) |
| `GetPreferredBinding(): InputBinding \| undefined` | `InputAction.PreferredBinding` |
| `AttachLabel(label: InputActionLabel): () => void` | points the label at the action, which then shows its keybind; it follows the Server Authority swap. A label is on one action at a time: the last `AttachLabel` takes it over. The function, destroying the label, or `Destroy` lets go and clears `label.InputAction` (unless it was pointed elsewhere); once the label was taken over, they leave it alone. See [Keybind labels](Advanced.md#keybind-labels) |
| `Bindings` | the binding handles, by slot name |

Bool actions add:

| Member | |
| --- | --- |
| `Pressed`, `Released: RBXScriptSignal<() => void>` | forward the IAS signals; they always alternate (a repeat of the last one, which IAS can send on a Server Authority copy, is dropped) |
| `IsPressed(): boolean` | |
| `Tap()` | `Fire(true)`, then `Fire(false)` on the next frame (on a Server Authority context, once the press shows in the state, so the server sees it) |
| `AttachButton(button: GuiButton): () => void` | adds a UIButton binding `<Action>UIButton<n>`; the function (or destroying the button) removes it. A button destroyed already gets none. Adding the binding releases the action if it is held (IAS resets an action's bindings when one is added; see [IAS behaviours to know](Advanced.md#ias-behaviours-to-know)) |

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
| `Capture(slot, callback, options?): () => void` | waits for the next legal key for `slot` that begins (`UserInputService.InputBegan`: keys, buttons, mouse buttons, taps; never the wheel, mouse movement or a drag), applies it, calls `callback(key)`; `options.Cancel` keys stop it |
| `CaptureChord(callback, options?): () => void` | Bool and Direction1D bindings only. Waits for up to three keys held together and settles when the first comes up (or when `options.Timeout` seconds run out, with the keys held then): the last key down is `KeyCode`, the ones before it the modifiers, in order. Applies it in one write and calls `callback(chord)`; `callback(undefined)` when it ends with nothing applied (a `Cancel` key, or the timeout). See [Capturing a chord](Advanced.md#capturing-a-chord) |

Only what changes is written. A change to a binding's keys while its action is held releases the
action, whatever holds it, on the server too under Server Authority; a change that leaves the keys
as they are (a threshold, the same key) leaves it held. See [Rebinding](Advanced.md#rebinding).

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

IAS reads `ReleasedThreshold` as at most `PressedThreshold`, and keeps the value written:
`Set({ ReleasedThreshold: 0.8 })` on a binding whose `PressedThreshold` is 0.5 reads (and `Get()`
returns) 0.5 until `PressedThreshold` is raised; after `Set({ PressedThreshold: 0.9 })` it reads 0.8.
The package writes it this way:

- `Set` and the schema store the `ReleasedThreshold` they name, even where it reads as
  `PressedThreshold`. One they don't name keeps the value stored, so `Set({ PressedThreshold })`
  never writes the clamped reading over it.
- `Reset`, `ResetBindings`, an import and `Destroy` (for adopted bindings) give the binding what its
  defaults read: `PressedThreshold` first, then `ReleasedThreshold` when the binding would read
  otherwise. A value stored above the default `PressedThreshold` (a designer's 0.8 under 0.5) is
  kept when the defaults read it as 0.5.
- A save holds what the binding reads.

- The Delta1D and Delta2D keys (`MouseWheel`, `MouseDelta`, `TouchDelta`, trackpad pan and pinch)
  read as **rates**: the amount over that frame's time, for one frame, then 0. Multiply by the
  frame's delta time. `Scale` and `Vector2Scale` apply to them; `ClampMagnitudeToOne` doesn't.
- Thumbstick and trigger deadzones are fixed (radial 0.1 with rescaling on sticks, linear 0.1 on
  triggers); `PressedThreshold` applies after them.
- A key with `PrimaryModifier`/`SecondaryModifier` doesn't block other bindings of the plain key.
  See [IAS behaviours to know](Advanced.md#ias-behaviours-to-know).

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
