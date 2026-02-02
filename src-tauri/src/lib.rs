// 模块声明
mod state;
mod file_ops;
mod window;
mod adb;
mod apk;
mod apk_quick;
mod jadx;
mod sensitive;
mod frida;
mod scrcpy;
mod capture;
mod ai;

// 重新导出模块中的公共项
pub use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // 文件操作
            file_ops::write_file,
            file_ops::write_binary_file,
            file_ops::copy_file,
            file_ops::select_apk_file,
            file_ops::read_file,
            file_ops::delete_file,
            file_ops::delete_dir,
            file_ops::delete_dir_async,
            file_ops::create_dir,
            file_ops::read_dirs,
            file_ops::save_excel_file,
            file_ops::read_excel_file,
            file_ops::file_exists,
            file_ops::open_file,
            file_ops::delete_path,
            file_ops::get_current_dir,
            // 窗口管理
            window::set_title,
            window::show_window,
            window::close_splash_show_main,
            // ADB操作
            adb::check_adb_devices,
            adb::install_apk,
            adb::check_apk_installed,
            adb::get_device_apps,
            adb::cleanup_residual_processes,
            // APK分析
            apk::get_apk_info,
            apk::get_apk_list,
            apk::get_apk_permissions,
            apk::get_apk_details,
            apk::preanalyze_apk_details,
            apk::analyze_third_party_services,
            // APK快速分析（不依赖jadx）
            apk_quick::quick_analyze_apk,
            apk_quick::analyze_detection_patterns,
            apk_quick::get_apk_info_quick,
            apk_quick::get_apk_permissions_quick,
            apk_quick::get_apk_components_quick,
            // JADX反编译
            jadx::get_jadx_file_tree,
            jadx::get_jadx_subdirectory,
            jadx::read_jadx_file,
            jadx::search_jadx_files,
            jadx::decompile_apk,
            // 敏感信息扫描
            sensitive::scan_sensitive_info,
            sensitive::scan_sensitive_info_streaming,
            sensitive::get_sensitive_info,
            sensitive::ping_ip,
            // Scrcpy屏幕投射
            scrcpy::start_scrcpy,
            scrcpy::stop_scrcpy,
            scrcpy::is_scrcpy_ready,
            scrcpy::list_scrcpy_devices,
            scrcpy::scan_emulator_ports,
            // Frida脚本
            frida::check_frida_env,
            frida::init_frida_env,
            frida::start_frida_server,
            frida::stop_frida_server,
            frida::check_frida_server_status,
            frida::get_frida_scripts,
            frida::run_frida_scripts,
            frida::stop_frida_scripts,
            frida::get_frida_output,
            frida::save_frida_output,
            frida::save_frida_script,
            // 网络抓包
            capture::start_packet_capture,
            capture::stop_packet_capture,
            capture::get_capture_sessions,
            capture::get_capture_packets,
            capture::delete_capture_session,
            // AI 分析
            ai::get_ai_config,
            ai::save_ai_config,
            ai::get_default_prompt,
            ai::get_prompt_for_file,
            ai::list_prompt_presets,
            ai::get_prompt_preset,
            ai::save_prompt_preset,
            ai::analyze_with_ai,
            ai::get_ai_analysis_history,
            ai::read_ai_analysis_cache,
            ai::check_claude_code_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
