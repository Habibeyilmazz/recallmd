// IndexedDB persistence. The dataset is small, so it is loaded whole and written through.
import { cleanSettings, type AppData, type Settings } from './data';
import type { ImportPlan } from './importer';
import { resolveImage } from './media';
import { imageRefs } from './markdown';
import { byNote, type Card } from './parser';
import type { CardState, ReviewLog } from './scheduler';

const STORES = ['cards', 'states', 'logs', 'kv', 'media'] as const;
type Store = (typeof STORES)[number];

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('recallmd', 2);
    r.onupgradeneeded = (e) => {
      if (e.oldVersion < 1) {
        r.result.createObjectStore('cards', { keyPath: 'id' });
        r.result.createObjectStore('states'); // key: card id
        r.result.createObjectStore('logs', { autoIncrement: true });
        r.result.createObjectStore('kv');
      }
      r.result.createObjectStore('media'); // key: image path, value: the file
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return opening;
}

// Every committed write is announced to this browser's other recallmd tabs, so none of
// them schedules a card from a state another tab has already replaced.
const channel = new BroadcastChannel('recallmd');

/** Calls `listener` when another tab has changed the stored data. Returns the unsubscribe function. */
export function onChangeElsewhere(listener: () => void): () => void {
  channel.addEventListener('message', listener);
  return () => channel.removeEventListener('message', listener);
}

/** Runs `work` in one readwrite transaction; resolves once it has committed. */
async function write<T>(stores: Store[], work: (s: Record<Store, IDBObjectStore>) => T): Promise<T> {
  const tx = (await open()).transaction(stores, 'readwrite');
  const result = work(Object.fromEntries(stores.map((n) => [n, tx.objectStore(n)])) as Record<Store, IDBObjectStore>);
  // Commit now instead of after the requests' success events: a review answered just
  // before the tab is closed or reloaded would otherwise be aborted and lost.
  tx.commit();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      channel.postMessage(null);
      resolve();
    };
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  return result;
}

export async function loadAll(): Promise<AppData & { sampleLoaded: boolean }> {
  const tx = (await open()).transaction(['cards', 'states', 'logs', 'kv'], 'readonly');
  const states = tx.objectStore('states');
  const kv = tx.objectStore('kv');
  const [cards, ids, values, logs, settings, sampleLoaded, suspended] = await Promise.all([
    done<Card[]>(tx.objectStore('cards').getAll()),
    done(states.getAllKeys()),
    done<CardState[]>(states.getAll()),
    done<ReviewLog[]>(tx.objectStore('logs').getAll()),
    done<unknown>(kv.get('settings')),
    done<unknown>(kv.get('sampleLoaded')),
    done<unknown>(kv.get('suspended')),
  ]);
  return {
    cards: cards.sort(byNote), // IndexedDB returns them in id order
    states: new Map(ids.map((id, i) => [String(id), values[i]!])),
    logs,
    settings: cleanSettings(settings),
    sampleLoaded: sampleLoaded === true,
    suspended: new Set(Array.isArray(suspended) ? suspended.filter((id): id is string => typeof id === 'string') : []),
  };
}

export interface ImageFile {
  path: string;
  file: Blob;
}

/** Writes an import and the images its cards show. Progress of removed cards is kept, so re-adding a note restores it. */
export async function applyImport(plan: ImportPlan, states: ReadonlyMap<string, CardState>, images: ImageFile[] = []): Promise<void> {
  await write(['cards', 'states', 'media'], (s) => {
    for (const { path, file } of images) s.media.put(file, path);
    for (const id of plan.remove) s.cards.delete(id);
    for (const card of plan.upsert) s.cards.put(card);
    for (const [from, to] of plan.moves) {
      const state = states.get(from);
      if (state) s.states.put(state, to);
      s.states.delete(from);
    }
  });
  await pruneImages();
}

/** Deletes the stored images that no card shows. */
async function pruneImages(): Promise<void> {
  const tx = (await open()).transaction(['cards', 'media'], 'readonly');
  const [cards, keys] = await Promise.all([done<Card[]>(tx.objectStore('cards').getAll()), done(tx.objectStore('media').getAllKeys())]);
  const paths = keys.map(String);
  const used = new Set<string>();
  for (const c of cards) for (const ref of new Set([...imageRefs(c.front), ...imageRefs(c.back)])) used.add(resolveImage(ref, c.source, paths) ?? '');
  const unused = paths.filter((p) => !used.has(p));
  if (unused.length) await write(['media'], (s) => unused.forEach((p) => s.media.delete(p)));
}

/** Paths of every stored image. */
export async function imagePaths(): Promise<string[]> {
  const tx = (await open()).transaction('media', 'readonly');
  return (await done(tx.objectStore('media').getAllKeys())).map(String);
}

export async function getImage(path: string): Promise<Blob | undefined> {
  const tx = (await open()).transaction('media', 'readonly');
  return done<Blob | undefined>(tx.objectStore('media').get(path));
}

export async function deleteCards(ids: string[]): Promise<void> {
  await write(['cards'], (s) => ids.forEach((id) => s.cards.delete(id)));
  await pruneImages();
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

/** Stores the whole set of suspended card ids. */
export function saveSuspended(ids: ReadonlySet<string>): Promise<void> {
  return write(['kv'], (s) => void s.kv.put([...ids], 'suspended'));
}

export function markSampleLoaded(): Promise<void> {
  return write(['kv'], (s) => void s.kv.put(true, 'sampleLoaded'));
}

/** Replaces everything with `data` (restoring a backup, which keeps stored images), or wipes it when `data` is omitted. */
export function replaceAll(data?: AppData): Promise<void> {
  return write([...STORES], (s) => {
    s.cards.clear();
    s.states.clear();
    s.logs.clear();
    s.kv.put(true, 'sampleLoaded');
    if (!data) {
      s.media.clear();
      s.kv.delete('settings');
      return void s.kv.delete('suspended');
    }
    s.kv.put(data.settings, 'settings');
    s.kv.put([...data.suspended], 'suspended');
    for (const card of data.cards) s.cards.put(card);
    for (const [id, state] of data.states) s.states.put(state, id);
    for (const log of data.logs) s.logs.add(log);
  });
}
