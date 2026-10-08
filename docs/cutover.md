# Next.js 版への切り替え手順（2027年1月公開）

設計：`docs/specs/2026-10-08-nextjs-migration-design.md` §8。
**★ はオーナー（あなた）が行う作業**、それ以外はコマンドを実行すれば終わる作業です。

## 0. いま時点の状態（2026-10-08）
- `nextjs-migration` ブランチに M1〜M6 を実装済み（`site/`）。エミュレータ上で全機能を手動確認済み、自動テスト：サイト 66 件・ルール 89 件・移行スクリプト 1 本。
- **本番には何も反映していません**（デプロイ、ルール変更、App Hosting の作成はしていない）。
- `firestore.rules` / `storage.rules` はこのブランチで「サーバーだけが書ける」形に変わっています。**このブランチから `firebase deploy` すると Flutter 版のレビュー投稿・資料投稿・アップロードが壊れます。** 切り替え当日まで、このブランチからルールをデプロイしないでください。

## 1. 事前準備（12月中）
1. ★ Firebase プロジェクト `kyodai-sns` を **Blaze プラン**にする（App Hosting に必要。この規模なら無料枠内の見込み）。
2. ★ App Hosting のバックエンドを作る：
   ```bash
   firebase apphosting:backends:create --project kyodai-sns --location asia-east1
   ```
   - リポジトリ：GitHub の本リポジトリ、ルートディレクトリ：`site`、本番ブランチ：まずは `nextjs-migration`
3. ★ App Hosting のサービスアカウントに Firestore / Storage / Auth（トークン検証）の権限があることを確認（既定で付与される。署名付き URL は使っていないので `signBlob` 権限は不要）。
4. ★ 独自ドメインを取得して App Hosting に割り当てる（例：`kyodai-info.jp`）。`site/apphosting.yaml` の `NEXT_PUBLIC_SITE_URL` をそのドメインに変更。
5. ★ `app/legal/terms`・`app/legal/privacy` の文面を確認・修正（運営者名、連絡先など。下書きです）。
6. 新しい複合インデックスを先に作っておく（既存のアプリには影響なし）：
   ```bash
   firebase deploy --only firestore:indexes --project kyodai-sns
   ```
7. App Hosting の URL（`*.hosted.app`）で、本番データを読んだ状態の表示を確認する（この時点ではまだ書き込みは Flutter 側のルールのまま）。

## 2. 切り替え当日
1. Flutter 版を「メンテナンス中」にする（書き込みを止める）。
2. ★ 既存データの移行（サービスアカウントの鍵か `gcloud auth application-default login` が必要）：
   ```bash
   cd tools && node migrate_to_next.mjs --project kyodai-sns            # まず確認だけ
   cd tools && node migrate_to_next.mjs --project kyodai-sns --apply    # 書き込み
   ```
   出力の `unresolved`（科目が見つからない投稿）と `missingFiles` を確認。
3. ルールを切り替える：
   ```bash
   firebase deploy --only firestore:rules,storage --project kyodai-sns
   ```
4. App Hosting で本番ロールアウト（`nextjs-migration` を main にマージ → 自動デプロイ）。
5. 旧 URL から新ドメインへ転送：`firebase.json` の `hosting` を次のように置き換えて `firebase deploy --only hosting`
   ```json
   "hosting": { "site": "kyodai-info", "public": "public-redirect", "redirects": [{ "source": "**", "destination": "https://<新ドメイン>/", "type": 301 }] }
   ```
   （`public-redirect/` は空の index.html だけのフォルダ）
6. 動作確認：登録 → メール確認 → レビュー投稿 → 別アカウントで閲覧・役に立った → 過去問アップロード → 別アカウントでダウンロード（クレジット −1）→ 教科書出品 → 申し込み → チャット。

## 3. 切り替え後
- メールリンクで登録していた既存ユーザーは、ログイン画面の案内どおり「パスワードを忘れた」から設定してもらう（約20人。個別に連絡してもよい）。
- 2週間問題がなければ、Flutter のコード（`lib/` `android/` `ios/` `web/` `test/` `pubspec.*` `analysis_options.yaml` `.metadata` `kyoto_exam_hub.iml`）と旧ストレージの `posts/` 配下のファイルを削除。
- `moderation_queue` は当面 Firebase コンソールで確認（`priority: true` が権利者からの削除依頼）。

## 既知の制約・あとでやること
- 科目データの一部で教員名の欄に「(配当学年)…(開講年度・開講期)…」などシラバスの別項目が入っている（`tools/build_courses.py` のスクレイプ由来）。検索結果にそのまま出るので、公開前にビルドスクリプトの修正と再シードを推奨。
- 時間割のマスごとの「新着」バッジ、出品の「まだ有効？」通知は未実装（M3・M5 のメモ参照）。
- E2E は自動化せず、エミュレータ上の手動確認のみ（Playwright を入れるなら上の 2-6 の流れを 3 本に）。
