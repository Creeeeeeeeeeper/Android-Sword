/**
 * APK模块 - 处理APK文件的添加、反编译、列表管理等功能
 * 负责APK上传、反编译、列表渲染、右键菜单、安装/删除等操作
 *
 * 支持两种分析模式：
 * 1. 快速分析：直接解析APK文件，不生成额外文件
 * 2. 深度分析（jadx反编译）：反编译APK到文件夹，支持源码查看
 */

window.ApkModule = (function() {
    // 模块依赖（通过init注入）
    let invoke = null;
    let convertFileSrc = null;
    let toast = null;
    let caseNumber = '';

    // DOM元素
    let addApkBtn = null;
    let apkTabsContainer = null;
    let apkDetailContainer = null;
    let taskIndicator = null;
    let fullscreenLoading = null;

    // 工具函数
    let formatFileSize = null;
    let formatDate = null;
    let escapeHtml = null;

    // 状态getter/setter
    let getApkListData = null;
    let setApkListData = null;
    let getSelectedApkIndex = null;
    let setSelectedApkIndex = null;
    let getDecompilingCount = null;
    let setDecompilingCount = null;

    // ADB设备缓存
    let adbDeviceCache = null;

    // 回调函数
    let onApkSelect = null;

    /**
     * 初始化模块，注入依赖
     * @param {Object} deps - 依赖对象
     */
    function init(deps) {
        invoke = deps.invoke;
        convertFileSrc = deps.convertFileSrc;
        toast = deps.toast;
        caseNumber = deps.caseNumber;

        // DOM元素
        addApkBtn = deps.addApkBtn;
        apkTabsContainer = deps.apkTabsContainer;
        apkDetailContainer = deps.apkDetailContainer;
        taskIndicator = deps.taskIndicator;
        fullscreenLoading = deps.fullscreenLoading;

        // 工具函数
        formatFileSize = deps.formatFileSize;
        formatDate = deps.formatDate;
        escapeHtml = deps.escapeHtml;

        // 状态getter/setter
        getApkListData = deps.getApkListData;
        setApkListData = deps.setApkListData;
        getSelectedApkIndex = deps.getSelectedApkIndex;
        setSelectedApkIndex = deps.setSelectedApkIndex;
        getDecompilingCount = deps.getDecompilingCount;
        setDecompilingCount = deps.setDecompilingCount;

        // ADB设备缓存
        adbDeviceCache = deps.adbDeviceCache;

        // 回调函数
        onApkSelect = deps.onApkSelect;

        // 绑定事件
        bindEvents();
    }

    /**
     * 绑定按钮事件
     */
    function bindEvents() {
        // 添加APK按钮事件
        if (addApkBtn) {
            addApkBtn.addEventListener('click', handleAddApk);
        }
    }

    /**
     * 显示/隐藏任务指示器
     */
    function updateTaskIndicator() {
        const decompilingCount = getDecompilingCount();
        if (decompilingCount > 0) {
            taskIndicator.classList.remove('hidden');
            taskIndicator.querySelector('.task-text').textContent =
                decompilingCount === 1 ? '反编译中...' : `反编译中 (${decompilingCount})...`;
        } else {
            taskIndicator.classList.add('hidden');
        }
    }

    /**
     * 反编译APK
     * @param {string} apkFilePath - APK文件路径
     * @param {string} apkDir - APK目录
     * @param {number} timestamp - 时间戳
     */
    async function decompileApk(apkFilePath, apkDir, timestamp) {
        // 增加反编译任务计数
        setDecompilingCount(getDecompilingCount() + 1);
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
            setDecompilingCount(getDecompilingCount() - 1);
            updateTaskIndicator();
        }
    }

    /**
     * 预分析APK详细信息（上传时自动运行，计算哈希和签名信息）
     * @param {string} apkDir - APK目录
     */
    async function preanalyzeApkDetails(apkDir) {
        try {
            console.log('开始预分析APK详细信息:', apkDir);
            const result = await invoke('preanalyze_apk_details', { apkDir: apkDir });
            console.log('APK详细信息预分析完成:', result);
        } catch (error) {
            console.error('APK详细信息预分析失败:', error);
        }
    }

    /**
     * 刷新APK列表并选中指定timestamp的APK
     * @param {number} targetTimestamp - 目标时间戳
     */
    async function refreshApkListAndSelect(targetTimestamp) {
        console.log('刷新APK列表并选中:', targetTimestamp);
        try {
            const apkListData = await invoke('get_apk_list', { caseNumber: caseNumber });
            console.log('APK列表:', apkListData);
            setApkListData(apkListData);

            renderApkTabs();

            // 查找目标timestamp对应的索引
            const targetIndex = apkListData.findIndex(apk => apk.timestamp === targetTimestamp);
            if (targetIndex !== -1) {
                selectApk(targetIndex);
            } else if (apkListData.length > 0) {
                // 如果没找到，选中第一个
                selectApk(0);
            } else {
                setSelectedApkIndex(-1);
                renderApkDetail(null);
            }
        } catch (error) {
            console.error('获取APK列表失败:', error);
        }
    }

    /**
     * 刷新APK列表
     */
    async function refreshApkList() {
        console.log('刷新APK列表');
        try {
            const apkListData = await invoke('get_apk_list', { caseNumber: caseNumber });
            console.log('APK列表:', apkListData);
            setApkListData(apkListData);

            renderApkTabs();

            const selectedApkIndex = getSelectedApkIndex();

            // 如果有APK且没有选中的，选中第一个
            if (apkListData.length > 0 && selectedApkIndex === -1) {
                selectApk(0);
            } else if (apkListData.length === 0) {
                setSelectedApkIndex(-1);
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

    /**
     * 渲染APK标签栏
     */
    function renderApkTabs() {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

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
                ? `<img src="${convertFileSrc(apk.iconPath)}" alt="icon" onerror="this.parentElement.innerHTML='<span class=\\'apk-tab-icon-placeholder\\'>&#128230;</span>'">`
                : '<span class="apk-tab-icon-placeholder">&#128230;</span>';

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

    /**
     * 显示APK右键菜单
     * @param {Event} event - 事件对象
     * @param {Object} apk - APK对象
     * @param {number} index - 索引
     */
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

    /**
     * 安装APK到设备
     * @param {Object} apk - APK对象
     */
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

    /**
     * 确认删除APK
     * @param {Object} apk - APK对象
     * @param {number} index - 索引
     */
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

    /**
     * 删除APK
     * @param {Object} apk - APK对象
     * @param {number} index - 索引
     */
    async function deleteApk(apk, index) {
        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

            // 清理该APK的事件监听器
            if (window.SensitiveModule && window.SensitiveModule.cleanupListenersForApk) {
                await window.SensitiveModule.cleanupListenersForApk(apk.timestamp);
            }

            // 删除整个APK目录
            await invoke('delete_dir', { dirname: apkDir });

            toast.show({
                text: '已删除APK分析',
                color: 'success',
                duration: 2000
            });

            const selectedApkIndex = getSelectedApkIndex();

            // 如果删除的是当前选中的，重置选中状态
            if (index === selectedApkIndex) {
                setSelectedApkIndex(-1);
            } else if (index < selectedApkIndex) {
                setSelectedApkIndex(selectedApkIndex - 1);
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

    /**
     * 选中APK
     * @param {number} index - 索引
     */
    function selectApk(index) {
        setSelectedApkIndex(index);

        const apkListData = getApkListData();

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

        // 触发回调
        if (onApkSelect) {
            onApkSelect(index);
        }
    }

    /**
     * 渲染APK详情
     * @param {Object} apk - APK对象
     */
    function renderApkDetail(apk) {
        if (!apk) {
            apkDetailContainer.innerHTML = '<div class="apk-detail-empty">暂无APK，请点击添加按钮上传</div>';
            return;
        }

        const iconHtml = apk.iconPath
            ? `<img src="${convertFileSrc(apk.iconPath)}" alt="icon" onerror="this.parentElement.innerHTML='<span class=\\'apk-detail-icon-placeholder\\'>&#128230;</span>'">`
            : '<span class="apk-detail-icon-placeholder">&#128230;</span>';

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

    /**
     * 隐藏全屏加载蒙层
     */
    function hideFullscreenLoading() {
        if (fullscreenLoading) {
            fullscreenLoading.classList.add('hidden');
        }
    }

    /**
     * 初始化APK面板
     */
    async function initApkPanel() {
        await refreshApkList();
        // APK列表加载完成后隐藏全屏加载蒙层
        hideFullscreenLoading();
    }

    /**
     * 处理添加APK按钮点击
     * 采用快速分析优先策略：先进行快速分析（不依赖jadx），然后后台进行jadx反编译
     */
    async function handleAddApk() {
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

            // 立即进行快速分析（不依赖jadx）
            try {
                console.log('开始快速分析APK...');
                addApkBtn.textContent = '分析中...';
                addApkBtn.disabled = true;

                // 执行快速分析
                const quickResult = await invoke('quick_analyze_apk', { apkDir: apkDir });
                if (quickResult.success) {
                    console.log('快速分析成功:', quickResult);
                    toast.show({
                        text: 'APK添加成功，快速分析完成',
                        color: 'success',
                        duration: 3000
                    });
                } else {
                    console.log('快速分析未成功:', quickResult.message);
                }
            } catch (quickError) {
                console.log('快速分析失败:', quickError);
            } finally {
                addApkBtn.textContent = '+ 添加';
                addApkBtn.disabled = false;
            }

            // 预分析APK详细信息（哈希和签名）
            preanalyzeApkDetails(apkDir);

            // 先刷新列表显示APK（快速分析已完成，可以立即使用部分功能）
            await refreshApkList();

            // 后台启动jadx反编译（异步，不阻塞用户操作）
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
    }

    /**
     * 获取当前选中的APK
     * @returns {Object|null} 当前选中的APK对象
     */
    function getSelectedApk() {
        const index = getSelectedApkIndex();
        if (index < 0) return null;
        const apkListData = getApkListData();
        return apkListData[index] || null;
    }

    // 暴露公共API
    return {
        init: init,
        initPanel: initApkPanel,
        updateTaskIndicator: updateTaskIndicator,
        decompileApk: decompileApk,
        preanalyzeApkDetails: preanalyzeApkDetails,
        refreshApkListAndSelect: refreshApkListAndSelect,
        refreshApkList: refreshApkList,
        renderApkTabs: renderApkTabs,
        showApkContextMenu: showApkContextMenu,
        installApkToDevice: installApkToDevice,
        confirmDeleteApk: confirmDeleteApk,
        deleteApk: deleteApk,
        selectApk: selectApk,
        renderApkDetail: renderApkDetail,
        hideFullscreenLoading: hideFullscreenLoading,
        getSelectedApk: getSelectedApk
    };
})();
