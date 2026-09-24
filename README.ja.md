# TurboWarp-KVS

[English](README.md)

TurboWarp projectとserver compilerで共通利用するnamespace/key型の永続storeです。text valueはbrowserのIndexedDBへ保存します。TurboWarp Asset Managerから抽出したIndexedDB/OPFS対応`BinaryObjectStore`も公開し、binary bytesをScratch文字列やmanifestへ埋め込みません。

## 機能

- namespace/key単位のtext set/get/has/delete/list
- format 2 manifestによるserver-safe operationの明示
- Composition API向けbinary object store
- Asset Managerとは独立した`tw-kvs-*`保存領域

## 安全性

namespaceはlowercase identifierに限定します。keyはNFC正規化し、NULと`.`／`..` path segmentを拒否します。既存Asset Manager databaseのmigrationや削除は行いません。

## インストール

```sh
pnpm add --save-exact @kubohiroya/turbowarp-kvs@0.2.0
```

詳細なblock一覧と開発手順は[英語版](README.md)を参照してください。

## License

MPL-2.0.
