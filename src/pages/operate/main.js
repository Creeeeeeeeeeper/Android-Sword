const { invoke, convertFileSrc } = window.__TAURI__.core;

// 复制到剪贴板函数（全局）
window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
        // 显示复制成功提示
        if (window.toast) {
            window.toast.show({
                text: '已复制到剪贴板',
                color: 'success',
                duration: 1500
            });
        }
    }).catch(err => {
        console.error('复制失败:', err);
    });
};

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
window.toast = toast;

document.addEventListener('DOMContentLoaded', function() {
    console.log('操作页面已加载');

    const backBtn = document.getElementById('back-btn');
    const reconnectBtn = document.getElementById('reconnect-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const caseTitle = document.getElementById('case-title');
    const deviceIframe = document.getElementById('device-iframe');
    const loadingIndicator = document.getElementById('loading-indicator');
    const addApkBtn = document.getElementById('add-apk-btn');
    const apkTabsContainer = document.getElementById('apk-tabs');
    const apkDetailContainer = document.getElementById('apk-detail');
    const taskIndicator = document.getElementById('task-indicator');
    const operationTabs = document.querySelectorAll('.operation-tab');
    const operationPanels = document.querySelectorAll('.operation-panel');
    const fullscreenLoading = document.getElementById('fullscreen-loading');

    // 正在反编译的任务计数
    let decompilingCount = 0;
    // APK列表数据
    let apkListData = [];
    // 当前选中的APK索引
    let selectedApkIndex = -1;
    // 是否已连接设备
    let deviceConnected = false;

    // ADB设备状态缓存
    let adbDeviceCache = {
        hasDevice: false,
        installedPackages: new Map(), // packageName -> isInstalled
        lastCheck: 0,
        checking: false
    };

    // 预检测ADB设备状态
    async function preCheckAdbStatus() {
        if (adbDeviceCache.checking) return;
        adbDeviceCache.checking = true;

        try {
            const deviceStatus = await invoke('check_adb_devices');
            adbDeviceCache.hasDevice = (deviceStatus === 'has_devices');
            adbDeviceCache.lastCheck = Date.now();

            // 如果有设备，预加载当前选中APK的安装状态
            if (adbDeviceCache.hasDevice && selectedApkIndex >= 0 && apkListData[selectedApkIndex]) {
                const apk = apkListData[selectedApkIndex];
                if (apk.packageName && !adbDeviceCache.installedPackages.has(apk.packageName)) {
                    try {
                        const result = await invoke('check_apk_installed', { packageName: apk.packageName });
                        adbDeviceCache.installedPackages.set(apk.packageName, result.installed);
                    } catch (e) {
                        console.error('预检测安装状态失败:', e);
                    }
                }
            }
        } catch (e) {
            console.error('预检测ADB状态失败:', e);
            adbDeviceCache.hasDevice = false;
        } finally {
            adbDeviceCache.checking = false;
        }
    }

    // 启动定期检测ADB状态（每10秒）
    setInterval(() => {
        preCheckAdbStatus();
    }, 10000);

    // 页面加载时立即检测
    preCheckAdbStatus();

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

    // 添加APK按钮事件 - 使用Tauri文件对话框
    addApkBtn.addEventListener('click', async function() {
        console.log('点击添加APK...');

        try {
            // 使用后端命令打开文件选择对话框
            const selectedPath = await invoke('select_apk_file');

            if (!selectedPath) {
                console.log('用户取消选择');
                return;
            }

            console.log('选择了文件:', selectedPath);

            // 获取文件名
            const pathParts = selectedPath.replace(/\\/g, '/').split('/');
            const fileName = pathParts[pathParts.length - 1];

            addApkBtn.disabled = true;
            addApkBtn.textContent = '复制中...';

            // 创建时间戳文件夹
            const timestamp = Date.now();
            const uploadTime = new Date().toISOString();
            const apkDir = `case/${caseNumber}/apks/${timestamp}`;

            // 创建APK目录
            await invoke('create_dir', { dirname: apkDir });
            console.log('已创建APK目录:', apkDir);

            // 获取当前工作目录以构建完整目标路径
            const currentDir = await invoke('get_current_dir');
            const destPath = `${currentDir}/${apkDir}/base.apk`.replace(/\\/g, '/');

            // 使用后端复制文件（避免大文件通过JS传输）
            await invoke('copy_file', {
                source: selectedPath,
                destination: destPath
            });

            console.log('APK复制成功:', destPath);

            // 获取文件大小
            const fileInfo = await invoke('read_file', { filename: `${apkDir}/base.apk` }).catch(() => null);
            // 通过文件系统获取文件大小，这里简化处理

            // 创建信息JSON文件
            const apkInfo = {
                originalName: fileName,
                uploadTime: uploadTime,
                fileSize: 0, // 将由后端在get_apk_list时更新
                timestamp: timestamp,
                sourcePath: selectedPath
            };

            const infoPath = `${apkDir}/info.json`;
            await invoke('write_file', {
                filename: infoPath,
                content: JSON.stringify(apkInfo, null, 2)
            });

            console.log('APK信息文件已创建:', infoPath);

            addApkBtn.textContent = '+ 添加';
            addApkBtn.disabled = false;

            toast.show({
                text: 'APK添加成功，开始反编译...',
                color: 'success',
                duration: 3000
            });

            // 先刷新列表显示正在反编译状态
            await refreshApkList();

            // 启动反编译（异步，不阻塞）
            const filePath = `${apkDir}/base.apk`;
            decompileApk(filePath, apkDir, timestamp);
        } catch (error) {
            console.error('APK添加失败:', error);
            toast.show({
                text: `APK添加失败: ${error}`,
                color: 'error',
                duration: 3000
            });
            addApkBtn.textContent = '+ 添加';
            addApkBtn.disabled = false;
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

            // 反编译成功后进行预分析（此时AndroidManifest.xml已生成）
            preanalyzeApkDetails(apkDir);

            // 刷新列表并自动选中新反编译的APK
            await refreshApkListAndSelect(timestamp);
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

    // 预分析APK详细信息（上传时自动运行，计算哈希和签名信息）
    async function preanalyzeApkDetails(apkDir) {
        try {
            console.log('开始预分析APK详细信息:', apkDir);
            const result = await invoke('preanalyze_apk_details', { apkDir: apkDir });
            console.log('APK详细信息预分析完成:', result);
        } catch (error) {
            console.error('APK详细信息预分析失败:', error);
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

    // 刷新APK列表并选中指定timestamp的APK
    async function refreshApkListAndSelect(targetTimestamp) {
        console.log('刷新APK列表并选中:', targetTimestamp);
        try {
            apkListData = await invoke('get_apk_list', { caseNumber: caseNumber });
            console.log('APK列表:', apkListData);

            renderApkTabs();

            // 查找目标timestamp对应的索引
            const targetIndex = apkListData.findIndex(apk => apk.timestamp === targetTimestamp);
            if (targetIndex !== -1) {
                selectApk(targetIndex);
            } else if (apkListData.length > 0) {
                // 如果没找到，选中第一个
                selectApk(0);
            } else {
                selectedApkIndex = -1;
                renderApkDetail(null);
            }
        } catch (error) {
            console.error('获取APK列表失败:', error);
        }
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
                ? `<img src="${convertFileSrc(apk.iconPath)}" alt="icon" onerror="this.parentElement.innerHTML='<span class=\\'apk-tab-icon-placeholder\\'>📦</span>'">`
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

        // 使用缓存快速判断是否有设备
        const cacheAge = Date.now() - adbDeviceCache.lastCheck;
        const cacheValid = cacheAge < 15000; // 缓存有效期15秒

        let installItem = null;

        if (cacheValid && adbDeviceCache.hasDevice) {
            // 缓存有效且有设备
            installItem = document.createElement('div');
            installItem.className = 'apk-context-menu-item';

            // 检查是否有缓存的安装状态
            if (apk.packageName && adbDeviceCache.installedPackages.has(apk.packageName)) {
                const isInstalled = adbDeviceCache.installedPackages.get(apk.packageName);
                installItem.textContent = isInstalled ? '重新安装' : '安装';
            } else {
                // 没有缓存安装状态，显示加载中并异步检测
                installItem.className = 'apk-context-menu-item loading';
                installItem.innerHTML = '<span class="menu-spinner"></span>检测中...';

                if (apk.packageName) {
                    invoke('check_apk_installed', { packageName: apk.packageName })
                        .then(result => {
                            adbDeviceCache.installedPackages.set(apk.packageName, result.installed);
                            if (installItem && installItem.parentNode) {
                                installItem.classList.remove('loading');
                                installItem.textContent = result.installed ? '重新安装' : '安装';
                            }
                        })
                        .catch(e => {
                            console.error('检查安装状态失败:', e);
                            if (installItem && installItem.parentNode) {
                                installItem.classList.remove('loading');
                                installItem.textContent = '安装';
                            }
                        });
                } else {
                    installItem.classList.remove('loading');
                    installItem.textContent = '安装';
                }
            }

            installItem.addEventListener('click', () => {
                menu.remove();
                installApkToDevice(apk);
            });
            menu.appendChild(installItem);
        } else if (cacheValid && !adbDeviceCache.hasDevice) {
            // 缓存有效但无设备，不显示安装按钮
        } else {
            // 缓存无效，需要检测
            installItem = document.createElement('div');
            installItem.className = 'apk-context-menu-item loading';
            installItem.innerHTML = '<span class="menu-spinner"></span>检测中...';
            menu.appendChild(installItem);

            // 异步检查设备和安装状态
            (async () => {
                try {
                    const deviceStatus = await invoke('check_adb_devices');
                    adbDeviceCache.hasDevice = (deviceStatus === 'has_devices');
                    adbDeviceCache.lastCheck = Date.now();

                    if (adbDeviceCache.hasDevice) {
                        // 有设备，检查是否已安装
                        let isInstalled = false;
                        if (apk.packageName) {
                            try {
                                const result = await invoke('check_apk_installed', { packageName: apk.packageName });
                                isInstalled = result.installed;
                                adbDeviceCache.installedPackages.set(apk.packageName, isInstalled);
                            } catch (e) {
                                console.error('检查安装状态失败:', e);
                            }
                        }

                        // 更新按钮状态
                        if (installItem && installItem.parentNode) {
                            installItem.classList.remove('loading');
                            installItem.textContent = isInstalled ? '重新安装' : '安装';
                            installItem.addEventListener('click', () => {
                                menu.remove();
                                installApkToDevice(apk);
                            });
                        }
                    } else {
                        // 无设备，移除安装按钮
                        if (installItem && installItem.parentNode) {
                            installItem.remove();
                        }
                    }
                } catch (e) {
                    console.error('检查ADB设备失败:', e);
                    if (installItem && installItem.parentNode) {
                        installItem.remove();
                    }
                }
            })();
        }

        // 在文件夹中打开
        const openFolderItem = document.createElement('div');
        openFolderItem.className = 'apk-context-menu-item';
        openFolderItem.textContent = '在文件夹中打开';
        openFolderItem.addEventListener('click', () => {
            menu.remove();
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
            invoke('open_file', { path: apkDir })
                .then(() => {
                    console.log('已打开文件夹:', apkDir);
                })
                .catch(err => {
                    console.error('打开文件夹失败:', err);
                    toast.show({
                        text: `打开文件夹失败: ${err}`,
                        color: 'error',
                        duration: 3000
                    });
                });
        });
        menu.appendChild(openFolderItem);

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
            // 更新缓存：标记为已安装
            if (apk.packageName) {
                adbDeviceCache.installedPackages.set(apk.packageName, true);
            }
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

        // 根据当前激活的面板加载相应数据
        const activeTab = document.querySelector('.operation-tab.active');
        if (activeTab) {
            if (activeTab.dataset.tab === 'overview') {
                loadOverview(apkListData[index]);
            } else if (activeTab.dataset.tab === 'permissions') {
                loadPermissions(apkListData[index]);
            } else if (activeTab.dataset.tab === 'details') {
                loadDetails(apkListData[index]);
            } else if (activeTab.dataset.tab === 'services') {
                loadThirdPartyServices(apkListData[index]);
            } else if (activeTab.dataset.tab === 'sensitive') {
                // 切换APK时刷新敏感信息面板
                refreshSensitiveUI();
            } else if (activeTab.dataset.tab === 'capture') {
                // 切换APK时刷新抓包会话列表并清空数据包显示
                loadCaptureSessions();
                // 清空数据包列表和详情
                captureState.selectedSessionId = null;
                captureState.packets = [];
                captureState.selectedPacketIndex = -1;
                capturePacketsBody.innerHTML = '';
                capturePacketsPlaceholder.classList.remove('hidden');
                capturePacketsTableWrapper.classList.remove('visible');
                capturePacketDetail.classList.remove('visible');
                packetsTitle.textContent = '数据包列表';
            }
        }
    }

    // 渲染APK详情
    function renderApkDetail(apk) {
        if (!apk) {
            apkDetailContainer.innerHTML = '<div class="apk-detail-empty">暂无APK，请点击添加按钮上传</div>';
            return;
        }

        const iconHtml = apk.iconPath
            ? `<img src="${convertFileSrc(apk.iconPath)}" alt="icon" onerror="this.parentElement.innerHTML='<span class=\\'apk-detail-icon-placeholder\\'>📦</span>'">`
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

    // 隐藏全屏加载蒙层
    function hideFullscreenLoading() {
        if (fullscreenLoading) {
            fullscreenLoading.classList.add('hidden');
        }
    }

    // 初始化页面时加载APK列表
    async function initApkPanel() {
        await refreshApkList();
        // APK列表加载完成后隐藏全屏加载蒙层
        hideFullscreenLoading();
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

    // 页面加载时初始化 - 先加载APK列表，再初始化设备（不阻塞）
    initApkPanel();
    initializeDevice();

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

            // 切换到总览面板时加载总览数据
            if (targetTab === 'overview' && selectedApkIndex >= 0) {
                loadOverview(apkListData[selectedApkIndex]);
            }

            // 切换到权限面板时加载权限数据
            if (targetTab === 'permissions' && selectedApkIndex >= 0) {
                loadPermissions(apkListData[selectedApkIndex]);
            }

            // 切换到详细信息面板时加载详细数据
            if (targetTab === 'details' && selectedApkIndex >= 0) {
                loadDetails(apkListData[selectedApkIndex]);
            }

            // 切换到第三方服务面板时加载数据
            if (targetTab === 'services' && selectedApkIndex >= 0) {
                loadThirdPartyServices(apkListData[selectedApkIndex]);
            }
        });
    });

    // 加载总览信息
    async function loadOverview(apk) {
        const basicInfoContent = document.getElementById('overview-basic-info-content');
        const permissionsContent = document.getElementById('overview-permissions-content');
        const signatureContent = document.getElementById('overview-signature-content');
        const ipContent = document.getElementById('overview-ip-content');

        if (!apk) {
            basicInfoContent.innerHTML = '<div class="overview-placeholder">上传一个apk开始分析</div>';
            permissionsContent.innerHTML = '<div class="overview-placeholder">上传一个apk开始分析</div>';
            signatureContent.innerHTML = '<div class="overview-placeholder">上传一个apk开始分析</div>';
            ipContent.innerHTML = '<div class="overview-placeholder">上传一个apk开始分析</div>';
            return;
        }

        if (!apk.isDecompiled) {
            basicInfoContent.innerHTML = '<div class="overview-placeholder">APK正在反编译中...</div>';
            permissionsContent.innerHTML = '<div class="overview-placeholder">APK正在反编译中...</div>';
            signatureContent.innerHTML = '<div class="overview-placeholder">APK正在反编译中...</div>';
            ipContent.innerHTML = '<div class="overview-placeholder">APK正在反编译中...</div>';
            return;
        }

        // 加载基本信息
        renderOverviewBasicInfo(apk);

        // 加载权限统计
        loadOverviewPermissions(apk);

        // 加载签名信息
        loadOverviewSignature(apk);

        // 加载IP检测
        loadOverviewIPs(apk);
    }

    // 渲染总览中的基本信息
    function renderOverviewBasicInfo(apk) {
        const basicInfoContent = document.getElementById('overview-basic-info-content');

        const infoItems = [
            { label: '程序入口', value: apk.mainActivity || '-' },
            { label: '版本代码', value: apk.versionCode || '-' },
            { label: '版本号', value: apk.versionName || '-' },
            { label: '最小SDK', value: apk.minSdk ? `API ${apk.minSdk}` : '-' },
            { label: '目标SDK', value: apk.targetSdk ? `API ${apk.targetSdk}` : '-' }
        ];

        basicInfoContent.innerHTML = `
            <div class="basic-info-grid">
                ${infoItems.map(item => `
                    <div class="basic-info-item">
                        <span class="basic-info-label">${item.label}</span>
                        <span class="basic-info-value" title="${item.value}">${item.value}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // 加载总览中的权限统计
    async function loadOverviewPermissions(apk) {
        const permissionsContent = document.getElementById('overview-permissions-content');
        permissionsContent.innerHTML = '<div class="overview-loading"><div class="spinner-small"></div></div>';

        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
            const result = await invoke('get_apk_permissions', { apkDir: apkDir });

            if (!result.success) {
                permissionsContent.innerHTML = `<div class="overview-placeholder">${result.message}</div>`;
                return;
            }

            renderOverviewPermissions(result.stats);
        } catch (error) {
            console.error('获取权限统计失败:', error);
            permissionsContent.innerHTML = '<div class="overview-placeholder">获取权限统计失败</div>';
        }
    }

    // 渲染总览中的权限统计
    function renderOverviewPermissions(stats) {
        const permissionsContent = document.getElementById('overview-permissions-content');

        if (!stats || stats.total === 0) {
            permissionsContent.innerHTML = '<div class="overview-placeholder">该APK未申请任何权限</div>';
            return;
        }

        // 权限等级配置
        const levelConfig = {
            'dangerous': { name: '危险', color: 'dangerous' },
            'signature': { name: '签名', color: 'signature' },
            'signature|privileged': { name: '签名|特权', color: 'signature-privileged' },
            'normal': { name: '普通', color: 'normal' },
            'other': { name: '其他', color: 'other' }
        };

        const levelStats = stats.levels || {};
        let html = `<div class="overview-stat-item total"><span class="overview-stat-value">${stats.total}</span><span class="overview-stat-label">总计</span></div>`;

        // 只显示主要的几种权限类型
        const mainLevels = ['dangerous', 'signature', 'normal'];
        for (const level of mainLevels) {
            const count = levelStats[level];
            if (count && count > 0) {
                const config = levelConfig[level] || { name: level, color: 'other' };
                html += `<div class="overview-stat-item ${config.color}"><span class="overview-stat-value">${count}</span><span class="overview-stat-label">${config.name}</span></div>`;
            }
        }

        // 计算其他类型的总数
        let otherCount = 0;
        for (const level of Object.keys(levelStats)) {
            if (!mainLevels.includes(level)) {
                otherCount += levelStats[level] || 0;
            }
        }
        if (otherCount > 0) {
            html += `<div class="overview-stat-item other"><span class="overview-stat-value">${otherCount}</span><span class="overview-stat-label">其他</span></div>`;
        }

        permissionsContent.innerHTML = `<div class="overview-stats-row">${html}</div>`;

        // 添加横向滚动支持：鼠标滚轮直接横向滚动
        const statsRow = permissionsContent.querySelector('.overview-stats-row');
        if (statsRow) {
            statsRow.addEventListener('wheel', (e) => {
                // 检查是否可以横向滚动
                const canScrollHorizontally = statsRow.scrollWidth > statsRow.clientWidth;
                if (canScrollHorizontally) {
                    e.preventDefault();
                    statsRow.scrollBy({
                        left: e.deltaY,
                        behavior: 'smooth'
                    });
                }
                // 如果不能横向滚动，则不阻止默认行为，允许页面正常上下滚动
            }, { passive: false });
        }
    }

    // 加载总览中的签名信息
    async function loadOverviewSignature(apk) {
        const signatureContent = document.getElementById('overview-signature-content');
        signatureContent.innerHTML = '<div class="overview-loading"><div class="spinner-small"></div></div>';

        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
            const result = await invoke('get_apk_details', { apkDir: apkDir });

            if (!result.success) {
                signatureContent.innerHTML = `<div class="overview-placeholder">${result.message}</div>`;
                return;
            }

            renderOverviewSignature(result.signature);
        } catch (error) {
            console.error('获取签名信息失败:', error);
            signatureContent.innerHTML = '<div class="overview-placeholder">获取签名信息失败</div>';
        }
    }

    // 渲染总览中的签名信息
    function renderOverviewSignature(signature) {
        const signatureContent = document.getElementById('overview-signature-content');

        if (signature.error) {
            signatureContent.innerHTML = `<div class="overview-placeholder">${signature.error}</div>`;
            return;
        }

        // 签名验证状态
        const verifiedClass = signature.verified ? 'verified' : 'not-verified';
        const verifiedText = signature.verified ? '验证通过' : '验证失败';
        const verifiedIcon = signature.verified ? '✓' : '✗';

        // 签名方案
        let schemesHtml = '';
        if (signature.signatureSchemes && signature.signatureSchemes.length > 0) {
            schemesHtml = signature.signatureSchemes.map(scheme => `<span class="overview-scheme-badge">${scheme}</span>`).join('');
        } else {
            schemesHtml = '<span class="overview-scheme-badge unknown">未知</span>';
        }

        signatureContent.innerHTML = `
            <div class="overview-signature-row">
                <div class="overview-signature-verification ${verifiedClass}">
                    <span class="overview-verification-icon">${verifiedIcon}</span>
                    <span class="overview-verification-text">${verifiedText}</span>
                </div>
                <div class="overview-signature-schemes">
                    <span class="overview-schemes-label">签名方案:</span>
                    ${schemesHtml}
                </div>
            </div>
        `;
    }

    // IP检测相关状态
    // 记录正在进行检测的APK，key为apk.timestamp，value为检测状态
    const ipCheckingMap = new Map();

    // 判断是否为私有IP
    function isPrivateIP(ip) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4) return false;

        // 10.0.0.0 - 10.255.255.255
        if (parts[0] === 10) return true;

        // 172.16.0.0 - 172.31.255.255
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

        // 192.168.0.0 - 192.168.255.255
        if (parts[0] === 192 && parts[1] === 168) return true;

        // 127.0.0.0 - 127.255.255.255 (回环地址)
        if (parts[0] === 127) return true;

        // 0.0.0.0
        if (parts[0] === 0) return true;

        // 169.254.0.0 - 169.254.255.255 (链路本地)
        if (parts[0] === 169 && parts[1] === 254) return true;

        // 224.0.0.0 - 239.255.255.255 (组播地址)
        if (parts[0] >= 224 && parts[0] <= 239) return true;

        // 255.255.255.255 (广播地址)
        if (parts[0] === 255 && parts[1] === 255 && parts[2] === 255 && parts[3] === 255) return true;

        return false;
    }

    // 判断是否为有效IP地址
    function isValidIP(ip) {
        const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = ip.match(ipRegex);
        if (!match) return false;

        for (let i = 1; i <= 4; i++) {
            const num = parseInt(match[i], 10);
            if (num < 0 || num > 255) return false;
        }
        return true;
    }

    // 加载总览中的IP检测
    async function loadOverviewIPs(apk, forceRescan = false) {
        const ipContent = document.getElementById('overview-ip-content');
        const ipStatus = document.getElementById('overview-ip-status');
        const rescanBtn = document.getElementById('overview-ip-rescan-btn');

        const apkTimestamp = apk?.timestamp;
        console.log('loadOverviewIPs 被调用, apk:', apkTimestamp, 'forceRescan:', forceRescan);

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
        const ipCacheFile = `${apkDir}/ip_check.json`;

        // 检查是否正在检测中
        if (ipCheckingMap.has(apkTimestamp) && !forceRescan) {
            // 显示检测中状态
            const checkingState = ipCheckingMap.get(apkTimestamp);
            ipContent.innerHTML = '<div class="overview-loading"><div class="spinner-small"></div></div>';
            ipStatus.innerHTML = `检测中 <span class="ip-progress">${checkingState.checked}/${checkingState.total}</span>`;
            rescanBtn.style.display = 'none';
            return;
        }

        // 如果不是强制重新检测，先尝试读取缓存
        if (!forceRescan) {
            try {
                const cacheContent = await invoke('read_file', { filename: ipCacheFile });
                const cacheData = JSON.parse(cacheContent);
                console.log('IP检测 - 读取到缓存:', cacheData);

                if (cacheData && cacheData.ips && cacheData.ips.length >= 0) {
                    // 显示缓存的结果
                    renderIPList(cacheData.ips, cacheData.privateCount, cacheData.publicCount);
                    rescanBtn.style.display = 'inline-block';
                    return;
                }
            } catch (e) {
                console.log('IP检测 - 无缓存，开始检测');
                // 没有缓存，继续检测
            }
        }

        // 显示加载状态
        ipContent.innerHTML = '<div class="overview-loading"><div class="spinner-small"></div></div>';
        ipStatus.textContent = '';
        rescanBtn.style.display = 'none';

        // 启动后台检测任务
        startIPCheck(apk, apkDir, ipCacheFile, forceRescan);
    }

    // 后台IP检测任务
    async function startIPCheck(apk, apkDir, ipCacheFile, forceRescan) {
        const apkTimestamp = apk.timestamp;

        // 如果已经在检测中且不是强制重新检测，直接返回
        if (ipCheckingMap.has(apkTimestamp) && !forceRescan) {
            return;
        }

        // 标记开始检测
        ipCheckingMap.set(apkTimestamp, { checked: 0, total: 0, aborted: false });

        try {
            // 先检查是否已有敏感信息缓存
            let sensitiveData = null;
            let hasScanCache = false;

            console.log('IP检测 - 请求敏感信息, apkDir:', apkDir);

            try {
                const result = await invoke('get_sensitive_info', {
                    apkDir,
                    page: 0,
                    pageSize: 1000,
                    category: 'ip'
                });

                console.log('IP检测 - get_sensitive_info 结果:', result);

                if (result.success) {
                    hasScanCache = true;
                    if (result.items && result.items.length > 0) {
                        sensitiveData = result.items;
                        console.log('IP检测 - 获取到IP数据条数:', sensitiveData.length);
                    } else {
                        console.log('IP检测 - 扫描过但没有IP数据');
                    }
                }
            } catch (e) {
                console.log('IP检测 - 获取敏感信息缓存失败:', e);
            }

            if (!hasScanCache) {
                ipCheckingMap.delete(apkTimestamp);
                updateIPUIIfCurrent(apkTimestamp, () => {
                    const ipContent = document.getElementById('overview-ip-content');
                    ipContent.innerHTML = '<div class="overview-placeholder">请先在"敏感信息"页面进行扫描</div>';
                });
                return;
            }

            if (!sensitiveData || sensitiveData.length === 0) {
                // 保存空结果到缓存
                await saveIPCache(ipCacheFile, [], 0, 0);
                ipCheckingMap.delete(apkTimestamp);
                updateIPUIIfCurrent(apkTimestamp, () => {
                    const ipContent = document.getElementById('overview-ip-content');
                    const ipStatus = document.getElementById('overview-ip-status');
                    const rescanBtn = document.getElementById('overview-ip-rescan-btn');
                    ipContent.innerHTML = '<div class="overview-placeholder">未检测到IP地址</div>';
                    rescanBtn.style.display = 'inline-block';
                });
                return;
            }

            // 提取所有唯一的IP地址
            const ipSet = new Set();
            for (const item of sensitiveData) {
                if (isValidIP(item.content)) {
                    ipSet.add(item.content);
                }
            }

            const allIPs = Array.from(ipSet);

            if (allIPs.length === 0) {
                await saveIPCache(ipCacheFile, [], 0, 0);
                ipCheckingMap.delete(apkTimestamp);
                updateIPUIIfCurrent(apkTimestamp, () => {
                    const ipContent = document.getElementById('overview-ip-content');
                    const rescanBtn = document.getElementById('overview-ip-rescan-btn');
                    ipContent.innerHTML = '<div class="overview-placeholder">未检测到有效IP地址</div>';
                    rescanBtn.style.display = 'inline-block';
                });
                return;
            }

            // 分类：私有IP和公网IP
            const privateIPs = allIPs.filter(ip => isPrivateIP(ip));
            const publicIPs = allIPs.filter(ip => !isPrivateIP(ip));

            // 用于保存结果的数组
            const resultIPs = [];

            // 先添加私有IP
            for (const ip of privateIPs) {
                resultIPs.push({ ip, type: 'private' });
            }

            // 更新检测状态
            const checkState = ipCheckingMap.get(apkTimestamp);
            if (checkState) {
                checkState.total = publicIPs.length;
                checkState.checked = 0;
            }

            // 更新UI显示私有IP
            updateIPUIIfCurrent(apkTimestamp, () => {
                const ipContent = document.getElementById('overview-ip-content');
                const ipStatus = document.getElementById('overview-ip-status');
                ipContent.innerHTML = '<div class="overview-ip-list" id="overview-ip-list"></div>';
                const ipList = document.getElementById('overview-ip-list');

                for (const ip of privateIPs) {
                    const ipItem = document.createElement('div');
                    ipItem.className = 'overview-ip-item private';
                    ipItem.innerHTML = `
                        <span class="overview-ip-address">${ip}</span>
                        <span class="overview-ip-tag private">内网</span>
                    `;
                    ipList.appendChild(ipItem);
                }

                if (publicIPs.length > 0) {
                    ipStatus.innerHTML = `检测中 <span class="ip-progress">0/${publicIPs.length}</span>`;
                }
            });

            // 如果没有公网IP，保存结果并完成
            if (publicIPs.length === 0) {
                await saveIPCache(ipCacheFile, resultIPs, privateIPs.length, 0);
                ipCheckingMap.delete(apkTimestamp);
                updateIPUIIfCurrent(apkTimestamp, () => {
                    const ipStatus = document.getElementById('overview-ip-status');
                    const rescanBtn = document.getElementById('overview-ip-rescan-btn');
                    ipStatus.textContent = `共 ${privateIPs.length} 个`;
                    rescanBtn.style.display = 'inline-block';
                });
                return;
            }

            // 并发检测公网IP，限制并发数为5
            let checkedCount = 0;
            let reachableCount = 0;
            const concurrentLimit = 5;
            const chunks = [];
            for (let i = 0; i < publicIPs.length; i += concurrentLimit) {
                chunks.push(publicIPs.slice(i, i + concurrentLimit));
            }

            for (const chunk of chunks) {
                // 检查是否被中止
                const state = ipCheckingMap.get(apkTimestamp);
                if (!state || state.aborted) {
                    console.log('IP检测 - 被中止:', apkTimestamp);
                    ipCheckingMap.delete(apkTimestamp);
                    return;
                }

                const promises = chunk.map(async (ip) => {
                    try {
                        const result = await invoke('ping_ip', { ip });
                        return { ip, reachable: result.reachable };
                    } catch (e) {
                        return { ip, reachable: false };
                    }
                });

                const results = await Promise.all(promises);

                for (const { ip, reachable } of results) {
                    checkedCount++;

                    // 更新检测状态
                    const currentState = ipCheckingMap.get(apkTimestamp);
                    if (currentState) {
                        currentState.checked = checkedCount;
                    }

                    if (reachable) {
                        reachableCount++;
                        resultIPs.push({ ip, type: 'public' });

                        // 更新UI添加可达的公网IP
                        updateIPUIIfCurrent(apkTimestamp, () => {
                            const ipList = document.getElementById('overview-ip-list');
                            const ipStatus = document.getElementById('overview-ip-status');
                            if (ipList) {
                                const ipItem = document.createElement('div');
                                ipItem.className = 'overview-ip-item public';
                                ipItem.innerHTML = `
                                    <span class="overview-ip-address">${ip}</span>
                                    <span class="overview-ip-tag public">公网</span>
                                `;
                                ipList.appendChild(ipItem);
                            }
                            ipStatus.innerHTML = `检测中 <span class="ip-progress">${checkedCount}/${publicIPs.length}</span>`;
                        });
                    } else {
                        // 只更新进度
                        updateIPUIIfCurrent(apkTimestamp, () => {
                            const ipStatus = document.getElementById('overview-ip-status');
                            ipStatus.innerHTML = `检测中 <span class="ip-progress">${checkedCount}/${publicIPs.length}</span>`;
                        });
                    }
                }
            }

            // 检测完成，保存结果到缓存
            await saveIPCache(ipCacheFile, resultIPs, privateIPs.length, reachableCount);
            ipCheckingMap.delete(apkTimestamp);

            const totalCount = privateIPs.length + reachableCount;
            updateIPUIIfCurrent(apkTimestamp, () => {
                const ipContent = document.getElementById('overview-ip-content');
                const ipStatus = document.getElementById('overview-ip-status');
                const rescanBtn = document.getElementById('overview-ip-rescan-btn');

                if (totalCount === 0) {
                    ipContent.innerHTML = '<div class="overview-placeholder">未检测到可达的IP地址</div>';
                    ipStatus.textContent = '';
                } else {
                    ipStatus.textContent = `共 ${totalCount} 个`;
                }
                rescanBtn.style.display = 'inline-block';
            });

            console.log('IP检测 - 完成:', apkTimestamp);

        } catch (error) {
            console.error('加载IP检测失败:', error);
            ipCheckingMap.delete(apkTimestamp);
            updateIPUIIfCurrent(apkTimestamp, () => {
                const ipContent = document.getElementById('overview-ip-content');
                const rescanBtn = document.getElementById('overview-ip-rescan-btn');
                ipContent.innerHTML = '<div class="overview-placeholder">加载失败</div>';
                rescanBtn.style.display = 'inline-block';
            });
        }
    }

    // 仅当当前显示的APK与检测的APK匹配时更新UI
    function updateIPUIIfCurrent(apkTimestamp, updateFn) {
        const currentApk = apkListData[selectedApkIndex];
        const activeTab = document.querySelector('.operation-tab.active');

        // 检查是否在总览页面且是当前APK
        if (currentApk && currentApk.timestamp === apkTimestamp && activeTab && activeTab.dataset.tab === 'overview') {
            updateFn();
        }
    }

    // 保存IP检测结果到缓存
    async function saveIPCache(cacheFile, ips, privateCount, publicCount) {
        try {
            const cacheData = {
                timestamp: Date.now(),
                ips: ips,
                privateCount: privateCount,
                publicCount: publicCount
            };
            await invoke('write_file', {
                filename: cacheFile,
                content: JSON.stringify(cacheData, null, 2)
            });
            console.log('IP检测 - 缓存已保存');
        } catch (e) {
            console.error('IP检测 - 保存缓存失败:', e);
        }
    }

    // 渲染IP列表（从缓存读取时使用）
    function renderIPList(ips, privateCount, publicCount) {
        const ipContent = document.getElementById('overview-ip-content');
        const ipStatus = document.getElementById('overview-ip-status');

        if (!ips || ips.length === 0) {
            ipContent.innerHTML = '<div class="overview-placeholder">未检测到可达的IP地址</div>';
            ipStatus.textContent = '';
            return;
        }

        ipContent.innerHTML = '<div class="overview-ip-list" id="overview-ip-list"></div>';
        const ipList = document.getElementById('overview-ip-list');

        for (const item of ips) {
            const ipItem = document.createElement('div');
            ipItem.className = `overview-ip-item ${item.type}`;
            const tagText = item.type === 'private' ? '内网' : '公网';
            ipItem.innerHTML = `
                <span class="overview-ip-address">${item.ip}</span>
                <span class="overview-ip-tag ${item.type}">${tagText}</span>
            `;
            ipList.appendChild(ipItem);
        }

        ipStatus.textContent = `共 ${ips.length} 个`;
    }

    // 重新检测按钮事件
    document.getElementById('overview-ip-rescan-btn').addEventListener('click', () => {
        if (selectedApkIndex >= 0) {
            loadOverviewIPs(apkListData[selectedApkIndex], true);
        }
    });

    // 总览面板中的链接点击事件
    document.querySelectorAll('.overview-link').forEach(link => {
        link.addEventListener('click', () => {
            const target = link.dataset.target;
            // 找到对应的tab并模拟点击
            const targetTab = document.querySelector(`.operation-tab[data-tab="${target}"]`);
            if (targetTab) {
                targetTab.click();
            }
        });
    });

    // 加载APK详细信息（哈希和签名）
    async function loadDetails(apk) {
        const detailsPanel = document.getElementById('tab-details');

        if (!apk) {
            detailsPanel.innerHTML = '<div class="operation-panel-placeholder">上传一个apk开始分析</div>';
            return;
        }

        // 显示加载状态
        detailsPanel.innerHTML = '<div class="details-loading"><div class="spinner"></div><span>正在分析APK详细信息...</span></div>';

        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
            const result = await invoke('get_apk_details', { apkDir: apkDir });

            if (!result.success) {
                detailsPanel.innerHTML = `<div class="operation-panel-placeholder">${result.message}</div>`;
                return;
            }

            renderDetails(result, apk);
        } catch (error) {
            console.error('获取详细信息失败:', error);
            detailsPanel.innerHTML = `<div class="operation-panel-placeholder">获取详细信息失败: ${error}</div>`;
        }
    }

    // 渲染详细信息
    function renderDetails(data, apk) {
        const detailsPanel = document.getElementById('tab-details');
        const { hashes, components, signature } = data;

        // 构建文件哈希部分
        const hashesHtml = `
            <div class="details-section">
                <div class="details-section-title">安装文件哈希</div>
                <div class="details-hash-list">
                    <div class="details-hash-item">
                        <span class="hash-label">MD5</span>
                        <span class="hash-value" title="点击复制" onclick="copyToClipboard('${hashes.md5}')">${hashes.md5}</span>
                    </div>
                    <div class="details-hash-item">
                        <span class="hash-label">SHA-1</span>
                        <span class="hash-value" title="点击复制" onclick="copyToClipboard('${hashes.sha1}')">${hashes.sha1}</span>
                    </div>
                    <div class="details-hash-item">
                        <span class="hash-label">SHA-256</span>
                        <span class="hash-value" title="点击复制" onclick="copyToClipboard('${hashes.sha256}')">${hashes.sha256}</span>
                    </div>
                </div>
            </div>
        `;

        // 构建四大组件部分
        const componentsHtml = buildComponentsHtml(components);

        // 构建签名信息部分
        let signatureHtml = '';
        if (signature.error) {
            signatureHtml = `
                <div class="details-section">
                    <div class="details-section-title">签名信息</div>
                    <div class="details-error">${signature.error}</div>
                </div>
            `;
        } else {
            // 签名验证状态
            const verifiedClass = signature.verified ? 'verified' : 'not-verified';
            const verifiedText = signature.verified ? '签名验证通过' : '签名验证失败';

            // 签名方案
            const schemesHtml = signature.signatureSchemes && signature.signatureSchemes.length > 0
                ? signature.signatureSchemes.map(scheme => `<span class="scheme-badge">${scheme}</span>`).join('')
                : '<span class="scheme-badge unknown">未知</span>';

            // 签名者信息
            let signersHtml = '';
            if (signature.signers && signature.signers.length > 0) {
                signersHtml = signature.signers.map((signer, index) => {
                    const signerItems = [];

                    if (signer.dn) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">DN</span><span class="signer-value">${escapeHtml(signer.dn)}</span></div>`);
                    }
                    if (signer.keyAlgorithm) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">密钥算法</span><span class="signer-value">${signer.keyAlgorithm}</span></div>`);
                    }
                    if (signer.keySize) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">密钥长度</span><span class="signer-value">${signer.keySize} bits</span></div>`);
                    }
                    if (signer.sha256Digest) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">证书 SHA-256</span><span class="signer-value hash-value" title="点击复制" onclick="copyToClipboard('${signer.sha256Digest}')">${signer.sha256Digest}</span></div>`);
                    }
                    if (signer.sha1Digest) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">证书 SHA-1</span><span class="signer-value hash-value" title="点击复制" onclick="copyToClipboard('${signer.sha1Digest}')">${signer.sha1Digest}</span></div>`);
                    }
                    if (signer.md5Digest) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">证书 MD5</span><span class="signer-value hash-value" title="点击复制" onclick="copyToClipboard('${signer.md5Digest}')">${signer.md5Digest}</span></div>`);
                    }
                    if (signer.publicKeySha256) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">公钥 SHA-256</span><span class="signer-value hash-value" title="点击复制" onclick="copyToClipboard('${signer.publicKeySha256}')">${signer.publicKeySha256}</span></div>`);
                    }
                    if (signer.publicKeySha1) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">公钥 SHA-1</span><span class="signer-value hash-value" title="点击复制" onclick="copyToClipboard('${signer.publicKeySha1}')">${signer.publicKeySha1}</span></div>`);
                    }
                    if (signer.publicKeyMd5) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">公钥 MD5</span><span class="signer-value hash-value" title="点击复制" onclick="copyToClipboard('${signer.publicKeyMd5}')">${signer.publicKeyMd5}</span></div>`);
                    }

                    return `
                        <div class="signer-card">
                            <div class="signer-header">签名者 #${index + 1}</div>
                            <div class="signer-content">
                                ${signerItems.join('')}
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                signersHtml = '<div class="details-empty">未找到签名者信息</div>';
            }

            signatureHtml = `
                <div class="details-section">
                    <div class="details-section-title">签名验证</div>
                    <div class="verification-status ${verifiedClass}">
                        <span class="verification-icon">${signature.verified ? '✓' : '✗'}</span>
                        <span class="verification-text">${verifiedText}</span>
                    </div>
                </div>
                <div class="details-section">
                    <div class="details-section-title">签名方案</div>
                    <div class="schemes-container">
                        ${schemesHtml}
                    </div>
                </div>
                <div class="details-section">
                    <div class="details-section-title">签名者证书</div>
                    <div class="signers-container">
                        ${signersHtml}
                    </div>
                </div>
            `;
        }

        detailsPanel.innerHTML = `
            <div class="details-container">
                ${hashesHtml}
                ${componentsHtml}
                ${signatureHtml}
            </div>
        `;

        // 初始化组件折叠/展开功能
        initComponentsToggle();
    }

    // 构建四大组件HTML
    function buildComponentsHtml(components) {
        if (!components) {
            return '';
        }

        const componentTypes = [
            { key: 'activities', name: 'Activity' },
            { key: 'services', name: 'Service' },
            { key: 'receivers', name: 'Receiver' },
            { key: 'providers', name: 'Provider' }
        ];

        let html = '<div class="details-section components-section">';
        html += '<div class="details-section-title">四大组件</div>';
        html += '<div class="components-wrapper">';

        for (const type of componentTypes) {
            const items = components[type.key] || [];
            const count = items.length;

            html += `
                <div class="component-group" data-component="${type.key}">
                    <div class="component-header">
                        <div class="component-header-left">
                            <span class="component-name">${type.name}</span>
                            <span class="component-count">${count}</span>
                        </div>
                        <div class="component-toggle collapsed">
                            <span class="toggle-icon">▼</span>
                        </div>
                    </div>
                    <div class="component-content collapsed">
                        <div class="component-list">
                            ${items.length > 0
                                ? items.map(item => `<div class="component-item" title="${item}">${item}</div>`).join('')
                                : '<div class="component-empty">无</div>'
                            }
                        </div>
                    </div>
                </div>
            `;
        }

        html += '</div></div>';
        return html;
    }

    // 初始化组件折叠/展开功能
    function initComponentsToggle() {
        const componentGroups = document.querySelectorAll('.component-group');

        componentGroups.forEach(group => {
            const header = group.querySelector('.component-header');
            const toggle = group.querySelector('.component-toggle');
            const content = group.querySelector('.component-content');

            header.addEventListener('click', () => {
                const isCollapsed = content.classList.contains('collapsed');

                if (isCollapsed) {
                    // 展开
                    content.classList.remove('collapsed');
                    toggle.classList.remove('collapsed');
                } else {
                    // 收起
                    content.classList.add('collapsed');
                    toggle.classList.add('collapsed');
                }
            });
        });
    }

    // HTML转义函数
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 加载第三方服务分析
    async function loadThirdPartyServices(apk) {
        const servicesPanel = document.getElementById('tab-services');

        if (!apk) {
            servicesPanel.innerHTML = '<div class="operation-panel-placeholder">上传一个apk开始分析</div>';
            return;
        }

        if (!apk.isDecompiled) {
            servicesPanel.innerHTML = '<div class="operation-panel-placeholder">APK正在反编译中，请稍候...</div>';
            return;
        }

        // 显示加载状态
        servicesPanel.innerHTML = '<div class="services-loading"><div class="spinner"></div><span>正在分析第三方服务...</span></div>';

        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
            const result = await invoke('analyze_third_party_services', { apkDir: apkDir });

            if (!result.success) {
                servicesPanel.innerHTML = `<div class="operation-panel-placeholder">${result.message}</div>`;
                return;
            }

            renderThirdPartyServices(result);
        } catch (error) {
            console.error('分析第三方服务失败:', error);
            servicesPanel.innerHTML = `<div class="operation-panel-placeholder">分析第三方服务失败: ${error}</div>`;
        }
    }

    // 渲染第三方服务
    function renderThirdPartyServices(data) {
        const servicesPanel = document.getElementById('tab-services');
        const { packers, sdks, forensics, libraries, summary } = data;

        // 构建各部分HTML
        const sectionsHtml = [];

        // 打包服务商
        sectionsHtml.push(buildServiceSection('打包服务商', packers, 'packers', summary.packersCount));

        // SDK服务商
        sectionsHtml.push(buildServiceSection('SDK服务商', sdks, 'sdks', summary.sdksCount));

        // 疑似调证值
        sectionsHtml.push(buildServiceSection('疑似调证值', forensics, 'forensics', summary.forensicsCount, true));

        // 第三方库
        sectionsHtml.push(buildServiceSection('第三方库', libraries, 'libraries', summary.librariesCount));

        servicesPanel.innerHTML = `
            <div class="services-container">
                ${sectionsHtml.join('')}
            </div>
        `;
    }

    // 构建服务分类区块
    function buildServiceSection(title, items, type, count, showEvidence = false) {
        const isEmpty = !items || items.length === 0;

        let itemsHtml = '';
        if (isEmpty) {
            itemsHtml = '<div class="services-empty">未检测到</div>';
        } else {
            // 按type分组
            const groupedItems = {};
            for (const item of items) {
                const itemType = item.type || '其他';
                if (!groupedItems[itemType]) {
                    groupedItems[itemType] = [];
                }
                groupedItems[itemType].push(item);
            }

            // 渲染分组
            for (const [groupType, groupItems] of Object.entries(groupedItems)) {
                itemsHtml += `<div class="services-group">`;
                itemsHtml += `<div class="services-group-title">${groupType}</div>`;
                itemsHtml += `<div class="services-group-items">`;
                for (const item of groupItems) {
                    const evidenceHtml = showEvidence && item.evidence
                        ? `<span class="service-evidence">${item.evidence}</span>`
                        : '';
                    itemsHtml += `
                        <div class="service-item">
                            <span class="service-name">${item.name}</span>
                            <span class="service-package">${item.package}</span>
                            ${evidenceHtml}
                        </div>
                    `;
                }
                itemsHtml += `</div></div>`;
            }
        }

        return `
            <div class="services-section" data-type="${type}">
                <div class="services-section-header">
                    <span class="services-section-title">${title}</span>
                    <span class="services-section-count">${count}</span>
                </div>
                <div class="services-section-content">
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    // 加载APK权限
    async function loadPermissions(apk) {
        const permissionsPanel = document.getElementById('tab-permissions');

        if (!apk) {
            permissionsPanel.innerHTML = '<div class="operation-panel-placeholder">上传一个apk开始分析</div>';
            return;
        }

        if (!apk.isDecompiled) {
            permissionsPanel.innerHTML = '<div class="operation-panel-placeholder">APK正在反编译中，请稍候...</div>';
            return;
        }

        // 显示加载状态
        permissionsPanel.innerHTML = '<div class="permissions-loading"><div class="spinner"></div><span>加载权限信息...</span></div>';

        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
            const result = await invoke('get_apk_permissions', { apkDir: apkDir });

            if (!result.success) {
                permissionsPanel.innerHTML = `<div class="operation-panel-placeholder">${result.message}</div>`;
                return;
            }

            renderPermissions(result.permissions, result.stats);
        } catch (error) {
            console.error('获取权限失败:', error);
            permissionsPanel.innerHTML = `<div class="operation-panel-placeholder">获取权限失败: ${error}</div>`;
        }
    }

    // 渲染权限列表
    function renderPermissions(permissions, stats) {
        const permissionsPanel = document.getElementById('tab-permissions');

        if (permissions.length === 0) {
            permissionsPanel.innerHTML = '<div class="operation-panel-placeholder">该APK未申请任何权限</div>';
            return;
        }

        // 权限等级配置
        const levelConfig = {
            'dangerous': { name: '危险', color: 'dangerous' },
            'signature': { name: '签名', color: 'signature' },
            'signature|privileged': { name: '签名|特权', color: 'signature-privileged' },
            'signature|privileged|development': { name: '签名|特权|开发', color: 'signature-dev' },
            'signature|privileged|appop': { name: '签名|特权|应用操作', color: 'signature-privileged-appop' },
            'signature|appop': { name: '签名|应用操作', color: 'signature-appop' },
            'signature|preinstalled|knownSigner|role': { name: '签名|预装|已知签名者|角色', color: 'signature-preinstalled' },
            'internal|role': { name: '内部|角色', color: 'internal-role' },
            'internal|privileged': { name: '内部|特权', color: 'internal-privileged' },
            'normal': { name: '普通', color: 'normal' },
            'normal|instant': { name: '普通|即时', color: 'normal-instant' },
            'normal|appop|instant': { name: '普通|应用操作|即时', color: 'normal-appop' },
            'other': { name: '其他', color: 'other' }
        };

        // 构建左侧统计栏
        const levelStats = stats.levels || {};
        let statsItemsHtml = `
            <div class="stats-item-vertical">
                <span class="stats-value-large">${stats.total}</span>
                <span class="stats-label">总计</span>
            </div>
        `;

        // 按顺序显示各等级统计
        const levelOrder = ['dangerous', 'signature', 'signature|privileged', 'signature|privileged|development',
                           'signature|privileged|appop', 'signature|appop', 'signature|preinstalled|knownSigner|role', 'internal|role',
                           'internal|privileged', 'normal', 'normal|instant', 'normal|appop|instant', 'other'];

        for (const level of levelOrder) {
            const count = levelStats[level];
            if (count && count > 0) {
                const config = levelConfig[level] || { name: level, color: 'other' };
                statsItemsHtml += `
                    <div class="stats-item-vertical ${config.color}" data-permission-level="${level}">
                        <span class="stats-value-large">${count}</span>
                        <span class="stats-label">${config.name}</span>
                    </div>
                `;
            }
        }

        const statsHtml = `
            <div class="permissions-sidebar">
                <div class="permissions-stats-vertical">
                    <div class="stats-title">权限统计</div>
                    ${statsItemsHtml}
                </div>
            </div>
        `;

        // 将权限分成两列
        const midPoint = Math.ceil(permissions.length / 2);
        const leftPermissions = permissions.slice(0, midPoint);
        const rightPermissions = permissions.slice(midPoint);

        const renderPermissionItem = (perm) => {
            const config = levelConfig[perm.level] || { name: perm.level, color: 'other' };
            const levelClass = `permission-level-${config.color}`;

            return `
                <div class="permission-item ${levelClass}" data-permission-level="${perm.level}">
                    <div class="permission-header">
                        <span class="permission-name">${perm.name_zh}</span>
                        <span class="permission-badge ${config.color}">${config.name}</span>
                    </div>
                    <div class="permission-description">${perm.description}</div>
                    <div class="permission-full-name">${perm.permission}</div>
                </div>
            `;
        };

        const leftColumnHtml = leftPermissions.map(renderPermissionItem).join('');
        const rightColumnHtml = rightPermissions.map(renderPermissionItem).join('');

        permissionsPanel.innerHTML = `
            <div class="permissions-container">
                ${statsHtml}
                <div class="permissions-main">
                    <div class="permissions-columns">
                        <div class="permissions-column">${leftColumnHtml}</div>
                        <div class="permissions-column">${rightColumnHtml}</div>
                    </div>
                </div>
            </div>
        `;

        // 添加权限统计项的交互事件
        const statsItems = permissionsPanel.querySelectorAll('.stats-item-vertical');
        const permissionItems = permissionsPanel.querySelectorAll('.permission-item');

        statsItems.forEach(statsItem => {
            statsItem.addEventListener('mouseenter', () => {
                const level = statsItem.getAttribute('data-permission-level');
                // 所有权限项都变灰
                permissionItems.forEach(item => {
                    if (item.getAttribute('data-permission-level') !== level) {
                        item.classList.add('dimmed');
                    }
                });
            });

            statsItem.addEventListener('mouseleave', () => {
                // 恢复所有权限项的原色
                permissionItems.forEach(item => {
                    item.classList.remove('dimmed');
                });
            });
        });
    }

    // ========== JADX源码查看器 ==========
    const jadxOverlay = document.getElementById('jadx-overlay');
    const jadxCloseBtn = document.getElementById('jadx-close-btn');
    const jadxSearchBtn = document.getElementById('jadx-search-btn');
    const jadxViewerBtn = document.getElementById('jadx-viewer-btn');
    const jadxTree = document.getElementById('jadx-tree');
    const jadxMain = document.getElementById('jadx-main');
    const jadxCurrentPath = document.getElementById('jadx-current-path');
    const jadxResizer = document.getElementById('jadx-resizer');
    const jadxSidebar = document.getElementById('jadx-sidebar');

    // 搜索相关元素
    const searchOverlay = document.getElementById('search-overlay');
    const searchCloseBtn = document.getElementById('search-close-btn');
    const searchInput = document.getElementById('search-input');
    const searchCount = document.getElementById('search-count');
    const searchResultsList = document.getElementById('search-results-list');
    const searchPreviewPath = document.getElementById('search-preview-path');
    const searchPreviewContent = document.getElementById('search-preview-content');
    const searchResizer = document.getElementById('search-resizer');
    const searchResultsPanel = document.getElementById('search-results-panel');

    let jadxFileTree = null;
    let currentFilePath = null;
    let searchTimeout = null;
    let searchResults = [];
    let selectedSearchIndex = -1;
    let currentBinaryData = null;  // 当前二进制文件数据
    let currentEncoding = 'ascii'; // 当前编码
    let currentHexPage = 0;        // 当前Hex页码
    let hexPageSizeKB = 64;        // 每页大小（KB），默认64KB

    // 打开JADX查看器
    jadxViewerBtn.addEventListener('click', async () => {
        if (selectedApkIndex < 0) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const apk = apkListData[selectedApkIndex];
        if (!apk.isDecompiled) {
            toast.show({ text: 'APK尚未反编译完成', color: 'warning', duration: 2000 });
            return;
        }

        jadxOverlay.classList.remove('hidden');
        await loadJadxFileTree();
    });

    // 关闭JADX查看器
    jadxCloseBtn.addEventListener('click', () => {
        jadxOverlay.classList.add('hidden');
    });

    // 打开搜索
    jadxSearchBtn.addEventListener('click', () => {
        searchOverlay.classList.remove('hidden');
        searchInput.focus();
    });

    // 关闭搜索
    searchCloseBtn.addEventListener('click', () => {
        searchOverlay.classList.add('hidden');
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        // Ctrl+F 打开搜索
        if (e.ctrlKey && e.key === 'f' && !jadxOverlay.classList.contains('hidden')) {
            e.preventDefault();
            searchOverlay.classList.remove('hidden');
            searchInput.focus();
        }
        // ESC 关闭搜索蒙层
        if (e.key === 'Escape' && !searchOverlay.classList.contains('hidden')) {
            searchOverlay.classList.add('hidden');
        }
    });

    // 加载文件树
    async function loadJadxFileTree() {
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        jadxTree.innerHTML = '<div class="jadx-loading">加载文件树中...</div>';
        jadxMain.innerHTML = '<div class="jadx-placeholder">选择左侧文件查看源码</div>';
        jadxCurrentPath.textContent = '';

        try {
            const result = await invoke('get_jadx_file_tree', { apkDir });

            if (!result.success) {
                jadxTree.innerHTML = `<div class="jadx-loading">${result.message}</div>`;
                return;
            }

            jadxFileTree = result.tree;
            jadxTree.innerHTML = '';
            renderFileTree(result.tree, jadxTree);
        } catch (error) {
            jadxTree.innerHTML = `<div class="jadx-loading">加载失败: ${error}</div>`;
        }
    }

    // 渲染文件树（懒加载版本）
    function renderFileTree(nodes, container, level = 0) {
        nodes.forEach(node => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'tree-node';
            nodeEl.dataset.path = node.path;

            const headerEl = document.createElement('div');
            headerEl.className = 'tree-node-header';
            headerEl.style.paddingLeft = `${8 + level * 12}px`;

            if (node.is_dir) {
                headerEl.innerHTML = `
                    <span class="tree-node-toggle">${node.has_children ? '▶' : ''}</span>
                    <span class="tree-node-icon">📁</span>
                    <span class="tree-node-name">${escapeHtml(node.name)}</span>
                `;

                const childrenEl = document.createElement('div');
                childrenEl.className = 'tree-node-children collapsed';
                childrenEl.dataset.loaded = 'false';

                headerEl.addEventListener('click', async (e) => {
                    e.stopPropagation();

                    if (!node.has_children) return;

                    const toggle = headerEl.querySelector('.tree-node-toggle');
                    const icon = headerEl.querySelector('.tree-node-icon');

                    if (childrenEl.classList.contains('collapsed')) {
                        // 展开
                        if (childrenEl.dataset.loaded === 'false') {
                            // 懒加载子目录 - 显示加载中的旋转圆圈
                            toggle.textContent = '';
                            toggle.classList.add('loading');

                            // 3秒后显示提示
                            const loadingTimeout = setTimeout(() => {
                                toast.show({
                                    text: `${node.name} 文件夹中文件较多，加载时间较长，请耐心等待`,
                                    color: 'warning',
                                    duration: 4000
                                });
                            }, 3000);

                            const success = await loadSubdirectory(node.path, childrenEl, level + 1);

                            // 清除超时提示
                            clearTimeout(loadingTimeout);

                            toggle.classList.remove('loading');
                            if (success) {
                                childrenEl.dataset.loaded = 'true';
                                childrenEl.classList.remove('collapsed');
                                toggle.textContent = '▼';
                                toggle.classList.add('expanded');
                                icon.textContent = '📂';
                            } else {
                                // 加载失败，恢复箭头状态
                                toggle.textContent = '▶';
                            }
                        } else {
                            childrenEl.classList.remove('collapsed');
                            toggle.textContent = '▼';
                            toggle.classList.add('expanded');
                            icon.textContent = '📂';
                        }
                    } else {
                        // 折叠
                        childrenEl.classList.add('collapsed');
                        toggle.textContent = '▶';
                        toggle.classList.remove('expanded');
                        icon.textContent = '📁';
                    }
                });

                nodeEl.appendChild(headerEl);
                nodeEl.appendChild(childrenEl);
            } else {
                const icon = getFileIcon(node.name);
                headerEl.innerHTML = `
                    <span class="tree-node-toggle"></span>
                    <span class="tree-node-icon">${icon}</span>
                    <span class="tree-node-name">${escapeHtml(node.name)}</span>
                `;

                headerEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectFile(node.path);
                });

                nodeEl.appendChild(headerEl);
            }

            container.appendChild(nodeEl);
        });
    }

    // 懒加载子目录
    async function loadSubdirectory(subPath, container, level) {
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('get_jadx_subdirectory', { apkDir, subPath });

            if (!result.success) {
                container.innerHTML = `<div class="jadx-loading" style="padding-left: ${8 + level * 12}px">${result.message}</div>`;
                return false;
            }

            renderFileTree(result.children, container, level);
            return true;
        } catch (error) {
            console.error('加载子目录失败:', error);
            container.innerHTML = `<div class="jadx-loading" style="padding-left: ${8 + level * 12}px">加载失败: ${error}</div>`;
            return false;
        }
    }

    // 获取文件图标
    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            'java': '☕',
            'kt': '🟣',
            'xml': '📄',
            'json': '📋',
            'txt': '📝',
            'smali': '🔧',
            'properties': '⚙️',
            'gradle': '🐘',
            'png': '🖼️',
            'jpg': '🖼️',
            'jpeg': '🖼️',
            'gif': '🖼️',
            'webp': '🖼️',
            'svg': '🖼️',
        };
        return icons[ext] || '📄';
    }

    // 媒体文件扩展名
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const audioExtensions = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'];
    const videoExtensions = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', '3gp'];

    // 当前媒体查看模式 ('preview' 或 'hex')
    let currentMediaViewMode = 'preview';

    // 选中文件
    // mode: 'auto' | 'preview' | 'hex' - 控制媒体文件的显示模式
    async function selectFile(filePath, page = 0, mode = 'auto') {
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        // 更新选中状态
        jadxTree.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected'));
        const nodeHeader = jadxTree.querySelector(`[data-path="${filePath}"] > .tree-node-header`);
        if (nodeHeader) {
            nodeHeader.classList.add('selected');
        }

        currentFilePath = filePath;
        currentHexPage = page;
        jadxCurrentPath.textContent = filePath;

        jadxMain.innerHTML = '<div class="jadx-placeholder">加载中...</div>';

        // 检查文件类型
        const ext = filePath.split('.').pop().toLowerCase();
        const isImage = imageExtensions.includes(ext);
        const isAudio = audioExtensions.includes(ext);
        const isVideo = videoExtensions.includes(ext);
        const isMedia = isImage || isAudio || isVideo;

        // 确定显示模式
        if (mode === 'auto') {
            currentMediaViewMode = isMedia ? 'preview' : 'hex';
        } else {
            currentMediaViewMode = mode;
        }

        // 媒体文件且为预览模式
        if (isMedia && currentMediaViewMode === 'preview') {
            if (isImage) {
                renderImageView(apkDir, filePath, ext);
            } else if (isAudio) {
                renderAudioView(apkDir, filePath, ext);
            } else if (isVideo) {
                renderVideoView(apkDir, filePath, ext);
            }
            return;
        }

        // 非媒体文件或二进制模式
        try {
            // 加载设置中的每页大小
            const settings = await getSettings();
            hexPageSizeKB = settings.source?.hexPageSize || 64;

            const result = await invoke('read_jadx_file', {
                apkDir,
                filePath,
                page: page,
                pageSizeKb: hexPageSizeKB
            });

            if (!result.success) {
                jadxMain.innerHTML = `<div class="jadx-placeholder">${result.message}</div>`;
                return;
            }

            if (result.is_binary || isMedia) {
                // 二进制文件或媒体文件的二进制模式，使用Hex查看器
                currentBinaryData = result;
                currentEncoding = 'ascii';
                renderHexView(result, isMedia);
            } else {
                // 文本文件，正常渲染
                currentBinaryData = null;
                renderCode(result.content, result.extension);
            }
        } catch (error) {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载失败: ${error}</div>`;
        }
    }

    // 渲染图片视图
    function renderImageView(apkDir, filePath, ext) {
        const container = document.createElement('div');
        container.className = 'image-viewer-container';

        // 构建图片的完整路径
        const fullPath = `${apkDir}/jadx/${filePath}`;

        // 获取当前工作目录并构建完整的文件路径
        invoke('get_current_dir').then(currentDir => {
            const absolutePath = `${currentDir}/${fullPath}`.replace(/\\/g, '/');
            const imageUrl = convertFileSrc(absolutePath);

            // 工具栏
            const toolbar = document.createElement('div');
            toolbar.className = 'media-toolbar';
            toolbar.innerHTML = `
                <span class="media-info">图片文件 | ${ext.toUpperCase()}</span>
                <div class="media-controls">
                    <button id="image-zoom-out" class="media-control-btn" title="缩小">−</button>
                    <span id="image-zoom-level" class="media-zoom-level">100%</span>
                    <button id="image-zoom-in" class="media-control-btn" title="放大">+</button>
                    <button id="image-zoom-fit" class="media-control-btn" title="适应窗口">⊡</button>
                    <button id="image-zoom-actual" class="media-control-btn" title="实际大小">1:1</button>
                    <span class="media-divider"></span>
                    <button id="media-view-hex" class="media-control-btn media-mode-btn" title="查看二进制">HEX</button>
                </div>
            `;

            // 图片容器
            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'image-wrapper';

            const img = document.createElement('img');
            img.className = 'preview-image';
            img.src = imageUrl;
            img.alt = filePath;

            let currentZoom = 100;

            img.onload = () => {
                // 更新工具栏显示图片尺寸
                const sizeInfo = document.createElement('span');
                sizeInfo.className = 'media-size-info';
                sizeInfo.textContent = ` | ${img.naturalWidth} × ${img.naturalHeight}`;
                toolbar.querySelector('.media-info').appendChild(sizeInfo);
            };

            img.onerror = () => {
                imageWrapper.innerHTML = '<div class="jadx-placeholder">图片加载失败</div>';
            };

            imageWrapper.appendChild(img);
            container.appendChild(toolbar);
            container.appendChild(imageWrapper);

            jadxMain.innerHTML = '';
            jadxMain.appendChild(container);

            // 缩放控制
            const zoomOut = document.getElementById('image-zoom-out');
            const zoomIn = document.getElementById('image-zoom-in');
            const zoomFit = document.getElementById('image-zoom-fit');
            const zoomActual = document.getElementById('image-zoom-actual');
            const zoomLevel = document.getElementById('image-zoom-level');

            const updateZoom = (zoom) => {
                currentZoom = Math.max(10, Math.min(500, zoom));
                img.style.transform = `scale(${currentZoom / 100})`;
                zoomLevel.textContent = `${currentZoom}%`;
            };

            zoomOut.addEventListener('click', () => updateZoom(currentZoom - 25));
            zoomIn.addEventListener('click', () => updateZoom(currentZoom + 25));
            zoomActual.addEventListener('click', () => updateZoom(100));
            zoomFit.addEventListener('click', () => {
                const wrapperRect = imageWrapper.getBoundingClientRect();
                const scaleX = (wrapperRect.width - 40) / img.naturalWidth;
                const scaleY = (wrapperRect.height - 40) / img.naturalHeight;
                const fitZoom = Math.min(scaleX, scaleY, 1) * 100;
                updateZoom(Math.round(fitZoom));
            });

            // 鼠标滚轮缩放
            imageWrapper.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -10 : 10;
                updateZoom(currentZoom + delta);
            });

            // 切换到二进制模式
            document.getElementById('media-view-hex').addEventListener('click', () => {
                selectFile(filePath, 0, 'hex');
            });
        }).catch(error => {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载图片失败: ${error}</div>`;
        });
    }

    // 渲染音频视图
    function renderAudioView(apkDir, filePath, ext) {
        const container = document.createElement('div');
        container.className = 'media-viewer-container';

        // 构建音频的完整路径
        const fullPath = `${apkDir}/jadx/${filePath}`;

        invoke('get_current_dir').then(currentDir => {
            const absolutePath = `${currentDir}/${fullPath}`.replace(/\\/g, '/');
            const audioUrl = convertFileSrc(absolutePath);

            // 工具栏
            const toolbar = document.createElement('div');
            toolbar.className = 'media-toolbar';
            toolbar.innerHTML = `
                <span class="media-info">音频文件 | ${ext.toUpperCase()}</span>
                <div class="media-controls">
                    <button id="media-view-hex" class="media-control-btn media-mode-btn" title="查看二进制">HEX</button>
                </div>
            `;

            // 音频播放器容器
            const audioWrapper = document.createElement('div');
            audioWrapper.className = 'audio-wrapper';

            const audioIcon = document.createElement('div');
            audioIcon.className = 'audio-icon';
            audioIcon.innerHTML = '🎵';

            const audio = document.createElement('audio');
            audio.className = 'audio-player';
            audio.controls = true;
            audio.src = audioUrl;

            const audioInfo = document.createElement('div');
            audioInfo.className = 'audio-file-info';
            audioInfo.textContent = filePath.split('/').pop();

            audio.onerror = () => {
                audioWrapper.innerHTML = '<div class="jadx-placeholder">音频加载失败，格式可能不受支持</div>';
            };

            audioWrapper.appendChild(audioIcon);
            audioWrapper.appendChild(audio);
            audioWrapper.appendChild(audioInfo);
            container.appendChild(toolbar);
            container.appendChild(audioWrapper);

            jadxMain.innerHTML = '';
            jadxMain.appendChild(container);

            // 切换到二进制模式
            document.getElementById('media-view-hex').addEventListener('click', () => {
                selectFile(filePath, 0, 'hex');
            });
        }).catch(error => {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载音频失败: ${error}</div>`;
        });
    }

    // 渲染视频视图
    function renderVideoView(apkDir, filePath, ext) {
        const container = document.createElement('div');
        container.className = 'media-viewer-container';

        // 构建视频的完整路径
        const fullPath = `${apkDir}/jadx/${filePath}`;

        invoke('get_current_dir').then(currentDir => {
            const absolutePath = `${currentDir}/${fullPath}`.replace(/\\/g, '/');
            const videoUrl = convertFileSrc(absolutePath);

            // 工具栏
            const toolbar = document.createElement('div');
            toolbar.className = 'media-toolbar';
            toolbar.innerHTML = `
                <span class="media-info">视频文件 | ${ext.toUpperCase()}</span>
                <div class="media-controls">
                    <button id="media-view-hex" class="media-control-btn media-mode-btn" title="查看二进制">HEX</button>
                </div>
            `;

            // 视频播放器容器
            const videoWrapper = document.createElement('div');
            videoWrapper.className = 'video-wrapper';

            const video = document.createElement('video');
            video.className = 'video-player';
            video.controls = true;
            video.src = videoUrl;

            video.onerror = () => {
                videoWrapper.innerHTML = '<div class="jadx-placeholder">视频加载失败，格式可能不受支持</div>';
            };

            videoWrapper.appendChild(video);
            container.appendChild(toolbar);
            container.appendChild(videoWrapper);

            jadxMain.innerHTML = '';
            jadxMain.appendChild(container);

            // 切换到二进制模式
            document.getElementById('media-view-hex').addEventListener('click', () => {
                selectFile(filePath, 0, 'hex');
            });
        }).catch(error => {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载视频失败: ${error}</div>`;
        });
    }

    // 渲染Hex视图
    // isMedia: 是否为媒体文件（可以切换回预览模式）
    function renderHexView(data, isMedia = false) {
        const container = document.createElement('div');
        container.className = 'hex-viewer-container';

        // 工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'hex-toolbar';

        // 分页信息
        const totalPages = data.total_pages || 1;
        const currentPage = data.page || 0;
        const startOffset = data.start_offset || 0;
        const endOffset = data.end_offset || data.file_size;

        // 预览按钮（仅媒体文件显示）
        const previewBtnHtml = isMedia
            ? '<button id="hex-view-preview" class="hex-page-btn hex-preview-btn" title="预览">预览</button>'
            : '';

        toolbar.innerHTML = `
            <span class="hex-info">二进制文件 | ${formatFileSize(data.file_size)} | 显示: ${formatFileSize(startOffset)} - ${formatFileSize(endOffset)}</span>
            <div class="hex-pagination">
                ${previewBtnHtml}
                <button id="hex-first-page" class="hex-page-btn" ${currentPage === 0 ? 'disabled' : ''} title="首页">⏮</button>
                <button id="hex-prev-page" class="hex-page-btn" ${currentPage === 0 ? 'disabled' : ''} title="上一页">◀</button>
                <span class="hex-page-info">${currentPage + 1} / ${totalPages}</span>
                <button id="hex-next-page" class="hex-page-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} title="下一页">▶</button>
                <button id="hex-last-page" class="hex-page-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} title="末页">⏭</button>
                <input type="number" id="hex-goto-page" class="hex-goto-input" min="1" max="${totalPages}" placeholder="跳转" title="输入页码后回车跳转">
            </div>
            <div class="hex-encoding-switch">
                <span>编码:</span>
                <select id="hex-encoding-select" class="hex-encoding-select">
                    <option value="ascii" ${currentEncoding === 'ascii' ? 'selected' : ''}>ASCII</option>
                    <option value="utf8" ${currentEncoding === 'utf8' ? 'selected' : ''}>UTF-8</option>
                    <option value="utf16le" ${currentEncoding === 'utf16le' ? 'selected' : ''}>UTF-16 LE</option>
                    <option value="utf16be" ${currentEncoding === 'utf16be' ? 'selected' : ''}>UTF-16 BE</option>
                    <option value="gbk" ${currentEncoding === 'gbk' ? 'selected' : ''}>GBK</option>
                </select>
            </div>
        `;
        container.appendChild(toolbar);

        // Hex内容区
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'hex-content-wrapper';

        // 行号列（固定）
        const lineNumbers = document.createElement('div');
        lineNumbers.className = 'hex-line-numbers';

        // 内容区（可滚动）
        const scrollArea = document.createElement('div');
        scrollArea.className = 'hex-scroll-area';

        const table = document.createElement('table');
        table.className = 'hex-table';

        const rawBytes = data.raw_bytes;
        const hexLines = data.hex_lines;

        hexLines.forEach((hexLine, index) => {
            // 使用实际的偏移量
            const offset = startOffset + index * 16;
            const lineBytes = rawBytes.slice(index * 16, index * 16 + 16);

            // 行号
            const lineNumDiv = document.createElement('div');
            lineNumDiv.className = 'hex-line-num';
            lineNumDiv.textContent = offset.toString(16).toUpperCase().padStart(8, '0');
            lineNumbers.appendChild(lineNumDiv);

            // 表格行
            const tr = document.createElement('tr');
            tr.className = 'hex-row';

            // Hex列
            const tdHex = document.createElement('td');
            tdHex.className = 'hex-cell hex-bytes';
            tdHex.textContent = hexLine.padEnd(47, ' '); // 16*2 + 15空格 = 47

            // ASCII/编码列
            const tdAscii = document.createElement('td');
            tdAscii.className = 'hex-cell hex-ascii';
            tdAscii.textContent = decodeBytes(lineBytes, currentEncoding);

            tr.appendChild(tdHex);
            tr.appendChild(tdAscii);
            table.appendChild(tr);
        });

        scrollArea.appendChild(table);
        contentWrapper.appendChild(lineNumbers);
        contentWrapper.appendChild(scrollArea);
        container.appendChild(contentWrapper);

        // 同步滚动
        scrollArea.addEventListener('scroll', () => {
            lineNumbers.scrollTop = scrollArea.scrollTop;
        });

        jadxMain.innerHTML = '';
        jadxMain.appendChild(container);

        // 编码切换事件
        const encodingSelect = document.getElementById('hex-encoding-select');
        encodingSelect.addEventListener('change', (e) => {
            currentEncoding = e.target.value;
            renderHexView(currentBinaryData);
        });

        // 分页事件
        document.getElementById('hex-first-page').addEventListener('click', () => {
            if (currentPage > 0) {
                selectFile(currentFilePath, 0, 'hex');
            }
        });

        document.getElementById('hex-prev-page').addEventListener('click', () => {
            if (currentPage > 0) {
                selectFile(currentFilePath, currentPage - 1, 'hex');
            }
        });

        document.getElementById('hex-next-page').addEventListener('click', () => {
            if (currentPage < totalPages - 1) {
                selectFile(currentFilePath, currentPage + 1, 'hex');
            }
        });

        document.getElementById('hex-last-page').addEventListener('click', () => {
            if (currentPage < totalPages - 1) {
                selectFile(currentFilePath, totalPages - 1, 'hex');
            }
        });

        // 跳转页码
        const gotoInput = document.getElementById('hex-goto-page');
        gotoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const targetPage = parseInt(gotoInput.value, 10);
                if (targetPage >= 1 && targetPage <= totalPages) {
                    selectFile(currentFilePath, targetPage - 1, 'hex');
                } else {
                    toast.show({ text: `页码范围: 1 - ${totalPages}`, color: 'warning', duration: 2000 });
                }
            }
        });

        // 预览按钮（媒体文件）
        if (isMedia) {
            const previewBtn = document.getElementById('hex-view-preview');
            if (previewBtn) {
                previewBtn.addEventListener('click', () => {
                    selectFile(currentFilePath, 0, 'preview');
                });
            }
        }
    }

    // 解码字节
    function decodeBytes(bytes, encoding) {
        try {
            switch (encoding) {
                case 'ascii':
                    return Array.from(bytes).map(b => {
                        if (b >= 32 && b < 127) {
                            return String.fromCharCode(b);
                        }
                        return '.';
                    }).join('');

                case 'utf8':
                    try {
                        const decoder = new TextDecoder('utf-8', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(bytes.length);
                    }

                case 'utf16le':
                    try {
                        const decoder = new TextDecoder('utf-16le', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(Math.floor(bytes.length / 2));
                    }

                case 'utf16be':
                    try {
                        const decoder = new TextDecoder('utf-16be', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(Math.floor(bytes.length / 2));
                    }

                case 'gbk':
                    try {
                        const decoder = new TextDecoder('gbk', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(bytes.length);
                    }

                default:
                    return '.'.repeat(bytes.length);
            }
        } catch {
            return '.'.repeat(bytes.length);
        }
    }

    // 获取 highlight.js 语言名称
    function getHighlightLanguage(extension) {
        const langMap = {
            'java': 'java',
            'kt': 'kotlin',
            'kts': 'kotlin',
            'xml': 'xml',
            'json': 'json',
            'js': 'javascript',
            'ts': 'typescript',
            'html': 'xml',
            'css': 'css',
            'gradle': 'gradle',
            'properties': 'properties',
            'md': 'markdown',
            'yml': 'yaml',
            'yaml': 'yaml',
            'smali': 'smali',
            'txt': 'plaintext',
            'pro': 'plaintext',
            'cfg': 'plaintext'
        };
        return langMap[extension] || 'plaintext';
    }

    // 渲染代码
    function renderCode(content, extension, highlightLine = -1, searchQuery = '') {
        const container = document.createElement('div');
        container.className = 'jadx-code-container';

        // 使用 highlight.js 进行语法高亮
        const language = getHighlightLanguage(extension);
        let highlightedCode;

        try {
            if (hljs.getLanguage(language)) {
                highlightedCode = hljs.highlight(content, { language: language }).value;
            } else {
                highlightedCode = hljs.highlightAuto(content).value;
            }
        } catch (e) {
            // 高亮失败，使用纯文本
            highlightedCode = escapeHtml(content);
        }

        const lines = highlightedCode.split('\n');
        const table = document.createElement('table');
        table.className = 'code-table';

        lines.forEach((line, index) => {
            const tr = document.createElement('tr');
            tr.className = 'code-line';
            if (index + 1 === highlightLine) {
                tr.classList.add('highlighted');
                tr.id = 'highlighted-line';
            }

            const tdNum = document.createElement('td');
            tdNum.className = 'line-number';
            tdNum.textContent = index + 1;

            const tdContent = document.createElement('td');
            tdContent.className = 'line-content';

            // 高亮搜索内容（在已经语法高亮的HTML中处理）
            if (searchQuery) {
                // 需要在保留HTML标签的情况下高亮搜索词
                const searchLower = searchQuery.toLowerCase();
                const lineLower = line.replace(/<[^>]*>/g, '').toLowerCase();
                if (lineLower.includes(searchLower)) {
                    // 简单处理：在文本节点中查找并高亮
                    const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
                    tdContent.innerHTML = line.replace(regex, '<span class="search-highlight">$1</span>');
                } else {
                    tdContent.innerHTML = line;
                }
            } else {
                tdContent.innerHTML = line;
            }

            tr.appendChild(tdNum);
            tr.appendChild(tdContent);
            table.appendChild(tr);
        });

        container.appendChild(table);
        jadxMain.innerHTML = '';
        jadxMain.appendChild(container);

        // 滚动到高亮行
        if (highlightLine > 0) {
            setTimeout(() => {
                const highlightedEl = document.getElementById('highlighted-line');
                if (highlightedEl) {
                    highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    }

    // 展开文件树到指定路径（支持懒加载）
    async function expandTreeToPath(filePath) {
        const parts = filePath.split('/');
        let currentPath = '';

        for (let i = 0; i < parts.length - 1; i++) {
            currentPath += (i > 0 ? '/' : '') + parts[i];
            const nodeEl = jadxTree.querySelector(`[data-path="${currentPath}"]`);
            if (nodeEl) {
                const children = nodeEl.querySelector('.tree-node-children');
                const toggle = nodeEl.querySelector('.tree-node-toggle');
                const icon = nodeEl.querySelector('.tree-node-icon');
                const header = nodeEl.querySelector('.tree-node-header');

                if (children && children.classList.contains('collapsed')) {
                    // 如果子节点未加载，先加载
                    if (children.dataset.loaded === 'false') {
                        toggle.textContent = '...';
                        await loadSubdirectory(currentPath, children, i + 1);
                        children.dataset.loaded = 'true';
                    }
                    children.classList.remove('collapsed');
                    if (toggle) {
                        toggle.textContent = '▼';
                        toggle.classList.add('expanded');
                    }
                    if (icon) icon.textContent = '📂';
                }
            }
        }

        // 选中文件节点
        const fileNode = jadxTree.querySelector(`[data-path="${filePath}"] > .tree-node-header`);
        if (fileNode) {
            jadxTree.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected'));
            fileNode.classList.add('selected');
            fileNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // 搜索输入处理
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = searchInput.value.trim();

        if (!query) {
            searchResultsList.innerHTML = '<div class="search-placeholder">输入搜索内容</div>';
            searchCount.textContent = '';
            searchPreviewContent.innerHTML = '<div class="search-placeholder">选择左侧结果预览</div>';
            searchPreviewPath.textContent = '';
            return;
        }

        searchResultsList.innerHTML = '<div class="search-placeholder">搜索中...</div>';

        searchTimeout = setTimeout(async () => {
            await performSearch(query);
        }, 300);
    });

    // 执行搜索
    async function performSearch(query) {
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('search_jadx_files', { apkDir, query, maxResults: 500 });

            if (!result.success) {
                searchResultsList.innerHTML = `<div class="search-placeholder">${result.message}</div>`;
                return;
            }

            searchResults = result.results;
            searchCount.textContent = `${result.total} 个结果`;

            if (result.results.length === 0) {
                searchResultsList.innerHTML = '<div class="search-placeholder">未找到匹配结果</div>';
                return;
            }

            renderSearchResults(result.results, query);
        } catch (error) {
            searchResultsList.innerHTML = `<div class="search-placeholder">搜索失败: ${error}</div>`;
        }
    }

    // 渲染搜索结果
    function renderSearchResults(results, query) {
        searchResultsList.innerHTML = '';
        selectedSearchIndex = -1;

        results.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.dataset.index = index;

            // 高亮匹配内容
            const beforeMatch = escapeHtml(result.line_content.substring(0, result.match_start));
            const match = escapeHtml(result.line_content.substring(result.match_start, result.match_end));
            const afterMatch = escapeHtml(result.line_content.substring(result.match_end));

            item.innerHTML = `
                <div class="search-result-file">${escapeHtml(result.file_path)}</div>
                <div class="search-result-line">行 ${result.line_number}</div>
                <div class="search-result-content">${beforeMatch}<span class="highlight">${match}</span>${afterMatch}</div>
            `;

            // 单击选中并预览
            item.addEventListener('click', () => {
                selectSearchResult(index, query);
            });

            // 双击跳转到文件
            item.addEventListener('dblclick', async () => {
                searchOverlay.classList.add('hidden');
                currentFilePath = result.file_path;
                jadxCurrentPath.textContent = result.file_path;
                expandTreeToPath(result.file_path);

                const apk = apkListData[selectedApkIndex];
                const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

                try {
                    const fileResult = await invoke('read_jadx_file', { apkDir, filePath: result.file_path });
                    if (fileResult.success) {
                        renderCode(fileResult.content, fileResult.extension, result.line_number, query);
                    }
                } catch (error) {
                    console.error('读取文件失败:', error);
                }
            });

            searchResultsList.appendChild(item);
        });
    }

    // 选中搜索结果
    async function selectSearchResult(index, query) {
        // 更新选中状态
        searchResultsList.querySelectorAll('.search-result-item').forEach(item => {
            item.classList.remove('selected');
        });
        const selectedItem = searchResultsList.querySelector(`[data-index="${index}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        selectedSearchIndex = index;
        const result = searchResults[index];

        searchPreviewPath.textContent = result.file_path;

        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const fileResult = await invoke('read_jadx_file', { apkDir, filePath: result.file_path });

            if (fileResult.success) {
                renderPreviewCode(fileResult.content, result.line_number, query);
            } else {
                searchPreviewContent.innerHTML = `<div class="search-placeholder">${fileResult.message}</div>`;
            }
        } catch (error) {
            searchPreviewContent.innerHTML = `<div class="search-placeholder">加载失败: ${error}</div>`;
        }
    }

    // 渲染预览代码
    function renderPreviewCode(content, highlightLine, searchQuery) {
        const lines = content.split('\n');
        const table = document.createElement('table');
        table.className = 'code-table';

        lines.forEach((line, index) => {
            const tr = document.createElement('tr');
            tr.className = 'code-line';
            if (index + 1 === highlightLine) {
                tr.classList.add('highlighted');
                tr.id = 'preview-highlighted-line';
            }

            const tdNum = document.createElement('td');
            tdNum.className = 'line-number';
            tdNum.textContent = index + 1;

            const tdContent = document.createElement('td');
            tdContent.className = 'line-content';

            // 高亮搜索内容
            if (searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase())) {
                const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
                tdContent.innerHTML = escapeHtml(line).replace(regex, '<span class="highlight">$1</span>');
            } else {
                tdContent.textContent = line;
            }

            tr.appendChild(tdNum);
            tr.appendChild(tdContent);
            table.appendChild(tr);
        });

        searchPreviewContent.innerHTML = '';
        searchPreviewContent.appendChild(table);

        // 滚动到高亮行
        setTimeout(() => {
            const highlightedEl = document.getElementById('preview-highlighted-line');
            if (highlightedEl) {
                highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    // 正则转义
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 拖拽调整JADX侧边栏大小
    let isResizingJadx = false;
    jadxResizer.addEventListener('mousedown', (e) => {
        isResizingJadx = true;
        jadxResizer.classList.add('active');
        document.addEventListener('mousemove', handleJadxResize);
        document.addEventListener('mouseup', stopJadxResize);
    });

    function handleJadxResize(e) {
        if (!isResizingJadx) return;
        const containerRect = jadxOverlay.querySelector('.overlay-content').getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 200 && newWidth <= 500) {
            jadxSidebar.style.width = newWidth + 'px';
        }
    }

    function stopJadxResize() {
        isResizingJadx = false;
        jadxResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleJadxResize);
        document.removeEventListener('mouseup', stopJadxResize);
    }

    // 拖拽调整搜索结果面板大小
    let isResizingSearch = false;
    searchResizer.addEventListener('mousedown', (e) => {
        isResizingSearch = true;
        searchResizer.classList.add('active');
        document.addEventListener('mousemove', handleSearchResize);
        document.addEventListener('mouseup', stopSearchResize);
    });

    function handleSearchResize(e) {
        if (!isResizingSearch) return;
        const containerRect = searchOverlay.querySelector('.search-content').getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 250 && newWidth <= 600) {
            searchResultsPanel.style.width = newWidth + 'px';
        }
    }

    function stopSearchResize() {
        isResizingSearch = false;
        searchResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleSearchResize);
        document.removeEventListener('mouseup', stopSearchResize);
    }

    // ========== 敏感信息模块 ==========
    const sensitiveCategory = document.getElementById('sensitive-category');
    const sensitivePageSize = document.getElementById('sensitive-page-size');
    const sensitiveScanBtn = document.getElementById('sensitive-scan-btn');
    const sensitiveRescanBtn = document.getElementById('sensitive-rescan-btn');
    const sensitiveStats = document.getElementById('sensitive-stats');
    const sensitiveList = document.getElementById('sensitive-list');
    const sensitivePagination = document.getElementById('sensitive-pagination');
    const sensitiveCodePath = document.getElementById('sensitive-code-path');
    const sensitiveCodeContent = document.getElementById('sensitive-code-content');
    const sensitiveResizer = document.getElementById('sensitive-resizer');
    const sensitiveLeft = document.querySelector('.sensitive-left');

    // 每个APK独立的敏感信息状态管理
    // key: apk.timestamp, value: { scanning, hasScanned, currentPage, totalPages, selectedId, stats }
    const sensitiveStateMap = new Map();

    // 获取当前APK的敏感信息状态
    function getSensitiveState(timestamp) {
        if (!sensitiveStateMap.has(timestamp)) {
            sensitiveStateMap.set(timestamp, {
                scanning: false,
                hasScanned: false,
                currentPage: 0,
                totalPages: 0,
                selectedId: -1,
                stats: null
            });
        }
        return sensitiveStateMap.get(timestamp);
    }

    // 分类名称映射
    const categoryNames = {
        'url': 'URL',
        'ip': 'IP地址',
        'access_key': 'AccessKey',
        'number': '纯数字'
    };

    // 刷新敏感信息面板UI（根据当前选中的APK状态）
    function refreshSensitiveUI() {
        if (selectedApkIndex < 0) {
            sensitiveStats.innerHTML = '';
            sensitiveList.innerHTML = '<div class="sensitive-placeholder">上传一个apk开始分析</div>';
            sensitivePagination.innerHTML = '';
            sensitiveCodePath.textContent = '';
            sensitiveCodeContent.innerHTML = '<div class="sensitive-placeholder">选择左侧敏感信息查看代码位置</div>';
            sensitiveScanBtn.disabled = false;
            sensitiveScanBtn.textContent = '扫描';
            sensitiveRescanBtn.style.display = 'none';
            return;
        }

        const apk = apkListData[selectedApkIndex];
        const state = getSensitiveState(apk.timestamp);

        // 切换APK时清空代码预览区
        sensitiveCodePath.textContent = '';
        sensitiveCodeContent.innerHTML = '<div class="sensitive-placeholder">选择左侧敏感信息查看代码位置</div>';

        if (state.scanning) {
            // 正在扫描中
            sensitiveScanBtn.disabled = true;
            sensitiveScanBtn.textContent = '扫描中...';
            sensitiveRescanBtn.style.display = 'none';
            sensitiveList.innerHTML = '<div class="sensitive-loading"><div class="spinner"></div><span>正在扫描敏感信息...</span></div>';
            sensitiveStats.innerHTML = '';
            sensitivePagination.innerHTML = '';
        } else {
            // 未在扫描
            sensitiveScanBtn.disabled = false;
            sensitiveScanBtn.textContent = '扫描';

            if (state.hasScanned) {
                // 已有扫描结果，显示重新扫描按钮
                sensitiveRescanBtn.style.display = 'inline-block';
                sensitiveRescanBtn.disabled = false;
                if (state.stats) {
                    renderSensitiveStats(state.stats);
                }
                loadSensitivePage();
            } else {
                // 尚未扫描，隐藏重新扫描按钮，检查是否有缓存
                sensitiveRescanBtn.style.display = 'none';
                sensitiveStats.innerHTML = '';
                sensitiveList.innerHTML = '<div class="sensitive-placeholder">点击扫描按钮开始分析敏感信息</div>';
                sensitivePagination.innerHTML = '';
                // 尝试加载缓存
                checkAndLoadSensitiveCache();
            }
        }
    }

    // 扫描敏感信息
    sensitiveScanBtn.addEventListener('click', async () => {
        await performSensitiveScan(false);
    });

    // 重新扫描敏感信息（带确认对话框）
    sensitiveRescanBtn.addEventListener('click', () => {
        if (selectedApkIndex < 0) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const apk = apkListData[selectedApkIndex];
        if (!apk.isDecompiled) {
            toast.show({ text: 'APK尚未反编译完成', color: 'warning', duration: 2000 });
            return;
        }

        // 显示确认对话框
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-modal-content">
                <div class="confirm-modal-title">重新扫描</div>
                <div class="confirm-modal-text">是否重新扫描敏感信息？新的结果将覆盖之前的结果。</div>
                <div class="confirm-modal-buttons">
                    <button class="confirm-modal-btn cancel">取消</button>
                    <button class="confirm-modal-btn confirm">确定</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 取消按钮
        modal.querySelector('.cancel').addEventListener('click', () => {
            modal.remove();
        });

        // 确定按钮
        modal.querySelector('.confirm').addEventListener('click', async () => {
            modal.remove();
            await performSensitiveScan(true);
        });

        // 点击蒙层关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    });

    // 执行敏感信息扫描
    async function performSensitiveScan(forceRescan) {
        if (selectedApkIndex < 0) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const apk = apkListData[selectedApkIndex];
        if (!apk.isDecompiled) {
            toast.show({ text: 'APK尚未反编译完成', color: 'warning', duration: 2000 });
            return;
        }

        const state = getSensitiveState(apk.timestamp);
        if (state.scanning) {
            toast.show({ text: '该APK正在扫描中，请稍候', color: 'warning', duration: 2000 });
            return;
        }

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
        const scanTimestamp = apk.timestamp; // 记录扫描时的APK标识

        // 如果是强制重新扫描，先删除缓存文件
        if (forceRescan) {
            try {
                const cachePath = `${apkDir}/sensitive.json`;
                await invoke('delete_file', { filename: cachePath });
                console.log('已删除敏感信息缓存文件');
            } catch (error) {
                // 缓存文件可能不存在，忽略错误
                console.log('删除缓存文件失败或文件不存在:', error);
            }
        }

        // 设置扫描状态
        state.scanning = true;
        refreshSensitiveUI();

        // 3秒后显示提示
        const scanTimeout = setTimeout(() => {
            toast.show({
                text: '敏感信息扫描中，请耐心等待...',
                color: 'warning',
                duration: 4000
            });
        }, 3000);

        try {
            const result = await invoke('scan_sensitive_info', { apkDir });

            clearTimeout(scanTimeout);

            // 更新该APK的状态
            const currentState = getSensitiveState(scanTimestamp);
            currentState.scanning = false;

            if (!result.success) {
                // 如果当前显示的还是这个APK，更新UI
                if (selectedApkIndex >= 0 && apkListData[selectedApkIndex].timestamp === scanTimestamp) {
                    sensitiveList.innerHTML = `<div class="sensitive-placeholder">${result.message}</div>`;
                    sensitiveScanBtn.disabled = false;
                    sensitiveScanBtn.textContent = '扫描';
                }
                return;
            }

            currentState.hasScanned = true;
            currentState.stats = result.data.stats;
            currentState.currentPage = 0;

            if (result.cached) {
                toast.show({ text: '已加载缓存的扫描结果', color: 'info', duration: 2000 });
            } else {
                toast.show({ text: `扫描完成，共发现 ${result.data.total} 条敏感信息`, color: 'success', duration: 3000 });
            }

            // 如果当前显示的还是这个APK，刷新UI
            if (selectedApkIndex >= 0 && apkListData[selectedApkIndex].timestamp === scanTimestamp) {
                refreshSensitiveUI();
            }

        } catch (error) {
            clearTimeout(scanTimeout);
            console.error('扫描敏感信息失败:', error);

            const currentState = getSensitiveState(scanTimestamp);
            currentState.scanning = false;

            // 如果当前显示的还是这个APK，更新UI
            if (selectedApkIndex >= 0 && apkListData[selectedApkIndex].timestamp === scanTimestamp) {
                sensitiveList.innerHTML = `<div class="sensitive-placeholder">扫描失败: ${error}</div>`;
                sensitiveScanBtn.disabled = false;
                sensitiveScanBtn.textContent = '扫描';
            }
        }
    }

    // 渲染统计信息
    function renderSensitiveStats(stats) {
        if (!stats || Object.keys(stats).length === 0) {
            sensitiveStats.innerHTML = '';
            return;
        }

        let html = '';
        const order = ['url', 'ip', 'access_key', 'number'];

        for (const cat of order) {
            if (stats[cat]) {
                html += `
                    <div class="sensitive-stat-item ${cat}">
                        <span>${categoryNames[cat] || cat}</span>
                        <span class="sensitive-stat-count">${stats[cat]}</span>
                    </div>
                `;
            }
        }

        sensitiveStats.innerHTML = html;
    }

    // 加载敏感信息分页数据
    async function loadSensitivePage() {
        if (selectedApkIndex < 0) return;

        const apk = apkListData[selectedApkIndex];
        const state = getSensitiveState(apk.timestamp);
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
        const category = sensitiveCategory.value;
        const pageSize = parseInt(sensitivePageSize.value, 10);

        try {
            const result = await invoke('get_sensitive_info', {
                apkDir,
                page: state.currentPage,
                pageSize,
                category
            });

            if (!result.success) {
                sensitiveList.innerHTML = `<div class="sensitive-placeholder">${result.message}</div>`;
                return;
            }

            state.totalPages = result.totalPages;
            renderSensitiveList(result.items, apk.timestamp);
            renderSensitivePagination(result.page, result.totalPages, result.total, apk.timestamp);

        } catch (error) {
            console.error('加载敏感信息失败:', error);
            sensitiveList.innerHTML = `<div class="sensitive-placeholder">加载失败: ${error}</div>`;
        }
    }

    // 渲染敏感信息列表
    function renderSensitiveList(items, timestamp) {
        if (!items || items.length === 0) {
            sensitiveList.innerHTML = '<div class="sensitive-placeholder">没有找到敏感信息</div>';
            return;
        }

        const state = getSensitiveState(timestamp);
        let html = '';
        for (const item of items) {
            const isSelected = item.id === state.selectedId ? 'selected' : '';
            html += `
                <div class="sensitive-item ${item.category} ${isSelected}" data-id="${item.id}" data-file="${escapeHtml(item.file_path)}" data-line="${item.line_number}" data-content="${escapeHtml(item.content)}">
                    <div class="sensitive-item-content">${escapeHtml(item.content)}</div>
                    <div class="sensitive-item-meta">
                        <span class="sensitive-item-category ${item.category}">${categoryNames[item.category] || item.category}</span>
                        <span class="sensitive-item-file">${escapeHtml(item.file_path)}</span>
                        <span class="sensitive-item-line">行 ${item.line_number}</span>
                    </div>
                </div>
            `;
        }

        sensitiveList.innerHTML = html;

        // 绑定点击事件
        sensitiveList.querySelectorAll('.sensitive-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.id, 10);
                const filePath = item.dataset.file;
                const lineNumber = parseInt(item.dataset.line, 10);
                const content = item.dataset.content;

                // 更新选中状态
                sensitiveList.querySelectorAll('.sensitive-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');

                // 更新当前APK的选中ID
                if (selectedApkIndex >= 0) {
                    const currentState = getSensitiveState(apkListData[selectedApkIndex].timestamp);
                    currentState.selectedId = id;
                }

                // 加载代码预览
                loadSensitiveCodePreview(filePath, lineNumber, content);
            });
        });
    }

    // 渲染分页控件
    function renderSensitivePagination(currentPage, totalPages, total, timestamp) {
        if (totalPages <= 1) {
            sensitivePagination.innerHTML = `<span class="sensitive-page-info">共 ${total} 条</span>`;
            return;
        }

        sensitivePagination.innerHTML = `
            <button class="sensitive-page-btn" id="sensitive-first" ${currentPage === 0 ? 'disabled' : ''}>⏮</button>
            <button class="sensitive-page-btn" id="sensitive-prev" ${currentPage === 0 ? 'disabled' : ''}>◀</button>
            <span class="sensitive-page-info">${currentPage + 1} / ${totalPages} (${total}条)</span>
            <button class="sensitive-page-btn" id="sensitive-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>▶</button>
            <button class="sensitive-page-btn" id="sensitive-last" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>⏭</button>
        `;

        const state = getSensitiveState(timestamp);

        // 绑定分页事件
        document.getElementById('sensitive-first').addEventListener('click', () => {
            if (state.currentPage > 0) {
                state.currentPage = 0;
                loadSensitivePage();
            }
        });

        document.getElementById('sensitive-prev').addEventListener('click', () => {
            if (state.currentPage > 0) {
                state.currentPage--;
                loadSensitivePage();
            }
        });

        document.getElementById('sensitive-next').addEventListener('click', () => {
            if (state.currentPage < state.totalPages - 1) {
                state.currentPage++;
                loadSensitivePage();
            }
        });

        document.getElementById('sensitive-last').addEventListener('click', () => {
            if (state.currentPage < state.totalPages - 1) {
                state.currentPage = state.totalPages - 1;
                loadSensitivePage();
            }
        });
    }

    // 加载代码预览
    async function loadSensitiveCodePreview(filePath, lineNumber, sensitiveContent) {
        sensitiveCodePath.textContent = filePath;
        sensitiveCodeContent.innerHTML = '<div class="sensitive-loading"><div class="spinner"></div><span>加载中...</span></div>';

        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('read_jadx_file', { apkDir, filePath });

            if (!result.success) {
                sensitiveCodeContent.innerHTML = `<div class="sensitive-placeholder">${result.message}</div>`;
                return;
            }

            if (result.is_binary) {
                sensitiveCodeContent.innerHTML = '<div class="sensitive-placeholder">无法预览二进制文件</div>';
                return;
            }

            renderSensitiveCode(result.content, result.extension, lineNumber, sensitiveContent);

        } catch (error) {
            console.error('加载代码预览失败:', error);
            sensitiveCodeContent.innerHTML = `<div class="sensitive-placeholder">加载失败: ${error}</div>`;
        }
    }

    // 渲染代码预览（带高亮）
    function renderSensitiveCode(content, extension, highlightLine, sensitiveContent) {
        // 使用 highlight.js 进行语法高亮
        const language = getHighlightLanguage(extension);
        let highlightedCode;

        try {
            if (hljs.getLanguage(language)) {
                highlightedCode = hljs.highlight(content, { language: language }).value;
            } else {
                highlightedCode = hljs.highlightAuto(content).value;
            }
        } catch (e) {
            highlightedCode = escapeHtml(content);
        }

        const lines = highlightedCode.split('\n');
        const table = document.createElement('table');
        table.className = 'code-table';

        lines.forEach((line, index) => {
            const tr = document.createElement('tr');
            tr.className = 'code-line';
            if (index + 1 === highlightLine) {
                tr.classList.add('highlighted');
                tr.id = 'sensitive-highlighted-line';
            }

            const tdNum = document.createElement('td');
            tdNum.className = 'line-number';
            tdNum.textContent = index + 1;

            const tdContent = document.createElement('td');
            tdContent.className = 'line-content';

            // 高亮敏感内容
            if (index + 1 === highlightLine && sensitiveContent) {
                const regex = new RegExp(`(${escapeRegExp(sensitiveContent)})`, 'g');
                tdContent.innerHTML = line.replace(regex, '<span class="sensitive-highlight">$1</span>');
            } else {
                tdContent.innerHTML = line;
            }

            tr.appendChild(tdNum);
            tr.appendChild(tdContent);
            table.appendChild(tr);
        });

        sensitiveCodeContent.innerHTML = '';
        sensitiveCodeContent.appendChild(table);

        // 滚动到高亮行
        setTimeout(() => {
            const highlightedEl = document.getElementById('sensitive-highlighted-line');
            if (highlightedEl) {
                highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    // 分类筛选变化
    sensitiveCategory.addEventListener('change', () => {
        if (selectedApkIndex >= 0) {
            const state = getSensitiveState(apkListData[selectedApkIndex].timestamp);
            if (state.hasScanned) {
                state.currentPage = 0;
                loadSensitivePage();
            }
        }
    });

    // 每页条数变化
    sensitivePageSize.addEventListener('change', () => {
        if (selectedApkIndex >= 0) {
            const state = getSensitiveState(apkListData[selectedApkIndex].timestamp);
            if (state.hasScanned) {
                state.currentPage = 0;
                loadSensitivePage();
            }
        }
    });

    // 切换到敏感信息面板时，刷新当前APK的敏感信息UI
    operationTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'sensitive' && selectedApkIndex >= 0) {
                refreshSensitiveUI();
            }
        });
    });

    // 检查并加载敏感信息缓存
    async function checkAndLoadSensitiveCache() {
        if (selectedApkIndex < 0) return;

        const apk = apkListData[selectedApkIndex];
        if (!apk.isDecompiled) return;

        const state = getSensitiveState(apk.timestamp);
        if (state.scanning || state.hasScanned) return; // 正在扫描或已扫描，不重复加载

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('get_sensitive_info', {
                apkDir,
                page: 0,
                pageSize: parseInt(sensitivePageSize.value, 10),
                category: sensitiveCategory.value
            });

            if (result.success) {
                state.hasScanned = true;
                state.stats = result.stats;
                state.totalPages = result.totalPages;
                state.currentPage = 0;
                renderSensitiveStats(result.stats);
                renderSensitiveList(result.items, apk.timestamp);
                renderSensitivePagination(result.page, result.totalPages, result.total, apk.timestamp);

                // 有缓存数据，显示重新扫描按钮
                sensitiveRescanBtn.style.display = 'inline-block';
            }
        } catch (error) {
            // 没有缓存，不处理
        }
    }

    // 拖拽调整敏感信息面板大小
    let isResizingSensitive = false;
    sensitiveResizer.addEventListener('mousedown', (e) => {
        isResizingSensitive = true;
        sensitiveResizer.classList.add('active');
        document.addEventListener('mousemove', handleSensitiveResize);
        document.addEventListener('mouseup', stopSensitiveResize);
    });

    function handleSensitiveResize(e) {
        if (!isResizingSensitive) return;
        const container = document.querySelector('.sensitive-container');
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 300 && newWidth <= containerRect.width * 0.6) {
            sensitiveLeft.style.width = newWidth + 'px';
        }
    }

    function stopSensitiveResize() {
        isResizingSensitive = false;
        sensitiveResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleSensitiveResize);
        document.removeEventListener('mouseup', stopSensitiveResize);
    }

    // ===================== 网络抓包模块 =====================

    // 获取DOM元素
    const fridaEnvStatus = document.getElementById('frida-env-status');
    const fridaServerStatus = document.getElementById('frida-server-status');
    const initFridaBtn = document.getElementById('init-frida-btn');
    const startServerBtn = document.getElementById('start-server-btn');
    const stopServerBtn = document.getElementById('stop-server-btn');
    const captureTargetSelect = document.getElementById('capture-target-select');
    const captureDeviceApps = document.getElementById('capture-device-apps');
    const deviceAppSelect = document.getElementById('device-app-select');
    const refreshAppsBtn = document.getElementById('refresh-apps-btn');
    const captureSpawnMode = document.getElementById('capture-spawn-mode');
    const startCaptureBtn = document.getElementById('start-capture-btn');
    const stopCaptureBtn = document.getElementById('stop-capture-btn');
    const refreshSessionsBtn = document.getElementById('refresh-sessions-btn');
    const captureSessionsList = document.getElementById('capture-sessions-list');
    const packetsTitle = document.getElementById('packets-title');
    const packetsFilterInput = document.getElementById('packets-filter-input');
    const capturePacketsBody = document.getElementById('capture-packets-body');
    const capturePacketsPlaceholder = document.getElementById('capture-packets-placeholder');
    const capturePacketsTableWrapper = document.querySelector('.capture-packets-table-wrapper');
    const capturePacketDetail = document.getElementById('capture-packet-detail');
    const packetDetailContent = document.getElementById('packet-detail-content');
    const captureResizer = document.getElementById('capture-resizer');
    const captureLeft = document.querySelector('.capture-left');

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

    // 自动刷新数据包（抓包时每秒刷新一次）
    function startAutoRefreshPackets() {
        stopAutoRefreshPackets(); // 先清除已有的定时器
        captureState.autoRefreshTimer = setInterval(async () => {
            if (captureState.capturing && captureState.currentSessionId) {
                await loadCapturePackets(captureState.currentSessionId);
            }
        }, 1000);
    }

    function stopAutoRefreshPackets() {
        if (captureState.autoRefreshTimer) {
            clearInterval(captureState.autoRefreshTimer);
            captureState.autoRefreshTimer = null;
        }
    }

    // 检查Frida环境状态
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

    // 检查Frida Server状态
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

    // 初始化Frida环境
    initFridaBtn.addEventListener('click', async () => {
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
    });

    // 启动Frida Server
    startServerBtn.addEventListener('click', async () => {
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
    });

    // 停止Frida Server
    stopServerBtn.addEventListener('click', async () => {
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
    });

    // 更新抓包按钮状态
    function updateCaptureButtons() {
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

    // 切换抓包目标
    captureTargetSelect.addEventListener('change', () => {
        if (captureTargetSelect.value === 'device') {
            captureDeviceApps.style.display = 'flex';
            loadDeviceApps();
        } else {
            captureDeviceApps.style.display = 'none';
        }
        updateCaptureButtons();
    });

    // 加载设备APP列表
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

    // 刷新APP列表
    refreshAppsBtn.addEventListener('click', loadDeviceApps);

    // APP选择变化
    deviceAppSelect.addEventListener('change', updateCaptureButtons);

    // 开始抓包
    startCaptureBtn.addEventListener('click', async () => {
        if (startCaptureBtn.disabled) return;

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
                await loadCaptureSessions();

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
    });

    // 停止抓包
    stopCaptureBtn.addEventListener('click', async () => {
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
            await loadCaptureSessions();
        } catch (error) {
            stopCaptureBtn.disabled = false;
            stopCaptureBtn.textContent = '停止抓包';
            toast.show({ text: `停止抓包失败: ${error}`, color: 'error', duration: 3000 });
        }
    });

    // 加载抓包会话列表
    async function loadCaptureSessions() {
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

    // 渲染抓包会话列表
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

    // 选择抓包会话
    async function selectCaptureSession(sessionId) {
        captureState.selectedSessionId = sessionId;

        // 更新选中状态
        captureSessionsList.querySelectorAll('.capture-session-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.sessionId === sessionId);
        });

        // 加载数据包
        await loadCapturePackets(sessionId);
    }

    // 加载抓包数据包
    async function loadCapturePackets(sessionId) {
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

    // 渲染数据包列表
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

    // 获取状态码样式类
    function getStatusClass(code) {
        if (code >= 200 && code < 300) return 'success';
        if (code >= 300 && code < 400) return 'redirect';
        if (code >= 400 && code < 500) return 'client-error';
        if (code >= 500) return 'server-error';
        return '';
    }

    // 格式化大小
    function formatSize(bytes) {
        if (!bytes || bytes === 0) return '-';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // 选择数据包
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

    // 渲染数据包详情
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

    // 格式化HTTP请求
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

    // 格式化HTTP响应
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

    // 格式化十六进制视图
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

    // 尝试格式化JSON
    function formatJsonIfPossible(str) {
        try {
            const obj = JSON.parse(str);
            return JSON.stringify(obj, null, 2);
        } catch {
            return str;
        }
    }

    // HTML转义
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // 数据包详情标签切换
    document.querySelectorAll('.packet-detail-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.packet-detail-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (captureState.selectedPacketIndex >= 0) {
                const packet = captureState.packets[captureState.selectedPacketIndex];
                renderPacketDetail(packet, tab.dataset.tab);
            }
        });
    });

    // 删除抓包会话
    async function deleteCaptureSession(sessionId) {
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

                await loadCaptureSessions();
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

    // 刷新会话列表按钮
    refreshSessionsBtn.addEventListener('click', loadCaptureSessions);

    // 过滤数据包
    packetsFilterInput.addEventListener('input', () => {
        const filter = packetsFilterInput.value.toLowerCase();
        capturePacketsBody.querySelectorAll('tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
        });
    });

    // 拖拽调整抓包面板大小
    let isResizingCapture = false;
    captureResizer.addEventListener('mousedown', () => {
        isResizingCapture = true;
        captureResizer.classList.add('active');
        document.addEventListener('mousemove', handleCaptureResize);
        document.addEventListener('mouseup', stopCaptureResize);
    });

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

    function stopCaptureResize() {
        isResizingCapture = false;
        captureResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleCaptureResize);
        document.removeEventListener('mouseup', stopCaptureResize);
    }

    // 切换到抓包面板时初始化
    operationTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'capture') {
                checkFridaEnv();
                loadCaptureSessions();
            }
            if (tab.dataset.tab === 'frida') {
                loadFridaScripts();
            }
        });
    });

    // ===================== Frida脚本模块 =====================

    // DOM元素
    const fridaScriptsList = document.getElementById('frida-scripts-list');
    const fridaSelectAllBtn = document.getElementById('frida-select-all-btn');
    const fridaSelectedScripts = document.getElementById('frida-selected-scripts');
    const fridaRunBtn = document.getElementById('frida-run-btn');
    const fridaStopBtn = document.getElementById('frida-stop-btn');
    const fridaTargetSelect = document.getElementById('frida-target-select');
    const fridaDeviceApps = document.getElementById('frida-device-apps');
    const fridaAppSelect = document.getElementById('frida-app-select');
    const fridaRefreshAppsBtn = document.getElementById('frida-refresh-apps-btn');
    const fridaSpawnMode = document.getElementById('frida-spawn-mode');
    const fridaShowTime = document.getElementById('frida-show-time');
    const fridaSearchInput = document.getElementById('frida-search-input');
    const fridaClearBtn = document.getElementById('frida-clear-btn');
    const fridaExportBtn = document.getElementById('frida-export-btn');
    const fridaOutput = document.getElementById('frida-output');
    const fridaResizer = document.getElementById('frida-resizer');
    const fridaLeft = document.querySelector('.frida-left');

    // 添加脚本相关DOM元素
    const fridaAddScriptBtn = document.getElementById('frida-add-script-btn');
    const fridaSaveDialog = document.getElementById('frida-save-dialog');
    const fridaSaveDialogClose = document.getElementById('frida-save-dialog-close');
    const fridaScriptPathDisplay = document.getElementById('frida-script-path-display');
    const fridaUseTempBtn = document.getElementById('frida-use-temp-btn');
    const fridaSavePermanentBtn = document.getElementById('frida-save-permanent-btn');
    const fridaInfoDialog = document.getElementById('frida-info-dialog');
    const fridaInfoDialogClose = document.getElementById('frida-info-dialog-close');
    const fridaScriptNameInput = document.getElementById('frida-script-name');
    const fridaScriptIdInput = document.getElementById('frida-script-id');
    const fridaScriptDescInput = document.getElementById('frida-script-desc');
    const fridaScriptCategorySelect = document.getElementById('frida-script-category');
    const fridaInfoCancelBtn = document.getElementById('frida-info-cancel-btn');
    const fridaInfoSaveBtn = document.getElementById('frida-info-save-btn');

    // Frida Server状态相关DOM元素
    const fridaServerIndicator = document.getElementById('frida-server-indicator');
    const fridaServerValue = document.getElementById('frida-server-value');
    const fridaModuleStartServer = document.getElementById('frida-module-start-server');
    const fridaModuleStopServer = document.getElementById('frida-module-stop-server');

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

    // 检查Frida脚本模块的环境状态
    async function checkFridaScriptEnv() {
        try {
            const result = await invoke('check_frida_env');
            fridaState.envReady = result.ready;
            return result;
        } catch (error) {
            console.error('检查Frida环境失败:', error);
            fridaState.envReady = false;
            return { ready: false };
        }
    }

    // 检查Frida Server状态（脚本模块专用）
    async function checkFridaModuleServerStatus() {
        try {
            const result = await invoke('check_frida_server_status');
            updateFridaServerUI(result.running);
            return result.running;
        } catch (error) {
            console.error('检查Frida Server状态失败:', error);
            updateFridaServerUI(false);
            return false;
        }
    }

    // 更新Frida Server UI状态
    function updateFridaServerUI(running) {
        fridaState.serverRunning = running;
        if (running) {
            fridaServerIndicator.textContent = '🟢';
            fridaServerValue.textContent = '运行中';
            fridaServerValue.className = 'frida-server-value running';
            fridaModuleStartServer.style.display = 'none';
            fridaModuleStopServer.style.display = 'inline-block';
        } else {
            fridaServerIndicator.textContent = '🔴';
            fridaServerValue.textContent = '未启动';
            fridaServerValue.className = 'frida-server-value stopped';
            fridaModuleStartServer.style.display = 'inline-block';
            fridaModuleStopServer.style.display = 'none';
        }
    }

    // 启动Frida Server（脚本模块）
    fridaModuleStartServer.addEventListener('click', async () => {
        fridaModuleStartServer.disabled = true;
        fridaServerIndicator.textContent = '🟡';
        fridaServerValue.textContent = '启动中...';
        fridaServerValue.className = 'frida-server-value loading';

        try {
            const result = await invoke('start_frida_server');
            if (result.success) {
                toast.show({ text: 'Frida Server已启动', color: 'success', duration: 2000 });
                updateFridaServerUI(true);
            } else {
                toast.show({ text: `启动失败: ${result.message}`, color: 'error', duration: 3000 });
                updateFridaServerUI(false);
            }
        } catch (error) {
            toast.show({ text: `启动失败: ${error}`, color: 'error', duration: 3000 });
            updateFridaServerUI(false);
        } finally {
            fridaModuleStartServer.disabled = false;
        }
    });

    // 停止Frida Server（脚本模块）
    fridaModuleStopServer.addEventListener('click', async () => {
        fridaModuleStopServer.disabled = true;
        fridaServerIndicator.textContent = '🟡';
        fridaServerValue.textContent = '停止中...';
        fridaServerValue.className = 'frida-server-value loading';

        try {
            const result = await invoke('stop_frida_server');
            if (result.success) {
                toast.show({ text: 'Frida Server已停止', color: 'success', duration: 2000 });
                updateFridaServerUI(false);
            } else {
                toast.show({ text: `停止失败: ${result.message}`, color: 'error', duration: 3000 });
                // 重新检查状态
                await checkFridaModuleServerStatus();
            }
        } catch (error) {
            toast.show({ text: `停止失败: ${error}`, color: 'error', duration: 3000 });
            await checkFridaModuleServerStatus();
        } finally {
            fridaModuleStopServer.disabled = false;
        }
    });

    // 加载Frida脚本列表
    async function loadFridaScripts() {
        fridaScriptsList.innerHTML = '<div class="frida-placeholder">检测环境中...</div>';

        // 先检查Frida环境
        const envResult = await checkFridaScriptEnv();

        if (!envResult.ready) {
            // 环境未就绪，显示初始化按钮
            fridaScriptsList.innerHTML = `
                <div class="frida-env-not-ready">
                    <div class="frida-env-icon">⚠️</div>
                    <div class="frida-env-title">Frida环境未初始化</div>
                    <div class="frida-env-desc">需要安装 frida、frida-tools 等依赖库</div>
                    <button class="frida-init-env-btn" id="frida-init-env-btn">初始化Frida环境</button>
                </div>
            `;

            // 绑定初始化按钮事件
            const initBtn = document.getElementById('frida-init-env-btn');
            if (initBtn) {
                initBtn.addEventListener('click', async () => {
                    initBtn.disabled = true;
                    initBtn.textContent = '初始化中...';

                    try {
                        toast.show({ text: '正在初始化Frida环境，这可能需要几分钟...', color: 'info', duration: 10000 });

                        const result = await invoke('init_frida_env');

                        if (result.success) {
                            toast.show({ text: 'Frida环境初始化成功！', color: 'success', duration: 3000 });
                            // 重新加载脚本列表
                            fridaState.scripts = [];
                            await loadFridaScripts();
                        }
                    } catch (error) {
                        toast.show({ text: `初始化失败: ${error}`, color: 'error', duration: 5000 });
                        initBtn.disabled = false;
                        initBtn.textContent = '初始化Frida环境';
                    }
                });
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

        fridaScriptsList.innerHTML = '<div class="frida-placeholder">加载脚本中...</div>';

        try {
            const result = await invoke('get_frida_scripts');

            if (!result.success) {
                fridaScriptsList.innerHTML = `<div class="frida-placeholder">${result.message}</div>`;
                return;
            }

            fridaState.scripts = result.scripts;
            renderFridaScripts();
        } catch (error) {
            console.error('加载Frida脚本失败:', error);
            fridaScriptsList.innerHTML = `<div class="frida-placeholder">加载失败: ${error}</div>`;
        }
    }

    // 渲染脚本列表
    function renderFridaScripts() {
        if (fridaState.scripts.length === 0) {
            fridaScriptsList.innerHTML = '<div class="frida-placeholder">暂无可用脚本</div>';
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

    // 切换脚本选中状态
    function toggleScriptSelection(scriptId, selected) {
        if (selected) {
            if (!fridaState.selectedScripts.includes(scriptId)) {
                fridaState.selectedScripts.push(scriptId);
            }
        } else {
            fridaState.selectedScripts = fridaState.selectedScripts.filter(id => id !== scriptId);
        }

        // 更新UI
        const item = fridaScriptsList.querySelector(`[data-id="${scriptId}"]`);
        if (item) {
            item.classList.toggle('selected', selected);
        }

        updateSelectedScriptsDisplay();
        updateFridaButtons();
    }

    // 更新选中脚本显示
    function updateSelectedScriptsDisplay() {
        const hasScripts = fridaState.selectedScripts.length > 0;
        const hasCustomScripts = fridaState.customScripts.length > 0;

        if (!hasScripts && !hasCustomScripts) {
            fridaSelectedScripts.innerHTML = '<span class="frida-selected-placeholder">请选择要执行的脚本</span>';
            return;
        }

        let tagsHtml = '';

        // 先显示自定义脚本
        if (hasCustomScripts) {
            tagsHtml += fridaState.customScripts.map((scriptPath, index) => {
                const fileName = scriptPath.split(/[\\/]/).pop();
                return `
                    <span class="frida-selected-tag custom" data-custom-index="${index}" title="${escapeHtml(scriptPath)}">
                        <span class="tag-label">[自定义]</span>${escapeHtml(fileName)}
                        <span class="remove-tag" title="移除">×</span>
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
                        <span class="remove-tag" title="移除">×</span>
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
                const checkbox = fridaScriptsList.querySelector(`[data-id="${scriptId}"] .frida-script-checkbox`);
                if (checkbox) {
                    checkbox.checked = false;
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

    // 全选/取消全选
    fridaSelectAllBtn.addEventListener('click', () => {
        const allSelected = fridaState.selectedScripts.length === fridaState.scripts.length;

        if (allSelected) {
            // 取消全选
            fridaState.selectedScripts = [];
            fridaSelectAllBtn.textContent = '全选';
        } else {
            // 全选
            fridaState.selectedScripts = fridaState.scripts.map(s => s.id);
            fridaSelectAllBtn.textContent = '取消';
        }

        // 更新所有checkbox
        fridaScriptsList.querySelectorAll('.frida-script-item').forEach(item => {
            const checkbox = item.querySelector('.frida-script-checkbox');
            checkbox.checked = !allSelected;
            item.classList.toggle('selected', !allSelected);
        });

        updateSelectedScriptsDisplay();
        updateFridaButtons();
    });

    // 更新按钮状态
    function updateFridaButtons() {
        const hasSelection = fridaState.selectedScripts.length > 0 || fridaState.customScripts.length > 0;
        const hasTarget = fridaTargetSelect.value === 'current' ?
            (selectedApkIndex >= 0 && apkListData[selectedApkIndex]?.packageName) :
            !!fridaAppSelect.value;

        fridaRunBtn.disabled = !hasSelection || !hasTarget || fridaState.running;
        fridaStopBtn.disabled = !fridaState.running;

        if (fridaState.running) {
            fridaRunBtn.classList.add('running');
            fridaRunBtn.textContent = '运行中...';
        } else {
            fridaRunBtn.classList.remove('running');
            fridaRunBtn.textContent = '运行脚本';
        }
    }

    // 目标选择切换
    fridaTargetSelect.addEventListener('change', () => {
        if (fridaTargetSelect.value === 'device') {
            fridaDeviceApps.style.display = 'flex';
            loadFridaDeviceApps();
        } else {
            fridaDeviceApps.style.display = 'none';
        }
        updateFridaButtons();
    });

    // 加载设备应用列表
    async function loadFridaDeviceApps() {
        fridaAppSelect.innerHTML = '<option value="">加载中...</option>';
        fridaAppSelect.disabled = true;

        try {
            const result = await invoke('get_device_apps');

            fridaAppSelect.innerHTML = '<option value="">请选择应用...</option>';
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
            fridaAppSelect.innerHTML = '<option value="">加载失败</option>';
            console.error('获取APP列表失败:', error);
        }
    }

    // 刷新应用列表
    fridaRefreshAppsBtn.addEventListener('click', loadFridaDeviceApps);

    // 应用选择变化
    fridaAppSelect.addEventListener('change', updateFridaButtons);

    // 运行脚本
    fridaRunBtn.addEventListener('click', async () => {
        if (fridaRunBtn.disabled || fridaState.running) return;

        let packageName = '';
        if (fridaTargetSelect.value === 'current') {
            if (selectedApkIndex < 0 || !apkListData[selectedApkIndex]) {
                toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
                return;
            }
            packageName = apkListData[selectedApkIndex].packageName;
            if (!packageName) {
                toast.show({ text: '无法获取APK包名', color: 'error', duration: 2000 });
                return;
            }
        } else {
            packageName = fridaAppSelect.value;
            if (!packageName) {
                toast.show({ text: '请选择要注入的应用', color: 'warning', duration: 2000 });
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
            toast.show({ text: '请选择要执行的脚本', color: 'warning', duration: 2000 });
            return;
        }

        fridaState.running = true;
        updateFridaButtons();
        clearFridaOutput();
        appendFridaOutput('[*] 正在启动Frida...', 'info');
        appendFridaOutput(`[*] 目标包名: ${packageName}`, 'info');
        if (scriptFiles.length > 0) {
            appendFridaOutput(`[*] 执行脚本: ${scriptFiles.join(', ')}`, 'info');
        }
        if (customScriptPaths.length > 0) {
            appendFridaOutput(`[*] 自定义脚本: ${customScriptPaths.length}个`, 'info');
        }
        appendFridaOutput(`[*] Spawn模式: ${fridaSpawnMode.checked ? '是' : '否'}`, 'info');

        try {
            const result = await invoke('run_frida_scripts', {
                packageName: packageName,
                scripts: scriptFiles,
                customScripts: customScriptPaths,
                spawnMode: fridaSpawnMode.checked
            });

            if (result.success) {
                fridaState.processId = result.processId;
                appendFridaOutput('[+] Frida已启动', 'success');

                // 开始轮询输出
                startFridaOutputPolling();
            } else {
                appendFridaOutput(`[-] 启动失败: ${result.message}`, 'error');
                fridaState.running = false;
                updateFridaButtons();
            }
        } catch (error) {
            appendFridaOutput(`[-] 启动失败: ${error}`, 'error');
            fridaState.running = false;
            updateFridaButtons();
        }
    });

    // 停止脚本
    fridaStopBtn.addEventListener('click', async () => {
        if (!fridaState.running) return;

        appendFridaOutput('[*] 正在停止Frida...', 'info');

        try {
            await invoke('stop_frida_scripts', { processId: fridaState.processId });
            appendFridaOutput('[+] Frida已停止', 'success');
        } catch (error) {
            appendFridaOutput(`[-] 停止失败: ${error}`, 'error');
        }

        stopFridaOutputPolling();
        fridaState.running = false;
        fridaState.processId = null;
        updateFridaButtons();
    });

    // 输出轮询
    let fridaOutputTimer = null;

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
                    appendFridaOutput('[*] Frida进程已结束', 'info');
                    stopFridaOutputPolling();
                    fridaState.running = false;
                    fridaState.processId = null;
                    updateFridaButtons();
                }
            } catch (error) {
                console.error('获取Frida输出失败:', error);
            }
        }, 500);
    }

    function stopFridaOutputPolling() {
        if (fridaOutputTimer) {
            clearInterval(fridaOutputTimer);
            fridaOutputTimer = null;
        }
    }

    // 添加输出行
    function appendFridaOutput(text, type = 'info') {
        // 移除占位符
        const placeholder = fridaOutput.querySelector('.frida-output-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        const line = document.createElement('div');
        line.className = `frida-output-line ${type}`;

        // 添加时间戳
        if (fridaShowTime.checked) {
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
        const searchText = fridaSearchInput.value.trim();
        if (searchText && text.toLowerCase().includes(searchText.toLowerCase())) {
            line.innerHTML = line.innerHTML.replace(
                new RegExp(`(${escapeRegExp(searchText)})`, 'gi'),
                '<span class="highlight">$1</span>'
            );
        }

        fridaOutput.appendChild(line);
        fridaState.outputLines.push({ text, type, timestamp: Date.now() });

        // 自动滚动到底部
        fridaOutput.scrollTop = fridaOutput.scrollHeight;
    }

    // 清空输出
    function clearFridaOutput() {
        fridaOutput.innerHTML = '<div class="frida-output-placeholder">Frida脚本输出将在此显示...</div>';
        fridaState.outputLines = [];
    }

    fridaClearBtn.addEventListener('click', clearFridaOutput);

    // 导出输出
    fridaExportBtn.addEventListener('click', async () => {
        if (fridaState.outputLines.length === 0) {
            toast.show({ text: '没有可导出的内容', color: 'warning', duration: 2000 });
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
            toast.show({ text: '导出成功', color: 'success', duration: 2000 });
        } catch (error) {
            toast.show({ text: `导出失败: ${error}`, color: 'error', duration: 3000 });
        }
    });

    // 搜索过滤
    fridaSearchInput.addEventListener('input', () => {
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
                        new RegExp(`(${escapeRegExp(searchText)})`, 'gi'),
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
    });

    // Frida面板拖拽调整大小
    let isResizingFrida = false;
    fridaResizer.addEventListener('mousedown', () => {
        isResizingFrida = true;
        fridaResizer.classList.add('active');
        document.addEventListener('mousemove', handleFridaResize);
        document.addEventListener('mouseup', stopFridaResize);
    });

    function handleFridaResize(e) {
        if (!isResizingFrida) return;
        const container = document.querySelector('.frida-container');
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 200 && newWidth <= 400) {
            fridaLeft.style.width = newWidth + 'px';
        }
    }

    function stopFridaResize() {
        isResizingFrida = false;
        fridaResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleFridaResize);
        document.removeEventListener('mouseup', stopFridaResize);
    }

    // ===================== 添加自定义脚本功能 =====================

    // 添加脚本按钮点击事件
    fridaAddScriptBtn.addEventListener('click', async () => {
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
                fridaScriptPathDisplay.textContent = selected;
                // 显示保存确认对话框
                fridaSaveDialog.classList.remove('hidden');
            }
        } catch (error) {
            console.error('选择文件失败:', error);
            toast.show({ text: '选择文件失败: ' + error, color: 'error', duration: 3000 });
        }
    });

    // 关闭保存确认对话框
    fridaSaveDialogClose.addEventListener('click', () => {
        fridaSaveDialog.classList.add('hidden');
        fridaState.pendingScriptPath = null;
    });

    // 仅本次使用
    fridaUseTempBtn.addEventListener('click', () => {
        if (fridaState.pendingScriptPath) {
            // 添加到自定义脚本列表
            fridaState.customScripts.push(fridaState.pendingScriptPath);
            updateSelectedScriptsDisplay();
            updateFridaButtons();
            toast.show({ text: '已添加自定义脚本（仅本次使用）', color: 'success', duration: 2000 });
        }
        fridaSaveDialog.classList.add('hidden');
        fridaState.pendingScriptPath = null;
    });

    // 保存到列表 - 显示信息填写对话框
    fridaSavePermanentBtn.addEventListener('click', () => {
        fridaSaveDialog.classList.add('hidden');
        // 清空表单
        fridaScriptNameInput.value = '';
        fridaScriptIdInput.value = '';
        fridaScriptDescInput.value = '';
        fridaScriptCategorySelect.value = 'other';
        // 显示信息填写对话框
        fridaInfoDialog.classList.remove('hidden');
    });

    // 关闭信息填写对话框
    fridaInfoDialogClose.addEventListener('click', () => {
        fridaInfoDialog.classList.add('hidden');
        fridaState.pendingScriptPath = null;
    });

    fridaInfoCancelBtn.addEventListener('click', () => {
        fridaInfoDialog.classList.add('hidden');
        fridaState.pendingScriptPath = null;
    });

    // 保存脚本到列表
    fridaInfoSaveBtn.addEventListener('click', async () => {
        const name = fridaScriptNameInput.value.trim();
        const id = fridaScriptIdInput.value.trim();
        const description = fridaScriptDescInput.value.trim();
        const category = fridaScriptCategorySelect.value;

        // 验证必填字段
        if (!name) {
            toast.show({ text: '请输入脚本名称', color: 'warning', duration: 2000 });
            fridaScriptNameInput.focus();
            return;
        }
        if (!id) {
            toast.show({ text: '请输入脚本ID', color: 'warning', duration: 2000 });
            fridaScriptIdInput.focus();
            return;
        }
        // 验证ID格式（只允许英文、数字、下划线）
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(id)) {
            toast.show({ text: '脚本ID只能包含英文字母、数字和下划线，且必须以字母开头', color: 'warning', duration: 3000 });
            fridaScriptIdInput.focus();
            return;
        }

        // 检查ID是否已存在
        if (fridaState.scripts.some(s => s.id === id)) {
            toast.show({ text: '该脚本ID已存在，请使用其他ID', color: 'warning', duration: 2000 });
            fridaScriptIdInput.focus();
            return;
        }

        try {
            fridaInfoSaveBtn.disabled = true;
            fridaInfoSaveBtn.textContent = '保存中...';

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
                toast.show({ text: '脚本已保存到列表', color: 'success', duration: 2000 });
                // 关闭对话框
                fridaInfoDialog.classList.add('hidden');
                fridaState.pendingScriptPath = null;
                // 重新加载脚本列表
                fridaState.scripts = [];
                await loadFridaScripts();
            } else {
                toast.show({ text: '保存失败: ' + result.message, color: 'error', duration: 3000 });
            }
        } catch (error) {
            console.error('保存脚本失败:', error);
            toast.show({ text: '保存失败: ' + error, color: 'error', duration: 3000 });
        } finally {
            fridaInfoSaveBtn.disabled = false;
            fridaInfoSaveBtn.textContent = '保存脚本';
        }
    });
});
