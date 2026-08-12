# BuildPouch

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> 빌드에 필요한 것만 담으세요.

BuildPouch는 모노레포에서 안전하고 최소화된 빌드 컨텍스트 아카이브를 만들어 빌드 프로바이더에 제출하는 CLI 프로젝트입니다.

## 프로젝트 상태

BuildPouch는 초기 개발 단계에 있습니다. 소스에서 `inspect`, `pack`, `submit` MVP 명령을 사용할 수 있습니다. 공개 인터페이스는 변경될 수 있고 npm 패키지는 아직 출시되지 않았습니다.

## AI를 활용한 개발

BuildPouch는 설계, 구현, 테스트, 문서화, 번역과 검토 전반에서 AI 개발 도구를 의도적으로 매우 적극 활용합니다. 프로젝트가 발전하는 동안에도 AI를 계속 적극적으로 사용할 계획입니다.

AI의 도움을 받더라도 유지관리자의 책임이 AI로 이전되지는 않습니다. 기술적 결정, 검토, 보안, 라이선스와 릴리즈에 대한 책임은 유지관리자에게 있으며, AI를 활용한 작업에도 다른 모든 기여와 동일한 품질 및 테스트 기준을 적용합니다.

사람이 직접 작성한 기여, AI의 도움을 받은 기여 또는 두 방식을 함께 사용한 기여를 모두 환영합니다. 다만 유지관리자가 검토해야 할 품질, 출처 또는 라이선스 고려 사항이 생기는 수준으로 AI를 사용했다면 그 사실을 알려 주세요.

## 로컬 개발

현재 BuildPouch에는 Node.js 24와 npm 11.12.1이 필요합니다.

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

빌드 후 `node dist/cli.js --help`로 로컬 CLI를 실행할 수 있습니다.

## BuildPouch가 필요한 이유

모노레포 안의 애플리케이션은 자체 디렉터리 밖에 있는 파일을 필요로 할 수 있습니다. 공용 패키지, 루트 manifest, lockfile, 생성된 client, 빌드 설정, 정적 자산 등이 그 예입니다.

애플리케이션 디렉터리만 빌드 컨텍스트로 사용하면 필수 파일이 빠질 수 있습니다. 반대로 모노레포 전체를 업로드하면 관련 없는 애플리케이션, 문서, 캐시 또는 민감한 파일까지 포함될 수 있습니다.

BuildPouch는 allowlist 우선 방식을 사용합니다. 빌드에 필요한 파일을 명시적으로 선택하고, 아카이브 안에서 배치될 경로를 검증한 뒤, 선택된 컨텍스트만 패키징합니다.

## 작업 흐름

```text
설정과 CLI 인자
       │
       ▼
 컨텍스트 계획 수립
       │
       ▼
경로·충돌·보안 검사
       │
       ▼
격리된 임시 staging 디렉터리
       │
       ▼
 tar.gz 아카이브
       │
       ▼
빌드 프로바이더 어댑터
```

컨텍스트 생성과 프로바이더 제출은 별도 단계로 유지합니다. 이를 통해 실패 원인을 분명하게 구분하고 각 단계를 독립적으로 테스트할 수 있습니다.

## MVP 명령

| 명령 | 상태 | 책임 |
| --- | --- | --- |
| `buildpouch inspect` | 소스에서 사용 가능 | 파일을 복사하거나 클라우드 프로바이더에 연결하지 않고 컨텍스트를 계산하고 검증합니다. |
| `buildpouch pack` | 소스에서 사용 가능 | 검증된 파일을 임시 디렉터리에 구성하고 `tar.gz` 아카이브를 만듭니다. |
| `buildpouch submit` | 소스에서 사용 가능 | 컨텍스트를 패키징하거나 기존 아카이브를 받아 설정된 프로바이더를 통해 제출합니다. |

Google Cloud Build는 기존 `gcloud` CLI를 통해, NCP NKS BuildKit은 기존 `aws`와 `kubectl` CLI를 통해 지원합니다. 프로바이더별 빌드 설정, Kubernetes Job template과 배포 동작은 BuildPouch를 사용하는 저장소가 계속 소유합니다.

명령 형태:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml --target gcp-development
```

npm 패키지를 출시하기 전에는 프로젝트를 빌드한 뒤 명령을 로컬에서 실행할 수 있습니다.

```sh
npm run build
node dist/cli.js inspect --config buildpouch.yaml
node dist/cli.js inspect --config buildpouch.yaml --json
node dist/cli.js pack --config buildpouch.yaml
node dist/cli.js pack --config buildpouch.yaml --output customer-api.context.tar.gz --json
node dist/cli.js submit --config buildpouch.yaml
node dist/cli.js submit --config buildpouch.yaml --archive customer-api.context.tar.gz --json
```

`inspect`는 metadata만 읽습니다. 파일을 staging하거나 프로바이더에 연결하지 않고 모든 source→target mapping, 개별 파일 크기, 파일 수와 전체 크기를 표시합니다.

`pack`은 같은 검증을 다시 수행하고, 선택된 파일을 격리된 임시 디렉터리에 복사한 뒤 이식 가능한 gzip 압축 tar 아카이브를 만듭니다. 기본 출력은 현재 디렉터리의 `<context.name>.context.tar.gz`입니다. `--force`를 지정하지 않으면 기존 아카이브를 보존합니다. 명령 종료 후 staging 디렉터리를 확인해야 할 때만 `--keep-context`를 사용하세요.

`submit`은 `--target`으로 전달한 target, `defaultTarget`, 기존 `build` section 순서로 제출 대상을 선택합니다. 이름 있는 target이 하나뿐이면 자동으로 선택하며, 여러 개라면 `--target` 또는 `defaultTarget`이 필요합니다. Google Cloud Build target에는 인증된 Google Cloud CLI가 필요합니다. NCP target에는 NCP Object Storage에 접근할 수 있도록 인증된 AWS CLI와 대상 NKS cluster의 `kubectl` context가 필요합니다. `--archive`가 없으면 내부 임시 아카이브를 만들고 build가 끝날 때까지 기다린 뒤 해당 로컬 아카이브를 제거합니다. `--archive`로 전달한 기존 로컬 아카이브는 절대 제거하지 않습니다.

한 번의 실행에 한해 프로바이더 값을 덮어쓸 수 있습니다.

```sh
node dist/cli.js submit --config buildpouch.yaml --target gcp-development \
  --project another-project \
  --region us-central1 \
  --build-config ./cloudbuild.yaml \
  --substitution _APP_NAME=customer-api
```

## 설정

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

Entry 목록은 source allowlist를 구성합니다. 각 entry는 `context.root` 아래의 파일, 디렉터리 또는 지원되는 glob을 아카이브 내부 경로에 대응시킵니다. Exclude는 allowlist의 범위를 줄이지만 그것만으로 컨텍스트를 정의하지는 않습니다.

상대 `context.root` 값은 설정 파일이 있는 디렉터리를 기준으로 해석합니다. 각 entry의 source는 이 root를 기준으로 해석합니다. `required`의 기본값은 `true`이며, 필수 entry가 없거나 exclude 적용 후 비어 있으면 inspect가 실패합니다.

이름 있는 target을 사용하면 공통 context 정의와 환경·프로바이더 선택을 분리할 수 있습니다. Target 이름에는 영문자, 숫자, 점, underscore와 hyphen을 사용할 수 있으며, 프로바이더별 값은 `targets.<name>.options` 아래에 둡니다. 하위 호환성을 위해 기존 단일 `build` section도 계속 지원하며, `--target`과 `defaultTarget`이 이름 있는 target을 선택하지 않으면 `build`가 우선됩니다.

예시는 `buildpouch.yaml`을 사용하지만 JSON 형식의 BuildPouch 설정이 더 편하면 YAML parser가 JSON 문법도 받아들입니다. 기존 애플리케이션 `config.json`은 그 애플리케이션이 소유한 별도 schema이므로 자동으로 해석하지 않습니다. 대신 저장소가 소유하는 task가 해당 파일을 읽어 BuildPouch target 값을 만들거나 선택할 수 있습니다. 기존 GCP `build.json`은 GCP target의 `config` field를 통해 그대로 사용할 수 있습니다.

Google Cloud Build의 상대 `config` 경로는 설정 파일이 있는 디렉터리를 기준으로 해석합니다. `--build-config` override는 현재 작업 디렉터리를 기준으로 해석합니다. 사용자 정의 Cloud Build substitution key는 `_`로 시작하고 대문자, 숫자와 underscore만 포함해야 합니다. Substitution 값은 명령 출력에 표시되므로 secret을 substitution으로 전달하지 말고 build configuration을 통해 Secret Manager를 사용하세요.

### NCP NKS BuildKit target

`ncp-nks-buildkit` 프로바이더는 BuildPouch의 archive-first 계약을 유지하면서 NCP 서비스를 사용합니다.

1. S3 호환 API를 통해 고유한 이름의 context archive를 설정된 private [NCP Object Storage](https://api.ncloud-docs.com/docs/storage-objectstorage) bucket에 업로드합니다.
2. 예약된 `BUILDPOUCH_*` metadata와 설정된 비밀이 아닌 `variables`를 저장소가 소유하는 `batch/v1` Job template의 지정 container에 주입합니다.
3. 기존 NKS context와 namespace에 Job을 만들고 terminal 상태까지 조회합니다.
4. 성공 또는 확인된 원격 실패 뒤 임시 Object Storage object를 제거합니다.

BuildPouch는 bucket, NKS cluster, [Container Registry](https://guide.ncloud-docs.com/docs/containerregistry-overview), Kubernetes service account, RBAC, credential 또는 registry pull/push secret을 만들지 않습니다. 실제 archive 다운로드, SHA-256 검증, 압축 해제, BuildKit 실행, image push와 선택적인 NKS 배포는 Job template이 담당합니다. 따라서 BuildPouch에 배포 의미를 넣지 않고 build·push만 수행하는 template과 배포까지 수행하는 template을 따로 운영할 수 있습니다. 완료된 Job은 점검할 수 있도록 남겨 두며, 자동 정리가 필요하면 template에 `ttlSecondsAfterFinished`를 설정하세요.

선택된 container에는 `BUILDPOUCH_CONTEXT_ENDPOINT`, `BUILDPOUCH_CONTEXT_REGION`, `BUILDPOUCH_CONTEXT_BUCKET`, `BUILDPOUCH_CONTEXT_KEY`, `BUILDPOUCH_CONTEXT_NAME`, `BUILDPOUCH_CONTEXT_SIZE`, `BUILDPOUCH_CONTEXT_SHA256`, `BUILDPOUCH_SUBMISSION_ID`, `BUILDPOUCH_TARGET`이 주입됩니다. 같은 이름의 기존 환경 변수는 교체합니다. Template이 소유하는 `secretKeyRef`, volume, command, image, security context와 다른 container는 보존합니다.

`endpoint`, `region`, `bucket`, `kubeContext`, `namespace`, `jobTemplate`은 필수입니다. `prefix` 기본값은 `buildpouch`, `container`는 `buildpouch`, `timeoutSeconds`는 1800, `pollIntervalSeconds`는 5입니다. 상대 `jobTemplate` 경로는 BuildPouch 설정 파일 디렉터리를 기준으로 해석합니다. `awsProfile`은 로컬 AWS CLI profile만 선택하며 Job에는 전달하지 않습니다. `variables`는 Job manifest에 노출되므로 credential이나 secret을 절대 넣지 말고 template의 Kubernetes Secret을 사용하세요.

Job 생성이 명확히 거부되면 BuildPouch가 업로드한 object를 제거합니다. Job 생성 결과가 불확실하거나, 접수 후 취소, timeout 또는 상태 조회가 불확실하게 실패하면 실행 중일 수 있는 build를 깨뜨리지 않도록 Job과 source object를 모두 보존합니다. 보고된 Job을 확인한 뒤 더 이상 필요하지 않을 때 정확한 object만 제거해야 합니다. 성공 결과는 프로바이더 web console URL인 것처럼 가장하지 않고 `kubernetes://<context>/<namespace>/jobs/<name>` locator를 반환합니다.

## 설계 원칙

- **Allowlist 우선:** 명시적으로 선택한 빌드 입력만 포함합니다.
- **Workspace 보존:** 컨텍스트를 만드는 동안 원본 파일을 이동·변경·삭제하지 않습니다.
- **프로바이더 분리:** 컨텍스트 계획과 패키징을 원격 빌드 실행과 분리합니다.
- **내용 가시성:** 제출 전에 포함 경로, 파일 크기, 전체 크기와 충돌을 보여줍니다.
- **작은 MVP:** 구체적인 사용 사례가 생길 때만 dependency resolver나 provider abstraction을 추가합니다.

## 보안 경계

현재 명령은 다음 동작을 수행합니다.

- 설정된 root 밖으로 나가는 source 경로를 거부합니다.
- 절대 경로 또는 상위 경로 이동을 포함한 archive target을 거부합니다.
- 기본적으로 source symlink를 따라가지 않습니다.
- 대소문자를 구분하지 않는 filesystem에서 발생하는 경우를 포함해 target 충돌을 감지합니다.
- 일반적인 secret 파일, credential 디렉터리, private key, local cache와 임시 파일을 차단합니다.
- source workspace 밖에 현재 사용자만 접근할 수 있는 staging 디렉터리를 만듭니다.
- 최종 경로에 확정하기 전에 고유한 같은 디렉터리의 임시 파일에 아카이브를 씁니다.
- `--force`를 명시하지 않으면 기존 아카이브 덮어쓰기를 거부합니다.
- `--keep-context`를 명시한 경우를 제외하고 성공, 실패 또는 취소 후 staging과 부분 아카이브를 정리합니다.
- shell 없이 argument array로 `gcloud`, `aws`, `kubectl`을 실행합니다.
- cloud credential을 읽거나 저장하지 않고 현재 CLI identity를 사용합니다.
- NCP Job manifest를 shell이나 영구 생성 파일이 아닌 `kubectl` 표준 입력으로 전달합니다.
- 제출 준비 단계의 사람용·JSON 출력에는 NCP variable 이름만 표시하고 설정값은 표시하지 않습니다.
- `submit`이 내부에서 만든 아카이브만 제거하고 사용자가 전달한 아카이브는 보존합니다.

`submit`을 취소하면 현재 실행 중인 로컬 provider process를 중단하고 로컬 임시 파일을 정리합니다. Cloud Build나 NKS가 이미 접수한 원격 build까지 취소되는 것은 보장하지 않습니다. NKS Job 접수 후의 보존 동작은 위에서 설명한 경계를 따릅니다.

경로 기반 차단은 파일 내용을 분석하는 secret scanner가 아닙니다. 파일 내용 검사가 필요하면 CI에서 전용 보안 도구를 사용해야 합니다.

## MVP 비범위

BuildPouch는 다음 작업을 수행하지 않습니다.

- TypeScript, Rust, Go 또는 다른 애플리케이션 코드를 compile하는 작업
- Nx, pnpm, Cargo 또는 Go dependency graph 자동 분석
- lockfile, Dockerfile 또는 build configuration 생성·수정
- Kubernetes, Cloud Run 또는 기타 runtime platform으로 직접 배포
- cloud credential과 secret 생성·저장·동기화
- Git commit, release 또는 외부 알림 관리

저장소가 소유하는 task는 BuildPouch를 호출하기 전에 compile 결과나 prune된 dependency tree를 준비할 수 있습니다.

## 기여

이 프로젝트는 공개적으로 설계하고 있습니다. [기여 가이드](CONTRIBUTING.ko.md)와 [행동 강령](CODE_OF_CONDUCT.ko.md)을 읽고, 큰 규모의 Pull Request를 열기 전에 질문과 제안은 [GitHub Issues](https://github.com/dreamyoungs/buildpouch/issues)를 이용해 주세요. 취약점은 공개 issue가 아닌 [보안 정책](SECURITY.ko.md)의 절차로 신고해 주세요.

주요 변경 사항은 [변경 기록](CHANGELOG.md)에서 관리합니다.

## 라이선스

BuildPouch는 [Apache License 2.0](LICENSE)에 따라 배포됩니다.
