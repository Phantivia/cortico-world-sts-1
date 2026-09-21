import { expect, it } from 'vitest';
import { renderSnapshot } from '../src/render.ts';
import { Sidecar } from './sidecar.ts';

it('keeps map and deck available in full observations without repeating them in combat receipts', () => {
  const snapshot = new Sidecar().state;
  snapshot.game!.deck = [{ id: 'card' }]; snapshot.game!.map = [{ x: 0, y: 0 }];
  const rendered = renderSnapshot(snapshot);
  expect(rendered.game).toMatchObject({ deckSize: 1, combat_state: snapshot.game!.combat_state });
  expect(rendered.game).not.toHaveProperty('deck'); expect(rendered.game).not.toHaveProperty('map');
  expect(renderSnapshot(snapshot, true)).toBe(snapshot);
  snapshot.screen = 'MAP'; expect(renderSnapshot(snapshot).game!.map).toEqual(snapshot.game!.map);
});
