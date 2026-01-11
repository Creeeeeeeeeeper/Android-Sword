/**
 * 主入口文件 - 模块化版本
 * 整合所有模块并初始化页面
 */

const { invoke, convertFileSrc } = window.__TAURI__.core;

// 复制到剪贴板函数（全局）
window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
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

        const toast = document.createElement('div');
        toast.className = `toast ${color}`;
        toast.textContent = text;

        this.container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('hide');
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

    // ============ DOM 元素 ============
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

    // ============ 共享状态 ============
    let decompilingCount = 0;
    let apkListData = [];
    let selectedApkIndex = -1;
    let deviceConnected = false;

    // ADB设备状态缓存
    let adbDeviceCache = {
        hasDevice: false,
        installedPackages: new Map(),
        lastCheck: 0,
        checking: false
    };

    // 获取当前案件信息
    const caseName = window.parent.currentCaseName || '未知案件';
    const caseNumber = window.parent.currentCaseNumber || '';

    // 设置案件标题
    caseTitle.textContent = caseName;

    // ============ 工具函数 ============
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDate(isoString) {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleString('zh-CN');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

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

    // 正则转义
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 获取高亮语言
    function getHighlightLanguage(extension) {
        const languageMap = {
            'java': 'java',
            'kt': 'kotlin',
            'xml': 'xml',
            'json': 'json',
            'smali': 'smali',
            'txt': 'plaintext',
            'properties': 'properties',
            'gradle': 'gradle',
            'pro': 'plaintext',
            'MF': 'plaintext'
        };
        return languageMap[extension] || 'plaintext';
    }

    // ============ 初始化各模块 ============
    // 初始化APK模块
    window.ApkModule.init({
        invoke, convertFileSrc, toast, caseNumber,
        addApkBtn, apkTabsContainer, apkDetailContainer, taskIndicator, fullscreenLoading,
        formatFileSize, formatDate, escapeHtml,
        getApkListData: () => apkListData,
        setApkListData: (data) => { apkListData = data; },
        getSelectedApkIndex: () => selectedApkIndex,
        setSelectedApkIndex: (idx) => { selectedApkIndex = idx; },
        getDecompilingCount: () => decompilingCount,
        setDecompilingCount: (c) => { decompilingCount = c; },
        adbDeviceCache,
        onApkSelect: (index) => {
            // 根据当前激活的面板加载相应数据
            const activeTab = document.querySelector('.operation-tab.active');
            if (activeTab) {
                const tabName = activeTab.dataset.tab;
                loadTabContent(tabName);
            }
        }
    });

    // 初始化设备模块
    window.DeviceModule.init({
        invoke, caseNumber,
        reconnectBtn, refreshBtn, deviceIframe, loadingIndicator,
        getSettings,
        getDeviceConnected: () => deviceConnected,
        setDeviceConnected: (v) => { deviceConnected = v; }
    });

    // 初始化总览模块
    window.OverviewModule.init({
        invoke, caseNumber, toast,
        escapeHtml,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex
    });

    // 初始化详细信息模块
    window.DetailsModule.init({
        invoke, caseNumber,
        escapeHtml,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex
    });

    // 初始化权限模块
    window.PermissionsModule.init({
        invoke, caseNumber,
        escapeHtml,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex
    });

    // 初始化第三方服务模块
    window.ServicesModule.init({
        invoke, caseNumber, toast,
        escapeHtml,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex
    });

    // 初始化JADX模块
    window.JadxModule.init({
        invoke, convertFileSrc, caseNumber, toast,
        escapeHtml, escapeRegExp, getHighlightLanguage, formatFileSize, getSettings,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex
    });

    // 初始化AI模块
    window.AIModule.init({
        caseNumber: caseNumber,
        apkTimestamp: () => {
            const selectedApk = apkListData[selectedApkIndex];
            return selectedApk ? selectedApk.timestamp : '';
        }
    });

    // 初始化敏感信息模块
    window.SensitiveModule.init({
        invoke, caseNumber, toast,
        escapeHtml, escapeRegExp, getHighlightLanguage,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex,
        operationTabs
    });

    // 初始化抓包模块
    window.CaptureModule.init({
        invoke, caseNumber, toast,
        escapeHtml, formatFileSize,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex
    });

    // 初始化Frida脚本模块
    window.FridaModule.init({
        invoke, caseNumber, toast,
        escapeHtml,
        getApkListData: () => apkListData,
        getSelectedApkIndex: () => selectedApkIndex
    });

    // ============ Tab 切换逻辑 ============
    function loadTabContent(tabName) {
        if (selectedApkIndex < 0) return;
        const apk = apkListData[selectedApkIndex];

        switch (tabName) {
            case 'overview':
                window.OverviewModule.load(apk);
                break;
            case 'details':
                window.DetailsModule.load(apk);
                break;
            case 'permissions':
                window.PermissionsModule.load(apk);
                break;
            case 'services':
                window.ServicesModule.load(apk);
                break;
            case 'sensitive':
                window.SensitiveModule.refresh();
                break;
            case 'capture':
                window.CaptureModule.loadSessions();
                break;
            case 'frida':
                // Frida模块不需要每次切换都加载
                break;
        }
    }

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

            // 加载对应内容
            loadTabContent(targetTab);
        });
    });

    // ============ 返回按钮 ============
    backBtn.addEventListener('click', function() {
        invoke('stop_scrcpy', { caseNumber: caseNumber })
            .then(() => {
                window.parent.loadPage('pages/homepage/index.html');
            })
            .catch(err => console.error('停止scrcpy失败:', err));
    });

    // ============ 初始化 ============
    // 预检测ADB设备状态
    async function preCheckAdbStatus() {
        if (adbDeviceCache.checking) return;
        adbDeviceCache.checking = true;

        try {
            const deviceStatus = await invoke('check_adb_devices');
            adbDeviceCache.hasDevice = (deviceStatus === 'has_devices');
            adbDeviceCache.lastCheck = Date.now();

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

    // 启动定期检测ADB状态
    setInterval(() => {
        preCheckAdbStatus();
    }, 10000);

    // 页面加载时立即检测
    preCheckAdbStatus();

    // 初始化APK面板
    window.ApkModule.initPanel();

    // 初始化设备连接
    window.DeviceModule.initDevice();
});
