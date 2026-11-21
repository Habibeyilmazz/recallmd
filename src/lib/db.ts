// IndexedDB persistence. The dataset is small, so it is loaded whole and written through.
import { cleanSettings, type AppData, type Settings } from './data';
import type { ImportPlan } from './importer';
import { byNote, type Card } from './parser';
import type { CardState, ReviewLog } from './scheduler';

const STORES = ['cards', 'states', 'logs', 'kv'] as const;
type Store = (typeof STORES)[number];

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('recallmd', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('cards', { keyPath: 'id' });
      r.result.createObjectStore('states'); // key: card id
      r.result.createObjectStore('logs', { autoIncrement: true });
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return opening;
}

/** Runs `work` in one readwrite transaction; resolves once it has committed. */
async function write<T>(stores: Store[], work: (s: Record<Store, IDBObjectStore>) => T): Promise<T> {
  const tx = (await open()).transaction(stores, 'readwrite');
  const result = work(Object.fromEntries(stores.map((n) => [n, tx.objectStore(n)])) as Record<Store, IDBObjectStore>);
  // Commit now instead of after the requests' success events: a review answered just
  // before the tab is closed or reloaded would otherwise be aborted and lost.
  tx.commit();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  return result;
}

export async function loadAll(): Promise<AppData & { sampleLoaded: boolean }> {
  const tx = (await open()).transaction(STORES, 'readonly');
  const states = tx.objectStore('states');
  const kv = tx.objectStore('kv');
  const [cards, ids, values, logs, settings, sampleLoaded] = await Promise.all([
    done<Card[]>(tx.objectStore('cards').getAll()),
    done(states.getAllKeys()),
    done<CardState[]>(states.getAll()),
    done<ReviewLog[]>(tx.objectStore('logs').getAll()),
    done<unknown>(kv.get('settings')),
    done<unknown>(kv.get('sampleLoaded')),
  ]);
  return {
    cards: cards.sort(byNote), // IndexedDB returns them in id order
    states: new Map(ids.map((id, i) => [String(id), values[i]!])),
    logs,
    settings: cleanSettings(settings),
    sampleLoaded: sampleLoaded === true,
  };
}

/** Writes an import. Progress of removed cards is kept, so re-adding a note restores it. */
export function applyImport(plan: ImportPlan, states: ReadonlyMap<string, CardState>): Promise<void> {
  return write(['cards', 'states'], (s) => {
    for (const id of plan.remove) s.cards.delete(id);
    for (const card of plan.upsert) s.cards.put(card);
    for (const [from, to] of plan.moves) {
      const state = states.get(from);
      if (state) s.states.put(state, to);
      s.states.delete(from);
    }
  });
}

export function deleteCards(ids: string[]): Promise<void> {
  return write(['cards'], (s) => ids.forEach((id) => s.cards.delete(id)));
}

/** Saves a review. Resolves to the log's key, which `undoReview` needs. */
export async function saveReview(state: CardState, log: ReviewLog): Promise<IDBValidKey> {
  const request = await write(['states', 'logs'], (s) => {
    s.states.put(state, log.id);
    return s.logs.add(log);
  });
  return request.result;
}

export function undoReview(id: string, previous: CardState | undefined, logKey: IDBValidKey): Promise<void> {
  return write(['states', 'logs'], (s) => {
    if (previous) s.states.put(previous, id);
    else s.states.delete(id);
    s.logs.delete(logKey);
  });
}

export function saveSettings(settings: Settings): Promise<void> {
  return write(['kv'], (s) => void s.kv.put(settings, 'settings'));
}

export function markSampleLoaded(): Promise<void> {
  return write(['kv'], (s) => void s.kv.put(true, 'sampleLoaded'));
}

/** Replaces everything with `data` (restoring a backup), or wipes it when `data` is omitted. */
export function replaceAll(data?: AppData): Promise<void> {
  return write([...STORES], (s) => {
    s.cards.clear();
    s.states.clear();
    s.logs.clear();
    s.kv.put(true, 'sampleLoaded');
    if (!data) return void s.kv.delete('settings');
    s.kv.put(data.settings, 'settings');
    for (const card of data.cards) s.cards.put(card);
    for (const [id, state] of data.states) s.states.put(state, id);
    for (const log of data.logs) s.logs.add(log);
  });
}
