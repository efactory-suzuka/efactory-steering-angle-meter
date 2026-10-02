# Phase 5：iPhone / Androidの具体的な実機診断手順

2026-10-02 / v0.2.0。正式測定・実車最終判定へ進む手順ではない。

## 0. URLの前提

現在の`http://127.0.0.1:4173/?debug=1`は開発PC専用。iPhoneの127.0.0.1はiPhone自身を指すので、このURLをコピーしても接続できない。GitHub PagesでPhase 5診断版だけをHTTPS配信する。公開先repository・ログイン・Pages設定・実際のデプロイ成功とURL確認が済んでから実機試験へ進む。証明書エラーを回避してセンサーを試す手順にはしない。

## 1. iPhoneで開始する

1. iPhoneのSafariで実機確認用HTTPS URLを開き、末尾へ`?debug=1`を付ける。既にクエリがあれば`&debug=1`。アプリ内ブラウザーではなくSafariを使う。
2. 機種、iOS版、Safari版（不明ならiOS版）、画面の縦/横、画面回転ロックON/OFFをメモする。
3. 「センサー確認を開始」をタップし、モーション・姿勢の使用許可を許可する。拒否した場合は案内を記録し、Safariの当該サイト設定を確認して再試行する。端末版での設定位置は実機確認する。
4. `current state`、姿勢の由来、DeviceOrientation / DeviceMotionのHz・dt、gyro / gravityのfreshnessを確認する。ABSOLUTE_FALLBACKやABSOLUTE_EVENTも取得成功の診断値であり、正式測定対応の判定ではない。
5. センサーが一部欠けても残る系列は記録される。足りない系列名と経過時間をメモし、その状態のJSONも取得する。

## 2. 動作別に短いJSONを取得する

直近8秒だけを保持するため、**x/y/z試験は以下の合計7秒で行い、最後の静止後すぐにコピーする**。事前に「JSONをコピー」ボタンが見える位置へ画面を合わせる。その他の動作は4〜6秒で終え、直後にコピーする。長い操作をまとめてから保存すると初めの部分が消える。合成ボタンは実機試験では使わない。

各軸の共通操作：

1. 1秒静止（baseline）
2. 約2秒かけて+方向へ約30°回転
3. 1秒静止
4. 約2秒かけて元位置へ戻す
5. 1秒静止
6. 直後にJSONをコピー（baseline・回転・停止・復帰を8秒ログ内へ残す）

| ファイル名の例 | 操作 | 確認対象 |
|---|---|---|
| iphone_01_screen_up.json | 画面上向きで水平な台へ置き、2秒静止 | 重力z符号、magnitude、静止gyro、姿勢source |
| iphone_02_screen_down.json | 画面下向きで2秒静止 | 重力符号の反転・大きさ |
| iphone_03_x_positive.json | 物理+x（右辺へ伸びる軸）で上記1→2→1→2→1秒の共通操作 | raw alphaとnormalized x、baseline・姿勢差・gyro残差・復帰 |
| iphone_04_y_positive.json | 物理+y（上端へ伸びる軸）で上記1→2→1→2→1秒の共通操作 | raw betaとnormalized y、baseline・停止・復帰 |
| iphone_05_z_positive.json | 物理+z（画面から外向き）で上記1→2→1→2→1秒の共通操作 | raw gammaとnormalized z、baseline・停止・復帰 |
| iphone_06_single_axis_return.json | 同じ固定軸で左/右に往復する6秒の運動 | A/B PCA、Qaxis、数、時間、総回転量、source/anchor |
| iphone_07_screen_rotation.json | Portrait→Landscapeへ切替し前後で1秒静止 | レイアウトと物理姿勢の変化、軸・sourceの変化 |
| iphone_08_background.json | 取得中に非表示、戻って再開始し静止 | PAUSED、再開始、独立時刻、gap・freshness |
| iphone_09_metal_nearby.json | 静止した端末へ金属物を近づけ、離す（端末自体を動かさない） | relative/absolute、Compass、姿勢ジャンプ診断 |
| iphone_10_missing_or_denied.json | 欠落・拒否が実際に起きた場合のみ、その状態を記録 | 権限結果・欠落系列。発生を捏造しない |

正回転の向きは右手の親指を+軸へ向けたときの指の巻く向き。xはスマホ物理右、yは物理上端、zは画面から外向き。表示が横向きになってもこれらの物理軸の意味は変えない。

「同じ物理姿勢のまま表示だけ横向き」ができない端末では、端末を回した事実をメモする。画面回転による影響と物理回転を混同しない。T32の5°基準ジャンプを実機で意図的に作れない場合は、それを正常に発生したことにしない。

## 3. JSONをコピー・保存する

1. 操作直後、取得を続けたまま「JSONをコピー」をタップする。そのクリック時点のログを画面内JSON欄へ固定し、クリップボードへコピーする。
2. 自動コピーに失敗した場合は、表示された「手動コピー用JSON」を長押しして全文コピーする。「JSONを保存」のネイティブ保存挙動はiPhoneで確認する。
3. JSONをファイルまたはメモへ貼り付け、ファイル名・動作・機種等のメモと対応させる。`build=0.2.0-phase5`、`meta.source=physical-unverified`、`meta.formalMeasurementEnabled=false`、`frames`が空でないことを確認する。
4. `orientationSource`、raw orientation / motion、`timing`、`phase5.consistencyBySource`、`phase5.rawGyroPca`、`phase5.transformedGyroPca`が含まれることを確認する。UNAVAILABLE/nullもそのまま残す。
5. JSONを共有する場合は内容を確認し、自分で選んで送る。アプリは自動送信しない。

同じ組をAndroid Chromeでも取得し、ファイル名をandroid_...にする。PC同時刻モデルや合成JSONを実機ログとして提出しない。合成サンプルは出力形式の比較用だけ。

## 4. 取得後に比較する項目

- 機種別のorientationSource分布と、relative/absoluteの可用性・基準変化。
- 3軸対応・符号・重力の符号、Compass値の有無。
- 独立Hz、event timestamp / previous / dt、受信時刻差、対向系列のage、長いgap。
- 各source内の姿勢差、gyro予測差、Quaternion残差、静止中の姿勢ジャンプ。
- raw PCAとtransformed PCAの軸・Qaxis・サンプル数・duration・totalRotation。Bの古い姿勢除外やsegment切替を含めて比較する。

結果を比較するまでは、PCA方式の採用、ABSOLUTE_FALLBACKの正式測定使用、閾値の最終調整、精度保証は決めない。Phase 5のデータをレビューしてそこで停止し、Phase 6以降は別途指示を待つ。
