import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {KvsExtension} from '../src/extension.js';
import type {KvsStore} from '../src/kvs-store.js';

const values = new Map<string, string>();
const store: KvsStore = {
  async set(namespace, key, value) { values.set(`${namespace}/${key}`, value); },
  async get(namespace, key) { return values.get(`${namespace}/${key}`); },
  async has(namespace, key) { return values.has(`${namespace}/${key}`); },
  async delete(namespace, key) { return values.delete(`${namespace}/${key}`); },
  async list(namespace) { return [...values.keys()].filter((key) => key.startsWith(`${namespace}/`)).map((key) => key.slice(namespace.length + 1)).sort(); },
  release() {}
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal('Scratch', {
    BlockType: {COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'boolean'},
    ArgumentType: {STRING: 'string'},
    Cast: {toString: (value: unknown) => String(value)},
    translate: (message: string | {default: string}) => typeof message === 'string' ? message : message.default
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('KvsExtension', () => {
  it('exposes deterministic namespace/key text operations', async () => {
    const extension = new KvsExtension(store);
    await extension.setValue({NAMESPACE: 'app', KEY: 'greeting', VALUE: 'hello'});
    await expect(extension.getValue({NAMESPACE: 'app', KEY: 'greeting'})).resolves.toBe('hello');
    await expect(extension.hasKey({NAMESPACE: 'app', KEY: 'greeting'})).resolves.toBe(true);
    await expect(extension.listKeys({NAMESPACE: 'app'})).resolves.toBe('["greeting"]');
    await extension.deleteKey({NAMESPACE: 'app', KEY: 'greeting'});
    await expect(extension.hasKey({NAMESPACE: 'app', KEY: 'greeting'})).resolves.toBe(false);
  });

  it('publishes the KVS block surface', () => {
    const info = new KvsExtension(store).getInfo() as {name: string; blocks: Array<{opcode: string}>};
    expect(info.name).toBe('KVS');
    expect(info.blocks.map(({opcode}) => opcode)).toEqual(['setValue', 'getValue', 'hasKey', 'deleteKey', 'listKeys']);
  });
});
