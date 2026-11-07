# 외부 서비스 설정 관리 규약 — 파일 위치, 빌드 주입, 보안 및 검증

> 범위: 공개 `nvideo-studio` 데스크톱, 로컬 개발, Neon 인증·게시판·후원 서비스. **실제 운영 주소·토큰·키를 적는 문서가 아니다.** 서비스 변수를 누가 어디에서 관리하고, 어떤 코드가 언제 읽는지 정의한다.

## 1. 실수 방지 원칙

1. **Git 저장소와 운영 설정을 분리한다.** 공개 저장소는 의도적으로 `example.invalid`를 기본 주소로 둔다. 개발 원본 `video_downloader`의 하드코딩 주소를 공개 소스로 가져오지 않는다.
2. **`.env` 파일을 두었다고 빌드에 연결된 것이 아니다.** 현재 공개판의 `release-build.mjs`/`release-plan.mjs`는 `.env`, `.env.example`을 자동 로드하지 않는다. Windows PowerShell/Jenkins **프로세스 환경변수**를 읽는다.
3. **데스크톱 빌드에는 공개 가능한 HTTPS URL 세 개만 주입한다.** Ko-fi 검증 토큰, DB 비밀번호, S3 자격 증명 등 서버 비밀값은 데스크톱 빌드·EXE에 넣지 않는다.
4. **운영과 스테이징의 서비스 URL은 한 세트로 관리한다.** 다른 Neon Auth 환경에서 발급한 JWT를 운영 게시판이 검증할 수 있다고 가정하지 않는다.
5. **컴파일 이후 주소 변경은 EXE 재빌드가 필요하다.** 실행 시 `.env`를 바꿔도 기존 EXE의 `option_env!` 값과 WebView CSP는 바뀌지 않는다.
6. **확인 순서:** 소스 diff → 외부 설정 파일의 소유/위치 → 빌드 시 변수 주입 → 릴리즈 프로필 → 새 EXE → 실제 API 연결. CI 성공만으로 운영 연결을 증명하지 않는다.

## 2. 파일·경로별 책임

| 파일 또는 장소 | 역할 | 관리 기준 |
| --- | --- | --- |
| `desktop-tauri/.env` | 로컬에 존재할 수 있는 개발자 설정 | `.gitignore` 제외; 현재 릴리즈 빌더는 **자동 로드하지 않음** |
| `desktop-tauri/.env.example` | 로컬에 별도 생성됐을 수 있는 샘플 | 공개 Git에서 반드시 제공된다고 가정하지 않음; `.env` 복구/로드 수단이 아님 |
| `services/supporter-api/.env.example` | 서버 전용 환경변수 이름 샘플 | Git 관리, 비밀값 없는 템플릿 |
| **저장소 바깥**의 `desktop-service-urls.psd1` (권장) | 사용자 PC의 공개 HTTPS 서비스 URL 3개 | 운영자 소유; Git/ZIP 미포함; 변경 시 빌드 재실행 |
| Jenkins의 보호된 설정/자격 증명 | CI 릴리즈 빌드 입력 | 잡 권한을 제한하고 세 URL을 빌드 프로세스에 전달; 로그에 값 출력 금지 |
| Neon Functions/서비스 호스팅 환경변수 | DB, Ko-fi, Auth 검증, 이미지 저장소의 비밀값 | **서버 전용**; 공개 저장소·데스크톱 EXE에 포함하지 않음 |
| `desktop-tauri/release-artifacts/` | 실행 파일·포터블 ZIP·검증 매니페스트 | 생성 산출물. 설정 파일을 복사/포함하지 않음 |

로컬 checkout 경로 예시는 `C:\dev\NVideoStudioPublic`이다. 다른 경로에 설치해도 동일하다. `git switch`는 보통 `.gitignore` 파일을 보존하지만, `git clean -fdx`, 빌드 정리 스크립트, 압축 해제 덮어쓰기 등은 별개의 동작이다. 중요한 외부 설정은 Git **밖에 백업**한다.

## 3. 데스크톱 빌드에서 소비하는 환경변수

| 변수 | 형식만 표시 (실제 주소 금지) | 소비 코드 | 기능 |
| --- | --- | --- | --- |
| `NVIDEO_AUTH_URL` | `https://AUTH_HOST/neondb/auth` | `vite.config.ts`, `scripts/service-csp.mjs`, `src-tauri/src/account_native.rs` | Google/Neon Auth. 프런트엔드·Rust·WebView2 CSP에 동일한 값 반영 |
| `NVIDEO_BOARD_API_BASE_URL` | `https://BOARD_HOST` | `src-tauri/src/account_native.rs` | 게시판 Function **기본 호스트**; `/posts`를 붙이지 않음 |
| `NVIDEO_SUPPORTER_API_URL` | `https://SUPPORTER_HOST/supporter` | `src-tauri/src/account_native.rs` | 후원 회원 판별 API; Ko-fi 토큰과 무관 |

설정 전달 흐름:

```text
[Git 외부 설정 파일 / Jenkins 보호된 변수]
           │  공개 HTTPS URL 3개
           ▼
[같은 PowerShell 또는 CI 빌드 프로세스의 NVIDEO_* 환경변수]
           ├─ vite.config.ts → Auth 프런트엔드 번들
           ├─ service-csp.mjs → WebView2 connect-src / frame-src
           └─ release-build.mjs → releaseEnvironment(process.env)
                                  └─ Cargo / build.rs
                                      └─ account_native.rs option_env!(...)
                                            ├─ Auth
                                            ├─ Board
                                            └─ Supporter
```

`src-tauri/build.rs`가 세 변수의 변경을 추적한다. 값은 빌드 시 결정되므로 **이미 배포된 EXE는 환경변수만 수정해서 재설정할 수 없다.**

## 4. 외부 파일로 관리하고 Windows 빌드에 연결하는 방법

사용자/CI 운영자는 **Git 저장소 밖**에 예를 들어 `C:\dev\NVideoStudioPrivate\desktop-service-urls.psd1` 파일을 둔다. 다음은 실제 주소가 없는 *형식 예시*다.

```powershell
# C:\dev\NVideoStudioPrivate\desktop-service-urls.psd1
@{
  NVIDEO_AUTH_URL = 'https://AUTH_HOST/neondb/auth'
  NVIDEO_BOARD_API_BASE_URL = 'https://BOARD_HOST'
  NVIDEO_SUPPORTER_API_URL = 'https://SUPPORTER_HOST/supporter'
}
```

이 파일은 실행 가능한 스크립트 대신 PowerShell **데이터 파일**(`Import-PowerShellDataFile`)로 로드한다. 실제 값은 빌드 운영자가 본인 환경에 따로 설정한다.

```powershell
$settingsPath = 'C:\dev\NVideoStudioPrivate\desktop-service-urls.psd1'
if (!(Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    throw 'Desktop service URL settings file missing'
}
$settings = Import-PowerShellDataFile -Path $settingsPath
$names = @('NVIDEO_AUTH_URL','NVIDEO_BOARD_API_BASE_URL','NVIDEO_SUPPORTER_API_URL')
foreach ($name in $names) {
    $value = $settings[$name]
    if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing: $name" }
    [Environment]::SetEnvironmentVariable($name,[string]$value,'Process')
}
cd C:\dev\NVideoStudioPublic\desktop-tauri
npm run release:build -- custom-release
```

경로는 실제 checkout에 맞춰 조정한다. 기존 `desktop-tauri/.env`나 Ko-fi 파일을 삭제/수정할 필요가 없다. 이 빌드 과정은 그 `.env`를 자동으로 읽지 않는다.

현재 세 값의 **존재 여부만** 확인하고 주소를 출력하지 않는 명령:

```powershell
'NVIDEO_AUTH_URL','NVIDEO_BOARD_API_BASE_URL','NVIDEO_SUPPORTER_API_URL' |
  ForEach-Object {
    $value = [Environment]::GetEnvironmentVariable($_,'Process')
    '{0}: {1}' -f $_, $(if ([string]::IsNullOrWhiteSpace($value)) {'MISSING'} else {'SET'})
  }
```

이 명령은 변수에 값이 있다는 것만 확인한다. 형식·호스트 검사는 빌더와 실제 서비스 테스트로 확인한다.

## 5. 서버 전용 환경변수 (데스크톱에 절대 전달하지 않음)

| 변수 | 서버 측 사용처 |
| --- | --- |
| `DATABASE_URL` | `services/board-api`, `services/supporter-api` 데이터베이스 |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_AUDIENCE` | 서버 측 토큰 검증 |
| `KOFI_VERIFICATION_TOKEN` | `services/supporter-api` Ko-fi 웹훅 검증 |
| `AWS_ENDPOINT_URL_S3`, `AWS_REGION` 및 객체 저장소 자격 증명 | `services/board-api` 이미지 저장 |

서버 운영 비밀은 Neon Functions 또는 해당 호스팅 플랫폼의 보호된 환경 설정으로 관리한다. `services/supporter-api/.env.example`은 **이름과 형식을 설명하는 템플릿**일 뿐 실제 값을 넣는 저장소가 아니다. 개발판에서 서비스 연결을 이식해도 원본 `.env`를 통째로 복사하거나 Git에 올리지 않는다.

## 6. 빌드 명령별 실제 의미

- `npm run portfolio:dev`: 셸 환경변수를 전달한다. 값이 빠져도 기능별로 예시 호스트를 쓸 수 있으므로 운영 연결 성공을 의미하지 않는다.
- `npm run release:check -- custom-release`: 프로필/기능 선택 검사. **실제 서비스 URL 주입 및 API 연결 검사가 아니다.**
- `npm run release:build -- custom-release` 또는 `npm run portable`: `nvideo.board`가 포함되면 세 URL이 빠졌거나 `.invalid`인 경우 빌드 **시작 전에 실패**하도록 구성했다. 이후 프런트엔드/Rust에 컴파일된다.
- `Jenkinsfile`: 선택한 `RELEASE_PROFILES`로 릴리즈 빌더를 호출하지만, **현재 코드에 세 URL을 자동 주입하는 단계는 없다**. CI 운영자가 보호된 설정을 빌드 잡 환경에 별도로 연결해야 한다. 전체 설정값과 토큰을 콘솔 로그에 출력하지 않는다.
- GitHub Actions의 단위 테스트와 Windows Rust 컴파일이 성공해도 실제 운영 게시판·Google OAuth·후원 서비스에 접속했다고 판단하지 않는다.

공개판 플러그인 선택은 `desktop-tauri/build-profiles/*.json`을 기준으로 한다. 외부 설정 연결을 위해 개발판에서 제외한 플러그인을 복원하지 않는다.

## 7. 새 기능 이식·브랜치 전환·릴리즈 전 체크리스트

- [ ] `git status -sb`로 저장소·브랜치·작업 상태 확인
- [ ] 외부 설정의 **소유자와 원본 경로** 확인; 로컬 `.env`는 별도 백업
- [ ] `.env` **존재**와 빌더의 **실제 로드**를 구별; `release-build.mjs` 소비 경로 재검토
- [ ] 3개 데스크톱 URL을 한 번의 빌드 세션에 전달했으며, **서버 전용 비밀을 주입하지 않음**
- [ ] Auth / Board / Supporter 모두 같은 운영 또는 같은 스테이징 환경 사용
- [ ] `release:check`뿐 아니라 `release:build` 검사 통과
- [ ] 새 EXE를 테스트 폴더에서 실행하고 게시판 익명 목록·로그인·후원 표시를 수동 확인
- [ ] 포터블 ZIP에 `.env`, Ko-fi 토큰, DB 키, S3 자격 증명이 없는지 확인
- [ ] 공개 소스에 개발판의 운영 주소 또는 민감한 설정 파일을 하드코딩하지 않음
- [ ] 외부 서비스 추가·변경 시 **이 문서의 변수 표와 경로·주입 방식도 같이 갱신**

## 8. 증상과 최초 확인 지점

| 증상 | 먼저 확인 |
| --- | --- |
| “게시판 서비스가 설정되지 않았습니다” | 그 EXE를 빌드할 때 Board URL이 없었거나 `.invalid`였는지. **재빌드 필요** |
| 로그인 연결 불가 | `NVIDEO_AUTH_URL` → 프런트엔드·Rust·WebView2 CSP 같은 빌드에서 생성 여부 |
| 후원 표시 불가 | `NVIDEO_SUPPORTER_API_URL` 컴파일 시 주입 여부 |
| 브랜치 변경 후 `.env`에 다른 내용 | Git 무시 여부·실제 파일 경로·수정 시각·외부 정리 명령 확인 |
| PowerShell에서는 값이 있는데 EXE 연결 실패 | 그 **PowerShell에서 빌드한 최신 EXE**를 실행 중인지 확인 |
| Jenkins 릴리즈만 실패 | CI 작업의 세 URL 주입, 프로필 및 자격 증명 접근 권한 확인 |

## 9. 연결 코드와 같이 유지할 문서

- 데스크톱 빌더: `desktop-tauri/scripts/release-build.mjs`, `release-plan.mjs`
- 프런트엔드/CSP: `desktop-tauri/vite.config.ts`, `scripts/service-csp.mjs`
- Rust 컴파일/서비스 프록시: `desktop-tauri/src-tauri/build.rs`, `src/account_native.rs`
- 서버 런타임: `services/board-api/index.mjs`, `services/supporter-api/index.mjs`
- 릴리즈 프로필: `desktop-tauri/build-profiles/custom-release.json`
- CI: `Jenkinsfile`
- [공개 소스·배포 정책](10-public-release.md), [뷰어 이식·릴리즈 검증](11-viewer-integration-v011.md)

**이 문서가 관리하는 대상은 운영 주소값이 아니라 설정 계약(파일, 변수, 역할, 주입 시점, 검증 방법)이다. 실제 주소와 비밀값은 외부 설정/서비스 관리자만 보관한다.**
