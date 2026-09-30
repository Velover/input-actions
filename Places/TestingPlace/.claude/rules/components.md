---
paths:
  - "src/*/components/**/*.ts"
---

# Flamework v2: components

For anything not covered here, read
`node_modules/@flamework-experimental/core/docs/guide/05-components.md` (and `04-lifecycle-events.md`
for the events a component gets).

## Shape

The `component` snippet gives the minimal form. With attributes, a dependency and cleanup:

```ts
import { BaseComponent, Component, ComponentMetadata } from "@flamework-experimental/components";
import { OnStart } from "@flamework-experimental/core";

interface Attributes {
	Speed: number;
	Label?: string;
}

@Component({ tag: Tags.Boat, defaults: { Speed: 16 } })
export class Boat
	extends BaseComponent<Attributes, Model & { Seat: VehicleSeat }>
	implements OnStart
{
	private connection?: RBXScriptConnection;

	constructor(
		metadata: ComponentMetadata,
		private readonly boatService: BoatService,
	) {
		super(metadata);
	}

	onStart() {
		this.connection = this.instance.Seat.GetPropertyChangedSignal("Occupant").Connect(() => {});
	}

	override destroy() {
		this.connection?.Disconnect();
		super.destroy();
	}
}
```

- **Constructor:** if a component declares one, `metadata: ComponentMetadata` comes first and goes
  to `super(metadata)`. It can inject its realm's providers and `Components`, and other components
  on the same instance, which it then waits for.
- **Tag:** the instance gets the component through its CollectionService tag. A tag that other
  code uses too goes in `src/shared/tags.ts`, as `Tags.Coin` does; the `component` snippet writes
  the string inline, so move it there when that happens. A component without a tag is attached
  only by `Components.addComponent`.
- **Attributes,** the first type argument (`{}` for none), become guards. An instance whose
  attributes fail them gets no component, and an attribute that later changes to a failing value
  removes the component until it is valid again. A `defaults` entry changes both: a missing or
  invalid attribute is set to the default when the component is built, and a later bad value is
  ignored, keeping the last good one.
- **Writing** `this.attributes.Speed = 20` writes the attribute back to the instance, checked by the
  guard. It only works spelled `<component>.attributes.<name> = ...`, not through a local copy.
- **Instance tree,** the second type argument: the class and the children the instance must have.
  An optional child (`Head?: BasePart`) is a compile error: leave it out of the type and use
  `FindFirstChild`.
- **Cleanup:** `BaseComponent.destroy()` only releases its `onAttributeChanged` connections.
  Removing a tag keeps the instance, so disconnect your own connections in `override destroy()`,
  then call `super.destroy()`.
- **Both realms:** a class in `src/shared/components/` registered from both entry points, or one
  class per realm with the same tag (as `Coin` and `CoinSpin` do). They never see each other.
- **Where:** by default no component is built under ServerStorage, ReplicatedStorage, StarterPack,
  StarterGui or StarterPlayer, so a tagged template there gets none until it is cloned into the
  world (`ancestorWhitelist`/`ancestorBlacklist` change this).
- **Timing:** tagged instances get their components once the module has ignited, after every
  provider's `onStart` has run to its first yield. `onInit` runs right after construction; `onStart`
  and the per-frame events (`OnTick`, `OnPhysics`, `OnRender`) work as on providers.

## Reaching components

- Inject `Components` into a provider (`private readonly components: Components`). A provider
  cannot inject a component class, and `Dependency<SomeComponent>()` is a compile error.
- `getComponent<T>(instance)`: exact class only, and it **builds** the component if the instance
  qualifies. Use `getAllComponents<T>()` to observe without building.
- `getComponents<T>`, `getAllComponents<T>`, `onComponentAdded<T>(cb)` and
  `onComponentRemoved<T>(cb)` also accept an interface, or a superclass that carries `@Component`
  itself. A base class without its own decorator is not looked up.
- `onComponentAdded` does not replay the components that already exist. Subscribe in a provider's
  `onStart`, which runs before any tagged instance gets its component.
- `waitForComponent<T>(instance)` returns a Promise; prefer it to polling.
