# Testing place for @rbxts/input-actions

A roblox-ts place on Flamework v2 whose only job is to test the package in the repository root
(`../../src`) inside Studio. The template's coin example has been removed.

## Testing the package

- `bun run test:all` builds the package from `../../` and copies it into
  `node_modules/@rbxts/input-actions` (`scripts/link-package.mjs`, also `bun run link`), then runs
  every test section in Studio under four Rojo projects:
  - `default` (`default.project.json`): legacy player scripts;
  - `ias` (`tests/ias.project.json`): `Workspace.PlayerScriptsUseInputActionSystem = Enabled`;
  - `authority` (`tests/authority.project.json`): Server Authority on (with the IAS player scripts,
    next-generation replication, fixed simulation, streaming, deferred signals);
  - `touch` (`tests/touch.project.json`): the IAS player scripts, with Studio simulating a phone
    (see [The touch pass](#the-touch-pass)).
- `bun run test`, `test:ias`, `test:authority` and `test:touch` run one project. `getProject()` from
  `@flamework-experimental/testing` returns `default`, `ias`, `authority` or `touch` inside the
  place.
- The package is not in `package.json`: the link script puts it in `node_modules`, and every test
  run refreshes it. Import it as `@rbxts/input-actions`.
- The design the package implements: `../../docs/Design/IAS-Rework.md`.
- The sections: `schema`, `rules`, `sanitize`, `presets`, `authority-mode`
  (`IsServerAuthority`) (shared); `create`, `actions`, `track-previous`, `contexts`,
  `attach-button`, `rebinding`, `saves`, `mouse`, `input-catcher`, `raw-input`, `server-authority`,
  `shared-handles` (several `Create`s on one folder, `Destroy`), `sa-release` (what reaches the
  server when the client resets an action; authority only), `real-input` (real keys and mouse
  through VirtualInput), `rebind-held` (changing a binding while its action is held, on a local
  context and on the server's copy), `touch` (taps on the simulated phone; touch only) (client);
  `server-authority` (server). The `validator-r*` and `hunter-r*` sections are reviewers'
  adversarial tests, kept as regression tests. Fixtures are in `src/shared/fixtures/`
  (`schemas.ts`; `authority.ts`, the mode each project expects and the warnings' wording;
  `skip.ts`; and `validator-r4.ts`, `validator-r5.ts` and `validator-r6.ts` for those rounds'
  sections). Project-specific tests return early under the other projects (`getProject()`).
- **Real keyboard and mouse input:** `src/client/tests/virtual.ts` wraps
  `UserInputService:CreateVirtualInput()` (Studio only; the typings return `RBXObject`, so it is
  cast to `VirtualInput`), whose input IAS treats as hardware, also with the window in the
  background. `realInput()` gives a test a `RealInput` (`Press`, `Release`, `Tap`, `MouseDown`,
  `MouseUp`, `Click`, `Wheel`, `MouseDelta`), or the reason there is none. What a test presses is
  released when the test ends, pass or fail: pressing a key or button that is already down throws,
  and a held key would leak into later tests. Rules:
  - mouse positions are screen positions, **including the GUI inset** (58 px here): use
    `screenCenter(guiObject)` for a GUI object, and `emptyPoint()` for a point over the 3D world
    clear of CoreGui and the touch controls;
  - input that would touch CoreGui throws: the top-left menu area, Escape and other keys Roblox
    reserves (VirtualInput sends gamepad KeyCodes as keyboard input, and `DPadUp`, `ButtonStart`
    throw), and anything while the Roblox menu is open;
  - `SendMouseDelta` registers only while the cursor is locked: `moveLockedMouse(real, delta)` in
    `real-input.ts` locks it through `MouseController`, and returns false when it never locks, for
    the test to skip. `SendMousePosition` doesn't register while the window is unfocused, so no
    test depends on it;
  - a window that renders nothing (display off) has no GUI layout: `clickProblem(guiObject)` says
    so, and the test skips;
  - Legacy player scripts (`default`) sink `Left`, `Right`, `I`, `O` (camera) and toggle shift lock
    on `LeftShift` through CAS: real-input tests use other keys.
- **Skipping:** a test that can't run in this state calls `skip(reason)` from
  `shared/fixtures/skip.ts` and returns. It counts as passed; the reason is a `[SKIP]` warning in
  Studio's output, just before the test's `[FWTEST]` line, and not in the terminal.
- Gamepad input, window focus and the Roblox menu can't be simulated from Luau: those paths are
  driven through Scriptable bindings (`Fire`) and the TextBox focus path.
- The server's `server-authority` provider hosts `ReplicatedStorage.InputActionsTestServer`, a
  RemoteFunction the client's section calls to have `SA_SCHEMA` (`"sa"`) or `SA_LATE_SCHEMA`
  (`"late"`, provided only after the client's `Create`, to test the stand-in swap) provided, and to
  read the server's state (`"playerModule"` reads Roblox's own `player.InputContexts` actions,
  `"copyState"` any action of the player's copy, including ones the schema doesn't mention).
- `tests/type-rules/type-rules.ts` holds the compile-time rules (`@ts-expect-error` cases). roblox-ts
  refuses those directives, so plain `tsc -p tests/type-rules` checks it (`bun run typecheck`);
  `bun run build` and `bun run test` run it, and an unused directive fails them.
- **With the display off, Studio renders nothing.** `RenderStepped` and `BindToRenderStep` never
  fire while Heartbeat keeps running at about 240 Hz; it renders again as soon as the display is
  back on. Measured on 2026-10-01 by turning the displays off during a play session: 0 render steps
  a second while off, about 150-180 while on. Long unattended runs hit this when the machine idles
  with its screen off. Minimizing the window does not stop rendering: a play session minimized as
  it opened kept rendering at about 60 fps (about 200 fps when visible). The render cadence never
  follows Heartbeat. The package's per-frame work (`src/Internal/EveryFrame.ts`) copes either way,
  and tests must too. The package's per-frame
  work (`src/Internal/EveryFrame.ts`) runs once per frame, at the render step or else at
  `PreAnimation`, so tests must hold either way; code that only binds to a render step may never
  run in a test. Such a window also has Heartbeat ticks with no `PreAnimation`, `PreSimulation` or
  `PostSimulation` (measured: 9 to 87 of 600 ticks, with nothing else running). The package's
  per-frame work skips them unless a render step lands in one (a window that renders may render in
  such a tick, and the work then runs there), so a test must not count a Heartbeat as a frame: step
  with `frame()` from `src/client/tests/helpers.ts`, which waits for a Heartbeat that follows a
  render step or a `PreAnimation`, the ticks in which the per-frame work runs.
- To try package code in a live session, go through a test (a temporary section run with
  `--sections`): `studio exec` can't `require` the package's modules directly.
- To try Luau in a live session: `rojo build -o probe.rbxl`, then
  `node_modules/.bin/flamework-test patch probe.rbxl --original tests/place.rbxlx [--project tests/authority.project.json]`,
  `studio open <patched file>`, `studio play`, `studio exec --realm client|server --script <file.luau>`,
  `studio stop`, `studio close`.

## The touch pass

`bun run test:touch` (and the last part of `bun run test:all`) runs every section with Studio
simulating an iPhone 14, so `UserInputService.PreferredInput` is `Touch` and VirtualInput's mouse
events arrive as touch: taps (`TouchPosition`), drags (`TouchDelta`), `UIButton` taps, `UIModifier`
regions. One finger only: no pinch, no multi-touch. Tests that need a mouse skip under it, and the
`touch` section runs only under it.

`flamework-test test` has no step between opening a window and playing, so `scripts/test.mjs` hands
every project named in `DEVICE_PROJECTS` (`scripts/device-test.mjs`) to `runOnDevice`, after the
other projects:

1. `flamework-test patch` makes `test.touch.rbxl` under `tests/touch.project.json`;
2. a window left open on that file by an earlier run is closed;
3. Studio is started on the file, and the run waits (up to 180 s) for it to show on the MCP proxy;
4. `flamework-test studio exec --studio test.touch.rbxl --realm edit` calls
   `game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("iphone_14")`;
5. `flamework-test studio run --studio test.touch.rbxl --realm both` runs the tests (`--sections`,
   `--realm`, `--timeout`, `--keep`, `--list` and `--json` are passed on);
6. **always**, also after a failure, a timeout or Ctrl+C, `SetDeviceAsync("default")` sets the
   device back, and the run says so (`Studio's device is back to default`);
7. the window is closed by ending the Studio process the run started (unless `--keep`).

The device is Studio's setting, not the place's: left set, it follows into every other Studio
window. If a run reports `STUDIO MAY STILL SIMULATE iphone_14`, or was killed before step 6, set it
back by hand, in any open Studio window:

- in the command bar (View > Command Bar), run
  `game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("default")`;
- or, while a window of `test.touch.rbxl` is open,
  `bunx flamework-test studio exec --studio test.touch.rbxl --realm edit --code 'game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("default") return game:GetService("StudioDeviceSimulatorService"):GetDeviceAsync()'`,
  which should print `default`.

Ctrl+C during the touch pass stops the CLI's current step; the script itself carries on to set the
device back and close the window, then rebuilds `out/` and exits with 130. The window helpers come
from flamework-test's own `cli/src/studio.ts` (finding Studio, and closing a window by the process
that opened it); the Flamework packages are pinned exactly, so that module can't move under it.

## Stack

- roblox-ts 3.0.0 (`rbxtsc`) compiles `src/` to Luau in `out/`. TypeScript is pinned to 5.5.3, the
  version roblox-ts 3.0.0 bundles.
- Rojo 7.7 (`aftman.toml`) builds the place from `default.project.json`.
- **Flamework v2 alpha**, all five pinned exactly; upgrade them together, to one release:
  - `@flamework-experimental/core`, `components`, `networking` and `testing` 2.0.0-alpha.4;
  - `@flamework-experimental/transformer` 2.0.0-alpha.5, the tsconfig plugin.
  - `testing` is in every build, not only test builds: both entry points include its
    `TestingPlugin`, which stays inert without the `testing` scope. A mismatched version breaks
    the game too.
- Not v1: `@flamework/*` and `rbxts-transformer-flamework` are v1, and the Flamework website
  (flamework.fireboltofdeath.dev) documents v1. Don't use v1 docs, or v1's API from memory.
- Package manager: bun, one lockfile (`bun.lock`).

## Flamework docs

The guides for the installed version ship inside core, in
`node_modules/@flamework-experimental/core/docs/guide/`. They are the reference for this version:
read the matching guide before you write Flamework code you are not sure of. Most of their install
commands use npm; use bun here.

| Guide                     | For                                                                         |
| ------------------------- | --------------------------------------------------------------------------- |
| `01-getting-started.md`   | install, tsconfig, Rojo mapping, entry points, common errors                |
| `02-modules.md`           | modules, ignition, `Dependency<T>()`                                        |
| `03-providers.md`         | `@Provider`, registration by folder, injection, lazy providers, `loadOrder` |
| `04-lifecycle-events.md`  | `onInit`, `onStart`, `onTick`, `onPhysics`, `onRender` and their order      |
| `05-components.md`        | components, attributes, instance trees, links, streaming, `Components`      |
| `06-networking.md`        | events, functions, middleware, serialization                                |
| `07-macros.md`            | `Flamework.id`/`createGuard`/`env`, `requireModules`, macros of your own    |
| `08-plugins.md`           | plugins                                                                     |
| `09-project-structure.md` | layout, `flamework.config.json`, obfuscation, `.env`, what to commit        |
| `10-migrating-from-v1.md` | porting v1 code, or advice written for v1                                   |
| `11-scopes.md`            | build scopes                                                                |
| `12-testing.md`           | tests that run inside the place                                             |

## Commands

- `bun install`.
- `bun run build` runs `rbxtsc`. It is the check: it must exit 0 and print no `error TS` and no
  Flamework warning. The `[Flamework]` prefix is coloured even in a log, so search for `Flamework`.
- `bun run watch` rebuilds on change. It keeps the `flamework.config.json` and `.env` it started
  with, so restart it after changing either.
- `bun run serve` runs `rojo serve` to sync into Studio, and `bun run place` builds `place.rbxl`.
  Build first: the project maps `out/` and `include/`.
- `bun run test` runs the tests in Studio; see [Tests](#tests).
- `bun run format` runs Prettier on `src/`: tabs, a width of 100, trailing commas.
- Add packages with `bun add <name>`, or `bun add -d <name>` for build tools. Add a
  `@flamework-experimental/*` package with `bun add --exact`, at the version the others are on. It
  needs no mapping: `default.project.json` maps the whole scope.

## Where things live

| Path                           | Realm  | Holds                                                               |
| ------------------------------ | ------ | ------------------------------------------------------------------- |
| `src/server/runtime.server.ts` | server | the entry point: builds and ignites the server's module             |
| `src/server/services/`         | server | `@Provider` classes, registered by `registerProviders`              |
| `src/server/components/`       | server | `@Component` classes, registered by `ComponentPlugin.fromPath`      |
| `src/server/network.ts`        | server | the server's `Events` and `Functions`, with their middleware        |
| `src/server/middleware/`       | server | networking middleware                                               |
| `src/client/runtime.client.ts` | client | the entry point: builds and ignites the client's module             |
| `src/client/controllers/`      | client | `@Provider` classes, registered by `registerProviders`              |
| `src/client/components/`       | client | `@Component` classes, registered by `ComponentPlugin.fromPath`      |
| `src/client/network.ts`        | client | the client's `Events` and `Functions`                               |
| `src/shared/network.ts`        | both   | the network declarations: `GlobalEvents`, `GlobalFunctions`         |
| `src/shared/`                  | both   | plain modules both realms import, such as `tags.ts` and `levels.ts` |

- In the place: `src/server` is `ServerScriptService.TS`, `src/client` is
  `StarterPlayer.StarterPlayerScripts.TS`, and `src/shared` is `ReplicatedStorage.TS`.
- Components for both realms go in `src/shared/components/`, registered from both entry points.
- Generated and git-ignored, never edited: `out/`, `include/` (including `include/flamework/`) and
  `flamework.build`. `flamework.config.json` is config: commit it and keep its `$schema` line.

## Tests

- `bun run test` (`scripts/test.mjs`) builds with `FLAMEWORK_SCOPES=testing` and makes `test.rbxl`.
  `flamework-test` then lays that over `tests/place.rbxlx` and runs every section in Studio, on the
  server and then on the client. It needs Studio's "MCP server" setting on, and `lune`. A failure
  exits non-zero.
- Tests live in `src/server/tests`, `src/client/tests` and `src/shared/tests` (both realms). Each
  test file is a `@Provider({ activeIn: ["testing"] })` that calls `defineTests` in `onStart`;
  `src/server/tests/players.ts` is a plain module of helpers beside them. The entry points register
  those folders only under the `testing` scope. `.claude/rules/testing.md` has the details.
- Whether the tests pass or fail, `bun run test` ends by rebuilding `out/` with `FLAMEWORK_SCOPES`
  set to nothing, so `rojo serve` and `bun run place` never ship the test host. Never put the scope
  in `.env` or `.env.local`: every other build reads them. A run stopped with Ctrl+C skips the
  rebuild, and leaves its Studio window open if Studio had started: run `bun run build`, and the next
  `bun run test` closes that window. Every run leaves `test.rbxl` and `test.patched.rbxl` behind; they are git-ignored.

## Flamework v2 rules

- Every singleton is `@Provider()` from core, on both realms. There is no `@Service` or
  `@Controller`: the entry point that registers a folder decides the realm.
- Only classes under a registered folder exist at runtime. A new folder needs its own
  `registerProviders("src/...")` or `ComponentPlugin.fromPath("src/...")` line in the entry point of
  each realm that uses it. The argument is a string literal and a source path, not a Rojo path.
- A registered folder must exist, spelled as on disk (case included), and hold a module. The build
  still passes without one, but warns at the call: `there is no such file or folder`, or
  `nothing in that folder compiles to a module`. A missing folder makes the call wait forever at
  runtime, warning after 5 s that it `is still waiting for its folder`. An empty folder is copied
  into the place and registers nothing, but git keeps no empty folder, so a fresh clone lacks it and
  waits.
- Registered folders must not overlap (`src/server` and `src/server/services`): ignition raises
  `provider ID was registered more than once`.
- Registration requires every ModuleScript under a registered folder at startup. A module that
  errors at its top level fails ignition. Keep modules that are neither providers nor components
  outside those folders, as `network.ts` and `middleware/` are. The exception is a plain helper
  that does nothing as it loads and serves only that folder, such as `src/server/tests/players.ts`.
- Classes are found whether exported or not, if declared at the top level of a file or namespace.
  Export them anyway when another file, or a test, imports them.
- Inject providers through the constructor. `Dependency<T>()` is for code without a constructor,
  once the module has ignited; never call it at a module's top level.
- Components attach only after every provider's `onStart` has run to its first yield. In a
  provider's `onStart`, `getAllComponents<T>()` finds none yet: use `onComponentAdded<T>()`.
- Settings go in `flamework.config.json`, one section per package. The tsconfig plugin entry holds
  only `"transform"` (and `"configFile"`, to move that file); the build refuses any other key.

## Gotchas

- Most of Flamework's API is macros that the transformer fills in. Without the transformer they
  are silently `nil`: read the emitted Luau in `out/` when an argument is unexpectedly missing.
- Keep TypeScript at the version roblox-ts bundles. Any other version makes every build warn
  `TypeScript version differs`, and the editor checks with a different compiler than the build.
- `default.project.json` maps all of `node_modules/@flamework-experimental` in one line, which needs
  transformer 2.0.0-alpha.5 or later (older ones put their JSON schemas in ReplicatedStorage). The
  place gets an empty `transformer` Folder, and core's guides as two empty Folders, `core.docs`
  and `core.docs.guide`: all expected.
- The build is not incremental, so an upgraded transformer just rebuilds. With `incremental` on,
  the first build after an upgrade stops with
  `Project was compiled on different version of Flamework` and names the tsbuildinfo to delete;
  delete it and build again.
- Line endings are LF everywhere: `.gitattributes` sets `eol=lf`, which overrides `core.autocrlf`.
- Shared modules run on both realms, and `Players.LocalPlayer` is undefined on the server. Guard
  realm-specific top-level code with `RunService.IsServer()`/`IsClient()`.
