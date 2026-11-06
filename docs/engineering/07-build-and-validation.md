# 빌드, 검증, 현재 이슈

## 기준과 범위

아래 기존 검증 표는 공개 추출 전 내부 코드베이스에서 수행한 기록이다. 공개 추출 이후의 검증은 [공개 상태 문서](10-public-release.md)를 참고한다. 사용자가 실제 파일·계정·장치로 수동 테스트를 진행한다.

## 재현 가능한 명령

```powershell
cd desktop-tauri
npm ci
npm run portfolio:dev
```

DEV 프로필은 기존 `scripts/run-portfolio-dev.mjs`를 사용한다. Vite는 기본 `127.0.0.1:1421`에서 실행한다. 생성 EXE를 감시하다 발생한 `EBUSY`를 막기 위해 `release-artifacts/`와 `portable-dist/`도 감시에서 제외했다.

```powershell
cmd /c VERIFY_PLUGIN_REFACTOR.bat
npm run test:release-builder
```

기존 CI BAT는 프런트엔드·아키텍처·안전성·Reader·실제 선택적 번들 검사와 기본 Rust check/test를 연결한다. Jenkins wrapper가 같은 진입점을 호출한다. 로컬 BAT 성공과 실제 원격 Jenkins 실행 성공은 별개의 증거다.

```powershell
npm run release:check -- custom-release
npm run release:build -- custom-release --strict-clean
```

새로운 빌더를 만들지 않고 기존 선택적 릴리스 빌더를 사용한다. clean source, 프로필·프런트엔드·Cargo feature 일치, 선택적 Rust 테스트, 실행 파일 생성, 실제 IPC 자체 검증, 도구 복사, 해시·manifest·ZIP 생성 순서로 진행한다.

서버 단위 테스트의 진입점은 각 서비스 디렉터리의 `npm test`다. staging E2E나 SQL 마이그레이션을 실행하는 것은 DB에 쓸 수 있는 별도 운영 작업이며 이 문서 작성 절차에는 포함하지 않는다.

## 확인한 자동 검증

| 검증 | 결과 | 해석 |
| --- | --- | --- |
| 아키텍처·경계·기능 회귀 | 287 통과 | 최종 기능 제거와 미사용 진단 정리 후 |
| UI 안전성·로컬 보존·Reader/libmpv 회귀 | 191 통과 | 실물 GPU 재생 성공을 뜻하지 않음 |
| Reader 레이아웃 | 28 통과 | 보기 정책·가상화 등 |
| 기본 Rust 전체 테스트 | 96 통과 | 기본 feature 구성 |
| 선택적 RELEASE Rust lib 테스트 | 86 통과 | 개발자 관리자 제외 구성 |
| 릴리스 빌더 정책 | 11 통과 | 경로·환경·도구·해시·아카이브 정책 |
| 릴리스 번들·구성·자체 검증 계약 | 11 통과 | 실제 Vite 결과의 개발자 코드 제외 포함 |
| Board API 단위 테스트 | 26 통과 | 대체 DB·저장소로 권한·문서·이미지 등 검증 |
| TypeScript / Vite / Rust check | 성공 | 경고가 없는 것은 아님 |
| 기존 로컬 CI BAT | 성공 | 원격 Jenkins 완료는 이 기록에서 확인하지 않음 |
| RELEASE / 포터블 ZIP | 성공 | unsigned, 사용자 최종 기능 테스트 진행 중 |

각 테스트 집합은 일부 파일을 공유하므로 숫자를 합산해 고유 테스트 개수라고 제시하지 않는다. Supporter API 테스트 파일은 존재하지만 이번 기록에서 별도 실행 성공으로 추가하지 않았다.

## 실제 실행에서 확인한 범위

DEV 실제 화면에서 로컬 책장·게시판·환경 설정·내 계정·플러그인 관리 메뉴를 확인했다. 플러그인 관리자에서 게시판 선택을 바꾸면 내보낼 JSON이 바뀌는 것을 확인했다. 구성 파일 저장·외부 패키지 설치·게시자 신뢰 등록은 별도 동작이며 화면 노출만으로 완료라고 하지 않는다.

RELEASE 실행 파일의 자동 self-test는 별도 scratch DB와 숨김 WebView에서 수행했다. 개발자 IPC가 등록되지 않았는지와 포함된 로컬 SQLite 조회 등을 검증한다. 현재 89개 production handler 등록 중 개발자 관리 명령 9개가 RELEASE에서 제외된다. 본문이 없는 성공 로그가 아니라 실제 명령 응답과 결과 JSON을 검사한다.

2026-11-06의 최신 포터블 산출물은 기존 빌더의 `custom-release/2026-11-06T07-18-15-692Z/` 실행에서 생성했다. 날짜 폴더는 빌더가 쓰는 UTC 표기이며 소스 커밋은 manifest에서 확인한다. `artifacts.json`, `smoke-result.json`, `release-manifest.json`이 근거다. 문서 변경만으로 바이너리를 재빌드했다고 주장하지 않는다.

## 현재 이슈·미완료 항목

| 항목 | 확인된 사실 | 다음 확인 |
| --- | --- | --- |
| 플레이어 수명 잠금 실패 | 사용자 실제 실행에서 `내부 영상 재생 실패: 플레이어 수명 잠금 실패`가 보고됨. 앱 재실행 요청을 수행함 | 선행 panic·실패 경로, 재생/닫기 순서, 재진입을 재현하고 원인을 조사 |
| 하드웨어 프로브 시작 실패 | 기존 격리 probe EXE가 `0xc0000139 / STATUS_ENTRYPOINT_NOT_FOUND`로 시작하지 못함 | 일반 앱의 재생 문제와 같은 원인인지 단정하지 말고 로더·의존성을 별도로 확인 |
| Google OAuth·세션 | 코드와 회귀 테스트는 있으나 이번 자동 검증에서 실제 사용자 로그인을 완료하지 않음 | 로그인·취소·재시도·재실행·로그아웃 |
| 이메일 가입·댓글·프로필 편집 | 현재 사용자 UI/API의 완료 구현을 확인하지 못함 | 요구 범위 재확정 후 별도 구현 |
| 설치형 업데이트 | 기존 선택적 빌더는 포터블 생성 중심 | 설치·업데이트·롤백과 설정 경로 확인 |
| 공개 배포 준비 | unsigned이며 외부 바이너리 라이선스 정리 미완료 | 고지·원문·해당 소스·배포 라이선스와 서명 검토 |
| 네이티브 경고 | 일부 과거 미리보기 보조 API·사용하지 않는 코드 등의 경고가 남음 | 공유 플레이어를 훼손하지 않는 별도 정리 |

`플레이어 수명 잠금 실패` 문구는 Mutex 잠금 실패 경로에 해당한다. 선행 panic에 의한 poison 가능성은 있지만 현재 로그만으로 근본 원인을 확정하지 않는다. 재시작으로 상태가 바뀌는 것은 원인 수정의 증거가 아니다.

## 사용자가 진행할 기능 확인 기록

| 확인 항목 | 상태 | 기록할 내용 |
| --- | --- | --- |
| 기존 루트·작가·작품·기록 보존 | 사용자 확인 중 | 일반 DB와 검증용 DB를 구분 |
| 스마트·전체 스캔·취소 | 사용자 확인 중 | 표본 규모와 취소 시점 |
| 이미지·ZIP/CBZ·문서·긴 웹툰 | 사용자 확인 중 | 형식·페이지 수·오류 파일 |
| Reader 종료 후 위치·포커스 | 사용자 확인 중 | 필터·정렬·페이지와 마지막 작품 |
| 로컬 영상·자막·멀티뷰 | 이슈 보고됨 | 실패 순서·영상 형식·장치·로그 |
| 테마·보기 설정 재실행 보존 | 사용자 확인 중 | 변경 값과 재실행 방식 |
| Google 로그인·로그아웃 | 사용자 확인 중 | 성공·취소·실패 흐름 |
| 게시판 작성자·관리자·비밀글·공지 | 사용자 확인 중 | 테스트 계정과 허용/거부 결과 |
| 후원 회원 표시·새로고침 | 사용자 확인 중 | 계정 일치 여부와 서버 응답 |
| RELEASE 메뉴·포터블 실행 | 사용자 확인 중 | DEV 관리자 부재, 실제 재생 |

## 데이터 보존과 운영 경계

일반 Windows SQLite 경로는 `%LOCALAPPDATA%\VideoDownloader\viewer_library\library.db`다. 포터블 marker는 도구 탐색의 기준에 사용하며, 현재 SQLite를 무조건 EXE 옆으로 옮기는 기능으로 설명하지 않는다. WebView 설정과 SQLite는 별도 저장 계층이다.

검증용 DEV는 별도의 환경 변수·WebView 경로로 실행했다. 일반 실행의 DB와 혼동하지 않는다. 운영 Neon DB 변경·main 머지·서비스 배포는 수행하지 않았다.

## 구현 근거

[기존 CI BAT](../../desktop-tauri/VERIFY_PLUGIN_REFACTOR.bat), [Jenkins](../../Jenkinsfile), [빌더](../../desktop-tauri/scripts/release-build.mjs), [네이티브 catalog](../../desktop-tauri/src-tauri/release-command-catalog.json), [데이터 경로](../../desktop-tauri/src-tauri/src/storage_paths.rs), [실행 파일 self-test](../../desktop-tauri/src-tauri/src/release_self_test.rs).
