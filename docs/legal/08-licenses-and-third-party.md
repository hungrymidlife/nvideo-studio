# 라이선스와 서드파티 기술

## 프로젝트 자체의 라이선스 상태

공개 소스는 GPL-3.0-or-later로 배포한다. 현재 확인한 libmpv는 기본 GPL 및 GPL 의존성을 포함한 구성이므로 MIT만으로 결합 배포하는 구성으로 승인하지 않았다. 사용자가 지정한 대안에 따라 GPL-3.0-or-later를 선택했으며 루트 LICENSE를 추가했다. [GitHub의 저장소 라이선스 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)를 참고한다.

이 문서는 현재 확인한 메타데이터와 검토 과제를 정리한 것이다. 전체 배포물의 법적 적합성을 확정하는 문서는 아니다.

## 라이선스를 확인하는 세 가지 층

1. **프로젝트 코드**: 작성자가 부여할 소스·배포 라이선스
2. **포함 소프트웨어**: npm, Rust crate, libmpv/FFmpeg와 그 빌드에 포함된 라이브러리의 조건
3. **온라인 서비스**: Neon, Google OAuth, Ko-fi 등의 호스팅·계정·API 이용 조건

오픈소스 SDK의 라이선스가 해당 호스팅 서비스의 이용 조건을 대체하지 않는다. 프런트엔드, 서버, 개발 도구와 실제 바이너리 포함 여부도 구분해야 한다.

## 주요 서드파티 기술

| 기술 | 프로젝트에서의 사용 | 확인 근거·조건 |
| --- | --- | --- |
| React / React DOM | 데스크톱 UI | 잠금 패키지 메타데이터의 MIT |
| TypeScript / Vite | 타입 검사·개발·번들 | 각각 Apache-2.0 / MIT 메타데이터 |
| Tauri / 플러그인 | 셸·IPC·대화상자·인스턴스 | MIT 또는 Apache-2.0 계열, 패키지별 확인 |
| Lucide React | UI 아이콘 | ISC 메타데이터 |
| Tiptap / ProseMirror | 게시글 에디터·문서 모델 | 현재 설치한 open-source 패키지는 MIT 메타데이터 |
| `@neon/auth` | Managed Auth 클라이언트 | Apache-2.0 메타데이터, 서비스 약관은 별도 |
| rusqlite / SQLite | 로컬 DB | wrapper와 SQLite 자체의 조건을 각각 확인 |
| serde / reqwest / image / zip 등 | 직렬화·HTTPS·이미지·압축 | crate별 라이선스 표현은 인벤토리 참조 |
| pg / jose / AWS S3 SDK | 서버 SQL·JWT·첨부 | 서버 패키지별 메타데이터 참조 |
| libmpv | 네이티브 재생 DLL | 실제 빌드의 GPL/LGPL 구성 확인 필요 |
| FFmpeg / FFprobe | 로컬 영상 썸네일·미디어 도구 | 현재 사용 바이너리는 GPL 옵션 포함 |
| Windows / WebView2 | OS 네이티브·웹 런타임 | Microsoft 런타임·SDK 배포 조건 별도 확인 |

Tauri의 upstream은 MIT/Apache-2.0 라이선스를 제공한다. Tiptap은 오픈소스 영역과 유료 확장을 구분한다. 프로젝트가 모든 Tiptap 유료 기능을 사용할 권한을 확보했다는 의미는 아니다. [Tauri](https://github.com/tauri-apps/tauri), [Tiptap 공식 안내](https://tiptap.dev/docs/editor/getting-started/overview).

정확한 잠금 버전과 선언 라이선스는 [직접 의존성 목록](THIRD_PARTY_DEPENDENCIES.md)을 본다. npm 직접 의존성은 desktop 18개, Board API 5개, Supporter API 2개이며 Rust 직접 의존성은 23개다. 같은 패키지가 여러 프로젝트에 중복되므로 고유 패키지 수로 합산하지 않는다. Rust Windows 대상 메타데이터 386개도 실제 최종 바이너리 포함 목록과 같다고 가정하지 않는다.

## 외부 바이너리의 실제 확인 상태

### libmpv

설치 정보에는 `mpv-dev-x86_64-20261101-git-48fca90e8c.7z`와 SourceForge 다운로드 출처, 원본 패키지 SHA-256가 기록되어 있다. DLL 파일의 해시는 포터블 manifest에서 확인할 수 있다. 공식 SourceForge 원본 아카이브를 다시 내려받아 SHA-256를 대조했고, 추출한 DLL도 로컬 DLL과 일치했다. 상세 기록은 third-party/binaries에 있다.

mpv upstream은 기본 GPL 구성과 GPL 전용 부분을 제외한 LGPL 구성을 구분한다. DLL로 분리되어 있다는 사실이나 `standard`라는 설치 표기만으로 이 DLL을 LGPL 빌드라고 확정할 수 없다. 현재 빌드의 upstream 레시피와 설정은 기본 GPL 및 GPL 의존성을 사용한다. 정확한 전체 의존성 대응 소스는 확보하지 못했으며, 이 때문에 포터블 공개 배포는 보류한다. [mpv Copyright](https://github.com/mpv-player/mpv/blob/master/Copyright).

### FFmpeg와 FFprobe

현재 빌더가 선택한 로컬 FFmpeg는 `8.1.1-full_build-www.gyan.dev`이며 `ffmpeg -L` 출력에 GPL version 3 or later가 표시된다. 빌드 옵션에는 `--enable-gpl`, `--enable-version3`가 있다. 따라서 이 바이너리를 단순 LGPL FFmpeg라고 소개하지 않는다.

FFmpeg 라이선스는 구성과 포함 컴포넌트의 영향을 받는다. 외부 EXE 호출로 분리했다는 사실만으로 포함 바이너리의 고지·소스 제공 등 조건 검토가 끝나지는 않는다. FFprobe와 연결 라이브러리도 같은 패키지 근거로 확인해야 한다. [FFmpeg upstream 라이선스](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md), [공식 법률 안내](https://ffmpeg.org/legal.html).

## 공개 배포 전에 정리할 결과물

| 항목 | 현재 상태 |
| --- | --- |
| 프로젝트 자체 LICENSE | GPL-3.0-or-later, 루트 LICENSE 참조 |
| npm·Cargo 직접 의존성 목록 | 이 문서와 JSON에 추출 |
| 전이 의존성의 전체 고지·원문 모음 | 621개 잠금 패키지 목록과 833개 고지 파일 보존; 104개 항목은 별도 원문 확보 필요 |
| libmpv의 실제 빌드 라이선스·원본 소스 | GPL 구성 확인, 전체 대응 소스 미확보로 바이너리 공개 보류 |
| FFmpeg/FFprobe의 원문·고지·대응 소스 제공 | 정리 필요 |
| 원본·추출 바이너리 해시·출처 | 설치 정보와 release manifest에 일부 근거 있음 |
| 배포 ZIP의 최종 notices 포함 | 확보한 고지·인벤토리·보류 사유를 복사함. 전체 대응 소스 확보를 보증하지 않음 |
| 코드·아이콘·폰트·샘플 자료의 권리 | 실제 포함 범위별 점검 필요 |

현재 포터블 생성 성공을 공개 재배포 승인으로 표시하지 않는다. 현재 소스 라이선스는 GPL-3.0-or-later로 결정했다. permissive 라이선스를 원한다면 실제 LGPL 호환 바이너리 구성을 확보하는 방안 등을 검토할 수 있으나, 현재 바이너리에 대한 결론으로 제시하지 않는다.

## 보존한 고지와 콘텐츠

기존 [QR 코드 라이선스 고지](../../desktop-tauri/public/QR_CODE_LICENSE.txt)는 QR 기능 제거와 별개로 보존했다. 보존된 고지는 QR 기능이 현재 제공된다는 의미가 아니다. 테스트용 콘텐츠와 스크린샷에도 사용자 자료·개인정보·제3자 저작물의 공개 권한을 확인해야 한다.

보존한 전체 고지는 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)와 [패키지별 파일 목록](../../third-party/notice-inventory.json)을 참고한다.

## 근거 파일

- [직접 의존성과 버전](THIRD_PARTY_DEPENDENCIES.md)
- [메타데이터와 lockfile 해시](dependency-inventory.json)
- [프런트엔드 package-lock](../../desktop-tauri/package-lock.json)
- [Rust Cargo.lock](../../desktop-tauri/src-tauri/Cargo.lock)
- [libmpv 설치 출처 기록](../../desktop-tauri/tools/mpv/INSTALL_INFO.txt)
- [포터블 도구 정책](../../desktop-tauri/scripts/release-plan.mjs)
