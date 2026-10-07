# Contributing

不具合修正や改善の提案を歓迎します。大きな変更は、実装前にIssueで目的と範囲を共有してください。

## 開発環境

Node.js 24 LTSを使用します。npm依存パッケージのインストールは不要です。
JavaScriptはES modules、2スペースインデント、ダブルクォート、セミコロンの既存スタイルに合わせます。
シェルスクリプトはPOSIX `sh`で書いてください。

```bash
npm run check
npm test
docker compose --env-file .env.example config --quiet
```

`check`はJavaScript/シェル構文、文書リンク、リリース情報の整合性を確認します。
テストは`node:test`と`node:assert/strict`を使い、`test/<module>.test.js`へ追加します。
HTTPテストはlocalhostの待ち受けと子プロセス実行が必要です。GPU、Mirakurun本体、放送録画は不要です。

## 変更と検証

変更した動作と失敗時の処理をテストしてください。HTTPサーバーと子プロセスは後処理で終了させます。
カバレッジの数値目標は設けていません。

エンコーダ引数や`patches/`の変更は、Dockerの再ビルドと実機検証も必要です。
AAC音声、ARIB字幕、PAT/PMT、PCR、EPG/SIの保持を確認してください。
Type-Dデータ放送の削除は`low-bandwidth`など明示した設定に限ります。
検証手順は[docs/releasing.md](docs/releasing.md)を参照してください。

## コミットとPull Request

コミットは変更の目的がわかる短い件名にします。例: `Fix upstream timeout handling`。
PRには変更前後の動作、関連Issue、実行した検証、未検証の項目を記載してください。
利用手順や既定値が変わる場合はREADMEとCHANGELOGを更新します。

`.env`、設定バックアップ、個人の接続情報、ログ、放送録画をコミットしないでください。
不具合報告には匿名化したログやTS検査のJSON結果を使ってください。
貢献した変更は、本プロジェクトの[MITライセンス](LICENSE)で提供されるものとして扱います。
