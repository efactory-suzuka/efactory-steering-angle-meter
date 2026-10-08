# β版の利用状況分析（GA4）

現時点では実測定IDは未設定です。`G-XXXXXXXXXX` は無効値として扱い、Googleへ送信しません。解析を有効にするには、下記のGA4設定とGitHubの公開ビルド設定が必要です。測定IDは公開識別子です。Googleアカウントの認証情報・秘密鍵は不要です。

## 1. GA4とGitHub Actionsの設定

1. Google AnalyticsでGA4プロパティとウェブデータストリームを作成します。サイトURLは `https://efactory-suzuka.github.io/efactory-steering-angle-meter/` とします。運用に合わせてプロパティのタイムゾーンを日本に設定すると、日別集計が日本時間になります。
2. ウェブストリームの「拡張計測機能」を**オフ**にします。特に自動ページビュー（履歴変更を含む）、スクロール、離脱クリック、フォーム、ファイルダウンロードなどを自動収集しない設定にしてください。この実装はページビューと必要な操作イベントを明示送信します。拡張計測がオンだと、自動イベントが追加される可能性があります。
3. Googleシグナル・ユーザー提供データの収集を有効化しないでください。広告アカウント連携やリマーケティングは不要です。コード側もGoogleシグナル／広告パーソナライズを無効化し、広告関連の同意は常に拒否に設定しています。データ保持期間は必要最小限（例：2か月）で運用してください。
4. ストリームの測定ID（実際の `G-...`）を取得します。
5. GitHubリポジトリの **Settings → Secrets and variables → Actions → Variables → New repository variable** で、名前 `VITE_GA4_MEASUREMENT_ID`、値に実測定IDを設定します。SecretではなくRepository variableを使います。
6. **Actions → Verify and deploy Phase 6 measurement → Run workflow** をmainで実行するか、mainへのpushで再ビルドします。Viteの設定値はビルド時に埋め込まれるため、Variableを保存しただけでは公開済みファイルは変わりません。

ローカルでは `.env.example` を `.env.local` にコピーして設定できますが、localhost／開発ビルドからは送信しません。テスト用のIDを本番Variableに設定しないでください。

GA4の管理画面やプロパティはこのリポジトリから自動作成しません。実測定IDの設定、拡張計測の停止、カスタム定義、レポートの作成はGA4側で行います。

## 2. 送信対象とページビュー

対象はproduction buildで、HTTPSの上記公開originにある次のパスのみです。

- `/efactory-steering-angle-meter/`
- `/efactory-steering-angle-meter/index.html`
- `/efactory-steering-angle-meter/guide.html`

`?debug=1`（重複パラメータに含まれる場合も含む）、localhost、ローカルpreview、他のホスト／パス、開発ビルド、未設定／仮のIDを除外します。通常ブラウザとホーム画面追加済みPWAは対象です。

Google tagの `send_page_view:false` と手動 `page_view` を組み合わせ、**各ページのdocument内で1回だけ**送信します。guideへのクリックは `guide_open`、到着したguideの表示は `page_view` であり、同じページのページビューを2回送ることはありません。拒否→再同意でも同じdocumentのページビューを重複送信しません。再読み込み・通常の新しいページ遷移は新しいページ表示です。BFCacheで元のdocumentに戻った場合は、そのdocumentの既送信ページビューを再送しません。

URLの任意クエリ・フラグメントを送信しません。流入分析に必要な `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term` だけを、英数字・`_`・`-`、80文字以内の値に制限して残します。参照元はoriginのみを送り、パス・クエリは除きます。ページタイトルは固定文字列です。UTMにも氏名・メール・問い合わせ内容を入れないでください。

## 3. イベントと発火条件

すべてのアプリイベントに `app_version`（package.jsonのversion）、`display_mode`（browser / standalone）を付けます。iOSの `navigator.standalone` も判定します。端末・OS・ブラウザ・流入元はGA4標準機能を使います。

| イベント | 発火条件 | 追加属性 |
| --- | --- | --- |
| `app_open` | 同意済みの測定ページを開いたとき。未選択で開いた場合は、そのページで最初に同意したとき。document内1回 | なし |
| `measurement_attempted` | 中央記録操作でCENTER_CAPTUREに入ったとき。基準喪失後の中央再記録も新しい試行 | なし |
| `center_recorded` | 既存の700ms静止判定が成功し、中央基準ができたとき | なし |
| `axis_calibration_started` | 中央記録に成功し、軸校正へ進んだとき | なし |
| `axis_calibration_completed` | 軸が確定し、CALIBRATEDが成立したとき | `calibration_duration_ms` |
| `measurement_started` | MEASURINGに入ったとき | なし |
| `left_max_recorded` | その中央記録試行で、左の静止MAXが初めて確定したとき | なし |
| `right_max_recorded` | その中央記録試行で、右の静止MAXが初めて確定したとき | なし |
| `measurement_completed` | ユーザーが測定終了を操作し、MEASURINGからRESULTに進んだとき | `measurement_duration_sec` |
| `reference_lost` | REFERENCE_LOSTに入ったとき | `error_code=reference_lost` |
| `sensor_error` | SENSOR_ERRORに入ったとき | 定義済み `error_code` |
| `guide_open` | 測定画面の「使い方・仕組み →」リンクを操作したとき | なし |
| `home_install_clicked` | 表示中の「ホーム画面に追加」を操作したとき。OSによるインストール完了とは区別 | なし |

校正時間は中央記録成功（軸校正開始）から軸確定まで、測定時間はMEASURING開始から明示的な測定終了までの単調時計による経過時間です。測定時間はバックグラウンド滞在を含む経過時間です。いずれも角度やセンサーサンプルを含みません。

RESULTへの移行は片側／両側MAXが未確定でも既存仕様通り可能です。そのため `measurement_completed` は「ユーザーが終了まで進んだ回数」であり、「左右MAXが両方そろった回数」や精度を意味しません。両側の到達状況は左右MAXイベントを別途見てください。

MAXの2回目以降の更新イベントは今回送信しません。高頻度フレーム／画面再描画からは状態変化と初回確定の有無のみを観察します。中央記録の試行ごとのフラグと直前状態で重複を抑え、Googleへの処理は測定コールバック終了後の非同期ディスパッチで実行します。同意前／拒否中の操作は保存せず、後から再送しません。

### 定義済みエラーコード

| コード | 意味 |
| --- | --- |
| `sensor_insecure_context` | 安全な接続ではないためセンサー利用不可（公開URLはHTTPSなので通常は発生しません） |
| `sensor_unsupported` | 必要なセンサーAPIが利用できない |
| `sensor_permission_denied` | センサー利用を拒否された |
| `sensor_permission_error` | センサー許可要求が失敗した |
| `sensor_timeout` | センサーデータが来ないまま既存の待機期限に達した |
| `sensor_stale` | 受信済みセンサーデータが古くなった／不足した |
| `sensor_invalid_data` | 既存コントローラーのセンサー処理エラー。自由文の例外メッセージは送信しません |
| `reference_lost` | 既存Quality監視が測定基準の喪失を判定した |

## 4. 同意・プライバシー

Basic Consent方式です。未同意・拒否ではGoogleのタグをロードせず、Cookieなしの解析pingも送信しません。実測定IDが設定された公開ページで、測定開始前のBOOTの控えめな領域に選択肢を表示します。ID未設定・開発環境では測定画面の同意案内を表示しません（guideの設定変更は可能です）。選択しなくても測定でき、測定途中／RESULTで突然表示しません。guideの「利用状況の解析と設定」からいつでも変更できます。

同意はlocalStorageの `efactory.analytics-consent.v1` に `granted` / `denied` だけを保存します。解析イベントや独自の識別子は保存しません。ブラウザが保存を禁止した場合はそのdocumentだけの選択になり、次回は未選択に戻ります。別タブの変更とBFCache復帰時も保存済みの選択に追従します。

撤回時は保留中の操作イベントを破棄し、Googleの `ga-disable-<測定ID>` フラグで以後の計測を無効にして、本アプリ用Cookieを削除します。読み込み済みのライブラリは無効状態で残し、再同意時も同じdocumentで重複ロード／設定しません。既に同意して開始した通信や送信済みデータを遡って取り消すことはできません。

Google標準のCookie識別子だけを利用します。Cookieはhost-only、公開アプリのpath、prefix `efactory`、最大180日に設定します。アプリはGPS・位置情報APIを呼びません。Googleへの通信ではIPアドレスがGoogleに届き、GA4標準で地域推定に使われることがありますが、GA4はIPアドレスを保存しません。

生ジャイロ・加速度・Quaternion・ログ・診断JSON・個別角度・氏名・メール・問い合わせ・独自端末IDを送信しません。送信境界はホワイトリストで再構成し、余分な属性や自由文は捨てます。測定ロジック、軸校正、MAX/700ms、Quality、診断の計算は変更していません。

解析タグのロード失敗・タイムアウト・例外は解析だけで処理し、測定・センサー・RESULTには伝播させません。失敗した解析は毎フレーム再試行せず、次のページ表示／再読み込みで再度試みます。送信はベストエフォートで、広告ブロッカー、ブラウザの制限、通信状況などにより欠けることがあります。

## 5. GA4のカスタム定義

**管理 → データの表示 → カスタム定義** で以下を登録します。

| 表示名の例 | 種類・スコープ | イベントパラメータ | 単位 |
| --- | --- | --- | --- |
| App version | カスタムディメンション・イベント | `app_version` | ― |
| Display mode | カスタムディメンション・イベント | `display_mode` | ― |
| Error code | カスタムディメンション・イベント | `error_code` | ― |
| Calibration duration | カスタム指標・イベント | `calibration_duration_ms` | ミリ秒 |
| Measurement duration | カスタム指標・イベント | `measurement_duration_sec` | 秒 |

GA4の標準「アプリのバージョン」がウェブイベントの `app_version` を利用できる場合は、それも使えます。上記の独自表示名なら他のアプリストリームと区別できます。カスタム定義は通常レポートに反映されるまで時間がかかり、過去データへ遡って定義を適用できません。公開前に登録してください。

`measurement_completed` をキーイベントに指定すると、標準レポートにも完了回数を追加できます。回数を比較する場合は「イベントごと」のカウント方法にします。完了率の分母を揃えるため、探索ではキーイベント指標だけに頼らずイベント名とイベント数を使います。

## 6. 人数・アクセス・測定回数と完了率

### 日別・端末・流入の基本レポート

- **探索 → 自由形式**：ディメンション「日付」、指標「総ユーザー数」「アクティブユーザー数」「セッション」「表示回数」を追加します。日付を行にすると日別の利用状況を見られます。アクティブと総ユーザーは定義が違うので、どちらかを決めて継続比較してください。
- **レポート → エンゲージメント → ページとスクリーン**：測定ページとguideの表示回数を見ます。`app_open` は測定ページを開いた同意済みdocumentの回数です。
- **レポート → エンゲージメント → イベント**：`measurement_attempted`（中央記録試行）、`measurement_started`（測定段階への到達）、`axis_calibration_completed`（校正成功）、`measurement_completed`（終了操作完了）のイベント数を見ます。
- **ユーザー → テクノロジー → 技術の詳細**：デバイスカテゴリ、OS、ブラウザで切り分けます。探索に `Display mode` を加えると通常ブラウザ／standaloneを比較できます。
- **ユーザー維持率レポート**、または自由形式の「新規ユーザー数」「リピーター数」等で傾向を見ます。Cookie削除・拒否・複数端末・ブラウザ/PWAの保存領域の違いにより、同じ人を複数として数える場合があります。人数は推定で、同意した利用者の範囲です。
- **集客 → トラフィック獲得**：「セッションの参照元 / メディア」を使い、Instagram等の流入を確認します。

Instagram等のアプリ内ブラウザでは参照元が欠けるため、公開リンクにUTMを付けると判別しやすくなります。例：

`https://efactory-suzuka.github.io/efactory-steering-angle-meter/?utm_source=instagram&utm_medium=social&utm_campaign=beta_launch`

guideへ直接案内する場合も同じUTMを使えます。測定IDやUTMを個人別の識別子として使わないでください。

### どこで止まるか：ファネル探索

**探索 → ファネルデータ探索**で、各ステップの条件を「イベント名が完全一致」で作成します。

1. `measurement_attempted`
2. `center_recorded`
3. `axis_calibration_completed`
4. `measurement_started`
5. `measurement_completed`

ステップは「間接的に続く」にし、MAXイベントなどを間に挟めるようにします。入口からの離脱を見る場合はクローズドファネルにします。必要に応じて同一セッションに絞り、ステップ間の経過時間も表示します。「デバイスカテゴリ」「ブラウザ」または `Display mode` で内訳を見てください。

別の2ステップ探索 `measurement_started → measurement_completed` で、測定開始後の到達割合を確認できます。**ファネルはユーザー単位**です。同じ利用者の複数試行があるため、イベント回数の完了率とは一致しません。

試行回数の比率を見る場合は自由形式でイベント名を行、イベント数を指標に置き、同じ期間・フィルタの `measurement_completed のイベント数 ÷ measurement_started のイベント数 × 100` を算出します。これは期間内の回数比率です。日付またぎ・同意変更などで開始／終了の一方だけが観測された場合や、同一人の複数試行を厳密に結び付ける用途には使えません。独自ユーザーID・試行IDは追加していません。

### エラー種類と校正時間

自由形式で行を「イベント名」「Error code」、指標を「イベント数」にし、`sensor_error` / `reference_lost` に絞ります。ブラウザ・OSを列やフィルタに追加すると、どの環境で起きやすいかを見られます。校正／測定時間のカスタム指標は対応する完了イベントだけに付くので、そのイベントでフィルタして確認します。中央値や分布が必要ならBigQuery等で集計します（今回BigQuery連携は実装していません）。

## 7. 受信確認

実測定IDを設定して公開ビルドを更新した後、公開の通常URLを開き、「同意する」を選びます。GA4の**リアルタイム**で `app_open` / `page_view` を、実際の操作で測定イベントを確認してください。`?debug=1` は除外されるため受信確認に使いません。この実装は `debug_mode` を自動付与しません。DebugViewを使う場合はGoogleの公式デバッグ手段で通常URLを検証してください。

ブラウザの開発者ツールNetworkで、未同意／拒否時に `googletagmanager.com` のタグとGoogle Analyticsへの送信がないことも確認します。guideで拒否に変更後は送信が止まり、再読み込みしても拒否が維持されることを確認します。

測定IDが未設定の段階で確認できるのはコード・UI・送信抑止とモックのイベント発火までです。**実データのGA4受信成功とは区別してください。**

## 8. 開発検証

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
# Browser fixture only. All Google requests are mocked/blocked by Playwright.
VITE_GA4_MEASUREMENT_ID=G-TEST00001 pnpm build
pnpm exec playwright install chromium
pnpm test:browser
# Final production build: real configured ID, or empty to disable analytics.
VITE_GA4_MEASUREMENT_ID= pnpm build
```

クラウド環境でpnpmホームを変更している場合は、環境セットアップで指定された `PNPM_HOME` とstoreを使ってください。既存Chromiumを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm test:browser` でも実行できます。

ブラウザテストは公開URLをローカルpreviewへ転送し、タグをモックに置換します。外部の通信先はすべて遮断するため、テストIDからGoogleへ実データを送信しません。小画面、iOS standalone相当の判定、guideの設定変更、実際のセンサーイベントを模した700ms保持／校正／RESULTを確認します。物理iPhone/Androidのセンサー・Safari実機・OSからのPWAインストールはこの自動テストの対象ではありません。

GitHub Actionsも、ユニットテスト→モック用ビルドとブラウザテスト→実設定での本番ビルドの順に実行します。本番ビルドが成功した場合だけ、そのdistをPagesへ公開します。

## 9. 追加・変更ファイルと確認結果

追加：

- `src/analytics/events.ts`：イベント／属性／エラーコードの許可リスト
- `src/analytics/client.ts`：同意、公開URLの限定、保留キュー、ページビューの重複防止
- `src/analytics/gtagTransport.ts`：Google tagロード、広告拒否、送信無効化とCookie削除
- `src/analytics/browser.ts`：Vite環境設定、アプリバージョン、standaloneと別タブ／復帰の接続
- `src/analytics/measurementObserver.ts`：測定の状態遷移と初回MAXの観測
- `src/ui/analyticsConsent.ts` / `src/ui/analyticsConsent.css`：BOOTの同意案内とguideの設定操作
- `src/guide.ts`：guideの解析・設定のエントリーポイント
- `tests/analytics/analytics.test.ts`：41件の送信抑止／属性／状態／実測定コントローラー回帰テスト
- `tests/browser/analytics.pw.ts` / `playwright.config.ts`：10件のブラウザ・同意・PWA相当・画面確認
- `.env.example`：未設定で無効になる設定サンプル
- `docs/GA4_ANALYTICS.md`：GA4の導入・分析・運用手順（この文書）

変更：`src/app.ts`（読み取り専用の解析接続と同意UI）、`guide.html`（プライバシー案内）、`.github/workflows/pages.yml`（ブラウザテストと本番Variable）、`package.json` / `pnpm-lock.yaml`（Playwrightと実行スクリプト）、`tsconfig.json`（version用JSON import。strictは維持）、`src/vite-env.d.ts`（IDの型定義）、`.gitignore`（ローカルブラウザ結果の除外・設定例の許可）、`README.md`（解析説明への案内）。

測定／state／core／sensors／debug／configの既存ファイル、および既存495件のテストは変更していません。ユニットテスト536件（既存495＋追加41）、ブラウザテスト10件、TypeScript strict、production buildを確認しています。ブラウザ画像はローカルの検証用で公開しません。実測定IDは未設定で、Googleへの実データ受信確認は未実施です。
