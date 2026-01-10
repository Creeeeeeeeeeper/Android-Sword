/**
 * Sensitive Module - 敏感信息模块
 * 负责APK敏感信息的扫描、展示和代码预览
 */
(function() {
    'use strict';

    // 依赖注入
    let invoke = null;
    let caseNumber = null;
    let toast = null;
    let escapeHtml = null;
    let escapeRegExp = null;
    let getHighlightLanguage = null;
    let getApkListData = null;
    let getSelectedApkIndex = null;
    let operationTabs = null;

    // DOM元素引用
    let sensitiveCategory = null;
    let sensitivePageSize = null;
    let sensitiveRescanBtn = null;
    let sensitiveStats = null;
    let sensitiveList = null;
    let sensitivePagination = null;
    let sensitiveCodePath = null;
    let sensitiveCodeContent = null;
    let sensitiveResizer = null;
    let sensitiveLeft = null;

    // 每个APK独立的敏感信息状态管理
    // key: apk.timestamp, value: { scanning, hasScanned, currentPage, totalPages, selectedId, stats, allItems, eventUnlisteners }
    const sensitiveStateMap = new Map();

    // 批量渲染控制
    let pendingItems = [];
    let renderTimer = null;
    const BATCH_SIZE = 10; // 累积10条再渲染
    const BATCH_DELAY = 500; // 或500ms后渲染

    // 分类名称映射
    const categoryNames = {
        'hae': 'HAE敏感信息',
        'private_key': '私钥和证书',
        'api_key': 'API密钥和令牌',
        'oauth': 'OAuth和认证令牌',
        'cloud': '云平台凭证',
        'service_account': '服务账号凭证',
        'payment': '支付相关密钥',
        'platform': '平台服务密钥',
        'ip': 'IP地址',
        'url': 'URL地址',
        'other': '其他敏感信息'
    };

    // 拖拽状态
    let isResizingSensitive = false;

    /**
     * 获取当前APK的敏感信息状态
     * @param {string|number} timestamp - APK的时间戳标识
     * @returns {Object} 敏感信息状态对象
     */
    function getSensitiveState(timestamp) {
        // 统一转换为字符串作为key，确保类型一致
        const key = String(timestamp);
        if (!sensitiveStateMap.has(key)) {
            sensitiveStateMap.set(key, {
                scanning: false,
                hasScanned: false,
                currentPage: 0,
                totalPages: 0,
                selectedId: -1,
                stats: null,
                allItems: [], // 所有扫描到的敏感信息
                eventUnlisteners: [] // 事件监听器的取消订阅函数
            });
        }
        return sensitiveStateMap.get(key);
    }

    /**
     * 初始化模块
     * @param {Object} deps - 依赖对象
     * @param {Function} deps.invoke - Tauri invoke函数
     * @param {string} deps.caseNumber - 案件编号
     * @param {Object} deps.toast - Toast提示对象
     * @param {Function} deps.escapeHtml - HTML转义函数
     * @param {Function} deps.escapeRegExp - 正则表达式转义函数
     * @param {Function} deps.getHighlightLanguage - 获取高亮语言函数
     * @param {Function} deps.getApkListData - 获取APK列表数据的函数
     * @param {Function} deps.getSelectedApkIndex - 获取当前选中APK索引的函数
     * @param {NodeList} deps.operationTabs - 操作标签页元素集合
     */
    function init(deps) {
        invoke = deps.invoke;
        caseNumber = deps.caseNumber;
        toast = deps.toast;
        escapeHtml = deps.escapeHtml;
        escapeRegExp = deps.escapeRegExp;
        getHighlightLanguage = deps.getHighlightLanguage;
        getApkListData = deps.getApkListData;
        getSelectedApkIndex = deps.getSelectedApkIndex;
        operationTabs = deps.operationTabs;

        // 初始化DOM元素引用
        sensitiveCategory = document.getElementById('sensitive-category');
        sensitivePageSize = document.getElementById('sensitive-page-size');
        sensitiveRescanBtn = document.getElementById('sensitive-rescan-btn');
        sensitiveStats = document.getElementById('sensitive-stats');
        sensitiveList = document.getElementById('sensitive-list');
        sensitivePagination = document.getElementById('sensitive-pagination');
        sensitiveCodePath = document.getElementById('sensitive-code-path');
        sensitiveCodeContent = document.getElementById('sensitive-code-content');
        sensitiveResizer = document.getElementById('sensitive-resizer');
        sensitiveLeft = document.querySelector('.sensitive-left');

        // 绑定事件
        bindEvents();

        // 注意：由于页面在iframe中运行，Tauri事件系统无法正常工作
        // 改用轮询缓存文件的方案，不再设置全局事件监听器

        console.log('SensitiveModule 初始化完成');
    }

    /**
     * 绑定事件监听器
     */
    function bindEvents() {
        // 重新扫描按钮点击
        if (sensitiveRescanBtn) {
            sensitiveRescanBtn.addEventListener('click', () => {
                handleRescanClick();
            });
        }

        // 分类筛选变化
        if (sensitiveCategory) {
            sensitiveCategory.addEventListener('change', () => {
                const selectedApkIndex = getSelectedApkIndex();
                const apkListData = getApkListData();
                if (selectedApkIndex >= 0) {
                    const state = getSensitiveState(apkListData[selectedApkIndex].timestamp);
                    if (state.hasScanned) {
                        state.currentPage = 0;
                        loadSensitivePage();
                    }
                }
            });
        }

        // 每页条数变化
        if (sensitivePageSize) {
            sensitivePageSize.addEventListener('change', () => {
                const selectedApkIndex = getSelectedApkIndex();
                const apkListData = getApkListData();
                if (selectedApkIndex >= 0) {
                    const state = getSensitiveState(apkListData[selectedApkIndex].timestamp);
                    if (state.hasScanned) {
                        state.currentPage = 0;
                        loadSensitivePage();
                    }
                }
            });
        }

        // 切换到敏感信息面板时，刷新当前APK的敏感信息UI
        if (operationTabs) {
            operationTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    if (tab.dataset.tab === 'sensitive' && getSelectedApkIndex() >= 0) {
                        refreshSensitiveUI();
                    }
                });
            });
        }

        // 拖拽调整敏感信息面板大小
        if (sensitiveResizer) {
            sensitiveResizer.addEventListener('mousedown', (e) => {
                isResizingSensitive = true;
                sensitiveResizer.classList.add('active');
                document.addEventListener('mousemove', handleSensitiveResize);
                document.addEventListener('mouseup', stopSensitiveResize);
            });
        }
    }

    /**
     * 处理重新扫描按钮点击
     */
    function handleRescanClick() {
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();

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
    }

    /**
     * 刷新敏感信息面板UI（根据当前选中的APK状态）
     */
    function refreshSensitiveUI() {
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();

        if (selectedApkIndex < 0) {
            sensitiveStats.innerHTML = '';
            sensitiveList.innerHTML = '<div class="sensitive-placeholder">请先添加APK，系统将自动扫描敏感信息</div>';
            sensitivePagination.innerHTML = '';
            sensitiveCodePath.textContent = '';
            sensitiveCodeContent.innerHTML = '<div class="sensitive-placeholder">选择左侧敏感信息查看代码位置</div>';
            sensitiveRescanBtn.style.display = 'none';
            return;
        }

        const apk = apkListData[selectedApkIndex];
        const state = getSensitiveState(apk.timestamp);
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        // 切换APK时清空代码预览区
        sensitiveCodePath.textContent = '';
        sensitiveCodeContent.innerHTML = '<div class="sensitive-placeholder">选择左侧敏感信息查看代码位置</div>';

        // APK扫描不再依赖反编译，直接可以扫描
        // 检查APK文件是否存在
        const apkPath = `${apkDir}/base.apk`;

        if (state.scanning) {
            // 正在扫描中
            sensitiveRescanBtn.style.display = 'none';
            sensitiveList.innerHTML = '<div class="sensitive-placeholder">扫描中，请稍候...</div>';
            sensitiveStats.innerHTML = '扫描中...';
            sensitivePagination.innerHTML = '';

            // 如果还没有轮询，启动轮询
            const cachePath = `${apkDir}/sensitive.json`;
            startPollingForCache(String(apk.timestamp), cachePath);
        } else {
            if (state.hasScanned) {
                // 已有扫描结果（来自内存或缓存），显示重新扫描按钮
                console.log(`[UI刷新] APK ${apk.timestamp} 已有扫描结果，共 ${state.allItems.length} 条`);
                sensitiveRescanBtn.style.display = 'inline-block';
                sensitiveRescanBtn.disabled = false;
                if (state.stats) {
                    renderSensitiveStats(state.stats);
                }
                // 使用分页渲染，而不是全量渲染
                loadSensitivePage();
            } else {
                // 尚未扫描，检查内存中是否有数据（可能扫描完成但状态未更新）
                if (state.allItems && state.allItems.length > 0) {
                    // 内存中有数据，说明扫描已完成，只是状态未更新
                    console.log(`[UI刷新] APK ${apk.timestamp} 内存中有数据，标记为已扫描，共 ${state.allItems.length} 条`);
                    state.hasScanned = true;
                    sensitiveRescanBtn.style.display = 'inline-block';
                    sensitiveRescanBtn.disabled = false;
                    if (state.stats) {
                        renderSensitiveStats(state.stats);
                    }
                    // 使用分页渲染
                    loadSensitivePage();
                } else {
                    // 内存中没有数据，检查缓存或等待后台扫描
                    console.log(`[UI刷新] APK ${apk.timestamp} 尚未扫描，检查缓存`);
                    sensitiveRescanBtn.style.display = 'none';
                    sensitiveStats.innerHTML = '';
                    sensitiveList.innerHTML = '<div class="sensitive-placeholder">等待自动扫描...</div>';
                    sensitivePagination.innerHTML = '';
                    // 异步检查缓存
                    checkAndLoadSensitiveCache().catch(err => {
                        console.error('检查缓存失败:', err);
                    });
                }
            }
        }
    }

    /**
     * 渲染所有敏感信息项（用于切换APK时显示已扫描的结果）
     * @param {Array} items - 敏感信息数组
     */
    function renderAllItems(items) {
        if (!items || items.length === 0) {
            sensitiveList.innerHTML = '<div class="sensitive-placeholder">未发现敏感信息</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        items.forEach(item => {
            const element = createSensitiveListItemElement(item);
            fragment.appendChild(element);
        });

        sensitiveList.innerHTML = '';
        sensitiveList.appendChild(fragment);
    }

    /**
     * 设置全局事件监听器（页面加载时设置一次，监听所有APK的扫描事件）
     */
    async function setupGlobalSensitiveListeners() {
        // 尝试从当前窗口或父窗口获取 Tauri API
        const tauriEvent = window.__TAURI__?.event || window.parent?.__TAURI__?.event;

        if (!tauriEvent || !tauriEvent.listen) {
            console.error('[全局监听] 无法获取 Tauri event API');
            return;
        }

        const { listen } = tauriEvent;

        try {
            // 监听单条结果（用于实时显示进度，可选）
            await listen('sensitive-item', (event) => {
                const { apkDir, item } = event.payload;
                // 从apkDir提取timestamp（处理Windows和Unix路径）
                const normalizedPath = apkDir.replace(/\\/g, '/');
                const timestamp = normalizedPath.split('/').pop();

                const state = getSensitiveState(timestamp);
                // 标记为扫描中
                state.scanning = true;

                // 如果当前显示的是这个APK且在敏感信息页面，实时显示
                const selectedApkIndex = getSelectedApkIndex();
                const apkListData = getApkListData();
                if (selectedApkIndex >= 0 && String(apkListData[selectedApkIndex].timestamp) === String(timestamp)) {
                    const sensitiveTab = document.querySelector('[data-tab="sensitive"]');
                    if (sensitiveTab && sensitiveTab.classList.contains('active')) {
                        // 添加到待渲染队列
                        pendingItems.push(item);
                        if (pendingItems.length >= BATCH_SIZE) {
                            flushPendingItems(timestamp);
                        } else if (!renderTimer) {
                            renderTimer = setTimeout(() => {
                                flushPendingItems(timestamp);
                            }, BATCH_DELAY);
                        }
                    }
                }
            });

            // 监听进度
            await listen('sensitive-progress', (event) => {
                const { apkDir, processed, total } = event.payload;
                // 从apkDir提取timestamp（处理Windows和Unix路径）
                const normalizedPath = apkDir.replace(/\\/g, '/');
                const timestamp = normalizedPath.split('/').pop();
                console.log(`[全局监听] 扫描进度: APK=${timestamp}, ${processed}/${total}`);

                // 标记为扫描中
                const state = getSensitiveState(timestamp);
                state.scanning = true;

                // 如果当前显示的是这个APK且在敏感信息页面，更新进度
                const selectedApkIndex = getSelectedApkIndex();
                const apkListData = getApkListData();
                // 注意：timestamp可能是字符串，apk.timestamp可能是数字，需要转换比较
                if (selectedApkIndex >= 0 && String(apkListData[selectedApkIndex].timestamp) === String(timestamp)) {
                    const sensitiveTab = document.querySelector('[data-tab="sensitive"]');
                    if (sensitiveTab && sensitiveTab.classList.contains('active')) {
                        updateScanProgress(timestamp, processed, total);
                    }
                }
            });

            // 监听完成
            await listen('sensitive-complete', (event) => {
                console.log('后端敏感信息已扫描完毕', event.payload);

                const { apkDir, total, stats, items } = event.payload;
                // 从apkDir提取timestamp（处理Windows和Unix路径）
                const normalizedPath = apkDir.replace(/\\/g, '/');
                const timestamp = normalizedPath.split('/').pop();

                console.log(`[全局监听] 敏感信息扫描完成: ${timestamp}, 共 ${total} 条, apkDir=${apkDir}`);

                const state = getSensitiveState(timestamp);
                state.scanning = false;
                state.hasScanned = true;
                state.stats = stats;
                // 直接使用后端发送的完整数据
                state.allItems = items || [];

                console.log(`[全局监听] APK ${timestamp} 状态更新: hasScanned=${state.hasScanned}, allItems.length=${state.allItems.length}`);

                // 如果当前显示的是这个APK，更新UI
                const selectedApkIndex = getSelectedApkIndex();
                const apkListData = getApkListData();
                // 注意：timestamp可能是字符串，apk.timestamp可能是数字，需要转换比较
                if (selectedApkIndex >= 0 && String(apkListData[selectedApkIndex].timestamp) === String(timestamp)) {
                    const sensitiveTab = document.querySelector('[data-tab="sensitive"]');
                    if (sensitiveTab && sensitiveTab.classList.contains('active')) {
                        // 在敏感信息页面，使用分页渲染
                        console.log(`[全局监听] 在敏感信息页面，使用分页渲染 ${state.allItems.length} 条结果`);

                        // 清空待渲染队列
                        pendingItems = [];
                        if (renderTimer) {
                            clearTimeout(renderTimer);
                            renderTimer = null;
                        }

                        toast.show({
                            text: `扫描完成，共发现 ${total} 条敏感信息`,
                            color: 'success',
                            duration: 3000
                        });

                        if (stats) {
                            renderSensitiveStats(stats);
                        }

                        // 显示重新扫描按钮
                        if (sensitiveRescanBtn) {
                            sensitiveRescanBtn.style.display = 'inline-block';
                        }

                        // 使用分页加载第一页
                        loadSensitivePage();
                    } else {
                        // 不在敏感信息页面，只记录状态
                        console.log(`[全局监听] APK ${timestamp} 扫描完成，结果已缓存到内存，共 ${state.allItems.length} 条`);
                    }
                } else {
                    console.log(`[全局监听] APK ${timestamp} 不是当前选中的APK，结果已缓存`);
                }
            });

            console.log('[全局监听] 敏感信息事件监听器已设置');
        } catch (error) {
            console.error('[全局监听] 设置全局监听器失败:', error);
        }
    }

    /**
     * 设置流式扫描的事件监听器（废弃，保留兼容性）
     * @deprecated 使用全局监听器代替
     * @param {string} timestamp - APK时间戳
     * @param {string} apkDir - APK目录
     */
    async function setupStreamingScanListeners(timestamp, apkDir) {
        // 标记为扫描中
        const state = getSensitiveState(timestamp);
        if (!state.scanning) {
            state.scanning = true;
            console.log(`[监听器] 标记 APK ${timestamp} 为扫描中`);
        }
    }

    /**
     * 批量添加敏感信息项到渲染队列（不再添加到allItems，因为全局监听器已添加）
     * @param {string} timestamp - APK时间戳
     * @param {Object} item - 敏感信息项
     */
    function appendSensitiveItemBatched(timestamp, item) {
        // 注意：item 已经在全局监听器中添加到 state.allItems 了，这里只处理渲染

        // 检查当前是否显示该APK
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();
        if (selectedApkIndex >= 0 && String(apkListData[selectedApkIndex].timestamp) === String(timestamp)) {
            pendingItems.push(item);

            // 累积10条或500ms后批量渲染
            if (pendingItems.length >= BATCH_SIZE) {
                flushPendingItems(timestamp);
            } else if (!renderTimer) {
                renderTimer = setTimeout(() => {
                    flushPendingItems(timestamp);
                }, BATCH_DELAY);
            }
        }
    }

    /**
     * 批量渲染待处理的敏感信息项
     * @param {string} timestamp - APK时间戳
     */
    function flushPendingItems(timestamp) {
        if (pendingItems.length === 0) return;

        // 检查当前是否还显示该APK
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();
        if (selectedApkIndex < 0 || apkListData[selectedApkIndex].timestamp !== timestamp) {
            pendingItems = [];
            renderTimer = null;
            return;
        }

        // 使用DocumentFragment批量插入DOM
        const fragment = document.createDocumentFragment();
        pendingItems.forEach(item => {
            const element = createSensitiveListItemElement(item);
            fragment.appendChild(element);
        });

        // 清空placeholder（如果有）
        const placeholder = sensitiveList.querySelector('.sensitive-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        sensitiveList.appendChild(fragment);
        pendingItems = [];
        renderTimer = null;

        // 更新计数
        const state = getSensitiveState(timestamp);
        if (sensitiveStats) {
            const statsHtml = `共发现 <span class="stats-total">${state.allItems.length}</span> 条敏感信息`;
            sensitiveStats.innerHTML = statsHtml;
        }
    }

    /**
     * 更新扫描进度
     * @param {string} timestamp - APK时间戳
     * @param {number} processed - 已处理文件数
     * @param {number} total - 总文件数
     */
    function updateScanProgress(timestamp, processed, total) {
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();
        if (selectedApkIndex >= 0 && apkListData[selectedApkIndex].timestamp === timestamp) {
            const percentage = Math.round((processed / total) * 100);
            if (sensitiveStats) {
                sensitiveStats.innerHTML = `扫描中... ${processed}/${total} (${percentage}%)`;
            }
        }
    }

    /**
     * 标记扫描完成
     * @param {string} timestamp - APK时间戳
     * @param {number} total - 总结果数
     * @param {Object} stats - 统计信息
     */
    function markScanComplete(timestamp, total, stats) {
        const state = getSensitiveState(timestamp);
        state.scanning = false;
        state.hasScanned = true;
        state.stats = stats;

        // 刷新剩余待渲染项
        flushPendingItems(timestamp);

        // 检查当前是否显示该APK
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();
        if (selectedApkIndex >= 0 && apkListData[selectedApkIndex].timestamp === timestamp) {
            toast.show({
                text: `扫描完成，共发现 ${total} 条敏感信息`,
                color: 'success',
                duration: 3000
            });

            if (stats) {
                renderSensitiveStats(stats);
            }

            // 显示重新扫描按钮
            if (sensitiveRescanBtn) {
                sensitiveRescanBtn.style.display = 'inline-block';
            }
        }
    }

    /**
     * 创建敏感信息列表项元素
     * @param {Object} item - 敏感信息项
     * @returns {HTMLElement}
     */
    function createSensitiveListItemElement(item) {
        const div = document.createElement('div');
        div.className = 'sensitive-item';
        div.dataset.id = item.id;

        const categoryName = categoryNames[item.category] || item.category;
        const contentPreview = item.content.length > 80 ?
            item.content.substring(0, 80) + '...' : item.content;

        div.innerHTML = `
            <div class="sensitive-item-header">
                <span class="sensitive-item-category">[${escapeHtml(categoryName)}]</span>
                <span class="sensitive-item-file">${escapeHtml(item.file_path)}</span>
            </div>
            <div class="sensitive-item-content">${escapeHtml(contentPreview)}</div>
            <div class="sensitive-item-location">行 ${item.line_number}, 列 ${item.column_start}-${item.column_end}</div>
        `;

        div.addEventListener('click', () => {
            selectSensitiveItem(item);
        });

        return div;
    }

    /**
     * 选中敏感信息项并显示源代码
     * @param {Object} item - 敏感信息项
     */
    async function selectSensitiveItem(item) {
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();

        if (selectedApkIndex < 0) return;

        const apk = apkListData[selectedApkIndex];
        const state = getSensitiveState(apk.timestamp);

        // 更新选中状态
        state.selectedId = item.id;

        // 移除所有项的选中状态
        sensitiveList.querySelectorAll('.sensitive-item').forEach(el => {
            el.classList.remove('selected');
        });

        // 添加当前项的选中状态
        const currentItem = sensitiveList.querySelector(`[data-id="${item.id}"]`);
        if (currentItem) {
            currentItem.classList.add('selected');
        }

        // 加载代码预览
        await loadSensitiveCodePreview(item.file_path, item.line_number, item.content);
    }

    /**
     * 执行敏感信息扫描（重写为使用流式API）
     * @param {boolean} forceRescan - 是否强制重新扫描
     */
    async function performSensitiveScan(forceRescan) {
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();

        if (selectedApkIndex < 0) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const apk = apkListData[selectedApkIndex];
        if (!apk) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const state = getSensitiveState(apk.timestamp);
        if (state.scanning) {
            toast.show({ text: '该APK正在扫描中，请稍候', color: 'warning', duration: 2000 });
            return;
        }

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
        const scanTimestamp = apk.timestamp;

        // 如果是强制重新扫描，先删除缓存文件并重置状态
        if (forceRescan) {
            try {
                const cachePath = `${apkDir}/sensitive.json`;
                await invoke('delete_file', { filename: cachePath });
                console.log('已删除敏感信息缓存文件');

                // 重置状态
                state.allItems = [];
                state.hasScanned = false;
                state.stats = null;
                pendingItems = [];
                if (renderTimer) {
                    clearTimeout(renderTimer);
                    renderTimer = null;
                }
            } catch (error) {
                console.log('删除缓存文件失败或文件不存在:', error);
            }
        }

        // 设置扫描状态并清空UI
        state.scanning = true;
        sensitiveList.innerHTML = '<div class="sensitive-placeholder">扫描中，请稍候...</div>';
        sensitiveStats.innerHTML = '准备扫描...';
        sensitivePagination.innerHTML = '';

        // 清空右侧代码预览区
        sensitiveCodePath.textContent = '';
        sensitiveCodeContent.innerHTML = '<div class="sensitive-placeholder">选择左侧敏感信息查看代码位置</div>';

        if (sensitiveRescanBtn) {
            sensitiveRescanBtn.style.display = 'none';
        }

        // 提示扫描开始
        toast.show({
            text: '开始扫描敏感信息...',
            color: 'info',
            duration: 2000
        });

        try {
            // 调用扫描API
            const result = await invoke('scan_sensitive_info_streaming', { apkDir });

            if (!result.success) {
                const currentState = getSensitiveState(scanTimestamp);
                currentState.scanning = false;

                const currentSelectedIndex = getSelectedApkIndex();
                const currentApkListData = getApkListData();
                if (currentSelectedIndex >= 0 && currentApkListData[currentSelectedIndex].timestamp === scanTimestamp) {
                    sensitiveList.innerHTML = `<div class="sensitive-placeholder">${result.message}</div>`;
                }
                return;
            }

            // 扫描成功完成，处理结果
            console.log('[扫描完成] 收到后端返回结果:', result.data);

            const currentState = getSensitiveState(scanTimestamp);
            currentState.scanning = false;
            currentState.hasScanned = true;
            currentState.allItems = result.data.items || [];
            currentState.stats = result.data.stats || {};

            // 检查当前是否还在显示同一个APK
            const currentSelectedIndex = getSelectedApkIndex();
            const currentApkListData = getApkListData();
            if (currentSelectedIndex >= 0 && String(currentApkListData[currentSelectedIndex].timestamp) === String(scanTimestamp)) {
                // 显示成功提示
                toast.show({
                    text: `扫描完成，共发现 ${result.data.total} 条敏感信息`,
                    color: 'success',
                    duration: 3000
                });

                // 渲染统计信息
                if (currentState.stats) {
                    renderSensitiveStats(currentState.stats);
                }

                // 使用分页渲染结果
                loadSensitivePage();

                // 显示重新扫描按钮
                if (sensitiveRescanBtn) {
                    sensitiveRescanBtn.style.display = 'inline-block';
                }
            }

        } catch (error) {
            console.error('扫描敏感信息失败:', error);

            const currentState = getSensitiveState(scanTimestamp);
            currentState.scanning = false;

            const currentSelectedIndex = getSelectedApkIndex();
            const currentApkListData = getApkListData();
            if (currentSelectedIndex >= 0 && currentApkListData[currentSelectedIndex].timestamp === scanTimestamp) {
                sensitiveList.innerHTML = `<div class="sensitive-placeholder">扫描失败: ${error}</div>`;
                if (sensitiveRescanBtn) {
                    sensitiveRescanBtn.style.display = 'inline-block';
                }
            }
        }
    }

    /**
     * 渲染统计信息
     * @param {Object} stats - 统计数据对象
     */
    function renderSensitiveStats(stats) {
        if (!stats || Object.keys(stats).length === 0) {
            sensitiveStats.innerHTML = '';
            return;
        }

        let html = '';
        const order = ['ip', 'url', 'hae', 'private_key', 'api_key', 'oauth', 'cloud', 'service_account', 'payment', 'platform', 'other'];

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

    /**
     * 加载敏感信息分页数据
     */
    async function loadSensitivePage() {
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();

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

    /**
     * 渲染敏感信息列表
     * @param {Array} items - 敏感信息项数组
     * @param {string} timestamp - APK时间戳
     */
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
                const currentSelectedIndex = getSelectedApkIndex();
                const currentApkListData = getApkListData();
                if (currentSelectedIndex >= 0) {
                    const currentState = getSensitiveState(currentApkListData[currentSelectedIndex].timestamp);
                    currentState.selectedId = id;
                }

                // 加载代码预览
                loadSensitiveCodePreview(filePath, lineNumber, content);
            });
        });
    }

    /**
     * 渲染分页控件
     * @param {number} currentPage - 当前页码
     * @param {number} totalPages - 总页数
     * @param {number} total - 总条数
     * @param {string} timestamp - APK时间戳
     */
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

    /**
     * 加载代码预览
     * @param {string} filePath - 文件路径
     * @param {number} lineNumber - 行号
     * @param {string} sensitiveContent - 敏感内容
     */
    async function loadSensitiveCodePreview(filePath, lineNumber, sensitiveContent) {
        sensitiveCodePath.textContent = filePath;
        sensitiveCodeContent.innerHTML = '<div class="sensitive-loading"><div class="spinner"></div><span>加载中...</span></div>';

        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();
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

    /**
     * 渲染代码预览（带高亮）
     * @param {string} content - 文件内容
     * @param {string} extension - 文件扩展名
     * @param {number} highlightLine - 高亮行号
     * @param {string} sensitiveContent - 敏感内容
     */
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

            // 高亮敏感内容（在已经语法高亮的HTML中匹配）
            if (index + 1 === highlightLine && sensitiveContent) {
                // 先设置HTML，然后在文本内容中查找并高亮
                tdContent.innerHTML = line;

                // 使用 TreeWalker 遍历所有文本节点
                const walker = document.createTreeWalker(
                    tdContent,
                    NodeFilter.SHOW_TEXT,
                    null
                );

                const textNodes = [];
                let node;
                while (node = walker.nextNode()) {
                    textNodes.push(node);
                }

                // 在文本节点中查找并替换敏感内容
                textNodes.forEach(textNode => {
                    const text = textNode.textContent;
                    if (text.includes(sensitiveContent)) {
                        const span = document.createElement('span');
                        const parts = text.split(sensitiveContent);

                        parts.forEach((part, i) => {
                            if (i > 0) {
                                const highlight = document.createElement('span');
                                highlight.className = 'sensitive-highlight';
                                highlight.textContent = sensitiveContent;
                                span.appendChild(highlight);
                            }
                            if (part) {
                                span.appendChild(document.createTextNode(part));
                            }
                        });

                        textNode.parentNode.replaceChild(span, textNode);
                    }
                });
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

    /**
     * 检查并加载敏感信息缓存
     */
    async function checkAndLoadSensitiveCache() {
        const selectedApkIndex = getSelectedApkIndex();
        const apkListData = getApkListData();

        if (selectedApkIndex < 0) return;

        const apk = apkListData[selectedApkIndex];
        if (!apk.isDecompiled) return;

        const state = getSensitiveState(apk.timestamp);
        if (state.hasScanned) return; // 已扫描，不重复加载

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
        const cachePath = `${apkDir}/sensitive.json`;

        try {
            // 检查缓存文件是否存在
            const fileExists = await invoke('file_exists', { filename: cachePath });

            if (!fileExists) {
                // 缓存不存在，标记为扫描状态，启动轮询
                console.log('[缓存检查] 缓存不存在，启动轮询等待后台扫描');
                state.scanning = true;

                // 更新UI状态为扫描中
                sensitiveList.innerHTML = '<div class="sensitive-placeholder">扫描中，请稍候...</div>';
                sensitiveStats.innerHTML = '扫描中...';

                // 启动轮询检查缓存
                startPollingForCache(apk.timestamp, cachePath);
                return;
            }

            // 读取缓存文件
            const cacheContent = await invoke('read_file', { filename: cachePath });
            const cachedData = JSON.parse(cacheContent);

            if (cachedData && cachedData.items) {
                // 加载缓存数据到状态
                state.scanning = false;
                state.hasScanned = true;
                state.allItems = cachedData.items;
                state.stats = cachedData.stats;

                // 检查当前是否还显示该APK
                const currentSelectedIndex = getSelectedApkIndex();
                const currentApkListData = getApkListData();
                if (currentSelectedIndex >= 0 && String(currentApkListData[currentSelectedIndex].timestamp) === String(apk.timestamp)) {
                    // 渲染统计信息
                    if (cachedData.stats) {
                        renderSensitiveStats(cachedData.stats);
                    }

                    // 使用分页渲染
                    loadSensitivePage();

                    // 显示重新扫描按钮
                    if (sensitiveRescanBtn) {
                        sensitiveRescanBtn.style.display = 'inline-block';
                    }

                    console.log(`[缓存检查] 已加载缓存，共 ${cachedData.items.length} 条敏感信息`);
                }
            }
        } catch (error) {
            // 缓存加载失败，启动轮询
            console.log('[缓存检查] 缓存加载失败，启动轮询:', error);
            state.scanning = true;

            sensitiveList.innerHTML = '<div class="sensitive-placeholder">扫描中，请稍候...</div>';
            sensitiveStats.innerHTML = '扫描中...';

            startPollingForCache(apk.timestamp, cachePath);
        }
    }

    // 轮询定时器
    let pollingTimer = null;
    let pollingTimestamp = null;

    /**
     * 启动轮询检查缓存文件
     * @param {string} timestamp - APK时间戳
     * @param {string} cachePath - 缓存文件路径
     */
    function startPollingForCache(timestamp, cachePath) {
        // 如果已经在轮询同一个APK，不重复启动
        if (pollingTimer && pollingTimestamp === timestamp) {
            return;
        }

        // 清除之前的轮询
        if (pollingTimer) {
            clearInterval(pollingTimer);
        }

        pollingTimestamp = timestamp;
        let pollCount = 0;
        const maxPolls = 120; // 最多轮询2分钟（每秒1次）

        console.log(`[轮询] 开始轮询缓存文件: ${cachePath}`);

        pollingTimer = setInterval(async () => {
            pollCount++;

            // 检查是否还在显示同一个APK
            const selectedApkIndex = getSelectedApkIndex();
            const apkListData = getApkListData();
            if (selectedApkIndex < 0 || String(apkListData[selectedApkIndex].timestamp) !== String(timestamp)) {
                console.log('[轮询] APK已切换，停止轮询');
                clearInterval(pollingTimer);
                pollingTimer = null;
                pollingTimestamp = null;
                return;
            }

            try {
                const fileExists = await invoke('file_exists', { filename: cachePath });

                if (fileExists) {
                    console.log(`[轮询] 发现缓存文件，尝试加载`);
                    clearInterval(pollingTimer);
                    pollingTimer = null;
                    pollingTimestamp = null;

                    // 加载缓存
                    const cacheContent = await invoke('read_file', { filename: cachePath });
                    const cachedData = JSON.parse(cacheContent);

                    if (cachedData && cachedData.items) {
                        const state = getSensitiveState(timestamp);
                        state.scanning = false;
                        state.hasScanned = true;
                        state.allItems = cachedData.items;
                        state.stats = cachedData.stats;

                        // 再次检查是否还在显示同一个APK
                        const currentSelectedIndex = getSelectedApkIndex();
                        const currentApkListData = getApkListData();
                        if (currentSelectedIndex >= 0 && String(currentApkListData[currentSelectedIndex].timestamp) === String(timestamp)) {
                            // 检查是否在敏感信息tab
                            const sensitiveTab = document.querySelector('[data-tab="sensitive"]');
                            if (sensitiveTab && sensitiveTab.classList.contains('active')) {
                                if (cachedData.stats) {
                                    renderSensitiveStats(cachedData.stats);
                                }

                                // 使用分页渲染
                                loadSensitivePage();

                                if (sensitiveRescanBtn) {
                                    sensitiveRescanBtn.style.display = 'inline-block';
                                }

                                toast.show({
                                    text: `扫描完成，共发现 ${cachedData.items.length} 条敏感信息`,
                                    color: 'success',
                                    duration: 3000
                                });
                            }
                        }

                        console.log(`[轮询] 缓存加载成功，共 ${cachedData.items.length} 条`);
                    }
                }
            } catch (error) {
                // 忽略错误，继续轮询
            }

            // 超过最大轮询次数，停止
            if (pollCount >= maxPolls) {
                console.log('[轮询] 超时，停止轮询');
                clearInterval(pollingTimer);
                pollingTimer = null;
                pollingTimestamp = null;

                const state = getSensitiveState(timestamp);
                state.scanning = false;

                sensitiveList.innerHTML = '<div class="sensitive-placeholder">扫描超时，请点击重新扫描</div>';
                if (sensitiveRescanBtn) {
                    sensitiveRescanBtn.style.display = 'inline-block';
                }
            }
        }, 1000); // 每秒检查一次
    }

    /**
     * 停止轮询
     */
    function stopPolling() {
        if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
            pollingTimestamp = null;
        }
    }

    /**
     * 处理敏感信息面板拖拽调整大小
     * @param {MouseEvent} e - 鼠标事件
     */
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

    /**
     * 停止敏感信息面板拖拽调整
     */
    function stopSensitiveResize() {
        isResizingSensitive = false;
        if (sensitiveResizer) {
            sensitiveResizer.classList.remove('active');
        }
        document.removeEventListener('mousemove', handleSensitiveResize);
        document.removeEventListener('mouseup', stopSensitiveResize);
    }

    /**
     * 刷新UI（对外暴露的主入口）
     */
    function refresh() {
        refreshSensitiveUI();
    }

    /**
     * 获取分类名称映射
     * @returns {Object} 分类名称映射对象
     */
    function getCategoryNames() {
        return categoryNames;
    }

    /**
     * 获取敏感信息状态Map
     * @returns {Map} 敏感信息状态Map
     */
    function getStateMap() {
        return sensitiveStateMap;
    }

    /**
     * 清理所有事件监听器
     */
    async function cleanupAllListeners() {
        console.log('清理所有敏感信息事件监听器');
        for (const [timestamp, state] of sensitiveStateMap.entries()) {
            if (state.eventUnlisteners && state.eventUnlisteners.length > 0) {
                console.log(`清理 APK ${timestamp} 的 ${state.eventUnlisteners.length} 个监听器`);
                for (const unlisten of state.eventUnlisteners) {
                    try {
                        await unlisten();
                    } catch (error) {
                        console.warn('清除监听器失败:', error);
                    }
                }
                state.eventUnlisteners = [];
            }
        }
    }

    /**
     * 清理指定APK的事件监听器
     * @param {string} timestamp - APK时间戳
     */
    async function cleanupListenersForApk(timestamp) {
        const state = getSensitiveState(timestamp);
        if (state.eventUnlisteners && state.eventUnlisteners.length > 0) {
            console.log(`清理 APK ${timestamp} 的 ${state.eventUnlisteners.length} 个监听器`);
            for (const unlisten of state.eventUnlisteners) {
                try {
                    await unlisten();
                } catch (error) {
                    console.warn('清除监听器失败:', error);
                }
            }
            state.eventUnlisteners = [];
        }
    }

    // 页面卸载时清理所有监听器
    window.addEventListener('beforeunload', () => {
        cleanupAllListeners().catch(err => {
            console.error('清理监听器失败:', err);
        });
    });

    // 暴露模块接口
    window.SensitiveModule = {
        init,
        refresh,
        refreshSensitiveUI,
        performSensitiveScan,
        renderSensitiveStats,
        loadSensitivePage,
        renderSensitiveList,
        renderSensitivePagination,
        loadSensitiveCodePreview,
        renderSensitiveCode,
        checkAndLoadSensitiveCache,
        getSensitiveState,
        getCategoryNames,
        getStateMap,
        cleanupAllListeners,
        cleanupListenersForApk
    };

})();
