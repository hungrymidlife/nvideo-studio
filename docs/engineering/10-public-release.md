# 공개 소스와 배포 상태

## 공개 원칙

새 저장소는 파일 스냅샷으로 시작하며 이전 `.git`, 브랜치, 커밋을 포함하지 않는다. 프로젝트 소스 라이선스는 GPL-3.0-or-later다. 환경 파일·토큰·사용자 DB·원본 콘텐츠·실행 파일은 소스에 포함하지 않는다.

## 온라인 서비스 구성

기본 주소는 `example.invalid`다. 현재 공개 소스의 계정·게시판·후원 기능은 소유자의 운영 환경으로 연결되지 않는다. 클라이언트와 서버 구현은 유지했으며 자신의 테스트 환경을 구성해야 한다.

```powershell
cd desktop-tauri
$env:NVIDEO_AUTH_URL='https://YOUR_AUTH_HOST/neondb/auth'
$env:NVIDEO_SUPPORTER_API_URL='https://YOUR_SUPPORTER_HOST/supporter'
$env:NVIDEO_BOARD_API_BASE_URL='https://YOUR_BOARD_HOST'
npm ci
npm run portfolio:dev
```

프런트엔드와 Rust에서 동일한 Auth URL을 사용한다. 지정한 auth origin을 `src-tauri/tauri.conf.json`의 connect-src/frame-src에, 첨부 저장소 origin을 img-src에 추가한다. HTTPS와 호스트 검증을 우회하지 않는다. DATABASE_URL·Ko-fi 검증 토큰·S3 비밀값은 데스크톱 환경 변수에 넣지 않고 Functions 서버에만 설정한다.

## 바이너리 공개 보류

기존 libmpv DLL은 SourceForge 원본 패키지와 해시가 일치하고, 현재 레시피는 GPL 구성을 사용한다. 그러나 정확히 대응하는 모든 정적 링크 의존성 소스·패치·빌드 자료를 확보하지 못했다. FFmpeg 8.1.1 full build도 원본 FFmpeg 커밋은 확인했지만 전체 외부 의존성의 정확한 대응 자료가 완전하지 않다.

GPL 라이선스 파일을 추가하는 것만으로 이 문제가 해결되지는 않는다. 포터블 검증 산출물이 있더라도 공개 배포 완료로 표시하지 않는다. `release-manifest.json`의 distributable은 false이며 distributionStatus에 보류 사유를 기록한다. GitHub Release는 초안으로만 준비할 수 있다.

해결 경로는 모든 의존성 revision·소스·패치·빌드 스크립트를 고정한 새 빌드를 만들거나, upstream에서 현재 바이너리에 정확히 대응하는 전체 자료를 확보하는 것이다. 이후 대응 소스와 고지를 바이너리와 함께 제공하고 공개 상태로 전환한다.

## FFmpeg 사용처

FFmpeg는 로컬 영상의 책장 표지·썸네일 추출에 실제 사용한다. 따라서 현재 빌드의 도구 정책에서는 FFmpeg와 FFprobe를 유지한다. libmpv 내부의 FFmpeg 라이브러리와 별도 ffmpeg.exe의 라이선스 범위는 각각 확인해야 한다.

## CI

공개 GitHub Actions는 대체 DB·저장소를 사용하는 단위 테스트, 소스 안전성 검사, 프런트엔드 빌드, Windows Rust 컴파일을 수행한다. 운영·staging URL 호출이나 마이그레이션·배포·게시글 쓰기를 포함하지 않는다. 기존 Jenkins 보조 스크립트는 참고용이며 자동 운영 자격 증명을 포함하지 않는다.

## 공개 복사본 검증

아키텍처 287개, 안전성 UI 191개, 릴리스 빌더 11개, 릴리스 프런트엔드 11개, 서비스 38개 테스트가 통과했다. TypeScript·Vite 빌드와 Windows Rust cargo check도 통과했다. 번들 크기 경고와 기존 Rust 경고가 남아 있다. 새 공개 복사본의 실행 파일을 빌드하거나 실제 재생 성공을 확인한 결과는 아니다.
