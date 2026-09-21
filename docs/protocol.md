# `src/protocol.ts`, `mod/src/cortico/sts/StsMod.java`: sidecar contract

The Mod owns game reads and actions on the game thread. Its TCP server binds to
127.0.0.1. One authenticated World connection controls one game process. Frames
are UTF-8 JSON objects terminated by LF, with protocol version 1 and request IDs.
The configured token is sent only in the initial hello. Network threads enqueue
requests; they never access game objects.

## Atomic actions

| Kind | Operation | Decision boundary |
|---|---|---|
| start | Start with an unlocked character and ascension | Main menu without a resumable run |
| continue | Resume the existing save | Resume button present |
| play | Play one hand card, with one legal enemy target when required | Player turn; game canUse check |
| end_turn | Commit the player's turn | No blocking selection screen |
| use_potion | Use one potion with a legal target when required | Game canUse check |
| discard_potion | Discard one potion | Game canDiscard check |
| map | Select a reachable node or the boss | Map decision |
| event | Select one enabled event option, flip one face-down card, or spin the wheel | Event decision |
| shop | Enter the shop | Merchant room |
| buy | Buy one available card, relic, or potion | Shop inventory and sufficient gold |
| purge | Open the paid card removal selection | Shop removal available and affordable |
| rest | Select one available campfire option | Rest, smith, dig, lift, toke, recall, or mod option |
| chest | Open the current chest | Unopened chest |
| reward | Take one combat reward | Gold, card selection, potion, relic, or key |
| card_reward | Pick one reward card or Singing Bowl | Card reward screen |
| boss_relic | Pick one boss relic | Boss reward screen |
| select | Select one card | Hand/grid discard, retain, upgrade, purge, transform, or other selection |
| confirm | Confirm the current selection or proceed | Game exposes an enabled confirmation |
| cancel | Skip, leave, return, or cancel the current screen | Game exposes cancellation |
| view | Open map, deck, draw, discard, or exhaust view | In-run view keys |
| close_view | Close a read-only view | Read-only view open |
| key | Issue one in-game key as a fallback | Explicit fallback tool |
| click | Click once in game coordinates as a fallback | Explicit fallback tool |

Observation and screenshot requests are read operations. There is no automatic
choice, potion use, reward collection, end-turn, or run restart.

## Snapshot

`sessionId` identifies the Mod process. `revision` changes when the visible state
or available actions change. `ready` says whether another game action can begin.
`screen`, `game`, and `actions` carry the menu, run, room, combat, or modal state.
Actions contain IDs, kinds, labels, and visible details; native commands and game
object references stay inside the Mod. IDs are valid only with their snapshot.

The run contains act/floor, health, gold, character, ascension, visible map,
relics, deck, potions, and keys. Combat adds energy, block, powers, stance, orbs,
hand, unordered draw-pile contents, discard/exhaust piles, and visible enemy
intents. Card descriptions include resolved damage/block/magic values. Screen
state includes full event text, disabled options, prices, rewards, selection
counts, and selected cards. Face-down matching cards expose only their position.

Draw-pile order, enemy move IDs/history, RNG state, event outcomes, and invisible
intents are removed before serialization. Runic Dome hides intent damage and hit
count as well as the intent label. Snapshot collection never reveals face-down
card identities through enrichment or action labels.

## Execution and receipts

`sts_do` submits `sessionId`, `revision`, and one `actionId`. The Mod checks that
snapshot before moving the internal cursor, then checks it again immediately
before the game mutation. A human action during cursor movement invalidates the
command. A receipt is `executed`, `rejected`, or `unknown`; accepted transport
delivery is not a completion receipt. `executed` means the game accepted the
atomic input and reached a subsequent stable decision point. The receipt embeds
that state; it does not claim a card killed an enemy or a run was won.

Only one action is in flight. Requests are never replayed after timeout or
reconnect. Duplicate IDs are rejected. A timeout after input was submitted is
`unknown`; observe before deciding whether to act again. Disconnect cancels an
input still in cursor motion, but cannot undo an input already sent to the game.
World stop disconnects and leaves the game available to the operator.

State changes originating outside a tool emit `sts.state`. Tool results carry
their own snapshots; they do not generate duplicate decision events. Socket
failures emit `sts.connection`. Screenshots are PNG framebuffer captures and
include the Mod-rendered cursor without moving the operating-system pointer.
