fn main() {
    println!("cargo:rerun-if-changed=../../web/.env.local");
    if let Ok(contents) = std::fs::read_to_string("../../web/.env.local") {
        if let Some(value) = contents.lines().find_map(|line| {
            let (name, value) = line.trim().split_once('=')?;
            let value = value.trim().trim_matches(['\"', '\'']);
            (name == "FREESOUND_API_KEY" && value.len() >= 20).then_some(value)
        }) {
            println!("cargo:rustc-env=HOVACUT_FREESOUND_API_KEY={value}");
        }
    }
    tauri_build::build()
}
