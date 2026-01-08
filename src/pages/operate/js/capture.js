/**
 * 网络抓包模块 - 处理Frida环境管理和网络数据包捕获
 * 负责Frida环境检测/初始化、Frida Server管理、网络抓包、数据包查看等功能
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

    // DOM元素
    let fridaEnvStatus = null;
    let fridaServerStatus = null;
    let initFridaBtn = null;
    let startServerBtn = null;
    let stopServerBtn = null;
    let captureTargetSelect = null;
    let captureDeviceApps = null;
    let deviceAppSelect = null;
    let refreshAppsBtn = null;
    let captureSpawnMode = null;
    let startCaptureBtn = null;
    let stopCaptureBtn = null;
    let refreshSessionsBtn = null;
    let captureSessionsList = null;
    let packetsTitle = null;
    let packetsFilterInput = null;
    let capturePacketsBody = null;
    let capturePacketsPlaceholder = null;
    let capturePacketsTableWrapper = null;
    let capturePacketDetail = null;
    let packetDetailContent = null;
    let captureResizer = null;
    let captureLeft = null;
    let operationTabs = null;

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
        autoRefreshTimer: null
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
        fridaEnvStatus = document.getElementById('frida-env-status');
        fridaServerStatus = document.getElementById('frida-server-status');
        initFridaBtn = document.getElementById('init-frida-btn');
        startServerBtn = document.getElementById('start-server-btn');
        stopServerBtn = document.getElementById('stop-server-btn');
        captureTargetSelect = document.getElementById('capture-target-select');
        captureDeviceApps = document.getElementById('capture-device-apps');
        deviceAppSelect = document.getElementById('device-app-select');
        refreshAppsBtn = document.getElementById('refresh-apps-btn');
        captureSpawnMode = document.getElementById('capture-spawn-mode');
        startCaptureBtn = document.getElementById('start-capture-btn');
        stopCaptureBtn = document.getElementById('stop-capture-btn');
        refreshSessionsBtn = document.getElementById('refresh-sessions-btn');
        captureSessionsList = document.getElementById('capture-sessions-list');
        packetsTitle = document.getElementById('packets-title');
        packetsFilterInput = document.getElementById('packets-filter-input');
        capturePacketsBody = document.getElementById('capture-packets-body');
        capturePacketsPlaceholder = document.getElementById('capture-packets-placeholder');
        capturePacketsTableWrapper = document.querySelector('.capture-packets-table-wrapper');
        capturePacketDetail = document.getElementById('capture-packet-detail');
        packetDetailContent = document.getElementById('packet-detail-content');
        captureResizer = document.getElementById('capture-resizer');
        captureLeft = document.querySelector('.capture-left');
        operationTabs = document.querySelectorAll('.operation-tab');
    }

    /**
     * 绑定所有事件
     */
    function bindEvents() {
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

        // 开始抓包按钮
        if (startCaptureBtn) {
            startCaptureBtn.addEventListener('click', handleStartCapture);
        }

        // 停止抓包按钮
        if (stopCaptureBtn) {
            stopCaptureBtn.addEventListener('click', handleStopCapture);
        }

        // 刷新会话列表按钮
        if (refreshSessionsBtn) {
            refreshSessionsBtn.addEventListener('click', loadSessions);
        }

        // 过滤数据包
        if (packetsFilterInput) {
            packetsFilterInput.addEventListener('input', handlePacketFilter);
        }

        // 数据包详情标签切换
        document.querySelectorAll('.packet-detail-tab').forEach(tab => {
            tab.addEventListener('click', () => handleTabSwitch(tab));
        });

        // 拖拽调整抓包面板大小
        if (captureResizer) {
            captureResizer.addEventListener('mousedown', startCaptureResize);
        }

        // 切换到抓包面板时初始化
        if (operationTabs) {
            operationTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    if (tab.dataset.tab === 'capture') {
                        checkFridaEnv();
                        loadSessions();
                    }
                });
            });
        }
    }

    // ===================== 自动刷新功能 =====================

    /**
     * 开始自动刷新数据包（抓包时每秒刷新一次）
     */
    function startAutoRefreshPackets() {
        stopAutoRefreshPackets(); // 先清除已有的定时器
        captureState.autoRefreshTimer = setInterval(async () => {
            if (captureState.capturing && captureState.currentSessionId) {
                await loadCapturePackets(captureState.currentSessionId);
            }
        }, 1000);
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
        const canStart = captureState.fridaReady && captureState.serverRunning && !captureState.capturing;

        if (captureTargetSelect.value === 'current') {
            // 当前APK - 需要选中APK且已安装
            if (selectedApkIndex >= 0 && apkListData[selectedApkIndex]) {
                startCaptureBtn.disabled = !canStart;
            } else {
                startCaptureBtn.disabled = true;
            }
        } else {
            // 设备上的APP - 需要选择应用
            startCaptureBtn.disabled = !canStart || !deviceAppSelect.value;
        }

        stopCaptureBtn.disabled = !captureState.capturing;
    }

    /**
     * 处理抓包目标切换
     */
    function handleTargetChange() {
        if (captureTargetSelect.value === 'device') {
            captureDeviceApps.style.display = 'flex';
            loadDeviceApps();
        } else {
            captureDeviceApps.style.display = 'none';
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
     * 处理开始抓包按钮点击
     */
    async function handleStartCapture() {
        if (startCaptureBtn.disabled) return;

        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        let packageName = '';
        let apkDir = '';

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

        startCaptureBtn.disabled = true;
        startCaptureBtn.textContent = '启动中...';

        try {
            const result = await invoke('start_packet_capture', {
                caseNumber,
                apkDir,
                packageName,
                spawnMode: captureSpawnMode.checked
            });

            if (result.success) {
                captureState.capturing = true;
                captureState.currentCaptureId = result.capture_id;
                captureState.currentSessionId = result.session_dir;
                startCaptureBtn.textContent = '抓包中...';
                stopCaptureBtn.disabled = false;
                toast.show({ text: '抓包已启动', color: 'success', duration: 3000 });

                // 刷新会话列表
                await loadSessions();

                // 自动选中当前会话并开始定时刷新
                if (result.session_dir) {
                    captureState.selectedSessionId = result.session_dir;
                    startAutoRefreshPackets();
                }
            }
        } catch (error) {
            startCaptureBtn.disabled = false;
            startCaptureBtn.textContent = '开始抓包';
            toast.show({ text: `启动抓包失败: ${error}`, color: 'error', duration: 5000 });
        }
    }

    /**
     * 处理停止抓包按钮点击
     */
    async function handleStopCapture() {
        if (!captureState.currentCaptureId) return;

        stopCaptureBtn.disabled = true;
        stopCaptureBtn.textContent = '停止中...';

        // 停止自动刷新
        stopAutoRefreshPackets();

        try {
            await invoke('stop_packet_capture', {
                captureId: captureState.currentCaptureId
            });

            captureState.capturing = false;
            captureState.currentCaptureId = null;
            startCaptureBtn.disabled = false;
            startCaptureBtn.textContent = '开始抓包';
            stopCaptureBtn.textContent = '停止抓包';
            updateCaptureButtons();
            toast.show({ text: '抓包已停止', color: 'success', duration: 3000 });

            // 刷新会话列表
            await loadSessions();
        } catch (error) {
            stopCaptureBtn.disabled = false;
            stopCaptureBtn.textContent = '停止抓包';
            toast.show({ text: `停止抓包失败: ${error}`, color: 'error', duration: 3000 });
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
     * 加载抓包数据包
     * @param {string} sessionId - 会话ID
     */
    async function loadCapturePackets(sessionId) {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
            return;
        }

        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('get_capture_packets', {
                apkDir,
                sessionId,
                page: 1,
                pageSize: 200
            });

            if (result.success) {
                captureState.packets = result.packets;
                renderCapturePackets(result.packets);
                packetsTitle.textContent = `数据包列表 (${result.total})`;
            }
        } catch (error) {
            console.error('加载数据包失败:', error);
            toast.show({ text: `加载数据包失败: ${error}`, color: 'error', duration: 3000 });
        }
    }

    /**
     * 渲染数据包列表
     * @param {Array} packets - 数据包列表
     */
    function renderCapturePackets(packets) {
        if (!packets || packets.length === 0) {
            capturePacketsPlaceholder.classList.remove('hidden');
            capturePacketsPlaceholder.querySelector('span').textContent = '暂无数据包';
            capturePacketsTableWrapper.classList.remove('visible');
            capturePacketDetail.classList.remove('visible');
            return;
        }

        capturePacketsPlaceholder.classList.add('hidden');
        capturePacketsTableWrapper.classList.add('visible');

        capturePacketsBody.innerHTML = packets.map((packet, index) => {
            const method = packet.method || 'GET';
            const methodClass = method.toLowerCase();
            const statusCode = packet.status || '-';
            const statusClass = getStatusClass(statusCode);

            return `
                <tr data-index="${index}">
                    <td class="col-no">${index + 1}</td>
                    <td class="col-time">${packet.time || ''}</td>
                    <td class="col-method"><span class="method-tag ${methodClass}">${method}</span></td>
                    <td class="col-host">${packet.host || ''}</td>
                    <td class="col-path" title="${packet.path || ''}">${packet.path || ''}</td>
                    <td class="col-status"><span class="status-code ${statusClass}">${statusCode}</span></td>
                    <td class="col-size">${formatSize(packet.size)}</td>
                </tr>
            `;
        }).join('');

        // 绑定行点击事件
        capturePacketsBody.querySelectorAll('tr').forEach(row => {
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
     * 选择数据包
     * @param {number} index - 数据包索引
     */
    function selectPacket(index) {
        captureState.selectedPacketIndex = index;

        // 更新表格选中状态
        capturePacketsBody.querySelectorAll('tr').forEach((row, i) => {
            row.classList.toggle('selected', i === index);
        });

        // 显示详情
        const packet = captureState.packets[index];
        if (packet) {
            capturePacketDetail.classList.add('visible');
            renderPacketDetail(packet, 'request');
        }
    }

    /**
     * 处理数据包过滤
     */
    function handlePacketFilter() {
        const filter = packetsFilterInput.value.toLowerCase();
        capturePacketsBody.querySelectorAll('tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
        });
    }

    // ===================== 数据包详情 =====================

    /**
     * 渲染数据包详情
     * @param {Object} packet - 数据包对象
     * @param {string} tab - 当前标签页
     */
    function renderPacketDetail(packet, tab) {
        let content = '';

        if (tab === 'request') {
            content = formatHttpRequest(packet);
        } else if (tab === 'response') {
            content = formatHttpResponse(packet);
        } else if (tab === 'hex') {
            content = formatHexView(packet);
        }

        packetDetailContent.innerHTML = content;
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
     */
    function handleTabSwitch(tab) {
        document.querySelectorAll('.packet-detail-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        if (captureState.selectedPacketIndex >= 0) {
            const packet = captureState.packets[captureState.selectedPacketIndex];
            renderPacketDetail(packet, tab.dataset.tab);
        }
    }

    // ===================== 拖拽调整大小 =====================

    /**
     * 开始拖拽调整大小
     */
    function startCaptureResize() {
        isResizingCapture = true;
        captureResizer.classList.add('active');
        document.addEventListener('mousemove', handleCaptureResize);
        document.addEventListener('mouseup', stopCaptureResize);
    }

    /**
     * 处理拖拽调整大小
     * @param {MouseEvent} e - 鼠标事件
     */
    function handleCaptureResize(e) {
        if (!isResizingCapture) return;
        const container = document.querySelector('.capture-container');
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 280 && newWidth <= 450) {
            captureLeft.style.width = newWidth + 'px';
        }
    }

    /**
     * 停止拖拽调整大小
     */
    function stopCaptureResize() {
        isResizingCapture = false;
        captureResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleCaptureResize);
        document.removeEventListener('mouseup', stopCaptureResize);
    }

    // 暴露公共API
    return {
        init: init,
        loadSessions: loadSessions,
        checkFridaEnv: checkFridaEnv,
        checkFridaServerStatus: checkFridaServerStatus,
        updateCaptureButtons: updateCaptureButtons,
        loadDeviceApps: loadDeviceApps,
        selectCaptureSession: selectCaptureSession,
        loadCapturePackets: loadCapturePackets,
        deleteCaptureSession: deleteCaptureSession,
        startAutoRefreshPackets: startAutoRefreshPackets,
        stopAutoRefreshPackets: stopAutoRefreshPackets
    };
})();
