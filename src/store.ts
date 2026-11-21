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
  /** Takes the answer back: at once in memory, and in storage as soon as the answer itself is saved. */
  undo: () => void;
}

export interface Store {
  data: AppData;
  /** The three bulk writes resolve to false when storage refused them; the app then shows why. */
  importNotes: (plan: ImportPlan) => Promise<boolean>;
  answer: (id: string, rating: Rating, now: number) => Answered;
  updateSettings: (patch: Partial<Settings>) => void;
  deleteCards: (ids: string[]) => Promise<boolean>;
  /** Leaves cards out of reviews (`on`) or brings them back. Shown at once; resolves to false if storage refused it. */
  suspend: (ids: string[], on: boolean) => Promise<boolean>;
  /** Replaces everything with a backup, or erases everything when called without one. */
  replaceAll: (data?: AppData) => Promise<boolean>;
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

  // Another tab studied or imported: reload as soon as it says so. Coming back to the tab
  // reloads too, in case the browser had frozen it and the message was missed.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') reload().catch(fail);
    };
    document.addEventListener('visibilitychange', refresh);
    const unsubscribe = db.onChangeElsewhere(() => reload().catch(fail));
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      unsubscribe();
    };
  }, [fail, reload]);

  if (!data) return { error, clearError: () => setError(undefined) };

  // A write that failed must not pass for one that worked: report it and tell the caller.
  const written = (write: Promise<void>) =>
    write.then(reload).then(
      () => true,
      (e: unknown) => {
        fail(e);
        return false;
      },
    );

  const store: Store = {
    data,
    importNotes: (plan) => written(db.applyImport(plan, data.states)),
    deleteCards: (ids) => written(db.deleteCards(ids)),
    replaceAll: (next) => written(db.replaceAll(next)),
    suspend(ids, on) {
      const suspended = new Set(data.suspended);
      for (const id of ids) {
        if (on) suspended.add(id);
        else suspended.delete(id);
      }
      setData((d) => d && { ...d, suspended });
      // Refused: show what storage holds again.
      return written(db.saveSuspended(suspended)).then((ok) => ok || reload().then(() => false, () => false));
    },
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
      const forget = () =>
        setData((d) => {
          if (!d) return d;
          const states = new Map(d.states);
          if (previous) states.set(id, previous);
          else states.delete(id);
          // Matched by value: a reload from storage replaces the log objects.
          return { ...d, states, logs: d.logs.filter((l) => l.id !== id || l.t !== now) };
        });
      const saved = db.saveReview(next, log);
      // An answer that could not be stored must not look stored: take it back and say so.
      saved.catch((e: unknown) => {
        forget();
        fail(e);
      });
      return {
        next,
        undo() {
          forget();
          saved.then((key) => db.undoReview(id, previous, key)).catch(() => undefined); // a failed save was already reported
        },
      };
    },
  };
  return { store, error, clearError: () => setError(undefined) };
}
