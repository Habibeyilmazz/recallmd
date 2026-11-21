import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';

// DOMPurify needs a DOM; db.ts only uses the parsing side of markdown.ts.
vi.mock('dompurify', () => ({ default: { addHook() {}, sanitize: (html: string) => html } }));


it('upgrading a database made before images were stored keeps its cards and adds image storage', async () => {
  // The version 1 layout, as the first release created it.
  const v1 = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('recallmd', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('cards', { keyPath: 'id' });
      r.result.createObjectStore('states');
      r.result.createObjectStore('logs', { autoIncrement: true });
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = v1.transaction('cards', 'readwrite');
  tx.objectStore('cards').put({ id: 'c1', kind: 'basic', front: 'q', back: 'a', deck: 'd', tags: [], source: 'd.md', line: 1, seq: 0 });
  await new Promise((resolve) => (tx.oncomplete = resolve));
  v1.close();

  const db = await import('./db');
  expect((await db.loadAll()).cards.map((c) => c.id)).toEqual(['c1']);
  expect(await db.imagePaths()).toEqual([]);
});
