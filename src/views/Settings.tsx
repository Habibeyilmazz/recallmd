import { useRef, useState } from 'react';
import { cleanSettings, makeBackup, parseBackup, type Settings as SettingsData } from '../lib/data';
import { planImport } from '../lib/importer';
import { SAMPLE, type Store } from '../store';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Settings({ store }: { store: Store }) {
  const { data } = store;
  const { settings } = data;
  const [status, setStatus] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);

  // Number fields are uncontrolled so they can be emptied while typing; valid values save at once.
  const number = (key: 'dailyGoal' | 'newPerDay') => ({
    type: 'number',
    inputMode: 'numeric' as const,
    defaultValue: settings[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = e.target.valueAsNumber;
      if (Number.isFinite(n)) store.updateSettings({ [key]: cleanSettings({ ...settings, [key]: n })[key] } as Partial<SettingsData>);
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.value = String(settings[key]);
    },
  });

  const exportProgress = () => {
    const now = Date.now();
    download(`recallmd-${new Date(now).toISOString().slice(0, 10)}.json`, JSON.stringify(makeBackup(data, now)));
    setStatus(`Exported ${data.cards.length} cards and ${data.logs.length} reviews.`);
  };

  const importProgress = async (file: File) => {
    try {
      if (file.size > 100_000_000) throw new Error('This file is too large to be a recallmd backup.');
      const backup = parseBackup(await file.text());
      const message = `Replace everything in this browser with the backup?\n\nIt holds ${backup.cards.length} cards and ${backup.logs.length} reviews. Your current ${data.cards.length} cards and ${data.logs.length} reviews will be erased.`;
      if (!confirm(message)) return;
      await store.replaceAll(backup);
      setStatus(`Restored ${backup.cards.length} cards and ${backup.logs.length} reviews.`);
    } catch (e) {
      setStatus(`Import failed. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const eraseAll = async () => {
    if (!confirm('Erase all cards, review history and settings from this browser? This cannot be undone. Export your progress first if you may want it back.')) return;
    await store.replaceAll();
    setStatus('Everything was erased.');
  };

  const addSample = async () => {
    await store.importNotes(planImport(data.cards, (id) => data.states.has(id), [SAMPLE]));
    setStatus('The sample deck is on the Decks page.');
  };

  return (
    <>
      <h1>Settings</h1>
      <section className="fields" aria-label="Study settings">
        <label>
          Daily goal
          <input {...number('dailyGoal')} min={1} max={9999} />
          <small className="muted">Reviews a day you aim for. Shown on the Decks page.</small>
        </label>
        <label>
          New cards a day
          <input {...number('newPerDay')} min={0} max={9999} />
          <small className="muted">How many cards you have never seen are added to a day's reviews.</small>
        </label>
        <label>
          Desired retention: {Math.round(settings.retention * 100)}%
          <input
            type="range"
            min={70}
            max={97}
            step={1}
            value={Math.round(settings.retention * 100)}
            onChange={(e) => store.updateSettings({ retention: e.target.valueAsNumber / 100 })}
          />
          <small className="muted">
            How likely you want to be to remember a card when it comes back. Higher means more reviews. 90% suits most
            people. Changes apply from each card's next review.
          </small>
        </label>
      </section>

      <h2>Your data</h2>
      <p className="muted">
        Cards and review history live only in this browser. Export them to back up or to move to another browser or device.
      </p>
      <div className="actions">
        <button onClick={exportProgress}>Export progress</button>
        <button onClick={() => backupInput.current?.click()}>Import progress</button>
        <button onClick={() => void addSample()}>Add the sample deck</button>
        <button className="danger" onClick={() => void eraseAll()}>
          Erase everything
        </button>
      </div>
      <input
        ref={backupInput}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="backup"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importProgress(file);
          e.target.value = '';
        }}
      />
      <p role="status">{status}</p>
    </>
  );
}
