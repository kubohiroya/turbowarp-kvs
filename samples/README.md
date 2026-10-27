# Kvsの最小デモ

- 配布: [`save-and-read-score.sb3`](https://kubohiroya.github.io/turbowarp-kvs/samples/save-and-read-score.sb3)
- 起動: [TurboWarp Editor](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-kvs%2Fsamples%2Fsave-and-read-score.sb3)
- 操作: **Run without sandbox**を選んで**Allow**し、緑の旗を押します。
- 内容: デモ専用namespaceへ`setValue`し、`getValue`・`hasKey`・`deleteKey`を順に確認
- 期待結果: 保存した42を読み出し、削除前の存在確認がtrue、削除後がfalseになります。

`manifest.json`に拡張ID・JSパス・sandbox条件・期待結果を記録しています。
`save-and-read-score/project.json`と自作SVGを編集し、次のコマンドで再生成します。

```bash
pnpm run samples:build
pnpm run samples:check
pnpm run pages:build
```

Node.jsは`.nvmrc`指定版を使います。サンプル生成に追加依存はありません。
生成したSB3もコミットし、`_site/`のdocs・dist・SB3をPagesへ公開します。
unsandboxed拡張は検証対象JSをSB3へ同梱し、利用者が通常の同意画面で許可します。
sandbox互換の拡張はPages上のJSを参照します。

緑の旗で毎回入力から結果を生成します。停止してから再実行できます。

切戻しはサンプル・READMEリンク・Pages配信設定の追加をrevertします。
