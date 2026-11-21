// Finding cards on the Cards page.
import { normalize, type Card } from './parser';
import { formatInterval, NEW, startOfNextDay, type CardState } from './scheduler';

export type Show = 'all' | 'due' | 'new' | 'suspended';

export type Status = { kind: 'suspended' | 'new' | 'due' } | { kind: 'later'; due: number };

export function cardStatus(state: CardState | undefined, suspended: boolean, now: number): Status {
  if (suspended) return { kind: 'suspended' };
  if (!state || state.state === NEW) return { kind: 'new' };
  return state.due < startOfNextDay(now) ? { kind: 'due' } : { kind: 'later', due: state.due };
}

export function statusLabel(status: Status, now: number): string {
  if (status.kind === 'later') return `Due in ${formatInterval(status.due - now)}`;
  return { suspended: 'Suspended', new: 'New', due: 'Due today' }[status.kind];
}

/**
 * The cards that match every word of `query` (in the question, answer, deck, note path or
 * tags, ignoring case) and the `show` filter, in note order.
 */
export function findCards(
  cards: Card[],
  states: ReadonlyMap<string, CardState>,
  suspended: ReadonlySet<string>,
  now: number,
  query: string,
  show: Show,
): Card[] {
  const words = normalize(query).split(' ').filter(Boolean);
  return cards.filter((card) => {
    if (show !== 'all' && cardStatus(states.get(card.id), suspended.has(card.id), now).kind !== show) return false;
    if (!words.length) return true;
    const text = normalize([card.front, card.back, card.deck, card.source, ...card.tags.map((t) => `#${t}`)].join('\n'));
    return words.every((w) => text.includes(w));
  });
}
