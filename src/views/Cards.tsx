import { useDeferredValue, useMemo, useState } from 'react';
import { useNow } from '../App';
import { cardStatus, findCards, statusLabel, type Show } from '../lib/browse';
import type { Store } from '../store';
import { plural } from './Home';

const SHOWS: [Show, string][] = [
  ['all', 'All cards'],
  ['due', 'Due today'],
  ['new', 'New'],
  ['suspended', 'Suspended'],
];
// Thousands of rows would make every keystroke slow; a search narrows it down instead.
const LIMIT = 100;

/** One line of plain text from card Markdown, for the list. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function Cards({ store, initialShow }: { store: Store; initialShow: string | null }) {
  const now = useNow();
  const { cards, states, suspended } = store.data;
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>(SHOWS.some(([s]) => s === initialShow) ? (initialShow as Show) : 'all');
  const search = useDeferredValue(query);
  const found = useMemo(() => findCards(cards, states, suspended, now, search, show), [cards, states, suspended, now, search, show]);

  return (
    <>
      <h1>Cards</h1>
      <p className="muted">Find a card, see when it is due, and suspend the ones you do not want to review. A suspended card keeps its progress and comes back when you unsuspend it.</p>
      <div className="filters" role="search">
        <label>
          Search
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Question, answer, deck or #tag" />
        </label>
        <label>
          Show
          <select value={show} onChange={(e) => setShow(e.target.value as Show)}>
            {SHOWS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted" role="status">
        {found.length > LIMIT ? `Showing the first ${LIMIT} of ${found.length} cards. Search to narrow them down.` : plural(found.length, 'card')}
      </p>
      {found.length > 0 && (
        <ul className="browse">
          {found.slice(0, LIMIT).map((card) => {
            const status = cardStatus(states.get(card.id), suspended.has(card.id), now);
            const off = status.kind === 'suspended';
            const question = oneLine(card.front);
            return (
              <li key={card.id} className={off ? 'off' : undefined}>
                <div className="text">
                  <p className="q">{question}</p>
                  <p className="a muted">{oneLine(card.back)}</p>
                  <p className="meta muted">
                    <span className={`status ${status.kind}`}>{statusLabel(status, now)}</span>
                    {/* The deck is usually the note's path; name it only when front matter chose another. */}
                    {card.source.replace(/\.[^./]+$/, '') !== card.deck && ` · ${card.deck}`} · {card.source}, line {card.line}
                  </p>
                </div>
                <button onClick={() => void store.suspend([card.id], !off)} aria-label={`${off ? 'Unsuspend' : 'Suspend'}: ${question.slice(0, 80)}`}>
                  {off ? 'Unsuspend' : 'Suspend'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
