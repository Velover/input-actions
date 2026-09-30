# Flamework Template

A Roblox game in roblox-ts on Flamework v2. It started from the Flamework template, whose coin
example (press F to spawn a coin, touch it to collect it) is there to be replaced.

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
