/**
 * Services Module - 第三方服务模块
 * 负责第三方服务分析的加载和渲染
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
     * 加载第三方服务分析
     * @param {Object} apk - APK对象
     */
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

    /**
     * 渲染第三方服务
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
     * 构建服务分类区块
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
        buildServiceSection
    };

})();
