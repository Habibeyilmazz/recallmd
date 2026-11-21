// App state: the whole dataset in memory, mirrored to IndexedDB.
import { useCallback, useEffect, useState } from 'react';
import type { AppData, Settings } from './lib/data';
import * as db from './lib/db';
import { planImport, type ImportPlan, type NoteFile } from './lib/importer';
import { NEW, schedule, type CardState, type Rating } from './lib/scheduler';
import sampleText from './sample/learn-recallmd.md?raw';

export const SAMPLE: NoteFile = { path: 'Learn recallmd in 2 minutes.md', text: sampleText };

export interface Answered {
  next: CardState;
  undo: () => Promise<void>;
}

export interface Store {
  data: AppData;
  importNotes: (plan: ImportPlan) => Promise<void>;
  answer: (id: string, rating: Rating, now: number) => Answered;
  updateSettings: (patch: Partial<Settings>) => void;
  deleteCards: (ids: string[]) => Promise<void>;
  /** Replaces everything with a backup, or erases everything when called without one. */
  replaceAll: (data?: AppData) => Promise<void>;
}

export function useStore(): { store?: Store; error?: string; clearError: () => void } {
  const [data, setData] = useState<AppData>();
  const [error, setError] = useState<string>();
  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);
  const reload = useCallback(async () => setData(await db.loadAll()), []);

  useEffect(() => {
    (async () => {
      const loaded = await db.loadAll();
      if (!loaded.cards.length && !loaded.sampleLoaded) {
        // First run: start with the sample deck instead of an empty page.
        await db.applyImport(planImport([], () => false, [SAMPLE]), loaded.states);
        await db.markSampleLoaded();
        return reload();
      }
      setData(loaded);
    })().catch(fail);
  }, [fail, reload]);

  if (!data) return { error, clearError: () => setError(undefined) };

  const store: Store = {
    data,
    importNotes: (plan) => db.applyImport(plan, data.states).then(reload),
    deleteCards: (ids) => db.deleteCards(ids).then(reload),
    replaceAll: (next) => db.replaceAll(next).then(reload),
    updateSettings(patch) {
      const settings = { ...data.settings, ...patch };
      setData({ ...data, settings });
      db.saveSettings(settings).catch(fail);
    },
    answer(id, rating, now) {
      const previous = data.states.get(id);
      const next = schedule(previous, rating, now, data.settings.retention);
      const log = { id, t: now, rating, state: previous?.state ?? NEW };
      setData((d) => d && { ...d, states: new Map(d.states).set(id, next), logs: [...d.logs, log] });
      const saved = db.saveReview(next, log);
      saved.catch(fail);
      return {
        next,
        async undo() {
          await db.undoReview(id, previous, await saved);
          setData((d) => {
            if (!d) return d;
            const states = new Map(d.states);
            if (previous) states.set(id, previous);
            else states.delete(id);
            return { ...d, states, logs: d.logs.filter((l) => l !== log) };
          });
        },
      };
    },
  };
  return { store, error, clearError: () => setError(undefined) };
}
