# 디자인 패턴과 설계 결정

패턴 이름을 붙이는 것보다 어느 책임과 변경 위험을 줄였는지를 설명한다. 다음 표는 현재 코드에서 확인할 수 있는 적용 사례다.

| 패턴·원칙 | 실제 적용 | 해결하는 문제 | 한계 |
| --- | --- | --- | --- |
| Feature-Based 구조 | `plugins/library`, `reader`, `board`, `settings` | 기능 변경 파일을 가까이 모으고 소유 경계를 드러냄 | 공통 Core와 큰 View의 결합은 남음 |
| MVVM | Library의 `model`, `hooks/use*ViewModel`, `services`, `views` | 화면 상태·비동기 흐름·입출력·표현을 구분 | 모든 화면이 동일한 수준으로 분해되지는 않음 |
| Modular Monolith | 단일 Tauri 앱 안의 기능 모듈 | 배포 복잡도를 억제하며 기능 경계 유지 | 내부 경계는 코드·테스트로 지켜야 함 |
| Plugin Architecture | manifest·Registry·프로필·Host API | 메뉴·의존성·빌드 구성을 명시 | 내장 메뉴 선언 자체가 네이티브 권한을 부여하지 않음 |
| Port / Adapter 경계 | `ReaderRenderPort`, Library Host Port | Library가 Reader 내부 View를 직접 import하는 결합 완화 | 전체 시스템에 일괄 적용한 Hexagonal Architecture는 아님 |
| Service Layer | `libraryBrowseService`, `readerNativeService`, `boardService` | IPC와 토큰·요청 조립을 View에서 분리 | Rust SQL은 별도 범용 Repository 계층으로 추상화하지 않음 |
| Observer·이벤트 구독 | Tauri 진행 이벤트, 공유 설정 알림 | 진행률과 같은 창의 설정 변경 전파 | 구독 해제·늦은 이벤트의 처리가 필요 |
| stale-request fence | Browse ViewModel의 `loadSerial` | 오래된 조회가 최신 목록을 덮어쓰는 문제 방지 | 요청 자체를 모두 취소하는 것과는 다름 |
| Error Boundary | 기능별 `PluginErrorBoundary` | 한 화면의 React 오류에서 복구 UI 제공 | Rust panic이나 프로세스 오류를 격리하지는 못함 |
| Allowlist / capability 분리 | 프로필 검증·Rust feature·IPC 등록 | 숨겨진 개발 기능이 RELEASE에서 호출되는 문제 방지 | 일반 메뉴 숨김 설정은 보안 경계가 아님 |
| Idempotency | 후원 transaction/message 고유키와 중복 무시 | 웹훅 재시도의 중복 적립 방지 | 환불·기간 만료 정책은 추가 설계 필요 |

## 결정 1. 로컬 책장과 회원 데이터를 분리한다

SQLite는 파일 경로, 작품 메타데이터, 열람 상태를 관리한다. PostgreSQL은 회원과 연결된 게시판·관리자·후원 기록을 관리한다. 로그인 오류가 로컬 파일의 소유권이나 독서 기록의 삭제로 이어지지 않도록 경계를 유지한다.

비용은 두 저장소의 모델과 백업 정책을 각각 설명해야 한다는 점이다. 현재 로컬 책장을 클라우드와 자동 동기화하는 기능은 없다.

## 결정 2. 기능을 숨기는 것과 배포에서 빼는 것을 구분한다

DEV의 메뉴 체크박스는 표시 설정이다. RELEASE 프로필은 빌드 입력이다. 후자는 Vite의 모듈 제외, Cargo feature, `build.rs` 대조, 실제 실행 파일의 IPC 검사까지 이어진다.

이 결정으로 배포 검증 절차는 길어지지만, 개발자 설치·게시자 신뢰 IPC가 사용자 배포본에 남는 위험을 줄인다. [선택적 빌드 구현](../../desktop-tauri/scripts/release-build.mjs)을 근거로 설명할 수 있다.

## 결정 3. Library와 Reader 사이에 Core-owned port를 둔다

Library는 작품 탐색과 선택을 소유하고 Reader는 열람 방식을 소유한다. App이 `ReaderRenderPort`를 제공해 두 기능을 조합한다. Library가 Reader의 상세 구현 파일을 가져오지 않아도 된다.

Reader 종료 후 돌아갈 페이지·필터·카드 포커스는 Library의 선택 ViewModel에서 관리한다. 화면 재사용과 상태 보존이 연결되는 지점이다.

## 결정 4. 기존 데이터 스키마를 급하게 정리하지 않는다

온라인 수집 기능을 제거해도 과거에 생성된 외부 메타데이터·태그·정렬 상태가 있을 수 있다. 현재 전환에서는 테이블·컬럼 DROP과 사용자 데이터 경로 변경을 하지 않았다. 과거 온라인 정렬 값의 UI 복원은 지원하는 정렬로 전환하는 로직을 둔다.

비용은 사용하지 않는 과거 컬럼과 API 흔적이 일부 남는다는 점이다. 향후 마이그레이션에는 실제 데이터 백업, 읽기 호환성, 복구 절차와 별도 검증이 필요하다.

## 결정 5. 네이티브 미디어 처리는 재사용하되 수명주기를 직접 관리한다

libmpv가 디코딩과 재생을 담당하고 React는 조작 UI를 제공한다. Rust가 세션 키·창 소유권·Win32 surface와 상태를 관리한다. 이 경계는 브라우저에서 파일 재생을 전부 구현하는 비용을 줄이는 대신, Mutex·UI dispatch·창 파괴 순서 같은 네이티브 문제를 도입한다.

실사용에서 보고된 `플레이어 수명 잠금 실패`는 이 비용을 드러낸다. 재시작으로 상태가 초기화되더라도 원인 해결로 보지 않으며, [현재 이슈](../engineering/07-build-and-validation.md)에 추적한다.

## 사용하지 않은 패턴을 과장하지 않기

- 독립 DB를 가진 완전한 마이크로서비스 집합이라고 소개하지 않는다.
- Rust SQL 모듈을 범용 ORM Repository 구현이라고 소개하지 않는다.
- 내장 플러그인 계약을 모든 서드파티 코드에 대한 완전한 권한 시스템이라고 소개하지 않는다.
- 로딩 직렬 번호나 React 상태를 이벤트 소싱·CQRS라고 부르지 않는다.
- 단위 테스트 통과를 실제 GPU·OAuth·운영 결제 검증으로 확대하지 않는다.

## 소스 안내

[Library ViewModel](../../desktop-tauri/src/plugins/library/hooks/useLibraryBrowseViewModel.ts), [Reader port](../../desktop-tauri/src/plugin-sdk/reader.ts), [Registry](../../desktop-tauri/src/plugin-host/registry.ts), [설정 알림](../../desktop-tauri/src/shared/settings/settingsSync.ts), [후원 API](../../services/supporter-api/index.mjs), [libmpv](../../desktop-tauri/src-tauri/src/libmpv_native.rs).
