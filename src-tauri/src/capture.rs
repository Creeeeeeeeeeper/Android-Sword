use std::fs;
use std::env;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::thread;
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::state::{AppState, NetworkPacket, TcpdumpBuffer};

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

/// 获取全流量抓包会话列表
#[tauri::command]
pub async fn get_realtime_sessions(case_number: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let realtime_dir = current_dir.join("case").join(&case_number).join("realtime");

    if !realtime_dir.exists() {
        return Ok(json!({
            "success": true,
            "sessions": []
        }));
    }

    let mut sessions: Vec<serde_json::Value> = Vec::new();

    if let Ok(entries) = fs::read_dir(&realtime_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let session_file = path.join("session.json");
                if session_file.exists() {
                    if let Ok(content) = fs::read_to_string(&session_file) {
                        if let Ok(mut info) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(obj) = info.as_object_mut() {
                                let session_id = entry.file_name().to_string_lossy().to_string();
                                obj.insert("session_id".to_string(), json!(session_id));
                                obj.insert("capture_type".to_string(), json!("realtime"));

                                let packets_file = path.join("packets.json");
                                let pcap_file = path.join("capture.pcap");
                                obj.insert("has_packets".to_string(), json!(packets_file.exists()));
                                obj.insert("has_pcap".to_string(), json!(pcap_file.exists()));

                                // 统计数据包数量
                                if packets_file.exists() {
                                    if let Ok(packets_content) = fs::read_to_string(&packets_file) {
                                        if let Ok(packets) = serde_json::from_str::<Vec<serde_json::Value>>(&packets_content) {
                                            obj.insert("packet_count".to_string(), json!(packets.len()));
                                        }
                                    }
                                }
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

/// 获取全流量抓包数据包
#[tauri::command]
pub async fn get_realtime_session_packets(
    case_number: String,
    session_id: String
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let packets_file = current_dir.join("case").join(&case_number).join("realtime").join(&session_id).join("packets.json");

    if !packets_file.exists() {
        return Ok(json!({
            "success": true,
            "packets": [],
            "total": 0
        }));
    }

    let content = fs::read_to_string(&packets_file).map_err(|e| format!("读取文件失败: {}", e))?;
    let packets: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap_or_else(|_| Vec::new());
    let total = packets.len();

    Ok(json!({
        "success": true,
        "packets": packets,
        "total": total
    }))
}

/// 删除全流量抓包会话
#[tauri::command]
pub async fn delete_realtime_session(
    case_number: String,
    session_id: String
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let session_dir = current_dir.join("case").join(&case_number).join("realtime").join(&session_id);

    if session_dir.exists() {
        fs::remove_dir_all(&session_dir).map_err(|e| format!("删除失败: {}", e))?;
    }

    Ok(json!({
        "success": true,
        "message": "已删除"
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

/// 获取辅助脚本列表
#[tauri::command]
pub async fn get_aux_scripts() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 尝试多个可能的路径
    let possible_paths = vec![
        current_dir.join("scripts").join("scripts.json"),
        current_dir.join("src-tauri").join("scripts").join("scripts.json"),
    ];

    let mut scripts_config = None;
    for path in possible_paths {
        if path.exists() {
            scripts_config = Some(path);
            break;
        }
    }

    let scripts_config = match scripts_config {
        Some(path) => path,
        None => {
            return Ok(json!({
                "success": true,
                "scripts": []
            }));
        }
    };

    let content = fs::read_to_string(&scripts_config)
        .map_err(|e| format!("读取脚本配置失败: {}", e))?;

    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析脚本配置失败: {}", e))?;

    let scripts = config.get("scripts")
        .cloned()
        .unwrap_or(json!([]));

    Ok(json!({
        "success": true,
        "scripts": scripts
    }))
}

/// 启动tcpdump抓包
#[tauri::command]
pub async fn start_tcpdump_capture(
    case_number: String,
    package_name: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 检查adb是否可用
    let adb_path = current_dir.join("adb").join("adb.exe");
    if !adb_path.exists() {
        return Err("ADB工具不存在".to_string());
    }

    // 创建抓包会话目录
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let capture_dir = current_dir.join("case").join(&case_number).join("tcpdump").join(&timestamp);
    fs::create_dir_all(&capture_dir).map_err(|e| format!("创建抓包目录失败: {}", e))?;

    let pcap_file = capture_dir.join("capture.pcap");
    let remote_pcap = "/data/local/tmp/capture.pcap";

    // 保存会话信息
    let session_info = json!({
        "package": package_name,
        "capture_type": "tcpdump",
        "start_time": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    });
    fs::write(
        capture_dir.join("session.json"),
        serde_json::to_string_pretty(&session_info).unwrap()
    ).map_err(|e| format!("保存会话信息失败: {}", e))?;

    // 获取应用UID
    let mut uid_cmd = Command::new(&adb_path);
    uid_cmd.args(["shell", &format!("dumpsys package {} | grep userId=", package_name)]);
    #[cfg(target_os = "windows")]
    uid_cmd.creation_flags(0x08000000);
    let uid_output = uid_cmd.output()
        .map_err(|e| format!("获取应用UID失败: {}", e))?;

    let uid_str = String::from_utf8_lossy(&uid_output.stdout);
    let uid = uid_str
        .split("userId=")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or("0")
        .to_string();

    // 启动tcpdump (需要root权限)
    // 使用 --uid-owner 过滤特定应用的流量
    let tcpdump_cmd = format!(
        "su -c 'tcpdump -i any -w {} -U' &",
        remote_pcap
    );

    let mut cmd = Command::new(&adb_path);
    cmd.args(["shell", &tcpdump_cmd]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let child = cmd.spawn()
        .map_err(|e| format!("启动tcpdump失败: {}", e))?;

    let capture_id = format!("tcpdump_{}_{}", case_number, timestamp);

    // 存储进程和相关信息
    {
        let mut processes = state.capture_processes.lock().unwrap();
        processes.insert(capture_id.clone(), child);
    }

    // 存储pcap文件路径信息
    let pcap_info = json!({
        "remote_pcap": remote_pcap,
        "local_pcap": pcap_file.to_str().unwrap_or(""),
        "capture_dir": capture_dir.to_str().unwrap_or("")
    });
    fs::write(
        capture_dir.join("pcap_info.json"),
        serde_json::to_string_pretty(&pcap_info).unwrap()
    ).ok();

    Ok(json!({
        "success": true,
        "capture_id": capture_id,
        "session_dir": timestamp,
        "message": "tcpdump抓包已启动"
    }))
}

/// 停止tcpdump抓包
#[tauri::command]
pub async fn stop_tcpdump_capture(
    capture_id: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_path = current_dir.join("adb").join("adb.exe");

    // 先通过adb停止tcpdump进程
    let mut kill_cmd = Command::new(&adb_path);
    kill_cmd.args(["shell", "su -c 'killall tcpdump'"]);
    #[cfg(target_os = "windows")]
    kill_cmd.creation_flags(0x08000000);
    let _ = kill_cmd.output();

    // 等待一下让文件写入完成
    std::thread::sleep(std::time::Duration::from_millis(500));

    // 从进程列表中移除
    {
        let mut processes = state.capture_processes.lock().unwrap();
        if let Some(mut child) = processes.remove(&capture_id) {
            child.kill().ok();
            child.wait().ok();
        }
    }

    // 解析capture_id获取目录信息
    // capture_id格式: tcpdump_{case_number}_{timestamp}
    let parts: Vec<&str> = capture_id.split('_').collect();
    if parts.len() >= 3 {
        let case_number = parts[1];
        let timestamp = parts[2];
        let capture_dir = current_dir.join("case").join(case_number).join("tcpdump").join(timestamp);

        // 读取pcap_info获取远程和本地路径
        let pcap_info_path = capture_dir.join("pcap_info.json");
        if pcap_info_path.exists() {
            if let Ok(content) = fs::read_to_string(&pcap_info_path) {
                if let Ok(info) = serde_json::from_str::<serde_json::Value>(&content) {
                    let remote_pcap = info.get("remote_pcap").and_then(|v| v.as_str()).unwrap_or("/data/local/tmp/capture.pcap");
                    let local_pcap = info.get("local_pcap").and_then(|v| v.as_str()).unwrap_or("");

                    // 从设备拉取pcap文件
                    let mut pull_cmd = Command::new(&adb_path);
                    pull_cmd.args(["pull", remote_pcap, local_pcap]);
                    #[cfg(target_os = "windows")]
                    pull_cmd.creation_flags(0x08000000);
                    let _ = pull_cmd.output();

                    // 清理远程文件
                    let mut rm_cmd = Command::new(&adb_path);
                    rm_cmd.args(["shell", &format!("rm -f {}", remote_pcap)]);
                    #[cfg(target_os = "windows")]
                    rm_cmd.creation_flags(0x08000000);
                    let _ = rm_cmd.output();
                }
            }
        }
    }

    Ok(json!({
        "success": true,
        "message": "tcpdump抓包已停止"
    }))
}

/// 在文件夹中打开抓包记录
#[tauri::command]
pub async fn open_capture_folder(
    case_number: String,
    session_id: String,
    capture_type: String
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 根据抓包类型确定目录
    let session_dir = if capture_type == "realtime" {
        current_dir.join("case").join(&case_number).join("realtime").join(&session_id)
    } else {
        // 对于其他类型，需要从 apk 目录查找
        // 这里简化处理，直接在 case 目录下查找
        let case_dir = current_dir.join("case").join(&case_number);

        // 尝试在 apks 子目录中查找
        let mut found_dir: Option<std::path::PathBuf> = None;
        if let Ok(apks_dir) = fs::read_dir(case_dir.join("apks")) {
            for entry in apks_dir.flatten() {
                let capture_dir = entry.path().join("capture").join(&session_id);
                if capture_dir.exists() {
                    found_dir = Some(capture_dir);
                    break;
                }
            }
        }

        // 也检查 tcpdump 和 proxy 目录
        if found_dir.is_none() {
            let tcpdump_dir = case_dir.join("tcpdump").join(&session_id);
            if tcpdump_dir.exists() {
                found_dir = Some(tcpdump_dir);
            }
        }
        if found_dir.is_none() {
            let proxy_dir = case_dir.join("proxy").join(&session_id);
            if proxy_dir.exists() {
                found_dir = Some(proxy_dir);
            }
        }

        found_dir.ok_or_else(|| "未找到抓包记录目录".to_string())?
    };

    if !session_dir.exists() {
        return Err("抓包记录目录不存在".to_string());
    }

    // 在资源管理器中打开文件夹
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer");
        cmd.arg(&session_dir);
        cmd.creation_flags(0x08000000);
        cmd.spawn().map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&session_dir)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&session_dir)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    Ok(json!({
        "success": true,
        "path": session_dir.to_str().unwrap_or(""),
        "message": "已打开文件夹"
    }))
}

/// 选择脚本文件
#[tauri::command]
pub async fn select_script_file(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app.dialog()
        .file()
        .add_filter("JavaScript", &["js"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            Ok(json!({
                "success": true,
                "path": path.to_string()
            }))
        }
        None => {
            Ok(json!({
                "success": false,
                "message": "未选择文件"
            }))
        }
    }
}

/// 保存辅助脚本
#[tauri::command]
pub async fn save_aux_script(
    source_path: String,
    script_id: String,
    script_name: String,
    description: String,
    category: String
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 确定脚本目标目录
    let scripts_base = current_dir.join("scripts");
    let category_dir = scripts_base.join(&category);
    fs::create_dir_all(&category_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    // 复制脚本文件
    let target_filename = format!("{}.js", script_id);
    let target_path = category_dir.join(&target_filename);
    fs::copy(&source_path, &target_path).map_err(|e| format!("复制脚本失败: {}", e))?;

    // 更新scripts.json
    let scripts_config_path = scripts_base.join("scripts.json");

    let mut config: serde_json::Value = if scripts_config_path.exists() {
        let content = fs::read_to_string(&scripts_config_path)
            .map_err(|e| format!("读取配置失败: {}", e))?;
        serde_json::from_str(&content).unwrap_or(json!({"scripts": [], "categories": {}}))
    } else {
        json!({
            "scripts": [],
            "categories": {
                "bypass": "绕过检测",
                "traffic": "流量控制",
                "intercept": "行为拦截",
                "helper": "应用辅助"
            }
        })
    };

    // 添加新脚本
    let new_script = json!({
        "id": script_id,
        "filename": format!("{}/{}", category, target_filename),
        "name": script_name,
        "description": description,
        "category": category,
        "enabled": true
    });

    if let Some(scripts) = config.get_mut("scripts").and_then(|s| s.as_array_mut()) {
        // 检查是否已存在
        let exists = scripts.iter().any(|s| s.get("id").and_then(|id| id.as_str()) == Some(&script_id));
        if exists {
            return Err("脚本ID已存在".to_string());
        }
        scripts.push(new_script);
    }

    // 保存配置
    fs::write(
        &scripts_config_path,
        serde_json::to_string_pretty(&config).unwrap()
    ).map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(json!({
        "success": true,
        "message": "脚本已保存"
    }))
}

/// 获取本机IP地址
#[tauri::command]
pub async fn get_local_ip() -> Result<serde_json::Value, String> {
    // 通过连接外部地址来获取本机局域网IP
    use std::net::UdpSocket;

    let ip = match UdpSocket::bind("0.0.0.0:0") {
        Ok(socket) => {
            // 连接一个外部地址（不会真正发送数据）
            if socket.connect("8.8.8.8:80").is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    addr.ip().to_string()
                } else {
                    "127.0.0.1".to_string()
                }
            } else {
                "127.0.0.1".to_string()
            }
        }
        Err(_) => "127.0.0.1".to_string()
    };

    Ok(json!({
        "success": true,
        "ip": ip
    }))
}

/// 启动代理抓包 (mitmproxy)
#[tauri::command]
pub async fn start_proxy_capture(
    case_number: String,
    port: u16,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 检查mitmdump是否存在
    let mitmdump_path = if cfg!(target_os = "windows") {
        current_dir.join("frida").join("frida").join("venv").join("Scripts").join("mitmdump.exe")
    } else {
        current_dir.join("frida").join("frida").join("venv").join("bin").join("mitmdump")
    };

    // 如果venv中没有，尝试系统路径
    let mitmdump_cmd = if mitmdump_path.exists() {
        mitmdump_path.to_string_lossy().to_string()
    } else {
        // 尝试直接使用系统命令
        if cfg!(target_os = "windows") { "mitmdump.exe".to_string() } else { "mitmdump".to_string() }
    };

    // 创建抓包会话目录
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let capture_dir = current_dir.join("case").join(&case_number).join("proxy").join(&timestamp);
    fs::create_dir_all(&capture_dir).map_err(|e| format!("创建抓包目录失败: {}", e))?;

    let output_file = capture_dir.join("packets.json");
    let flow_file = capture_dir.join("flows.mitm");

    // 创建内联的mitmdump addon脚本，将流量输出为JSON
    let addon_script = capture_dir.join("addon.py");
    let addon_content = format!(r#"
import json
import time
import os
from mitmproxy import http

OUTPUT_FILE = r"{}"

packets = []

def load_existing():
    global packets
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                packets = json.load(f)
        except:
            packets = []

def save_packets():
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(packets, f, ensure_ascii=False, indent=None)
    except Exception as e:
        print(f"Error saving packets: {{e}}")

def response(flow: http.HTTPFlow):
    global packets
    try:
        req = flow.request
        resp = flow.response

        request_headers = dict(req.headers)
        response_headers = dict(resp.headers) if resp else {{}}

        req_body = ""
        try:
            req_body = req.get_text()[:10000] if req.content else ""
        except:
            req_body = "<binary data>"

        resp_body = ""
        try:
            resp_body = resp.get_text()[:10000] if resp and resp.content else ""
        except:
            resp_body = "<binary data>"

        packet = {{
            "timestamp": int(time.time() * 1000),
            "time": time.strftime("%H:%M:%S"),
            "method": req.method,
            "host": req.host,
            "path": req.path,
            "status": resp.status_code if resp else 0,
            "statusText": resp.reason if resp else "",
            "size": len(resp.content) if resp and resp.content else 0,
            "requestHeaders": request_headers,
            "responseHeaders": response_headers,
            "requestBody": req_body,
            "responseBody": resp_body
        }}

        packets.append(packet)
        save_packets()
    except Exception as e:
        print(f"Error processing flow: {{e}}")
"#, output_file.to_str().unwrap().replace('\\', "\\\\"));

    fs::write(&addon_script, addon_content)
        .map_err(|e| format!("创建addon脚本失败: {}", e))?;

    // 保存会话信息
    let session_info = json!({
        "package": format!("proxy:{}", port),
        "capture_type": "proxy",
        "port": port,
        "start_time": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    });
    fs::write(
        capture_dir.join("session.json"),
        serde_json::to_string_pretty(&session_info).unwrap()
    ).map_err(|e| format!("保存会话信息失败: {}", e))?;

    // 启动mitmdump
    let mut cmd = Command::new(&mitmdump_cmd);
    cmd.arg("-p").arg(port.to_string())
        .arg("-s").arg(addon_script.to_str().unwrap())
        .arg("-w").arg(flow_file.to_str().unwrap())
        .arg("--set").arg("stream_large_bodies=10m")
        .arg("--ssl-insecure");

    let log_file_path = capture_dir.join("proxy.log");
    let log_file = std::fs::File::create(&log_file_path)
        .map_err(|e| format!("创建日志文件失败: {}", e))?;
    let log_file_clone = log_file.try_clone()
        .map_err(|e| format!("复制文件句柄失败: {}", e))?;

    cmd.stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_clone));

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let child = cmd.spawn()
        .map_err(|e| format!("启动代理服务失败: {}。请确保已安装mitmproxy (pip install mitmproxy)", e))?;

    eprintln!("代理抓包进程已启动，端口: {}, 日志: {}", port, log_file_path.display());

    let capture_id = format!("proxy_{}_{}", case_number, timestamp);
    {
        let mut processes = state.capture_processes.lock().unwrap();
        processes.insert(capture_id.clone(), child);
    }

    Ok(json!({
        "success": true,
        "capture_id": capture_id,
        "session_dir": timestamp,
        "port": port,
        "message": format!("代理抓包已启动，端口: {}", port)
    }))
}

/// 停止代理抓包
#[tauri::command]
pub async fn stop_proxy_capture(
    capture_id: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let mut processes = state.capture_processes.lock().unwrap();

    if let Some(mut child) = processes.remove(&capture_id) {
        child.kill().ok();
        child.wait().ok();

        Ok(json!({
            "success": true,
            "message": "代理抓包已停止"
        }))
    } else {
        Err("未找到代理抓包进程".to_string())
    }
}

/// 导出代理CA证书
#[tauri::command]
pub async fn export_proxy_cert() -> Result<serde_json::Value, String> {
    // mitmproxy证书默认在 ~/.mitmproxy/ 目录下
    let home_dir = if cfg!(target_os = "windows") {
        env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string())
    } else {
        env::var("HOME").unwrap_or_else(|_| ".".to_string())
    };

    let cert_dir = std::path::PathBuf::from(&home_dir).join(".mitmproxy");
    let cert_file = cert_dir.join("mitmproxy-ca-cert.pem");

    if !cert_file.exists() {
        return Ok(json!({
            "success": false,
            "message": "证书文件不存在，请先启动一次代理服务以生成证书"
        }));
    }

    // 复制到当前目录方便用户访问
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let export_path = current_dir.join("mitmproxy-ca-cert.pem");
    fs::copy(&cert_file, &export_path)
        .map_err(|e| format!("复制证书失败: {}", e))?;

    // 同时复制cer格式（Android更容易安装）
    let cer_src = cert_dir.join("mitmproxy-ca-cert.cer");
    if cer_src.exists() {
        let cer_dst = current_dir.join("mitmproxy-ca-cert.cer");
        fs::copy(&cer_src, &cer_dst).ok();
    }

    Ok(json!({
        "success": true,
        "path": export_path.to_str().unwrap_or(""),
        "message": "证书已导出"
    }))
}

/// 推送代理CA证书到设备
#[tauri::command]
pub async fn install_proxy_cert() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_path = current_dir.join("adb").join("adb.exe");

    if !adb_path.exists() {
        return Err("ADB工具不存在".to_string());
    }

    // mitmproxy证书路径
    let home_dir = if cfg!(target_os = "windows") {
        env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string())
    } else {
        env::var("HOME").unwrap_or_else(|_| ".".to_string())
    };

    let cert_dir = std::path::PathBuf::from(&home_dir).join(".mitmproxy");
    let cert_file = cert_dir.join("mitmproxy-ca-cert.cer");

    // 如果cer不存在，尝试pem
    let cert_to_push = if cert_file.exists() {
        cert_file
    } else {
        let pem_file = cert_dir.join("mitmproxy-ca-cert.pem");
        if !pem_file.exists() {
            return Ok(json!({
                "success": false,
                "message": "证书文件不存在，请先启动一次代理服务以生成证书"
            }));
        }
        pem_file
    };

    // 推送到设备
    let mut push_cmd = Command::new(&adb_path);
    push_cmd.args(["push", cert_to_push.to_str().unwrap(), "/sdcard/mitmproxy-ca-cert.cer"]);
    #[cfg(target_os = "windows")]
    push_cmd.creation_flags(0x08000000);
    let output = push_cmd.output()
        .map_err(|e| format!("推送证书失败: {}", e))?;

    if output.status.success() {
        Ok(json!({
            "success": true,
            "message": "证书已推送到 /sdcard/mitmproxy-ca-cert.cer，请在设备 设置->安全->安装证书 中安装"
        }))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Ok(json!({
            "success": false,
            "message": format!("推送失败: {}", err)
        }))
    }
}

/// 检测mitmproxy环境
#[tauri::command]
pub async fn check_mitmproxy_env() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 检查venv中的mitmdump
    let mitmdump_path = if cfg!(target_os = "windows") {
        current_dir.join("frida").join("frida").join("venv").join("Scripts").join("mitmdump.exe")
    } else {
        current_dir.join("frida").join("frida").join("venv").join("bin").join("mitmdump")
    };

    if mitmdump_path.exists() {
        // 尝试获取版本
        let mut version_cmd = Command::new(&mitmdump_path);
        version_cmd.arg("--version");
        #[cfg(target_os = "windows")]
        version_cmd.creation_flags(0x08000000);
        let output = version_cmd.output();

        match output {
            Ok(out) if out.status.success() => {
                let version_str = String::from_utf8_lossy(&out.stdout);
                // 解析版本号，格式如 "Mitmproxy: 10.1.1"
                let version = version_str
                    .lines()
                    .find(|line| line.contains("Mitmproxy"))
                    .and_then(|line| line.split(':').nth(1))
                    .map(|v| v.trim().to_string())
                    .unwrap_or_else(|| "unknown".to_string());

                return Ok(json!({
                    "ready": true,
                    "version": version,
                    "path": mitmdump_path.to_str().unwrap_or("")
                }));
            }
            _ => {}
        }
    }

    // 检查系统路径中的mitmdump
    let system_cmd = if cfg!(target_os = "windows") { "mitmdump.exe" } else { "mitmdump" };
    let mut sys_version_cmd = Command::new(system_cmd);
    sys_version_cmd.arg("--version");
    #[cfg(target_os = "windows")]
    sys_version_cmd.creation_flags(0x08000000);
    let output = sys_version_cmd.output();

    match output {
        Ok(out) if out.status.success() => {
            let version_str = String::from_utf8_lossy(&out.stdout);
            let version = version_str
                .lines()
                .find(|line| line.contains("Mitmproxy"))
                .and_then(|line| line.split(':').nth(1))
                .map(|v| v.trim().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            Ok(json!({
                "ready": true,
                "version": version,
                "path": "system"
            }))
        }
        _ => {
            Ok(json!({
                "ready": false,
                "message": "mitmproxy未安装"
            }))
        }
    }
}

/// 安装mitmproxy到frida的venv环境（后台运行，输出到日志文件）
#[tauri::command]
pub async fn install_mitmproxy() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 检查venv是否存在
    let venv_dir = current_dir.join("frida").join("frida").join("venv");
    if !venv_dir.exists() {
        return Ok(json!({
            "success": false,
            "message": "Frida虚拟环境不存在，请先初始化Frida环境"
        }));
    }

    let pip_path = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("pip.exe")
    } else {
        venv_dir.join("bin").join("pip")
    };

    if !pip_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "pip不存在，虚拟环境可能已损坏"
        }));
    }

    // 创建日志文件
    let log_file_path = current_dir.join("frida").join("mitmproxy_install.log");
    let log_file = std::fs::File::create(&log_file_path)
        .map_err(|e| format!("创建日志文件失败: {}", e))?;
    let log_file_stderr = log_file.try_clone()
        .map_err(|e| format!("复制文件句柄失败: {}", e))?;

    // 使用阿里云镜像源加速，添加 --progress-bar on 显示进度
    let mut cmd = Command::new(&pip_path);
    cmd.args([
        "install",
        "mitmproxy",
        "-i", "https://mirrors.aliyun.com/pypi/simple/",
        "--trusted-host", "mirrors.aliyun.com",
        "--progress-bar", "on",
        "-v"  // verbose模式，输出更多信息
    ]);

    cmd.stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_stderr));

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    // 启动后台进程
    let _child = cmd.spawn()
        .map_err(|e| format!("启动安装进程失败: {}", e))?;

    Ok(json!({
        "success": true,
        "installing": true,
        "log_file": log_file_path.to_str().unwrap_or(""),
        "message": "安装已开始，请查看安装进度"
    }))
}

/// 获取mitmproxy安装状态和日志
#[tauri::command]
pub async fn get_mitmproxy_install_status() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let log_file_path = current_dir.join("frida").join("mitmproxy_install.log");

    // 检查日志文件是否存在
    if !log_file_path.exists() {
        return Ok(json!({
            "installing": false,
            "log": "",
            "status": "未开始"
        }));
    }

    // 读取日志文件最后的内容
    let log_content = fs::read_to_string(&log_file_path)
        .unwrap_or_else(|_| String::new());

    // 获取所有行
    let lines: Vec<&str> = log_content.lines().collect();

    // 获取最后20行
    let last_lines: Vec<&str> = if lines.len() > 20 {
        lines[lines.len() - 20..].to_vec()
    } else {
        lines.clone()
    };
    let recent_log = last_lines.join("\n");

    // 判断安装状态
    let status = if log_content.contains("Successfully installed") {
        "completed"
    } else if log_content.contains("ERROR:") || log_content.contains("error:") {
        "error"
    } else if log_content.contains("Downloading") || log_content.contains("Collecting")
           || log_content.contains("Installing") || log_content.contains("Using cached") {
        "installing"
    } else {
        "unknown"
    };

    // 提取当前步骤信息
    let current_step = lines.iter().rev()
        .find(|line| {
            line.contains("Collecting") ||
            line.contains("Downloading") ||
            line.contains("Installing") ||
            line.contains("Successfully")
        })
        .map(|s| s.to_string())
        .unwrap_or_else(|| "准备中...".to_string());

    Ok(json!({
        "installing": status == "installing",
        "completed": status == "completed",
        "error": status == "error",
        "status": status,
        "current_step": current_step,
        "log": recent_log
    }))
}

// ===================== 全流量实时抓包 =====================

/// 解析 tcpdump 单行输出为 NetworkPacket
fn parse_tcpdump_line(line: &str, counter: &mut u64, device_ip: &str) -> Option<NetworkPacket> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    *counter += 1;

    // tcpdump -n -l -q -tttt 输出格式:
    // 2026-02-02 12:00:00.123456 IP 10.0.2.15.54321 > 93.184.216.34.443: tcp 120
    // 2026-02-02 12:00:00.123456 IP 10.0.2.15.12345 > 8.8.8.8.53: UDP, length 40

    let mut timestamp = String::new();
    let mut time_str = String::new();
    let mut proto_hint = String::new();
    let mut length: u32 = 0;

    // 尝试解析带日期的格式
    let parts: Vec<&str> = line.splitn(4, ' ').collect();

    let rest = if parts.len() >= 4 && parts[0].contains('-') && parts[1].contains(':') {
        timestamp = format!("{} {}", parts[0], parts[1]);
        time_str = parts[1].split('.').next().unwrap_or(parts[1]).to_string();
        parts[3]
    } else if parts.len() >= 3 && parts[0].contains(':') {
        timestamp = parts[0].to_string();
        time_str = parts[0].split('.').next().unwrap_or(parts[0]).to_string();
        if parts.len() >= 3 {
            &line[parts[0].len() + 1 + parts[1].len() + 1..]
        } else {
            return Some(make_raw_packet(*counter, &time_str, line));
        }
    } else {
        return Some(make_raw_packet(*counter, "", line));
    };

    // rest: "10.0.2.15.54321 > 93.184.216.34.443: tcp 120"
    let arrow_pos = rest.find(" > ");
    if arrow_pos.is_none() {
        return Some(make_raw_packet(*counter, &time_str, line));
    }

    let arrow_pos = arrow_pos.unwrap();
    let src_full = rest[..arrow_pos].trim().to_string();

    let after_arrow = &rest[arrow_pos + 3..];
    let colon_pos = after_arrow.find(": ");
    let dst_full;
    if let Some(cp) = colon_pos {
        dst_full = after_arrow[..cp].trim().trim_end_matches(':').to_string();
        let tail = after_arrow[cp + 2..].trim();
        proto_hint = tail.to_string();

        if let Some(len_pos) = tail.find("length ") {
            let len_str = &tail[len_pos + 7..];
            let len_end = len_str.find(|c: char| !c.is_ascii_digit()).unwrap_or(len_str.len());
            length = len_str[..len_end].parse().unwrap_or(0);
        }
    } else {
        dst_full = after_arrow.trim().to_string();
    }

    let (src_addr, src_port) = parse_addr_port(&src_full);
    let (dst_addr, dst_port) = parse_addr_port(&dst_full);

    let protocol = detect_protocol(&proto_hint, src_port, dst_port);

    let direction = if !device_ip.is_empty() {
        if src_addr == device_ip { "OUT".to_string() }
        else if dst_addr == device_ip { "IN".to_string() }
        else { "-".to_string() }
    } else { "-".to_string() };

    let info = extract_info(&proto_hint, &protocol, dst_port);
    let flags = extract_tcp_flags(&proto_hint);

    Some(NetworkPacket {
        id: *counter,
        timestamp,
        time: time_str,
        protocol,
        src_addr,
        src_port,
        dst_addr,
        dst_port,
        direction,
        length,
        info,
        flags,
        raw: line.to_string(),
        hex_dump: String::new(),
        ascii_dump: String::new(),
        payload: String::new(),
    })
}

fn make_raw_packet(id: u64, time: &str, raw: &str) -> NetworkPacket {
    NetworkPacket {
        id, timestamp: String::new(), time: time.to_string(),
        protocol: "OTHER".to_string(), src_addr: String::new(), src_port: 0,
        dst_addr: String::new(), dst_port: 0, direction: "-".to_string(),
        length: 0, info: raw.chars().take(100).collect(), flags: String::new(),
        raw: raw.to_string(),
        hex_dump: String::new(),
        ascii_dump: String::new(),
        payload: String::new(),
    }
}

fn parse_addr_port(s: &str) -> (String, u16) {
    let s = s.trim();
    if let Some(last_dot) = s.rfind('.') {
        let port_str = &s[last_dot + 1..];
        if let Ok(port) = port_str.parse::<u16>() {
            let addr = &s[..last_dot];
            if addr.chars().filter(|c| *c == '.').count() >= 1 {
                return (addr.to_string(), port);
            }
        }
    }
    (s.to_string(), 0)
}

fn detect_protocol(proto_hint: &str, src_port: u16, dst_port: u16) -> String {
    let hint_lower = proto_hint.to_lowercase();
    if src_port == 53 || dst_port == 53 { return "DNS".to_string(); }
    if dst_port == 80 || src_port == 80 { return "HTTP".to_string(); }
    if dst_port == 443 || src_port == 443 { return "HTTPS".to_string(); }
    if hint_lower.contains("udp") { return "UDP".to_string(); }
    if hint_lower.contains("flags") || hint_lower.starts_with("tcp") || hint_lower.contains("seq ") { return "TCP".to_string(); }
    if hint_lower.contains("icmp") { return "ICMP".to_string(); }
    "TCP".to_string()
}

fn extract_info(proto_hint: &str, protocol: &str, dst_port: u16) -> String {
    match protocol {
        "DNS" => {
            if let Some(q_pos) = proto_hint.find("? ") {
                let after_q = &proto_hint[q_pos + 2..];
                let domain = after_q.split_whitespace().next().unwrap_or("").trim_end_matches('.');
                return format!("Query: {}", domain);
            }
            if proto_hint.contains("/0/0") || proto_hint.contains("/1/0") { return "Response".to_string(); }
            proto_hint.chars().take(60).collect()
        }
        "HTTP" => format!("port {}", dst_port),
        "HTTPS" => format!("TLS → port {}", dst_port),
        _ => {
            let flags = extract_tcp_flags(proto_hint);
            if !flags.is_empty() { return flags; }
            if proto_hint.len() > 60 { proto_hint.chars().take(60).collect::<String>() + "..." }
            else { proto_hint.to_string() }
        }
    }
}

fn extract_tcp_flags(proto_hint: &str) -> String {
    if let Some(flags_pos) = proto_hint.find("Flags [") {
        let after = &proto_hint[flags_pos + 7..];
        if let Some(end) = after.find(']') {
            let flags_str = &after[..end];
            let readable = flags_str.chars().map(|c| match c {
                'S' => "SYN", 'F' => "FIN", 'R' => "RST", 'P' => "PSH", '.' => "ACK", 'U' => "URG", _ => "",
            }).filter(|s| !s.is_empty()).collect::<Vec<&str>>().join(",");
            return format!("[{}]", readable);
        }
    }
    String::new()
}

/// 解析 tcpdump -X 输出的数据包头部行
fn parse_tcpdump_header(line: &str, counter: &mut u64, device_ip: &str) -> Option<NetworkPacket> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    *counter += 1;

    // tcpdump -X -tttt 输出格式:
    // 2026-02-02 12:00:00.123456 IP 10.0.2.15.54321 > 93.184.216.34.443: Flags [S], seq 123, win 65535, length 0

    let mut timestamp = String::new();
    let mut time_str = String::new();
    let mut proto_hint = String::new();
    let mut length: u32 = 0;

    // 解析时间戳
    let parts: Vec<&str> = line.splitn(4, ' ').collect();

    let rest = if parts.len() >= 4 && parts[0].contains('-') && parts[1].contains(':') {
        timestamp = format!("{} {}", parts[0], parts[1]);
        time_str = parts[1].split('.').next().unwrap_or(parts[1]).to_string();
        parts[3]
    } else if parts.len() >= 3 && parts[0].contains(':') {
        timestamp = parts[0].to_string();
        time_str = parts[0].split('.').next().unwrap_or(parts[0]).to_string();
        &line[parts[0].len() + 1..]
    } else {
        return Some(NetworkPacket {
            id: *counter, timestamp: String::new(), time: String::new(),
            protocol: "OTHER".to_string(), src_addr: String::new(), src_port: 0,
            dst_addr: String::new(), dst_port: 0, direction: "-".to_string(),
            length: 0, info: line.chars().take(100).collect(), flags: String::new(),
            raw: line.to_string(), hex_dump: String::new(), ascii_dump: String::new(), payload: String::new(),
        });
    };

    // 解析 IP 地址
    let arrow_pos = rest.find(" > ");
    if arrow_pos.is_none() {
        return Some(NetworkPacket {
            id: *counter, timestamp, time: time_str,
            protocol: "OTHER".to_string(), src_addr: String::new(), src_port: 0,
            dst_addr: String::new(), dst_port: 0, direction: "-".to_string(),
            length: 0, info: rest.chars().take(100).collect(), flags: String::new(),
            raw: line.to_string(), hex_dump: String::new(), ascii_dump: String::new(), payload: String::new(),
        });
    }

    let arrow_pos = arrow_pos.unwrap();
    // 跳过 "IP " 或 "IP6 "
    let src_start = if rest.starts_with("IP6 ") { 4 } else if rest.starts_with("IP ") { 3 } else { 0 };
    let src_full = rest[src_start..arrow_pos].trim().to_string();

    let after_arrow = &rest[arrow_pos + 3..];
    let colon_pos = after_arrow.find(": ");
    let dst_full;
    if let Some(cp) = colon_pos {
        dst_full = after_arrow[..cp].trim().trim_end_matches(':').to_string();
        let tail = after_arrow[cp + 2..].trim();
        proto_hint = tail.to_string();

        // 提取长度
        if let Some(len_pos) = tail.find("length ") {
            let len_str = &tail[len_pos + 7..];
            let len_end = len_str.find(|c: char| !c.is_ascii_digit()).unwrap_or(len_str.len());
            length = len_str[..len_end].parse().unwrap_or(0);
        }
    } else {
        dst_full = after_arrow.trim().to_string();
    }

    let (src_addr, src_port) = parse_addr_port(&src_full);
    let (dst_addr, dst_port) = parse_addr_port(&dst_full);

    let protocol = detect_protocol(&proto_hint, src_port, dst_port);

    let direction = if !device_ip.is_empty() {
        if src_addr == device_ip { "OUT".to_string() }
        else if dst_addr == device_ip { "IN".to_string() }
        else { "-".to_string() }
    } else { "-".to_string() };

    let info = extract_info(&proto_hint, &protocol, dst_port);
    let flags = extract_tcp_flags(&proto_hint);

    Some(NetworkPacket {
        id: *counter,
        timestamp,
        time: time_str,
        protocol,
        src_addr,
        src_port,
        dst_addr,
        dst_port,
        direction,
        length,
        info,
        flags,
        raw: line.to_string(),
        hex_dump: String::new(),
        ascii_dump: String::new(),
        payload: String::new(),
    })
}

/// 解析十六进制数据行
/// 格式: 0x0000:  4500 003c 1c46 4000 4006 b1e6 ac10 0a63  E..<.F@.@......c
fn parse_hex_line(line: &str) -> Option<(String, String)> {
    // 跳过偏移量部分 "0x0000:"
    let colon_pos = line.find(':')?;
    let after_colon = line[colon_pos + 1..].trim();

    // 分割成十六进制部分和 ASCII 部分
    // 十六进制部分约 48 个字符，后面跟着 ASCII
    if after_colon.len() < 2 {
        return None;
    }

    // 找到ASCII部分（通常在两个空格后）
    let parts: Vec<&str> = after_colon.splitn(2, "  ").collect();
    if parts.len() >= 2 {
        let hex_part = parts[0].trim().to_string();
        let ascii_part = parts[1].trim().to_string();
        Some((hex_part, ascii_part))
    } else {
        // 只有十六进制部分
        Some((after_colon.to_string(), String::new()))
    }
}

/// 从十六进制数据中提取可读的 payload
fn extract_payload_from_hex(hex_lines: &[String]) -> String {
    let mut payload = String::new();

    for hex_line in hex_lines {
        // 解析十六进制字节
        for hex_byte in hex_line.split_whitespace() {
            if hex_byte.len() == 4 {
                // 两个字节
                if let Ok(b1) = u8::from_str_radix(&hex_byte[0..2], 16) {
                    if b1 >= 0x20 && b1 < 0x7f {
                        payload.push(b1 as char);
                    } else if b1 == 0x0a || b1 == 0x0d {
                        payload.push('\n');
                    } else {
                        payload.push('.');
                    }
                }
                if let Ok(b2) = u8::from_str_radix(&hex_byte[2..4], 16) {
                    if b2 >= 0x20 && b2 < 0x7f {
                        payload.push(b2 as char);
                    } else if b2 == 0x0a || b2 == 0x0d {
                        payload.push('\n');
                    } else {
                        payload.push('.');
                    }
                }
            } else if hex_byte.len() == 2 {
                // 单个字节
                if let Ok(b) = u8::from_str_radix(hex_byte, 16) {
                    if b >= 0x20 && b < 0x7f {
                        payload.push(b as char);
                    } else if b == 0x0a || b == 0x0d {
                        payload.push('\n');
                    } else {
                        payload.push('.');
                    }
                }
            }
        }
    }

    payload
}

fn get_device_ip(adb_path: &std::path::Path) -> String {
    for iface in &["wlan0", "eth0"] {
        let mut cmd = Command::new(adb_path);
        cmd.args(["shell", &format!("ip addr show {} 2>/dev/null | grep 'inet ' | awk '{{print $2}}' | cut -d/ -f1", iface)]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        let output = cmd.output();
        if let Ok(out) = &output {
            let ip = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !ip.is_empty() && ip.contains('.') { return ip; }
        }
    }
    String::new()
}

/// 获取应用的 UID
fn get_app_uid(adb_path: &std::path::Path, package_name: &str) -> Result<Option<u32>, String> {
    // 使用 dumpsys package 获取应用的 userId
    let mut cmd = Command::new(adb_path);
    cmd.args(["shell", &format!("dumpsys package {} | grep userId=", package_name)]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let output = cmd.output()
        .map_err(|e| format!("获取应用UID失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // 解析 userId=xxxxx 格式
    for line in stdout.lines() {
        if let Some(start) = line.find("userId=") {
            let uid_str = &line[start + 7..];
            // 提取数字部分
            let uid_end = uid_str.find(|c: char| !c.is_ascii_digit()).unwrap_or(uid_str.len());
            if let Ok(uid) = uid_str[..uid_end].parse::<u32>() {
                return Ok(Some(uid));
            }
        }
    }

    // 如果没找到，尝试另一种方式
    let mut cmd2 = Command::new(adb_path);
    cmd2.args(["shell", &format!("stat -c %u /data/data/{} 2>/dev/null", package_name)]);
    #[cfg(target_os = "windows")]
    cmd2.creation_flags(0x08000000);
    let output2 = cmd2.output();

    if let Ok(out) = output2 {
        let uid_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if let Ok(uid) = uid_str.parse::<u32>() {
            return Ok(Some(uid));
        }
    }

    Ok(None)
}

/// 启动全流量实时抓包
#[tauri::command]
pub async fn start_realtime_capture(
    case_number: String,
    package_name: Option<String>,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_path = current_dir.join("adb").join("adb.exe");
    if !adb_path.exists() { return Err("ADB工具不存在".to_string()); }

    // 检查 root
    let mut root_cmd = Command::new(&adb_path);
    root_cmd.args(["shell", "su -c 'id'"]);
    #[cfg(target_os = "windows")]
    root_cmd.creation_flags(0x08000000);
    let root_check = root_cmd.output()
        .map_err(|e| format!("检查root失败: {}", e))?;
    if !String::from_utf8_lossy(&root_check.stdout).contains("uid=0") {
        return Err("设备需要ROOT权限".to_string());
    }

    // 检查 tcpdump
    let mut tcpdump_cmd = Command::new(&adb_path);
    tcpdump_cmd.args(["shell", "su -c 'which tcpdump'"]);
    #[cfg(target_os = "windows")]
    tcpdump_cmd.creation_flags(0x08000000);
    let tcpdump_check = tcpdump_cmd.output()
        .map_err(|e| format!("检查tcpdump失败: {}", e))?;
    if String::from_utf8_lossy(&tcpdump_check.stdout).trim().is_empty() {
        return Err("设备上未安装tcpdump".to_string());
    }

    // 如果指定了包名，获取应用的 UID
    let app_uid: Option<u32> = if let Some(ref pkg) = package_name {
        get_app_uid(&adb_path, pkg)?
    } else {
        None
    };

    let device_ip = get_device_ip(&adb_path);
    let mut killall_cmd = Command::new(&adb_path);
    killall_cmd.args(["shell", "su -c 'killall tcpdump 2>/dev/null'"]);
    #[cfg(target_os = "windows")]
    killall_cmd.creation_flags(0x08000000);
    let _ = killall_cmd.output();

    // 清除之前的 iptables 标记规则
    let mut iptables_cmd = Command::new(&adb_path);
    iptables_cmd.args(["shell", "su -c 'iptables -t mangle -F OUTPUT 2>/dev/null'"]);
    #[cfg(target_os = "windows")]
    iptables_cmd.creation_flags(0x08000000);
    let _ = iptables_cmd.output();

    std::thread::sleep(std::time::Duration::from_millis(300));

    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let capture_dir = current_dir.join("case").join(&case_number).join("realtime").join(&timestamp);
    fs::create_dir_all(&capture_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let capture_id = format!("realtime_{}_{}", case_number, timestamp);

    // 记录会话信息（包含包名）
    let session_package = package_name.clone().unwrap_or_else(|| "全流量抓包".to_string());
    fs::write(capture_dir.join("session.json"), serde_json::to_string_pretty(&json!({
        "package": session_package, "capture_type": "realtime", "device_ip": device_ip,
        "app_uid": app_uid,
        "start_time": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    })).unwrap()).ok();

    let remote_pcap = "/data/local/tmp/realtime_capture.pcap";
    fs::write(capture_dir.join("pcap_info.json"), serde_json::to_string_pretty(&json!({
        "remote_pcap": remote_pcap, "local_pcap": capture_dir.join("capture.pcap").to_str().unwrap_or(""),
        "capture_dir": capture_dir.to_str().unwrap_or("")
    })).unwrap()).ok();

    // 如果指定了 UID，设置 iptables 标记
    if let Some(uid) = app_uid {
        // 使用 iptables 标记指定 UID 的流量
        let mark_cmd_str = format!(
            "su -c 'iptables -t mangle -A OUTPUT -m owner --uid-owner {} -j MARK --set-mark 100'",
            uid
        );
        let mut mark_cmd = Command::new(&adb_path);
        mark_cmd.args(["shell", &mark_cmd_str]);
        #[cfg(target_os = "windows")]
        mark_cmd.creation_flags(0x08000000);
        let _ = mark_cmd.output();
    }

    // 构建 tcpdump 命令
    // 如果指定了 UID，我们仍然抓取所有流量，但在后端过滤（因为 tcpdump 无法直接按 mark 过滤）
    // 这里我们使用另一种方式：获取应用的 IP 连接并在解析时过滤

    // 后台 pcap 写入
    let mut pcap_cmd = Command::new(&adb_path);
    pcap_cmd.args(["shell", &format!("su -c 'tcpdump -i any -w {} -U'", remote_pcap)]);
    #[cfg(target_os = "windows")]
    pcap_cmd.creation_flags(0x08000000);
    let pcap_child = pcap_cmd.spawn().map_err(|e| format!("启动pcap写入失败: {}", e))?;

    // 实时输出 - 使用 -X 获取十六进制数据
    let mut cmd = Command::new(&adb_path);
    cmd.args(["shell", "su -c 'tcpdump -i any -n -l -tttt -X -s 0 2>/dev/null'"]);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| format!("启动抓包失败: {}", e))?;
    let stdout = child.stdout.take().ok_or("无法获取输出")?;

    {
        let mut buffers = state.tcpdump_buffers.lock().unwrap();
        buffers.insert(capture_id.clone(), TcpdumpBuffer { packets: Vec::new(), running: true, packet_counter: 0 });
    }
    {
        let mut processes = state.capture_processes.lock().unwrap();
        processes.insert(format!("{}_pcap", capture_id), pcap_child);
    }

    // 克隆 Arc 以传递给线程
    let tcpdump_buffers = state.tcpdump_buffers.clone();
    let capture_id_clone = capture_id.clone();
    let device_ip_clone = device_ip.clone();

    // 如果指定了包名，获取该应用的 IP 地址列表用于过滤
    let filter_ips: Option<Vec<String>> = if package_name.is_some() && app_uid.is_some() {
        // 获取应用的网络连接（这里可以后续扩展）
        // 目前简化处理：不做 IP 过滤，让用户可以看到所有流量
        None
    } else {
        None
    };

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut counter: u64 = 0;
        let mut current_packet: Option<NetworkPacket> = None;
        let mut hex_lines: Vec<String> = Vec::new();
        let mut ascii_lines: Vec<String> = Vec::new();

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let trimmed = line.trim();

                    // 检查是否是新数据包的开始（以时间戳开头）
                    let is_new_packet = trimmed.len() > 10 &&
                        (trimmed.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)) &&
                        (trimmed.contains(" IP ") || trimmed.contains(" IP6 "));

                    // 检查是否是十六进制数据行（以0x开头的偏移量）
                    let is_hex_line = trimmed.starts_with("0x");

                    if is_new_packet {
                        // 保存之前的数据包
                        if let Some(mut pkt) = current_packet.take() {
                            pkt.hex_dump = hex_lines.join("\n");
                            pkt.ascii_dump = ascii_lines.join("\n");
                            // 尝试提取可读payload
                            pkt.payload = extract_payload_from_hex(&hex_lines);

                            let mut buffers = tcpdump_buffers.lock().unwrap();
                            if let Some(buffer) = buffers.get_mut(&capture_id_clone) {
                                if !buffer.running { break; }
                                buffer.packets.push(pkt);
                                buffer.packet_counter = counter;
                                if buffer.packets.len() > 10000 { buffer.packets.drain(0..1000); }
                            } else { break; }
                        }

                        // 解析新数据包头部
                        hex_lines.clear();
                        ascii_lines.clear();
                        current_packet = parse_tcpdump_header(&line, &mut counter, &device_ip_clone);
                    } else if is_hex_line && current_packet.is_some() {
                        // 解析十六进制数据行
                        // 格式: 0x0000:  4500 003c 1c46 4000 4006 b1e6 ac10 0a63  E..<.F@.@......c
                        if let Some((hex_part, ascii_part)) = parse_hex_line(trimmed) {
                            hex_lines.push(hex_part);
                            ascii_lines.push(ascii_part);
                        }
                    }
                }
                Err(_) => break,
            }
        }

        // 保存最后一个数据包
        if let Some(mut pkt) = current_packet.take() {
            pkt.hex_dump = hex_lines.join("\n");
            pkt.ascii_dump = ascii_lines.join("\n");
            pkt.payload = extract_payload_from_hex(&hex_lines);

            let mut buffers = tcpdump_buffers.lock().unwrap();
            if let Some(buffer) = buffers.get_mut(&capture_id_clone) {
                buffer.packets.push(pkt);
            }
        }

        let mut buffers = tcpdump_buffers.lock().unwrap();
        if let Some(buffer) = buffers.get_mut(&capture_id_clone) { buffer.running = false; }
    });

    { state.capture_processes.lock().unwrap().insert(capture_id.clone(), child); }

    Ok(json!({ "success": true, "capture_id": capture_id, "session_dir": timestamp, "device_ip": device_ip, "message": "全流量抓包已启动" }))
}

/// 获取实时抓包数据
#[tauri::command]
pub async fn get_realtime_packets(
    capture_id: String,
    since_id: Option<u64>,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let buffers = state.tcpdump_buffers.lock().unwrap();
    if let Some(buffer) = buffers.get(&capture_id) {
        let since = since_id.unwrap_or(0);
        let new_packets: Vec<&NetworkPacket> = buffer.packets.iter().filter(|p| p.id > since).collect();

        let (mut tcp, mut udp, mut dns, mut http, mut https, mut other) = (0u32, 0, 0, 0, 0, 0);
        for p in &buffer.packets {
            match p.protocol.as_str() {
                "TCP" => tcp += 1, "UDP" => udp += 1, "DNS" => dns += 1,
                "HTTP" => http += 1, "HTTPS" => https += 1, _ => other += 1,
            }
        }

        Ok(json!({ "success": true, "packets": new_packets, "total": buffer.packets.len(), "running": buffer.running,
            "stats": { "tcp": tcp, "udp": udp, "dns": dns, "http": http, "https": https, "other": other } }))
    } else {
        Ok(json!({ "success": true, "packets": [], "total": 0, "running": false, "stats": {} }))
    }
}

/// 停止全流量实时抓包
#[tauri::command]
pub async fn stop_realtime_capture(
    capture_id: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_path = current_dir.join("adb").join("adb.exe");

    { if let Some(buffer) = state.tcpdump_buffers.lock().unwrap().get_mut(&capture_id) { buffer.running = false; } }

    let mut kill_cmd = Command::new(&adb_path);
    kill_cmd.args(["shell", "su -c 'killall tcpdump 2>/dev/null'"]);
    #[cfg(target_os = "windows")]
    kill_cmd.creation_flags(0x08000000);
    let _ = kill_cmd.output();

    // 清除 iptables 标记规则
    let mut iptables_cmd = Command::new(&adb_path);
    iptables_cmd.args(["shell", "su -c 'iptables -t mangle -F OUTPUT 2>/dev/null'"]);
    #[cfg(target_os = "windows")]
    iptables_cmd.creation_flags(0x08000000);
    let _ = iptables_cmd.output();

    std::thread::sleep(std::time::Duration::from_millis(500));

    {
        let mut processes = state.capture_processes.lock().unwrap();
        if let Some(mut child) = processes.remove(&capture_id) { child.kill().ok(); child.wait().ok(); }
        if let Some(mut child) = processes.remove(&format!("{}_pcap", capture_id)) { child.kill().ok(); child.wait().ok(); }
    }

    let parts: Vec<&str> = capture_id.split('_').collect();
    if parts.len() >= 3 {
        let capture_dir = current_dir.join("case").join(parts[1]).join("realtime").join(parts[2]);
        if let Ok(content) = fs::read_to_string(capture_dir.join("pcap_info.json")) {
            if let Ok(info) = serde_json::from_str::<serde_json::Value>(&content) {
                let remote = info.get("remote_pcap").and_then(|v| v.as_str()).unwrap_or("");
                let local = info.get("local_pcap").and_then(|v| v.as_str()).unwrap_or("");
                if !local.is_empty() {
                    let mut pull_cmd = Command::new(&adb_path);
                    pull_cmd.args(["pull", remote, local]);
                    #[cfg(target_os = "windows")]
                    pull_cmd.creation_flags(0x08000000);
                    let _ = pull_cmd.output();
                }
                let mut rm_cmd = Command::new(&adb_path);
                rm_cmd.args(["shell", &format!("su -c 'rm -f {}'", remote)]);
                #[cfg(target_os = "windows")]
                rm_cmd.creation_flags(0x08000000);
                let _ = rm_cmd.output();
            }
        }
        if let Some(buffer) = state.tcpdump_buffers.lock().unwrap().get(&capture_id) {
            fs::write(capture_dir.join("packets.json"), serde_json::to_string(&buffer.packets).unwrap_or_else(|_| "[]".to_string())).ok();
        }
    }

    state.tcpdump_buffers.lock().unwrap().remove(&capture_id);
    Ok(json!({ "success": true, "message": "全流量抓包已停止" }))
}
