# 更新ガイド

初回導入は[README](../README.md)を参照してください。以下は各バージョンでの変更と移行手順です。

## 1.5.3 から 1.5.4 への更新

実行環境をNode.js 24 LTSへ変更し、転送先URLの検証とプロセス終了処理を改善しました。
Dockerを利用する場合は、新しいイメージをビルドしてください。

```bash
docker compose build
docker compose up -d --force-recreate
```

既存の`.env`に指定した`BIND_ADDRESS`は引き続き優先されます。未指定の場合の既定値は
`127.0.0.1`です。遠隔視聴する場合は、サーバーのTailscale IPなどを明示してください。
`.env.example`は設定例であり、既存の`.env`を置き換えるものではありません。

スモークテストは既定でコンテナ内部から確認します。ホスト側の公開ポートも確認する場合は
`./scripts/smoke-test.sh http://SERVER_IP:40773`を実行してください。

## 過去の移行手順

以下の記述は各リリース当時のものです。現在の推奨プロファイルはREADMEを参照してください。

## 1.5.2 から 1.5.3 への更新

1.5.2でSIGSEGVは解消しましたが、最初の188バイトまで約5.2秒残る環境がありました。
FFmpegはMPEG-TSのストリーム情報解析に通常より長い上限を使い、tsreplaceは元TSの
映像時刻合わせに必要のないフレームレート推定まで待っていました。

1.5.3は元TSの解析を映像情報取得に必要な範囲へ限定します。既定値は1.5秒／2MiB、
フレームレート推定は4フレームです。QSVEncC出力側の300ms制限とは別設定です。

```dotenv
TSREPLACE_SOURCE_ANALYZE_SECONDS=1.5
```

局によって`incomplete video stream parameters`となる場合だけ、`2.0`、それでも不足なら
`3.0`へ上げてください。設定可能範囲は0.5～7.0秒です。

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

## 1.5.1 から 1.5.2 への更新

1.5.1の低遅延パッチは元Mirakurun TSの事前解析にも300ms制限を適用してしまい、局に
よって`Invalid frame dimensions 0x0`の後にSIGSEGVとなります。1.5.2では制限対象を
QSVEncC出力だけに限定し、映像情報未確定時のNULL参照も防止しました。1.5.1は使用せず、
1.5.2へ更新してください。

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

既存の`.env`はそのまま利用できます。

## 1.5.0 から 1.5.1 への更新

1.5.0では、Mirakurunから最初のTSパケットが約1秒で届いても、プロキシ出力まで約6.5秒
かかるケースがありました。原因はQSVEncCの入力解析ではなく、QSVEncCが生成した映像TSを
tsreplaceが再び`avformat_find_stream_info()`で解析する処理です。解析時間を指定して
いなかったため、FFmpegの複数秒に及ぶ既定解析が選局待ちへそのまま加算されていました。

1.5.1は自前で生成した映像専用MPEG-TSにだけ、300ms／512KiBの解析上限を設定します。
置換形式もMPEG-TSへ固定します。元MirakurunのPAT/PMT、音声、字幕、EPG/SIの解析・保持
には触れません。tsreplaceを再ビルドするため、更新後はキャッシュなしでビルドしてください。

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

最初の188バイトまでの時間は、TSバイナリを端末へ表示しないよう`of=/dev/null`を付けて
比較できます。サービスIDとパスは実環境に合わせてください。

```bash
/usr/bin/time -f 'Mirakurun: %e sec' sh -c \
  "curl -s 'http://127.0.0.1:40772/api/services/1040/stream?decode=1' | \
   dd bs=188 count=1 status=none of=/dev/null"

/usr/bin/time -f 'Proxy: %e sec' sh -c \
  "curl -s 'http://127.0.0.1:40773/api/services/1040/stream?decode=1' | \
   dd bs=188 count=1 status=none of=/dev/null"
```

## 1.4.0 から 1.5.0 への更新

1.4.0で映像PID衝突が解消し、インタレース保持やQSVデコードとは無関係に正常再生できる
ことが確認できたため、1.5.0では負荷・帯域調整を名前付きプロファイルにしました。
旧`.env`には個別設定が残っておりプロファイルより優先されるため、同梱スクリプトで
整理します。まず低負荷設定から試してください。

```bash
chmod +x scripts/*.sh
./scripts/set-tuning-profile.sh low-load
docker compose up -d --force-recreate
docker compose logs --tail=30 proxy
```

スクリプトは変更前の`.env`を日時付きでバックアップします。起動ログに次が含まれれば
反映済みです。

```json
{"tuningProfile":"low-load","decoder":"hardware","deinterlace":"none","inputAnalyzeSeconds":0.5,"inputProbeSize":1000000,"tsreplaceSourceAnalyzeSeconds":1.5,"rateControl":"qvbr","bitrateKbps":5500,"maxBitrateKbps":8000,"qvbrQuality":23,"gopLength":60,"removeTyped":false}
```

### チューニングプロファイル

| プロファイル | 入力処理 | 映像レート | Type-Dデータ放送 | 用途 |
|---|---|---:|---|---|
| `stable` | FFmpeg decode + 29.97p化 | 5.5 / 最大8 Mbps | 保持 | 問題切り分け、互換性優先 |
| `low-load` | QSV decode + TFF 60i保持 | 5.5 / 最大8 Mbps | 保持 | N100のCPU/GPU負荷低減、推奨開始点 |
| `low-bandwidth` | QSV decode + TFF 60i保持 | 4 / 最大6 Mbps | 削除 | 通信量優先 |

インタレース保持では`--tff`を指定したままVPPデインターレースを省き、H.264へ
picture-timing SEIも付けます。デインターレース処理とRGB変換はTVTest側のLAV Video
Decoder／レンダラーへ任せるため、遠隔N100の処理が減ります。GOPは30から60へ延ばして
IDRの比率も少し抑えます。Bフレームは遅延と時刻並べ替えを増やすため0のままです。

`low-bandwidth`のType-D削除はデータ放送が占める分を画質劣化なしで除けます。AAC音声、
ARIB字幕、PAT/PMT、EIT/EPG、PCR、通常のSIは保持しますが、テレビのデータ放送機能は
使えなくなります。局や番組によってデータ放送量が違うため、削減幅は一定ではありません。

```bash
./scripts/set-tuning-profile.sh low-bandwidth
docker compose up -d --force-recreate
```

動きの激しい番組で圧縮ノイズが見えた場合は、`low-load`へ戻すか、`low-bandwidth`を
使ったまま次だけを`.env`末尾へ追加します。

```dotenv
TRANSCODE_BITRATE_KBPS=4500
TRANSCODE_MAX_BITRATE_KBPS=6500
```

ホストで`docker stats`を使うとCPU・メモリ、`intel_gpu_top`を使うとVideo/VideoEnhance
エンジンの使用率を比較できます。通信量は同じチャンネルを同じ時間だけ視聴し、
`tailscale0`の受送信バイト差で比較してください。評価中は1ストリームに固定すると
比較しやすくなります。

## 1.3.0 から 1.4.0 への更新

1.4.0は、VLCを含むプレイヤーで映像が出ず音声のみになる症状と、画面下部の周期的な
ブロック破損を修正します。原因は、PMTが複数の188バイトTSパケットにまたがる局で、
`tsreplace 0.19`が先頭パケットだけを受けた時点の未完成なサービス情報を採用できて
しまうことでした。その場合、H.264映像PIDがPAT予約PIDの`0x0000`になり、PATと映像の
continuity counterが衝突します。

本プロジェクトは`tsreplace 0.19`へ局所パッチを適用し、CRC検証済みの完全なPMTを
受け取るまでサービスを確定しません。さらに、映像PIDが予約値またはMPEG-2映像以外
なら破損TSを送出せず変換をエラー終了します。画質設定やデインターレース設定では
直らないTS多重化層の問題です。

更新時は、パッチ済み`tsreplace`を組み込むため必ずキャッシュなしで再ビルドします。

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
docker compose logs --tail=30 proxy
```

既存の`.env`はそのまま利用できます。切り分けで変更した場合は、次の安定設定に戻して
ください。

```dotenv
QSVENC_DECODER=software
TRANSCODE_DEINTERLACE=normal
TRANSCODE_CROP_BOTTOM=0
EXTRA_QSVENC_ARGS_JSON=[]
```

### 修正確認

プロキシ経由のTSを15秒保存し、映像PIDを確認します。

```bash
curl --fail --max-time 15 \
  'http://127.0.0.1:40773/api/services/1024/stream?decode=1' \
  --output proxy-test-fixed.ts

ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,id,width,height \
  -of default=noprint_wrappers=1 proxy-test-fixed.ts
```

サービスID `1024` は実際の値へ置き換えてください。`codec_name=h264`かつ`id=0x100`
などの非予約PIDなら修正済みです。`id=0x0`なら古いイメージが動作しています。

`ffprobe`がない場合は、プロジェクト同梱の検査スクリプトでも確認できます。

```bash
node scripts/check-ts.mjs proxy-test-fixed.ts
```

正常なら`valid: true`、`continuityErrors: 0`を表示して終了コード0になります。
映像PID `0x0000`、映像パケット欠落、continuity破綻のいずれかがあれば終了コード1です。

## 1.2.1 から 1.3.0 への更新

1.3.0は、画面下部が大きなマクロブロック列として崩れ、同時に映像が数フレーム前後へ
戻るように見える症状への安定化版です。

- QSVEncCを8.26へ更新
- ソフトウェアMPEG-2デコードを維持
- インタレース保持をやめ、TFFを明示した29.97p出力へ戻す
- 既定の時刻同期はQSVEncC 8.26の自動判定を使用

既存の`.env`は自動更新されません。次の4項目を必ず確認してください。特に、以前の
切り分けで`TRANSCODE_DEINTERLACE=none`へ変更したままでは1.3.0の安定化経路を
使用できません。

```dotenv
QSVENC_DECODER=software
TRANSCODE_DEINTERLACE=normal
TRANSCODE_CROP_BOTTOM=0
EXTRA_QSVENC_ARGS_JSON=[]
```

イメージ内のQSVEncCも更新されるため、再作成だけでなく再ビルドが必要です。

```bash
docker compose build --no-cache
docker compose up -d --force-recreate
docker compose logs --tail=20 proxy
```

起動ログの`transcodeProfile`が次の内容なら新しい安定プロファイルです。

```json
{"decoder":"software","deinterlace":"normal","inputAnalyzeSeconds":3,"inputProbeSize":5000000}
```

### v1.3.0時点でインタレース保持を外した暫定判断

当時はPAFFのフィールド処理を破損候補として外しましたが、v1.4.0で実原因が未完成PMTに
よる映像PID `0x0000`とPATの衝突だと確定しました。したがってこの推定は撤回し、
v1.5.0の`low-load`と`low-bandwidth`では公式に対応するH.264インタレース保持を使います。

## 1.2.0 から 1.2.1 への更新

ソフトウェアデコード時に次のログが出る場合は、MPEG-2シーケンスヘッダーを取得する
前に入力解析を終了しています。

```text
[mpeg2video] Invalid frame dimensions 0x0
```

既存の`.env`を次へ変更してください。指定値は解析の上限であり、解像度を早く取得
できれば3秒いっぱいは待ちません。

```dotenv
QSVENC_DECODER=software
QSVENC_INPUT_ANALYZE_SECONDS=3.0
QSVENC_INPUT_PROBESIZE=5000000
```

設定だけでも反映できますが、バージョン表示を揃えるため1.2.1へ更新して再ビルドする
ことを推奨します。

## 1.1 から 1.2 への更新

画面下側のマクロブロック列が帯状に崩れる症状は、通常の圧縮ノイズとは異なります。
1.2では、MPEG-2入力のQSVハードウェアデコード経路を既定から外しました。
H.264エンコードは従来どおりQSVなので、出力形式とWAN帯域は変わりません。

既存の`.env`へ次を追加し、必ずイメージを再ビルドしてください。

```dotenv
QSVENC_DECODER=software
TRANSCODE_CROP_BOTTOM=0
```

```bash
docker compose build
docker compose up -d --force-recreate
```

CPU負荷を比較したい場合だけ`QSVENC_DECODER=hardware`で従来経路へ戻せます。

## 1.0 から 1.1 への更新

1.1 は、実視聴で報告されたブロックノイズと約 7 秒の選局待ちを受け、次を変更しました。

- 破綻しやすかった 4.5 Mbps VBR / `fast` から、5.5 Mbps QVBR / `balanced` へ変更
- 瞬間的に複雑な映像へ最大 8 Mbps まで割り当て、`--mbbrc` で局所的な破綻を抑制
- 入力解析を 0.5 秒・1 MB から 0.2 秒・256 KiB へ短縮
- `--output-buf 0` を明示してパイプ出力の余分な待ちを回避
- MPEG-2 デコード結果の最下部だけが乱れる環境向けに、任意の下端置換設定を追加

既存の `.env` は自動更新されません。1.0 から上書き更新する場合は、最低限次を
反映してからイメージを再ビルドしてください。

```dotenv
TRANSCODE_RATE_CONTROL=qvbr
TRANSCODE_BITRATE_KBPS=5500
TRANSCODE_MAX_BITRATE_KBPS=8000
TRANSCODE_VBV_BUFFER_KBITS=3000
TRANSCODE_QVBR_QUALITY=23
TRANSCODE_QUALITY=balanced
QSVENC_INPUT_ANALYZE_SECONDS=3.0
QSVENC_INPUT_PROBESIZE=5000000
TRANSCODE_CROP_BOTTOM=0
QSVENC_DECODER=software
```

```bash
docker compose build
docker compose up -d --force-recreate
```
