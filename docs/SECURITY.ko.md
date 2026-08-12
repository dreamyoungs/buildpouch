# 보안 정책

[프로젝트 README](../README.md) | [English](../.github/SECURITY.md) | [한국어](SECURITY.ko.md) | [日本語](SECURITY.ja.md)

## 지원 버전

보안 수정은 최신 0.1.x release를 대상으로 합니다. `main` branch에는 아직 release되지 않은 수정이 포함될 수 있습니다. 비공식 archive, fork와 수정된 build는 이 정책의 지원 대상이 아닙니다.

## 취약점 신고

의심되는 취약점을 공개 issue로 작성하지 마세요. 제목에 `[BuildPouch security]`를 넣어 [dev-team@dreamyoungs.com](mailto:dev-team@dreamyoungs.com)으로 다음 정보를 보내 주세요.

- 영향을 받는 명령과 version 또는 commit;
- 영향에 대한 명확한 설명;
- 최소화하고 민감 정보를 제거한 재현 단계;
- 제안하는 완화 방법이나 patch가 있다면 그 내용.

Credential, 비공개 repository, 운영 데이터 또는 비공개 source code가 들어 있는 archive를 첨부하지 마세요. Artifact가 필요하면 maintainer가 더 안전한 전달 방법을 협의합니다.

Maintainer는 가능한 한 빠르게 신고를 확인하고 비공개로 조사한 뒤, 수정이 준비되면 공개 시점을 협의합니다. 공개하기 전에 검증과 수정에 필요한 합리적인 시간을 제공해 주세요.

## 보안 범위

Path traversal, 의도하지 않은 파일 포함, source 변경, secret 경로 차단 우회, archive 덮어쓰기, 임시 artifact 유출, command injection과 credential 노출에 관한 신고가 특히 중요합니다. BuildPouch가 문서화된 오류로 이미 거부하는 설정 실수는 일반적으로 취약점이 아니라 지원 문제입니다.
