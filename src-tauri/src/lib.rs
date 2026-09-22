use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const LEGACY_NOTES_FILE_NAME: &str = "leenote-notes.json";
const NOTES_INDEX_FILE_NAME: &str = "leenote-index.json";

fn ensure_storage_directory(path: &str) -> Result<PathBuf, String> {
    let directory = PathBuf::from(path);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

#[tauri::command]
fn default_storage_directory(app: tauri::AppHandle) -> Result<String, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("notes");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
fn choose_storage_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择 LeeNote 保存目录")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_markdown(suggested_name: String, content: String) -> Result<bool, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("导出 Markdown")
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(&suggested_name)
        .save_file()
    else {
        return Ok(false);
    };

    fs::write(path, content).map_err(|error| error.to_string())?;
    Ok(true)
}

fn safe_note_file_name(title: &str, id: &str) -> String {
    let mut safe_title = title
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '-'
            } else {
                character
            }
        })
        .take(48)
        .collect::<String>();
    safe_title = safe_title.trim_matches([' ', '.', '-']).to_string();
    if safe_title.is_empty() {
        safe_title = "note".to_string();
    }
    let short_id = id.chars().take(8).collect::<String>();
    format!("{safe_title}-{short_id}.md")
}

fn load_index(directory: &Path) -> Result<Vec<serde_json::Value>, String> {
    let index_path = directory.join(NOTES_INDEX_FILE_NAME);
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(index_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn save_notes_to_directory(directory: &Path, notes: &serde_json::Value) -> Result<(), String> {
    let notes = notes
        .as_array()
        .ok_or_else(|| "便签数据格式无效".to_string())?;
    let previous_index = load_index(directory)?;
    let previous_files = previous_index
        .iter()
        .filter_map(|item| {
            Some((
                item.get("id")?.as_str()?.to_string(),
                item.get("file")?.as_str()?.to_string(),
            ))
        })
        .collect::<HashMap<_, _>>();

    let mut next_index = Vec::with_capacity(notes.len());
    let mut current_files = HashSet::new();
    for note in notes {
        let mut metadata = note
            .as_object()
            .cloned()
            .ok_or_else(|| "便签数据格式无效".to_string())?;
        let id = metadata
            .get("id")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "便签缺少 ID".to_string())?;
        let title = metadata
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("无标题");
        let file_name = previous_files
            .get(id)
            .cloned()
            .unwrap_or_else(|| safe_note_file_name(title, id));
        let content = metadata
            .remove("content")
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default();
        fs::write(directory.join(&file_name), content).map_err(|error| error.to_string())?;
        current_files.insert(file_name.clone());
        metadata.insert("file".to_string(), serde_json::Value::String(file_name));
        next_index.push(serde_json::Value::Object(metadata));
    }

    let index_content = serde_json::to_string_pretty(&next_index).map_err(|error| error.to_string())?;
    fs::write(directory.join(NOTES_INDEX_FILE_NAME), index_content)
        .map_err(|error| error.to_string())?;

    for file_name in previous_files.values() {
        let is_managed_file = Path::new(file_name)
            .file_name()
            .and_then(|name| name.to_str())
            == Some(file_name.as_str())
            && file_name.ends_with(".md");
        if is_managed_file && !current_files.contains(file_name) {
            let _ = fs::remove_file(directory.join(file_name));
        }
    }
    Ok(())
}

#[tauri::command]
fn load_notes_file(directory: String) -> Result<Option<serde_json::Value>, String> {
    let directory = ensure_storage_directory(&directory)?;
    let mut index = load_index(&directory)?;
    if index.is_empty() {
        let legacy_file = directory.join(LEGACY_NOTES_FILE_NAME);
        if !legacy_file.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(legacy_file).map_err(|error| error.to_string())?;
        let legacy_notes = serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|error| error.to_string())?;
        save_notes_to_directory(&directory, &legacy_notes)?;
        return Ok(Some(legacy_notes));
    }
    for item in &mut index {
        let metadata = item
            .as_object_mut()
            .ok_or_else(|| "索引数据格式无效".to_string())?;
        let file_name = metadata
            .remove("file")
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(|| "索引缺少 Markdown 文件名".to_string())?;
        let content = fs::read_to_string(directory.join(file_name)).unwrap_or_default();
        metadata.insert("content".to_string(), serde_json::Value::String(content));
    }
    Ok(Some(serde_json::Value::Array(index)))
}

#[tauri::command]
fn save_notes_file(directory: String, notes: serde_json::Value) -> Result<(), String> {
    let directory = ensure_storage_directory(&directory)?;
    save_notes_to_directory(&directory, &notes)
}

#[tauri::command]
fn open_storage_directory(directory: String) -> Result<(), String> {
    let directory = ensure_storage_directory(&directory)?;
    #[cfg(target_os = "windows")]
    Command::new("explorer")
        .arg(&directory)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&directory)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(&directory)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            default_storage_directory,
            choose_storage_directory,
            export_markdown,
            load_notes_file,
            save_notes_file,
            open_storage_directory
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示 LeeNote", true, None::<&str>)?;
            let new_note = MenuItem::with_id(app, "new-note", "新建便签", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_note, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "new-note" => {
                        show_main_window(app);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("window.dispatchEvent(new CustomEvent('leenote:new-note'))");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LeeNote");
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
