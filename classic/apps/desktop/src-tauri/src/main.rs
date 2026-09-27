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

fn encoder_available(encoder: &str) -> bool {
    Command::new(ffmpeg_path())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=s=256x256:d=0.1",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn detect_video_encoders() -> Vec<String> {
    [
        ("nvidia", "h264_nvenc"),
        ("amd", "h264_amf"),
        ("intel", "h264_qsv"),
    ]
    .into_iter()
    .filter_map(|(name, encoder)| encoder_available(encoder).then(|| name.to_string()))
    .collect()
}

#[tauri::command]
fn render_auto_video(
    audio_path: String,
    video_paths: Vec<String>,
    output_path: String,
    resolution: String,
    encoder: String,
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
    let video_encoder = match encoder.as_str() {
        "nvidia" => "h264_nvenc",
        "amd" => "h264_amf",
        "intel" => "h264_qsv",
        _ => "libx264",
    };
    let (speed_option, speed_value) = if video_encoder == "h264_amf" {
        ("-quality", "speed")
    } else {
        (
            "-preset",
            if video_encoder == "libx264" {
                "medium"
            } else {
                "fast"
            },
        )
    };
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
            video_encoder,
            speed_option,
            speed_value,
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

fn audio_duration(path: &str) -> f64 {
    let Ok(output) = Command::new(ffmpeg_path()).args(["-i", path]).output() else {
        return 0.0;
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    let Some(value) = stderr
        .split("Duration: ")
        .nth(1)
        .and_then(|part| part.split(',').next())
    else {
        return 0.0;
    };
    let parts: Vec<f64> = value
        .split(':')
        .filter_map(|part| part.parse().ok())
        .collect();
    if parts.len() == 3 {
        parts[0] * 3600.0 + parts[1] * 60.0 + parts[2]
    } else {
        0.0
    }
}

fn track_time(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        (total % 3600) / 60,
        total % 60
    )
}

#[tauri::command]
fn render_auto_mp3(
    good_paths: Vec<String>,
    other_paths: Vec<String>,
    good_count: usize,
    other_count: usize,
    output_count: usize,
    output_directory: String,
) -> Result<Vec<String>, String> {
    if good_count + other_count < 2 {
        return Err("Mỗi playlist cần ít nhất 2 bài.".into());
    }
    if good_count > good_paths.len() || other_count > other_paths.len() {
        return Err("Số bài yêu cầu lớn hơn số file trong thư mục.".into());
    }
    fs::create_dir_all(&output_directory).map_err(|error| error.to_string())?;
    let mut outputs = Vec::new();
    for output_index in 0..output_count.clamp(1, 20) {
        let mut selected = shuffled(good_paths.clone())
            .into_iter()
            .take(good_count)
            .collect::<Vec<_>>();
        selected.extend(shuffled(other_paths.clone()).into_iter().take(other_count));
        selected = shuffled(selected);
        let base = format!("hovacut-auto-mp3-{:02}", output_index + 1);
        let mp3_path = PathBuf::from(&output_directory).join(format!("{base}.mp3"));
        let txt_path = PathBuf::from(&output_directory).join(format!("{base}.txt"));
        let mut args = vec!["-y".to_string()];
        for input in &selected {
            args.extend(["-i".into(), input.clone()]);
        }
        let labels = (0..selected.len())
            .map(|index| format!("[{index}:a:0]"))
            .collect::<String>();
        args.extend([
            "-filter_complex".into(),
            format!("{labels}concat=n={}:v=0:a=1[outa]", selected.len()),
            "-map".into(),
            "[outa]".into(),
            "-ar".into(),
            "44100".into(),
            "-ac".into(),
            "2".into(),
            "-c:a".into(),
            "libmp3lame".into(),
            "-b:a".into(),
            "320k".into(),
            mp3_path.to_string_lossy().into_owned(),
        ]);
        let output = Command::new(ffmpeg_path())
            .args(args)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let mut elapsed = 0.0;
        let mut tracks = Vec::new();
        for input in &selected {
            let name = Path::new(input)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Track");
            tracks.push(format!("{} {}", track_time(elapsed), name));
            elapsed += audio_duration(input);
        }
        fs::write(&txt_path, tracks.join("\r\n")).map_err(|error| error.to_string())?;
        outputs.push(mp3_path.to_string_lossy().into_owned());
        outputs.push(txt_path.to_string_lossy().into_owned());
    }
    Ok(outputs)
}

#[tauri::command]
fn render_join_audio(
    audio_paths: Vec<String>,
    output_path: String,
    export_tracks: bool,
) -> Result<Vec<String>, String> {
    if audio_paths.len() < 2 {
        return Err("Chọn ít nhất hai file audio.".into());
    }
    if audio_paths.iter().any(|value| !Path::new(value).is_file()) {
        return Err("Một hoặc nhiều file audio không còn tồn tại.".into());
    }
    let mut args = vec!["-y".to_string()];
    for input in &audio_paths {
        args.extend(["-i".into(), input.clone()]);
    }
    let labels = (0..audio_paths.len())
        .map(|index| format!("[{index}:a:0]"))
        .collect::<String>();
    args.extend([
        "-filter_complex".into(),
        format!("{labels}concat=n={}:v=0:a=1[outa]", audio_paths.len()),
        "-map".into(),
        "[outa]".into(),
        "-ar".into(),
        "44100".into(),
        "-ac".into(),
        "2".into(),
        "-c:a".into(),
        "libmp3lame".into(),
        "-b:a".into(),
        "320k".into(),
        output_path.clone(),
    ]);
    let output = Command::new(ffmpeg_path())
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let mut outputs = vec![output_path.clone()];
    if export_tracks {
        let txt_path = Path::new(&output_path).with_extension("txt");
        let mut elapsed = 0.0;
        let mut tracks = Vec::new();
        for input in &audio_paths {
            let name = Path::new(input)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Track");
            tracks.push(format!("{} {}", track_time(elapsed), name));
            elapsed += audio_duration(input);
        }
        fs::write(&txt_path, tracks.join("\r\n")).map_err(|error| error.to_string())?;
        outputs.push(txt_path.to_string_lossy().into_owned());
    }
    Ok(outputs)
}

#[tauri::command]
fn convert_media(
    input_path: String,
    output_path: String,
    format: String,
) -> Result<String, String> {
    if !Path::new(&input_path).is_file() {
        return Err("File đầu vào không tồn tại.".into());
    }
    let mut args = vec!["-y", "-i", &input_path];
    match format.as_str() {
        "wav" => args.extend(["-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le"]),
        "mp4" => args.extend([
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
        ]),
        _ => args.extend(["-vn", "-c:a", "libmp3lame", "-b:a", "320k"]),
    }
    args.push(&output_path);
    let output = Command::new(ffmpeg_path())
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(output_path)
}

#[tauri::command]
fn render_image_audio(
    image_path: String,
    audio_path: String,
    output_path: String,
    resolution: String,
) -> Result<String, String> {
    if !Path::new(&image_path).is_file() || !Path::new(&audio_path).is_file() {
        return Err("Ảnh hoặc audio không tồn tại.".into());
    }
    let (width, height) = if resolution == "4k" {
        (3840, 2160)
    } else {
        (1920, 1080)
    };
    let filter = format!("scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p");
    let output = Command::new(ffmpeg_path())
        .args([
            "-y",
            "-loop",
            "1",
            "-i",
            &image_path,
            "-i",
            &audio_path,
            "-vf",
            &filter,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-tune",
            "stillimage",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-fflags",
            "+shortest",
            "-movflags",
            "+faststart",
            &output_path,
        ])
        .output()
        .map_err(|error| error.to_string())?;
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
            detect_video_encoders,
            render_auto_video,
            render_auto_mp3,
            render_join_audio,
            convert_media,
            render_image_audio
        ])
        .run(tauri::generate_context!())
        .expect("Không thể khởi động HovaCut Desktop");
}
