# 직접 의존성·라이선스 인벤토리

2026-11-06, 소스 `public-initial-snapshot` 기준. npm lockfile 및 설치된 package.json, Windows 대상 `cargo metadata --offline --locked` 결과에서 추출했다. 실제 바이너리 구성 전체를 보증하는 SBOM은 아니다.

## desktop-tauri

| 패키지 | 잠금 버전 | 선언 라이선스 | 용도 구분 |
| --- | --- | --- | --- |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT | 앱/서비스 의존성 |
| `@tauri-apps/plugin-dialog` | 2.8.4 | MIT OR Apache-2.0 | 앱/서비스 의존성 |
| `lucide-react` | 0.468.0 | ISC | 앱/서비스 의존성 |
| `react` | 19.3.1 | MIT | 앱/서비스 의존성 |
| `react-dom` | 19.3.1 | MIT | 앱/서비스 의존성 |
| `@neon/auth` | 0.8.2 | Apache-2.0 | 앱/서비스 의존성 |
| `@tiptap/core` | 3.33.0 | MIT | 앱/서비스 의존성 |
| `@tiptap/react` | 3.33.0 | MIT | 앱/서비스 의존성 |
| `@tiptap/pm` | 3.33.0 | MIT | 앱/서비스 의존성 |
| `@tiptap/starter-kit` | 3.33.0 | MIT | 앱/서비스 의존성 |
| `@tiptap/extension-image` | 3.33.0 | MIT | 앱/서비스 의존성 |
| `@tiptap/extension-file-handler` | 3.33.0 | MIT | 앱/서비스 의존성 |
| `@tiptap/extension-text-style` | 3.33.0 | MIT | 앱/서비스 의존성 |
| `@tauri-apps/cli` | 2.12.4 | Apache-2.0 OR MIT | 개발 도구 |
| `@types/react` | 19.3.0 | MIT | 개발 도구 |
| `@types/react-dom` | 19.3.0 | MIT | 개발 도구 |
| `typescript` | 5.9.3 | Apache-2.0 | 개발 도구 |
| `vite` | 7.3.7 | MIT | 개발 도구 |

## services/board-api

| 패키지 | 잠금 버전 | 선언 라이선스 | 용도 구분 |
| --- | --- | --- | --- |
| `pg` | 8.23.1 | MIT | 앱/서비스 의존성 |
| `jose` | 6.2.15 | MIT | 앱/서비스 의존성 |
| `@aws-sdk/client-s3` | 3.1163.0 | Apache-2.0 | 앱/서비스 의존성 |
| `@aws-sdk/s3-request-presigner` | 3.1163.0 | Apache-2.0 | 앱/서비스 의존성 |
| `esbuild` | 0.25.12 | MIT | 개발 도구 |

## services/supporter-api

| 패키지 | 잠금 버전 | 선언 라이선스 | 용도 구분 |
| --- | --- | --- | --- |
| `jose` | 6.2.15 | MIT | 앱/서비스 의존성 |
| `pg` | 8.23.1 | MIT | 앱/서비스 의존성 |

## Rust 직접 의존성

| crate | 잠금 버전 | 선언 라이선스 | 종류 |
| --- | --- | --- | --- |
| `base64` | 0.22.1 | MIT OR Apache-2.0 | normal |
| `blake2` | 0.10.6 | MIT OR Apache-2.0 | normal |
| `ed25519-dalek` | 2.2.0 | BSD-3-Clause | normal |
| `encoding_rs` | 0.8.42 | (Apache-2.0 OR MIT) AND BSD-3-Clause | normal |
| `image` | 0.25.10 | MIT OR Apache-2.0 | normal |
| `regex` | 1.13.1 | MIT OR Apache-2.0 | normal |
| `reqwest` | 0.12.28 | MIT OR Apache-2.0 | normal |
| `rusqlite` | 0.32.1 | MIT | normal |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | normal |
| `serde_json` | 1.0.154 | MIT OR Apache-2.0 | normal, build |
| `sha1` | 0.10.7 | MIT OR Apache-2.0 | normal |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 | normal |
| `tauri` | 2.12.5 | Apache-2.0 OR MIT | normal |
| `tauri-build` | 2.7.4 | Apache-2.0 OR MIT | build |
| `tauri-plugin-dialog` | 2.8.4 | Apache-2.0 OR MIT | normal |
| `tauri-plugin-single-instance` | 2.5.5 | Apache-2.0 OR MIT | normal |
| `trash` | 5.2.9 | MIT | normal |
| `url` | 2.5.8 | MIT OR Apache-2.0 | normal |
| `uuid` | 1.29.0 | Apache-2.0 OR MIT | normal |
| `webview2-com` | 0.39.1 | MIT | normal |
| `windows` | 0.62.2 | MIT OR Apache-2.0 | normal |
| `windows-sys` | 0.61.2 | MIT OR Apache-2.0 | normal |
| `zip` | 2.6.1 | MIT | normal |

`OR`와 `AND` 등 라이선스 표현은 upstream 메타데이터를 그대로 보존했다. 이 표는 라이선스 원문·저작권 고지의 대체물이 아니다. 외부 libmpv/FFmpeg 바이너리와 호스팅 서비스 약관은 별도 검토 대상이다. 전체 Rust 해석 결과와 lockfile 해시는 [dependency-inventory.json](dependency-inventory.json)에 있다. npm 전이 의존성은 각 package-lock.json을 함께 확인한다.
