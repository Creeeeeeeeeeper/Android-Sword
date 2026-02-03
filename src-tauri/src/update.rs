use std::env;
use std::fs;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use serde_json::json;

/// 版本信息结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VersionInfo {
    pub version: String,
}

/// GitHub Release 信息
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
}

/// 获取当前版本
#[tauri::command]
pub fn get_current_version() -> Result<String, String> {
    let current_dir = env::current_dir()
        .map_err(|e| format!("获取当前目录失败: {}", e))?;

    let version_path = current_dir.join("version.json");

    let content = fs::read_to_string(&version_path)
        .map_err(|e| format!("读取版本文件失败: {}", e))?;

    let version_info: VersionInfo = serde_json::from_str(&content)
        .map_err(|e| format!("解析版本文件失败: {}", e))?;

    Ok(version_info.version)
}

/// 检查最新版本（异步）
#[tauri::command]
pub async fn check_latest_version() -> Result<serde_json::Value, String> {
    // GitHub API URL for latest release
    let api_url = "https://api.github.com/repos/Creeeeeeeeeeper/Android-Sword/releases/latest";

    // 创建 HTTP 客户端并发送请求
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(api_url)
        .header("User-Agent", "Android-Sword-Updater")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("请求 GitHub API 失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API 返回错误状态: {}", response.status()));
    }

    let body = response.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let release: GitHubRelease = serde_json::from_str(&body)
        .map_err(|e| format!("解析 GitHub 响应失败: {}", e))?;

    Ok(json!({
        "version": release.tag_name,
        "name": release.name.unwrap_or_default(),
        "body": release.body.unwrap_or_default(),
        "url": release.html_url
    }))
}

/// 比较版本号，返回是否有新版本
/// 版本格式: v1.2.0 或 1.2.0
#[tauri::command]
pub fn compare_versions(current: String, latest: String) -> Result<bool, String> {
    // 移除 'v' 前缀
    let current_clean = current.trim_start_matches('v').trim_start_matches('V');
    let latest_clean = latest.trim_start_matches('v').trim_start_matches('V');

    // 分割版本号
    let current_parts: Vec<u32> = current_clean
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    let latest_parts: Vec<u32> = latest_clean
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    // 比较版本
    for i in 0..3 {
        let c = current_parts.get(i).unwrap_or(&0);
        let l = latest_parts.get(i).unwrap_or(&0);

        if l > c {
            return Ok(true);  // 有新版本
        } else if l < c {
            return Ok(false); // 当前版本更新
        }
    }

    Ok(false) // 版本相同
}

/// 启动更新程序
#[tauri::command]
pub fn launch_updater(app_handle: tauri::AppHandle) -> Result<(), String> {
    let current_dir = env::current_dir()
        .map_err(|e| format!("获取当前目录失败: {}", e))?;

    let updater_path = current_dir.join("update.exe");

    if !updater_path.exists() {
        return Err(format!("更新程序不存在: {}", updater_path.display()));
    }

    // 启动更新程序
    let mut cmd = Command::new(&updater_path);
    cmd.current_dir(&current_dir);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
        .map_err(|e| format!("启动更新程序失败: {}", e))?;

    // 关闭当前应用
    app_handle.exit(0);

    Ok(())
}

/// 获取更新设置
#[tauri::command]
pub fn get_update_settings() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir()
        .map_err(|e| format!("获取当前目录失败: {}", e))?;

    let settings_path = current_dir.join("settings.json");

    let settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("读取设置文件失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or(json!({}))
    } else {
        json!({})
    };

    // 获取更新相关设置
    let update_settings = settings.get("update").cloned().unwrap_or(json!({
        "autoCheck": true,
        "skipVersion": null
    }));

    Ok(update_settings)
}

/// 保存更新设置
#[tauri::command]
pub fn save_update_settings(auto_check: bool, skip_version: Option<String>) -> Result<(), String> {
    let current_dir = env::current_dir()
        .map_err(|e| format!("获取当前目录失败: {}", e))?;

    let settings_path = current_dir.join("settings.json");

    // 读取现有设置
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("读取设置文件失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or(json!({}))
    } else {
        json!({})
    };

    // 更新更新设置
    settings["update"] = json!({
        "autoCheck": auto_check,
        "skipVersion": skip_version
    });

    // 保存设置
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("序列化设置失败: {}", e))?;

    fs::write(&settings_path, content)
        .map_err(|e| format!("写入设置文件失败: {}", e))?;

    Ok(())
}
