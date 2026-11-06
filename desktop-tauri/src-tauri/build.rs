fn main() {
    validate_selected_profile();
    for name in ["NVIDEO_AUTH_URL","NVIDEO_SUPPORTER_API_URL","NVIDEO_BOARD_API_BASE_URL"]{println!("cargo:rerun-if-env-changed={name}");}
    // Standalone desktop builds run as the current user.
    #[cfg(windows)]
    if std::env::var("PROFILE").ok().as_deref()==Some("release") {
        let windows=tauri_build::WindowsAttributes::new()
            .app_manifest(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>"#);
        let attrs=tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("Tauri Windows non-elevated release manifest failed");
        return;
    }
    tauri_build::build()
}

fn validate_selected_profile(){
    use std::{env,fs,path::PathBuf};
    println!("cargo:rerun-if-env-changed=NVIDEO_PLUGIN_BUILD_PROFILE");
    let selective=env::var_os("CARGO_FEATURE_NATIVE_SELECTIVE").is_some();
    let dev_selective=env::var_os("CARGO_FEATURE_DEV_SELECTIVE").is_some();
    let developer_manager=env::var_os("CARGO_FEATURE_DEV_PLUGIN_MANAGER").is_some();
    assert!(!(selective&&dev_selective),"Release and development selective modes are mutually exclusive");
    let selected=env::var("NVIDEO_PLUGIN_BUILD_PROFILE").ok();
    if !selective&&!dev_selective {
        assert!(selected.is_none(),"A named native profile requires --no-default-features and a selective Cargo feature");
        println!("cargo:rustc-env=NVIDEO_COMPILED_PROFILE=null");
        return
    }
    if selective {
        assert!(!developer_manager,"Developer management is forbidden in selective release/staging builds");
    }
    if dev_selective {
        assert!(developer_manager,"Development-selective builds require the developer plugin manager");
    }
    assert!(env::var_os("CARGO_FEATURE_PLAYER_PROBE").is_none(),"Hardware probe is not a release capability");
    let id=selected.expect("Selective native builds require NVIDEO_PLUGIN_BUILD_PROFILE");
    assert!(!id.is_empty()&&id.len()<=40&&id.as_bytes()[0].is_ascii_lowercase()&&id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-'),"Invalid profile ID");
    let path=PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../build-profiles").join(format!("{id}.json"));
    println!("cargo:rerun-if-changed={}",path.display());
    let raw:serde_json::Value=serde_json::from_str(&fs::read_to_string(&path).expect("Missing selected profile")).expect("Invalid JSON profile");
    let object=raw.as_object().expect("Profile must be an object");
    assert!(object.len()==4&&["schemaVersion","profileId","mode","enabledPlugins"].iter().all(|k|object.contains_key(*k)),"Unexpected profile keys");
    assert_eq!(raw["schemaVersion"],1,"Unsupported profile schema");
    assert_eq!(raw["profileId"],id,"Profile filename mismatch");
    assert!(matches!(raw["mode"].as_str(),Some("release"|"development")),"Invalid profile mode");
    if dev_selective {
        assert_eq!(raw["mode"],"development","Developer-selective profile must be development");
    }
    if raw["mode"]=="release" {
        assert!(selective,"Release profiles must use native-selective without developer manager");
    }
    let plugins=raw["enabledPlugins"].as_array().expect("enabledPlugins must be an array");
    let mut expected=vec!["nvideo.settings"];
    for (name,feature) in [("library","LIBRARY"),("board","BOARD")]{
        if env::var_os(format!("CARGO_FEATURE_PLUGIN_{feature}")).is_some(){expected.push(match name{
            "library"=>"nvideo.library","board"=>"nvideo.board",_=>unreachable!("unexpected native plugin")});}
    }
    let mut actual=plugins.iter().map(|v|v.as_str().expect("Invalid plugin ID")).collect::<Vec<_>>();
    expected.sort();actual.sort();
    assert_eq!(actual,expected,"Cargo capabilities differ from selected JSON allowlist");
    if raw["mode"]=="release"{
        let config:serde_json::Value=serde_json::from_str(&env::var("TAURI_CONFIG").expect("Release selection requires matching Tauri frontend configuration")).expect("Invalid Tauri override");
        assert_eq!(config["build"]["frontendDist"],format!("../dist-plugin-{id}"),"Tauri frontend differs from selected profile");
        assert_eq!(config["bundle"]["resources"],serde_json::json!([]),"Selective release must not inherit full default frontend resources");
        let stamp_path=PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join(format!("../dist-plugin-{id}/bundle-profile.json"));
        println!("cargo:rerun-if-changed={}",stamp_path.display());
        let stamp:serde_json::Value=serde_json::from_str(&fs::read_to_string(&stamp_path).expect("Build the selected frontend before native release")).expect("Invalid frontend stamp");
        assert_eq!(stamp["profileId"],id,"Frontend profile mismatch");
        assert_eq!(stamp["mode"],"release","Frontend is not a release build");
        let mut frontend=stamp["menuIds"].as_array().expect("Frontend menu allowlist missing").iter().map(|v|v.as_str().expect("Invalid frontend plugin")).collect::<Vec<_>>();
        frontend.sort();assert_eq!(frontend,expected,"Frontend and Cargo feature allowlists differ");
    }
    println!("cargo:rustc-env=NVIDEO_COMPILED_PROFILE={}",serde_json::to_string(&raw).unwrap());
}
