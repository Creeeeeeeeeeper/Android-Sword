const { invoke } = window.__TAURI__.core;

// 顶部弹出框组件
class Toast {
    constructor() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            // 如果没有 toast 容器，创建一个
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    show(options = {}) {
        const {
            text = '提示信息',
            color = 'info',
            duration = 3000
        } = options;

        // 创建 toast 元素
        const toast = document.createElement('div');
        toast.className = `toast ${color}`;
        toast.textContent = text;

        // 添加到容器
        this.container.appendChild(toast);

        // 定时关闭
        setTimeout(() => {
            toast.classList.add('hide');
            // 动画完成后删除元素
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, duration);
    }
}

// 创建全局 toast 实例
const toast = new Toast();

document.addEventListener('DOMContentLoaded', function() {
    console.log('操作页面已加载');

    const backBtn = document.getElementById('back-btn');
    const reconnectBtn = document.getElementById('reconnect-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const caseTitle = document.getElementById('case-title');
    const deviceIframe = document.getElementById('device-iframe');
    const loadingIndicator = document.getElementById('loading-indicator');
    const addApkBtn = document.getElementById('add-apk-btn');
    const apkFileInput = document.getElementById('apk-file-input');
    const apkTabsContainer = document.getElementById('apk-tabs');
    const apkDetailContainer = document.getElementById('apk-detail');
    const taskIndicator = document.getElementById('task-indicator');
    const operationTabs = document.querySelectorAll('.operation-tab');
    const operationPanels = document.querySelectorAll('.operation-panel');

    // 正在反编译的任务计数
    let decompilingCount = 0;
    // APK列表数据
    let apkListData = [];
    // 当前选中的APK索引
    let selectedApkIndex = -1;
    // 是否已连接设备
    let deviceConnected = false;

    // 获取当前案件信息
    const caseName = window.parent.currentCaseName || '未知案件';
    const caseNumber = window.parent.currentCaseNumber || '';

    // 设置案件标题
    caseTitle.textContent = caseName;

    // 返回按钮事件
    backBtn.addEventListener('click', function() {
        // 停止scrcpy进程
        invoke('stop_scrcpy', { caseNumber: caseNumber })
            .then(() => {
                window.parent.loadPage('pages/homepage/index.html');
            })
            .catch(err => console.error('停止scrcpy失败:', err));
    });

    // 重新连接按钮事件
    reconnectBtn.addEventListener('click', async function() {
        console.log('点击重新连接...');
        reconnectBtn.disabled = true;
        reconnectBtn.textContent = '清理进程中...';
        deviceConnected = false;

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
                <div class="loading-text">重新连接手机中...</div>
            `;

            // 重新启动scrcpy（强制连接，忽略autoConnect设置）
            await initializeDevice(true);

            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
        } catch (error) {
            console.error('重新连接失败:', error);
            loadingIndicator.innerHTML = `
                <div class="empty-state-icon">❌</div>
                <div class="loading-text">重新连接失败: ${error}</div>
            `;
            reconnectBtn.disabled = false;
            reconnectBtn.textContent = '重连';
        }
    });

    // 刷新按钮事件
    refreshBtn.addEventListener('click', function() {
        console.log('点击刷新...');
        if (deviceIframe.src && deviceIframe.src !== 'about:blank') {
            // 刷新iframe页面（类似F5刷新）
            deviceIframe.src = deviceIframe.src;
        }
    });

    // 添加APK按钮事件
    addApkBtn.addEventListener('click', function() {
        console.log('点击添加APK...');
        apkFileInput.click();
    });

    // 处理文件选择
    apkFileInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) return;

        console.log('选择了文件:', file.name);

        // 检查文件是否为APK格式
        if (!file.name.endsWith('.apk')) {
            toast.show({
                text: '请选择有效的APK文件',
                color: 'error',
                duration: 3000
            });
            return;
        }

        try {
            addApkBtn.disabled = true;
            addApkBtn.textContent = '上传中...';

            // 创建时间戳文件夹
            const timestamp = Date.now();
            const uploadTime = new Date().toISOString();
            const apkDir = `case/${caseNumber}/apks/${timestamp}`;

            // 创建APK目录
            await invoke('create_dir', { dirname: apkDir });
            console.log('已创建APK目录:', apkDir);

            // 读取文件内容并保存为 base.apk
            const fileBuffer = await file.arrayBuffer();
            const fileData = Array.from(new Uint8Array(fileBuffer));

            // 保存文件为 base.apk（二进制方式）
            const filePath = `${apkDir}/base.apk`;
            await invoke('write_binary_file', {
                filename: filePath,
                data: fileData
            });

            console.log('APK上传成功:', filePath);

            // 创建信息JSON文件
            const apkInfo = {
                originalName: file.name,
                uploadTime: uploadTime,
                fileSize: file.size,
                timestamp: timestamp
            };

            const infoPath = `${apkDir}/info.json`;
            await invoke('write_file', {
                filename: infoPath,
                content: JSON.stringify(apkInfo, null, 2)
            });

            console.log('APK信息文件已创建:', infoPath);

            addApkBtn.textContent = '+ 添加';
            addApkBtn.disabled = false;
            apkFileInput.value = '';

            toast.show({
                text: 'APK上传成功，开始反编译...',
                color: 'success',
                duration: 3000
            });

            // 先刷新列表显示正在反编译状态
            await refreshApkList();

            // 反编译APK（异步，不阻塞）
            decompileApk(filePath, apkDir, timestamp);
        } catch (error) {
            console.error('APK上传失败:', error);
            toast.show({
                text: `APK上传失败: ${error}`,
                color: 'error',
                duration: 3000
            });
            addApkBtn.textContent = '+ 添加';
            addApkBtn.disabled = false;
            apkFileInput.value = '';
        }
    });

    // 显示/隐藏任务指示器
    function updateTaskIndicator() {
        if (decompilingCount > 0) {
            taskIndicator.classList.remove('hidden');
            taskIndicator.querySelector('.task-text').textContent =
                decompilingCount === 1 ? '反编译中...' : `反编译中 (${decompilingCount})...`;
        } else {
            taskIndicator.classList.add('hidden');
        }
    }

    // 反编译APK
    async function decompileApk(apkFilePath, apkDir, timestamp) {
        // 增加反编译任务计数
        decompilingCount++;
        updateTaskIndicator();

        try {
            console.log('开始反编译APK:', apkFilePath);

            // 获取当前工作目录
            const currentDir = await invoke('get_current_dir');
            const jadxExe = `${currentDir}/jadx/bin/jadx.bat`;
            const outputDir = `${apkDir}/jadx`;

            // 创建输出目录
            await invoke('create_dir', { dirname: outputDir });
            console.log('已创建反编译输出目录:', outputDir);

            // 执行jadx命令进行反编译
            const result = await invoke('decompile_apk', {
                apkPath: apkFilePath,
                outputPath: outputDir
            });

            console.log('APK反编译成功:', result);
            toast.show({
                text: 'APK反编译成功',
                color: 'success',
                duration: 3000
            });

            // 刷新列表
            await refreshApkList();
        } catch (error) {
            console.error('APK反编译失败:', error);
            toast.show({
                text: `APK反编译失败: 文件格式错误或损坏`,
                color: 'error',
                duration: 5000
            });

            // 反编译失败，清理上传的文件和目录
            try {
                console.log('清理失败的APK文件...');

                // 删除APK文件
                await invoke('delete_file', { filename: apkFilePath });
                console.log('已删除APK文件');

                // 删除jadx目录
                const jadxDir = `${apkDir}/jadx`;
                await invoke('delete_dir', { dirname: jadxDir }).catch(() => {
                    console.log('jadx目录不存在或删除失败');
                });

                // 删除info.json
                await invoke('delete_file', { filename: `${apkDir}/info.json` }).catch(() => {
                    console.log('info.json不存在或删除失败');
                });

                // 删除APK所在的时间戳目录
                await invoke('delete_dir', { dirname: apkDir }).catch(() => {
                    console.log('时间戳目录不为空或删除失败');
                });

                console.log('已清理失败的APK相关文件');
            } catch (cleanError) {
                console.error('清理失败文件出错:', cleanError);
            }

            // 刷新列表
            await refreshApkList();
        } finally {
            // 减少反编译任务计数
            decompilingCount--;
            updateTaskIndicator();
        }
    }

    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 格式化时间
    function formatDate(isoString) {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleString('zh-CN');
    }

    // 刷新APK列表
    async function refreshApkList() {
        console.log('刷新APK列表');
        try {
            apkListData = await invoke('get_apk_list', { caseNumber: caseNumber });
            console.log('APK列表:', apkListData);

            renderApkTabs();

            // 如果有APK且没有选中的，选中第一个
            if (apkListData.length > 0 && selectedApkIndex === -1) {
                selectApk(0);
            } else if (apkListData.length === 0) {
                selectedApkIndex = -1;
                renderApkDetail(null);
            } else if (selectedApkIndex >= apkListData.length) {
                // 如果之前选中的索引超出范围，选中最后一个
                selectApk(apkListData.length - 1);
            } else {
                // 刷新当前选中的详情
                renderApkDetail(apkListData[selectedApkIndex]);
            }
        } catch (error) {
            console.error('获取APK列表失败:', error);
        }
    }

    // 渲染APK标签栏
    function renderApkTabs() {
        apkTabsContainer.innerHTML = '';

        apkListData.forEach((apk, index) => {
            const tab = document.createElement('div');
            tab.className = 'apk-tab';
            if (index === selectedApkIndex) {
                tab.classList.add('active');
            }
            if (!apk.isDecompiled) {
                tab.classList.add('decompiling');
            }

            const iconHtml = apk.iconPath
                ? `<img src="file://${apk.iconPath}" alt="icon" onerror="this.parentElement.innerHTML='<span class=\\'apk-tab-icon-placeholder\\'>📦</span>'">`
                : '<span class="apk-tab-icon-placeholder">📦</span>';

            const spinnerHtml = !apk.isDecompiled ? '<div class="apk-tab-spinner"></div>' : '';

            tab.innerHTML = `
                <div class="apk-tab-icon">${iconHtml}</div>
                <span class="apk-tab-name">${apk.appName || apk.originalName || '未知'}</span>
                ${spinnerHtml}
            `;

            tab.addEventListener('click', () => {
                selectApk(index);
            });

            // 右键菜单
            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showApkContextMenu(e, apk, index);
            });

            apkTabsContainer.appendChild(tab);
        });
    }

    // 显示APK右键菜单
    function showApkContextMenu(event, apk, index) {
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.apk-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'apk-context-menu';
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';

        // 如果已连接设备，显示安装选项
        if (deviceConnected) {
            const installItem = document.createElement('div');
            installItem.className = 'apk-context-menu-item';
            installItem.textContent = '安装';
            installItem.addEventListener('click', () => {
                menu.remove();
                installApkToDevice(apk);
            });
            menu.appendChild(installItem);
        }

        const deleteItem = document.createElement('div');
        deleteItem.className = 'apk-context-menu-item';
        deleteItem.textContent = '删除';
        deleteItem.addEventListener('click', () => {
            menu.remove();
            confirmDeleteApk(apk, index);
        });

        menu.appendChild(deleteItem);
        document.body.appendChild(menu);

        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    // 安装APK到设备
    async function installApkToDevice(apk) {
        const appName = apk.appName || apk.packageName || apk.originalName || '未知应用';
        const apkPath = `case/${caseNumber}/apks/${apk.timestamp}/base.apk`;

        toast.show({
            text: `正在安装 ${appName}...`,
            color: 'info',
            duration: 2000
        });

        try {
            await invoke('install_apk', { apkPath: apkPath });
            toast.show({
                text: `${appName} 安装成功`,
                color: 'success',
                duration: 3000
            });
        } catch (error) {
            console.error('安装APK失败:', error);
            toast.show({
                text: `安装失败: ${error}`,
                color: 'error',
                duration: 5000
            });
        }
    }

    // 确认删除APK
    function confirmDeleteApk(apk, index) {
        const appName = apk.appName || apk.packageName || apk.originalName || '未知应用';

        // 创建确认对话框
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-modal-content">
                <div class="confirm-modal-title">确认删除</div>
                <div class="confirm-modal-text">确定要删除 "${appName}" 的分析吗？此操作无法撤销。</div>
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
            await deleteApk(apk, index);
        });

        // 点击蒙层关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // 删除APK
    async function deleteApk(apk, index) {
        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

            // 删除整个APK目录
            await invoke('delete_dir', { dirname: apkDir });

            toast.show({
                text: '已删除APK分析',
                color: 'success',
                duration: 2000
            });

            // 如果删除的是当前选中的，重置选中状态
            if (index === selectedApkIndex) {
                selectedApkIndex = -1;
            } else if (index < selectedApkIndex) {
                selectedApkIndex--;
            }

            // 刷新列表
            await refreshApkList();
        } catch (error) {
            console.error('删除APK失败:', error);
            toast.show({
                text: `删除失败: ${error}`,
                color: 'error',
                duration: 3000
            });
        }
    }

    // 选中APK
    function selectApk(index) {
        selectedApkIndex = index;

        // 更新标签激活状态
        const tabs = apkTabsContainer.querySelectorAll('.apk-tab');
        tabs.forEach((tab, i) => {
            if (i === index) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // 渲染详情
        renderApkDetail(apkListData[index]);
    }

    // 渲染APK详情
    function renderApkDetail(apk) {
        if (!apk) {
            apkDetailContainer.innerHTML = '<div class="apk-detail-empty">暂无APK，请点击添加按钮上传</div>';
            return;
        }

        const iconHtml = apk.iconPath
            ? `<img src="file://${apk.iconPath}" alt="icon" onerror="this.parentElement.innerHTML='<span class=\\'apk-detail-icon-placeholder\\'>📦</span>'">`
            : '<span class="apk-detail-icon-placeholder">📦</span>';

        const statusHtml = apk.isDecompiled
            ? '<div class="apk-detail-status ready">已就绪</div>'
            : '<div class="apk-detail-status decompiling"><div class="apk-tab-spinner"></div>反编译中</div>';

        apkDetailContainer.innerHTML = `
            <div class="apk-detail-content">
                <div class="apk-detail-header">
                    <div class="apk-detail-icon">${iconHtml}</div>
                    <div class="apk-detail-title">
                        <div class="apk-detail-app-name">${apk.appName || apk.originalName || '未知应用'}</div>
                        <div class="apk-detail-package">${apk.packageName || '-'}</div>
                    </div>
                </div>
                <div class="apk-detail-info">
                    <div class="apk-detail-item">
                        <span class="apk-detail-label">版本</span>
                        <span class="apk-detail-value">${apk.versionName ? `v${apk.versionName}` : '-'}</span>
                    </div>
                    <div class="apk-detail-item">
                        <span class="apk-detail-label">大小</span>
                        <span class="apk-detail-value">${formatFileSize(apk.fileSize)}</span>
                    </div>
                    <div class="apk-detail-item">
                        <span class="apk-detail-label">上传</span>
                        <span class="apk-detail-value">${formatDate(apk.uploadTime)}</span>
                    </div>
                    <div class="apk-detail-item">
                        <span class="apk-detail-label">状态</span>
                        ${statusHtml}
                    </div>
                </div>
            </div>
        `;
    }

    // 初始化页面时加载APK列表
    async function initApkPanel() {
        await refreshApkList();
    }

    // 获取设置
    async function getSettings() {
        try {
            const content = await invoke('read_file', { filename: 'settings.json' });
            return JSON.parse(content);
        } catch (error) {
            console.log('设置文件不存在，使用默认设置');
            return {
                adb: { autoConnect: true },
                scrcpy: {}
            };
        }
    }

    // 初始化设备连接
    // forceConnect: 是否强制连接（忽略autoConnect设置），用于手动重连
    async function initializeDevice(forceConnect = false) {
        try {
            // 检查自动连接设置
            const settings = await getSettings();
            const autoConnect = settings.adb?.autoConnect ?? true;

            if (!autoConnect && !forceConnect) {
                // 自动连接已关闭且非强制连接，显示提示
                loadingIndicator.innerHTML = `
                    <div class="loading-text">自动连接已关闭，点击重连按钮手动连接</div>
                `;
                return;
            }

            // 检查是否有可用的设备
            const response = await invoke('check_adb_devices', {});
            console.log('ADB设备检查结果:', response);

            if (response === 'has_devices') {
                // 有设备，启动scrcpy
                await startScrcpy();
            } else if (response === 'no_devices') {
                // 没有设备，隐藏加载指示器，显示提示
                loadingIndicator.innerHTML = `
                    <div class="empty-state-icon">📱</div>
                    <div class="loading-text">未检测到连接的设备</div>
                `;
            }
        } catch (error) {
            console.error('初始化设备失败:', error);
            loadingIndicator.innerHTML = `
                <div class="empty-state-icon">❌</div>
                <div class="loading-text">设备初始化失败</div>
            `;
        }
    }

    // 启动scrcpy进程
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
                            <div class="empty-state-icon">⚠️</div>
                            <div class="loading-text">连接超时，请重试</div>
                        `;
                    }
                }, 15000);

                deviceIframe.onload = () => {
                    clearTimeout(loadTimeout);
                    console.log('iframe加载成功');
                    loadingIndicator.classList.add('hidden');
                    deviceConnected = true;
                };

                deviceIframe.onerror = () => {
                    clearTimeout(loadTimeout);
                    console.error('iframe加载失败');
                    deviceConnected = false;
                    loadingIndicator.innerHTML = `
                        <div class="empty-state-icon">❌</div>
                        <div class="loading-text">连接失败，请检查设备</div>
                    `;
                };
            }
        } catch (error) {
            console.error('启动scrcpy失败:', error);
            loadingIndicator.innerHTML = `
                <div class="empty-state-icon">❌</div>
                <div class="loading-text">启动投屏失败: ${error}</div>
            `;
        }
    }

    // 页面加载时初始化
    initializeDevice();
    initApkPanel();

    // 操作区切换栏点击事件
    operationTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // 更新标签状态
            operationTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 更新面板显示
            operationPanels.forEach(panel => {
                panel.classList.remove('active');
                if (panel.id === `tab-${targetTab}`) {
                    panel.classList.add('active');
                }
            });
        });
    });
});
