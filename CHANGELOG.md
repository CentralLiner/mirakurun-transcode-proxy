# Changelog

## 1.5.4 (Unreleased)

- GitHub公開向けにMITライセンス、第三者ライセンス表示、投稿ガイド、CIを追加
- 絶対URL・ネットワークパス・バックスラッシュによる上流ホストの変更をHTTP 400で拒否
- `X-Transcode-Proxy`のバージョンを`package.json`から取得し、表示の不一致を解消
- セッション停止時もSIGTERM後の強制終了処理を適用
- Node.js 24 LTSを実行環境とCIの基準に変更
- ホスト側の既定待ち受けを`127.0.0.1`へ変更。遠隔視聴では`BIND_ADDRESS`を明示
- Tailscaleのみで待ち受ける構成に対応したスモークテストと公開前チェックを追加
- READMEを初回導入中心に整理し、過去の更新手順を`docs/upgrading.md`へ移動

## 1.5.3

- 元Mirakurun MPEG-2 TSの`avformat_find_stream_info()`を既定1.5秒／2MiBへ制限
- tsreplaceが利用しない長いフレームレート推定を4フレームへ短縮
- `TSREPLACE_SOURCE_ANALYZE_SECONDS`（0.5～7.0秒）で局別に安全側へ調整可能
- QSVEncC出力側300ms制限、SIGSEGV防止、PMT/PID修正には変更なし

## 1.5.2

- 1.5.1の300ms解析制限が元Mirakurun MPEG-2 TSの事前解析キューにも適用され、
  `Invalid frame dimensions 0x0`後にSIGSEGVとなる問題を修正
- 解析制限の対象を、映像PID指定がないQSVEncC置換出力キューだけに限定
- 映像の解像度またはピクセル形式が未確定の場合、NULL参照せずエラー終了する防御を追加
- PMT/PID修正、インタレース保持、音声・字幕・SI保持、レート制御には変更なし

## 1.5.1

- QSVEncC出力を読むtsreplace側の`avformat_find_stream_info()`が、FFmpeg既定の5秒間
  解析してから出力を始める問題を修正
- 自前で生成した映像専用MPEG-TSに限り、解析を300ms／512KiBへ制限
- 置換映像の入力形式を`--replace-format mpegts`で明示し、形式検出の待ちを除去
- Mirakurun入力、AAC、ARIB字幕、EPG/SI、PCRおよびレート制御には変更なし

## 1.5.0

- `stable`、`low-load`、`low-bandwidth`の名前付きチューニングプロファイルを追加
- `low-load`でMPEG-2のQSVハードウェアデコード、TFFインタレース保持、GOP 60を採用
- インタレース保持時にpicture-timing SEIを付加し、TVTest側デコーダへフィールド構造を明示
- `low-bandwidth`で映像4 Mbps目安／6 Mbps上限とType-Dデータ放送削除を採用
- `TSREPLACE_REMOVE_TYPED`から`tsreplace --remove-typed`を制御可能にした
- 旧`.env`の個別値を安全に整理する`set-tuning-profile.sh`を追加
- v1.4.0で映像破損の原因がPID衝突と確定したため、インタレース保持を再び推奨可能にした

## 1.4.0

- 複数TSパケットにまたがるPMTを先頭パケットだけで確定し、H.264映像PIDが`0x0000`
  になる`tsreplace 0.19`の初期化問題を局所パッチで修正
- PATとH.264映像のPID衝突によるcontinuity破綻、ブロックノイズ、音声のみ再生を修正
- 無効な映像PIDやMPEG-2以外の入力では破損TSを生成せずエラー終了する防御を追加
- 添付TSの検査結果に基づく`ffprobe`確認手順をREADMEへ追加

## 1.3.0

- QSVEncCを8.26へ更新。TSの一時的な無効PTSと、長時間VFR入力で出力PTSが直前フレーム
  より前へ戻り得る経路に対する公式修正を取り込んだ。
- `normal` / `bob` のフィールド順をTFFへ固定し、フィールド順の自動判定による時間方向の
  揺れを排除した。
- N100でのインタレース保持は、下端のマクロブロック破損と数フレーム前後する再生が
  観測されたため、`normal`（29.97p）を安定プロファイルとして明記した。
- 起動ログへ実際のデコーダ、インタレース処理、入力解析値を出すようにした。

## 1.2.1

- ソフトウェアMPEG-2デコーダで`Invalid frame dimensions 0x0`が発生する局に対応。
- `--input-analyze`の既定上限を3秒、`--input-probesize`を5MBへ拡大し、開始位置が
  GOP途中でもシーケンスヘッダーと解像度を取得できるようにした。
- ハードウェアデコーダを直接使用する場合の内部既定値は従来の0.2秒・256KiBを維持。

## 1.2.0

- 画面下部のマクロブロック列が部分的に崩れる症状への対策として、MPEG-2入力の
  既定デコーダをQSVハードウェアデコードからFFmpegソフトウェアデコードへ変更。
- H.264エンコードは引き続きIntel QSVを使用するため、WAN帯域と出力形式は変更なし。
- `QSVENC_DECODER=hardware`で従来の完全ハードウェア経路へ戻せるようにした。

## 1.1.0

- 既定レート制御を VBR 4.5 Mbps から QVBR 5.5 Mbps（上限 8 Mbps、品質値 23）へ変更。
- QSV 品質プリセットを `fast` から `balanced` へ変更し、`--mbbrc` を明示。
- QSVEncC の入力解析を 0.2 秒 / 256 KiB へ短縮。
- パイプ出力の待ちを減らすため `--output-buf 0` を明示。
- 画面最下部の細い帯だけが乱れる環境向けに `TRANSCODE_CROP_BOTTOM` を追加。
- 新しい既定値、下端回避設定、旧版からの更新手順を README に追加。

## 1.0.0

- 初回リリース。
