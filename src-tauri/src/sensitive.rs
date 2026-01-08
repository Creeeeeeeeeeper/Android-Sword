use std::fs;
use std::env;
use std::process::{Command, Stdio};
use std::collections::HashMap;
use std::sync::OnceLock;
use serde_json::json;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 敏感信息结构体
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SensitiveInfo {
    pub id: usize,
    pub content: String,
    pub category: String,
    pub file_path: String,
    pub line_number: usize,
    pub column_start: usize,
    pub column_end: usize,
}

/// 敏感信息扫描结果
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SensitiveResult {
    pub items: Vec<SensitiveInfo>,
    pub stats: HashMap<String, usize>,
    pub total: usize,
}

/// 敏感信息扫描配置结构体
#[derive(serde::Deserialize, Clone, Default)]
pub struct SensitiveSettings {
    #[serde(default, rename = "urlWhitelist")]
    pub url_whitelist: Vec<String>,
    #[serde(default, rename = "ipWhitelist")]
    pub ip_whitelist: Vec<String>,
}

/// 预编译正则：双引号字符串提取
fn get_string_regex() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r#""([^"\\]*(\\.[^"\\]*)*)""#).unwrap())
}

/// 预编译正则：IPv4地址
fn get_ipv4_regex() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^(\d{1,3}\.){3}\d{1,3}(:\d+)?$").unwrap())
}

/// 从settings.json加载敏感信息扫描配置
pub fn load_sensitive_settings() -> SensitiveSettings {
    let current_dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(_) => return SensitiveSettings::default(),
    };

    let settings_file = current_dir.join("settings.json");

    if let Ok(content) = fs::read_to_string(&settings_file) {
        if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(sensitive) = settings.get("sensitive") {
                if let Ok(sensitive_settings) = serde_json::from_value::<SensitiveSettings>(sensitive.clone()) {
                    return sensitive_settings;
                }
            }
        }
    }

    SensitiveSettings::default()
}

/// 判断URL是否在白名单中
pub fn is_url_whitelisted(url: &str, whitelist: &[String]) -> bool {
    if whitelist.is_empty() {
        return false;
    }
    let url_lower = url.to_lowercase();
    for pattern in whitelist {
        if url_lower.contains(&pattern.to_lowercase()) {
            return true;
        }
    }
    false
}

/// 判断IP是否在白名单中
pub fn is_ip_whitelisted(ip: &str, whitelist: &[String]) -> bool {
    if whitelist.is_empty() {
        return false;
    }
    let ip_only = ip.split(':').next().unwrap_or(ip);
    whitelist.iter().any(|w| w == ip_only)
}

/// 判断是否为URL
pub fn is_url(s: &str, whitelist: &[String]) -> bool {
    let s_lower = s.to_lowercase();
    if !((s_lower.starts_with("http://") || s_lower.starts_with("https://") ||
          s_lower.starts_with("ftp://") || s_lower.starts_with("ws://") ||
          s_lower.starts_with("wss://")) && s.len() > 10) {
        return false;
    }
    !is_url_whitelisted(s, whitelist)
}

/// 判断是否为IP地址
pub fn is_ip_address(s: &str, whitelist: &[String]) -> bool {
    let ipv4_re = get_ipv4_regex();
    if !ipv4_re.is_match(s) {
        return false;
    }

    let ip_only = s.split(':').next().unwrap_or("");
    let parts: Vec<&str> = ip_only.split('.').collect();
    if parts.len() != 4 {
        return false;
    }

    if !parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        return false;
    }

    !is_ip_whitelisted(s, whitelist)
}

/// 判断是否为AccessKey相关
pub fn is_access_key(s: &str, context: &str) -> bool {
    if s.len() < 16 || s.len() > 128 {
        return false;
    }

    if s.len() >= 20 && s.len() <= 64 {
        if s.starts_with("AKIA") || s.starts_with("ASIA") || s.starts_with("AIDA") {
            return true;
        }
        if s.starts_with("LTAI") {
            return true;
        }
        if s.starts_with("AKID") {
            return true;
        }
    }

    if !s.chars().all(|c| c.is_alphanumeric() || c == '+' || c == '/' || c == '=' || c == '-' || c == '_') {
        return false;
    }

    let context_lower = context.to_lowercase();

    const KEY_PATTERNS: &[&str] = &[
        "accesskey", "access_key", "secretkey", "secret_key",
        "appsecret", "app_secret", "appkey", "app_key",
        "api_key", "apikey", "private_key", "privatekey",
        "aws_key", "token", "credential",
    ];

    for pattern in KEY_PATTERNS {
        if context_lower.contains(pattern) {
            return true;
        }
    }

    false
}

/// 判断是否为纯数字字符串
pub fn is_number_string(s: &str) -> bool {
    let len = s.len();
    if len < 6 || len > 20 {
        return false;
    }
    s.bytes().all(|b| b.is_ascii_digit())
}

/// 从源码中提取字符串
pub fn extract_strings_from_content(content: &str) -> Vec<(String, usize, usize, usize)> {
    let mut strings = Vec::new();
    let string_re = get_string_regex();

    for (line_num, line) in content.lines().enumerate() {
        if !line.contains('"') {
            continue;
        }

        for cap in string_re.captures_iter(line) {
            if let Some(m) = cap.get(1) {
                let s = m.as_str();
                if s.len() >= 6 && s.len() <= 2000 {
                    strings.push((s.to_string(), line_num + 1, m.start(), m.end()));
                }
            }
        }
    }

    strings
}

/// 分类敏感信息
pub fn categorize_sensitive(s: &str, line_content: &str, settings: &SensitiveSettings) -> Option<String> {
    if s.len() < 6 {
        return None;
    }

    if s.len() > 10 {
        let s_lower_start = s.get(0..5).map(|x| x.to_lowercase());
        if let Some(start) = s_lower_start {
            if start.starts_with("http") || start.starts_with("ftp:") || start.starts_with("ws:/") || start.starts_with("wss:") {
                if is_url(s, &settings.url_whitelist) {
                    return Some("url".to_string());
                }
            }
        }
    }

    if s.len() >= 7 && s.len() <= 21 {
        let first_char = s.chars().next();
        if let Some(c) = first_char {
            if c.is_ascii_digit() && is_ip_address(s, &settings.ip_whitelist) {
                return Some("ip".to_string());
            }
        }
    }

    if is_access_key(s, line_content) {
        return Some("access_key".to_string());
    }

    if is_number_string(s) {
        return Some("number".to_string());
    }

    None
}

/// 递归收集所有需要扫描的文件路径
pub fn collect_files_to_scan(dir_path: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
    let entries = match fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return,
    };

    const TEXT_EXTENSIONS: &[&str] = &["java", "kt", "xml", "json", "smali", "properties", "gradle", "js"];

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();

        if path.is_dir() {
            collect_files_to_scan(&path, files);
        } else {
            let ext = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");

            if TEXT_EXTENSIONS.contains(&ext) {
                files.push(path);
            }
        }
    }
}

/// 使用内存映射读取文件内容为字符串
pub fn read_file_with_mmap(file_path: &std::path::Path) -> Option<String> {
    use memmap2::Mmap;

    let file = fs::File::open(file_path).ok()?;
    let metadata = file.metadata().ok()?;

    if metadata.len() < 64 * 1024 {
        return fs::read_to_string(file_path).ok();
    }

    let mmap = unsafe { Mmap::map(&file).ok()? };
    std::str::from_utf8(&mmap).ok().map(|s| s.to_string())
}

/// 扫描单个文件的敏感信息
pub fn scan_file_for_sensitive(
    file_path: &std::path::Path,
    base_path: &std::path::Path,
    settings: &SensitiveSettings,
) -> Vec<SensitiveInfo> {
    let mut results = Vec::new();

    let content = match read_file_with_mmap(file_path) {
        Some(c) => c,
        None => return results,
    };

    let relative_path = file_path.strip_prefix(base_path)
        .map(|p| p.to_string_lossy().to_string().replace("\\", "/"))
        .unwrap_or_default();

    let lines: Vec<&str> = content.lines().collect();
    let extracted = extract_strings_from_content(&content);

    for (s, line_num, col_start, col_end) in extracted {
        let line_content = lines.get(line_num - 1).unwrap_or(&"");

        if let Some(category) = categorize_sensitive(&s, line_content, settings) {
            results.push(SensitiveInfo {
                id: 0,
                content: s,
                category,
                file_path: relative_path.clone(),
                line_number: line_num,
                column_start: col_start,
                column_end: col_end,
            });
        }
    }

    results
}

/// 扫描APK敏感信息
#[tauri::command]
pub async fn scan_sensitive_info(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let jadx_path = apk_dir_path.join("jadx");
    let cache_path = apk_dir_path.join("sensitive.json");

    if !jadx_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK尚未反编译完成"
        }));
    }

    // 检查缓存
    if cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<SensitiveResult>(&cache_content) {
                eprintln!("从缓存读取敏感信息: {}", cache_path.display());
                return Ok(json!({
                    "success": true,
                    "data": cached_data,
                    "cached": true
                }));
            }
        }
    }

    let settings = load_sensitive_settings();
    eprintln!("URL白名单: {} 条, IP白名单: {} 条", settings.url_whitelist.len(), settings.ip_whitelist.len());

    let jadx_path_clone = jadx_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        use rayon::prelude::*;

        let mut files: Vec<std::path::PathBuf> = Vec::new();
        collect_files_to_scan(&jadx_path_clone, &mut files);

        eprintln!("收集到 {} 个文件待扫描", files.len());

        let all_results: Vec<Vec<SensitiveInfo>> = files
            .par_iter()
            .map(|file_path| scan_file_for_sensitive(file_path, &jadx_path_clone, &settings))
            .collect();

        let mut items: Vec<SensitiveInfo> = Vec::new();
        let mut id_counter: usize = 0;

        for mut file_results in all_results {
            for item in &mut file_results {
                item.id = id_counter;
                id_counter += 1;
            }
            items.extend(file_results);
        }

        eprintln!("扫描完成，共发现 {} 条敏感信息", items.len());

        let mut stats: HashMap<String, usize> = HashMap::new();
        for item in &items {
            *stats.entry(item.category.clone()).or_insert(0) += 1;
        }

        SensitiveResult {
            total: items.len(),
            items,
            stats,
        }
    }).await.map_err(|e| e.to_string())?;

    // 保存到缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        if let Err(e) = fs::write(&cache_path, &json_str) {
            eprintln!("保存敏感信息缓存失败: {}", e);
        } else {
            eprintln!("已保存敏感信息缓存: {}", cache_path.display());
        }
    }

    Ok(json!({
        "success": true,
        "data": result,
        "cached": false
    }))
}

/// 获取敏感信息（分页）
#[tauri::command]
pub async fn get_sensitive_info(apk_dir: String, page: usize, page_size: usize, category: Option<String>) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let cache_path = current_dir.join(&apk_dir).join("sensitive.json");

    if !cache_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "请先扫描敏感信息"
        }));
    }

    let cache_content = fs::read_to_string(&cache_path)
        .map_err(|e| format!("读取缓存失败: {}", e))?;

    let data: SensitiveResult = serde_json::from_str(&cache_content)
        .map_err(|e| format!("解析缓存失败: {}", e))?;

    let filtered: Vec<&SensitiveInfo> = if let Some(ref cat) = category {
        if cat == "all" {
            data.items.iter().collect()
        } else {
            data.items.iter().filter(|item| &item.category == cat).collect()
        }
    } else {
        data.items.iter().collect()
    };

    let total = filtered.len();
    let total_pages = (total + page_size - 1) / page_size;

    let start = page * page_size;
    let end = std::cmp::min(start + page_size, total);

    let page_items: Vec<&SensitiveInfo> = if start < total {
        filtered[start..end].to_vec()
    } else {
        vec![]
    };

    Ok(json!({
        "success": true,
        "items": page_items,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": total_pages,
        "stats": data.stats
    }))
}

/// Ping IP地址检测是否可达
#[tauri::command]
pub async fn ping_ip(ip: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("ping")
        .args(&["-n", "1", "-w", "1000", &ip])
        .creation_flags(0x08000000)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("ping")
        .args(&["-c", "1", "-W", "1", &ip])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(out) => {
            let success = out.status.success();
            Ok(json!({
                "ip": ip,
                "reachable": success
            }))
        },
        Err(e) => {
            Ok(json!({
                "ip": ip,
                "reachable": false,
                "error": e.to_string()
            }))
        }
    }
}
