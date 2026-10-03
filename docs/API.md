# API reference

```ts
import { InputActions, MouseController, EMouseLockAction, InputCatcher, RawInputHandler } from "@rbxts/input-actions";
```

- [InputActions](#inputactions)
  - [Builders](#builders) · [Schema](#schema) · [Create](#create) · [Server](#server) ·
    [IsServerAuthority](#isserverauthority) · [SanitizeBindings](#sanitizebindings) ·
    [PreferredDevice](#preferreddevice) · [PreferredDeviceChanged](#preferreddevicechanged) ·
    [Presets](#presets) · [Types](#types)
- [Handles](#handles): [root](#root-handle) · [context](#context-handle) · [action](#action-handle) ·
  [binding](#binding-handle) · [server](#server-handles)
- [Binding shapes](#binding-shapes) · [Keys per device](#keys-per-device) · [Key groups](#key-groups)
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

- `bindings`: a record of name to binding. A binding with keys (a bare key or an object shape) is
  named after its device, `KeyboardAndMouse`, `Gamepad` or `Touch`, and takes only that device's
  keys ([Keys per device](#keys-per-device)); any other name takes only `InputActions.Scriptable`
  (a binding driven only by `Fire`). See [Binding shapes](#binding-shapes). Unknown properties,
  keys the action type can't use, another device's keys, a key binding under another name and a
  Scriptable under a device's name are compile errors. Every action gets the three device bindings
  at `Create`, unbound when left out here.
- **The compile errors say why**, in the words of the runtime's messages: what a refused binding is
  checked against is a sentence, so the error ends on it (see
  [Readable compile errors](#readable-compile-errors)).
- A device takes one binding, or several through a **namespace**: `{ Main: <binding>, <Extra>:
  <binding>, ... }`, an object with a `Main` key (no binding has that property). `Main` is the
  device's main binding, the one the direct form gives; the others are **extras**, named as you
  like, each with the device's keys and the action type's rules, or `{}` for a binding with no keys
  (`Main` may be `{}` too). An extra can't be named `Main`, after a member of a binding handle
  (`Instance`, `Name`, `Get`, `Set`, `Reset`, `Clear`, `Capture`, `CaptureChord`, `Extras`, and
  the handle's internal ones), after a binding property (`KeyCode`, `Up`... `PressedThreshold`,
  `DisplayName`, `DisplayImage`, `EnumType`), nor contain `/`; no binding of a namespace is
  `InputActions.Scriptable`. See [Several bindings per device](Advanced.md#several-bindings-per-device).
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
as on an option of the wrong type, an action option of the wrong type (`DisplayName` not a string,
`Enabled` or `TrackPrevious` not a boolean: a cast can put anything there), and a `Priority` an
`InputContext` can't hold: it must be a whole number from -2147483648 to 2147483647 (IAS reads
`math.huge`, `NaN` or `2 ** 31` as the lowest priority there is, and 2.5 as 2, without a word).
`Schema` checks the bindings at runtime too (a key binding not
named after a device, a Scriptable under a device's name, another device's key: each named in the
message), and throws on names the handles can't hold: a context named like one of the root
handle's six members, a name with `/`, or a slot whose binding would take the name of one the
package makes itself (`Script`, `UIButton<n>`, `<Action>Script`, `<Action>UIButton<n>`: see
[`Fire`](#action-handle) and `AttachButton`), or two slots `S` and `<Action>S` on one action (both
would find the binding `<Action>S`; the device bindings count, being always there, so a Scriptable
named `JumpTouch` on `Jump` is refused). A device's extra is found as `<Device><Extra>` (or
`<Action><Device><Extra>`), so the same goes for it: a Scriptable named `KeyboardAndMouseArrows`
beside the `KeyboardAndMouse` extra `Arrows` is refused. A namespace is checked as the bindings are,
each binding against its device's keys and each extra's name against the reserved ones, the message
naming `Context/Action/Device/Main` or `Context/Action/Device/<Extra>`. The result is frozen and
creates no instances: require it on both realms.

#### Readable compile errors

What the types refuse in a schema (the builders' bindings, a device's namespace, a context's
options) is checked against a sentence that says why, in the runtime's words, so the error ends on
it:

```
InputActions.Bool({ Gamepad: Enum.KeyCode.Space })
// Type 'Space' is not assignable to type 'Space & "Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys"'.
```

| Written | The sentence |
| --- | --- |
| another device's key, also as a modifier or a direction | `Space is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys` |
| a key the slot never takes | `MouseDelta is not allowed in KeyCode on a Bool action` |
| keys under another name | `Keys is not a device: bindings with keys are named KeyboardAndMouse, Gamepad, Touch; any other binding must be InputActions.Scriptable` |
| `InputActions.Scriptable` under a device | `Gamepad is a device: its bindings hold keys, not InputActions.Scriptable; name a Scriptable binding beside the devices` |
| an extra named after a handle's member, or a binding property | `Get is a member of a binding handle, ...`, `KeyCode is a binding property, not an extra binding: ...` |
| an extra name with `/` | `a/b: an extra binding's name can't contain /` |
| a property the action type lacks (a key there: likely a second binding) | `Alt is not a property of a Bool binding; several bindings of one device go in { Main: <binding>, Alt: <binding> }` |
| `KeyCode` beside a direction | `KeyCode and composite directions can't share a binding` |
| `ResponseCurve` without a thumbstick | `ResponseCurve only applies to a Thumbstick1/Thumbstick2 KeyCode` |
| a misspelt context option | `unknown option ServerAuthorty; a context has ServerAuthority, Priority, Sink, Enabled and Actions` |

A number, a boolean or a string is checked against an object named by the sentence
(`Type '1' is not assignable to type '1 & { readonly "Typo is not a property of a Bool binding": never; }'`).
`Set` on a binding handle keeps TypeScript's own message (the keys it takes, listed): its parameter
isn't generic, so that handles of different devices still compare (`BindingHandle<A, Device>`
takes any of the three), and it checks again at runtime with the sentence.

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

Throws when an existing action's `Type` differs from the schema, when a child named like a
context or action is not an `InputContext`/`InputAction`, and on anything `Schema` refuses, with
its message (a schema made without `Schema`: a misspelt option, an option of the wrong type, a
`Priority`, a name, a binding). It checks these
before it changes anything: a `Create` that throws leaves the tree as it was, and makes no
`ReplicatedStorage.Inputs`. A misspelt option in `{ Contexts }` written without `Schema` is a
compile error too, as in `Schema`. See
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
entries. Works without instances, on either realm. It keeps the device paths of every action, also
those the schema leaves out, and the paths of the extras the schema declares
(`Context/Action/Device/Extra`). A save nested deeper than a save can be is refused before it is decoded
(JSON nested a few hundred levels deep crashes `HttpService:JSONDecode`), so it is safe on what a
client sends. It can't see the client's bindings, and one in the folder or the template wins over
the schema's (a stick the Input Action Manager gave a device the schema leaves out). So a
`ResponseCurve` without a `KeyCode` in its entry stays on a `Gamepad` binding, and the import checks
it against the binding it finds. On a `KeyboardAndMouse` or `Touch` binding it is dropped: they
can't hold a thumbstick.

### PreferredDevice

```ts
InputActions.PreferredDevice(): InputActions.Device // "KeyboardAndMouse" | "Gamepad" | "Touch"
```

Client. `UserInputService.PreferredInput` as the name of the binding that holds that device's keys;
the TV remote (`MicroGamepad`) is `"Gamepad"`. Roblox counts a gamepad as preferred as soon as one
is plugged in, before any of its buttons is pressed. A rebinding menu shows
`action.Bindings[InputActions.PreferredDevice()]`, and has nothing to capture on `"Touch"`. See
[Rebinding](Advanced.md#rebinding).

### PreferredDeviceChanged

```ts
InputActions.PreferredDeviceChanged: RBXScriptSignal<(device: InputActions.Device) => void>
InputActions.PreferredDeviceChanged.Connect((device) => renderMenu(device));
```

Client. Fires with the new device each time `PreferredDevice()` changes: a key pressed after a tap,
a tap after a key, a gamepad plugged in or out. `MicroGamepad` and `Gamepad` both read
`"Gamepad"`, so a switch between them fires nothing, and it never fires the same device twice in a
row. It listens to `UserInputService.PreferredInput` from the first time it is read, once for the
game, and it is the same signal on every read. On the server it never fires. Under Deferred
signals it arrives a moment after `PreferredInput` changed: read the device from its argument.

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
| `InputActions.Device` | `"KeyboardAndMouse" \| "Gamepad" \| "Touch"`: a device, and the name of its binding |
| `InputActions.CapturableDevice` | `"KeyboardAndMouse" \| "Gamepad"`: the devices with keys to press |
| `InputActions.BoolAction` | any Bool action handle, for helpers in your project |
| `InputActions.Action<A>` | any action handle of type `A` |
| `InputActions.CaptureAction` | any Bool or Direction1D action handle: the ones with the one-field `Capture` and `CaptureChord` |
| `InputActions.ActionHandle<D>` | the handle of an action definition |
| `InputActions.BindingHandle<A, D>` | the handle of device `D`'s binding: by default (`D` = `CapturableDevice`) the keyboard-and-mouse or gamepad one, with `Capture`, and on Bool and Direction1D actions `CaptureChord`; `BindingHandle<A, "Touch">` has no captures; `BindingHandle<A, Device>` is what any of the three is assignable to (its `Set` takes any device's keys, checked at runtime) |
| `InputActions.ScriptableBindingHandle<A>` | a Scriptable binding's handle |
| `InputActions.ExtraBindings<H>` | what a binding handle's `Extras()` returns: `{ readonly [name: string]: H \| undefined }`, the device's extras by name, `H` their handles' type |
| `InputActions.ChordBindingHandle<A, D>` | a binding handle with `CaptureChord`, for helpers generic over `A extends Bool | Direction1D` (a `BindingHandle<A>` of a generic `A` doesn't resolve to it) |
| `InputActions.ContextHandle<C>` | a context handle |
| `InputActions.Handle<S>` | what `Create` returns |
| `InputActions.ServerHandle<S>`, `ServerAction<A>` | what `ForPlayer` returns |
| `InputActions.ContextSchema`, `InputSchema<S>`, `ActionDefinition<A, B, TP>`, `ActionOptions` | schema data; `InputSchema<S>` refuses a misspelt context option, and a helper generic over it can pass it to `Create`, `ForPlayer`, `ProvideToPlayers` and `SanitizeBindings` (`ForPlayer` then returns `ServerHandle<S>`) |
| `InputActions.ActionValue<A>` | `boolean`, `number`, `Vector2`, `Vector3` or `Vector2` |
| `InputActions.BindingShape<A, D>`, `BindingPart<A, D>`, `BindingData<A, D>` | what `Set` takes (a shape, or part of an object shape without its key) and `Get` returns, for device `D` (any device's by default). `BindingData` and `BindingPart` are the same forms, so `Set(binding.Get())` gives a binding back what it had; a device with no key for the action type (the gamepad's ViewportPosition binding) has the display only |
| `InputActions.CaptureSlot<A>`, `CaptureOptions` | `Capture`'s arguments |
| `InputActions.Chord`, `ChordCaptureOptions` | what `CaptureChord` passes its callback, and its options |
| `InputActions.ImportResult`, `SkippedBinding` | what `ImportBindings` returns |
| `InputActions.BindingConflict`, `ConflictPair` | what `FindConflicts(binding)` and `FindConflicts()` list |
| `InputActions.TapOptions`, `DoubleTapOptions`, `HoldOptions`, `LongPressOptions` | the [gestures](#action-handle)' options |
| `InputActions.CreateOptions`, `ProvideOptions`, `ForPlayerOptions` | options |
| `InputActions.ButtonKey`, `MouseButtonKey`, `AxisKey`, `StickKey`, `Delta1DKey`, `Delta2DKey`, `PositionKey`, `BoolKey`, `Direction1DKey`, `Direction2DKey`, `CompositeKey`, `ModifierKey` | the [key groups](#key-groups) |
| `InputActions.KeyboardAndMouseKey`, `GamepadKey`, `TouchKey` | the [keys per device](#keys-per-device) |

## Handles

### Root handle

What `Create` returns: one property per context, by name, plus:

| Member | |
| --- | --- |
| `BindingsChanged: RBXScriptSignal<(path: string) => void>` | a binding changed through `Set`/`Reset`/`Clear`/`Capture`/`CaptureChord`, an import or a reset; `path` is `Context/Action/Slot`, and `Context/Action/Device/Extra` for a device's extra |
| `ExportBindings(): string` | the saved rebinds of every context ([format](Advanced.md#saving-keybinds)) |
| `ImportBindings(json): { Applied; Skipped }` | resets to the defaults, then applies the save (a binding that ends as it was isn't touched); never throws |
| `ResetBindings()` | every binding back to its defaults |
| `FindConflicts(binding): BindingConflict[]` | the other bindings of `binding`'s device, in every context, that share a key with it, by path: `{ Binding, Path, Key, Keys, Identical }` (see [Conflicts](Advanced.md#conflicts)) |
| `FindConflicts(): ConflictPair[]` | every pair of bindings of one device that share a key, each pair once: `{ Bindings, Paths, Key, Keys, Identical }` |
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
| `ExportBindings()`, `ImportBindings(json)`, `ResetBindings()`, `FindConflicts(binding?)` | as on the root, for this context's bindings |

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
| `Fire(value: V)` | drives the action through a Scriptable binding `<Action>Script`, made on first use. Made while the action is held, that binding releases it before the value lands, as `AttachButton` does (see [IAS behaviours to know](Advanced.md#ias-behaviours-to-know)) |
| `SetEnabled(enabled)`, `IsEnabled()` | `InputAction.Enabled`; disabling resets the state (on the server too, under Server Authority) |
| `GetPreferredBinding(): InputBinding \| undefined` | `InputAction.PreferredBinding` |
| `Describe(device?): string` | the keybind of `device` as text: its main binding's `Describe()` (`"Space"`, `"Ctrl + S"`, `"W / A / S / D"`, `""` when it has no key). By default the device the player uses (`InputActions.PreferredDevice()`); a name that isn't a device throws |
| `AttachLabel(label: InputActionLabel): () => void` | points the label at the action, which then shows its keybind; it follows the Server Authority swap. A label is on one action at a time: the last `AttachLabel` takes it over. The function, destroying the label, or `Destroy` lets go and clears `label.InputAction` (unless it was pointed elsewhere); once the label was taken over, they leave it alone. See [Keybind labels](Advanced.md#keybind-labels) |
| `Bindings` | the binding handles: `KeyboardAndMouse`, `Gamepad` and `Touch` always (unbound when the schema leaves one out), each its main binding's with the extras its schema declares as properties (`Bindings.KeyboardAndMouse.Arrows`), and the schema's Scriptable slots by name |

Bool and Direction1D actions add (the others don't have them, and they throw if called anyway):

| Member | |
| --- | --- |
| `Capture(callback: (key, device) => void, options?): () => void` | a one-field rebind: waits for the next key a `KeyboardAndMouse` or `Gamepad` binding of the action can hold in its `KeyCode`; the key's device picks the binding, which becomes that key alone (its composite directions and modifiers give way, as with `CaptureChord` given one key: Ctrl+S captured with F is F), then `callback(key, device)`. Touch input is ignored, and so is a key no binding of its device can take. Options and rules as for the binding's `Capture`, which keeps the modifiers |
| `CaptureChord(callback: (chord, device) => void, options?): () => void` | as the binding's `CaptureChord`, on the binding of the device whose key goes down first; the other device's keys are ignored while any key of the chord is held (no Shift + ButtonA). `callback(undefined, undefined)` when it ends with nothing applied |

`device` is `"KeyboardAndMouse"` or `"Gamepad"`. Both write the device's main binding, never one of
its extras. See [Rebinding](Advanced.md#rebinding).

Bool actions add:

| Member | |
| --- | --- |
| `Pressed`, `Released: RBXScriptSignal<() => void>` | forward the IAS signals; they always alternate (a repeat of the last one, which IAS can send on a Server Authority copy, is dropped) |
| `IsPressed(): boolean` | |
| `Tap()` | `Fire(true)`, then `Fire(false)` on the next frame (on a Server Authority context, once the press shows in the state, so the server sees it) |
| `AttachButton(button: GuiButton): () => void` | adds a UIButton binding `<Action>UIButton<n>`; the function (or destroying the button) removes it. A button destroyed already gets none. Adding the binding releases the action if it is held (IAS resets an action's bindings when one is added; see [IAS behaviours to know](Advanced.md#ias-behaviours-to-know)) |
| `OnTap(callback, { MaxDuration?, WaitForDoubleTap?, Window? }?): () => void` | a press released within `MaxDuration` (0.25 s). With `WaitForDoubleTap`, once `Window` (0.3 s) has passed after it without a second press |
| `OnDoubleTap(callback, { Window?, MaxDuration? }?): () => void` | at the second press, within `Window` (0.3 s) after a tap (released within `MaxDuration`, 0.25 s) |
| `OnHold(callback, { Duration, Progress?, Cancelled? }): () => void` | once a press has lasted `Duration`, while still held; `Progress(fraction)` each frame while held, from 0 to 1; `Cancelled()` (after `Progress(0)`) when it ends first |
| `OnLongPress(callback: (heldFor) => void, { Duration }): () => void` | on the release of a press that lasted at least `Duration`, with the seconds held |

The gestures' functions stop them, and so does `Destroy`. Durations are positive, finite seconds
(anything else throws). A release the package or IAS makes (the context or the action disabled,
the focus-loss reset, a rebind or a binding added while held, the Server Authority swap) ends a
gesture without completing it. See [Gestures](Advanced.md#gestures).

Actions with `TrackPrevious: true` add `GetPrevious(): V` and `HasChanged(): boolean`; tracked Bool
actions also add `IsJustPressed()` and `IsJustReleased()`. See [TrackPrevious](Advanced.md#trackprevious).

### Binding handle

A device's binding (`KeyboardAndMouse`, `Gamepad`, `Touch`), its main one or an extra:

| Member | |
| --- | --- |
| `Instance: InputBinding`, `Name` | `Name` is the device, an extra's too |
| `Extras(): InputActions.ExtraBindings<H>` | the device's extras its schema declares, by name: the same handles as its properties (`Extras().Arrows === Bindings.KeyboardAndMouse.Arrows`), each typed as the device's handle. A table: read one by name, also on a handle picked by a device at runtime (`Bindings[device].Extras().Alt`), or go through them with `pairs`, in no order. Empty on an extra, and on a device without extras |
| `Get(): BindingData<A, D>` | the binding as plain data in the schema's shape; `{}` when unbound |
| `Describe(): string` | the binding as text: its `DisplayName` when it has one; else its modifiers then its key, joined by `" + "` (`"Ctrl + S"`), or its composite directions in reading order (Up, Left, Down, Right, Forward, Backward) joined by `" / "` (`"W / A / S / D"`; with modifiers, `"Shift + (W / A / S / D)"`); `""` when it has no key. See [Keybinds as text](Advanced.md#keybinds-as-text) |
| `Set(binding: BindingShape<A, D> \| BindingPart<A, D>)` | rebinds; objects merge, so one may leave the key out (`Set({ PressedThreshold: 0.9 })` tunes the key the binding has); throws on what the action type doesn't allow, on another device's key, on a `ResponseCurve` when the binding doesn't end on a thumbstick after the merge, and on a number a float can't hold (beyond ±3.4e38) |
| `Reset()` | back to the binding right after `Create` (unbound when the schema left the device out) |
| `Clear(slot?)` | unbinds: `KeyCode`, composites and modifiers become `None`; with a slot (as for `Capture`), clears only that one |

The `KeyboardAndMouse` and `Gamepad` bindings add (the `Touch` one has none: touch has no keys to
press; they throw if called on it anyway):

| Member | |
| --- | --- |
| `Capture(slot, callback, options?): () => void` | waits for the next key of the binding's device legal for `slot` that goes down (keys, buttons, mouse buttons; on the gamepad also a stick pushed past halfway, as its direction `Thumbstick1Up`..., or the whole stick for a Direction2D `KeyCode`, and a trigger pulled past halfway, both as IAS reads them past its deadzone, so where a binding on them would press; never the wheel, mouse movement or a tap), applies it (a `KeyCode` keeps the binding's modifiers), calls `callback(key)`. Other devices' keys are ignored; `options.Cancel` keys stop it, from any device |
| `CaptureChord(callback, options?): () => void` | Bool and Direction1D bindings only. Waits for up to three keys of the binding's device held together and settles when the first comes up (or when `options.Timeout` seconds run out, with the keys held then): the last key down is `KeyCode`, the ones before it the modifiers, in order. Other devices' keys are no part of it. Applies it in one write and calls `callback(chord)`; `callback(undefined)` when it ends with nothing applied (a `Cancel` key, or the timeout). See [Capturing a chord](Advanced.md#capturing-a-chord) |

Only what changes is written. A change to a binding's keys while its action is held releases the
action, whatever holds it, on the server too under Server Authority; a change that leaves the keys
as they are (a threshold, the same key) leaves it held. See [Rebinding](Advanced.md#rebinding).

A device's **extras** (declared in its namespace) are binding handles of that device with every
member above: its keys only, `Capture` and `CaptureChord` as the device and action type allow
(none on a `Touch` extra), `Reset` to their own defaults. Their instances are named
`<Action><Device><Extra>` (`MoveKeyboardAndMouseArrows`), their paths `Context/Action/Device/Extra`.
See [Several bindings per device](Advanced.md#several-bindings-per-device).

A binding declared `InputActions.Scriptable`: `Instance`, `Name`, `Fire(value: V)`.

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
makes them and `Clear()` produces them. In a device's namespace, `{}` declares one (an Alternate
column a player fills); the direct form takes `{}` only where the shape is all-optional, as before.

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
  triggers); `PressedThreshold` applies after them, so the default thresholds press past a raw push
  of about 0.55 and release under about 0.28 (`InputObject.Position` is the raw value).
- A key with `PrimaryModifier`/`SecondaryModifier` doesn't block other bindings of the plain key.
  See [IAS behaviours to know](Advanced.md#ias-behaviours-to-know).

## Keys per device

Every key belongs to one device, by the key alone (VirtualInput sends gamepad KeyCodes as keyboard
input: they are still the gamepad's). A device's binding takes only its keys, modifiers included.

| Device | Keys |
| --- | --- |
| `Gamepad` | `ButtonA/B/X/Y`, `ButtonL1/R1/L2/R2/L3/R3`, `ButtonSelect`, `DPadLeft/Right/Up/Down`, `Thumbstick1`, `Thumbstick2` and their `Up/Down/Left/Right`, and the TV remote's `ButtonCenter`, `ButtonBack`, `ButtonUp`, `ButtonDown`, `ButtonLeft`, `ButtonRight` (`ButtonStart` is the gamepad's too, but reserved) |
| `Touch` | `TouchPosition` (`Enum.KeyCode.Touch` is its old name), `TouchDelta`, `TouchPinch` |
| `KeyboardAndMouse` | every other key: keyboard keys, mouse buttons, `MouseWheel`, `MouseDelta`, `MousePosition`, `TrackpadPan`, `TrackpadPinch` |

So the `Touch` binding takes `TouchPosition` (Bool, ViewportPosition), `TouchPinch` (Direction1D) or
`TouchDelta` (Direction2D), and has no modifiers or composite directions; a gamepad has no position
(its ViewportPosition binding stays unbound).

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
