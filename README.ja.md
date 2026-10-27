# TurboWarp-KVS

<img src="assets/block-icon.svg" alt="" width="48" height="48">

[English](README.md) | 日本語

TurboWarp projectとserver compilerで共通利用するnamespace/key型の永続storeです。text valueはbrowserのIndexedDBへ保存します。TurboWarp Asset Managerから抽出したIndexedDB/OPFS対応`BinaryObjectStore`も公開し、binary bytesをScratch文字列やmanifestへ埋め込みません。

## 実行できるサンプル

[**TurboWarp Editorでデモを開く**](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-kvs%2Fsamples%2Fsave-and-read-score.sb3) · [SB3をダウンロード](https://kubohiroya.github.io/turbowarp-kvs/samples/save-and-read-score.sb3)

**Run without sandbox**を選んで**Allow**し、緑の旗を押します。
デモ専用namespaceへ`setValue`し、`getValue`・`hasKey`・`deleteKey`を順に確認。サンプルの元データと期待結果は[`samples/README.md`](samples/README.md)に記載しています。

`pnpm run samples:build`でSB3を再生成し、`pnpm run samples:check`で更新漏れと生成処理を確認します。

## 機能

- namespace/key単位のtext set/get/has/delete/list
- format 2 manifestによるserver-safe operationの明示
- Composition API向けbinary object store
- Asset Managerとは独立した`tw-kvs-*`保存領域

## 安全性

namespaceはlowercase identifierに限定します。keyはNFC正規化し、NULと`.`／`..` path segmentを拒否します。既存Asset Manager databaseのmigrationや削除は行いません。

## インストール

```sh
pnpm add --save-exact @kubohiroya/turbowarp-kvs@0.4.0
```

詳細なblock一覧と開発手順は[英語版](README.md)を参照してください。

## License

MPL-2.0.
