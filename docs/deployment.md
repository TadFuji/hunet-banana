# Vercel公開・引き継ぎ

公開先は `hunet-banana`、アカウントは `tadfujis-projects`、本番ドメインは `https://hunet-banana-studio.vercel.app/`。公開結果は以下に記録。本人による初回の実生成でモデル利用不可のエラーが発生し、接続診断と404時の限定再試行を公開。更新後、本人の実APIによる初回生成成功の報告と生成候補の画像を確認済み。

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

## 2026-10-13の本番公開結果

- 本番共有URL: https://hunet-banana-studio.vercel.app/
- Vercelプロジェクト: `hunet-banana` / `prj_yM9rdiqB36g5oF8ywAUFVayd2DG3`
- デプロイ: `dpl_4r6VoGNn7jC8hWXAkhr2fGWGb86V`、target production、state READY。
- 公開ソースコミット: `7eb5bafb6511f6c3aee5cd001f3f709224a54a19`。
- https://hunet-banana.vercel.app/ も公開時に同じデプロイへ自動割当され、匿名200を確認。説明書と利用案内はstudio側へ統一する。オリジンが異なるためブラウザ内の作品保存は共有されない。
- 単体15件、ローカルE2E24件、公開URLのE2E24件が成功。公開E2Eは19.7秒。
- 公開URLの匿名200、個別デプロイURLの認証への302、更新メソッドPOST/PUTと任意メソッドBREWの405を確認。個別デプロイURLは `hunet-banana-anc6wtwu5-tadfujis-projects.vercel.app`。
- 文書とWorkerのCSP、その他6種の共通ヘッダーの完全一致、クエリ付きURL・HEAD、HSTS、PDF MIME、第三者script不在を検証。
- Googleの実APIは未使用。実キーを取得・表示・送信記録していない。本人に1K・検索オフで1枚生成、採用、PNG書き出し、切断を案内済み。

公開レスポンスとローカルビルドのバイト一致を確認したSHA-256:

| ファイル | バイト数 | SHA-256 |
|---|---:|---|
| index.html | 402 | `7ea554d30f31a50446d9fce60fa725611d29d0f9a1b47979d86783a7c53fad23` |
| guide.pdf | 4090644 | `7a09303a4e8852ba1a0892630d37b81e23de71f9fe8a0b7c539de67c6ba08373` |
| assets/index-BgITURxo.js | 257636 | `fa52105c58b1ec2b83804bf69b48a1ab03552666d9df947fa6217ed6a967c080` |
| assets/index-CwtLOypH.css | 19965 | `8512f96c930dd269ebbcca71ed9d58e2d15ee51c5ed5f7d972bffdd7a22f32a2` |
| assets/security.worker-BnNFa0Lb.js | 7802 | `8ec0242e348fa203da67a86169d9f24b625ca967951e7821989641d528470ae0` |

配信設定自身は公開対象のHTTP取得で比較していない。Vercelが適用した最終レスポンスのヘッダー・ルート挙動を検証している。更新メソッドの明示拒否とVercel側の処理は、あらゆる任意メソッドの永続的な拒否を証明するものではない。静的配信で書き込み用APIは存在しない。

## 初回実生成エラーへの更新（2026-10-13）

本人が新規生成・1K・1:1・検索オフで試し、「指定モデルまたはBatchが利用できません」のエラーを報告。スクリーンショットでも設定と公開URLを確認した。根本原因はこのメッセージだけでは確定できない。元のモデルIDとv1 generateContent経路は[Googleの公式仕様](https://ai.google.dev/gemini-api/docs/generate-content/image-generation?hl=en)と一致しており、ID誤記・v1非対応と断定していない。

- 更新ソース: `85b6fd3059f02359a48c41ff3b1508e0d5789f99`。
- デプロイ: `dpl_DZJvCGQQLSr9tq9cb6fPCSBYNKRx`、production / READY。同じ本番ドメインに反映済み。
- キー設定に「モデル接続を確認（生成なし）」を追加。固定Googleへのモデル情報GETだけを行い、v1とv1betaの結果を固定文で表示する。画像生成と生成の課金・利用枠の確認は行わない。
- 通常生成のv1が404の場合のみ、v1betaで同じモデル名とgenerateContent対応を確認できれば、同一本文で1回だけ生成を試す。成功したAPI版はキー接続中のみ保持する。権限・利用枠・通信断から追加生成しない。
- Astraが重要差分を独立レビュー。診断結果の過大表示と事前GETエラーの分類を修正し、再レビューで解消を確認。
- ビルド・単体15件、ローカルE2E38件（23.2秒）、公開E2E38件（29.6秒）が成功。いずれも生成通信はダミーキーのモック。ユーザーのキーや通信記録には触れていない。
- 公開されたHTML・JS・CSS・Worker・説明書の全ファイルがローカルビルドと一致。公開側の文書/WorkerのCSP完全一致、HEAD/クエリ付きURL、同一オリジンのPDFと第三者script不在も再確認。
- 更新後は本人にChromeで再読み込みし、キー設定の診断結果だけを共有するよう案内。実生成成功の確認は引き続き必要。

更新後の公開ファイルSHA-256:

| ファイル | バイト数 | SHA-256 |
|---|---:|---|
| index.html | 402 | `f538b1371d4c0afeb3e2bc8db5caf5a6725ec9a090ada6e0b8a440962b726013` |
| guide.pdf | 4090644 | `7a09303a4e8852ba1a0892630d37b81e23de71f9fe8a0b7c539de67c6ba08373` |
| assets/index-CBj48v73.js | 258184 | `7dedaa8e81c3d58d0fa1ec276ef22db259a4c3bd3a2d3ed8853de951352490cf` |
| assets/index-CwtLOypH.css | 19965 | `8512f96c930dd269ebbcca71ed9d58e2d15ee51c5ed5f7d972bffdd7a22f32a2` |
| assets/security.worker-B1xDD4on.js | 9320 | `6e73e1232a023c93f70030d93c13f5d8086c5c42910addf014a185f1d652b2af` |

![接続診断画面（ダミーキーとモック応答）](screenshots/model-diagnostics.png)

## 本人による実API生成成功（2026-10-13）

- 本人のモデル接続診断画面で、v1は404、v1betaは対象モデル名とgenerateContent対応を確認できたことを確認。
- 更新済み公開URLで新規生成・1K・検索オフ、「白い背景に赤いリンゴを1個」を再試行するよう案内し、本人から「うまくいきました」と回答を受けた。
- 添付された候補画面でも、白い背景の赤いリンゴ1個と「キャンバスに採用」ボタンを確認。実APIから生成画像が返るところまで、本人の報告と画像で確認できた。実際に使われたAPI版の通信ログは取得していない。
- 初回の案内は生成→キャンバスに採用→PNG書き出し→キー切断の流れ。回答は全体の成功報告として記録するが、採用・PNG書き出し・切断の各操作を個別に観察したとは扱わない。
- チャットの「候補を採用」という案内を、実際のボタン名「キャンバスに採用」に訂正。アプリと図解説明書のボタン名は元から一致していたため変更不要。
- この成功は本人のキー・初回新規生成の経路についての確認。他の利用者のキーや実APIの部分編集・スケッチ・検索・Batchの成功を証明するものではない。
- キーの値を取得・表示・保存せず、本人のブラウザ自動化や実通信記録も行っていない。今回の更新は記録のみで、公開コードの再配信は不要。
