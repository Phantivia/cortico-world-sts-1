import type { StsSnapshot } from './protocol.ts';

/** Decision receipts omit the map and master deck unless that screen needs them; full observation preserves both. */
export function renderSnapshot(snapshot: StsSnapshot, full = false): StsSnapshot {
  if (full || !snapshot.game) return snapshot;
  const game = { ...snapshot.game };
  if (snapshot.screen !== 'MAP') delete game.map;
  if (game.combat_state) {
    if (Array.isArray(game.deck)) game.deckSize = game.deck.length;
    delete game.deck;
  }
  return { ...snapshot, game };
}
