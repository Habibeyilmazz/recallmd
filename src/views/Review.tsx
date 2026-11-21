import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Card } from '../lib/parser';
import {
  afterAnswer, buildQueue, formatInterval, newSeenToday, pickNext, previewIntervals, syncQueue,
  type QueueItem, type Rating,
} from '../lib/scheduler';
import type { Store } from '../store';
import { Markdown } from './Markdown';

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Hard' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' },
];
const MORE = 10;

export function Review({ store, cards, title }: { store: Store; cards: Card[]; title: string }) {
  const { states, logs, settings } = store.data;
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  // The session's cards are chosen when it starts; answers change it through afterAnswer.
  const [session, setSession] = useState(() => {
    const now = Date.now();
    const queue = buildQueue(cards, states, now, Math.max(0, settings.newPerDay - newSeenToday(logs, now)));
    return { queue, current: pickNext(queue, now)?.id, answered: 0, total: queue.length };
  });
  // The id of the card whose answer is showing, so a card swapped in from outside starts hidden.
  const [revealedId, setRevealedId] = useState<string>();
  const undo = useRef<{ session: typeof session; run: () => void } | undefined>(undefined);
  const [canUndo, setCanUndo] = useState(false);

  // Another tab may have answered or removed some of this session's cards since it started.
  const queue = syncQueue(session.queue, states, (id) => byId.has(id), Date.now());
  const current = queue.some((q) => q.id === session.current) ? session.current : pickNext(queue, Date.now())?.id;
  const card = current ? byId.get(current) : undefined;
  const revealed = !!card && revealedId === card.id;
  const reveal = () => setRevealedId(card?.id);
  const newLeft = cards.filter((c) => !states.has(c.id)).length;

  const rate = (rating: Rating) => {
    if (!card || !revealed) return;
    const now = Date.now();
    const { next, undo: run } = store.answer(card.id, rating, now);
    const rest = afterAnswer(queue, card.id, next, now);
    undo.current = { session, run };
    setCanUndo(true);
    setSession({ ...session, queue: rest, current: pickNext(rest, now)?.id, answered: session.answered + 1 });
    setRevealedId(undefined);
  };

  const takeBack = () => {
    const last = undo.current;
    if (!last) return;
    undo.current = undefined;
    setCanUndo(false);
    last.run();
    setSession(last.session);
    setRevealedId(undefined);
  };

  const learnMore = () => {
    const more: QueueItem[] = buildQueue(cards, states, Date.now(), MORE);
    setSession({ queue: more, current: pickNext(more, Date.now())?.id, answered: session.answered, total: session.total + more.length });
  };

  // Keyboard-first: the handler reads the latest state through a ref, so it is attached once.
  const keys = useRef({ rate, takeBack, reveal, revealed, card });
  keys.current = { rate, takeBack, reveal, revealed, card };
  // Layout effect: the keys work from the first frame the card is on screen.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const target = e.target as HTMLElement;
      // e.repeat: holding Space must not answer card after card.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // flushSync: render before the next key arrives, so fast typing never acts on a stale card.
      flushSync(() => {
        if (e.key === 'Escape') {
          location.hash = '#/';
        } else if (e.key === 'z' || e.key === 'Z' || e.key === 'u') {
          k.takeBack();
        } else if (!k.card) {
          return;
        } else if (e.key === ' ' || e.key === 'Enter') {
          // A focused button or link keeps its own Space/Enter behaviour.
          if (/^(BUTTON|A|SUMMARY)$/.test(target.tagName)) return;
          e.preventDefault();
          if (k.revealed) k.rate(3);
          else k.reveal();
        } else if (k.revealed && e.key >= '1' && e.key <= '4') {
          k.rate(Number(e.key) as Rating);
        }
      });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const head = (
    <div className="review-head">
      <h1>{title}</h1>
      <p className="muted" aria-live="polite">
        {card ? `${queue.length} to go` : ''}
      </p>
      {/* Counts cards finished for today, so a card that comes back in a few minutes does not move it. */}
      <progress className="bar" max={session.total || 1} value={Math.max(0, session.total - queue.length)} aria-label="Cards finished this session" />
    </div>
  );

  if (!card) {
    return (
      <>
        {head}
        <section className="sheet done">
          <h2>{session.answered ? 'Done for today' : cards.length ? 'Nothing is due right now' : 'This deck has no cards'}</h2>
          <p>
            {session.answered > 0 && `${session.answered} ${session.answered === 1 ? 'review' : 'reviews'} done. `}
            {cards.length > 0 && 'Cards come back when FSRS expects you to be close to forgetting them.'}
          </p>
          <div className="actions">
            <a className="button primary" href="#/">
              Back to decks
            </a>
            {newLeft > 0 && (
              <button onClick={learnMore}>
                Learn {Math.min(MORE, newLeft)} more new {Math.min(MORE, newLeft) === 1 ? 'card' : 'cards'}
              </button>
            )}
            {canUndo && <button onClick={takeBack}>Undo last answer</button>}
          </div>
        </section>
      </>
    );
  }

  const intervals = revealed ? previewIntervals(states.get(card.id), Date.now(), settings.retention) : undefined;
  return (
    <>
      {head}
      <article className="sheet card" aria-label="Flashcard">
        {/* A cloze answer is the same sentence with the gap filled, so it replaces the question. */}
        {!(revealed && card.kind === 'cloze') && <Markdown text={card.front} />}
        <div aria-live="polite">
          {revealed && (
            <>
              {card.kind !== 'cloze' && <hr />}
              <Markdown text={card.back} />
            </>
          )}
        </div>
        <p className="source muted">
          {card.source}, line {card.line}
        </p>
      </article>

      {intervals ? (
        <div className="ratings" role="group" aria-label="How well did you remember?">
          {RATINGS.map(({ rating, label }) => (
            <button key={rating} className={`rating r${rating}`} onClick={() => rate(rating)}>
              <span className="label">{label}</span>
              <span className="when">{formatInterval(intervals[rating])}</span>
              <kbd>{rating}</kbd>
            </button>
          ))}
        </div>
      ) : (
        <div className="ratings">
          <button className="button primary show" onClick={reveal}>
            Show answer <kbd>Space</kbd>
          </button>
        </div>
      )}
      <p className="hint muted">
        {revealed ? 'Space also means Good. ' : ''}
        {canUndo && (
          <button className="link" onClick={takeBack}>
            Undo last answer (Z)
          </button>
        )}
      </p>
    </>
  );
}
