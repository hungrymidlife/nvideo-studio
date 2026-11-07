# Viewer integration candidate (v0.1.1)

This feature is staged in `feature/viewer-integration-v011` against the independent public repository.
It is not a Git merge, cherry-pick, or full copy of the private development tree.

## Scope and plugin boundary

- Uses only `nvideo.library` and the existing Reader contribution port.
- External Explorer file requests are handled by `external_viewer.rs`, conditionally
  compiled with `#[cfg(all(windows, feature = "plugin-library"))]`.
- No external service, browser capture, streaming/downloader, remote mobile,
  developer menu, or private Hitomi plugin is introduced.
- Public custom-release and library-release profiles retain their existing plugin
  allowlists and the native-selective cargo feature.
- All Explorer integration is explicitly opt-in and scoped to HKCU (current user).
- No UserChoice keys or default Windows association are silently modified.

## Windows integration

After successful compilation, unpack the new `NVideoStudio_Portable.zip`.
Inside `NVideoStudio_Portable/Windows-Integration/` run:

1. `VERIFY_VIEWER.cmd` for Windows PowerShell 5.1 parser and ASCII checks.
2. `REGISTER_VIEWER.cmd` to add **Open with NVideo Image Viewer** and
   **Open with NVideo Media Viewer** context commands plus Open With candidates.
3. `STATUS_VIEWER.cmd` to check registered commands.
4. `UNREGISTER_VIEWER.cmd` to remove the app's entries.

The scripts are intentionally ASCII-only and CMD wrappers use CRLF. No elevated
permissions are required. Windows 11 may display legacy verbs under **Show more
options**. After moving the portable directory, register again from its new
location. Choose the default application explicitly in Windows Settings.

The application accepts one `--nvideo-viewer image|video|auto <absolute-file-path>`
request per process. Requests use a bounded, profile-scoped, per-user disk inbox,
are revalidated before opening, and do not require an HTTP listener.

## Image and media viewer behavior

- Shared review queue: Ctrl+D by default, configurable Ctrl+Q/Ctrl+Shift+D.
- The queue is local-only, persistent, and limited to 100 entries.
- Files are never deleted on queue insertion. Batch execution requires an explicit
  confirmation, moves to the OS Recycle Bin, verifies path/index again, and
  retains failures for review.
- Image and video reader use existing single-item Delete confirmation.
- Video right-click offers original location, author folder (when available),
  queue actions, delete and playback mode selection. Hitomi search is absent.
- Video EOF behavior: next video by default, current-file repeat, or single file.
- Settings are persisted locally. Native libmpv keyboard focus uses input
  forwarding without global hooks.

## Required validation before merging

```powershell
git switch feature/viewer-integration-v011
cd desktop-tauri
npm ci
npm run test:viewer-queue
npm run test:architecture
npm run test:safety-ui
npm run test:reader-layout
npm run build
cd src-tauri
cargo check
cargo check --no-default-features --features native-selective
cargo check --no-default-features --features native-selective,plugin-library,plugin-board
cargo test --lib --no-default-features --features native-selective,plugin-library batch_recycle
cd ..
npm run release:check -- custom-release
npm run release:build -- custom-release
```

Then test on Windows with **disposable copies** of image, ZIP/CBZ and video
files, with and without an existing running process; test single deletion,
batch confirmation/cancellation, stale or missing paths, EOF advance, loop and
single mode, context menu, drag and multiview. Build and inspect core-release
as well to confirm Explorer IPC is absent.

Do not replace the existing GitHub v0.1.0 release asset until these checks pass.
The public release policy still records `distributable:false` pending complete
corresponding-source/licensing validation of external media binaries. A test
ZIP is not equivalent to approval for public binary distribution.
