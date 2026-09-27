use std::{fs, path::PathBuf};

#[tauri::command]
fn list_media_files(directory: String, extensions: Vec<String>) -> Result<Vec<String>, String> {
	let root = PathBuf::from(directory);
	if !root.is_dir() {
		return Err("Thư mục không tồn tại.".into());
	}
	let allowed: Vec<String> = extensions.into_iter().map(|value| value.to_ascii_lowercase()).collect();
	let mut files = Vec::new();
	for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
		let path = entry.map_err(|error| error.to_string())?.path();
		if !path.is_file() {
			continue;
		}
		let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
		if allowed.iter().any(|value| value == &extension) {
			files.push(path.to_string_lossy().into_owned());
		}
	}
	files.sort();
	Ok(files)
}

fn main() {
	tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.invoke_handler(tauri::generate_handler![list_media_files])
		.run(tauri::generate_context!())
		.expect("Không thể khởi động HovaCut Desktop");
}

