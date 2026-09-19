# TurboWarp-KVS

[日本語](README.ja.md)

Portable namespace/key storage for TurboWarp projects and server compilation. Text values use IndexedDB in the browser. The package also exports the IndexedDB/OPFS `BinaryObjectStore` contract extracted from TurboWarp Asset Manager; binary bytes never pass through Scratch string values or the extension manifest.

## What it does

- Stores text values by explicit namespace and key.
- Provides deterministic `get`, `set`, `has`, `delete`, and sorted `list` operations.
- Publishes a format 2 manifest with explicit server-safe KVS operations.
- Exports tested IndexedDB and OPFS binary object stores for Composition consumers.

## Requirements and safety

Load `dist/kvs.js` as an unsandboxed extension because browser persistence requires IndexedDB and OPFS. Namespaces are lowercase identifiers. Keys are NFC-normalized and reject NUL and traversal segments. KVS uses its own `tw-kvs-*` storage and never migrates or deletes Asset Manager databases.

## Installation

```sh
pnpm add --save-exact @kubohiroya/turbowarp-kvs@0.1.0
```

## Block reference

<!-- BEGIN GENERATED BLOCKS -->

### `set [KEY] in [NAMESPACE] to [VALUE]`

Stores a text value under a namespace and key.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setValue` |
| `NAMESPACE` | String, default: `app` |
| `KEY` | String, default: `message` |
| `VALUE` | String, default: `hello` |

### `value of [KEY] in [NAMESPACE]`

Returns a stored text value, or an empty string when absent.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `getValue` |
| `NAMESPACE` | String, default: `app` |
| `KEY` | String, default: `message` |

### `[KEY] exists in [NAMESPACE]`

Reports whether a key exists.

| Property | Value |
|---|---|
| Type | Boolean |
| Opcode | `hasKey` |
| `NAMESPACE` | String, default: `app` |
| `KEY` | String, default: `message` |

### `delete [KEY] from [NAMESPACE]`

Deletes a key if it exists.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `deleteKey` |
| `NAMESPACE` | String, default: `app` |
| `KEY` | String, default: `message` |

### `keys in [NAMESPACE] as JSON`

Returns a sorted JSON array of keys.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `listKeys` |
| `NAMESPACE` | String, default: `app` |

<!-- END GENERATED BLOCKS -->

## Binary Composition API

Import `@kubohiroya/turbowarp-kvs/binary-object-store`. Callers provide size and SHA-256 integrity descriptors; implementations validate bytes and expose no base64 shortcut. Browser and server adapters share logical contracts, not physical bucket or filesystem paths.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

## License

MPL-2.0.
