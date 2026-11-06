//! Compile-time native allowlist. Default features are the retained developer build; portfolio DEV uses dev-selective.
//! Selected releases are bound by build.rs to matching JSON, Cargo and Vite output;
//! the release builder verifies the actual handler before publishing a portable ZIP.
#[cfg(all(feature = "native-selective", feature = "dev-plugin-manager"))]
compile_error!("native-selective builds must not include the developer plugin manager");
#[cfg(all(feature = "native-selective", feature = "dev-selective"))]
compile_error!("Release-selective and developer-selective features cannot be combined");
#[cfg(all(feature = "dev-selective", not(feature = "dev-plugin-manager")))]
compile_error!("Developer-selective builds must include the plugin manager");

#[cfg(all(
    not(feature = "native-selective"),
    not(any(
        feature = "plugin-library",
        feature = "plugin-board",
        feature = "dev-plugin-manager"
    ))
))]
compile_error!("No native plugins selected. Use default features or explicit native-selective.");

pub(crate) fn selected_plugins()->Vec<&'static str>{
    let mut selected=vec!["nvideo.settings"];
    if cfg!(feature="plugin-library"){selected.push("nvideo.library");}
    if cfg!(feature="plugin-board"){selected.push("nvideo.board");}
    selected
}
pub(crate) fn selective_staging()->bool{cfg!(feature="native-selective")}
pub(crate) fn developer_plugin_manager()->bool{cfg!(feature="dev-plugin-manager")}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn required_core_plugins_are_always_compiled(){
        let selected=selected_plugins();
        assert!(selected.contains(&"nvideo.settings"));
        assert_eq!(selected.len(),
            1+[
                cfg!(feature="plugin-library"),
                cfg!(feature="plugin-board"),
            ].into_iter().filter(|enabled|*enabled).count());
    }
    #[test]
    fn staging_never_includes_developer_plugin_manager(){
        if selective_staging(){assert!(!developer_plugin_manager());}
    }
}

pub(crate) fn compiled_profile()->serde_json::Value{
    serde_json::from_str(env!("NVIDEO_COMPILED_PROFILE")).expect("Build script validated profile")
}

pub(crate) fn instance_namespace()->String{
    use sha2::{Digest,Sha256};
    format!("NVideoStudio-profile-{:x}",Sha256::digest(env!("NVIDEO_COMPILED_PROFILE").as_bytes()))
}
pub(crate) fn window_title()->String{
    match compiled_profile()["profileId"].as_str(){Some(id)=>format!("NVideo Studio · {id} [{}]",&instance_namespace()[21..37]),None=>"NVideo Studio".into()}
}
