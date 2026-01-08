use tauri::{AppHandle, Manager};

/// 设置窗口标题
#[tauri::command]
pub fn set_title(title: &str, window: tauri::Window) {
    window.set_title(title).unwrap();
}

/// 显示窗口（用于预加载完成后显示）
#[tauri::command]
pub fn show_window(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())
}

/// 关闭启动窗口并显示主窗口
#[tauri::command]
pub async fn close_splash_show_main(app: AppHandle) -> Result<(), String> {
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
