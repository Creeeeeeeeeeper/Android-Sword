/**
 * Frida Script Module - Frida脚本模块
 * 负责Frida脚本的加载、执行、输出管理等功能
 */
(function() {
    'use strict';

    // 依赖注入
    let invoke = null;
    let caseNumber = null;
    let toast = null;
    let escapeHtml = null;
    let getApkListData = null;
    let getSelectedApkIndex = null;

    // DOM元素引用
    let fridaScriptsList = null;
    let fridaSelectAllBtn = null;
    let fridaSelectedScripts = null;
    let fridaRunBtn = null;
    let fridaStopBtn = null;
    let fridaTargetSelect = null;
    let fridaDeviceApps = null;
    let fridaAppSelect = null;
    let fridaRefreshAppsBtn = null;
    let fridaSpawnMode = null;
    let fridaShowTime = null;
    let fridaSearchInput = null;
    let fridaClearBtn = null;
    let fridaExportBtn = null;
    let fridaOutput = null;
    let fridaResizer = null;
    let fridaLeft = null;

    // 添加脚本相关DOM元素
    let fridaAddScriptBtn = null;
    let fridaSaveDialog = null;
    let fridaSaveDialogClose = null;
    let fridaScriptPathDisplay = null;
    let fridaUseTempBtn = null;
    let fridaSavePermanentBtn = null;
    let fridaInfoDialog = null;
    let fridaInfoDialogClose = null;
    let fridaScriptNameInput = null;
    let fridaScriptIdInput = null;
    let fridaScriptDescInput = null;
    let fridaScriptCategorySelect = null;
    let fridaInfoCancelBtn = null;
    let fridaInfoSaveBtn = null;

    // Frida Server状态相关DOM元素
    let fridaServerIndicator = null;
    let fridaServerValue = null;
    let fridaModuleStartServer = null;
    let fridaModuleStopServer = null;

    // Frida状态
    let fridaState = {
        scripts: [],           // 所有脚本配置
        selectedScripts: [],   // 选中的脚本ID
        running: false,        // 是否正在运行
        processId: null,       // 当前运行的进程ID
        outputLines: [],       // 输出行缓存
        envReady: false,       // Frida环境是否就绪
        customScripts: [],     // 自定义临时脚本路径
        pendingScriptPath: null, // 待处理的脚本路径
        serverRunning: false   // Frida Server是否运行
    };

    // 输出轮询定时器
    let fridaOutputTimer = null;

    // 拖拽状态
    let isResizingFrida = false;

    /**
     * 初始化模块
     * @param {Object} deps - 依赖对象
     * @param {Function} deps.invoke - Tauri invoke函数
     * @param {string} deps.caseNumber - 案件编号
     * @param {Object} deps.toast - Toast提示对象
     * @param {Function} deps.escapeHtml - HTML转义函数
     * @param {Function} deps.getApkListData - 获取APK列表数据的函数
     * @param {Function} deps.getSelectedApkIndex - 获取当前选中APK索引的函数
     */
    function init(deps) {
        invoke = deps.invoke;
        caseNumber = deps.caseNumber;
        toast = deps.toast;
        escapeHtml = deps.escapeHtml;
        getApkListData = deps.getApkListData;
        getSelectedApkIndex = deps.getSelectedApkIndex;

        // 初始化DOM元素引用
        initDOMElements();

        // 绑定事件
        bindEvents();

        // 初始化时加载脚本列表
        loadFridaScripts();

        console.log('FridaModule initialized');
    }

    /**
     * 初始化DOM元素引用
     */
    function initDOMElements() {
        // 脚本列表相关
        fridaScriptsList = document.getElementById('frida-scripts-list');
        fridaSelectAllBtn = document.getElementById('frida-select-all-btn');
        fridaSelectedScripts = document.getElementById('frida-selected-scripts');
        fridaRunBtn = document.getElementById('frida-run-btn');
        fridaStopBtn = document.getElementById('frida-stop-btn');

        // 目标选择相关
        fridaTargetSelect = document.getElementById('frida-target-select');
        fridaDeviceApps = document.getElementById('frida-device-apps');
        fridaAppSelect = document.getElementById('frida-app-select');
        fridaRefreshAppsBtn = document.getElementById('frida-refresh-apps-btn');
        fridaSpawnMode = document.getElementById('frida-spawn-mode');

        // 输出相关
        fridaShowTime = document.getElementById('frida-show-time');
        fridaSearchInput = document.getElementById('frida-search-input');
        fridaClearBtn = document.getElementById('frida-clear-btn');
        fridaExportBtn = document.getElementById('frida-export-btn');
        fridaOutput = document.getElementById('frida-output');

        // 布局相关
        fridaResizer = document.getElementById('frida-resizer');
        fridaLeft = document.querySelector('.frida-left');

        // 添加脚本相关
        fridaAddScriptBtn = document.getElementById('frida-add-script-btn');
        fridaSaveDialog = document.getElementById('frida-save-dialog');
        fridaSaveDialogClose = document.getElementById('frida-save-dialog-close');
        fridaScriptPathDisplay = document.getElementById('frida-script-path-display');
        fridaUseTempBtn = document.getElementById('frida-use-temp-btn');
        fridaSavePermanentBtn = document.getElementById('frida-save-permanent-btn');
        fridaInfoDialog = document.getElementById('frida-info-dialog');
        fridaInfoDialogClose = document.getElementById('frida-info-dialog-close');
        fridaScriptNameInput = document.getElementById('frida-script-name');
        fridaScriptIdInput = document.getElementById('frida-script-id');
        fridaScriptDescInput = document.getElementById('frida-script-desc');
        fridaScriptCategorySelect = document.getElementById('frida-script-category');
        fridaInfoCancelBtn = document.getElementById('frida-info-cancel-btn');
        fridaInfoSaveBtn = document.getElementById('frida-info-save-btn');

        // Frida Server状态相关
        fridaServerIndicator = document.getElementById('frida-server-indicator');
        fridaServerValue = document.getElementById('frida-server-value');
        fridaModuleStartServer = document.getElementById('frida-module-start-server');
        fridaModuleStopServer = document.getElementById('frida-module-stop-server');
    }

    /**
     * 绑定事件监听器
     */
    function bindEvents() {
        // 全选/取消全选按钮
        if (fridaSelectAllBtn) {
            fridaSelectAllBtn.addEventListener('click', handleSelectAll);
        }

        // 目标选择切换
        if (fridaTargetSelect) {
            fridaTargetSelect.addEventListener('change', handleTargetChange);
        }

        // 刷新应用列表按钮
        if (fridaRefreshAppsBtn) {
            fridaRefreshAppsBtn.addEventListener('click', loadFridaDeviceApps);
        }

        // 应用选择变化
        if (fridaAppSelect) {
            fridaAppSelect.addEventListener('change', updateFridaButtons);
        }

        // 运行脚本按钮
        if (fridaRunBtn) {
            fridaRunBtn.addEventListener('click', handleRunScripts);
        }

        // 停止脚本按钮
        if (fridaStopBtn) {
            fridaStopBtn.addEventListener('click', handleStopScripts);
        }

        // 清空输出按钮
        if (fridaClearBtn) {
            fridaClearBtn.addEventListener('click', clearFridaOutput);
        }

        // 导出输出按钮
        if (fridaExportBtn) {
            fridaExportBtn.addEventListener('click', handleExportOutput);
        }

        // 搜索过滤输入
        if (fridaSearchInput) {
            fridaSearchInput.addEventListener('input', handleSearchFilter);
        }

        // 拖拽调整大小
        if (fridaResizer) {
            fridaResizer.addEventListener('mousedown', startFridaResize);
        }

        // Frida Server 启动按钮
        if (fridaModuleStartServer) {
            fridaModuleStartServer.addEventListener('click', handleStartServer);
        }

        // Frida Server 停止按钮
        if (fridaModuleStopServer) {
            fridaModuleStopServer.addEventListener('click', handleStopServer);
        }

        // 添加脚本按钮
        if (fridaAddScriptBtn) {
            fridaAddScriptBtn.addEventListener('click', handleAddScript);
        }

        // 保存对话框关闭按钮
        if (fridaSaveDialogClose) {
            fridaSaveDialogClose.addEventListener('click', closeSaveDialog);
        }

        // 仅本次使用按钮
        if (fridaUseTempBtn) {
            fridaUseTempBtn.addEventListener('click', handleUseTempScript);
        }

        // 保存到列表按钮
        if (fridaSavePermanentBtn) {
            fridaSavePermanentBtn.addEventListener('click', handleSavePermanent);
        }

        // 信息对话框关闭按钮
        if (fridaInfoDialogClose) {
            fridaInfoDialogClose.addEventListener('click', closeInfoDialog);
        }

        // 信息对话框取消按钮
        if (fridaInfoCancelBtn) {
            fridaInfoCancelBtn.addEventListener('click', closeInfoDialog);
        }

        // 信息对话框保存按钮
        if (fridaInfoSaveBtn) {
            fridaInfoSaveBtn.addEventListener('click', handleSaveScriptInfo);
        }
    }

    // ===================== 环境检测 =====================

    /**
     * 检查Frida脚本模块的环境状态
     * @returns {Promise<Object>} 环境状态结果
     */
    async function checkFridaScriptEnv() {
        try {
            const result = await invoke('check_frida_env');
            fridaState.envReady = result.ready;
            return result;
        } catch (error) {
            console.error('Check Frida env failed:', error);
            fridaState.envReady = false;
            return { ready: false };
        }
    }

    /**
     * 检查Frida Server状态（脚本模块专用）
     * @returns {Promise<boolean>} Server是否运行
     */
    async function checkFridaModuleServerStatus() {
        try {
            const result = await invoke('check_frida_server_status');
            updateFridaServerUI(result.running);
            return result.running;
        } catch (error) {
            console.error('Check Frida Server status failed:', error);
            updateFridaServerUI(false);
            return false;
        }
    }

    /**
     * 更新Frida Server UI状态
     * @param {boolean} running - 是否运行中
     */
    function updateFridaServerUI(running) {
        fridaState.serverRunning = running;
        if (!fridaServerIndicator || !fridaServerValue || !fridaModuleStartServer || !fridaModuleStopServer) {
            return;
        }

        if (running) {
            fridaServerIndicator.textContent = '🟢';
            fridaServerValue.textContent = 'Running';
            fridaServerValue.className = 'frida-server-value running';
            fridaModuleStartServer.style.display = 'none';
            fridaModuleStopServer.style.display = 'inline-block';
        } else {
            fridaServerIndicator.textContent = '🔴';
            fridaServerValue.textContent = 'Stopped';
            fridaServerValue.className = 'frida-server-value stopped';
            fridaModuleStartServer.style.display = 'inline-block';
            fridaModuleStopServer.style.display = 'none';
        }
    }

    // ===================== Frida Server管理 =====================

    /**
     * 处理启动Frida Server
     */
    async function handleStartServer() {
        if (!fridaModuleStartServer) return;

        fridaModuleStartServer.disabled = true;
        if (fridaServerIndicator) fridaServerIndicator.textContent = '🟡';
        if (fridaServerValue) {
            fridaServerValue.textContent = 'Starting...';
            fridaServerValue.className = 'frida-server-value loading';
        }

        try {
            const result = await invoke('start_frida_server');
            if (result.success) {
                toast.show({ text: 'Frida Server started', color: 'success', duration: 2000 });
                updateFridaServerUI(true);
            } else {
                toast.show({ text: `Start failed: ${result.message}`, color: 'error', duration: 3000 });
                updateFridaServerUI(false);
            }
        } catch (error) {
            toast.show({ text: `Start failed: ${error}`, color: 'error', duration: 3000 });
            updateFridaServerUI(false);
        } finally {
            fridaModuleStartServer.disabled = false;
        }
    }

    /**
     * 处理停止Frida Server
     */
    async function handleStopServer() {
        if (!fridaModuleStopServer) return;

        fridaModuleStopServer.disabled = true;
        if (fridaServerIndicator) fridaServerIndicator.textContent = '🟡';
        if (fridaServerValue) {
            fridaServerValue.textContent = 'Stopping...';
            fridaServerValue.className = 'frida-server-value loading';
        }

        try {
            const result = await invoke('stop_frida_server');
            if (result.success) {
                toast.show({ text: 'Frida Server stopped', color: 'success', duration: 2000 });
                updateFridaServerUI(false);
            } else {
                toast.show({ text: `Stop failed: ${result.message}`, color: 'error', duration: 3000 });
                // 重新检查状态
                await checkFridaModuleServerStatus();
            }
        } catch (error) {
            toast.show({ text: `Stop failed: ${error}`, color: 'error', duration: 3000 });
            await checkFridaModuleServerStatus();
        } finally {
            fridaModuleStopServer.disabled = false;
        }
    }

    // ===================== 脚本列表管理 =====================

    /**
     * 加载Frida脚本列表
     */
    async function loadFridaScripts() {
        if (!fridaScriptsList) return;

        fridaScriptsList.innerHTML = '<div class="frida-placeholder">Checking environment...</div>';

        // 先检查Frida环境
        const envResult = await checkFridaScriptEnv();

        if (!envResult.ready) {
            // 环境未就绪，显示初始化按钮
            fridaScriptsList.innerHTML = `
                <div class="frida-env-not-ready">
                    <div class="frida-env-icon">&#9888;</div>
                    <div class="frida-env-title">Frida Environment Not Initialized</div>
                    <div class="frida-env-desc">Need to install frida, frida-tools and other dependencies</div>
                    <button class="frida-init-env-btn" id="frida-init-env-btn">Initialize Frida Environment</button>
                </div>
            `;

            // 绑定初始化按钮事件
            const initBtn = document.getElementById('frida-init-env-btn');
            if (initBtn) {
                initBtn.addEventListener('click', handleInitEnv);
            }
            return;
        }

        // 环境就绪，检查Frida Server状态
        checkFridaModuleServerStatus();

        // 环境就绪，加载脚本列表
        if (fridaState.scripts.length > 0) {
            // 已加载过，直接渲染
            renderFridaScripts();
            return;
        }

        fridaScriptsList.innerHTML = '<div class="frida-placeholder">Loading scripts...</div>';

        try {
            const result = await invoke('get_frida_scripts');

            if (!result.success) {
                fridaScriptsList.innerHTML = `<div class="frida-placeholder">${result.message}</div>`;
                return;
            }

            fridaState.scripts = result.scripts;
            renderFridaScripts();
        } catch (error) {
            console.error('Load Frida scripts failed:', error);
            fridaScriptsList.innerHTML = `<div class="frida-placeholder">Load failed: ${error}</div>`;
        }
    }

    /**
     * 处理环境初始化
     */
    async function handleInitEnv() {
        const initBtn = document.getElementById('frida-init-env-btn');
        if (!initBtn) return;

        initBtn.disabled = true;
        initBtn.textContent = 'Initializing...';

        try {
            toast.show({ text: 'Initializing Frida environment, this may take a few minutes...', color: 'info', duration: 10000 });

            const result = await invoke('init_frida_env');

            if (result.success) {
                toast.show({ text: 'Frida environment initialized successfully!', color: 'success', duration: 3000 });
                // 重新加载脚本列表
                fridaState.scripts = [];
                await loadFridaScripts();
            }
        } catch (error) {
            toast.show({ text: `Initialization failed: ${error}`, color: 'error', duration: 5000 });
            initBtn.disabled = false;
            initBtn.textContent = 'Initialize Frida Environment';
        }
    }

    /**
     * 渲染脚本列表
     */
    function renderFridaScripts() {
        if (!fridaScriptsList) return;

        if (fridaState.scripts.length === 0) {
            fridaScriptsList.innerHTML = '<div class="frida-placeholder">No scripts available</div>';
            return;
        }

        fridaScriptsList.innerHTML = fridaState.scripts.map(script => {
            const isSelected = fridaState.selectedScripts.includes(script.id);
            return `
                <div class="frida-script-item ${isSelected ? 'selected' : ''}" data-id="${script.id}">
                    <input type="checkbox" class="frida-script-checkbox" ${isSelected ? 'checked' : ''}>
                    <div class="frida-script-info">
                        <div class="frida-script-name">${escapeHtml(script.name)}</div>
                        <div class="frida-script-desc">${escapeHtml(script.description)}</div>
                        <span class="frida-script-category">${escapeHtml(script.categoryName || script.category)}</span>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定点击事件
        fridaScriptsList.querySelectorAll('.frida-script-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const scriptId = item.dataset.id;
                const checkbox = item.querySelector('.frida-script-checkbox');

                // 如果点击的不是checkbox本身，切换选中状态
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                }

                toggleScriptSelection(scriptId, checkbox.checked);
            });
        });

        updateSelectedScriptsDisplay();
        updateFridaButtons();
    }

    /**
     * 切换脚本选中状态
     * @param {string} scriptId - 脚本ID
     * @param {boolean} selected - 是否选中
     */
    function toggleScriptSelection(scriptId, selected) {
        if (selected) {
            if (!fridaState.selectedScripts.includes(scriptId)) {
                fridaState.selectedScripts.push(scriptId);
            }
        } else {
            fridaState.selectedScripts = fridaState.selectedScripts.filter(id => id !== scriptId);
        }

        // 更新UI
        if (fridaScriptsList) {
            const item = fridaScriptsList.querySelector(`[data-id="${scriptId}"]`);
            if (item) {
                item.classList.toggle('selected', selected);
            }
        }

        updateSelectedScriptsDisplay();
        updateFridaButtons();
    }

    /**
     * 更新选中脚本显示
     */
    function updateSelectedScriptsDisplay() {
        if (!fridaSelectedScripts) return;

        const hasScripts = fridaState.selectedScripts.length > 0;
        const hasCustomScripts = fridaState.customScripts.length > 0;

        if (!hasScripts && !hasCustomScripts) {
            fridaSelectedScripts.innerHTML = '<span class="frida-selected-placeholder">Please select scripts to execute</span>';
            return;
        }

        let tagsHtml = '';

        // 先显示自定义脚本
        if (hasCustomScripts) {
            tagsHtml += fridaState.customScripts.map((scriptPath, index) => {
                const fileName = scriptPath.split(/[\\/]/).pop();
                return `
                    <span class="frida-selected-tag custom" data-custom-index="${index}" title="${escapeHtml(scriptPath)}">
                        <span class="tag-label">[Custom]</span>${escapeHtml(fileName)}
                        <span class="remove-tag" title="Remove">x</span>
                    </span>
                `;
            }).join('');
        }

        // 再显示普通脚本
        if (hasScripts) {
            tagsHtml += fridaState.selectedScripts.map(id => {
                const script = fridaState.scripts.find(s => s.id === id);
                if (!script) return '';
                return `
                    <span class="frida-selected-tag" data-id="${id}">
                        ${escapeHtml(script.name)}
                        <span class="remove-tag" title="Remove">x</span>
                    </span>
                `;
            }).join('');
        }

        fridaSelectedScripts.innerHTML = tagsHtml;

        // 绑定普通脚本移除事件
        fridaSelectedScripts.querySelectorAll('.frida-selected-tag:not(.custom) .remove-tag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.closest('.frida-selected-tag');
                const scriptId = tag.dataset.id;
                toggleScriptSelection(scriptId, false);

                // 更新左侧列表的checkbox
                if (fridaScriptsList) {
                    const checkbox = fridaScriptsList.querySelector(`[data-id="${scriptId}"] .frida-script-checkbox`);
                    if (checkbox) {
                        checkbox.checked = false;
                    }
                }
            });
        });

        // 绑定自定义脚本移除事件
        fridaSelectedScripts.querySelectorAll('.frida-selected-tag.custom .remove-tag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = btn.closest('.frida-selected-tag');
                const index = parseInt(tag.dataset.customIndex);
                fridaState.customScripts.splice(index, 1);
                updateSelectedScriptsDisplay();
                updateFridaButtons();
            });
        });
    }

    /**
     * 处理全选/取消全选
     */
    function handleSelectAll() {
        if (!fridaSelectAllBtn) return;

        const allSelected = fridaState.selectedScripts.length === fridaState.scripts.length;

        if (allSelected) {
            // 取消全选
            fridaState.selectedScripts = [];
            fridaSelectAllBtn.textContent = 'Select All';
        } else {
            // 全选
            fridaState.selectedScripts = fridaState.scripts.map(s => s.id);
            fridaSelectAllBtn.textContent = 'Deselect All';
        }

        // 更新所有checkbox
        if (fridaScriptsList) {
            fridaScriptsList.querySelectorAll('.frida-script-item').forEach(item => {
                const checkbox = item.querySelector('.frida-script-checkbox');
                checkbox.checked = !allSelected;
                item.classList.toggle('selected', !allSelected);
            });
        }

        updateSelectedScriptsDisplay();
        updateFridaButtons();
    }

    /**
     * 更新按钮状态
     */
    function updateFridaButtons() {
        if (!fridaRunBtn || !fridaStopBtn) return;

        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        const hasSelection = fridaState.selectedScripts.length > 0 || fridaState.customScripts.length > 0;
        const hasTarget = fridaTargetSelect && fridaTargetSelect.value === 'current' ?
            (selectedApkIndex >= 0 && apkListData[selectedApkIndex]?.packageName) :
            !!(fridaAppSelect && fridaAppSelect.value);

        fridaRunBtn.disabled = !hasSelection || !hasTarget || fridaState.running;
        fridaStopBtn.disabled = !fridaState.running;

        if (fridaState.running) {
            fridaRunBtn.classList.add('running');
            fridaRunBtn.textContent = 'Running...';
        } else {
            fridaRunBtn.classList.remove('running');
            fridaRunBtn.textContent = 'Run Scripts';
        }
    }

    // ===================== 目标选择 =====================

    /**
     * 处理目标选择切换
     */
    function handleTargetChange() {
        if (!fridaTargetSelect || !fridaDeviceApps) return;

        if (fridaTargetSelect.value === 'device') {
            fridaDeviceApps.style.display = 'flex';
            loadFridaDeviceApps();
        } else {
            fridaDeviceApps.style.display = 'none';
        }
        updateFridaButtons();
    }

    /**
     * 加载设备应用列表
     */
    async function loadFridaDeviceApps() {
        if (!fridaAppSelect) return;

        fridaAppSelect.innerHTML = '<option value="">Loading...</option>';
        fridaAppSelect.disabled = true;

        try {
            const result = await invoke('get_device_apps');

            fridaAppSelect.innerHTML = '<option value="">Select an app...</option>';
            if (result.success && result.apps) {
                result.apps.forEach(app => {
                    const option = document.createElement('option');
                    option.value = app.package;
                    option.textContent = `${app.name} (${app.package})`;
                    fridaAppSelect.appendChild(option);
                });
            }
            fridaAppSelect.disabled = false;
        } catch (error) {
            fridaAppSelect.innerHTML = '<option value="">Load failed</option>';
            console.error('Get device apps failed:', error);
        }
    }

    // ===================== 脚本执行 =====================

    /**
     * 处理运行脚本
     */
    async function handleRunScripts() {
        if (!fridaRunBtn || fridaRunBtn.disabled || fridaState.running) return;

        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        let packageName = '';
        if (fridaTargetSelect && fridaTargetSelect.value === 'current') {
            if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
                toast.show({ text: 'Please select an APK first', color: 'warning', duration: 2000 });
                return;
            }
            packageName = apkListData[selectedApkIndex].packageName;
            if (!packageName) {
                toast.show({ text: 'Cannot get APK package name', color: 'error', duration: 2000 });
                return;
            }
        } else {
            packageName = fridaAppSelect ? fridaAppSelect.value : '';
            if (!packageName) {
                toast.show({ text: 'Please select an app to inject', color: 'warning', duration: 2000 });
                return;
            }
        }

        // 获取选中的普通脚本文件名
        const scriptFiles = fridaState.selectedScripts.map(id => {
            const script = fridaState.scripts.find(s => s.id === id);
            return script ? script.filename : null;
        }).filter(Boolean);

        // 获取自定义脚本路径
        const customScriptPaths = [...fridaState.customScripts];

        if (scriptFiles.length === 0 && customScriptPaths.length === 0) {
            toast.show({ text: 'Please select scripts to execute', color: 'warning', duration: 2000 });
            return;
        }

        fridaState.running = true;
        updateFridaButtons();
        clearFridaOutput();
        appendFridaOutput('[*] Starting Frida...', 'info');
        appendFridaOutput(`[*] Target package: ${packageName}`, 'info');
        if (scriptFiles.length > 0) {
            appendFridaOutput(`[*] Scripts: ${scriptFiles.join(', ')}`, 'info');
        }
        if (customScriptPaths.length > 0) {
            appendFridaOutput(`[*] Custom scripts: ${customScriptPaths.length}`, 'info');
        }
        const spawnMode = fridaSpawnMode ? fridaSpawnMode.checked : false;
        appendFridaOutput(`[*] Spawn mode: ${spawnMode ? 'Yes' : 'No'}`, 'info');

        try {
            const result = await invoke('run_frida_scripts', {
                packageName: packageName,
                scripts: scriptFiles,
                customScripts: customScriptPaths,
                spawnMode: spawnMode
            });

            if (result.success) {
                fridaState.processId = result.processId;
                appendFridaOutput('[+] Frida started', 'success');

                // 开始轮询输出
                startFridaOutputPolling();
            } else {
                appendFridaOutput(`[-] Start failed: ${result.message}`, 'error');
                fridaState.running = false;
                updateFridaButtons();
            }
        } catch (error) {
            appendFridaOutput(`[-] Start failed: ${error}`, 'error');
            fridaState.running = false;
            updateFridaButtons();
        }
    }

    /**
     * 处理停止脚本
     */
    async function handleStopScripts() {
        if (!fridaState.running) return;

        appendFridaOutput('[*] Stopping Frida...', 'info');

        try {
            await invoke('stop_frida_scripts', { processId: fridaState.processId });
            appendFridaOutput('[+] Frida stopped', 'success');
        } catch (error) {
            appendFridaOutput(`[-] Stop failed: ${error}`, 'error');
        }

        stopFridaOutputPolling();
        fridaState.running = false;
        fridaState.processId = null;
        updateFridaButtons();
    }

    // ===================== 输出管理 =====================

    /**
     * 开始输出轮询
     */
    function startFridaOutputPolling() {
        stopFridaOutputPolling();
        fridaOutputTimer = setInterval(async () => {
            if (!fridaState.running || !fridaState.processId) {
                stopFridaOutputPolling();
                return;
            }

            try {
                const result = await invoke('get_frida_output', { processId: fridaState.processId });

                if (result.success && result.lines && result.lines.length > 0) {
                    result.lines.forEach(line => {
                        appendFridaOutput(line.content, line.type || 'info');
                    });
                }

                // 检查进程是否还在运行
                if (result.finished) {
                    appendFridaOutput('[*] Frida process ended', 'info');
                    stopFridaOutputPolling();
                    fridaState.running = false;
                    fridaState.processId = null;
                    updateFridaButtons();
                }
            } catch (error) {
                console.error('Get Frida output failed:', error);
            }
        }, 500);
    }

    /**
     * 停止输出轮询
     */
    function stopFridaOutputPolling() {
        if (fridaOutputTimer) {
            clearInterval(fridaOutputTimer);
            fridaOutputTimer = null;
        }
    }

    /**
     * 添加输出行
     * @param {string} text - 输出文本
     * @param {string} type - 输出类型 (info, success, error, warning)
     */
    function appendFridaOutput(text, type = 'info') {
        if (!fridaOutput) return;

        // 移除占位符
        const placeholder = fridaOutput.querySelector('.frida-output-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        const line = document.createElement('div');
        line.className = `frida-output-line ${type}`;

        // 添加时间戳
        if (fridaShowTime && fridaShowTime.checked) {
            const now = new Date();
            const timestamp = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + ' ' +
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0') + ':' +
                String(now.getSeconds()).padStart(2, '0') + '.' +
                String(now.getMilliseconds()).padStart(3, '0');
            line.innerHTML = `<span class="time">[${timestamp}]</span>${escapeHtml(text)}`;
        } else {
            line.textContent = text;
        }

        // 搜索高亮
        if (fridaSearchInput) {
            const searchText = fridaSearchInput.value.trim();
            if (searchText && text.toLowerCase().includes(searchText.toLowerCase())) {
                line.innerHTML = line.innerHTML.replace(
                    new RegExp(`(${escapeRegExpLocal(searchText)})`, 'gi'),
                    '<span class="highlight">$1</span>'
                );
            }
        }

        fridaOutput.appendChild(line);
        fridaState.outputLines.push({ text, type, timestamp: Date.now() });

        // 自动滚动到底部
        fridaOutput.scrollTop = fridaOutput.scrollHeight;
    }

    /**
     * 清空输出
     */
    function clearFridaOutput() {
        if (!fridaOutput) return;
        fridaOutput.innerHTML = '<div class="frida-output-placeholder">Frida script output will be displayed here...</div>';
        fridaState.outputLines = [];
    }

    /**
     * 处理导出输出
     */
    async function handleExportOutput() {
        if (fridaState.outputLines.length === 0) {
            toast.show({ text: 'No content to export', color: 'warning', duration: 2000 });
            return;
        }

        const content = fridaState.outputLines.map(line => {
            const date = new Date(line.timestamp);
            const timestamp = date.getFullYear() + '-' +
                String(date.getMonth() + 1).padStart(2, '0') + '-' +
                String(date.getDate()).padStart(2, '0') + ' ' +
                String(date.getHours()).padStart(2, '0') + ':' +
                String(date.getMinutes()).padStart(2, '0') + ':' +
                String(date.getSeconds()).padStart(2, '0') + '.' +
                String(date.getMilliseconds()).padStart(3, '0');
            return `[${timestamp}] ${line.text}`;
        }).join('\n');

        try {
            const filename = `frida_output_${Date.now()}.txt`;
            await invoke('save_frida_output', { filename, content });
            toast.show({ text: 'Export successful', color: 'success', duration: 2000 });
        } catch (error) {
            toast.show({ text: `Export failed: ${error}`, color: 'error', duration: 3000 });
        }
    }

    /**
     * 处理搜索过滤
     */
    function handleSearchFilter() {
        if (!fridaSearchInput || !fridaOutput) return;

        const searchText = fridaSearchInput.value.trim().toLowerCase();

        fridaOutput.querySelectorAll('.frida-output-line').forEach(line => {
            const text = (line.dataset.originalText || line.textContent).toLowerCase();
            if (!searchText || text.includes(searchText)) {
                line.style.display = '';
                // 高亮匹配文本或恢复原始文本
                const originalText = line.dataset.originalText || line.textContent;
                line.dataset.originalText = originalText;
                if (searchText) {
                    line.innerHTML = escapeHtml(originalText).replace(
                        new RegExp(`(${escapeRegExpLocal(searchText)})`, 'gi'),
                        '<span class="highlight">$1</span>'
                    );
                } else {
                    // 清空搜索时恢复原始文本
                    line.innerHTML = escapeHtml(originalText);
                }
            } else {
                line.style.display = 'none';
            }
        });
    }

    /**
     * 正则表达式转义（本地实现）
     * @param {string} string - 要转义的字符串
     * @returns {string} 转义后的字符串
     */
    function escapeRegExpLocal(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ===================== 添加自定义脚本 =====================

    /**
     * 处理添加脚本按钮点击
     */
    async function handleAddScript() {
        try {
            // 使用Tauri的文件选择对话框
            const { open } = window.__TAURI__.dialog;
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'JavaScript',
                    extensions: ['js']
                }]
            });

            if (selected) {
                // 保存待处理的脚本路径
                fridaState.pendingScriptPath = selected;
                // 显示路径
                if (fridaScriptPathDisplay) {
                    fridaScriptPathDisplay.textContent = selected;
                }
                // 显示保存确认对话框
                if (fridaSaveDialog) {
                    fridaSaveDialog.classList.remove('hidden');
                }
            }
        } catch (error) {
            console.error('Select file failed:', error);
            toast.show({ text: 'Select file failed: ' + error, color: 'error', duration: 3000 });
        }
    }

    /**
     * 关闭保存对话框
     */
    function closeSaveDialog() {
        if (fridaSaveDialog) {
            fridaSaveDialog.classList.add('hidden');
        }
        fridaState.pendingScriptPath = null;
    }

    /**
     * 处理仅本次使用
     */
    function handleUseTempScript() {
        if (fridaState.pendingScriptPath) {
            // 添加到自定义脚本列表
            fridaState.customScripts.push(fridaState.pendingScriptPath);
            updateSelectedScriptsDisplay();
            updateFridaButtons();
            toast.show({ text: 'Custom script added (temp only)', color: 'success', duration: 2000 });
        }
        closeSaveDialog();
    }

    /**
     * 处理保存到列表 - 显示信息填写对话框
     */
    function handleSavePermanent() {
        closeSaveDialog();
        // 清空表单
        if (fridaScriptNameInput) fridaScriptNameInput.value = '';
        if (fridaScriptIdInput) fridaScriptIdInput.value = '';
        if (fridaScriptDescInput) fridaScriptDescInput.value = '';
        if (fridaScriptCategorySelect) fridaScriptCategorySelect.value = 'other';
        // 显示信息填写对话框
        if (fridaInfoDialog) {
            fridaInfoDialog.classList.remove('hidden');
        }
    }

    /**
     * 关闭信息对话框
     */
    function closeInfoDialog() {
        if (fridaInfoDialog) {
            fridaInfoDialog.classList.add('hidden');
        }
        fridaState.pendingScriptPath = null;
    }

    /**
     * 处理保存脚本信息
     */
    async function handleSaveScriptInfo() {
        const name = fridaScriptNameInput ? fridaScriptNameInput.value.trim() : '';
        const id = fridaScriptIdInput ? fridaScriptIdInput.value.trim() : '';
        const description = fridaScriptDescInput ? fridaScriptDescInput.value.trim() : '';
        const category = fridaScriptCategorySelect ? fridaScriptCategorySelect.value : 'other';

        // 验证必填字段
        if (!name) {
            toast.show({ text: 'Please enter script name', color: 'warning', duration: 2000 });
            if (fridaScriptNameInput) fridaScriptNameInput.focus();
            return;
        }
        if (!id) {
            toast.show({ text: 'Please enter script ID', color: 'warning', duration: 2000 });
            if (fridaScriptIdInput) fridaScriptIdInput.focus();
            return;
        }
        // 验证ID格式（只允许英文、数字、下划线）
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(id)) {
            toast.show({ text: 'Script ID can only contain letters, numbers and underscores, must start with a letter', color: 'warning', duration: 3000 });
            if (fridaScriptIdInput) fridaScriptIdInput.focus();
            return;
        }

        // 检查ID是否已存在
        if (fridaState.scripts.some(s => s.id === id)) {
            toast.show({ text: 'Script ID already exists, please use another ID', color: 'warning', duration: 2000 });
            if (fridaScriptIdInput) fridaScriptIdInput.focus();
            return;
        }

        try {
            if (fridaInfoSaveBtn) {
                fridaInfoSaveBtn.disabled = true;
                fridaInfoSaveBtn.textContent = 'Saving...';
            }

            // 调用后端保存脚本
            const result = await invoke('save_frida_script', {
                sourcePath: fridaState.pendingScriptPath,
                scriptInfo: {
                    id: id,
                    name: name,
                    description: description || '',
                    category: category
                }
            });

            if (result.success) {
                toast.show({ text: 'Script saved to list', color: 'success', duration: 2000 });
                // 关闭对话框
                closeInfoDialog();
                // 重新加载脚本列表
                fridaState.scripts = [];
                await loadFridaScripts();
            } else {
                toast.show({ text: 'Save failed: ' + result.message, color: 'error', duration: 3000 });
            }
        } catch (error) {
            console.error('Save script failed:', error);
            toast.show({ text: 'Save failed: ' + error, color: 'error', duration: 3000 });
        } finally {
            if (fridaInfoSaveBtn) {
                fridaInfoSaveBtn.disabled = false;
                fridaInfoSaveBtn.textContent = 'Save Script';
            }
        }
    }

    // ===================== 拖拽调整大小 =====================

    /**
     * 开始拖拽调整大小
     */
    function startFridaResize() {
        isResizingFrida = true;
        if (fridaResizer) {
            fridaResizer.classList.add('active');
        }
        document.addEventListener('mousemove', handleFridaResize);
        document.addEventListener('mouseup', stopFridaResize);
    }

    /**
     * 处理拖拽调整大小
     * @param {MouseEvent} e - 鼠标事件
     */
    function handleFridaResize(e) {
        if (!isResizingFrida) return;
        const container = document.querySelector('.frida-container');
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 200 && newWidth <= 400 && fridaLeft) {
            fridaLeft.style.width = newWidth + 'px';
        }
    }

    /**
     * 停止拖拽调整大小
     */
    function stopFridaResize() {
        isResizingFrida = false;
        if (fridaResizer) {
            fridaResizer.classList.remove('active');
        }
        document.removeEventListener('mousemove', handleFridaResize);
        document.removeEventListener('mouseup', stopFridaResize);
    }

    // ===================== 公共API =====================

    /**
     * 获取Frida状态
     * @returns {Object} Frida状态对象
     */
    function getState() {
        return fridaState;
    }

    /**
     * 重置状态（用于切换APK时）
     */
    function resetSelection() {
        fridaState.selectedScripts = [];
        fridaState.customScripts = [];
        updateSelectedScriptsDisplay();
        updateFridaButtons();
    }

    // 暴露模块接口
    window.FridaModule = {
        init,
        loadFridaScripts,
        renderFridaScripts,
        toggleScriptSelection,
        updateSelectedScriptsDisplay,
        updateFridaButtons,
        loadFridaDeviceApps,
        startFridaOutputPolling,
        stopFridaOutputPolling,
        appendFridaOutput,
        clearFridaOutput,
        checkFridaScriptEnv,
        checkFridaModuleServerStatus,
        updateFridaServerUI,
        getState,
        resetSelection
    };

})();
