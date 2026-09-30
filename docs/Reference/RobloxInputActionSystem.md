# Roblox Input Action System (IAS): Reference Snapshot

> **Reference snapshot, not a spec.** Compiled on **2026-09-28** for redesigning `@rbxts/input-actions` on top of IAS.
> Engine API from Roblox-Client-Tracker `Full-API-Dump.json` **v0.740.19.7400931**. roblox-ts typings are from local `@rbxts/types@1.0.955`.
> IAS changes often, and several behaviours changed during 2025–2026. Test anything marked **UNVERIFIED** before you depend on it.

**Source tags used below**

| Tag | Meaning |
| --- | --- |
| `[Ref]` | Official engine reference (creator-docs YAML) |
| `[Guide]` | Official guide `input/input-action-system.md` (and linked guides) |
| `[Dump]` | Roblox API dump (defaults, hidden members, security) |
| `[Ann]` | Official DevForum announcement or update post |
| `[Staff]` | Reply from Roblox staff on the DevForum (date given) |
| `[Src]` | Roblox's own IAS-based PlayerModule source (Client-Tracker) |
| `[User]` | Community report that staff have not confirmed (treat as **UNVERIFIED**) |

**Sources**

- Guide: https://create.roblox.com/docs/input/input-action-system (raw: https://github.com/Roblox/creator-docs/blob/main/content/en-us/input/input-action-system.md)
- Reference: https://create.roblox.com/docs/reference/engine/classes/InputContext · …/classes/InputAction · …/classes/InputBinding · …/classes/InputActionLabel · …/enums/InputActionType · …/enums/InputBindingType · …/enums/PreferredInput · …/enums/KeyCode · …/enums/InputSink
  (raw YAML: `https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/{classes|enums}/<Name>.yaml`)
- Related reference: `UserInputService` (PreferredInput, GetStringForKeyCode, GetImageForKeyCode), `Workspace.PlayerScriptsUseInputActionSystem`, `Workspace.AuthorityMode`, `StarterPlayer.CreateDefaultPlayerModule`, `GuiObject.InputSink`
- Guides: https://create.roblox.com/docs/input (PreferredInput) · https://create.roblox.com/docs/projects/server-authority · https://create.roblox.com/docs/projects/cross-platform · https://create.roblox.com/docs/input/micro-gamepad
- DevForum (official):
  - [Studio Beta] New Input Action System (2025-05-19): https://devforum.roblox.com/t/studio-beta-new-input-action-system/3656214
  - [Client Beta] IAS publishable (2025-08-20, with update posts on 2025-11-21, 2026-02-11, 2026-02-24 and 2026-07-29): https://devforum.roblox.com/t/client-beta-input-action-system-is-now-available-to-publish-in-experiences/3890979
  - [Full Release] IAS & Newly Converted Player Scripts (2026-06-11): https://devforum.roblox.com/t/full-release-input-action-system-ias-newly-converted-player-scripts/4678416
  - [Studio Beta] Input Action Manager (2026-07-14): https://devforum.roblox.com/t/studio-beta-input-action-manager/4737890
  - [Studio Beta] No-code Hotkey Hints With InputActionLabel (2026-08-06): https://devforum.roblox.com/t/studio-beta-no-code-hotkey-hints-with-inputactionlabel/4779420
  - Feature request "Pressed should pass InputBinding" (staff answer, 2026-01-13): https://devforum.roblox.com/t/inputactionpressed-should-pass-inputbinding-as-a-parameter/4242004
  - UI navigation bug (fixed 2025-11): https://devforum.roblox.com/t/ui-navigation-is-not-working-properly-on-the-input-action-system/3891622
- Community: PlayerModule migration guide https://devforum.roblox.com/t/new-playermodule-migration-guide-for-playerscripts-useinputactionsystem/4681909 · `InputBinding:Fire() is not enabled` thread https://devforum.roblox.com/t/inputbindingfire-is-not-enabled/4710232
- API dump and PlayerModule source: https://github.com/MaximumADHD/Roblox-Client-Tracker (`Full-API-Dump.json`, `scripts/PlayerScripts/StarterPlayer/PlayerModule/**`)
- Prior art: `@rbxts/flux` (https://github.com/christopher-buss/flux) is a roblox-ts wrapper over IAS with typed actions, triggers and modifiers.

---

## 0. Timeline (what landed when)

| Date | Change |
| --- | --- |
| 2025-05-19 | Studio beta: `InputContext` / `InputAction` / `InputBinding` / `InputActionType` (Bool, Direction1D, Direction2D). Not publishable. `[Ann]` |
| 2025-08-20 | Client beta (publishable). Mouse button KeyCodes for Bool, `Direction3D`, Studio state display. `[Ann]` |
| 2025-10-23 | Bug: `MouseLeftButton`/`MouseMiddleButton`/`MouseRightButton`/`MousePosition` KeyCodes set in the Studio UI reverted to Unknown and had to be set again. Values set from scripts were unaffected. `[Staff]` |
| 2025-11-21 | `ResponseCurve`, `ViewportPosition` action type, per-axis thumbstick KeyCodes (`Thumbstick1Up`…). Fixes: touch triggering mouse bindings, `InputContext.Enabled` not resetting state, UI navigation, Direction3D switched to Roblox right-handed coordinates, thumbstick deadzone cancelling other bindings. `[Ann]` |
| 2026-02-11 (effective 02-24) | `PrimaryModifier`/`SecondaryModifier` (chords). UIButton references now work from any location. **Exclusive bindings** (one input source per binding). **Improved sinking**: IAS now respects sinking from UI and CAS. `[Ann]` |
| 2026-04-07 | Bool action with `UIButton`: `Released` now fires when the pointer or touch leaves the button bounds. `[Staff]` |
| 2026-06-11 | **Full release.** Adds `TouchPosition`/`TouchPinch`/`TouchDelta`, `UIModifier`, `MouseWheel`/`TrackpadPinch`→Direction1D, `MouseDelta`/`TrackpadPan`→Direction2D, `ClampMagnitudeToOne`, `Vector3Scale`. `Workspace.PlayerScriptsUseInputActionSystem` phase 1 (opt-in). `[Ann]` |
| ~2026-06/07 | `InputBindingType` (`Automatic`/`Scriptable`) and `InputBinding:Fire()` added. `InputAction:Fire()` deprecated. The exact date is **UNVERIFIED**: no announcement was found, and a community thread shows it rolling out between late June and early July. |
| 2026-07-14 | Input Action Manager (Studio beta tool). `[Ann]` |
| 2026-07-29 | Per-place opt-outs from the 2026-02 sinking change are being removed (target 2026-08-14). `[Staff]` |
| 2026-08-06 | `InputActionLabel` Studio beta (not publishable). `InputAction.PreferredBinding` and `InputBinding.DisplayName`/`DisplayImage` are **live**. `[Ann]` |
| Early 2027 (ETA) | Phase 2: `PlayerScriptsUseInputActionSystem` defaults to Enabled (potentially breaking). `[Ann]` |
| Mid 2027 (ETA) | Phase 3: property removed. All places use the IAS PlayerScripts. `[Ann]` |

---

## 1. Concepts

### 1.1 Hierarchy and registration

```
InputContext             group of actions; Enabled / Priority / Sink
└─ InputAction           one gameplay intent; Type fixes the value type; events live here
   ├─ InputBinding       one input source: KeyCode, or UIButton, or composite directions, or Scriptable
   └─ InputBinding …     any number of bindings, typically one per device class (KBM, gamepad, touch)
```

- An `InputAction` registers with its **first ancestor `InputContext`**. With no ancestor context it registers with an engine **default context** `[Ref]`. The default context's Priority and Sink are **UNVERIFIED**. IAM shows such actions under "Default Context" `[Ann]`.
- "Nested `InputContext` instances will have no effect". Ordering and priority come only from `Enabled`/`Priority`/`Sink` `[Ref]`. Practical reading: an outer context's `Enabled`/`Priority` does **not** cascade to an inner context, and actions belong to their nearest context (**UNVERIFIED** interpretation). Do not nest contexts.
- `InputBinding`s are parented to the `InputAction` `[Ref]`. Whether bindings deeper than direct children count is **UNVERIFIED**; assume direct children only.
- Several actions in the **same** context may share a key. All of them fire, with no ordering guarantee `[Staff 2025-05-20]`. IAM flags this as a "duplicate" warning, but it is not an error.
- Changing binding properties, or adding or removing bindings, at runtime takes effect immediately `[Staff 2025-05-20, 2025-09-12]`.
- Everything is scriptable through `Instance.new` and properties `[Staff 2025-08-20]`. Staff position: no service-style or "bulk create" API is planned. Write Lua wrappers `[Staff 2025-05-20]`.

### 1.2 Where instances must live, and client versus server

- **Recommended location:** a folder in `ReplicatedStorage`, for example `ReplicatedStorage.Inputs` `[Guide]`. IAM does not show contexts that sit in starter folders `[Ann IAM]`.
- Staff also say: "Actions should work almost anywhere". ReplicatedStorage works, StarterGui copies appear under PlayerGui, and actions under a car model in Workspace work `[Staff 2025-05-20]`. Roblox's own PlayerModule keeps its contexts at `StarterPlayer.PlayerModule.InputContexts` on the client `[Src]`.
- Instances **can be created purely on the client** with `Instance.new` from a LocalScript or client Script `[Staff 2025-05-20: "You can also create these on the client as well"]`. Community repro scripts create the context under `script`.
- **UNVERIFIED:** whether a context parented to `nil`, outside the DataModel, is active. Assume it must be in the DataModel.
- **Server Authority requirement:** `InputContext`s must be descendants of a `Player`. The official pattern clones `ReplicatedStorage.Inputs` into each player from a server Script `[Guide SA]`.
- Script gotcha: `LocalScript`s do not run in ReplicatedStorage. The guide uses `Script` with `RunContext = Client` parented under the action `[Staff 2026-07-24]`.
- **UIButton references:** before 2026-02 the action tree had to be in the same tree as the GUI (StarterGui), or `UIButton` had to be assigned at runtime to the PlayerGui copy. Since the 2026-02 fix, bindings anywhere can reference StarterGui buttons, and the reference survives cloning into PlayerGui `[Ann 2026-02-11; Staff 2026-02-26]`. Contexts placed inside a `ScreenGui` with `ResetOnSpawn = true` are destroyed and re-cloned on respawn, which drops your connections `[User]`.

### 1.3 Replication and the server

- IAS objects are ordinary Instances. Server-created objects in replicated containers replicate to clients. Input state and events are produced **on the client**.
- **Without Server Authority**, action state does not replicate and events do not fire on the server `[Staff 2026-02-19: "still thinking about the design for action replication"; Staff 2026-07-24: "InputActions currently should only replicate to the server when AuthorityMode = Server"]`. Use RemoteEvents for server-side processing `[Staff 2025-05-20]`.
- **With `Workspace.AuthorityMode = Server`** (this requires `PlayerScriptsUseInputActionSystem` Enabled, NextGenerationReplication, Deferred signals, UseFixedSimulation and StreamingEnabled): action states are sent to the server and replayed during client resimulation. Read `action:GetState()` inside `RunService:BindToSimulation()` on both client and server. Use IAS for **all** inputs that affect the core simulation, and do not use `UserInputService.InputBegan` there `[Guide SA]`.
- These members have **Simulation Access**, meaning they are predicted and usable inside `BindToSimulation`: `InputAction.Type`, `Enabled`, `DisplayName`, `GetState()`, `Fire()`, and `InputBinding:Fire()` `[Dump]`.
- Only action state is networked. Which binding caused a change is not `[User 2026-01]`.
- **UNVERIFIED:** whether `Pressed`/`Released`/`StateChanged` fire on the server under Server Authority. The docs only show polling `GetState()`.
- `InputAction.PreferredBinding` is `NotReplicated`.

### 1.4 Enabling and disabling

- `InputContext.Enabled` defaults to `true`. When it is set to `false`, descendant actions receive no signals, **except** a final "end" signal if a key was held or a directional input was non-zero `[Ref]`. Staff: disabling a context "is identical to calling `InputAction:Fire(false)` on bool actions". This signal arrives even though the context is now disabled, and it is not deferred until re-enable `[Staff 2025-11-24]`.
- `InputAction.Enabled` defaults to `true`. Toggling it to `false` resets the action state `[Ref]`.
- There is **no public reset or clear API**. Users report that inputs held across a disable and re-enable, or across TextBox focus, can come back "stuck" `[User 2025-11, 2026-01]`. Staff fixed "first input ignored after re-enable" in 2025-11.

### 1.5 Priority and Sink (across contexts)

Rules, combining `[Ref]`, `[Guide]` and `[Staff 2025-05-20 #146/#155]`:

1. Contexts are processed from **highest `Priority` to lowest**. `Priority` is an `int` with a default of **1000** `[Dump]`.
2. Processing continues down the priority levels until it reaches a level where a context with **`Sink = true`** has a binding for that input. **Every** context at that same priority level still receives the input, including non-sinking ones. Lower levels do not receive it and fire no events for it.
3. Sink is **per input**. A sinking context blocks only the inputs it has bindings for ("consumes input events for its bound KeyCodes") `[Guide]`. Unrelated keys pass through.
4. There is no ordering guarantee between actions in one context, or between contexts at the same priority `[Staff]`.
5. There is no per-action Sink, and nothing like CAS's return `Pass`/`Sink` from a callback. Toggling `Sink` or `Enabled` inside a `Pressed` handler does not affect the input currently being processed `[User 2026-06-23]`. Staff advice: split behaviour into separate contexts with their own priority and sink `[Staff 2026-06-22]`.
6. To override Roblox's default controls, the guide sets a custom context to `Priority = 2000` with `Sink = true`. That is "high enough to sink its bound inputs before the default PlayerScripts contexts process them", which only works when `PlayerScriptsUseInputActionSystem = Enabled` `[Guide]`. The exact priorities of the default contexts are **UNVERIFIED** (the guide implies they are below 2000).
7. **UNVERIFIED:** whether a disabled action inside an enabled sinking context still sinks. Also UNVERIFIED: whether a binding whose modifier is not held still sinks its KeyCode, and whether `Scriptable` bindings participate in sinking.

### 1.6 Multiple bindings on one action

- Any number of bindings is allowed. The guide expects one gamepad, one keyboard/mouse and one touch binding per action `[Guide]`.
- **Exclusive bindings (since 2026-02-24):** each `InputBinding` listens to one input source. If `KeyCode` is set, `UIButton` and composite directions on that binding are **ignored**. Split them into separate bindings `[Ann]`. Studio hides the unused properties.
- Events do **not** report which binding fired. This is deliberate: "all bindings connected to an action should result in the same output regardless of platform / input". Use one action per distinct meaning `[Staff 2025-05-20, 2026-01-13]`.
- How simultaneously active bindings **aggregate** (OR for Bool, sum or last-write for directional) is **not documented**. A 2025-06 user report says that with two bindings held, releasing one resets the state to 0. A 2026-01 user report says `Released` did not fire in a multi-key sequence. **UNVERIFIED: test this.**

---

## 2. Class reference

Defaults come from `[Dump]`. Descriptions come from `[Ref]` unless tagged otherwise. Unless noted, all properties are script read/write with security `None`.

### 2.1 `InputContext : Instance`

"Collection of actions which holds related actions and defines how they interact with other contexts/actions."

| Property | Type | Default | Notes |
| --- | --- | --- | --- |
| `Enabled` | `bool` | `true` | When false, descendant actions get no signals except one final "end" signal (§1.4). |
| `Priority` | `int` | `1000` | Higher priority runs first. |
| `Sink` | `bool` | `false` | Inputs bound in this context are not processed by lower-priority contexts. Contexts with the same priority still receive them (§1.5). |

- Public methods: **none**. Public events: **none**. Use `GetPropertyChangedSignal`.
- Hidden (`RobloxScriptSecurity`, not callable by games) `[Dump]`: `GetInputActions(): Instances` and event `InputActionsChanged()`.

### 2.2 `InputAction : Instance`

"Defines a gameplay action mechanic. These actions are then mapped to hardware inputs using `InputBinding`."

| Property | Type | Default | Tags | Notes |
| --- | --- | --- | --- | --- |
| `DisplayName` | `string` | `""` | SimAccess | Localized display name for UI such as a controls help menu. |
| `Enabled` | `bool` | `true` | SimAccess | Toggling to false resets the action state. |
| `PreferredBinding` | `InputBinding?` | `nil` | ReadOnly, NotReplicated | The child binding that best matches `UserInputService.PreferredInput` (KeyboardAndMouse / Gamepad / Touch). It updates as devices change; listen with `GetPropertyChangedSignal("PreferredBinding")`. The selection rule when several bindings fit one device is **UNVERIFIED**. |
| `Type` | `Enum.InputActionType` | `Bool` | SimAccess | Fixes the value type of the state, events and `Fire`. |
| `BoolState` / `Direction1DState` / `Direction2DState` / `Direction3DState` / `ViewportPositionState` | bool / float / Vector2 / Vector3 / Vector2 | false / 0 / (0,0) / (0,0,0) / (0,0) | ReadOnly, NotReplicated, **NotScriptable** (RobloxScriptSecurity) | Studio-only debug display. Not readable from scripts (one community post claims otherwise, but security says no). |

| Method | Signature | Notes |
| --- | --- | --- |
| `GetState` | `GetState(): Variant` | Current state: `boolean` / `number` / `Vector2` / `Vector3` / `Vector2` for Bool / 1D / 2D / 3D / ViewportPosition. Thread-safe (`Safe`). SimAccess. |
| `Fire` **(Deprecated)** | `Fire(state: Variant): ()` | "Use `InputBinding:Fire()` with a `Scriptable` binding instead." Sets the action state and fires the matching signals. `state` must match `Type` or it **errors** (for example `0.5` on a Bool action). It follows the event rules: repeated `Fire(true)` fires only once. Whether it respects `Enabled` is **UNVERIFIED**. It bypasses binding `Scale` because it sets the action directly `[User]`. SimAccess. |
| hidden | `GetInputBindings(): Instances`, `GetPreferredBindingList(count: int = 0): Instances` | `RobloxScriptSecurity`. Not usable. |

| Event | Params | Fires when |
| --- | --- | --- |
| `Pressed` | `()` | Only for `Type = Bool`, on the transition false→true. |
| `Released` | `()` | Only for `Type = Bool`, on the transition true→false. |
| `StateChanged` | `(value: Variant)` | For all types, whenever the state changes. It does **not** fire when the new state equals the old one, so a thumbstick held at a fixed angle fires once. Poll `GetState()` every frame for continuous input `[Guide]`. |
| hidden | `InputBindingsChanged()` | `RobloxScriptSecurity`. |

### 2.3 `InputBinding : Instance`

"Defines which hardware binding should trigger the parent `InputAction`."

| Property | Type | Default | Applies to | Description |
| --- | --- | --- | --- | --- |
| `KeyCode` | `Enum.KeyCode` | `None` (formerly `Unknown`) | all | Main input. It should match the action type, for example `E` for Bool or `Thumbstick1` for Direction2D. "Type mismatches will either not fire the InputAction or the StateChanged event will receive a converted value." When set, it takes precedence over `UIButton` and composite directions (exclusive bindings). |
| `Up` | `KeyCode` | `None` | 1D, 2D, 3D | Composite +direction: 1D gives 0..1, 2D gives Y 0..1, 3D gives Y 0..1. |
| `Down` | `KeyCode` | `None` | 1D, 2D, 3D | Composite −direction: 1D gives 0..−1, 2D gives Y 0..−1, 3D gives Y 0..−1. |
| `Left` | `KeyCode` | `None` | 2D, 3D | X 0..−1. |
| `Right` | `KeyCode` | `None` | 2D, 3D | X 0..1. |
| `Forward` | `KeyCode` | `None` | 3D | Z 0..**−1** (Roblox forward is −Z). |
| `Backward` | `KeyCode` | `None` | 3D | Z 0..**+1**. |
| `ClampMagnitudeToOne` | `bool` | `true` | 1D, 2D, 3D | Normalizes the **combined composite** vector to magnitude 1, and only when it exceeds 1. This stops diagonals being faster. Set it to false for independent axes (freecam) or raw sources that exceed 1, such as mouse wheel velocity. |
| `Scale` | `float` | `1` | 1D, 2D, 3D | Uniform multiplier on the output. Applied **together with** `Vector2Scale`/`Vector3Scale` when both are set. The guide uses `0.01` on `MouseDelta`/`TouchDelta` because they report pixels. A negative value inverts. |
| `Vector2Scale` | `Vector2` | `(1, 1)` | 2D | Per-component linear scale. |
| `Vector3Scale` | `Vector3` | `(1, 1, 1)` | 3D | Per-component linear scale. |
| `ResponseCurve` | `float` | `1` | 2D with `Thumbstick1`/`Thumbstick2` (and per-axis thumbstick KeyCodes, per a 2026-06 fix) | Quadratic response curve with range 1–10. At 1 the input passes through unchanged. Higher values give finer control near centre and a fast ramp near full deflection. |
| `PressedThreshold` | `float` | `0.5` | Bool with an analog source | Value above which (the guide says `>=`) the action becomes true. Clamped to be `>= ReleasedThreshold`. |
| `ReleasedThreshold` | `float` | `0.2` | Bool with an analog source | Value below which (the guide says `<=`) the action becomes false. Clamped to be `<= PressedThreshold`. Together the two give hysteresis. |
| `PrimaryModifier` | `KeyCode` | `None` | all | A key that must be held **before** the `KeyCode`/`UIButton`/composite input. `None` means no requirement. |
| `SecondaryModifier` | `KeyCode` | `None` | all | A second required key. When both modifiers are set, both must be held, in either order. |
| `UIButton` | `GuiButton?` | `nil` | Bool | Press and release of this `GuiButton` drive the action. Ignored when `KeyCode` is set. Releases when the pointer leaves the bounds (since 2026-04). Presses through gamepad UI navigation also route here (fixed 2025-11 and 2026-06). |
| `UIModifier` | `GuiButton?` | `nil` | all | A `GuiButton` that must be held (touched) for the binding to activate. It behaves like a modifier key, and is meant for "touches that begin within a specific UI region", for example a dynamic thumbstick. `nil` means no requirement. |
| `PointerIndex` | `int` | `0` | ? | **Undocumented** (empty docs). Probably selects the pointer or touch index for pointer KeyCodes. **UNVERIFIED.** |
| `Type` | `Enum.InputBindingType` | `Automatic` | all | `Automatic` is driven by hardware or UI. `Scriptable` ignores hardware and is driven only by `Fire()`. |
| `DisplayName` | `string` | `""` | display | Custom hint text (for example "FIGHT" instead of "F"). Fallback is `UserInputService:GetStringForKeyCode()`. |
| `DisplayImage` | `Content` | empty | display | Custom hint image. Fallback is `UserInputService:GetImageForKeyCode()`. `InputActionLabel` prefers it over `DisplayName`. |

| Method | Signature | Notes |
| --- | --- | --- |
| `Fire` | `Fire(state: Variant): ()` | Only on `Type = Scriptable`; on an `Automatic` binding it **throws**. `state` must match the parent action `Type`: Bool takes a `boolean`, 1D a `number`, 2D a `Vector2`, 3D a `Vector3` and ViewportPosition a `Vector2`. A mismatch **throws**. Deduplicated like hardware input (same value, no event). **Silently ignored** if the parent action or its ancestor context is disabled. Fires `Pressed`/`Released`/`StateChanged`. SimAccess. |

No events.

### 2.4 `InputActionLabel : GuiObject` (Studio beta, related)

A drag-and-drop label that renders an action's `PreferredBinding`. It is **not publishable** during the Studio beta. As of 2026-09-12 users were still asking when it would ship, so treat it as **UNVERIFIED** whether it has been released since.

- Properties: `InputAction: InputAction?`, `ResolvedText: string` (ReadOnly, NotReplicated; for example `"Ctrl + Shift + Space"`), `ResolvedImageContent: Content` (ReadOnly, NotReplicated), `FontFace`, `TextColor3`, `TextSize` (default 8), `TextTransparency`, `TextWrapped`, `TextXAlignment`, `TextYAlignment`, `ImageColor3`, `ImageTransparency`. There is no `TextScaled` (requested).
- Resolution order: binding `DisplayImage`, then platform key image (`GetImageForKeyCode`; modifier chords render as icons joined by `+`), then binding `DisplayName`, then platform key string (`GetStringForKeyCode`), then a placeholder icon when there is no action or no binding. It updates live when devices switch or bindings are rebound.

---

## 3. Enums

### `Enum.InputActionType` (used by `InputAction.Type`)

| Item | Value | State type | Typical sources |
| --- | --- | --- | --- |
| `Bool` | 0 | `boolean` | Keys and buttons, mouse buttons, `UIButton`, `TouchPosition` (touch active), analog sources through thresholds |
| `Direction1D` | 1 | `number` | Triggers `ButtonL2`/`ButtonR2`, `Up`/`Down` composites, `MouseWheel`, `TrackpadPinch`, `TouchPinch` |
| `Direction2D` | 2 | `Vector2` | `Thumbstick1`/`Thumbstick2`, `Up`/`Down`/`Left`/`Right` composites, `MouseDelta`, `TrackpadPan`, `TouchDelta` |
| `Direction3D` | 3 | `Vector3` | Composites `Up`/`Down`/`Left`/`Right`/`Forward`/`Backward` |
| `ViewportPosition` | 4 | `Vector2` (absolute pixels) | `MousePosition`, `TouchPosition` |

### `Enum.InputBindingType` (used by `InputBinding.Type`)

| Item | Value | Meaning |
| --- | --- | --- |
| `Automatic` | 0 | Default. Responds to devices through `KeyCode`, composites or UI button. |
| `Scriptable` | 1 | Ignores hardware. State comes only from `InputBinding:Fire()`. |

### `Enum.PreferredInput` (used by `UserInputService.PreferredInput`)

| Item | Value | Meaning |
| --- | --- | --- |
| `KeyboardAndMouse` | 0 | Keyboard or mouse is connected or was most recently used. |
| `Gamepad` | 1 | A gamepad is connected or was most recently used. |
| `Touch` | 2 | The device has touch and no other input is available or recently used. |
| `MicroGamepad` | 3 | A gamepad without thumbsticks (TV remote), with no standard gamepad connected. |

### `Enum.KeyCode`: IAS-relevant items

| Name | Value | Use in IAS |
| --- | --- | --- |
| `None` | 0 | "No key". Renamed from `Unknown`; the typings keep `Unknown` as a deprecated alias. The default for all KeyCode properties. |
| `ButtonL2` / `ButtonR2` | 1007 / 1006 | Analog triggers: 0..1 for Direction1D, Bool through thresholds. |
| `Thumbstick1` / `Thumbstick2` | 1016 / 1017 | Direction2D. |
| `Thumbstick1Up/Down/Left/Right` | 1018–1021 | Per-axis stick directions, for Bool or as composite directions. |
| `Thumbstick2Up/Down/Left/Right` | 1022–1025 | Same, for the right stick. |
| `MouseLeftButton` / `MouseRightButton` / `MouseMiddleButton` | 1026 / 1027 / 1028 | Bool. In 2025-09 staff said mouse and touch KeyCodes "will be able to be assigned" to Bool and Direction1D `KeyCode` and to composite directions; current support for the non-Bool uses is **UNVERIFIED**. |
| `MouseBackButton`, `MouseNoButton`, `MouseX`, `MouseY` | 1029–1032 | **Deprecated**, "flagged for removal". |
| `MousePosition` | 1033 | ViewportPosition. |
| `TouchPosition` (legacy name `Touch`) | 1034 | Bool (touch active) or ViewportPosition (touch position). Pair with `UIModifier` to limit it to a region. |
| `MouseWheel` | 1035 | Direction1D, velocity-based scroll delta. |
| `TrackpadPan` | 1040 | Direction2D, pan delta. |
| `TrackpadPinch` | 1045 | Direction1D, pinch scale delta. |
| `MouseDelta` | 1048 | Direction2D, mouse movement delta in pixels (the guide uses `Scale = 0.01`). |
| `TouchDelta` | 1049 | Direction2D, one-finger swipe delta in pixels. |
| `TouchPinch` | 1050 | Direction1D, two-finger pinch velocity. |
| `ButtonCenter`, `ButtonBack`, `ButtonUp`/`Down`/`Left`/`Right` | 1051–1056 | TV remote / MicroGamepad. The docs note that remote events currently map to **legacy** gamepad KeyCodes before reaching game code; Roblox's PlayerModule binds `ButtonUp`/`ButtonDown`/`ButtonCenter`/`ButtonLeft`/`ButtonRight` anyway `[Src]`. |

### Related: `Enum.InputSink` (`GuiObject.InputSink`)

`None` (0), `Activate` (1; the default on `GuiButton`s: sinks press and release but lets hover and movement through), `All` (100). It controls whether a GUI element sinks input from things behind it, including 3D objects. It is a finer successor to `GuiObject.Active`. **UNVERIFIED:** exactly how it interacts with IAS pointer bindings. It is likely the UI-sinking mechanism that IAS respects since 2026-02.

---

## 4. Value semantics by action type and source `[Guide]`

| Action type | Binding source | `StateChanged` / `GetState` value |
| --- | --- | --- |
| **Bool** | Digital `KeyCode` (key, button, mouse button) or `UIButton` | `true` on press, `false` on release. `Pressed`/`Released` fire with **no arguments**. |
| Bool | Analog `KeyCode` (L2/R2, and probably per-axis stick codes) | `true` when value ≥ `PressedThreshold`, `false` when value ≤ `ReleasedThreshold`. |
| Bool | `TouchPosition` | `true` while a touch is active (anywhere unless `UIModifier` restricts it). |
| **Direction1D** | Analog `KeyCode` or `Up` | 0 → 1. |
| Direction1D | Analog `Down` | 0 → −1. |
| Direction1D | Digital `KeyCode` or `Up` / digital `Down` | 1 or 0 / −1 or 0. |
| Direction1D | `MouseWheel` / `TrackpadPinch` / `TouchPinch` | Velocity-style delta. Not bounded to ±1, so set `ClampMagnitudeToOne = false` and scale it yourself. Units and return-to-zero behaviour are **UNVERIFIED**. |
| **Direction2D** | `Thumbstick1`/`Thumbstick2` | Vector2 in (−1..1, −1..1) after a built-in deadzone. Up is +Y. |
| Direction2D | Digital composites | `Up` (0,1), `Down` (0,−1), `Left` (−1,0), `Right` (1,0), summed then clamped to magnitude 1 by default. |
| Direction2D | Analog composites (triggers, per-axis stick codes) | Each component 0..±1 as pressed. |
| Direction2D | `MouseDelta` / `TouchDelta` / `TrackpadPan` | Pixel or velocity delta; the guide scales by 0.01 and multiplies `GetState()` by `dt` each frame. Whether it is per-frame or per-second, and whether it resets to zero when motion stops, is **UNVERIFIED**. |
| **Direction3D** | Digital composites | `Up` (0,1,0), `Down` (0,−1,0), `Left` (−1,0,0), `Right` (1,0,0), `Forward` (0,0,−1), `Backward` (0,0,1). |
| Direction3D | Analog composites | Components 0..±1. Whether `KeyCode` (such as a thumbstick) is accepted on Direction3D is **UNVERIFIED**; the docs only mention composites. |
| **ViewportPosition** | `MousePosition` / `TouchPosition` | Absolute pixel Vector2 from (0,0) to the viewport size. |

Type-mismatch rules: a mismatched hardware binding either does not fire, or delivers a converted value `[Ref]`. `Fire()` with the wrong Lua type **throws**. Since 2026-06, "passing a boolean input into a Direction1D action" throws a type error instead of failing silently `[Ann]`.

---

## 5. Behaviour notes and gotchas

### Events and state
- `StateChanged` fires only when the value changes. For continuous control (camera, steering), poll `GetState()` in `RenderStepped`, `BindToRenderStep` or `BindToSimulation` `[Guide]`.
- With `Workspace.SignalBehavior = Deferred`, IAS signals are deferred like any other signal. Staff believe a context-disable "end" signal does not defer past the current script step `[Staff 2025-11]`.
- IAS signals are processed **before** `UserInputService` callbacks `[Staff 2025-05-20]`.
- There is no "cancelled" versus "ended" distinction; they are the same event `[Staff 2025-05-20]`.
- There is no built-in toggle, hold, tap or double-tap. Implement toggles by flipping state on each `Pressed` `[Staff]`. A toggle property on bindings "is being considered" `[Staff 2026-02-19]`.

### Thresholds, deadzone and curve
- Bool analog thresholds are hysteresis (0.5 press, 0.2 release by default). Setting `PressedThreshold < ReleasedThreshold` is clamped.
- Thumbsticks have a **built-in, non-configurable deadzone**. Users measured about 10–12%, remapped as `sign(x)*max(|x|-dz,0)/(1-dz)` per component `[User]`. Staff said in 2025-08 that "we will make them configurable", but no property exists in the 2026-09 dump. **UNVERIFIED** values.
- `ResponseCurve` shapes stick magnitude; it does not change the deadzone.

### Composite and directional input
- Composite bindings use `Up`/`Down`/`Left`/`Right`/`Forward`/`Backward` with `KeyCode` left as `None`. **A binding with a `KeyCode` set ignores its composite directions.**
- 1D supports only `Up`/`Down`. 2D adds `Left`/`Right`. 3D adds `Forward`/`Backward`.
- `ClampMagnitudeToOne` (default true) normalizes diagonals.
- Direction3D uses Roblox right-handed coordinates (forward is −Z) since 2025-11.
- To read a trigger's analog position, use a Direction1D action with a binding where `Up = ButtonR2` (or `KeyCode = ButtonR2`) `[Staff 2025-10-23]`.

### Modifiers (chords)
- `PrimaryModifier` and `SecondaryModifier` give up to **two** modifier keys per binding (so Ctrl+Shift+K is possible). Modifiers must be held **before** the main key. The two modifiers can be pressed in either order.
- **UNVERIFIED (important for design):** whether a plain `C` binding also fires while Ctrl is held, in other words whether matching is exclusive. Likewise whether `Ctrl+C` and `Ctrl+Shift+C` in the same or equal-priority contexts suppress each other. Godot-style exact matching is **not** documented. Test before relying on it.
- On Mac, Ctrl reports as Ctrl and Cmd reports as Meta. Use two bindings for Ctrl or Cmd shortcuts `[Staff 2026-04-07]`.
- `UIModifier` is the touch equivalent: a `GuiButton` region that must be held.

### Fire and Scriptable bindings
- Preferred pattern: add an `InputBinding` with `Type = Scriptable` to the action, then call `binding:Fire(value)`. Use it for custom on-screen controls (virtual stick, D-pad buttons feeding Direction2D), replays, AI or tests, and for bridging legacy input. Roblox's own PlayerModule does exactly this: `MoveAction` has `DynamicThumbstickScriptableBinding`, `ClassicThumbstickScriptableBinding` and `ClickToMoveScriptableBinding`, and the dynamic thumbstick reads a `TransformerContext.ThumbstickAction` fed by a `TouchPosition` binding with `UIModifier = thumbstickButton`. It fires `Vector2.zero` on release `[Src]`.
- `InputBinding:Fire` throws on `Automatic` bindings and on type mismatch. It is silently ignored when the action or context is disabled. It is deduplicated.
- **UNVERIFIED:** whether `Scale`, `Vector2Scale`, `Vector3Scale`, `ResponseCurve` or `ClampMagnitudeToOne` apply to values from `Fire`. Also UNVERIFIED: how a fired value combines with other active bindings, and whether the fired value persists until the next `Fire` (the PlayerModule explicitly fires zero on release, which suggests it does).
- `InputAction:Fire` is deprecated. It still works, bypasses binding `Scale` `[User]`, and its `Enabled` behaviour is undocumented.

### UIButton and touch
- `UIButton` only exists or works for **Bool** actions. GUI buttons are "fundamentally a boolean-like input" `[Staff 2025-05-22]`.
- There are **no UI buttons for directional actions**. Staff "can consider" `UIButtonUp/Down/Left/Right`. The workaround is button events plus a `Scriptable` binding.
- IAS does not create or hide touch buttons for you (unlike CAS `createTouchButton`). You manage visibility, for example by `PreferredInput` `[Staff]`.
- The Roblox **mobile virtual thumbstick is not exposed as a KeyCode**. `Thumbstick1*` does not include it `[Staff 2026-04-01]`. With the IAS PlayerScripts, the thumbstick feeds `CharacterContext.MoveAction` through Scriptable bindings, so `MoveAction:GetState()` is a unified move vector. That path is internal: `StarterPlayer.PlayerModule.InputContexts.CharacterContext.MoveAction` on the client, or `Player.InputContexts…` under Server Authority `[Src/User]`.
- Other touch gestures (`TouchRotate`, `TouchSwipe`, long press) are not in IAS; use UIS `[User 2026-07]`.

### Mouse, trackpad and pointer
- `MouseDelta`, `MouseWheel`, `TrackpadPan` and `TrackpadPinch` are supported since the 2026-06 full release. Before that, scroll wheel and mouse delta were missing.
- A user reports that a `MouseDelta` Direction2D binding only registered while the right mouse button was held `[User 2026-06-13]`. **UNVERIFIED.** It may depend on camera or mouse-lock state or on default contexts. Test with the IAS PlayerScripts both on and off.
- GUI under the cursor (for example ProximityPrompts or buttons) sinks mouse input, including `MouseDelta`, and there is no opt-out to "receive even if sunk" `[User 2026-06-15]`.

### Rebinding
- Runtime rebinding means setting `KeyCode`, composite or modifier properties on bindings, or creating and destroying bindings. It **takes effect immediately** `[Staff]`. `InputActionLabel` updates automatically.
- **No built-in persistence, player-facing remap UI or profile system.** Roblox is "actively investigating native frameworks to support player-side key remapping" `[Ann 2026-06-11]`. They are also floating per-game or per-controller "profiles" `[Staff 2025-10-02]` and a display customization API keyed by KeyCode "in case of player level rebinding" `[Staff 2026-08-11]`. Persist yourself, for example with a DataStore on the server, then apply on the client.
- IAM can export an `Inputs` folder as `.rbxm` (Studio only).

### Display and hints
- `PreferredBinding` plus `DisplayName`/`DisplayImage`, with fallbacks to `GetStringForKeyCode(keyCode, format?)` and `GetImageForKeyCode(keyCode)`.
- `GetImageForKeyCode` returns an empty string for many keys: there are no keyboard images, and no LMB, RMB or LShift images `[Staff 2026-08/09]`.
- In 2026-08 a user reported `PreferredBinding` not populating. The reply (by the account that co-built `InputActionLabel`) was that it was pending rollout; it went live with the 2026-08-06 announcement.

### Reserved and conflicting keys
- Esc and ButtonStart, F9, F11, F12 and PrintScreen are reserved. `/`, Tab, `` ` ``, 0–9, Backspace and `\` are taken by CoreGui features unless you disable them. For example, a Tab binding is ignored while the player list is enabled `[Guide default-bindings, User]`.
- In Studio only, I and O are bound to Studio camera zoom unless "Respect Studio Shortcuts when game has focus" is off `[Staff 2026-05-26]`.

### Performance
- Staff expect performance "about the same" as UIS, with minimal instance overhead `[Staff 2025-05-20]`.

---

## 6. Related APIs and interop

### 6.1 `UserInputService.PreferredInput` (a replacement for custom device detection)
- `UserInputService.PreferredInput: Enum.PreferredInput`. ReadOnly, NotReplicated, client-side. It **exists** and is in the typings: `readonly PreferredInput: Enum.PreferredInput`.
- **No dedicated event.** Use `UserInputService:GetPropertyChangedSignal("PreferredInput")` (the official sample does this).
- It changes based on built-in devices and the **most recent interaction** with a connected gamepad or keyboard/mouse. Examples: a phone alone gives Touch. A phone with a BT keyboard gives KeyboardAndMouse. A tablet with a BT gamepad gives Gamepad. A console with keyboard/mouse most recently used gives KeyboardAndMouse. A PC with a gamepad most recently used gives Gamepad.
- It avoids the known problems with `TouchEnabled` (true on touch laptops) and with `GetLastInputType()` thrashing between MouseMovement and Keyboard or returning `Focus`, `TextInput` and similar. `GetLastInputType()`/`LastInputTypeChanged` remain available for fine-grained needs. Staff advise against `KeyboardEnabled`/`MouseEnabled` for UX `[Staff 2025-05-19]`.
- `InputAction.PreferredBinding` is the per-action counterpart.

### 6.2 Mouse KeyCodes accepted by IAS bindings
- Buttons: `MouseLeftButton`, `MouseRightButton` and `MouseMiddleButton` for Bool. Staff said on 2025-09-03 that they "will be able to be assigned" to Direction1D `KeyCode` and to composite directions; this is **UNVERIFIED** today.
- Position: `MousePosition` for ViewportPosition.
- Motion: `MouseDelta` for Direction2D (pixels; scale down).
- Wheel: `MouseWheel` for Direction1D (velocity; there is no separate wheel-up or wheel-down KeyCode, so map the sign yourself or use thresholds).
- Trackpad: `TrackpadPan` for Direction2D and `TrackpadPinch` for Direction1D.
- `MouseBackButton`, `MouseNoButton`, `MouseX` and `MouseY` are deprecated.
- Historical bug: `MouseLeftButton` bindings used to fire on touch and gamepad R2 (fixed around 2025-10/11).

### 6.3 IAS with ContextActionService, UserInputService, the UI and TextBoxes
- **CAS is processed before IAS.** Since 2026-02-24, a CAS binding that returns `Sink` **blocks** IAS bindings for that input `[Staff 2026-02-19: "CAS takes priority over IAS"; User 2026-03-21 confirms "IAS no longer register inputs when CAS sinks"]`. With the legacy CAS PlayerScripts (`PlayerScriptsUseInputActionSystem = Disabled`), default controls can therefore sink your IAS actions on `Thumbstick1`, `ButtonA`, `ButtonR2`, Shift and similar `[Ann 2026-02-11]`. A higher-priority sinking IAS context **cannot** block legacy CAS controls `[Staff 2026-02-19]`. The fix is to enable the IAS PlayerScripts.
- **UNVERIFIED:** whether an IAS `Sink` blocks CAS actions or sets `gameProcessedEvent = true` for UIS listeners. Ordering suggests it does not block CAS.
- **There is no `gameProcessedEvent` equivalent** in IAS signals. IAS filters implicitly:
  - Key bindings do not fire while a **TextBox is focused** `[User 2025-11-17]`.
  - GUI elements that sink input (buttons are `InputSink.Activate` by default; `Active`) block mouse-button bindings since the 2026-02-24 sinking fix. Before that, clicks on buttons leaked into `MouseLeftButton` actions `[Ann]`.
  - Clicks in CoreGui (menu, chat) used to leak into mouse-button actions (reported 2025-09). Presumably covered by the sinking fix; **UNVERIFIED**.
- **Stuck-key hazard:** if a key is held when chat or a TextBox gains focus, its release can be swallowed and the action stays active `[User 2026-01-28]`. Roblox's own camera code resets its pan state on `UserInputService.TextBoxFocusReleased` and `WindowFocusReleased` `[Src]`. The library should handle focus loss (TextBox focus, window focus loss, menu open) itself, for example by toggling `Enabled` or tracking state.
- **UI navigation (GuiService selection):** activating a selected `GuiButton` through gamepad or keyboard navigation now routes into its `UIButton` binding `[Ann 2025-11, 2026-06]`. **UNVERIFIED:** whether IAS gameplay bindings are suppressed while `GuiService.SelectedObject` is set, or during UI-selection mode. A known bug: enabling the virtual cursor sank all `Thumbstick2` input (tracked 2026-03).

### 6.4 Where an `InputContext` must live (answer)
- Anywhere in the DataModel that the client can see: ReplicatedStorage (recommended), StarterPlayer (Roblox's own), PlayerGui or StarterGui, a `Player` (**required** under Server Authority), or Workspace models (streaming can remove them). See §1.2.
- Creating contexts purely from a LocalScript or client Script is supported.
- Not recommended: `ScreenGui`s with `ResetOnSpawn`, and starter folders (IAM hides them). Behaviour when parented to `nil` is **UNVERIFIED**.

### 6.5 Default PlayerModule and overriding default jump or move
- **Opt in:** set `Workspace.PlayerScriptsUseInputActionSystem = Enabled`. It is `NotScriptable`, so set it in Studio. Phase 2 (early 2027) makes it the default; phase 3 (mid 2027) removes the legacy scripts.
- When enabled, the PlayerModule lives at `StarterPlayer.PlayerModule` and runs from there. It has no public API; `GetControls()` and `GetMoveVector()` are gone. Its IAS tree is `StarterPlayer.PlayerModule.InputContexts` `[Src]`:
  - `CharacterContext`: `MoveAction` (Direction2D), `JumpAction` (Bool), `RotationAction`, and ability actions (`AbilityAction1`…) with Scriptable bindings.
  - `CameraContext`: `CameraAction`, `CameraRotationAction`, `CameraZoomAction`, `CameraPanActiveAction`, `CameraToggleAction`.
  - `TransformerContext`: `ThumbstickAction` (touch thumbstick source).
  - `VehicleContext`: steer and throttle actions, per the community guide; enabled only when seated `[User]`.
  - Under Server Authority, `InputContexts` is cloned under each `Player`.
- **Official ways to override:**
  1. Create your own context with a higher `Priority` and `Sink = true`, bound to the same keys. This is the guide example with 2000.
  2. Modify the default instances: disable `JumpAction`, `MoveAction` or a whole context, change or add bindings, or use a negative `Scale` to invert. Users report "disable jump or walk in one click", but these are internal names subject to change.
  3. Fork: set `StarterPlayer.CreateDefaultPlayerModule = false` (`NotScriptable`; only visible when the Workspace flag is enabled) and ship your own PlayerModule. This also stops `RbxCharacterSounds` injection.
- Staff recommend against depending on PlayerModule internals because they are "subject to future updates" `[Ann]`. Before the IAS PlayerScripts existed, staff said overriding the default Jump through IAS was "still working on this" `[Staff 2025-09-19]`. It is now possible through options 1–3.
- With the legacy PlayerScripts, the default controls are CAS-based, and your IAS actions cannot sink them (see §6.3).

---

## 7. roblox-ts typings (`@rbxts/types@1.0.955`)

Files: `node_modules/@rbxts/types/include/generated/None.d.ts` (classes) and `generated/enums.d.ts` (enums). JSDoc is stripped here; the member signatures are **verbatim**.

```ts
// None.d.ts — all four are in `interface CreatableInstances` → new Instance("InputContext") etc. is valid.
interface InputContext extends Instance {
    readonly _nominal_InputContext: unique symbol;
    Enabled: boolean;
    Priority: number;
    Sink: boolean;
}

interface InputAction extends Instance {
    readonly _nominal_InputAction: unique symbol;
    DisplayName: string;
    Enabled: boolean;
    readonly PreferredBinding: InputBinding | undefined;
    Type: Enum.InputActionType;
    /** @deprecated Use InputBinding:Fire() with a Scriptable binding instead. */
    Fire(this: InputAction, state: unknown): void;
    GetState(this: InputAction): unknown;
    readonly Pressed: RBXScriptSignal<() => void>;
    readonly Released: RBXScriptSignal<() => void>;
    readonly StateChanged: RBXScriptSignal<(value: unknown) => void>;
}

interface InputBinding extends Instance {
    readonly _nominal_InputBinding: unique symbol;
    Backward: Enum.KeyCode;
    ClampMagnitudeToOne: boolean;
    DisplayImage: Content;
    DisplayName: string;
    Down: Enum.KeyCode;
    Forward: Enum.KeyCode;
    KeyCode: Enum.KeyCode;
    Left: Enum.KeyCode;
    PointerIndex: number;
    PressedThreshold: number;
    PrimaryModifier: Enum.KeyCode;
    ReleasedThreshold: number;
    ResponseCurve: number;
    Right: Enum.KeyCode;
    Scale: number;
    SecondaryModifier: Enum.KeyCode;
    Type: Enum.InputBindingType;
    UIButton: GuiButton | undefined;
    UIModifier: GuiButton | undefined;
    Up: Enum.KeyCode;
    Vector2Scale: Vector2;
    Vector3Scale: Vector3;
    Fire(this: InputBinding, state: unknown): void;
}

interface InputActionLabel extends GuiObject {
    readonly _nominal_InputActionLabel: unique symbol;
    FontFace: Font;
    ImageColor3: Color3;
    ImageTransparency: number;
    InputAction: InputAction | undefined;
    readonly ResolvedImageContent: Content;
    readonly ResolvedText: string;
    TextColor3: Color3;
    TextSize: number;
    TextTransparency: number;
    TextWrapped: boolean;
    TextXAlignment: Enum.TextXAlignment;
    TextYAlignment: Enum.TextYAlignment;
}

// UserInputService
readonly PreferredInput: Enum.PreferredInput;
GetImageForKeyCode(this: UserInputService, keyCode: CastsToEnum<Enum.KeyCode>): ContentId;
GetStringForKeyCode(this: UserInputService, keyCode: CastsToEnum<Enum.KeyCode>, format?: CastsToEnum<Enum.KeyCodeStringFormat>): string;

// GuiObject
InputSink: Enum.InputSink;
```

```ts
// enums.d.ts (shape; each item is an interface with literal Name/Value)
export type InputActionType =
    InputActionType.Bool            // Name "Bool", Value 0
  | InputActionType.Direction1D     // 1
  | InputActionType.Direction2D     // 2
  | InputActionType.Direction3D     // 3
  | InputActionType.ViewportPosition; // 4
export type InputBindingType = InputBindingType.Automatic /*0*/ | InputBindingType.Scriptable /*1*/;
export type PreferredInput = PreferredInput.KeyboardAndMouse /*0*/ | PreferredInput.Gamepad /*1*/ | PreferredInput.Touch /*2*/ | PreferredInput.MicroGamepad /*3*/;
export type InputSink = InputSink.None /*0*/ | InputSink.Activate /*1*/ | InputSink.All /*100*/;
// KeyCode: `None` (value 0) + `/** @deprecated renamed to None */ export const Unknown: None;`
//          `TouchPosition` (1034) + `/** @deprecated renamed to TouchPosition */ export const Touch: TouchPosition;`
//          All IAS KeyCodes from §3 (Thumbstick1Up…, MouseLeftButton…, MousePosition, MouseWheel, TrackpadPan,
//          TrackpadPinch, MouseDelta, TouchDelta, TouchPinch, ButtonCenter/Back/Up/Down/Left/Right) are present.
```

**Gaps and caveats in the typings**

- **No missing public members.** Every script-accessible member in the reference and the dump is present, including the new `InputBindingType`, `Fire`, modifiers, `UIModifier`, `ClampMagnitudeToOne`, `Vector3Scale`, `PreferredBinding`, `DisplayName`/`DisplayImage` and `InputActionLabel`. The correctly absent ones are the non-scriptable debug `*State` properties and the `RobloxScriptSecurity` members `GetInputActions`, `InputActionsChanged`, `GetInputBindings`, `GetPreferredBindingList` and `InputBindingsChanged`.
- **Weak value typing:** `GetState(): unknown`, `StateChanged: (value: unknown)`, and `Fire(state: unknown)` on both classes. Nothing links the value type to `InputAction.Type`. The library must cast or provide typed wrappers (see §8.2).
- `Pressed`/`Released` are typed `() => void`, which is correct; they carry no payload or binding.
- `InputAction.DisplayName` and `InputBinding.PointerIndex` have no description in the JSDoc. `PointerIndex` is undocumented upstream.
- `InputAction.Fire` is marked `@deprecated`, so ESLint or TS will flag its use.
- Watch for `Enum.KeyCode.Unknown` in existing code: it is now a deprecated alias of `Enum.KeyCode.None`.
- The `PluginSecurity.d.ts` entries for these classes are empty placeholder interfaces (normal for the generator).

---

## 8. Code examples

### 8.1 Luau: build a context in code and listen

```lua
--!strict
-- Client: LocalScript in StarterPlayerScripts, or Script with RunContext = Client.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local context = Instance.new("InputContext")
context.Name = "GameplayContext"
context.Priority = 2000   -- above the default PlayerScripts contexts (guide example)
context.Sink = true       -- lower contexts will not see keys bound here

-- Bool action with keyboard, gamepad and on-screen button
local jump = Instance.new("InputAction")
jump.Name = "Jump"
jump.Type = Enum.InputActionType.Bool
jump.Parent = context

local jumpKey = Instance.new("InputBinding")
jumpKey.Name = "Keyboard"
jumpKey.KeyCode = Enum.KeyCode.Space
jumpKey.Parent = jump

local jumpPad = Instance.new("InputBinding")
jumpPad.Name = "Gamepad"
jumpPad.KeyCode = Enum.KeyCode.ButtonA
jumpPad.Parent = jump

local jumpTouch = Instance.new("InputBinding")  -- separate binding: UIButton is ignored when KeyCode is set
jumpTouch.Name = "Touch"
jumpTouch.UIButton = Players.LocalPlayer:WaitForChild("PlayerGui"):WaitForChild("HUD"):WaitForChild("JumpButton") :: GuiButton
jumpTouch.Parent = jump

-- Chord: LeftControl + LeftShift + S
local save = Instance.new("InputAction")
save.Name = "QuickSave"
save.Parent = context
local saveKey = Instance.new("InputBinding")
saveKey.KeyCode = Enum.KeyCode.S
saveKey.PrimaryModifier = Enum.KeyCode.LeftControl
saveKey.SecondaryModifier = Enum.KeyCode.LeftShift
saveKey.Parent = save

-- Direction2D: WASD composite + left stick + scriptable (custom virtual stick)
local move = Instance.new("InputAction")
move.Name = "Move"
move.Type = Enum.InputActionType.Direction2D
move.Parent = context

local wasd = Instance.new("InputBinding")
wasd.Name = "Keyboard"          -- KeyCode stays None, otherwise composites are ignored
wasd.Up, wasd.Down, wasd.Left, wasd.Right = Enum.KeyCode.W, Enum.KeyCode.S, Enum.KeyCode.A, Enum.KeyCode.D
wasd.Parent = move

local stick = Instance.new("InputBinding")
stick.Name = "Gamepad"
stick.KeyCode = Enum.KeyCode.Thumbstick1
stick.ResponseCurve = 2
stick.Parent = move

local virtualStick = Instance.new("InputBinding")
virtualStick.Name = "Virtual"
virtualStick.Type = Enum.InputBindingType.Scriptable
virtualStick.Parent = move

-- Parent last (hygiene; not documented as required). Under Server Authority, parent under the Player instead.
local folder = ReplicatedStorage:FindFirstChild("Inputs") or Instance.new("Folder")
folder.Name = "Inputs"
folder.Parent = ReplicatedStorage
context.Parent = folder

jump.Pressed:Connect(function() print("jump down") end)
jump.Released:Connect(function() print("jump up") end)
move.StateChanged:Connect(function(value: Vector2) print("move ->", value) end)

RunService.RenderStepped:Connect(function(dt)
	local v = move:GetState() :: Vector2   -- poll for continuous input
end)

virtualStick:Fire(Vector2.new(0, 1))  -- custom UI drives the action
virtualStick:Fire(Vector2.zero)       -- always fire zero on release

jumpKey.KeyCode = Enum.KeyCode.F      -- runtime rebind, takes effect immediately
context.Enabled = false               -- held bool actions receive a final Released
```

### 8.2 roblox-ts: same, with a typed state helper

```ts
import { ReplicatedStorage, RunService, UserInputService } from "@rbxts/services";

// Map InputActionType -> Lua value type (the typings give `unknown`).
type ActionValueByName = {
	Bool: boolean;
	Direction1D: number;
	Direction2D: Vector2;
	Direction3D: Vector3;
	ViewportPosition: Vector2;
};
type ActionValue<T extends Enum.InputActionType> = ActionValueByName[T["Name"]];

function makeAction<T extends Enum.InputActionType>(name: string, actionType: T, parent: InputContext) {
	const action = new Instance("InputAction");
	action.Name = name;
	action.Type = actionType;
	action.Parent = parent;
	return action as InputAction & { Type: T };
}

function getState<T extends Enum.InputActionType>(action: InputAction & { Type: T }): ActionValue<T> {
	return action.GetState() as ActionValue<T>;
}

const context = new Instance("InputContext");
context.Name = "GameplayContext";
context.Priority = 2000;
context.Sink = true;

const jump = makeAction("Jump", Enum.InputActionType.Bool, context);
const jumpKey = new Instance("InputBinding");
jumpKey.KeyCode = Enum.KeyCode.Space;
jumpKey.Parent = jump;
const jumpPad = new Instance("InputBinding");
jumpPad.KeyCode = Enum.KeyCode.ButtonA;
jumpPad.Parent = jump;

const move = makeAction("Move", Enum.InputActionType.Direction2D, context);
const wasd = new Instance("InputBinding");
wasd.Up = Enum.KeyCode.W;
wasd.Down = Enum.KeyCode.S;
wasd.Left = Enum.KeyCode.A;
wasd.Right = Enum.KeyCode.D;
wasd.Parent = move;
const stick = new Instance("InputBinding");
stick.KeyCode = Enum.KeyCode.Thumbstick1;
stick.Parent = move;
const virtualStick = new Instance("InputBinding");
virtualStick.Type = Enum.InputBindingType.Scriptable;
virtualStick.Parent = move;

const look = makeAction("Look", Enum.InputActionType.Direction2D, context);
const mouseLook = new Instance("InputBinding");
mouseLook.KeyCode = Enum.KeyCode.MouseDelta;
mouseLook.Scale = 0.01; // pixels -> reasonable range (guide)
mouseLook.Parent = look;

const inputs = (ReplicatedStorage.FindFirstChild("Inputs") as Folder | undefined) ?? new Instance("Folder");
inputs.Name = "Inputs";
inputs.Parent = ReplicatedStorage;
context.Parent = inputs; // under Server Authority: parent under a Player instead

jump.Pressed.Connect(() => print("jump down"));
jump.Released.Connect(() => print("jump up"));
move.StateChanged.Connect((value) => print("move ->", value as Vector2));

RunService.RenderStepped.Connect((dt) => {
	const moveVec = getState(move); // Vector2
	const lookDelta = getState(look).mul(dt);
});

virtualStick.Fire(new Vector2(0, 1));
virtualStick.Fire(Vector2.zero);

// Device-aware hint text
const refreshHint = () => {
	const binding = jump.PreferredBinding;
	const text =
		binding === undefined
			? ""
			: binding.DisplayName !== ""
				? binding.DisplayName
				: UserInputService.GetStringForKeyCode(binding.KeyCode);
	print(`[${UserInputService.PreferredInput.Name}] jump = ${text}`);
};
jump.GetPropertyChangedSignal("PreferredBinding").Connect(refreshHint);
UserInputService.GetPropertyChangedSignal("PreferredInput").Connect(refreshHint);
refreshHint();

// Focus-loss hygiene (IAS has no reset API): toggling Enabled resets action state.
UserInputService.TextBoxFocused.Connect(() => {
	context.Enabled = false;
});
UserInputService.TextBoxFocusReleased.Connect(() => {
	context.Enabled = true;
});
```

---

## 9. Open questions (UNVERIFIED; test in Studio before designing around them)

1. How simultaneous bindings aggregate: OR for Bool; sum, last-write or max for directional (§1.6).
2. Whether modifier matching is exclusive (does `C` fire during Ctrl+C?) and whether chords shadow each other.
3. Whether `Fire()` values are post-processed (`Scale`, curve, clamp), how they combine with hardware bindings, and whether they persist until re-fired.
4. Delta sources (`MouseDelta`, `MouseWheel`, `TouchDelta`, `TrackpadPan` and pinches): units, per-frame versus per-second, and return to zero. Also the RMB-gating report on `MouseDelta`.
5. Priority and Sink of the implicit default context and of the default PlayerScripts contexts.
6. Sinking edge cases: disabled actions, unmet modifiers, Scriptable bindings, `GuiObject.InputSink` modes, GuiService selection mode, and whether IAS sinks CAS or UIS (`gameProcessedEvent`).
7. Whether events fire on the server under Server Authority (docs show polling only).
8. `PointerIndex` semantics, and the `PreferredBinding` selection rule when several bindings fit one device.
9. Whether contexts parented to `nil` or inside StarterGui templates are active, and whether they produce duplicates alongside their PlayerGui copies.
10. The release status of `InputActionLabel` (Studio beta, non-publishable, as of 2026-08/09), and when `InputBindingType.Scriptable` shipped.
