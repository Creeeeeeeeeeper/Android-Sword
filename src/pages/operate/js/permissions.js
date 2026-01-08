/**
 * Permissions Module - 权限模块
 * 负责APK权限信息的加载和渲染
 */
(function() {
    'use strict';

    // 依赖注入
    let invoke = null;
    let caseNumber = null;
    let escapeHtml = null;
    let getApkListData = null;
    let getSelectedApkIndex = null;

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

    // 权限等级显示顺序
    const levelOrder = [
        'dangerous', 'signature', 'signature|privileged', 'signature|privileged|development',
        'signature|privileged|appop', 'signature|appop', 'signature|preinstalled|knownSigner|role',
        'internal|role', 'internal|privileged', 'normal', 'normal|instant', 'normal|appop|instant', 'other'
    ];

    /**
     * 初始化模块
     * @param {Object} deps - 依赖对象
     * @param {Function} deps.invoke - Tauri invoke函数
     * @param {string} deps.caseNumber - 案件编号
     * @param {Function} deps.escapeHtml - HTML转义函数
     * @param {Function} deps.getApkListData - 获取APK列表数据的函数
     * @param {Function} deps.getSelectedApkIndex - 获取当前选中APK索引的函数
     */
    function init(deps) {
        invoke = deps.invoke;
        caseNumber = deps.caseNumber;
        escapeHtml = deps.escapeHtml;
        getApkListData = deps.getApkListData;
        getSelectedApkIndex = deps.getSelectedApkIndex;

        console.log('PermissionsModule 初始化完成');
    }

    /**
     * 加载权限信息（对外暴露的主入口）
     * @param {Object} apk - APK对象
     */
    async function load(apk) {
        return loadPermissions(apk);
    }

    /**
     * 加载APK权限
     * @param {Object} apk - APK对象
     */
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
                permissionsPanel.innerHTML = `<div class="operation-panel-placeholder">${escapeHtml(result.message)}</div>`;
                return;
            }

            renderPermissions(result.permissions, result.stats);
        } catch (error) {
            console.error('获取权限失败:', error);
            permissionsPanel.innerHTML = `<div class="operation-panel-placeholder">获取权限失败: ${escapeHtml(String(error))}</div>`;
        }
    }

    /**
     * 渲染权限列表
     * @param {Array} permissions - 权限数组
     * @param {Object} stats - 权限统计对象
     */
    function renderPermissions(permissions, stats) {
        const permissionsPanel = document.getElementById('tab-permissions');

        if (permissions.length === 0) {
            permissionsPanel.innerHTML = '<div class="operation-panel-placeholder">该APK未申请任何权限</div>';
            return;
        }

        // 构建左侧统计栏
        const levelStats = stats.levels || {};
        let statsItemsHtml = `
            <div class="stats-item-vertical">
                <span class="stats-value-large">${stats.total}</span>
                <span class="stats-label">总计</span>
            </div>
        `;

        // 按顺序显示各等级统计
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
                        <span class="permission-name">${escapeHtml(perm.name_zh)}</span>
                        <span class="permission-badge ${config.color}">${config.name}</span>
                    </div>
                    <div class="permission-description">${escapeHtml(perm.description)}</div>
                    <div class="permission-full-name">${escapeHtml(perm.permission)}</div>
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
        bindPermissionInteractions(permissionsPanel);
    }

    /**
     * 绑定权限交互事件（鼠标悬停高亮等）
     * @param {HTMLElement} permissionsPanel - 权限面板元素
     */
    function bindPermissionInteractions(permissionsPanel) {
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

    /**
     * 获取权限等级配置
     * @returns {Object} 权限等级配置对象
     */
    function getLevelConfig() {
        return levelConfig;
    }

    /**
     * 获取权限等级顺序
     * @returns {Array} 权限等级顺序数组
     */
    function getLevelOrder() {
        return levelOrder;
    }

    // 暴露模块接口
    window.PermissionsModule = {
        init,
        load,
        loadPermissions,
        renderPermissions,
        bindPermissionInteractions,
        getLevelConfig,
        getLevelOrder
    };

})();
