/**
 * Overview Module - 总览模块
 * 负责APK总览信息的加载和渲染
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

    // IP检测相关状态
    // 记录正在进行检测的APK，key为apk.timestamp，value为检测状态
    const ipCheckingMap = new Map();

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

        // 绑定重新检测按钮事件
        const rescanBtn = document.getElementById('overview-ip-rescan-btn');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', () => {
                const selectedApkIndex = getSelectedApkIndex();
                const apkListData = getApkListData();
                if (selectedApkIndex >= 0 && apkListData[selectedApkIndex]) {
                    loadOverviewIPs(apkListData[selectedApkIndex], true);
                }
            });
        }

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

        console.log('OverviewModule 初始化完成');
    }

    /**
     * 加载总览信息（对外暴露的主入口）
     * @param {Object} apk - APK对象
     */
    async function load(apk) {
        return loadOverview(apk);
    }

    /**
     * 加载总览信息
     * 支持快速模式：即使未反编译也可以显示基本信息
     * @param {Object} apk - APK对象
     */
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

        // 加载基本信息（快速模式可用）
        renderOverviewBasicInfo(apk);

        // 加载权限统计（优先使用快速分析）
        loadOverviewPermissionsQuick(apk);

        // 加载签名信息（直接从APK读取，不依赖jadx）
        loadOverviewSignature(apk);

        // IP检测（现在不依赖反编译，直接从敏感信息扫描结果读取）
        loadOverviewIPs(apk);
    }

    /**
     * 快速加载权限统计（优先使用快速分析API）
     * @param {Object} apk - APK对象
     */
    async function loadOverviewPermissionsQuick(apk) {
        const permissionsContent = document.getElementById('overview-permissions-content');
        permissionsContent.innerHTML = '<div class="overview-loading"><div class="spinner-small"></div></div>';

        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

            // 优先尝试快速分析API
            try {
                const quickResult = await invoke('get_apk_permissions_quick', { apkDir: apkDir });
                if (quickResult.success) {
                    renderOverviewPermissions(quickResult.stats);
                    return;
                }
            } catch (e) {
                console.log('快速权限分析失败，尝试标准方法:', e);
            }

            // 回退到标准API（需要jadx反编译）
            if (apk.isDecompiled) {
                const result = await invoke('get_apk_permissions', { apkDir: apkDir });
                if (result.success) {
                    renderOverviewPermissions(result.stats);
                    return;
                }
                permissionsContent.innerHTML = `<div class="overview-placeholder">${result.message}</div>`;
            } else {
                permissionsContent.innerHTML = '<div class="overview-placeholder">正在反编译中...</div>';
            }
        } catch (error) {
            console.error('获取权限统计失败:', error);
            permissionsContent.innerHTML = '<div class="overview-placeholder">获取权限统计失败</div>';
        }
    }

    /**
     * 渲染总览中的基本信息
     * @param {Object} apk - APK对象
     */
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

    /**
     * 加载总览中的权限统计
     * @param {Object} apk - APK对象
     */
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

    /**
     * 渲染总览中的权限统计
     * @param {Object} stats - 权限统计对象
     */
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

    /**
     * 加载总览中的签名信息
     * @param {Object} apk - APK对象
     */
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

    /**
     * 渲染总览中的签名信息
     * @param {Object} signature - 签名信息对象
     */
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

    /**
     * 判断是否为私有IP
     * @param {string} ip - IP地址
     * @returns {boolean}
     */
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

    /**
     * 判断是否为有效IP地址
     * @param {string} ip - IP地址
     * @returns {boolean}
     */
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

    /**
     * 加载总览中的IP检测
     * @param {Object} apk - APK对象
     * @param {boolean} forceRescan - 是否强制重新检测
     */
    async function loadOverviewIPs(apk, forceRescan = false) {
        const ipContent = document.getElementById('overview-ip-content');
        const ipStatus = document.getElementById('overview-ip-status');
        const rescanBtn = document.getElementById('overview-ip-rescan-btn');

        const apkTimestamp = apk?.timestamp;
        console.log('loadOverviewIPs 被调用, apk:', apkTimestamp, 'forceRescan:', forceRescan);

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
        const ipCacheFile = `${apkDir}/ip_check.json`;

        // 检查是否正在检测中或已完成
        const checkingState = ipCheckingMap.get(apkTimestamp);
        if (checkingState && !forceRescan) {
            // 如果检测已完成，直接渲染结果
            if (checkingState.completed) {
                console.log('IP检测 - 已完成，直接渲染结果');
                renderIPList(checkingState.resultIPs, checkingState.privateCount, checkingState.publicCount);
                ipStatus.textContent = `共 ${checkingState.privateCount + checkingState.publicCount} 个`;
                rescanBtn.style.display = 'inline-block';
                // 清理状态
                ipCheckingMap.delete(apkTimestamp);
                return;
            }

            // 如果正在检测中，显示当前进度和已检测到的IP
            console.log('IP检测 - 检测中，显示当前进度');
            ipContent.innerHTML = '<div class="overview-ip-list" id="overview-ip-list"></div>';
            const ipList = document.getElementById('overview-ip-list');

            // 渲染私有IP（如果有）
            if (checkingState.privateIPs && checkingState.privateIPs.length > 0) {
                for (const ip of checkingState.privateIPs) {
                    const ipItem = document.createElement('div');
                    ipItem.className = 'overview-ip-item private';
                    ipItem.innerHTML = `
                        <span class="overview-ip-address">${ip}</span>
                        <span class="overview-ip-tag private">内网</span>
                    `;
                    ipList.appendChild(ipItem);
                }
            }

            // 渲染已检测到的公网IP（如果有）
            if (checkingState.reachableIPs && checkingState.reachableIPs.length > 0) {
                for (const ipItem of checkingState.reachableIPs) {
                    if (ipItem.type === 'public') {
                        const ipElem = document.createElement('div');
                        ipElem.className = 'overview-ip-item public';
                        ipElem.innerHTML = `
                            <span class="overview-ip-address">${ipItem.ip}</span>
                            <span class="overview-ip-tag public">公网</span>
                        `;
                        ipList.appendChild(ipElem);
                    }
                }
            }

            ipStatus.innerHTML = `检测中 <span class="ip-progress">${checkingState.checked || 0}/${checkingState.total || 0}</span>`;
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

    /**
     * 后台IP检测任务
     * @param {Object} apk - APK对象
     * @param {string} apkDir - APK目录路径
     * @param {string} ipCacheFile - IP缓存文件路径
     * @param {boolean} forceRescan - 是否强制重新检测
     */
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
                checkState.privateIPs = privateIPs;  // 保存私有IP列表
                checkState.reachableIPs = [];  // 初始化已检测的公网IP列表
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

                        // 更新状态中的结果（无论是否在当前页面）
                        if (currentState) {
                            currentState.reachableIPs = resultIPs.filter(item => item.type === 'public');  // 保存当前已发现的公网IP
                        }

                        // 更新UI添加可达的公网IP（仅当在overview页面时）
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
                        // 只更新进度（仅当在overview页面时）
                        updateIPUIIfCurrent(apkTimestamp, () => {
                            const ipStatus = document.getElementById('overview-ip-status');
                            ipStatus.innerHTML = `检测中 <span class="ip-progress">${checkedCount}/${publicIPs.length}</span>`;
                        });
                    }
                }
            }

            // 检测完成，保存结果到缓存
            await saveIPCache(ipCacheFile, resultIPs, privateIPs.length, reachableCount);

            // 标记检测完成（保留状态信息，用于切换回来时渲染）
            const finalState = ipCheckingMap.get(apkTimestamp);
            if (finalState) {
                finalState.completed = true;
                finalState.resultIPs = resultIPs;
                finalState.privateCount = privateIPs.length;
                finalState.publicCount = reachableCount;
            }

            const totalCount = privateIPs.length + reachableCount;

            // 总是尝试更新UI（无论是否在当前页面）
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

                // 如果成功渲染了，就删除状态
                ipCheckingMap.delete(apkTimestamp);
            });

            // 如果当前不在overview页面，保留状态不删除
            // 用户切换回来时会自动渲染并删除状态

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

    /**
     * 仅当当前显示的APK与检测的APK匹配时更新UI
     * @param {string} apkTimestamp - APK时间戳
     * @param {Function} updateFn - 更新UI的函数
     */
    function updateIPUIIfCurrent(apkTimestamp, updateFn) {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();
        const currentApk = apkListData[selectedApkIndex];
        const activeTab = document.querySelector('.operation-tab.active');

        // 检查是否在总览页面且是当前APK
        if (currentApk && currentApk.timestamp === apkTimestamp && activeTab && activeTab.dataset.tab === 'overview') {
            updateFn();
        }
    }

    /**
     * 保存IP检测结果到缓存
     * @param {string} cacheFile - 缓存文件路径
     * @param {Array} ips - IP列表
     * @param {number} privateCount - 私有IP数量
     * @param {number} publicCount - 公网IP数量
     */
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

    /**
     * 渲染IP列表（从缓存读取时使用）
     * @param {Array} ips - IP列表
     * @param {number} privateCount - 私有IP数量
     * @param {number} publicCount - 公网IP数量
     */
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

    /**
     * 获取IP检测状态Map（供外部访问）
     * @returns {Map}
     */
    function getIPCheckingMap() {
        return ipCheckingMap;
    }

    // 暴露模块接口
    window.OverviewModule = {
        init,
        load,
        loadOverview,
        renderOverviewBasicInfo,
        loadOverviewPermissions,
        loadOverviewPermissionsQuick,
        renderOverviewPermissions,
        loadOverviewSignature,
        renderOverviewSignature,
        loadOverviewIPs,
        startIPCheck,
        updateIPUIIfCurrent,
        saveIPCache,
        renderIPList,
        isPrivateIP,
        isValidIP,
        getIPCheckingMap
    };

})();
