use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use std::path::{Path, PathBuf};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Default, Clone)]
struct AppConfig {
    #[serde(default)]
    custom_css: String,
    #[serde(default)]
    fullscreen: bool,
    #[serde(default = "default_true")]
    discord_rpc: bool,
}

fn default_true() -> bool { true }

fn save_config(app_handle: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let config_dir = app_handle.path().app_config_dir().map_err(|e| e.to_string())?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    let config_path = config_dir.join("dawn_config.json");
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_config_internal(app_handle: &tauri::AppHandle) -> AppConfig {
     let config_dir = app_handle.path().app_config_dir().unwrap_or_default();
    let config_path = config_dir.join("dawn_config.json");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(config_path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

#[tauri::command]
fn exit_app(state: tauri::State<'_, RpcState>) {
    if let Ok(sender) = state.sender.lock() {
        let _ = sender.send(RpcCmd::Disconnect);
    }
    std::thread::sleep(std::time::Duration::from_millis(100));
    std::process::exit(0);
}

#[tauri::command]
fn save_css(app_handle: tauri::AppHandle, css: String) -> Result<(), String> {
    let mut config = load_config_internal(&app_handle);
    config.custom_css = css;
    save_config(&app_handle, &config)
}

#[tauri::command]
fn convert_file_to_base64(path: String) -> Result<String, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }
    
    let content = fs::read(&file_path).map_err(|e| e.to_string())?;
    let extension = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    
    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "css" => "text/css",
        _ => "application/octet-stream",
    };

    use base64::{Engine as _, engine::general_purpose};
    let b64 = general_purpose::STANDARD.encode(content);
    
    Ok(format!("data:{};base64,{}", mime_type, b64))
}

#[tauri::command]
fn read_file_binary(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_fullscreen(app_handle: tauri::AppHandle, window: tauri::Window) -> Result<(), String> {
    let mut config = load_config_internal(&app_handle);
    config.fullscreen = !config.fullscreen; 
    window.set_fullscreen(config.fullscreen).map_err(|e| e.to_string())?;
    save_config(&app_handle, &config)
}

#[tauri::command]
fn open_devtools(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Window 'main' not found")?;

    window.open_devtools();

    Ok(())
}

#[derive(Serialize, Clone)]
struct GalleryFile {
    name: String,
    path: String,
    is_image: bool,
}

#[derive(Serialize, Clone)]
struct GalleryCategory {
    name: String,
    path: String,
    files: Vec<GalleryFile>,
}

#[tauri::command]
fn get_gallery(app_handle: tauri::AppHandle) -> Result<Vec<GalleryCategory>, String> {
    let gallery_path = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("DawnClient")
        .join("gallery");
    
    if !gallery_path.exists() {
        fs::create_dir_all(&gallery_path).map_err(|e| e.to_string())?;
    }
    
    let mut categories = Vec::new();
    let mut root_files = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&gallery_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_name().and_then(|n| n.to_str()) == Some(".DS_Store") {
                continue;
            }
            if path.is_dir() {
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                
                let mut files = Vec::new();
                if let Ok(file_entries) = fs::read_dir(&path) {
                    for file_entry in file_entries.flatten() {
                        let file_path = file_entry.path();
                        if file_path.file_name().and_then(|n| n.to_str()) == Some(".DS_Store") {
                            continue;
                        }
                        if file_path.is_file() {
                            let file_name = file_path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("Unknown")
                                .to_string();
                            let ext = file_path.extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_lowercase();
                            let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp");
                            
                            files.push(GalleryFile {
                                name: file_name,
                                path: file_path.to_string_lossy().to_string(),
                                is_image,
                            });
                        }
                    }
                }
                
                categories.push(GalleryCategory {
                    name,
                    path: path.to_string_lossy().to_string(),
                    files,
                });
            } else if path.is_file() {
                let file_name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let ext = path.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp");
                
                root_files.push(GalleryFile {
                    name: file_name,
                    path: path.to_string_lossy().to_string(),
                    is_image,
                });
            }
        }
    }
    
    if !root_files.is_empty() {
        categories.insert(0, GalleryCategory {
            name: "Root".to_string(),
            path: gallery_path.to_string_lossy().to_string(),
            files: root_files,
        });
    }
    
    Ok(categories)
}

#[tauri::command]
fn open_gallery_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_gallery_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_gallery_file(old_path: String, new_name: String) -> Result<String, String> {
    let old = PathBuf::from(&old_path);
    let parent = old.parent().ok_or("Invalid path")?;
    let new_path = parent.join(&new_name);
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_gallery_file_preview(path: String) -> Result<String, String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }
    
    let content = fs::read(&file_path).map_err(|e| e.to_string())?;
    let extension = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    
    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };

    use base64::{Engine as _, engine::general_purpose};
    let b64 = general_purpose::STANDARD.encode(content);
    
    Ok(format!("data:{};base64,{}", mime_type, b64))
}

#[tauri::command]
fn save_skin(app_handle: tauri::AppHandle, skin_name: String, data: Vec<u8>) -> Result<(), String> {
    let swapper_path = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("DawnClient")
        .join("swapper")
        .join("assets")
        .join("img");
    
    if !swapper_path.exists() {
        fs::create_dir_all(&swapper_path).map_err(|e| e.to_string())?;
    }
    
    let file_path = swapper_path.join(&skin_name);
    fs::write(file_path, data).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn save_sound(app_handle: tauri::AppHandle, sound_name: String, data: Vec<u8>) -> Result<(), String> {
    let swapper_path = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("DawnClient")
        .join("swapper")
        .join("assets")
        .join("media");
    
    if !swapper_path.exists() {
        fs::create_dir_all(&swapper_path).map_err(|e| e.to_string())?;
    }
    
    let file_path = swapper_path.join(&sound_name);
    fs::write(file_path, data).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn open_swapper_folder(app_handle: tauri::AppHandle, folder_type: String) -> Result<(), String> {
    let base_path = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("DawnClient")
        .join("swapper")
        .join("assets");
    
    let folder_path = if folder_type == "skins" {
        base_path.join("img")
    } else if folder_type == "sounds" {
        base_path.join("media")
    } else {
        base_path
    };
    
    if !folder_path.exists() {
        fs::create_dir_all(&folder_path).map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
fn open_scripts_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let folder_path = app_handle.path().document_dir()
        .map_err(|e| e.to_string())?
        .join("DawnClient")
        .join("scripts");
    
    if !folder_path.exists() {
        fs::create_dir_all(&folder_path).map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}


use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread;

pub enum RpcCmd {
    Connect,
    Disconnect,
    UpdateActivity(String),
}

struct RpcState {
    sender: Mutex<mpsc::Sender<RpcCmd>>,
}

#[tauri::command]
fn set_discord_rpc_activity(state: tauri::State<'_, RpcState>, activity_state: String) -> Result<(), String> {
    let sender = state.sender.lock().map_err(|e| e.to_string())?;
    let _ = sender.send(RpcCmd::UpdateActivity(activity_state));
    Ok(())
}

#[tauri::command]
fn toggle_discord_rpc(app_handle: tauri::AppHandle, state: tauri::State<'_, RpcState>, enabled: bool) -> Result<(), String> {
    let mut config = load_config_internal(&app_handle);
    config.discord_rpc = enabled;
    save_config(&app_handle, &config)?;

    let sender = state.sender.lock().map_err(|e| e.to_string())?;
    if enabled {
        let _ = sender.send(RpcCmd::Connect);
    } else {
        let _ = sender.send(RpcCmd::Disconnect);
    }
    
    Ok(())
}

fn load_config(app: &tauri::App) -> AppConfig {
    load_config_internal(app.handle())
}

fn get_swap_map(base_path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let assets_path = base_path.join("swapper").join("assets");
    
    if !assets_path.exists() {
        return map;
    }
    
    fn scan_dir(dir: &Path, base: &Path, map: &mut HashMap<String, String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    scan_dir(&path, base, map);
                } else {
                    if let Ok(rel) = path.strip_prefix(base) {
                        let rel_str = rel.to_string_lossy().replace("\\", "/");
                        let rel_str_clean = rel_str.replace("_", "");
                        let url_key = format!("https://kirka.io/assets/{}", rel_str_clean);
                        
                        if let Ok(data) = fs::read(&path) {
                            let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                            let mime_type = match extension.to_lowercase().as_str() {
                                "webp" => "image/webp",
                                "css" => "text/css",
                                "mp3" => "audio/mpeg",
                                _ => "application/octet-stream" 
                            };

                            use base64::{Engine as _, engine::general_purpose};
                            let b64 = general_purpose::STANDARD.encode(data);
                            let data_uri = format!("data:{};base64,{}", mime_type, b64);
                            
                            map.insert(url_key, data_uri);
                        }
                    }
                }
            }
        }
    }

    scan_dir(&assets_path, &assets_path, &mut map);
    map
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let injection_script = include_str!("injection.js");
    let menu_html = include_str!("menu.html");
    let menu_css = include_str!("menu.css");
    
    let icon_bytes = include_bytes!("../icons/icon.png");
    use base64::{Engine as _, engine::general_purpose};
    let icon_b64 = general_purpose::STANDARD.encode(icon_bytes);
    let icon_data_uri = format!("data:image/png;base64,{}", icon_b64);
    
    let app_version = env!("CARGO_PKG_VERSION");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("dawn", |_app, request| {
            let uri = request.uri().path();
            let path_str = uri.strip_prefix('/').unwrap_or(uri);
            
            let base_path = match _app.app_handle().path().document_dir() {
                Ok(path) => path.join("DawnClient"),
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(500)
                        .body(Vec::new())
                        .unwrap()
                }
            };
            let file_path = base_path.join(path_str);
            
            if file_path.exists() && file_path.is_file() {
                let content = fs::read(&file_path).map_err(|_| ());
                match content {
                     Ok(data) => {
                         let extension = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                         let mime_type = match extension.to_lowercase().as_str() {
                             "png" => "image/png",
                             "jpg" | "jpeg" => "image/jpeg",
                             "webp" => "image/webp",
                             "gif" => "image/gif",
                             "css" => "text/css",
                             "js" | "mjs" => "application/javascript",
                             "mp3" => "audio/mpeg",
                             "wav" => "audio/wav",
                             "ogg" => "audio/ogg",
                             _ => "application/octet-stream" 
                         };

                        tauri::http::Response::builder()
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Content-Type", mime_type)
                            .body(data)
                            .unwrap()
                     },
                     Err(_) => {
                         tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap()
                     }
                }
            } else {
                 tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap()
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_css, 
            toggle_fullscreen, 
            open_devtools,
            convert_file_to_base64,
            set_discord_rpc_activity,
            toggle_discord_rpc,
            exit_app,
            get_gallery,
            open_gallery_folder,
            delete_gallery_file,
            rename_gallery_file,
            get_gallery_file_preview,
            read_text_file,
            read_file_binary,
            save_skin,
            save_sound,
            open_swapper_folder,
            open_scripts_folder
        ])
        .setup(move |app| {
            let config = load_config(app);
            
            let base_path = app.path().document_dir().unwrap().join("DawnClient");
            
            let dirs = [
                base_path.join("gallery"),
                base_path.join("scripts"),
                base_path.join("swapper").join("assets").join("img"),
                base_path.join("swapper").join("assets").join("media"),
            ];
            for dir in dirs {
                if !dir.exists() {
                    let _ = fs::create_dir_all(dir);
                }
            }

            let mut custom_scripts = String::new();
            let scripts_path = base_path.join("scripts");
            if let Ok(entries) = fs::read_dir(scripts_path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("js") {
                        if let Ok(content) = fs::read_to_string(path) {
                            let script_name = entry.file_name().to_string_lossy().into_owned();
                            let safe_name = script_name.replace(|c: char| !c.is_alphanumeric(), "_");
                            custom_scripts.push_str(&format!(
                                "\n// Custom Script: {}\n(function() {{ if (window['__DAWN_SCRIPT_{}__']) return; window['__DAWN_SCRIPT_{}__'] = true; \n{}\n }})();\n", 
                                script_name, safe_name, safe_name, content
                            ));
                        }
                    }
                }
            }

            let swap_map = get_swap_map(&base_path);
            let swap_data_json = serde_json::to_string(&swap_map).unwrap_or_else(|_| "{}".to_string());

            let final_script = format!(
                "(function() {{ \
                    if (window.self !== window.top) return; \
                    if (window.__DAWN_MASTER_INITIALIZED__) return; \
                    window.__DAWN_MASTER_INITIALIZED__ = true; \
                    const INJECTED_MENU_HTML = `{}`; \
                    const INJECTED_MENU_CSS = `{}`; \
                    const SAVED_CSS = `{}`; \
                    const DAWNSWAP_DATA = {}; \
                    const DAWN_ICON = '{}'; \
                    const DAWN_VERSION = '{}'; \
                    \n{}\n{}\n\
                }})();",
                menu_html, menu_css, config.custom_css.replace("`", "\\`"), swap_data_json, icon_data_uri, app_version, injection_script, custom_scripts
            );
            
            let builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("https://kirka.io".parse().unwrap())
            );

            let builder = builder
                .title("Dawn Client v2")
                .inner_size(1280.0, 720.0)
                .initialization_script(&final_script)
                .fullscreen(config.fullscreen)
                .devtools(true);

            let start_time = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            let (tx, rx) = mpsc::channel();
            let initial_rpc = config.discord_rpc;
            let start_time_clone = start_time;

            thread::spawn(move || {
                let mut client: Option<DiscordIpcClient> = None;
                
                let connect = |start_ts: i64| -> Option<DiscordIpcClient> {
                     if let Ok(mut c) = DiscordIpcClient::new("1462424278078197800") {
                        if c.connect().is_ok() {
                             let timestamps = activity::Timestamps::new().start(start_ts);
                             let _ = c.set_activity(activity::Activity::new()
                                .state("In the lobby")
                                .assets(activity::Assets::new()
                                    .large_image("dawn")
                                    .large_text("Dawn Client v2"))
                                .timestamps(timestamps)
                                .buttons(vec![
                                    activity::Button::new("Discord", "https://discord.gg/VsMEQ3HWs2"),
                                    activity::Button::new("Download", "https://github.com/zVipexx/dawn-client"),
                                ])
                             );
                             return Some(c);
                        }
                     }
                     None
                };

                if initial_rpc {
                    client = connect(start_time_clone);
                }

                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        RpcCmd::Connect => {
                             if client.is_none() {
                                 client = connect(start_time_clone);
                             }
                        },
                         RpcCmd::Disconnect => {
                            if let Some(mut c) = client.take() {
                                let _ = c.clear_activity(); 
                                let _ = c.close();
                            }
                        },
                        RpcCmd::UpdateActivity(state_str) => {
                            if let Some(c) = client.as_mut() {
                                 let assets = activity::Assets::new()
                                    .large_image("dawn")
                                    .large_text("Dawn Client v2");
                                let buttons = vec![
                                    activity::Button::new("Discord", "https://discord.gg/VsMEQ3HWs2"),
                                    activity::Button::new("Download", "https://github.com/zVipexx/dawn-client"),
                                ];
                                let timestamps = activity::Timestamps::new().start(start_time_clone);
                                
                                let _ = c.set_activity(activity::Activity::new()
                                    .state(&state_str)
                                    .assets(assets)
                                    .timestamps(timestamps)
                                    .buttons(buttons)
                                );
                            }
                        }
                    }
                }
            });

            app.manage(RpcState {
                sender: Mutex::new(tx),
            });

            builder.build().expect("failed to build window");

            Ok(())
        })

        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
             if let tauri::RunEvent::ExitRequested { .. } = event {                 let state = app_handle.state::<RpcState>();
                 if let Ok(sender) = state.sender.lock() {
                     let _ = sender.send(RpcCmd::Disconnect);
                 }
                 std::thread::sleep(std::time::Duration::from_millis(500));
             }
        });
}