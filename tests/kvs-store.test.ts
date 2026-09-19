import {IDBFactory} from 'fake-indexeddb';
import {describe, expect, it} from 'vitest';
import {IndexedDbKvsStore, KvsError, normalizeKey, normalizeNamespace} from '../src/kvs-store.js';

describe('IndexedDbKvsStore', () => {
  it('isolates namespaces and sorts keys', async () => {
    const store = new IndexedDbKvsStore(new IDBFactory(), 'test-kvs', () => 1);
    await store.set('app', 'z', 'last');
    await store.set('app', 'a', 'first');
    await store.set('other', 'a', 'separate');
    await expect(store.list('app')).resolves.toEqual(['a', 'z']);
    await expect(store.get('other', 'a')).resolves.toBe('separate');
    await expect(store.delete('app', 'missing')).resolves.toBe(false);
    await expect(store.delete('app', 'a')).resolves.toBe(true);
    store.release();
  });

  it('rejects invalid namespace and traversal keys', () => {
    expect(() => normalizeNamespace('Asset')).toThrow(KvsError);
    expect(() => normalizeKey('../secret')).toThrow(expect.objectContaining({code: 'KVS_KEY_INVALID'}));
  });
});
