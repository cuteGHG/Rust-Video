use std::{env, fs, path::PathBuf};

fn main() {
    // Tauri's Windows resource generator expects this file even when no
    // application bundle icon is configured. Generate a tiny valid ICO so
    // clean CI checkouts can build without committing a binary asset.
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let icons_dir = manifest_dir.join("icons");
    fs::create_dir_all(&icons_dir).expect("create icons directory");
    let icon_path = icons_dir.join("icon.ico");
    if !icon_path.exists() {
        let mut ico = Vec::with_capacity(70);
        // ICONDIR
        ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
        // One 1x1, 32-bit image; bitmap data starts immediately after header.
        ico.extend_from_slice(&[1, 1, 0, 0, 1, 0, 32, 0]);
        ico.extend_from_slice(&[48, 0, 0, 0, 22, 0, 0, 0]);
        // BITMAPINFOHEADER (height is doubled for XOR + AND masks).
        ico.extend_from_slice(&[40, 0, 0, 0]);
        ico.extend_from_slice(&[1, 0, 0, 0]);
        ico.extend_from_slice(&[2, 0, 0, 0]);
        ico.extend_from_slice(&[1, 0, 32, 0]);
        ico.extend_from_slice(&[0, 0, 0, 0]);
        ico.extend_from_slice(&[4, 0, 0, 0]);
        ico.extend_from_slice(&[0; 16]);
        // Opaque dark-blue pixel followed by the 1-bit transparency mask.
        ico.extend_from_slice(&[180, 70, 30, 255, 0, 0, 0, 0]);
        fs::write(&icon_path, ico).expect("write fallback Windows icon");
    }
    println!("cargo:rerun-if-changed={}", icon_path.display());
    tauri_build::build()
}
