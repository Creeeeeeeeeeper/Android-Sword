/**
 * JADX模块 - JADX源码查看器
 * 负责文件树加载、源码预览、搜索、媒体文件预览、Hex查看等功能
 */

window.JadxModule = (function() {
    // 模块依赖（通过init注入）
    let invoke = null;
    let convertFileSrc = null;
    let caseNumber = '';
    let toast = null;

    // 工具函数
    let escapeHtml = null;
    let escapeRegExp = null;
    let getHighlightLanguage = null;
    let formatFileSize = null;
    let getSettings = null;

    // 状态访问器
    let getApkListData = null;
    let getSelectedApkIndex = null;

    // DOM元素引用
    let jadxOverlay = null;
    let jadxCloseBtn = null;
    let jadxSearchBtn = null;
    let jadxViewerBtn = null;
    let jadxTree = null;
    let jadxMain = null;
    let jadxCurrentPath = null;
    let jadxResizer = null;
    let jadxSidebar = null;

    // 搜索相关元素
    let searchOverlay = null;
    let searchCloseBtn = null;
    let searchInput = null;
    let searchCount = null;
    let searchResultsList = null;
    let searchPreviewPath = null;
    let searchPreviewContent = null;
    let searchResizer = null;
    let searchResultsPanel = null;

    // 状态变量
    let jadxFileTree = null;
    let currentFilePath = null;
    let currentFileContent = null; // 保存当前文件的原始内容
    let searchTimeout = null;
    let searchResults = [];
    let selectedSearchIndex = -1;
    let currentBinaryData = null;  // 当前二进制文件数据
    let currentEncoding = 'ascii'; // 当前编码
    let currentHexPage = 0;        // 当前Hex页码
    let hexPageSizeKB = 64;        // 每页大小（KB），默认64KB
    let currentMediaViewMode = 'preview'; // 当前媒体查看模式 ('preview' 或 'hex')

    // 媒体文件扩展名
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const audioExtensions = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'];
    const videoExtensions = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', '3gp'];

    // 拖拽状态
    let isResizingJadx = false;
    let isResizingSearch = false;

    /**
     * 初始化模块，注入依赖
     * @param {Object} deps - 依赖对象
     */
    function init(deps) {
        invoke = deps.invoke;
        convertFileSrc = deps.convertFileSrc;
        caseNumber = deps.caseNumber;
        toast = deps.toast;

        // 工具函数
        escapeHtml = deps.escapeHtml;
        escapeRegExp = deps.escapeRegExp;
        getHighlightLanguage = deps.getHighlightLanguage;
        formatFileSize = deps.formatFileSize;
        getSettings = deps.getSettings;

        // 状态访问器
        getApkListData = deps.getApkListData;
        getSelectedApkIndex = deps.getSelectedApkIndex;

        // 获取DOM元素
        initDomElements();

        // 绑定事件
        bindEvents();
    }

    /**
     * 初始化DOM元素引用
     */
    function initDomElements() {
        jadxOverlay = document.getElementById('jadx-overlay');
        jadxCloseBtn = document.getElementById('jadx-close-btn');
        jadxSearchBtn = document.getElementById('jadx-search-btn');
        jadxViewerBtn = document.getElementById('jadx-viewer-btn');
        jadxTree = document.getElementById('jadx-tree');
        jadxMain = document.getElementById('jadx-main');
        jadxCurrentPath = document.getElementById('jadx-current-path');
        jadxResizer = document.getElementById('jadx-resizer');
        jadxSidebar = document.getElementById('jadx-sidebar');

        // 搜索相关元素
        searchOverlay = document.getElementById('search-overlay');
        searchCloseBtn = document.getElementById('search-close-btn');
        searchInput = document.getElementById('search-input');
        searchCount = document.getElementById('search-count');
        searchResultsList = document.getElementById('search-results-list');
        searchPreviewPath = document.getElementById('search-preview-path');
        searchPreviewContent = document.getElementById('search-preview-content');
        searchResizer = document.getElementById('search-resizer');
        searchResultsPanel = document.getElementById('search-results-panel');
    }

    /**
     * 绑定事件
     */
    function bindEvents() {
        // 打开JADX查看器
        if (jadxViewerBtn) {
            jadxViewerBtn.addEventListener('click', handleOpenJadxViewer);
        }

        // 关闭JADX查看器
        if (jadxCloseBtn) {
            jadxCloseBtn.addEventListener('click', () => {
                jadxOverlay.classList.add('hidden');
            });
        }

        // 打开搜索
        if (jadxSearchBtn) {
            jadxSearchBtn.addEventListener('click', () => {
                // 打开搜索界面并清空之前的搜索
                clearSearchState();
                searchOverlay.classList.remove('hidden');
                searchInput.focus();
            });
        }

        // 关闭搜索
        if (searchCloseBtn) {
            searchCloseBtn.addEventListener('click', () => {
                searchOverlay.classList.add('hidden');
                // 关闭时也清空搜索状态
                clearSearchState();
            });
        }

        // 键盘快捷键
        document.addEventListener('keydown', handleKeydown);

        // 搜索输入
        if (searchInput) {
            searchInput.addEventListener('input', handleSearchInput);
        }

        // JADX侧边栏拖拽调整大小
        if (jadxResizer) {
            jadxResizer.addEventListener('mousedown', handleJadxResizerMousedown);
        }

        // 搜索结果面板拖拽调整大小
        if (searchResizer) {
            searchResizer.addEventListener('mousedown', handleSearchResizerMousedown);
        }
    }

    /**
     * 清空搜索状态
     */
    function clearSearchState() {
        searchResults = [];
        selectedSearchIndex = -1;
        if (searchInput) {
            searchInput.value = '';
        }
        if (searchResultsList) {
            searchResultsList.innerHTML = '<div class="search-placeholder">输入搜索内容</div>';
        }
        if (searchCount) {
            searchCount.textContent = '';
        }
        if (searchPreviewContent) {
            searchPreviewContent.innerHTML = '<div class="search-placeholder">选择左侧结果预览</div>';
        }
        if (searchPreviewPath) {
            searchPreviewPath.textContent = '';
        }
    }

    /**
     * 处理打开JADX查看器
     */
    async function handleOpenJadxViewer() {
        const selectedApkIndex = getSelectedApkIndex();
        if (selectedApkIndex < 0) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const apkListData = getApkListData();
        const apk = apkListData[selectedApkIndex];
        if (!apk.isDecompiled) {
            toast.show({ text: 'APK尚未反编译完成', color: 'warning', duration: 2000 });
            return;
        }

        jadxOverlay.classList.remove('hidden');

        // 清空搜索状态
        clearSearchState();

        await loadJadxFileTree();
    }

    /**
     * 处理键盘快捷键
     */
    function handleKeydown(e) {
        // Ctrl+F 打开搜索
        if (e.ctrlKey && e.key === 'f' && !jadxOverlay.classList.contains('hidden')) {
            e.preventDefault();
            clearSearchState();
            searchOverlay.classList.remove('hidden');
            searchInput.focus();
        }
        // ESC 关闭搜索蒙层
        if (e.key === 'Escape' && !searchOverlay.classList.contains('hidden')) {
            searchOverlay.classList.add('hidden');
            clearSearchState();
        }
    }

    /**
     * 加载文件树
     */
    async function loadJadxFileTree() {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        jadxTree.innerHTML = '<div class="jadx-loading">加载文件树中...</div>';
        jadxMain.innerHTML = '<div class="jadx-placeholder">选择左侧文件查看源码</div>';
        jadxCurrentPath.textContent = '';

        try {
            const result = await invoke('get_jadx_file_tree', { apkDir });

            if (!result.success) {
                jadxTree.innerHTML = `<div class="jadx-loading">${result.message}</div>`;
                return;
            }

            jadxFileTree = result.tree;
            jadxTree.innerHTML = '';
            renderFileTree(result.tree, jadxTree);
        } catch (error) {
            jadxTree.innerHTML = `<div class="jadx-loading">加载失败: ${error}</div>`;
        }
    }

    // 分批渲染配置
    const BATCH_SIZE = 100; // 每批渲染的节点数
    const BATCH_DELAY = 10; // 批次间隔（毫秒）

    /**
     * 渲染文件树（懒加载版本，支持分批渲染）
     * @param {Array} nodes - 节点数组
     * @param {HTMLElement} container - 容器元素
     * @param {number} level - 层级
     * @returns {Promise<void>}
     */
    async function renderFileTree(nodes, container, level = 0) {
        // 对于大量节点，使用分批渲染
        if (nodes.length > BATCH_SIZE) {
            await renderFileTreeBatched(nodes, container, level);
        } else {
            renderFileTreeSync(nodes, container, level);
        }
    }

    /**
     * 分批渲染文件树
     * @param {Array} nodes - 节点数组
     * @param {HTMLElement} container - 容器元素
     * @param {number} level - 层级
     */
    async function renderFileTreeBatched(nodes, container, level) {
        for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
            const batch = nodes.slice(i, i + BATCH_SIZE);
            const fragment = document.createDocumentFragment();

            batch.forEach(node => {
                const nodeEl = createTreeNode(node, level);
                fragment.appendChild(nodeEl);
            });

            container.appendChild(fragment);

            // 每批次渲染后让出主线程（最后一批不需要等待）
            if (i + BATCH_SIZE < nodes.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        }
    }

    /**
     * 同步渲染文件树（小量数据）
     * @param {Array} nodes - 节点数组
     * @param {HTMLElement} container - 容器元素
     * @param {number} level - 层级
     */
    function renderFileTreeSync(nodes, container, level) {
        const fragment = document.createDocumentFragment();

        nodes.forEach(node => {
            const nodeEl = createTreeNode(node, level);
            fragment.appendChild(nodeEl);
        });

        container.appendChild(fragment);
    }

    /**
     * 创建单个树节点元素
     * @param {Object} node - 节点数据
     * @param {number} level - 层级
     * @returns {HTMLElement}
     */
    function createTreeNode(node, level) {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'tree-node';
        nodeEl.dataset.path = node.path;

        const headerEl = document.createElement('div');
        headerEl.className = 'tree-node-header';
        headerEl.style.paddingLeft = `${8 + level * 12}px`;

        if (node.is_dir) {
            headerEl.innerHTML = `
                <span class="tree-node-toggle">${node.has_children ? '>' : ''}</span>
                <span class="tree-node-icon">&#128193;</span>
                <span class="tree-node-name">${escapeHtml(node.name)}</span>
            `;

            const childrenEl = document.createElement('div');
            childrenEl.className = 'tree-node-children collapsed';
            childrenEl.dataset.loaded = 'false';

            headerEl.addEventListener('click', async (e) => {
                e.stopPropagation();

                if (!node.has_children) return;

                const toggle = headerEl.querySelector('.tree-node-toggle');
                const icon = headerEl.querySelector('.tree-node-icon');

                if (childrenEl.classList.contains('collapsed')) {
                    // 展开
                    if (childrenEl.dataset.loaded === 'false') {
                        // 懒加载子目录 - 显示加载中的旋转圆圈
                        toggle.textContent = '';
                        toggle.classList.add('loading');

                        // 1.5秒后显示提示（缩短等待时间）
                        const loadingTimeout = setTimeout(() => {
                            toast.show({
                                text: `${node.name} 文件夹加载中...`,
                                color: 'info',
                                duration: 3000
                            });
                        }, 1500);

                        const success = await loadSubdirectory(node.path, childrenEl, level + 1);

                        // 清除超时提示
                        clearTimeout(loadingTimeout);

                        toggle.classList.remove('loading');
                        if (success) {
                            childrenEl.dataset.loaded = 'true';
                            childrenEl.classList.remove('collapsed');
                            toggle.textContent = 'v';
                            toggle.classList.add('expanded');
                            icon.innerHTML = '&#128194;';
                        } else {
                            // 加载失败或空目录
                            toggle.textContent = '';
                            node.has_children = false;
                        }
                    } else {
                        childrenEl.classList.remove('collapsed');
                        toggle.textContent = 'v';
                        toggle.classList.add('expanded');
                        icon.innerHTML = '&#128194;';
                    }
                } else {
                    // 折叠
                    childrenEl.classList.add('collapsed');
                    toggle.textContent = '>';
                    toggle.classList.remove('expanded');
                    icon.innerHTML = '&#128193;';
                }
            });

            nodeEl.appendChild(headerEl);
            nodeEl.appendChild(childrenEl);
        } else {
            const icon = getFileIcon(node.name);
            const nameSpan = document.createElement('span');
            nameSpan.className = 'tree-node-name';
            nameSpan.textContent = node.name;

            headerEl.innerHTML = `
                <span class="tree-node-toggle"></span>
                <span class="tree-node-icon">${icon}</span>
            `;
            headerEl.appendChild(nameSpan);

            // 异步检查是否有AI分析历史
            if (window.AIModule && window.AIModule.hasAIHistory) {
                window.AIModule.hasAIHistory(node.path).then(hasHistory => {
                    if (hasHistory) {
                        const aiIcon = document.createElement('span');
                        aiIcon.className = 'tree-node-ai-icon';
                        aiIcon.textContent = '🤖';
                        aiIcon.title = '已使用AI分析';
                        nameSpan.appendChild(aiIcon);
                    }
                });
            }

            headerEl.addEventListener('click', (e) => {
                e.stopPropagation();
                selectFile(node.path);
            });

            nodeEl.appendChild(headerEl);
        }

        return nodeEl;
    }

    /**
     * 懒加载子目录
     * @param {string} subPath - 子目录路径
     * @param {HTMLElement} container - 容器元素
     * @param {number} level - 层级
     * @returns {Promise<boolean>} 是否成功（有子项返回true，空目录或失败返回false）
     */
    async function loadSubdirectory(subPath, container, level) {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const result = await invoke('get_jadx_subdirectory', { apkDir, subPath });

            if (!result.success) {
                container.innerHTML = `<div class="jadx-loading" style="padding-left: ${8 + level * 12}px">${result.message}</div>`;
                return false;
            }

            // 如果子目录为空，返回 false
            if (!result.children || result.children.length === 0) {
                return false;
            }

            await renderFileTree(result.children, container, level);
            return true;
        } catch (error) {
            console.error('加载子目录失败:', error);
            container.innerHTML = `<div class="jadx-loading" style="padding-left: ${8 + level * 12}px">加载失败: ${error}</div>`;
            return false;
        }
    }

    /**
     * 获取文件图标
     * @param {string} filename - 文件名
     * @returns {string} 图标字符
     */
    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            'java': '&#9749;',      // 咖啡杯
            'kt': '&#128995;',      // 紫色圆
            'xml': '&#128196;',     // 文档
            'json': '&#128203;',    // 剪贴板
            'txt': '&#128221;',     // 备忘录
            'smali': '&#128295;',   // 扳手
            'properties': '&#9881;', // 齿轮
            'gradle': '&#128024;',  // 大象
            'png': '&#128444;',     // 图片
            'jpg': '&#128444;',
            'jpeg': '&#128444;',
            'gif': '&#128444;',
            'webp': '&#128444;',
            'svg': '&#128444;',
        };
        return icons[ext] || '&#128196;';
    }

    /**
     * 选中文件
     * @param {string} filePath - 文件路径
     * @param {number} page - 页码
     * @param {string} mode - 模式 ('auto' | 'preview' | 'hex')
     */
    async function selectFile(filePath, page = 0, mode = 'auto') {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        // 更新选中状态
        jadxTree.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected'));
        const nodeHeader = jadxTree.querySelector(`[data-path="${filePath}"] > .tree-node-header`);
        if (nodeHeader) {
            nodeHeader.classList.add('selected');
        }

        currentFilePath = filePath;
        currentHexPage = page;
        jadxCurrentPath.textContent = filePath;

        jadxMain.innerHTML = '<div class="jadx-placeholder">加载中...</div>';

        // 检查文件类型
        const ext = filePath.split('.').pop().toLowerCase();
        const isImage = imageExtensions.includes(ext);
        const isAudio = audioExtensions.includes(ext);
        const isVideo = videoExtensions.includes(ext);
        const isMedia = isImage || isAudio || isVideo;

        // 确定显示模式
        if (mode === 'auto') {
            currentMediaViewMode = isMedia ? 'preview' : 'hex';
        } else {
            currentMediaViewMode = mode;
        }

        // 媒体文件且为预览模式
        if (isMedia && currentMediaViewMode === 'preview') {
            // 隐藏 AI 分析按钮（媒体预览模式）
            hideAIButton();

            if (isImage) {
                renderImageView(apkDir, filePath, ext);
            } else if (isAudio) {
                renderAudioView(apkDir, filePath, ext);
            } else if (isVideo) {
                renderVideoView(apkDir, filePath, ext);
            }
            return;
        }

        // 非媒体文件或二进制模式
        try {
            // 加载设置中的每页大小
            const settings = await getSettings();
            hexPageSizeKB = settings.source?.hexPageSize || 64;

            const result = await invoke('read_jadx_file', {
                apkDir,
                filePath,
                page: page,
                pageSizeKb: hexPageSizeKB
            });

            if (!result.success) {
                jadxMain.innerHTML = `<div class="jadx-placeholder">${result.message}</div>`;
                return;
            }

            if (result.is_binary || isMedia) {
                // 二进制文件或媒体文件的二进制模式，使用Hex查看器
                currentBinaryData = result;
                currentFileContent = null; // 二进制文件不保存内容
                currentEncoding = 'ascii';
                renderHexView(result, isMedia);

                // 隐藏 AI 分析按钮
                hideAIButton();
            } else {
                // 文本文件，正常渲染
                currentBinaryData = null;
                currentFileContent = result.content; // 保存原始文本内容
                renderCode(result.content, result.extension);

                // 显示 AI 分析按钮
                showAIButton();
            }
        } catch (error) {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载失败: ${error}</div>`;
        }
    }

    /**
     * 显示 AI 分析按钮
     */
    function showAIButton() {
        const aiBtn = document.getElementById('jadx-ai-analysis-btn');
        if (aiBtn) {
            aiBtn.classList.remove('hidden');
        }
    }

    /**
     * 隐藏 AI 分析按钮
     */
    function hideAIButton() {
        const aiBtn = document.getElementById('jadx-ai-analysis-btn');
        if (aiBtn) {
            aiBtn.classList.add('hidden');
        }
    }

    /**
     * 渲染图片视图
     * @param {string} apkDir - APK目录
     * @param {string} filePath - 文件路径
     * @param {string} ext - 文件扩展名
     */
    function renderImageView(apkDir, filePath, ext) {
        const container = document.createElement('div');
        container.className = 'image-viewer-container';

        // 构建图片的完整路径
        const fullPath = `${apkDir}/jadx/${filePath}`;

        // 获取当前工作目录并构建完整的文件路径
        invoke('get_current_dir').then(currentDir => {
            const absolutePath = `${currentDir}/${fullPath}`.replace(/\\/g, '/');
            const imageUrl = convertFileSrc(absolutePath);

            // 工具栏
            const toolbar = document.createElement('div');
            toolbar.className = 'media-toolbar';
            toolbar.innerHTML = `
                <span class="media-info">图片文件 | ${ext.toUpperCase()}</span>
                <div class="media-controls">
                    <button id="image-zoom-out" class="media-control-btn" title="缩小">-</button>
                    <span id="image-zoom-level" class="media-zoom-level">100%</span>
                    <button id="image-zoom-in" class="media-control-btn" title="放大">+</button>
                    <button id="image-zoom-fit" class="media-control-btn" title="适应窗口">&#8862;</button>
                    <button id="image-zoom-actual" class="media-control-btn" title="实际大小">1:1</button>
                    <span class="media-divider"></span>
                    <button id="media-view-hex" class="media-control-btn media-mode-btn" title="查看二进制">HEX</button>
                </div>
            `;

            // 图片容器
            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'image-wrapper';

            const img = document.createElement('img');
            img.className = 'preview-image';
            img.src = imageUrl;
            img.alt = filePath;

            let currentZoom = 100;

            img.onload = () => {
                // 更新工具栏显示图片尺寸
                const sizeInfo = document.createElement('span');
                sizeInfo.className = 'media-size-info';
                sizeInfo.textContent = ` | ${img.naturalWidth} x ${img.naturalHeight}`;
                toolbar.querySelector('.media-info').appendChild(sizeInfo);
            };

            img.onerror = () => {
                imageWrapper.innerHTML = '<div class="jadx-placeholder">图片加载失败</div>';
            };

            imageWrapper.appendChild(img);
            container.appendChild(toolbar);
            container.appendChild(imageWrapper);

            jadxMain.innerHTML = '';
            jadxMain.appendChild(container);

            // 缩放控制
            const zoomOut = document.getElementById('image-zoom-out');
            const zoomIn = document.getElementById('image-zoom-in');
            const zoomFit = document.getElementById('image-zoom-fit');
            const zoomActual = document.getElementById('image-zoom-actual');
            const zoomLevel = document.getElementById('image-zoom-level');

            const updateZoom = (zoom) => {
                currentZoom = Math.max(10, Math.min(500, zoom));
                img.style.transform = `scale(${currentZoom / 100})`;
                zoomLevel.textContent = `${currentZoom}%`;
            };

            zoomOut.addEventListener('click', () => updateZoom(currentZoom - 25));
            zoomIn.addEventListener('click', () => updateZoom(currentZoom + 25));
            zoomActual.addEventListener('click', () => updateZoom(100));
            zoomFit.addEventListener('click', () => {
                const wrapperRect = imageWrapper.getBoundingClientRect();
                const scaleX = (wrapperRect.width - 40) / img.naturalWidth;
                const scaleY = (wrapperRect.height - 40) / img.naturalHeight;
                const fitZoom = Math.min(scaleX, scaleY, 1) * 100;
                updateZoom(Math.round(fitZoom));
            });

            // 鼠标滚轮缩放
            imageWrapper.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -10 : 10;
                updateZoom(currentZoom + delta);
            });

            // 切换到二进制模式
            document.getElementById('media-view-hex').addEventListener('click', () => {
                selectFile(filePath, 0, 'hex');
            });
        }).catch(error => {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载图片失败: ${error}</div>`;
        });
    }

    /**
     * 渲染音频视图
     * @param {string} apkDir - APK目录
     * @param {string} filePath - 文件路径
     * @param {string} ext - 文件扩展名
     */
    function renderAudioView(apkDir, filePath, ext) {
        const container = document.createElement('div');
        container.className = 'media-viewer-container';

        // 构建音频的完整路径
        const fullPath = `${apkDir}/jadx/${filePath}`;

        invoke('get_current_dir').then(currentDir => {
            const absolutePath = `${currentDir}/${fullPath}`.replace(/\\/g, '/');
            const audioUrl = convertFileSrc(absolutePath);

            // 工具栏
            const toolbar = document.createElement('div');
            toolbar.className = 'media-toolbar';
            toolbar.innerHTML = `
                <span class="media-info">音频文件 | ${ext.toUpperCase()}</span>
                <div class="media-controls">
                    <button id="media-view-hex" class="media-control-btn media-mode-btn" title="查看二进制">HEX</button>
                </div>
            `;

            // 音频播放器容器
            const audioWrapper = document.createElement('div');
            audioWrapper.className = 'audio-wrapper';

            const audioIcon = document.createElement('div');
            audioIcon.className = 'audio-icon';
            audioIcon.innerHTML = '&#127925;';

            const audio = document.createElement('audio');
            audio.className = 'audio-player';
            audio.controls = true;
            audio.src = audioUrl;

            const audioInfo = document.createElement('div');
            audioInfo.className = 'audio-file-info';
            audioInfo.textContent = filePath.split('/').pop();

            audio.onerror = () => {
                audioWrapper.innerHTML = '<div class="jadx-placeholder">音频加载失败，格式可能不受支持</div>';
            };

            audioWrapper.appendChild(audioIcon);
            audioWrapper.appendChild(audio);
            audioWrapper.appendChild(audioInfo);
            container.appendChild(toolbar);
            container.appendChild(audioWrapper);

            jadxMain.innerHTML = '';
            jadxMain.appendChild(container);

            // 切换到二进制模式
            document.getElementById('media-view-hex').addEventListener('click', () => {
                selectFile(filePath, 0, 'hex');
            });
        }).catch(error => {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载音频失败: ${error}</div>`;
        });
    }

    /**
     * 渲染视频视图
     * @param {string} apkDir - APK目录
     * @param {string} filePath - 文件路径
     * @param {string} ext - 文件扩展名
     */
    function renderVideoView(apkDir, filePath, ext) {
        const container = document.createElement('div');
        container.className = 'media-viewer-container';

        // 构建视频的完整路径
        const fullPath = `${apkDir}/jadx/${filePath}`;

        invoke('get_current_dir').then(currentDir => {
            const absolutePath = `${currentDir}/${fullPath}`.replace(/\\/g, '/');
            const videoUrl = convertFileSrc(absolutePath);

            // 工具栏
            const toolbar = document.createElement('div');
            toolbar.className = 'media-toolbar';
            toolbar.innerHTML = `
                <span class="media-info">视频文件 | ${ext.toUpperCase()}</span>
                <div class="media-controls">
                    <button id="media-view-hex" class="media-control-btn media-mode-btn" title="查看二进制">HEX</button>
                </div>
            `;

            // 视频播放器容器
            const videoWrapper = document.createElement('div');
            videoWrapper.className = 'video-wrapper';

            const video = document.createElement('video');
            video.className = 'video-player';
            video.controls = true;
            video.src = videoUrl;

            video.onerror = () => {
                videoWrapper.innerHTML = '<div class="jadx-placeholder">视频加载失败，格式可能不受支持</div>';
            };

            videoWrapper.appendChild(video);
            container.appendChild(toolbar);
            container.appendChild(videoWrapper);

            jadxMain.innerHTML = '';
            jadxMain.appendChild(container);

            // 切换到二进制模式
            document.getElementById('media-view-hex').addEventListener('click', () => {
                selectFile(filePath, 0, 'hex');
            });
        }).catch(error => {
            jadxMain.innerHTML = `<div class="jadx-placeholder">加载视频失败: ${error}</div>`;
        });
    }

    /**
     * 渲染Hex视图
     * @param {Object} data - 二进制数据对象
     * @param {boolean} isMedia - 是否为媒体文件（可以切换回预览模式）
     */
    function renderHexView(data, isMedia = false) {
        const container = document.createElement('div');
        container.className = 'hex-viewer-container';

        // 工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'hex-toolbar';

        // 分页信息
        const totalPages = data.total_pages || 1;
        const currentPage = data.page || 0;
        const startOffset = data.start_offset || 0;
        const endOffset = data.end_offset || data.file_size;

        // 预览按钮（仅媒体文件显示）
        const previewBtnHtml = isMedia
            ? '<button id="hex-view-preview" class="hex-page-btn hex-preview-btn" title="预览">预览</button>'
            : '';

        toolbar.innerHTML = `
            <span class="hex-info">二进制文件 | ${formatFileSize(data.file_size)} | 显示: ${formatFileSize(startOffset)} - ${formatFileSize(endOffset)}</span>
            <div class="hex-pagination">
                ${previewBtnHtml}
                <button id="hex-first-page" class="hex-page-btn" ${currentPage === 0 ? 'disabled' : ''} title="首页">&#9198;</button>
                <button id="hex-prev-page" class="hex-page-btn" ${currentPage === 0 ? 'disabled' : ''} title="上一页">&#9664;</button>
                <span class="hex-page-info">${currentPage + 1} / ${totalPages}</span>
                <button id="hex-next-page" class="hex-page-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} title="下一页">&#9654;</button>
                <button id="hex-last-page" class="hex-page-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} title="末页">&#9197;</button>
                <input type="number" id="hex-goto-page" class="hex-goto-input" min="1" max="${totalPages}" placeholder="跳转" title="输入页码后回车跳转">
            </div>
            <div class="hex-encoding-switch">
                <span>编码:</span>
                <select id="hex-encoding-select" class="hex-encoding-select">
                    <option value="ascii" ${currentEncoding === 'ascii' ? 'selected' : ''}>ASCII</option>
                    <option value="utf8" ${currentEncoding === 'utf8' ? 'selected' : ''}>UTF-8</option>
                    <option value="utf16le" ${currentEncoding === 'utf16le' ? 'selected' : ''}>UTF-16 LE</option>
                    <option value="utf16be" ${currentEncoding === 'utf16be' ? 'selected' : ''}>UTF-16 BE</option>
                    <option value="gbk" ${currentEncoding === 'gbk' ? 'selected' : ''}>GBK</option>
                </select>
            </div>
        `;
        container.appendChild(toolbar);

        // Hex内容区
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'hex-content-wrapper';

        // 行号列（固定）
        const lineNumbers = document.createElement('div');
        lineNumbers.className = 'hex-line-numbers';

        // 内容区（可滚动）
        const scrollArea = document.createElement('div');
        scrollArea.className = 'hex-scroll-area';

        const table = document.createElement('table');
        table.className = 'hex-table';

        const rawBytes = data.raw_bytes;
        const hexLines = data.hex_lines;

        hexLines.forEach((hexLine, index) => {
            // 使用实际的偏移量
            const offset = startOffset + index * 16;
            const lineBytes = rawBytes.slice(index * 16, index * 16 + 16);

            // 行号
            const lineNumDiv = document.createElement('div');
            lineNumDiv.className = 'hex-line-num';
            lineNumDiv.textContent = offset.toString(16).toUpperCase().padStart(8, '0');
            lineNumbers.appendChild(lineNumDiv);

            // 表格行
            const tr = document.createElement('tr');
            tr.className = 'hex-row';

            // Hex列
            const tdHex = document.createElement('td');
            tdHex.className = 'hex-cell hex-bytes';
            tdHex.textContent = hexLine.padEnd(47, ' '); // 16*2 + 15空格 = 47

            // ASCII/编码列
            const tdAscii = document.createElement('td');
            tdAscii.className = 'hex-cell hex-ascii';
            tdAscii.textContent = decodeBytes(lineBytes, currentEncoding);

            tr.appendChild(tdHex);
            tr.appendChild(tdAscii);
            table.appendChild(tr);
        });

        scrollArea.appendChild(table);
        contentWrapper.appendChild(lineNumbers);
        contentWrapper.appendChild(scrollArea);
        container.appendChild(contentWrapper);

        // 同步滚动
        scrollArea.addEventListener('scroll', () => {
            lineNumbers.scrollTop = scrollArea.scrollTop;
        });

        jadxMain.innerHTML = '';
        jadxMain.appendChild(container);

        // 编码切换事件
        const encodingSelect = document.getElementById('hex-encoding-select');
        encodingSelect.addEventListener('change', (e) => {
            currentEncoding = e.target.value;
            renderHexView(currentBinaryData, isMedia);
        });

        // 分页事件
        document.getElementById('hex-first-page').addEventListener('click', () => {
            if (currentPage > 0) {
                selectFile(currentFilePath, 0, 'hex');
            }
        });

        document.getElementById('hex-prev-page').addEventListener('click', () => {
            if (currentPage > 0) {
                selectFile(currentFilePath, currentPage - 1, 'hex');
            }
        });

        document.getElementById('hex-next-page').addEventListener('click', () => {
            if (currentPage < totalPages - 1) {
                selectFile(currentFilePath, currentPage + 1, 'hex');
            }
        });

        document.getElementById('hex-last-page').addEventListener('click', () => {
            if (currentPage < totalPages - 1) {
                selectFile(currentFilePath, totalPages - 1, 'hex');
            }
        });

        // 跳转页码
        const gotoInput = document.getElementById('hex-goto-page');
        gotoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const targetPage = parseInt(gotoInput.value, 10);
                if (targetPage >= 1 && targetPage <= totalPages) {
                    selectFile(currentFilePath, targetPage - 1, 'hex');
                } else {
                    toast.show({ text: `页码范围: 1 - ${totalPages}`, color: 'warning', duration: 2000 });
                }
            }
        });

        // 预览按钮（媒体文件）
        if (isMedia) {
            const previewBtn = document.getElementById('hex-view-preview');
            if (previewBtn) {
                previewBtn.addEventListener('click', () => {
                    selectFile(currentFilePath, 0, 'preview');
                });
            }
        }
    }

    /**
     * 解码字节
     * @param {Array} bytes - 字节数组
     * @param {string} encoding - 编码
     * @returns {string} 解码后的字符串
     */
    function decodeBytes(bytes, encoding) {
        try {
            switch (encoding) {
                case 'ascii':
                    return Array.from(bytes).map(b => {
                        if (b >= 32 && b < 127) {
                            return String.fromCharCode(b);
                        }
                        return '.';
                    }).join('');

                case 'utf8':
                    try {
                        const decoder = new TextDecoder('utf-8', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(bytes.length);
                    }

                case 'utf16le':
                    try {
                        const decoder = new TextDecoder('utf-16le', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(Math.floor(bytes.length / 2));
                    }

                case 'utf16be':
                    try {
                        const decoder = new TextDecoder('utf-16be', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(Math.floor(bytes.length / 2));
                    }

                case 'gbk':
                    try {
                        const decoder = new TextDecoder('gbk', { fatal: false });
                        const text = decoder.decode(new Uint8Array(bytes));
                        return text.split('').map(c => {
                            const code = c.charCodeAt(0);
                            if (code < 32 || code === 0xFFFD) return '.';
                            return c;
                        }).join('');
                    } catch {
                        return '.'.repeat(bytes.length);
                    }

                default:
                    return '.'.repeat(bytes.length);
            }
        } catch {
            return '.'.repeat(bytes.length);
        }
    }

    /**
     * 渲染代码
     * @param {string} content - 代码内容
     * @param {string} extension - 文件扩展名
     * @param {number} highlightLine - 高亮行号
     * @param {string} searchQuery - 搜索查询
     */
    function renderCode(content, extension, highlightLine = -1, searchQuery = '') {
        const container = document.createElement('div');
        container.className = 'jadx-code-container';

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
            // 高亮失败，使用纯文本
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
                tr.id = 'highlighted-line';
            }

            const tdNum = document.createElement('td');
            tdNum.className = 'line-number';
            tdNum.textContent = index + 1;

            const tdContent = document.createElement('td');
            tdContent.className = 'line-content';

            // 高亮搜索内容（在已经语法高亮的HTML中处理）
            if (searchQuery) {
                // 需要在保留HTML标签的情况下高亮搜索词
                const searchLower = searchQuery.toLowerCase();
                const lineLower = line.replace(/<[^>]*>/g, '').toLowerCase();
                if (lineLower.includes(searchLower)) {
                    // 简单处理：在文本节点中查找并高亮
                    const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
                    tdContent.innerHTML = line.replace(regex, '<span class="search-highlight">$1</span>');
                } else {
                    tdContent.innerHTML = line;
                }
            } else {
                tdContent.innerHTML = line;
            }

            tr.appendChild(tdNum);
            tr.appendChild(tdContent);
            table.appendChild(tr);
        });

        container.appendChild(table);
        jadxMain.innerHTML = '';
        jadxMain.appendChild(container);

        // 滚动到高亮行
        if (highlightLine > 0) {
            setTimeout(() => {
                const highlightedEl = document.getElementById('highlighted-line');
                if (highlightedEl) {
                    highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    }

    /**
     * 展开文件树到指定路径（支持懒加载）
     * @param {string} filePath - 文件路径
     */
    async function expandTreeToPath(filePath) {
        const parts = filePath.split('/');
        let currentPath = '';

        for (let i = 0; i < parts.length - 1; i++) {
            currentPath += (i > 0 ? '/' : '') + parts[i];
            const nodeEl = jadxTree.querySelector(`[data-path="${currentPath}"]`);
            if (nodeEl) {
                const children = nodeEl.querySelector('.tree-node-children');
                const toggle = nodeEl.querySelector('.tree-node-toggle');
                const icon = nodeEl.querySelector('.tree-node-icon');

                if (children && children.classList.contains('collapsed')) {
                    // 如果子节点未加载，先加载
                    if (children.dataset.loaded === 'false') {
                        toggle.textContent = '...';
                        await loadSubdirectory(currentPath, children, i + 1);
                        children.dataset.loaded = 'true';
                    }
                    children.classList.remove('collapsed');
                    if (toggle) {
                        toggle.textContent = 'v';
                        toggle.classList.add('expanded');
                    }
                    if (icon) icon.innerHTML = '&#128194;';
                }
            }
        }

        // 选中文件节点
        const fileNode = jadxTree.querySelector(`[data-path="${filePath}"] > .tree-node-header`);
        if (fileNode) {
            jadxTree.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected'));
            fileNode.classList.add('selected');
            fileNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    /**
     * 处理搜索输入
     */
    function handleSearchInput() {
        clearTimeout(searchTimeout);
        const query = searchInput.value.trim();

        if (!query) {
            searchResultsList.innerHTML = '<div class="search-placeholder">输入搜索内容</div>';
            searchCount.textContent = '';
            searchPreviewContent.innerHTML = '<div class="search-placeholder">选择左侧结果预览</div>';
            searchPreviewPath.textContent = '';
            searchResults = [];
            return;
        }

        searchResultsList.innerHTML = '<div class="search-placeholder">搜索中...</div>';
        searchCount.textContent = '搜索中...';

        searchTimeout = setTimeout(async () => {
            await performSearch(query);
        }, 300);
    }

    /**
     * 执行搜索
     * @param {string} query - 搜索查询
     */
    async function performSearch(query) {
        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();

        if (selectedApkIndex < 0) {
            toast.show({ text: '请先选择一个APK', color: 'warning', duration: 2000 });
            return;
        }

        const apk = apkListData[selectedApkIndex];

        if (!apk.isDecompiled) {
            searchResultsList.innerHTML = '<div class="search-placeholder">APK尚未反编译，无法搜索</div>';
            searchCount.textContent = '';
            toast.show({ text: 'APK尚未反编译完成', color: 'warning', duration: 2000 });
            return;
        }

        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        console.log('开始搜索:', query, 'apkDir:', apkDir, 'APK名称:', apk.name);

        // 重置搜索状态
        searchResults = [];
        searchResultsList.innerHTML = '<div class="search-placeholder">搜索中...</div>';
        searchCount.textContent = '搜索中...';

        try {
            // 开始搜索
            const result = await invoke('search_jadx_files', { apkDir, query, maxResults: 500 });
            console.log('后端返回结果:', result);

            if (!result.success) {
                searchResultsList.innerHTML = `<div class="search-placeholder">${result.message}</div>`;
                searchCount.textContent = '';
                return;
            }

            searchResults = result.results;

            if (result.results.length === 0) {
                searchResultsList.innerHTML = '<div class="search-placeholder">未找到匹配结果</div>';
                searchCount.textContent = '0 个结果';
                return;
            }

            // 分批渲染搜索结果（流式显示效果）
            searchResultsList.innerHTML = '';
            searchCount.textContent = `加载中... 0/${result.total}`;

            await renderSearchResultsInBatches(result.results, query, result.total);
        } catch (error) {
            console.error('搜索失败:', error);
            searchResultsList.innerHTML = `<div class="search-placeholder">搜索失败: ${error}</div>`;
            searchCount.textContent = '';
        }
    }

    /**
     * 分批渲染搜索结果
     * @param {Array} results - 搜索结果数组
     * @param {string} query - 搜索查询
     * @param {number} total - 总结果数
     */
    async function renderSearchResultsInBatches(results, query, total) {
        const BATCH_SIZE = 50; // 每批渲染50条（增加批次大小）
        const BATCH_DELAY = 5; // 批次间隔5毫秒（减少延迟）

        for (let i = 0; i < results.length; i += BATCH_SIZE) {
            const batch = results.slice(i, i + BATCH_SIZE);

            // 使用 DocumentFragment 优化DOM操作
            const fragment = document.createDocumentFragment();

            // 渲染当前批次
            batch.forEach((res, idx) => {
                const item = createSearchResultElement(res, i + idx, query);
                fragment.appendChild(item);
            });

            searchResultsList.appendChild(fragment);

            // 更新计数
            const currentCount = Math.min(i + BATCH_SIZE, results.length);
            searchCount.textContent = `${currentCount}/${total} 个结果`;

            // 让出主线程，避免阻塞UI（最后一批不需要等待）
            if (i + BATCH_SIZE < results.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        }

        // 最终更新计数
        searchCount.textContent = `${total} 个结果`;
    }

    /**
     * 创建搜索结果元素（从appendSearchResult拆分出来）
     * @param {Object} result - 搜索结果
     * @param {number} index - 索引
     * @param {string} query - 搜索查询
     * @returns {HTMLElement}
     */
    function createSearchResultElement(result, index, query) {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.dataset.index = index;

        // 高亮匹配内容
        const beforeMatch = escapeHtml(result.line_content.substring(0, result.match_start));
        const match = escapeHtml(result.line_content.substring(result.match_start, result.match_end));
        const afterMatch = escapeHtml(result.line_content.substring(result.match_end));

        const contentDiv = document.createElement('div');
        contentDiv.className = 'search-result-content';
        contentDiv.innerHTML = `${beforeMatch}<span class="highlight">${match}</span>${afterMatch}`;

        item.innerHTML = `
            <div class="search-result-file">${escapeHtml(result.file_path)}</div>
            <div class="search-result-line">行 ${result.line_number}</div>
        `;
        item.appendChild(contentDiv);

        // 添加到列表后，滚动使高亮的关键词可见
        setTimeout(() => {
            const highlight = contentDiv.querySelector('.highlight');
            if (highlight) {
                // 计算高亮元素相对于容器的位置
                const containerWidth = contentDiv.clientWidth;
                const highlightLeft = highlight.offsetLeft;
                const highlightWidth = highlight.offsetWidth;

                // 将高亮元素滚动到容器中间
                const scrollLeft = highlightLeft - (containerWidth / 2) + (highlightWidth / 2);
                contentDiv.scrollLeft = Math.max(0, scrollLeft);
            }
        }, 0);

        // 单击选中并预览
        item.addEventListener('click', () => {
            selectSearchResult(index, query);
        });

        // 双击跳转到文件
        item.addEventListener('dblclick', async () => {
            searchOverlay.classList.add('hidden');
            currentFilePath = result.file_path;
            jadxCurrentPath.textContent = result.file_path;
            expandTreeToPath(result.file_path);

            const apkListData = getApkListData();
            const selectedApkIndex = getSelectedApkIndex();
            const apk = apkListData[selectedApkIndex];
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

            try {
                const fileResult = await invoke('read_jadx_file', { apkDir, filePath: result.file_path });
                if (fileResult.success) {
                    renderCode(fileResult.content, fileResult.extension, result.line_number, query);
                }
            } catch (error) {
                console.error('读取文件失败:', error);
            }
        });

        return item;
    }

    /**
     * 添加单个搜索结果到列表（保留用于兼容性）
     * @param {Object} result - 搜索结果
     * @param {number} index - 索引
     * @param {string} query - 搜索查询
     */
    function appendSearchResult(result, index, query) {
        const item = createSearchResultElement(result, index, query);
        searchResultsList.appendChild(item);
    }

    /**
     * 选中搜索结果
     * @param {number} index - 结果索引
     * @param {string} query - 搜索查询
     */
    async function selectSearchResult(index, query) {
        // 更新选中状态
        searchResultsList.querySelectorAll('.search-result-item').forEach(item => {
            item.classList.remove('selected');
        });
        const selectedItem = searchResultsList.querySelector(`[data-index="${index}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        selectedSearchIndex = index;
        const result = searchResults[index];

        searchPreviewPath.textContent = result.file_path;

        const apkListData = getApkListData();
        const selectedApkIndex = getSelectedApkIndex();
        const apk = apkListData[selectedApkIndex];
        const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;

        try {
            const fileResult = await invoke('read_jadx_file', { apkDir, filePath: result.file_path });

            if (fileResult.success) {
                renderPreviewCode(fileResult.content, result.line_number, query, fileResult.extension);
            } else {
                searchPreviewContent.innerHTML = `<div class="search-placeholder">${fileResult.message}</div>`;
            }
        } catch (error) {
            searchPreviewContent.innerHTML = `<div class="search-placeholder">加载失败: ${error}</div>`;
        }
    }

    /**
     * 渲染预览代码（带语法高亮）
     * @param {string} content - 代码内容
     * @param {number} highlightLine - 高亮行号
     * @param {string} searchQuery - 搜索查询
     * @param {string} extension - 文件扩展名
     */
    function renderPreviewCode(content, highlightLine, searchQuery, extension = '') {
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
            // 高亮失败，使用纯文本
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
                tr.id = 'preview-highlighted-line';
            }

            const tdNum = document.createElement('td');
            tdNum.className = 'line-number';
            tdNum.textContent = index + 1;

            const tdContent = document.createElement('td');
            tdContent.className = 'line-content';

            // 在已经语法高亮的HTML中高亮搜索内容
            if (searchQuery) {
                const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
                tdContent.innerHTML = line.replace(regex, '<span class="search-highlight">$1</span>');
            } else {
                tdContent.innerHTML = line;
            }

            tr.appendChild(tdNum);
            tr.appendChild(tdContent);
            table.appendChild(tr);
        });

        searchPreviewContent.innerHTML = '';
        searchPreviewContent.appendChild(table);

        // 滚动到高亮行
        setTimeout(() => {
            const highlightedEl = document.getElementById('preview-highlighted-line');
            if (highlightedEl) {
                highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    /**
     * 处理JADX侧边栏拖拽开始
     */
    function handleJadxResizerMousedown(e) {
        isResizingJadx = true;
        jadxResizer.classList.add('active');
        document.addEventListener('mousemove', handleJadxResize);
        document.addEventListener('mouseup', stopJadxResize);
    }

    /**
     * 处理JADX侧边栏拖拽
     */
    function handleJadxResize(e) {
        if (!isResizingJadx) return;
        const containerRect = jadxOverlay.querySelector('.overlay-content').getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 200 && newWidth <= 500) {
            jadxSidebar.style.width = newWidth + 'px';
        }
    }

    /**
     * 停止JADX侧边栏拖拽
     */
    function stopJadxResize() {
        isResizingJadx = false;
        jadxResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleJadxResize);
        document.removeEventListener('mouseup', stopJadxResize);
    }

    /**
     * 处理搜索结果面板拖拽开始
     */
    function handleSearchResizerMousedown(e) {
        isResizingSearch = true;
        searchResizer.classList.add('active');
        document.addEventListener('mousemove', handleSearchResize);
        document.addEventListener('mouseup', stopSearchResize);
    }

    /**
     * 处理搜索结果面板拖拽
     */
    function handleSearchResize(e) {
        if (!isResizingSearch) return;
        const containerRect = searchOverlay.querySelector('.search-content').getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        if (newWidth >= 250 && newWidth <= 600) {
            searchResultsPanel.style.width = newWidth + 'px';
        }
    }

    /**
     * 停止搜索结果面板拖拽
     */
    function stopSearchResize() {
        isResizingSearch = false;
        searchResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleSearchResize);
        document.removeEventListener('mouseup', stopSearchResize);
    }

    /**
     * 打开JADX查看器
     */
    async function open() {
        await handleOpenJadxViewer();
    }

    /**
     * 关闭JADX查看器
     */
    function close() {
        if (jadxOverlay) {
            jadxOverlay.classList.add('hidden');
        }

        // 隐藏 AI 分析按钮
        hideAIButton();
    }

    /**
     * 获取当前文件路径
     * @returns {string|null} 当前文件路径
     */
    function getCurrentFilePath() {
        return currentFilePath;
    }

    /**
     * 获取当前文件内容
     * @returns {string|null} 当前文件的原始文本内容
     */
    function getCurrentFileContent() {
        return currentFileContent;
    }

    // 暴露公共API
    return {
        init: init,
        open: open,
        close: close,
        loadJadxFileTree: loadJadxFileTree,
        renderFileTree: renderFileTree,
        loadSubdirectory: loadSubdirectory,
        getFileIcon: getFileIcon,
        selectFile: selectFile,
        renderImageView: renderImageView,
        renderAudioView: renderAudioView,
        renderVideoView: renderVideoView,
        renderHexView: renderHexView,
        decodeBytes: decodeBytes,
        renderCode: renderCode,
        expandTreeToPath: expandTreeToPath,
        performSearch: performSearch,
        selectSearchResult: selectSearchResult,
        renderPreviewCode: renderPreviewCode,
        getCurrentFilePath: getCurrentFilePath,
        getCurrentFileContent: getCurrentFileContent
    };
})();
