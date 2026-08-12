# BuildPouch

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> ビルドに必要なものだけを詰め込みましょう。

BuildPouchは、モノレポから安全で最小限のビルドコンテキストアーカイブを作成し、ビルドプロバイダーに送信するためのCLIプロジェクトです。

## プロジェクトの状況

BuildPouch 0.1.0は、最初の公開npm releaseです。`inspect`、`pack`、`submit`のMVPコマンドを利用できます。0.x releaseの間は公開interfaceが変更される可能性があります。

## インストール

BuildPouchにはNode.js 24以降が必要です。プロジェクトにインストールし、`npx`で実行します。

```sh
npm install --save-dev buildpouch
npx buildpouch --help
```

複数のプロジェクトで対話的に使用する場合は、globalインストールも利用できます。

```sh
npm install --global buildpouch
buildpouch --help
```

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
| `buildpouch inspect` | 利用可能 | ファイルをコピーしたりクラウドプロバイダーへ接続したりせず、コンテキストを算出して検証します。 |
| `buildpouch pack` | 利用可能 | 検証済みのファイルを一時ディレクトリに配置し、`tar.gz`アーカイブを作成します。 |
| `buildpouch submit` | 利用可能 | コンテキストをパッケージ化するか既存のアーカイブを受け取り、設定されたプロバイダーを通じて送信します。 |

Google Cloud Buildは既存の`gcloud` CLIを通じて、NCP NKS BuildKitは既存の`aws`および`kubectl` CLIを通じてサポートされます。プロバイダー固有のビルド設定、Kubernetes Job template、デプロイ動作は、BuildPouchを利用するリポジトリが引き続き所有します。NCP対応は、NCP Object Storage、NKS、Container Registryを接続した実環境のend-to-end検証が完了するまでexperimentalです。

コマンド形式:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml --target gcp-development
```

プロジェクトにBuildPouchをインストールした後、`npx`でコマンドを実行します。

```sh
npx buildpouch inspect --config buildpouch.yaml
npx buildpouch inspect --config buildpouch.yaml --json
npx buildpouch pack --config buildpouch.yaml
npx buildpouch pack --config buildpouch.yaml --output customer-api.context.tar.gz --json
npx buildpouch submit --config buildpouch.yaml
npx buildpouch submit --config buildpouch.yaml --archive customer-api.context.tar.gz --json
```

`inspect`はmetadataだけを読み取ります。ファイルをステージングしたりプロバイダーへ接続したりせず、すべてのsource→target mapping、各ファイルサイズ、ファイル数、合計サイズを表示します。

`pack`は同じ検証を再度行い、選択されたファイルを分離された一時ディレクトリにコピーして、ポータブルなgzip圧縮tarアーカイブを作成します。デフォルトの出力先は、現在のディレクトリにある`<context.name>.context.tar.gz`です。`--force`を指定しない限り既存のアーカイブは保持されます。コマンド終了後にステージングディレクトリを確認する必要がある場合のみ、`--keep-context`を使用してください。

`submit`は、`--target`で指定したtarget、`defaultTarget`、従来の`build`セクションの順に送信先を選択します。名前付きtargetが1つだけの場合は自動的に選択され、複数ある場合は`--target`または`defaultTarget`が必要です。Google Cloud Build targetには認証済みのGoogle Cloud CLIが必要です。NCP targetには、NCP Object Storageへアクセスできる認証済みAWS CLIと、対象NKS clusterの`kubectl` contextが必要です。`--archive`がない場合は内部の一時アーカイブを作成し、buildの完了を待ってからそのローカルアーカイブを削除します。`--archive`で渡した既存のローカルアーカイブは削除しません。

1回の実行に限り、プロバイダーの値を上書きできます。

```sh
node dist/cli.js submit --config buildpouch.yaml --target gcp-development \
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

defaultTarget: gcp-development

targets:
  gcp-development:
    provider: gcp-cloud-build
    options:
      config: apps/customer/api/deploy/gcp/build.json
      project: example-project
      region: asia-northeast3
      substitutions:
        _APP_NAME: customer-api

  gcp-production:
    provider: gcp-cloud-build
    options:
      config: apps/customer/api/deploy/gcp/build.json
      project: production-project
      region: asia-northeast3
      substitutions:
        _APP_NAME: customer-api

  ncp-development:
    provider: ncp-nks-buildkit
    options:
      endpoint: https://kr.object.ncloudstorage.com
      region: kr-standard
      bucket: example-build-contexts
      prefix: buildpouch/development
      awsProfile: ncp
      kubeContext: nks-development
      namespace: build-system
      jobTemplate: apps/customer/api/deploy/ncp/build-job.yaml
      container: buildpouch
      timeoutSeconds: 1800
      pollIntervalSeconds: 5
      variables:
        IMAGE_REF: example.kr.ncr.ntruss.com/customer-api:development
        DEPLOYMENT_NAME: customer-api
```

エントリーの一覧がソースの許可リストを構成します。各エントリーは、`context.root`以下にあるファイル、ディレクトリ、または対応するglobをアーカイブ内のパスに対応付けます。除外設定は許可リストを絞り込みますが、それだけでコンテキストを定義するものではありません。

相対的な`context.root`は設定ファイルのディレクトリを基準に解決されます。各エントリーのsourceは、このrootを基準に解決されます。`required`のデフォルト値は`true`で、必須エントリーが存在しない場合や除外後に空になる場合はinspectが失敗します。

名前付きtargetを使用すると、共通のcontext定義と環境・プロバイダーの選択を分離できます。Target名には英字、数字、ピリオド、underscore、hyphenを使用でき、プロバイダー固有の値は`targets.<name>.options`の下に置きます。後方互換性のため、従来の単一`build`セクションも引き続きサポートされ、`--target`と`defaultTarget`が名前付きtargetを選択しない場合は`build`が優先されます。

例では`buildpouch.yaml`を使用していますが、JSON形式のBuildPouch設定を使いたい場合はYAML parserがJSON構文も受け付けます。既存アプリケーションの`config.json`は、そのアプリケーションが所有する別のschemaであるため自動解釈されません。代わりに、リポジトリ所有のtaskがそのファイルを読み取り、BuildPouch targetの値を生成または選択できます。既存のGCP `build.json`は、GCP targetの`config` fieldからそのまま利用できます。

Google Cloud Buildの相対的な`config`パスは設定ファイルのディレクトリを基準に解決されます。`--build-config`の上書きは現在の作業ディレクトリを基準に解決されます。ユーザー定義のCloud Build substitution keyは`_`で始まり、大文字、数字、underscoreのみを含める必要があります。Substitutionの値はコマンド出力に表示されるため、secretをsubstitutionとして渡さず、build configurationを通じてSecret Managerを使用してください。

### NCP NKS BuildKit target

`ncp-nks-buildkit`プロバイダーは、BuildPouchのarchive-first契約を維持しながらNCPサービスを使用します。

1. S3互換APIを通じて、一意の名前を持つcontext archiveを設定済みのprivate [NCP Object Storage](https://api.ncloud-docs.com/docs/ja/storage-objectstorage) bucketへアップロードします。
2. 予約済みの`BUILDPOUCH_*` metadataと、設定された秘密ではない`variables`を、リポジトリ所有の`batch/v1` Job templateにある指定containerへ注入します。
3. 既存のNKS contextとnamespaceにJobを作成し、terminal状態になるまで確認します。
4. 成功または確認済みのリモート失敗後に、一時Object Storage objectを削除します。

BuildPouchはbucket、NKS cluster、[Container Registry](https://guide.ncloud-docs.com/docs/en/containerregistry-overview)、Kubernetes service account、RBAC、credential、registry pull/push secretを作成しません。実際のarchiveダウンロード、SHA-256検証、展開、BuildKit実行、image push、任意のNKSデプロイはJob templateが担当します。このため、BuildPouchにデプロイの意味を持たせず、build・pushだけを行うtemplateとデプロイまで行うtemplateを分けて運用できます。完了したJobは確認できるように残されるため、自動削除が必要な場合はtemplateに`ttlSecondsAfterFinished`を設定してください。

選択したcontainerには、`BUILDPOUCH_CONTEXT_ENDPOINT`、`BUILDPOUCH_CONTEXT_REGION`、`BUILDPOUCH_CONTEXT_BUCKET`、`BUILDPOUCH_CONTEXT_KEY`、`BUILDPOUCH_CONTEXT_NAME`、`BUILDPOUCH_CONTEXT_SIZE`、`BUILDPOUCH_CONTEXT_SHA256`、`BUILDPOUCH_SUBMISSION_ID`、`BUILDPOUCH_TARGET`が注入されます。同名の既存環境変数は置き換えられます。Templateが所有する`secretKeyRef`、volume、command、image、security context、その他のcontainerは維持されます。

`endpoint`、`region`、`bucket`、`kubeContext`、`namespace`、`jobTemplate`は必須です。`prefix`のデフォルトは`buildpouch`、`container`は`buildpouch`、`timeoutSeconds`は1800、`pollIntervalSeconds`は5です。相対的な`jobTemplate`パスはBuildPouch設定ファイルのディレクトリを基準に解決されます。`awsProfile`はローカルAWS CLI profileだけを選択し、Jobには送信されません。`variables`はJob manifestに表示されるため、credentialやsecretを絶対に含めず、templateのKubernetes Secretを使用してください。

Job作成が明確に拒否された場合、BuildPouchはアップロードしたobjectを削除します。Job作成結果が曖昧な場合、または受付後のキャンセル、timeout、状態確認の曖昧な失敗では、実行中の可能性があるbuildを壊さないようにJobとsource objectを保持します。報告されたJobを確認し、不要になった後で対象objectだけを削除してください。成功結果はプロバイダーのweb console URLであるかのように扱わず、`kubernetes://<context>/<namespace>/jobs/<name>` locatorを返します。

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
- shellを使わず、argument arrayで`gcloud`、`aws`、`kubectl`を実行します。
- cloud credentialを読み取ったり保存したりせず、現在のCLI identityを使用します。
- NCP Job manifestをshellや永続的な生成ファイルではなく、`kubectl`の標準入力で渡します。
- 送信準備時の人向け出力とJSON出力には、NCP variableの名前だけを表示し、設定値は表示しません。
- `submit`が内部で作成したアーカイブだけを削除し、ユーザーが渡したアーカイブは保持します。

`submit`をキャンセルすると、実行中のローカルprovider processを停止し、ローカルの一時ファイルを削除します。Cloud BuildまたはNKSがすでに受け付けたリモートbuildまでキャンセルされることは保証しません。NKS Job受付後の保持動作は、上記の境界に従います。

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

BuildPouchは[Apache License 2.0](../LICENSE)のもとで提供されています。
