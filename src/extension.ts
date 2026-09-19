import {extensionConfig} from './config.js';
import definitions from './block-definitions.json' with {type: 'json'};
import {IndexedDbKvsStore, type KvsStore} from './kvs-store.js';

type BlockTypeName = 'COMMAND' | 'REPORTER' | 'BOOLEAN';
type ArgumentTypeName = 'STRING';

interface DefinitionArgument {
  type: ArgumentTypeName;
  defaultValue: string;
}

interface BlockDefinition {
  opcode: string;
  blockType: BlockTypeName;
  text: string;
  description: string;
  arguments: Record<string, DefinitionArgument>;
}

const blockDefinitions = definitions.blocks as readonly BlockDefinition[];

export class KvsExtension implements TurboWarpExtension {
  public constructor(private readonly store: KvsStore = new IndexedDbKvsStore()) {}

  public getInfo(): Record<string, unknown> {
    return {
      id: extensionConfig.id,
      name: Scratch.translate(definitions.extensionName),
      docsURI: extensionConfig.docsURI,
      blockIconURI: extensionConfig.blockIconURI,
      blocks: blockDefinitions.map((block) => this.toScratchBlock(block))
    };
  }

  public async setValue(args: Record<string, unknown>): Promise<void> {
    await this.store.set(text(args.NAMESPACE), text(args.KEY), text(args.VALUE));
  }

  public async getValue(args: Record<string, unknown>): Promise<string> {
    return (await this.store.get(text(args.NAMESPACE), text(args.KEY))) ?? '';
  }

  public async hasKey(args: Record<string, unknown>): Promise<boolean> {
    return this.store.has(text(args.NAMESPACE), text(args.KEY));
  }

  public async deleteKey(args: Record<string, unknown>): Promise<void> {
    await this.store.delete(text(args.NAMESPACE), text(args.KEY));
  }

  public async listKeys(args: Record<string, unknown>): Promise<string> {
    return JSON.stringify(await this.store.list(text(args.NAMESPACE)));
  }

  private toScratchBlock(block: BlockDefinition): Record<string, unknown> {
    return {
      opcode: block.opcode,
      blockType: Scratch.BlockType[block.blockType],
      text: Scratch.translate(block.text),
      arguments: Object.fromEntries(
        Object.entries(block.arguments).map(([name, argument]) => [
          name,
          {type: Scratch.ArgumentType[argument.type], defaultValue: argument.defaultValue}
        ])
      )
    };
  }
}

function text(value: unknown): string {
  return Scratch.Cast.toString(value);
}
