use std::fs;
use std::env;
use std::process::Command;
use std::io::Read;
use serde_json::json;
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

/// 获取单层目录内容（懒加载）
pub fn get_directory_contents(dir_path: &std::path::Path, base_path: &std::path::Path) -> Result<Vec<FileTreeNode>, String> {
    let mut nodes = Vec::new();

    let entries = fs::read_dir(dir_path)
        .map_err(|e| format!("读取目录失败: {}", e))?;

    let mut entries: Vec<_> = entries
        .filter_map(|e| e.ok())
        .collect();

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

/// 递归搜索目录
pub fn search_in_directory(
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

/// 搜索jadx目录下的文件内容
#[tauri::command]
pub async fn search_jadx_files(apk_dir: String, query: String, max_results: Option<usize>) -> Result<serde_json::Value, String> {
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

/// 反编译APK文件（异步）
#[tauri::command]
pub async fn decompile_apk(apk_path: String, output_path: String) -> Result<String, String> {
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

    result
}
