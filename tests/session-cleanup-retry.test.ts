import {IDBFactory, IDBDatabase as FakeDatabase} from 'fake-indexeddb';
import {expect, test, vi} from 'vitest';
import {createSessionBinaryBacking} from '../src/session-binary-backing.js';

async function fixture() {
  const bytes = new Uint8Array([3, 2, 1]);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const integrity = 'sha256-' + [...hash].map((n) => n.toString(16).padStart(2, '0')).join('');
  const asset = {namespace: 'story', name: 'video', integrity: 'sha256-' + 'a'.repeat(64),
    files: [{path: 'video.bin', size: bytes.length, integrity}]};
  const source = {read: async () => ({...asset, files: [{...asset.files[0]!, bytes}]}), release: vi.fn()};
  return {asset, source};
}

async function counts(indexedDB: IDBFactory, name: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await Promise.all(['sessions', 'sessionBinaryBundles'].map((store) =>
      new Promise<number>((resolve, reject) => {
        const tx = db.transaction(store);
        const request = tx.objectStore(store).count();
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error);
      })));
  } finally { db.close(); }
}

test('direct disposal retains a failed source, joins reentry, and retries only on explicit dispose', async () => {
  const {asset, source} = await fixture();
  let nested: Promise<void> | undefined;
  source.release.mockImplementationOnce(() => {
    nested = backing.dispose();
    void nested.catch(() => {});
    throw new Error('source still owned');
  });
  const backing: Awaited<ReturnType<typeof createSessionBinaryBacking>> = await createSessionBinaryBacking({policy: 'disabled', sessionId: 'direct-retry', assets: [asset], source});
  const first = backing.dispose();
  expect(backing.dispose()).toBe(first);
  const results = await Promise.allSettled([first]);
  expect(results[0]!.status).toBe('rejected');
  await expect(nested).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_CLEANUP_FAILED'});
  expect(source.release).toHaveBeenCalledTimes(1);
  await expect(backing.get(asset)).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_RELEASED'});
  await backing.dispose();
  expect(source.release).toHaveBeenCalledTimes(2);
  await backing.dispose();
  expect(source.release).toHaveBeenCalledTimes(2);
});

for (const closed of [false, true]) {
  test(`IDB cleanup retries an aborted deletion and isolates another session (closed: ${closed})`, async () => {
    const {asset, source} = await fixture();
    const indexedDB = new IDBFactory();
    const name = 'session-dispose-retry-' + closed;
    const first = await createSessionBinaryBacking({policy: 'required', sessionId: 'first', assets: [asset], source}, {indexedDB, databaseName: name});
    const second = await createSessionBinaryBacking({policy: 'required', sessionId: 'second', assets: [asset], source}, {indexedDB, databaseName: name});
    const held = await first.get(asset);
    const original = Uint8Array.from(held.files[0]!.bytes);
    const transaction = FakeDatabase.prototype.transaction;
    let failures = 1;
    const spy = vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = transaction.apply(this, args);
      if (this.name === name && args[1] === 'readwrite' && tx.objectStoreNames.contains('sessionBinaryBundles') && failures > 0) {
        failures--;
        queueMicrotask(() => { tx.abort(); if (closed) this.close(); });
      }
      return tx;
    });
    try {
      const pending = first.dispose();
      expect(first.dispose()).toBe(pending);
      await expect(pending).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_CLEANUP_FAILED'});
      expect(await counts(indexedDB, name)).toEqual([2, 2]);
      await expect(first.get(asset)).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_RELEASED'});
      await first.dispose();
      expect(await counts(indexedDB, name)).toEqual([1, 1]);
      expect((await second.get(asset)).files[0]!.bytes).toEqual(original);
      expect(held.files[0]!.bytes).toEqual(original);
      await second.dispose();
      expect(await counts(indexedDB, name)).toEqual([0, 0]);
      expect(source.release).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
      await first.dispose().catch(() => {});
      await second.dispose().catch(() => {});
    }
  });
}

for (const change of ['delete', 'upgrade'] as const) {
  test(`reopened cleanup connections yield to DB ${change} after repeated deletion failures`, async () => {
    const {asset, source} = await fixture();
    const indexedDB = new IDBFactory();
    const name = 'session-cleanup-versionchange-' + change;
    const backing = await createSessionBinaryBacking({policy: 'required', sessionId: 'first', assets: [asset], source}, {indexedDB, databaseName: name});
    const transaction = FakeDatabase.prototype.transaction;
    const connections = new Set<IDBDatabase>();
    let failures = 3;
    const spy = vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = transaction.apply(this, args);
      if (this.name === name && args[1] === 'readwrite' && tx.objectStoreNames.contains('sessionBinaryBundles')) {
        connections.add(this);
        if (failures > 0) {
          const closeOriginal = failures === 3;
          failures--;
          queueMicrotask(() => { tx.abort(); if (closeOriginal) this.close(); });
        }
      }
      return tx;
    });
    let changedDatabase: IDBDatabase | undefined;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const disposal = backing.dispose();
        expect(backing.dispose()).toBe(disposal);
        await expect(disposal).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_CLEANUP_FAILED'});
        expect(await counts(indexedDB, name)).toEqual([1, 1]);
        await expect(backing.get(asset)).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_RELEASED'});
      }
      expect(connections.size).toBe(2);
      const request = change === 'delete' ? indexedDB.deleteDatabase(name) : indexedDB.open(name, 2);
      const outcome = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('DB change did not settle')), 2000);
        request.onblocked = () => { clearTimeout(timer); resolve('blocked'); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onupgradeneeded = () => request.result.createObjectStore('upgradeProbe');
        request.onsuccess = () => {
          clearTimeout(timer);
          if (change === 'upgrade') changedDatabase = request.result;
          resolve('complete');
        };
      });
      expect(outcome).toBe('complete');
      await expect(backing.get(asset)).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_RELEASED'});
      if (change === 'upgrade') {
        expect(changedDatabase!.version).toBe(2);
        expect(changedDatabase!.objectStoreNames.contains('upgradeProbe')).toBe(true);
        changedDatabase!.close();
        expect(await counts(indexedDB, name)).toEqual([1, 1]);
        // A schema newer than this reader is an explicit failure, never false cleanup success.
        await expect(backing.dispose()).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_CLEANUP_FAILED'});
        await new Promise<void>((resolve, reject) => {
          const deletion = indexedDB.deleteDatabase(name);
          deletion.onsuccess = () => resolve();
          deletion.onerror = () => reject(deletion.error);
          deletion.onblocked = () => reject(new Error('upgrade connection still blocked deletion'));
        });
      }
      await backing.dispose();
      expect(await counts(indexedDB, name)).toEqual([0, 0]);
      expect(source.release).toHaveBeenCalledTimes(1);
      await backing.dispose();
    } finally {
      spy.mockRestore();
      for (const connection of connections) connection.close();
      changedDatabase?.close();
      await backing.dispose().catch(() => {});
    }
  });
}
