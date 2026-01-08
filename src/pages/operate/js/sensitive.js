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
    let sensitiveScanBtn = null;
    let sensitiveRescanBtn = null;
    let sensitiveStats = null;
    let sensitiveList = null;
    let sensitivePagination = null;
    let sensitiveCodePath = null;
    let sensitiveCodeContent = null;
    let sensitiveResizer = null;
    let sensitiveLeft = null;

    // 每个APK独立的敏感信息状态管理
    // key: apk.timestamp, value: { scanning, hasScanned, currentPage, totalPages, selectedId, stats }
    const sensitiveStateMap = new Map();

    // 分类名称映射
    const categoryNames = {
        'url': 'URL',
        'ip': 'IP地址',
        'access_key': 'AccessKey',
        'number': '纯数字'
    };

    // 拖拽状态
    let isResizingSensitive = false;

    /**
     * 获取当前APK的敏感信息状态
     * @param {string} timestamp - APK的时间戳标识
     * @returns {Object} 敏感信息状态对象
     */
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
        sensitiveScanBtn = document.getElementById('sensitive-scan-btn');
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

        console.log('SensitiveModule 初始化完成');
    }

    /**
     * 绑定事件监听器
     */
    function bindEvents() {
        // 扫描按钮点击
        if (sensitiveScanBtn) {
            sensitiveScanBtn.addEventListener('click', async () => {
                await performSensitiveScan(false);
            });
        }

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

    /**
     * 执行敏感信息扫描
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
                const currentSelectedIndex = getSelectedApkIndex();
                const currentApkListData = getApkListData();
                if (currentSelectedIndex >= 0 && currentApkListData[currentSelectedIndex].timestamp === scanTimestamp) {
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
            const currentSelectedIndex = getSelectedApkIndex();
            const currentApkListData = getApkListData();
            if (currentSelectedIndex >= 0 && currentApkListData[currentSelectedIndex].timestamp === scanTimestamp) {
                refreshSensitiveUI();
            }

        } catch (error) {
            clearTimeout(scanTimeout);
            console.error('扫描敏感信息失败:', error);

            const currentState = getSensitiveState(scanTimestamp);
            currentState.scanning = false;

            // 如果当前显示的还是这个APK，更新UI
            const currentSelectedIndex = getSelectedApkIndex();
            const currentApkListData = getApkListData();
            if (currentSelectedIndex >= 0 && currentApkListData[currentSelectedIndex].timestamp === scanTimestamp) {
                sensitiveList.innerHTML = `<div class="sensitive-placeholder">扫描失败: ${error}</div>`;
                sensitiveScanBtn.disabled = false;
                sensitiveScanBtn.textContent = '扫描';
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
        getStateMap
    };

})();
