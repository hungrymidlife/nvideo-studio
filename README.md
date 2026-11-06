# NVideo Studio

Windows에서 로컬 책과 영상을 관리하고, 이미지·웹툰·문서 Reader와 네이티브 미디어 플레이어로 열람하는 데스크톱 애플리케이션입니다. 로컬 라이브러리는 SQLite에 보관하고, 계정·게시판·후원 확인은 Neon 기반 서비스와 연결합니다.

이 저장소는 기존 애플리케이션을 포트폴리오용 제품 범위로 정리한 작업입니다. 다운로드·온라인 사이트 엔진·모바일 원격 제어는 제거했습니다. 제품의 중심은 **사용자 소유 파일의 관리와 열람**, 그리고 **분리된 계정·커뮤니티 서비스**입니다.

## 공개 소스 사용 안내

이 저장소는 이전 저장소의 파일 스냅샷으로 시작하며 기존 Git 이력을 포함하지 않습니다. 기본 온라인 서비스 주소는 `example.invalid`로 대체되어 소유자의 운영 서비스로 접속하지 않습니다. 로컬 기능은 독립적으로 사용하고, 계정·게시판·후원 서비스는 [공개 빌드 설정](docs/engineering/10-public-release.md)에 따라 직접 구성합니다.

## 주요 기능

| 영역 | 현재 구현 |
| --- | --- |
| 로컬 책장 | 루트·작가·작품 탐색, 스캔, 검색·태그·정렬, 수동 묶음, 썸네일·캐시, 열람 기록 |
| Reader | 이미지·ZIP/CBZ·문서 열람, 만화·웹툰·자동 보기, 가상화된 페이지 선택, 저장된 보기 설정 |
| 미디어 | libmpv 기반 로컬 재생, 자막·키보드 제어, 멀티뷰 |
| 게시판 | 목록·검색·CRUD·신고, 비밀글, 관리자 공지, 구조화된 리치 텍스트와 이미지 |
| 내 계정 | Google OAuth, 세션 확인·로그아웃, 이름·이메일·회원 상태 표시 |
| 후원 | Ko-fi 웹훅 저장 및 서버 검증에 기반한 후원 회원 표시 |
| DEV 도구 | 내장 메뉴 관리, 제한된 외부 플러그인 관리, 선택적 릴리스 구성 JSON 생성 |

현재 계정 UI는 Google 로그인 중심입니다. 이메일/비밀번호 가입 UI, 댓글 API, 프로필 편집은 구현 완료 기능으로 소개하지 않습니다. 실제 영상 재생과 로그인 흐름의 최종 사용자 테스트는 진행 중입니다.

## 설계의 핵심

- 기능 단위 디렉터리와 Model·ViewModel·Service·View 역할 분리
- 하나의 데스크톱 프로세스 안에서 모듈 경계를 유지하는 Modular Monolith
- Core가 인증·창 수명주기·IPC를 소유하고 플러그인이 화면과 기능을 구성하는 구조
- Vite 번들 선택과 Rust Cargo feature를 같은 프로필로 맞추는 DEV/RELEASE 분리
- 기존 SQLite 경로·행·Reader 설정을 보존하는 점진적 전환
- 게시판·후원 검증은 별도 Functions 서비스가 서버 권한으로 수행

설계 패턴의 적용 범위와 한계는 [설계 결정 문서](docs/architecture/03-patterns-and-decisions.md)에 정리했습니다.

온라인 계정·게시판은 기본적으로 구성되지 않습니다. [공개 소스 설정과 배포 보류 안내](docs/engineering/10-public-release.md)를 먼저 확인하세요. Google 로그인은 빌드 전에 자신의 `NVIDEO_AUTH_URL`을 설정해야 합니다. 개발 및 릴리스 빌드가 그 HTTPS origin을 WebView2 CSP에 자동 반영하므로 `tauri.conf.json`에 개인 주소를 커밋하지 않습니다.

## 실행과 빌드

Windows, Node.js 24, Rust MSVC 도구체인, Visual Studio C++ Build Tools 및 WebView2 런타임을 기준으로 검증했습니다. 정확한 의존성은 lockfile을 사용합니다.

```powershell
cd desktop-tauri
npm ci
npm run portfolio:dev
```

DEV에는 로컬 책장·게시판·환경 설정·내 계정과 플러그인 관리가 표시됩니다. 내 계정은 Core가 제공하는 대화상자이며 별도 내장 메뉴 플러그인은 아닙니다.

```powershell
npm run release:check -- custom-release
npm run release:build -- custom-release
# 같은 기존 빌더를 호출하는 별칭
npm run portable
```

RELEASE에는 네 가지 사용자 메뉴가 제공됩니다. 개발자 관리 UI는 번들에서 제외되고 관련 네이티브 IPC도 등록되지 않습니다. 실행 파일·포터블 ZIP·해시와 검증 manifest는 `desktop-tauri/release-artifacts/`에 생성됩니다.

## 문서

[전체 문서 목차](docs/README.md)에서 다음 내용을 볼 수 있습니다.

1. [제품 기획](docs/product/01-product-plan.md)
2. [시스템 설계·기술스택](docs/architecture/02-system-design.md)
3. [디자인 패턴·설계 결정](docs/architecture/03-patterns-and-decisions.md)
4. [모델·서비스 구현](docs/implementation/04-models-and-services.md)
5. [UI·UX 설계](docs/product/05-design-and-ux.md)
6. [수익화 아이디어](docs/business/06-monetization.md)
7. [빌드·검증·현재 이슈](docs/engineering/07-build-and-validation.md)
8. [라이선스·서드파티 기술](docs/legal/08-licenses-and-third-party.md)
9. [포트폴리오 사례 설명](docs/portfolio/09-case-study.md)

## 검증 상태와 공개 범위

공개 복사본에서 아키텍처 287개, 안전성 UI 191개, 릴리스 빌더·프런트엔드 22개, 서비스 38개 테스트와 프런트엔드 빌드·Windows Rust 컴파일을 확인했습니다. 기존 내부 소스의 RELEASE·포터블 생성 기록은 공개 복사본의 새 바이너리 검증을 뜻하지 않습니다. 실사용 테스트에서 보고된 플레이어 잠금 오류, 실제 OAuth·재생·설치형 업데이트 확인은 별도 미완료 항목입니다. 자동 테스트 통과를 실사용 전체 검증으로 해석하지 않습니다.

로컬 SQLite와 사용자 설정의 저장 경로는 유지했습니다. 문서 작성 과정에서 운영 DB, 결제 설정, 서비스 배포는 변경하지 않았습니다.

프로젝트 소스 라이선스는 GPL-3.0-or-later입니다. 현재 libmpv의 GPL 구성을 기준으로 선택했습니다. 외부 미디어 바이너리의 정확한 대응 소스 확보 전까지 포터블의 공개 배포는 보류합니다. 서드파티 라이선스와 외부 바이너리의 배포 조건은 [라이선스 문서](docs/legal/08-licenses-and-third-party.md)를 확인하세요.
