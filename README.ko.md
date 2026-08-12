# BuildPouch

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> 빌드에 필요한 것만 담으세요.

BuildPouch는 모노레포에서 안전하고 최소화된 빌드 컨텍스트 아카이브를 만들어 빌드 프로바이더에 제출하는 CLI 프로젝트입니다.

## 프로젝트 상태

BuildPouch는 초기 개발 단계에 있습니다. 소스에서 `inspect`와 `pack` 명령을 사용할 수 있으며, `submit`은 아직 구현 예정입니다. 공개 인터페이스는 변경될 수 있고 npm 패키지는 아직 출시되지 않았습니다.

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
| `buildpouch submit` | 구현 예정 | 컨텍스트를 패키징하거나 기존 아카이브를 받아 설정된 프로바이더를 통해 제출합니다. |

첫 번째 예정 프로바이더는 기존 `gcloud` CLI를 통해 호출하는 Google Cloud Build입니다. `build.json`이나 `cloudbuild.yaml` 같은 프로바이더별 빌드 설정은 BuildPouch를 사용하는 저장소가 계속 소유합니다.

명령 형태:

```sh
buildpouch inspect --config buildpouch.yaml
buildpouch pack --config buildpouch.yaml
buildpouch submit --config buildpouch.yaml
```

npm 패키지를 출시하기 전에는 프로젝트를 빌드한 뒤 명령을 로컬에서 실행할 수 있습니다.

```sh
npm run build
node dist/cli.js inspect --config buildpouch.yaml
node dist/cli.js inspect --config buildpouch.yaml --json
node dist/cli.js pack --config buildpouch.yaml
node dist/cli.js pack --config buildpouch.yaml --output customer-api.context.tar.gz --json
```

`inspect`는 metadata만 읽습니다. 파일을 staging하거나 프로바이더에 연결하지 않고 모든 source→target mapping, 개별 파일 크기, 파일 수와 전체 크기를 표시합니다.

`pack`은 같은 검증을 다시 수행하고, 선택된 파일을 격리된 임시 디렉터리에 복사한 뒤 이식 가능한 gzip 압축 tar 아카이브를 만듭니다. 기본 출력은 현재 디렉터리의 `<context.name>.context.tar.gz`입니다. `--force`를 지정하지 않으면 기존 아카이브를 보존합니다. 명령 종료 후 staging 디렉터리를 확인해야 할 때만 `--keep-context`를 사용하세요.

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

build:
  provider: gcp-cloud-build
  config: apps/customer/api/deploy/gcp/build.json
  project: example-project
  region: asia-northeast3
  substitutions:
    _APP_NAME: customer-api
```

Entry 목록은 source allowlist를 구성합니다. 각 entry는 `context.root` 아래의 파일, 디렉터리 또는 지원되는 glob을 아카이브 내부 경로에 대응시킵니다. Exclude는 allowlist의 범위를 줄이지만 그것만으로 컨텍스트를 정의하지는 않습니다.

상대 `context.root` 값은 설정 파일이 있는 디렉터리를 기준으로 해석합니다. 각 entry의 source는 이 root를 기준으로 해석합니다. `required`의 기본값은 `true`이며, 필수 entry가 없거나 exclude 적용 후 비어 있으면 inspect가 실패합니다.

## 설계 원칙

- **Allowlist 우선:** 명시적으로 선택한 빌드 입력만 포함합니다.
- **Workspace 보존:** 컨텍스트를 만드는 동안 원본 파일을 이동·변경·삭제하지 않습니다.
- **프로바이더 분리:** 컨텍스트 계획과 패키징을 원격 빌드 실행과 분리합니다.
- **내용 가시성:** 제출 전에 포함 경로, 파일 크기, 전체 크기와 충돌을 보여줍니다.
- **작은 MVP:** 구체적인 사용 사례가 생길 때만 dependency resolver나 provider abstraction을 추가합니다.

## 보안 경계

현재 `inspect`와 `pack` 명령은 다음 동작을 수행합니다.

- 설정된 root 밖으로 나가는 source 경로를 거부합니다.
- 절대 경로 또는 상위 경로 이동을 포함한 archive target을 거부합니다.
- 기본적으로 source symlink를 따라가지 않습니다.
- 대소문자를 구분하지 않는 filesystem에서 발생하는 경우를 포함해 target 충돌을 감지합니다.
- 일반적인 secret 파일, credential 디렉터리, private key, local cache와 임시 파일을 차단합니다.
- source workspace 밖에 현재 사용자만 접근할 수 있는 staging 디렉터리를 만듭니다.
- 최종 경로에 확정하기 전에 고유한 같은 디렉터리의 임시 파일에 아카이브를 씁니다.
- `--force`를 명시하지 않으면 기존 아카이브 덮어쓰기를 거부합니다.
- `--keep-context`를 명시한 경우를 제외하고 성공, 실패 또는 취소 후 staging과 부분 아카이브를 정리합니다.

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

이 프로젝트는 공개적으로 설계하고 있습니다. 큰 규모의 Pull Request를 열기 전에 질문과 제안은 [GitHub Issues](https://github.com/dreamyoungs/buildpouch/issues)를 이용해 주세요.

## 라이선스

BuildPouch는 [Apache License 2.0](LICENSE)에 따라 배포됩니다.
