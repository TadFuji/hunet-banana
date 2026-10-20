# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

作業ルール（キーの扱い、CSP、合成、保存スキーマ、検証範囲の報告）は次の `AGENTS.md` にあり、ここで読み込まれます。ルールの変更は `AGENTS.md` 側で行ってください。

@AGENTS.md

## コマンド

```sh
npm ci --ignore-scripts        # 依存関係の再現（install スクリプトは実行しない）
npm run dev                    # http://127.0.0.1:5173/ 画面開発用。APIキー接続は意図的に失敗する
npm run build                  # tsc -b → vite build → scripts/prepare-release.mjs
npm start                      # dist を本番と同じヘッダー付きで配信 http://127.0.0.1:4173/
npm run check                  # build + vitest + 文書リンク検査（通常の確認）
npm run test:e2e               # Playwright。先に npm run build が必要
```

- 単体テスト1件: `npx vitest run src/lib/editor.test.ts`（対象は `src/**/*.test.ts` と `scripts/**/*.test.mjs`）
- E2E 1件: `npx playwright test tests/editor.spec.ts -g "<テスト名の一部>"`
- E2E は既定でインストール済み Google Chrome を使う。Chrome がなければ `PLAYWRIGHT_BROWSER_CHANNEL=chromium`。`PLAYWRIGHT_BASE_URL` を指定すると、ローカルサーバーを起動せずにその URL に対して実行する。
- ローカルでは既存の 4173 番サーバーを再利用する（`reuseExistingServer`）。古いビルドのまま `npm start` が動いていると、新しいビルドを試していないことになるので、再ビルド後はそのサーバーを止める。
- リンター・フォーマッターはない。型確認は `npm run build` 内の `tsc -b` で行う。
- `npm run build` は追跡対象の `vercel.json` を `vercel-config.mjs` から再生成し、説明書PDFを `dist/guide.pdf` へコピーする。`vercel.json` は手で編集しない。
- `check:docs` はリポジトリ内の全 Markdown のローカルリンクを検査する。文書でファイルを参照するときは、実在する相対パスにする。

## 全体像

静的配信のシングルページアプリで、運営側のAPIサーバーはない。ブラウザ内の専用 Web Worker が、利用者のキーで Google Gemini API へ直接接続する。詳しい図は `docs/architecture.md`、仕様は `docs/app-design.md`、脅威と境界は `docs/security.md`。

- **編集画面**: ほぼすべてが `src/App.tsx`（単一コンポーネント）にある。メニュー、ツール、Canvas描画、選択・スケッチ用の別Canvas、最大24ステップの履歴、IndexedDB/JSON保存、生成候補の採用、Batch UI を含む。画素処理の純粋関数（画像読込、部分編集の合成、保存データ検証など）は `src/lib/editor.ts` に分けてあり、単体テストはここを対象にする。
- **キーと通信の境界**: `src/api/client.ts` が Worker の生成・RPC・15分無操作やページ離脱での終了を管理し、接続ごとの `session` 番号で古い生成要求の送信を止める。`src/api/security.worker.ts` だけがキーを持ち、固定オリジンへ `x-goog-api-key` ヘッダーで送る。`src/api/protocol.ts` がリクエストの組み立てと応答の検証・抽出を行い、Worker から呼ばれる。
- **配信ヘッダー**: `security-headers.mjs` が文書用CSP（`connect-src 'none'`）と Worker 用CSP（Google だけを許可）を定義する。ローカルは `server.mjs`、Vercel は `vercel-config.mjs` が、Worker のファイル名 `assets/security.worker-[hash].js` を正規表現で判別して Worker 用CSPを付ける。このファイル名は `vite.config.ts` で決めているので、変えるとローカル・Vercel・テストの3か所がずれる。
- **型と固定値**: モデルID・比率・`Project`/`Layer` の形は `src/types.ts`。レイヤーは PNG の dataURL と整数オフセット `x`/`y` を持ち、移動では画素を描き直さない。
- **テスト**: `tests/*.spec.ts` はダミーキーと、Google への通信を `context.route` で差し替えたモックで、CSP・キー非保持・生成・合成・診断を確かめる。実APIや課金は検証しない。

## コードの書き方

既存のソース（`src/api/*`、`server.mjs` など）は、1行に複数の文を詰めた短い書き方が多い。変更するときは周囲の書き方に合わせる。

## GitHub の運用

`main` はブランチ保護されており、変更は Pull Request（Squash 統合）で入れる。必須チェックは Node 22/24 の check、Chromium の E2E、全履歴の秘密情報スキャン、CodeQL。詳細は `docs/development.md` の「GitHubでの保守」。Dependabot の PR は自動統合しない。未解決のレビュー会話（自動レビューのコメントを含む）が残っていると統合できない。GitHub の自動統合（auto-merge）はリポジトリ設定で無効。

## 公開（Vercel）

Vercel プロジェクト `hunet-banana`（チーム `tadfujis-projects`）は GitHub と自動連携していない。`main` に統合しても公開版は変わらない。統合後に `npm run build` した `dist` の中身を、Vercel CLI でそのまま本番配信する（`dist/vercel.json` が配信ヘッダーを含む）。リポジトリ外の作業用フォルダーに `dist` をコピーし、`.vercel/project.json` に `{"projectId":"prj_yM9rdiqB36g5oF8ywAUFVayd2DG3","orgId":"team_WAAbwc67azA5nSnKk2XCVrSC"}` を置いて `vercel deploy --prod --yes` を実行する（どちらも識別子で、秘密情報ではない。認証は実行者の Vercel CLI のログインを使う）。配信後の確認手順と過去の記録は `docs/deployment.md`。

## 文書の更新先

- 利用者向けの説明: `README.md`、図解取扱説明書（`docs/manual/` のソースから `output/pdf/` を再生成。手順は `docs/manual/README.md`）
- 利用者に見える変更: `CHANGELOG.md` の Unreleased
- 実キーとモックで確認した範囲の記録: `docs/validation.md`、公開の記録: `docs/deployment.md`
- `docs/app-design-ai-studio-archive.md` と `docs/ai-studio-build-prompts.md` は旧案の記録で、現行仕様ではない。
