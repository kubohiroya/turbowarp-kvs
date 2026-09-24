import {
  createExtensionManifest,
  serializeExtensionManifest
} from '@kubohiroya/turbowarp-extension-manifest';
import {describe, expect, it} from 'vitest';
import blockMetadata from '../src/block-metadata.json';
import definitions from '../src/block-definitions.json';
import {extensionConfig} from '../src/config.js';

const options = {formatVersion: 2, blockMetadata} as const;

describe('extension API manifest', () => {
  it('serializes the server-safe KVS contract deterministically', () => {
    const first = serializeExtensionManifest(extensionConfig.id, definitions, options);
    const second = serializeExtensionManifest(
      extensionConfig.id,
      structuredClone(definitions),
      options
    );
    const manifest = createExtensionManifest(extensionConfig.id, definitions, options);

    expect(first).toBe(second);
    expect(first).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.blocks).toHaveLength(definitions.blocks.length);
  });

  it('declares compiler metadata for every block', () => {
    const manifest = createExtensionManifest(extensionConfig.id, definitions, options);

    for (const block of manifest.blocks) {
      expect(block.resultType).toBeDefined();
      expect(block.effect).toMatch(/^storage-(read|write)$/u);
      expect(block.errors).toContain('KVS_STORAGE_FAILURE');
      expect(block.server).toEqual({
        supported: true,
        irOperation: expect.stringMatching(/^kvs\./u)
      });
    }
  });

  // Metadata lives in its own build-time file, so a block added without it must not slip through.
  it('rejects an opcode without compiler metadata', () => {
    expect(() =>
      createExtensionManifest(
        extensionConfig.id,
        {blocks: [{opcode: 'unmapped', blockType: 'COMMAND', arguments: {}}]},
        options
      )
    ).toThrow('must declare resultType for format version 2');
  });
});
