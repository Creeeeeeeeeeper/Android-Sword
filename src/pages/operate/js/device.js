/**
 * 设备模块 - 处理设备连接和scrcpy投屏
 * 负责ADB设备检测、scrcpy启动/停止、设备重连等功能
 */

window.DeviceModule = (function() {
    // 模块依赖（通过init注入）
    let invoke = null;
    let caseNumber = '';

    // DOM元素
    let reconnectBtn = null;
    let refreshBtn = null;
    let deviceIframe = null;
    let loadingIndicator = null;

    // 外部函数
    let getSettings = null;
    let getDeviceConnected = null;
    let setDeviceConnected = null;

    /**
     * 初始化模块，注入依赖
     * @param {Object} deps - 依赖对象
     */
    function init(deps) {
        invoke = deps.invoke;
        caseNumber = deps.caseNumber;

        // DOM元素
        reconnectBtn = deps.reconnectBtn;
        refreshBtn = deps.refreshBtn;
        deviceIframe = deps.deviceIframe;
        loadingIndicator = deps.loadingIndicator;

        // 外部函数
        getSettings = deps.getSettings;
        getDeviceConnected = deps.getDeviceConnected;
        setDeviceConnected = deps.setDeviceConnected;

        // 绑定事件
        bindEvents();
    }

    /**
     * 绑定按钮事件
     */
    function bindEvents() {
        // 重新连接按钮事件
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', handleReconnect);
        }

        // 刷新按钮事件
        if (refreshBtn) {
            refreshBtn.addEventListener('click', handleRefresh);
        }
    }

    /**
     * 初始化设备连接
     * @param {boolean} forceConnect - 是否强制连接（忽略autoConnect设置），用于手动重连
     */
    async function initializeDevice(forceConnect = false) {
        try {
            // 检查自动连接设置
            const settings = await getSettings();
            const autoConnect = settings.adb?.autoConnect ?? true;

            if (!autoConnect && !forceConnect) {
                // 自动连接已关闭且非强制连接，显示简洁提示
                loadingIndicator.innerHTML = `
                    <div class="loading-text">点击重连按钮连接手机</div>
                `;
                return;
            }

            // 显示连接中状态
            loadingIndicator.classList.remove('hidden');
            loadingIndicator.innerHTML = `
                <div class="spinner"></div>
                <div class="loading-text">连接手机中...</div>
            `;

            // 检查是否有可用的设备
            const response = await invoke('check_adb_devices', {});
            console.log('ADB设备检查结果:', response);

            if (response === 'has_devices') {
                // 有设备，启动scrcpy
                await startScrcpy();
            } else if (response === 'no_devices') {
                // 没有设备，显示提示
                loadingIndicator.innerHTML = `
                    <div class="loading-text">未检测到连接的设备</div>
                `;
            }
        } catch (error) {
            console.error('初始化设备失败:', error);
            loadingIndicator.innerHTML = `
                <div class="loading-text">设备初始化失败</div>
            `;
        }
    }

    /**
     * 启动scrcpy进程
     */
    async function startScrcpy() {
        try {
            console.log('启动scrcpy...');
            const result = await invoke('start_scrcpy', { caseNumber: caseNumber });
            console.log('Scrcpy启动命令已发送:', result);

            if (result && result.port) {
                const wsUrl = `http://127.0.0.1:${result.port}`;
                console.log('等待scrcpy准备完成...');

                // 等待5秒让scrcpy完全启动（后端已经等待了2秒）
                await new Promise(resolve => setTimeout(resolve, 5000));

                console.log('加载WebSocket:', wsUrl);

                // 设置 iframe src，只设置一次
                deviceIframe.src = wsUrl;

                // 给iframe加载足够的时间
                const loadTimeout = setTimeout(() => {
                    if (!loadingIndicator.classList.contains('hidden')) {
                        loadingIndicator.innerHTML = `
                            <div class="loading-text">连接超时，请重试</div>
                        `;
                    }
                }, 15000);

                deviceIframe.onload = () => {
                    clearTimeout(loadTimeout);
                    console.log('iframe加载成功');
                    loadingIndicator.classList.add('hidden');
                    setDeviceConnected(true);
                };

                deviceIframe.onerror = () => {
                    clearTimeout(loadTimeout);
                    console.error('iframe加载失败');
                    setDeviceConnected(false);
                    loadingIndicator.innerHTML = `
                        <div class="loading-text">连接失败，请检查设备</div>
                    `;
                };
            }
        } catch (error) {
            console.error('启动scrcpy失败:', error);
            loadingIndicator.innerHTML = `
                <div class="loading-text">启动投屏失败: ${error}</div>
            `;
        }
    }

    /**
     * 处理重连按钮点击
     */
    async function handleReconnect() {
        console.log('点击重新连接...');
        reconnectBtn.disabled = true;
        reconnectBtn.textContent = '清理进程中...';
        setDeviceConnected(false);

        try {
            // 先清理残留进程
            await invoke('cleanup_residual_processes');
            console.log('已清理残留进程');

            reconnectBtn.textContent = '停止scrcpy...';

            // 停止当前的scrcpy进程
            await invoke('stop_scrcpy', { caseNumber: caseNumber });
            console.log('已停止scrcpy');

            reconnectBtn.textContent = '重新启动...';

            // 重置加载指示器
            loadingIndicator.classList.remove('hidden');
            loadingIndicator.innerHTML = `
                <div class="spinner"></div>
                <div class="loading-text">重新连接中...</div>
            `;

            // 重新启动scrcpy（强制连接，忽略autoConnect设置）
            await initializeDevice(true);

            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
        } catch (error) {
            console.error('重新连接失败:', error);
            loadingIndicator.innerHTML = `
                <div class="loading-text">重新连接失败: ${error}</div>
            `;
            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
        }
    }

    /**
     * 处理刷新按钮点击
     */
    function handleRefresh() {
        console.log('点击刷新...');
        if (deviceIframe.src && deviceIframe.src !== 'about:blank') {
            // 刷新iframe页面（类似F5刷新）
            deviceIframe.src = deviceIframe.src;
        }
    }

    /**
     * 停止scrcpy进程
     * @returns {Promise}
     */
    async function stopScrcpy() {
        try {
            await invoke('stop_scrcpy', { caseNumber: caseNumber });
            console.log('已停止scrcpy');
            setDeviceConnected(false);
        } catch (error) {
            console.error('停止scrcpy失败:', error);
            throw error;
        }
    }

    // 暴露公共API
    return {
        init: init,
        initDevice: initializeDevice,
        startScrcpy: startScrcpy,
        stopScrcpy: stopScrcpy
    };
})();
