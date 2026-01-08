use std::fs;
use std::env;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::state::AppState;

/// 检查端口是否空闲
pub fn is_port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 启动scrcpy进程（异步）
#[tauri::command]
#[allow(non_snake_case)]
pub async fn start_scrcpy(caseNumber: String, state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let case_number = caseNumber.clone();

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

    let scrcpy_exe = current_dir.join("scrcpy\\rust-ws-scrcpy-v2.1.1.exe");
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

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    let mut child = cmd.spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("无法获取stdout")?;

    let case_number_for_thread = case_number.clone();

    // 立即将进程保存到状态中
    let mut processes = state.scrcpy_processes.lock().unwrap();
    processes.insert(case_number.clone(), child);
    drop(processes);

    // 在后台异步线程中处理启动完成检查
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        let start_time = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(30);
        let mut startup_complete = false;

        while let Some(Ok(line)) = lines.next() {
            if line.contains("Open http://") && line.contains("in your browser") {
                startup_complete = true;
                eprintln!("scrcpy启动完成，案件: {}，端口: {}", case_number_for_thread, port);
                break;
            }

            if start_time.elapsed() > timeout {
                eprintln!("scrcpy启动超时");
                return;
            }
        }

        if startup_complete {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            eprintln!("scrcpy已准备好接受连接，案件: {}", case_number_for_thread);
        } else {
            eprintln!("无法确认scrcpy启动成功");
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
