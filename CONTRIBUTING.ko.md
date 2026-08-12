# BuildPouch 기여 가이드

[English](CONTRIBUTING.md) | [한국어](CONTRIBUTING.ko.md) | [日本語](CONTRIBUTING.ja.md)

BuildPouch 개선에 참여해 주셔서 감사합니다. 변경은 한 회사나 특정 모노레포에 종속되지 않도록 작고 검증 가능하게 유지해 주세요.

## 시작하기 전에

- 버그와 제안은 GitHub Issues를 이용하고, 큰 변경은 구현 전에 논의해 주세요.
- credential, secret, 비공개 source code 또는 민감한 build log를 게시하지 마세요.
- [행동 강령](CODE_OF_CONDUCT.ko.md)과 [보안 정책](SECURITY.ko.md)을 읽어 주세요.

## 개발 환경

BuildPouch에는 Node.js 24와 npm 11.12.1이 필요합니다.

```sh
git clone https://github.com/dreamyoungs/buildpouch.git
cd buildpouch
npm ci --ignore-scripts
npm run check
npm test
```

`main`에서 목적이 분명한 branch를 만드세요. 기존 TypeScript style을 따르고 provider별 동작은 provider 경계 안에 유지하세요. 플랫폼이나 현재 dependency로 해결할 수 없는 이유를 설명하지 않은 새 dependency는 추가하지 마세요.

## 테스트

Pull Request를 열기 전에 다음 명령을 실행하세요.

```sh
npm run check
npm test
npm audit --audit-level=high
npm pack --dry-run
```

Provider 테스트는 mock runner 또는 fake executable을 사용해야 합니다. 자동화 테스트에서 실제 cloud build를 제출하지 마세요. 변경이 관련 경로에 영향을 준다면 성공, 검증 실패, provider 실패, 취소와 임시 파일 정리를 테스트하세요.

## 커밋과 Pull Request

- 모든 변경을 GitHub issue에 연결하세요.
- `feat(pack): 실행 권한 보존 (#123)` 같은 conventional commit을 권장합니다.
- 하나의 Pull Request는 하나의 결과에 집중하고 무관한 formatting이나 refactoring을 피하세요.
- 공개 동작이 바뀌면 영어, 한국어와 일본어 문서를 함께 갱신하세요.
- 수행한 검증과 로컬에서 확인하지 못한 동작을 설명하세요.

Maintainer는 squash merge를 사용합니다. 구체적인 사용 사례 없이 MVP를 확장하거나, 파일 안전 경계를 약화하거나, 특정 저장소에 종속된 가정을 추가하는 Pull Request는 수정 요청 또는 거절될 수 있습니다.
