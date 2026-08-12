# セキュリティポリシー

[プロジェクトREADME](../README.md) | [English](../.github/SECURITY.md) | [한국어](SECURITY.ko.md) | [日本語](SECURITY.ja.md)

## サポート対象のバージョン

BuildPouchはまだnpm releaseを公開していません。最初のreleaseまでは、`main`の最新commitを対象にセキュリティ修正を行います。非公式archive、fork、変更されたbuildはこのポリシーのサポート対象外です。

## 脆弱性の報告

疑われる脆弱性を公開issueに投稿しないでください。件名に`[BuildPouch security]`を付けて[dev-team@dreamyoungs.com](mailto:dev-team@dreamyoungs.com)へ次の情報を送ってください。

- 影響を受けるコマンドとversionまたはcommit;
- 影響の明確な説明;
- 最小化し、機密情報を除いた再現手順;
- 提案する緩和策やpatchがある場合はその内容。

Credential、非公開repository、本番データ、非公開source codeを含むarchiveを添付しないでください。Artifactが必要な場合は、maintainerがより安全な転送方法を調整します。

Maintainerは可能な限り速やかに報告を確認し、非公開で調査したうえで、修正が準備できた後に公開時期を調整します。公開前に、検証と修正のための合理的な時間を確保してください。

## セキュリティの対象範囲

Path traversal、意図しないファイルの取り込み、sourceの変更、secretパス制限の回避、archiveの上書き、一時artifactの漏えい、command injection、credentialの露出に関する報告は特に重要です。BuildPouchが文書化されたエラーですでに拒否する設定ミスは、通常、脆弱性ではなくサポート上の問題です。
