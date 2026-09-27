use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[tauri::command]
fn list_media_files(directory: String, extensions: Vec<String>) -> Result<Vec<String>, String> {
    let root = PathBuf::from(directory);
    if !root.is_dir() {
        return Err("Thư mục không tồn tại.".into());
    }
    let allowed: Vec<String> = extensions
        .into_iter()
        .map(|value| value.to_ascii_lowercase())
        .collect();
    let mut files = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if allowed.iter().any(|value| value == &extension) {
            files.push(path.to_string_lossy().into_owned());
        }
    }
    files.sort();
    Ok(files)
}

fn ffmpeg_path() -> PathBuf {
    if let Ok(configured) = env::var("HOVACUT_FFMPEG_PATH") {
        if !configured.trim().is_empty() {
            return PathBuf::from(configured);
        }
    }
    let cgt = PathBuf::from(r"E:\CGT Auto Tools v1.3.0\ffmpeg.exe");
    if cgt.is_file() {
        cgt
    } else {
        PathBuf::from("ffmpeg.exe")
    }
}

fn shuffled(mut paths: Vec<String>) -> Vec<String> {
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    for index in (1..paths.len()).rev() {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let target = (seed as usize) % (index + 1);
        paths.swap(index, target);
    }
    paths
}

#[tauri::command]
fn render_auto_video(
    audio_path: String,
    video_paths: Vec<String>,
    output_path: String,
    resolution: String,
) -> Result<String, String> {
    if !Path::new(&audio_path).is_file() {
        return Err("File audio không tồn tại.".into());
    }
    if video_paths.is_empty() {
        return Err("Thư mục không có video hợp lệ.".into());
    }
    if video_paths.iter().any(|value| !Path::new(value).is_file()) {
        return Err("Một hoặc nhiều video không còn tồn tại.".into());
    }
    let (width, height) = if resolution == "4k" {
        (3840, 2160)
    } else {
        (1920, 1080)
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let list_path = env::temp_dir().join(format!("hovacut-backgrounds-{stamp}.txt"));
    let list = shuffled(video_paths)
        .iter()
        .map(|value| {
            let normalized = value.replace('\\', "/").replace('\'', "'\\''");
            format!("file '{normalized}'")
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&list_path, list).map_err(|error| error.to_string())?;
    let filter = format!("scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p");
    let result = Command::new(ffmpeg_path())
        .args([
            "-y",
            "-stream_loop",
            "-1",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
        ])
        .arg(&list_path)
        .args([
            "-i",
            &audio_path,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            &filter,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-fflags",
            "+shortest",
            "-max_interleave_delta",
            "100M",
            "-movflags",
            "+faststart",
            &output_path,
        ])
        .output()
        .map_err(|error| error.to_string());
    let _ = fs::remove_file(&list_path);
    let output = result?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(output_path)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_media_files,
            render_auto_video
        ])
        .run(tauri::generate_context!())
        .expect("Không thể khởi động HovaCut Desktop");
}
