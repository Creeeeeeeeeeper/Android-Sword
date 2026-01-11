/**
 * AI 模块 - 处理 AI 智能分析相关功能
 * 负责 AI 分析请求、结果展示、历史记录管理、提示词预设等
 */

window.AIModule = (function() {
    // Tauri API
    const { invoke } = window.__TAURI__.core;

    // DOM 元素
    let aiAnalysisBtn = null;
    let aiAnalysisPanel = null;
    let aiPanelClose = null;
    let aiStatus = null;
    let aiResult = null;
    let aiReanalyzeBtn = null;
    let aiHistoryBtn = null;
    let aiContextMenu = null;

    // 状态
    let currentFilePath = null;
    let currentSourceCode = null;
    let currentProvider = 'claude_code';
    let currentPrompt = null;
    let currentPromptName = null; // 当前使用的提示词名称
    let filePromptOverrides = {}; // 记录每个文件使用的自定义提示词
    let caseNumber = '';
    let apkTimestamp = '';
    let getApkTimestamp = null; // 动态获取 timestamp 的函数
    let aiConfig = null;
    let isAnalyzing = false;

    // 调试：监听 filePromptOverrides 的变化
    console.log('[AI 模块] filePromptOverrides 初始化:', filePromptOverrides);

    /**
     * 初始化模块
     */
    function init(params) {
        caseNumber = params.caseNumber;

        // apkTimestamp 可以是字符串或函数
        if (typeof params.apkTimestamp === 'function') {
            // 保存函数引用，后续调用时动态获取
            getApkTimestamp = params.apkTimestamp;
        } else {
            apkTimestamp = params.apkTimestamp || '';
        }

        console.log('AI 模块初始化，caseNumber:', caseNumber);

        // 使用事件委托，监听整个 document
        document.addEventListener('click', function(e) {
            // AI 分析按钮点击
            if (e.target.id === 'jadx-ai-analysis-btn' || e.target.closest('#jadx-ai-analysis-btn')) {
                e.preventDefault();
                handleAIButtonClick(e);
            }
            // 关闭按钮
            else if (e.target.id === 'ai-panel-close' || e.target.closest('#ai-panel-close')) {
                closeAIPanel();
            }
            // 重新分析按钮
            else if (e.target.id === 'ai-reanalyze-btn' || e.target.closest('#ai-reanalyze-btn')) {
                handleReanalyze();
            }
            // 历史记录按钮
            else if (e.target.id === 'ai-history-btn' || e.target.closest('#ai-history-btn')) {
                handleShowHistory();
            }
            // 历史记录返回按钮
            else if (e.target.id === 'ai-history-back-btn' || e.target.closest('#ai-history-back-btn')) {
                handleHistoryBack();
            }
        });

        // 右键菜单事件委托
        document.addEventListener('contextmenu', function(e) {
            if (e.target.id === 'jadx-ai-analysis-btn' || e.target.closest('#jadx-ai-analysis-btn')) {
                e.preventDefault();
                handleAIButtonRightClick(e);
            }
        });

        // 点击其他地方关闭右键菜单
        document.addEventListener('click', () => {
            const menu = document.getElementById('ai-context-menu');
            if (menu) {
                menu.classList.add('hidden');
            }
        });

        // 加载 AI 配置
        loadAIConfig();

        console.log('AI 模块初始化完成（使用事件委托）');
    }

    /**
     * 加载 AI 配置
     */
    async function loadAIConfig() {
        try {
            aiConfig = await invoke('get_ai_config');
            currentProvider = aiConfig.default_provider || 'claude_code';
            console.log('AI 配置加载完成:', aiConfig);
        } catch (error) {
            console.warn('加载 AI 配置失败，使用默认配置:', error);
            // 使用默认配置
            aiConfig = {
                default_provider: 'claude_code',
                providers: {
                    claude_code: {
                        name: 'Claude Code',
                        enabled: true,
                        api_url: '',
                        api_key: '',
                        model: 'sonnet',
                        description: '本地安装的 Claude Code CLI'
                    },
                    moonshot_kimi: {
                        name: 'Moonshot Kimi',
                        enabled: false,
                        api_url: 'https://api.moonshot.cn/v1/chat/completions',
                        api_key: '',
                        model: 'moonshot-v1-8k',
                        description: '月之暗面 Kimi API'
                    },
                    deepseek: {
                        name: 'DeepSeek',
                        enabled: false,
                        api_url: 'https://api.deepseek.com/v1/chat/completions',
                        api_key: '',
                        model: 'deepseek-chat',
                        description: 'DeepSeek API'
                    },
                    openai: {
                        name: 'OpenAI',
                        enabled: false,
                        api_url: 'https://api.openai.com/v1/chat/completions',
                        api_key: '',
                        model: 'gpt-4',
                        description: 'OpenAI ChatGPT API'
                    },
                    zhipu: {
                        name: '智谱AI',
                        enabled: false,
                        api_url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
                        api_key: '',
                        model: 'glm-4',
                        description: '智谱AI ChatGLM API'
                    }
                }
            };
            currentProvider = 'claude_code';
        }
    }

    /**
     * AI 按钮点击事件 - 使用默认提供商分析
     */
    async function handleAIButtonClick(e) {
        e.preventDefault();
        console.log('AI 分析按钮被点击');

        // 获取当前源码
        const sourceCode = getCurrentSourceCode();
        console.log('当前源码:', sourceCode);

        if (!sourceCode || !sourceCode.filePath || !sourceCode.content) {
            console.warn('没有可分析的源码');
            showToast('请先选择要分析的源文件', 'warning');
            return;
        }

        currentFilePath = sourceCode.filePath;
        currentSourceCode = sourceCode.content;

        console.log('文件路径:', currentFilePath);
        console.log('源码长度:', currentSourceCode.length);

        // 打开面板并显示加载状态
        openAIPanel();
        showLoadingStatus(currentProvider);

        // 检查是否有缓存
        const hasCache = await checkCache(currentFilePath, currentProvider);
        if (hasCache) {
            console.log('找到缓存，直接显示');
            showAIResult(hasCache);
            return;
        }

        // 开始分析
        console.log('开始 AI 分析...');
        startAnalysis(currentProvider);
    }

    /**
     * AI 按钮右键点击事件 - 显示菜单
     */
    function handleAIButtonRightClick(e) {
        e.preventDefault();

        // 获取当前源码信息（确保 currentFilePath 是最新的）
        const sourceCode = getCurrentSourceCode();
        console.log('[右键点击] 获取当前源码:', sourceCode);

        if (!sourceCode || !sourceCode.filePath || !sourceCode.content) {
            console.warn('[右键点击] 没有可用的源码');
            showToast('请先选择要分析的源文件', 'warning');
            return;
        }

        // 更新当前文件信息
        currentFilePath = sourceCode.filePath;
        currentSourceCode = sourceCode.content;

        console.log('[右键点击] 已设置当前文件路径:', currentFilePath);

        // 显示右键菜单
        showContextMenu(e.clientX, e.clientY);
    }

    /**
     * 显示右键菜单
     */
    function showContextMenu(x, y) {
        if (!aiContextMenu) {
            aiContextMenu = document.getElementById('ai-context-menu');
        }
        if (!aiContextMenu) {
            console.error('找不到 ai-context-menu 元素！');
            return;
        }

        // 设置菜单位置
        aiContextMenu.style.left = x + 'px';
        aiContextMenu.style.top = y + 'px';
        aiContextMenu.classList.remove('hidden');

        // 更新当前提示词显示
        const currentPromptNameElem = document.getElementById('current-prompt-name');
        if (currentPromptNameElem) {
            let displayPromptName;
            if (currentFilePath && filePromptOverrides[currentFilePath]) {
                displayPromptName = filePromptOverrides[currentFilePath];
                console.log('[右键菜单] 当前文件使用自定义提示词:', displayPromptName);
            } else {
                displayPromptName = getDefaultPromptName();
                console.log('[右键菜单] 当前文件使用默认提示词:', displayPromptName);
            }
            console.log('[右键菜单] 文件路径:', currentFilePath);
            console.log('[右键菜单] 映射表:', filePromptOverrides);
            currentPromptNameElem.textContent = displayPromptName;
        }

        // 清空并重新生成提供商列表
        const providersList = document.getElementById('ai-providers-list');

        if (providersList && aiConfig) {
            providersList.innerHTML = '';

            // 遍历所有提供商
            Object.entries(aiConfig.providers).forEach(([key, provider]) => {
                // 只显示已配置好的提供商
                let isConfigured = false;

                if (key === 'claude_code') {
                    // Claude Code 始终可用（如果启用）
                    isConfigured = provider.enabled !== false;
                } else if (key === 'moonshot_kimi' || key === 'deepseek' || key === 'openai' || key === 'zhipu') {
                    // Kimi、DeepSeek、OpenAI、智谱AI 需要有 API Key
                    isConfigured = provider.api_key && provider.api_key.trim() !== '';
                } else {
                    // 其他提供商根据 enabled 和 api_key 判断
                    isConfigured = provider.enabled && provider.api_key && provider.api_key.trim() !== '';
                }

                if (isConfigured) {
                    const item = document.createElement('div');
                    item.className = 'ai-provider-item';
                    if (key === currentProvider) {
                        item.classList.add('default');
                    }

                    // 显示提供商名称和模型
                    let displayText = provider.name || key;
                    if (key === 'claude_code') {
                        displayText = `Claude ${provider.model || 'Sonnet'}`;
                    } else if (key === 'moonshot_kimi') {
                        displayText = `Moonshot Kimi ${provider.model || 'v1-8k'}`;
                    } else if (key === 'deepseek') {
                        displayText = `DeepSeek ${provider.model || 'Chat'}`;
                    } else if (key === 'openai') {
                        displayText = `OpenAI ${provider.model || 'GPT-4'}`;
                    } else if (key === 'zhipu') {
                        displayText = `智谱AI ${provider.model || 'GLM-4'}`;
                    }

                    item.textContent = displayText;
                    item.addEventListener('click', () => {
                        selectProvider(key);
                        aiContextMenu.classList.add('hidden');
                    });
                    providersList.appendChild(item);
                }
            });

            // 如果没有可用的提供商，显示提示
            if (providersList.children.length === 0) {
                const hint = document.createElement('div');
                hint.className = 'ai-menu-hint';
                hint.textContent = '暂无可用的 AI 提供商，请先在设置中配置';
                providersList.appendChild(hint);
            }
        }

        // 绑定菜单项点击事件
        const menuItems = aiContextMenu.querySelectorAll('.ai-menu-item');
        menuItems.forEach(item => {
            const action = item.getAttribute('data-action');
            item.onclick = () => {
                handleMenuAction(action);
                aiContextMenu.classList.add('hidden');
            };
        });
    }

    /**
     * 获取默认提示词名称
     */
    function getDefaultPromptName() {
        if (!currentFilePath) {
            console.log('[getDefaultPromptName] 文件路径为空，返回 default_prompt');
            return 'default_prompt';
        }

        console.log('[getDefaultPromptName] 当前文件路径:', currentFilePath);

        // 先检查 resources（因为 resources 包含 sources 字符串）
        // 支持: resources/、/resources/、\resources\
        if (currentFilePath.includes('resources/') || currentFilePath.includes('resources\\') ||
            currentFilePath.includes('/resources/') || currentFilePath.includes('\\resources\\')) {
            console.log('[getDefaultPromptName] 检测到 resources 路径，返回 general_prompt');
            return 'general_prompt';
        }
        // 然后检查 sources（Java源码）
        // 支持: sources/、/sources/、\sources\
        else if (currentFilePath.includes('sources/') || currentFilePath.includes('sources\\') ||
                 currentFilePath.includes('/sources/') || currentFilePath.includes('\\sources\\')) {
            console.log('[getDefaultPromptName] 检测到 sources 路径，返回 default_prompt');
            return 'default_prompt';
        }
        // 其他情况
        else {
            console.log('[getDefaultPromptName] 其他路径，返回 general_prompt');
            return 'general_prompt';
        }
    }

    /**
     * 处理菜单操作
     */
    async function handleMenuAction(action) {
        switch (action) {
            case 'analyze':
                handleAIButtonClick(new Event('click'));
                break;
            case 'manage-presets':
                await managePresets();
                break;
        }
    }

    /**
     * 选择 AI 提供商
     */
    function selectProvider(providerKey) {
        currentProvider = providerKey;
        console.log('切换 AI 提供商:', providerKey);
    }

    /**
     * 获取当前源码内容（从 JADX 模块）
     */
    function getCurrentSourceCode() {
        // 检查 JADX 模块是否存在
        if (!window.JadxModule) {
            console.error('JADX 模块未加载');
            return null;
        }

        // 从 JADX 模块获取当前文件信息
        const filePath = window.JadxModule.getCurrentFilePath();
        const content = window.JadxModule.getCurrentFileContent();

        console.log('从 JADX 获取文件路径:', filePath);
        console.log('从 JADX 获取文件内容长度:', content ? content.length : 0);

        if (!filePath || !content) {
            return null;
        }

        return {
            filePath: filePath,
            content: content
        };
    }

    /**
     * 打开 AI 分析面板
     */
    function openAIPanel() {
        const panel = document.getElementById('ai-analysis-panel');
        if (panel) {
            panel.classList.remove('hidden');
        }
    }

    /**
     * 关闭 AI 分析面板
     */
    function closeAIPanel() {
        const panel = document.getElementById('ai-analysis-panel');
        if (panel) {
            panel.classList.add('hidden');
        }
    }

    /**
     * 检查是否有缓存
     */
    async function checkCache(filePath, provider) {
        try {
            const timestamp = getApkTimestamp ? getApkTimestamp() : apkTimestamp;
            const history = await invoke('get_ai_analysis_history', {
                caseNumber: caseNumber,
                apkTimestamp: String(timestamp), // 转换为字符串
                filePath: filePath
            });

            // 查找匹配的提供商的最新记录
            const matchedHistory = history.find(h => h.provider === provider);
            if (matchedHistory) {
                const content = await invoke('read_ai_analysis_cache', {
                    cachePath: matchedHistory.path
                });
                return content;
            }

            return null;
        } catch (error) {
            console.error('检查缓存失败:', error);
            return null;
        }
    }

    /**
     * 开始分析
     */
    async function startAnalysis(provider) {
        if (isAnalyzing) {
            showToast('正在分析中，请稍候...', 'info');
            return;
        }

        isAnalyzing = true;

        // 显示加载状态
        showLoadingStatus(provider);

        try {
            // 根据文件路径和自定义设置获取提示词
            let promptToUse = null;

            console.log('=== 开始分析 ===');
            console.log('当前文件路径:', currentFilePath);
            console.log('filePromptOverrides 映射:', filePromptOverrides);

            // 检查是否有自定义提示词
            if (currentFilePath && filePromptOverrides[currentFilePath]) {
                const customPromptName = filePromptOverrides[currentFilePath];
                console.log('找到自定义提示词映射:', customPromptName);

                try {
                    promptToUse = await invoke('get_prompt_preset', {
                        presetName: customPromptName
                    });
                    console.log('✓ 成功加载自定义提示词:', customPromptName);
                    console.log('提示词内容长度:', promptToUse.length);
                } catch (error) {
                    console.error('✗ 加载自定义提示词失败:', customPromptName, error);
                    showToast('加载提示词失败: ' + error, 'error');
                    isAnalyzing = false;
                    return;
                }
            } else {
                // 使用默认提示词
                console.log('============ 前端路径信息 ============');
                console.log('未找到自定义提示词，使用默认提示词');
                console.log('当前文件路径:', currentFilePath);
                console.log('路径长度:', currentFilePath.length);
                console.log('包含 "sources/":', currentFilePath.includes('sources/'));
                console.log('包含 "sources\\":', currentFilePath.includes('sources\\'));
                console.log('包含 "/sources/":', currentFilePath.includes('/sources/'));
                console.log('包含 "\\sources\\":', currentFilePath.includes('\\sources\\'));
                console.log('包含 "resources/":', currentFilePath.includes('resources/'));
                console.log('包含 "resources\\":', currentFilePath.includes('resources\\'));
                console.log('包含 "/resources/":', currentFilePath.includes('/resources/'));
                console.log('包含 "\\resources\\":', currentFilePath.includes('\\resources\\'));
                console.log('[后端调用] 传递给 get_prompt_for_file 的路径:', currentFilePath);
                console.log('========================================');
                promptToUse = await invoke('get_prompt_for_file', {
                    filePath: currentFilePath
                });
                console.log('[后端调用] 默认提示词加载完成，长度:', promptToUse.length);
            }

            currentPrompt = promptToUse;

            const timestamp = getApkTimestamp ? getApkTimestamp() : apkTimestamp;

            // 调用后端分析
            const response = await invoke('analyze_with_ai', {
                request: {
                    provider: provider,
                    file_path: currentFilePath,
                    source_code: currentSourceCode,
                    prompt: currentPrompt,
                    case_number: caseNumber,
                    apk_timestamp: String(timestamp) // 转换为字符串
                }
            });

            if (response.success) {
                // 读取分析结果
                const result = await invoke('read_ai_analysis_cache', {
                    cachePath: response.cache_path
                });
                showAIResult(result);
                showToast('AI 分析完成', 'success');
            } else {
                showError(response.message);
                showToast('AI 分析失败: ' + response.message, 'error');
            }
        } catch (error) {
            console.error('AI 分析失败:', error);
            showError(error.toString());
            showToast('AI 分析失败: ' + error, 'error');
        } finally {
            isAnalyzing = false;
        }
    }

    /**
     * 显示加载状态
     */
    function showLoadingStatus(provider = null) {
        const status = document.getElementById('ai-status');
        const result = document.getElementById('ai-result');

        console.log('[AI] 显示加载状态');
        if (status) {
            status.classList.remove('hidden');

            // 更新状态文本，显示具体使用的提供商和模型
            const statusText = status.querySelector('.ai-status-text');
            if (statusText && provider && aiConfig && aiConfig.providers[provider]) {
                const providerConfig = aiConfig.providers[provider];
                let displayName = '';

                if (provider === 'claude_code') {
                    displayName = `Claude ${providerConfig.model || 'Sonnet'}`;
                } else if (provider === 'moonshot_kimi') {
                    displayName = `Moonshot Kimi ${providerConfig.model || 'v1-8k'}`;
                } else if (provider === 'deepseek') {
                    displayName = `DeepSeek ${providerConfig.model || 'Chat'}`;
                } else if (provider === 'openai') {
                    displayName = `OpenAI ${providerConfig.model || 'GPT-4'}`;
                } else if (provider === 'zhipu') {
                    displayName = `智谱AI ${providerConfig.model || 'GLM-4'}`;
                } else {
                    displayName = providerConfig.name || provider;
                }

                statusText.textContent = `${displayName} 正在分析文件...`;
            }

            console.log('[AI] ai-status 已显示');
        }
        if (result) {
            result.classList.add('hidden');
            console.log('[AI] ai-result 已隐藏');
        }
    }

    /**
     * 显示 AI 分析结果
     */
    function showAIResult(markdown) {
        const status = document.getElementById('ai-status');
        const result = document.getElementById('ai-result');

        console.log('[AI] 显示分析结果');
        if (!result) {
            console.error('[AI] ai-result 元素不存在');
            return;
        }

        // 隐藏加载状态
        if (status) {
            status.classList.add('hidden');
            console.log('[AI] ai-status 已隐藏, classList:', Array.from(status.classList));
        }

        // 渲染 Markdown
        result.innerHTML = renderMarkdown(markdown);
        result.classList.remove('hidden');
        console.log('[AI] ai-result 已显示, classList:', Array.from(result.classList));
    }

    /**
     * 显示错误信息
     */
    function showError(message) {
        const status = document.getElementById('ai-status');
        const result = document.getElementById('ai-result');

        if (!result) return;

        if (status) {
            status.classList.add('hidden');
        }

        result.innerHTML = `
            <div style="color: #ff6b6b; padding: 20px; text-align: center;">
                <h3>❌ 分析失败</h3>
                <p>${message}</p>
            </div>
        `;
        result.classList.remove('hidden');
    }

    /**
     * 简单的 Markdown 渲染（使用 marked.js）
     */
    function renderMarkdown(markdown) {
        if (typeof marked !== 'undefined') {
            // 配置 marked.js
            marked.setOptions({
                gfm: true,  // 启用 GitHub Flavored Markdown
                tables: true,  // 启用表格支持
                breaks: true,  // 启用换行符转换
                pedantic: false,
                sanitize: false,
                smartLists: true,
                smartypants: false
            });

            return marked.parse(markdown);
        }

        // 降级：使用简单的正则替换
        return simpleMarkdownRender(markdown);
    }

    /**
     * 简单的 Markdown 渲染（降级方案）
     */
    function simpleMarkdownRender(markdown) {
        let html = markdown;

        // 标题
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // 粗体
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // 斜体
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // 代码块
        html = html.replace(/```(.*?)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

        // 行内代码
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 列表
        html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

        // 段落
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';

        return html;
    }

    /**
     * 重新分析
     */
    async function handleReanalyze() {
        if (!currentFilePath || !currentSourceCode) {
            showToast('没有可重新分析的文件', 'warning');
            return;
        }

        startAnalysis(currentProvider);
    }

    /**
     * 显示历史记录
     */
    async function handleShowHistory() {
        if (!currentFilePath) {
            showToast('请先选择一个文件', 'warning');
            return;
        }

        try {
            const timestamp = getApkTimestamp ? getApkTimestamp() : apkTimestamp;
            const history = await invoke('get_ai_analysis_history', {
                caseNumber: caseNumber,
                apkTimestamp: String(timestamp),
                filePath: currentFilePath
            });

            if (history.length === 0) {
                showToast('暂无历史记录', 'info');
                return;
            }

            console.log('历史记录:', history);

            // 显示历史记录面板
            showHistoryPanel(history);
        } catch (error) {
            console.error('获取历史记录失败:', error);
            showToast('获取历史记录失败: ' + error, 'error');
        }
    }

    /**
     * 显示历史记录面板
     */
    function showHistoryPanel(history) {
        const historyPanel = document.getElementById('ai-history-panel');
        const historyList = document.getElementById('ai-history-list');
        const resultDiv = document.getElementById('ai-result');

        if (!historyPanel || !historyList) return;

        // 清空列表
        historyList.innerHTML = '';

        // 添加历史记录项
        history.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'ai-history-item';

            // 格式化时间戳 (20260110_203408 -> 2026-01-10 20:34:08)
            const formattedTime = formatHistoryTimestamp(item.timestamp);

            itemDiv.innerHTML = `
                <div class="ai-history-item-header">
                    <span class="ai-history-item-provider">${item.provider}</span>
                    <span class="ai-history-item-time">${formattedTime}</span>
                </div>
            `;

            // 点击加载历史记录
            itemDiv.addEventListener('click', () => {
                loadHistoryItem(item);
            });

            historyList.appendChild(itemDiv);
        });

        // 隐藏结果，显示历史记录面板
        resultDiv.classList.add('hidden');
        historyPanel.classList.remove('hidden');
    }

    /**
     * 格式化历史记录时间戳
     */
    function formatHistoryTimestamp(timestamp) {
        // 输入格式: 20260110_203408
        // 输出格式: 2026-01-10 20:34:08
        if (!timestamp || timestamp.length < 15) return timestamp;

        const date = timestamp.substring(0, 8);
        const time = timestamp.substring(9, 15);

        const year = date.substring(0, 4);
        const month = date.substring(4, 6);
        const day = date.substring(6, 8);

        const hour = time.substring(0, 2);
        const minute = time.substring(2, 4);
        const second = time.substring(4, 6);

        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }

    /**
     * 加载历史记录项
     */
    async function loadHistoryItem(item) {
        try {
            showLoadingStatus();

            // 读取缓存文件
            const content = await invoke('read_ai_analysis_cache', {
                cachePath: item.path
            });

            // 显示结果
            showAIResult(content);

            // 隐藏历史记录面板，显示结果
            const historyPanel = document.getElementById('ai-history-panel');
            const resultDiv = document.getElementById('ai-result');

            if (historyPanel && resultDiv) {
                historyPanel.classList.add('hidden');
                resultDiv.classList.remove('hidden');
            }

            showToast('已加载历史记录', 'success');
        } catch (error) {
            console.error('加载历史记录失败:', error);
            showError('加载历史记录失败: ' + error);
            showToast('加载历史记录失败: ' + error, 'error');
        }
    }

    /**
     * 从历史记录返回到结果
     */
    function handleHistoryBack() {
        const historyPanel = document.getElementById('ai-history-panel');
        const resultDiv = document.getElementById('ai-result');

        if (historyPanel && resultDiv) {
            historyPanel.classList.add('hidden');
            resultDiv.classList.remove('hidden');
        }
    }

    /**
     * 管理预设
     */
    async function managePresets() {
        const modal = document.getElementById('manage-presets-modal');
        const presetsList = document.getElementById('presets-list');
        const nameInput = document.getElementById('preset-name-input');
        const contentEditor = document.getElementById('preset-content-editor');
        const editorFooter = document.getElementById('preset-editor-footer');
        const addBtn = document.getElementById('preset-add-btn');
        const closeBtn = document.getElementById('manage-presets-close');

        let currentPreset = null;
        let isNewPreset = false;
        let originalContent = ''; // 保存原始内容，用于检测是否有改动

        const DEFAULT_PRESETS = ['default_prompt', 'resource_prompt', 'general_prompt'];

        // 获取当前文件应该使用的提示词名称
        function getCurrentPromptName() {
            console.log('[getCurrentPromptName] 当前文件路径:', currentFilePath);
            console.log('[getCurrentPromptName] 映射表:', filePromptOverrides);

            if (currentFilePath && filePromptOverrides[currentFilePath]) {
                const customPrompt = filePromptOverrides[currentFilePath];
                console.log('[getCurrentPromptName] 返回自定义提示词:', customPrompt);
                return customPrompt;
            }

            const defaultPrompt = getDefaultPromptName();
            console.log('[getCurrentPromptName] 返回默认提示词:', defaultPrompt);
            return defaultPrompt;
        }

        // 渲染底部按钮
        function renderFooterButtons(isDefault, isNew, hasChanges = false) {
            editorFooter.innerHTML = '';

            if (isNew) {
                // 新建预设：显示保存按钮
                const saveBtn = document.createElement('button');
                saveBtn.className = 'modal-btn modal-btn-primary';
                saveBtn.id = 'preset-save-btn';
                saveBtn.textContent = '保存';
                saveBtn.onclick = handleSave;
                editorFooter.appendChild(saveBtn);
            } else if (!isDefault) {
                // 自定义预设：根据是否有改动决定是否显示保存按钮
                if (hasChanges) {
                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'modal-btn modal-btn-primary';
                    saveBtn.id = 'preset-save-btn';
                    saveBtn.textContent = '保存';
                    saveBtn.onclick = handleSave;
                    editorFooter.appendChild(saveBtn);
                }

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'modal-btn modal-btn-danger';
                deleteBtn.textContent = '删除';
                deleteBtn.onclick = handleDelete;
                editorFooter.appendChild(deleteBtn);
            }
            // 默认预设不显示任何按钮
        }

        // 加载预设列表
        async function loadPresets() {
            try {
                console.log('[loadPresets] 开始加载预设列表');
                const presets = await invoke('list_prompt_presets');
                presetsList.innerHTML = '';

                if (presets.length === 0) {
                    presetsList.innerHTML = '<div class="presets-placeholder">暂无预设</div>';
                    return;
                }

                const currentPromptName = getCurrentPromptName();
                console.log('[loadPresets] 当前应该使用的提示词:', currentPromptName);

                presets.forEach(preset => {
                    const item = document.createElement('div');
                    item.className = 'preset-item';

                    // 存储真实的预设名称作为 data 属性
                    item.setAttribute('data-preset-name', preset);

                    // 标记默认预设
                    if (DEFAULT_PRESETS.includes(preset)) {
                        item.classList.add('default-preset');
                    }

                    // 高亮当前使用的提示词
                    if (preset === currentPromptName) {
                        item.classList.add('current-using');
                    }

                    item.textContent = preset;
                    item.onclick = () => selectPreset(preset);
                    presetsList.appendChild(item);
                });

                // 自动选中当前使用的提示词
                await selectPreset(currentPromptName);
            } catch (error) {
                console.error('加载预设列表失败:', error);
                presetsList.innerHTML = '<div class="presets-placeholder">加载失败</div>';
            }
        }

        // 选择预设
        async function selectPreset(presetName) {
            try {
                const content = await invoke('get_prompt_preset', {
                    presetName: presetName
                });

                currentPreset = presetName;
                nameInput.value = presetName;
                contentEditor.value = content;
                originalContent = content; // 保存原始内容
                isNewPreset = false;

                const isDefault = DEFAULT_PRESETS.includes(presetName);

                // 默认预设设为只读
                if (isDefault) {
                    nameInput.setAttribute('readonly', 'true');
                    contentEditor.setAttribute('readonly', 'true');
                } else {
                    nameInput.setAttribute('readonly', 'true');
                    contentEditor.removeAttribute('readonly');
                }

                // 渲染底部按钮（初始没有改动）
                renderFooterButtons(isDefault, false, false);

                // 更新选中状态 - 移除所有 active 和 current-using 类
                presetsList.querySelectorAll('.preset-item').forEach(item => {
                    item.classList.remove('active', 'current-using');
                });

                // 为当前选中的预设添加 active 和 current-using 类
                presetsList.querySelectorAll('.preset-item').forEach(item => {
                    // 使用 data-preset-name 属性进行匹配
                    const itemPresetName = item.getAttribute('data-preset-name');

                    if (itemPresetName === presetName) {
                        item.classList.add('active', 'current-using');
                        console.log('✓ 已将 CSS 高亮应用到:', itemPresetName);
                    }
                });

                // 点击预设后自动应用到当前文件
                if (currentFilePath) {
                    filePromptOverrides[currentFilePath] = presetName;
                    console.log('========================================');
                    console.log(`✓ 已将提示词 "${presetName}" 应用到当前文件`);
                    console.log('文件路径:', currentFilePath);
                    console.log('完整映射表:', JSON.stringify(filePromptOverrides, null, 2));
                    console.log('========================================');
                } else {
                    console.warn('⚠ 当前没有打开的文件，无法应用提示词');
                }
            } catch (error) {
                console.error('加载预设内容失败:', error);
                showToast('加载预设内容失败: ' + error, 'error');
            }
        }

        // 新建预设
        addBtn.onclick = () => {
            currentPreset = null;
            nameInput.value = '';
            nameInput.removeAttribute('readonly');
            contentEditor.value = '';
            contentEditor.removeAttribute('readonly');
            originalContent = ''; // 清空原始内容
            isNewPreset = true;

            // 渲染底部按钮
            renderFooterButtons(false, true, false);

            // 清除选中状态
            presetsList.querySelectorAll('.preset-item').forEach(item => {
                item.classList.remove('active');
            });
        };

        // 监听内容变化
        contentEditor.addEventListener('input', () => {
            const isDefault = DEFAULT_PRESETS.includes(currentPreset);
            if (!isDefault && !isNewPreset) {
                const hasChanges = contentEditor.value !== originalContent;
                renderFooterButtons(false, false, hasChanges);
            }
        });

        // 保存
        async function handleSave() {
            const name = nameInput.value.trim();
            const content = contentEditor.value;

            if (!name) {
                showToast('请输入预设名称', 'warning');
                nameInput.focus();
                return;
            }

            // 检查是否试图覆盖默认提示词
            if (DEFAULT_PRESETS.includes(name)) {
                showToast('不能使用默认提示词的名称', 'warning');
                return;
            }

            if (!content.trim()) {
                showToast('提示词内容不能为空', 'warning');
                return;
            }

            try {
                await invoke('save_prompt_preset', {
                    presetName: name,
                    content: content
                });

                showToast('预设保存成功', 'success');
                currentPreset = name;
                nameInput.setAttribute('readonly', 'true');
                originalContent = content; // 更新原始内容
                isNewPreset = false;

                // 隐藏保存按钮（因为已保存，没有改动）
                const isDefault = DEFAULT_PRESETS.includes(name);
                renderFooterButtons(isDefault, false, false);

                await loadPresets();

                // 选中刚保存的预设（会自动应用）
                await selectPreset(name);
            } catch (error) {
                console.error('保存预设失败:', error);
                showToast('保存预设失败: ' + error, 'error');
            }
        }

        // 删除
        async function handleDelete() {
            if (!currentPreset) {
                showToast('请先选择一个预设', 'warning');
                return;
            }

            if (DEFAULT_PRESETS.includes(currentPreset)) {
                showToast('默认提示词不能删除', 'warning');
                return;
            }

            // 先询问，再删除
            if (!confirm(`确定要删除预设 "${currentPreset}" 吗？此操作不可撤销。`)) {
                return;
            }

            try {
                // 删除文件
                await invoke('delete_file', {
                    filename: `prefile/ai_prompt/${currentPreset}.txt`
                });

                showToast('预设已删除', 'success');

                // 清空编辑器
                currentPreset = null;
                nameInput.value = '';
                contentEditor.value = '';
                editorFooter.innerHTML = '';

                // 重新加载预设列表
                await loadPresets();
            } catch (error) {
                console.error('删除预设失败:', error);
                showToast('删除预设失败: ' + error, 'error');
            }
        }

        // 关闭
        closeBtn.onclick = () => {
            modal.classList.add('hidden');
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        };

        // 显示模态框并加载预设
        modal.classList.remove('hidden');
        await loadPresets();
    }

    /**
     * 显示提示消息
     */
    function showToast(message, type = 'info') {
        // 使用全局 toast 函数（如果存在）
        if (window.toast && window.toast.show) {
            window.toast.show({
                text: message,
                color: type,
                duration: 3000
            });
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * AI 面板大小调整功能
     */
    let isResizingAIPanel = false;

    function handleAIPanelResizerMousedown(e) {
        isResizingAIPanel = true;
        const aiPanel = document.getElementById('ai-analysis-panel');
        const resizer = document.getElementById('ai-panel-resizer');

        if (resizer) {
            resizer.classList.add('active');
        }

        document.addEventListener('mousemove', handleAIPanelResize);
        document.addEventListener('mouseup', stopAIPanelResize);
        e.preventDefault();
    }

    function handleAIPanelResize(e) {
        if (!isResizingAIPanel) return;

        const aiPanel = document.getElementById('ai-analysis-panel');
        if (!aiPanel) return;

        const containerRect = aiPanel.parentElement.getBoundingClientRect();
        const newWidth = containerRect.right - e.clientX;

        // 限制最小和最大宽度
        if (newWidth >= 400 && newWidth <= 1000) {
            aiPanel.style.width = newWidth + 'px';
        }
    }

    function stopAIPanelResize() {
        isResizingAIPanel = false;
        const resizer = document.getElementById('ai-panel-resizer');

        if (resizer) {
            resizer.classList.remove('active');
        }

        document.removeEventListener('mousemove', handleAIPanelResize);
        document.removeEventListener('mouseup', stopAIPanelResize);
    }

    // 绑定调整大小事件（在 DOM 加载后）
    setTimeout(() => {
        const resizer = document.getElementById('ai-panel-resizer');
        if (resizer) {
            resizer.addEventListener('mousedown', handleAIPanelResizerMousedown);
        }
    }, 100);

    /**
     * 检查文件是否有AI分析历史
     * @param {string} filePath - 文件路径
     * @returns {Promise<boolean>} 是否有历史记录
     */
    async function hasAIHistory(filePath) {
        try {
            const timestamp = getApkTimestamp ? getApkTimestamp() : apkTimestamp;
            const history = await invoke('get_ai_analysis_history', {
                caseNumber: caseNumber,
                apkTimestamp: String(timestamp),
                filePath: filePath
            });
            return history && history.length > 0;
        } catch (error) {
            console.error('检查AI历史失败:', error);
            return false;
        }
    }

    // 暴露公共 API
    return {
        init: init,
        openPanel: openAIPanel,
        closePanel: closeAIPanel,
        hasAIHistory: hasAIHistory
    };
})();
