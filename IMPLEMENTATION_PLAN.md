# eFactory Steering Angle Meter / first review

2026-10-02。現在の到達範囲はPhase 1–4（数学・合成運動・Adapter・Diagnostics）。Phase 5のiPhone Safari / Android Chrome実機取得を未完了のままPhase 6以降の測定UIへ進まない。初回成果物の要件に合わせる。公開用完成版とは呼ばない。

## 座標・Quaternion convention（実装前に固定）

Hamilton積、wxyz、単位Quaternion、右手active rotation。qはdevice D→ブラウザーreference R。vR=q vD q^-1。CENTER frame Z0はCENTER時のDと一致。qRel=q0^-1 qNowは現在D→Z0。gyroZ0=qRel gyroD。Eはabsolute=trueの独立系列のみ。RとEの基準を混ぜない。

DeviceOrientationはintrinsic Z–X′–Y″、q=qZ(alpha) qX(beta) qY(gamma)。screen.orientationはUI情報だけ。W3C最新公開版とEditor's Draft（確認時2025-02-12版）§3.1 / §6.3.2、WebKitとChromiumの現行ソースを2026-10-02に照合。rotationRateのgetterはalpha=x,beta=y,gamma=z。姿勢Eulerとジャイロのフィールド名の意味を混同しない。詳細根拠はSENSOR_SPEC_REVIEW.md。

upは正規化したproper accelerationの静止時上向きベクトル。iOSの符号差があり得るため、実機診断で確認する。forwardは物理+yをup直交平面へ射影し正規化。right=forward×up、right×forward=upの右手系。画面下向き等も物理+yと重力から処理。前方向が鉛直に近くなり射影できない取付は拒否する。

PCAは符号を打ち消さないΣwωωᵀ、対称3×3 Jacobi固有分解。軸の半球はup内積正。軸が水平付近なら左右幾何が退化するので拒否（追加暫定閾値）。主固有軸への角度で外れ値を除き再推定。除去前Qaxisも満たすことを要求し多軸運動を隠さない。

qRel=swing*twist。twist=normalize([w,A dot(v,A)])、swing=qRel*twist^-1。180°の軸外回転は分解不定として明示的に拒否。q/-qを連続化。LEFT/RIGHT=dot(rotate(qRel,physicalTopD),rightZero)の符号で決める。PCA符号・動作開始方向・操作案内に依存しない。純軸運動では画面の固定角やcasterに依存しないTwistの角度が得られる。

## テスト設計（数学層を先に作る）

- 独立したrotation matrix oracleでW3C合成Quaternionを検証。単軸90°、混合姿勢、逆積順による誤り、q/-q、relative frame、180°跨ぎ。
- PCAの左右往復、x軸に直交した軸、雑音、多軸、不正入力。
- 既知の車体→端末取付回転でcaster 0/25/30/35°×取付0/5/20°×左右を合成。Math referenceで方向とTwistを検証。UI案内の変数はAPIに存在しない。
- 実時刻列、逆操作、微小反転、静止窓、瞬間ピーク、MAX継続更新はPhase 2の純粋な参照モデルで検証。後続実装の要件を先に証明するもので、実機の測定層完成を意味しない。
- Adapter: null/NaN、absolute系列分離、独立timestamp、片系列欠落、permission拒否、両許可を同じユーザー操作中に要求、画面回転の非干渉。
- Diagnostics: debug query限定、JSON手動コピー/ダウンロード、再試行、非表示時停止、同一originのみのリソース取得。

## 開発順序とentry/exit

1. Phase 1 数学ライブラリ + Vitest → 全数学テスト成功。
2. Phase 2 時間列合成データ + reference-model tests → 合成データの期待値成功。
3. Phase 3 Adapter → センサー仕様/permission/health tests成功。
4. Phase 4 Diagnostics → ブラウザーUIを検証、今回の最初のレビュー。
5. Phase 5 iPhone/Androidの実ログ：静置、3軸ごとの回転、Portrait/Landscape、磁石近傍、欠落/拒否を確認。署名・軸・単位を実測証明。ログはユーザーが明示的に共有するまで端末内のみ。
6. Phase 6–14 CENTER→PCA→estimator→direction→quality→MAX→SVG meter→absolute→branding。各段階テストと実測。reference modelを製品コードへ統合する際は同一試験を再実行する。
7. Phase 15 GitHub Pages完成版公開、HTTPS・対象URL・デプロイrevision・実際の動作を確認。公開先未指定。実機取得用診断版の先行HTTPS配信は別の検証用配信として管理。

## 観測限界（数式を変える場合は先にここへ記録）

単一端末だけでは、車体のステアリング軸まわりの回転とハンドル回転、同軸のホルダーずれを一般には区別できない。重力・Swingが変わらず磁気が使えない場合は不可観測。独立外部基準なしに「すべての車体移動/固定ずれを検出」とは言わない。磁気だけは失敗条件にしない。

単一forwardの幾何は180°で左右退化、180°を超えると符号反転する。モーターサイクル測定UIは±90°を上限として範囲外を拒否する予定。T23のQuaternion連続性はsigned twist unwrapで別に証明し、幾何方向の適用範囲と混同しない。

後続MAXロジックは700ms全窓で静止・時刻連続・quality有効のとき中央値。記録済MAXでもMEASURINGを続ける。CHECKは要件どおり採用可能だが結果に品質を記録。測定層未統合のため正式結果はまだ生成しない。

## 2026-10-02 Phase 5追加指示

Phase 1–4レビュー承認により診断層だけを拡張。RELATIVE / ABSOLUTE_FALLBACK / ABSOLUTE_EVENTを全イベントに保存し、正式測定用相対姿勢へfallbackを代入しない。同sourceの姿勢区間をbody gyroの右側Quaternion積分と比較する。異常は診断表示だけでREFERENCE_LOSTへ接続しない。

PCA Aはraw body gyro、Bは最新過去姿勢を診断アンカーq0へ相対化したgyro。非同期ageとB segmentの変化を残し、採用は両実機ログの比較後。event.timeStampとperformance.now受信時刻を混同しない。T32–T36とsource・PCA・欠落試験を先に追加。一般公開・Phase 6以降・閾値最終化は行わず、Phase 5診断準備のレビューで停止する。
