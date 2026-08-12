# BuildPouch

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> ビルドに必要なものだけを詰め込みましょう。

BuildPouchは、モノレポから安全で最小限のビルドコンテキストアーカイブを作成し、ビルドプロバイダーに送信するためのCLIプロジェクトです。

## プロジェクトの状況

BuildPouchは初期開発段階にあります。ソースから`inspect`、`pack`、`submit`のMVPコマンドを利用できます。公開インターフェースは変更される可能性があり、npmパッケージはまだリリースされていません。

## AIを活用した開発

BuildPouchは、設計、実装、テスト、ドキュメント作成、翻訳、レビューの全般にわたり、AI開発ツールを意図的かつ非常に積極的に活用しています。プロジェクトの発展に伴い、今後もAIを積極的に活用していく予定です。

AIの支援を受けても、メンテナーの責任がAIに移ることはありません。技術的な判断、レビュー、セキュリティ、ライセンス、リリースについてはメンテナーが責任を負い、AIを活用した作業にも他のすべての貢献と同じ品質およびテスト基準を適用します。

人が直接作成した貢献、AIの支援を受けた貢献、またはその両方を組み合わせた貢献を歓迎します。ただし、メンテナーが確認すべき品質、出所、またはライセンス上の検討事項が生じるほどAIを使用した場合は、その事実を開示してください。

## ローカル開発

現在のBuildPouchにはNode.js 24とnpm 11.12.1が必要です。

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

ビルド後は、`node dist/cli.js --help`でローカルCLIを実行できます。

## BuildPouchが必要な理由

モノレポ内のアプリケーションは、自身のディレクトリ外にあるファイルを必要とすることがあります。共有パッケージ、ルートのマニフェスト、ロックファイル、生成済みクライアント、ビルド設定、静的アセットなどがその例です。

アプリケーションディレクトリだけをビルドコンテキストにすると、必要なファイルが欠ける可能性があります。一方、モノレポ全体をアップロードすると、無関係なアプリケーション、ドキュメント、キャッシュ、機密ファイルまで含まれる可能性があります。

BuildPouchは許可リストを優先する方式を採用します。ビルドに必要なファイルを明示的に選択し、アーカイブ内での配置先を検証して、選択されたコンテキストだけをパッケージ化します。

## ワークフロー

```text
設定とCLI引数
      │
      ▼
コンテキストの計画
      │
      ▼
パス・競合・セキュリティ検査
      │
      ▼
分離された一時ステージングディレクトリ
      │
      ▼
 tar.gzアーカイブ
      │
      ▼
ビルドプロバイダーアダプター
```

コンテキスト作成とプロバイダーへの送信は別々の段階として維持します。これにより、失敗の原因を明確に区別し、各段階を個別にテストできます。

## MVPコマンド

| コマンド | 状態 | 役割 |
| --- | --- | --- |
| `buildpouch inspect` | ソースから利用可能 | ファイルをコピーしたりクラウドプロバイダーへ接続したりせず、コンテキストを算出して検証します。 |
| `buildpouch pack` | ソースから利用可能 | 検証済みのファイルを一時ディレクトリに配置し、`tar.gz`アーカイブを作成します。 |
| `buildpouch submit` | ソースから利用可能 | コンテキストをパッケージ化するか既存のアーカイブを受け取り、設定されたプロバイダーを通じて送信します。 |

最初のプロバイダーは、既存の`gcloud` CLIを通じて呼び出すGoogle Cloud Buildです。`build.json`や`cloudbuild.yaml`などのプロバイダー固有のビルド設定は、BuildPouchを利用するリポジトリが引き続き所有します。

コマンド形式:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml
```

npmパッケージをリリースするまでは、プロジェクトをビルドして各コマンドをローカルで実行できます。

```sh
npm run build
node dist/cli.js inspect --config buildpouch.yaml
node dist/cli.js inspect --config buildpouch.yaml --json
node dist/cli.js pack --config buildpouch.yaml
node dist/cli.js pack --config buildpouch.yaml --output customer-api.context.tar.gz --json
node dist/cli.js submit --config buildpouch.yaml
node dist/cli.js submit --config buildpouch.yaml --archive customer-api.context.tar.gz --json
```

`inspect`はmetadataだけを読み取ります。ファイルをステージングしたりプロバイダーへ接続したりせず、すべてのsource→target mapping、各ファイルサイズ、ファイル数、合計サイズを表示します。

`pack`は同じ検証を再度行い、選択されたファイルを分離された一時ディレクトリにコピーして、ポータブルなgzip圧縮tarアーカイブを作成します。デフォルトの出力先は、現在のディレクトリにある`<context.name>.context.tar.gz`です。`--force`を指定しない限り既存のアーカイブは保持されます。コマンド終了後にステージングディレクトリを確認する必要がある場合のみ、`--keep-context`を使用してください。

`submit`を使用するには、Google Cloud CLIがインストールされ、認証済みである必要があります。`--archive`がない場合は内部の一時アーカイブを作成し、Cloud Buildの完了を待ってからそのアーカイブを削除します。`--archive`で渡した既存のアーカイブは削除しません。最終的なbuild ID、ステータス、所要時間、Cloud Console URLは、人向け出力とJSON出力の両方で確認できます。

1回の実行に限り、プロバイダーの値を上書きできます。

```sh
node dist/cli.js submit --config buildpouch.yaml \
  --project another-project \
  --region us-central1 \
  --build-config ./cloudbuild.yaml \
  --substitution _APP_NAME=customer-api
```

## 設定

```yaml
schemaVersion: 1

context:
  name: customer-api
  root: .
  entries:
    - source: apps/customer/api/dist
      target: .
      required: true
    - source: apps/customer/api/Dockerfile
      target: Dockerfile
      required: true
    - source: apps/customer/api/static
      target: static
      required: false

  exclude:
    - "**/node_modules/**"
    - "**/.git/**"
    - "**/coverage/**"

build:
  provider: gcp-cloud-build
  config: apps/customer/api/deploy/gcp/build.json
  project: example-project
  region: asia-northeast3
  substitutions:
    _APP_NAME: customer-api
```

エントリーの一覧がソースの許可リストを構成します。各エントリーは、`context.root`以下にあるファイル、ディレクトリ、または対応するglobをアーカイブ内のパスに対応付けます。除外設定は許可リストを絞り込みますが、それだけでコンテキストを定義するものではありません。

相対的な`context.root`は設定ファイルのディレクトリを基準に解決されます。各エントリーのsourceは、このrootを基準に解決されます。`required`のデフォルト値は`true`で、必須エントリーが存在しない場合や除外後に空になる場合はinspectが失敗します。

相対的な`build.config`パスも設定ファイルのディレクトリを基準に解決されます。`--build-config`の上書きは現在の作業ディレクトリを基準に解決されます。ユーザー定義のCloud Build substitution keyは`_`で始まり、大文字、数字、underscoreのみを含める必要があります。Substitutionの値はコマンド出力に表示されるため、secretをsubstitutionとして渡さず、build configurationを通じてSecret Managerを使用してください。

## 設計原則

- **許可リストを優先:** 明示的に選択されたビルド入力だけを含めます。
- **ワークスペースを保全:** コンテキストの作成中にソースファイルを移動、変更、削除しません。
- **プロバイダーを分離:** コンテキストの計画とパッケージ化を、リモートビルドの実行から分離します。
- **内容を可視化:** 送信前に対象パス、ファイルサイズ、合計サイズ、競合を表示します。
- **小さなMVP:** 具体的なユースケースが生じた場合にのみ、依存関係リゾルバーやプロバイダー抽象化を追加します。

## セキュリティ境界

現在のコマンドは、以下の動作を行います。

- 設定されたルート外を参照するソースパスを拒否します。
- 絶対パスやパストラバーサルを含むアーカイブのターゲットを拒否します。
- デフォルトではソースのシンボリックリンクをたどりません。
- 大文字と小文字を区別しないファイルシステムでの競合を含め、ターゲットの競合を検出します。
- 一般的なシークレットファイル、認証情報ディレクトリ、秘密鍵、ローカルキャッシュ、一時ファイルをブロックします。
- ソースワークスペースの外に、現在のユーザーだけがアクセスできるステージングディレクトリを作成します。
- 最終パスに確定する前に、同じディレクトリ内の一意な一時ファイルへアーカイブを書き込みます。
- `--force`を明示しない限り、既存のアーカイブの上書きを拒否します。
- `--keep-context`を明示した場合を除き、成功、失敗、キャンセルの後にステージングと不完全なアーカイブを削除します。
- shellを使わず、argument arrayで`gcloud`を実行します。
- cloud credentialを読み取ったり保存したりせず、現在の`gcloud` identityを使用します。
- `submit`が内部で作成したアーカイブだけを削除し、ユーザーが渡したアーカイブは保持します。

`submit`をキャンセルすると、ローカルの`gcloud` processを停止し、一時ファイルを削除します。Cloud Buildがすでに受け付けたリモートbuildまでキャンセルされることは保証しません。

パスに基づくブロックは、ファイル内容を解析するシークレットスキャナーではありません。ファイル内容の検査が必要な場合は、CIで専用のセキュリティツールを使用してください。

## MVPの対象外

BuildPouchは、以下の作業を行いません。

- TypeScript、Rust、Go、その他のアプリケーションコードのコンパイル
- Nx、pnpm、Cargo、Goの依存関係グラフの自動解析
- ロックファイル、Dockerfile、ビルド設定の生成や変更
- Kubernetes、Cloud Run、その他のランタイムプラットフォームへの直接デプロイ
- クラウドの認証情報やシークレットの作成、保存、同期
- Gitコミット、リリース、外部通知の管理

リポジトリ側のタスクは、BuildPouchを呼び出す前に、コンパイル済みの出力やprune済みの依存関係ツリーを準備できます。

## コントリビューション

このプロジェクトは公開の場で設計を進めています。[コントリビューションガイド](CONTRIBUTING.ja.md)と[行動規範](CODE_OF_CONDUCT.ja.md)を読み、大規模なPull Requestを作成する前に質問や提案を[GitHub Issues](https://github.com/dreamyoungs/buildpouch/issues)で共有してください。脆弱性は公開issueではなく、[セキュリティポリシー](SECURITY.ja.md)の手順で報告してください。

主な変更は[変更履歴](CHANGELOG.md)で管理します。

## ライセンス

BuildPouchは[Apache License 2.0](LICENSE)のもとで提供されています。
