use std::fs;
use std::env;
use std::process::Command;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// AI 提供商配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIProviderConfig {
    pub name: String,
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub description: String,
}

/// AI 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    pub default_provider: String,
    pub providers: std::collections::HashMap<String, AIProviderConfig>,
}

/// AI 分析请求
#[derive(Debug, Deserialize)]
pub struct AIAnalysisRequest {
    pub provider: String,
    pub file_path: String,
    pub source_code: String,
    pub prompt: String,
    pub case_number: String,
    pub apk_timestamp: String,
}

/// AI 分析响应
#[derive(Debug, Serialize)]
pub struct AIAnalysisResponse {
    pub success: bool,
    pub message: String,
    pub cache_path: Option<String>,
}

/// 获取 AI 配置
#[tauri::command]
pub fn get_ai_config() -> Result<AIConfig, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let config_path = current_dir.join("prefile").join("ai_config.json");

    eprintln!("当前工作目录: {}", current_dir.display());
    eprintln!("AI配置文件路径: {}", config_path.display());
    eprintln!("文件是否存在: {}", config_path.exists());

    if !config_path.exists() {
        // 尝试创建默认配置
        eprintln!("AI 配置文件不存在，尝试创建默认配置...");

        let default_config = AIConfig {
            default_provider: "claude_code".to_string(),
            providers: {
                let mut providers = std::collections::HashMap::new();
                providers.insert("claude_code".to_string(), AIProviderConfig {
                    name: "Claude Code".to_string(),
                    enabled: true,
                    api_url: String::new(),
                    api_key: String::new(),
                    model: "sonnet".to_string(),
                    description: "本地安装的 Claude Code CLI".to_string(),
                });
                providers.insert("moonshot_kimi".to_string(), AIProviderConfig {
                    name: "Moonshot Kimi".to_string(),
                    enabled: false,
                    api_url: "https://api.moonshot.cn/v1/chat/completions".to_string(),
                    api_key: String::new(),
                    model: "moonshot-v1-8k".to_string(),
                    description: "月之暗面 Kimi API".to_string(),
                });
                providers.insert("deepseek".to_string(), AIProviderConfig {
                    name: "DeepSeek".to_string(),
                    enabled: false,
                    api_url: "https://api.deepseek.com/v1/chat/completions".to_string(),
                    api_key: String::new(),
                    model: "deepseek-chat".to_string(),
                    description: "DeepSeek API".to_string(),
                });
                providers.insert("openai".to_string(), AIProviderConfig {
                    name: "OpenAI".to_string(),
                    enabled: false,
                    api_url: "https://api.openai.com/v1/chat/completions".to_string(),
                    api_key: String::new(),
                    model: "gpt-4".to_string(),
                    description: "OpenAI ChatGPT API".to_string(),
                });
                providers.insert("zhipu".to_string(), AIProviderConfig {
                    name: "智谱AI".to_string(),
                    enabled: false,
                    api_url: "https://open.bigmodel.cn/api/paas/v4/chat/completions".to_string(),
                    api_key: String::new(),
                    model: "glm-4".to_string(),
                    description: "智谱AI ChatGLM API".to_string(),
                });
                providers
            }
        };

        // 尝试创建目录和文件
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let content = serde_json::to_string_pretty(&default_config).map_err(|e| e.to_string())?;
        fs::write(&config_path, content).map_err(|e| e.to_string())?;

        eprintln!("默认配置文件创建成功");
        return Ok(default_config);
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: AIConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(config)
}

/// 保存 AI 配置
#[tauri::command]
pub fn save_ai_config(config: AIConfig) -> Result<String, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let config_path = current_dir.join("prefile").join("ai_config.json");

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    Ok("保存成功".to_string())
}

/// 获取默认提示词
#[tauri::command]
pub fn get_default_prompt() -> Result<String, String> {
    get_prompt_for_file("".to_string())
}

/// 根据文件路径获取对应的提示词
#[tauri::command]
pub fn get_prompt_for_file(file_path: String) -> Result<String, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;

    // 先判断是否为 resources 目录下的文件（因为 resources 包含 sources 字符串）
    // 支持: resources/、/resources/、\resources\
    let is_resources_file = file_path.contains("/resources/") || file_path.contains("resources/") ||
                           file_path.contains("\\resources\\") || file_path.contains("resources\\");

    // 然后判断是否为 sources 目录下的文件
    // 支持: sources/、/sources/、\sources\
    let contains_forward_slash = file_path.contains("/sources/") || file_path.contains("sources/");
    let contains_backslash = file_path.contains("\\sources\\") || file_path.contains("sources\\");
    let is_sources_file = contains_forward_slash || contains_backslash;

    let prompt_filename = if is_resources_file {
        "general_prompt.txt"  // 资源文件分析
    } else if is_sources_file {
        "default_prompt.txt"  // Java/Kotlin 源码分析
    } else {
        "general_prompt.txt"  // 其他文件分析
    };

    let prompt_path = current_dir.join("prefile").join("ai_prompt").join(prompt_filename);

    eprintln!("============ 后端路径匹配调试 ============");
    eprintln!("文件路径: {}", file_path);
    eprintln!("文件路径长度: {}", file_path.len());
    eprintln!("包含 '/sources/': {}", contains_forward_slash);
    eprintln!("包含 '\\sources\\': {}", contains_backslash);
    eprintln!("是否为 sources 文件: {}", is_sources_file);
    eprintln!("是否为 resources 文件: {}", is_resources_file);
    eprintln!("选择的提示词文件名: {}", prompt_filename);
    eprintln!("提示词文件路径: {}", prompt_path.display());
    eprintln!("文件是否存在: {}", prompt_path.exists());
    eprintln!("==========================================");

    if !prompt_path.exists() {
        eprintln!("提示词文件不存在，创建默认内容...");

        // 创建目录
        if let Some(parent) = prompt_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // 根据类型创建对应的默认内容
        let default_content = if is_sources_file {
            create_default_sources_prompt()
        } else {
            create_default_general_prompt(&file_path)
        };

        fs::write(&prompt_path, &default_content).map_err(|e| e.to_string())?;
        eprintln!("提示词文件创建成功");
        return Ok(default_content);
    }

    // 读取提示词模板
    let mut prompt_template = fs::read_to_string(&prompt_path).map_err(|e| e.to_string())?;

    // 如果不是 sources 文件，替换文件路径占位符
    if !is_sources_file && prompt_template.contains("{file_path}") {
        prompt_template = prompt_template.replace("{file_path}", &file_path);
    }

    Ok(prompt_template)
}

/// 创建 sources 目录的默认提示词
fn create_default_sources_prompt() -> String {
    r#"你是一名专注于 Android 逆向工程与源码安全审计 的分析专家。
请对以下 jadx 反编译得到的源码类 / 文件进行系统性分析，并严格按照以下结构输出：

## 概览

该类的核心职责、设计目的与使用场景

是否属于抽象层、内部实现、工具类、UI 组件或 IPC 相关组件

## 三方库

列出涉及的第三方库或框架（如 SQLCipher、Material、Android Support 等）

若无明显三方库，请明确说明

## 敏感行为

请枚举所有可能影响安全、稳定性或数据完整性的行为，每一项必须包含：

- 行为描述
- 关键方法名
- 调用顺序（如 A → B → C）
- 关键参数及其安全含义

行为类型包括但不限于：

- 数据读取 / 更新 / 缓存
- 游标或状态移动
- 跨进程通信（CursorWindow / Binder / IPC）
- UI 状态变化与绘制
- 文件操作（删除 / 创建 / 访问）
- 异常抛出与状态校验

## 关键机制与实现特性

- 线程同步（synchronized / 锁对象）
- 缓存或本地状态管理
- 状态机或条件判断逻辑
- API 版本兼容性处理

## 潜在风险点

- 数据不一致、越权访问、信息泄露
- IPC 或共享内存误用
- 资源泄漏、异常状态未正确处理
- 类型判断或转换风险

※ 仅基于代码事实分析，避免无依据推测

## 安全特点 / 防护措施（如有）

- 并发安全设计
- 状态校验、异常防护
- 内存泄漏防护（如 WeakReference）
- 资源释放与生命周期管理

---

**输出要求：**

- 使用专业、偏安全审计的技术语言
- 结构清晰，使用严格的 markdown 格式
- 内容应可直接用于 APK / SQLCipher / Android Framework 源码分析报告
- 若某一项不存在，请明确说明"未发现相关实现"
"#.to_string()
}

/// 创建通用文件（包括资源文件）的默认提示词
fn create_default_general_prompt(file_path: &str) -> String {
    format!(r#"你是一名专注于 Android 逆向工程与资源文件审计的分析专家。

以下代码/资源文件是 jadx 反编译得到的，文件路径为：**{file_path}**

请对该文件进行安全审计与代码分析，并按以下结构输出：

## 文件基本信息

- **文件类型**：（如 XML 配置、资源文件、Manifest、混淆代码等）
- **文件路径**：{file_path}
- **文件用途**：简要说明该文件在 APK 中的作用

## 内容概览

- 文件的主要配置项或代码逻辑
- 关键字段/属性及其含义
- 是否包含敏感信息（API Key、证书、密钥等）

## 安全审计要点

### 1. 敏感信息泄露
- 硬编码的密钥、Token、API Key
- 明文存储的凭证或密码
- 内部服务器地址、测试环境配置

### 2. 权限与组件导出
（仅适用于 AndroidManifest.xml）
- 声明的危险权限及其合理性
- 导出的组件（Activity、Service、Receiver、Provider）
- Intent Filter 配置是否存在越权风险

### 3. 网络安全配置
（仅适用于 network_security_config.xml）
- 是否允许明文传输
- 证书锁定配置
- 自定义 CA 信任设置

### 4. 资源混淆与代码保护
- 资源名称是否混淆
- 是否存在调试信息泄露
- ProGuard/R8 混淆规则分析

### 5. 其他风险点
- WebView 配置安全性
- 深层链接（Deep Link）配置风险
- 备份配置（allowBackup）
- 调试模式（debuggable）

## 潜在威胁与建议

- 列出发现的安全问题
- 提供修复建议或最佳实践

---

**输出要求：**

- 使用专业的安全审计语言
- 结构清晰，使用 markdown 格式
- 仅基于文件内容进行分析，避免无依据猜测
- 若某项不适用，请明确说明"不适用于该文件类型"
"#, file_path = file_path)
}

/// 列出所有提示词预设
#[tauri::command]
pub fn list_prompt_presets() -> Result<Vec<String>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let prompt_dir = current_dir.join("prefile").join("ai_prompt");

    if !prompt_dir.exists() {
        return Ok(Vec::new());
    }

    let mut presets = Vec::new();
    let entries = fs::read_dir(&prompt_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("txt") {
            if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                presets.push(name.to_string());
            }
        }
    }

    Ok(presets)
}

/// 获取提示词预设内容
#[tauri::command]
pub fn get_prompt_preset(preset_name: String) -> Result<String, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let prompt_path = current_dir
        .join("prefile")
        .join("ai_prompt")
        .join(format!("{}.txt", preset_name));

    if !prompt_path.exists() {
        return Err(format!("提示词预设 {} 不存在", preset_name));
    }

    fs::read_to_string(&prompt_path).map_err(|e| e.to_string())
}

/// 保存提示词预设
#[tauri::command]
pub fn save_prompt_preset(preset_name: String, content: String) -> Result<String, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let prompt_dir = current_dir.join("prefile").join("ai_prompt");

    // 确保目录存在
    fs::create_dir_all(&prompt_dir).map_err(|e| e.to_string())?;

    let prompt_path = prompt_dir.join(format!("{}.txt", preset_name));
    fs::write(&prompt_path, content).map_err(|e| e.to_string())?;

    Ok("保存成功".to_string())
}

/// 执行 AI 分析
#[tauri::command]
pub async fn analyze_with_ai(request: AIAnalysisRequest) -> Result<AIAnalysisResponse, String> {
    eprintln!("开始 AI 分析，提供商: {}", request.provider);

    // 创建缓存目录
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let cache_dir = current_dir
        .join("case")
        .join(&request.case_number)
        .join("apks")
        .join(&request.apk_timestamp)
        .join("ai_analysis");

    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    // 生成缓存文件名（使用文件路径的哈希 + 提供商名称）
    let file_hash = format!("{:x}", md5::compute(&request.file_path));
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let cache_filename = format!("{}_{}_{}_{}.md",
        file_hash,
        request.provider,
        timestamp,
        "analysis"
    );
    let cache_path = cache_dir.join(&cache_filename);

    // 根据提供商选择分析方法
    let config = get_ai_config()?;
    let result = match request.provider.as_str() {
        "claude_code" => {
            analyze_with_claude_code(
                &request.source_code,
                &request.prompt,
            )
            .await
        }
        "moonshot_kimi" => {
            if let Some(provider_config) = config.providers.get("moonshot_kimi") {
                analyze_with_moonshot_kimi(
                    &request.source_code,
                    &request.prompt,
                    provider_config,
                )
                .await
            } else {
                Err("Moonshot Kimi 配置不存在".to_string())
            }
        }
        "deepseek" => {
            if let Some(provider_config) = config.providers.get("deepseek") {
                analyze_with_deepseek(
                    &request.source_code,
                    &request.prompt,
                    provider_config,
                )
                .await
            } else {
                Err("DeepSeek 配置不存在".to_string())
            }
        }
        "openai" => {
            if let Some(provider_config) = config.providers.get("openai") {
                analyze_with_openai(
                    &request.source_code,
                    &request.prompt,
                    provider_config,
                )
                .await
            } else {
                Err("OpenAI 配置不存在".to_string())
            }
        }
        "zhipu" => {
            if let Some(provider_config) = config.providers.get("zhipu") {
                analyze_with_zhipu(
                    &request.source_code,
                    &request.prompt,
                    provider_config,
                )
                .await
            } else {
                Err("智谱AI 配置不存在".to_string())
            }
        }
        _ => Err(format!("不支持的 AI 提供商: {}", request.provider)),
    };

    match result {
        Ok(content) => {
            // 保存分析结果到缓存文件
            fs::write(&cache_path, &content).map_err(|e| e.to_string())?;

            Ok(AIAnalysisResponse {
                success: true,
                message: "分析完成".to_string(),
                cache_path: Some(cache_path.to_string_lossy().to_string()),
            })
        }
        Err(e) => {
            eprintln!("AI 分析失败: {}", e);
            Ok(AIAnalysisResponse {
                success: false,
                message: e,
                cache_path: None,
            })
        }
    }
}

/// 获取 AI 分析历史
#[tauri::command]
pub fn get_ai_analysis_history(
    case_number: String,
    apk_timestamp: String,
    file_path: String,
) -> Result<Vec<serde_json::Value>, String> {
    let current_dir = env::current_dir().map_err(|e| e.to_string())?;
    let cache_dir = current_dir
        .join("case")
        .join(&case_number)
        .join("apks")
        .join(&apk_timestamp)
        .join("ai_analysis");

    if !cache_dir.exists() {
        return Ok(Vec::new());
    }

    let file_hash = format!("{:x}", md5::compute(&file_path));
    let mut history = Vec::new();

    let entries = fs::read_dir(&cache_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
            if filename.starts_with(&file_hash) && filename.ends_with(".md") {
                // 解析文件名: {hash}_{provider}_{timestamp}_analysis.md
                // 移除 hash 前缀和 .md 后缀
                let without_ext = filename.strip_suffix(".md").unwrap_or(filename);
                let without_hash = without_ext.strip_prefix(&format!("{}_", file_hash))
                    .unwrap_or(without_ext);

                // 现在格式是: {provider}_{timestamp}_analysis
                // 从后往前找 _analysis，然后再往前找日期时间格式
                if let Some(analysis_pos) = without_hash.rfind("_analysis") {
                    let before_analysis = &without_hash[..analysis_pos];
                    // 查找倒数第二个下划线（日期和时间之间）
                    if let Some(time_pos) = before_analysis.rfind('_') {
                        let timestamp_start = &before_analysis[..time_pos];
                        // 查找倒数第三个下划线（provider 和日期之间）
                        if let Some(date_pos) = timestamp_start.rfind('_') {
                            let provider = timestamp_start[..date_pos].to_string();
                            let timestamp = before_analysis[date_pos + 1..].to_string();

                            if let Ok(metadata) = fs::metadata(&path) {
                                if let Ok(modified) = metadata.modified() {
                                    history.push(serde_json::json!({
                                        "provider": provider,
                                        "timestamp": timestamp,
                                        "path": path.to_string_lossy().to_string(),
                                        "modified": format!("{:?}", modified),
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 按时间排序（最新的在前）
    history.sort_by(|a, b| {
        let time_a = a["timestamp"].as_str().unwrap_or("");
        let time_b = b["timestamp"].as_str().unwrap_or("");
        time_b.cmp(time_a)
    });

    Ok(history)
}

/// 读取 AI 分析缓存
#[tauri::command]
pub fn read_ai_analysis_cache(cache_path: String) -> Result<String, String> {
    fs::read_to_string(&cache_path).map_err(|e| e.to_string())
}

/// 使用 Claude Code CLI 进行分析
async fn analyze_with_claude_code(
    source_code: &str,
    prompt: &str,
) -> Result<String, String> {
    // 在 Windows 上，使用 cmd.exe 来调用 claude 命令，确保能找到 .cmd 文件
    #[cfg(target_os = "windows")]
    let claude_cmd = "cmd";
    #[cfg(not(target_os = "windows"))]
    let claude_cmd = "claude";

    // 检查 claude 命令是否可用
    #[cfg(target_os = "windows")]
    let claude_check = {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("cmd")
            .args(&["/C", "claude", "--version"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let claude_check = Command::new("claude")
        .arg("--version")
        .output();

    if claude_check.is_err() {
        return Err("Claude Code 未安装或未在 PATH 中。请安装 Claude Code CLI。".to_string());
    }

    eprintln!("Claude Code 已找到，开始分析...");

    // 构造完整的输入内容
    let full_input = format!(
        "{}\n\n---\n\n以下是需要分析的源码：\n\n```java\n{}\n```",
        prompt, source_code
    );

    // 输出完整提示词到日志（用于调试）
    eprintln!("=== 完整提示词 ===");
    eprintln!("{}", full_input);
    eprintln!("=== 提示词结束 ===");
    eprintln!("提示词长度: {} 字符, 源码长度: {} 字符", prompt.len(), source_code.len());

    // 在后台线程中执行（避免阻塞）
    let result = tokio::task::spawn_blocking(move || {
        eprintln!("正在调用 claude 进行分析...");

        // 使用简单的系统提示，让 Claude 直接回答问题，不要额外的介绍
        let system_prompt = "直接回答用户的问题，不要做自我介绍，不要询问用户需要什么。";

        // 创建临时目录，在其中执行 claude 命令，避免读取项目上下文
        let temp_dir = std::env::temp_dir().join(format!("claude_analysis_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));

        if let Err(e) = std::fs::create_dir_all(&temp_dir) {
            eprintln!("创建临时目录失败: {}", e);
        }

        eprintln!("临时工作目录: {}", temp_dir.display());

        // 在临时目录中执行命令，通过 stdin 传递内容
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(&[
                "/C",
                "cd", temp_dir.to_str().unwrap(), "&&",
                "claude",
                "--system-prompt", system_prompt,
                "--append-system-prompt", "重要：不要分析用户的项目，只分析用户提供的代码片段。"
            ]);
            c.current_dir(&temp_dir);
            c.stdin(std::process::Stdio::piped());
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = Command::new("claude");
            c.arg("--system-prompt")
                .arg(system_prompt)
                .arg("--append-system-prompt")
                .arg("重要：不要分析用户的项目，只分析用户提供的代码片段。");
            c.current_dir(&temp_dir);
            c.stdin(std::process::Stdio::piped());
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c
        };

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // 启动进程
        let mut child = cmd.spawn()
            .map_err(|e| format!("启动 claude 进程失败: {}", e))?;

        // 通过 stdin 写入完整内容
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(full_input.as_bytes())
                .map_err(|e| format!("写入 stdin 失败: {}", e))?;
        }

        // 等待命令完成并获取输出
        let output = child.wait_with_output()
            .map_err(|e| format!("等待 claude 命令完成失败: {}", e))?;

        // 清理临时目录
        let _ = std::fs::remove_dir_all(&temp_dir);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Claude Code 分析失败: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut result = stdout.to_string();

        // 输出原始响应到日志（用于调试）
        eprintln!("=== Claude CLI 原始响应 ===");
        eprintln!("{}", result);
        eprintln!("=== 原始响应结束 ===");

        // 过滤掉 Claude CLI 的欢迎信息
        // 欢迎信息通常以特定格式开始，我们只保留实际回复内容
        // 查找第一个实质性的段落（通常在欢迎信息之后）
        if let Some(start_pos) = result.find("我可以看到") {
            // 从欢迎语开始删除
            if let Some(end_pos) = result[start_pos..].find("\n\n") {
                // 删除欢迎语段落
                result.replace_range(start_pos..start_pos + end_pos + 2, "");
            }
        }

        // 删除常见的欢迎提示
        let welcome_patterns = [
            "你好!我是一名专注于",
            "我可以帮助你:",
            "请告诉我你需要什么帮助",
            "我可以看到你正在开发",
        ];

        for pattern in &welcome_patterns {
            if let Some(pos) = result.find(pattern) {
                // 找到段落结束（连续两个换行）
                if let Some(end) = result[pos..].find("\n\n") {
                    result.replace_range(pos..pos + end + 2, "");
                }
            }
        }

        // 清理多余的空行
        while result.contains("\n\n\n") {
            result = result.replace("\n\n\n", "\n\n");
        }

        result = result.trim().to_string();

        eprintln!("=== 过滤后的响应 ===");
        eprintln!("{}", result);
        eprintln!("=== 过滤后响应结束 ===");
        eprintln!("Claude Code 分析完成，响应长度: {} 字符", result.len());

        Ok(result)
    })
    .await
    .map_err(|e| format!("异步任务失败: {}", e))??;

    Ok(result)
}

/// 使用 Moonshot Kimi API 进行分析
async fn analyze_with_moonshot_kimi(
    source_code: &str,
    prompt: &str,
    config: &AIProviderConfig,
) -> Result<String, String> {
    eprintln!("使用 Moonshot Kimi API 进行分析...");

    if config.api_key.is_empty() {
        return Err("Moonshot Kimi API Key 未配置".to_string());
    }

    // API 端点
    let api_url = if config.api_url.is_empty() {
        "https://api.moonshot.cn/v1/chat/completions"
    } else {
        &config.api_url
    };

    // 使用的模型
    let model = if config.model.is_empty() {
        "moonshot-v1-8k"
    } else {
        &config.model
    };

    // 构造完整的用户消息
    let user_message = format!(
        "{}\n\n---\n\n以下是需要分析的源码：\n\n```java\n{}\n```",
        prompt, source_code
    );

    eprintln!("API URL: {}", api_url);
    eprintln!("使用模型: {}", model);
    eprintln!("消息长度: {} 字符", user_message.len());

    // 构造请求体
    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是一名专业的 Android 逆向工程与源码安全审计专家。直接分析代码，不要做自我介绍。"
            },
            {
                "role": "user",
                "content": user_message
            }
        ],
        "temperature": 0.3,
        "max_tokens": 4000
    });

    // 发送 HTTP 请求
    let client = reqwest::Client::new();
    let response = client
        .post(api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    // 检查响应状态
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        eprintln!("API 错误响应: {}", error_text);
        return Err(format!("API 请求失败 ({}): {}", status, error_text));
    }

    // 解析响应
    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    eprintln!("API 响应: {}", serde_json::to_string_pretty(&response_json).unwrap_or_default());

    // 提取回复内容
    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法提取回复内容")?
        .to_string();

    eprintln!("Moonshot Kimi 分析完成，响应长度: {} 字符", content.len());

    Ok(content)
}

/// 使用 DeepSeek API 进行分析
async fn analyze_with_deepseek(
    source_code: &str,
    prompt: &str,
    config: &AIProviderConfig,
) -> Result<String, String> {
    eprintln!("使用 DeepSeek API 进行分析...");

    if config.api_key.is_empty() {
        return Err("DeepSeek API Key 未配置".to_string());
    }

    // API 端点
    let api_url = if config.api_url.is_empty() {
        "https://api.deepseek.com/v1/chat/completions"
    } else {
        &config.api_url
    };

    // 使用的模型
    let model = if config.model.is_empty() {
        "deepseek-chat"
    } else {
        &config.model
    };

    // 构造完整的用户消息
    let user_message = format!(
        "{}\n\n---\n\n以下是需要分析的源码：\n\n```java\n{}\n```",
        prompt, source_code
    );

    eprintln!("API URL: {}", api_url);
    eprintln!("使用模型: {}", model);
    eprintln!("消息长度: {} 字符", user_message.len());

    // 构造请求体
    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是一名专业的 Android 逆向工程与源码安全审计专家。直接分析代码，不要做自我介绍。"
            },
            {
                "role": "user",
                "content": user_message
            }
        ],
        "temperature": 0.3,
        "max_tokens": 4000
    });

    // 发送 HTTP 请求
    let client = reqwest::Client::new();
    let response = client
        .post(api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    // 检查响应状态
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        eprintln!("API 错误响应: {}", error_text);
        return Err(format!("API 请求失败 ({}): {}", status, error_text));
    }

    // 解析响应
    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    eprintln!("API 响应: {}", serde_json::to_string_pretty(&response_json).unwrap_or_default());

    // 提取回复内容
    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法提取回复内容")?
        .to_string();

    eprintln!("DeepSeek 分析完成，响应长度: {} 字符", content.len());

    Ok(content)
}

/// 使用 OpenAI API 进行分析
async fn analyze_with_openai(
    source_code: &str,
    prompt: &str,
    config: &AIProviderConfig,
) -> Result<String, String> {
    eprintln!("使用 OpenAI API 进行分析...");

    if config.api_key.is_empty() {
        return Err("OpenAI API Key 未配置".to_string());
    }

    // API 端点
    let api_url = if config.api_url.is_empty() {
        "https://api.openai.com/v1/chat/completions"
    } else {
        &config.api_url
    };

    // 使用的模型
    let model = if config.model.is_empty() {
        "gpt-4"
    } else {
        &config.model
    };

    // 构造完整的用户消息
    let user_message = format!(
        "{}\n\n---\n\n以下是需要分析的源码：\n\n```java\n{}\n```",
        prompt, source_code
    );

    eprintln!("API URL: {}", api_url);
    eprintln!("使用模型: {}", model);
    eprintln!("消息长度: {} 字符", user_message.len());

    // 构造请求体
    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是一名专业的 Android 逆向工程与源码安全审计专家。直接分析代码，不要做自我介绍。"
            },
            {
                "role": "user",
                "content": user_message
            }
        ],
        "temperature": 0.3,
        "max_tokens": 4000
    });

    // 发送 HTTP 请求
    let client = reqwest::Client::new();
    let response = client
        .post(api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    // 检查响应状态
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        eprintln!("API 错误响应: {}", error_text);
        return Err(format!("API 请求失败 ({}): {}", status, error_text));
    }

    // 解析响应
    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    eprintln!("API 响应: {}", serde_json::to_string_pretty(&response_json).unwrap_or_default());

    // 提取回复内容
    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法提取回复内容")?
        .to_string();

    eprintln!("OpenAI 分析完成，响应长度: {} 字符", content.len());

    Ok(content)
}

/// 使用 智谱AI API 进行分析
async fn analyze_with_zhipu(
    source_code: &str,
    prompt: &str,
    config: &AIProviderConfig,
) -> Result<String, String> {
    eprintln!("使用 智谱AI API 进行分析...");

    if config.api_key.is_empty() {
        return Err("智谱AI API Key 未配置".to_string());
    }

    // API 端点
    let api_url = if config.api_url.is_empty() {
        "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    } else {
        &config.api_url
    };

    // 使用的模型
    let model = if config.model.is_empty() {
        "glm-4"
    } else {
        &config.model
    };

    // 构造完整的用户消息
    let user_message = format!(
        "{}\n\n---\n\n以下是需要分析的源码：\n\n```java\n{}\n```",
        prompt, source_code
    );

    eprintln!("API URL: {}", api_url);
    eprintln!("使用模型: {}", model);
    eprintln!("消息长度: {} 字符", user_message.len());

    // 构造请求体
    let request_body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是一名专业的 Android 逆向工程与源码安全审计专家。直接分析代码，不要做自我介绍。"
            },
            {
                "role": "user",
                "content": user_message
            }
        ],
        "temperature": 0.3,
        "max_tokens": 4000
    });

    // 发送 HTTP 请求
    let client = reqwest::Client::new();
    let response = client
        .post(api_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    // 检查响应状态
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        eprintln!("API 错误响应: {}", error_text);
        return Err(format!("API 请求失败 ({}): {}", status, error_text));
    }

    // 解析响应
    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    eprintln!("API 响应: {}", serde_json::to_string_pretty(&response_json).unwrap_or_default());

    // 提取回复内容
    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法提取回复内容")?
        .to_string();

    eprintln!("智谱AI 分析完成，响应长度: {} 字符", content.len());

    Ok(content)
}

/// 检测 Claude Code 是否已安装
#[tauri::command]
pub fn check_claude_code_installed() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    let check_result = {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("cmd")
            .args(&["/C", "claude", "--version"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let check_result = Command::new("claude")
        .arg("--version")
        .output();

    match check_result {
        Ok(output) => {
            let is_installed = output.status.success();
            eprintln!("Claude Code 检测结果: {}", is_installed);
            if is_installed {
                let version = String::from_utf8_lossy(&output.stdout);
                eprintln!("Claude Code 版本: {}", version.trim());
            }
            Ok(is_installed)
        }
        Err(e) => {
            eprintln!("Claude Code 检测失败: {}", e);
            Ok(false)
        }
    }
}
