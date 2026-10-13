# Vercel公開・引き継ぎ

公開先は `hunet-banana`、アカウントは `tadfujis-projects`、本番ドメインは `https://hunet-banana-studio.vercel.app/`。公開URLと実APIの確認結果は公開後にこの文書へ記録する。

## 配信構成

Viteの本番ビルドだけを静的配信する。GeminiのAPIキーやGoogleへの生成プロキシはVercelに置かず、利用者のWorkerからGoogleへ直接接続する。環境変数へのキー登録は不要。ソース、テスト、ログ、`.env`、ローカル作品は配信しない。

`npm run build` の最後で `scripts/prepare-release.mjs` が次を行う。

- `security-headers.mjs` を元に文書とWorkerのCSPを分けた `vercel.json` を生成。
- 本番ビルドをそのままMCP経由で配信できる `dist/vercel.json` を生成。
- 図解説明書を `dist/guide.pdf` へコピー。アプリのヘルプから同じオリジンで開く。

静的公開するファイルは `dist/index.html`、`dist/assets/` 内のJS・CSS、`dist/guide.pdf`、配信設定のみ。ハッシュ名のWorker専用ルートと、その他のパスのCSPルートは排他的。POST等の標準更新メソッドを405にし、不明なパスは404を保つ。外部へのrewriteやAPI Functionは追加しない。

Vercel ToolbarのProduction/Preview Feedbackは両方無効。ディレクトリ一覧も無効。Vercel Authenticationは `prod_deployment_urls_and_all_previews` を設定し、共有する本番ドメインは匿名アクセス可能に、個別デプロイとプレビューは認証付きにする。公開確認は認証情報のないブラウザとHTTPクライアントで行う。

## 更新と公開後の確認

1. 変更に応じて説明書を更新し、`npm run check` と `npm run test:e2e` を実行。
2. 作業内容をGitに記録し、対象のアカウント・プロジェクトを指定して本番ビルドを配信する。新たな生成SDKや解析サービス、環境変数を追加しない。
3. 公開後、以下でダミーキー・モック応答のブラウザ検査を行う。利用者の普段のブラウザとは別のChromeプロファイルを使う。

```sh
PLAYWRIGHT_BASE_URL=https://hunet-banana-studio.vercel.app npm run test:e2e
```

4. 画面とWorkerのCSPの完全一致、クエリ付きURLとHEAD、HTTPS、PDFのMIME、第三者script不在、匿名アクセス、保存・生成候補・部分編集・切断を確認。
5. 実APIは利用者本人が公開アプリの入力欄にキーを貼り、1K・検索オフで1枚生成。成功後、採用・PNG書き出し・切断を確認する。本人のキーの値をチャットに書かない。モックの成功と実APIの成功を区別して記録する。

実キーの操作中にはブラウザ自動化や通信記録を実行しない。キーの取得・課金・権限・利用枠の設定はGoogle側で本人が行う。エラーを共有する場合はアプリの短いエラー文だけを共有する。
