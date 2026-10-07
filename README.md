# Mirakurun TVTest Transcode Proxy

Intel N100のQSVでMirakurunの映像をH.264へ変換し、遠隔地のTVTestへ渡すプロキシです。
既存Mirakurunはポート`40772`、プロキシは`40773`を使用します。

A low-latency Mirakurun-compatible proxy for TVTest. It uses Intel QSV to replace
MPEG-2 video with H.264 while retaining AAC audio, ARIB subtitles, and service metadata.
The target environment is x86-64 Linux with an Intel N100 and Docker Compose.

通常のMirakurun APIはそのまま転送し、サービス／番組のストリームだけを
`tsreplace`と`QSVEncC`で変換します。出力はMPEG-2 TSです。
AAC音声、ARIB字幕、PAT/PMT、PCR、EPG/SIを保持します。
Type-Dデータ放送はプロファイルに応じて保持または削除します。

```text
Mirakurun :40772
  ├─ 通常API ──────────────────────┐
  └─ service/program stream        │
          ↓                        │
      tsreplace → QSVEncC          │
          ↓ H.264 + 音声/字幕/SI    │
      Proxy :40773 ←───────────────┘
          ↓ LAN / Tailscale
      BonDriver_Mirakurun → TVTest
```

## 対応環境

- Intel N100を主な対象とするx86-64 Linux。ホストでi915が動作し、`/dev/dri/renderD128`を利用できること
- Docker EngineとDocker Compose v2以降
- プロキシから接続可能なMirakurun。入力映像はMPEG-2 Videoで、Mirakurun側のB25復号が必要
- WindowsのTVTestとBonDriver_Mirakurun、H.264対応デコーダ（LAV Video Decoderなど）

他のIntel GPUではドライバとエンコーダの対応を事前確認してください。
Dockerイメージは`linux/amd64`向けです。Node.jsを直接使う開発環境は24 LTSを基準とします。

## 導入

```bash
git clone https://github.com/CentralLiner/mirakurun-transcode-proxy.git
cd mirakurun-transcode-proxy
./scripts/configure.sh
```

`configure.sh`はGPUデバイスのグループIDを検出して`.env`を作成します。既存ファイルは上書きしません。
生成後に接続先と待ち受けアドレスを確認してください。

```dotenv
MIRAKURUN_URL=http://host.docker.internal:40772
BIND_ADDRESS=127.0.0.1
```

初期値はホスト自身からの接続用です。**遠隔視聴では`BIND_ADDRESS`をサーバー自身の
Tailscale IPv4アドレスへ変更**します。例: `BIND_ADDRESS=100.64.0.10`。
別ホストのMirakurunを使う場合は、`MIRAKURUN_URL`も変更してください。

認証とTLS終端は内蔵していません。LAN/VPN内で使い、アクセスできる端末を制限してください。
`0.0.0.0`を指定する場合はホストのファイアウォールも設定します。[セキュリティ方針](SECURITY.md)

続けて、ビルドとQSV認識を確認して起動します。

```bash
./scripts/preflight.sh
docker compose up -d
./scripts/smoke-test.sh
```

ビルドにはUbuntuパッケージ、Node.jsイメージ、上流GitHubへの接続が必要です。
スモークテストはコンテナ内部のヘルスチェック、Mirakurun API転送、QSV認識を確認します。
公開ポートも検証する場合は、サーバーのアドレスを渡してください。

```bash
./scripts/smoke-test.sh http://100.64.0.10:40773
docker compose logs --tail=30 proxy
```

実放送の変換は、次のBonDriver設定で選局して確認します。

## BonDriverとTVTestの設定

[examples/BonDriver_Mirakurun.ini](examples/BonDriver_Mirakurun.ini)を参考に、
`SERVER_HOST`をサーバーのTailscaleアドレスへ変更します。

```ini
[GLOBAL]
SERVER_HOST=100.64.0.10
SERVER_PORT=40773
DECODE_B25=1
PRIORITY=0
SERVICE_SPLIT=1
```

`DECODE_B25=1`で上流の復号を有効にし、`SERVICE_SPLIT=1`で選局中のサービスだけを取得します。
初回はTVTestでチャンネルスキャンをやり直し、H.264対応映像デコーダを選択してください。

チャンネル全体のTSには複数サービスが含まれ、1つの変換プロセスで処理できるのは1サービスです。
既定の`CHANNEL_STREAM_MODE=reject`では全体ストリームをHTTP 409で拒否します。
`first`は先頭サービスだけを変換し、`passthrough`は元の多重化TSを転送します。

## チューニング

新規の`.env`は`low-load`を選択します。環境変数が未設定のアプリ内部の既定値は`stable`です。

| プロファイル | 入力と出力 | 映像レート目安 / 上限 | Type-Dデータ放送 |
|---|---|---|---|
| `stable` | ソフトウェアデコード、TFFから29.97pへ変換 | 5.5 / 8 Mbps | 保持 |
| `low-load` | QSVデコード、TFF 60i保持 | 5.5 / 8 Mbps | 保持 |
| `low-bandwidth` | QSVデコード、TFF 60i保持 | 4 / 6 Mbps | 削除 |

全プロファイルでH.264 High@4.1、Bフレームなし、AAC音声・ARIB字幕・EPG/SI保持を使用します。
60i保持時のデインターレースはTVTest側のデコーダ／レンダラーで行います。

```bash
./scripts/set-tuning-profile.sh low-bandwidth
docker compose up -d --force-recreate
```

スクリプトは`.env`をバックアップし、プロファイルを上書きしていた個別値を整理します。
追加の個別設定はプロファイルの値より優先されます。主な調整項目は以下です。

| 設定 | 内容 |
|---|---|
| `MAX_TRANSCODES` | 同時変換数。初期値2 |
| `TRANSCODE_BITRATE_KBPS` / `TRANSCODE_MAX_BITRATE_KBPS` | 平均目安と映像上限 |
| `TRANSCODE_QVBR_QUALITY` | QVBR品質。小さいほど高画質・高ビットレート |
| `TRANSCODE_DEINTERLACE` | `none`で60i保持、`normal`で29.97p、`bob`で59.94p |
| `QSVENC_DECODER` | `hardware`または`software` |
| `QSVENC_INPUT_ANALYZE_SECONDS` / `QSVENC_INPUT_PROBESIZE` | QSVEncC入力解析の時間・サイズ上限 |
| `TSREPLACE_SOURCE_ANALYZE_SECONDS` | tsreplaceの元TS解析上限。既定1.5秒、範囲0.5～7.0秒 |
| `TSREPLACE_REMOVE_TYPED` | `1`でType-Dデータ放送を削除 |
| `EXTRA_QSVENC_ARGS_JSON` | 追加引数のJSON配列。例: `[]` |

設定例とその他の項目は[.env.example](.env.example)を参照してください。

## トラブルシューティング

**QSVが見つからない場合**は、ホストの`/dev/dri`、i915、デバイスのグループIDを確認します。
`configure.sh`は既存`.env`を変更しないため、デバイス構成が変わった場合は
`VIDEO_GID`と`RENDER_GID`を更新してください。

```bash
ls -l /dev/dri
docker compose run --rm --no-deps proxy qsvencc --check-hw
```

**音声だけで映像が出ない場合**は、`DECODE_B25=1`とH.264デコーダを確認し、
`docker compose logs -f proxy`で変換エラーを調べます。

**選局が遅い、解析に失敗する場合**は、起動ログの実際のプロファイルを確認します。
`incomplete video stream parameters`には`TSREPLACE_SOURCE_ANALYZE_SECONDS=2.0`、
不足する場合は`3.0`を試します。QSVEncCの入力情報不足には
`QSVENC_INPUT_ANALYZE_SECONDS`と`QSVENC_INPUT_PROBESIZE`を調整します。
解析値は上限であり、必要情報が取得できれば早く完了します。

**映像が崩れる場合**は、まずTSの映像PIDとcontinuityを検査します。
TSに異常がなければ`QSVENC_DECODER=software`で入力デコードを切り分けます。
下端8ピクセル程度だけの継続的なノイズには`TRANSCODE_CROP_BOTTOM=8`を試せます。

## TS出力の確認

実際のサービスIDへ置き換え、短時間のTSをローカルへ保存します。
正常に取得した後でも、指定時間で終了する`curl`の終了コード28は発生します。

```bash
curl --fail --max-time 15 \
  'http://127.0.0.1:40773/api/services/1024/stream?decode=1' \
  --output proxy-check.ts
node scripts/check-ts.mjs proxy-check.ts
```

TailscaleのIPだけで待ち受けている場合はURLもそのIPへ変更します。
`valid: true`、`continuityErrors: 0`なら終了コード0です。
`ffprobe`があれば、`ffprobe -v error -select_streams v:0 -show_streams proxy-check.ts`で形式も確認できます。
検査スクリプトはPIDとcontinuityを確認するためのもので、音声・字幕の再生確認も行ってください。
放送録画はリポジトリやIssueへ添付せず、検査結果のJSONを共有します。

## APIとビルド

`/healthz`はプロキシ自身が応答します。通常APIとPOST/PUT/DELETEは上流へ転送し、
サービス・番組とチャンネル内サービスの`GET .../stream`を変換します。
クライアント切断時はMirakurun接続と変換プロセスを終了させます。
このプロキシはリアルタイム視聴向けです。録画用途は元のMirakurunへ接続してください。

Dockerビルドでは、`tsreplace`のコミット、QSVEncCのバージョンとSHA-256を固定しています。
OS/NodeイメージとUbuntuパッケージは更新されるため、調査時はビルド日とイメージIDも記録してください。
依存ソフトとハッシュの詳細は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)にあります。

## 開発・更新・ライセンス

- [開発と貢献](CONTRIBUTING.md)
- [更新ガイド](docs/upgrading.md) / [変更履歴](CHANGELOG.md)
- [リリース検証](docs/releasing.md)
- [MIT License](LICENSE) / [第三者ソフトウェア](THIRD_PARTY_NOTICES.md)

参照先: [Mirakurun](https://github.com/Chinachu/Mirakurun)、
[BonDriver_Mirakurun](https://github.com/Chinachu/BonDriver_Mirakurun)、
[tsreplace](https://github.com/rigaya/tsreplace)、
[QSVEnc](https://github.com/rigaya/QSVEnc)、[TVTest](https://github.com/DBCTRADO/TVTest)。
