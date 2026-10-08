# 利用回数カウンター本番設定の確認記録

確認日：2026-10-09（日本時間）。引き継ぎ元：`19e7bdd8daf920f85182dfc5798f8c70d7cb179d`。

## 本番設定

- Cloudflare Account：`3d78b5680772e0d3714238c71cefbcf0`。
- 対象専用D1：`efactory-usage`。同名DBがないことをDashboardで確認して作成。
- database_id：`a1307ce3-28e3-4e08-bc61-2bbdcd8758dd`。`COUNTERS` bindingへ設定。
- Dashboard Consoleで初期SQLを実行し、`PRAGMA table_info(daily_counts)` で `day TEXT / event TEXT / count INTEGER` の3列と複合主キーを確認。
- 初期migrationを `IF NOT EXISTS` に変更。既にDashboardで作ったテーブルを維持してCLIのmigration管理へ引き継ぐため。既存スキーマが違う場合の自動修正はしない。
- Worker公開・実際のURL・HTTP受信確認：未完了。URLは推測していない。
- `VITE_COUNTER_ENDPOINT`：作業開始時は存在しない。受信・法令確認が終わるまで登録しない。
- 旧 `VITE_GA4_MEASUREMENT_ID` は開始時に残存。削除確認待ち。Google側のデータは変更していない。
- LINE用Workerなど他サービスは変更していない。

## 検証

- アプリ：528件PASS。
- アプリTypeScript strict：PASS。
- モック送信先 `https://counter.example/count` のproduction build：PASS。
- ブラウザ：11件PASS。ローカルのビルドを公開originに見立てて全通信をモックした検証。実送信・実機検証ではない。
- Worker strictとdry-run bundle：PASS。
- WindowsのWorkerテスト：31件PASS、実Workers/D1の3件は実行環境起動失敗で未完了。OSのアプリケーション制御がworkerd.exeを遮断したことを確認。保護設定は変更していない。
- GitHub Actionsで変更後のWorker全34件を再確認する。本番Workerの公開は全件成功を確認してから行う。

## 無料枠・ログ

D1 DashboardはDB数10、読込500万行/日、書込10万行/日、容量5GBのhard limitを表示。Workers plans画面でもFree $0のCurrent planを確認。公式の[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)と[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)でもFree枠を確認した。有料プランへの変更、支払情報の登録は行っていない。rate bindingの実デプロイ成功は引き続き確認する。

リポジトリではobservability/logs/traces/invocation_logs/Logpushは無効、preview URLも無効。コードに個別アクセス履歴、Cookie、ID、公開GET集計APIはない。Worker本番設定の照合は公開後に行う。Tail/Live logsを有効にしない。

## 法令・公表

現行法令はe-Gov公式API `api/1/lawdata/359AC0000000086` と `api/1/lawdata/360M50001000025` から取得し、対象・公表方法・公表事項の条文を確認した。総務省の説明ページは取得できなかった。Cookieなしを根拠に対象外とは判断していない。

個人情報保護委員会の通則編、外国委託FAQ Q12-1、CloudflareのPrivacy Policy、DPA v6.4、SSAを確認した。日別合計と、IP・標準HTTP情報の基盤処理を分けてguideに説明し、国外処理があり得る旨とDPAリンクを追加した。guide冒頭から集計説明に直接移動できるようにした。測定画面は変更していない。

残る確認は、本サービスへの外部送信規律の適用と公表方法の十分性、実際の契約・DPAの適用範囲と日本法上必要な委託・国外処理の措置、対象地域。契約が締結済みであることを推測していない。詳細資料は [USAGE_COUNTER.md](USAGE_COUNTER.md) の法令確認欄を参照。

## 再開条件

CLIの既存認証はない。新しい認証に必要な権限は対象アカウントのWorkers編集、D1編集、Account参照。認証情報はGitHub・Vite変数・チャットに出さない。新しいアクセス権限付与について確認待ち。

残る順序：認証 → remote migration管理へ引き継ぎ → CI全件PASS → Worker公開（ログ無効） → DB初期値記録 → 3イベントと拒否条件の実受信確認 → 公表・適用確認 → 実URLのguide掲載 → `VITE_COUNTER_ENDPOINT`登録 → 本番build/Pages反映 → 公開ページとDB増分の照合。

現時点では本番イベントのテスト送信を行っていないため、テストによる増分は `open=0 / start=0 / success=0`。公開アプリからの実受信・物理センサー操作は未確認。
