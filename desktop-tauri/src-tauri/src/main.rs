#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// In cargo/tauri DEV builds the WebView points at Vite on 127.0.0.1:1421.
/// A taskbar-pinned debug EXE or an HKCU Startup entry bypasses
/// `beforeDevCommand`, so it must start the frontend BEFORE Tauri creates
/// the WebView. Release binaries embed the frontend and skip this entirely.
#[cfg(debug_assertions)]
mod dev_frontend {
    use std::{
        fs::{self, OpenOptions},
        net::{SocketAddr, TcpStream},
        path::PathBuf,
        process::{Child, Command, Stdio},
        thread,
        time::Duration,
    };

    const VITE_PORT: u16 = 1421;

    fn ready() -> bool {
        TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], VITE_PORT)),
            Duration::from_millis(250),
        ).is_ok()
    }

    pub(super) struct ManagedVite(Option<Child>);

    impl Drop for ManagedVite {
        fn drop(&mut self) {
            if let Some(mut child) = self.0.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    pub(super) fn prepare() -> Result<ManagedVite, String> {
        // npm run tauri dev already starts the server via beforeDevCommand;
        // do not attempt to start a second instance on the same port.
        if ready() {
            return Ok(ManagedVite(None));
        }
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("desktop-tauri 프로젝트 경로를 찾지 못했습니다.")?
            .to_path_buf();
        let vite = project.join("node_modules").join("vite").join("bin").join("vite.js");
        if !vite.is_file() {
            return Err(format!(
                "Vite 실행 파일이 없습니다: {}. desktop-tauri에서 npm install을 실행하세요.",
                vite.display()
            ));
        }

        let log_path = std::env::temp_dir().join("nvideo-studio-dev-vite.log");
        let log = OpenOptions::new().create(true).append(true)
            .open(&log_path).map_err(|e|e.to_string())?;
        let errors = log.try_clone().map_err(|e|e.to_string())?;
        // Launch node.exe directly, not npm.cmd: one owned process, no
        // command window and no orphan cmd/npm process tree at normal exit.
        let mut command = Command::new("node.exe");
        command.arg(vite)
            .args(["--host", "127.0.0.1", "--port", "1421", "--strictPort"])
            .current_dir(&project)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(errors));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|e|format!(
            "Node.js 개발 서버 실행 실패 ({e}). node.exe가 PATH에 있는지 확인하세요."
        ))?;

        // The WebView must not navigate until Vite is accepting requests.
        for _ in 0..100 {
            if ready() {
                return Ok(ManagedVite(Some(child)));
            }
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!(
                    "Vite 서버가 종료됐습니다 ({status}). 로그: {}",
                    log_path.display()
                ));
            }
            thread::sleep(Duration::from_millis(150));
        }
        let _ = child.kill();
        let _ = child.wait();
        Err(format!(
            "Vite 서버 연결 시간 초과 (127.0.0.1:{VITE_PORT}). 로그: {}",
            log_path.display()
        ))
    }

    pub(super) fn write_boot_error(error: &str) {
        let path = std::env::temp_dir().join("nvideo-studio-dev-startup-error.txt");
        let _ = fs::write(&path, error);
        eprintln!("[NVideo dev] {error}");
    }
}

fn main() {
    // The verification process never starts the normal application's services.
    if std::env::args().nth(1).as_deref()==Some("--nvideo-release-self-test"){
        let input=std::env::args().nth(2).unwrap_or_default();
        if let Err(error)=nvideo_studio_lib::run_release_self_test(&input){
            eprintln!("[NVideo release self-test] {error}");std::process::exit(1);
        }
        return
    }
    #[cfg(debug_assertions)]
    let _vite = match dev_frontend::prepare() {
        Ok(child) => child,
        Err(error) => {
            dev_frontend::write_boot_error(&error);
            // Do not open a WebView pointing at a refused localhost URL.
            // A visible error is shown on Windows, even without a console.
            #[cfg(windows)]
            {
                use std::ffi::OsStr;
                use std::os::windows::ffi::OsStrExt;
                #[link(name = "user32")]
                unsafe extern "system" {
                    fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16,
                        caption: *const u16, flags: u32) -> i32;
                }
                let wide = |s: &str| OsStr::new(s).encode_wide()
                    .chain(std::iter::once(0)).collect::<Vec<_>>();
                unsafe {
                    MessageBoxW(std::ptr::null_mut(),
                        wide(&error).as_ptr(),
                        wide("NVideo Studio 개발 실행 오류").as_ptr(), 0x10);
                }
            }
            return;
        }
    };
    nvideo_studio_lib::run();
}
