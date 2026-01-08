use std::fs;
use std::env;
use std::process::{Command, Stdio};
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::state::AppState;

/// 启动网络抓包
#[tauri::command]
pub async fn start_packet_capture(
    case_number: String,
    apk_dir: String,
    package_name: String,
    spawn_mode: bool,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    let frida_python = if cfg!(target_os = "windows") {
        current_dir.join("frida").join("frida").join("venv").join("Scripts").join("python.exe")
    } else {
        current_dir.join("frida").join("frida").join("venv").join("bin").join("python")
    };

    if !frida_python.exists() {
        return Err("Frida环境未初始化，请先初始化Frida环境".to_string());
    }

    let capture_script = current_dir.join("scripts").join("packet_capture").join("r0capture_http.py");
    if !capture_script.exists() {
        return Err("抓包脚本不存在".to_string());
    }

    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let capture_session_dir = current_dir.join(&apk_dir).join("capture").join(&timestamp);
    fs::create_dir_all(&capture_session_dir).map_err(|e| format!("创建抓包目录失败: {}", e))?;

    let output_file = capture_session_dir.join("packets.json");
    let pcap_file = capture_session_dir.join("capture.pcap");

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

    let mut cmd = Command::new(&frida_python);
    cmd.arg(&capture_script)
        .arg("-U")
        .arg("-p").arg(pcap_file.to_str().unwrap());

    if spawn_mode {
        cmd.arg("-f");
    }

    cmd.arg(&package_name);
    cmd.env("CAPTURE_OUTPUT_FILE", output_file.to_str().unwrap());

    let log_file_path = capture_session_dir.join("capture.log");
    let log_file = std::fs::File::create(&log_file_path)
        .map_err(|e| format!("创建日志文件失败: {}", e))?;
    let log_file_clone = log_file.try_clone()
        .map_err(|e| format!("复制文件句柄失败: {}", e))?;

    cmd.stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_clone));

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let child = cmd.spawn()
        .map_err(|e| format!("启动抓包进程失败: {}", e))?;

    eprintln!("抓包进程已启动，日志文件: {}", log_file_path.display());

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

/// 停止网络抓包
#[tauri::command]
pub async fn stop_packet_capture(
    capture_id: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let mut processes = state.capture_processes.lock().unwrap();

    if let Some(mut child) = processes.remove(&capture_id) {
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

/// 获取抓包会话列表
#[tauri::command]
pub async fn get_capture_sessions(apk_dir: String) -> Result<serde_json::Value, String> {
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
                            if let Some(obj) = info.as_object_mut() {
                                obj.insert("session_id".to_string(), json!(entry.file_name().to_string_lossy().to_string()));

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

/// 获取抓包数据
#[tauri::command]
pub async fn get_capture_packets(
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

/// 删除抓包会话
#[tauri::command]
pub async fn delete_capture_session(apk_dir: String, session_id: String) -> Result<serde_json::Value, String> {
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
