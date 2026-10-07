# 京大InfoHub Next.js 移行 — 設計ドキュメント

- 日付: 2026-10-08
- 対象: `kyoto_exam_hub`（Flutter Web + Firebase、kyodai-info.web.app）を Next.js に作り直す
- ステータス: ブレインストーミング完了、レビュー待ち
- 前提ドキュメント: `docs/specs/2026-09-07-kyodai-info-redesign-design.md`（プロダクト設計。以下「再設計書」）、`docs/superpowers/plans/2026-10-03-phase2a-credits-private-resources.md`（ポイント設計。以下「2A 計画」）、`design.md`（デザインシステム）

---

## 1. 目的

- フロントエンドを Flutter Web から **Next.js** に置き換え、**検索流入（SEO）・初回表示速度・日本語の表示品質**の弱点を解消する
- 同時に、再設計書の Phase 1〜3 と 2A 計画の内容を**1 回のリリースにまとめて**実装する
- 公開は **2027 年 1 月の試験期**。今期（2026 年 10 月）の履修登録期は見送る

### 非ゴール
- バックエンドの乗り換え（Firebase Auth / Firestore / Storage は継続）
- ネイティブアプリ、多大学展開、AI 機能、収益化機能（再設計書の非ゴールを継承）

---

## 2. 意思決定ログ

| 論点 | 決定 | 理由 |
|---|---|---|
| 書き換えの是非 | **Next.js に全面移行** | オーナー判断（2026-10-08） |
| 初回リリースの範囲 | **全機能**：LP / さがす・科目詳細・レビュー / 時間割・マイページ・登録 / 過去問・資料＋ポイント / 教科書 | オーナー判断 |
| ローンチ時期 | **Next.js 版完成まで公開しない。1 月の試験期が最初の山** | オーナー判断。今期の履修登録期は見送る |
| 未ログインへの公開範囲 | **科目ページの要約のみ**（科目名・教員・曜限・★平均・楽単度分布・レビュー件数・過去問件数）。レビュー本文・過去問・教科書はログイン後 | 検索に出しつつ「京大生限定」の価値と炎上リスク低減を両立 |
| ホスティング | **Firebase App Hosting**（同一プロジェクト `kyodai-sns`、リージョン `asia-east1`） | Firestore と同じリージョン。管理場所が 1 つ。Blaze は 2A でも必要だった |
| サーバー処理 | **Next.js の Route Handlers**（Admin SDK）。Cloud Functions は作らない | 2A 計画の callable / trigger を同じリポジトリの TypeScript で書ける |
| 認証方式 | **メール＋パスワード＋確認メールに一本化**。メールリンク認証は廃止 | 現状 2 経路が中途半端に混在している |
| 教科書 | **再設計書 4.4 の出品型マーケットを新規実装**。旧リクエスト型・20pt 決済・`talk_rooms` は移行しない | 作り直し直後の再作り直しを避ける |
| スタイリング | **Tailwind CSS**。`design.md` のトークンを CSS 変数＋Tailwind テーマとして 1 か所に定義 | トークン直参照を強制しやすく、AI による実装と相性が良い |

---

## 3. アーキテクチャ

### 3.1 データの読み書き 3 分類

| 分類 | 対象 | 実装 | 安全性の担保 |
|---|---|---|---|
| **公開（サーバー描画）** | LP、`/courses/[id]` の要約、`/search` のランキング | Server Component が Admin SDK で読む。ISR（`revalidate = 3600`） | **公開フィールドだけを返す関数**（`lib/server/public.ts`）を経由する。レビュー本文などは型レベルで返せない |
| **ログイン後の閲覧・軽い書き込み** | レビュー本文の閲覧、時間割、プロフィール、お問い合わせ | Client Component が Firebase JS SDK で直接読み書き | 既存の `firestore.rules` |
| **権限が要る操作** | ポイント増減、過去問 DL、資料投稿、レビュー投稿（ボーナス・集計つき）、教科書の出品・評価、通知作成 | `app/api/**/route.ts`（POST）。クライアントは Firebase ID トークンを `Authorization: Bearer` で送る | サーバーで `verifyIdToken` → `email_verified` かつ `@st.kyoto-u.ac.jp` を確認してから処理 |

- ログイン状態の判定はクライアント側（Firebase Auth）。サーバーセッション Cookie は使わない（公開ページはログイン状態に依存せず描画し、ログイン後の内容はクライアントで差し込む）
- Admin SDK は App Hosting のサービスアカウント（ADC）で認証する。**鍵ファイルはリポジトリに置かない**

### 3.2 ディレクトリ構成
```
site/                      ← Next.js アプリ（新規）
  app/
    (public)/page.tsx            LP
    (public)/courses/[id]/page.tsx
    (public)/search/page.tsx
    (auth)/login, signup, verify
    (app)/timetable, mypage, textbooks, ...
    api/                          Route Handlers
    sitemap.ts, robots.ts
  components/               UI 部品（design.md 6 章に対応）
  lib/
    firebase/client.ts      JS SDK 初期化
    server/admin.ts         Admin SDK 初期化（server-only）
    server/auth.ts          requireKuUser(req)
    server/public.ts        公開フィールドの取り出し
    server/credits.ts       2A 計画の credits.ts を移植
  styles/tokens.css         design.md のトークン
  tests/
apphosting.yaml
firestore.rules, storage.rules, firestore.indexes.json   ← ルートに残す（共有）
lib/ (Flutter)              ← 切り替え完了後に削除
```

---

## 4. 画面と URL

| URL | 公開 | 中身 |
|---|---|---|
| `/` | ○ | LP（design.md 7 章） |
| `/search` | ○ | 科目検索、ランキング（楽単・過去問が多い・レビューが多い・新着）、学部/系列フィルタ |
| `/courses/[id]` | 要約のみ ○ | 未ログイン：要約＋「京大生ログインでレビューを読む」。ログイン後：タブ「レビュー」「過去問・資料」 |
| `/timetable` | × | 週グリッド。空きマス→検索→登録、登録マス→科目詳細 |
| `/textbooks` | × | 出品一覧（譲る/売る/買いたい）、出品、取引チャット、相互評価 |
| `/mypage` | × | プロフィール、クレジット残高・履歴、自分の投稿、招待コード、設定、お問い合わせ |
| `/notifications` | × | 通知一覧（ベルアイコンから） |
| `/login` `/signup` `/verify` | ○ | 認証 |
| `/legal/*` | ○ | 利用規約、プライバシー、権利者向け削除依頼フォーム |

- レイアウト：スマホ（< 768px）は**下タブ 4 つ（さがす / 時間割 / 教科書 / マイページ）**、PC は左サイドバー（Todoist 式）に同じ 4 項目＋通知。アプリバー右にベルアイコン

### 4.1 SEO
- `sitemap.ts`：**レビューが 1 件以上ある科目だけ**を出す（約 1 万件の空ページで評価を下げない）
- レビュー 0 件の科目ページは `noindex`
- 各科目ページに `title`（例「微分積分学A（山田太郎）の楽単度・評判 | 京大InfoHub」）、`description`、OGP、構造化データ（`Course` ＋ `AggregateRating`、件数 ≥ 3 のときのみ）
- OGP 画像は `opengraph-image.tsx` で科目名と★を描画

---

## 5. 認証

- 登録：京大メール（`@st.kyoto-u.ac.jp`）＋パスワード → 確認メール送信 → `/verify` で待機（再送ボタン、確認後に自動遷移）
- ログイン：メール＋パスワード。パスワード再設定メール
- 招待コード：登録フォームで任意入力（`users.pendingReferralCode`）。付与は `POST /api/welcome`（2A 計画 P2-2 と同じ条件）
- 既存ユーザー：同じ Firebase Auth なのでそのままログインできる。**メールリンクでしか登録していないユーザーは「パスワード再設定」で設定してもらう**（ログイン画面に案内文を出す）

---

## 6. データとサーバー処理

### 6.1 Firestore
- 既存コレクションは構造を維持：`courses` `course_stats` `reviews` `posts` `requests` `users` `user_timetables` `inquiries` `meta`
- 2A 計画で追加：`credit_balances` `credits_ledger` `invitation_codes`
- 新規：`textbook_listings` `chats/{id}/messages` `trade_ratings` `notifications`
- 移行しない（読まない・後で削除）：`transactions` `talk_rooms` `textbook_requests`、`users.points`（2A 計画 P2-5）

### 6.2 Route Handlers（2A 計画の Functions を置き換え）
| エンドポイント | 中身 | 2A 計画との対応 |
|---|---|---|
| `POST /api/welcome` | 初回 +3、招待コード発行・照合 | `claimWelcome` |
| `POST /api/resources/download` | 残高 −1（再 DL 無料）、台帳、10 分の署名 URL | `downloadResource` |
| `POST /api/resources` | アップロード済みファイルを検証 → `posts` 作成 → +3（1 日 3 回まで）。リクエスト充足なら +3 | `onPostCreated`（trigger → 同期 API に変更） |
| `POST/PATCH/DELETE /api/reviews` | 1 人 1 科目 1 件。**`course_stats` をトランザクションで更新**。最初の 3 件 +2、レビュー 5 件以下の科目 +1、1 日 5 回まで | `onReviewCreated` |
| `POST /api/textbooks/*` | 出品、取引成立、相互評価、「買いたい」一致の通知作成 | 新規 |
| `POST /api/reports` | 通報。閾値で非表示＋運営キュー | 2B の一部を前倒し |

- 金額・上限は 2A 計画の「Global Constraints」と P2-1〜P2-14 をそのまま採用（`lib/server/credits.ts` に定数として集約）
- **`course_stats` と `reviews` の作成・更新はサーバーのみに変更**（ルールで `write: false`）。公開ページに出す集計値をクライアントが偽造できないようにするため
- Storage：過去問・資料は非公開。クライアントは `uploads/{uid}/pending/` にだけ書け、`/api/resources` が検証して正式パスへ移動する。教科書の写真は `textbook_photos/{uid}/` に公開読み取りで保存

### 6.3 教科書マーケット（再設計書 4.4 を実装）
- 出品タイプ：譲る / 売る / 買いたい。フィールド：書名、関連科目（任意）、状態、価格（売る場合）、写真（最大 3 枚）、受け渡し場所（プリセット）
- 「買いたい」と同じ科目の出品が作られたら、買いたい人に通知
- 話がついたらチャット（`chats/{id}/messages`、ページネーション）。取引成立後に相互評価（★＋一言）
- 決済はアプリ外。画面に明示。30 日で「まだ有効？」通知、期限切れは非表示

---

## 7. デザイン
- `design.md` に従う。8.1 章（Flutter）は Next.js 用に書き換える：トークンは `site/styles/tokens.css` と Tailwind テーマで定義し、**任意値（`bg-[#...]`、`text-[13px]` など）を禁止**（ESLint で検出）
- フォント：`next/font/google` で Noto Sans JP（400/500/700）
- アニメーション：CSS transition と `IntersectionObserver` のみ。アニメーションライブラリは入れない

---

## 8. 切り替え

1. 開発中は App Hosting のバックエンド URL（`*.hosted.app`）で確認。Flutter 版は kyodai-info.web.app でそのまま動かす
2. 公開時：**独自ドメインを取得して App Hosting に割り当てる**。kyodai-info.web.app は Firebase Hosting のリダイレクトで新ドメインへ 301 転送
3. ルール変更（`reviews` `course_stats` のサーバー専用化、Storage 非公開化）は**切り替えと同時に**デプロイ（先に出すと Flutter 版が壊れる）
4. 既存の公開 Storage ファイルは 2A 計画の `migrate_storage.mjs` で非公開パスへ移す（サービスアカウント鍵が必要なのでオーナーが実行）
5. 切り替え後 2 週間問題がなければ、Flutter のコード（`lib/` `android/` `ios/` `web/` `pubspec.*` など）を削除

---

## 9. テスト方針
- **Route Handlers**：Vitest ＋ Firestore/Auth/Storage エミュレータ。2A 計画のテスト観点（同時 DL で残高がマイナスにならない、日次上限、冪等性、招待の不正防止）をすべて移植
- **公開フィールド**：`public.ts` がレビュー本文やユーザー ID を返さないことのテスト
- **ルール**：既存の `firestore-tests/rules.test.mjs` を更新（reviews / course_stats の書き込み禁止、新コレクション）
- **E2E**：Playwright で 3 本だけ：登録→確認→レビュー投稿 / 未ログインで科目ページの要約表示 / 過去問 DL でクレジット減少
- **デザイン**：Lighthouse の Performance・Accessibility・SEO が公開ページで 90 以上

---

## 10. マイルストーン（2027 年 1 月公開）

| # | 内容 | 目安 |
|---|---|---|
| M1 | 土台：`site/` 作成、トークン、レイアウト（下タブ/サイドバー）、認証、App Hosting デプロイ | 10 月中旬 |
| M2 | さがす、科目詳細、レビュー API、公開 SEO ページ、sitemap | 10 月末 |
| M3 | 時間割、マイページ、お問い合わせ、通知 | 11 月中旬 |
| M4 | 過去問・資料、クレジット API、Storage 非公開化、リクエスト掲示板 | 11 月末 |
| M5 | 教科書マーケット | 12 月中旬 |
| M6 | LP、法務ページ、E2E、切り替え | 12 月末 |

各マイルストーンごとに実装計画（`docs/superpowers/plans/`）を書いてから着手する。

---

## 11. リスク
| リスク | 対応 |
|---|---|
| 全機能 1 回リリースでスコープ超過 | マイルストーン単位で動く状態を保つ。M5（教科書）が遅れたら教科書だけ「近日公開」で 1 月に出す |
| 公開ページから非公開データが漏れる | 公開データは `public.ts` 経由のみ。テストで検証 |
| 切り替え時に Flutter 版が壊れる | ルール変更は切り替えと同時。切り替え前日にエミュレータで全テスト |
| メールリンク登録の既存ユーザーがログインできない | パスワード再設定の案内（既存は約 20 人なので個別連絡も可） |
| App Hosting のコスト | 最小インスタンス 0。ISR でサーバー描画回数を抑える |

---

## 12. 未決事項
- 独自ドメイン名（切り替え時までに決定）
- 通報の閾値（再設計書から継続。暫定 3 件）
- 学部/系列フィルタの系列マスタ（再設計書から継続）
