# BuildPouch コントリビューションガイド

[プロジェクトREADME](../README.md) | [English](CONTRIBUTING.md) | [한국어](CONTRIBUTING.ko.md) | [日本語](CONTRIBUTING.ja.md)

BuildPouchの改善にご協力いただきありがとうございます。変更は、特定の会社やモノレポに依存しない、焦点を絞った検証可能なものにしてください。

## 始める前に

- バグと提案にはGitHub Issuesを使用し、大きな変更は実装前に議論してください。
- credential、secret、非公開のsource code、機密性の高いbuild logを投稿しないでください。
- [行動規範](CODE_OF_CONDUCT.ja.md)と[セキュリティポリシー](SECURITY.ja.md)をお読みください。

## 開発環境

BuildPouchにはNode.js 24とnpm 11.12.1が必要です。

```sh
git clone https://github.com/dreamyoungs/buildpouch.git
cd buildpouch
npm ci --ignore-scripts
npm run check
npm test
```

`main`から目的を限定したbranchを作成してください。既存のTypeScript styleに従い、provider固有の動作はprovider境界内に保ってください。プラットフォームや現在のdependencyでは不十分な理由を説明せずに、新しいdependencyを追加しないでください。

## テスト

Pull Requestを作成する前に、次のコマンドを実行してください。

```sh
npm run check
npm test
npm audit --audit-level=high
npm pack --dry-run
```

Providerテストではmock runnerまたはfake executableを使用してください。自動テストから実際のcloud buildを送信してはいけません。変更が関連する経路に影響する場合は、成功、検証失敗、provider失敗、キャンセル、一時ファイルの削除をテストしてください。

## コミットとPull Request

- すべての変更をGitHub issueに関連付けてください。
- `feat(pack): 実行権限を保持 (#123)`のようなconventional commitを推奨します。
- 1つのPull Requestは1つの成果に集中し、無関係なformattingやrefactoringを避けてください。
- 公開動作が変わる場合は、英語、韓国語、日本語のドキュメントを同時に更新してください。
- 実施した検証と、ローカルで確認できなかった動作を説明してください。

Maintainerはsquash mergeを使用します。具体的なユースケースなしにMVPを拡張するもの、ファイル安全性の境界を弱めるもの、特定のリポジトリに依存する前提を追加するPull Requestには、修正を求めるか受け入れない場合があります。
