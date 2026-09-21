# `src/definition.ts`: cortico-world-sts

A Cortico World for Slay the Spire. The Mod reads the game on its update thread,
executes one atomic action at a time, and renders an internal pointer with the
pixel companion used by the PvZ World. A token-authenticated loopback TCP sidecar
connects the game to the World.

## Requirements

- Cortico World API 5 and Node.js 22 or later.
- A local Slay the Spire installation, ModTheSpire, and BaseMod.
- A JDK with `javac --release 8`, `jar`, and Git on PATH for building.
- The game's bundled Java 8 runtime for launching ModTheSpire on Windows.

The extension contains no game files or third-party JARs. The build downloads
CommunicationMod source at a pinned revision and compiles it against the local
game, ModTheSpire, and BaseMod. Generated JARs remain under ignored directories.

## Installation

```powershell
pnpm install
pnpm install:mod 'G:\Steam\steamapps\common\SlayTheSpire'
```

`install:mod` builds `CommunicationMod.jar` and `CorticoSts.jar`, backs up existing
copies, and installs them in the game's `mods` directory. It also copies the local
BaseMod JAR there when absent, so launching does not depend on Steam Workshop
discovery. Stop the game before replacing loaded Mod JARs.

Install this directory as a local World extension in Cortico. Enable `worlds.sts`
and set its `gameDir`. Set `launch` to true for World-managed startup. The World
generates `CORTICO_STS_TOKEN` in the deployment's `.env` when it is missing, then
passes it and `CORTICO_STS_PORT` to the game process. The launch includes only
BaseMod, CommunicationMod, and Cortico StS. Other installed mods are not selected.

For a manually launched game, set the same `CORTICO_STS_TOKEN` (at least 24
characters) and `CORTICO_STS_PORT` in its environment, select the three Mods, and
leave `launch` false. The default port is 27831. Only 127.0.0.1 is bound.
When a World stops it disconnects; the game remains open. Re-enabling it attaches
to that game. Neither timeouts nor reconnects replay actions.

## Tools

| Tool | Result |
|---|---|
| `sts_observe` | Current visible snapshot and available action IDs; `detail:"full"` includes map and master deck |
| `sts_do` | One action bound to `sessionId`, `revision`, and `actionId`, followed by its receipt and resulting snapshot |
| `sts_capture` | PNG of the game framebuffer, including the internal cursor |
| `sts_input` | Explicit fallback for an in-game key or a click in 1920×1080 coordinates |

The action list covers starting/resuming runs, cards, potions, map travel, events,
shops, campfires, chests, rewards, grid/hand selections, confirmation, cancellation,
and view screens. Actions only appear when the game exposes them. Opening a
selection ends the current action and lets the agent make the next choice.

Draw-pile order, RNG state, enemy move IDs/history, unrevealed matching cards, and
Runic Dome-hidden intents are excluded. Visible card, potion, relic, and power
descriptions come from the installed game's language files and current state.
See [the protocol contract](docs/protocol.md) for action and receipt semantics.

`sts.state` reports externally observed decision changes. A tool's state is
returned in its receipt without a second wakeup. `sts.connection` reports loss of
the sidecar; `sts_observe` attempts a new authenticated connection.

## Validation

```powershell
pnpm test
pnpm run typecheck
pnpm build:mod '<game directory>'
# From the framework checkout:
pnpm check:extension '<extension directory>'
```

Tests use real loopback sockets and the framework's JSONL event store. They cover
framing, authentication, stale actions, cancellation, timeout, reconnect, and
World events. Game/Mod compatibility requires a local game check; automated tests
do not launch a game or a bot.

Supported integration targets Slay the Spire 12-18-2022, ModTheSpire 3.30.3, and
BaseMod 5.56.0. Third-party gameplay Mods can introduce screens or mechanics that
need additional adapters. Daily/custom run configuration and editing profiles or
game settings are outside the semantic action list.
