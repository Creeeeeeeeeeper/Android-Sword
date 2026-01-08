use std::fs;
use std::env;
use std::process::Command;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use serde_json::json;
use md5;
use sha1::{Sha1, Digest as Sha1Digest};
use sha2::{Sha256, Digest};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 权限信息结构体
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PermissionInfo {
    pub permission: String,
    pub name: String,
    pub name_zh: String,
    pub description: String,
    pub level: String,
}

/// permission.json中的权限条目结构
#[derive(serde::Deserialize)]
pub struct PermissionEntry {
    pub name: String,
    pub name_zh: String,
    pub description: String,
    pub level: String,
}

/// 从permission.json加载权限映射表
pub fn load_permission_map() -> HashMap<String, PermissionEntry> {
    let mut map = HashMap::new();

    let current_dir = match env::current_dir() {
        Ok(dir) => dir,
        Err(_) => return map,
    };

    let permission_file = current_dir.join("prefile").join("permission.json");

    if let Ok(content) = fs::read_to_string(&permission_file) {
        if let Ok(entries) = serde_json::from_str::<Vec<PermissionEntry>>(&content) {
            for entry in entries {
                map.insert(entry.name.clone(), entry);
            }
        }
    }

    map
}

/// 从strings.xml解析字符串资源
pub fn resolve_string_resource(jadx_path: &std::path::Path, string_name: &str) -> Option<String> {
    let res_path = jadx_path.join("resources").join("res");

    let values_dirs = vec!["values-zh-rCN", "values-zh", "values", "values-en"];

    for values_dir in &values_dirs {
        let strings_path = res_path.join(values_dir).join("strings.xml");
        if strings_path.exists() {
            if let Ok(content) = fs::read_to_string(&strings_path) {
                let pattern = format!("<string name=\"{}\">", string_name);
                if let Some(start) = content.find(&pattern) {
                    let start = start + pattern.len();
                    if let Some(end) = content[start..].find("</string>") {
                        let value = &content[start..start + end];
                        if !value.is_empty() && !value.starts_with("@") {
                            return Some(value.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// 查找并复制图标到APK目录
pub fn find_and_copy_icon(jadx_path: &std::path::Path, icon_ref: &str, apk_dir_path: &std::path::Path) -> Option<String> {
    let res_path = jadx_path.join("resources").join("res");

    let parts: Vec<&str> = icon_ref.split('/').collect();
    if parts.len() != 2 {
        return None;
    }

    let res_type = parts[0];
    let icon_name = parts[1];

    let density_suffixes = vec![
        "-xxxhdpi-v4", "-xxxhdpi",
        "-xxhdpi-v4", "-xxhdpi",
        "-xhdpi-v4", "-xhdpi",
        "-hdpi-v4", "-hdpi",
        "-mdpi-v4", "-mdpi",
        "-anydpi-v26", "-anydpi-v24", "-anydpi",
        "-v4", ""
    ];

    let extensions = vec!["png", "webp", "jpg", "jpeg"];

    // 首先尝试直接查找PNG图标
    for suffix in &density_suffixes {
        let dir_name = format!("{}{}", res_type, suffix);
        let dir_path = res_path.join(&dir_name);

        if dir_path.exists() {
            for ext in &extensions {
                let icon_file = dir_path.join(format!("{}.{}", icon_name, ext));
                if icon_file.exists() {
                    let dest_path = apk_dir_path.join("icon.png");
                    if fs::copy(&icon_file, &dest_path).is_ok() {
                        eprintln!("已复制图标: {} -> {}", icon_file.display(), dest_path.display());
                        return Some(dest_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    // 如果是自适应图标（XML），尝试解析并查找foreground图标
    for suffix in &density_suffixes {
        let dir_name = format!("{}{}", res_type, suffix);
        let dir_path = res_path.join(&dir_name);
        let xml_file = dir_path.join(format!("{}.xml", icon_name));

        if xml_file.exists() {
            if let Ok(xml_content) = fs::read_to_string(&xml_file) {
                if let Some(foreground_ref) = parse_adaptive_icon_foreground(&xml_content) {
                    eprintln!("找到自适应图标，foreground: {}", foreground_ref);
                    if let Some(icon) = find_and_copy_icon(jadx_path, &foreground_ref, apk_dir_path) {
                        return Some(icon);
                    }
                }
            }
        }
    }

    // 尝试常见的图标名称作为后备方案
    let fallback_names = vec![
        format!("{}_foreground", icon_name),
        "ic_launcher_foreground".to_string(),
        "ic_launcher".to_string(),
        "icon".to_string(),
        "app_icon".to_string(),
    ];

    for fallback_name in &fallback_names {
        if let Ok(entries) = fs::read_dir(&res_path) {
            for entry in entries.flatten() {
                let entry_name = entry.file_name().to_string_lossy().to_string();
                if entry_name.starts_with("mipmap") || entry_name.starts_with("drawable") {
                    let dir_path = entry.path();
                    if dir_path.is_dir() {
                        for ext in &extensions {
                            let icon_file = dir_path.join(format!("{}.{}", fallback_name, ext));
                            if icon_file.exists() {
                                let dest_path = apk_dir_path.join("icon.png");
                                if fs::copy(&icon_file, &dest_path).is_ok() {
                                    eprintln!("已复制后备图标: {} -> {}", icon_file.display(), dest_path.display());
                                    return Some(dest_path.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 最后尝试遍历所有res子目录查找任何可能的图标PNG
    if let Ok(entries) = fs::read_dir(&res_path) {
        let mut found_icons: Vec<(String, std::path::PathBuf)> = Vec::new();

        for entry in entries.flatten() {
            let entry_name = entry.file_name().to_string_lossy().to_string();
            if entry_name.starts_with("mipmap") || entry_name.starts_with("drawable") {
                let dir_path = entry.path();
                if dir_path.is_dir() {
                    if let Ok(files) = fs::read_dir(&dir_path) {
                        for file in files.flatten() {
                            let file_name = file.file_name().to_string_lossy().to_string();
                            if (file_name.contains("launcher") || file_name.contains("icon"))
                                && !file_name.contains("notification")
                                && (file_name.ends_with(".png") || file_name.ends_with(".webp")) {
                                found_icons.push((entry_name.clone(), file.path()));
                            }
                        }
                    }
                }
            }
        }

        found_icons.sort_by(|a, b| {
            let priority = |name: &str| -> i32 {
                if name.contains("xxxhdpi") { return 0; }
                if name.contains("xxhdpi") { return 1; }
                if name.contains("xhdpi") { return 2; }
                if name.contains("hdpi") { return 3; }
                if name.contains("mdpi") { return 4; }
                5
            };
            priority(&a.0).cmp(&priority(&b.0))
        });

        if let Some((_, icon_file)) = found_icons.first() {
            let dest_path = apk_dir_path.join("icon.png");
            if fs::copy(icon_file, &dest_path).is_ok() {
                eprintln!("已复制图标: {} -> {}", icon_file.display(), dest_path.display());
                return Some(dest_path.to_string_lossy().to_string());
            }
        }
    }

    None
}

/// 解析自适应图标XML，获取foreground drawable引用
pub fn parse_adaptive_icon_foreground(xml_content: &str) -> Option<String> {
    if let Some(start) = xml_content.find("foreground") {
        let after_foreground = &xml_content[start..];
        if let Some(drawable_start) = after_foreground.find("android:drawable=\"@") {
            let ref_start = drawable_start + 19;
            if let Some(ref_end) = after_foreground[ref_start..].find("\"") {
                let drawable_ref = &after_foreground[ref_start..ref_start + ref_end];
                return Some(drawable_ref.to_string());
            }
        }
    }
    None
}

/// 获取APK信息（从AndroidManifest.xml解析）
#[tauri::command]
pub fn get_apk_info(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);

    let info_path = apk_dir_path.join("info.json");
    let info_content = fs::read_to_string(&info_path).unwrap_or_default();
    let info: serde_json::Value = serde_json::from_str(&info_content).unwrap_or(json!({}));

    let jadx_path = apk_dir_path.join("jadx");
    let is_decompiled = jadx_path.exists();

    let saved_icon_path = apk_dir_path.join("icon.png");
    let mut icon_path = String::new();

    if saved_icon_path.exists() {
        icon_path = saved_icon_path.to_string_lossy().to_string();
    }

    let manifest_path = jadx_path.join("resources").join("AndroidManifest.xml");
    let mut app_name = info.get("originalName").and_then(|v| v.as_str()).unwrap_or("未知应用").to_string();
    let mut package_name = String::new();
    let mut version_name = String::new();
    let mut version_code = String::new();
    let mut min_sdk = String::new();
    let mut target_sdk = String::new();
    let mut main_activity = String::new();
    let mut icon_ref = String::new();

    if manifest_path.exists() {
        if let Ok(manifest_content) = fs::read_to_string(&manifest_path) {
            // 获取package名
            if let Some(start) = manifest_content.find("package=\"") {
                let start = start + 9;
                if let Some(end) = manifest_content[start..].find("\"") {
                    package_name = manifest_content[start..start+end].to_string();
                }
            }

            // 获取versionName
            if let Some(start) = manifest_content.find("android:versionName=\"") {
                let start = start + 21;
                if let Some(end) = manifest_content[start..].find("\"") {
                    version_name = manifest_content[start..start+end].to_string();
                }
            }

            // 获取versionCode
            if let Some(start) = manifest_content.find("android:versionCode=\"") {
                let start = start + 21;
                if let Some(end) = manifest_content[start..].find("\"") {
                    version_code = manifest_content[start..start+end].to_string();
                }
            }

            // 获取minSdkVersion
            if let Some(start) = manifest_content.find("android:minSdkVersion=\"") {
                let start = start + 23;
                if let Some(end) = manifest_content[start..].find("\"") {
                    min_sdk = manifest_content[start..start+end].to_string();
                }
            }

            // 获取targetSdkVersion
            if let Some(start) = manifest_content.find("android:targetSdkVersion=\"") {
                let start = start + 26;
                if let Some(end) = manifest_content[start..].find("\"") {
                    target_sdk = manifest_content[start..start+end].to_string();
                }
            }

            // 获取入口Activity
            let mut pos = 0;
            while let Some(activity_start) = manifest_content[pos..].find("<activity") {
                let activity_start = pos + activity_start;
                if let Some(activity_end) = manifest_content[activity_start..].find("</activity>") {
                    let activity_end = activity_start + activity_end + 11;
                    let activity_block = &manifest_content[activity_start..activity_end];

                    if activity_block.contains("android.intent.action.MAIN") &&
                       activity_block.contains("android.intent.category.LAUNCHER") {
                        if let Some(name_start) = activity_block.find("android:name=\"") {
                            let name_start = name_start + 14;
                            if let Some(name_end) = activity_block[name_start..].find("\"") {
                                main_activity = activity_block[name_start..name_start+name_end].to_string();
                                break;
                            }
                        }
                    }
                    pos = activity_end;
                } else {
                    break;
                }
            }

            // 获取 <application> 标签的内容
            if let Some(app_start) = manifest_content.find("<application") {
                let app_tag_end = manifest_content[app_start..].find('>').map(|p| app_start + p).unwrap_or(manifest_content.len());
                let app_tag = &manifest_content[app_start..app_tag_end];

                if let Some(label_start) = app_tag.find("android:label=\"") {
                    let label_start = label_start + 15;
                    if let Some(label_end) = app_tag[label_start..].find("\"") {
                        let label = &app_tag[label_start..label_start+label_end];
                        if label.starts_with("@string/") {
                            let string_name = &label[8..];
                            if let Some(resolved_name) = resolve_string_resource(&jadx_path, string_name) {
                                app_name = resolved_name;
                            }
                        } else if !label.starts_with("@") {
                            app_name = label.to_string();
                        }
                    }
                }

                if let Some(icon_start) = app_tag.find("android:icon=\"@") {
                    let icon_start = icon_start + 15;
                    if let Some(icon_end) = app_tag[icon_start..].find("\"") {
                        icon_ref = app_tag[icon_start..icon_start+icon_end].to_string();
                    }
                }
            }
        }
    }

    // 如果还没有提取图标，尝试从jadx资源中查找并复制
    if icon_path.is_empty() && is_decompiled && !icon_ref.is_empty() {
        if let Some(found_icon) = find_and_copy_icon(&jadx_path, &icon_ref, &apk_dir_path) {
            icon_path = found_icon;
        }
    }

    // 获取APK文件大小
    let apk_path = apk_dir_path.join("base.apk");
    let file_size = if apk_path.exists() {
        fs::metadata(&apk_path).map(|m| m.len()).unwrap_or(0)
    } else {
        info.get("fileSize").and_then(|v| v.as_u64()).unwrap_or(0)
    };

    Ok(json!({
        "originalName": info.get("originalName").and_then(|v| v.as_str()).unwrap_or(""),
        "uploadTime": info.get("uploadTime").and_then(|v| v.as_str()).unwrap_or(""),
        "fileSize": file_size,
        "timestamp": info.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0),
        "isDecompiled": is_decompiled,
        "appName": app_name,
        "packageName": package_name,
        "versionName": version_name,
        "versionCode": version_code,
        "minSdk": min_sdk,
        "targetSdk": target_sdk,
        "mainActivity": main_activity,
        "iconPath": icon_path
    }))
}

/// 获取所有APK列表
#[tauri::command]
pub fn get_apk_list(case_number: String) -> Result<Vec<serde_json::Value>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apks_dir = current_dir.join("case").join(&case_number).join("apks");

    if !apks_dir.exists() {
        return Ok(vec![]);
    }

    let mut apk_list = Vec::new();

    if let Ok(entries) = fs::read_dir(&apks_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let apk_dir = format!("case/{}/apks/{}", case_number, entry.file_name().to_string_lossy());
                if let Ok(info) = get_apk_info(apk_dir) {
                    apk_list.push(info);
                }
            }
        }
    }

    apk_list.sort_by(|a, b| {
        let ts_a = a.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0);
        let ts_b = b.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0);
        ts_b.cmp(&ts_a)
    });

    Ok(apk_list)
}

/// 从AndroidManifest.xml解析权限列表
pub fn parse_permissions_from_manifest(manifest_content: &str) -> Vec<String> {
    let mut permissions = Vec::new();

    let re = regex::Regex::new(r#"<uses-permission[^>]*android:name="([^"]+)"[^>]*/?\s*>"#).unwrap();

    for cap in re.captures_iter(manifest_content) {
        if let Some(perm) = cap.get(1) {
            permissions.push(perm.as_str().to_string());
        }
    }

    permissions.sort();
    permissions.dedup();

    permissions
}

/// 获取APK权限列表
#[tauri::command]
pub fn get_apk_permissions(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let jadx_path = apk_dir_path.join("jadx");

    if !jadx_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK尚未反编译完成",
            "permissions": []
        }));
    }

    let manifest_path = jadx_path.join("resources").join("AndroidManifest.xml");
    if !manifest_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "未找到AndroidManifest.xml文件",
            "permissions": []
        }));
    }

    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("读取Manifest失败: {}", e))?;

    let raw_permissions = parse_permissions_from_manifest(&manifest_content);
    let permission_map = load_permission_map();

    let mut permissions: Vec<PermissionInfo> = Vec::new();

    for perm in raw_permissions {
        let short_name = perm.split('.').last().unwrap_or(&perm).to_string();

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

        permissions.push(PermissionInfo {
            permission: perm,
            name: short_name,
            name_zh,
            description,
            level,
        });
    }

    permissions.sort_by(|a, b| {
        let level_order = |l: &str| -> i32 {
            match l {
                "dangerous" => 0,
                "signature" => 1,
                "signature|privileged" => 2,
                "signature|privileged|development" => 3,
                "signature|privileged|appop" => 4,
                "signature|appop" => 5,
                "signature|preinstalled|knownSigner|role" => 6,
                "internal|role" => 7,
                "internal|privileged" => 8,
                "normal" => 9,
                "normal|instant" => 10,
                "normal|appop|instant" => 11,
                "other" => 12,
                _ => 13,
            }
        };
        level_order(&a.level).cmp(&level_order(&b.level))
    });

    let mut level_stats: HashMap<String, usize> = HashMap::new();
    for perm in &permissions {
        *level_stats.entry(perm.level.clone()).or_insert(0) += 1;
    }

    Ok(json!({
        "success": true,
        "message": "成功",
        "permissions": permissions,
        "stats": {
            "total": permissions.len(),
            "levels": level_stats
        }
    }))
}

/// 计算文件哈希值
pub fn calculate_file_hashes(file_path: &std::path::Path) -> Result<(String, String, String), String> {
    let mut file = fs::File::open(file_path).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

    let md5_hash = format!("{:x}", md5::compute(&buffer));

    let mut sha1_hasher = Sha1::new();
    Sha1Digest::update(&mut sha1_hasher, &buffer);
    let sha1_hash = format!("{:x}", sha1_hasher.finalize());

    let mut sha256_hasher = Sha256::new();
    Digest::update(&mut sha256_hasher, &buffer);
    let sha256_hash = format!("{:x}", sha256_hasher.finalize());

    Ok((md5_hash, sha1_hash, sha256_hash))
}

/// 解析AndroidManifest.xml中的四大组件
pub fn parse_android_components(manifest_content: &str) -> serde_json::Value {
    let mut activities: Vec<String> = Vec::new();
    let mut services: Vec<String> = Vec::new();
    let mut receivers: Vec<String> = Vec::new();
    let mut providers: Vec<String> = Vec::new();

    // 解析 Activity
    let mut pos = 0;
    while let Some(start) = manifest_content[pos..].find("<activity") {
        let start = pos + start;
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    activities.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    // 解析 Service
    pos = 0;
    while let Some(start) = manifest_content[pos..].find("<service") {
        let start = pos + start;
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    services.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    // 解析 Receiver
    pos = 0;
    while let Some(start) = manifest_content[pos..].find("<receiver") {
        let start = pos + start;
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    receivers.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    // 解析 Provider
    pos = 0;
    while let Some(start) = manifest_content[pos..].find("<provider") {
        let start = pos + start;
        if let Some(tag_end) = manifest_content[start..].find('>') {
            let tag_content = &manifest_content[start..start + tag_end];
            if let Some(name_start) = tag_content.find("android:name=\"") {
                let name_start = name_start + 14;
                if let Some(name_end) = tag_content[name_start..].find("\"") {
                    let name = tag_content[name_start..name_start + name_end].to_string();
                    providers.push(name);
                }
            }
            pos = start + tag_end;
        } else {
            break;
        }
    }

    json!({
        "activities": activities,
        "services": services,
        "receivers": receivers,
        "providers": providers
    })
}

/// 从文件加载第三方服务特征库
pub fn load_third_party_services_database(current_dir: &std::path::Path) -> Result<serde_json::Value, String> {
    let db_path = current_dir.join("prefile").join("third_party_services.json");

    if !db_path.exists() {
        return Err("第三方服务特征库文件不存在".to_string());
    }

    let content = fs::read_to_string(&db_path)
        .map_err(|e| format!("读取特征库文件失败: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("解析特征库JSON失败: {}", e))
}

/// 递归扫描包目录
pub fn scan_packages_recursive(base_path: &std::path::Path, current_path: &std::path::Path, packages: &mut HashSet<String>) {
    if let Ok(entries) = fs::read_dir(current_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(relative) = path.strip_prefix(base_path) {
                    let pkg_path = relative.to_string_lossy().replace('\\', "/");
                    packages.insert(pkg_path);
                }
                scan_packages_recursive(base_path, &path, packages);
            }
        }
    }
}

/// 分析第三方服务
#[tauri::command]
pub async fn analyze_third_party_services(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let jadx_path = apk_dir_path.join("jadx");
    let sources_path = jadx_path.join("sources");
    let cache_path = apk_dir_path.join("third_party_services.json");

    // 检查缓存
    if cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<serde_json::Value>(&cache_content) {
                return Ok(cached_data);
            }
        }
    }

    if !sources_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "源码目录不存在，请先反编译APK"
        }));
    }

    let database = load_third_party_services_database(&current_dir)?;

    let mut found_packages: HashSet<String> = HashSet::new();
    scan_packages_recursive(&sources_path, &sources_path, &mut found_packages);

    let mut packers: Vec<serde_json::Value> = Vec::new();
    let mut sdks: Vec<serde_json::Value> = Vec::new();
    let mut forensics: Vec<serde_json::Value> = Vec::new();
    let mut libraries: Vec<serde_json::Value> = Vec::new();
    let mut matched_names: HashSet<String> = HashSet::new();

    // 匹配打包服务商
    if let Some(packer_list) = database["packers"].as_array() {
        for packer in packer_list {
            if let Some(pkg) = packer["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = packer["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("packer_{}", name)) {
                            matched_names.insert(format!("packer_{}", name));
                            packers.push(packer.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    // 匹配SDK服务商
    if let Some(sdk_list) = database["sdks"].as_array() {
        for sdk in sdk_list {
            if let Some(pkg) = sdk["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = sdk["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("sdk_{}", name)) {
                            matched_names.insert(format!("sdk_{}", name));
                            sdks.push(sdk.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    // 匹配调证值相关
    if let Some(forensic_list) = database["forensics"].as_array() {
        for forensic in forensic_list {
            if let Some(pkg) = forensic["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = forensic["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("forensic_{}", name)) {
                            matched_names.insert(format!("forensic_{}", name));
                            forensics.push(forensic.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    // 匹配第三方库
    if let Some(lib_list) = database["libraries"].as_array() {
        for lib in lib_list {
            if let Some(pkg) = lib["package"].as_str() {
                let pkg_path = pkg.replace('.', "/");
                for found_pkg in &found_packages {
                    if found_pkg.starts_with(&pkg_path) || found_pkg.contains(&pkg_path) {
                        let name = lib["name"].as_str().unwrap_or("未知").to_string();
                        if !matched_names.contains(&format!("lib_{}", name)) {
                            matched_names.insert(format!("lib_{}", name));
                            libraries.push(lib.clone());
                        }
                        break;
                    }
                }
            }
        }
    }

    let result = json!({
        "success": true,
        "packers": packers,
        "sdks": sdks,
        "forensics": forensics,
        "libraries": libraries,
        "summary": {
            "packersCount": packers.len(),
            "sdksCount": sdks.len(),
            "forensicsCount": forensics.len(),
            "librariesCount": libraries.len()
        }
    });

    // 保存缓存
    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        let _ = fs::write(&cache_path, &json_str);
    }

    Ok(result)
}

/// 解析apksigner输出
pub fn parse_apksigner_output(output: &str) -> serde_json::Value {
    let mut result = json!({
        "verified": false,
        "signatureSchemes": [],
        "signers": []
    });

    let lines: Vec<&str> = output.lines().collect();
    let mut signers: HashMap<usize, serde_json::Map<String, serde_json::Value>> = HashMap::new();

    for line in &lines {
        let line = line.trim();

        if line == "Verifies" {
            result["verified"] = json!(true);
        }

        if line.starts_with("Verified using v1 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v1 (JAR signing)"));
            }
        }
        if line.starts_with("Verified using v2 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v2 (APK Signature Scheme v2)"));
            }
        }
        if line.starts_with("Verified using v3 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v3 (APK Signature Scheme v3)"));
            }
        }
        if line.starts_with("Verified using v3.1 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v3.1 (APK Signature Scheme v3.1)"));
            }
        }
        if line.starts_with("Verified using v4 scheme") && line.contains("true") {
            if let Some(schemes) = result["signatureSchemes"].as_array_mut() {
                schemes.push(json!("v4 (APK Signature Scheme v4)"));
            }
        }

        if line.starts_with("Signer #") {
            if let Some(num_end) = line[8..].find(' ') {
                if let Ok(signer_num) = line[8..8+num_end].parse::<usize>() {
                    let signer = signers.entry(signer_num).or_insert_with(serde_json::Map::new);
                    let rest = &line[8+num_end..].trim();

                    if rest.starts_with("certificate DN:") {
                        signer.insert("dn".to_string(), json!(rest[15..].trim()));
                    } else if rest.starts_with("certificate SHA-256 digest:") {
                        signer.insert("sha256Digest".to_string(), json!(rest[27..].trim()));
                    } else if rest.starts_with("certificate SHA-1 digest:") {
                        signer.insert("sha1Digest".to_string(), json!(rest[25..].trim()));
                    } else if rest.starts_with("certificate MD5 digest:") {
                        signer.insert("md5Digest".to_string(), json!(rest[23..].trim()));
                    } else if rest.starts_with("key algorithm:") {
                        signer.insert("keyAlgorithm".to_string(), json!(rest[14..].trim()));
                    } else if rest.starts_with("key size (bits):") {
                        signer.insert("keySize".to_string(), json!(rest[16..].trim()));
                    } else if rest.starts_with("public key SHA-256 digest:") {
                        signer.insert("publicKeySha256".to_string(), json!(rest[26..].trim()));
                    } else if rest.starts_with("public key SHA-1 digest:") {
                        signer.insert("publicKeySha1".to_string(), json!(rest[24..].trim()));
                    } else if rest.starts_with("public key MD5 digest:") {
                        signer.insert("publicKeyMd5".to_string(), json!(rest[22..].trim()));
                    }
                }
            }
        }
    }

    let mut signer_nums: Vec<usize> = signers.keys().cloned().collect();
    signer_nums.sort();

    let signers_array: Vec<serde_json::Value> = signer_nums
        .into_iter()
        .map(|num| json!(signers.remove(&num).unwrap()))
        .collect();

    result["signers"] = json!(signers_array);
    result
}

/// 获取APK详细信息（哈希和签名）- 带缓存
#[tauri::command]
pub async fn get_apk_details(apk_dir: String) -> Result<serde_json::Value, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let apk_path = apk_dir_path.join("base.apk");
    let details_cache_path = apk_dir_path.join("details.json");

    if !apk_path.exists() {
        return Ok(json!({
            "success": false,
            "message": "APK文件不存在"
        }));
    }

    // 检查是否有缓存文件
    if details_cache_path.exists() {
        if let Ok(cache_content) = fs::read_to_string(&details_cache_path) {
            if let Ok(cached_data) = serde_json::from_str::<serde_json::Value>(&cache_content) {
                if let Some(components) = cached_data.get("components") {
                    let activities = components.get("activities").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    let services = components.get("services").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    let receivers = components.get("receivers").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    let providers = components.get("providers").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);

                    let total_components = activities + services + receivers + providers;

                    if total_components > 0 {
                        eprintln!("从缓存读取APK详细信息: {}", details_cache_path.display());
                        return Ok(cached_data);
                    }

                    let manifest_path = apk_dir_path.join("jadx/resources/AndroidManifest.xml");
                    if !manifest_path.exists() {
                        eprintln!("AndroidManifest.xml不存在，返回缓存: {}", details_cache_path.display());
                        return Ok(cached_data);
                    }

                    eprintln!("缓存的components为空但AndroidManifest.xml存在，重新分析: {}", details_cache_path.display());
                } else {
                    eprintln!("缓存缺少components字段，重新分析: {}", details_cache_path.display());
                }
            }
        }
    }

    let result = analyze_apk_details(&apk_path, &current_dir).await?;

    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        if let Err(e) = fs::write(&details_cache_path, &json_str) {
            eprintln!("保存详细信息缓存失败: {}", e);
        } else {
            eprintln!("已保存APK详细信息缓存: {}", details_cache_path.display());
        }
    }

    Ok(result)
}

/// 分析APK详细信息（内部函数）
pub async fn analyze_apk_details(apk_path: &std::path::Path, current_dir: &std::path::Path) -> Result<serde_json::Value, String> {
    let apk_path_clone = apk_path.to_path_buf();
    let hashes = tokio::task::spawn_blocking(move || {
        calculate_file_hashes(&apk_path_clone)
    }).await.map_err(|e| e.to_string())??;

    let (md5_hash, sha1_hash, sha256_hash) = hashes;

    let apksigner_exe = current_dir.join("apksigner\\apksigner.bat");
    let apk_path_for_sign = apk_path.to_path_buf();

    let signature_info = if apksigner_exe.exists() {
        let result = tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&apksigner_exe);
            cmd.arg("verify")
                .arg("--verbose")
                .arg("--print-certs")
                .arg(&apk_path_for_sign);

            #[cfg(target_os = "windows")]
            {
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }

            let output = cmd.output().map_err(|e| e.to_string())?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let output_text = format!("{}\n{}", stdout, stderr);

            eprintln!("apksigner输出:\n{}", output_text);

            Ok::<String, String>(output_text)
        }).await.map_err(|e| e.to_string())?;

        match result {
            Ok(output) => parse_apksigner_output(&output),
            Err(e) => json!({
                "error": e,
                "verified": false,
                "signatureSchemes": [],
                "signers": []
            })
        }
    } else {
        json!({
            "error": "apksigner工具不存在",
            "verified": false,
            "signatureSchemes": [],
            "signers": []
        })
    };

    let apk_dir = apk_path.parent().unwrap_or(std::path::Path::new(""));
    let manifest_path = apk_dir.join("jadx").join("resources").join("AndroidManifest.xml");

    let components = if manifest_path.exists() {
        if let Ok(manifest_content) = fs::read_to_string(&manifest_path) {
            parse_android_components(&manifest_content)
        } else {
            json!({
                "activities": [],
                "services": [],
                "receivers": [],
                "providers": []
            })
        }
    } else {
        json!({
            "activities": [],
            "services": [],
            "receivers": [],
            "providers": []
        })
    };

    Ok(json!({
        "success": true,
        "hashes": {
            "md5": md5_hash,
            "sha1": sha1_hash,
            "sha256": sha256_hash
        },
        "components": components,
        "signature": signature_info
    }))
}

/// 预分析APK详细信息（上传时调用，异步不阻塞）
#[tauri::command]
pub async fn preanalyze_apk_details(apk_dir: String) -> Result<String, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let apk_dir_path = current_dir.join(&apk_dir);
    let apk_path = apk_dir_path.join("base.apk");
    let details_cache_path = apk_dir_path.join("details.json");

    if details_cache_path.exists() {
        return Ok("cached".to_string());
    }

    if !apk_path.exists() {
        return Err("APK文件不存在".to_string());
    }

    eprintln!("开始预分析APK详细信息: {}", apk_path.display());

    let result = analyze_apk_details(&apk_path, &current_dir).await?;

    if let Ok(json_str) = serde_json::to_string_pretty(&result) {
        fs::write(&details_cache_path, &json_str)
            .map_err(|e| format!("保存缓存失败: {}", e))?;
        eprintln!("已保存APK详细信息缓存: {}", details_cache_path.display());
    }

    Ok("analyzed".to_string())
}
