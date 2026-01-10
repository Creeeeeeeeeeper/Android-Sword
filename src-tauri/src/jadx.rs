use std::fs;
use std::env;
use std::process::Command;
use std::io::Read;
use serde_json::json;
use std::sync::{Arc, Mutex};
use rayon::prelude::*;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 文件树节点结构
#[derive(serde::Serialize, Clone)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub has_children: bool,
}

/// 搜索结果结构
#[derive(serde::Serialize, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

/// 获取单层目录内容（懒加载，优化版）
pub fn get_directory_contents(dir_path: &std::path::Path, base_path: &std::path::Path) -> Result<Vec<FileTreeNode>, String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();

    let entries = fs::read_dir(dir_path)
        .map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();

        // 使用 file_type() 而不是 path.is_dir()，避免额外的元数据查询
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        let path = entry.path();
        let relative_path = path.strip_prefix(base_path)
            .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
            .unwrap_or_default();

        let node = FileTreeNode {
            name,
            path: relative_path,
            is_dir,
            // 优化：假设所有文件夹都有子项，避免额外的 read_dir 调用
            // 前端展开时如果为空会显示空状态
            has_children: is_dir,
        };

        if is_dir {
            dirs.push(node);
        } else {
            files.push(node);
        }
    }

    // 分别排序后合并（文件夹优先）
    dirs.sort_by(|a, b| a.name.cmp(&b.name));
    files.sort_by(|a, b| a.name.cmp(&b.name));

    dirs.extend(files);
    Ok(dirs)
}

/// 获取jadx反编译后的文件树（根目录）
#[tauri::command]
pub async fn get_jadx_file_tree(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let jadx_path = current_dir.join(&apk_dir).join("jadx");

    if !jadx_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "jadx目录不存在，请先反编译APK"
        }));
    }

    let jadx_path_clone = jadx_path.clone();
    let tree = tokio::task::spawn_blocking(move || {
        get_directory_contents(&jadx_path_clone, &jadx_path_clone)
    }).await.map_err(|e| e.to_string())??;

    Ok(json!({
        "success": true,
        "tree": tree
    }))
}

/// 获取子目录内容（懒加载）
#[tauri::command]
pub async fn get_jadx_subdirectory(apk_dir: String, sub_path: String) -> Result<serde_json::Value, String> {
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

    let jadx_path_clone = jadx_path.clone();
    let children = tokio::task::spawn_blocking(move || {
        get_directory_contents(&target_path, &jadx_path_clone)
    }).await.map_err(|e| e.to_string())??;

    Ok(json!({
        "success": true,
        "children": children
    }))
}

/// 读取jadx目录下的文件内容
#[tauri::command]
pub async fn read_jadx_file(apk_dir: String, file_path: String, page: Option<usize>, page_size_kb: Option<usize>) -> Result<serde_json::Value, String> {
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

            let page_size = (page_size_kb.unwrap_or(64)) * 1024;
            let current_page = page.unwrap_or(0);
            let total_pages = (total_size + page_size - 1) / page_size;

            let start_offset = current_page * page_size;
            let end_offset = std::cmp::min(start_offset + page_size, total_size);

            if start_offset >= total_size {
                return Ok(json!({
                    "success": false,
                    "message": "页码超出范围"
                }));
            }

            let mut file = fs::File::open(&full_path)
                .map_err(|e| format!("打开文件失败: {}", e))?;

            use std::io::{Seek, SeekFrom};
            file.seek(SeekFrom::Start(start_offset as u64))
                .map_err(|e| format!("定位文件失败: {}", e))?;

            let bytes_to_read = end_offset - start_offset;
            let mut buffer = vec![0u8; bytes_to_read];
            file.read_exact(&mut buffer)
                .map_err(|e| format!("读取文件失败: {}", e))?;

            let hex_lines: Vec<String> = buffer.chunks(16)
                .map(|chunk| {
                    chunk.iter()
                        .map(|b| format!("{:02X}", b))
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect();

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

/// 收集所有文件路径（用于并行搜索）
fn collect_text_files(dir_path: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();

    fn walk_dir(path: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    walk_dir(&path, files);
                } else {
                    let ext = path.extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");

                    let text_extensions = ["java", "kt", "xml", "json", "txt", "smali", "properties", "gradle", "pro", "cfg", "yml", "yaml", "md", "html", "css", "js"];
                    if text_extensions.contains(&ext) {
                        files.push(path);
                    }
                }
            }
        }
    }

    walk_dir(dir_path, &mut files);
    files
}

/// 在单个文件中搜索（带上下文展示）
fn search_in_file(
    file_path: &std::path::Path,
    base_path: &std::path::Path,
    query: &str,
    query_lower: &str,
    max_per_file: usize,
) -> Vec<SearchResult> {
    let mut results = Vec::new();

    if let Ok(content) = fs::read_to_string(file_path) {
        let relative_path = file_path.strip_prefix(base_path)
            .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
            .unwrap_or_default();

        let lines: Vec<&str> = content.lines().collect();

        for (line_num, line) in lines.iter().enumerate() {
            if results.len() >= max_per_file {
                break;
            }

            let line_lower = line.to_lowercase();
            if let Some(pos) = line_lower.find(query_lower) {
                // 提取上下文：关键词前后各取一定字符
                const CONTEXT_CHARS: usize = 60; // 左右各取60个字符

                // 使用字符索引而不是字节索引
                let chars: Vec<char> = line.chars().collect();
                let total_chars = chars.len();

                // 计算匹配位置（字符索引）
                let match_char_start = line[..pos].chars().count();
                let match_char_end = match_char_start + query.chars().count();

                // 计算显示范围（字符索引）
                let display_char_start = if match_char_start > CONTEXT_CHARS {
                    match_char_start.saturating_sub(CONTEXT_CHARS)
                } else {
                    0
                };

                let display_char_end = std::cmp::min(match_char_end + CONTEXT_CHARS, total_chars);

                // 提取显示内容
                let display_content = if display_char_start > 0 || display_char_end < total_chars {
                    let mut content = String::new();
                    if display_char_start > 0 {
                        content.push_str("...");
                    }
                    content.push_str(&chars[display_char_start..display_char_end].iter().collect::<String>());
                    if display_char_end < total_chars {
                        content.push_str("...");
                    }
                    content
                } else {
                    line.to_string()
                };

                // 重新计算在显示内容中的匹配位置（字节索引）
                let adjusted_match_start = if display_char_start > 0 {
                    3 + chars[display_char_start..match_char_start].iter().collect::<String>().len()
                } else {
                    line[..pos].len()
                };

                results.push(SearchResult {
                    file_path: relative_path.clone(),
                    line_number: line_num + 1,
                    line_content: display_content,
                    match_start: adjusted_match_start,
                    match_end: adjusted_match_start + query.len(),
                });
            }
        }
    }

    results
}

/// 搜索jadx目录下的文件内容（优化版 - 提前停止）
#[tauri::command]
pub async fn search_jadx_files(
    apk_dir: String,
    query: String,
    max_results: Option<usize>,
) -> Result<serde_json::Value, String> {
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
            "results": [],
            "total": 0
        }));
    }

    let max_results = max_results.unwrap_or(500);
    let max_per_file = 10; // 每个文件最多返回10条结果
    let query_lower = query.to_lowercase();

    // 在后台线程中执行搜索
    let results = tokio::task::spawn_blocking(move || {
        // 收集所有文件
        let files = collect_text_files(&jadx_path);

        // 使用 Arc<Mutex> 来跟踪结果数量，支持提前停止
        let results = Arc::new(Mutex::new(Vec::new()));
        let should_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));

        // 使用rayon并行搜索所有文件
        files.par_iter().for_each({
            let results = Arc::clone(&results);
            let should_stop = Arc::clone(&should_stop);
            let query = query.clone();
            let query_lower = query_lower.clone();
            let jadx_path = jadx_path.clone();

            move |file_path| {
                // 检查是否应该停止
                if should_stop.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }

                // 搜索文件
                let file_results = search_in_file(
                    file_path,
                    &jadx_path,
                    &query,
                    &query_lower,
                    max_per_file
                );

                if !file_results.is_empty() {
                    let mut r = results.lock().unwrap();
                    for result in file_results {
                        if r.len() >= max_results {
                            // 达到最大结果数，设置停止标志
                            should_stop.store(true, std::sync::atomic::Ordering::Relaxed);
                            break;
                        }
                        r.push(result);
                    }
                }
            }
        });

        let final_results = results.lock().unwrap().clone();
        final_results
    }).await.map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "results": results,
        "total": results.len()
    }))
}

/// 反编译APK文件（异步）
#[tauri::command]
pub async fn decompile_apk(apk_path: String, output_path: String, app: tauri::AppHandle) -> Result<String, String> {
    let current_dir = env::current_dir()
        .map_err(|e| e.to_string())?;

    let jadx_exe = if cfg!(target_os = "windows") {
        current_dir.join("jadx\\bin\\jadx.bat")
    } else {
        current_dir.join("jadx/bin/jadx")
    };

    if !jadx_exe.exists() {
        return Err(format!("jadx执行文件不存在: {}", jadx_exe.display()));
    }

    let apk_path = apk_path.replace("/", "\\");
    let output_path = output_path.replace("/", "\\");
    let apk_full_path = current_dir.join(&apk_path);
    let output_full_path = current_dir.join(&output_path);

    if !apk_full_path.exists() {
        return Err(format!("APK文件不存在: {}", apk_full_path.display()));
    }

    eprintln!("开始反编译APK: {}", apk_full_path.display());
    eprintln!("输出目录: {}", output_full_path.display());

    let result = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&jadx_exe);
        cmd.arg("-d")
            .arg(&output_full_path)
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

        eprintln!("jadx输出:\n{}", output_text);

        if output_text.contains("Failed to process") ||
           output_text.contains("zip END header not found") ||
           output_text.contains("No classes to decompile") {
            let error_line = output_text
                .lines()
                .find(|line| line.contains("Failed") || line.contains("ZipException"))
                .unwrap_or("反编译失败");

            return Err(error_line.to_string());
        }

        eprintln!("APK反编译完成");
        Ok("success".to_string())
    }).await.map_err(|e| e.to_string())?;

    // 反编译成功后，自动在后台启动敏感信息扫描
    if result.is_ok() {
        // 从 output_path 提取 apk_dir
        // output_path 格式: "case/{caseNumber}/apks/{timestamp}/jadx"
        // 需要提取到 "case/{caseNumber}/apks/{timestamp}"
        let apk_dir = if let Some(jadx_index) = output_path.rfind("\\jadx") {
            output_path[..jadx_index].to_string()
        } else if let Some(jadx_index) = output_path.rfind("/jadx") {
            output_path[..jadx_index].to_string()
        } else {
            output_path.clone()
        };

        eprintln!("[自动扫描] 反编译完成，启动敏感信息后台扫描: {}", apk_dir);

        // 在后台异步启动扫描，不阻塞反编译完成信号
        tokio::spawn(async move {
            use crate::sensitive::scan_sensitive_info_streaming;
            match scan_sensitive_info_streaming(apk_dir.clone(), app).await {
                Ok(_) => eprintln!("[自动扫描] 敏感信息扫描完成: {}", apk_dir),
                Err(e) => eprintln!("[自动扫描] 敏感信息扫描失败: {} - {}", apk_dir, e),
            }
        });
    }

    result
}
