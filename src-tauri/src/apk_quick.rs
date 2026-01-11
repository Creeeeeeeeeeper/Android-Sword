//! APK快速解析模块
//! 直接从APK文件读取信息，不依赖jadx反编译
//! 使用zip库解析APK，使用自定义AXML解析器解析AndroidManifest.xml

use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::{self, File};
use std::io::{Read, Cursor, BufReader};
use std::path::Path;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use zip::ZipArchive;
use rayon::prelude::*;

/// SDK服务商信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SdkInfo {
    pub label: String,
    pub team: String,
    pub description: String,
    #[serde(rename = "relativeUrl")]
    pub relative_url: Option<String>,
    pub soname: String,
}

/// 打包服务商信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackerInfo {
    pub name: String,
    pub sopath: Vec<String>,
    pub soname: Vec<String>,
    pub other: Vec<String>,
    pub soregex: Vec<String>,
}

/// 检测模式分类
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionPatterns {
    #[serde(rename = "RootFilePatterns")]
    pub root_file_patterns: Vec<PatternInfo>,
    #[serde(rename = "RootAppPatterns")]
    pub root_app_patterns: Vec<PatternInfo>,
    #[serde(rename = "EmulatorPatterns")]
    pub emulator_patterns: Vec<PatternInfo>,
    #[serde(rename = "DebugPatterns")]
    pub debug_patterns: Vec<PatternInfo>,
    #[serde(rename = "ProxyPatterns")]
    pub proxy_patterns: Vec<PatternInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatternInfo {
    pub pattern: String,
    pub description: String,
}

/// 匹配到的检测模式结果
#[derive(Debug, Clone, Serialize)]
pub struct DetectionMatch {
    pub pattern: String,
    pub description: String,
    pub category: String,
    pub locations: Vec<String>,
}

/// APK快速分析结果
#[derive(Debug, Serialize)]
pub struct QuickAnalysisResult {
    pub success: bool,
    pub message: String,
    // 基本信息（从二进制AndroidManifest.xml解析）
    pub package_name: Option<String>,
    pub version_name: Option<String>,
    pub version_code: Option<String>,
    pub min_sdk: Option<String>,
    pub target_sdk: Option<String>,
    pub main_activity: Option<String>,
    pub permissions: Vec<String>,
    // 打包服务商
    pub packers: Vec<PackerMatchResult>,
    // SDK服务商
    pub sdks: Vec<SdkMatchResult>,
    // 检测模式匹配
    pub detection_patterns: DetectionPatternResult,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackerMatchResult {
    pub name: String,
    pub matched_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SdkMatchResult {
    pub label: String,
    pub team: String,
    pub description: String,
    pub matched_so: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DetectionPatternResult {
    pub root_file: Vec<DetectionMatch>,
    pub root_app: Vec<DetectionMatch>,
    pub emulator: Vec<DetectionMatch>,
    pub debug: Vec<DetectionMatch>,
    pub proxy: Vec<DetectionMatch>,
}

/// 加载SDK服务商数据库
fn load_sdk_database(current_dir: &Path) -> Result<Vec<SdkInfo>, String> {
    let db_path = current_dir.join("prefile").join("merged_json_file.json");
    if !db_path.exists() {
        return Err("SDK数据库文件不存在".to_string());
    }

    let content = fs::read_to_string(&db_path)
        .map_err(|e| format!("读取SDK数据库失败: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("解析SDK数据库失败: {}", e))
}

/// 加载打包服务商数据库
fn load_packer_database(current_dir: &Path) -> Result<HashMap<String, PackerInfo>, String> {
    let db_path = current_dir.join("prefile").join("apkpackdata.json");
    if !db_path.exists() {
        return Err("打包服务商数据库文件不存在".to_string());
    }

    let content = fs::read_to_string(&db_path)
        .map_err(|e| format!("读取打包服务商数据库失败: {}", e))?;

    // 解析为HashMap<String, PackerInfo>
    let raw: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析打包服务商数据库失败: {}", e))?;

    let mut result = HashMap::new();
    if let Some(obj) = raw.as_object() {
        for (name, value) in obj {
            if let Ok(mut packer) = serde_json::from_value::<PackerInfo>(value.clone()) {
                packer.name = name.clone();
                result.insert(name.clone(), packer);
            }
        }
    }

    Ok(result)
}

/// 加载检测模式数据库
fn load_detection_patterns(current_dir: &Path) -> Result<DetectionPatterns, String> {
    let db_path = current_dir.join("prefile").join("detection_patterns.json");
    if !db_path.exists() {
        return Err("检测模式数据库文件不存在".to_string());
    }

    let content = fs::read_to_string(&db_path)
        .map_err(|e| format!("读取检测模式数据库失败: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("解析检测模式数据库失败: {}", e))
}

/// 二进制AndroidManifest.xml解析器
/// 使用 axmldecoder 库解析Android二进制XML
mod axml_parser {
    use quick_xml::Reader;
    use quick_xml::events::Event;
    use std::io::Cursor;

    #[derive(Debug, Clone, Default)]
    pub struct ManifestInfo {
        pub package_name: Option<String>,
        pub version_name: Option<String>,
        pub version_code: Option<String>,
        pub min_sdk: Option<String>,
        pub target_sdk: Option<String>,
        pub main_activity: Option<String>,
        pub permissions: Vec<String>,
        pub activities: Vec<String>,
        pub services: Vec<String>,
        pub receivers: Vec<String>,
        pub providers: Vec<String>,
    }

    pub struct AxmlParser;

    impl AxmlParser {
        pub fn parse(data: &[u8]) -> Result<ManifestInfo, String> {
            // 使用 axmldecoder 库解析二进制XML
            let mut cursor = Cursor::new(data);
            let axml = axmldecoder::parse(&mut cursor)
                .map_err(|e| format!("AXML解析失败: {:?}", e))?;

            // 将 XmlDocument 转换为 XML 字符串
            let xml_string = Self::xml_document_to_string(&axml);

            // 使用 quick-xml 解析转换后的XML字符串
            Self::parse_xml_string(&xml_string)
        }

        fn xml_document_to_string(doc: &axmldecoder::XmlDocument) -> String {
            let mut result = String::new();
            result.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
            if let Some(axmldecoder::Node::Element(root)) = doc.get_root() {
                Self::element_to_string(root, &mut result, 0);
            }
            result
        }

        fn element_to_string(elem: &axmldecoder::Element, result: &mut String, indent: usize) {
            let indent_str = "  ".repeat(indent);
            result.push_str(&indent_str);
            result.push('<');
            result.push_str(elem.get_tag());

            for (key, value) in elem.get_attributes() {
                result.push(' ');
                result.push_str(key);
                result.push_str("=\"");
                result.push_str(&Self::escape_xml(value));
                result.push('"');
            }

            let children = elem.get_children();
            if children.is_empty() {
                result.push_str(" />\n");
            } else {
                result.push_str(">\n");
                for child in children {
                    if let axmldecoder::Node::Element(child_elem) = child {
                        Self::element_to_string(child_elem, result, indent + 1);
                    }
                }
                result.push_str(&indent_str);
                result.push_str("</");
                result.push_str(elem.get_tag());
                result.push_str(">\n");
            }
        }

        fn escape_xml(s: &str) -> String {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
                .replace('\'', "&apos;")
        }

        fn parse_xml_string(xml: &str) -> Result<ManifestInfo, String> {
            let mut reader = Reader::from_str(xml);
            reader.config_mut().trim_text(true);

            let mut manifest_info = ManifestInfo::default();
            let mut in_intent_filter = false;
            let mut has_main_action = false;
            let mut has_launcher_category = false;
            let mut current_activity_name = String::new();

            let mut buf = Vec::new();

            loop {
                match reader.read_event_into(&mut buf) {
                    Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                        let name = String::from_utf8_lossy(e.name().as_ref()).to_string();

                        match name.as_str() {
                            "manifest" => {
                                for attr in e.attributes().flatten() {
                                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                    let value = String::from_utf8_lossy(&attr.value).to_string();

                                    match key.as_str() {
                                        "package" => manifest_info.package_name = Some(value),
                                        "versionCode" | "android:versionCode" => manifest_info.version_code = Some(value),
                                        "versionName" | "android:versionName" => manifest_info.version_name = Some(value),
                                        _ => {}
                                    }
                                }
                            }
                            "uses-sdk" => {
                                for attr in e.attributes().flatten() {
                                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                    let value = String::from_utf8_lossy(&attr.value).to_string();

                                    match key.as_str() {
                                        "minSdkVersion" | "android:minSdkVersion" => manifest_info.min_sdk = Some(value),
                                        "targetSdkVersion" | "android:targetSdkVersion" => manifest_info.target_sdk = Some(value),
                                        _ => {}
                                    }
                                }
                            }
                            "uses-permission" => {
                                for attr in e.attributes().flatten() {
                                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                    let value = String::from_utf8_lossy(&attr.value).to_string();

                                    if key == "name" || key == "android:name" {
                                        if !value.is_empty() {
                                            manifest_info.permissions.push(value);
                                        }
                                    }
                                }
                            }
                            "activity" | "activity-alias" => {
                                for attr in e.attributes().flatten() {
                                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                    let value = String::from_utf8_lossy(&attr.value).to_string();

                                    if key == "name" || key == "android:name" {
                                        current_activity_name = value.clone();
                                        manifest_info.activities.push(value);
                                        break;
                                    }
                                }
                                in_intent_filter = false;
                                has_main_action = false;
                                has_launcher_category = false;
                            }
                            "service" => {
                                for attr in e.attributes().flatten() {
                                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                    let value = String::from_utf8_lossy(&attr.value).to_string();

                                    if key == "name" || key == "android:name" {
                                        manifest_info.services.push(value);
                                        break;
                                    }
                                }
                            }
                            "receiver" => {
                                for attr in e.attributes().flatten() {
                                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                    let value = String::from_utf8_lossy(&attr.value).to_string();

                                    if key == "name" || key == "android:name" {
                                        manifest_info.receivers.push(value);
                                        break;
                                    }
                                }
                            }
                            "provider" => {
                                for attr in e.attributes().flatten() {
                                    let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                    let value = String::from_utf8_lossy(&attr.value).to_string();

                                    if key == "name" || key == "android:name" {
                                        manifest_info.providers.push(value);
                                        break;
                                    }
                                }
                            }
                            "intent-filter" => {
                                in_intent_filter = true;
                            }
                            "action" => {
                                if in_intent_filter {
                                    for attr in e.attributes().flatten() {
                                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                        let value = String::from_utf8_lossy(&attr.value).to_string();

                                        if (key == "name" || key == "android:name")
                                            && value == "android.intent.action.MAIN" {
                                            has_main_action = true;
                                        }
                                    }
                                }
                            }
                            "category" => {
                                if in_intent_filter {
                                    for attr in e.attributes().flatten() {
                                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                                        let value = String::from_utf8_lossy(&attr.value).to_string();

                                        if (key == "name" || key == "android:name")
                                            && value == "android.intent.category.LAUNCHER" {
                                            has_launcher_category = true;
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    Ok(Event::End(ref e)) => {
                        let name = String::from_utf8_lossy(e.name().as_ref()).to_string();

                        if name == "intent-filter" {
                            if has_main_action && has_launcher_category && manifest_info.main_activity.is_none() {
                                manifest_info.main_activity = Some(current_activity_name.clone());
                            }
                            in_intent_filter = false;
                        }
                        if name == "activity" || name == "activity-alias" {
                            current_activity_name.clear();
                            has_main_action = false;
                            has_launcher_category = false;
                        }
                    }
                    Ok(Event::Eof) => break,
                    Err(e) => return Err(format!("XML解析错误: {:?}", e)),
                    _ => {}
                }
                buf.clear();
            }

            Ok(manifest_info)
        }
    }
}

/// 从APK文件列表中匹配打包服务商
fn match_packers(
    file_list: &[String],
    packers_db: &HashMap<String, PackerInfo>,
) -> Vec<PackerMatchResult> {
    let mut results = Vec::new();

    for (name, packer) in packers_db {
        let mut matched_files = Vec::new();

        // 匹配sopath
        for sopath in &packer.sopath {
            let normalized = sopath.replace('\\', "/");
            if file_list.iter().any(|f| f == &normalized || f.ends_with(&normalized)) {
                matched_files.push(normalized);
            }
        }

        // 匹配soname (在lib目录下)
        for soname in &packer.soname {
            for file in file_list {
                if file.ends_with(soname) && (file.contains("lib/") || file.contains("assets/")) {
                    if !matched_files.contains(file) {
                        matched_files.push(file.clone());
                    }
                }
            }
        }

        // 匹配other (其他特征文件)
        for other in &packer.other {
            let normalized = other.replace('\\', "/");
            for file in file_list {
                if file == &normalized || file.ends_with(&normalized) {
                    if !matched_files.contains(file) {
                        matched_files.push(file.clone());
                    }
                }
            }
        }

        // 匹配soregex
        for regex_pattern in &packer.soregex {
            if let Ok(re) = regex::Regex::new(regex_pattern) {
                for file in file_list {
                    if re.is_match(file) && !matched_files.contains(file) {
                        matched_files.push(file.clone());
                    }
                }
            }
        }

        if !matched_files.is_empty() {
            results.push(PackerMatchResult {
                name: name.clone(),
                matched_files,
            });
        }
    }

    results
}

/// 从APK文件列表中匹配SDK服务商（基于.so文件）
fn match_sdks(
    so_files: &[String],
    sdk_db: &[SdkInfo],
) -> Vec<SdkMatchResult> {
    let mut results = Vec::new();
    let mut matched_labels = HashSet::new();

    for sdk in sdk_db {
        let soname = &sdk.soname;
        for so_file in so_files {
            // 提取文件名
            let file_name = so_file.rsplit('/').next().unwrap_or(so_file);
            if file_name == soname {
                if !matched_labels.contains(&sdk.label) {
                    matched_labels.insert(sdk.label.clone());
                    results.push(SdkMatchResult {
                        label: sdk.label.clone(),
                        team: sdk.team.clone(),
                        description: sdk.description.clone(),
                        matched_so: so_file.clone(),
                    });
                }
                break;
            }
        }
    }

    results
}

/// 从APK直接快速分析
#[tauri::command]
pub async fn quick_analyze_apk(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_path = current_dir.join(&apk_dir).join("base.apk");
    let cache_path = current_dir.join(&apk_dir).join("quick_analysis.json");

    // 检查缓存
    if cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<serde_json::Value>(&cache_content) {
                return Ok(cached_data);
            }
        }
    }

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
        }));
    }

    let current_dir_clone = current_dir.clone();
    let apk_path_clone = apk_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        do_quick_analyze(&apk_path_clone, &current_dir_clone)
    }).await.map_err(|e| e.to_string())??;

    // 保存缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        let _ = fs::write(&cache_path, &json_str);
    }

    Ok(result)
}

fn do_quick_analyze(apk_path: &Path, current_dir: &Path) -> Result<serde_json::Value, String> {
    let file = File::open(apk_path).map_err(|e| format!("打开APK失败: {}", e))?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("解析APK失败: {}", e))?;

    // 收集所有文件列表
    let mut file_list: Vec<String> = Vec::new();
    let mut so_files: Vec<String> = Vec::new();

    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name().to_string();
            if name.ends_with(".so") {
                so_files.push(name.clone());
            }
            file_list.push(name);
        }
    }

    // 解析AndroidManifest.xml
    let manifest_info = {
        let manifest_result = archive.by_name("AndroidManifest.xml");
        match manifest_result {
            Ok(mut manifest_file) => {
                let mut manifest_data = Vec::new();
                manifest_file.read_to_end(&mut manifest_data).map_err(|e| e.to_string())?;
                axml_parser::AxmlParser::parse(&manifest_data).ok()
            }
            Err(_) => None
        }
    };

    // 加载数据库
    let sdk_db = load_sdk_database(current_dir).unwrap_or_default();
    let packer_db = load_packer_database(current_dir).unwrap_or_default();

    // 并行匹配
    let sdk_db_arc = Arc::new(sdk_db);
    let packer_db_arc = Arc::new(packer_db);
    let so_files_arc = Arc::new(so_files);
    let file_list_arc = Arc::new(file_list);

    let sdk_results = match_sdks(&so_files_arc, &sdk_db_arc);
    let packer_results = match_packers(&file_list_arc, &packer_db_arc);

    let result = json!({
        "success": true,
        "message": "分析完成",
        "packageName": manifest_info.as_ref().and_then(|m| m.package_name.clone()),
        "versionName": manifest_info.as_ref().and_then(|m| m.version_name.clone()),
        "versionCode": manifest_info.as_ref().and_then(|m| m.version_code.clone()),
        "minSdk": manifest_info.as_ref().and_then(|m| m.min_sdk.clone()),
        "targetSdk": manifest_info.as_ref().and_then(|m| m.target_sdk.clone()),
        "mainActivity": manifest_info.as_ref().and_then(|m| m.main_activity.clone()),
        "permissions": manifest_info.as_ref().map(|m| m.permissions.clone()).unwrap_or_default(),
        "components": {
            "activities": manifest_info.as_ref().map(|m| m.activities.clone()).unwrap_or_default(),
            "services": manifest_info.as_ref().map(|m| m.services.clone()).unwrap_or_default(),
            "receivers": manifest_info.as_ref().map(|m| m.receivers.clone()).unwrap_or_default(),
            "providers": manifest_info.as_ref().map(|m| m.providers.clone()).unwrap_or_default()
        },
        "packers": packer_results,
        "sdks": sdk_results,
        "soFiles": so_files_arc.as_ref().clone(),
        "fileCount": file_list_arc.len()
    });

    Ok(result)
}

/// 分析检测模式（扫描dex文件中的字符串）
#[tauri::command]
pub async fn analyze_detection_patterns(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_path = current_dir.join(&apk_dir).join("base.apk");
    let cache_path = current_dir.join(&apk_dir).join("detection_patterns.json");

    // 检查缓存
    if cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<serde_json::Value>(&cache_content) {
                return Ok(cached_data);
            }
        }
    }

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
        }));
    }

    // 加载检测模式数据库
    let patterns = load_detection_patterns(&current_dir)?;

    let apk_path_clone = apk_path.clone();
    let patterns_arc = Arc::new(patterns);

    let result = tokio::task::spawn_blocking(move || {
        do_analyze_detection_patterns(&apk_path_clone, &patterns_arc)
    }).await.map_err(|e| e.to_string())??;

    // 保存缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        let _ = fs::write(&cache_path, &json_str);
    }

    Ok(result)
}

fn do_analyze_detection_patterns(apk_path: &Path, patterns: &DetectionPatterns) -> Result<serde_json::Value, String> {
    let file = File::open(apk_path).map_err(|e| format!("打开APK失败: {}", e))?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("解析APK失败: {}", e))?;

    // 收集所有dex文件内容用于字符串搜索
    let mut all_strings = HashSet::new();

    // 读取所有dex文件，提取字符串
    for i in 0..archive.len() {
        if let Ok(mut file) = archive.by_index(i) {
            let name = file.name().to_string();
            if name.ends_with(".dex") || name.ends_with(".smali") {
                let mut content = Vec::new();
                if file.read_to_end(&mut content).is_ok() {
                    // 简单提取可打印字符串
                    extract_strings_from_bytes(&content, &mut all_strings);
                }
            }
        }
    }

    let all_strings: Vec<String> = all_strings.into_iter().collect();

    // 并行匹配各类模式
    let mut result = DetectionPatternResult::default();

    // Root文件检测
    result.root_file = patterns.root_file_patterns.par_iter()
        .filter_map(|p| {
            let matches: Vec<String> = all_strings.iter()
                .filter(|s| s.contains(&p.pattern))
                .cloned()
                .take(5)
                .collect();
            if !matches.is_empty() {
                Some(DetectionMatch {
                    pattern: p.pattern.clone(),
                    description: p.description.clone(),
                    category: "RootFile".to_string(),
                    locations: matches,
                })
            } else {
                None
            }
        })
        .collect();

    // Root应用检测
    result.root_app = patterns.root_app_patterns.par_iter()
        .filter_map(|p| {
            let matches: Vec<String> = all_strings.iter()
                .filter(|s| s.contains(&p.pattern))
                .cloned()
                .take(5)
                .collect();
            if !matches.is_empty() {
                Some(DetectionMatch {
                    pattern: p.pattern.clone(),
                    description: p.description.clone(),
                    category: "RootApp".to_string(),
                    locations: matches,
                })
            } else {
                None
            }
        })
        .collect();

    // 模拟器检测
    result.emulator = patterns.emulator_patterns.par_iter()
        .filter_map(|p| {
            let matches: Vec<String> = all_strings.iter()
                .filter(|s| s.contains(&p.pattern))
                .cloned()
                .take(5)
                .collect();
            if !matches.is_empty() {
                Some(DetectionMatch {
                    pattern: p.pattern.clone(),
                    description: p.description.clone(),
                    category: "Emulator".to_string(),
                    locations: matches,
                })
            } else {
                None
            }
        })
        .collect();

    // 调试检测
    result.debug = patterns.debug_patterns.par_iter()
        .filter_map(|p| {
            let matches: Vec<String> = all_strings.iter()
                .filter(|s| s.contains(&p.pattern))
                .cloned()
                .take(5)
                .collect();
            if !matches.is_empty() {
                Some(DetectionMatch {
                    pattern: p.pattern.clone(),
                    description: p.description.clone(),
                    category: "Debug".to_string(),
                    locations: matches,
                })
            } else {
                None
            }
        })
        .collect();

    // 代理检测
    result.proxy = patterns.proxy_patterns.par_iter()
        .filter_map(|p| {
            let matches: Vec<String> = all_strings.iter()
                .filter(|s| s.contains(&p.pattern))
                .cloned()
                .take(5)
                .collect();
            if !matches.is_empty() {
                Some(DetectionMatch {
                    pattern: p.pattern.clone(),
                    description: p.description.clone(),
                    category: "Proxy".to_string(),
                    locations: matches,
                })
            } else {
                None
            }
        })
        .collect();

    Ok(json!({
        "success": true,
        "rootFile": result.root_file,
        "rootApp": result.root_app,
        "emulator": result.emulator,
        "debug": result.debug,
        "proxy": result.proxy,
        "summary": {
            "rootFileCount": result.root_file.len(),
            "rootAppCount": result.root_app.len(),
            "emulatorCount": result.emulator.len(),
            "debugCount": result.debug.len(),
            "proxyCount": result.proxy.len()
        }
    }))
}

/// 从字节数据中提取可打印字符串
fn extract_strings_from_bytes(data: &[u8], strings: &mut HashSet<String>) {
    let mut current = String::new();

    for &byte in data {
        if byte >= 0x20 && byte < 0x7F {
            current.push(byte as char);
        } else if current.len() >= 4 {
            // 只保留长度>=4的字符串
            strings.insert(current.clone());
            current.clear();
        } else {
            current.clear();
        }
    }

    if current.len() >= 4 {
        strings.insert(current);
    }
}

/// 获取APK基本信息（快速版本，不依赖jadx）
#[tauri::command]
pub async fn get_apk_info_quick(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_path = current_dir.join(&apk_dir).join("base.apk");
    let info_path = current_dir.join(&apk_dir).join("info.json");
    let quick_info_path = current_dir.join(&apk_dir).join("quick_info.json");

    // 检查缓存
    if quick_info_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&quick_info_path) {
            if let Ok(cached_data) = serde_json::from_str::<serde_json::Value>(&cache_content) {
                return Ok(cached_data);
            }
        }
    }

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
        }));
    }

    // 读取原始info.json
    let info: serde_json::Value = if info_path.exists() {
        fs::read_to_string(&info_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(json!({}))
    } else {
        json!({})
    };

    let apk_path_clone = apk_path.clone();

    let manifest_info = tokio::task::spawn_blocking(move || {
        let file = File::open(&apk_path_clone).ok()?;
        let reader = BufReader::new(file);
        let mut archive = ZipArchive::new(reader).ok()?;

        let mut manifest_file = archive.by_name("AndroidManifest.xml").ok()?;
        let mut manifest_data = Vec::new();
        manifest_file.read_to_end(&mut manifest_data).ok()?;

        axml_parser::AxmlParser::parse(&manifest_data).ok()
    }).await.map_err(|e| e.to_string())?;

    // 获取文件大小
    let file_size = fs::metadata(&apk_path).map(|m| m.len()).unwrap_or(0);

    // 检查jadx目录是否存在
    let jadx_path = current_dir.join(&apk_dir).join("jadx");
    let is_decompiled = jadx_path.exists();

    let result = json!({
        "success": true,
        "originalName": info.get("originalName").and_then(|v| v.as_str()).unwrap_or(""),
        "uploadTime": info.get("uploadTime").and_then(|v| v.as_str()).unwrap_or(""),
        "fileSize": file_size,
        "timestamp": info.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0),
        "isDecompiled": is_decompiled,
        "appName": manifest_info.as_ref().and_then(|m| m.package_name.clone())
            .or_else(|| info.get("originalName").and_then(|v| v.as_str().map(|s| s.to_string())))
            .unwrap_or_else(|| "未知应用".to_string()),
        "packageName": manifest_info.as_ref().and_then(|m| m.package_name.clone()).unwrap_or_default(),
        "versionName": manifest_info.as_ref().and_then(|m| m.version_name.clone()).unwrap_or_default(),
        "versionCode": manifest_info.as_ref().and_then(|m| m.version_code.clone()).unwrap_or_default(),
        "minSdk": manifest_info.as_ref().and_then(|m| m.min_sdk.clone()).unwrap_or_default(),
        "targetSdk": manifest_info.as_ref().and_then(|m| m.target_sdk.clone()).unwrap_or_default(),
        "mainActivity": manifest_info.as_ref().and_then(|m| m.main_activity.clone()).unwrap_or_default(),
        "permissions": manifest_info.as_ref().map(|m| m.permissions.clone()).unwrap_or_default(),
        "iconPath": ""
    });

    // 保存缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        let _ = fs::write(&quick_info_path, &json_str);
    }

    Ok(result)
}

/// 快速获取权限列表（不依赖jadx）
#[tauri::command]
pub async fn get_apk_permissions_quick(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_path = current_dir.join(&apk_dir).join("base.apk");

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在",
            "permissions": []
        }));
    }

    let apk_path_clone = apk_path.clone();
    let current_dir_clone = current_dir.clone();

    let result = tokio::task::spawn_blocking(move || {
        let file = File::open(&apk_path_clone).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;

        let mut manifest_file = archive.by_name("AndroidManifest.xml").map_err(|e| e.to_string())?;
        let mut manifest_data = Vec::new();
        manifest_file.read_to_end(&mut manifest_data).map_err(|e| e.to_string())?;

        let manifest_info = axml_parser::AxmlParser::parse(&manifest_data)?;

        // 加载权限映射表
        let permission_map = crate::apk::load_permission_map();

        let mut permissions: Vec<crate::apk::PermissionInfo> = Vec::new();

        for perm in &manifest_info.permissions {
            let short_name = perm.split('.').last().unwrap_or(perm).to_string();

            let (name_zh, description, level) = if let Some(entry) = permission_map.get(&short_name) {
                (entry.name_zh.clone(), entry.description.clone(), entry.level.clone())
            } else {
                let readable_name = short_name
                    .replace("_", " ")
                    .split_whitespace()
                    .map(|word| {
                        let mut chars = word.chars();
                        match chars.next() {
                            Some(c) => c.to_uppercase().collect::<String>() + chars.as_str().to_lowercase().as_str(),
                            None => String::new(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                (readable_name, format!("自定义权限: {}", perm), "other".to_string())
            };

            permissions.push(crate::apk::PermissionInfo {
                permission: perm.clone(),
                name: short_name,
                name_zh,
                description,
                level,
            });
        }

        // 排序
        permissions.sort_by(|a, b| {
            let level_order = |l: &str| -> i32 {
                match l {
                    "dangerous" => 0,
                    "signature" => 1,
                    "normal" => 9,
                    "other" => 12,
                    _ => 13,
                }
            };
            level_order(&a.level).cmp(&level_order(&b.level))
        });

        // 统计
        let mut level_stats: HashMap<String, usize> = HashMap::new();
        for perm in &permissions {
            *level_stats.entry(perm.level.clone()).or_insert(0) += 1;
        }

        Ok::<serde_json::Value, String>(json!({
            "success": true,
            "message": "成功",
            "permissions": permissions,
            "stats": {
                "total": permissions.len(),
                "levels": level_stats
            }
        }))
    }).await.map_err(|e| e.to_string())??;

    Ok(result)
}

/// 快速获取四大组件（不依赖jadx）
#[tauri::command]
pub async fn get_apk_components_quick(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_path = current_dir.join(&apk_dir).join("base.apk");

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
        }));
    }

    let apk_path_clone = apk_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        let file = File::open(&apk_path_clone).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;

        let mut manifest_file = archive.by_name("AndroidManifest.xml").map_err(|e| e.to_string())?;
        let mut manifest_data = Vec::new();
        manifest_file.read_to_end(&mut manifest_data).map_err(|e| e.to_string())?;

        let manifest_info = axml_parser::AxmlParser::parse(&manifest_data)?;

        Ok::<serde_json::Value, String>(json!({
            "success": true,
            "components": {
                "activities": manifest_info.activities,
                "services": manifest_info.services,
                "receivers": manifest_info.receivers,
                "providers": manifest_info.providers
            }
        }))
    }).await.map_err(|e| e.to_string())??;

    Ok(result)
}
