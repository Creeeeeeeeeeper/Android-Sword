use std::fs;
use std::path::Path;
use tauri::{AppHandle, Runtime, Manager};
use std::env;
use std::sync::Mutex;
use std::process::{Child, Command, Stdio};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, mpsc};
use md5;
use sha1::{Sha1, Digest as Sha1Digest};
use sha2::{Sha256, Digest};
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// 应用状态结构体
struct AppState {
    scrcpy_processes: Mutex<HashMap<String, Child>>,
}

// 权限信息结构体
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct PermissionInfo {
    permission: String,      // 原始权限名称（完整格式如 android.permission.CAMERA）
    name: String,           // 权限短名称（如 CAMERA）
    name_zh: String,        // 中文名称
    description: String,    // 描述
    level: String,          // 等级
}

// permission.json中的权限条目结构
#[derive(serde::Deserialize)]
struct PermissionEntry {
    name: String,
    name_zh: String,
    description: String,
    level: String,
}

// 从permission.json加载权限映射表
fn load_permission_map() -> HashMap<String, PermissionEntry> {
    let mut map = HashMap::new();

    let current_dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(_) => return map,
    };

    let permission_file = current_dir.join("prefile").join("permission.json");

    if let Ok(content) = fs::read_to_string(&permission_file) {
        if let Ok(entries) = serde_json::from_str::<Vec<PermissionEntry>>(&content) {
            for entry in entries {
                // 键为权限短名称（如 CAMERA）
                map.insert(entry.name.clone(), entry);
            }
        }
    }

    map
}

// 写入文件
#[tauri::command]
fn write_file(filename: &str, content: &str) -> Result<String, String> {
    match fs::write(filename, content) {
        Ok(_) => Ok("s".to_string()),  // 成功返回 "s"
        Err(_e) => Err("f".to_string()), // 失败返回 "f"
    }
}

// 写入二进制文件
#[tauri::command]
fn write_binary_file(filename: &str, data: Vec<u8>) -> Result<String, String> {
    match fs::write(filename, data) {
        Ok(_) => Ok("s".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

// 设置窗口标题
#[tauri::command]
fn set_title(title: &str, window: tauri::Window) {
    window.set_title(title).unwrap();
}

// 显示窗口（用于预加载完成后显示）
#[tauri::command]
fn show_window(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())
}

// 关闭启动窗口并显示主窗口
#[tauri::command]
async fn close_splash_show_main(app: AppHandle) -> Result<(), String> {
    // 先隐藏 splash 窗口
    if let Some(splash) = app.get_webview_window("splash") {
        splash.hide().map_err(|e| e.to_string())?;
    }

    // 等待隐藏完成
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // 显示主窗口
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
    }

    // 等待主窗口显示完成
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // 聚焦主窗口
    if let Some(main) = app.get_webview_window("main") {
        main.set_focus().map_err(|e| e.to_string())?;
    }

    // 等待2秒后再关闭 splash 窗口
    let app_clone = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        if let Some(splash) = app_clone.get_webview_window("splash") {
            let _ = splash.close();
        }
    });

    Ok(())
}

// 读取文件
#[tauri::command]
fn read_file(filename: &str) -> Result<String, String> {
    match fs::read_to_string(filename) {
        Ok(content) => Ok(content),  // 成功返回文件内容
        Err(_) => Err("f".to_string()), // 失败返回 "f"
    }
}

// 删除文件
#[tauri::command]
fn delete_file(filename: &str) -> Result<String, String> {
    match fs::remove_file(filename) {
        Ok(_) => Ok("s".to_string()),  // 成功返回 "s"
        Err(_) => Err("f".to_string()), // 失败返回 "f"
    }
}

// 删除文件夹
#[tauri::command]
fn delete_dir(dirname: &str) -> Result<String, String> {
    match fs::remove_dir_all(dirname) {
        Ok(_) => Ok("s".to_string()),  // 成功返回 "s"
        Err(_) => Err("f".to_string()), // 失败返回 "f"
    }
}

// 创建文件夹
#[tauri::command]
fn create_dir(dirname: &str) -> Result<String, String> {
    match fs::create_dir_all(dirname) {
        Ok(_) => Ok("s".to_string()),  // 成功返回 "s"
        Err(_) => Err("f".to_string()), // 失败返回 "f"
    }
}

// 读取文件夹内所有文件夹名称
#[tauri::command]
fn read_dirs(dirname: &str) -> Result<Vec<String>, String> {
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

// 保存Excel文件
#[tauri::command]
fn save_excel_file(_file_name: String, bytes: Vec<u8>, target_path: String) -> Result<(), String> {
    fs::write(&target_path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

// 读取teacher_schedule.xlsx文件内容
#[tauri::command]
fn read_excel_file<R: Runtime>(
    _app: AppHandle<R>,
    file_path: String,
) -> Result<Vec<u8>, String> {
    fs::read(file_path).map_err(|e| e.to_string())
}

// 检查文件存在性
#[tauri::command]
fn file_exists(filename: &str) -> Result<String, String> {
    if Path::new(filename).exists() {
        Ok("s".to_string())  // 存在返回 "s"
    } else {
        Err("f".to_string()) // 不存在返回 "f"
    }
}

// 打开文件路径
#[tauri::command]
fn open_file(path: &str) -> Result<String, String> {
    // 获取当前工作目录并构建完整路径
    let current_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?;

    // 规范化路径（将正斜杠转换为反斜杠）
    let normalized_path = path.replace("/", "\\");
    let full_path = current_dir.join(&normalized_path);

    // 调试日志
    eprintln!("当前工作目录: {}", current_dir.display());
    eprintln!("要打开的路径: {}", full_path.display());
    eprintln!("路径是否存在: {}", full_path.exists());

    // 确保路径存在
    if !full_path.exists() {
        return Err(format!("路径不存在: {}", full_path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 直接使用powershell执行explorer打开文件夹
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

// 删除文件或文件夹
#[tauri::command]
fn delete_path(path: &str) -> Result<String, String> {
    if std::path::Path::new(path).is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok("s".to_string())
}

// 安装APK到设备
#[tauri::command]
async fn install_apk(apk_path: String) -> Result<String, String> {
    let current_dir = env::current_dir()
        .map_err(|e| e.to_string())?;

    let adb_exe = current_dir.join("adb\\adb.exe");
    let apk_full_path = current_dir.join(&apk_path);

    if !apk_full_path.exists() {
        return Err(format!("APK文件不存在: {}", apk_full_path.display()));
    }

    eprintln!("开始安装APK: {}", apk_full_path.display());

    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&adb_exe);
        cmd.arg("install")
            .arg("-r") // 替换已存在的应用
            .arg(&apk_full_path);

        // Windows平台：隐藏控制台窗口
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let output_text = format!("{}\n{}", stdout, stderr);

        eprintln!("ADB安装输出:\n{}", output_text);

        if output_text.contains("Success") {
            Ok("success".to_string())
        } else if output_text.contains("INSTALL_FAILED") {
            // 提取错误信息
            let error_line = output_text
                .lines()
                .find(|line| line.contains("INSTALL_FAILED") || line.contains("Failure"))
                .unwrap_or("安装失败");
            Err(error_line.to_string())
        } else if output_text.contains("error") || output_text.contains("failed") {
            Err(output_text.lines().last().unwrap_or("安装失败").to_string())
        } else {
            Ok("success".to_string())
        }
    }).await.map_err(|e| e.to_string())?;

    result
}

// 检查ADB设备
#[tauri::command]
fn check_adb_devices() -> Result<String, String> {
    let mut cmd = Command::new("adb\\adb.exe");
    cmd.arg("devices");

    // Windows平台：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output()
        .map_err(|e| e.to_string())?;

    let devices_output = String::from_utf8_lossy(&output.stdout);

    // 解析输出，查找除了"List of attached devices"和空行之外的设备
    let device_count = devices_output
        .lines()
        .skip(1)
        .filter(|line| !line.is_empty() && line.contains("device") && !line.contains("List"))
        .count();

    if device_count > 0 {
        Ok("has_devices".to_string())
    } else {
        Ok("no_devices".to_string())
    }
}

// 启动scrcpy进程（异步）
#[tauri::command]
async fn start_scrcpy(caseNumber: String, state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let case_number = caseNumber.clone();

    // 读取设置文件
    let settings: serde_json::Value = match fs::read_to_string("settings.json") {
        Ok(content) => serde_json::from_str(&content).unwrap_or(json!({})),
        Err(_) => json!({})
    };
    let scrcpy_settings = settings.get("scrcpy").cloned().unwrap_or(json!({}));

    // 查找可用的端口（从8080开始）
    let mut port = 8080;
    loop {
        if is_port_free(port) {
            break;
        }
        port += 1;
        if port > 9000 {
            return Err("无法找到可用的端口".to_string());
        }
    }

    let current_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?;

    // 构建scrcpy命令
    let scrcpy_exe = current_dir.join("scrcpy\\rust-ws-scrcpy-v2.1.1.exe");
    let adb_exe = current_dir.join("adb\\adb.exe");
    let scrcpy_server = current_dir.join("scrcpy\\scrcpy-server-v3.3.4");

    if !scrcpy_exe.exists() {
        return Err(format!("scrcpy执行文件不存在: {}", scrcpy_exe.display()));
    }

    // 先在主线程中生成进程，然后在后台线程中处理等待逻辑
    let mut cmd = Command::new(&scrcpy_exe);
    cmd.arg("-a")
        .arg(&adb_exe)
        .arg("-s")
        .arg(&scrcpy_server)
        .arg("-p")
        .arg(port.to_string());

    // 应用用户设置的参数
    if let Some(max_size) = scrcpy_settings.get("maxSize").and_then(|v| v.as_u64()) {
        cmd.arg("-m").arg(max_size.to_string());
    }

    if let Some(bit_rate) = scrcpy_settings.get("bitRate").and_then(|v| v.as_u64()) {
        cmd.arg("-b").arg(bit_rate.to_string());
    }

    if let Some(max_fps) = scrcpy_settings.get("maxFps").and_then(|v| v.as_u64()) {
        cmd.arg("-f").arg(max_fps.to_string());
    }

    if let Some(video_port) = scrcpy_settings.get("videoPort").and_then(|v| v.as_u64()) {
        cmd.arg("--video-port").arg(video_port.to_string());
    }

    if let Some(control_port) = scrcpy_settings.get("controlPort").and_then(|v| v.as_u64()) {
        cmd.arg("--control-port").arg(control_port.to_string());
    }

    if let Some(intra_refresh) = scrcpy_settings.get("intraRefresh").and_then(|v| v.as_u64()) {
        cmd.arg("-i").arg(intra_refresh.to_string());
    }

    if let Some(public) = scrcpy_settings.get("public").and_then(|v| v.as_bool()) {
        if public {
            cmd.arg("--public");
        }
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::null());

    // Windows平台：隐藏窗口和继承进程关系
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    let mut child = cmd.spawn()
        .map_err(|e| e.to_string())?;

    // 提取stdout用于后台监听
    let stdout = child.stdout.take().ok_or("无法获取stdout")?;

    // 为后台线程克隆case_number
    let case_number_for_thread = case_number.clone();

    // 立即将进程保存到状态中，即使还在启动中
    let mut processes = state.scrcpy_processes.lock().unwrap();
    processes.insert(case_number.clone(), child);
    drop(processes); // 释放锁

    // 在后台异步线程中处理启动完成检查
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        // 等待启动完成信号，超时30秒
        let start_time = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(30);
        let mut startup_complete = false;

        while let Some(Ok(line)) = lines.next() {
            if line.contains("Open http://") && line.contains("in your browser") {
                startup_complete = true;
                eprintln!("scrcpy启动完成，案件: {}，端口: {}", case_number_for_thread, port);
                break;
            }

            // 超时检查
            if start_time.elapsed() > timeout {
                eprintln!("scrcpy启动超时");
                return;
            }
        }

        if startup_complete {
            // 等待额外的2秒，让scrcpy完全准备好接受连接
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            eprintln!("scrcpy已准备好接受连接，案件: {}", case_number_for_thread);
        } else {
            eprintln!("无法确认scrcpy启动成功");
        }
    });

    // 立即返回，不阻塞前端
    Ok(json!({ "port": port, "status": "启动中" }))
}

// 停止scrcpy进程
#[tauri::command]
fn stop_scrcpy(caseNumber: &str, state: tauri::State<AppState>) -> Result<String, String> {
    let mut processes = state.scrcpy_processes.lock().unwrap();

    if let Some(mut child) = processes.remove(caseNumber) {
        let _ = child.kill();
        let _ = child.wait();
        Ok("stopped".to_string())
    } else {
        Ok("no_process".to_string())
    }
}

// 检查scrcpy是否已准备好接受连接
#[tauri::command]
fn is_scrcpy_ready(caseNumber: &str, state: tauri::State<AppState>) -> Result<bool, String> {
    // 简化：如果进程存在，就认为准备好了
    let processes = state.scrcpy_processes.lock().unwrap();
    Ok(processes.contains_key(caseNumber))
}

// 清理所有残留的adb和scrcpy进程
#[tauri::command]
fn cleanup_residual_processes() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 杀死所有残留的adb进程
        let mut cmd1 = Command::new("taskkill");
        cmd1.args(&["/F", "/IM", "adb.exe"])
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd1.output();

        // 杀死所有残留的rust-ws-scrcpy进程
        let mut cmd2 = Command::new("taskkill");
        cmd2.args(&["/F", "/IM", "rust-ws-scrcpy-v2.1.1.exe"])
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd2.output();

        Ok("cleaned".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Linux/Mac
        let _ = Command::new("pkill")
            .args(&["-f", "adb"])
            .output();

        let _ = Command::new("pkill")
            .args(&["-f", "scrcpy"])
            .output();

        Ok("cleaned".to_string())
    }
}

// 获取当前工作目录
#[tauri::command]
fn get_current_dir() -> Result<String, String> {
    env::current_dir()
        .map_err(|e| e.to_string())
        .map(|path| path.to_string_lossy().to_string())
}

// 获取APK信息（从AndroidManifest.xml解析）
#[tauri::command]
fn get_apk_info(apk_dir: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);

    // 读取info.json
    let info_path = apk_dir_path.join("info.json");
    let info_content = fs::read_to_string(&info_path).unwrap_or_default();
    let info: serde_json::Value = serde_json::from_str(&info_content).unwrap_or(json!({}));

    // 检查jadx目录是否存在（表示反编译完成）
    let jadx_path = apk_dir_path.join("jadx");
    let is_decompiled = jadx_path.exists();

    // 检查是否已经提取过图标
    let saved_icon_path = apk_dir_path.join("icon.png");
    let mut icon_path = String::new();

    if saved_icon_path.exists() {
        icon_path = saved_icon_path.to_string_lossy().to_string();
    }

    // 解析AndroidManifest.xml获取应用信息
    let manifest_path = jadx_path.join("resources").join("AndroidManifest.xml");
    let mut app_name = info.get("originalName").and_then(|v| v.as_str()).unwrap_or("未知应用").to_string();
    let mut package_name = String::new();
    let mut version_name = String::new();
    let mut icon_ref = String::new();

    if manifest_path.exists() {
        if let Ok(manifest_content) = fs::read_to_string(&manifest_path) {
            // 简单解析XML获取信息
            // 获取package名
            if let Some(start) = manifest_content.find("package=\"") {
                let start = start + 9;
                if let Some(end) = manifest_content[start..].find("\"") {
                    package_name = manifest_content[start..start+end].to_string();
                }
            }

            // 获取versionName
            if let Some(start) = manifest_content.find("android:versionName=\"") {
                let start = start + 21;
                if let Some(end) = manifest_content[start..].find("\"") {
                    version_name = manifest_content[start..start+end].to_string();
                }
            }

            // 获取label
            if let Some(start) = manifest_content.find("android:label=\"") {
                let start = start + 15;
                if let Some(end) = manifest_content[start..].find("\"") {
                    let label = &manifest_content[start..start+end];
                    if label.starts_with("@string/") {
                        // 从strings.xml解析字符串资源
                        let string_name = &label[8..]; // 去掉 "@string/" 前缀
                        if let Some(resolved_name) = resolve_string_resource(&jadx_path, string_name) {
                            app_name = resolved_name;
                        }
                    } else if !label.starts_with("@") {
                        app_name = label.to_string();
                    }
                }
            }

            // 获取icon引用（如 @mipmap/ic_launcher 或 @drawable/icon）
            if let Some(start) = manifest_content.find("android:icon=\"@") {
                let start = start + 15;
                if let Some(end) = manifest_content[start..].find("\"") {
                    icon_ref = manifest_content[start..start+end].to_string();
                }
            }
        }
    }

    // 如果还没有提取图标，尝试从jadx资源中查找并复制
    if icon_path.is_empty() && is_decompiled && !icon_ref.is_empty() {
        if let Some(found_icon) = find_and_copy_icon(&jadx_path, &icon_ref, &apk_dir_path) {
            icon_path = found_icon;
        }
    }

    // 获取APK文件大小
    let apk_path = apk_dir_path.join("base.apk");
    let file_size = if apk_path.exists() {
        fs::metadata(&apk_path).map(|m| m.len()).unwrap_or(0)
    } else {
        info.get("fileSize").and_then(|v| v.as_u64()).unwrap_or(0)
    };

    Ok(json!({
        "originalName": info.get("originalName").and_then(|v| v.as_str()).unwrap_or(""),
        "uploadTime": info.get("uploadTime").and_then(|v| v.as_str()).unwrap_or(""),
        "fileSize": file_size,
        "timestamp": info.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0),
        "isDecompiled": is_decompiled,
        "appName": app_name,
        "packageName": package_name,
        "versionName": version_name,
        "iconPath": icon_path
    }))
}

// 从strings.xml解析字符串资源
fn resolve_string_resource(jadx_path: &std::path::Path, string_name: &str) -> Option<String> {
    let res_path = jadx_path.join("resources").join("res");

    // 尝试不同的values目录
    let values_dirs = vec!["values", "values-zh", "values-zh-rCN", "values-en"];

    for values_dir in &values_dirs {
        let strings_path = res_path.join(values_dir).join("strings.xml");
        if strings_path.exists() {
            if let Ok(content) = fs::read_to_string(&strings_path) {
                // 查找 <string name="app_name">应用名</string> 格式
                let pattern = format!("<string name=\"{}\">", string_name);
                if let Some(start) = content.find(&pattern) {
                    let start = start + pattern.len();
                    if let Some(end) = content[start..].find("</string>") {
                        let value = &content[start..start + end];
                        // 跳过空值
                        if !value.is_empty() && !value.starts_with("@") {
                            return Some(value.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

// 查找并复制图标到APK目录
fn find_and_copy_icon(jadx_path: &std::path::Path, icon_ref: &str, apk_dir_path: &std::path::Path) -> Option<String> {
    let res_path = jadx_path.join("resources").join("res");

    // 解析icon_ref，如 "mipmap/ic_launcher" 或 "drawable/icon"
    let parts: Vec<&str> = icon_ref.split('/').collect();
    if parts.len() != 2 {
        return None;
    }

    let res_type = parts[0]; // mipmap 或 drawable
    let icon_name = parts[1]; // ic_launcher 或 icon

    // 按优先级排序的目录后缀列表（优先使用高分辨率）
    let density_suffixes = vec![
        "-xxxhdpi-v4", "-xxxhdpi",
        "-xxhdpi-v4", "-xxhdpi",
        "-xhdpi-v4", "-xhdpi",
        "-hdpi-v4", "-hdpi",
        "-mdpi-v4", "-mdpi",
        "-anydpi-v26", "-anydpi-v24", "-anydpi",
        "-v4", ""
    ];

    // 支持的图片扩展名
    let extensions = vec!["png", "webp", "jpg", "jpeg"];

    // 首先尝试直接查找PNG图标
    for suffix in &density_suffixes {
        let dir_name = format!("{}{}", res_type, suffix);
        let dir_path = res_path.join(&dir_name);

        if dir_path.exists() {
            for ext in &extensions {
                let icon_file = dir_path.join(format!("{}.{}", icon_name, ext));
                if icon_file.exists() {
                    let dest_path = apk_dir_path.join("icon.png");
                    if fs::copy(&icon_file, &dest_path).is_ok() {
                        eprintln!("已复制图标: {} -> {}", icon_file.display(), dest_path.display());
                        return Some(dest_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    // 如果是自适应图标（XML），尝试解析并查找foreground图标
    for suffix in &density_suffixes {
        let dir_name = format!("{}{}", res_type, suffix);
        let dir_path = res_path.join(&dir_name);
        let xml_file = dir_path.join(format!("{}.xml", icon_name));

        if xml_file.exists() {
            if let Ok(xml_content) = fs::read_to_string(&xml_file) {
                // 解析 foreground drawable 引用
                if let Some(foreground_ref) = parse_adaptive_icon_foreground(&xml_content) {
                    eprintln!("找到自适应图标，foreground: {}", foreground_ref);
                    // 递归查找foreground图标
                    if let Some(icon) = find_and_copy_icon(jadx_path, &foreground_ref, apk_dir_path) {
                        return Some(icon);
                    }
                }
            }
        }
    }

    // 尝试常见的图标名称作为后备方案
    let fallback_names = vec![
        format!("{}_foreground", icon_name),
        "ic_launcher_foreground".to_string(),
        "ic_launcher".to_string(),
        "icon".to_string(),
        "app_icon".to_string(),
    ];

    for fallback_name in &fallback_names {
        if let Ok(entries) = fs::read_dir(&res_path) {
            for entry in entries.flatten() {
                let entry_name = entry.file_name().to_string_lossy().to_string();
                if entry_name.starts_with("mipmap") || entry_name.starts_with("drawable") {
                    let dir_path = entry.path();
                    if dir_path.is_dir() {
                        for ext in &extensions {
                            let icon_file = dir_path.join(format!("{}.{}", fallback_name, ext));
                            if icon_file.exists() {
                                let dest_path = apk_dir_path.join("icon.png");
                                if fs::copy(&icon_file, &dest_path).is_ok() {
                                    eprintln!("已复制后备图标: {} -> {}", icon_file.display(), dest_path.display());
                                    return Some(dest_path.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 最后尝试遍历所有res子目录查找任何可能的图标PNG
    if let Ok(entries) = fs::read_dir(&res_path) {
        let mut found_icons: Vec<(String, std::path::PathBuf)> = Vec::new();

        for entry in entries.flatten() {
            let entry_name = entry.file_name().to_string_lossy().to_string();
            if entry_name.starts_with("mipmap") || entry_name.starts_with("drawable") {
                let dir_path = entry.path();
                if dir_path.is_dir() {
                    // 查找包含 "launcher" 或 "icon" 的PNG文件
                    if let Ok(files) = fs::read_dir(&dir_path) {
                        for file in files.flatten() {
                            let file_name = file.file_name().to_string_lossy().to_string();
                            if (file_name.contains("launcher") || file_name.contains("icon"))
                                && !file_name.contains("notification")
                                && (file_name.ends_with(".png") || file_name.ends_with(".webp")) {
                                found_icons.push((entry_name.clone(), file.path()));
                            }
                        }
                    }
                }
            }
        }

        // 按目录名排序，优先选择高分辨率
        found_icons.sort_by(|a, b| {
            let priority = |name: &str| -> i32 {
                if name.contains("xxxhdpi") { return 0; }
                if name.contains("xxhdpi") { return 1; }
                if name.contains("xhdpi") { return 2; }
                if name.contains("hdpi") { return 3; }
                if name.contains("mdpi") { return 4; }
                5
            };
            priority(&a.0).cmp(&priority(&b.0))
        });

        if let Some((_, icon_file)) = found_icons.first() {
            let dest_path = apk_dir_path.join("icon.png");
            if fs::copy(icon_file, &dest_path).is_ok() {
                eprintln!("已复制图标: {} -> {}", icon_file.display(), dest_path.display());
                return Some(dest_path.to_string_lossy().to_string());
            }
        }
    }

    None
}

// 解析自适应图标XML，获取foreground drawable引用
fn parse_adaptive_icon_foreground(xml_content: &str) -> Option<String> {
    // 查找 <foreground android:drawable="@drawable/xxx"/> 或类似模式
    if let Some(start) = xml_content.find("foreground") {
        let after_foreground = &xml_content[start..];
        if let Some(drawable_start) = after_foreground.find("android:drawable=\"@") {
            let ref_start = drawable_start + 19; // "android:drawable=\"@" 的长度
            if let Some(ref_end) = after_foreground[ref_start..].find("\"") {
                let drawable_ref = &after_foreground[ref_start..ref_start + ref_end];
                return Some(drawable_ref.to_string());
            }
        }
    }
    None
}

// 获取所有APK列表
#[tauri::command]
fn get_apk_list(case_number: String) -> Result<Vec<serde_json::Value>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apks_dir = current_dir.join("case").join(&case_number).join("apks");

    if !apks_dir.exists() {
        return Ok(vec![]);
    }

    let mut apk_list = Vec::new();

    if let Ok(entries) = fs::read_dir(&apks_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let apk_dir = format!("case/{}/apks/{}", case_number, entry.file_name().to_string_lossy());
                if let Ok(info) = get_apk_info(apk_dir) {
                    apk_list.push(info);
                }
            }
        }
    }

    // 按时间戳降序排序
    apk_list.sort_by(|a, b| {
        let ts_a = a.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0);
        let ts_b = b.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0);
        ts_b.cmp(&ts_a)
    });

    Ok(apk_list)
}

// 从AndroidManifest.xml解析权限列表
fn parse_permissions_from_manifest(manifest_content: &str) -> Vec<String> {
    let mut permissions = Vec::new();

    // 使用正则表达式匹配 <uses-permission android:name="xxx" />
    let re = regex::Regex::new(r#"<uses-permission[^>]*android:name="([^"]+)"[^>]*/?\s*>"#).unwrap();

    for cap in re.captures_iter(manifest_content) {
        if let Some(perm) = cap.get(1) {
            permissions.push(perm.as_str().to_string());
        }
    }

    // 去重
    permissions.sort();
    permissions.dedup();

    permissions
}

// 获取APK权限列表
#[tauri::command]
fn get_apk_permissions(apk_dir: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let jadx_path = apk_dir_path.join("jadx");

    // 检查是否已反编译
    if !jadx_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK尚未反编译完成",
            "permissions": []
        }));
    }

    // 读取AndroidManifest.xml
    let manifest_path = jadx_path.join("resources").join("AndroidManifest.xml");
    if !manifest_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "未找到AndroidManifest.xml文件",
            "permissions": []
        }));
    }

    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("读取Manifest失败: {}", e))?;

    // 解析权限
    let raw_permissions = parse_permissions_from_manifest(&manifest_content);
    let permission_map = load_permission_map();

    // 构建权限信息列表
    let mut permissions: Vec<PermissionInfo> = Vec::new();

    for perm in raw_permissions {
        // 提取权限短名称（如从 android.permission.CAMERA 提取 CAMERA）
        let short_name = perm.split('.').last().unwrap_or(&perm).to_string();

        let (name_zh, description, level) = if let Some(entry) = permission_map.get(&short_name) {
            (entry.name_zh.clone(), entry.description.clone(), entry.level.clone())
        } else {
            // 未知权限
            let readable_name = short_name
                .replace("_", " ")
                .split_whitespace()
                .map(|word| {
                    let mut chars = word.chars();
                    match chars.next() {
                        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str().to_lowercase().as_str(),
                        None => String::new(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            (readable_name, format!("自定义权限: {}", perm), "other".to_string())
        };

        permissions.push(PermissionInfo {
            permission: perm,
            name: short_name,
            name_zh,
            description,
            level,
        });
    }

    // 按危险等级排序
    permissions.sort_by(|a, b| {
        let level_order = |l: &str| -> i32 {
            match l {
                "dangerous" => 0,
                "signature" => 1,
                "signature|privileged" => 2,
                "signature|privileged|development" => 3,
                "signature|privileged|appop" => 4,
                "signature|appop" => 5,
                "signature|preinstalled|knownSigner|role" => 6,
                "internal|role" => 7,
                "internal|privileged" => 8,
                "normal" => 9,
                "normal|instant" => 10,
                "normal|appop|instant" => 11,
                "other" => 12,
                _ => 13,
            }
        };
        level_order(&a.level).cmp(&level_order(&b.level))
    });

    // 统计各等级权限数量
    let mut level_stats: HashMap<String, usize> = HashMap::new();
    for perm in &permissions {
        *level_stats.entry(perm.level.clone()).or_insert(0) += 1;
    }

    Ok(json!({
        "success": true,
        "message": "成功",
        "permissions": permissions,
        "stats": {
            "total": permissions.len(),
            "levels": level_stats
        }
    }))
}

// 计算文件哈希值
fn calculate_file_hashes(file_path: &std::path::Path) -> Result<(String, String, String), String> {
    let mut file = fs::File::open(file_path).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

    // 计算MD5
    let md5_hash = format!("{:x}", md5::compute(&buffer));

    // 计算SHA1
    let mut sha1_hasher = Sha1::new();
    Sha1Digest::update(&mut sha1_hasher, &buffer);
    let sha1_hash = format!("{:x}", sha1_hasher.finalize());

    // 计算SHA256
    let mut sha256_hasher = Sha256::new();
    Digest::update(&mut sha256_hasher, &buffer);
    let sha256_hash = format!("{:x}", sha256_hasher.finalize());

    Ok((md5_hash, sha1_hash, sha256_hash))
}

// 解析apksigner输出
fn parse_apksigner_output(output: &str) -> serde_json::Value {
    use serde_json::json;

    let mut result = json!({
        "verified": false,
        "signatureSchemes": [],
        "signers": []
    });

    let lines: Vec<&str> = output.lines().collect();
    let mut signers: HashMap<usize, serde_json::Map<String, serde_json::Value>> = HashMap::new();

    for line in &lines {
        let line = line.trim();

        // 检查验证状态
        if line == "Verifies" {
            result["verified"] = json!(true);
        }

        // 检查签名方案
        if line.starts_with("Verified using v1 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v1 (JAR signing)"));
            }
        }
        if line.starts_with("Verified using v2 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v2 (APK Signature Scheme v2)"));
            }
        }
        if line.starts_with("Verified using v3 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v3 (APK Signature Scheme v3)"));
            }
        }
        if line.starts_with("Verified using v3.1 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v3.1 (APK Signature Scheme v3.1)"));
            }
        }
        if line.starts_with("Verified using v4 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v4 (APK Signature Scheme v4)"));
            }
        }

        // 解析签名者信息 - 格式: "Signer #1 certificate DN: xxx"
        if line.starts_with("Signer #") {
            // 提取签名者编号
            if let Some(num_end) = line[8..].find(' ') {
                if let Ok(signer_num) = line[8..8+num_end].parse::<usize>() {
                    let signer = signers.entry(signer_num).or_insert_with(serde_json::Map::new);

                    let rest = &line[8+num_end..].trim();

                    if rest.starts_with("certificate DN:") {
                        signer.insert("dn".to_string(), json!(rest[15..].trim()));
                    } else if rest.starts_with("certificate SHA-256 digest:") {
                        signer.insert("sha256Digest".to_string(), json!(rest[27..].trim()));
                    } else if rest.starts_with("certificate SHA-1 digest:") {
                        signer.insert("sha1Digest".to_string(), json!(rest[25..].trim()));
                    } else if rest.starts_with("certificate MD5 digest:") {
                        signer.insert("md5Digest".to_string(), json!(rest[23..].trim()));
                    } else if rest.starts_with("key algorithm:") {
                        signer.insert("keyAlgorithm".to_string(), json!(rest[14..].trim()));
                    } else if rest.starts_with("key size (bits):") {
                        signer.insert("keySize".to_string(), json!(rest[16..].trim()));
                    } else if rest.starts_with("public key SHA-256 digest:") {
                        signer.insert("publicKeySha256".to_string(), json!(rest[26..].trim()));
                    } else if rest.starts_with("public key SHA-1 digest:") {
                        signer.insert("publicKeySha1".to_string(), json!(rest[24..].trim()));
                    } else if rest.starts_with("public key MD5 digest:") {
                        signer.insert("publicKeyMd5".to_string(), json!(rest[22..].trim()));
                    }
                }
            }
        }
    }

    // 将签名者按编号排序并添加到结果中
    let mut signer_nums: Vec<usize> = signers.keys().cloned().collect();
    signer_nums.sort();

    let signers_array: Vec<serde_json::Value> = signer_nums
        .into_iter()
        .map(|num| json!(signers.remove(&num).unwrap()))
        .collect();

    result["signers"] = json!(signers_array);
    result
}

// 获取APK详细信息（哈希和签名）- 带缓存
#[tauri::command]
async fn get_apk_details(apk_dir: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let apk_path = apk_dir_path.join("base.apk");
    let details_cache_path = apk_dir_path.join("details.json");

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
        }));
    }

    // 检查是否有缓存文件
    if details_cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&details_cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<serde_json::Value>(&cache_content) {
                eprintln!("从缓存读取APK详细信息: {}", details_cache_path.display());
                return Ok(cached_data);
            }
        }
    }

    // 没有缓存，执行分析
    let result = analyze_apk_details(&apk_path, &current_dir).await?;

    // 保存到缓存文件
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        if let Err(e) = fs::write(&details_cache_path, &json_str) {
            eprintln!("保存详细信息缓存失败: {}", e);
        } else {
            eprintln!("已保存APK详细信息缓存: {}", details_cache_path.display());
        }
    }

    Ok(result)
}

// 分析APK详细信息（内部函数）
async fn analyze_apk_details(apk_path: &std::path::Path, current_dir: &std::path::Path) -> Result<serde_json::Value, String> {
    use serde_json::json;

    // 计算文件哈希
    let apk_path_clone = apk_path.to_path_buf();
    let hashes = tokio::task::spawn_blocking(move || {
        calculate_file_hashes(&apk_path_clone)
    }).await.map_err(|e| e.to_string())??;

    let (md5_hash, sha1_hash, sha256_hash) = hashes;

    // 使用apksigner分析签名
    let apksigner_exe = current_dir.join("apksigner\\apksigner.bat");
    let apk_path_for_sign = apk_path.to_path_buf();

    let signature_info = if apksigner_exe.exists() {
        let result = tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&apksigner_exe);
            cmd.arg("verify")
                .arg("--verbose")
                .arg("--print-certs")
                .arg(&apk_path_for_sign);

            // Windows平台：隐藏控制台窗口
            #[cfg(target_os = "windows")]
            {
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }

            let output = cmd.output().map_err(|e| e.to_string())?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let output_text = format!("{}\n{}", stdout, stderr);

            eprintln!("apksigner输出:\n{}", output_text);

            Ok::<String, String>(output_text)
        }).await.map_err(|e| e.to_string())?;

        match result {
            Ok(output) => parse_apksigner_output(&output),
            Err(e) => json!({
                "error": e,
                "verified": false,
                "signatureSchemes": [],
                "signers": []
            })
        }
    } else {
        json!({
            "error": "apksigner工具不存在",
            "verified": false,
            "signatureSchemes": [],
            "signers": []
        })
    };

    Ok(json!({
        "success": true,
        "hashes": {
            "md5": md5_hash,
            "sha1": sha1_hash,
            "sha256": sha256_hash
        },
        "signature": signature_info
    }))
}

// 预分析APK详细信息（上传时调用，异步不阻塞）
#[tauri::command]
async fn preanalyze_apk_details(apk_dir: String) -> Result<String, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let apk_path = apk_dir_path.join("base.apk");
    let details_cache_path = apk_dir_path.join("details.json");

    // 如果缓存已存在，跳过分析
    if details_cache_path.exists() {
        return Ok("cached".to_string());
    }

    if !apk_path.exists() {
        return Err("APK文件不存在".to_string());
    }

    eprintln!("开始预分析APK详细信息: {}", apk_path.display());

    // 执行分析
    let result = analyze_apk_details(&apk_path, &current_dir).await?;

    // 保存到缓存文件
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        fs::write(&details_cache_path, &json_str)
            .map_err(|e| format!("保存缓存失败: {}", e))?;
        eprintln!("已保存APK详细信息缓存: {}", details_cache_path.display());
    }

    Ok("analyzed".to_string())
}

// 文件树节点结构
#[derive(serde::Serialize, Clone)]
struct FileTreeNode {
    name: String,
    path: String,           // 相对路径
    is_dir: bool,
    has_children: bool,     // 是否有子节点（用于懒加载）
}

// 获取单层目录内容（懒加载）
fn get_directory_contents(dir_path: &std::path::Path, base_path: &std::path::Path) -> Result<Vec<FileTreeNode>, String> {
    let mut nodes = Vec::new();

    let entries = fs::read_dir(dir_path)
        .map_err(|e| format!("读取目录失败: {}", e))?;

    let mut entries: Vec<_> = entries
        .filter_map(|e| e.ok())
        .collect();

    // 排序：文件夹在前，文件在后，同类型按名称排序
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let relative_path = path.strip_prefix(base_path)
            .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
            .unwrap_or_default();

        let is_dir = path.is_dir();
        let has_children = if is_dir {
            // 检查是否有子项
            fs::read_dir(&path).map(|mut d| d.next().is_some()).unwrap_or(false)
        } else {
            false
        };

        nodes.push(FileTreeNode {
            name,
            path: relative_path,
            is_dir,
            has_children,
        });
    }

    Ok(nodes)
}

// 获取jadx反编译后的文件树（根目录）
#[tauri::command]
async fn get_jadx_file_tree(apk_dir: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let jadx_path = current_dir.join(&apk_dir).join("jadx");

    if !jadx_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "jadx目录不存在，请先反编译APK"
        }));
    }

    // 在后台线程中执行文件系统操作，避免阻塞主线程
    let jadx_path_clone = jadx_path.clone();
    let tree = tokio::task::spawn_blocking(move || {
        get_directory_contents(&jadx_path_clone, &jadx_path_clone)
    }).await.map_err(|e| e.to_string())??;

    Ok(json!({
        "success": true,
        "tree": tree
    }))
}

// 获取子目录内容（懒加载）
#[tauri::command]
async fn get_jadx_subdirectory(apk_dir: String, sub_path: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let jadx_path = current_dir.join(&apk_dir).join("jadx");
    let target_path = jadx_path.join(&sub_path);

    if !target_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "目录不存在"
        }));
    }

    if !target_path.is_dir() {
        return Ok(json!({
            "success": false,
            "message": "不是目录"
        }));
    }

    // 在后台线程中执行文件系统操作，避免阻塞主线程
    let jadx_path_clone = jadx_path.clone();
    let children = tokio::task::spawn_blocking(move || {
        get_directory_contents(&target_path, &jadx_path_clone)
    }).await.map_err(|e| e.to_string())??;

    Ok(json!({
        "success": true,
        "children": children
    }))
}

// 读取jadx目录下的文件内容
#[tauri::command]
async fn read_jadx_file(apk_dir: String, file_path: String, page: Option<usize>, page_size_kb: Option<usize>) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let full_path = current_dir.join(&apk_dir).join("jadx").join(&file_path);

    if !full_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "文件不存在"
        }));
    }

    if full_path.is_dir() {
        return Ok(json!({
            "success": false,
            "message": "不能读取目录"
        }));
    }

    // 获取文件扩展名
    let extension = full_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();

    // 先尝试以UTF-8读取
    match fs::read_to_string(&full_path) {
        Ok(content) => {
            Ok(json!({
                "success": true,
                "content": content,
                "extension": extension,
                "is_binary": false
            }))
        }
        Err(_) => {
            // UTF-8读取失败，以二进制方式读取（支持分页）
            let file_metadata = fs::metadata(&full_path)
                .map_err(|e| format!("获取文件元数据失败: {}", e))?;
            let total_size = file_metadata.len() as usize;

            // 分页参数（默认64KB每页）
            let page_size = (page_size_kb.unwrap_or(64)) * 1024;
            let current_page = page.unwrap_or(0);
            let total_pages = (total_size + page_size - 1) / page_size;

            // 计算读取范围
            let start_offset = current_page * page_size;
            let end_offset = std::cmp::min(start_offset + page_size, total_size);

            if start_offset >= total_size {
                return Ok(json!({
                    "success": false,
                    "message": "页码超出范围"
                }));
            }

            // 读取指定范围的字节
            let mut file = fs::File::open(&full_path)
                .map_err(|e| format!("打开文件失败: {}", e))?;

            use std::io::{Seek, SeekFrom};
            file.seek(SeekFrom::Start(start_offset as u64))
                .map_err(|e| format!("定位文件失败: {}", e))?;

            let bytes_to_read = end_offset - start_offset;
            let mut buffer = vec![0u8; bytes_to_read];
            file.read_exact(&mut buffer)
                .map_err(|e| format!("读取文件失败: {}", e))?;

            // 将字节转换为hex字符串数组（每行16字节）
            let hex_lines: Vec<String> = buffer.chunks(16)
                .map(|chunk| {
                    chunk.iter()
                        .map(|b| format!("{:02X}", b))
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect();

            // 原始字节数据（用于前端解码）
            let raw_bytes: Vec<u8> = buffer;

            Ok(json!({
                "success": true,
                "hex_lines": hex_lines,
                "raw_bytes": raw_bytes,
                "extension": extension,
                "is_binary": true,
                "file_size": total_size,
                "page": current_page,
                "page_size": page_size,
                "total_pages": total_pages,
                "start_offset": start_offset,
                "end_offset": end_offset
            }))
        }
    }
}

// 搜索结果结构
#[derive(serde::Serialize, Clone)]
struct SearchResult {
    file_path: String,      // 相对路径
    line_number: usize,
    line_content: String,
    match_start: usize,     // 匹配位置开始
    match_end: usize,       // 匹配位置结束
}

// 搜索jadx目录下的文件内容
#[tauri::command]
async fn search_jadx_files(apk_dir: String, query: String, max_results: Option<usize>) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let jadx_path = current_dir.join(&apk_dir).join("jadx");

    if !jadx_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "jadx目录不存在"
        }));
    }

    if query.is_empty() {
        return Ok(json!({
            "success": true,
            "results": []
        }));
    }

    let max_results = max_results.unwrap_or(500);
    let query_lower = query.to_lowercase();

    // 在后台线程中执行搜索
    let results = tokio::task::spawn_blocking(move || {
        let mut results: Vec<SearchResult> = Vec::new();
        search_in_directory(&jadx_path, &jadx_path, &query, &query_lower, &mut results, max_results);
        results
    }).await.map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "results": results,
        "total": results.len()
    }))
}

// 递归搜索目录
fn search_in_directory(
    dir_path: &std::path::Path,
    base_path: &std::path::Path,
    query: &str,
    query_lower: &str,
    results: &mut Vec<SearchResult>,
    max_results: usize,
) {
    if results.len() >= max_results {
        return;
    }

    let entries = match fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        if results.len() >= max_results {
            break;
        }

        let path = entry.path();

        if path.is_dir() {
            search_in_directory(&path, base_path, query, query_lower, results, max_results);
        } else {
            // 只搜索文本文件
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");

            let text_extensions = ["java", "kt", "xml", "json", "txt", "smali", "properties", "gradle", "pro", "cfg", "yml", "yaml", "md", "html", "css", "js"];
            if !text_extensions.contains(&ext) {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&path) {
                let relative_path = path.strip_prefix(base_path)
                    .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
                    .unwrap_or_default();

                for (line_num, line) in content.lines().enumerate() {
                    if results.len() >= max_results {
                        break;
                    }

                    let line_lower = line.to_lowercase();
                    if let Some(pos) = line_lower.find(query_lower) {
                        results.push(SearchResult {
                            file_path: relative_path.clone(),
                            line_number: line_num + 1,
                            line_content: line.to_string(),
                            match_start: pos,
                            match_end: pos + query.len(),
                        });
                    }
                }
            }
        }
    }
}

// 反编译APK文件（异步）
#[tauri::command]
async fn decompile_apk(apk_path: String, output_path: String) -> Result<String, String> {
    let current_dir = env::current_dir()
        .map_err(|e| e.to_string())?;

    // 构建jadx命令路径
    let jadx_exe = if cfg!(target_os = "windows") {
        current_dir.join("jadx\\bin\\jadx.bat")
    } else {
        current_dir.join("jadx/bin/jadx")
    };

    if !jadx_exe.exists() {
        return Err(format!("jadx执行文件不存在: {}", jadx_exe.display()));
    }

    // 规范化路径
    let apk_path = apk_path.replace("/", "\\");
    let output_path = output_path.replace("/", "\\");
    let apk_full_path = current_dir.join(&apk_path);
    let output_full_path = current_dir.join(&output_path);

    if !apk_full_path.exists() {
        return Err(format!("APK文件不存在: {}", apk_full_path.display()));
    }

    eprintln!("开始反编译APK: {}", apk_full_path.display());
    eprintln!("输出目录: {}", output_full_path.display());

    // 在异步任务中执行jadx命令
    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&jadx_exe);
        cmd.arg("-d")
            .arg(&output_full_path)
            .arg(&apk_full_path);

        // Windows平台：隐藏控制台窗口
        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let output_text = format!("{}\n{}", stdout, stderr);

        eprintln!("jadx输出:\n{}", output_text);

        // 只检查是否有真正的失败（Failed），而不是一般的 ERROR
        // "ERROR - finished with errors" 表示成功但有警告
        // "Failed to process" 表示真正的失败
        if output_text.contains("Failed to process") ||
           output_text.contains("zip END header not found") ||
           output_text.contains("No classes to decompile") {
            // 提取主要的错误信息
            let error_line = output_text
                .lines()
                .find(|line| line.contains("Failed") || line.contains("ZipException"))
                .unwrap_or("反编译失败");

            return Err(error_line.to_string());
        }

        eprintln!("APK反编译完成");
        Ok("success".to_string())
    }).await.map_err(|e| e.to_string())?;

    result
}

// 敏感信息结构体
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct SensitiveInfo {
    id: usize,              // 唯一ID
    content: String,        // 敏感信息内容
    category: String,       // 分类: url, ip, access_key, number
    file_path: String,      // 文件相对路径
    line_number: usize,     // 行号
    column_start: usize,    // 列开始位置
    column_end: usize,      // 列结束位置
}

// 敏感信息扫描结果
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct SensitiveResult {
    items: Vec<SensitiveInfo>,
    stats: HashMap<String, usize>,  // 各分类数量统计
    total: usize,
}

// 预编译的正则表达式（使用 lazy_static 或 once_cell）
use std::sync::OnceLock;

// 预编译正则：双引号字符串提取
fn get_string_regex() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r#""([^"\\]*(\\.[^"\\]*)*)""#).unwrap())
}

// 预编译正则：IPv4地址
fn get_ipv4_regex() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^(\d{1,3}\.){3}\d{1,3}(:\d+)?$").unwrap())
}

// 敏感信息扫描配置结构体
#[derive(serde::Deserialize, Clone, Default)]
struct SensitiveSettings {
    #[serde(default, rename = "urlWhitelist")]
    url_whitelist: Vec<String>,
    #[serde(default, rename = "ipWhitelist")]
    ip_whitelist: Vec<String>,
}

// 从settings.json加载敏感信息扫描配置
fn load_sensitive_settings() -> SensitiveSettings {
    let current_dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(_) => return SensitiveSettings::default(),
    };

    let settings_file = current_dir.join("settings.json");

    if let Ok(content) = fs::read_to_string(&settings_file) {
        if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(sensitive) = settings.get("sensitive") {
                if let Ok(sensitive_settings) = serde_json::from_value::<SensitiveSettings>(sensitive.clone()) {
                    return sensitive_settings;
                }
            }
        }
    }

    SensitiveSettings::default()
}

// 判断URL是否在白名单中
fn is_url_whitelisted(url: &str, whitelist: &[String]) -> bool {
    if whitelist.is_empty() {
        return false;
    }
    let url_lower = url.to_lowercase();
    for pattern in whitelist {
        if url_lower.contains(&pattern.to_lowercase()) {
            return true;
        }
    }
    false
}

// 判断IP是否在白名单中
fn is_ip_whitelisted(ip: &str, whitelist: &[String]) -> bool {
    if whitelist.is_empty() {
        return false;
    }
    // 提取IP部分（去掉端口）
    let ip_only = ip.split(':').next().unwrap_or(ip);
    whitelist.iter().any(|w| w == ip_only)
}

// 判断是否为URL（优化版，接受白名单参数）
fn is_url(s: &str, whitelist: &[String]) -> bool {
    let s_lower = s.to_lowercase();
    if !((s_lower.starts_with("http://") || s_lower.starts_with("https://") ||
          s_lower.starts_with("ftp://") || s_lower.starts_with("ws://") ||
          s_lower.starts_with("wss://")) && s.len() > 10) {
        return false;
    }

    // 检查白名单
    !is_url_whitelisted(s, whitelist)
}

// 判断是否为IP地址（优化版，使用预编译正则，接受白名单参数）
fn is_ip_address(s: &str, whitelist: &[String]) -> bool {
    let ipv4_re = get_ipv4_regex();
    if !ipv4_re.is_match(s) {
        return false;
    }

    let ip_only = s.split(':').next().unwrap_or("");
    let parts: Vec<&str> = ip_only.split('.').collect();
    if parts.len() != 4 {
        return false;
    }

    // 验证每个部分是有效的0-255
    if !parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        return false;
    }

    // 检查白名单
    !is_ip_whitelisted(s, whitelist)
}

// 判断是否为AccessKey相关（优化版）
fn is_access_key(s: &str, context: &str) -> bool {
    // 快速长度检查
    if s.len() < 16 || s.len() > 128 {
        return false;
    }

    // 直接检查字符串本身是否看起来像密钥前缀
    if s.len() >= 20 && s.len() <= 64 {
        // AWS风格的密钥
        if s.starts_with("AKIA") || s.starts_with("ASIA") || s.starts_with("AIDA") {
            return true;
        }
        // 阿里云风格
        if s.starts_with("LTAI") {
            return true;
        }
        // 腾讯云风格
        if s.starts_with("AKID") {
            return true;
        }
    }

    // 检查字符串是否看起来像一个密钥值（字母数字混合）
    if !s.chars().all(|c| c.is_alphanumeric() || c == '+' || c == '/' || c == '=' || c == '-' || c == '_') {
        return false;
    }

    let context_lower = context.to_lowercase();

    // 快速检查上下文中是否包含key相关的关键词
    const KEY_PATTERNS: &[&str] = &[
        "accesskey", "access_key", "secretkey", "secret_key",
        "appsecret", "app_secret", "appkey", "app_key",
        "api_key", "apikey", "private_key", "privatekey",
        "aws_key", "token", "credential",
    ];

    for pattern in KEY_PATTERNS {
        if context_lower.contains(pattern) {
            return true;
        }
    }

    false
}

// 判断是否为纯数字字符串（可能是ID、手机号等）
fn is_number_string(s: &str) -> bool {
    let len = s.len();
    if len < 6 || len > 20 {
        return false;
    }

    // 快速检查：使用bytes避免UTF-8解码开销
    s.bytes().all(|b| b.is_ascii_digit())
}

// 从源码中提取字符串（优化版，使用预编译正则）
fn extract_strings_from_content(content: &str) -> Vec<(String, usize, usize, usize)> {
    let mut strings = Vec::new();
    let string_re = get_string_regex();

    for (line_num, line) in content.lines().enumerate() {
        // 快速跳过：如果行中没有双引号，直接跳过
        if !line.contains('"') {
            continue;
        }

        for cap in string_re.captures_iter(line) {
            if let Some(m) = cap.get(1) {
                let s = m.as_str();
                // 忽略太短或太长的字符串
                if s.len() >= 6 && s.len() <= 2000 {
                    strings.push((s.to_string(), line_num + 1, m.start(), m.end()));
                }
            }
        }
    }

    strings
}

// 分类敏感信息（优化版，接受配置参数）
fn categorize_sensitive(s: &str, line_content: &str, settings: &SensitiveSettings) -> Option<String> {
    // 快速预检查 - 如果字符串太短，直接跳过大部分检查
    if s.len() < 6 {
        return None;
    }

    // 按优先级和可能性检查
    // URL通常以 http 开头，快速检查
    if s.len() > 10 {
        let s_lower_start = s.get(0..5).map(|x| x.to_lowercase());
        if let Some(start) = s_lower_start {
            if start.starts_with("http") || start.starts_with("ftp:") || start.starts_with("ws:/") || start.starts_with("wss:") {
                if is_url(s, &settings.url_whitelist) {
                    return Some("url".to_string());
                }
            }
        }
    }

    // IP地址检查 - 快速预检查是否以数字开头
    if s.len() >= 7 && s.len() <= 21 {
        let first_char = s.chars().next();
        if let Some(c) = first_char {
            if c.is_ascii_digit() && is_ip_address(s, &settings.ip_whitelist) {
                return Some("ip".to_string());
            }
        }
    }

    // AccessKey检查
    if is_access_key(s, line_content) {
        return Some("access_key".to_string());
    }

    // 纯数字检查
    if is_number_string(s) {
        return Some("number".to_string());
    }

    None
}

// 递归收集所有需要扫描的文件路径
fn collect_files_to_scan(dir_path: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
    let entries = match fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return,
    };

    // 扫描的文件扩展名
    const TEXT_EXTENSIONS: &[&str] = &["java", "kt", "xml", "json", "smali", "properties", "gradle", "js"];

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();

        if path.is_dir() {
            collect_files_to_scan(&path, files);
        } else {
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");

            if TEXT_EXTENSIONS.contains(&ext) {
                files.push(path);
            }
        }
    }
}

// 使用内存映射读取文件内容为字符串
fn read_file_with_mmap(file_path: &std::path::Path) -> Option<String> {
    use memmap2::Mmap;

    let file = fs::File::open(file_path).ok()?;
    let metadata = file.metadata().ok()?;

    // 对于小文件（<64KB），直接使用普通读取更高效
    if metadata.len() < 64 * 1024 {
        return fs::read_to_string(file_path).ok();
    }

    // 对于大文件，使用内存映射
    let mmap = unsafe { Mmap::map(&file).ok()? };

    // 尝试作为UTF-8解析
    std::str::from_utf8(&mmap).ok().map(|s| s.to_string())
}

// 扫描单个文件的敏感信息（优化版，使用内存映射）
fn scan_file_for_sensitive(
    file_path: &std::path::Path,
    base_path: &std::path::Path,
    settings: &SensitiveSettings,
) -> Vec<SensitiveInfo> {
    let mut results = Vec::new();

    // 使用内存映射读取文件
    let content = match read_file_with_mmap(file_path) {
        Some(c) => c,
        None => return results,
    };

    let relative_path = file_path.strip_prefix(base_path)
        .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
        .unwrap_or_default();

    let lines: Vec<&str> = content.lines().collect();
    let extracted = extract_strings_from_content(&content);

    for (s, line_num, col_start, col_end) in extracted {
        let line_content = lines.get(line_num - 1).unwrap_or(&"");

        if let Some(category) = categorize_sensitive(&s, line_content, settings) {
            results.push(SensitiveInfo {
                id: 0,  // ID will be assigned later
                content: s,
                category,
                file_path: relative_path.clone(),
                line_number: line_num,
                column_start: col_start,
                column_end: col_end,
            });
        }
    }

    results
}

// 扫描APK敏感信息
#[tauri::command]
async fn scan_sensitive_info(apk_dir: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let jadx_path = apk_dir_path.join("jadx");
    let cache_path = apk_dir_path.join("sensitive.json");

    // 检查是否已反编译
    if !jadx_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK尚未反编译完成"
        }));
    }

    // 检查缓存
    if cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<SensitiveResult>(&cache_content) {
                eprintln!("从缓存读取敏感信息: {}", cache_path.display());
                return Ok(json!({
                    "success": true,
                    "data": cached_data,
                    "cached": true
                }));
            }
        }
    }

    // 加载扫描配置
    let settings = load_sensitive_settings();
    eprintln!("URL白名单: {} 条, IP白名单: {} 条", settings.url_whitelist.len(), settings.ip_whitelist.len());

    // 在后台线程中执行扫描（使用rayon多线程）
    let jadx_path_clone = jadx_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        use rayon::prelude::*;

        // 第一步：收集所有需要扫描的文件
        let mut files: Vec<std::path::PathBuf> = Vec::new();
        collect_files_to_scan(&jadx_path_clone, &mut files);

        eprintln!("收集到 {} 个文件待扫描", files.len());

        // 第二步：使用rayon并行扫描所有文件
        let all_results: Vec<Vec<SensitiveInfo>> = files
            .par_iter()
            .map(|file_path| scan_file_for_sensitive(file_path, &jadx_path_clone, &settings))
            .collect();

        // 第三步：合并结果并分配ID
        let mut items: Vec<SensitiveInfo> = Vec::new();
        let mut id_counter: usize = 0;

        for mut file_results in all_results {
            for item in &mut file_results {
                item.id = id_counter;
                id_counter += 1;
            }
            items.extend(file_results);
        }

        eprintln!("扫描完成，共发现 {} 条敏感信息", items.len());

        // 统计各分类数量
        let mut stats: HashMap<String, usize> = HashMap::new();
        for item in &items {
            *stats.entry(item.category.clone()).or_insert(0) += 1;
        }

        SensitiveResult {
            total: items.len(),
            items,
            stats,
        }
    }).await.map_err(|e| e.to_string())?;

    // 保存到缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        if let Err(e) = fs::write(&cache_path, &json_str) {
            eprintln!("保存敏感信息缓存失败: {}", e);
        } else {
            eprintln!("已保存敏感信息缓存: {}", cache_path.display());
        }
    }

    Ok(json!({
        "success": true,
        "data": result,
        "cached": false
    }))
}

// 获取敏感信息（分页）
#[tauri::command]
async fn get_sensitive_info(apk_dir: String, page: usize, page_size: usize, category: Option<String>) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let cache_path = current_dir.join(&apk_dir).join("sensitive.json");

    if !cache_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "请先扫描敏感信息"
        }));
    }

    let cache_content = fs::read_to_string(&cache_path)
        .map_err(|e| format!("读取缓存失败: {}", e))?;

    let data: SensitiveResult = serde_json::from_str(&cache_content)
        .map_err(|e| format!("解析缓存失败: {}", e))?;

    // 过滤分类
    let filtered: Vec<&SensitiveInfo> = if let Some(ref cat) = category {
        if cat == "all" {
            data.items.iter().collect()
        } else {
            data.items.iter().filter(|item| &item.category == cat).collect()
        }
    } else {
        data.items.iter().collect()
    };

    let total = filtered.len();
    let total_pages = (total + page_size - 1) / page_size;

    // 分页
    let start = page * page_size;
    let end = std::cmp::min(start + page_size, total);

    let page_items: Vec<&SensitiveInfo> = if start < total {
        filtered[start..end].to_vec()
    } else {
        vec![]
    };

    Ok(json!({
        "success": true,
        "items": page_items,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": total_pages,
        "stats": data.stats
    }))
}

// Ping IP地址检测是否可达
#[tauri::command]
async fn ping_ip(ip: String) -> Result<serde_json::Value, String> {
    use std::time::Duration;

    // Windows ping命令：-n 1 发送1个包，-w 1000 超时1秒
    #[cfg(target_os = "windows")]
    let output = Command::new("ping")
        .args(&["-n", "1", "-w", "1000", &ip])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    // Linux/macOS ping命令：-c 1 发送1个包，-W 1 超时1秒
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("ping")
        .args(&["-c", "1", "-W", "1", &ip])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(out) => {
            let success = out.status.success();
            Ok(json!({
                "ip": ip,
                "reachable": success
            }))
        },
        Err(e) => {
            Ok(json!({
                "ip": ip,
                "reachable": false,
                "error": e.to_string()
            }))
        }
    }
}

// 检查端口是否空闲
fn is_port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            scrcpy_processes: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            write_file, write_binary_file, set_title, show_window, close_splash_show_main, read_file, delete_file, delete_dir, create_dir, read_dirs, save_excel_file, read_excel_file, file_exists, open_file, delete_path, check_adb_devices, install_apk, start_scrcpy, stop_scrcpy, is_scrcpy_ready, cleanup_residual_processes, get_current_dir, get_apk_info, get_apk_list, decompile_apk, get_apk_permissions, get_apk_details, preanalyze_apk_details, get_jadx_file_tree, get_jadx_subdirectory, read_jadx_file, search_jadx_files, scan_sensitive_info, get_sensitive_info, ping_ip
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
