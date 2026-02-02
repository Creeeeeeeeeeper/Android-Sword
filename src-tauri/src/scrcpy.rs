use std::fs;
use std::env;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use serde_json::json;
use regex::Regex;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::state::AppState;

/// 常见模拟器端口列表
const EMULATOR_PORTS: &[u16] = &[
    // 雷电模拟器
    5555, 5556, 5557, 5558, 5559,
    // 夜神模拟器
    62001, 62025, 62026,
    // 逍遥模拟器
    21503,
    // MuMu模拟器
    7555, 16384, 16416,
    // 蓝叠模拟器
    5575, 5585, 5595,
    // 网易MuMu12
    16384, 16416, 16448,
    // 天天模拟器
    6555,
    // 海马玩模拟器
    26944,
    // 标准Android模拟器
    5554, 5556, 5558, 5560,
];

/// 检查端口是否空闲
pub fn is_port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 获取adb当前设备列表（内部工具函数）
fn get_adb_device_serials(adb_exe: &std::path::Path) -> Vec<String> {
    let mut cmd = Command::new(adb_exe);
    cmd.arg("devices");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .skip(1)
        .filter(|line| !line.is_empty() && line.contains("\tdevice"))
        .filter_map(|line| line.split_whitespace().next().map(|s| s.to_string()))
        .collect()
}

/// 扫描并连接常见模拟器端口（异步并发）
/// 不做自动去重，让用户自己选择设备
#[tauri::command]
pub async fn scan_emulator_ports() -> Result<Vec<String>, String> {
    use std::sync::Arc;

    let current_dir = env::current_dir()
        .map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb\\adb.exe");

    if !adb_exe.exists() {
        return Err(format!("ADB不存在: {}", adb_exe.display()));
    }

    let adb_path = Arc::new(adb_exe);

    // 去重端口
    let mut unique_ports: Vec<u16> = EMULATOR_PORTS.to_vec();
    unique_ports.sort();
    unique_ports.dedup();

    eprintln!("[scan_emulator_ports] 开始扫描 {} 个端口...", unique_ports.len());

    // 并发adb connect
    let mut handles = Vec::new();
    for port in unique_ports {
        let adb = Arc::clone(&adb_path);
        let handle = tokio::task::spawn_blocking(move || {
            let address = format!("127.0.0.1:{}", port);
            let mut cmd = Command::new(adb.as_ref());
            cmd.arg("connect").arg(&address);

            #[cfg(target_os = "windows")]
            {
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }

            if let Ok(output) = cmd.output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.contains("connected") {
                    eprintln!("[scan_emulator_ports] 连接成功: {}", address);
                    return Some(address);
                }
            }
            None
        });
        handles.push(handle);
    }

    let mut newly_connected = Vec::new();
    for handle in handles {
        if let Ok(Some(addr)) = handle.await {
            newly_connected.push(addr);
        }
    }

    eprintln!("[scan_emulator_ports] 扫描完成，连接了 {} 个端口", newly_connected.len());
    Ok(newly_connected)
}

/// 获取adb设备详细信息（内部工具函数）
fn get_adb_device_details(adb_exe: &std::path::Path) -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;

    let mut cmd = Command::new(adb_exe);
    cmd.arg("devices").arg("-l");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return HashMap::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut device_details = HashMap::new();

    // 解析 adb devices -l 输出
    // 格式: FLHG65002148010B84M002G3  device usb:1-1 product:xxx model:xxx device:xxx transport_id:1
    for line in stdout.lines().skip(1) {
        if line.is_empty() || !line.contains("device") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let serial = parts[0].to_string();
            // 提取详细信息
            let detail = line.trim().to_string();
            device_details.insert(serial, detail);
        }
    }

    device_details
}

/// 获取已连接设备列表（异步，不阻塞主线程）
/// 返回设备索引、序列号和详细信息
#[tauri::command]
pub async fn list_scrcpy_devices() -> Result<Vec<serde_json::Value>, String> {
    // 使用 tokio::task::spawn_blocking 在独立线程中执行阻塞操作
    tokio::task::spawn_blocking(|| {
        let current_dir = env::current_dir()
            .map_err(|e| e.to_string())?;

        let scrcpy_exe = current_dir.join("scrcpy\\rust-ws-scrcpy.exe");
        let scrcpy_dir = current_dir.join("scrcpy");
        let adb_exe = current_dir.join("adb\\adb.exe");

        if !scrcpy_exe.exists() {
            return Err(format!("scrcpy执行文件不存在: {}", scrcpy_exe.display()));
        }

        // 先获取 adb devices -l 的详细信息
        let device_details = get_adb_device_details(&adb_exe);

        let mut cmd = Command::new(&scrcpy_exe);
        cmd.arg("--list")
            .arg("-a")
            .arg(&adb_exe)
            .current_dir(&scrcpy_dir);

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output()
            .map_err(|e| format!("执行--list命令失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined_output = format!("{}\n{}", stdout, stderr);

        // 查找 "Connected devices:" 之后的设备列表
        let re = Regex::new(r"(?m)^\s{2}\[(\d+)\]\s+(\S+)").map_err(|e| e.to_string())?;

        let mut devices = Vec::new();

        let devices_section = if let Some(pos) = combined_output.find("Connected devices") {
            &combined_output[pos..]
        } else {
            &combined_output[..]
        };

        for cap in re.captures_iter(devices_section) {
            let index: u32 = cap[1].parse().unwrap_or(0);
            let serial = cap[2].to_string();

            // 获取该设备的详细信息
            let detail = device_details.get(&serial).cloned().unwrap_or_else(|| serial.clone());

            // 解析出 model 信息用于显示
            let model = extract_model_from_detail(&detail);

            devices.push(json!({
                "index": index,
                "serial": serial,
                "detail": detail,
                "model": model
            }));
        }

        Ok(devices)
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

/// 从 adb devices -l 详细信息中提取 model
fn extract_model_from_detail(detail: &str) -> String {
    // 尝试提取 model:xxx
    if let Some(pos) = detail.find("model:") {
        let start = pos + 6;
        let rest = &detail[start..];
        if let Some(end) = rest.find(' ') {
            return rest[..end].replace('_', " ");
        } else {
            return rest.replace('_', " ");
        }
    }

    // 尝试提取 product:xxx
    if let Some(pos) = detail.find("product:") {
        let start = pos + 8;
        let rest = &detail[start..];
        if let Some(end) = rest.find(' ') {
            return rest[..end].replace('_', " ");
        } else {
            return rest.replace('_', " ");
        }
    }

    // 没有找到，返回空
    String::new()
}

/// 启动scrcpy进程（异步）
#[tauri::command]
#[allow(non_snake_case)]
pub async fn start_scrcpy(caseNumber: String, deviceIndex: Option<u32>, emulatorOptimize: Option<bool>, state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let case_number = caseNumber.clone();
    let is_emulator_optimize = emulatorOptimize.unwrap_or(false);

    // 读取设置文件
    let settings: serde_json::Value = match fs::read_to_string("settings.json") {
        Ok(content) => serde_json::from_str(&content).unwrap_or(json!({})),
        Err(_) => json!({})
    };
    let scrcpy_settings = settings.get("scrcpy").cloned().unwrap_or(json!({}));

    // 查找可用的端口
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

    let current_dir = env::current_dir()
        .map_err(|e| e.to_string())?;

    let scrcpy_exe = current_dir.join("scrcpy\\rust-ws-scrcpy.exe");
    let adb_exe = current_dir.join("adb\\adb.exe");
    let scrcpy_server = current_dir.join("scrcpy\\scrcpy-server-v3.3.4");

    if !scrcpy_exe.exists() {
        return Err(format!("scrcpy执行文件不存在: {}", scrcpy_exe.display()));
    }

    let mut cmd = Command::new(&scrcpy_exe);
    cmd.arg("-a")
        .arg(&adb_exe)
        .arg("-s")
        .arg(&scrcpy_server)
        .arg("-p")
        .arg(port.to_string());

    // 如果指定了设备索引，添加 -d 参数
    if let Some(idx) = deviceIndex {
        cmd.arg("-d").arg(idx.to_string());
    }

    // 模拟器优化模式：使用较低的码率和分辨率
    if is_emulator_optimize {
        cmd.arg("-b").arg("1000000");  // 1Mbps 码率
        cmd.arg("-m").arg("1080");     // 1080 分辨率
        eprintln!("[scrcpy] 模拟器优化模式: -b 1000000 -m 1080");
    } else {
        // 应用用户设置的参数
        if let Some(max_size) = scrcpy_settings.get("maxSize").and_then(|v| v.as_u64()) {
            cmd.arg("-m").arg(max_size.to_string());
        }

        if let Some(bit_rate) = scrcpy_settings.get("bitRate").and_then(|v| v.as_u64()) {
            cmd.arg("-b").arg(bit_rate.to_string());
        }
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
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    eprintln!("[scrcpy] 启动命令: {:?}", cmd);

    let mut child = cmd.spawn()
        .map_err(|e| format!("spawn失败: {}", e))?;

    let stdout = child.stdout.take().ok_or("无法获取stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取stderr")?;

    let case_number_for_thread = case_number.clone();

    // 立即将进程保存到状态中
    let mut processes = state.scrcpy_processes.lock().unwrap();
    processes.insert(case_number.clone(), child);
    drop(processes);

    // 后台线程读取stderr并打印
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                eprintln!("[scrcpy stderr] {}", line);
            }
        }
    });

    // 在后台异步线程中处理stdout + 启动完成检查
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        let start_time = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(30);
        let mut startup_complete = false;

        while let Some(Ok(line)) = lines.next() {
            eprintln!("[scrcpy stdout] {}", line);

            if line.contains("Open http://") && line.contains("in your browser") {
                startup_complete = true;
                eprintln!("[scrcpy] 启动完成，案件: {}，端口: {}", case_number_for_thread, port);
                break;
            }

            if start_time.elapsed() > timeout {
                eprintln!("[scrcpy] 启动超时(30s)");
                return;
            }
        }

        if startup_complete {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            eprintln!("[scrcpy] 已准备好接受连接，案件: {}", case_number_for_thread);
        } else {
            eprintln!("[scrcpy] stdout已关闭，未检测到启动成功标志");
        }
    });

    Ok(json!({ "port": port, "status": "启动中" }))
}

/// 停止scrcpy进程
#[tauri::command]
#[allow(non_snake_case)]
pub fn stop_scrcpy(caseNumber: &str, state: tauri::State<AppState>) -> Result<String, String> {
    let mut processes = state.scrcpy_processes.lock().unwrap();

    if let Some(mut child) = processes.remove(caseNumber) {
        let _ = child.kill();
        let _ = child.wait();
        Ok("stopped".to_string())
    } else {
        Ok("no_process".to_string())
    }
}

/// 检查scrcpy是否已准备好接受连接
#[tauri::command]
#[allow(non_snake_case)]
pub fn is_scrcpy_ready(caseNumber: &str, state: tauri::State<AppState>) -> Result<bool, String> {
    let processes = state.scrcpy_processes.lock().unwrap();
    Ok(processes.contains_key(caseNumber))
}
