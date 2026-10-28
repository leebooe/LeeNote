use reqwest::{blocking::Client, redirect::Policy, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, time::Duration};
use tauri::Manager;

const MAX_BACKUP_BYTES: usize = 20 * 1024 * 1024;
const BACKUP_FILE: &str = "leenote-backup.json";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfig {
    url: String,
    username: String,
    #[serde(default = "default_directory")]
    directory: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConfig {
    config: WebDavConfig,
    has_password: bool,
}

fn default_directory() -> String {
    "LeeNote".to_string()
}

async fn blocking<T: Send + 'static>(
    action: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|_| "WebDAV 操作中断，请重试".to_string())?
}

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("webdav.json"))
}

fn read_config(app: &tauri::AppHandle) -> Result<WebDavConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(WebDavConfig { directory: default_directory(), ..Default::default() });
    }
    serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|_| "WebDAV 配置读取失败，请重新保存配置".to_string())
}

fn normalize_config(mut config: WebDavConfig) -> Result<WebDavConfig, String> {
    let mut url = Url::parse(config.url.trim()).map_err(|_| "请输入完整的 WebDAV 地址".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("WebDAV 地址须使用 http:// 或 https://".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("请将账号和密码填写在对应字段，地址中仅保留服务器和路径".to_string());
    }
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    config.url = url.to_string();
    config.username = config.username.trim().to_string();
    let directory = config.directory.trim().trim_matches('/');
    if directory.split('/').any(|part| part == "." || part == ".." || part.contains('\\') || part.chars().any(char::is_control)) {
        return Err("备份目录请使用以 / 分隔的文件夹名称".to_string());
    }
    config.directory = directory.split('/').filter(|part| !part.is_empty()).collect::<Vec<_>>().join("/");
    Ok(config)
}

fn credential(config: &WebDavConfig) -> Result<keyring::Entry, String> {
    // Bind credentials to the server and account; changing a server never reuses its password.
    let account = serde_json::to_string(&(&config.url, &config.username))
        .map_err(|_| "WebDAV 凭据标识生成失败".to_string())?;
    keyring::Entry::new("com.leenote.desktop.webdav", &account)
        .map_err(|_| "系统凭据库访问失败".to_string())
}

fn stored_password(config: &WebDavConfig) -> Result<Option<String>, String> {
    match credential(config)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("系统凭据库读取失败，请解锁凭据库后重试".to_string()),
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .redirect(Policy::none())
        .build()
        .map_err(|_| "WebDAV 网络客户端初始化失败".to_string())
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "WebDAV 请求超时，请稍后重试".to_string()
    } else if error.is_connect() {
        "WebDAV 连接失败，请检查地址、网络和服务器证书".to_string()
    } else {
        "WebDAV 网络请求失败，请检查网络和服务器配置".to_string()
    }
}

fn check_status(status: StatusCode) -> Result<(), String> {
    if status.is_success() {
        return Ok(());
    }
    let message = match status.as_u16() {
        301 | 302 | 303 | 307 | 308 => "服务器返回重定向，请填写最终 WebDAV 地址",
        401 => "WebDAV 账号或密码错误",
        403 => "WebDAV 访问被拒绝，请检查账号权限",
        404 => "WebDAV 路径或备份文件尚未创建",
        405 => "服务器未开放此 WebDAV 操作，请检查地址和权限",
        409 => "WebDAV 父目录缺失，请检查服务器路径",
        413 => "备份文件超过服务器大小限制",
        423 => "WebDAV 文件已锁定，请稍后重试",
        507 => "WebDAV 存储空间不足",
        _ => "WebDAV 服务器操作失败",
    };
    Err(format!("{message}（HTTP {}）", status.as_u16()))
}

fn remote_url(config: &WebDavConfig, parts: &[&str]) -> Result<Url, String> {
    let mut url = Url::parse(&config.url).map_err(|_| "WebDAV 地址无效".to_string())?;
    {
        let mut segments = url.path_segments_mut().map_err(|_| "WebDAV 路径无效".to_string())?;
        segments.pop_if_empty();
        for part in parts {
            segments.push(part);
        }
    }
    Ok(url)
}

fn ensure_directory(client: &Client, config: &WebDavConfig, password: &str) -> Result<(), String> {
    let parts: Vec<_> = config.directory.split('/').filter(|part| !part.is_empty()).collect();
    for length in 1..=parts.len() {
        let mut url = remote_url(config, &parts[..length])?;
        url.path_segments_mut().map_err(|_| "WebDAV 路径无效".to_string())?.push("");
        let response = client.request(Method::from_bytes(b"MKCOL").unwrap(), url)
            .basic_auth(&config.username, Some(password))
            .send().map_err(network_error)?;
        // Existing collections conventionally return 405.
        if response.status() != StatusCode::METHOD_NOT_ALLOWED {
            check_status(response.status())?;
        }
    }
    Ok(())
}

fn backup_url(config: &WebDavConfig) -> Result<Url, String> {
    let mut parts: Vec<_> = config.directory.split('/').filter(|part| !part.is_empty()).collect();
    parts.push(BACKUP_FILE);
    remote_url(config, &parts)
}

#[tauri::command]
pub async fn load_webdav_config(app: tauri::AppHandle) -> Result<StoredConfig, String> {
    blocking(move || {
        let config = read_config(&app)?;
        let has_password = if config.url.is_empty() { false } else { stored_password(&config)?.is_some() };
        Ok(StoredConfig { config, has_password })
    }).await
}

#[tauri::command]
pub async fn save_webdav_config(app: tauri::AppHandle, config: WebDavConfig, password: Option<String>) -> Result<StoredConfig, String> {
    blocking(move || {
        let config = normalize_config(config)?;
        if let Some(password) = password {
            credential(&config)?.set_password(&password)
                .map_err(|_| "密码保存失败，请检查系统凭据库是否已解锁".to_string())?;
        }
        let has_password = stored_password(&config)?.is_some();
        let content = serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?;
        let path = config_path(&app)?;
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, content).map_err(|error| error.to_string())?;
        fs::rename(temporary, path).map_err(|error| error.to_string())?;
        Ok(StoredConfig { config, has_password })
    }).await
}

#[tauri::command]
pub async fn test_webdav_connection(config: WebDavConfig, password: Option<String>) -> Result<(), String> {
    blocking(move || {
        let config = normalize_config(config)?;
        let password = match password { Some(value) => value, None => stored_password(&config)?.unwrap_or_default() };
        let response = client()?.request(Method::from_bytes(b"PROPFIND").unwrap(), &config.url)
            .basic_auth(&config.username, Some(password))
            .header("Depth", "0")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(r#"<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#)
            .send().map_err(network_error)?;
        if response.status() != StatusCode::MULTI_STATUS {
            check_status(response.status())?;
            return Err("请填写支持 PROPFIND 的 WebDAV 服务地址".to_string());
        }
        Ok(())
    }).await
}

#[tauri::command]
pub async fn upload_webdav_backup(app: tauri::AppHandle, content: String) -> Result<(), String> {
    blocking(move || {
        if content.len() > MAX_BACKUP_BYTES {
            return Err("备份文件超过 20 MB 限制".to_string());
        }
        let payload: serde_json::Value = serde_json::from_str(&content).map_err(|_| "备份数据格式无效".to_string())?;
        if payload.get("app").and_then(|value| value.as_str()) != Some("LeeNote")
            || payload.get("version").and_then(|value| value.as_u64()) != Some(1)
            || payload.get("notes").and_then(|value| value.as_array()).is_none() {
            return Err("备份数据格式无效".to_string());
        }
        let config = normalize_config(read_config(&app)?)?;
        let password = stored_password(&config)?.unwrap_or_default();
        let client = client()?;
        ensure_directory(&client, &config, &password)?;
        let response = client.put(backup_url(&config)?)
            .basic_auth(&config.username, Some(&password))
            .header("Content-Type", "application/json; charset=utf-8")
            .body(content).send().map_err(network_error)?;
        check_status(response.status())
    }).await
}

#[tauri::command]
pub async fn download_webdav_backup(app: tauri::AppHandle) -> Result<String, String> {
    blocking(move || {
        let config = normalize_config(read_config(&app)?)?;
        let password = stored_password(&config)?.unwrap_or_default();
        let response = client()?.get(backup_url(&config)?)
            .basic_auth(&config.username, Some(&password))
            .send().map_err(network_error)?;
        check_status(response.status())?;
        if response.content_length().is_some_and(|length| length > MAX_BACKUP_BYTES as u64) {
            return Err("远程备份超过 20 MB 限制".to_string());
        }
        let mut bytes = Vec::new();
        response.take((MAX_BACKUP_BYTES + 1) as u64).read_to_end(&mut bytes)
            .map_err(|_| "备份下载中断，请重试".to_string())?;
        if bytes.len() > MAX_BACKUP_BYTES {
            return Err("远程备份超过 20 MB 限制".to_string());
        }
        String::from_utf8(bytes).map_err(|_| "远程备份须为 UTF-8 JSON 文件".to_string())
    }).await
}
