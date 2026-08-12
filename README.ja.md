# BuildPouch

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> ビルドに必要なものだけを詰め込みましょう。

BuildPouchは、モノレポから安全で最小限のビルドコンテキストアーカイブを作成し、ビルドプロバイダーに送信するためのCLIプロジェクトです。

## プロジェクトの状況

BuildPouchは初期開発段階にあります。TypeScript CLIの土台では`--help`と`--version`を利用できますが、以下のコマンドと設定は引き続き提案であり、変更される可能性があります。npmパッケージはまだリリースされていません。

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

## 予定されているワークフロー

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

## 予定されているMVP

| コマンド | 役割 |
| --- | --- |
| `buildpouch inspect` | ファイルをコピーしたりクラウドプロバイダーへ接続したりせず、コンテキストを算出して検証します。 |
| `buildpouch pack` | 検証済みのファイルを一時ディレクトリに配置し、`tar.gz`アーカイブを作成します。 |
| `buildpouch submit` | コンテキストをパッケージ化するか既存のアーカイブを受け取り、設定されたプロバイダーを通じて送信します。 |

最初に対応予定のプロバイダーは、既存の`gcloud` CLIを通じて呼び出すGoogle Cloud Buildです。`build.json`や`cloudbuild.yaml`などのプロバイダー固有のビルド設定は、BuildPouchを利用するリポジトリが引き続き所有します。

予定されているコマンド形式:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml
```

これらのコマンドはドキュメント上のプレビューであり、まだ利用できません。

## 提案されている設定

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

## 設計原則

- **許可リストを優先:** 明示的に選択されたビルド入力だけを含めます。
- **ワークスペースを保全:** コンテキストの作成中にソースファイルを移動、変更、削除しません。
- **プロバイダーを分離:** コンテキストの計画とパッケージ化を、リモートビルドの実行から分離します。
- **内容を可視化:** 送信前に対象パス、ファイルサイズ、合計サイズ、競合を表示します。
- **小さなMVP:** 具体的なユースケースが生じた場合にのみ、依存関係リゾルバーやプロバイダー抽象化を追加します。

## セキュリティ境界

MVPでは、以下の動作を予定しています。

- 設定されたルート外を参照するソースパスを拒否します。
- 絶対パスやパストラバーサルを含むアーカイブのターゲットを拒否します。
- デフォルトではソースのシンボリックリンクをたどりません。
- 大文字と小文字を区別しないファイルシステムでの競合を含め、ターゲットの競合を検出します。
- 一般的なシークレットファイル、認証情報ディレクトリ、秘密鍵、ローカルキャッシュ、一時ファイルをブロックします。
- ソースワークスペースの外に、現在のユーザーだけがアクセスできる一時ディレクトリを作成します。
- 成功、失敗、キャンセルのいずれの場合も一時生成物を削除します。

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

このプロジェクトは公開の場で設計を進めています。大規模なPull Requestを作成する前に、質問や提案を[GitHub Issues](https://github.com/dreamyoungs/buildpouch/issues)で共有してください。

## ライセンス

BuildPouchは[Apache License 2.0](LICENSE)のもとで提供されています。
