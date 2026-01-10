use std::fs;
use std::env;
use std::io::{Read, Cursor};
use std::process::{Command, Stdio};
use std::collections::HashMap;
use std::sync::{OnceLock, Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use serde_json::json;
use regex::Regex;
use rayon::prelude::*;
use tauri::Emitter;
use zip::ZipArchive;
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
    #[serde(default = "default_scan_jadx", rename = "scanJadx")]
    pub scan_jadx: bool,
    #[serde(default, rename = "urlWhitelist")]
    pub url_whitelist: Vec<String>,
    #[serde(default, rename = "ipWhitelist")]
    pub ip_whitelist: Vec<String>,
}

/// 默认值函数：默认启用JADX扫描
fn default_scan_jadx() -> bool {
    true
}

/// 敏感信息模式分类
#[derive(Clone)]
pub struct SensitivePattern {
    pub category: String,
    pub patterns: Vec<Regex>,
}

/// 预编译所有敏感信息正则模式
fn get_sensitive_patterns() -> &'static Vec<SensitivePattern> {
    static PATTERNS: OnceLock<Vec<SensitivePattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            // 1. HAE敏感信息（密码、密钥等20个模式）
            SensitivePattern {
                category: "hae".to_string(),
                patterns: vec![
                    Regex::new(r"password\s*[=:]\s*\S{6,}").unwrap(),
                    Regex::new(r"passwd\s*[=:]\s*\S{6,}").unwrap(),
                    Regex::new(r"pwd\s*[=:]\s*\S{6,}").unwrap(),
                    Regex::new(r"secret\s*[=:]\s*\S{6,}").unwrap(),
                    Regex::new(r"token\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"apikey\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"api_key\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"access_key\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"accesskey\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"secret_key\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"secretkey\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"app_secret\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"appsecret\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"private_key\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"privatekey\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"auth\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"authorization\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"credential\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"jwt\s*[=:]\s*\S{20,}").unwrap(),
                    Regex::new(r"session\s*[=:]\s*\S{20,}").unwrap(),
                ],
            },
            // 2. 私钥和证书（4个模式）
            SensitivePattern {
                category: "private_key".to_string(),
                patterns: vec![
                    Regex::new(r"-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----").unwrap(),
                    Regex::new(r"-----BEGIN OPENSSH PRIVATE KEY-----").unwrap(),
                    Regex::new(r"-----BEGIN PGP PRIVATE KEY BLOCK-----").unwrap(),
                    Regex::new(r"-----BEGIN ENCRYPTED PRIVATE KEY-----").unwrap(),
                ],
            },
            // 3. API密钥和令牌（4个模式）
            SensitivePattern {
                category: "api_key".to_string(),
                patterns: vec![
                    Regex::new(r"[A-Za-z0-9]{32,45}").unwrap(), // 通用API Key格式
                    Regex::new(r"sk-[A-Za-z0-9]{20,50}").unwrap(), // OpenAI风格
                    Regex::new(r"ghp_[A-Za-z0-9]{36}").unwrap(), // GitHub Personal Access Token
                    Regex::new(r"glpat-[A-Za-z0-9\-]{20,}").unwrap(), // GitLab Personal Access Token
                ],
            },
            // 4. OAuth和认证令牌（5个模式）
            SensitivePattern {
                category: "oauth".to_string(),
                patterns: vec![
                    Regex::new(r"access_token\s*[:=]\s*[A-Za-z0-9\-_\.]{20,}").unwrap(),
                    Regex::new(r"refresh_token\s*[:=]\s*[A-Za-z0-9\-_\.]{20,}").unwrap(),
                    Regex::new(r"bearer\s+[A-Za-z0-9\-_\.]{20,}").unwrap(),
                    Regex::new(r"client_secret\s*[:=]\s*[A-Za-z0-9\-_]{20,}").unwrap(),
                    Regex::new(r"oauth_token\s*[:=]\s*[A-Za-z0-9\-_]{20,}").unwrap(),
                ],
            },
            // 5. 云平台凭证（3个模式）
            SensitivePattern {
                category: "cloud".to_string(),
                patterns: vec![
                    Regex::new(r"(AKIA|ASIA|AIDA)[A-Z0-9]{16}").unwrap(), // AWS Access Key
                    Regex::new(r"amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap(), // Amazon MWS
                    Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap(), // Heroku API Key
                ],
            },
            // 6. 服务账号凭证（3个模式）
            SensitivePattern {
                category: "service_account".to_string(),
                patterns: vec![
                    Regex::new(r#"type":\s*"service_account"#).unwrap(), // Google Service Account
                    Regex::new(r#"private_key_id":\s*"[^""]+"#).unwrap(),
                    Regex::new(r#"client_email":\s*"[^""]+@[^""]+\.iam\.gserviceaccount\.com"#).unwrap(),
                ],
            },
            // 7. 支付相关密钥（5个模式）
            SensitivePattern {
                category: "payment".to_string(),
                patterns: vec![
                    Regex::new(r"sk_live_[A-Za-z0-9]{24,}").unwrap(), // Stripe Live Secret Key
                    Regex::new(r"pk_live_[A-Za-z0-9]{24,}").unwrap(), // Stripe Live Publishable Key
                    Regex::new(r"sq0atp-[A-Za-z0-9\-_]{22}").unwrap(), // Square Access Token
                    Regex::new(r"sq0csp-[A-Za-z0-9\-_]{43}").unwrap(), // Square OAuth Secret
                    Regex::new(r"paypal\S*\s*[:=]\s*[A-Za-z0-9]{20,}").unwrap(),
                ],
            },
            // 8. 平台服务密钥（4个模式）
            SensitivePattern {
                category: "platform".to_string(),
                patterns: vec![
                    Regex::new(r"EAACEdEose0cBA[A-Za-z0-9]+").unwrap(), // Facebook Access Token
                    Regex::new(r"[fF][aA][cC][eE][bB][oO][oO][kK].*[0-9a-f]{32}").unwrap(), // Facebook OAuth
                    Regex::new(r"xox[baprs]-[A-Za-z0-9\-]+").unwrap(), // Slack Token
                    Regex::new(r"https://hooks\.slack\.com/services/T[A-Z0-9]{8}/B[A-Z0-9]{8}/[A-Za-z0-9]{24}").unwrap(), // Slack Webhook
                ],
            },
            // 9. IP地址检测
            SensitivePattern {
                category: "ip".to_string(),
                patterns: vec![
                    // IPv4地址（带可选端口，带引号）- 优先匹配
                    Regex::new(r#"["'](\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?["']"#).unwrap(),
                    // IPv4地址（带可选端口，无引号）- 使用边界匹配避免误匹配版本号
                    Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?\b").unwrap(),
                ],
            },
            // 10. URL检测
            SensitivePattern {
                category: "url".to_string(),
                patterns: vec![
                    // URL（带引号）- 优先匹配
                    Regex::new(r#"["'](https?://[^\s"'<>]+)["']"#).unwrap(),
                    // URL（无引号）- 使用边界和空白符匹配
                    Regex::new(r"(https?://[^\s<>]+)").unwrap(),
                ],
            },
            // 11. 其他敏感信息（5个模式）
            SensitivePattern {
                category: "other".to_string(),
                patterns: vec![
                    Regex::new(r"mongodb(\+srv)?://[^\s]+").unwrap(), // MongoDB连接串
                    Regex::new(r"mysql://[^\s]+").unwrap(), // MySQL连接串
                    Regex::new(r"postgres://[^\s]+").unwrap(), // PostgreSQL连接串
                    Regex::new(r"redis://[^\s]+").unwrap(), // Redis连接串
                    Regex::new(r"jdbc:[^\s]+").unwrap(), // JDBC连接串
                ],
            },
        ]
    })
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

/// 扫描单个文件的敏感信息（使用新的正则模式）
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

    let patterns = get_sensitive_patterns();

    // 按行扫描
    for (line_num, line) in content.lines().enumerate() {
        let line_lower = line.to_lowercase();

        // 对每个分类的模式进行匹配
        for pattern_group in patterns {
            for pattern in &pattern_group.patterns {
                // 对于IP和URL，使用captures提取捕获组
                if pattern_group.category == "ip" || pattern_group.category == "url" {
                    if let Some(caps) = pattern.captures(line) {
                        // 提取第一个捕获组（不含引号的内容）
                        if let Some(cap) = caps.get(1) {
                            let matched_text = cap.as_str();

                            // 对IP进行验证和白名单过滤
                            if pattern_group.category == "ip" {
                                if !is_valid_ip_for_scan(matched_text) {
                                    continue;
                                }
                                // 检查IP白名单
                                if is_ip_whitelisted(matched_text, &settings.ip_whitelist) {
                                    continue;
                                }
                            }

                            // 对URL进行白名单过滤
                            if pattern_group.category == "url" {
                                if is_url_whitelisted(matched_text, &settings.url_whitelist) {
                                    continue;
                                }
                            }

                            results.push(SensitiveInfo {
                                id: 0,
                                content: matched_text.to_string(),
                                category: pattern_group.category.clone(),
                                file_path: relative_path.clone(),
                                line_number: line_num + 1,
                                column_start: cap.start(),
                                column_end: cap.end(),
                            });
                            break;
                        }
                    }
                } else {
                    // 其他类型使用find
                    if let Some(mat) = pattern.find(&line_lower) {
                        // 找到匹配
                        let matched_text = &line[mat.start()..mat.end()];

                        results.push(SensitiveInfo {
                            id: 0,
                            content: matched_text.to_string(),
                            category: pattern_group.category.clone(),
                            file_path: relative_path.clone(),
                            line_number: line_num + 1,
                            column_start: mat.start(),
                            column_end: mat.end(),
                        });

                        // 每行每个分类只匹配一次，避免重复
                        break;
                    }
                }
            }
        }
    }

    results
}

/// 验证IP地址是否有效（用于扫描过滤）
fn is_valid_ip_for_scan(ip: &str) -> bool {
    // 去掉端口部分
    let ip_only = ip.split(':').next().unwrap_or(ip);

    let parts: Vec<&str> = ip_only.split('.').collect();
    if parts.len() != 4 {
        return false;
    }

    // 验证每部分是否为有效数字（0-255）
    for part in &parts {
        match part.parse::<u8>() {
            Ok(_) => {},
            Err(_) => return false,
        }
    }

    // 不再硬编码过滤规则，所有过滤通过白名单配置实现
    true
}

/// 流式扫描APK敏感信息（边扫边发送结果）
#[tauri::command]
pub async fn scan_sensitive_info_streaming(
    apk_dir: String,
    _app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let apk_path = apk_dir_path.join("base.apk");
    let cache_path = apk_dir_path.join("sensitive.json");

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
        }));
    }

    eprintln!("[敏感信息扫描] 开始扫描: {}", apk_dir);

    let settings = load_sensitive_settings();

    // 使用 tokio::spawn_blocking 运行扫描任务
    let apk_path_clone = apk_path.clone();
    let jadx_path = apk_dir_path.join("jadx");
    let jadx_path_clone = jadx_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        let mut all_items: Vec<SensitiveInfo> = Vec::new();
        let mut id_counter: usize = 0;

        // 1. 扫描APK硬编码（ZIP文件）
        eprintln!("[综合扫描] 第1步: 扫描APK硬编码");
        let mut apk_items = scan_apk_zip_for_sensitive(&apk_path_clone, &settings);

        // 为APK硬编码项分配ID
        for item in &mut apk_items {
            item.id = id_counter;
            id_counter += 1;
        }

        let apk_count = apk_items.len();
        eprintln!("[综合扫描] APK硬编码扫描完成，发现 {} 条", apk_count);
        all_items.extend(apk_items);

        // 2. 扫描JADX反编译结果（如果启用且目录存在）
        if settings.scan_jadx {
            if jadx_path_clone.exists() {
                eprintln!("[综合扫描] 第2步: 扫描JADX反编译结果");

                let mut files: Vec<std::path::PathBuf> = Vec::new();
                collect_files_to_scan(&jadx_path_clone, &mut files);

                eprintln!("[综合扫描] 收集到 {} 个Java文件待扫描", files.len());

                // 使用rayon并行扫描JADX文件
                let jadx_results: Vec<Vec<SensitiveInfo>> = files
                    .par_iter()
                    .map(|file_path| scan_file_for_sensitive(file_path, &jadx_path_clone, &settings))
                    .collect();

                // 合并JADX扫描结果并分配ID
                for mut file_results in jadx_results {
                    for item in &mut file_results {
                        item.id = id_counter;
                        id_counter += 1;
                    }
                    all_items.extend(file_results);
                }

                let jadx_count = all_items.len() - apk_count;
                eprintln!("[综合扫描] JADX反编译扫描完成，发现 {} 条", jadx_count);
            } else {
                eprintln!("[综合扫描] JADX反编译目录不存在，跳过反编译扫描");
            }
        } else {
            eprintln!("[综合扫描] 已禁用JADX反编译扫描（仅扫描APK硬编码）");
        }

        eprintln!("[综合扫描] 总计发现 {} 条敏感信息", all_items.len());

        // 计算统计信息
        let mut stats: HashMap<String, usize> = HashMap::new();
        for item in &all_items {
            *stats.entry(item.category.clone()).or_insert(0) += 1;
        }

        SensitiveResult {
            total: all_items.len(),
            items: all_items,
            stats,
        }
    }).await.map_err(|e| e.to_string())?;

    // 保存到缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        if let Err(e) = fs::write(&cache_path, &json_str) {
            eprintln!("[敏感信息扫描] 保存缓存失败: {}", e);
        } else {
            eprintln!("[敏感信息扫描] 已保存缓存: {}", cache_path.display());
        }
    }

    Ok(json!({
        "success": true,
        "data": result,
        "cached": false
    }))
}

/// 扫描APK敏感信息
#[tauri::command]
pub async fn scan_sensitive_info(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let apk_path = apk_dir_path.join("base.apk");
    let cache_path = apk_dir_path.join("sensitive.json");

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
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

    let apk_path_clone = apk_path.clone();
    let jadx_path = apk_dir_path.join("jadx");
    let jadx_path_clone = jadx_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        let mut all_items: Vec<SensitiveInfo> = Vec::new();
        let mut id_counter: usize = 0;

        // 1. 扫描APK硬编码（ZIP文件）
        eprintln!("[综合扫描] 第1步: 扫描APK硬编码");
        let mut apk_items = scan_apk_zip_for_sensitive(&apk_path_clone, &settings);

        // 为APK硬编码项分配ID
        for item in &mut apk_items {
            item.id = id_counter;
            id_counter += 1;
        }

        let apk_count = apk_items.len();
        eprintln!("[综合扫描] APK硬编码扫描完成，发现 {} 条", apk_count);
        all_items.extend(apk_items);

        // 2. 扫描JADX反编译结果（如果启用且目录存在）
        if settings.scan_jadx {
            if jadx_path_clone.exists() {
                eprintln!("[综合扫描] 第2步: 扫描JADX反编译结果");

                let mut files: Vec<std::path::PathBuf> = Vec::new();
                collect_files_to_scan(&jadx_path_clone, &mut files);

                eprintln!("[综合扫描] 收集到 {} 个Java文件待扫描", files.len());

                // 使用rayon并行扫描JADX文件
                let jadx_results: Vec<Vec<SensitiveInfo>> = files
                    .par_iter()
                    .map(|file_path| scan_file_for_sensitive(file_path, &jadx_path_clone, &settings))
                    .collect();

                // 合并JADX扫描结果并分配ID
                for mut file_results in jadx_results {
                    for item in &mut file_results {
                        item.id = id_counter;
                        id_counter += 1;
                    }
                    all_items.extend(file_results);
                }

                let jadx_count = all_items.len() - apk_count;
                eprintln!("[综合扫描] JADX反编译扫描完成，发现 {} 条", jadx_count);
            } else {
                eprintln!("[综合扫描] JADX反编译目录不存在，跳过反编译扫描");
            }
        } else {
            eprintln!("[综合扫描] 已禁用JADX反编译扫描（仅扫描APK硬编码）");
        }

        eprintln!("[综合扫描] 总计发现 {} 条敏感信息", all_items.len());

        // 计算统计信息
        let mut stats: HashMap<String, usize> = HashMap::new();
        for item in &all_items {
            *stats.entry(item.category.clone()).or_insert(0) += 1;
        }

        SensitiveResult {
            total: all_items.len(),
            items: all_items,
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

/// 从字节数组中提取可打印字符串（用于扫描DEX、SO等二进制文件）
pub fn extract_strings_from_bytes(data: &[u8], min_length: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current_string = Vec::new();

    for &byte in data {
        if byte >= 32 && byte <= 126 {
            // 可打印ASCII字符
            current_string.push(byte);
        } else {
            // 非可打印字符，结束当前字符串
            if current_string.len() >= min_length {
                if let Ok(s) = String::from_utf8(current_string.clone()) {
                    strings.push(s);
                }
            }
            current_string.clear();
        }
    }

    // 处理最后一个字符串
    if current_string.len() >= min_length {
        if let Ok(s) = String::from_utf8(current_string) {
            strings.push(s);
        }
    }

    strings
}

/// 从APK ZIP文件中扫描敏感信息
pub fn scan_apk_zip_for_sensitive(
    apk_path: &std::path::Path,
    settings: &SensitiveSettings,
) -> Vec<SensitiveInfo> {
    let mut all_results = Vec::new();
    let mut id_counter: usize = 0;

    eprintln!("[APK扫描] 开始扫描APK文件: {}", apk_path.display());

    let file = match fs::File::open(apk_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[APK扫描] 打开APK文件失败: {}", e);
            return all_results;
        }
    };

    let mut archive = match ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("[APK扫描] 解析APK ZIP失败: {}", e);
            return all_results;
        }
    };

    eprintln!("[APK扫描] ZIP文件包含 {} 个条目", archive.len());

    // 扫描策略：
    // 1. 文本文件（.xml, .txt, .json, .properties）：直接读取内容
    // 2. DEX文件（.dex）：提取字符串池
    // 3. SO文件（.so）：提取可打印字符串
    // 4. 资源文件（resources.arsc）：跳过（格式复杂）

    for i in 0..archive.len() {
        let mut file_entry = match archive.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let file_name = file_entry.name().to_string();

        // 跳过目录
        if file_entry.is_dir() {
            continue;
        }

        // 根据文件类型决定扫描方式
        let should_scan = file_name.ends_with(".xml")
            || file_name.ends_with(".txt")
            || file_name.ends_with(".json")
            || file_name.ends_with(".properties")
            || file_name.ends_with(".dex")
            || file_name.ends_with(".so")
            || file_name.contains("classes") && file_name.ends_with(".dex");

        if !should_scan {
            continue;
        }

        // 读取文件内容
        let mut content_bytes = Vec::new();
        if file_entry.read_to_end(&mut content_bytes).is_err() {
            continue;
        }

        // 如果文件太大（超过10MB），跳过
        if content_bytes.len() > 10 * 1024 * 1024 {
            eprintln!("[APK扫描] 跳过大文件: {} ({}MB)", file_name, content_bytes.len() / 1024 / 1024);
            continue;
        }

        eprintln!("[APK扫描] 扫描文件: {} ({} bytes)", file_name, content_bytes.len());

        // 根据文件类型提取字符串
        let strings_to_scan: Vec<String> = if file_name.ends_with(".xml")
            || file_name.ends_with(".txt")
            || file_name.ends_with(".json")
            || file_name.ends_with(".properties") {
            // 文本文件：尝试作为UTF-8读取
            if let Ok(text_content) = String::from_utf8(content_bytes.clone()) {
                vec![text_content]
            } else {
                // UTF-8解析失败，尝试提取字符串
                extract_strings_from_bytes(&content_bytes, 6)
            }
        } else {
            // 二进制文件（DEX、SO）：提取字符串
            extract_strings_from_bytes(&content_bytes, 6)
        };

        // 扫描提取的字符串
        for string_content in strings_to_scan {
            let lines: Vec<&str> = string_content.lines().collect();

            for (line_num, line) in lines.iter().enumerate() {
                let line_lower = line.to_lowercase();

                // 对每个分类的模式进行匹配
                let patterns = get_sensitive_patterns();
                for pattern_group in patterns {
                    for pattern in &pattern_group.patterns {
                        // 对于IP和URL，使用captures提取捕获组
                        if pattern_group.category == "ip" || pattern_group.category == "url" {
                            if let Some(caps) = pattern.captures(line) {
                                if let Some(cap) = caps.get(1) {
                                    let matched_text = cap.as_str();

                                    // 对IP进行验证和白名单过滤
                                    if pattern_group.category == "ip" {
                                        if !is_valid_ip_for_scan(matched_text) {
                                            continue;
                                        }
                                        if is_ip_whitelisted(matched_text, &settings.ip_whitelist) {
                                            continue;
                                        }
                                    }

                                    // 对URL进行白名单过滤
                                    if pattern_group.category == "url" {
                                        if is_url_whitelisted(matched_text, &settings.url_whitelist) {
                                            continue;
                                        }
                                    }

                                    all_results.push(SensitiveInfo {
                                        id: id_counter,
                                        content: matched_text.to_string(),
                                        category: pattern_group.category.clone(),
                                        file_path: file_name.clone(),
                                        line_number: line_num + 1,
                                        column_start: cap.start(),
                                        column_end: cap.end(),
                                    });
                                    id_counter += 1;
                                    break;
                                }
                            }
                        } else {
                            // 其他类型使用find
                            if let Some(mat) = pattern.find(&line_lower) {
                                let matched_text = &line[mat.start()..mat.end()];

                                all_results.push(SensitiveInfo {
                                    id: id_counter,
                                    content: matched_text.to_string(),
                                    category: pattern_group.category.clone(),
                                    file_path: file_name.clone(),
                                    line_number: line_num + 1,
                                    column_start: mat.start(),
                                    column_end: mat.end(),
                                });
                                id_counter += 1;

                                // 每行每个分类只匹配一次
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    eprintln!("[APK扫描] 扫描完成，共发现 {} 条敏感信息", all_results.len());
    all_results
}
