const { invoke } = window.__TAURI__.core;

// 顶部弹出框组件
class Toast {
    constructor() {
        this.container = document.getElementById('toast-container');
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
window.toast = new Toast();

// 生成案件编号
function generateCaseNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    // 随机三个字母（大小写混合）
    let letters = '';
    for (let i = 0; i < 3; i++) {
        const randomChar = Math.random() < 0.5 ?
            String.fromCharCode(65 + Math.floor(Math.random() * 26)) :
            String.fromCharCode(97 + Math.floor(Math.random() * 26));
        letters += randomChar;
    }

    return `${year}${month}${day}${hours}${minutes}${seconds}${letters}`;
}

// 验证案件编号格式
function validateCaseNumber(number) {
    const regex = /^[a-zA-Z0-9]{1,20}$/;
    return regex.test(number);
}

// 格式化时间
function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN');
}

// 全局变量存储当前操作的案件
let currentCaseData = null;

// 页面加载完成时的初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('主页已加载');

    // 清理残留的adb和scrcpy进程
    invoke('cleanup_residual_processes')
        .then(() => {
            console.log('已清理残留进程');
        })
        .catch(err => console.error('清理残留进程失败:', err));

    const createCaseBtn = document.getElementById('create-case');
    const caseModal = document.getElementById('case-modal');
    const editModal = document.getElementById('edit-modal');
    const aboutModal = document.getElementById('about-modal');
    const cancelBtn = document.getElementById('cancel-btn');
    const confirmBtn = document.getElementById('confirm-btn');
    const editCancelBtn = document.getElementById('edit-cancel-btn');
    const editConfirmBtn = document.getElementById('edit-confirm-btn');
    const aboutCloseBtn = document.getElementById('about-close-btn');

    const caseNameInput = document.getElementById('case-name');
    const caseNumberInput = document.getElementById('case-number');
    const casePathInput = document.getElementById('case-path');

    // 加载案件列表
    async function loadCases() {
        try {
            const dirs = await invoke('read_dirs', { dirname: 'case' });
            const casesList = [];

            for (const caseDir of dirs) {
                try {
                    const configPath = `case/${caseDir}/config.json`;
                    const configContent = await invoke('read_file', { filename: configPath });
                    const caseConfig = JSON.parse(configContent);
                    casesList.push(caseConfig);
                } catch (error) {
                    console.error(`读取案件 ${caseDir} 配置失败:`, error);
                }
            }

            // 按创建时间降序排列
            casesList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // 更新案件数量
            document.getElementById('case-total').textContent = casesList.length;

            // 渲染案件列表
            const caseListContainer = document.getElementById('cases-list');
            const emptyState = document.getElementById('empty-state');
            caseListContainer.innerHTML = '';

            if (casesList.length === 0) {
                // 显示空状态
                emptyState.style.display = 'flex';
            } else {
                // 隐藏空状态
                emptyState.style.display = 'none';
                casesList.forEach(caseData => {
                    const caseRow = createCaseRow(caseData);
                    caseListContainer.appendChild(caseRow);
                });
            }
        } catch (error) {
            console.error('加载案件列表失败:', error);
        }
    }

    // 创建案件行
    function createCaseRow(caseData) {
        const row = document.createElement('div');
        row.className = 'case-row';
        row.innerHTML = `
            <button class="case-expand-btn">></button>
            <div class="case-cell case-name-cell">${caseData.name}</div>
            <div class="case-cell">${caseData.number}</div>
            <div class="case-cell">-</div>
            <div class="case-cell">${caseData.investigator || '-'}</div>
            <div class="case-cell">${formatDate(caseData.createdAt)}</div>
            <div class="case-cell cell-action">
                <button class="action-btn folder-btn">📁</button>
                <button class="action-btn menu-btn">⋮</button>
            </div>
        `;

        // 创建详情行
        const detailRow = document.createElement('div');
        detailRow.className = 'case-detail-row';
        detailRow.innerHTML = `
            <div class="case-detail-content">
                <div class="case-detail-item">
                    <div class="case-detail-label">案件描述</div>
                    <div class="case-detail-text">${caseData.description || '-'}</div>
                </div>
                <div class="case-detail-item">
                    <div class="case-detail-label">备注</div>
                    <div class="case-detail-text">${caseData.remark || '-'}</div>
                </div>
            </div>
        `;

        // 跳转到operate页面的函数
        function navigateToOperate() {
            window.parent.currentCaseNumber = caseData.number;
            window.parent.currentCaseName = caseData.name;
            window.parent.loadPage('pages/operate/index.html');
        }

        // 案件名称单击事件
        const nameCellElement = row.querySelector('.case-name-cell');
        nameCellElement.style.cursor = 'pointer';
        nameCellElement.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateToOperate();
        });

        // 整行双击事件
        row.addEventListener('dblclick', (e) => {
            if (!e.target.classList.contains('action-btn')) {
                navigateToOperate();
            }
        });

        // 展开按钮事件
        const expandBtn = row.querySelector('.case-expand-btn');
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            expandBtn.classList.toggle('expanded');
            detailRow.classList.toggle('show');
        });

        // 为所有 case-cell 添加 tooltip
        const cells = row.querySelectorAll('.case-cell:not(.cell-action)');
        cells.forEach(cell => {
            cell.addEventListener('mouseenter', function(e) {
                // 检查文本是否被截断
                if (this.scrollWidth > this.clientWidth) {
                    showTooltip(e, this.textContent);
                }
            });

            cell.addEventListener('mouseleave', function() {
                hideTooltip();
            });
        });

        // 打开文件夹按钮
        row.querySelector('.folder-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            invoke('open_file', { path: caseData.path }).catch(err => console.error(err));
        });

        // 菜单按钮
        row.querySelector('.menu-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            showContextMenu(e, caseData);
        });

        // 返回行和详情行的包装容器
        const container = document.createElement('div');
        container.style.display = 'contents';
        container.appendChild(row);
        container.appendChild(detailRow);
        return container;
    }

    let tooltipHideTimeout = null;

    // 显示 tooltip
    function showTooltip(event, text) {
        // 取消任何待处理的隐藏操作
        if (tooltipHideTimeout) {
            clearTimeout(tooltipHideTimeout);
            tooltipHideTimeout = null;
        }

        // 移除已存在的 tooltip
        const existingTooltip = document.querySelector('.cell-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }

        const tooltip = document.createElement('div');
        tooltip.className = 'cell-tooltip';
        tooltip.textContent = text;
        tooltip.style.opacity = '1';
        document.body.appendChild(tooltip);

        // 位置计算
        const rect = event.target.getBoundingClientRect();
        tooltip.style.left = (rect.right + 10) + 'px';
        tooltip.style.top = rect.top + 'px';
    }

    // 隐藏 tooltip
    function hideTooltip() {
        const tooltip = document.querySelector('.cell-tooltip');
        if (tooltip) {
            tooltip.style.opacity = '0';
            tooltipHideTimeout = setTimeout(() => {
                tooltip.remove();
                tooltipHideTimeout = null;
            }, 200);
        }
    }

    // 显示上下文菜单
    function showContextMenu(event, caseData) {
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.case-menu');
        if (existingMenu) {
            // 播放收起动画然后删除
            existingMenu.classList.add('closing');
            setTimeout(() => {
                existingMenu.remove();
            }, 150);
        }

        const menu = document.createElement('div');
        menu.className = 'case-menu';
        menu.style.position = 'absolute';
        menu.style.left = (event.pageX - 50) + 'px';
        menu.style.top = event.pageY + 'px';

        const editItem = document.createElement('button');
        editItem.className = 'case-menu-item';
        editItem.textContent = '编辑';
        editItem.addEventListener('click', () => {
            // 播放收起动画
            menu.classList.add('closing');
            setTimeout(() => {
                menu.remove();
                openEditModal(caseData);
            }, 150);
        });

        const deleteItem = document.createElement('button');
        deleteItem.className = 'case-menu-item';
        deleteItem.textContent = '删除';
        deleteItem.addEventListener('click', () => {
            // 播放收起动画
            menu.classList.add('closing');
            setTimeout(() => {
                menu.remove();
                // 显示删除确认对话框
                const confirmDialog = document.createElement('div');
                confirmDialog.className = 'modal show';
                confirmDialog.id = 'delete-confirm-modal';
                confirmDialog.innerHTML = `
                    <div class="modal-content" style="max-width: 400px;">
                        <h2>确认删除</h2>
                        <p style="color: #dbdbdbff; margin: 20px 0;">确认删除案件 "<strong>${caseData.name}</strong>" 吗？此操作无法撤销。</p>
                        <div class="modal-buttons">
                            <button class="btn-cancel" onclick="document.getElementById('delete-confirm-modal').remove()">取消</button>
                            <button class="btn-confirm" id="confirm-delete-btn">删除</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(confirmDialog);

                confirmDialog.addEventListener('click', (e) => {
                    if (e.target === confirmDialog) {
                        confirmDialog.remove();
                    }
                });

                document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
                    confirmDialog.remove();
                    await performDelete(caseData);
                });
            });
        });

        menu.appendChild(editItem);
        menu.appendChild(deleteItem);
        document.body.appendChild(menu);

        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                // 播放关闭动画
                menu.classList.add('closing');
                setTimeout(() => {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }, 150);
            }
        };
        document.addEventListener('click', closeMenu);
    }

    // 打开编辑对话框
    function openEditModal(caseData) {
        currentCaseData = caseData;
        document.getElementById('edit-case-name').value = caseData.name;
        document.getElementById('edit-case-number').value = caseData.number;
        document.getElementById('edit-case-path').value = caseData.path;
        document.getElementById('edit-case-investigator').value = caseData.investigator || '';
        document.getElementById('edit-case-description').value = caseData.description || '';
        document.getElementById('edit-case-remark').value = caseData.remark || '';

        editModal.classList.add('show');
    }

    // 确认删除
    function confirmDelete(caseData) {
        currentCaseData = caseData;

        // 显示删除确认 toast
        window.toast.show({
            text: `确认删除案件 "${caseData.name}" 吗？此操作无法撤销`,
            color: 'warning',
            duration: 5000
        });
    }

    // 执行删除操作
    async function performDelete(caseData) {
        try {
            const result = await invoke('delete_path', { path: caseData.path });

            if (result === 's') {
                window.toast.show({
                    text: `案件 "${caseData.name}" 已删除`,
                    color: 'success',
                    duration: 3000
                });
                currentCaseData = null;
                loadCases(); // 重新加载案件列表
            } else {
                window.toast.show({
                    text: '删除案件失败',
                    color: 'error',
                    duration: 3000
                });
            }
        } catch (error) {
            console.error('删除案件出错:', error);
            window.toast.show({
                text: `删除案件出错：${error}`,
                color: 'error',
                duration: 3000
            });
        }
    }

    // 打开创建案件对话框
    createCaseBtn.addEventListener('click', function() {
        const initialNumber = generateCaseNumber();
        caseNumberInput.value = initialNumber;
        updateCasePath();

        caseNameInput.value = '';
        document.getElementById('case-investigator').value = '';
        document.getElementById('case-description').value = '';
        document.getElementById('case-remark').value = '';

        caseModal.classList.add('show');
    });

    // 关闭对话框
    cancelBtn.addEventListener('click', function() {
        caseModal.classList.remove('show');
    });

    editCancelBtn.addEventListener('click', function() {
        editModal.classList.remove('show');
        currentCaseData = null;
    });

    // 监听编号输入
    caseNumberInput.addEventListener('input', function() {
        const originalValue = this.value;
        const cleanValue = this.value.replace(/[^a-zA-Z0-9]/g, '');

        if (originalValue !== cleanValue) {
            this.value = cleanValue;
            window.toast.show({
                text: '案件编号由数字或大小写字母组成，非法字符已删除',
                color: 'warning',
                duration: 3000
            });
        }

        updateCasePath();
    });

    // 更新保存位置
    function updateCasePath() {
        const caseNumber = caseNumberInput.value;
        if (caseNumber) {
            casePathInput.value = `case/${caseNumber}`;
        } else {
            casePathInput.value = '';
        }
    }

    // 确定创建案件
    confirmBtn.addEventListener('click', async function() {
        const caseName = caseNameInput.value.trim();
        const caseNumber = caseNumberInput.value.trim();
        const investigator = document.getElementById('case-investigator').value.trim();
        const description = document.getElementById('case-description').value.trim();
        const remark = document.getElementById('case-remark').value.trim();

        if (!caseName) {
            window.toast.show({
                text: '案件名称不能为空',
                color: 'error',
                duration: 3000
            });
            caseNameInput.focus();
            return;
        }

        if (!caseNumber) {
            window.toast.show({
                text: '案件编号不能为空',
                color: 'error',
                duration: 3000
            });
            caseNumberInput.focus();
            return;
        }

        if (!validateCaseNumber(caseNumber)) {
            window.toast.show({
                text: '案件编号只能包含数字和大小写字母，最多20个字符',
                color: 'error',
                duration: 3000
            });
            caseNumberInput.focus();
            return;
        }

        try {
            const caseDir = `case/${caseNumber}`;

            // 检查案件编号是否已存在
            try {
                const configPath = `${caseDir}/config.json`;
                await invoke('read_file', { filename: configPath });
                // 如果能成功读取文件，说明案件编号已存在
                window.toast.show({
                    text: '案件编号已存在，请使用其他编号',
                    color: 'error',
                    duration: 3000
                });
                caseNumberInput.focus();
                return;
            } catch (e) {
                // 文件不存在，可以继续创建
            }

            const createResult = await invoke('create_dir', { dirname: caseDir });

            if (createResult === 's') {
                const caseConfig = {
                    name: caseName,
                    number: caseNumber,
                    investigator: investigator,
                    description: description,
                    remark: remark,
                    createdAt: new Date().toISOString(),
                    path: caseDir
                };

                const configPath = `${caseDir}/config.json`;
                const configContent = JSON.stringify(caseConfig, null, 2);

                const writeResult = await invoke('write_file', {
                    filename: configPath,
                    content: configContent
                });

                if (writeResult === 's') {
                    window.toast.show({
                        text: `案件 "${caseName}" 创建成功！`,
                        color: 'success',
                        duration: 3000
                    });
                    caseModal.classList.remove('show');
                    loadCases(); // 重新加载案件列表
                } else {
                    window.toast.show({
                        text: '创建案件配置文件失败',
                        color: 'error',
                        duration: 3000
                    });
                }
            } else {
                window.toast.show({
                    text: '创建案件目录失败，请检查权限',
                    color: 'error',
                    duration: 3000
                });
            }
        } catch (error) {
            console.error('创建案件出错:', error);
            window.toast.show({
                text: `创建案件出错：${error}`,
                color: 'error',
                duration: 3000
            });
        }
    });

    // 编辑案件确定
    editConfirmBtn.addEventListener('click', async function() {
        if (!currentCaseData) return;

        const newName = document.getElementById('edit-case-name').value.trim();
        const newInvestigator = document.getElementById('edit-case-investigator').value.trim();
        const newDescription = document.getElementById('edit-case-description').value.trim();
        const newRemark = document.getElementById('edit-case-remark').value.trim();

        if (!newName) {
            window.toast.show({
                text: '案件名称不能为空',
                color: 'error',
                duration: 3000
            });
            document.getElementById('edit-case-name').focus();
            return;
        }

        try {
            const updatedConfig = {
                name: newName,
                number: currentCaseData.number,
                investigator: newInvestigator,
                description: newDescription,
                remark: newRemark,
                createdAt: currentCaseData.createdAt,
                path: currentCaseData.path
            };

            const configPath = `${currentCaseData.path}/config.json`;
            const configContent = JSON.stringify(updatedConfig, null, 2);

            const writeResult = await invoke('write_file', {
                filename: configPath,
                content: configContent
            });

            if (writeResult === 's') {
                window.toast.show({
                    text: '案件信息更新成功！',
                    color: 'success',
                    duration: 3000
                });
                editModal.classList.remove('show');
                currentCaseData = null;
                loadCases(); // 重新加载案件列表
            } else {
                window.toast.show({
                    text: '更新案件信息失败',
                    color: 'error',
                    duration: 3000
                });
            }
        } catch (error) {
            console.error('编辑案件出错:', error);
            window.toast.show({
                text: `编辑案件出错：${error}`,
                color: 'error',
                duration: 3000
            });
        }
    });

    editModal.addEventListener('click', function(e) {
        if (e.target === editModal) {
            editModal.classList.remove('show');
            currentCaseData = null;
        }
    });

    // 关于按钮事件
    const aboutBtns = document.querySelectorAll('.top-btn');
    aboutBtns.forEach(btn => {
        if (btn.textContent.trim() === '关于') {
            btn.addEventListener('click', function() {
                aboutModal.classList.add('show');
            });
        }
    });

    // 关于模态框关闭按钮
    aboutCloseBtn.addEventListener('click', function() {
        aboutModal.classList.remove('show');
    });

    // ============ 设置模态框功能 ============
    const settingsModal = document.getElementById('settings-modal');
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    const settingsMenuItems = document.querySelectorAll('.settings-menu-item');
    const settingsSections = document.querySelectorAll('.settings-section');

    // 默认设置
    const defaultSettings = {
        adb: {
            autoConnect: true
        },
        scrcpy: {
            maxSize: null,
            bitRate: null,
            maxFps: null,
            videoPort: null,
            controlPort: null,
            intraRefresh: null,
            logLevel: '',
            public: false
        }
    };

    // 当前设置
    let currentSettings = { ...defaultSettings };

    // 加载设置
    async function loadSettings() {
        try {
            const content = await invoke('read_file', { filename: 'settings.json' });
            currentSettings = JSON.parse(content);
            console.log('已加载设置:', currentSettings);
        } catch (error) {
            console.log('设置文件不存在，使用默认设置');
            currentSettings = { ...defaultSettings };
        }
        applySettingsToUI();
    }

    // 保存设置
    async function saveSettings() {
        try {
            await invoke('write_file', {
                filename: 'settings.json',
                content: JSON.stringify(currentSettings, null, 2)
            });
            console.log('设置已保存');
        } catch (error) {
            console.error('保存设置失败:', error);
            window.toast.show({
                text: '保存设置失败',
                color: 'error',
                duration: 3000
            });
        }
    }

    // 将设置应用到UI
    function applySettingsToUI() {
        // ADB 设置
        const autoConnectCheckbox = document.getElementById('setting-auto-connect');
        if (autoConnectCheckbox) {
            autoConnectCheckbox.checked = currentSettings.adb?.autoConnect ?? true;
        }

        // Scrcpy 设置
        const scrcpy = currentSettings.scrcpy || {};

        const maxSizeInput = document.getElementById('setting-max-size');
        if (maxSizeInput) {
            maxSizeInput.value = scrcpy.maxSize || '';
        }

        const bitRateInput = document.getElementById('setting-bit-rate');
        if (bitRateInput) {
            bitRateInput.value = scrcpy.bitRate || '';
        }

        const maxFpsInput = document.getElementById('setting-max-fps');
        if (maxFpsInput) {
            maxFpsInput.value = scrcpy.maxFps || '';
        }

        const videoPortInput = document.getElementById('setting-video-port');
        if (videoPortInput) {
            videoPortInput.value = scrcpy.videoPort || '';
        }

        const controlPortInput = document.getElementById('setting-control-port');
        if (controlPortInput) {
            controlPortInput.value = scrcpy.controlPort || '';
        }

        const intraRefreshInput = document.getElementById('setting-intra-refresh');
        if (intraRefreshInput) {
            intraRefreshInput.value = scrcpy.intraRefresh || '';
        }

        const publicCheckbox = document.getElementById('setting-public');
        if (publicCheckbox) {
            publicCheckbox.checked = scrcpy.public || false;
        }
    }

    // 设置按钮事件
    aboutBtns.forEach(btn => {
        if (btn.textContent.trim() === '设置') {
            btn.addEventListener('click', async function() {
                await loadSettings();
                settingsModal.classList.add('show');
            });
        }
    });

    // 设置模态框关闭按钮
    settingsCloseBtn.addEventListener('click', function() {
        settingsModal.classList.remove('show');
    });

    // 设置模态框不能通过蒙层关闭，只能点击关闭按钮

    // 设置菜单切换
    settingsMenuItems.forEach(item => {
        item.addEventListener('click', function() {
            const section = this.dataset.section;

            // 更新菜单项状态
            settingsMenuItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');

            // 更新内容区域
            settingsSections.forEach(s => s.classList.remove('active'));
            const targetSection = document.getElementById(`settings-${section}`);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });

    // 自动连接设置变更
    const autoConnectCheckbox = document.getElementById('setting-auto-connect');
    if (autoConnectCheckbox) {
        autoConnectCheckbox.addEventListener('change', async function() {
            if (!currentSettings.adb) {
                currentSettings.adb = {};
            }
            currentSettings.adb.autoConnect = this.checked;
            await saveSettings();
        });
    }

    // Scrcpy设置变更 - 数字输入框
    const scrcpyNumberInputs = [
        { id: 'setting-max-size', key: 'maxSize' },
        { id: 'setting-bit-rate', key: 'bitRate' },
        { id: 'setting-max-fps', key: 'maxFps' },
        { id: 'setting-video-port', key: 'videoPort' },
        { id: 'setting-control-port', key: 'controlPort' },
        { id: 'setting-intra-refresh', key: 'intraRefresh' }
    ];

    scrcpyNumberInputs.forEach(({ id, key }) => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', async function() {
                if (!currentSettings.scrcpy) {
                    currentSettings.scrcpy = {};
                }
                const value = this.value ? parseInt(this.value, 10) : null;
                currentSettings.scrcpy[key] = value;
                await saveSettings();
            });
        }
    });

    // Scrcpy设置变更 - 局域网访问开关
    const publicCheckbox = document.getElementById('setting-public');
    if (publicCheckbox) {
        publicCheckbox.addEventListener('change', async function() {
            if (!currentSettings.scrcpy) {
                currentSettings.scrcpy = {};
            }
            currentSettings.scrcpy.public = this.checked;
            await saveSettings();
        });
    }

    // 导出设置到全局，供其他页面使用
    window.getSettings = function() {
        return currentSettings;
    };

    // 初始加载设置（不显示模态框，只是预加载设置）
    loadSettings();

    // 初始加载案件列表
    loadCases();
});

