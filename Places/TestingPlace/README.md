# Flamework Template

A minimal Roblox game on Flamework v2 (alpha) and roblox-ts, with Flamework's core, components and
networking. A small coin example shows each part; replace it with your game.

## Start

You need [bun](https://bun.sh), and Rojo 7.7 with its Studio plugin (`aftman install` or
`rokit install` installs the version in `aftman.toml`).

```sh
git clone <this repository> my-game
cd my-game
bun install
bun run build
rojo serve
```

Open a place in Studio (a new Baseplate will do), connect from the Rojo plugin and press Play. Press
F to spawn a coin in front of you, then walk into it: the output prints your coins and level.

`bun run watch` rebuilds as you edit, `bun run place` builds `place.rbxl`, and `bun run format`
formats `src/`.

## Layout

```
src/
  server/
    runtime.server.ts   entry point: registers the folders below and ignites
    services/           providers (server)
    components/         components (server)
    network.ts          the server's events and functions, with middleware
    middleware/         networking middleware
    tests/              tests (server)
  client/
    runtime.client.ts   entry point: registers the folders below and ignites
    controllers/        providers (client)
    components/         components (client)
    network.ts          the client's events and functions
    tests/              tests (client)
  shared/
    network.ts          the network declarations
    levels.ts, tags.ts  plain modules both realms use
    tests/              tests both realms run
tests/
  place.rbxlx           the place the tests run in
scripts/
  test.mjs              what `bun run test` runs
```

## Tests

```sh
bun run test
```

This builds the game with the `testing` scope and lays the build over `tests/place.rbxlx`. It then
runs the tests in Studio, on the server and on the client, and prints each realm's results. Last,
whatever the result, it rebuilds `out/` without the `testing` scope: the tests are still compiled
in, but nothing loads them.

- **Needs:** Studio with "MCP server" turned on in its Assistant settings, and
  [Lune](https://lune-org.github.io/docs) (in `aftman.toml`).
- **One section:** `bun run test --sections levels` runs one section, in each realm that has it.
- **Other builds:** only a test build loads the tests, so keep the `testing` scope out of `.env`
  and `.env.local`, which every build reads. A run stopped with Ctrl+C leaves the test build in
  `out/`, and its Studio window open if Studio had started: run `bun run build` before `rojo serve`. The next
  `bun run test` closes that window. Every run leaves `test.rbxl` and `test.patched.rbxl` behind;
  they are git-ignored.
- **The test place:** `tests/place.rbxlx` has what a new Baseplate place has: deferred signals, a
  baseplate and a spawn.

## Docs

The Flamework guides for the installed version are in
`node_modules/@flamework-experimental/core/docs/guide/`. Start with `01-getting-started.md`. The
Flamework website documents v1, most of which no longer applies.

`CLAUDE.md` and `.claude/rules/` are the instructions for Claude Code.

## Renaming the project

1. Set `name` in `package.json` and in `default.project.json`.
2. Change the title of this README and of `CLAUDE.md`, and the first paragraph of `CLAUDE.md`.
3. Delete the coin example: `src/*/components/coin*.ts`, `src/server/services/coin-service.ts`,
   `src/client/controllers/coin-controller.ts`, `src/shared/levels.ts`, and its members in
   `src/*/network.ts` and `src/shared/tags.ts`. Delete its tests too: `src/server/tests/coin*.ts`,
   `src/client/tests/coin-spin.ts` and `src/shared/tests/levels.ts`. Every folder an entry point
   registers must keep at least one module, or lose its line in the entry point: the build warns
   about each one that does not.
