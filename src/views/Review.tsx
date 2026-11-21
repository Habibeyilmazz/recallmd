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
  // What Z would take back: the last answer or the last suspend.
  const [undoable, setUndoable] = useState<'answer' | 'suspend'>();
  const canUndo = !!undoable;
  const latest = useRef(store);
  latest.current = store;
  // A pressed button that the next render removes would drop focus to <body>; this hands it to the button that replaces it.
  const view = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    // Scoped to the app's own bars: a note's HTML can carry these class names too.
    view.current?.querySelector<HTMLElement>('.answerbar .show, .answerbar .r3, .done .primary')?.focus();
  });
  const press = (action: () => void) => () => {
    refocus.current = true;
    action();
  };

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
    setUndoable('answer');
    setSession({ ...session, queue: rest, current: pickNext(rest, now)?.id, answered: session.answered + 1 });
    setRevealedId(undefined);
  };

  // The card leaves the session as soon as it is suspended, since App drops it from `cards`.
  const suspend = () => {
    if (!card) return;
    const { id } = card;
    void store.suspend([id], true);
    undo.current = { session, run: () => void latest.current.suspend([id], false) };
    setUndoable('suspend');
    setSession({ ...session, current: undefined });
    setRevealedId(undefined);
  };

  const takeBack = () => {
    const last = undo.current;
    if (!last) return;
    undo.current = undefined;
    setUndoable(undefined);
    last.run();
    setSession(last.session);
    setRevealedId(undefined);
  };

  const learnMore = () => {
    const more: QueueItem[] = buildQueue(cards, states, Date.now(), MORE);
    setSession({ queue: more, current: pickNext(more, Date.now())?.id, answered: session.answered, total: session.total + more.length });
  };

  // Keyboard-first: the handler reads the latest state through a ref, so it is attached once.
  const keys = useRef({ rate, takeBack, reveal, suspend, revealed, card });
  keys.current = { rate, takeBack, reveal, suspend, revealed, card };
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
        } else if (e.key === 's' || e.key === 'S') {
          k.suspend();
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
      <div className="review" ref={view}>
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
              <button onClick={press(learnMore)}>
                Learn {Math.min(MORE, newLeft)} more new {Math.min(MORE, newLeft) === 1 ? 'card' : 'cards'}
              </button>
            )}
            {canUndo && <button onClick={press(takeBack)}>Undo last {undoable}</button>}
          </div>
        </section>
      </div>
    );
  }

  const intervals = revealed ? previewIntervals(states.get(card.id), Date.now(), settings.retention, card.id) : undefined;
  return (
    <div className="review" ref={view}>
      {head}
      <article className="sheet card" aria-label="Flashcard">
        {/* A cloze answer is the same sentence with the gap filled, so it replaces the question. */}
        {!(revealed && card.kind === 'cloze') && <Markdown text={card.front} />}
        <div aria-live="polite">
          {revealed && (
            <div className={card.kind === 'cloze' ? undefined : 'answer'}>
              {card.kind !== 'cloze' && <hr />}
              <Markdown text={card.back} />
            </div>
          )}
        </div>
        <p className="source muted">
          {card.source}, line {card.line}
        </p>
      </article>

      {/* Stays at the bottom of the window, so the buttons are in one place whatever the card's length. */}
      <div className="answerbar">
        {intervals ? (
          <div className="ratings" role="group" aria-label="How well did you remember?">
            {RATINGS.map(({ rating, label }) => (
              // The key is a hint for the eye; assistive tech gets it as a shortcut, not as part of the name.
              <button key={rating} className={`rating r${rating}`} onClick={press(() => rate(rating))} aria-keyshortcuts={String(rating)}>
                <span className="label">{label}</span>
                <span className="when">{formatInterval(intervals[rating])}</span>
                <kbd aria-hidden="true">{rating}</kbd>
              </button>
            ))}
          </div>
        ) : (
          <div className="ratings">
            <button className="button primary show" onClick={press(reveal)} aria-keyshortcuts="Space">
              Show answer <kbd aria-hidden="true">Space</kbd>
            </button>
          </div>
        )}
        <p className="hint muted">
          {/* .keys is hidden where there is no keyboard. */}
          {revealed && (
            <span className="keys">
              <kbd>Space</kbd> Good
            </span>
          )}
          <span className="keys">
            <kbd>Esc</kbd> Back to decks
          </span>
          <button className="link" onClick={press(suspend)} aria-keyshortcuts="S">
            <kbd className="keys" aria-hidden="true">S</kbd> Suspend card
          </button>
          {canUndo && (
            <button className="link" onClick={press(takeBack)} aria-keyshortcuts="Z">
              <kbd className="keys" aria-hidden="true">Z</kbd> Undo last {undoable}
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
