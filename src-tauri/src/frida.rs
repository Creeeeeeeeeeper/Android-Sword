use std::fs;
use std::env;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::state::{AppState, FridaOutputBuffer, FridaOutputLine};

// 全局Frida输出缓冲区
lazy_static::lazy_static! {
    pub static ref FRIDA_OUTPUT_BUFFERS: Arc<Mutex<HashMap<String, FridaOutputBuffer>>> = Arc::new(Mutex::new(HashMap::new()));
}

/// Frida脚本配置结构
#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct FridaScript {
    pub id: String,
    pub filename: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub enabled: bool,
}

#[derive(serde::Deserialize)]
pub struct FridaScriptsConfig {
    pub scripts: Vec<FridaScript>,
    pub categories: HashMap<String, String>,
}

/// 保存Frida脚本的信息结构
#[derive(serde::Deserialize)]
pub struct ScriptInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
}

/// 检查Frida环境是否就绪
#[tauri::command]
pub async fn check_frida_env() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let frida_venv = current_dir.join("frida").join("frida").join("venv");

    let (frida_exe, frida_python) = if cfg!(target_os = "windows") {
        (frida_venv.join("Scripts").join("frida.exe"), frida_venv.join("Scripts").join("python.exe"))
    } else {
        (frida_venv.join("bin").join("frida"), frida_venv.join("bin").join("python"))
    };

    if !frida_venv.exists() || !frida_exe.exists() {
        return Ok(json!({
            "ready": false,
            "version": null
        }));
    }

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

/// 初始化Frida环境
#[tauri::command]
pub async fn init_frida_env() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let frida_dir = current_dir.join("frida").join("frida");
    let frida_venv = frida_dir.join("venv");

    fs::create_dir_all(&frida_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let pip_exe = if cfg!(target_os = "windows") {
        frida_venv.join("Scripts").join("pip.exe")
    } else {
        frida_venv.join("bin").join("pip")
    };

    if !pip_exe.exists() {
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

    eprintln!("正在升级pip...");
    let _ = Command::new(&pip_exe)
        .args(&["install", "--upgrade", "pip"])
        .creation_flags(0x08000000)
        .status();

    let packages = vec![
        "frida==17.5.2",
        "frida-tools==13.5.2",
        "loguru",
        "click",
        "hexdump",
    ];

    for package in &packages {
        eprintln!("正在安装 {}...", package);

        let install_result = Command::new(&pip_exe)
            .args(&["install", package])
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| format!("安装{}失败: {}", package, e))?;

        if !install_result.success() {
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

/// 推送并启动Frida Server
#[tauri::command]
pub async fn start_frida_server() -> Result<serde_json::Value, String> {
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

    eprintln!("正在推送frida-server到设备...");
    let push_result = Command::new(&adb_exe)
        .args(&["push", server_path.to_str().unwrap(), "/data/local/tmp/frida-server"])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("推送frida-server失败: {}", e))?;

    if !push_result.success() {
        return Err("推送frida-server失败".to_string());
    }

    Command::new(&adb_exe)
        .args(&["shell", "chmod", "755", "/data/local/tmp/frida-server"])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("设置权限失败: {}", e))?;

    Command::new(&adb_exe)
        .args(&["shell", "su", "-c", "/data/local/tmp/frida-server -D &"])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("启动frida-server失败: {}", e))?;

    std::thread::sleep(std::time::Duration::from_secs(2));

    Ok(json!({
        "success": true,
        "message": "Frida Server已启动"
    }))
}

/// 检查Frida Server是否正在运行
#[tauri::command]
pub async fn check_frida_server_status() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb").join("adb.exe");

    if !adb_exe.exists() {
        return Ok(json!({
            "running": false,
            "message": "ADB工具不存在"
        }));
    }

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

/// 停止Frida Server
#[tauri::command]
pub async fn stop_frida_server() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb").join("adb.exe");

    if !adb_exe.exists() {
        return Err("ADB工具不存在".to_string());
    }

    let _ = Command::new(&adb_exe)
        .args(&["shell", "su -c 'pkill -9 frida-server'"])
        .creation_flags(0x08000000)
        .status();

    let _ = Command::new(&adb_exe)
        .args(&["shell", "su -c 'killall frida-server'"])
        .creation_flags(0x08000000)
        .status();

    std::thread::sleep(std::time::Duration::from_millis(500));

    Ok(json!({
        "success": true,
        "message": "Frida Server已停止"
    }))
}

/// 获取Frida脚本列表
#[tauri::command]
pub async fn get_frida_scripts() -> Result<serde_json::Value, String> {
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

/// 运行Frida脚本
#[tauri::command]
pub async fn run_frida_scripts(
    package_name: String,
    scripts: Vec<String>,
    custom_scripts: Option<Vec<String>>,
    spawn_mode: bool,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    let frida_exe = if cfg!(target_os = "windows") {
        current_dir.join("frida").join("frida").join("venv").join("Scripts").join("frida.exe")
    } else {
        current_dir.join("frida").join("frida").join("venv").join("bin").join("frida")
    };

    if !frida_exe.exists() {
        return Err("Frida环境未初始化，请先初始化Frida环境".to_string());
    }

    let scripts_dir = current_dir.join("frida").join("scripts");

    let mut combined_script = String::new();

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

    // 加载普通脚本
    for script_name in &scripts {
        let script_path = scripts_dir.join(script_name);
        if script_path.exists() {
            if let Ok(content) = fs::read_to_string(&script_path) {
                combined_script.push_str(&format!("\n    // === {} ===\n", script_name));
                for line in content.lines() {
                    combined_script.push_str("    ");
                    combined_script.push_str(line);
                    combined_script.push_str("\n");
                }
                combined_script.push_str("\n");
            }
        }
    }

    // 加载自定义脚本
    if let Some(custom_script_paths) = custom_scripts {
        for custom_path in &custom_script_paths {
            let script_path = std::path::Path::new(custom_path);
            if script_path.exists() {
                if let Ok(content) = fs::read_to_string(&script_path) {
                    let file_name = script_path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "custom_script".to_string());
                    combined_script.push_str(&format!("\n    // === [自定义] {} ===\n", file_name));
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

    combined_script.push_str("});\n\nconsole.log('[*] All scripts queued for loading');\n");

    let temp_script_path = current_dir.join("frida").join("temp_combined_script.js");
    fs::write(&temp_script_path, &combined_script)
        .map_err(|e| format!("写入临时脚本失败: {}", e))?;

    let process_id = format!("frida_{}", chrono::Local::now().format("%Y%m%d%H%M%S%3f"));

    let mut cmd = Command::new(&frida_exe);
    cmd.arg("-U");
    cmd.arg("-l").arg(&temp_script_path);

    if spawn_mode {
        cmd.arg("-f").arg(&package_name);
    } else {
        cmd.arg(&package_name);
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

/// 停止Frida脚本
#[tauri::command]
pub async fn stop_frida_scripts(
    process_id: String,
    state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    {
        let mut processes = state.frida_processes.lock().unwrap();
        if let Some(mut child) = processes.remove(&process_id) {
            child.kill().ok();
            child.wait().ok();
        }
    }

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

/// 获取Frida输出
#[tauri::command]
pub async fn get_frida_output(
    process_id: String,
    _state: tauri::State<'_, AppState>
) -> Result<serde_json::Value, String> {
    let mut outputs = FRIDA_OUTPUT_BUFFERS.lock().unwrap();

    if let Some(buffer) = outputs.get_mut(&process_id) {
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

/// 保存Frida输出
#[tauri::command]
pub async fn save_frida_output(filename: String, content: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let output_dir = current_dir.join("frida").join("output");

    fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;

    let output_path = output_dir.join(&filename);
    fs::write(&output_path, &content).map_err(|e| format!("保存输出失败: {}", e))?;

    Ok(json!({
        "success": true,
        "path": output_path.to_string_lossy().to_string(),
        "message": "输出已保存"
    }))
}

/// 保存Frida脚本到列表
#[tauri::command]
pub async fn save_frida_script(
    source_path: String,
    script_info: ScriptInfo,
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let scripts_dir = current_dir.join("frida").join("scripts");
    let scripts_json_path = scripts_dir.join("scripts.json");

    if !scripts_dir.exists() {
        fs::create_dir_all(&scripts_dir).map_err(|e| format!("创建scripts目录失败: {}", e))?;
    }

    let source = std::path::Path::new(&source_path);
    if !source.exists() {
        return Err(format!("源脚本文件不存在: {}", source_path));
    }

    let script_content = fs::read_to_string(&source)
        .map_err(|e| format!("读取脚本文件失败: {}", e))?;

    let target_filename = format!("{}.js", script_info.id);
    let target_path = scripts_dir.join(&target_filename);

    if target_path.exists() {
        return Err(format!("脚本文件已存在: {}", target_filename));
    }

    fs::write(&target_path, script_content)
        .map_err(|e| format!("保存脚本文件失败: {}", e))?;

    let mut scripts: Vec<serde_json::Value> = if scripts_json_path.exists() {
        let json_content = fs::read_to_string(&scripts_json_path)
            .map_err(|e| format!("读取scripts.json失败: {}", e))?;
        serde_json::from_str(&json_content).unwrap_or_else(|_| Vec::new())
    } else {
        Vec::new()
    };

    scripts.push(json!({
        "id": script_info.id,
        "name": script_info.name,
        "description": script_info.description,
        "category": script_info.category,
        "filename": target_filename
    }));

    let json_content = serde_json::to_string_pretty(&scripts)
        .map_err(|e| format!("序列化scripts.json失败: {}", e))?;
    fs::write(&scripts_json_path, json_content)
        .map_err(|e| format!("保存scripts.json失败: {}", e))?;

    Ok(json!({
        "success": true,
        "message": "脚本已保存到列表"
    }))
}
