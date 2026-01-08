/**
 * 全局应用状态和工具函数
 * 所有模块共享的状态和方法
 */

// Tauri API
const { invoke, convertFileSrc } = window.__TAURI__.core;

// 全局应用状态对象
window.AppState = {
    // 案件信息
    caseName: '',
    caseNumber: '',

    // APK相关
    apkListData: [],
    selectedApkIndex: -1,
    decompilingCount: 0,

    // 设备相关
    deviceConnected: false,

    // ADB设备状态缓存
    adbDeviceCache: {
        hasDevice: false,
        installedPackages: new Map(),
        lastCheck: 0,
        checking: false
    },

    // DOM元素引用（初始化时设置）
    elements: {}
};

// 全局工具函数
window.AppUtils = {
    // 格式化文件大小
    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 格式化时间
    formatDate: function(isoString) {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleString('zh-CN');
    },

    // HTML转义函数
    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // 获取设置
    getSettings: async function() {
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
};

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
window.toast = new Toast();
