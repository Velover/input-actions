---
paths:
  - "src/*/network.ts"
  - "src/server/middleware/**/*.ts"
  - "src/server/services/**/*.ts"
  - "src/client/controllers/**/*.ts"
---

# Flamework v2: networking

For anything not covered here, read
`node_modules/@flamework-experimental/core/docs/guide/06-networking.md`. Step 10 of
`node_modules/@flamework-experimental/core/docs/guide/10-migrating-from-v1.md` lists what changed
since v1.

## Declaring

- `src/shared/network.ts` declares everything: `GlobalEvents = Networking.createEvent<A, B>()` and
  `GlobalFunctions = Networking.createFunction<A, B>()`. `A` is what the **server receives**, `B`
  what the client receives. The interfaces are named for the direction: `ClientToServerEvents`,
  `ServerToClientEvents`, `ClientToServerFunctions`.
- Use an event for a one-way message, and a function only when the caller needs an answer. Avoid
  server-to-client functions: a client can stall or lie.
- Group a feature's members under a key (`shop: { buy(itemId: string): void }`). Middleware nests
  the same way.
- `Networking.Unreliable<(...) => void>` for frequent state that may be dropped, such as positions.
  Send state, not deltas.

## Using

- Import `Events`/`Functions` from `server/network` or `client/network`, never `GlobalEvents` or
  `GlobalFunctions`. Each realm's file creates its handlers once: the first `createServer` or
  `createClient` call wins, and later calls silently ignore their config and middleware.
- The config and the `middleware` tree must be object literals written inline: the transformer
  reads them when you build.
- Server: `Events.x.fire(player, ...)`, `.fire([a, b], ...)`, `.broadcast(...)`,
  `.except(player, ...)`; receive with `Events.y.connect((player, ...) => {})`;
  answer with `Functions.z.setCallback((player, ...) => value)`.
- Client: `Events.y.fire(...)`, `Events.x.connect((...) => {})`, and `Functions.z.invoke(...)`,
  which returns a Promise (30 s timeout, or `invokeWithTimeout`). Handle its rejection.
- Connect in a provider's `onStart`. `connect` returns a `Networking.Connection`, not an
  `RBXScriptConnection`.

## Trust

- The parameter types become guards, and a call whose arguments fail them is dropped. Guards check
  the shape, not the meaning: the handler still checks ownership, cost, cooldown and distance.
  Never trust what a client sends.
- Rate-limit every client-to-server member, in `middleware` in `src/server/network.ts`:
  `throttle(seconds)` for an event and `throttleFunction(seconds)` for a function, both from
  `src/server/middleware/throttle.ts`. Game rules belong in the handler, not in middleware.

## Writing middleware

- A middleware is a factory `(processNext, event) => (player, ...args) => result`, typed
  `Networking.EventMiddleware<Args>` or `Networking.FunctionMiddleware<Args, Result>`.
- `processNext(player, ...args)` returns the next link's result directly, not a Promise. To drop an
  event, return without calling it. A function middleware returns `Networking.Skip` instead, and
  the caller's Promise rejects with `Cancelled`.
- `player` is optional in the type because the client shares it; on the server it is always there.

## Config

- `networking.serialization` in `flamework.config.json` packs every payload into a buffer. It is
  off here. Both realms build from one config, so they always agree on the format.
- To pack one heavy member with the switch off, mark it: `Networking.SerializedReliable<...>` or
  `SerializedUnreliable<...>` for an event, `Networking.Serialized<...>` for a function (`Raw*`
  does the opposite). The build refuses a call that may reach members packed differently, such as
  a helper returning either a `Serialized` member or a plain one.
- With `transformer.obfuscation` on, remote names change with every build: never look a remote up
  by name.
