# 最小限の利用回数カウンター

GitHub Pagesの測定アプリと、独立した `worker/` のCloudflare Workers + D1で構成します。GA4・Google tag・同意UI・同意保存・解析設定は除去しました。測定／センサー／軸校正／700ms保持／MAX／Quality／診断の既存実装は変更していません。

**初期状態は通信無効です。** Cloudflareの認証と実URLが未設定です。Worker受信テスト、下記の法令・公表確認、guideの送信先URL掲載が完了するまで、本番の `VITE_COUNTER_ENDPOINT` は空にしてください。

## 保存するもの・イベント

| イベント | 条件 |
| --- | --- |
| `open` | 公開の通常測定ページの新しいdocumentを開いたときに1回 |
| `start` | 中央記録の操作でCENTER_CAPTUREに入ったときに1回。中央再記録は新しい試行 |
| `success` | 同じ試行で有効な左右両方のConfirmed MAXが確定し、終了操作によりMEASURINGからRESULTへ進んだときに1回 |

片側のみ／MAXなし／Observed Peakのみ／基準喪失後／エラーや一時停止した試行はsuccessにしません。画面再描画、センサーフレーム、MAX再更新では送信しません。新しい中央記録で試行を切り替えます。途中の基準喪失等で前の試行の成功資格を破棄します。

`open` は延べページ表示回数です。人数、セッション、新規・リピーター、OS、ブラウザ、流入元は計測しません。リロードは新しいページ表示なのでopenが増えます。BFCacheで同じdocumentに戻るだけでは増えません。同じ試行の送信失敗は再送しません。

対象はproduction buildの `https://efactory-suzuka.github.io/efactory-steering-angle-meter/` と `index.html` のみです。guide、localhost、preview、他のパス／ホスト、`debug=1`（重複パラメータも含む）は除外します。通常版・PWAは同じ3イベントです。

本文はUTF-8の **`open` / `start` / `success` の文字列だけ**、最大7バイトです。JSON、属性、角度、時刻、IDを付けません。`credentials: omit` / `referrerPolicy: no-referrer` を指定し、Cookie・参照元を送らず、追跡用CookieやlocalStorageを使用しません。ネットワークの標準HTTPヘッダー（Origin、User-Agent等）や通信に必要なIPは基盤に届きますが、Workerはそれらを個別履歴として保存しません。Originはアクセス許可の検証だけに使います。

D1のアプリ用テーブルは `daily_counts(day, event, count)` だけです。日本時間の日付はWorkerのサーバー時計で決めます。イベント単位の履歴・識別子・タイムスタンプはありません。`INSERT ... ON CONFLICT ... DO UPDATE SET count = count + 1` によるatomic UPSERTで同時アクセスを集計します。

送信はセンサー処理の外の非同期タスクで開始し、応答を待ちません。1500msで中止し、失敗・遅延・DB停止・429でも測定は継続します。永続キュー、失敗保存、バックオフ、自動再送、送信成功の画面通知はありません。そのため通信失敗や濫用制限による過少計上はあり得ます。

## Cloudflareの初期設定と公開

必要なのはWorkersとD1を利用できるCloudflareアカウントです。ブラウザでのWrangler login、またはWorkers編集・D1編集に限定したAPIトークンとAccount IDを使います。認証情報はローカルの安全な環境変数／Cloudflareの認証機構に設定し、リポジトリやチャットには保存しません。公開用URLやD1のdatabase_idは秘密鍵ではありません。

### Codexクラウドから実施する場合の認証

PCのCloudflare Dashboardへのログインは、CodexクラウドのWranglerには共有されません。公開先のAccount IDは提示されたDashboardのアカウントを設定済みです。既存のLINE用Workerは変更しません。

1. Cloudflareの[API Tokens](https://dash.cloudflare.com/profile/api-tokens)で **Create Token → Create Custom Token** を選びます。
2. 対象アカウントを限定し、Accountの **Workers Scripts: Edit**、**D1: Edit**、**Account Settings: Read** を許可します。Zone、DNS、Tailログ、他アカウントの権限は不要です。
3. 作成したトークンをCodexの環境設定にあるSecret **`CLOUDFLARE_API_TOKEN`** に登録します。チャット、GitHubリポジトリ、Vite公開変数には貼りません。トークンの送信先は `api.cloudflare.com` のみです。
4. 同じ環境設定に **`CLOUDFLARE_ACCOUNT_ID`** が設定されていることを確認し、設定を保存して環境を公開します。環境設定の下書きにはCloudflare API、Worker受信確認、GitHub APIとPages、法令・Cloudflare資料の取得に必要な接続先も登録しています。
5. 反映後、Codexが認証を再確認し、D1作成／マイグレーション、Worker公開、受信確認、公表文の実URL掲載、GitHub Variable設定、Pages再公開の順で進めます。認証情報の値は表示しません。

環境設定の下書きを保存しただけでは、認証情報の作成や現在の実行環境への反映は完了しません。Cloudflareの料金・API制限やAPIトークンの権限不足があれば、その具体的な応答を確認して対応します。

```sh
cd worker
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create efactory-usage
```

作成結果のdatabase_idを `worker/wrangler.jsonc` のゼロの仮IDと置き換えます。同名のDBが既にある場合は新規作成せず、そのDBを選びます。

```sh
pnpm migrate:remote
pnpm test
pnpm deploy
```

`pnpm migrate:remote` はD1に集計テーブルを作成します。ローカル開発用は `pnpm migrate:local` / `pnpm dev` です。テストは隔離したローカルD1を作り、本番DBは変更しません。

deployで表示された `https://efactory-usage-counter.<account-subdomain>.workers.dev` を確認します。受付URLは末尾に `/count` を付けます。GET、集計取得API、任意の別パスは提供していません。

### ログと濫用対策

設定は `observability.enabled=false`、logs/traces無効、`invocation_logs=false`、`logpush=false`、preview URL無効です。アプリのWorkerコードはconsoleを出力しません。Cloudflare DashboardでもWorkers Logs、Logpush、Tail/Live logs等を有効にせず、別のログ収集連携を追加しないでください。Wranglerの匿名CLIメトリクスも `send_metrics=false` です。

これはWorkerのリクエストログを作らない設定であり、CloudflareやGitHub自身の基盤・セキュリティ処理を完全に無効化する意味ではありません。D1内部の管理情報やCloudflare標準のリソース・請求メトリクスもアプリの個別利用履歴とは別です。

CORSとOrigin検証は `https://efactory-suzuka.github.io` に限定します。GitHub Pagesは同じoriginに複数リポジトリを置くため、originだけではリポジトリの識別はできません。Originを偽装するスクリプト・botも防げません。クライアント内の秘密鍵は有効な対策にならないため追加していません。

最小限の濫用対策として、Cloudflare Rate Limiting bindingで固定キー `all-events` の全体上限を120件／60秒にしています。IPや端末ごとのキーは使いません。上限はCloudflareの拠点ごとの近似制限で、厳密な全世界共通上限ではありません。上限を超えると429にしてDBへ書かず、アプリは再送しません。必要に応じて利用規模に合わせて上限を変更し、Cloudflareの請求状況も確認してください。改ざん不能な実績や正確な人数には使えません。

### 公開Workerの受信確認（アプリ有効化前）

実際のURLに置き換えて実行します。これは本番の日別カウントを1件増やす確認なので、実行前後の値を比較し、確認で増やした数を運用メモに残してください。個別履歴のテーブルは作りません。

```sh
curl -i -X POST 'https://efactory-usage-counter.<account-subdomain>.workers.dev/count' \
  -H 'Origin: https://efactory-suzuka.github.io' \
  -H 'Content-Type: text/plain;charset=UTF-8' --data-binary 'open'
```

204、正しいAccess-Control-Allow-Origin、D1で当日のopenが1増えたことを確認します。GET、異なるOrigin、不正イベントが拒否されることも確認してください。CurlでOriginを指定できる点自体が、CORSの限界を示します。認証なしで集計を読むことはできません。

## GitHub Pages側の設定

1. 上の受信確認と法令上の確認を完了します。
2. `guide.html` の「利用回数の集計について」に実際の受付URLを掲載し、「集計先が未設定」の説明を運用状態に合わせて更新します。測定画面に案内や設定を追加する必要はありません。
3. GitHub **Settings → Secrets and variables → Actions → Variables** に `VITE_COUNTER_ENDPOINT` を実際の **HTTPS URL + `/count`** で登録します。Secretではなく公開Variableです。クエリ・ハッシュ・ユーザー名・パスワードは認めません。
4. mainで **Actions → Verify and deploy Phase 6 measurement → Run workflow** を実行します。Variableの保存だけでは公開済みファイルは変わりません。
5. 通常URLで測定を試し、3イベントのD1増分を確認します。未完了の左右MAXでsuccessが増えないことも確認します。

既存の `VITE_GA4_MEASUREMENT_ID` Variableは削除してください。Google側の既存GA4は自動削除しません。不要なら管理者がGoogle側で保持・削除を判断してください。旧同意情報や旧Google Cookieが端末に残っていても、今回のコードは読まず利用しません。必要ならブラウザのサイトデータ削除で消せます。

アプリ計測を停止する場合は `VITE_COUNTER_ENDPOINT` を空／削除して再ビルド・公開します。緊急時はWorkerを停止することでも送信を失敗させられ、測定は継続します。古いページを開いたままの利用者には、既に埋め込まれたURLが残ることがあります。

## 日別集計を見る具体的な操作

Cloudflare Dashboardにログイン → **Storage & databases → D1 → efactory-usage → Console** を開きます（UI表記は変更される場合があります）。認証済み管理画面で次のSQLを実行してください。

```sql
SELECT day, event, count
FROM daily_counts
ORDER BY day DESC, event;
```

横並びで見る場合：

```sql
SELECT day,
  SUM(CASE WHEN event='open' THEN count ELSE 0 END) AS opens,
  SUM(CASE WHEN event='start' THEN count ELSE 0 END) AS starts,
  SUM(CASE WHEN event='success' THEN count ELSE 0 END) AS successes
FROM daily_counts
GROUP BY day ORDER BY day DESC;
```

当日は `WHERE day='2026-10-08'` のように日本時間の日付で絞ります。CLIなら `pnpm exec wrangler d1 execute efactory-usage --remote --command "SELECT day,event,count FROM daily_counts ORDER BY day DESC,event"` を使えます。公開閲覧APIはありません。

success/startは同一期間の回数比率であり、個々の試行を結び付けた厳密な完了率ではありません。日付またぎ・通信失敗で値がずれることがあります。利用者人数をこの数字から算出しないでください。

## 法令上の通知・公表：有効化前の確認事項

Cookieを使わず個別履歴を保存しないことだけで、すべての通知・公表義務がなくなるとは断定できません。実装前にこの点を報告しています。今回のコードは未設定なら通信しないため、確認未完了でもGA4除去版を公開できます。集計通信の有効化は確認後に行います。

- **電気通信事業法の外部送信規律（第27条の12）**：運営者・提供サービスが対象になるか、対象情報・適用除外に該当するかを確認してください。対象の場合は送信情報、送信先名称、利用目的などについて法令に適合する通知／容易に知り得る状態での公表等が必要です。規律が適用される場合でも、適切な公表で対応できるかを確認し、同意UIが必須と決め付けないでください。
- **個人情報保護法**：アプリのDBは日別合計のみですが、ネットワーク基盤ではIP等が処理されます。eFactoryとCloudflareの処理の関係、個人情報・個人関連情報への該当、第三者提供／委託／外国での処理に関する義務、契約・DPAを実態に合わせて確認してください。
- **対象地域**：日本以外の利用者も対象とする場合は、その地域のプライバシー・端末情報利用規制を別途確認してください。
- **実際の公表**：guideの静的説明は公表文案です。実送信先URL、運営主体、受信情報の範囲、Cloudflareの基盤処理が契約・運用実態と一致していること、guideへの既存リンクで必要な容易性を満たすことを確認してください。必要な義務を満たせない場合は通信を有効化しません。

確認資料：[総務省の外部送信規律に関する案内](https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/gaibusoushin.html)、[個人情報保護委員会の法令・ガイドライン](https://www.ppc.go.jp/personalinfo/legal/)、[Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/)、[Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/)。この環境では公式サイトの取得が制限されており、現行資料の確認や法的適用の確定は未実施です。運営者または専門家による確認が有効化前の残作業です。

## 開発検証

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm --dir worker install --frozen-lockfile
pnpm --dir worker test
VITE_COUNTER_ENDPOINT=https://counter.example/count pnpm build
pnpm exec playwright install chromium
pnpm test:browser
VITE_COUNTER_ENDPOINT= pnpm build
```

Browserテストは全通信を遮断／モックし、テストの受付URLに実データを送りません。WorkerテストはMiniflareの実ローカルWorkers/D1で240件の並列POSTを処理し、3種類各80件に一致することを確認します。実Cloudflare本番の受信確認とは区別します。権限やセンサーデータはテスト用に模擬し、実機Safariや物理PWAのインストール検証ではありません。

クラウド環境でホームの書き込みが制限される場合は、Wranglerに `XDG_CONFIG_HOME=/tmp/efactory-wrangler-config`、`WRANGLER_LOG_PATH=/tmp/efactory-wrangler-logs` を指定します。pnpmの既存store/PNPM_HOME、既存Chromiumの `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` も環境に合わせて指定してください。Wrangler CLIのローカルビルドログはWorkerのリクエストログではありません。

GitHub Actionsは既存測定テスト、Worker/D1テスト、モックURLでのブラウザテスト、本番Variableでの最終ビルド、Pagesデプロイの順です。Cloudflareへの自動デプロイや認証は追加していません。

今回のローカル検証は、アプリ528件（既存495＋追加33）、Worker34件、ブラウザ11件が成功しています。アプリ／WorkerのTypeScript strict、アプリの本番ビルド、Workerのdry-run bundleも成功しました。Cloudflare本番のDB作成・公開・受信確認と、法令上の適用確認は未実施です。
