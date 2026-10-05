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
3. JSONをファイルまたはメモへ貼り付け、ファイル名・動作・機種等のメモと対応させる。`build=0.3.10-phase6-home-install`、`meta.source=physical-unverified`、`meta.physicalValidation=UNVERIFIED`、`frames`が空でないことを確認する。`formalMeasurementEnabled=true`は機能の実装状態を意味し、端末での検証済みを意味しない。
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

1. 端末を見やすい任意の向きでハンドルへしっかり固定し「固定しました」。縦・横・180°・斜め取付を許容する。左右反転はOFFから確認し、取付向きだけを理由にONにしない。測定中に固定位置が動かないこと。
2. ハンドルを中央へ戻し「中央を記録」。700msの静止を待つ。押した瞬間の姿勢はZEROにしない。
3. 「ハンドルを左右へゆっくり動かしてください」に従う。方向は任意。軸検出後は自動でMEASURINGになる。
4. 各端で700ms静止しMAXマーカーを確認。さらに切れば針だけが移動し、静止成立後にMAXを更新する。左右両方のMAXが成立して初めてLock-to-Lockを表示する。
5. 「測定終了」でRESULT。「もう一度測る」で新しいCENTER・軸校正を取り直す。REFERENCE_LOST / PAUSED / SENSOR_ERRORの値は継続使用しない。
6. 磁気異常だけでは測定を止めない。absoluteのみ取得可能な端末では正式測定を開始できないが、生データの診断JSONは取得できる。
7. 合成データボタンは実機試験では押さない。実機の装着・符号・精度・保存挙動の確認は別途必要。

## 6. UX修正後の実機再確認

- 取付回転0°/90°/180°/270°・任意3D傾斜で、左右反転OFFの物理LEFTは負、RIGHTは正、MAXは正しい側へ格納されるか確認する。取り直すたびにCENTERと軸校正を実施する。
- 中央記録のJSONに resolvedGravityUpSign と gravityOrientationAlignment を残す。生の加速度・姿勢もそのまま残す。AUTOの上下照合は実機未検証。
- 0.7秒保持表示が静止で増え、動けば戻り、MAX記録/更新メッセージとマーカー移動が一致するか確認する。
- core CHECKでも針・角度・左右が更新され、既存MAXだけは保持されるか確認する。0.4秒保持→core CHECKで0→core GOODで0から700ms取り直すこと。core CHECKだけで主指示が切り替わらず、独立した補助警告が表示されること。Absolute-only CHECKなら保持・MAX記録が継続し、この補助警告が出ないこと。発生しなかったCHECKを実機で確認済みとしない。
- JSONのphase6.reading.signedTwistDeg / signedSteeringTwistDeg、steeringAxisZero、zero.upZero、calibration.axisUpAlignment / axisSignAmbiguous、MAX.stableElapsedMs、phase6.guidance.primaryInstruction / secondaryStatusを比較する。forwardZero/rightZeroは互換診断値であり車体方向ではない。
- 実車のキャスターを変えるために分解等を行わず、caster=0°の確認は固定した鉛直軸治具等で行う。0°/25°/35°は合成テスト済み、実機の確認は未実施。
- 通常測定画面でスクロール/スワイプを試しても終了せず、明示的な「測定終了」のタップでだけ結果へ進むか確認する。
- Safariのアドレスバー、ホームインジケータ、画面回転、背景から復帰、保存/コピーを確認する。可視状態の変更自体ではRESULTにしないが、センサー欠落は別途SENSOR_ERRORにする。
- 既存の7秒回転試験と8秒の端末内JSON保存は維持する。実機の精度や端末差を確認済みと扱わない。

## 7. リアスタンド補正の実車比較（実験・未検証）

1. Safariで `https://efactory-suzuka.github.io/efactory-steering-angle-meter/?debug=1` を開く。診断内Rear Stand Compensationは初期OFF。通常のCENTER・軸校正を行う。軸校正中の車体Yaw混入に注意し、車体が回らない支持条件で基準軸を取得した事実をメモする。
2. 独立した角度治具等で車体に対するハンドル角度を記録し、車体Yawも床・室内基準から別に観察する。端末の表示値だけを正解として比較しない。
3. 前輪を自由に動かせる支持条件と、リアスタンド支持・前輪床接地の条件を比較する。支持状態・車両・端末・取付姿勢をメモし、それぞれCENTERと軸校正を取り直す。純粋な並進と車体の回転を区別する。
4. 診断で実験補正をONにする。同じ操作中の正式Rawと実験Correctedが同一JSONに入る。ゆっくり片側へ切り、1秒以上静止、中央へ戻る。反対側も同様に行い、各操作直後にJSONを保存する。直近8秒だけなので両側全操作を一つのログに収めようとせず、側ごとに保存する。
5. `frames[].phase6.rearStandCompensation` のtimestampMs / rawSteeringDeg / correctedSteeringDeg / estimatedBodyYawDeg / modelResidualDeg / status / reason / coreQuality / axisGravityAngleDeg / separationSin / conditionNumber / correctedConfirmedLeftMaxDeg / correctedConfirmedRightMaxDeg を独立した基準角と突合する。通常MAXは同じsnapshot内のrawConfirmed...とphase6.max。生データ、PCA A/B、source、Hz/dt・ageも保存する。
6. VALIDのときだけ補正値を比較する。CHECK/INVALID時のnullやreasonを削除しない。候補candidate...は正式値ではない。近平行軸ではUNOBSERVABLE/ILL_CONDITIONEDとなり、LEFT/RIGHT判定が可能でも補正不能であることを区別する。
7. 各側の繰り返し、戻りゼロ、静止中のgyro bias、磁気のみCHECK、core CHECK、固定具のずれ、安全に試せる小Roll/Pitch、縦横/反転/斜め取付を比較する。小残差だけでは正しいYaw分離の証明にならないため、独立した角度基準との偏り・繰り返し性・誤補正/拒否を評価する。
8. ON/OFFの切替は実験MAXをリセットする。新CENTER・PAUSED・SENSOR_ERROR・REFERENCE_LOSTも実験基準/MAXを無効化する。通常測定値は補正値に置き換わらない。0.1°は表示分解能であり、実証された正確さを意味しない。
9. 合成ボタンは実車ログ取得では押さない。実車ログはphysical-unverifiedのまま保存する。共有する場合は本人が内容を確認して送る。アプリは外部へ自動送信しない。

支持方法ごとの差、真の車体Yawとの一致、軸校正への混入、Roll/Pitchや固定滑りの検出限界、端末差、閾値の妥当性、再現性が未評価のため、現時点では正式採用しない。Phase 7以降は別途指示を待つ。

## 軸推定の待ち時間を調べる（v0.3.7）

1. debug=1付きURLをSafari/Chromeで開き、固定後にCENTERを記録する。
2. 「ステアリング軸を推定しています」の案内に従い、ハンドルを左右へゆっくり操作する。推定中の「—」は未確定であり、正式角度ではない。
3. 成立した瞬間に「ステアリング軸を検出しました」「測定できます」が短時間表示され、CENTERからの現在角度がすぐ表示される。操作を続けてよい。
4. 成立後なるべく早く診断を開き、JSONを端末内でコピー/保存する。measurement.axisCalibration.completedで成立時の経過時間、累積操作量、初回角度、方向、品質、安定度、件数を確認する。
5. 長時間かかった場合は成立前にも保存し、各frameのblockingReasonsを比較する。直近8秒より前の各イベントは残らないため、長い待ち時間の全履歴には途中の保存が必要。成立記録は8秒後も最新snapshotとmetadataへ残る。
6. 右から開始したログ、左から開始したログをそれぞれ取得する。再CENTERで軸診断がリセットされることも確認する。

既存のx/y/z回転試験の「1秒静止→約2秒で+30°→1秒静止→約2秒で復帰→1秒静止」は変更しない。軸成立条件や実機精度の結論は実ログ確認後に判断する。


## 切れ角が小さく出る可能性を比較する（v0.3.8・診断のみ）

1. 診断URL `https://efactory-suzuka.github.io/efactory-steering-angle-meter/?debug=1` をSafariで開き、通常どおりCENTER・軸校正を行う。Rear Stand CompensationはOFFのまま今回の値を取得できる。
2. 「診断」を開き、Steering comparisonのSTEERING / ORIENTATION / AXISを確認する。Current live angleは正式live値、Display angleは通常画面の平滑化された表示値。Confirmed MAXは静止確定値で、未確定は `--`。
3. 左右のロック位置で、それぞれ0.7秒・1秒・2秒・3秒・5秒の保持中にlive / Quaternion total / Twist / Axis differenceの変化を観察する。5秒保持が終わった直後、測定終了の前にJSONをコピーまたは保存する。直近8秒なので、左右は各ロック位置で別々に保存すると保持開始から比較できる。
4. `frames[].phase6.steeringDiagnostics` と既存のframe.timestampMs、timing.eventTimestampMs、orientationTimestampMs / motionTimestampMsを時系列で比較する。Quaternion rotation axisとAxis differenceは総回転角3°未満ではnull / N/A。総回転角は符号のない3次元回転量、Twist/live/MAXはLEFT負・RIGHT正。PCA axisとQuaternion axisは同じCENTER/Z0座標、軸差は軸の正負を同一視した0〜90°。
5. 支持状態、端末機種・OS、取付姿勢、左右、保持時間と、別の方法で確認した物理角度がある場合はその測定方法・基準をJSONと対応するメモに残す。実ログをこの公開リポジトリへ保存しない。

診断値から原因を自動判定しない。正式アルゴリズム、校正閾値、700msのMAX条件、Qualityや基準喪失の判定は変更していない。通常URLにこのカードは出ない。実機の測定精度や約4°の差の原因は未確認。


## 診断スクロールと数値復帰の確認（v0.3.9）

1. 診断URLをSafariで再読み込みし、CENTER・軸校正まで通常操作する。「診断」を開くと上部にQuaternion total angle / Twist angle / Confirmed LEFT MAX / Confirmed RIGHT MAXが固定表示される。必要な値を見るためのスクロールは不要。
2. 測定しながら詳細部分を上下へ短くスクロールする。上部の値と「計測中」が残ること、指を離した後にハンドル角度を変えると総回転・Twistが更新されることを確認する。
3. 「センサー更新待ち」の間は最後の受信値であり新しい実測値ではない。短い欠落が復帰すると元のCENTER・確定MAXを保持して更新が再開する。欠落中の保持時間はMAXへ加算しない。復帰後は新しい700 ms保持が必要。
4. 最大2秒の復帰待ちを超える実際の入力停止は従来どおりセンサーエラーになり、再測定が必要。基準喪失や一時停止/終了は独立の状態表示で区別する。正常なセンサー故障を無期限に隠さない。
5. 数値が消える問題が残る場合は、上部の状態/メッセージと、直後のJSONを記録する。JSONのdiagnosticInteraction、既存event gap/Hz/freshness、frame timestamps、axis/quality/reference stateを比較する。実機での改善はこの確認を終えるまで未検証。

## ホーム画面追加の実機確認（v0.3.10）

1. 通常版 https://efactory-suzuka.github.io/efactory-steering-angle-meter/ を開く。診断URLの追加ボタンでは、先に通常版を開く案内が表示される。
2. 開始前の「ホーム画面に追加」を押す。Androidでは利用可能なら確認画面、利用できなければブラウザメニューの案内が出る。iPhone/iPadでは共有→「ホーム画面に追加」→「追加」。項目がないブラウザではSafariで通常版を開く。
3. eロゴの外周が欠けないこと、名前がSteering Angleであることを確認する。古いアイコンがある場合は別に追加して比較する（アプリは既存ショートカットを書き換えない）。
4. 追加したアイコンから起動し、通常版が開くこと、診断ボタン・ホーム画面追加ボタンが表示されないことを確認する。ブラウザ表示ではなくstandalone起動かも確認する。
5. センサー使用許可と通常測定フローを確認する。ブラウザで許可済みでもホーム起動側で再度許可が必要な場合がある。実機での動作はこの手順の実施前には未検証。
6. Pages更新後に再起動・再読み込みし、JSONのbuildが0.3.10-phase6-home-installであることを診断URLで確認する。Service Worker/offline cacheは追加していない。アイコンやホーム画面名はOSに保存されるため、更新時に再追加が必要な場合がある。
