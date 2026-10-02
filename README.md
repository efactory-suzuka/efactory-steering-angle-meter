# eFactory Steering Angle Meter

**v0.2.0 / Phase 5実機センサー診断専用。正式測定器は未完成。**

Phase 1–4の初回レビュー承認後、実端末の生データを比較できる診断処理だけを拡張した。正式CENTER、軸採用、切れ角判定、MAX、扇形メーター、精度表示、実車最終判定、GitHub一般公開には進んでいない。

## Run

Node.js 24 / pnpm 11.19.0で確認。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

`?debug=1`でPhase 5診断値、JSONコピー/保存、合成データを表示。実端末には信頼されたHTTPS配信先が必要。GitHub Pages用workflowは105テスト→TypeScript strict check / production build→distのみ配信。mainを対象とし、Pull Requestでは配信しない。Repository Settings→Pages→SourceをGitHub Actionsへ設定する。Vite baseは`./`でrepository配下に対応する。一般公開する内容もPhase 5診断専用であり、完成測定機能は含まない。

全105件（既存90＋追加15）を実行する。具体的な操作は[DEVICE_TEST_PROTOCOL.md](DEVICE_TEST_PROTOCOL.md)。テスト結果JSON、端末ログ、合成サンプル、ローカル画面キャプチャ、初回レビュー記録は公開リポジトリへ含めない。JSONが生成されるのはユーザーが端末内でコピー/保存したときで、GitHubへ送信する処理はない。

## Measurement principle

数学・Adapter・診断UIを分離。Hamilton wxyz、右手active、D→Rの単位Quaternionで`vR=q vD q^-1`。`qRel=q0^-1*qNow`は現在D→Z0。W3C intrinsic Z–X′–Y″は`qZ(alpha)*qX(beta)*qY(gamma)`。画面回転で物理軸を無条件に再回転しない。rotationRateは現行仕様とWebKit/Chromiumソース照合に基づき`alpha=x,beta=y,gamma=z`、deg/s。重力の端末別符号は未検証なので生値を保存する。根拠は[SENSOR_SPEC_REVIEW.md](SENSOR_SPEC_REVIEW.md)。

Phase 5の`OrientationSource`はRELATIVE / ABSOLUTE_FALLBACK / ABSOLUTE_EVENT / UNAVAILABLE。`deviceorientation`がabsolute=trueでも捨てずABSOLUTE_FALLBACKとして診断する。正式測定用`frame.orientation`には相対系列しか入れない。診断用`frame.diagnosticOrientation`は別。各イベント自身の由来と、最新スナップショットで選ばれた診断姿勢の由来はJSONで区別する。

姿勢整合性は同じprovenanceの前後姿勢差と、その区間のbody gyro積分Quaternionを比較する。gyroは到着順に零次ホールドし、`qPred=qPred*dqBody`を各実dtで積分。角度の大きさだけでなくQuaternion残差を取る。未来サンプルは使わず、500ms姿勢欠落やgyroの長いgapを明示する。診断の異常表示はREFERENCE_LOSTへ接続しない。

PCAは2方式を同時に記録：Aはraw gyroDeviceDpsの非中心化二次モーメント、Bは診断アンカーq0によるqRelでDIAGNOSTIC_Z0へ変換したgyro。Jacobi固有分解、`Qaxis=λ1/trace`。Bのq0は診断中の最初の有効姿勢で、正式CENTERではない。系列切替・姿勢鮮度切れ・gyro gapでB区間を作り直す。A/Bの正式採用は未判断。各結果へ軸、Qaxis、数、秒単位のduration、degree単位のtotalRotation、積分時間、Bアンカーとsegmentを保存。

Phase 2の測定参照モデルは`tests/support/referenceModel.ts`に隔離したまま。Swing/Twistは`twist=normalize([qRel.w,A*dot(qRel.xyz,A)])`、`swing=qRel*twist^-1`。LEFT/RIGHTは物理上端の回転と重力から得るrightの幾何学的符号を使う設計。正式MAXは700ms静止中央値から継続更新する参照モデルであり、現行UIへは未統合。同軸の車体回転・ホルダーずれの識別には不可観測条件があり、実車の再現性・精度保証はまだしない。

## Diagnostics and privacy

生Euler、event.absolute、Compass補助値、normalized Quaternion、raw gyroとx/y/z、加速度と大きさ、系列ごとのevent timestamp / previous / dt / Hz / 反対系列のage / gap、整合性3値、PCA A/B、状態・鮮度を表示し直近8秒をJSONへ保存する。時間統合の共通軸は`performance.now()`のイベント受信時刻。ブラウザーの`event.timeStamp`は別々に生値保存し、実センサー採取時刻と同じだとは断定しない。

不足系列があっても取得済みの系列を記録し続ける。SENSOR_ERRORの表示からデータが戻ればSENSOR_CHECKへ回復。停止・非表示では取得停止。再開始は新しい診断セッション。合成データはSYNTHETICと明示し実機データと混同しない。PCでの合成JSONの画面出力・再読込を確認済み。iPhoneの許可・コピー・保存の実挙動は未検証。

端末内処理、センサーデータのサーバー送信なし、アカウント不要、GPS不使用。JSONは操作したときだけ保存/コピーする。userAgentを含むので共有前に内容を確認できる。外部解析・広告・CDNフォントなし。承認済ロゴがなければDeveloped by eFactoryへフォールバック。WebサイトURLは`src/config/branding.ts`で一元設定。

スマートフォンセンサーを使う簡易ツールであり、法規適合、整備品質、安全性、メーカー指定寸法を保証する測定器ではない。
