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
    let deviceSelector = null;
    let refreshDevicesBtn = null;
    let emulatorOptimizeCheckbox = null;

    // 外部函数
    let getSettings = null;
    let getDeviceConnected = null;
    let setDeviceConnected = null;

    // 设备列表
    let deviceList = [];
    let selectedDeviceIndex = -1;
    let currentConnectedIndex = -1;
    let isEmulatorOptimized = false;

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
        deviceSelector = document.getElementById('device-selector');
        refreshDevicesBtn = document.getElementById('refresh-devices-btn');
        emulatorOptimizeCheckbox = document.getElementById('emulator-optimize-checkbox');

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

        // 刷新设备列表按钮
        if (refreshDevicesBtn) {
            refreshDevicesBtn.addEventListener('click', handleRefreshDevices);
        }

        // 设备选择下拉框变化事件
        if (deviceSelector) {
            deviceSelector.addEventListener('change', handleDeviceChange);
        }

        // 模拟器优化复选框
        if (emulatorOptimizeCheckbox) {
            emulatorOptimizeCheckbox.addEventListener('change', handleEmulatorOptimizeChange);
        }
    }

    /**
     * 刷新设备列表
     * 不再扫描模拟器端口，直接获取 rust-ws-scrcpy 的设备列表
     */
    async function refreshDeviceList() {
        try {
            deviceSelector.innerHTML = '<option value="-1">检测中...</option>';
            deviceSelector.disabled = true;

            const devices = await invoke('list_scrcpy_devices');
            deviceList = devices || [];

            deviceSelector.innerHTML = '';

            if (deviceList.length === 0) {
                deviceSelector.innerHTML = '<option value="-1">无设备</option>';
            } else {
                deviceList.forEach((device) => {
                    const option = document.createElement('option');
                    option.value = device.index;

                    // 显示格式: [索引] 型号 或 [索引] 序列号
                    const displayName = device.model ? device.model : device.serial;
                    option.textContent = `[${device.index}] ${displayName}`;

                    // 设置 title 显示完整详细信息
                    option.title = device.detail || device.serial;

                    deviceSelector.appendChild(option);
                });
                // 默认选中第一个设备
                selectedDeviceIndex = deviceList.length > 0 ? deviceList[0].index : -1;
                // 设置下拉框 title 为第一个设备的详情
                if (deviceList.length > 0) {
                    deviceSelector.title = deviceList[0].detail || deviceList[0].serial;
                }
            }

            deviceSelector.disabled = false;
            return deviceList;
        } catch (error) {
            console.error('获取设备列表失败:', error);
            deviceSelector.innerHTML = '<option value="-1">获取失败</option>';
            deviceSelector.disabled = false;
            deviceList = [];
            return [];
        }
    }

    /**
     * 处理设备选择变化
     */
    async function handleDeviceChange() {
        const newIndex = parseInt(deviceSelector.value);
        if (newIndex === -1) return;

        // 更新下拉框 title 为当前选中设备的详情
        const selectedDevice = deviceList.find(d => d.index === newIndex);
        if (selectedDevice) {
            deviceSelector.title = selectedDevice.detail || selectedDevice.serial;
        }

        if (newIndex !== currentConnectedIndex && currentConnectedIndex !== -1) {
            // 如果已经连接了一个设备，且选择了不同的设备，则断开当前连接并重新连接
            console.log(`切换设备: ${currentConnectedIndex} -> ${newIndex}`);
            await switchDevice(newIndex);
        } else if (currentConnectedIndex === -1) {
            // 如果还没有连接任何设备，不做任何操作（等待手动点击重连或自动连接）
            selectedDeviceIndex = newIndex;
        }
    }

    /**
     * 切换到新设备
     */
    async function switchDevice(newIndex) {
        try {
            reconnectBtn.disabled = true;
            reconnectBtn.textContent = '切换中...';
            setDeviceConnected(false);

            // 停止当前的scrcpy进程
            await invoke('stop_scrcpy', { caseNumber: caseNumber });
            console.log('已停止当前scrcpy');

            // 重置加载指示器
            loadingIndicator.classList.remove('hidden');
            loadingIndicator.innerHTML = `
                <div class="spinner"></div>
                <div class="loading-text">切换设备中...</div>
            `;

            // 连接新设备
            selectedDeviceIndex = newIndex;
            await startScrcpy(newIndex);

            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
        } catch (error) {
            console.error('切换设备失败:', error);
            loadingIndicator.innerHTML = `
                <div class="loading-text">切换设备失败: ${error}</div>
            `;
            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
        }
    }

    /**
     * 处理刷新设备列表按钮
     */
    async function handleRefreshDevices() {
        refreshDevicesBtn.disabled = true;
        refreshDevicesBtn.textContent = '刷新中...';

        await refreshDeviceList();

        refreshDevicesBtn.disabled = false;
        refreshDevicesBtn.textContent = '刷新';
    }

    /**
     * 处理模拟器优化复选框变化
     */
    async function handleEmulatorOptimizeChange() {
        const newValue = emulatorOptimizeCheckbox.checked;
        // 如果状态没变，不做任何操作
        if (newValue === isEmulatorOptimized) return;
        isEmulatorOptimized = newValue;

        // 如果当前有连接的设备，需要重启scrcpy
        if (currentConnectedIndex === -1) return;

        console.log(`模拟器优化: ${isEmulatorOptimized ? '开启' : '关闭'}，重启scrcpy...`);

        try {
            reconnectBtn.disabled = true;
            reconnectBtn.textContent = '重启中...';
            setDeviceConnected(false);

            // 停止当前的scrcpy进程
            await invoke('stop_scrcpy', { caseNumber: caseNumber });

            // 重置加载指示器
            loadingIndicator.classList.remove('hidden');
            loadingIndicator.innerHTML = `
                <div class="spinner"></div>
                <div class="loading-text">${isEmulatorOptimized ? '以模拟器优化模式重启中...' : '以默认模式重启中...'}</div>
            `;

            const targetIndex = currentConnectedIndex;
            currentConnectedIndex = -1;

            // 用新参数重新启动
            await startScrcpy(targetIndex);

            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
        } catch (error) {
            console.error('重启scrcpy失败:', error);
            loadingIndicator.innerHTML = `
                <div class="loading-text">重启失败: ${error}</div>
            `;
            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
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

            if (!forceConnect) {
                // 非强制连接时（页面初始化），先获取设备列表
                const devices = await refreshDeviceList();

                if (!autoConnect) {
                    // 自动连接已关闭，显示简洁提示
                    loadingIndicator.innerHTML = `
                        <div class="loading-text">点击重连按钮连接手机</div>
                    `;
                    return;
                }

                if (devices.length === 0) {
                    // 没有设备，显示提示
                    loadingIndicator.innerHTML = `
                        <div class="loading-text">未检测到连接的设备</div>
                    `;
                    return;
                }

                // 显示连接中状态
                loadingIndicator.classList.remove('hidden');
                loadingIndicator.innerHTML = `
                    <div class="spinner"></div>
                    <div class="loading-text">连接手机中...</div>
                `;

                // 自动连接时使用第一个设备（索引0）
                await startScrcpy(0);
            } else {
                // 强制连接（点击重连），直接使用当前选中的设备索引
                const currentIndex = parseInt(deviceSelector.value);
                const targetIndex = currentIndex >= 0 ? currentIndex : 0;

                // 显示连接中状态
                loadingIndicator.classList.remove('hidden');
                loadingIndicator.innerHTML = `
                    <div class="spinner"></div>
                    <div class="loading-text">连接手机中...</div>
                `;

                // 直接启动scrcpy，不再重新获取设备列表
                await startScrcpy(targetIndex);
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
     * @param {number} deviceIndex - 设备索引
     */
    async function startScrcpy(deviceIndex = 0) {
        try {
            console.log('启动scrcpy，设备索引:', deviceIndex, '模拟器优化:', isEmulatorOptimized);
            const result = await invoke('start_scrcpy', {
                caseNumber: caseNumber,
                deviceIndex: deviceIndex,
                emulatorOptimize: isEmulatorOptimized
            });
            console.log('Scrcpy启动命令已发送:', result);

            if (result && result.port) {
                const wsUrl = `http://127.0.0.1:${result.port}`;
                console.log('等待scrcpy准备完成...');

                // 轮询检测服务是否就绪，最长等待20秒
                const maxWaitTime = 20000;
                const checkInterval = 500;
                let waited = 0;
                let serverReady = false;

                while (waited < maxWaitTime) {
                    try {
                        // 尝试fetch检测服务是否可用
                        const response = await fetch(wsUrl, { method: 'HEAD', mode: 'no-cors' });
                        serverReady = true;
                        console.log(`scrcpy服务已就绪，等待了${waited}ms`);
                        break;
                    } catch (e) {
                        // 服务还未就绪，继续等待
                    }
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    waited += checkInterval;
                }

                if (!serverReady) {
                    console.warn('scrcpy服务在20秒内未就绪，尝试连接...');
                }

                // 额外等待1秒确保WebSocket完全就绪
                await new Promise(resolve => setTimeout(resolve, 1000));

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
                    currentConnectedIndex = deviceIndex;
                    // 更新下拉框选中状态
                    if (deviceSelector) {
                        deviceSelector.value = deviceIndex.toString();
                    }
                };

                deviceIframe.onerror = () => {
                    clearTimeout(loadTimeout);
                    console.error('iframe加载失败');
                    setDeviceConnected(false);
                    currentConnectedIndex = -1;
                    loadingIndicator.innerHTML = `
                        <div class="loading-text">连接失败，请检查设备</div>
                    `;
                };
            }
        } catch (error) {
            console.error('启动scrcpy失败:', error);
            currentConnectedIndex = -1;
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
        currentConnectedIndex = -1;

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
            currentConnectedIndex = -1;
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
        stopScrcpy: stopScrcpy,
        refreshDeviceList: refreshDeviceList
    };
})();
