import {describe, expect, it} from 'vitest';
import schema from '../schemas/extension-manifest.schema.json';
import definitions from '../src/block-definitions.json' with {type: 'json'};
import {createExtensionManifest, EXTENSION_MANIFEST_FORMAT_VERSION, serializeExtensionManifest} from '../src/extension-manifest.js';

describe('extension API manifest', () => {
  it('serializes the server-safe KVS contract deterministically', () => {
    const first = createExtensionManifest('kubohiroyakvs', definitions);
    const second = serializeExtensionManifest('kubohiroyakvs', structuredClone(definitions));
    expect(first.formatVersion).toBe(2);
    expect(second).toBe(`${JSON.stringify(first, null, 2)}\n`);
    expect(first.blocks.map((block) => block.server.irOperation)).toEqual([
      'kvs.delete', 'kvs.getText', 'kvs.has', 'kvs.listKeys', 'kvs.setText'
    ]);
  });

  it('keeps the schema version aligned', () => {
    expect(schema.properties.formatVersion.const).toBe(EXTENSION_MANIFEST_FORMAT_VERSION);
  });

  it('rejects an opcode without compiler metadata', () => {
    expect(() => createExtensionManifest('kubohiroyakvs', {blocks: [{opcode: 'unknown', blockType: 'COMMAND'}]})).toThrow('Missing server metadata');
  });
});
