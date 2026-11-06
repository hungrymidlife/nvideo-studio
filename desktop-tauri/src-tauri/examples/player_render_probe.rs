#[cfg(windows)]
fn main(){nvideo_studio_lib::player_render_probe::run();}
#[cfg(not(windows))]
fn main(){eprintln!("The hardware rendering probe requires Windows.");}
