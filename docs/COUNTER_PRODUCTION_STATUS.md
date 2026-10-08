# 利用回数カウンター本番設定の確認記録

確認日：2026-10-09（日本時間）。引き継ぎ元：`19e7bdd8daf920f85182dfc5798f8c70d7cb179d`。

## 本番設定

- Cloudflare Account：`3d78b5680772e0d3714238c71cefbcf0`。
- 対象専用D1：`efactory-usage`。同名DBがないことをDashboardで確認して作成。
- database_id：`a1307ce3-28e3-4e08-bc61-2bbdcd8758dd`。`COUNTERS` bindingへ設定。
- Dashboard Consoleで初期SQLを実行し、`PRAGMA table_info(daily_counts)` で `day TEXT / event TEXT / count INTEGER` の3列と複合主キーを確認。
- 初期migrationを `IF NOT EXISTS` に変更。既にDashboardで作ったテーブルを維持してCLIのmigration管理へ引き継ぐため。既存スキーマが違う場合の自動修正はしない。
- Worker公開・HTTP受信確認：完了。公開時に発行されたURLは `https://efactory-usage-counter.efactory-suzuka.workers.dev`、受付は末尾 `/count`。Version ID：`0057b127-1779-40f3-b017-28294bcc4914`。
- 認証はCloudflare公式Wrangler OAuthでAccount Read・Workers Scripts Write・D1 Writeのみを選択し、成功を確認。認証情報はソース／GitHub／Vite変数へ登録していない。
- remote migration `0001_daily_counts.sql` を適用済み。既存テーブルとデータを削除していない。
- `VITE_COUNTER_ENDPOINT`：作業開始時は存在しない。受信・法令確認が終わるまで登録しない。
- 旧 `VITE_GA4_MEASUREMENT_ID` は開始時に残存。削除操作でGitHubの本人確認が要求され、メール確認待ち。Google側のデータは変更していない。
- LINE用Workerなど他サービスは変更していない。

## 検証

- アプリ：528件PASS。
- アプリTypeScript strict：PASS。
- モック送信先 `https://counter.example/count` のproduction build：PASS。
- ブラウザ：11件PASS。ローカルのビルドを公開originに見立てて全通信をモックした検証。実送信・実機検証ではない。
- Worker strictとdry-run bundle：PASS。
- WindowsのWorkerテスト：31件PASS、実Workers/D1の3件は実行環境起動失敗で未完了。OSのアプリケーション制御がworkerd.exeを遮断したことを確認。保護設定は変更していない。
- GitHub Actions [37856118584](https://github.com/efactory-suzuka/efactory-steering-angle-meter/actions/runs/37856118584) で変更後のアプリ528件、Worker全34件、ブラウザ11件、strictを含む最終production buildが成功。Linux上では実Workers/D1の3件も成功した。これはCloudflare本番の受信確認ではない。
- 同runのPages deployも成功。公開guideがHTTP 200で集計説明へのリンク・国外処理の説明・通信未設定の表示を返すことを確認。アプリの送信は引き続き無効。

## 無料枠・ログ

D1 DashboardはDB数10、読込500万行/日、書込10万行/日、容量5GBのhard limitを表示。Workers plans画面でもFree $0のCurrent planを確認。公式の[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)と[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)でもFree枠を確認した。有料プランへの変更、支払情報の登録は行っていない。Rate Limit binding `120 requests/60s` を含む実デプロイも成功した。

リポジトリではobservability/logs/traces/invocation_logs/Logpushは無効、preview URLも無効。コードに個別アクセス履歴、Cookie、ID、公開GET集計APIはない。公開後のWorker SettingsでもLogs・Traces・IssuesがすべてOFF、外部export先なしを確認。Tail/Live logsは有効にしていない。

## 法令・公表

現行法令はe-Gov公式API `api/1/lawdata/359AC0000000086` と `api/1/lawdata/360M50001000025` から取得し、対象・公表方法・公表事項の条文を確認した。総務省の説明ページは取得できなかった。Cookieなしを根拠に対象外とは判断していない。

個人情報保護委員会の通則編、外国委託FAQ Q12-1、CloudflareのPrivacy Policy、DPA v6.4、SSAを確認した。日別合計と、IP・標準HTTP情報の基盤処理を分けてguideに説明し、国外処理があり得る旨とDPAリンクを追加した。guide冒頭から集計説明に直接移動できるようにした。測定画面は変更していない。

残る確認は、本サービスへの外部送信規律の適用と公表方法の十分性、実際の契約・DPAの適用範囲と日本法上必要な委託・国外処理の措置、対象地域。契約が締結済みであることを推測していない。詳細資料は [USAGE_COUNTER.md](USAGE_COUNTER.md) の法令確認欄を参照。

## 本番受信テスト

実行時刻：2026-10-09 08:06 JST。直前の `daily_counts` は空。公開originを指定し、本文 `open`、`start`、`success` を各1回だけPOSTした。

| 確認 | 結果 |
| --- | --- |
| open / start / success | すべて204、本文なし |
| Access-Control-Allow-Origin | `https://efactory-suzuka.github.io` と一致 |
| 別Origin | 403 |
| 未知イベント | 400 |
| 128バイト本文 | 413 |
| GET /count | 405、集計データを返さない |
| OPTIONS preflight | 204 |
| Set-Cookie | 全応答でなし |

テスト後のD1：`2026-10-09 / open=1 / start=1 / success=1`。拒否テストによる増分はなし。これは直接HTTP送信の受信検証であり、公開アプリや物理センサーからの送信を確認したものではない。テスト分は削除せず、合計に各1回含まれる。

## 残る順序

GitHubの本人確認・旧Variable削除 → 公表・適用／契約確認 → `VITE_COUNTER_ENDPOINT`登録 → 有効化状態に合わせたguide更新 → 本番build/Pages反映 → 公開ページとDB増分の照合。

guideへ実際の受付URLを記載したが、アプリ送信が無効である旨は維持。対象地域と実際のDPAの適用状況はユーザーへ確認中。測定ロジック、UI、他Workerは変更していない。
