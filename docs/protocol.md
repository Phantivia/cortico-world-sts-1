# `src/protocol.ts`, `src/render.ts`, `src/world.ts`, `mod/src/cortico/sts/StsMod.java`: StS contract

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
intents. Hand-card descriptions include current damage/block/magic values;
other card locations use base values, including upgrades, so played-card visual
resets do not change a decision revision. Screen
state includes full event text, disabled options, prices, rewards, selection
counts, and selected cards. Face-down matching cards expose only their position.
Upgrade grids include the game's card upgrade preview, including its changed
cost and effect. Confirmation repeats the selected upgraded card. A combat
decision waits for the action queues and opening intent initialization to finish.

Draw-pile order, enemy move IDs/history, RNG state, event outcomes, and invisible
intents are removed before serialization. Runic Dome hides intent damage and hit
count as well as the intent label. Snapshot collection never reveals face-down
card identities through enrichment or action labels.

## Execution and receipts

`sts_do` accepts a short `state` code and a positive integer `action`. The World
resolves that number against the snapshot last presented to the agent, verifies
the code against its current sidecar state, and submits native `sessionId`,
`revision`, and `actionId`. State codes hash both session and revision. An expired
code returns a complete current decision without submitting game input.
The Mod checks that
snapshot before moving the internal cursor, then checks it again immediately
before the game mutation. A human action during cursor movement invalidates the
command. A receipt is `executed`, `rejected`, or `unknown`; accepted transport
delivery is not a completion receipt. `executed` means the game accepted the
atomic input and reached a subsequent stable decision point. The receipt embeds
that state; it does not claim a card killed an enemy or a run was won.

Only one action is in flight. Requests are never replayed after timeout or
reconnect. Duplicate IDs are rejected. A timeout after input was submitted is
`unknown`; an exception while applying input is also `unknown`, because the game
may have already changed. Observe before deciding whether to act again. Disconnect cancels an
input still in cursor motion, but cannot undo an input already sent to the game.
World stop disconnects and leaves the game available to the operator.

## Model-facing text and events

Native JSON is rendered as Chinese descriptions. A hand card's effect appears
once beside its available action numbers and targets; identical cards are grouped
without merging their executable identities. Card types, energy symbols, relics,
powers, potions, event options, prices, selection counts, confirmation prompts,
and hidden-intent markers retain their visible
meaning. Default pile output contains counts. Full observation adds grouped card
contents and a row-by-row map whose edges point to the next row's columns. Map
decisions identify the current node. Enemy names distinguish visible red/blue
slaver variants; card receipts name newly entered hand cards.

Within the same screen, floor, and session, successful receipts include only
changed semantic sections. A new combat turn always repeats current enemy intents,
even when unchanged. Removed effects are explicitly cleared. A collected
potion or relic is named in the outcome; its effect appears in the
inventory section once. The latest
state code applies to retained action numbers as well as changed ones. Errors,
screen changes, explicit observation, and context handoff produce self-contained
decisions; deltas are not tagged as replaceable snapshots.

Only one deferred state event is pending. Its renderer reads the latest cached
sidecar snapshot at delivery and drops it if a tool has already presented that
state. Complete state events and observations carry the `snapshot` tag.
After a host turn that executed an action, `sts-1.decision` gives a short reminder
that the last decision still awaits input, without repeating the state body.
This turn-boundary fallback preserves a decision opportunity when the host ends
the tool loop at its round cap. A turn without an executed action produces none. Socket
failures emit `sts-1.connection`. Screenshots are PNG framebuffer captures and
include the Mod-rendered cursor without moving the operating-system pointer.
