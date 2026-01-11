use std::fs;
use std::path::Path;
use std::env;
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 写入文件
#[tauri::command]
pub fn write_file(filename: &str, content: &str) -> Result<String, String> {
    match fs::write(filename, content) {
        Ok(_) => Ok("s".to_string()),
        Err(_e) => Err("f".to_string()),
    }
}

/// 写入二进制文件
#[tauri::command]
pub fn write_binary_file(filename: &str, data: Vec<u8>) -> Result<String, String> {
    match fs::write(filename, data) {
        Ok(_) => Ok("s".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// 复制文件（用于大文件复制，避免通过JS传输）
#[tauri::command]
pub fn copy_file(source: &str, destination: &str) -> Result<String, String> {
    match fs::copy(source, destination) {
        Ok(_) => Ok("s".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// 选择APK文件对话框
#[tauri::command]
pub async fn select_apk_file(app: AppHandle<impl Runtime>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app.dialog()
        .file()
        .add_filter("APK文件", &["apk"])
        .blocking_pick_file();

    match file_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

/// 读取文件
#[tauri::command]
pub fn read_file(filename: &str) -> Result<String, String> {
    match fs::read_to_string(filename) {
        Ok(content) => Ok(content),
        Err(_) => Err("f".to_string()),
    }
}

/// 删除文件
#[tauri::command]
pub fn delete_file(filename: &str) -> Result<String, String> {
    match fs::remove_file(filename) {
        Ok(_) => Ok("s".to_string()),
        Err(_) => Err("f".to_string()),
    }
}

/// 删除文件夹
#[tauri::command]
pub fn delete_dir(dirname: &str) -> Result<String, String> {
    match fs::remove_dir_all(dirname) {
        Ok(_) => Ok("s".to_string()),
        Err(_) => Err("f".to_string()),
    }
}

/// 异步删除文件夹（大文件夹时使用）
#[tauri::command]
pub async fn delete_dir_async(dirname: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        match fs::remove_dir_all(&dirname) {
            Ok(_) => Ok("s".to_string()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 创建文件夹
#[tauri::command]
pub fn create_dir(dirname: &str) -> Result<String, String> {
    match fs::create_dir_all(dirname) {
        Ok(_) => Ok("s".to_string()),
        Err(_) => Err("f".to_string()),
    }
}

/// 读取文件夹内所有文件夹名称
#[tauri::command]
pub fn read_dirs(dirname: &str) -> Result<Vec<String>, String> {
    match fs::read_dir(dirname) {
        Ok(entries) => {
            let mut dirs = Vec::new();
            for entry in entries {
                if let Ok(entry) = entry {
                    if let Ok(metadata) = entry.metadata() {
                        if metadata.is_dir() {
                            if let Some(name) = entry.file_name().to_str() {
                                dirs.push(name.to_string());
                            }
                        }
                    }
                }
            }
            Ok(dirs)
        }
        Err(_) => Err("f".to_string()),
    }
}

/// 保存Excel文件
#[tauri::command]
pub fn save_excel_file(_file_name: String, bytes: Vec<u8>, target_path: String) -> Result<(), String> {
    fs::write(&target_path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取Excel文件内容
#[tauri::command]
pub fn read_excel_file<R: Runtime>(
    _app: AppHandle<R>,
    file_path: String,
) -> Result<Vec<u8>, String> {
    fs::read(file_path).map_err(|e| e.to_string())
}

/// 检查文件存在性
#[tauri::command]
pub fn file_exists(filename: &str) -> Result<String, String> {
    if Path::new(filename).exists() {
        Ok("s".to_string())
    } else {
        Err("f".to_string())
    }
}

/// 打开文件路径
#[tauri::command]
pub fn open_file(path: &str) -> Result<String, String> {
    let current_dir = env::current_dir()
        .map_err(|e| e.to_string())?;

    let normalized_path = path.replace("/", "\\");
    let full_path = current_dir.join(&normalized_path);

    eprintln!("当前工作目录: {}", current_dir.display());
    eprintln!("要打开的路径: {}", full_path.display());
    eprintln!("路径是否存在: {}", full_path.exists());

    if !full_path.exists() {
        return Err(format!("路径不存在: {}", full_path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let ps_cmd = format!("explorer '{}'", full_path.display());
        let mut cmd = std::process::Command::new("powershell");
        cmd.arg("-NoProfile")
            .arg("-Command")
            .arg(&ps_cmd)
            .creation_flags(CREATE_NO_WINDOW);
        cmd.spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(full_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(full_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok("s".to_string())
}

/// 删除文件或文件夹
#[tauri::command]
pub fn delete_path(path: &str) -> Result<String, String> {
    if std::path::Path::new(path).is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok("s".to_string())
}

/// 获取当前工作目录
#[tauri::command]
pub fn get_current_dir() -> Result<String, String> {
    env::current_dir()
        .map_err(|e| e.to_string())
        .map(|path| path.to_string_lossy().to_string())
}
