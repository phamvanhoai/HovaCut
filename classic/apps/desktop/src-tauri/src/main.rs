use serde::Deserialize;
use serde_json::Value;
use std::{
    env, fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

static CANCEL_NATIVE_RENDER: AtomicBool = AtomicBool::new(false);

fn frontend_is_ready() -> bool {
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:3000".parse().expect("valid frontend address"),
        Duration::from_millis(250),
    )
    .is_ok()
}

fn start_frontend_server() -> Result<Option<Child>, String> {
    if frontend_is_ready() {
        return Ok(None);
    }

    #[cfg(debug_assertions)]
    let (program, working_directory, arguments) = {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let web_directory = manifest
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| "Không tìm thấy thư mục frontend HovaCut.".to_string())?
            .join("web");
        let next = web_directory
            .join("node_modules")
            .join(".bin")
            .join("next.exe");
        if !next.is_file() {
            return Err(format!("Không tìm thấy Next.js tại {}", next.display()));
        }
        (next, web_directory, vec!["dev", "--webpack"])
    };

    #[cfg(not(debug_assertions))]
    let (program, working_directory, arguments) = {
        let executable_directory = env::current_exe()
            .map_err(|error| error.to_string())?
            .parent()
            .ok_or_else(|| "Cannot locate the HovaCut install directory.".to_string())?
            .to_path_buf();
        let frontend_directory = [
            executable_directory.join("frontend"),
            executable_directory.join("resources").join("frontend"),
        ]
        .into_iter()
        .find(|directory| directory.join("node.exe").is_file())
        .ok_or_else(|| "Cannot locate the packaged HovaCut frontend.".to_string())?;
        let server_directory = frontend_directory.join("apps").join("web");
        let server = server_directory.join("server.js");
        if !server.is_file() {
            return Err(format!(
                "Cannot locate the frontend server at {}",
                server.display()
            ));
        }
        (
            frontend_directory.join("node.exe"),
            server_directory,
            vec!["server.js"],
        )
    };

    let mut command = Command::new(program);
    command
        .current_dir(working_directory)
        .args(arguments)
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", "3000")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(not(debug_assertions))]
    command
        .env("NODE_ENV", "production")
        .env("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000")
        .env("NEXT_PUBLIC_MARBLE_API_URL", "https://api.marblecms.com")
        .env("DATABASE_URL", "postgres://localhost/hovacut_desktop")
        .env(
            "BETTER_AUTH_SECRET",
            "hovacut-desktop-local-only-secret-key",
        )
        .env("UPSTASH_REDIS_REST_URL", "http://127.0.0.1")
        .env("UPSTASH_REDIS_REST_TOKEN", "desktop")
        .env("MARBLE_WORKSPACE_KEY", "desktop")
        .env("FREESOUND_CLIENT_ID", "desktop")
        .env("FREESOUND_API_KEY", "desktop");
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let child = command.spawn().map_err(|error| error.to_string())?;
    for _ in 0..240 {
        if frontend_is_ready() {
            return Ok(Some(child));
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err("Frontend HovaCut không khởi động sau 60 giây.".into())
}

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

fn projects_directory() -> Result<PathBuf, String> {
    let root = env::var("APPDATA").map_err(|_| "Không tìm thấy thư mục AppData.".to_string())?;
    let directory = PathBuf::from(root).join("HovaCut").join("projects");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn validate_storage_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("ID lưu trữ không hợp lệ.".into());
    }
    Ok(())
}

fn media_metadata_path(project_id: &str) -> Result<PathBuf, String> {
    validate_storage_id(project_id)?;
    Ok(projects_directory()?.join(format!("{project_id}.media.json")))
}

fn read_media_metadata(project_id: &str) -> Result<Vec<Value>, String> {
    let path = media_metadata_path(project_id)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&content).map_err(|error| error.to_string())
}

fn write_media_metadata(project_id: &str, items: &[Value]) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(items).map_err(|error| error.to_string())?;
    fs::write(media_metadata_path(project_id)?, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_media_metadata(project_id: String, metadata: Value) -> Result<(), String> {
    let media_id = metadata
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Metadata media thiếu ID.".to_string())?;
    validate_storage_id(media_id)?;
    let mut items = read_media_metadata(&project_id)?;
    if let Some(existing) = items
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(media_id))
    {
        *existing = metadata;
    } else {
        items.push(metadata);
    }
    write_media_metadata(&project_id, &items)
}

#[tauri::command]
fn load_media_metadata(project_id: String, media_id: String) -> Result<Option<Value>, String> {
    validate_storage_id(&media_id)?;
    Ok(read_media_metadata(&project_id)?
        .into_iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(media_id.as_str())))
}

#[tauri::command]
fn list_media_metadata(project_id: String) -> Result<Vec<Value>, String> {
    read_media_metadata(&project_id)
}

#[tauri::command]
fn delete_media_metadata(project_id: String, media_id: String) -> Result<(), String> {
    validate_storage_id(&media_id)?;
    let mut items = read_media_metadata(&project_id)?;
    items.retain(|item| item.get("id").and_then(Value::as_str) != Some(media_id.as_str()));
    write_media_metadata(&project_id, &items)
}

#[tauri::command]
fn clear_media_metadata(project_id: String) -> Result<(), String> {
    let path = media_metadata_path(&project_id)?;
    if path.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_project_json(project_id: String, project: Value) -> Result<String, String> {
    validate_storage_id(&project_id)?;
    let path = projects_directory()?.join(format!("{project_id}.hovacut.json"));
    let content = serde_json::to_vec_pretty(&project).map_err(|error| error.to_string())?;
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_project_json(project_id: String) -> Result<Option<Value>, String> {
    validate_storage_id(&project_id)?;
    let path = projects_directory()?.join(format!("{project_id}.hovacut.json"));
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&content)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_project_jsons() -> Result<Vec<Value>, String> {
    let directory = projects_directory()?;
    let mut projects = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if !path.is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("json")
            || !path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.ends_with(".hovacut.json"))
        {
            continue;
        }
        let content = fs::read(&path).map_err(|error| error.to_string())?;
        match serde_json::from_slice::<Value>(&content) {
            Ok(project) => projects.push(project),
            Err(error) => eprintln!("Skipping invalid project {}: {error}", path.display()),
        }
    }
    projects.sort_by(|left, right| {
        let updated = |project: &Value| {
            project
                .get("metadata")
                .and_then(|metadata| metadata.get("updatedAt"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        updated(right).cmp(&updated(left))
    });
    Ok(projects)
}

#[tauri::command]
fn delete_project_json(project_id: String) -> Result<(), String> {
    validate_storage_id(&project_id)?;
    let path = projects_directory()?.join(format!("{project_id}.hovacut.json"));
    if path.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    let media_path = media_metadata_path(&project_id)?;
    if media_path.is_file() {
        fs::remove_file(media_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn project_id_from_json(project: &Value) -> Result<String, String> {
    let project_id = project
        .get("metadata")
        .and_then(|metadata| metadata.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| "File project thiếu metadata.id.".to_string())?;
    if project_id.is_empty()
        || !project_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("ID project không hợp lệ.".into());
    }
    Ok(project_id.to_string())
}

#[tauri::command]
fn import_project_json(input_path: String) -> Result<Value, String> {
    let content = fs::read(&input_path).map_err(|error| error.to_string())?;
    let mut project: Value = serde_json::from_slice(&content)
        .map_err(|error| format!("File project không phải JSON hợp lệ: {error}"))?;
    if let Some(media) = project
        .get_mut("desktopMedia")
        .and_then(Value::as_array_mut)
    {
        let base = Path::new(&input_path)
            .parent()
            .unwrap_or_else(|| Path::new("."));
        for item in media {
            if let Some(relative) = item.get("sourcePath").and_then(Value::as_str) {
                let path = PathBuf::from(relative);
                if path.is_relative() {
                    item["sourcePath"] =
                        Value::String(base.join(path).to_string_lossy().into_owned());
                }
            }
        }
    }
    let project_id = project_id_from_json(&project)?;
    let destination = projects_directory()?.join(format!("{project_id}.hovacut.json"));
    let normalized = serde_json::to_vec_pretty(&project).map_err(|error| error.to_string())?;
    fs::write(destination, normalized).map_err(|error| error.to_string())?;
    Ok(project)
}

#[tauri::command]
fn export_project_json(
    project_id: String,
    output_path: String,
    media_assets: Vec<Value>,
) -> Result<String, String> {
    let source = projects_directory()?.join(format!("{project_id}.hovacut.json"));
    if !source.is_file() {
        return Err("Không tìm thấy dữ liệu project đã lưu.".into());
    }
    let content = fs::read(source).map_err(|error| error.to_string())?;
    let mut project: Value = serde_json::from_slice(&content).map_err(|error| error.to_string())?;
    let output = PathBuf::from(&output_path);
    let stem = output
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("hovacut");
    let media_folder_name = format!("{stem}_media");
    let media_directory = output
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(&media_folder_name);
    fs::create_dir_all(&media_directory).map_err(|error| error.to_string())?;
    let mut portable_media = Vec::new();
    for mut media in media_assets {
        let Some(source_path) = media.get("sourcePath").and_then(Value::as_str) else {
            continue;
        };
        let source = PathBuf::from(source_path);
        if !source.is_file() {
            continue;
        }
        let id = media.get("id").and_then(Value::as_str).unwrap_or("media");
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("asset");
        let filename = format!("{id}-{name}");
        fs::copy(&source, media_directory.join(&filename)).map_err(|error| error.to_string())?;
        media["sourcePath"] = Value::String(format!("{media_folder_name}/{filename}"));
        portable_media.push(media);
    }
    project["desktopMedia"] = Value::Array(portable_media);
    let normalized = serde_json::to_vec_pretty(&project).map_err(|error| error.to_string())?;
    fs::write(&output, normalized).map_err(|error| error.to_string())?;
    Ok(output_path)
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTimelineClip {
    path: String,
    kind: String,
    duration: f64,
    trim_start: f64,
    rate: f64,
    blur: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTimelineAudio {
    path: String,
    start: f64,
    duration: f64,
    trim_start: f64,
    volume: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTimelineOverlay {
    path: String,
    kind: String,
    start: f64,
    duration: f64,
    trim_start: f64,
    source_width: u32,
    source_height: u32,
    scale_x: f64,
    scale_y: f64,
    position_x: f64,
    position_y: f64,
    opacity: f64,
    rotation: f64,
    blur: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTimelineText {
    content: String,
    start: f64,
    duration: f64,
    font_size: f64,
    color: String,
    position_x: f64,
    position_y: f64,
    opacity: f64,
    font_family: String,
    rotation: f64,
    bold: bool,
    italic: bool,
    background_enabled: bool,
    background_color: String,
    background_padding: f64,
}

fn escape_drawtext(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace('%', "\\%")
        .replace(',', "\\,")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('\n', "\\n")
}

fn windows_font_path(family: &str, bold: bool, italic: bool) -> PathBuf {
    let style = match (bold, italic) {
        (true, true) => 3,
        (true, false) => 1,
        (false, true) => 2,
        _ => 0,
    };
    let filename = match (family.to_ascii_lowercase().as_str(), style) {
        ("arial", 1) => "arialbd.ttf",
        ("arial", 2) => "ariali.ttf",
        ("arial", 3) => "arialbi.ttf",
        ("calibri", 1) => "calibrib.ttf",
        ("calibri", 2) => "calibrii.ttf",
        ("calibri", 3) => "calibriz.ttf",
        ("segoe ui", 1) => "segoeuib.ttf",
        ("segoe ui", 2) => "segoeuii.ttf",
        ("segoe ui", 3) => "segoeuiz.ttf",
        ("times new roman", 1) => "timesbd.ttf",
        ("times new roman", 2) => "timesi.ttf",
        ("times new roman", 3) => "timesbi.ttf",
        ("arial", _) => "arial.ttf",
        ("arial black", _) => "ariblk.ttf",
        ("calibri", _) => "calibri.ttf",
        ("cambria", _) => "cambria.ttc",
        ("comic sans ms", _) => "comic.ttf",
        ("consolas", _) => "consola.ttf",
        ("courier new", _) => "cour.ttf",
        ("georgia", _) => "georgia.ttf",
        ("segoe ui", _) => "segoeui.ttf",
        ("tahoma", _) => "tahoma.ttf",
        ("times new roman", _) => "times.ttf",
        ("trebuchet ms", _) => "trebuc.ttf",
        ("verdana", _) => "verdana.ttf",
        (_, 1) => "arialbd.ttf",
        (_, 2) => "ariali.ttf",
        (_, 3) => "arialbi.ttf",
        _ => "arial.ttf",
    };
    let selected = PathBuf::from(r"C:\Windows\Fonts").join(filename);
    if selected.is_file() {
        selected
    } else {
        PathBuf::from(r"C:\Windows\Fonts\arial.ttf")
    }
}

#[tauri::command]
fn render_native_timeline(
    window: tauri::Window,
    clips: Vec<NativeTimelineClip>,
    overlays: Vec<NativeTimelineOverlay>,
    texts: Vec<NativeTimelineText>,
    audios: Vec<NativeTimelineAudio>,
    output_path: String,
    width: u32,
    height: u32,
    fps: f64,
    encoder: String,
    quality: String,
    total_duration: f64,
    format: String,
    background_color: String,
    background_blur: f64,
) -> Result<String, String> {
    CANCEL_NATIVE_RENDER.store(false, Ordering::SeqCst);
    if clips.is_empty()
        || clips
            .iter()
            .any(|clip| clip.kind != "blank" && !Path::new(&clip.path).is_file())
        || overlays
            .iter()
            .any(|overlay| !Path::new(&overlay.path).is_file())
        || audios.iter().any(|audio| !Path::new(&audio.path).is_file())
    {
        return Err("Timeline không có media native hợp lệ.".into());
    }
    let mut command = Command::new(ffmpeg_path());
    command.arg("-y");
    for clip in &clips {
        if clip.kind == "blank" {
            command.args([
                "-f",
                "lavfi",
                "-t",
                &clip.duration.to_string(),
                "-i",
                &format!("color=c={background_color}:s={width}x{height}:r={fps}"),
            ]);
        } else if clip.kind == "image" {
            command.args([
                "-loop",
                "1",
                "-t",
                &clip.duration.to_string(),
                "-i",
                &clip.path,
            ]);
        } else {
            let source_duration = clip.duration * clip.rate.max(0.01);
            command.args([
                "-ss",
                &clip.trim_start.to_string(),
                "-t",
                &source_duration.to_string(),
                "-i",
                &clip.path,
            ]);
        }
    }
    for overlay in &overlays {
        if overlay.kind == "image" {
            command.args([
                "-loop",
                "1",
                "-t",
                &overlay.duration.to_string(),
                "-i",
                &overlay.path,
            ]);
        } else {
            command.args([
                "-ss",
                &overlay.trim_start.to_string(),
                "-t",
                &overlay.duration.to_string(),
                "-i",
                &overlay.path,
            ]);
        }
    }
    for audio in &audios {
        command.args(["-i", &audio.path]);
    }
    let mut filter = String::new();
    for (index, clip) in clips.iter().enumerate() {
        let setpts = if clip.kind == "video" && (clip.rate - 1.0).abs() > 0.001 {
            format!(",setpts=PTS/{}", clip.rate.max(0.01))
        } else {
            String::new()
        };
        let blur = if clip.blur > 0.0 {
            format!(",gblur=sigma={}", clip.blur.min(100.0))
        } else {
            String::new()
        };
        if background_blur > 0.0 && clip.kind != "blank" {
            filter.push_str(&format!("[{index}:v]split=2[bgraw{index}][fgraw{index}];[bgraw{index}]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},gblur=sigma={},fps={fps},setsar=1[bg{index}];[fgraw{index}]scale={width}:{height}:force_original_aspect_ratio=decrease,format=rgba{blur}[fg{index}];[bg{index}][fg{index}]overlay=(W-w)/2:(H-h)/2,format=yuv420p{setpts}[v{index}];", background_blur.min(100.0)));
        } else {
            filter.push_str(&format!("[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color={background_color},fps={fps},setsar=1,format=yuv420p{blur}{setpts}[v{index}];"));
        }
    }
    for index in 0..clips.len() {
        filter.push_str(&format!("[v{index}]"));
    }
    filter.push_str(&format!("concat=n={}:v=1:a=0[outv]", clips.len()));
    let mut video_output = "outv".to_string();
    for (overlay_index, overlay) in overlays.iter().enumerate() {
        let input_index = clips.len() + overlay_index;
        let overlay_width = ((overlay.source_width as f64) * overlay.scale_x.abs())
            .round()
            .max(2.0) as u32;
        let overlay_height = ((overlay.source_height as f64) * overlay.scale_y.abs())
            .round()
            .max(2.0) as u32;
        let next_output = format!("outv{}", overlay_index + 1);
        let rotation = if overlay.rotation.abs() > 0.001 {
            format!(
                ",rotate={}/180*PI:ow=rotw({}/180*PI):oh=roth({}/180*PI):c=none",
                overlay.rotation, overlay.rotation, overlay.rotation
            )
        } else {
            String::new()
        };
        let blur = if overlay.blur > 0.0 {
            format!(",gblur=sigma={}", overlay.blur.min(100.0))
        } else {
            String::new()
        };
        filter.push_str(&format!(";[{input_index}:v]scale={overlay_width}:{overlay_height},format=rgba{rotation}{blur},colorchannelmixer=aa={},setpts=PTS-STARTPTS+{}/TB[ov{overlay_index}];[{}][ov{overlay_index}]overlay=x=(W-w)/2+{}:y=(H-h)/2+{}:enable='between(t,{},{})'[{}]", overlay.opacity.clamp(0.0, 1.0), overlay.start, video_output, overlay.position_x, overlay.position_y, overlay.start, overlay.start + overlay.duration, next_output));
        video_output = next_output;
    }
    for (text_index, text) in texts.iter().enumerate() {
        let next_output = format!("outt{}", text_index + 1);
        let content = escape_drawtext(&text.content);
        let color = text.color.trim_start_matches('#');
        let font_file = windows_font_path(&text.font_family, text.bold, text.italic)
            .to_string_lossy()
            .replace('\\', "/")
            .replace(':', "\\:");
        let _rotation = text.rotation;
        let background = if text.background_enabled {
            format!(
                ":box=1:boxcolor={}@{}:boxborderw={}",
                text.background_color,
                text.opacity.clamp(0.0, 1.0),
                text.background_padding.max(0.0)
            )
        } else {
            String::new()
        };
        filter.push_str(&format!(";[{}]drawtext=fontfile='{}':text='{}':fontsize={}:fontcolor=#{}@{}{}:x=(w-text_w)/2+{}:y=(h-text_h)/2+{}:enable='between(t,{},{})'[{}]", video_output, font_file, content, text.font_size.max(1.0), color, text.opacity.clamp(0.0, 1.0), background, text.position_x, text.position_y, text.start, text.start + text.duration, next_output));
        video_output = next_output;
    }
    if !audios.is_empty() {
        filter.push(';');
        for (audio_index, audio) in audios.iter().enumerate() {
            let input_index = clips.len() + overlays.len() + audio_index;
            let delay = (audio.start.max(0.0) * 1000.0).round() as u64;
            filter.push_str(&format!("[{input_index}:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS,adelay={delay}|{delay},volume={}[a{audio_index}];", audio.trim_start, audio.duration, audio.volume));
        }
        for index in 0..audios.len() {
            filter.push_str(&format!("[a{index}]"));
        }
        filter.push_str(&format!("amix=inputs={}:normalize=0[outa]", audios.len()));
    }
    let video_encoder = if format == "webm" {
        "libvpx-vp9"
    } else {
        match encoder.as_str() {
            "nvidia" => "h264_nvenc",
            "intel" => "h264_qsv",
            "amd" => "h264_amf",
            _ => "libx264",
        }
    };
    command.args([
        "-filter_complex",
        &filter,
        "-map",
        &format!("[{video_output}]"),
    ]);
    if !audios.is_empty() {
        command.args([
            "-map",
            "[outa]",
            "-c:a",
            if format == "webm" { "libopus" } else { "aac" },
            "-b:a",
            "192k",
        ]);
    }
    command.args(["-c:v", video_encoder]);
    let quality_value = match quality.as_str() {
        "low" => "32",
        "medium" => "26",
        "very_high" => "18",
        _ => "22",
    };
    match video_encoder {
        "libvpx-vp9" => {
            command.args(["-crf", quality_value, "-b:v", "0", "-row-mt", "1"]);
        }
        "h264_nvenc" => {
            command.args(["-preset", "p4", "-cq", quality_value]);
        }
        "h264_qsv" => {
            command.args(["-preset", "medium", "-global_quality", quality_value]);
        }
        "h264_amf" => {
            command.args([
                "-quality",
                "balanced",
                "-qp_i",
                quality_value,
                "-qp_p",
                quality_value,
            ]);
        }
        _ => {
            command.args(["-preset", "medium", "-crf", quality_value]);
        }
    }
    if format != "webm" {
        command.args(["-movflags", "+faststart"]);
    }
    command.args(["-progress", "pipe:1", "-nostats", &output_path]);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stderr = child.stderr.take();
    let stderr_thread = thread::spawn(move || {
        let mut message = String::new();
        if let Some(mut stream) = stderr {
            let _ = stream.read_to_string(&mut message);
        }
        message
    });
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if CANCEL_NATIVE_RENDER.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stderr_thread.join();
                let _ = fs::remove_file(&output_path);
                return Err("Đã hủy xuất video.".into());
            }
            if let Some(value) = line.strip_prefix("out_time_ms=") {
                if let Ok(microseconds) = value.parse::<f64>() {
                    let progress =
                        (microseconds / 1_000_000.0 / total_duration.max(0.001)).clamp(0.0, 1.0);
                    let _ = window.emit("native-export-progress", progress);
                }
            }
        }
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    let stderr_message = stderr_thread.join().unwrap_or_default();
    if !status.success() {
        return Err(stderr_message);
    }
    let _ = window.emit("native-export-progress", 1.0_f64);
    Ok(output_path)
}

#[tauri::command]
fn cancel_native_timeline() {
    CANCEL_NATIVE_RENDER.store(true, Ordering::SeqCst);
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
    let mut frontend_process = start_frontend_server()
        .unwrap_or_else(|error| panic!("Không thể khởi động giao diện HovaCut: {error}"));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_media_files,
            save_project_json,
            load_project_json,
            list_project_jsons,
            delete_project_json,
            save_media_metadata,
            load_media_metadata,
            list_media_metadata,
            delete_media_metadata,
            clear_media_metadata,
            import_project_json,
            export_project_json,
            detect_video_encoders,
            render_native_timeline,
            cancel_native_timeline,
            render_auto_video,
            render_auto_mp3,
            render_join_audio,
            convert_media,
            render_image_audio
        ])
        .run(tauri::generate_context!())
        .expect("Không thể khởi động HovaCut Desktop");
    if let Some(process) = frontend_process.as_mut() {
        let _ = process.kill();
        let _ = process.wait();
    }
}
