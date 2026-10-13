# GitHub公開の記録（2026-10-13）

利用者の依頼により、既存のGit履歴を含めて以下のリポジトリーを公開した。

- GitHub: https://github.com/TadFuji/hunet-banana
- 公開範囲: Public
- 既定ブランチ: `main`
- 本番アプリ: https://hunet-banana-studio.vercel.app/

## 公開前の確認

- 公開準備の15コミットをGitleaksで検査し、秘密情報の検出は0件。
- Astraによる独立レビューで、公開を妨げる秘密情報や私的な顧客データは見つからなかった。PDFの抽出テキストとメタデータ、画像のメタデータと主要画面、Git履歴、ダミーキーを使う撮影手順も確認した。全画像の全画素や権利関係を網羅的に審査したものではない。
- 別フォルダーへ新規cloneし、`npm ci --ignore-scripts` と `npm run check` が成功。ビルドと単体テスト18件が成功し、インストール時の依存関係の脆弱性検出は0件。
- READMEの起動手順をGitHubからの取得に対応させ、脆弱性の非公開報告方法を `SECURITY.md` に追加した。

## GitHub側の設定と確認

- Secret scanning: enabled
- Secret scanning push protection: enabled
- Private vulnerability reporting: enabled
- APIで `private: false` と `visibility: public` を確認。
- 認証ヘルパーを無効にした `git ls-remote` で、公開された `main` のコミットがローカルと一致することを確認。

今回のアプリコード変更はないため、Vercelへの再配信は行っていない。Googleの実APIキーは取得・表示・使用していない。公開リポジトリーにする依頼は、ソフトウェアのライセンスを新たに指定する依頼とは扱っていない。
