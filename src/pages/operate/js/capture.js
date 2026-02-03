/**
 * 网络抓包模块 - 处理Frida环境管理和网络数据包捕获
 * 负责Frida环境检测/初始化、Frida Server管理、网络抓包、数据包查看等功能
 * 支持多种抓包方式：r0capture(Hook抓包)、tcpdump(网络层抓包)
 * 支持辅助脚本：绕过检测、流量控制、行为拦截等
 */

window.CaptureModule = (function() {
    // 模块依赖（通过init注入）
    let invoke = null;
    let caseNumber = '';
    let toast = null;

    // 外部函数
    let escapeHtml = null;
    let formatFileSize = null;
    let getApkListData = null;
    let getSelectedApkIndex = null;

    // ========== 页面1：选择页面 DOM元素 ==========
    let captureSetupPage = null;
    let fridaEnvStatus = null;
    let fridaServerStatus = null;
    let initFridaBtn = null;
    let startServerBtn = null;
    let stopServerBtn = null;
    let captureTypeList = null;
    let captureTargetSelect = null;
    let captureDeviceApps = null;
    let deviceAppSelect = null;
    let refreshAppsBtn = null;
    let captureSpawnMode = null;
    let captureScriptsCategories = null;
    let addAuxScriptBtn = null;
    let captureHistoryBtn = null;
    let startCaptureMainBtn = null;
    let operationTabs = null;

    // ========== 页面2：抓包进行中 DOM元素 ==========
    let captureRunningPage = null;
    let captureBackBtn = null;
    let captureRunningType = null;
    let captureRunningTarget = null;
    let captureRunningStatus = null;
    let stopCaptureBtn = null;
    let packetsTitle = null;
    let packetsFilterInput = null;
    let capturePacketsBody = null;
    let capturePacketsPlaceholder = null;
    let capturePacketsTableWrapper = null;
    let packetDetailContent = null;
    let captureResizer = null;
    let capturePacketsLeft = null;

    // ========== 抓包记录弹出层 DOM元素 ==========
    let captureHistoryOverlay = null;
    let captureHistoryCloseBtn = null;
    let captureHistoryRefreshBtn = null;
    let captureHistoryTypeFilter = null;
    let captureHistorySessions = null;
    let captureHistoryPacketsTitle = null;
    let captureHistoryFilterInput = null;
    let captureHistoryExportBtn = null;
    let captureHistoryPacketsBody = null;
    let captureHistoryPacketsPlaceholder = null;
    let captureHistoryPacketDetailContent = null;
    let captureHistoryResizer = null;
    let captureHistoryVResizer = null;
    let captureHistoryPacketsTableWrapper = null;
    let captureHistoryPacketDetail = null;
    let captureHistoryRealtimeTabs = null;

    // ========== 对话框 DOM元素 ==========
    let auxScriptSaveDialog = null;
    let auxScriptInfoDialog = null;
    let captureBackConfirmDialog = null;

    // ========== 代理抓包 DOM元素 ==========
    let captureProxySettings = null;
    let proxyPortInput = null;
    let proxyLocalIp = null;
    let proxyCopyIpBtn = null;
    let proxyTipAddr = null;
    let proxyExportCertBtn = null;
    let proxyInstallCertBtn = null;
    // mitmproxy环境
    let proxyEnvStatus = null;
    let proxyEnvIcon = null;
    let proxyEnvValue = null;
    let proxyInstallMitmproxyBtn = null;

    // ========== 全流量抓包 DOM元素 ==========
    let captureRealtimeTarget = null;
    let realtimeTargetSelect = null;
    let realtimeDeviceApps = null;
    let realtimeAppSelect = null;
    let realtimeRefreshAppsBtn = null;
    let captureStatsBar = null;
    let httpPacketsWrapper = null;
    let realtimePacketsWrapper = null;
    let realtimePacketsBody = null;
    let statTotal = null;
    let statTcp = null;
    let statUdp = null;
    let statHttp = null;
    let statHttps = null;
    let statDns = null;

    // 抓包状态
    let captureState = {
        fridaReady: false,
        serverRunning: false,
        capturing: false,
        currentCaptureId: null,
        currentSessionId: null,
        selectedSessionId: null,
        packets: [],
        selectedPacketIndex: -1,
        autoRefreshTimer: null,
        // 新增状态
        captureType: 'realtime',         // 当前选择的抓包类型，默认全流量
        selectedAuxScripts: [],         // 选中的辅助脚本ID列表
        auxScripts: [],                 // 可用的辅助脚本列表
        tempAuxScript: null,            // 临时添加的脚本路径
        // 历史记录弹出层状态
        historySelectedSessionId: null,
        historySelectedSessionType: null, // 历史会话的抓包类型
        historyPackets: [],
        historySelectedPacketIndex: -1,
        // mitmproxy状态
        mitmproxyReady: false,
        // 全流量抓包状态
        realtimePackets: [],
        realtimeLastId: 0,
        realtimeFilter: 'all',
        deviceIp: ''
    };

    // 拖拽状态
    let isResizingCapture = false;

    /**
     * 初始化模块，注入依赖
     * @param {Object} deps - 依赖对象
     */
    function init(deps) {
        invoke = deps.invoke;
        caseNumber = deps.caseNumber;
        toast = deps.toast;

        // 外部函数
        escapeHtml = deps.escapeHtml;
        formatFileSize = deps.formatFileSize;
        getApkListData = deps.getApkListData;
        getSelectedApkIndex = deps.getSelectedApkIndex;

        // 初始化DOM元素
        initDOMElements();

        // 绑定事件
        bindEvents();
    }

    /**
     * 初始化DOM元素引用
     */
    function initDOMElements() {
        // ========== 页面1：选择页面 ==========
        captureSetupPage = document.getElementById('capture-setup-page');
        fridaEnvStatus = document.getElementById('frida-env-status');
        fridaServerStatus = document.getElementById('frida-server-status');
        initFridaBtn = document.getElementById('init-frida-btn');
        startServerBtn = document.getElementById('start-server-btn');
        stopServerBtn = document.getElementById('stop-server-btn');
        captureTypeList = document.querySelector('.capture-type-list');
        captureTargetSelect = document.getElementById('capture-target-select');
        captureDeviceApps = document.getElementById('capture-device-apps');
        deviceAppSelect = document.getElementById('device-app-select');
        refreshAppsBtn = document.getElementById('refresh-apps-btn');
        captureSpawnMode = document.getElementById('capture-spawn-mode');
        captureScriptsCategories = document.getElementById('capture-scripts-categories');
        addAuxScriptBtn = document.getElementById('add-aux-script-btn');
        captureHistoryBtn = document.getElementById('capture-history-btn');
        startCaptureMainBtn = document.getElementById('start-capture-main-btn');
        operationTabs = document.querySelectorAll('.operation-tab');

        // ========== 页面2：抓包进行中 ==========
        captureRunningPage = document.getElementById('capture-running-page');
        captureBackBtn = document.getElementById('capture-back-btn');
        captureRunningType = document.getElementById('capture-running-type');
        captureRunningTarget = document.getElementById('capture-running-target');
        captureRunningStatus = document.getElementById('capture-running-status');
        stopCaptureBtn = document.getElementById('stop-capture-btn');
        packetsTitle = document.getElementById('packets-title');
        packetsFilterInput = document.getElementById('packets-filter-input');
        capturePacketsBody = document.getElementById('capture-packets-body');
        capturePacketsPlaceholder = document.getElementById('capture-packets-placeholder');
        capturePacketsTableWrapper = document.querySelector('.capture-packets-table-wrapper');
        packetDetailContent = document.getElementById('packet-detail-content');
        captureResizer = document.getElementById('capture-resizer');
        capturePacketsLeft = document.querySelector('.capture-packets-left');

        // ========== 抓包记录弹出层 ==========
        captureHistoryOverlay = document.getElementById('capture-history-overlay');
        captureHistoryCloseBtn = document.getElementById('capture-history-close-btn');
        captureHistoryRefreshBtn = document.getElementById('capture-history-refresh-btn');
        captureHistoryTypeFilter = document.getElementById('capture-history-type-filter');
        captureHistorySessions = document.getElementById('capture-history-sessions');
        captureHistoryPacketsTitle = document.getElementById('capture-history-packets-title');
        captureHistoryFilterInput = document.getElementById('capture-history-filter-input');
        captureHistoryExportBtn = document.getElementById('capture-history-export-btn');
        captureHistoryPacketsBody = document.getElementById('capture-history-packets-body');
        captureHistoryPacketsPlaceholder = document.getElementById('capture-history-packets-placeholder');
        captureHistoryPacketDetailContent = document.getElementById('capture-history-packet-detail-content');
        captureHistoryResizer = document.getElementById('capture-history-resizer');
        captureHistoryVResizer = document.getElementById('capture-history-v-resizer');
        captureHistoryPacketsTableWrapper = document.getElementById('capture-history-packets-table-wrapper');
        captureHistoryPacketDetail = document.getElementById('capture-history-packet-detail');
        captureHistoryRealtimeTabs = document.getElementById('capture-history-realtime-tabs');

        // ========== 对话框 ==========
        auxScriptSaveDialog = document.getElementById('aux-script-save-dialog');
        auxScriptInfoDialog = document.getElementById('aux-script-info-dialog');
        captureBackConfirmDialog = document.getElementById('capture-back-confirm-dialog');

        // ========== 代理抓包 ==========
        captureProxySettings = document.getElementById('capture-proxy-settings');
        proxyPortInput = document.getElementById('proxy-port');
        proxyLocalIp = document.getElementById('proxy-local-ip');
        proxyCopyIpBtn = document.getElementById('proxy-copy-ip-btn');
        proxyTipAddr = document.getElementById('proxy-tip-addr');
        proxyExportCertBtn = document.getElementById('proxy-export-cert-btn');
        proxyInstallCertBtn = document.getElementById('proxy-install-cert-btn');
        // mitmproxy环境
        proxyEnvStatus = document.getElementById('proxy-env-status');
        proxyEnvIcon = document.getElementById('proxy-env-icon');
        proxyEnvValue = document.getElementById('proxy-env-value');
        proxyInstallMitmproxyBtn = document.getElementById('proxy-install-mitmproxy-btn');

        // ========== 全流量抓包 ==========
        captureRealtimeTarget = document.getElementById('capture-realtime-target');
        realtimeTargetSelect = document.getElementById('realtime-target-select');
        realtimeDeviceApps = document.getElementById('realtime-device-apps');
        realtimeAppSelect = document.getElementById('realtime-app-select');
        realtimeRefreshAppsBtn = document.getElementById('realtime-refresh-apps-btn');
        captureStatsBar = document.getElementById('capture-stats-bar');
        httpPacketsWrapper = document.getElementById('http-packets-wrapper');
        realtimePacketsWrapper = document.getElementById('realtime-packets-wrapper');
        realtimePacketsBody = document.getElementById('realtime-packets-body');
        // 统计数量元素
        statTotal = document.getElementById('stat-total');
        statTcp = document.getElementById('stat-tcp');
        statUdp = document.getElementById('stat-udp');
        statHttp = document.getElementById('stat-http');
        statHttps = document.getElementById('stat-https');
        statDns = document.getElementById('stat-dns');
    }

    /**
     * 绑定所有事件
     */
    function bindEvents() {
        // ========== 页面1：选择页面事件 ==========
        // 初始化Frida环境按钮
        if (initFridaBtn) {
            initFridaBtn.addEventListener('click', handleInitFrida);
        }

        // 启动Frida Server按钮
        if (startServerBtn) {
            startServerBtn.addEventListener('click', handleStartServer);
        }

        // 停止Frida Server按钮
        if (stopServerBtn) {
            stopServerBtn.addEventListener('click', handleStopServer);
        }

        // 抓包类型选择
        if (captureTypeList) {
            captureTypeList.addEventListener('click', handleCaptureTypeClick);
        }

        // 切换抓包目标
        if (captureTargetSelect) {
            captureTargetSelect.addEventListener('change', handleTargetChange);
        }

        // 刷新APP列表按钮
        if (refreshAppsBtn) {
            refreshAppsBtn.addEventListener('click', loadDeviceApps);
        }

        // APP选择变化
        if (deviceAppSelect) {
            deviceAppSelect.addEventListener('change', updateCaptureButtons);
        }

        // 添加辅助脚本按钮
        if (addAuxScriptBtn) {
            addAuxScriptBtn.addEventListener('click', handleAddAuxScript);
        }

        // 查看抓包记录按钮
        if (captureHistoryBtn) {
            captureHistoryBtn.addEventListener('click', openCaptureHistory);
        }

        // 开始抓包主按钮
        if (startCaptureMainBtn) {
            startCaptureMainBtn.addEventListener('click', handleStartCapture);
        }

        // ========== 页面2：抓包进行中事件 ==========
        // 返回按钮
        if (captureBackBtn) {
            captureBackBtn.addEventListener('click', handleCaptureBack);
        }

        // 停止抓包按钮
        if (stopCaptureBtn) {
            stopCaptureBtn.addEventListener('click', handleStopCapture);
        }

        // 过滤数据包
        if (packetsFilterInput) {
            packetsFilterInput.addEventListener('input', handlePacketFilter);
        }

        // 数据包详情标签切换 - 运行页面
        document.querySelectorAll('#capture-running-page .packet-detail-tab').forEach(tab => {
            tab.addEventListener('click', () => handleTabSwitch(tab, 'running'));
        });

        // 拖拽调整抓包面板大小
        if (captureResizer) {
            captureResizer.addEventListener('mousedown', startCaptureResize);
        }

        // ========== 抓包记录弹出层事件 ==========
        if (captureHistoryCloseBtn) {
            captureHistoryCloseBtn.addEventListener('click', closeCaptureHistory);
        }

        if (captureHistoryRefreshBtn) {
            captureHistoryRefreshBtn.addEventListener('click', loadHistorySessions);
        }

        if (captureHistoryTypeFilter) {
            captureHistoryTypeFilter.addEventListener('change', loadHistorySessions);
        }

        if (captureHistoryFilterInput) {
            captureHistoryFilterInput.addEventListener('input', handleHistoryPacketFilter);
        }

        if (captureHistoryExportBtn) {
            captureHistoryExportBtn.addEventListener('click', handleOpenCaptureFolder);
        }

        // 数据包详情标签切换 - 历史记录弹出层
        document.querySelectorAll('#capture-history-packet-detail .packet-detail-tab').forEach(tab => {
            tab.addEventListener('click', () => handleTabSwitch(tab, 'history'));
        });

        if (captureHistoryResizer) {
            captureHistoryResizer.addEventListener('mousedown', startHistoryResize);
        }

        // 垂直分割线拖动（上下调整高度）
        if (captureHistoryVResizer) {
            captureHistoryVResizer.addEventListener('mousedown', startHistoryVResize);
        }

        // 全流量抓包Tab切换事件
        if (captureHistoryRealtimeTabs) {
            captureHistoryRealtimeTabs.addEventListener('click', handleRealtimeTabClick);
        }

        // ========== 对话框事件 ==========
        bindDialogEvents();

        // ========== 代理抓包事件 ==========
        if (proxyCopyIpBtn) {
            proxyCopyIpBtn.addEventListener('click', handleCopyProxyIp);
        }

        if (proxyPortInput) {
            proxyPortInput.addEventListener('change', updateProxyTipAddr);
        }

        if (proxyExportCertBtn) {
            proxyExportCertBtn.addEventListener('click', handleExportCert);
        }

        if (proxyInstallCertBtn) {
            proxyInstallCertBtn.addEventListener('click', handleInstallCert);
        }

        // mitmproxy安装按钮
        if (proxyInstallMitmproxyBtn) {
            proxyInstallMitmproxyBtn.addEventListener('click', handleInstallMitmproxy);
        }

        // ========== 全流量抓包目标选择事件 ==========
        if (realtimeTargetSelect) {
            realtimeTargetSelect.addEventListener('change', handleRealtimeTargetChange);
        }

        if (realtimeRefreshAppsBtn) {
            realtimeRefreshAppsBtn.addEventListener('click', loadRealtimeDeviceApps);
        }

        if (realtimeAppSelect) {
            realtimeAppSelect.addEventListener('change', updateCaptureButtons);
        }

        // ========== 全流量抓包统计栏事件 ==========
        if (captureStatsBar) {
            captureStatsBar.addEventListener('click', handleStatsFilterClick);
        }

        // ========== Tab切换事件 ==========
        if (operationTabs) {
            operationTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    if (tab.dataset.tab === 'capture') {
                        checkFridaEnv();
                        loadAuxScripts();
                    }
                });
            });
        }

        // ========== 初始化UI状态 ==========
        // 根据默认的抓包类型(realtime)更新UI显示
        updateCaptureTypeUI();
    }

    // ===================== 自动刷新功能 =====================

    /**
     * 开始自动刷新数据包（抓包时每秒刷新一次）
     */
    function startAutoRefreshPackets() {
        stopAutoRefreshPackets(); // 先清除已有的定时器
        captureState.autoRefreshTimer = setInterval(async () => {
            if (captureState.capturing && captureState.currentCaptureId) {
                if (captureState.captureType === 'realtime') {
                    // 全流量抓包使用增量获取
                    await loadRealtimePackets();
                } else if (captureState.currentSessionId) {
                    await loadCapturePackets(captureState.currentSessionId);
                }
            }
        }, 500); // 全流量抓包更快刷新
    }

    /**
     * 停止自动刷新数据包
     */
    function stopAutoRefreshPackets() {
        if (captureState.autoRefreshTimer) {
            clearInterval(captureState.autoRefreshTimer);
            captureState.autoRefreshTimer = null;
        }
    }

    // ===================== Frida环境管理 =====================

    /**
     * 检查Frida环境状态
     */
    async function checkFridaEnv() {
        try {
            fridaEnvStatus.classList.remove('ready', 'error');
            fridaEnvStatus.classList.add('loading');
            fridaEnvStatus.querySelector('.status-icon').textContent = '🔄';
            fridaEnvStatus.querySelector('.status-value').textContent = '检测中...';

            const result = await invoke('check_frida_env');

            fridaEnvStatus.classList.remove('loading');
            if (result.ready) {
                fridaEnvStatus.classList.add('ready');
                fridaEnvStatus.querySelector('.status-icon').textContent = '🟢';
                fridaEnvStatus.querySelector('.status-value').textContent = `v${result.version}`;
                captureState.fridaReady = true;
                initFridaBtn.disabled = true;
                initFridaBtn.textContent = '已就绪';

                // 检查frida-server状态
                await checkFridaServerStatus();
            } else {
                fridaEnvStatus.classList.add('error');
                fridaEnvStatus.querySelector('.status-icon').textContent = '🔴';
                fridaEnvStatus.querySelector('.status-value').textContent = '未安装';
                captureState.fridaReady = false;
                initFridaBtn.disabled = false;
                initFridaBtn.textContent = '初始化环境';
                startServerBtn.disabled = true;
            }
        } catch (error) {
            fridaEnvStatus.classList.remove('loading');
            fridaEnvStatus.classList.add('error');
            fridaEnvStatus.querySelector('.status-icon').textContent = '🔴';
            fridaEnvStatus.querySelector('.status-value').textContent = '检测失败';
            console.error('检查Frida环境失败:', error);
        }
    }

    /**
     * 检查Frida Server状态
     */
    async function checkFridaServerStatus() {
        try {
            const result = await invoke('check_frida_server_status');

            fridaServerStatus.classList.remove('ready', 'error', 'loading');
            if (result.running) {
                fridaServerStatus.classList.add('ready');
                fridaServerStatus.querySelector('.status-icon').textContent = '🟢';
                fridaServerStatus.querySelector('.status-value').textContent = '运行中';
                captureState.serverRunning = true;
                startServerBtn.disabled = true;
                startServerBtn.textContent = '已启动';
                startServerBtn.style.display = 'none';
                stopServerBtn.style.display = 'inline-block';
            } else {
                fridaServerStatus.classList.add('error');
                fridaServerStatus.querySelector('.status-icon').textContent = '🔴';
                fridaServerStatus.querySelector('.status-value').textContent = '未启动';
                captureState.serverRunning = false;
                startServerBtn.disabled = !captureState.fridaReady;
                startServerBtn.textContent = '启动服务';
                startServerBtn.style.display = 'inline-block';
                stopServerBtn.style.display = 'none';
            }
            updateCaptureButtons();
        } catch (error) {
            console.error('检查Frida Server状态失败:', error);
        }
    }

    /**
     * 处理初始化Frida环境按钮点击
     */
    async function handleInitFrida() {
        if (initFridaBtn.disabled) return;

        initFridaBtn.disabled = true;
        initFridaBtn.textContent = '初始化中...';

        try {
            toast.show({ text: '正在初始化Frida环境，请稍候...', color: 'info', duration: 5000 });

            const result = await invoke('init_frida_env');

            if (result.success) {
                toast.show({ text: 'Frida环境初始化成功', color: 'success', duration: 3000 });
                await checkFridaEnv();
            }
        } catch (error) {
            toast.show({ text: `初始化失败: ${error}`, color: 'error', duration: 5000 });
            initFridaBtn.disabled = false;
            initFridaBtn.textContent = '初始化环境';
        }
    }

    /**
     * 处理启动Frida Server按钮点击
     */
    async function handleStartServer() {
        if (startServerBtn.disabled) return;

        startServerBtn.disabled = true;
        startServerBtn.textContent = '启动中...';
        fridaServerStatus.classList.remove('ready', 'error');
        fridaServerStatus.classList.add('loading');
        fridaServerStatus.querySelector('.status-icon').textContent = '🔄';
        fridaServerStatus.querySelector('.status-value').textContent = '启动中...';

        try {
            const result = await invoke('start_frida_server');

            fridaServerStatus.classList.remove('loading');
            if (result.success) {
                fridaServerStatus.classList.add('ready');
                fridaServerStatus.querySelector('.status-icon').textContent = '🟢';
                fridaServerStatus.querySelector('.status-value').textContent = '运行中';
                captureState.serverRunning = true;
                startServerBtn.textContent = '已启动';
                startServerBtn.style.display = 'none';
                stopServerBtn.style.display = 'inline-block';
                updateCaptureButtons();
                toast.show({ text: result.message, color: 'success', duration: 3000 });
            }
        } catch (error) {
            fridaServerStatus.classList.remove('loading');
            fridaServerStatus.classList.add('error');
            fridaServerStatus.querySelector('.status-icon').textContent = '🔴';
            fridaServerStatus.querySelector('.status-value').textContent = '启动失败';
            startServerBtn.disabled = false;
            startServerBtn.textContent = '启动服务';
            toast.show({ text: `启动失败: ${error}`, color: 'error', duration: 5000 });
        }
    }

    /**
     * 处理停止Frida Server按钮点击
     */
    async function handleStopServer() {
        stopServerBtn.disabled = true;
        stopServerBtn.textContent = '停止中...';

        try {
            const result = await invoke('stop_frida_server');

            if (result.success) {
                fridaServerStatus.classList.remove('ready');
                fridaServerStatus.classList.add('error');
                fridaServerStatus.querySelector('.status-icon').textContent = '🔴';
                fridaServerStatus.querySelector('.status-value').textContent = '未启动';
                captureState.serverRunning = false;
                stopServerBtn.style.display = 'none';
                startServerBtn.style.display = 'inline-block';
                startServerBtn.disabled = false;
                startServerBtn.textContent = '启动服务';
                updateCaptureButtons();
                toast.show({ text: result.message, color: 'success', duration: 3000 });
            }
        } catch (error) {
            toast.show({ text: `停止失败: ${error}`, color: 'error', duration: 3000 });
        } finally {
            stopServerBtn.disabled = false;
            stopServerBtn.textContent = '停止服务';
        }
    }

    // ===================== 抓包控制 =====================

    /**
     * 更新抓包按钮状态
     */
    function updateCaptureButtons() {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        // tcpdump、proxy、realtime不需要Frida环境
        const isRealtime = captureState.captureType === 'realtime';
        const isTcpdump = captureState.captureType === 'tcpdump';
        const isProxy = captureState.captureType === 'proxy';
        const noFridaNeeded = isTcpdump || isProxy || isRealtime;

        // 代理模式需要mitmproxy就绪
        let canStart;
        if (isProxy) {
            canStart = captureState.mitmproxyReady && !captureState.capturing;
        } else if (isTcpdump || isRealtime) {
            // tcpdump和全流量抓包只需要设备连接（不需要Frida）
            canStart = !captureState.capturing;
        } else {
            canStart = captureState.fridaReady && captureState.serverRunning && !captureState.capturing;
        }

        if (!startCaptureMainBtn) return;

        // 根据抓包类型判断是否可以开始
        if (isRealtime) {
            // 全流量抓包：根据目标类型判断
            const realtimeTarget = realtimeTargetSelect?.value || 'all';
            if (realtimeTarget === 'all') {
                // 整个设备，直接可以开始
                startCaptureMainBtn.disabled = !canStart;
            } else if (realtimeTarget === 'current') {
                // 当前APK - 需要选中APK
                if (selectedApkIndex >= 0 && apkListData[selectedApkIndex] && apkListData[selectedApkIndex].packageName) {
                    startCaptureMainBtn.disabled = !canStart;
                } else {
                    startCaptureMainBtn.disabled = true;
                }
            } else if (realtimeTarget === 'device') {
                // 设备上的APP - 需要选择应用
                startCaptureMainBtn.disabled = !canStart || !realtimeAppSelect?.value;
            }
        } else if (isProxy) {
            startCaptureMainBtn.disabled = !canStart;
        } else if (captureTargetSelect && captureTargetSelect.value === 'current') {
            // 当前APK - 需要选中APK
            if (selectedApkIndex >= 0 && apkListData[selectedApkIndex]) {
                startCaptureMainBtn.disabled = !canStart;
            } else {
                startCaptureMainBtn.disabled = true;
            }
        } else {
            // 设备上的APP - 需要选择应用
            startCaptureMainBtn.disabled = !canStart || !deviceAppSelect?.value;
        }

        if (stopCaptureBtn) {
            stopCaptureBtn.disabled = !captureState.capturing;
        }
    }

    /**
     * 处理抓包目标切换
     */
    function handleTargetChange() {
        if (captureTargetSelect && captureTargetSelect.value === 'device') {
            if (captureDeviceApps) captureDeviceApps.style.display = 'flex';
            loadDeviceApps();
        } else {
            if (captureDeviceApps) captureDeviceApps.style.display = 'none';
        }
        updateCaptureButtons();
    }

    /**
     * 加载设备APP列表
     */
    async function loadDeviceApps() {
        deviceAppSelect.innerHTML = '<option value="">加载中...</option>';
        deviceAppSelect.disabled = true;

        try {
            const result = await invoke('get_device_apps');

            deviceAppSelect.innerHTML = '<option value="">请选择应用...</option>';
            if (result.success && result.apps) {
                result.apps.forEach(app => {
                    const option = document.createElement('option');
                    option.value = app.package;
                    option.textContent = `${app.name} (${app.package})`;
                    deviceAppSelect.appendChild(option);
                });
            }
            deviceAppSelect.disabled = false;
        } catch (error) {
            deviceAppSelect.innerHTML = '<option value="">加载失败</option>';
            toast.show({ text: `获取APP列表失败: ${error}`, color: 'error', duration: 3000 });
        }
    }

    /**
     * 处理全流量抓包目标切换
     */
    function handleRealtimeTargetChange() {
        const target = realtimeTargetSelect?.value || 'all';
        if (target === 'device') {
            if (realtimeDeviceApps) realtimeDeviceApps.style.display = 'flex';
            loadRealtimeDeviceApps();
        } else {
            if (realtimeDeviceApps) realtimeDeviceApps.style.display = 'none';
        }
        updateCaptureButtons();
    }

    /**
     * 加载全流量抓包的设备APP列表
     */
    async function loadRealtimeDeviceApps() {
        if (!realtimeAppSelect) return;

        realtimeAppSelect.innerHTML = '<option value="">加载中...</option>';
        realtimeAppSelect.disabled = true;

        try {
            const result = await invoke('get_device_apps');

            realtimeAppSelect.innerHTML = '<option value="">请选择应用...</option>';
            if (result.success && result.apps) {
                result.apps.forEach(app => {
                    const option = document.createElement('option');
                    option.value = app.package;
                    option.textContent = `${app.name} (${app.package})`;
                    realtimeAppSelect.appendChild(option);
                });
            }
            realtimeAppSelect.disabled = false;
        } catch (error) {
            realtimeAppSelect.innerHTML = '<option value="">加载失败</option>';
            toast.show({ text: `获取APP列表失败: ${error}`, color: 'error', duration: 3000 });
        }
    }

    /**
     * 获取全流量抓包的目标包名
     * @returns {string|null} 包名，如果是全设备则返回null
     */
    function getRealtimeTargetPackage() {
        const target = realtimeTargetSelect?.value || 'all';
        if (target === 'all') {
            return null;
        } else if (target === 'current') {
            const apkListData = getApkListData();
            const selectedApkIndex = getSelectedApkIndex();
            if (selectedApkIndex >= 0 && apkListData[selectedApkIndex]) {
                return apkListData[selectedApkIndex].packageName;
            }
            return null;
        } else if (target === 'device') {
            return realtimeAppSelect?.value || null;
        }
        return null;
    }

    /**
     * 处理开始抓包按钮点击
     */
    async function handleStartCapture() {
        if (startCaptureMainBtn && startCaptureMainBtn.disabled) return;

        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        let packageName = '';
        let apkDir = '';

        // 全流量抓包需要根据目标类型获取包名
        if (captureState.captureType === 'realtime') {
            const targetPackage = getRealtimeTargetPackage();
            if (targetPackage) {
                packageName = targetPackage;
            }
            // 全流量抓包不需要apkDir
        } else if (captureState.captureType === 'proxy') {
            // 代理抓包不需要选择应用
        } else {
            // r0capture 和 tcpdump 需要选择应用
            if (captureTargetSelect.value === 'current') {
                if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
                    toast.show({ text: '请先选择一个APK', color: 'warning', duration: 3000 });
                    return;
                }

                const apk = apkListData[selectedApkIndex];
                packageName = apk.packageName;
                apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

                if (!packageName) {
                    toast.show({ text: '无法获取APK包名', color: 'error', duration: 3000 });
                    return;
                }
            } else {
                packageName = deviceAppSelect.value;
                if (!packageName) {
                    toast.show({ text: '请选择要抓包的应用', color: 'warning', duration: 3000 });
                    return;
                }
                apkDir = '';
            }
        }

        if (startCaptureMainBtn) {
            startCaptureMainBtn.disabled = true;
            startCaptureMainBtn.textContent = '启动中...';
        }

        try {
            // 根据抓包类型调用不同的后端接口
            let result;
            if (captureState.captureType === 'realtime') {
                // 全流量抓包，传递可选的包名用于按应用过滤
                result = await invoke('start_realtime_capture', {
                    caseNumber: caseNumber,
                    packageName: packageName || null  // null表示抓取全部流量
                });
                if (result.success) {
                    captureState.deviceIp = result.device_ip || '';
                }
            } else if (captureState.captureType === 'tcpdump') {
                result = await invoke('start_tcpdump_capture', {
                    caseNumber,
                    packageName
                });
            } else if (captureState.captureType === 'proxy') {
                // 代理抓包
                const port = parseInt(proxyPortInput?.value || '8080', 10);
                result = await invoke('start_proxy_capture', {
                    caseNumber,
                    port
                });
            } else {
                // 获取选中的辅助脚本路径
                const auxScriptPaths = getSelectedAuxScriptPaths();

                result = await invoke('start_packet_capture', {
                    caseNumber,
                    apkDir,
                    packageName,
                    spawnMode: captureSpawnMode?.checked ?? true,
                    auxScripts: auxScriptPaths
                });
            }

            if (result.success) {
                captureState.capturing = true;
                captureState.currentCaptureId = result.capture_id;
                captureState.currentSessionId = result.session_dir;

                // 更新运行页面信息
                let targetName;
                if (captureState.captureType === 'realtime') {
                    if (packageName) {
                        targetName = `应用流量: ${packageName}`;
                    } else {
                        targetName = '全设备流量';
                    }
                } else if (captureState.captureType === 'proxy') {
                    targetName = `代理服务 (端口 ${proxyPortInput?.value || '8080'})`;
                } else {
                    targetName = packageName;
                }
                updateRunningPageInfo(targetName);

                // 切换到运行页面
                switchToRunningPage();

                // 获取详情标签栏
                const detailTabs = document.querySelector('#capture-running-page .packet-detail-tabs');

                // 根据抓包类型切换显示的表格
                if (captureState.captureType === 'realtime') {
                    // 显示全流量抓包表格和统计栏
                    if (httpPacketsWrapper) {
                        httpPacketsWrapper.classList.add('hidden');
                        httpPacketsWrapper.classList.remove('visible');
                    }
                    if (realtimePacketsWrapper) {
                        realtimePacketsWrapper.classList.remove('hidden');
                        realtimePacketsWrapper.classList.add('visible');
                        realtimePacketsWrapper.style.display = 'block';
                    }
                    if (captureStatsBar) captureStatsBar.classList.remove('hidden');
                    // 隐藏详情标签栏（全流量抓包不需要请求/响应/十六进制）
                    if (detailTabs) detailTabs.style.display = 'none';
                    // 清空全流量抓包状态
                    captureState.realtimePackets = [];
                    captureState.realtimeLastId = 0;
                    captureState.realtimeFilter = 'all';
                    if (realtimePacketsBody) realtimePacketsBody.innerHTML = '';
                    updateRealtimeStats({ tcp: 0, udp: 0, http: 0, https: 0, dns: 0, other: 0 });
                    // 隐藏占位符
                    if (capturePacketsPlaceholder) capturePacketsPlaceholder.style.display = 'none';
                    // 设置详情面板默认提示
                    if (packetDetailContent) {
                        packetDetailContent.innerHTML = '<div class="packet-detail-placeholder">点击左侧数据包查看详情</div>';
                    }
                } else {
                    // 显示HTTP抓包表格
                    if (httpPacketsWrapper) {
                        httpPacketsWrapper.classList.remove('hidden');
                        httpPacketsWrapper.classList.add('visible');
                    }
                    if (realtimePacketsWrapper) {
                        realtimePacketsWrapper.classList.add('hidden');
                        realtimePacketsWrapper.classList.remove('visible');
                        realtimePacketsWrapper.style.display = 'none';
                    }
                    if (captureStatsBar) captureStatsBar.classList.add('hidden');
                    // 显示详情标签栏
                    if (detailTabs) detailTabs.style.display = '';
                    // 清空数据包列表
                    captureState.packets = [];
                    captureState.selectedPacketIndex = -1;
                    if (capturePacketsBody) capturePacketsBody.innerHTML = '';
                    // 显示占位符
                    if (capturePacketsPlaceholder) capturePacketsPlaceholder.style.display = 'flex';
                }
                if (packetsTitle) packetsTitle.textContent = '数据包列表 (0)';

                // 更新按钮状态（启用停止按钮）
                updateCaptureButtons();

                toast.show({ text: '抓包已启动', color: 'success', duration: 3000 });

                // 开始定时刷新
                startAutoRefreshPackets();
            } else {
                toast.show({ text: result.message || '启动抓包失败', color: 'error', duration: 5000 });
            }
        } catch (error) {
            toast.show({ text: `启动抓包失败: ${error}`, color: 'error', duration: 5000 });
        } finally {
            if (startCaptureMainBtn) {
                startCaptureMainBtn.disabled = false;
                startCaptureMainBtn.textContent = '开始抓包';
            }
        }
    }

    /**
     * 获取选中的辅助脚本路径列表
     * @returns {Array} 脚本路径列表
     */
    function getSelectedAuxScriptPaths() {
        const paths = [];
        captureState.selectedAuxScripts.forEach(scriptId => {
            const script = captureState.auxScripts.find(s => s.id === scriptId);
            if (script) {
                if (script.isTemp && script.path) {
                    paths.push(script.path);
                } else if (script.filename) {
                    paths.push(script.filename);
                }
            }
        });
        return paths;
    }

    /**
     * 更新运行页面信息
     * @param {string} packageName - 包名或目标描述
     */
    function updateRunningPageInfo(packageName) {
        if (captureRunningType) {
            const typeMap = {
                'realtime': '全流量抓包',
                'r0capture': 'r0capture',
                'tcpdump': 'tcpdump',
                'proxy': '代理抓包'
            };
            captureRunningType.textContent = typeMap[captureState.captureType] || captureState.captureType;
        }
        if (captureRunningTarget) {
            captureRunningTarget.textContent = packageName;
        }
        if (captureRunningStatus) {
            captureRunningStatus.textContent = '抓包中...';
        }
    }

    /**
     * 处理停止抓包按钮点击
     */
    async function handleStopCapture() {
        if (!captureState.currentCaptureId && !captureState.capturing) return;

        if (stopCaptureBtn) {
            stopCaptureBtn.disabled = true;
            stopCaptureBtn.textContent = '停止中...';
        }

        // 停止自动刷新
        stopAutoRefreshPackets();

        try {
            if (captureState.captureType === 'realtime') {
                await invoke('stop_realtime_capture', {
                    captureId: captureState.currentCaptureId
                });
            } else if (captureState.captureType === 'tcpdump') {
                await invoke('stop_tcpdump_capture', {
                    captureId: captureState.currentCaptureId
                });
            } else if (captureState.captureType === 'proxy') {
                await invoke('stop_proxy_capture', {
                    captureId: captureState.currentCaptureId
                });
            } else {
                await invoke('stop_packet_capture', {
                    captureId: captureState.currentCaptureId
                });
            }

            captureState.capturing = false;
            captureState.currentCaptureId = null;

            if (captureRunningStatus) {
                captureRunningStatus.textContent = '已停止';
            }

            toast.show({ text: '抓包已停止', color: 'success', duration: 3000 });
        } catch (error) {
            toast.show({ text: `停止抓包失败: ${error}`, color: 'error', duration: 3000 });
        } finally {
            if (stopCaptureBtn) {
                stopCaptureBtn.disabled = false;
                stopCaptureBtn.textContent = '停止抓包';
            }
            updateCaptureButtons();
        }
    }

    // ===================== 会话管理 =====================

    /**
     * 加载抓包会话列表
     */
    async function loadSessions() {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        // 需要选中APK才能加载该APK的抓包记录
        if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
            captureSessionsList.innerHTML = '<div class="capture-placeholder">上传一个apk开始分析</div>';
            return;
        }

        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('get_capture_sessions', { apkDir });

            if (result.success) {
                renderCaptureSessions(result.sessions);
            }
        } catch (error) {
            console.error('加载抓包会话失败:', error);
        }
    }

    /**
     * 渲染抓包会话列表
     * @param {Array} sessions - 会话列表
     */
    function renderCaptureSessions(sessions) {
        if (!sessions || sessions.length === 0) {
            captureSessionsList.innerHTML = '<div class="capture-placeholder">暂无抓包记录</div>';
            return;
        }

        captureSessionsList.innerHTML = sessions.map(session => {
            const isCapturing = captureState.currentCaptureId &&
                captureState.currentCaptureId.includes(session.session_id);
            const isSelected = captureState.selectedSessionId === session.session_id;

            return `
                <div class="capture-session-item ${isCapturing ? 'capturing' : ''} ${isSelected ? 'selected' : ''}"
                     data-session-id="${session.session_id}">
                    <div class="session-item-header">
                        <span class="session-item-package" title="${session.package}">${session.package}</span>
                        <span class="session-item-status ${isCapturing ? 'capturing' : 'completed'}">
                            ${isCapturing ? '抓包中' : '已完成'}
                        </span>
                    </div>
                    <div class="session-item-time">${session.start_time}</div>
                    <div class="session-item-actions">
                        <button class="session-action-btn view-btn" data-session="${session.session_id}">查看</button>
                        <button class="session-action-btn delete" data-session="${session.session_id}">删除</button>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定事件
        captureSessionsList.querySelectorAll('.capture-session-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('session-action-btn')) {
                    selectCaptureSession(item.dataset.sessionId);
                }
            });
        });

        captureSessionsList.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => selectCaptureSession(btn.dataset.session));
        });

        captureSessionsList.querySelectorAll('.delete').forEach(btn => {
            btn.addEventListener('click', () => deleteCaptureSession(btn.dataset.session));
        });
    }

    /**
     * 选择抓包会话
     * @param {string} sessionId - 会话ID
     */
    async function selectCaptureSession(sessionId) {
        captureState.selectedSessionId = sessionId;

        // 更新选中状态
        captureSessionsList.querySelectorAll('.capture-session-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.sessionId === sessionId);
        });

        // 加载数据包
        await loadCapturePackets(sessionId);
    }

    /**
     * 删除抓包会话
     * @param {string} sessionId - 会话ID
     */
    async function deleteCaptureSession(sessionId) {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        // 创建确认对话框
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-modal-content">
                <div class="confirm-modal-title">确认删除</div>
                <div class="confirm-modal-text">确定要删除这个抓包记录吗？此操作无法撤销。</div>
                <div class="confirm-modal-buttons">
                    <button class="confirm-modal-btn cancel">取消</button>
                    <button class="confirm-modal-btn delete">删除</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 取消按钮
        modal.querySelector('.cancel').addEventListener('click', () => {
            modal.remove();
        });

        // 删除按钮
        modal.querySelector('.delete').addEventListener('click', async () => {
            modal.remove();

            try {
                await invoke('delete_capture_session', { apkDir, sessionId });
                toast.show({ text: '已删除抓包记录', color: 'success', duration: 2000 });

                if (captureState.selectedSessionId === sessionId) {
                    captureState.selectedSessionId = null;
                    captureState.packets = [];
                    capturePacketsPlaceholder.classList.remove('hidden');
                    capturePacketsTableWrapper.classList.remove('visible');
                    capturePacketDetail.classList.remove('visible');
                }

                await loadSessions();
            } catch (error) {
                toast.show({ text: `删除失败: ${error}`, color: 'error', duration: 3000 });
            }
        });

        // 点击蒙层关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // ===================== 数据包管理 =====================

    /**
     * 加载抓包数据包（运行页面使用）
     * @param {string} sessionId - 会话ID
     */
    async function loadCapturePackets(sessionId) {
        if (!sessionId) return;

        // 获取当前APK目录
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();
        let apkDir = '';

        if (selectedApkIndex >= 0 && apkListData[selectedApkIndex]) {
            const apk = apkListData[selectedApkIndex];
            apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
        }

        try {
            const result = await invoke('get_capture_packets', {
                apkDir: apkDir,
                sessionId: sessionId,
                page: 1,
                pageSize: 500
            });

            if (result.success) {
                captureState.packets = result.packets || [];
                renderCapturePackets(captureState.packets);
                if (packetsTitle) {
                    packetsTitle.textContent = `数据包列表 (${result.total || captureState.packets.length})`;
                }
            }
        } catch (error) {
            console.error('加载数据包失败:', error);
        }
    }

    /**
     * 渲染数据包列表（运行页面使用）
     * @param {Array} packets - 数据包列表
     */
    function renderCapturePackets(packets) {
        if (!capturePacketsBody) return;

        if (!packets || packets.length === 0) {
            if (capturePacketsPlaceholder) {
                capturePacketsPlaceholder.style.display = 'flex';
            }
            capturePacketsBody.innerHTML = '';
            return;
        }

        if (capturePacketsPlaceholder) {
            capturePacketsPlaceholder.style.display = 'none';
        }

        capturePacketsBody.innerHTML = packets.map((packet, index) => {
            const method = packet.method || 'GET';
            const methodClass = method.toLowerCase();
            const statusCode = packet.status || '-';
            const statusClass = getStatusClass(statusCode);
            const time = packet.time || (packet.timestamp ? new Date(packet.timestamp).toLocaleTimeString() : '');

            return `
                <tr class="packet-row" data-index="${index}">
                    <td class="col-no">${index + 1}</td>
                    <td class="col-time">${time}</td>
                    <td class="col-method"><span class="method-tag ${methodClass}">${method}</span></td>
                    <td class="col-host">${escapeHtml(packet.host || '')}</td>
                    <td class="col-path" title="${escapeHtml(packet.path || '')}">${escapeHtml(packet.path || '')}</td>
                    <td class="col-status"><span class="status-code ${statusClass}">${statusCode}</span></td>
                    <td class="col-size">${formatSize(packet.size)}</td>
                </tr>
            `;
        }).join('');

        // 绑定行点击事件
        capturePacketsBody.querySelectorAll('.packet-row').forEach(row => {
            row.addEventListener('click', () => {
                selectPacket(parseInt(row.dataset.index, 10));
            });
        });
    }

    /**
     * 获取状态码样式类
     * @param {number} code - HTTP状态码
     * @returns {string} 样式类名
     */
    function getStatusClass(code) {
        if (code >= 200 && code < 300) return 'success';
        if (code >= 300 && code < 400) return 'redirect';
        if (code >= 400 && code < 500) return 'client-error';
        if (code >= 500) return 'server-error';
        return '';
    }

    /**
     * 格式化大小
     * @param {number} bytes - 字节数
     * @returns {string} 格式化后的大小
     */
    function formatSize(bytes) {
        if (!bytes || bytes === 0) return '-';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    /**
     * 选择数据包（运行页面使用）
     * @param {number} index - 数据包索引
     */
    function selectPacket(index) {
        captureState.selectedPacketIndex = index;

        // 更新表格选中状态
        if (capturePacketsBody) {
            capturePacketsBody.querySelectorAll('.packet-row').forEach((row, i) => {
                row.classList.toggle('selected', i === index);
            });
        }

        // 显示详情
        const packet = captureState.packets[index];
        if (packet) {
            const activeTab = document.querySelector('#capture-running-page .packet-detail-tab.active');
            renderPacketDetail(packet, activeTab?.dataset.tab || 'request', packetDetailContent);
        }
    }

    /**
     * 处理数据包过滤
     */
    function handlePacketFilter() {
        const filter = packetsFilterInput?.value?.toLowerCase() || '';
        if (capturePacketsBody) {
            capturePacketsBody.querySelectorAll('.packet-row').forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(filter) ? '' : 'none';
            });
        }
    }

    // ===================== 数据包详情 =====================

    /**
     * 渲染数据包详情
     * @param {Object} packet - 数据包对象
     * @param {string} tab - 当前标签页
     * @param {Element} container - 目标容器（可选，默认为packetDetailContent）
     */
    function renderPacketDetail(packet, tab, container = null) {
        let content = '';

        if (tab === 'request') {
            content = formatHttpRequest(packet);
        } else if (tab === 'response') {
            content = formatHttpResponse(packet);
        } else if (tab === 'hex') {
            content = formatHexView(packet);
        }

        const targetContainer = container || packetDetailContent;
        if (targetContainer) {
            targetContainer.innerHTML = content;
        }
    }

    /**
     * 格式化HTTP请求
     * @param {Object} packet - 数据包对象
     * @returns {string} 格式化后的HTML
     */
    function formatHttpRequest(packet) {
        let html = '';

        // 请求行
        html += `<div class="http-first-line">${packet.method || 'GET'} ${packet.path || '/'} HTTP/1.1</div>`;

        // 请求头
        if (packet.requestHeaders) {
            Object.entries(packet.requestHeaders).forEach(([name, value]) => {
                html += `<span class="http-header-name">${name}:</span> <span class="http-header-value">${value}</span>\n`;
            });
        }

        // 请求体
        if (packet.requestBody) {
            html += `\n<div class="http-body-label">Body:</div>`;
            html += escapeHtml(formatJsonIfPossible(packet.requestBody));
        }

        return html;
    }

    /**
     * 格式化HTTP响应
     * @param {Object} packet - 数据包对象
     * @returns {string} 格式化后的HTML
     */
    function formatHttpResponse(packet) {
        let html = '';

        // 状态行
        html += `<div class="http-first-line">HTTP/1.1 ${packet.status || 200} ${packet.statusText || 'OK'}</div>`;

        // 响应头
        if (packet.responseHeaders) {
            Object.entries(packet.responseHeaders).forEach(([name, value]) => {
                html += `<span class="http-header-name">${name}:</span> <span class="http-header-value">${value}</span>\n`;
            });
        }

        // 响应体
        if (packet.responseBody) {
            html += `\n<div class="http-body-label">Body:</div>`;
            html += escapeHtml(formatJsonIfPossible(packet.responseBody));
        }

        return html;
    }

    /**
     * 格式化十六进制视图
     * @param {Object} packet - 数据包对象
     * @returns {string} 格式化后的HTML
     */
    function formatHexView(packet) {
        const data = packet.requestBody || packet.responseBody || '';
        if (!data) return '<div class="packet-detail-placeholder">无数据</div>';

        let lines = [];

        for (let i = 0; i < data.length; i += 16) {
            const offset = i.toString(16).toUpperCase().padStart(8, '0');
            let hex = '';
            let ascii = '';

            for (let j = 0; j < 16; j++) {
                if (i + j < data.length) {
                    const byte = data.charCodeAt(i + j);
                    hex += byte.toString(16).toUpperCase().padStart(2, '0') + ' ';
                    ascii += (byte >= 32 && byte < 127) ? data[i + j] : '.';
                } else {
                    hex += '   ';
                }
            }

            lines.push(`<div class="hex-line"><span class="hex-offset">${offset}</span>  <span class="hex-bytes">${hex}</span> <span class="hex-ascii">${ascii}</span></div>`);
        }

        return `<div class="packet-hex-view">${lines.join('')}</div>`;
    }

    /**
     * 尝试格式化JSON
     * @param {string} str - 字符串
     * @returns {string} 格式化后的字符串
     */
    function formatJsonIfPossible(str) {
        try {
            const obj = JSON.parse(str);
            return JSON.stringify(obj, null, 2);
        } catch {
            return str;
        }
    }

    /**
     * 处理标签切换
     * @param {Element} tab - 标签元素
     * @param {string} context - 上下文: 'running' 或 'history'
     */
    function handleTabSwitch(tab, context = 'running') {
        // 找到同一上下文中的所有标签并清除active
        const parent = tab.closest('.packet-detail-tabs');
        if (parent) {
            parent.querySelectorAll('.packet-detail-tab').forEach(t => t.classList.remove('active'));
        }
        tab.classList.add('active');

        if (context === 'running') {
            if (captureState.selectedPacketIndex >= 0) {
                const packet = captureState.packets[captureState.selectedPacketIndex];
                renderPacketDetail(packet, tab.dataset.tab, packetDetailContent);
            }
        } else if (context === 'history') {
            if (captureState.historySelectedPacketIndex >= 0) {
                const packet = captureState.historyPackets[captureState.historySelectedPacketIndex];
                renderPacketDetail(packet, tab.dataset.tab, captureHistoryPacketDetailContent);
            }
        }
    }

    // ===================== 拖拽调整大小 =====================

    let isResizingHistory = false;

    /**
     * 开始拖拽调整大小 - 抓包运行页面
     */
    function startCaptureResize() {
        isResizingCapture = true;
        captureResizer.classList.add('active');
        document.addEventListener('mousemove', handleCaptureResize);
        document.addEventListener('mouseup', stopCaptureResize);
    }

    /**
     * 处理拖拽调整大小 - 抓包运行页面
     * @param {MouseEvent} e - 鼠标事件
     */
    function handleCaptureResize(e) {
        if (!isResizingCapture) return;
        const container = document.querySelector('.capture-running-content');
        if (!container || !capturePacketsLeft) return;
        const containerRect = container.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 300 && newWidth <= 800) {
            capturePacketsLeft.style.width = newWidth + 'px';
        }
    }

    /**
     * 停止拖拽调整大小 - 抓包运行页面
     */
    function stopCaptureResize() {
        isResizingCapture = false;
        if (captureResizer) captureResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleCaptureResize);
        document.removeEventListener('mouseup', stopCaptureResize);
    }

    /**
     * 开始拖拽调整大小 - 历史记录弹出层
     */
    function startHistoryResize() {
        isResizingHistory = true;
        captureHistoryResizer.classList.add('active');
        document.addEventListener('mousemove', handleHistoryResize);
        document.addEventListener('mouseup', stopHistoryResize);
    }

    /**
     * 处理拖拽调整大小 - 历史记录弹出层
     * @param {MouseEvent} e - 鼠标事件
     */
    function handleHistoryResize(e) {
        if (!isResizingHistory) return;
        const container = document.querySelector('.capture-history-content');
        const leftPanel = document.querySelector('.capture-history-left');
        if (!container || !leftPanel) return;
        const containerRect = container.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 200 && newWidth <= 400) {
            leftPanel.style.width = newWidth + 'px';
        }
    }

    /**
     * 停止拖拽调整大小 - 历史记录弹出层
     */
    function stopHistoryResize() {
        isResizingHistory = false;
        if (captureHistoryResizer) captureHistoryResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleHistoryResize);
        document.removeEventListener('mouseup', stopHistoryResize);
    }

    // ===================== 垂直拖动调整高度 =====================

    let isResizingHistoryV = false;

    /**
     * 开始垂直拖拽调整高度 - 历史记录弹出层
     */
    function startHistoryVResize(e) {
        isResizingHistoryV = true;
        captureHistoryVResizer.classList.add('active');
        document.addEventListener('mousemove', handleHistoryVResize);
        document.addEventListener('mouseup', stopHistoryVResize);
        e.preventDefault();
    }

    /**
     * 处理垂直拖拽调整高度 - 历史记录弹出层
     * @param {MouseEvent} e - 鼠标事件
     */
    function handleHistoryVResize(e) {
        if (!isResizingHistoryV) return;
        const rightPanel = document.querySelector('.capture-history-right');
        if (!rightPanel || !captureHistoryPacketDetail) return;

        const rightRect = rightPanel.getBoundingClientRect();
        const newDetailHeight = rightRect.bottom - e.clientY;

        // 限制最小和最大高度
        if (newDetailHeight >= 100 && newDetailHeight <= rightRect.height - 150) {
            captureHistoryPacketDetail.style.height = newDetailHeight + 'px';
        }
    }

    /**
     * 停止垂直拖拽调整高度 - 历史记录弹出层
     */
    function stopHistoryVResize() {
        isResizingHistoryV = false;
        if (captureHistoryVResizer) captureHistoryVResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleHistoryVResize);
        document.removeEventListener('mouseup', stopHistoryVResize);
    }

    // ===================== 全流量抓包Tab切换 =====================

    /**
     * 处理全流量抓包Tab点击
     * @param {Event} e - 点击事件
     */
    function handleRealtimeTabClick(e) {
        const tab = e.target.closest('.realtime-detail-tab');
        if (!tab) return;

        // 更新选中状态
        captureHistoryRealtimeTabs.querySelectorAll('.realtime-detail-tab').forEach(t => {
            t.classList.remove('active');
        });
        tab.classList.add('active');

        // 渲染对应的内容
        const tabType = tab.dataset.tab;
        renderRealtimeDetailTab(tabType);
    }

    /**
     * 渲染全流量抓包Tab内容
     * @param {string} tabType - Tab类型: info, payload, hex, raw
     */
    function renderRealtimeDetailTab(tabType) {
        if (captureState.historySelectedPacketIndex < 0) return;
        const packet = captureState.historyPackets[captureState.historySelectedPacketIndex];
        if (!packet || !captureHistoryPacketDetailContent) return;

        let html = '';

        switch (tabType) {
            case 'info':
                html = renderRealtimeInfoTab(packet);
                break;
            case 'payload':
                html = renderRealtimePayloadTab(packet);
                break;
            case 'hex':
                html = renderRealtimeHexTab(packet);
                break;
            case 'raw':
                html = renderRealtimeRawTab(packet);
                break;
        }

        captureHistoryPacketDetailContent.innerHTML = html;
    }

    /**
     * 渲染基本信息Tab
     */
    function renderRealtimeInfoTab(packet) {
        let html = '<div class="realtime-tab-content info-content">';
        html += '<table class="info-table">';
        html += `<tr><td class="info-label">帧序号</td><td class="info-value">${packet.id || '-'}</td></tr>`;
        html += `<tr><td class="info-label">捕获时间</td><td class="info-value">${escapeHtml(packet.timestamp || packet.time || '-')}</td></tr>`;
        html += `<tr><td class="info-label">帧长度</td><td class="info-value">${packet.length || 0} bytes</td></tr>`;
        html += `<tr><td class="info-label">协议</td><td class="info-value">${escapeHtml(packet.protocol || '-')}</td></tr>`;
        html += `<tr><td class="info-label">方向</td><td class="info-value">${escapeHtml(packet.direction || '-')}</td></tr>`;
        html += `<tr><td class="info-label">源地址</td><td class="info-value">${escapeHtml(packet.src_addr || '-')}:${packet.src_port || 0}</td></tr>`;
        html += `<tr><td class="info-label">目的地址</td><td class="info-value">${escapeHtml(packet.dst_addr || '-')}:${packet.dst_port || 0}</td></tr>`;
        if (packet.flags) {
            html += `<tr><td class="info-label">标志</td><td class="info-value">${escapeHtml(packet.flags)}</td></tr>`;
        }
        if (packet.info) {
            html += `<tr><td class="info-label">信息</td><td class="info-value">${escapeHtml(packet.info)}</td></tr>`;
        }
        html += '</table></div>';
        return html;
    }

    /**
     * 渲染Payload Tab
     */
    function renderRealtimePayloadTab(packet) {
        let html = '<div class="realtime-tab-content payload-content">';
        if (packet.payload && packet.payload.trim()) {
            html += `<pre class="payload-pre">${escapeHtml(packet.payload)}</pre>`;
        } else {
            html += '<div class="tab-empty">无可解码的 Payload 数据</div>';
        }
        html += '</div>';
        return html;
    }

    /**
     * 渲染Hex Dump Tab
     */
    function renderRealtimeHexTab(packet) {
        let html = '<div class="realtime-tab-content hex-content">';
        if (packet.hex_dump) {
            html += '<div class="hex-view-container">';
            const hexLines = packet.hex_dump.split('\n');
            const asciiLines = packet.ascii_dump ? packet.ascii_dump.split('\n') : [];
            let offset = 0;
            for (let i = 0; i < hexLines.length; i++) {
                const hexLine = hexLines[i] || '';
                const asciiLine = asciiLines[i] || '';
                const offsetStr = offset.toString(16).toUpperCase().padStart(4, '0');
                html += `<div class="hex-line">`;
                html += `<span class="hex-offset">${offsetStr}</span>`;
                html += `<span class="hex-bytes">${escapeHtml(hexLine)}</span>`;
                html += `<span class="hex-ascii">${escapeHtml(asciiLine)}</span>`;
                html += `</div>`;
                offset += 16;
            }
            html += '</div>';
        } else {
            html += '<div class="tab-empty">此记录无十六进制数据（旧版本抓取的记录不包含此数据）</div>';
        }
        html += '</div>';
        return html;
    }

    /**
     * 渲染Raw Tab
     */
    function renderRealtimeRawTab(packet) {
        let html = '<div class="realtime-tab-content raw-content">';
        if (packet.raw) {
            html += `<pre class="raw-pre">${escapeHtml(packet.raw)}</pre>`;
        } else {
            html += '<div class="tab-empty">无原始数据</div>';
        }
        html += '</div>';
        return html;
    }

    // ===================== 新增功能函数 =====================

    /**
     * 处理抓包类型点击
     * @param {Event} e - 点击事件
     */
    function handleCaptureTypeClick(e) {
        const item = e.target.closest('.capture-type-item');
        if (!item) return;

        // 更新选中状态
        captureTypeList.querySelectorAll('.capture-type-item').forEach(i => {
            i.classList.remove('selected');
        });
        item.classList.add('selected');

        // 更新状态
        captureState.captureType = item.dataset.type;

        // 根据抓包类型更新UI
        updateCaptureTypeUI();
    }

    /**
     * 根据抓包类型更新UI
     */
    function updateCaptureTypeUI() {
        const isRealtime = captureState.captureType === 'realtime';
        const isTcpdump = captureState.captureType === 'tcpdump';
        const isProxy = captureState.captureType === 'proxy';
        const isHook = captureState.captureType === 'r0capture';

        // tcpdump、proxy、realtime不需要选择辅助脚本（辅助脚本是Frida脚本），直接隐藏
        const scriptsSection = captureScriptsCategories?.closest('.capture-scripts-section');
        if (scriptsSection) {
            const hideAuxScripts = isTcpdump || isProxy || isRealtime;
            scriptsSection.style.display = hideAuxScripts ? 'none' : 'block';
        }

        // 只有r0capture需要Spawn模式
        const spawnModeContainer = captureSpawnMode?.closest('.capture-options');
        if (spawnModeContainer) {
            spawnModeContainer.style.display = isHook ? 'block' : 'none';
        }

        // 全流量抓包显示专用目标选择，其他类型显示原来的目标选择
        const targetSection = captureTargetSelect?.closest('.capture-target-section');
        if (targetSection) {
            targetSection.style.display = (isProxy || isRealtime) ? 'none' : 'block';
        }

        // 全流量抓包目标选择区域
        if (captureRealtimeTarget) {
            if (isRealtime) {
                captureRealtimeTarget.classList.remove('hidden');
            } else {
                captureRealtimeTarget.classList.add('hidden');
            }
        }

        // 代理设置面板显示/隐藏
        if (captureProxySettings) {
            if (isProxy) {
                captureProxySettings.classList.remove('hidden');
                // 获取本机IP
                loadLocalIp();
                // 检测mitmproxy环境
                checkMitmproxyEnv();
            } else {
                captureProxySettings.classList.add('hidden');
            }
        }

        // 更新按钮状态
        updateCaptureButtons();
    }

    /**
     * 绑定对话框事件
     */
    function bindDialogEvents() {
        // 辅助脚本保存对话框
        const auxDialogClose = document.getElementById('aux-script-dialog-close');
        const auxUseTempBtn = document.getElementById('aux-use-temp-btn');
        const auxSavePermanentBtn = document.getElementById('aux-save-permanent-btn');

        if (auxDialogClose) {
            auxDialogClose.addEventListener('click', () => {
                auxScriptSaveDialog.classList.add('hidden');
            });
        }

        if (auxUseTempBtn) {
            auxUseTempBtn.addEventListener('click', handleUseTempScript);
        }

        if (auxSavePermanentBtn) {
            auxSavePermanentBtn.addEventListener('click', () => {
                auxScriptSaveDialog.classList.add('hidden');
                auxScriptInfoDialog.classList.remove('hidden');
            });
        }

        // 辅助脚本信息填写对话框
        const auxInfoDialogClose = document.getElementById('aux-script-info-dialog-close');
        const auxInfoCancelBtn = document.getElementById('aux-info-cancel-btn');
        const auxInfoSaveBtn = document.getElementById('aux-info-save-btn');

        if (auxInfoDialogClose) {
            auxInfoDialogClose.addEventListener('click', () => {
                auxScriptInfoDialog.classList.add('hidden');
            });
        }

        if (auxInfoCancelBtn) {
            auxInfoCancelBtn.addEventListener('click', () => {
                auxScriptInfoDialog.classList.add('hidden');
            });
        }

        if (auxInfoSaveBtn) {
            auxInfoSaveBtn.addEventListener('click', handleSaveAuxScript);
        }

        // 返回确认对话框
        const backDialogClose = document.getElementById('capture-back-dialog-close');
        const backCancelBtn = document.getElementById('capture-back-cancel-btn');
        const backConfirmBtn = document.getElementById('capture-back-confirm-btn');

        if (backDialogClose) {
            backDialogClose.addEventListener('click', () => {
                captureBackConfirmDialog.classList.add('hidden');
            });
        }

        if (backCancelBtn) {
            backCancelBtn.addEventListener('click', () => {
                captureBackConfirmDialog.classList.add('hidden');
            });
        }

        if (backConfirmBtn) {
            backConfirmBtn.addEventListener('click', async () => {
                captureBackConfirmDialog.classList.add('hidden');
                await handleStopCapture();
                switchToSetupPage();
            });
        }
    }

    /**
     * 处理返回按钮点击
     */
    function handleCaptureBack() {
        if (captureState.capturing) {
            // 正在抓包，显示确认对话框
            captureBackConfirmDialog.classList.remove('hidden');
        } else {
            // 没有抓包，直接返回
            switchToSetupPage();
        }
    }

    /**
     * 切换到选择页面
     */
    function switchToSetupPage() {
        if (captureSetupPage) captureSetupPage.classList.remove('hidden');
        if (captureRunningPage) captureRunningPage.classList.add('hidden');
    }

    /**
     * 切换到抓包运行页面
     */
    function switchToRunningPage() {
        if (captureSetupPage) captureSetupPage.classList.add('hidden');
        if (captureRunningPage) captureRunningPage.classList.remove('hidden');
    }

    // ===================== 辅助脚本功能 =====================

    /**
     * 脚本分类名称映射
     */
    const categoryNames = {
        'bypass': '绕过检测',
        'traffic': '流量控制',
        'intercept': '行为拦截',
        'helper': '应用辅助'
    };

    /**
     * 加载辅助脚本列表
     */
    async function loadAuxScripts() {
        if (!captureScriptsCategories) return;

        try {
            const result = await invoke('get_aux_scripts');
            if (result.success) {
                captureState.auxScripts = result.scripts || [];
                renderAuxScripts();
            } else {
                captureScriptsCategories.innerHTML = '<div class="capture-scripts-error">加载脚本失败</div>';
            }
        } catch (error) {
            console.error('加载辅助脚本失败:', error);
            captureScriptsCategories.innerHTML = '<div class="capture-scripts-error">加载脚本失败</div>';
        }
    }

    /**
     * 渲染辅助脚本列表
     */
    function renderAuxScripts() {
        if (!captureScriptsCategories) return;

        // 按分类分组
        const categorized = {};
        captureState.auxScripts.forEach(script => {
            const cat = script.category || 'other';
            if (!categorized[cat]) {
                categorized[cat] = [];
            }
            categorized[cat].push(script);
        });

        let html = '';

        // 按固定顺序渲染分类
        const categoryOrder = ['bypass', 'traffic', 'intercept', 'helper'];
        categoryOrder.forEach(cat => {
            if (categorized[cat] && categorized[cat].length > 0) {
                html += renderScriptCategory(cat, categorized[cat]);
            }
        });

        // 渲染其他分类（如果有）
        Object.keys(categorized).forEach(cat => {
            if (!categoryOrder.includes(cat) && categorized[cat].length > 0) {
                html += renderScriptCategory(cat, categorized[cat]);
            }
        });

        if (!html) {
            html = '<div class="capture-scripts-empty">暂无辅助脚本</div>';
        }

        captureScriptsCategories.innerHTML = html;

        // 绑定脚本选择事件
        captureScriptsCategories.querySelectorAll('.capture-script-item').forEach(item => {
            item.addEventListener('click', () => toggleAuxScript(item.dataset.id));
        });

        // 绑定分类折叠事件
        captureScriptsCategories.querySelectorAll('.capture-scripts-category-header').forEach(header => {
            header.addEventListener('click', () => {
                const category = header.closest('.capture-scripts-category');
                category.classList.toggle('collapsed');
            });
        });
    }

    /**
     * 渲染单个脚本分类
     * @param {string} category - 分类ID
     * @param {Array} scripts - 该分类下的脚本列表
     * @returns {string} HTML字符串
     */
    function renderScriptCategory(category, scripts) {
        const categoryName = categoryNames[category] || category;
        let html = `
            <div class="capture-scripts-category" data-category="${category}">
                <div class="capture-scripts-category-header">
                    <span class="category-icon">▼</span>
                    <span class="category-name">${categoryName}</span>
                    <span class="category-count">${scripts.length}</span>
                </div>
                <div class="capture-scripts-category-content">
        `;

        scripts.forEach(script => {
            const isSelected = captureState.selectedAuxScripts.includes(script.id);
            html += `
                <div class="capture-script-item ${isSelected ? 'selected' : ''}" data-id="${script.id}">
                    <div class="script-checkbox ${isSelected ? 'checked' : ''}"></div>
                    <div class="script-info">
                        <div class="script-name">${escapeHtml(script.name)}</div>
                        <div class="script-desc">${escapeHtml(script.description || '')}</div>
                    </div>
                </div>
            `;
        });

        html += '</div></div>';
        return html;
    }

    /**
     * 切换辅助脚本选中状态
     * @param {string} scriptId - 脚本ID
     */
    function toggleAuxScript(scriptId) {
        const index = captureState.selectedAuxScripts.indexOf(scriptId);
        if (index >= 0) {
            captureState.selectedAuxScripts.splice(index, 1);
        } else {
            captureState.selectedAuxScripts.push(scriptId);
        }
        renderAuxScripts();
    }

    /**
     * 处理添加辅助脚本按钮点击
     */
    async function handleAddAuxScript() {
        try {
            // 调用后端打开文件选择对话框
            const result = await invoke('select_script_file');
            if (result.success && result.path) {
                captureState.tempAuxScript = result.path;
                // 显示保存确认对话框
                const pathDisplay = document.getElementById('aux-script-path-display');
                if (pathDisplay) {
                    pathDisplay.textContent = result.path;
                }
                auxScriptSaveDialog.classList.remove('hidden');
            }
        } catch (error) {
            console.error('选择脚本文件失败:', error);
            toast.show({ text: '选择脚本文件失败', color: 'error', duration: 3000 });
        }
    }

    /**
     * 处理仅本次使用脚本
     */
    function handleUseTempScript() {
        auxScriptSaveDialog.classList.add('hidden');
        if (captureState.tempAuxScript) {
            // 添加到临时选中列表
            const tempId = 'temp_' + Date.now();
            captureState.auxScripts.push({
                id: tempId,
                name: captureState.tempAuxScript.split(/[/\\]/).pop(),
                description: '临时脚本',
                category: 'helper',
                path: captureState.tempAuxScript,
                isTemp: true
            });
            captureState.selectedAuxScripts.push(tempId);
            renderAuxScripts();
            toast.show({ text: '已添加临时脚本', color: 'success', duration: 2000 });
        }
    }

    /**
     * 处理保存辅助脚本
     */
    async function handleSaveAuxScript() {
        const nameInput = document.getElementById('aux-script-name');
        const idInput = document.getElementById('aux-script-id');
        const descInput = document.getElementById('aux-script-desc');
        const categorySelect = document.getElementById('aux-script-category');

        const name = nameInput?.value?.trim();
        const id = idInput?.value?.trim();
        const description = descInput?.value?.trim() || '';
        const category = categorySelect?.value || 'helper';

        if (!name) {
            toast.show({ text: '请输入脚本名称', color: 'warning', duration: 2000 });
            return;
        }

        if (!id) {
            toast.show({ text: '请输入脚本ID', color: 'warning', duration: 2000 });
            return;
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
            toast.show({ text: '脚本ID只能包含字母、数字和下划线，且不能以数字开头', color: 'warning', duration: 3000 });
            return;
        }

        try {
            const result = await invoke('save_aux_script', {
                sourcePath: captureState.tempAuxScript,
                scriptId: id,
                scriptName: name,
                description: description,
                category: category
            });

            if (result.success) {
                auxScriptInfoDialog.classList.add('hidden');
                toast.show({ text: '脚本已保存', color: 'success', duration: 2000 });
                // 清空表单
                if (nameInput) nameInput.value = '';
                if (idInput) idInput.value = '';
                if (descInput) descInput.value = '';
                // 重新加载脚本列表
                await loadAuxScripts();
                // 自动选中新添加的脚本
                captureState.selectedAuxScripts.push(id);
                renderAuxScripts();
            } else {
                toast.show({ text: result.message || '保存脚本失败', color: 'error', duration: 3000 });
            }
        } catch (error) {
            console.error('保存脚本失败:', error);
            toast.show({ text: '保存脚本失败', color: 'error', duration: 3000 });
        }
    }

    // ===================== 抓包记录弹出层功能 =====================

    /**
     * 打开抓包记录弹出层
     */
    async function openCaptureHistory() {
        if (captureHistoryOverlay) {
            captureHistoryOverlay.classList.remove('hidden');

            // 重置状态
            captureState.historySelectedSessionId = null;
            captureState.historySelectedSessionType = null;
            captureState.historyPackets = [];
            captureState.historySelectedPacketIndex = -1;

            // 初始隐藏标签栏（等选择会话后根据类型决定是否显示）
            const historyDetailTabs = document.querySelector('#capture-history-packet-detail .packet-detail-tabs');
            if (historyDetailTabs) historyDetailTabs.style.display = 'none';

            // 清空数据包列表和详情
            if (captureHistoryPacketsBody) captureHistoryPacketsBody.innerHTML = '';
            if (captureHistoryPacketsPlaceholder) captureHistoryPacketsPlaceholder.style.display = 'flex';
            if (captureHistoryPacketDetailContent) {
                captureHistoryPacketDetailContent.innerHTML = '<div class="packet-detail-placeholder">点击左侧数据包查看详情</div>';
            }
            if (captureHistoryPacketsTitle) captureHistoryPacketsTitle.textContent = '数据包列表';

            await loadHistorySessions();
        }
    }

    /**
     * 关闭抓包记录弹出层
     */
    function closeCaptureHistory() {
        if (captureHistoryOverlay) {
            captureHistoryOverlay.classList.add('hidden');
        }
    }

    /**
     * 显示历史记录加载状态
     * @param {boolean} show - 是否显示
     * @param {string} text - 加载文字
     */
    function showHistoryLoading(show, text = '加载中...') {
        let loadingOverlay = document.getElementById('capture-history-loading');
        if (show) {
            if (!loadingOverlay) {
                loadingOverlay = document.createElement('div');
                loadingOverlay.id = 'capture-history-loading';
                loadingOverlay.className = 'capture-history-loading';
                loadingOverlay.innerHTML = `
                    <div class="capture-history-loading-content">
                        <div class="capture-history-loading-spinner"></div>
                        <div class="capture-history-loading-text">${text}</div>
                    </div>
                `;
                const container = document.querySelector('.capture-history-container');
                if (container) {
                    container.appendChild(loadingOverlay);
                }
            } else {
                loadingOverlay.querySelector('.capture-history-loading-text').textContent = text;
                loadingOverlay.classList.remove('hidden');
            }
        } else {
            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
            }
        }
    }

    /**
     * 加载历史会话列表
     */
    async function loadHistorySessions() {
        if (!captureHistorySessions) return;

        const filterType = captureHistoryTypeFilter?.value || 'all';

        // 获取当前选中的APK目录
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        let allSessions = [];

        // 1. 加载全流量抓包记录（不需要选择APK）
        try {
            const realtimeResult = await invoke('get_realtime_sessions', {
                caseNumber: caseNumber
            });
            if (realtimeResult.success && realtimeResult.sessions) {
                allSessions = allSessions.concat(realtimeResult.sessions);
            }
        } catch (error) {
            console.error('加载全流量抓包记录失败:', error);
        }

        // 2. 如果选择了APK，加载该APK的抓包记录
        if (selectedApkIndex >= 0 && apkListData[selectedApkIndex]) {
            const apk = apkListData[selectedApkIndex];
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

            try {
                const result = await invoke('get_capture_sessions', {
                    apkDir: apkDir
                });
                if (result.success && result.sessions) {
                    allSessions = allSessions.concat(result.sessions);
                }
            } catch (error) {
                console.error('加载APK抓包记录失败:', error);
            }
        }

        // 按时间排序
        allSessions.sort((a, b) => {
            const timeA = a.start_time || '';
            const timeB = b.start_time || '';
            return timeB.localeCompare(timeA);
        });

        // 客户端过滤类型
        if (filterType !== 'all') {
            allSessions = allSessions.filter(s => (s.capture_type || s.captureType) === filterType);
        }

        if (allSessions.length === 0) {
            captureHistorySessions.innerHTML = '<div class="capture-history-placeholder">暂无抓包记录</div>';
        } else {
            renderHistorySessions(allSessions);
        }
    }

    /**
     * 渲染历史会话列表
     * @param {Array} sessions - 会话列表
     */
    function renderHistorySessions(sessions) {
        if (!captureHistorySessions) return;

        if (!sessions || sessions.length === 0) {
            captureHistorySessions.innerHTML = '<div class="capture-history-placeholder">暂无抓包记录</div>';
            return;
        }

        let html = '';
        sessions.forEach(session => {
            // 后端字段: session_id, package, start_time, spawn_mode, has_packets, has_pcap, capture_type
            const sid = session.session_id || '';
            const isSelected = captureState.historySelectedSessionId === sid;
            const captureType = session.capture_type || 'r0capture';
            let typeLabel;
            if (captureType === 'realtime') {
                typeLabel = '全流量';
            } else if (captureType === 'tcpdump') {
                typeLabel = 'TCP';
            } else {
                typeLabel = 'Hook';
            }
            const date = session.start_time || '';
            const target = session.package || '未知应用';
            const packetCount = session.packet_count ? `${session.packet_count}条` : (session.has_packets ? '有数据' : '无数据');

            // 对于全流量抓包，显示抓包目标信息
            let captureTargetLabel = '';
            if (captureType === 'realtime') {
                // session.package 存储的是包名或"全流量抓包"
                const pkg = session.package || '';
                if (pkg === '全流量抓包' || pkg === '' || pkg === '未知应用') {
                    captureTargetLabel = '全设备流量';
                } else {
                    captureTargetLabel = pkg;  // 显示包名
                }
            }

            html += `
                <div class="capture-history-session ${isSelected ? 'selected' : ''}" data-id="${sid}" data-type="${captureType}">
                    <div class="session-type-badge ${captureType}">${typeLabel}</div>
                    <div class="session-info">
                        <div class="session-target">${escapeHtml(target)}</div>
                        ${captureType === 'realtime' ? `<div class="session-capture-target">抓包目标: ${escapeHtml(captureTargetLabel)}</div>` : ''}
                        <div class="session-time">${escapeHtml(date)}</div>
                        <div class="session-stats">${packetCount}</div>
                    </div>
                    <button class="session-delete-btn" data-id="${sid}" data-type="${captureType}" title="删除">×</button>
                </div>
            `;
        });

        captureHistorySessions.innerHTML = html;

        // 绑定会话点击事件
        captureHistorySessions.querySelectorAll('.capture-history-session').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('session-delete-btn')) {
                    selectHistorySession(item.dataset.id, item.dataset.type);
                }
            });
        });

        // 绑定删除按钮事件
        captureHistorySessions.querySelectorAll('.session-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHistorySession(btn.dataset.id, btn.dataset.type);
            });
        });
    }

    /**
     * 选择历史会话
     * @param {string} sessionId - 会话ID
     * @param {string} captureType - 抓包类型（realtime, r0capture, tcpdump等）
     */
    async function selectHistorySession(sessionId, captureType) {
        captureState.historySelectedSessionId = sessionId;
        captureState.historySelectedSessionType = captureType; // 保存类型

        // 更新选中状态UI
        captureHistorySessions.querySelectorAll('.capture-history-session').forEach(item => {
            item.classList.toggle('selected', item.dataset.id === sessionId);
        });

        // 加载该会话的数据包
        await loadHistoryPackets(sessionId, captureType);
    }

    /**
     * 删除历史会话
     * @param {string} sessionId - 会话ID
     * @param {string} captureType - 抓包类型
     */
    async function deleteHistorySession(sessionId, captureType) {
        // 创建确认对话框
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-modal-content">
                <div class="confirm-modal-title">确认删除</div>
                <div class="confirm-modal-text">确定要删除这条抓包记录吗？此操作无法撤销。</div>
                <div class="confirm-modal-buttons">
                    <button class="confirm-modal-btn cancel">取消</button>
                    <button class="confirm-modal-btn delete">删除</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 取消按钮
        modal.querySelector('.cancel').addEventListener('click', () => {
            modal.remove();
        });

        // 删除按钮
        modal.querySelector('.delete').addEventListener('click', async () => {
            modal.remove();

            try {
                let result;
                if (captureType === 'realtime') {
                    // 全流量抓包使用专用删除接口
                    result = await invoke('delete_realtime_session', {
                        caseNumber: caseNumber,
                        sessionId: sessionId
                    });
                } else {
                    // 其他类型需要APK目录
                    const apkListData = getApkListData();
                    const selectedApkIndex = getSelectedApkIndex();
                    if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
                        toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
                        return;
                    }
                    const apk = apkListData[selectedApkIndex];
                    const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
                    result = await invoke('delete_capture_session', {
                        apkDir: apkDir,
                        sessionId: sessionId
                    });
                }

                if (result.success) {
                    toast.show({ text: '已删除', color: 'success', duration: 2000 });
                    // 如果删除的是当前选中的会话，清空数据包列表
                    if (captureState.historySelectedSessionId === sessionId) {
                        captureState.historySelectedSessionId = null;
                        captureState.historyPackets = [];
                        if (captureHistoryPacketsBody) captureHistoryPacketsBody.innerHTML = '';
                        if (captureHistoryPacketsPlaceholder) {
                            captureHistoryPacketsPlaceholder.style.display = 'flex';
                        }
                    }
                    await loadHistorySessions();
                } else {
                    toast.show({ text: result.message || '删除失败', color: 'error', duration: 3000 });
                }
            } catch (error) {
                console.error('删除会话失败:', error);
                toast.show({ text: '删除失败', color: 'error', duration: 3000 });
            }
        });

        // 点击蒙层关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    /**
     * 加载历史会话的数据包
     * @param {string} sessionId - 会话ID
     * @param {string} captureType - 抓包类型
     */
    async function loadHistoryPackets(sessionId, captureType) {
        if (!captureHistoryPacketsBody) return;

        // 显示加载状态
        showHistoryLoading(true, '加载数据包...');

        try {
            let result;
            if (captureType === 'realtime') {
                // 全流量抓包使用专用接口
                result = await invoke('get_realtime_session_packets', {
                    caseNumber: caseNumber,
                    sessionId: sessionId
                });
            } else {
                // 其他类型需要APK目录
                const apkListData = getApkListData();
                const selectedApkIndex = getSelectedApkIndex();

                if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
                    return;
                }

                const apk = apkListData[selectedApkIndex];
                const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
                result = await invoke('get_capture_packets', {
                    apkDir: apkDir,
                    sessionId: sessionId
                });
            }

            if (result.success) {
                captureState.historyPackets = result.packets || [];
                // 根据类型选择不同的渲染方式
                if (captureType === 'realtime') {
                    renderHistoryRealtimePackets();
                } else {
                    renderHistoryPackets();
                }

                if (captureHistoryPacketsTitle) {
                    captureHistoryPacketsTitle.textContent = `数据包列表 (${captureState.historyPackets.length})`;
                }
            } else {
                captureHistoryPacketsBody.innerHTML = '';
                if (captureHistoryPacketsPlaceholder) {
                    captureHistoryPacketsPlaceholder.innerHTML = '<span>加载数据包失败</span>';
                    captureHistoryPacketsPlaceholder.style.display = 'flex';
                }
            }
        } catch (error) {
            console.error('加载历史数据包失败:', error);
        } finally {
            // 隐藏加载状态
            showHistoryLoading(false);
        }
    }

    /**
     * 渲染历史全流量数据包列表
     */
    function renderHistoryRealtimePackets() {
        if (!captureHistoryPacketsBody) return;

        // 更新表头为全流量格式
        const table = captureHistoryPacketsBody.closest('table');
        if (table) {
            const thead = table.querySelector('thead tr');
            if (thead) {
                thead.innerHTML = '<th class="col-no">#</th><th class="col-time">时间</th><th class="col-protocol">协议</th><th class="col-direction">方向</th><th class="col-src">源地址</th><th class="col-dst">目的地址</th><th class="col-length">长度</th><th class="col-info">信息</th>';
            }
        }

        // 隐藏HTTP的请求/响应/十六进制标签，显示全流量Tab
        const historyDetailTabs = document.querySelector('#capture-history-packet-detail .packet-detail-tabs');
        if (historyDetailTabs) historyDetailTabs.style.display = 'none';
        if (captureHistoryRealtimeTabs) captureHistoryRealtimeTabs.style.display = 'flex';

        const packets = captureState.historyPackets;

        if (!packets || packets.length === 0) {
            captureHistoryPacketsBody.innerHTML = '';
            if (captureHistoryPacketsPlaceholder) {
                captureHistoryPacketsPlaceholder.style.display = 'flex';
            }
            return;
        }

        if (captureHistoryPacketsPlaceholder) {
            captureHistoryPacketsPlaceholder.style.display = 'none';
        }

        let html = '';
        packets.forEach((packet, index) => {
            const directionClass = packet.direction === 'OUT' ? 'direction-out' :
                                   packet.direction === 'IN' ? 'direction-in' : '';
            const protocolClass = `protocol-${(packet.protocol || 'tcp').toLowerCase()}`;

            html += `<tr class="packet-row realtime-row" data-index="${index}">`;
            html += `<td class="col-no">${packet.id || index + 1}</td>`;
            html += `<td class="col-time">${escapeHtml(packet.time || '')}</td>`;
            html += `<td class="col-protocol"><span class="protocol-tag ${protocolClass}">${escapeHtml(packet.protocol || '-')}</span></td>`;
            html += `<td class="col-direction"><span class="direction-tag ${directionClass}">${escapeHtml(packet.direction || '-')}</span></td>`;
            html += `<td class="col-src" title="${escapeHtml(packet.src_addr || '')}:${packet.src_port || 0}">${escapeHtml(packet.src_addr || '-')}:${packet.src_port || 0}</td>`;
            html += `<td class="col-dst" title="${escapeHtml(packet.dst_addr || '')}:${packet.dst_port || 0}">${escapeHtml(packet.dst_addr || '-')}:${packet.dst_port || 0}</td>`;
            html += `<td class="col-length">${packet.length || 0}</td>`;
            html += `<td class="col-info" title="${escapeHtml(packet.info || '')}">${escapeHtml(packet.info || '')}</td>`;
            html += `</tr>`;
        });

        captureHistoryPacketsBody.innerHTML = html;

        // 绑定数据包点击事件
        captureHistoryPacketsBody.querySelectorAll('.packet-row').forEach(row => {
            row.addEventListener('click', () => {
                selectHistoryRealtimePacket(parseInt(row.dataset.index));
            });
        });
    }

    /**
     * 选择历史全流量数据包
     * @param {number} index - 数据包索引
     */
    function selectHistoryRealtimePacket(index) {
        captureState.historySelectedPacketIndex = index;

        // 更新选中状态
        captureHistoryPacketsBody.querySelectorAll('.packet-row').forEach((row, i) => {
            row.classList.toggle('selected', i === index);
        });

        // 重置Tab到第一个并渲染
        if (captureHistoryRealtimeTabs) {
            captureHistoryRealtimeTabs.querySelectorAll('.realtime-detail-tab').forEach((t, i) => {
                t.classList.toggle('active', i === 0);
            });
        }

        // 渲染基本信息Tab（默认）
        renderRealtimeDetailTab('info');
    }

    /**
     * 渲染历史数据包列表
     */
    function renderHistoryPackets() {
        if (!captureHistoryPacketsBody) return;

        // 恢复表头为HTTP格式
        const table = captureHistoryPacketsBody.closest('table');
        if (table) {
            const thead = table.querySelector('thead tr');
            if (thead) {
                thead.innerHTML = '<th class="col-no">#</th><th class="col-time">时间</th><th class="col-method">方法</th><th class="col-host">主机</th><th class="col-path">路径</th><th class="col-status">状态</th><th class="col-size">大小</th>';
            }
        }

        // 显示历史记录的请求/响应/十六进制标签，隐藏全流量Tab
        const historyDetailTabs = document.querySelector('#capture-history-packet-detail .packet-detail-tabs');
        if (historyDetailTabs) historyDetailTabs.style.display = '';
        if (captureHistoryRealtimeTabs) captureHistoryRealtimeTabs.style.display = 'none';

        const packets = captureState.historyPackets;

        if (!packets || packets.length === 0) {
            captureHistoryPacketsBody.innerHTML = '';
            if (captureHistoryPacketsPlaceholder) {
                captureHistoryPacketsPlaceholder.style.display = 'flex';
            }
            return;
        }

        if (captureHistoryPacketsPlaceholder) {
            captureHistoryPacketsPlaceholder.style.display = 'none';
        }

        let html = '';
        packets.forEach((packet, index) => {
            const time = new Date(packet.timestamp).toLocaleTimeString();
            const statusClass = getStatusClass(packet.status);

            html += `
                <tr class="packet-row" data-index="${index}">
                    <td class="col-no">${index + 1}</td>
                    <td class="col-time">${time}</td>
                    <td class="col-method">${escapeHtml(packet.method || '-')}</td>
                    <td class="col-host">${escapeHtml(packet.host || '-')}</td>
                    <td class="col-path" title="${escapeHtml(packet.path || '')}">${escapeHtml(packet.path || '-')}</td>
                    <td class="col-status ${statusClass}">${packet.status || '-'}</td>
                    <td class="col-size">${formatSize(packet.size)}</td>
                </tr>
            `;
        });

        captureHistoryPacketsBody.innerHTML = html;

        // 绑定数据包点击事件
        captureHistoryPacketsBody.querySelectorAll('.packet-row').forEach(row => {
            row.addEventListener('click', () => {
                selectHistoryPacket(parseInt(row.dataset.index));
            });
        });
    }

    /**
     * 选择历史数据包
     * @param {number} index - 数据包索引
     */
    function selectHistoryPacket(index) {
        captureState.historySelectedPacketIndex = index;

        // 更新选中状态
        captureHistoryPacketsBody.querySelectorAll('.packet-row').forEach((row, i) => {
            row.classList.toggle('selected', i === index);
        });

        // 渲染详情
        const packet = captureState.historyPackets[index];
        if (packet) {
            const activeTab = document.querySelector('#capture-history-packet-detail .packet-detail-tab.active');
            renderPacketDetail(packet, activeTab?.dataset.tab || 'request', captureHistoryPacketDetailContent);
        }
    }

    /**
     * 处理历史记录数据包过滤
     */
    function handleHistoryPacketFilter() {
        const filter = captureHistoryFilterInput?.value?.toLowerCase() || '';
        captureHistoryPacketsBody.querySelectorAll('.packet-row').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
        });
    }

    /**
     * 在文件夹中打开抓包记录
     */
    async function handleOpenCaptureFolder() {
        if (!captureState.historySelectedSessionId) {
            toast.show({ text: '请先选择一个抓包记录', color: 'warning', duration: 2000 });
            return;
        }

        try {
            const result = await invoke('open_capture_folder', {
                caseNumber: caseNumber,
                sessionId: captureState.historySelectedSessionId,
                captureType: captureState.historySelectedSessionType || 'r0capture'
            });

            if (result.success) {
                toast.show({ text: '已打开文件夹', color: 'success', duration: 2000 });
            } else {
                toast.show({ text: result.message || '打开失败', color: 'error', duration: 3000 });
            }
        } catch (error) {
            console.error('打开文件夹失败:', error);
            toast.show({ text: '打开文件夹失败: ' + error, color: 'error', duration: 3000 });
        }
    }

    // ===================== 代理抓包功能 =====================

    /**
     * 检测mitmproxy环境
     */
    async function checkMitmproxyEnv() {
        if (proxyEnvIcon) proxyEnvIcon.textContent = '🔄';
        if (proxyEnvValue) {
            proxyEnvValue.textContent = '检测中...';
            proxyEnvValue.className = 'proxy-env-value loading';
        }
        if (proxyInstallMitmproxyBtn) proxyInstallMitmproxyBtn.style.display = 'none';

        try {
            const result = await invoke('check_mitmproxy_env');

            if (result.ready) {
                captureState.mitmproxyReady = true;
                if (proxyEnvIcon) proxyEnvIcon.textContent = '🟢';
                if (proxyEnvValue) {
                    proxyEnvValue.textContent = `v${result.version}`;
                    proxyEnvValue.className = 'proxy-env-value ready';
                }
                if (proxyInstallMitmproxyBtn) proxyInstallMitmproxyBtn.style.display = 'none';
            } else {
                captureState.mitmproxyReady = false;
                if (proxyEnvIcon) proxyEnvIcon.textContent = '🔴';
                if (proxyEnvValue) {
                    proxyEnvValue.textContent = '未安装';
                    proxyEnvValue.className = 'proxy-env-value error';
                }
                if (proxyInstallMitmproxyBtn) proxyInstallMitmproxyBtn.style.display = 'inline-block';
            }
        } catch (error) {
            console.error('检测mitmproxy环境失败:', error);
            captureState.mitmproxyReady = false;
            if (proxyEnvIcon) proxyEnvIcon.textContent = '🔴';
            if (proxyEnvValue) {
                proxyEnvValue.textContent = '检测失败';
                proxyEnvValue.className = 'proxy-env-value error';
            }
            if (proxyInstallMitmproxyBtn) proxyInstallMitmproxyBtn.style.display = 'inline-block';
        }

        updateCaptureButtons();
    }

    /**
     * 安装mitmproxy
     */
    async function handleInstallMitmproxy() {
        if (proxyInstallMitmproxyBtn) {
            proxyInstallMitmproxyBtn.disabled = true;
            proxyInstallMitmproxyBtn.textContent = '安装中...';
            proxyInstallMitmproxyBtn.classList.add('installing');
        }
        if (proxyEnvIcon) proxyEnvIcon.textContent = '🔄';
        if (proxyEnvValue) {
            proxyEnvValue.textContent = '正在启动安装...';
            proxyEnvValue.className = 'proxy-env-value loading';
        }

        toast.show({ text: '正在安装mitmproxy，请稍候...', color: 'info', duration: 3000 });

        try {
            const result = await invoke('install_mitmproxy');

            if (result.success && result.installing) {
                // 开始轮询安装进度
                startMitmproxyInstallPolling();
            } else if (!result.success) {
                toast.show({ text: result.message || '安装失败', color: 'error', duration: 5000 });
                resetMitmproxyInstallUI('安装失败');
            }
        } catch (error) {
            console.error('安装mitmproxy失败:', error);
            toast.show({ text: `安装失败: ${error}`, color: 'error', duration: 5000 });
            resetMitmproxyInstallUI('安装失败');
        }
    }

    /**
     * 重置mitmproxy安装UI
     */
    function resetMitmproxyInstallUI(errorText = null) {
        if (proxyInstallMitmproxyBtn) {
            proxyInstallMitmproxyBtn.disabled = false;
            proxyInstallMitmproxyBtn.textContent = '安装mitmproxy';
            proxyInstallMitmproxyBtn.classList.remove('installing');
        }
        if (errorText) {
            if (proxyEnvIcon) proxyEnvIcon.textContent = '🔴';
            if (proxyEnvValue) {
                proxyEnvValue.textContent = errorText;
                proxyEnvValue.className = 'proxy-env-value error';
            }
        }
    }

    // mitmproxy安装轮询定时器
    let mitmproxyInstallTimer = null;

    /**
     * 开始轮询mitmproxy安装进度
     */
    function startMitmproxyInstallPolling() {
        // 清除已有定时器
        if (mitmproxyInstallTimer) {
            clearInterval(mitmproxyInstallTimer);
        }

        mitmproxyInstallTimer = setInterval(async () => {
            try {
                const status = await invoke('get_mitmproxy_install_status');

                // 更新当前步骤显示
                if (proxyEnvValue && status.current_step) {
                    // 截取显示，避免太长
                    let stepText = status.current_step;
                    if (stepText.length > 40) {
                        stepText = stepText.substring(0, 40) + '...';
                    }
                    proxyEnvValue.textContent = stepText;
                }

                if (status.completed) {
                    // 安装完成
                    clearInterval(mitmproxyInstallTimer);
                    mitmproxyInstallTimer = null;
                    toast.show({ text: 'mitmproxy安装成功！', color: 'success', duration: 3000 });
                    // 重新检测环境
                    await checkMitmproxyEnv();
                    resetMitmproxyInstallUI();
                } else if (status.error) {
                    // 安装出错
                    clearInterval(mitmproxyInstallTimer);
                    mitmproxyInstallTimer = null;
                    toast.show({ text: '安装失败，请查看日志', color: 'error', duration: 5000 });
                    resetMitmproxyInstallUI('安装失败');
                    console.error('mitmproxy安装日志:', status.log);
                }
                // 否则继续轮询
            } catch (error) {
                console.error('获取安装状态失败:', error);
            }
        }, 1500); // 每1.5秒检查一次
    }

    /**
     * 加载本机IP地址
     */
    async function loadLocalIp() {
        if (proxyLocalIp) {
            proxyLocalIp.textContent = '获取中...';
        }

        try {
            const result = await invoke('get_local_ip');
            if (result.success && result.ip) {
                if (proxyLocalIp) {
                    proxyLocalIp.textContent = result.ip;
                }
                updateProxyTipAddr();
            } else {
                if (proxyLocalIp) {
                    proxyLocalIp.textContent = '获取失败';
                }
            }
        } catch (error) {
            console.error('获取本机IP失败:', error);
            if (proxyLocalIp) {
                proxyLocalIp.textContent = '获取失败';
            }
        }
    }

    /**
     * 更新代理提示地址
     */
    function updateProxyTipAddr() {
        const ip = proxyLocalIp?.textContent || 'IP';
        const port = proxyPortInput?.value || '8080';
        if (proxyTipAddr) {
            proxyTipAddr.textContent = `${ip}:${port}`;
        }
    }

    /**
     * 复制代理IP地址
     */
    function handleCopyProxyIp() {
        const ip = proxyLocalIp?.textContent || '';
        const port = proxyPortInput?.value || '8080';
        const proxyAddr = `${ip}:${port}`;

        if (ip && ip !== '获取中...' && ip !== '获取失败') {
            navigator.clipboard.writeText(proxyAddr).then(() => {
                toast.show({ text: '已复制: ' + proxyAddr, color: 'success', duration: 2000 });
            }).catch(err => {
                console.error('复制失败:', err);
                toast.show({ text: '复制失败', color: 'error', duration: 2000 });
            });
        }
    }

    /**
     * 导出CA证书
     */
    async function handleExportCert() {
        try {
            const result = await invoke('export_proxy_cert');
            if (result.success) {
                toast.show({ text: '证书已导出: ' + result.path, color: 'success', duration: 3000 });
            } else {
                toast.show({ text: result.message || '导出证书失败', color: 'error', duration: 3000 });
            }
        } catch (error) {
            console.error('导出证书失败:', error);
            toast.show({ text: '导出证书失败: ' + error, color: 'error', duration: 3000 });
        }
    }

    /**
     * 推送证书到设备
     */
    async function handleInstallCert() {
        try {
            toast.show({ text: '正在推送证书到设备...', color: 'info', duration: 2000 });
            const result = await invoke('install_proxy_cert');
            if (result.success) {
                toast.show({ text: '证书已推送到设备，请在设备上手动安装', color: 'success', duration: 5000 });
            } else {
                toast.show({ text: result.message || '推送证书失败', color: 'error', duration: 3000 });
            }
        } catch (error) {
            console.error('推送证书失败:', error);
            toast.show({ text: '推送证书失败: ' + error, color: 'error', duration: 3000 });
        }
    }

    // ===================== 全流量抓包功能 =====================

    /**
     * 加载实时抓包数据（增量获取）
     */
    async function loadRealtimePackets() {
        if (!captureState.currentCaptureId) {
            console.log('[realtime] 无 captureId');
            return;
        }

        try {
            console.log('[realtime] 请求数据, captureId:', captureState.currentCaptureId, 'sinceId:', captureState.realtimeLastId);
            const result = await invoke('get_realtime_packets', {
                captureId: captureState.currentCaptureId,
                sinceId: captureState.realtimeLastId
            });

            console.log('[realtime] 响应:', result);

            if (result.success) {
                // 追加新数据包
                if (result.packets && result.packets.length > 0) {
                    console.log('[realtime] 新数据包数量:', result.packets.length);
                    captureState.realtimePackets = captureState.realtimePackets.concat(result.packets);
                    // 更新最后ID
                    const lastPacket = result.packets[result.packets.length - 1];
                    if (lastPacket && lastPacket.id) {
                        captureState.realtimeLastId = lastPacket.id;
                    }
                    // 限制本地缓存数量
                    if (captureState.realtimePackets.length > 5000) {
                        captureState.realtimePackets = captureState.realtimePackets.slice(-5000);
                    }
                }

                // 更新统计
                if (result.stats) {
                    updateRealtimeStats(result.stats);
                }

                // 渲染数据包
                console.log('[realtime] 渲染, 总数:', captureState.realtimePackets.length);
                renderRealtimePackets();

                // 更新标题
                if (packetsTitle) {
                    packetsTitle.textContent = `数据包列表 (${result.total || captureState.realtimePackets.length})`;
                }

                // 隐藏占位符
                if (captureState.realtimePackets.length > 0 && capturePacketsPlaceholder) {
                    capturePacketsPlaceholder.style.display = 'none';
                }

                // 检查是否仍在运行
                if (!result.running && captureState.capturing) {
                    captureState.capturing = false;
                    if (captureRunningStatus) {
                        captureRunningStatus.textContent = '已停止';
                    }
                    stopAutoRefreshPackets();
                }
            }
        } catch (error) {
            console.error('获取实时数据包失败:', error);
        }
    }

    /**
     * 更新实时抓包统计
     * @param {Object} stats - 统计数据
     */
    function updateRealtimeStats(stats) {
        const total = (stats.tcp || 0) + (stats.udp || 0) + (stats.dns || 0) +
                      (stats.http || 0) + (stats.https || 0) + (stats.other || 0);
        if (statTotal) statTotal.textContent = total;
        if (statTcp) statTcp.textContent = stats.tcp || 0;
        if (statUdp) statUdp.textContent = stats.udp || 0;
        if (statHttp) statHttp.textContent = stats.http || 0;
        if (statHttps) statHttps.textContent = stats.https || 0;
        if (statDns) statDns.textContent = stats.dns || 0;
    }

    /**
     * 渲染实时抓包数据包列表
     */
    function renderRealtimePackets() {
        console.log('[renderRealtime] realtimePacketsBody:', realtimePacketsBody);
        if (!realtimePacketsBody) {
            console.log('[renderRealtime] realtimePacketsBody 为空!');
            return;
        }

        // 根据过滤条件筛选
        let filteredPackets = captureState.realtimePackets;
        if (captureState.realtimeFilter && captureState.realtimeFilter !== 'all') {
            filteredPackets = captureState.realtimePackets.filter(p =>
                p.protocol === captureState.realtimeFilter
            );
        }

        // 只显示最后500条
        const displayPackets = filteredPackets.slice(-500);
        console.log('[renderRealtime] 显示数量:', displayPackets.length);

        let html = '';
        displayPackets.forEach((packet, index) => {
            const directionClass = packet.direction === 'OUT' ? 'direction-out' :
                                   packet.direction === 'IN' ? 'direction-in' : '';
            const protocolClass = `protocol-${packet.protocol.toLowerCase()}`;

            html += `
                <tr class="packet-row realtime-row" data-index="${index}">
                    <td class="col-no">${packet.id}</td>
                    <td class="col-time">${escapeHtml(packet.time || '')}</td>
                    <td class="col-protocol"><span class="protocol-tag ${protocolClass}">${escapeHtml(packet.protocol)}</span></td>
                    <td class="col-direction"><span class="direction-tag ${directionClass}">${escapeHtml(packet.direction || '-')}</span></td>
                    <td class="col-src" title="${escapeHtml(packet.src_addr)}:${packet.src_port}">${escapeHtml(packet.src_addr)}:${packet.src_port}</td>
                    <td class="col-dst" title="${escapeHtml(packet.dst_addr)}:${packet.dst_port}">${escapeHtml(packet.dst_addr)}:${packet.dst_port}</td>
                    <td class="col-length">${packet.length}</td>
                    <td class="col-info" title="${escapeHtml(packet.info || '')}">${escapeHtml(packet.info || '')}</td>
                </tr>
            `;
        });

        realtimePacketsBody.innerHTML = html;

        // 自动滚动到底部
        const wrapper = realtimePacketsWrapper;
        if (wrapper) {
            wrapper.scrollTop = wrapper.scrollHeight;
        }

        // 绑定行点击事件
        realtimePacketsBody.querySelectorAll('.packet-row').forEach(row => {
            row.addEventListener('click', () => {
                selectRealtimePacket(parseInt(row.dataset.index, 10));
            });
        });
    }

    /**
     * 选择实时数据包
     * @param {number} index - 数据包索引
     */
    function selectRealtimePacket(index) {
        // 更新选中状态
        if (realtimePacketsBody) {
            realtimePacketsBody.querySelectorAll('.packet-row').forEach((row, i) => {
                row.classList.toggle('selected', i === index);
            });
        }

        // 根据过滤条件获取对应的数据包
        let filteredPackets = captureState.realtimePackets;
        if (captureState.realtimeFilter && captureState.realtimeFilter !== 'all') {
            filteredPackets = captureState.realtimePackets.filter(p =>
                p.protocol === captureState.realtimeFilter
            );
        }
        const displayPackets = filteredPackets.slice(-500);
        const packet = displayPackets[index];

        if (packet && packetDetailContent) {
            // 显示类似 Wireshark 的详细视图
            let html = '<div class="realtime-packet-detail wireshark-view">';

            // === 帧信息 ===
            html += '<div class="detail-section frame-section">';
            html += '<div class="detail-section-title clickable" onclick="this.parentElement.classList.toggle(\'collapsed\')">▼ Frame Info</div>';
            html += '<div class="detail-section-content">';
            html += `<div class="detail-row"><span class="detail-label">帧序号:</span> ${packet.id || '-'}</div>`;
            html += `<div class="detail-row"><span class="detail-label">捕获时间:</span> ${escapeHtml(packet.timestamp || packet.time || '-')}</div>`;
            html += `<div class="detail-row"><span class="detail-label">帧长度:</span> ${packet.length || 0} bytes</div>`;
            html += '</div></div>';

            // === 网络层 ===
            html += '<div class="detail-section network-section">';
            html += '<div class="detail-section-title clickable" onclick="this.parentElement.classList.toggle(\'collapsed\')">▼ Internet Protocol</div>';
            html += '<div class="detail-section-content">';
            html += `<div class="detail-row"><span class="detail-label">源地址:</span> ${escapeHtml(packet.src_addr || '-')}</div>`;
            html += `<div class="detail-row"><span class="detail-label">目的地址:</span> ${escapeHtml(packet.dst_addr || '-')}</div>`;
            html += '</div></div>';

            // === 传输层 ===
            html += '<div class="detail-section transport-section">';
            html += `<div class="detail-section-title clickable" onclick="this.parentElement.classList.toggle('collapsed')">▼ ${escapeHtml(packet.protocol || 'TCP')}</div>`;
            html += '<div class="detail-section-content">';
            html += `<div class="detail-row"><span class="detail-label">源端口:</span> ${packet.src_port || 0}</div>`;
            html += `<div class="detail-row"><span class="detail-label">目的端口:</span> ${packet.dst_port || 0}</div>`;
            if (packet.flags) {
                html += `<div class="detail-row"><span class="detail-label">标志:</span> ${escapeHtml(packet.flags)}</div>`;
            }
            if (packet.info) {
                html += `<div class="detail-row"><span class="detail-label">信息:</span> ${escapeHtml(packet.info)}</div>`;
            }
            html += '</div></div>';

            // === Payload (可读内容) ===
            html += '<div class="detail-section payload-section">';
            html += '<div class="detail-section-title clickable" onclick="this.parentElement.classList.toggle(\'collapsed\')">▼ Payload (解码)</div>';
            html += '<div class="detail-section-content">';
            if (packet.payload && packet.payload.trim()) {
                html += `<pre class="detail-payload">${escapeHtml(packet.payload)}</pre>`;
            } else {
                html += '<div class="detail-empty">无可解码的 Payload 数据</div>';
            }
            html += '</div></div>';

            // === 十六进制视图 ===
            html += '<div class="detail-section hex-section">';
            html += '<div class="detail-section-title clickable" onclick="this.parentElement.classList.toggle(\'collapsed\')">▼ Hex Dump</div>';
            html += '<div class="detail-section-content">';
            if (packet.hex_dump) {
                html += '<div class="hex-view-container">';
                // 格式化十六进制和ASCII并排显示
                const hexLines = packet.hex_dump.split('\n');
                const asciiLines = packet.ascii_dump ? packet.ascii_dump.split('\n') : [];
                let offset = 0;
                for (let i = 0; i < hexLines.length; i++) {
                    const hexLine = hexLines[i] || '';
                    const asciiLine = asciiLines[i] || '';
                    const offsetStr = offset.toString(16).toUpperCase().padStart(4, '0');
                    html += `<div class="hex-line">`;
                    html += `<span class="hex-offset">${offsetStr}</span>`;
                    html += `<span class="hex-bytes">${escapeHtml(hexLine)}</span>`;
                    html += `<span class="hex-ascii">${escapeHtml(asciiLine)}</span>`;
                    html += `</div>`;
                    offset += 16;
                }
                html += '</div>';
            } else {
                html += '<div class="detail-empty">无十六进制数据</div>';
            }
            html += '</div></div>';

            // === 原始输出 ===
            if (packet.raw) {
                html += '<div class="detail-section raw-section collapsed">';
                html += '<div class="detail-section-title clickable" onclick="this.parentElement.classList.toggle(\'collapsed\')">▶ Raw Output</div>';
                html += '<div class="detail-section-content">';
                html += `<pre class="detail-raw">${escapeHtml(packet.raw)}</pre>`;
                html += '</div></div>';
            }

            html += '</div>';
            packetDetailContent.innerHTML = html;
        }
    }

    /**
     * 处理统计栏过滤点击
     * @param {Event} e - 点击事件
     */
    function handleStatsFilterClick(e) {
        const item = e.target.closest('.capture-stat-item');
        if (!item) return;

        const filter = item.dataset.filter;
        captureState.realtimeFilter = filter;

        // 更新选中状态
        if (captureStatsBar) {
            captureStatsBar.querySelectorAll('.capture-stat-item').forEach(i => {
                i.classList.toggle('active', i.dataset.filter === filter);
            });
        }

        // 重新渲染
        renderRealtimePackets();
    }

    // 暴露公共API
    return {
        init: init,
        checkFridaEnv: checkFridaEnv,
        checkFridaServerStatus: checkFridaServerStatus,
        updateCaptureButtons: updateCaptureButtons,
        loadDeviceApps: loadDeviceApps,
        loadCapturePackets: loadCapturePackets,
        startAutoRefreshPackets: startAutoRefreshPackets,
        stopAutoRefreshPackets: stopAutoRefreshPackets,
        // 新增API
        loadAuxScripts: loadAuxScripts,
        openCaptureHistory: openCaptureHistory,
        closeCaptureHistory: closeCaptureHistory
    };
})();
