import { useEffect, useMemo, useRef, useState } from 'react';
import { useNow } from '../App';
import { readDropped, readPicked, type ReadResult } from '../lib/files';
import { planImport } from '../lib/importer';
import { buildQueue, newSeenToday } from '../lib/scheduler';
import { deckRows, inDeck, reviewsToday, streak } from '../lib/stats';
import type { Store } from '../store';
import { Modal } from './Modal';

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Home({ store }: { store: Store }) {
  const now = useNow();
  const { cards, states, logs, settings, suspended } = store.data;
  const queue = buildQueue(cards.filter((c) => !suspended.has(c.id)), states, now, Math.max(0, settings.newPerDay - newSeenToday(logs, now)));
  const fresh = queue.filter((q) => q.due === 0).length;
  const done = reviewsToday(logs, now);
  const days = streak(logs, now).current;
  const rows = useMemo(() => deckRows(cards, states, now, suspended), [cards, states, now, suspended]);
  const tags = useMemo(() => [...new Set(cards.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b)), [cards]);

  const removeDeck = (path: string, total: number) => {
    const message = `Remove "${path}" and its ${plural(total, 'card')}?\n\nReview progress is kept: importing the same notes again restores it.`;
    if (confirm(message)) void store.deleteCards(cards.filter((c) => inDeck(c, path)).map((c) => c.id));
  };

  return (
    <>
      <section className="today" aria-labelledby="today-h">
        <div>
          <h1 id="today-h">{queue.length ? `${plural(queue.length, 'card')} to study today` : cards.length ? 'Nothing left to study today' : 'No cards yet'}</h1>
          {cards.length ? (
            <p className="muted">
              {queue.length > 0 && `${[queue.length > fresh && plural(queue.length - fresh, 'review'), fresh > 0 && `${fresh} new`].filter(Boolean).join(' and ')}. `}
              {days > 0 ? `${plural(days, 'day')} in a row.` : 'Review today to start a streak.'}
            </p>
          ) : (
            <p className="muted">
              Add your Markdown notes below to make the first cards, or bring the sample deck back from <a href="#/settings">Settings</a>.
            </p>
          )}
        </div>
        {queue.length > 0 && (
          <a className="button primary" href="#/review">
            Study now
          </a>
        )}
        {/* No cards, nothing to count toward a goal. */}
        {cards.length > 0 && (
          <div className="goal">
            <progress className="bar" max={settings.dailyGoal} value={Math.min(done, settings.dailyGoal)} aria-label="Daily goal" />
            <span className="muted">
              {done} of {settings.dailyGoal} reviews for today's goal{done >= settings.dailyGoal ? ', reached' : ''}
            </span>
          </div>
        )}
      </section>

      {rows.length > 0 && (
        <section aria-labelledby="decks-h">
          <h2 id="decks-h">Decks</h2>
          <ul className="decks">
            {rows.map((row) => (
              <li key={row.path} className={row.depth ? 'sub' : undefined} style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}>
                <a href={`#/review?deck=${encodeURIComponent(row.path)}`}>
                  <span className="name">{row.name}</span>
                  {/* Three fixed slots, so the numbers line up down the list. */}
                  <span className="counts">
                    <span>{row.counts.due > 0 && <b>{row.counts.due} due</b>}</span>
                    <span>{row.counts.new > 0 && `${row.counts.new} new`}</span>
                    <span className="muted">{plural(row.counts.total, 'card')}</span>
                  </span>
                </a>
                <button className="icon" onClick={() => removeDeck(row.path, row.counts.total)} aria-label={`Remove deck ${row.path}`} title="Remove deck">
                  ×
                </button>
              </li>
            ))}
          </ul>
          {tags.length > 0 && (
            <p className="tags">
              <span className="muted">Study by tag</span>
              {tags.map((tag) => (
                <a key={tag} href={`#/review?tag=${encodeURIComponent(tag)}`}>
                  #{tag}
                </a>
              ))}
            </p>
          )}
        </section>
      )}

      <AddNotes store={store} />
    </>
  );
}

function AddNotes({ store }: { store: Store }) {
  const { cards, states, settings } = store.data;
  const [pending, setPending] = useState<ReadResult>();
  const [pasting, setPasting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const take = (reading: Promise<ReadResult>) =>
    reading.then(setPending, (e: unknown) => setStatus(`Those files could not be read: ${e instanceof Error ? e.message : String(e)}`));

  // Drop anywhere on the page.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      setDragging(false);
      void take(readDropped(e.dataTransfer));
    };
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragover', over);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', drop);
    };
  }, []);

  const plan = useMemo(
    () => pending && planImport(cards, (id) => states.has(id), pending.files, { headings: settings.headings }),
    [pending, cards, states, settings.headings],
  );

  const confirmImport = async () => {
    if (!plan) return;
    const saved = await store.importNotes(plan);
    // On failure the dialog still closes: the reason is on the page behind it.
    setStatus(
      !saved
        ? ''
        : plan.upsert.length
          ? `Imported ${plural(plan.upsert.length, 'card')} from ${plural(plan.files, 'note')}.`
          : `Removed ${plural(plan.remove.length, 'card')}.`,
    );
    setPending(undefined);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void take(readPicked(e.target.files));
    e.target.value = ''; // so picking the same file again fires a change
  };

  return (
    <section aria-labelledby="add-h">
      <h2 id="add-h">Add notes</h2>
      <div className={`drop ${dragging ? 'over' : ''}`}>
        <p>
          {/* A touch screen has nothing to drag from, so it gets the second sentence. */}
          <span className="drag">Drop Markdown files or a whole folder anywhere on this page. </span>
          <span className="tap">Pick Markdown files or paste them in. </span>
          An Obsidian vault works as it is. Nothing leaves your browser.
        </p>
        <div className="actions">
          <button onClick={() => filesInput.current?.click()}>Choose files</button>
          <button onClick={() => folderInput.current?.click()}>Choose folder</button>
          <button onClick={() => setPasting(true)}>Paste text</button>
        </div>
        <input ref={filesInput} type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={onPick} data-testid="files" />
        {/* webkitdirectory is not in React's types, but every current browser supports it. */}
        <input ref={folderInput} type="file" hidden onChange={onPick} data-testid="folder" {...{ webkitdirectory: '' }} />
      </div>
      <p role="status" className="muted">
        {status}
      </p>
      <details className="syntax">
        <summary>What makes a card</summary>
        <pre>{`Question :: Answer

The ==hidden part== of a sentence

Q: A question that needs
several lines
A: An answer that can hold code,
lists and math, up to the next blank line`}</pre>
        <p className="muted">
          Folders and file names become decks; a <code>deck:</code> line in front matter overrides them. Tags come from
          front matter and inline <code>#tags</code>.
        </p>
        <p className="muted">
          Cards written for the Obsidian Spaced Repetition plugin work too: <code>:::</code> makes a card both ways, and a
          line of <code>?</code> (or <code>??</code>) between a question and its answer makes a multi-line card.
        </p>
      </details>

      {pasting && (
        <PasteDialog
          onClose={() => setPasting(false)}
          onSubmit={(file) => {
            setPasting(false);
            setPending({ files: [file], skipped: [] });
          }}
        />
      )}

      {pending && plan && (
        <Modal
          title={plan.upsert.length ? `${plural(plan.upsert.length, 'card')} in ${plural(plan.files, 'note')}` : plan.remove.length ? 'No cards left in these notes' : 'No cards found'}
          onClose={() => setPending(undefined)}
        >
          {plan.upsert.length + plan.remove.length > 0 ? (
            <ul className="summary">
              {/* A reworded card is one removal plus one addition; report it once, as reworded. */}
              {plan.upsert.length > 0 && <li>{plan.added - plan.moves.length} new</li>}
              {plan.changed > 0 && <li>{plan.changed} changed</li>}
              {plan.unchanged > 0 && <li>{plan.unchanged} already imported, unchanged</li>}
              {plan.moves.length > 0 && (
                <li>{plan.moves.length === 1 ? '1 reworded, keeps its progress' : `${plan.moves.length} reworded, keep their progress`}</li>
              )}
              {plan.remove.length > plan.moves.length && (
                <li>{plan.remove.length - plan.moves.length} removed, no longer in these notes</li>
              )}
            </ul>
          ) : (
            <p>
              {pending.files.length
                ? `None of the ${plural(pending.files.length, 'note')} contains a line like "Question :: Answer", a Q:/A: block, a ==highlight== or a "?" line between a question and an answer.`
                : 'No .md, .markdown or .txt files were found in what you added.'}
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={settings.headings} onChange={(e) => store.updateSettings({ headings: e.target.checked })} />
            Also turn headings into questions, with the text under them as the answer
          </label>
          {plan.warnings.length + pending.skipped.length > 0 && (
            <details>
              <summary>{plural(plan.warnings.length + pending.skipped.length, 'thing')} skipped</summary>
              <ul className="warnings">
                {[...pending.skipped, ...plan.warnings].map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="actions">
            {plan.upsert.length + plan.remove.length > 0 && (
              <button className="button primary" data-autofocus onClick={() => void confirmImport()}>
                {plan.upsert.length ? `Import ${plural(plan.upsert.length, 'card')}` : `Remove ${plural(plan.remove.length, 'card')}`}
              </button>
            )}
            <button onClick={() => setPending(undefined)}>{plan.upsert.length + plan.remove.length ? 'Cancel' : 'Close'}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function PasteDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (file: { path: string; text: string }) => void }) {
  const [name, setName] = useState('Pasted notes');
  const [text, setText] = useState('');
  return (
    <Modal title="Paste notes" onClose={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const deck = name.trim().replace(/^\/+|\/+$/g, '') || 'Pasted notes';
          onSubmit({ path: `${deck}.md`, text });
        }}
      >
        <label>
          Deck name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label>
          Markdown
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={'Capital of France? :: Paris\nWater boils at ==100 °C== at sea level.'} required />
        </label>
        <p className="muted">Pasting again under the same deck name replaces that deck: cards that are not in the new text are removed.</p>
        <div className="actions">
          <button className="button primary" type="submit">
            Preview cards
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
