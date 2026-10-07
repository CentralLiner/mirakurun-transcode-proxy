# ソースコードのリリース

## リリース情報

バージョンは`package.json`を基準にします。変更した動作と移行事項をCHANGELOGへ記載し、
`v1.5.4`のような対応するタグを作成します。第三者ソフトのバージョンやハッシュを変更した場合は、
Dockerfile、Compose、THIRD_PARTY_NOTICESを更新してください。

## 自動検証

```bash
npm run check
npm test
docker compose --env-file .env.example config --quiet
docker build --platform linux/amd64 --tag mirakurun-proxy:release-check .
```

GitHub Actionsも同じ構文・文書・HTTPテストとコンテナビルド／起動を確認します。
CIのコンテナ起動はGPUを使わない`/healthz`の確認です。

## N100での実機確認

新しい作業ディレクトリへ候補タグのソースを取得し、READMEに従って設定と起動を行います。

1. `configure.sh`で設定を生成し、Mirakurun接続先、Tailscale IP、GPUグループIDを確認する。
2. `preflight.sh`でビルドとQSV認識を確認する。
3. `smoke-test.sh`でAPI転送を確認し、実際の待ち受けアドレスを渡して公開ポートも確認する。
4. TVTestで地上波とBS/CSを選局し、映像、AAC音声、ARIB字幕、番組情報を確認する。
5. 短時間のTSをローカルへ保存して`check-ts.mjs`と、可能なら`ffprobe`で検査する。
6. プロファイル変更、同時視聴、切断後のチューナー解放、再選局を確認する。

試したCPU/GPU、OS、プロファイル、選局時間、TS検査結果を記録してください。
検証できなかった項目もReleaseの説明に明記します。放送録画や個人設定は添付しません。

## 初回のGitHub公開

公開するファイルを`git status --short`と`git diff --cached --stat`で確認します。
`.env.example`、ライセンス、パッチ、テスト、文書、`.github/`を含め、
`.env`とバックアップ、録画、ログ、依存パッケージを除外してください。

GitHubへソースを公開してCIが成功したら、タグとReleaseを作成します。
実機検証前の候補はprereleaseとして扱い、検証状況を記載します。
リポジトリのSecurity設定でPrivate vulnerability reportingを有効にしてください。

この手順はソースコードの公開用です。コンテナは利用者がDockerfileからビルドします。
