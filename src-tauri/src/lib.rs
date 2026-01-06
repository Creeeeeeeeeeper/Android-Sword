use std::fs;
use std::path::Path;
use tauri::{AppHandle, Runtime, Manager};
use std::env;
use std::sync::Mutex;
use std::process::{Child, Command, Stdio};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, mpsc};
use md5;
use sha1::{Sha1, Digest as Sha1Digest};
use sha2::{Sha256, Digest};
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Frida进程输出缓冲结构
struct FridaOutputBuffer {
    lines: Vec<FridaOutputLine>,
    finished: bool,
}

#[derive(serde::Serialize, Clone)]
struct FridaOutputLine {
    content: String,
    #[serde(rename = "type")]
    line_type: String,
}

// 应用状态结构体
struct AppState {
    scrcpy_processes: Mutex<HashMap<String, Child>>,
    capture_processes: Mutex<HashMap<String, Child>>,
    frida_processes: Mutex<HashMap<String, Child>>,
    frida_outputs: Mutex<HashMap<String, FridaOutputBuffer>>,
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

// 复制文件（用于大文件复制，避免通过JS传输）
#[tauri::command]
fn copy_file(source: &str, destination: &str) -> Result<String, String> {
    match fs::copy(source, destination) {
        Ok(_) => Ok("s".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

// 选择APK文件对话框
#[tauri::command]
async fn select_apk_file(app: AppHandle<impl Runtime>) -> Result<Option<String>, String> {
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

// 检查APK是否已安装在设备上
#[tauri::command]
async fn check_apk_installed(package_name: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb\\adb.exe");

    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&adb_exe);
        cmd.args(&["shell", "pm", "list", "packages", &package_name]);

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&output.stdout);

        // 检查是否包含精确的包名
        let is_installed = stdout.lines().any(|line| {
            line.trim() == format!("package:{}", package_name)
        });

        Ok::<bool, String>(is_installed)
    }).await.map_err(|e| e.to_string())??;

    Ok(json!({
        "installed": result
    }))
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

// 辅助函数：带超时执行命令（不等待结果，fire-and-forget）
#[cfg(target_os = "windows")]
fn run_command_fire_and_forget(mut cmd: Command) {
    match cmd.spawn() {
        Ok(_child) => {
            // 不等待，让进程在后台运行
            // 注意：这里不调用 wait()，进程会成为孤儿进程，由系统接管
        }
        Err(e) => {
            eprintln!("启动命令失败: {}", e);
        }
    }
}

// 辅助函数：带超时执行命令
#[cfg(target_os = "windows")]
fn run_command_with_timeout(mut cmd: Command, timeout_ms: u64) -> bool {
    match cmd.spawn() {
        Ok(mut child) => {
            // 使用循环检查进程状态，实现超时
            let start = std::time::Instant::now();
            let timeout = std::time::Duration::from_millis(timeout_ms);

            loop {
                match child.try_wait() {
                    Ok(Some(_status)) => {
                        // 进程已结束
                        return true;
                    }
                    Ok(None) => {
                        // 进程还在运行，检查超时
                        if start.elapsed() > timeout {
                            eprintln!("命令执行超时，强制终止");
                            let _ = child.kill();
                            let _ = child.wait();
                            return false;
                        }
                        // 短暂休眠避免忙等待
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(e) => {
                        eprintln!("检查进程状态失败: {}", e);
                        let _ = child.kill();
                        return false;
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("启动命令失败: {}", e);
            false
        }
    }
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

        // 杀死所有残留的python抓包进程
        let mut cmd3 = Command::new("taskkill");
        cmd3.args(&["/F", "/IM", "python.exe"])
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd3.output();

        // 在后台线程中异步清理设备上的frida-server，不阻塞主流程
        std::thread::spawn(move || {
            let current_dir = match std::env::current_dir() {
                Ok(dir) => dir,
                Err(_) => return,
            };

            let adb_exe = current_dir.join("adb").join("adb.exe");
            if !adb_exe.exists() {
                return;
            }

            // 启动adb服务（带超时，1秒）
            let mut adb_start = Command::new(&adb_exe);
            adb_start.arg("start-server")
                .creation_flags(CREATE_NO_WINDOW);
            run_command_with_timeout(adb_start, 1000);

            // 短暂等待
            std::thread::sleep(std::time::Duration::from_millis(200));

            // 快速检查是否有设备连接（超时500ms）
            let mut check_devices = Command::new(&adb_exe);
            check_devices.args(&["devices"])
                .creation_flags(CREATE_NO_WINDOW);

            // 使用spawn + 超时检查，而不是阻塞的output()
            let has_device = match check_devices.spawn() {
                Ok(mut child) => {
                    let start = std::time::Instant::now();
                    loop {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                if status.success() {
                                    // 进程成功结束，但我们没有获取输出
                                    // 简单假设有设备（因为adb server启动了）
                                    break true;
                                }
                                break false;
                            }
                            Ok(None) => {
                                if start.elapsed() > std::time::Duration::from_millis(500) {
                                    let _ = child.kill();
                                    let _ = child.wait();
                                    break false;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(50));
                            }
                            Err(_) => {
                                let _ = child.kill();
                                break false;
                            }
                        }
                    }
                }
                Err(_) => false
            };

            if has_device {
                // 使用 fire-and-forget 方式发送 kill 命令，不等待结果
                // 方式1: 使用 su -c pkill
                let mut adb_kill = Command::new(&adb_exe);
                adb_kill.args(&["shell", "su", "-c", "pkill -9 frida-server"])
                    .creation_flags(CREATE_NO_WINDOW);
                run_command_fire_and_forget(adb_kill);

                // 方式2: 使用 su -c killall
                let mut adb_kill2 = Command::new(&adb_exe);
                adb_kill2.args(&["shell", "su", "-c", "killall frida-server"])
                    .creation_flags(CREATE_NO_WINDOW);
                run_command_fire_and_forget(adb_kill2);

                eprintln!("已发送frida-server清理命令");
            } else {
                eprintln!("没有检测到已连接的设备，跳过frida-server清理");
            }
        });

        // 立即返回，不等待后台线程
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

        let _ = Command::new("pkill")
            .args(&["-f", "python"])
            .output();

        // 在后台线程中异步清理frida-server
        std::thread::spawn(|| {
            if let Ok(output) = Command::new("adb").args(&["devices"]).output() {
                let output_str = String::from_utf8_lossy(&output.stdout);
                let has_device = output_str.lines()
                    .skip(1)
                    .any(|line| !line.trim().is_empty() && line.contains("device"));

                if has_device {
                    let _ = Command::new("adb")
                        .args(&["shell", "su", "-c", "pkill -9 frida-server"])
                        .spawn();

                    let _ = Command::new("adb")
                        .args(&["shell", "su", "-c", "killall frida-server"])
                        .spawn();

                    eprintln!("已发送frida-server清理命令");
                }
            }
        });

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
    let mut version_code = String::new();
    let mut min_sdk = String::new();
    let mut target_sdk = String::new();
    let mut main_activity = String::new();
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

            // 获取versionCode
            if let Some(start) = manifest_content.find("android:versionCode=\"") {
                let start = start + 21;
                if let Some(end) = manifest_content[start..].find("\"") {
                    version_code = manifest_content[start..start+end].to_string();
                }
            }

            // 获取minSdkVersion
            if let Some(start) = manifest_content.find("android:minSdkVersion=\"") {
                let start = start + 23;
                if let Some(end) = manifest_content[start..].find("\"") {
                    min_sdk = manifest_content[start..start+end].to_string();
                }
            }

            // 获取targetSdkVersion
            if let Some(start) = manifest_content.find("android:targetSdkVersion=\"") {
                let start = start + 26;
                if let Some(end) = manifest_content[start..].find("\"") {
                    target_sdk = manifest_content[start..start+end].to_string();
                }
            }

            // 获取入口Activity（带有MAIN和LAUNCHER的activity）
            // 查找包含android.intent.action.MAIN的activity
            let mut pos = 0;
            while let Some(activity_start) = manifest_content[pos..].find("<activity") {
                let activity_start = pos + activity_start;
                // 找到这个activity标签的结束位置
                if let Some(activity_end) = manifest_content[activity_start..].find("</activity>") {
                    let activity_end = activity_start + activity_end + 11;
                    let activity_block = &manifest_content[activity_start..activity_end];

                    // 检查是否包含MAIN action和LAUNCHER category
                    if activity_block.contains("android.intent.action.MAIN") &&
                       activity_block.contains("android.intent.category.LAUNCHER") {
                        // 提取activity的name属性
                        if let Some(name_start) = activity_block.find("android:name=\"") {
                            let name_start = name_start + 14;
                            if let Some(name_end) = activity_block[name_start..].find("\"") {
                                main_activity = activity_block[name_start..name_start+name_end].to_string();
                                break;
                            }
                        }
                    }
                    pos = activity_end;
                } else {
                    break;
                }
            }

            // 获取 <application> 标签的内容，从中提取 label 和 icon
            if let Some(app_start) = manifest_content.find("<application") {
                // 找到 <application 标签的结束位置（第一个 >）
                let app_tag_end = manifest_content[app_start..].find('>').map(|p| app_start + p).unwrap_or(manifest_content.len());
                let app_tag = &manifest_content[app_start..app_tag_end];

                // 从 <application> 标签中获取 label
                if let Some(label_start) = app_tag.find("android:label=\"") {
                    let label_start = label_start + 15;
                    if let Some(label_end) = app_tag[label_start..].find("\"") {
                        let label = &app_tag[label_start..label_start+label_end];
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

                // 从 <application> 标签中获取 icon 引用
                if let Some(icon_start) = app_tag.find("android:icon=\"@") {
                    let icon_start = icon_start + 15;
                    if let Some(icon_end) = app_tag[icon_start..].find("\"") {
                        icon_ref = app_tag[icon_start..icon_start+icon_end].to_string();
                    }
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
        "versionCode": version_code,
        "minSdk": min_sdk,
        "targetSdk": target_sdk,
        "mainActivity": main_activity,
        "iconPath": icon_path
    }))
}

// 从strings.xml解析字符串资源
fn resolve_string_resource(jadx_path: &std::path::Path, string_name: &str) -> Option<String> {
    let res_path = jadx_path.join("resources").join("res");

    // 尝试不同的values目录（优先中文）
    let values_dirs = vec!["values-zh-rCN", "values-zh", "values", "values-en"];

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

// 解析AndroidManifest.xml中的四大组件
fn parse_android_components(manifest_content: &str) -> serde_json::Value {
    use serde_json::json;

    let mut activities: Vec<String> = Vec::new();
    let mut services: Vec<String> = Vec::new();
    let mut receivers: Vec<String> = Vec::new();
    let mut providers: Vec<String> = Vec::new();

    // 解析 Activity
    let mut pos = 0;
    while let Some(start) = manifest_content[pos..].find("<activity") {
        let start = pos + start;
        // 查找 android:name 属性
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    activities.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    // 解析 Service
    pos = 0;
    while let Some(start) = manifest_content[pos..].find("<service") {
        let start = pos + start;
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    services.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    // 解析 Receiver (BroadcastReceiver)
    pos = 0;
    while let Some(start) = manifest_content[pos..].find("<receiver") {
        let start = pos + start;
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    receivers.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    // 解析 Provider (ContentProvider)
    pos = 0;
    while let Some(start) = manifest_content[pos..].find("<provider") {
        let start = pos + start;
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    providers.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    json!({
        "activities": activities,
        "services": services,
        "receivers": receivers,
        "providers": providers
    })
}

// 从文件加载第三方服务特征库
fn load_third_party_services_database(current_dir: &std::path::Path) -> Result<serde_json::Value, String> {
    let db_path = current_dir.join("prefile").join("third_party_services.json");

    if !db_path.exists() {
        return Err("第三方服务特征库文件不存在".to_string());
    }

    let content = fs::read_to_string(&db_path)
        .map_err(|e| format!("读取特征库文件失败: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("解析特征库JSON失败: {}", e))
}

// 分析第三方服务
#[tauri::command]
async fn analyze_third_party_services(apk_dir: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let jadx_path = apk_dir_path.join("jadx");
    let sources_path = jadx_path.join("sources");
    let cache_path = apk_dir_path.join("third_party_services.json");

    // 检查缓存
    if cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<serde_json::Value>(&cache_content) {
                return Ok(cached_data);
            }
        }
    }

    if !sources_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "源码目录不存在，请先反编译APK"
        }));
    }

    // 从文件加载特征库
    let database = load_third_party_services_database(&current_dir)?;

    // 扫描源码目录，收集所有包名
    let mut found_packages: HashSet<String> = HashSet::new();
    scan_packages_recursive(&sources_path, &sources_path, &mut found_packages);

    // 匹配结果
    let mut packers: Vec<serde_json::Value> = Vec::new();
    let mut sdks: Vec<serde_json::Value> = Vec::new();
    let mut forensics: Vec<serde_json::Value> = Vec::new();
    let mut libraries: Vec<serde_json::Value> = Vec::new();

    // 用于去重
    let mut matched_names: HashSet<String> = HashSet::new();

    // 匹配打包服务商
    if let Some(packer_list) = database["packers"].as_array() {
        for packer in packer_list {
            if let Some(pkg) = packer["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = packer["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("packer_{}", name)) {
                            matched_names.insert(format!("packer_{}", name));
                            packers.push(packer.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    // 匹配SDK服务商
    if let Some(sdk_list) = database["sdks"].as_array() {
        for sdk in sdk_list {
            if let Some(pkg) = sdk["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = sdk["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("sdk_{}", name)) {
                            matched_names.insert(format!("sdk_{}", name));
                            sdks.push(sdk.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    // 匹配调证值相关
    if let Some(forensic_list) = database["forensics"].as_array() {
        for forensic in forensic_list {
            if let Some(pkg) = forensic["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = forensic["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("forensic_{}", name)) {
                            matched_names.insert(format!("forensic_{}", name));
                            forensics.push(forensic.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    // 匹配第三方库
    if let Some(lib_list) = database["libraries"].as_array() {
        for lib in lib_list {
            if let Some(pkg) = lib["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = lib["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("lib_{}", name)) {
                            matched_names.insert(format!("lib_{}", name));
                            libraries.push(lib.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    let result = json!({
        "success": true,
        "packers": packers,
        "sdks": sdks,
        "forensics": forensics,
        "libraries": libraries,
        "summary": {
            "packersCount": packers.len(),
            "sdksCount": sdks.len(),
            "forensicsCount": forensics.len(),
            "librariesCount": libraries.len()
        }
    });

    // 保存缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        let _ = fs::write(&cache_path, &json_str);
    }

    Ok(result)
}

// 递归扫描包目录
fn scan_packages_recursive(base_path: &std::path::Path, current_path: &std::path::Path, packages: &mut HashSet<String>) {
    if let Ok(entries) = fs::read_dir(current_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // 获取相对路径作为包名
                if let Ok(relative) = path.strip_prefix(base_path) {
                    let pkg_path = relative.to_string_lossy().replace('\\', "/");
                    packages.insert(pkg_path);
                }
                // 递归扫描
                scan_packages_recursive(base_path, &path, packages);
            }
        }
    }
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
                // 检查缓存是否包含有效的components字段
                // 如果components存在但所有数组都为空，且AndroidManifest.xml存在，则需要重新分析
                if let Some(components) = cached_data.get("components") {
                    let activities = components.get("activities").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    let services = components.get("services").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    let receivers = components.get("receivers").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    let providers = components.get("providers").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);

                    let total_components = activities + services + receivers + providers;

                    // 如果组件不为空，直接返回缓存
                    if total_components > 0 {
                        eprintln!("从缓存读取APK详细信息: {}", details_cache_path.display());
                        return Ok(cached_data);
                    }

                    // 如果组件为空，检查AndroidManifest.xml是否存在
                    let manifest_path = apk_dir_path.join("jadx/resources/AndroidManifest.xml");
                    if !manifest_path.exists() {
                        // AndroidManifest.xml不存在，说明还没反编译完成，返回缓存的空数据
                        eprintln!("AndroidManifest.xml不存在，返回缓存: {}", details_cache_path.display());
                        return Ok(cached_data);
                    }

                    // AndroidManifest.xml存在但组件为空，需要重新分析
                    eprintln!("缓存的components为空但AndroidManifest.xml存在，重新分析: {}", details_cache_path.display());
                } else {
                    eprintln!("缓存缺少components字段，重新分析: {}", details_cache_path.display());
                }
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

    // 解析四大组件
    // 从apk_path获取apk目录，然后找到jadx目录下的AndroidManifest.xml
    let apk_dir = apk_path.parent().unwrap_or(std::path::Path::new(""));
    let manifest_path = apk_dir.join("jadx").join("resources").join("AndroidManifest.xml");

    let components = if manifest_path.exists() {
        if let Ok(manifest_content) = fs::read_to_string(&manifest_path) {
            parse_android_components(&manifest_content)
        } else {
            json!({
                "activities": [],
                "services": [],
                "receivers": [],
                "providers": []
            })
        }
    } else {
        json!({
            "activities": [],
            "services": [],
            "receivers": [],
            "providers": []
        })
    };

    Ok(json!({
        "success": true,
        "hashes": {
            "md5": md5_hash,
            "sha1": sha1_hash,
            "sha256": sha256_hash
        },
        "components": components,
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

// ===================== 网络抓包模块 =====================

// 获取设备上安装的APP列表
#[tauri::command]
async fn get_device_apps() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb").join("adb.exe");

    if !adb_exe.exists() {
        return Err("ADB工具不存在".to_string());
    }

    // 获取第三方应用列表
    let output = Command::new(&adb_exe)
        .args(&["shell", "pm", "list", "packages", "-3"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("执行ADB命令失败: {}", e))?;

    if !output.status.success() {
        return Err("获取APP列表失败，请确保设备已连接".to_string());
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    let mut apps: Vec<serde_json::Value> = Vec::new();

    for line in output_str.lines() {
        if let Some(package) = line.strip_prefix("package:") {
            let package = package.trim();
            if !package.is_empty() {
                // 获取应用名称
                let label_output = Command::new(&adb_exe)
                    .args(&["shell", "pm", "dump", package, "|", "grep", "-m1", "application-label:"])
                    .creation_flags(0x08000000)
                    .output();

                let app_name = if let Ok(label_out) = label_output {
                    let label_str = String::from_utf8_lossy(&label_out.stdout);
                    label_str.lines()
                        .find(|l| l.contains("application-label:"))
                        .and_then(|l| l.strip_prefix("application-label:"))
                        .map(|s| s.trim().trim_matches('\'').to_string())
                        .unwrap_or_else(|| package.to_string())
                } else {
                    package.to_string()
                };

                apps.push(json!({
                    "package": package,
                    "name": app_name
                }));
            }
        }
    }

    // 按包名排序
    apps.sort_by(|a, b| {
        let pkg_a = a.get("package").and_then(|v| v.as_str()).unwrap_or("");
        let pkg_b = b.get("package").and_then(|v| v.as_str()).unwrap_or("");
        pkg_a.cmp(pkg_b)
    });

    Ok(json!({
        "success": true,
        "apps": apps
    }))
}

// 检查Frida环境是否就绪
#[tauri::command]
async fn check_frida_env() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let frida_venv = current_dir.join("frida").join("frida").join("venv");

    let (frida_exe, frida_python) = if cfg!(target_os = "windows") {
        (frida_venv.join("Scripts").join("frida.exe"), frida_venv.join("Scripts").join("python.exe"))
    } else {
        (frida_venv.join("bin").join("frida"), frida_venv.join("bin").join("python"))
    };

    // 检查虚拟环境和frida.exe是否存在
    if !frida_venv.exists() || !frida_exe.exists() {
        return Ok(json!({
            "ready": false,
            "version": null
        }));
    }

    // 检查frida版本
    let output = Command::new(&frida_python)
        .args(&["-c", "import frida; print(frida.__version__)"])
        .creation_flags(0x08000000)
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            return Ok(json!({
                "ready": true,
                "version": version
            }));
        }
    }

    Ok(json!({
        "ready": false,
        "version": null
    }))
}

// 初始化Frida环境（创建虚拟环境并安装所需库）
#[tauri::command]
async fn init_frida_env() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let frida_dir = current_dir.join("frida").join("frida");
    let frida_venv = frida_dir.join("venv");

    // 确保目录存在
    fs::create_dir_all(&frida_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    // 获取虚拟环境中的pip路径
    let pip_exe = if cfg!(target_os = "windows") {
        frida_venv.join("Scripts").join("pip.exe")
    } else {
        frida_venv.join("bin").join("pip")
    };

    // 检查虚拟环境是否已存在
    if !pip_exe.exists() {
        // 创建虚拟环境
        eprintln!("正在创建Python虚拟环境...");
        let venv_result = Command::new("python")
            .args(&["-m", "venv", frida_venv.to_str().unwrap()])
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| format!("创建虚拟环境失败: {}", e))?;

        if !venv_result.success() {
            return Err("创建虚拟环境失败".to_string());
        }
    } else {
        eprintln!("虚拟环境已存在，跳过创建...");
    }

    // 先升级pip
    eprintln!("正在升级pip...");
    let _ = Command::new(&pip_exe)
        .args(&["install", "--upgrade", "pip"])
        .creation_flags(0x08000000)
        .status();

    // 定义需要安装的包列表
    let packages = vec![
        "frida==17.5.2",
        "frida-tools==13.5.2",
        "loguru",
        "click",
        "hexdump",
    ];

    // 安装所有包
    for package in &packages {
        eprintln!("正在安装 {}...", package);

        let install_result = Command::new(&pip_exe)
            .args(&["install", package])
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| format!("安装{}失败: {}", package, e))?;

        if !install_result.success() {
            // 如果官方源失败，尝试阿里云镜像
            eprintln!("官方源安装{}失败，尝试阿里云镜像...", package);
            let install_result2 = Command::new(&pip_exe)
                .args(&["install", package, "-i", "https://mirrors.aliyun.com/pypi/simple/", "--trusted-host", "mirrors.aliyun.com"])
                .creation_flags(0x08000000)
                .status()
                .map_err(|e| format!("安装{}失败: {}", package, e))?;

            if !install_result2.success() {
                return Err(format!("安装{}失败，请检查网络连接", package));
            }
        }
    }

    Ok(json!({
        "success": true,
        "message": "Frida环境初始化完成"
    }))
}

// 推送并启动Frida Server
#[tauri::command]
async fn start_frida_server() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb").join("adb.exe");
    let frida_server_dir = current_dir.join("frida").join("frida-server");

    if !adb_exe.exists() {
        return Err("ADB工具不存在".to_string());
    }

    // 获取设备架构
    let arch_output = Command::new(&adb_exe)
        .args(&["shell", "getprop", "ro.product.cpu.abi"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("获取设备架构失败: {}", e))?;

    let arch = String::from_utf8_lossy(&arch_output.stdout).trim().to_string();

    // 根据架构选择对应的frida-server (使用17.5.2版本，兼容性更好)
    let server_name = match arch.as_str() {
        "arm64-v8a" => "frida-server-17.5.2-android-arm64",
        "armeabi-v7a" | "armeabi" => "frida-server-17.5.2-android-arm",
        "x86_64" => "frida-server-17.5.2-android-x86_64",
        "x86" => "frida-server-17.5.2-android-x86",
        _ => return Err(format!("不支持的设备架构: {}", arch)),
    };

    let server_path = frida_server_dir.join(server_name);
    if !server_path.exists() {
        return Err(format!("Frida Server文件不存在: {}", server_name));
    }

    // 检查frida-server是否已在运行
    let check_output = Command::new(&adb_exe)
        .args(&["shell", "ps", "-A", "|", "grep", "frida-server"])
        .creation_flags(0x08000000)
        .output();

    if let Ok(out) = check_output {
        if !String::from_utf8_lossy(&out.stdout).trim().is_empty() {
            return Ok(json!({
                "success": true,
                "message": "Frida Server已在运行"
            }));
        }
    }

    // 推送frida-server到设备
    eprintln!("正在推送frida-server到设备...");
    let push_result = Command::new(&adb_exe)
        .args(&["push", server_path.to_str().unwrap(), "/data/local/tmp/frida-server"])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("推送frida-server失败: {}", e))?;

    if !push_result.success() {
        return Err("推送frida-server失败".to_string());
    }

    // 设置权限
    Command::new(&adb_exe)
        .args(&["shell", "chmod", "755", "/data/local/tmp/frida-server"])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("设置权限失败: {}", e))?;

    // 后台启动frida-server
    Command::new(&adb_exe)
        .args(&["shell", "su", "-c", "/data/local/tmp/frida-server -D &"])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("启动frida-server失败: {}", e))?;

    // 等待启动
    std::thread::sleep(std::time::Duration::from_secs(2));

    Ok(json!({
        "success": true,
        "message": "Frida Server已启动"
    }))
}

// 检查Frida Server是否正在运行
#[tauri::command]
async fn check_frida_server_status() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb").join("adb.exe");

    if !adb_exe.exists() {
        return Ok(json!({
            "running": false,
            "message": "ADB工具不存在"
        }));
    }

    // 使用 ps -A 和 grep 分开执行来检查frida-server
    let check_output = Command::new(&adb_exe)
        .args(&["shell", "ps -A | grep frida-server"])
        .creation_flags(0x08000000)
        .output();

    if let Ok(out) = check_output {
        let output_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !output_str.is_empty() && output_str.contains("frida-server") {
            return Ok(json!({
                "running": true,
                "message": "Frida Server正在运行"
            }));
        }
    }

    Ok(json!({
        "running": false,
        "message": "Frida Server未运行"
    }))
}

// 停止Frida Server
#[tauri::command]
async fn stop_frida_server() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb").join("adb.exe");

    if !adb_exe.exists() {
        return Err("ADB工具不存在".to_string());
    }

    // 杀死frida-server进程
    let _ = Command::new(&adb_exe)
        .args(&["shell", "su -c 'pkill -9 frida-server'"])
        .creation_flags(0x08000000)
        .status();

    // 备用方式：通过killall
    let _ = Command::new(&adb_exe)
        .args(&["shell", "su -c 'killall frida-server'"])
        .creation_flags(0x08000000)
        .status();

    // 等待进程终止
    std::thread::sleep(std::time::Duration::from_millis(500));

    Ok(json!({
        "success": true,
        "message": "Frida Server已停止"
    }))
}

// 启动网络抓包
#[tauri::command]
async fn start_packet_capture(
    case_number: String,
    apk_dir: String,
    package_name: String,
    spawn_mode: bool,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // Frida虚拟环境中的python
    let frida_python = if cfg!(target_os = "windows") {
        current_dir.join("frida").join("frida").join("venv").join("Scripts").join("python.exe")
    } else {
        current_dir.join("frida").join("frida").join("venv").join("bin").join("python")
    };

    if !frida_python.exists() {
        return Err("Frida环境未初始化，请先初始化Frida环境".to_string());
    }

    // 抓包脚本路径
    let capture_script = current_dir.join("scripts").join("packet_capture").join("r0capture_http.py");
    if !capture_script.exists() {
        return Err("抓包脚本不存在".to_string());
    }

    // 创建抓包会话目录（在APK目录下的capture文件夹）
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let capture_session_dir = current_dir.join(&apk_dir).join("capture").join(&timestamp);
    fs::create_dir_all(&capture_session_dir).map_err(|e| format!("创建抓包目录失败: {}", e))?;

    // 创建输出文件路径
    let output_file = capture_session_dir.join("packets.json");
    let pcap_file = capture_session_dir.join("capture.pcap");

    // 保存会话信息
    let session_info = json!({
        "package": package_name,
        "apk_dir": apk_dir,
        "start_time": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "spawn_mode": spawn_mode
    });
    fs::write(
        capture_session_dir.join("session.json"),
        serde_json::to_string_pretty(&session_info).unwrap()
    ).map_err(|e| format!("保存会话信息失败: {}", e))?;

    // 构建启动命令
    let mut cmd = Command::new(&frida_python);
    cmd.arg(&capture_script)
        .arg("-U")  // USB设备
        .arg("-p").arg(pcap_file.to_str().unwrap());

    if spawn_mode {
        cmd.arg("-f");  // spawn模式
    }

    cmd.arg(&package_name);

    // 设置环境变量以便脚本输出JSON格式
    cmd.env("CAPTURE_OUTPUT_FILE", output_file.to_str().unwrap());

    // 创建日志文件用于记录Python脚本输出
    let log_file_path = capture_session_dir.join("capture.log");
    let log_file = std::fs::File::create(&log_file_path)
        .map_err(|e| format!("创建日志文件失败: {}", e))?;
    let log_file_clone = log_file.try_clone()
        .map_err(|e| format!("复制文件句柄失败: {}", e))?;

    cmd.stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_clone));

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    // 启动抓包进程
    let child = cmd.spawn()
        .map_err(|e| format!("启动抓包进程失败: {}", e))?;

    eprintln!("抓包进程已启动，日志文件: {}", log_file_path.display());

    // 保存进程句柄
    let capture_id = format!("{}_{}", case_number, timestamp);
    {
        let mut processes = state.capture_processes.lock().unwrap();
        processes.insert(capture_id.clone(), child);
    }

    Ok(json!({
        "success": true,
        "capture_id": capture_id,
        "session_dir": timestamp,
        "log_file": log_file_path.to_str().unwrap_or(""),
        "message": "抓包已启动"
    }))
}

// 停止网络抓包
#[tauri::command]
async fn stop_packet_capture(
    capture_id: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let mut processes = state.capture_processes.lock().unwrap();

    if let Some(mut child) = processes.remove(&capture_id) {
        // 发送终止信号
        child.kill().ok();
        child.wait().ok();

        Ok(json!({
            "success": true,
            "message": "抓包已停止"
        }))
    } else {
        Err("未找到抓包进程".to_string())
    }
}

// 获取抓包会话列表
#[tauri::command]
async fn get_capture_sessions(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let captures_dir = current_dir.join(&apk_dir).join("capture");

    if !captures_dir.exists() {
        return Ok(json!({
            "success": true,
            "sessions": []
        }));
    }

    let mut sessions: Vec<serde_json::Value> = Vec::new();

    if let Ok(entries) = fs::read_dir(&captures_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let session_file = path.join("session.json");
                if session_file.exists() {
                    if let Ok(content) = fs::read_to_string(&session_file) {
                        if let Ok(mut info) = serde_json::from_str::<serde_json::Value>(&content) {
                            // 添加会话ID（目录名）
                            if let Some(obj) = info.as_object_mut() {
                                obj.insert("session_id".to_string(), json!(entry.file_name().to_string_lossy().to_string()));

                                // 检查是否有抓包数据
                                let packets_file = path.join("packets.json");
                                let pcap_file = path.join("capture.pcap");
                                obj.insert("has_packets".to_string(), json!(packets_file.exists()));
                                obj.insert("has_pcap".to_string(), json!(pcap_file.exists()));
                            }
                            sessions.push(info);
                        }
                    }
                }
            }
        }
    }

    // 按时间倒序排序
    sessions.sort_by(|a, b| {
        let time_a = a.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
        let time_b = b.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
        time_b.cmp(time_a)
    });

    Ok(json!({
        "success": true,
        "sessions": sessions
    }))
}

// 获取抓包数据
#[tauri::command]
async fn get_capture_packets(
    apk_dir: String,
    session_id: String,
    page: Option<usize>,
    page_size: Option<usize>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let session_dir = current_dir.join(&apk_dir).join("capture").join(&session_id);
    let packets_file = session_dir.join("packets.json");

    if !packets_file.exists() {
        return Ok(json!({
            "success": true,
            "packets": [],
            "total": 0
        }));
    }

    let content = fs::read_to_string(&packets_file)
        .map_err(|e| format!("读取抓包数据失败: {}", e))?;

    let packets: Vec<serde_json::Value> = serde_json::from_str(&content)
        .unwrap_or_else(|_| Vec::new());

    let total = packets.len();
    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(50);
    let start = (page - 1) * page_size;
    let end = std::cmp::min(start + page_size, total);

    let page_packets: Vec<serde_json::Value> = if start < total {
        packets[start..end].to_vec()
    } else {
        Vec::new()
    };

    Ok(json!({
        "success": true,
        "packets": page_packets,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) / page_size
    }))
}

// 删除抓包会话
#[tauri::command]
async fn delete_capture_session(apk_dir: String, session_id: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let session_dir = current_dir.join(&apk_dir).join("capture").join(&session_id);

    if session_dir.exists() {
        fs::remove_dir_all(&session_dir)
            .map_err(|e| format!("删除抓包会话失败: {}", e))?;
    }

    Ok(json!({
        "success": true,
        "message": "抓包会话已删除"
    }))
}

// ===================== Frida脚本模块 =====================

// Frida脚本配置结构
#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct FridaScript {
    id: String,
    filename: String,
    name: String,
    description: String,
    category: String,
    enabled: bool,
}

#[derive(serde::Deserialize)]
struct FridaScriptsConfig {
    scripts: Vec<FridaScript>,
    categories: HashMap<String, String>,
}

// 获取Frida脚本列表
#[tauri::command]
async fn get_frida_scripts() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let scripts_config_path = current_dir.join("frida").join("scripts").join("scripts.json");

    if !scripts_config_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "脚本配置文件不存在",
            "scripts": []
        }));
    }

    let config_content = fs::read_to_string(&scripts_config_path)
        .map_err(|e| format!("读取脚本配置失败: {}", e))?;

    let config: FridaScriptsConfig = serde_json::from_str(&config_content)
        .map_err(|e| format!("解析脚本配置失败: {}", e))?;

    // 添加分类名称到每个脚本
    let scripts_with_category: Vec<serde_json::Value> = config.scripts.iter()
        .filter(|s| s.enabled)
        .map(|s| {
            let category_name = config.categories.get(&s.category)
                .cloned()
                .unwrap_or_else(|| s.category.clone());
            json!({
                "id": s.id,
                "filename": s.filename,
                "name": s.name,
                "description": s.description,
                "category": s.category,
                "categoryName": category_name,
                "enabled": s.enabled
            })
        })
        .collect();

    Ok(json!({
        "success": true,
        "scripts": scripts_with_category
    }))
}

// 全局Frida输出缓冲区 - 用于在线程间共享输出数据
lazy_static::lazy_static! {
    static ref FRIDA_OUTPUT_BUFFERS: Arc<Mutex<HashMap<String, FridaOutputBuffer>>> = Arc::new(Mutex::new(HashMap::new()));
}

// 运行Frida脚本
#[tauri::command]
async fn run_frida_scripts(
    package_name: String,
    scripts: Vec<String>,
    custom_scripts: Option<Vec<String>>,
    spawn_mode: bool,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // Frida虚拟环境中的frida命令行工具
    let frida_exe = if cfg!(target_os = "windows") {
        current_dir.join("frida").join("frida").join("venv").join("Scripts").join("frida.exe")
    } else {
        current_dir.join("frida").join("frida").join("venv").join("bin").join("frida")
    };

    if !frida_exe.exists() {
        return Err("Frida环境未初始化，请先初始化Frida环境".to_string());
    }

    // 脚本目录
    let scripts_dir = current_dir.join("frida").join("scripts");

    // 合并所有选中的脚本内容
    let mut combined_script = String::new();

    // 添加通用头部 - 等待应用初始化的包装函数
    combined_script.push_str(r#"// Combined Frida Scripts
console.log('[*] Script loaded, initializing...');

// 等待应用完全初始化的通用函数
function waitForApplication(callback) {
    Java.perform(function() {
        var ActivityThread = Java.use("android.app.ActivityThread");
        var app = ActivityThread.currentApplication();

        if (app != null) {
            console.log('[+] Application initialized, loading hooks...');
            callback();
        } else {
            console.log('[*] Waiting for application to initialize...');
            setTimeout(function() {
                waitForApplication(callback);
            }, 100);
        }
    });
}

waitForApplication(function() {
"#);

    // 加载普通脚本（相对路径）
    for script_name in &scripts {
        let script_path = scripts_dir.join(script_name);
        if script_path.exists() {
            if let Ok(content) = fs::read_to_string(&script_path) {
                combined_script.push_str(&format!("\n    // === {} ===\n", script_name));
                // 缩进脚本内容
                for line in content.lines() {
                    combined_script.push_str("    ");
                    combined_script.push_str(line);
                    combined_script.push_str("\n");
                }
                combined_script.push_str("\n");
            }
        }
    }

    // 加载自定义脚本（绝对路径）
    if let Some(custom_script_paths) = custom_scripts {
        for custom_path in &custom_script_paths {
            let script_path = std::path::Path::new(custom_path);
            if script_path.exists() {
                if let Ok(content) = fs::read_to_string(&script_path) {
                    let file_name = script_path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "custom_script".to_string());
                    combined_script.push_str(&format!("\n    // === [自定义] {} ===\n", file_name));
                    // 缩进脚本内容
                    for line in content.lines() {
                        combined_script.push_str("    ");
                        combined_script.push_str(line);
                        combined_script.push_str("\n");
                    }
                    combined_script.push_str("\n");
                }
            } else {
                return Err(format!("自定义脚本不存在: {}", custom_path));
            }
        }
    }

    // 关闭 waitForApplication 回调
    combined_script.push_str("});\n\nconsole.log('[*] All scripts queued for loading');\n");

    // 创建临时脚本文件
    let temp_script_path = current_dir.join("frida").join("temp_combined_script.js");
    fs::write(&temp_script_path, &combined_script)
        .map_err(|e| format!("写入临时脚本失败: {}", e))?;

    // 生成唯一的进程ID
    let process_id = format!("frida_{}", chrono::Local::now().format("%Y%m%d%H%M%S%3f"));

    // 使用frida命令行工具直接运行
    // frida -U -l script.js -f package_name (spawn模式)
    // frida -U -l script.js package_name (attach模式)
    let mut cmd = Command::new(&frida_exe);
    cmd.arg("-U"); // USB设备

    cmd.arg("-l").arg(&temp_script_path); // 加载脚本

    if spawn_mode {
        cmd.arg("-f").arg(&package_name); // spawn模式：-f 包名
        // frida会自动resume进程
    } else {
        cmd.arg(&package_name); // attach模式：直接跟包名
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("启动Frida进程失败: {}", e))?;

    // 获取stdout和stderr
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let process_id_clone = process_id.clone();
    let process_id_for_stdout = process_id.clone();
    let process_id_for_stderr = process_id.clone();

    // 初始化全局输出缓冲
    {
        let mut outputs = FRIDA_OUTPUT_BUFFERS.lock().unwrap();
        outputs.insert(process_id.clone(), FridaOutputBuffer {
            lines: Vec::new(),
            finished: false,
        });
    }

    // 保存进程
    {
        let mut processes = state.frida_processes.lock().unwrap();
        processes.insert(process_id.clone(), child);
    }

    // 在后台线程中读取stdout
    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            let buf_reader = BufReader::new(stdout);
            for line in buf_reader.lines() {
                if let Ok(line_content) = line {
                    let line_type = if line_content.starts_with("[+]") || line_content.starts_with("[SEND]") {
                        "success"
                    } else if line_content.starts_with("[-]") || line_content.starts_with("[ERROR]") {
                        "error"
                    } else if line_content.starts_with("[!]") {
                        "warn"
                    } else {
                        "info"
                    };

                    let mut outputs = FRIDA_OUTPUT_BUFFERS.lock().unwrap();
                    if let Some(buffer) = outputs.get_mut(&process_id_for_stdout) {
                        buffer.lines.push(FridaOutputLine {
                            content: line_content,
                            line_type: line_type.to_string(),
                        });
                    }
                }
            }

            // 标记stdout结束
            let mut outputs = FRIDA_OUTPUT_BUFFERS.lock().unwrap();
            if let Some(buffer) = outputs.get_mut(&process_id_for_stdout) {
                buffer.finished = true;
            }
        });
    }

    // 在后台线程中读取stderr
    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            let buf_reader = BufReader::new(stderr);
            for line in buf_reader.lines() {
                if let Ok(line_content) = line {
                    let mut outputs = FRIDA_OUTPUT_BUFFERS.lock().unwrap();
                    if let Some(buffer) = outputs.get_mut(&process_id_for_stderr) {
                        buffer.lines.push(FridaOutputLine {
                            content: line_content,
                            line_type: "error".to_string(),
                        });
                    }
                }
            }
        });
    }

    Ok(json!({
        "success": true,
        "processId": process_id_clone,
        "message": "Frida脚本已启动"
    }))
}

// 停止Frida脚本
#[tauri::command]
async fn stop_frida_scripts(
    process_id: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    // 杀死进程
    {
        let mut processes = state.frida_processes.lock().unwrap();
        if let Some(mut child) = processes.remove(&process_id) {
            child.kill().ok();
            child.wait().ok();
        }
    }

    // 标记输出结束 - 使用全局缓冲区
    {
        let mut outputs = FRIDA_OUTPUT_BUFFERS.lock().unwrap();
        if let Some(buffer) = outputs.get_mut(&process_id) {
            buffer.finished = true;
        }
    }

    Ok(json!({
        "success": true,
        "message": "Frida已停止"
    }))
}

// 获取Frida输出 - 使用全局缓冲区
#[tauri::command]
async fn get_frida_output(
    process_id: String,
    _state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let mut outputs = FRIDA_OUTPUT_BUFFERS.lock().unwrap();

    if let Some(buffer) = outputs.get_mut(&process_id) {
        // 获取并清空已读取的行
        let lines: Vec<FridaOutputLine> = buffer.lines.drain(..).collect();
        let finished = buffer.finished;

        Ok(json!({
            "success": true,
            "lines": lines,
            "finished": finished
        }))
    } else {
        Ok(json!({
            "success": false,
            "lines": [],
            "finished": true,
            "message": "进程不存在"
        }))
    }
}

// 保存Frida输出
#[tauri::command]
async fn save_frida_output(filename: String, content: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let output_dir = current_dir.join("frida").join("output");

    // 确保输出目录存在
    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let output_path = output_dir.join(&filename);
    fs::write(&output_path, &content).map_err(|e| format!("保存输出失败: {}", e))?;

    Ok(json!({
        "success": true,
        "path": output_path.to_string_lossy().to_string(),
        "message": "输出已保存"
    }))
}

// 保存Frida脚本到列表
#[derive(serde::Deserialize)]
struct ScriptInfo {
    id: String,
    name: String,
    description: String,
    category: String,
}

#[tauri::command]
async fn save_frida_script(
    source_path: String,
    script_info: ScriptInfo,
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let scripts_dir = current_dir.join("frida").join("scripts");
    let scripts_json_path = scripts_dir.join("scripts.json");

    // 确保scripts目录存在
    if !scripts_dir.exists() {
        fs::create_dir_all(&scripts_dir).map_err(|e| format!("创建scripts目录失败: {}", e))?;
    }

    // 读取源脚本文件
    let source = std::path::Path::new(&source_path);
    if !source.exists() {
        return Err(format!("源脚本文件不存在: {}", source_path));
    }

    let script_content = fs::read_to_string(&source)
        .map_err(|e| format!("读取脚本文件失败: {}", e))?;

    // 生成目标文件名
    let target_filename = format!("{}.js", script_info.id);
    let target_path = scripts_dir.join(&target_filename);

    // 检查是否已存在同名文件
    if target_path.exists() {
        return Err(format!("脚本文件已存在: {}", target_filename));
    }

    // 复制脚本文件
    fs::write(&target_path, script_content)
        .map_err(|e| format!("保存脚本文件失败: {}", e))?;

    // 读取现有的scripts.json
    let mut scripts: Vec<serde_json::Value> = if scripts_json_path.exists() {
        let json_content = fs::read_to_string(&scripts_json_path)
            .map_err(|e| format!("读取scripts.json失败: {}", e))?;
        serde_json::from_str(&json_content).unwrap_or_else(|_| Vec::new())
    } else {
        Vec::new()
    };

    // 添加新脚本配置
    scripts.push(json!({
        "id": script_info.id,
        "name": script_info.name,
        "description": script_info.description,
        "category": script_info.category,
        "filename": target_filename
    }));

    // 保存scripts.json
    let json_content = serde_json::to_string_pretty(&scripts)
        .map_err(|e| format!("序列化scripts.json失败: {}", e))?;
    fs::write(&scripts_json_path, json_content)
        .map_err(|e| format!("保存scripts.json失败: {}", e))?;

    Ok(json!({
        "success": true,
        "message": "脚本已保存到列表"
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            scrcpy_processes: Mutex::new(HashMap::new()),
            capture_processes: Mutex::new(HashMap::new()),
            frida_processes: Mutex::new(HashMap::new()),
            frida_outputs: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            write_file, write_binary_file, copy_file, select_apk_file, set_title, show_window, close_splash_show_main, read_file, delete_file, delete_dir, create_dir, read_dirs, save_excel_file, read_excel_file, file_exists, open_file, delete_path, check_adb_devices, install_apk, check_apk_installed, start_scrcpy, stop_scrcpy, is_scrcpy_ready, cleanup_residual_processes, get_current_dir, get_apk_info, get_apk_list, decompile_apk, get_apk_permissions, get_apk_details, preanalyze_apk_details, get_jadx_file_tree, get_jadx_subdirectory, read_jadx_file, search_jadx_files, scan_sensitive_info, get_sensitive_info, ping_ip, analyze_third_party_services,
            // 网络抓包模块
            get_device_apps, check_frida_env, init_frida_env, start_frida_server, stop_frida_server, check_frida_server_status, start_packet_capture, stop_packet_capture, get_capture_sessions, get_capture_packets, delete_capture_session,
            // Frida脚本模块
            get_frida_scripts, run_frida_scripts, stop_frida_scripts, get_frida_output, save_frida_output, save_frida_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
