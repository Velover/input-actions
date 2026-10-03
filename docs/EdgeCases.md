# Edge cases

Behaviour you meet only in unusual setups or at unusual moments: several root handles on one
folder, a held action whose bindings change, `Destroy` while events are on their way, and the
Server Authority swap step by step. The everyday behaviour is in [Advanced](Advanced.md), and the
everyday tasks in the [Guide](Guide.md).

- [Several root handles on one folder](#several-root-handles-on-one-folder)
- [Destroy](#destroy)
- [Held actions and binding changes](#held-actions-and-binding-changes)
- [Releasing on the server](#releasing-on-the-server)
- [The Server Authority swap](#the-server-authority-swap)
- [Captures](#captures)
- [Labels attached more than once](#labels-attached-more-than-once)
- [Gestures and releases the player didn't make](#gestures-and-releases-the-player-didnt-make)
- [Saves cleaned on the server](#saves-cleaned-on-the-server)
- [What Roblox sends for a pad](#what-roblox-sends-for-a-pad)

## Several root handles on one folder

`Create` twice on the same folder adopts the same instances and creates nothing twice. The root
handles then share them:

- A context has one enabled state (base state and requests) whichever handle changes it, and every
  handle on a binding has the same defaults.
- **`BindingsChanged` fires on every root handle that has the binding.** A rebind, an import or a
  reset through one root handle changes what the others read (`Get`, `Describe`), so their
  `BindingsChanged` fires too, each with its own path for the binding; so does a later `Create` that
  fills a device the earlier schema left out, and the Server Authority swap when it writes a
  stand-in's rebinds onto a binding another root handle has on the copy, or moves the stand-in's
  root handle onto such a binding that reads otherwise than its own did (the other root handle's
  rebinds, its keys for a device the stand-in's schema left out). A HUD's hint refreshed on its own
  root handle's `BindingsChanged` follows a menu's rebinds made through another.
- Destroying one root handle leaves what another still uses (instances, held input, requests). What
  the package made goes with the last root handle that uses it.
- **The fill rule.** When a later schema names a device an earlier one left out, it fills that
  device's unbound binding: its keys become the defaults of every handle on it (a player's rebind
  made meanwhile stays). The keys decide: a tuning or a name given to the unbound binding meanwhile
  (`Set({ PressedThreshold: 0.25 })`, a save's entry without a key) stays on top of what the schema
  fills in, so a save loaded before the later `Create` ends as one loaded after it; a key the
  player set keeps the binding as the player left it.
- A `Create` that gives an action a binding it didn't have (a Scriptable slot, or a template's
  binding) or fills one releases the action if it is held, as `AttachButton` does (see
  [Held actions and binding changes](#held-actions-and-binding-changes)).
- **Extras.** Each root handle gets or makes the extras its own schema declares, and only those
  are on its handles; one that the other's schema doesn't declare stays out of the other's handles,
  saves and resets, and goes with the root handle that has it. Two schemas that declare the same
  extra share it, with the first one's defaults (what exists wins). A later schema whose namespace
  names a device an earlier one left out fills its unbound binding with `Main` (a `Main: {}` fills
  it with no keys), and makes its extras. Making an extra for an action that is held releases it,
  as any binding added does.
- **`Destroy` on an action another root handle still uses** lets go of what the destroyed handle
  held itself: a value its `Fire`, `Tap` or Scriptable slots left goes back to rest, unless the
  package fired a value after it (IAS shows the last write), even an equal one on another binding.
  A value another live handle fired too, on the same binding, stays: IAS ignored that repeat, but
  the value is that handle's as well. Its attached buttons go too, and so do the bindings only it
  has (its own slots, the template's bindings it cloned). A binding destroyed while it holds its
  action would leave the action stuck on, so, as when a held button is detached, the action is
  released if it is not at rest and nothing the other handles fired holds it. A value they fired
  holds it only while the action shows the last one they fired: a key or a button that wrote after
  it holds the action instead. IAS doesn't tell which binding holds an action, so that also lets go
  of a key held through a binding the other handles keep, until the key is pressed again. On the
  server's copy the release is the pair of [Releasing on the server](#releasing-on-the-server);
  elsewhere it is an `InputAction.Enabled` toggle once the bindings are gone, as below, after which
  a value the other handles fired before counts again when fired again. The other root handles'
  gestures take that release for a reset, not the player's: no tap or long press comes of it, and a
  hold in progress is cancelled.
- Root handles made before a Server Authority context's copy arrives share one stand-in, and swap
  together (see [The Server Authority swap](#the-server-authority-swap)).

## Destroy

What `Destroy` undoes is in [Get-or-create in detail](Advanced.md#get-or-create-in-detail). Two
details:

- **An event on its way.** Under Deferred signals, an event a handle fired before `Destroy` that
  Roblox had not delivered yet, such as the `LinkedToServer` of a swap in the same frame, still
  reaches the listeners connected then: destroying a signal doesn't take back a delivery on its
  way, while disconnecting a connection does. Disconnect your own connections first when such a
  late call matters; a `WhenLinkedToServer` callback never runs after `Destroy`.
- **An action left held.** A binding `Destroy` removes while a key or a button holds its action
  would leave the action stuck on in IAS. So an action that stays after `Destroy` (an adopted one,
  or one of the server's copy) and is still not at rest once the package's bindings are gone is
  reset (`InputAction.Enabled` toggled), whatever its type: a key held through the package's binding
  doesn't keep a `Move` or a `Jump` held after the handle is gone. An action another root handle
  still uses is released instead (see [above](#several-root-handles-on-one-folder)).

## Held actions and binding changes

IAS resets an action's bindings when one of them changes keys or a binding is added, and a binding
destroyed while it holds its action leaves the action stuck on. What that does to a held action:

- **A change to a binding's keys** (`KeyCode`, a composite direction or a modifier, through `Set`,
  `Reset`, `Clear`, `Capture`, `CaptureChord`, an import or `ResetBindings`) while its action is held
  releases the action, whatever holds it: a key, a button, a value fired from code. IAS does that on
  a local context, even when the binding that changed isn't the one holding the action (it resets
  every binding of the action). A key still down counts again once it is pressed again, and a value
  fired from code must be fired again. On the server's copy of a Server Authority context IAS would
  keep the action held, on the client and the server, so the package releases it there, on both
  sides (see [Releasing on the server](#releasing-on-the-server)). A change that leaves the keys as
  they are (a threshold, a scale, the same key) leaves the action held.
- **Adding a binding to a held action** releases it the same way. On a local context the action is
  released at once, with one `Released`; a key still down holds it again only once it is pressed
  again, and a value fired from code must be fired again. `AttachButton` adds a binding, and so does
  a `Create` that gives an action a binding it didn't have (a device's, a Scriptable slot, a
  template's), and the first `Fire` on an action (it makes `<Action>Script`; the value it fires lands
  after the release); a `Create` that fills a device's unbound binding changes its keys. The package
  can't keep the press: a value it fired in its place would hold the action after the key comes up.
  On the server's copy IAS keeps the action held instead, and the package releases it there.
- **Removing a binding that holds its action** would leave the action stuck on, with no `Released`.
  So when a button's binding goes (the function `AttachButton` returned, or the button destroyed)
  while the action is pressed, the package resets the action (toggles `InputAction.Enabled`, after
  releasing it on the server under Server Authority). `Destroy` does the same for the bindings it
  removes (see [Destroy](#destroy)).

## Releasing on the server

Disabling a context or an action on the client releases the client's state only: the server keeps
the last value it received, and the client's own state comes back when the context is enabled
again. A value at rest written through a Scriptable binding reaches both sides, because the last
write wins. So before anything resets an action on the server's copy, the package releases it that
way:

- when the context is disabled (`SetEnabled(false)`, `Request(false)`, the focus-loss reset), the
  action is disabled (`SetEnabled(false)`), a held button binding is removed, or on `Destroy`;
- through the Scriptable bindings it drives when they hold a value (`Fire`'s `<Action>Script`, the
  schema's Scriptable slots), else, when something else holds the action (a key, a button, a binding
  you made), with a same-frame pair on `<Action>Script`: the held value, then the value at rest.
- Actions of the server's copy that the schema doesn't mention (a template's extra actions, which
  get the template's keys) are released the same way when the context is disabled, and on the
  last `Destroy`, which removes those keys: the pair goes through a binding made for it and
  removed in the same frame.

The server sees one `Released`. If you disable a context by writing `InputContext.Enabled` yourself,
or disable an action through its instance, the server keeps the state: go through the handles.
`RawInputHandler.ControlSetEnabled(false)` does the same for the PlayerModule's `CharacterContext`.

**Rebinding a held action.** On the server's copy, a change to a binding's keys while the action is
held (any binding of the action, not only the one holding it) leaves it held, on the client and the
server, until the new keys are pressed and released: IAS resets the action's bindings, and the
client's state is pressed again. A local context is released instead. So after `Set`, `Reset`,
`Clear`, `Capture`, `ImportBindings` or `ResetBindings` changes the keys of a held action, the
package fires the same-frame pair, the value it held before the change then the value at rest,
through a binding made for it and removed in the same frame. It goes after the change, because a
release before it would be undone by it; an import that changes several bindings of one action
releases it once. The values the package fired on that action are forgotten: IAS reset them too.
Write keys through the binding handles: a key you write on the instance yourself leaves the action
held.

**Adding a binding to a held action** does the same on the server's copy: IAS resets the action's
bindings, and the client's state is pressed again and stays held, on both sides, after the key comes
up. So the package fires the same pair after it adds a binding to an action that is held:
`AttachButton`, a `Create` that gives an action a binding it lacked (a device's binding, a
Scriptable slot, a template's binding) or fills a device's unbound binding, the swap moving a
stand-in's binding onto an action another handle's input holds on the copy (one pair for all of
it), and the first `Fire` on an action, which makes its `<Action>Script` binding (the fired value
lands after the pair: a press holds the action, a value at rest leaves it released). A binding you
add to the instance yourself leaves the action held.

**In a place without Server Authority** (`IsServerAuthority()` is `false`), a context marked
`ServerAuthority: true` still runs on the server's copy under the player, but that copy is an
ordinary local context there: a rebind while a key holds its action releases it once, as on any
local context, and the server never receives its state. So the package fires none of the pairs
above on it. After a rebind, IAS has released the action already, and a pair would press and
release it once more. While the mode is unknown (`undefined`), the package fires them, as under
Server Authority. `Destroy` still lets go of what it held on that copy: an action a key holds when
its binding goes is reset, as on any local context.

## The Server Authority swap

How the handles move from the local stand-in to the server's copy is in
[Server Authority](Advanced.md#server-authority). In detail:

- **What listeners hear.** At the swap each handle passes on the copy's state (a `Released`, and a
  `StateChanged` to the value at rest, when the copy doesn't show the stand-in's value yet), then
  the copy's own events, so a value fired again reads as a release and a new press, never as two
  presses in a row, and `StateChanged` never repeats a value.
- **Under Immediate signals** the swap's events run inside it: the copy's state, the held values
  fired again, the labels moving and `LinkedToServer` come once every root handle on the stand-in
  wraps the copy and `IsLinkedToServer()` is `true`. Before them come the releases of the held
  values, with everything still on the stand-in: a root handle a listener destroys there takes no
  part in the swap, and when none is left the copy stays untouched, for the next `Create` to take up
  with the template's or the schema's `Enabled`. A value a listener fires there through a
  Scriptable binding is carried over as well, and wins over the one it replaced; one it fires at
  rest stays at rest.
- **Several root handles.** Root handles made before the copy arrives (`Create` twice, with the
  same `PlayerFolderName`) share one stand-in, as they share the copy later: one enabled state, and
  one swap for all of them. A `Create` that finds the copy while other handles still wait for it
  swaps them first, so the copy takes their enabled state. After that, every handle shares the
  copy's instances and its enabled state; nothing is doubled.
- **A handle that swaps onto a copy another handle already uses** (its schema has actions the copy
  gained later) shares that handle's bindings of the same name instead of adding its own; attached
  buttons are renamed. Its rebinds and imports made on the stand-in are written onto the shared
  binding, which keeps the first handle's defaults, as with `Create` twice. So a rebind to a value
  those defaults hold is a default after the swap, and leaves the handle's export: a gamepad key a
  player gave an action whose schema left `Gamepad` out drops out when the other handle's schema
  binds the same key there. From then on the handle reads the shared binding: when that reads
  otherwise than its own did (the other handle's rebinds, its keys for a device this handle's schema
  left out), this handle's `BindingsChanged` fires for it once the swap is done, as the other
  handle's does for the rebinds written onto it. A value both handles hold on the same Scriptable
  binding stays held until neither does. A binding of its own that it brings onto an action the
  other handle's input holds releases that action, as `AttachButton` does.
- **Labels** follow the action onto the copy while they still show the stand-in's action: one
  pointed elsewhere meanwhile stays there.
- **Gestures**: a press held at the swap ends without completing (see
  [Gestures and releases the player didn't make](#gestures-and-releases-the-player-didnt-make)).
- **A server's copy whose action has another `Type`** than the schema's: `Create` warns, naming the
  path, and the context stays on its (working) stand-in.

## Captures

- **Legacy player scripts.** Under the legacy player scripts
  (`Workspace.PlayerScriptsUseInputActionSystem` off) the ControlModule sinks the gamepad's
  `ButtonA` (jump) and left stick (`Thumbstick1`, movement) through ContextActionService, always: a
  capture ignores them, and an IAS binding on them doesn't fire. Under the IAS player scripts both
  reach IAS bindings (`ButtonA`, `Thumbstick1`, `Thumbstick1Up`) and captures. A `Cancel` key is
  heard even then, so the player can always back out.
- **A gamepad menu with a GUI object selected.** The selected button takes a real pad's `ButtonA`
  (and `R2`), and a capture, which ignores input the game processed, most likely misses them: clear
  `GuiService.SelectedObject` while a capture runs. Tests with `VirtualInput` don't show this:
  `VirtualInput` sends `ButtonA` as a keyboard key, which the selection doesn't take.

## Labels attached more than once

- A label is attached to one action at a time: the last `AttachLabel`, from any action or root
  handle, takes it over, and the earlier attachment's function and `Destroy` then leave it alone.
- Each function lets go of its own attachment only: once the label was taken over, it does nothing,
  even after the label is attached to its action again.
- At the Server Authority swap a label follows the action while it still shows the stand-in's
  action; one pointed elsewhere meanwhile stays there.

## Gestures and releases the player didn't make

A release the player didn't make ends a gesture without completing it (see
[Gestures](Advanced.md#gestures)). The package tells such a release by one rule: **it reset the
action itself while IAS showed it held, since the handle's previous release.** Its resets are the
context or the action turned off through their handles (`SetEnabled`, `Request`, the focus-loss
reset), a rebind or a binding added while held, the swap, and another root handle's `Destroy` letting
go of an action they share (see [above](#several-root-handles-on-one-folder)), also when that
`Destroy` turns the action off and on again before the release arrives. Whether the context is still
off when the release arrives plays no part. The answer is worked out once per release, as the
release arrives, and every gesture gets the same one, on every root handle: a gesture whose callback
turns the context off (a tap that opens a menu) changes nothing for the gestures that hear the
release after it, another root handle's included.

Under Deferred signals a press and a reset can come in one frame, before the handle hears the press:
`Fire(true)` then a rebind, a context turned off and on again at once, a first `Fire` or an
`AttachButton` in the frame a key went down, an `InputBegan` handler or per-frame code that rebinds
or disables the action as its key goes down. The release that follows is still the reset's: no tap,
and the hold is cancelled. A reset of an action that isn't held releases nothing and changes nothing:
a key let go of (or `Fire(false)`), then the context turned off, and on again or left off, in the
same frame, is the player's release (a tap), as under Immediate signals. Once the reset's release
has arrived with the action at rest, the next press is the player's again. When IAS presses the
action again by itself (on the server's copy, a rebind while the action is held presses it again
until the package releases it on both sides), that press and its release are the reset's too.

What IAS shows when the reset is made decides, and in two places it still shows the action held
after the player let go. A reset made there takes the player's release for the reset's: no tap, no
long press.

- **A key's `UserInputService.InputEnded` handler.** IAS still shows the key's action held while
  that event's handlers run (as an `InputBegan` handler sees a press first). A key-up handler that
  turns the context off (or off and on again) ends the gesture as a reset. To act on a key-up, use
  the action's `Released` or a gesture instead.
- **The server's copy of a Server Authority context**, in the simulation step after the release: the
  copy shows a key-up or a `Fire(false)` one step (1/60 s) later. `Fire(false)` then
  `Request(false)` in the same frame is no tap there, where it is one on a local context.

One case is told wrong: the player lets go and presses again, and the package resets the action, all
in one frame under Deferred signals, before the handle hears any of it. That release of the player's
is then taken for the reset's, and the reset's release for the player's (IAS doesn't say how many
presses and releases are still on their way). So is a reset followed by a new press of the player's
in the same frame: that press's release counts as the reset's.

Turn contexts and actions off through their handles: an `Enabled` written on the instance, or by
another script, resets the action without the package knowing, and its release counts as the
player's.

At the Server Authority swap a press ends so, since the copy doesn't show it yet, and a value a
Scriptable binding held is fired again on the copy, a new press; only a press the copy already shows
(another root handle's input holds it there) goes on. A release IAS makes on its own when the window
loses focus counts as the player's while `ResetOnFocusLoss` is off.

A frame that runs long (a hitch) can hold back a gesture's timer past its moment. The gestures then
go by the time each press and release arrived: a second press that arrives after a waiting tap's
`Window` keeps that tap (it fires as the press arrives, then the press counts on its own), and a
release that arrives once the press has lasted a hold's `Duration` completes the hold rather than
cancelling it.

## Saves cleaned on the server

The schema can't tell `SanitizeBindings` the `KeyCode` a binding has on the client: a binding in the
folder or the template wins over the schema's (a stick the Input Action Manager put on a device the
schema leaves out). So it keeps a `ResponseCurve` without a `KeyCode` on a `Gamepad` binding, and the
import checks it against the binding it finds. On a `KeyboardAndMouse` or `Touch` binding it is
dropped: they can't hold a thumbstick. What the client exports and loads, the server keeps.

## What Roblox sends for a pad

For a gamepad (an Xbox 360 pad), `UserInputService` sends buttons an `InputBegan`
(`Position.Z` 1) and an `InputEnded` (0), from `Gamepad1`; a stick only `InputChanged`, raw, `y`
positive up; a trigger an `InputChanged` at every change (`Position.Z`, raw), `InputBegan` only once
all the way down and `InputEnded` only once back at 0, also after a pull that never reached 1. So
code that waits for a trigger's `InputBegan` misses a partial pull: read `InputChanged`, or bind it
with IAS. Bindings and captures read the sticks and triggers past IAS's fixed deadzone (see
[IAS behaviours to know](Advanced.md#ias-behaviours-to-know)).
