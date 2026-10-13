# 開発ガイド

## 必要な環境

- Node.js 22.12以上の22系、または24系。利用可能な範囲は `package.json` の `engines` を基準にしてください。
- npmと、ローカルの画面確認用ブラウザ。E2Eの標準はGoogle Chrome、CIではPlaywrightのChromiumを使います。
- **開発や自動テストにGemini APIキーは不要です。** キーをリポジトリ、環境ファイル、Issue、テストの記録に貼らないでください。

初回取得と依存関係の再現:

```sh
git clone https://github.com/TadFuji/hunet-banana.git
cd hunet-banana
npm ci --ignore-scripts
```

画面だけを変更するときは `npm run dev` で `http://127.0.0.1:5173/` を開けます。Viteの開発サーバーではAPIキー接続を禁止しています。Workerと文書に別々の本番CSPを付けて操作を確認するには、以下を使ってください。

```sh
npm run build
npm start
```

既定のURLは `http://127.0.0.1:4173/` です。起動スクリプトを使う場合の動きは[README](../README.md#使い始める)を参照してください。`npm run build` はTypeScriptの確認、Viteビルド、Vercel設定と説明書PDFの `dist` への配置を行います。

## 検証

```sh
npm run check
npm run test:e2e
```

`check` はビルド、単体テスト、配信ヘッダーの設定テスト、文書内のローカルファイルリンク検査を実行します。E2Eの前に `npm run build` が済んでいる必要があります。ブラウザテストは `npm start` を自動起動し、ダミーキーとモックしたGoogle通信を使用します。既定ではインストール済みGoogle Chromeを使います。Chromeがない環境では、PlaywrightのChromiumを取得して次のように実行できます。

```sh
npx --no-install playwright install chromium
PLAYWRIGHT_BROWSER_CHANNEL=chromium npm run test:e2e
```

キー管理、生成、画素合成、セキュリティヘッダーに変更したときは、`check` とE2Eの両方を実行してください。ブラウザテストは自動テスト専用のコンテキストを使い、実APIへの有料リクエストや実キーでの動作を証明するものではありません。公開環境へ配信した場合は、[公開・検証記録](deployment.md)にある匿名アクセスと実レスポンスヘッダーの確認も必要です。アプリ内の料金表示や説明書の料金表を更新する際はGoogle公式資料と確認日を更新してください。

## 変更時の確認点

- APIキーを扱う経路は[セキュリティ設計](security.md)と[アーキテクチャ](architecture.md)を先に読み、Workerの一時メモリ以外へキーを置かないでください。画面の接続状態はキー本体を保持しません。
- 文書・Workerの両方のCSPを維持してください。Workerのハッシュ付き出力ファイル名や配信ルートを変えた場合は、ローカルとVercelの両方のヘッダーを確認してください。
- 部分編集の未選択領域はアプリ側で元画像からコピーします。モデル出力が一致する前提に置き換えないでください。
- 保存スキーマの変更時は、読込時の検証、レイヤー・画素上限、JSONの許可フィールド、旧データの扱いを合わせて確認してください。
- UIや料金案内を変えた場合は、[図解取扱説明書](manual/README.md)とスクリーンショットも更新してください。

## GitHubでの保守

`main` への変更はPull Requestで行います。保護設定は管理者にも適用され、最新の `main` を取り込んだ状態で次の7チェックが成功する必要があります。

| 必須チェック | 確認する内容 |
| --- | --- |
| `Check (Node 22)` / `Check (Node 24)` | ビルド、単体テスト、文書リンク、依存関係の監査 |
| `Browser tests (Chromium)` | Linux上でのブラウザ操作とセキュリティ境界 |
| `Secret scan (full history)` | 全Git履歴への秘密情報の混入 |
| `CodeQL (javascript-typescript)` / `CodeQL (actions)` / `CodeQL` | コードとワークフローの静的解析、解析結果の集約 |

単独の保守担当者でも統合できるよう、必須の承認数は0です。コードレビューを自動検証で代替できるという意味ではありません。重要な変更には独立レビューを行い、指摘と確認結果をPRに残してください。会話の解決と直線的な履歴を必須とし、統合はSquashを使います。`main` の強制プッシュと削除は禁止しています。

Actionsは許可した公式アクションだけをコミットSHAで固定し、既定のトークン権限は読み取り専用にしています。解析結果の投稿などに必要な権限は該当ジョブだけに与えます。ブラウザテストが失敗した場合の記録は3日間保持します。テストにはダミーキーを使い、実APIキーをGitHub Secretsへ追加する運用は行いません。

DependabotはnpmとActionsの更新PRを週次で作成します。自動統合は設定していません。差分と検証結果を確認して統合してください。GitHubの秘密情報スキャン、Push Protection、非公開の脆弱性報告も有効にしています。これらのホスト側設定はリポジトリをコピーしても引き継がれないため、新しいリポジトリでは再設定が必要です。設定を変えた場合はこの文書も更新してください。

不具合や改善提案の出し方は[貢献ガイド](../CONTRIBUTING.md)へ。セキュリティ上の問題は[非公開の報告手順](../SECURITY.md)を使ってください。
