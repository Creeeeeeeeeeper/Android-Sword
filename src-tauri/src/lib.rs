use std::fs;
use std::path::Path;
use tauri::{AppHandle, Runtime, Manager};
use std::env;
use std::sync::Mutex;
use std::process::{Child, Command, Stdio};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, mpsc};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// 应用状态结构体
struct AppState {
    scrcpy_processes: Mutex<HashMap<String, Child>>,
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
            write_file, write_binary_file, set_title, show_window, close_splash_show_main, read_file, delete_file, delete_dir, create_dir, read_dirs, save_excel_file, read_excel_file, file_exists, open_file, delete_path, check_adb_devices, install_apk, start_scrcpy, stop_scrcpy, is_scrcpy_ready, cleanup_residual_processes, get_current_dir, get_apk_info, get_apk_list, decompile_apk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
