use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

static CANCEL_NATIVE_RENDER: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeMediaInfo {
    name: String,
    media_type: String,
    size: u64,
    last_modified: u64,
    duration: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f64>,
    has_audio: bool,
}

#[tauri::command]
fn inspect_media_file(path: String) -> Result<NativeMediaInfo, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("File media không tồn tại.".into());
    }
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let media_type = match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" => "image",
        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" | "opus" => "audio",
        _ => "video",
    };
    let output = Command::new(ffmpeg_path())
        .args(["-hide_banner", "-i", &path])
        .output()
        .map_err(|error| error.to_string())?;
    let details = String::from_utf8_lossy(&output.stderr);
    let duration = Regex::new(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
        .ok()
        .and_then(|pattern| pattern.captures(&details))
        .and_then(|capture| {
            let hours = capture.get(1)?.as_str().parse::<f64>().ok()?;
            let minutes = capture.get(2)?.as_str().parse::<f64>().ok()?;
            let seconds = capture.get(3)?.as_str().parse::<f64>().ok()?;
            Some(hours * 3600.0 + minutes * 60.0 + seconds)
        });
    let dimensions = Regex::new(r"(?m)Stream[^\r\n]*Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b")
        .ok()
        .and_then(|pattern| pattern.captures(&details))
        .and_then(|capture| {
            Some((
                capture.get(1)?.as_str().parse::<u32>().ok()?,
                capture.get(2)?.as_str().parse::<u32>().ok()?,
            ))
        });
    let fps = Regex::new(r"(?:,|\s)(\d+(?:\.\d+)?)\s+fps(?:,|\s)")
        .ok()
        .and_then(|pattern| pattern.captures(&details))
        .and_then(|capture| capture.get(1)?.as_str().parse::<f64>().ok());
    let last_modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default();
    Ok(NativeMediaInfo {
        name: source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("media")
            .to_owned(),
        media_type: media_type.to_owned(),
        size: metadata.len(),
        last_modified,
        duration,
        width: dimensions.map(|value| value.0),
        height: dimensions.map(|value| value.1),
        fps,
        has_audio: details
            .lines()
            .any(|line| line.contains("Stream") && line.contains("Audio:")),
    })
}

#[tauri::command]
fn read_media_range(path: String, start: u64, end: u64) -> Result<Vec<u8>, String> {
    if end < start {
        return Err("Khoảng đọc media không hợp lệ.".into());
    }
    // Keep IPC payloads bounded even if a malformed caller requests the whole file.
    const MAX_CHUNK_SIZE: u64 = 16 * 1024 * 1024;
    if end - start > MAX_CHUNK_SIZE {
        return Err("Đoạn media yêu cầu vượt quá 16 MB.".into());
    }
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("File media không tồn tại.".into());
    }
    let size = fs::metadata(&source)
        .map_err(|error| error.to_string())?
        .len();
    if start >= size {
        return Ok(Vec::new());
    }
    let read_end = end.min(size);
    let mut file = fs::File::open(source).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    let mut data = vec![0; (read_end - start) as usize];
    file.read_exact(&mut data)
        .map_err(|error| error.to_string())?;
    Ok(data)
}

#[tauri::command]
fn save_export_file(output_path: String, data: Vec<u8>) -> Result<String, String> {
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        if !parent.is_dir() {
            return Err("Thư mục xuất không tồn tại.".into());
        }
    }
    fs::write(&output, data).map_err(|error| error.to_string())?;
    Ok(output_path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractFramesResult {
    directory: String,
    count: usize,
}

fn extract_video_frames_blocking(
    input_path: String,
    output_directory: String,
    interval_seconds: f64,
    format: String,
) -> Result<ExtractFramesResult, String> {
    if !Path::new(&input_path).is_file() {
        return Err("Video nguồn không tồn tại.".into());
    }
    let extension = if format.eq_ignore_ascii_case("png") {
        "png"
    } else {
        "jpg"
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let directory = PathBuf::from(output_directory).join(format!("frames-{stamp}"));
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let pattern = directory.join(format!("frame_%06d.{extension}"));
    let interval = interval_seconds.clamp(0.1, 3600.0);
    let mut command = Command::new(ffmpeg_path());
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        &input_path,
        "-vf",
        &format!("fps=1/{interval}"),
        "-start_number",
        "1",
    ]);
    if extension == "jpg" {
        command.args(["-q:v", "2"]);
    }
    let output = command
        .arg(&pattern)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let _ = fs::remove_dir_all(&directory);
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let count = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .count();
    Ok(ExtractFramesResult {
        directory: directory.to_string_lossy().into_owned(),
        count,
    })
}

fn join_video_files_blocking(
    video_paths: Vec<String>,
    output_path: String,
    resolution: String,
    encoder: String,
) -> Result<String, String> {
    if video_paths.len() < 2 || video_paths.iter().any(|path| !Path::new(path).is_file()) {
        return Err("Cần ít nhất hai video nguồn hợp lệ.".into());
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
    let list_path = env::temp_dir().join(format!("hovacut-join-video-{stamp}.txt"));
    let list = video_paths
        .iter()
        .map(|value| format!("file '{}'", value.replace('\\', "/").replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&list_path, list).map_err(|error| error.to_string())?;
    let video_encoder = resolve_h264_encoder(&encoder);
    let filter = format!("scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p");
    let mut command = Command::new(ffmpeg_path());
    command
        .args(["-y", "-f", "concat", "-safe", "0", "-i"])
        .arg(&list_path)
        .args(["-vf", &filter, "-c:v", video_encoder]);
    match video_encoder {
        "h264_nvenc" => {
            command.args(["-preset", "slow", "-rc", "vbr", "-cq", "20", "-b:v", "0"]);
        }
        "h264_qsv" => {
            command.args(["-preset", "medium", "-global_quality", "20"]);
        }
        "h264_amf" => {
            command.args([
                "-quality", "quality", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-qp_b", "24",
            ]);
        }
        _ => {
            command.args(["-preset", "medium", "-crf", "20"]);
        }
    }
    let result = command
        .args([
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            &output_path,
        ])
        .output()
        .map_err(|error| error.to_string());
    let _ = fs::remove_file(list_path);
    let output = result?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(output_path)
}

fn render_lofi_video_blocking(
    background_path: String,
    audio_path: String,
    effect_path: Option<String>,
    logo_path: Option<String>,
    output_path: String,
    resolution: String,
    encoder: String,
) -> Result<String, String> {
    if !Path::new(&background_path).is_file() || !Path::new(&audio_path).is_file() {
        return Err("Ảnh/video nền hoặc audio không tồn tại.".into());
    }
    let effect_path = effect_path.filter(|path| Path::new(path).is_file());
    let logo_path = logo_path.filter(|path| Path::new(path).is_file());
    let (width, height) = if resolution == "4k" {
        (3840, 2160)
    } else {
        (1920, 1080)
    };
    let background_extension = Path::new(&background_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let background_is_image = matches!(
        background_extension.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "bmp"
    );
    let mut command = Command::new(ffmpeg_path());
    command.arg("-y");
    if background_is_image {
        command.args(["-loop", "1"]);
    } else {
        command.args(["-stream_loop", "-1"]);
    }
    command.args(["-i", &background_path]);
    let mut next_input = 1usize;
    let effect_index = effect_path.as_ref().map(|path| {
        let index = next_input;
        next_input += 1;
        command.args(["-stream_loop", "-1", "-i", path]);
        index
    });
    let logo_index = logo_path.as_ref().map(|path| {
        let index = next_input;
        next_input += 1;
        command.args(["-stream_loop", "-1", "-i", path]);
        index
    });
    let audio_index = next_input;
    command.args(["-i", &audio_path]);
    let mut filter = format!("[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[base]");
    let mut current = "base".to_owned();
    if let Some(index) = effect_index {
        filter.push_str(&format!(";[{index}:v]scale={width}:{height},fps=30,setsar=1,format=yuv420p[effect];[{current}][effect]blend=all_mode=screen:shortest=1[with_effect]"));
        current = "with_effect".into();
    }
    if let Some(index) = logo_index {
        filter.push_str(&format!(";[{index}:v]scale={width}:{height},fps=30,format=rgba[logo];[{current}][logo]overlay=0:0:shortest=1[with_logo]"));
        current = "with_logo".into();
    }
    command.args([
        "-filter_complex",
        &filter,
        "-map",
        &format!("[{current}]"),
        "-map",
        &format!("{audio_index}:a:0"),
    ]);
    let video_encoder = resolve_h264_encoder(&encoder);
    command.args(["-c:v", video_encoder]);
    match video_encoder {
        "h264_nvenc" => {
            command.args(["-preset", "slow", "-rc", "vbr", "-cq", "20", "-b:v", "0"]);
        }
        "h264_qsv" => {
            command.args(["-preset", "medium", "-global_quality", "20"]);
        }
        "h264_amf" => {
            command.args([
                "-quality", "quality", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-qp_b", "24",
            ]);
        }
        _ => {
            command.args(["-preset", "medium", "-crf", "20"]);
        }
    }
    let output = command
        .args([
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
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

#[tauri::command]
fn create_file_list(
    directory: String,
    output_path: String,
    include_extension: bool,
    shuffle: bool,
) -> Result<usize, String> {
    let root = PathBuf::from(directory);
    if !root.is_dir() {
        return Err("Thư mục nguồn không tồn tại.".into());
    }
    let mut values = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter_map(|path| {
            if include_extension {
                path.file_name()?.to_str().map(str::to_owned)
            } else {
                path.file_stem()?.to_str().map(str::to_owned)
            }
        })
        .collect::<Vec<_>>();
    values.sort_by_key(|value| value.to_ascii_lowercase());
    if shuffle {
        values = shuffled(values);
    }
    let content = if values.is_empty() {
        String::new()
    } else {
        format!("{}\n", values.join("\n"))
    };
    fs::write(output_path, content.as_bytes()).map_err(|error| error.to_string())?;
    Ok(values.len())
}

#[tauri::command]
fn shuffle_text_file(input_path: String, output_path: String) -> Result<usize, String> {
    if !Path::new(&input_path).is_file() {
        return Err("File TXT nguồn không tồn tại.".into());
    }
    let content = fs::read_to_string(input_path).map_err(|error| error.to_string())?;
    let values = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let values = shuffled(values);
    let result = if values.is_empty() {
        String::new()
    } else {
        format!("{}\n", values.join("\n"))
    };
    fs::write(output_path, result.as_bytes()).map_err(|error| error.to_string())?;
    Ok(values.len())
}

fn freesound_api_key() -> Result<String, String> {
    let path = application_data_directory()?.join("settings.json");
    if path.is_file() {
        let data: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if let Some(value) = data.get("freesoundApiKey").and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return Ok(value.trim().to_owned());
            }
        }
    }
    option_env!("HOVACUT_FREESOUND_API_KEY")
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Chưa cấu hình Freesound API Key trong HovaCut.".to_string())
}

#[tauri::command]
fn save_freesound_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.len() < 20 || !api_key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Freesound API Key không hợp lệ.".into());
    }
    let path = application_data_directory()?.join("settings.json");
    let mut data = if path.is_file() {
        serde_json::from_slice::<Value>(&fs::read(&path).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    data["freesoundApiKey"] = Value::String(api_key.to_owned());
    fs::write(
        path,
        serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct FreesoundSearchResult {
    id: u64,
    name: String,
    #[serde(default)]
    description: String,
    url: String,
    previews: Option<Value>,
    download: Option<String>,
    duration: f64,
    filesize: u64,
    #[serde(rename = "type")]
    media_type: String,
    channels: u32,
    bitrate: u32,
    bitdepth: u32,
    samplerate: f64,
    username: String,
    tags: Vec<String>,
    license: String,
    created: String,
    #[serde(default)]
    num_downloads: u64,
    #[serde(default)]
    avg_rating: f64,
    #[serde(default)]
    num_ratings: u64,
}

#[derive(Deserialize)]
struct FreesoundSearchResponse {
    count: u64,
    next: Option<String>,
    previous: Option<String>,
    results: Vec<FreesoundSearchResult>,
}

#[tauri::command]
fn search_sounds(
    query: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
    sort: Option<String>,
    min_rating: Option<f64>,
    commercial_only: Option<bool>,
) -> Result<Value, String> {
    let token = freesound_api_key()?;
    let query = query.unwrap_or_default();
    if query.len() > 500 {
        return Err("Từ khóa tìm kiếm quá dài.".into());
    }
    let page = page.unwrap_or(1).clamp(1, 1000);
    let page_size = page_size.unwrap_or(20).clamp(1, 150);
    let sort = sort.unwrap_or_else(|| "downloads".into());
    let sort = match sort.as_str() {
        "rating" | "created" | "score" => sort,
        _ => "downloads".into(),
    };
    let sort_parameter = if query.is_empty() {
        format!("{sort}_desc")
    } else if sort == "score" {
        "score".into()
    } else {
        format!("{sort}_desc")
    };
    let mut url = reqwest::Url::parse("https://freesound.org/apiv2/search/text/")
        .map_err(|error| error.to_string())?;
    {
        let mut params = url.query_pairs_mut();
        params
            .append_pair("query", &query)
            .append_pair("token", &token)
            .append_pair("page", &page.to_string())
            .append_pair("page_size", &page_size.to_string())
            .append_pair("sort", &sort_parameter)
            .append_pair("fields", "id,name,description,url,previews,download,duration,filesize,type,channels,bitrate,bitdepth,samplerate,username,tags,license,created,num_downloads,avg_rating,num_ratings")
            .append_pair("filter", "duration:[* TO 30.0]")
            .append_pair(
                "filter",
                &format!("avg_rating:[{} TO *]", min_rating.unwrap_or(3.0).clamp(0.0, 5.0)),
            )
            .append_pair("filter", "tag:sound-effect OR tag:sfx OR tag:foley OR tag:ambient OR tag:nature OR tag:mechanical OR tag:electronic OR tag:impact OR tag:whoosh OR tag:explosion");
        if commercial_only.unwrap_or(true) {
            params.append_pair("filter", "license:(\"Attribution\" OR \"Creative Commons 0\" OR \"Attribution Noncommercial\" OR \"Attribution Commercial\")");
        }
    }
    let response = reqwest::blocking::Client::builder()
        .user_agent("HovaCut Desktop/0.1")
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .map_err(|error| format!("Không thể kết nối Freesound: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Freesound trả về lỗi HTTP {status}."));
    }
    let data: FreesoundSearchResponse = response
        .json()
        .map_err(|error| format!("Dữ liệu Freesound không hợp lệ: {error}"))?;
    let results: Vec<Value> = data
        .results
        .into_iter()
        .map(|sound| {
            let preview_url = sound.previews.as_ref().and_then(|previews| {
                previews
                    .get("preview-hq-mp3")
                    .or_else(|| previews.get("preview-lq-mp3"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
            serde_json::json!({
                "id": sound.id, "name": sound.name, "description": sound.description,
                "url": sound.url, "previewUrl": preview_url, "downloadUrl": sound.download,
                "duration": sound.duration, "filesize": sound.filesize, "type": sound.media_type,
                "channels": sound.channels, "bitrate": sound.bitrate, "bitdepth": sound.bitdepth,
                "samplerate": sound.samplerate, "username": sound.username, "tags": sound.tags,
                "license": sound.license, "created": sound.created, "downloads": sound.num_downloads,
                "rating": sound.avg_rating, "ratingCount": sound.num_ratings
            })
        })
        .collect();
    Ok(serde_json::json!({
        "count": data.count, "next": data.next, "previous": data.previous,
        "results": results, "query": query, "type": "effects", "page": page,
        "pageSize": page_size, "sort": sort, "minRating": min_rating.unwrap_or(3.0)
    }))
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

fn application_data_directory() -> Result<PathBuf, String> {
    let root = env::var("APPDATA").map_err(|_| "Không tìm thấy thư mục AppData.".to_string())?;
    let directory = PathBuf::from(root).join("HovaCut");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

#[tauri::command]
fn load_saved_sounds_json() -> Result<Option<Value>, String> {
    let path = application_data_directory()?.join("saved-sounds.json");
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&content)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_saved_sounds_json(data: Value) -> Result<(), String> {
    let path = application_data_directory()?.join("saved-sounds.json");
    let content = serde_json::to_vec_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_saved_sounds_json() -> Result<(), String> {
    let path = application_data_directory()?.join("saved-sounds.json");
    if path.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
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

fn media_file_path(project_id: &str, media_id: &str) -> Result<PathBuf, String> {
    validate_storage_id(project_id)?;
    validate_storage_id(media_id)?;
    let directory = application_data_directory()?.join("media").join(project_id);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(format!("{media_id}.bin")))
}

#[tauri::command]
fn save_media_file(project_id: String, media_id: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(media_file_path(&project_id, &media_id)?, data).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_media_file(project_id: String, media_id: String) -> Result<Option<Vec<u8>>, String> {
    let path = media_file_path(&project_id, &media_id)?;
    if !path.is_file() {
        return Ok(None);
    }
    fs::read(path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_media_file(project_id: String, media_id: String) -> Result<(), String> {
    let path = media_file_path(&project_id, &media_id)?;
    if path.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn clear_project_media_files(project_id: String) -> Result<(), String> {
    validate_storage_id(&project_id)?;
    let directory = application_data_directory()?.join("media").join(project_id);
    if directory.is_dir() {
        fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
    }
    Ok(())
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
    clear_project_media_files(project_id)?;
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

#[derive(Serialize)]
struct NativeFfmpegStatus {
    enabled: bool,
    available: bool,
    path: String,
    version: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn get_ffmpeg_status() -> NativeFfmpegStatus {
    let path = ffmpeg_path();
    match Command::new(&path).arg("-version").output() {
        Ok(output) if output.status.success() => NativeFfmpegStatus {
            enabled: true,
            available: true,
            path: path.to_string_lossy().into_owned(),
            version: String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(str::to_owned),
            error: None,
        },
        Ok(output) => NativeFfmpegStatus {
            enabled: true,
            available: false,
            path: path.to_string_lossy().into_owned(),
            version: None,
            error: Some(String::from_utf8_lossy(&output.stderr).into_owned()),
        },
        Err(error) => NativeFfmpegStatus {
            enabled: true,
            available: false,
            path: path.to_string_lossy().into_owned(),
            version: None,
            error: Some(error.to_string()),
        },
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
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let output_path = env::temp_dir().join(format!("hovacut-encoder-{encoder}-{stamp}.mp4"));
    let available = Command::new(ffmpeg_path())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=s=256x256:r=30:d=0.25",
            "-frames:v",
            "4",
            "-c:v",
            encoder,
        ])
        .arg(&output_path)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let valid_output = fs::metadata(&output_path)
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false);
    let _ = fs::remove_file(output_path);
    available && valid_output
}

fn resolve_h264_encoder(requested: &str) -> &'static str {
    let hardware = match requested {
        "nvidia" => Some("h264_nvenc"),
        "intel" => Some("h264_qsv"),
        "amd" => Some("h264_amf"),
        _ => None,
    };
    hardware
        .filter(|encoder| encoder_available(encoder))
        .unwrap_or("libx264")
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
        resolve_h264_encoder(&encoder)
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

fn render_auto_video_blocking(
    audio_path: String,
    video_paths: Vec<String>,
    logo_path: Option<String>,
    logo_mode: Option<String>,
    logo_position: Option<String>,
    logo_width_percent: Option<f64>,
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
    let logo_path = logo_path.filter(|value| Path::new(value).is_file());
    let filter = format!("scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p");
    let video_encoder = resolve_h264_encoder(&encoder);
    let mut command = Command::new(ffmpeg_path());
    command
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
        .arg(&list_path);
    let audio_index = if let Some(path) = &logo_path {
        let extension = Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp") {
            command.args(["-loop", "1", "-i", path]);
        } else {
            command.args(["-stream_loop", "-1", "-i", path]);
        }
        2
    } else {
        1
    };
    command.args(["-i", &audio_path]);
    if logo_path.is_some() {
        let logo_filter = if logo_mode.as_deref() == Some("full") {
            format!("[0:v]{filter}[base];[1:v]scale={width}:{height},fps=30,format=rgba[logo];[base][logo]overlay=0:0:shortest=1[outv]")
        } else {
            let logo_width = ((width as f64)
                * (logo_width_percent.unwrap_or(18.0).clamp(5.0, 80.0) / 100.0))
                .round() as u32;
            let (x, y) = match logo_position.as_deref() {
                Some("top-left") => ("24", "24"),
                Some("bottom-left") => ("24", "H-h-24"),
                Some("bottom-right") => ("W-w-24", "H-h-24"),
                Some("center") => ("(W-w)/2", "(H-h)/2"),
                _ => ("W-w-24", "24"),
            };
            format!("[0:v]{filter}[base];[1:v]scale={logo_width}:-1,fps=30,format=rgba[logo];[base][logo]overlay={x}:{y}:shortest=1[outv]")
        };
        command.args([
            "-filter_complex",
            &logo_filter,
            "-map",
            "[outv]",
            "-map",
            &format!("{audio_index}:a:0"),
        ]);
    } else {
        command.args([
            "-map",
            "0:v:0",
            "-map",
            &format!("{audio_index}:a:0"),
            "-vf",
            &filter,
        ]);
    }
    command.args(["-c:v", video_encoder]);
    match video_encoder {
        "h264_nvenc" => {
            command.args(["-preset", "slow", "-rc", "vbr", "-cq", "20", "-b:v", "0"]);
        }
        "h264_qsv" => {
            command.args(["-preset", "medium", "-global_quality", "20"]);
        }
        "h264_amf" => {
            command.args([
                "-quality", "quality", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-qp_b", "24",
            ]);
        }
        _ => {
            command.args(["-preset", "medium", "-crf", "20"]);
        }
    }
    let result = command
        .args([
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

#[tauri::command]
async fn render_auto_video(
    audio_path: String,
    video_paths: Vec<String>,
    logo_path: Option<String>,
    logo_mode: Option<String>,
    logo_position: Option<String>,
    logo_width_percent: Option<f64>,
    output_path: String,
    resolution: String,
    encoder: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        render_auto_video_blocking(
            audio_path,
            video_paths,
            logo_path,
            logo_mode,
            logo_position,
            logo_width_percent,
            output_path,
            resolution,
            encoder,
        )
    })
    .await
    .map_err(|error| format!("Worker Auto Video bị dừng: {error}"))?
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

fn render_auto_mp3_blocking(
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

fn render_join_audio_blocking(
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

fn convert_media_blocking(
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

fn render_image_audio_blocking(
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

#[tauri::command]
async fn extract_video_frames(
    input_path: String,
    output_directory: String,
    interval_seconds: f64,
    format: String,
) -> Result<ExtractFramesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        extract_video_frames_blocking(input_path, output_directory, interval_seconds, format)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn join_video_files(
    video_paths: Vec<String>,
    output_path: String,
    resolution: String,
    encoder: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        join_video_files_blocking(video_paths, output_path, resolution, encoder)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_lofi_video(
    background_path: String,
    audio_path: String,
    effect_path: Option<String>,
    logo_path: Option<String>,
    output_path: String,
    resolution: String,
    encoder: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        render_lofi_video_blocking(
            background_path,
            audio_path,
            effect_path,
            logo_path,
            output_path,
            resolution,
            encoder,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_auto_mp3(
    good_paths: Vec<String>,
    other_paths: Vec<String>,
    good_count: usize,
    other_count: usize,
    output_count: usize,
    output_directory: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        render_auto_mp3_blocking(
            good_paths,
            other_paths,
            good_count,
            other_count,
            output_count,
            output_directory,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_join_audio(
    audio_paths: Vec<String>,
    output_path: String,
    export_tracks: bool,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        render_join_audio_blocking(audio_paths, output_path, export_tracks)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn convert_media(
    input_path: String,
    output_path: String,
    format: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_media_blocking(input_path, output_path, format)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_image_audio(
    image_path: String,
    audio_path: String,
    output_path: String,
    resolution: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        render_image_audio_blocking(image_path, audio_path, output_path, resolution)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
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
            save_media_file,
            load_media_file,
            delete_media_file,
            clear_project_media_files,
            load_saved_sounds_json,
            save_saved_sounds_json,
            clear_saved_sounds_json,
            import_project_json,
            export_project_json,
            get_ffmpeg_status,
            detect_video_encoders,
            render_native_timeline,
            cancel_native_timeline,
            render_auto_video,
            render_auto_mp3,
            render_join_audio,
            convert_media,
            render_image_audio,
            search_sounds,
            save_freesound_api_key,
            inspect_media_file,
            read_media_range,
            save_export_file,
            extract_video_frames,
            join_video_files,
            render_lofi_video,
            create_file_list,
            shuffle_text_file
        ])
        .run(tauri::generate_context!())
        .expect("Không thể khởi động HovaCut Desktop");
}
