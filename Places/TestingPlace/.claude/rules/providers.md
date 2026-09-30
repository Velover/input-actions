---
paths:
  - "src/*/runtime.*.ts"
  - "src/server/services/**/*.ts"
  - "src/client/controllers/**/*.ts"
  - "flamework.config.json"
  - "tsconfig.json"
---

# Flamework v2: providers, lifecycle, entry points

For anything not covered here, read the guides of the installed version:

- `node_modules/@flamework-experimental/core/docs/guide/03-providers.md`
- `node_modules/@flamework-experimental/core/docs/guide/04-lifecycle-events.md`
- `node_modules/@flamework-experimental/core/docs/guide/02-modules.md`, for `Dependency<T>()`
- `node_modules/@flamework-experimental/core/docs/guide/07-macros.md`, "Paths", for
  `requireModules`
- `node_modules/@flamework-experimental/core/docs/guide/09-project-structure.md`, for the layout
  and `flamework.config.json`
- `node_modules/@flamework-experimental/core/docs/guide/10-migrating-from-v1.md`, before porting v1
  code or following advice written for v1

## Shape

The `provider`, `service` and `controller` snippets expand to this, without the constructor:

```ts
import { OnStart, Provider } from "@flamework-experimental/core";

@Provider()
export class ShopService implements OnStart {
	constructor(private readonly coinService: CoinService) {}

	onStart() {}
}
```

- One decorator for both realms. A provider in `src/server/services` exists on the server only, and
  one in `src/client/controllers` on the client only, because of the entry point that registers it.
- Inject through the constructor, by type. A provider can inject:
  - the providers its own module registers;
  - `Components`, when the module includes a `ComponentPlugin`;
  - `Module`, the module itself.
- It cannot inject a component (a compile error: get it from `Components`), or a provider of the
  other realm (a runtime error: nothing in this module registers it).
- `Dependency<T>()` resolves a provider from code without a constructor, once the module has
  ignited. At a module's top level it raises, because modules load before ignition.
- Two providers that inject each other cannot both be built. Inject `Module` into one and resolve
  the other when it is used, or move what both need into a third provider.

## Lifecycle

- **constructor:** wiring only. It runs during ignition, in dependency order, and must not yield.
- **`onInit`:** once every provider is constructed, in dependency order, then `loadOrder`. It
  blocks every provider after it, and a returned Promise is awaited, so keep it short. An error
  fails ignition.
- **`onStart`:** on its own thread, in `loadOrder`. It may yield. Connect events and start work here.
- **Per frame:** `OnTick` (Heartbeat), `OnPhysics` (PreSimulation) and `OnRender` (PreRender, client
  only). They are not ordered.
- A class gets an event only through `implements OnX`. Having the method is not enough.
- `@Provider({ loadOrder: n })`: lower goes first, and the default is 1. Dependencies are still
  initialised first. Set it only when the start order really matters.
- `@Provider({ lazy: true })`: built the first time something resolves it, then gets `onInit` and
  `onStart`. For a provider that nothing needs at startup.

## Entry points

```ts
Flamework.createModule()
	.registerProviders("src/server/services")
	.includePlugin(ComponentPlugin.fromPath("src/server/components"))
	.ignite();
```

- Each realm ignites one module, in its entry point, and nothing else ignites one.
- Register a new folder in the entry point of each realm that uses it. The path is a string
  literal and a source path (`"src/..."`), under a folder `default.project.json` maps.
- A registered folder must exist, spelled as on disk, and hold a module. The build warns at the
  call otherwise. A missing folder makes the call wait forever at runtime, warning after 5 s; an
  empty one registers nothing, and waits in a fresh clone, which lacks it.
- Folders must not overlap, and registration requires every ModuleScript in them at startup.
- A folder of modules that only do their work as they load (commands that register themselves,
  say) is loaded with `requireModules("src/...")` from core: v1's `addPaths` for such a folder. A
  folder inside a registered folder needs no call.
- There is no `@Service`, `@Controller`, `@Optional`, `Flamework.addPaths` or `Flamework.ignite()`.

## Config

- `flamework.config.json` has one section per package (`transformer`, `core`, `components`,
  `networking`, and more). Keep its `$schema` line: the editor then lists every option.
- The tsconfig plugin entry holds only `"transform"` (and `"configFile"`). The build refuses
  transformer options there and names the file to move them to.
- `bun run watch` keeps the config it started with. Restart it after changing the file or `.env`.
