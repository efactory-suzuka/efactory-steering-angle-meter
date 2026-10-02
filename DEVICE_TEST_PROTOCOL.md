# Phase 5：iPhone / Androidの具体的な実機診断手順

2026-10-02 / v0.3.0-phase6。Phase 5診断機能は正式測定UIの背後に維持する。実車精度や端末依存の挙動を検証済みとする手順ではない。

## 0. URLの前提

実機URLは`https://efactory-suzuka.github.io/efactory-steering-angle-meter/?debug=1`。PC用localhost URLはiPhoneへコピーしない。証明書エラーを回避してセンサーを試す手順にはしない。

## 1. iPhoneで開始する

1. iPhoneのSafariで実機確認用HTTPS URLを開き、末尾へ`?debug=1`を付ける。既にクエリがあれば`&debug=1`。アプリ内ブラウザーではなくSafariを使う。
2. 機種、iOS版、Safari版（不明ならiOS版）、画面の縦/横、画面回転ロックON/OFFをメモする。
3. 「測定開始」をタップし、モーション・姿勢の使用許可を許可する。拒否した場合は案内を記録し、Safariの当該サイト設定を確認して再試行する。端末版での設定位置は実機確認する。
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
| iphone_08_background.json | 取得中に非表示、戻って再開始し静止 | 自動RESULTにならないこと、保持リセット、独立時刻、gap・freshness。古いデータでSENSOR_ERRORなら再測定 |
| iphone_09_metal_nearby.json | 静止した端末へ金属物を近づけ、離す（端末自体を動かさない） | relative/absolute、Compass、姿勢ジャンプ診断 |
| iphone_10_missing_or_denied.json | 欠落・拒否が実際に起きた場合のみ、その状態を記録 | 権限結果・欠落系列。発生を捏造しない |

正回転の向きは右手の親指を+軸へ向けたときの指の巻く向き。xはスマホ物理右、yは物理上端、zは画面から外向き。表示が横向きになってもこれらの物理軸の意味は変えない。

「同じ物理姿勢のまま表示だけ横向き」ができない端末では、端末を回した事実をメモする。画面回転による影響と物理回転を混同しない。T32の5°基準ジャンプを実機で意図的に作れない場合は、それを正常に発生したことにしない。

## 3. JSONをコピー・保存する

1. 操作直後、取得を続けたまま右上の「診断」を開き「JSONをコピー」をタップする。そのクリック時点のログを画面内JSON欄へ固定し、クリップボードへコピーする。
2. 自動コピーに失敗した場合は、表示された「手動コピー用JSON」を長押しして全文コピーする。「JSONを保存」のネイティブ保存挙動はiPhoneで確認する。
3. JSONをファイルまたはメモへ貼り付け、ファイル名・動作・機種等のメモと対応させる。`build=0.3.2-phase6-ui`、`meta.source=physical-unverified`、`meta.physicalValidation=UNVERIFIED`、`frames`が空でないことを確認する。`formalMeasurementEnabled=true`は機能の実装状態を意味し、端末での検証済みを意味しない。
4. `orientationSource`、raw orientation / motion、`timing`、`phase5.consistencyBySource`、`phase5.rawGyroPca`、`phase5.transformedGyroPca`が含まれることを確認する。UNAVAILABLE/nullもそのまま残す。
5. JSONを共有する場合は内容を確認し、自分で選んで送る。アプリは自動送信しない。

同じ組をAndroid Chromeでも取得し、ファイル名をandroid_...にする。PC同時刻モデルや合成JSONを実機ログとして提出しない。合成サンプルは出力形式の比較用だけ。

## 4. 取得後に比較する項目

- 機種別のorientationSource分布と、relative/absoluteの可用性・基準変化。
- 3軸対応・符号・重力の符号、Compass値の有無。
- 独立Hz、event timestamp / previous / dt、受信時刻差、対向系列のage、長いgap。
- 各source内の姿勢差、gyro予測差、Quaternion残差、静止中の姿勢ジャンプ。
- raw PCAとtransformed PCAの軸・Qaxis・サンプル数・duration・totalRotation。Bの古い姿勢除外やsegment切替を含めて比較する。

Phase 6は既存設計に合わせTRANSFORMED_GYROを暫定採用し、RAW_GYROへ切り替え可能とする。実機比較による優位性、ABSOLUTE_FALLBACKの正式測定使用、閾値の最終調整、精度保証は未判断。Phase 7以降は別途指示を待つ。

## 5. 正式測定UIの確認（Phase 6）

1. 固定図に従って物理上端を車体前方へ向けて固定し、必要なら左右反転を選んで「固定しました」。
2. ハンドルを中央へ戻し「中央を記録」。700msの静止を待つ。押した瞬間の姿勢はZEROにしない。
3. 「ハンドルを左右へゆっくり動かしてください」に従う。方向は任意。軸検出後は自動でMEASURINGになる。
4. 各端で700ms静止しMAXマーカーを確認。さらに切れば針だけが移動し、静止成立後にMAXを更新する。左右両方のMAXが成立して初めてLock-to-Lockを表示する。
5. 「測定終了」でRESULT。「もう一度測る」で新しいCENTER・軸校正を取り直す。REFERENCE_LOST / PAUSED / SENSOR_ERRORの値は継続使用しない。
6. 磁気異常だけでは測定を止めない。absoluteのみ取得可能な端末では正式測定を開始できないが、生データの診断JSONは取得できる。
7. 合成データボタンは実機試験では押さない。実機の装着・符号・精度・保存挙動の確認は別途必要。

## 6. UX修正後の実機再確認

- 標準固定・左右反転OFFで、物理LEFTは負、RIGHTは正、MAXは正しい側へ格納されるか確認する。
- 中央記録のJSONに resolvedGravityUpSign と gravityOrientationAlignment を残す。生の加速度・姿勢もそのまま残す。AUTOの上下照合は実機未検証。
- 0.7秒保持表示が静止で増え、動けば戻り、MAX記録/更新メッセージとマーカー移動が一致するか確認する。
- 通常測定画面でスクロール/スワイプを試しても終了せず、明示的な「測定終了」のタップでだけ結果へ進むか確認する。
- Safariのアドレスバー、ホームインジケータ、画面回転、背景から復帰、保存/コピーを確認する。可視状態の変更自体ではRESULTにしないが、センサー欠落は別途SENSOR_ERRORにする。
- 既存の7秒回転試験と8秒の端末内JSON保存は維持する。実機の精度や端末差を確認済みと扱わない。
