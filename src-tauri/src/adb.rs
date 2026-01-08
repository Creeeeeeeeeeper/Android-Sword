use std::env;
use std::process::Command;
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 检查ADB设备
#[tauri::command]
pub fn check_adb_devices() -> Result<String, String> {
    let mut cmd = Command::new("adb\\adb.exe");
    cmd.arg("devices");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output()
        .map_err(|e| e.to_string())?;

    let devices_output = String::from_utf8_lossy(&output.stdout);

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

/// 安装APK到设备
#[tauri::command]
pub async fn install_apk(apk_path: String) -> Result<String, String> {
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
            .arg("-r")
            .arg(&apk_full_path);

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

/// 检查APK是否已安装在设备上
#[tauri::command]
pub async fn check_apk_installed(package_name: String) -> Result<serde_json::Value, String> {
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

        let is_installed = stdout.lines().any(|line| {
            line.trim() == format!("package:{}", package_name)
        });

        Ok::<bool, String>(is_installed)
    }).await.map_err(|e| e.to_string())??;

    Ok(json!({
        "installed": result
    }))
}

/// 获取设备上安装的APP列表
#[tauri::command]
pub async fn get_device_apps() -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let adb_exe = current_dir.join("adb").join("adb.exe");

    if !adb_exe.exists() {
        return Err("ADB工具不存在".to_string());
    }

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

/// 辅助函数：带超时执行命令（不等待结果，fire-and-forget）
#[cfg(target_os = "windows")]
pub fn run_command_fire_and_forget(mut cmd: Command) {
    match cmd.spawn() {
        Ok(_child) => {
            // 不等待，让进程在后台运行
        }
        Err(e) => {
            eprintln!("启动命令失败: {}", e);
        }
    }
}

/// 辅助函数：带超时执行命令
#[cfg(target_os = "windows")]
pub fn run_command_with_timeout(mut cmd: Command, timeout_ms: u64) -> bool {
    match cmd.spawn() {
        Ok(mut child) => {
            let start = std::time::Instant::now();
            let timeout = std::time::Duration::from_millis(timeout_ms);

            loop {
                match child.try_wait() {
                    Ok(Some(_status)) => {
                        return true;
                    }
                    Ok(None) => {
                        if start.elapsed() > timeout {
                            eprintln!("命令执行超时，强制终止");
                            let _ = child.kill();
                            let _ = child.wait();
                            return false;
                        }
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

/// 清理所有残留的adb和scrcpy进程
#[tauri::command]
pub fn cleanup_residual_processes() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd1 = Command::new("taskkill");
        cmd1.args(&["/F", "/IM", "adb.exe"])
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd1.output();

        let mut cmd2 = Command::new("taskkill");
        cmd2.args(&["/F", "/IM", "rust-ws-scrcpy-v2.1.1.exe"])
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd2.output();

        let mut cmd3 = Command::new("taskkill");
        cmd3.args(&["/F", "/IM", "python.exe"])
            .creation_flags(CREATE_NO_WINDOW);
        let _ = cmd3.output();

        std::thread::spawn(move || {
            let current_dir = match std::env::current_dir() {
                Ok(dir) => dir,
                Err(_) => return,
            };

            let adb_exe = current_dir.join("adb").join("adb.exe");
            if !adb_exe.exists() {
                return;
            }

            let mut adb_start = Command::new(&adb_exe);
            adb_start.arg("start-server")
                .creation_flags(CREATE_NO_WINDOW);
            run_command_with_timeout(adb_start, 1000);

            std::thread::sleep(std::time::Duration::from_millis(200));

            let mut check_devices = Command::new(&adb_exe);
            check_devices.args(&["devices"])
                .creation_flags(CREATE_NO_WINDOW);

            let has_device = match check_devices.spawn() {
                Ok(mut child) => {
                    let start = std::time::Instant::now();
                    loop {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                if status.success() {
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
                let mut adb_kill = Command::new(&adb_exe);
                adb_kill.args(&["shell", "su", "-c", "pkill -9 frida-server"])
                    .creation_flags(CREATE_NO_WINDOW);
                run_command_fire_and_forget(adb_kill);

                let mut adb_kill2 = Command::new(&adb_exe);
                adb_kill2.args(&["shell", "su", "-c", "killall frida-server"])
                    .creation_flags(CREATE_NO_WINDOW);
                run_command_fire_and_forget(adb_kill2);

                eprintln!("已发送frida-server清理命令");
            } else {
                eprintln!("没有检测到已连接的设备，跳过frida-server清理");
            }
        });

        Ok("cleaned".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("pkill")
            .args(&["-f", "adb"])
            .output();

        let _ = Command::new("pkill")
            .args(&["-f", "scrcpy"])
            .output();

        let _ = Command::new("pkill")
            .args(&["-f", "python"])
            .output();

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
