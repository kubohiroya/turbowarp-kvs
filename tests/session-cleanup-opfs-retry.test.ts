import {expect, test, vi} from 'vitest';
const store = vi.hoisted(() => ({
  put: vi.fn(), get: vi.fn(), delete: vi.fn(), touch: vi.fn(), release: vi.fn(),
  getBackendStatus: () => ({selected: 'opfs'})
}));
vi.mock('../src/binary-bundle-store.js', () => ({createBinaryBundleStore: () => store}));
import {createSessionBinaryBacking} from '../src/session-binary-backing.js';

test('object-backed session retains failed deletion and does not close the store or repeat successful keys', async () => {
  const bytes = new Uint8Array([1]);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const integrity = 'sha256-' + [...hash].map((n) => n.toString(16).padStart(2, '0')).join('');
  const assets = ['first', 'second'].map((name) => ({namespace: 'story', name,
    integrity: 'sha256-' + 'a'.repeat(64), files: [{path: 'file.bin', size: 1, integrity}]}));
  const release = vi.fn();
  let firstKey: unknown;
  let fail = true;
  store.put.mockImplementation(async (input) => { firstKey ??= input.namespace; });
  store.get.mockResolvedValue({files: [], totalBytes: 1});
  store.delete.mockImplementation(async (key) => {
    if (key.namespace === firstKey && fail) { fail = false; throw new Error('delete failed'); }
  });
  const backing = await createSessionBinaryBacking({policy: 'required', sessionId: 'opfs-retry', assets,
    source: {read: async (asset) => ({...asset, files: [{...asset.files[0]!, bytes}]}), release}},
    {backendPolicy: 'opfs-required'});
  await expect(backing.dispose()).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_CLEANUP_FAILED'});
  expect(store.release).not.toHaveBeenCalled();
  expect(store.delete).toHaveBeenCalledTimes(2);
  await expect(backing.get(assets[0]!)).rejects.toMatchObject({code: 'KVS_SESSION_BINARY_RELEASED'});
  await backing.dispose();
  expect(store.delete).toHaveBeenCalledTimes(3);
  expect(store.delete.mock.calls[2]![0].namespace).toBe(firstKey);
  expect(store.release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
  await backing.dispose();
  expect(store.delete).toHaveBeenCalledTimes(3);
  expect(store.release).toHaveBeenCalledTimes(1);
});
