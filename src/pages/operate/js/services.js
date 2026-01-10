/**
 * Services Module - 第三方服务模块
 * 负责第三方服务分析的加载和渲染
 * 支持两种模式：快速分析（直接解析APK）和深度分析（依赖jadx反编译）
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

    /**
     * 初始化模块
     * @param {Object} deps - 依赖对象
     * @param {Function} deps.invoke - Tauri invoke函数
     * @param {string} deps.caseNumber - 案件编号
     * @param {Function} deps.toast - Toast提示函数
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

        console.log('ServicesModule 初始化完成');
    }

    /**
     * 加载第三方服务分析（对外暴露的主入口）
     * @param {Object} apk - APK对象
     */
    async function load(apk) {
        return loadThirdPartyServices(apk);
    }

    /**
     * 从缓存文件加载分析结果
     * @param {string} apkDir - APK目录
     * @returns {Object|null} 缓存的分析结果，如果不存在返回null
     */
    async function loadCachedAnalysis(apkDir) {
        try {
            const cacheFile = `${apkDir}/services_cache.json`;
            const content = await invoke('read_file', { filename: cacheFile });
            if (content) {
                const data = JSON.parse(content);
                console.log('从缓存加载第三方服务分析结果');
                return data;
            }
        } catch (error) {
            console.log('缓存文件不存在或读取失败:', error);
        }
        return null;
    }

    /**
     * 保存分析结果到缓存文件
     * @param {string} apkDir - APK目录
     * @param {Object} data - 分析结果数据
     */
    async function saveCachedAnalysis(apkDir, data) {
        try {
            const cacheFile = `${apkDir}/services_cache.json`;
            const content = JSON.stringify(data, null, 2);
            await invoke('write_file', {
                filename: cacheFile,
                content: content
            });
            console.log('分析结果已保存到缓存');
        } catch (error) {
            console.error('保存缓存失败:', error);
        }
    }

    /**
     * 加载第三方服务分析
     * 优先从缓存读取，如果没有则进行分析并保存
     * @param {Object} apk - APK对象
     */
    async function loadThirdPartyServices(apk) {
        const servicesPanel = document.getElementById('tab-services');

        if (!apk) {
            servicesPanel.innerHTML = '<div class="operation-panel-placeholder">上传一个apk开始分析</div>';
            return;
        }

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        // 尝试从缓存加载
        const cachedData = await loadCachedAnalysis(apkDir);
        if (cachedData) {
            renderQuickAnalysisResult(cachedData, apk.isDecompiled, true);
            // 自动加载安全检测数据
            await loadDetectionFromCache(apk);
            return;
        }

        // 显示加载状态
        servicesPanel.innerHTML = '<div class="services-loading"><div class="spinner"></div><span>正在分析第三方服务...</span></div>';

        try {
            // 优先使用快速分析API
            const quickResult = await invoke('quick_analyze_apk', { apkDir: apkDir });

            if (quickResult.success) {
                // 保存到缓存
                await saveCachedAnalysis(apkDir, quickResult);
                renderQuickAnalysisResult(quickResult, apk.isDecompiled, false);
                // 自动扫描安全检测
                await autoScanDetectionPatterns(apk);
                return;
            }
        } catch (error) {
            console.log('快速分析失败，尝试深度分析:', error);
        }

        // 回退到原来的深度分析（需要jadx反编译）
        if (!apk.isDecompiled) {
            servicesPanel.innerHTML = '<div class="operation-panel-placeholder">APK正在反编译中，请稍候...</div>';
            return;
        }

        try {
            const result = await invoke('analyze_third_party_services', { apkDir: apkDir });

            if (!result.success) {
                servicesPanel.innerHTML = `<div class="operation-panel-placeholder">${result.message}</div>`;
                return;
            }

            // 保存到缓存
            await saveCachedAnalysis(apkDir, result);
            renderThirdPartyServices(result);
        } catch (error) {
            console.error('分析第三方服务失败:', error);
            servicesPanel.innerHTML = `<div class="operation-panel-placeholder">分析第三方服务失败: ${error}</div>`;
        }
    }

    /**
     * 渲染快速分析结果
     * @param {Object} data - 快速分析结果
     * @param {boolean} isDecompiled - 是否已反编译
     * @param {boolean} fromCache - 是否从缓存加载
     */
    function renderQuickAnalysisResult(data, isDecompiled, fromCache = false) {
        const servicesPanel = document.getElementById('tab-services');
        const { packers, sdks, soFiles, fileCount } = data;

        // 统计信息（独占一行，顶部）
        const statsHtml = `
            <div class="services-stats">
                <div class="services-stat-item">
                    <span class="stat-label">APK文件总数</span>
                    <span class="stat-value">${fileCount}</span>
                </div>
                <div class="services-stat-item">
                    <span class="stat-label">.so文件数量</span>
                    <span class="stat-value">${soFiles ? soFiles.length : 0}</span>
                </div>
                <div class="services-stat-item">
                    <span class="stat-label">检测到打包商</span>
                    <span class="stat-value">${packers ? packers.length : 0}</span>
                </div>
                <div class="services-stat-item">
                    <span class="stat-label">识别SDK</span>
                    <span class="stat-value">${sdks ? sdks.length : 0}</span>
                </div>
            </div>
        `;

        // 构建各部分HTML（这些会在网格中显示）
        const sectionsHtml = [];

        // 打包服务商（加固检测）
        sectionsHtml.push(buildPackerSection('打包服务商', packers));

        // SDK服务商（基于.so文件）
        sectionsHtml.push(buildSdkSection('SDK服务商', sdks));

        // 安全检测区块（占位）
        sectionsHtml.push(buildDetectionPlaceholder());

        servicesPanel.innerHTML = `
            <div class="services-container">
                ${statsHtml}
                <div class="services-grid">
                    ${sectionsHtml.join('')}
                </div>
            </div>
        `;

        // 如果不是从缓存加载，则占位符会显示"正在扫描..."
        // 如果是从缓存加载，占位符会显示等待加载检测结果
    }

    /**
     * 构建打包服务商区块
     * @param {string} title - 区块标题
     * @param {Array} packers - 打包服务商列表
     * @returns {string} HTML字符串
     */
    function buildPackerSection(title, packers) {
        const isEmpty = !packers || packers.length === 0;

        let itemsHtml = '';
        if (isEmpty) {
            itemsHtml = '<div class="services-empty">未检测到加固/打包</div>';
        } else {
            for (const packer of packers) {
                const matchedFilesHtml = packer.matched_files.map(f =>
                    `<div class="matched-file" title="${escapeHtml(f)}">${escapeHtml(f)}</div>`
                ).join('');

                itemsHtml += `
                    <div class="service-item packer-item">
                        <div class="service-header">
                            <span class="service-name">${escapeHtml(packer.name)}</span>
                            <span class="service-badge packer">加固</span>
                        </div>
                        <div class="service-matched-files">
                            ${matchedFilesHtml}
                        </div>
                    </div>
                `;
            }
        }

        return `
            <div class="services-section" data-type="packers">
                <div class="services-section-header">
                    <span class="services-section-title">${title}</span>
                    <span class="services-section-count">${packers ? packers.length : 0}</span>
                </div>
                <div class="services-section-content">
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    /**
     * 构建SDK服务商区块
     * @param {string} title - 区块标题
     * @param {Array} sdks - SDK服务商列表
     * @returns {string} HTML字符串
     */
    function buildSdkSection(title, sdks) {
        const isEmpty = !sdks || sdks.length === 0;

        let itemsHtml = '';
        if (isEmpty) {
            itemsHtml = '<div class="services-empty">未检测到第三方SDK</div>';
        } else {
            // 按team分组
            const groupedSdks = {};
            for (const sdk of sdks) {
                const team = sdk.team || '其他';
                if (!groupedSdks[team]) {
                    groupedSdks[team] = [];
                }
                groupedSdks[team].push(sdk);
            }

            for (const [team, teamSdks] of Object.entries(groupedSdks)) {
                itemsHtml += `<div class="services-group">`;
                itemsHtml += `<div class="services-group-title">${escapeHtml(team)}</div>`;
                itemsHtml += `<div class="services-group-items">`;
                for (const sdk of teamSdks) {
                    itemsHtml += `
                        <div class="service-item sdk-item">
                            <span class="service-name">${escapeHtml(sdk.label)}</span>
                            <span class="service-so" title="${escapeHtml(sdk.matched_so)}">${escapeHtml(sdk.matched_so.split('/').pop())}</span>
                        </div>
                    `;
                }
                itemsHtml += `</div></div>`;
            }
        }

        return `
            <div class="services-section" data-type="sdks">
                <div class="services-section-header">
                    <span class="services-section-title">${title}</span>
                    <span class="services-section-count">${sdks ? sdks.length : 0}</span>
                </div>
                <div class="services-section-content">
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    /**
     * 构建检测模式占位区块
     * @returns {string} HTML字符串
     */
    function buildDetectionPlaceholder() {
        return `
            <div class="services-section detection-section" data-type="detection">
                <div class="services-section-header">
                    <span class="services-section-title">安全检测</span>
                </div>
                <div class="services-section-content" id="detection-content">
                    <div class="services-loading">
                        <div class="spinner"></div>
                        <span>正在扫描安全检测...</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 自动扫描检测模式（新数据时）
     * @param {Object} apk - APK对象
     */
    async function autoScanDetectionPatterns(apk) {
        const detectionContent = document.getElementById('detection-content');
        if (!detectionContent) return;

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('analyze_detection_patterns', { apkDir: apkDir });

            if (!result.success) {
                detectionContent.innerHTML = `<div class="services-empty">${result.message || '扫描失败'}</div>`;
                return;
            }

            // 保存检测结果到缓存
            await saveDetectionCache(apkDir, result);
            renderDetectionPatterns(result);
        } catch (error) {
            console.error('扫描检测模式失败:', error);
            detectionContent.innerHTML = `<div class="services-empty">扫描失败: ${error}</div>`;
        }
    }

    /**
     * 从缓存加载检测结果
     * @param {Object} apk - APK对象
     */
    async function loadDetectionFromCache(apk) {
        const detectionContent = document.getElementById('detection-content');
        if (!detectionContent) return;

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const cacheFile = `${apkDir}/detection_cache.json`;
            const content = await invoke('read_file', { filename: cacheFile });

            if (content) {
                const data = JSON.parse(content);
                console.log('从缓存加载安全检测结果');
                renderDetectionPatterns(data);
            } else {
                // 如果缓存不存在，自动扫描
                await autoScanDetectionPatterns(apk);
            }
        } catch (error) {
            console.log('检测缓存不存在，开始扫描:', error);
            await autoScanDetectionPatterns(apk);
        }
    }

    /**
     * 保存检测结果到缓存
     * @param {string} apkDir - APK目录
     * @param {Object} data - 检测结果数据
     */
    async function saveDetectionCache(apkDir, data) {
        try {
            const cacheFile = `${apkDir}/detection_cache.json`;
            const content = JSON.stringify(data, null, 2);
            await invoke('write_file', {
                filename: cacheFile,
                content: content
            });
            console.log('检测结果已保存到缓存');
        } catch (error) {
            console.error('保存检测缓存失败:', error);
        }
    }

    /**
     * 渲染检测模式结果
     * @param {Object} result - 检测结果
     */
    function renderDetectionPatterns(result) {
        const detectionContent = document.getElementById('detection-content');
        if (!detectionContent) return;

        const { rootFile, rootApp, emulator, debug, proxy, summary } = result;

        const categories = [
            { key: 'rootFile', name: 'Root文件检测', data: rootFile, count: summary.rootFileCount },
            { key: 'rootApp', name: 'Root应用检测', data: rootApp, count: summary.rootAppCount },
            { key: 'emulator', name: '模拟器检测', data: emulator, count: summary.emulatorCount },
            { key: 'debug', name: '调试/Hook检测', data: debug, count: summary.debugCount },
            { key: 'proxy', name: '代理/VPN检测', data: proxy, count: summary.proxyCount }
        ];

        let html = '<div class="detection-results">';

        for (const category of categories) {
            const isEmpty = !category.data || category.data.length === 0;
            const statusClass = isEmpty ? 'empty' : 'found';
            const statusIcon = isEmpty ? '✓' : '⚠';

            html += `
                <div class="detection-category ${statusClass}">
                    <div class="detection-category-header">
                        <span class="detection-status-icon">${statusIcon}</span>
                        <span class="detection-category-name">${category.name}</span>
                        <span class="detection-category-count">${category.count}</span>
                    </div>
            `;

            if (!isEmpty) {
                html += '<div class="detection-category-items">';
                for (const item of category.data) {
                    html += `
                        <div class="detection-item">
                            <div class="detection-item-header">
                                <span class="detection-pattern">${escapeHtml(item.pattern)}</span>
                            </div>
                            <div class="detection-item-desc">${escapeHtml(item.description)}</div>
                        </div>
                    `;
                }
                html += '</div>';
            }

            html += '</div>';
        }

        html += '</div>';

        detectionContent.innerHTML = html;
    }

    /**
     * 渲染第三方服务（原深度分析模式）
     * @param {Object} data - 第三方服务分析结果
     */
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

    /**
     * 构建服务分类区块（原深度分析模式使用）
     * @param {string} title - 区块标题
     * @param {Array} items - 服务项目列表
     * @param {string} type - 区块类型
     * @param {number} count - 服务数量
     * @param {boolean} showEvidence - 是否显示证据信息
     * @returns {string} HTML字符串
     */
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

    // 暴露模块接口
    window.ServicesModule = {
        init,
        load,
        loadThirdPartyServices,
        renderThirdPartyServices,
        buildServiceSection,
        renderDetectionPatterns,
        autoScanDetectionPatterns,
        loadDetectionFromCache
    };

})();
