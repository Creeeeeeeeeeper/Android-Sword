/**
 * Details Module - 详细信息模块
 * 负责APK详细信息的加载和渲染（哈希、四大组件、签名信息）
 */
(function() {
    'use strict';

    // 依赖注入
    let invoke = null;
    let caseNumber = null;
    let escapeHtml = null;
    let getApkListData = null;
    let getSelectedApkIndex = null;

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

        console.log('DetailsModule 初始化完成');
    }

    /**
     * 加载详细信息（对外暴露的主入口）
     * @param {Object} apk - APK对象
     */
    async function load(apk) {
        return loadDetails(apk);
    }

    /**
     * 加载APK详细信息（哈希和签名）
     * @param {Object} apk - APK对象
     */
    async function loadDetails(apk) {
        const detailsPanel = document.getElementById('tab-details');

        if (!apk) {
            detailsPanel.innerHTML = '<div class="operation-panel-placeholder">上传一个apk开始分析</div>';
            return;
        }

        // 显示加载状态
        detailsPanel.innerHTML = '<div class="details-loading"><div class="spinner"></div><span>正在分析APK详细信息...</span></div>';

        try {
            const apkDir = `case/${caseNumber}/apks/${apk.timestamp}`;
            const result = await invoke('get_apk_details', { apkDir: apkDir });

            if (!result.success) {
                detailsPanel.innerHTML = `<div class="operation-panel-placeholder">${result.message}</div>`;
                return;
            }

            renderDetails(result, apk);
        } catch (error) {
            console.error('获取详细信息失败:', error);
            detailsPanel.innerHTML = `<div class="operation-panel-placeholder">获取详细信息失败: ${error}</div>`;
        }
    }

    /**
     * 渲染详细信息
     * @param {Object} data - 详细信息数据
     * @param {Object} apk - APK对象
     */
    function renderDetails(data, apk) {
        const detailsPanel = document.getElementById('tab-details');
        const { hashes, components, signature } = data;

        // 构建文件哈希部分
        const hashesHtml = `
            <div class="details-section">
                <div class="details-section-title">安装文件哈希</div>
                <div class="details-hash-list">
                    <div class="details-hash-item">
                        <span class="hash-label">MD5</span>
                        <span class="hash-value" title="点击复制" data-hash="${hashes.md5}">${hashes.md5}</span>
                    </div>
                    <div class="details-hash-item">
                        <span class="hash-label">SHA-1</span>
                        <span class="hash-value" title="点击复制" data-hash="${hashes.sha1}">${hashes.sha1}</span>
                    </div>
                    <div class="details-hash-item">
                        <span class="hash-label">SHA-256</span>
                        <span class="hash-value" title="点击复制" data-hash="${hashes.sha256}">${hashes.sha256}</span>
                    </div>
                </div>
            </div>
        `;

        // 构建四大组件部分
        const componentsHtml = buildComponentsHtml(components);

        // 构建签名信息部分
        let signatureHtml = '';
        if (signature.error) {
            signatureHtml = `
                <div class="details-section">
                    <div class="details-section-title">签名信息</div>
                    <div class="details-error">${signature.error}</div>
                </div>
            `;
        } else {
            // 签名验证状态
            const verifiedClass = signature.verified ? 'verified' : 'not-verified';
            const verifiedText = signature.verified ? '签名验证通过' : '签名验证失败';

            // 签名方案
            const schemesHtml = signature.signatureSchemes && signature.signatureSchemes.length > 0
                ? signature.signatureSchemes.map(scheme => `<span class="scheme-badge">${scheme}</span>`).join('')
                : '<span class="scheme-badge unknown">未知</span>';

            // 签名者信息
            let signersHtml = '';
            if (signature.signers && signature.signers.length > 0) {
                signersHtml = signature.signers.map((signer, index) => {
                    const signerItems = [];

                    if (signer.dn) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">DN</span><span class="signer-value">${escapeHtml(signer.dn)}</span></div>`);
                    }
                    if (signer.keyAlgorithm) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">密钥算法</span><span class="signer-value">${signer.keyAlgorithm}</span></div>`);
                    }
                    if (signer.keySize) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">密钥长度</span><span class="signer-value">${signer.keySize} bits</span></div>`);
                    }
                    if (signer.sha256Digest) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">证书 SHA-256</span><span class="signer-value hash-value" title="点击复制" data-hash="${signer.sha256Digest}">${signer.sha256Digest}</span></div>`);
                    }
                    if (signer.sha1Digest) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">证书 SHA-1</span><span class="signer-value hash-value" title="点击复制" data-hash="${signer.sha1Digest}">${signer.sha1Digest}</span></div>`);
                    }
                    if (signer.md5Digest) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">证书 MD5</span><span class="signer-value hash-value" title="点击复制" data-hash="${signer.md5Digest}">${signer.md5Digest}</span></div>`);
                    }
                    if (signer.publicKeySha256) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">公钥 SHA-256</span><span class="signer-value hash-value" title="点击复制" data-hash="${signer.publicKeySha256}">${signer.publicKeySha256}</span></div>`);
                    }
                    if (signer.publicKeySha1) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">公钥 SHA-1</span><span class="signer-value hash-value" title="点击复制" data-hash="${signer.publicKeySha1}">${signer.publicKeySha1}</span></div>`);
                    }
                    if (signer.publicKeyMd5) {
                        signerItems.push(`<div class="signer-item"><span class="signer-label">公钥 MD5</span><span class="signer-value hash-value" title="点击复制" data-hash="${signer.publicKeyMd5}">${signer.publicKeyMd5}</span></div>`);
                    }

                    return `
                        <div class="signer-card">
                            <div class="signer-header">签名者 #${index + 1}</div>
                            <div class="signer-content">
                                ${signerItems.join('')}
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                signersHtml = '<div class="details-empty">未找到签名者信息</div>';
            }

            signatureHtml = `
                <div class="details-section">
                    <div class="details-section-title">签名验证</div>
                    <div class="verification-status ${verifiedClass}">
                        <span class="verification-icon">${signature.verified ? '✓' : '✗'}</span>
                        <span class="verification-text">${verifiedText}</span>
                    </div>
                </div>
                <div class="details-section">
                    <div class="details-section-title">签名方案</div>
                    <div class="schemes-container">
                        ${schemesHtml}
                    </div>
                </div>
                <div class="details-section">
                    <div class="details-section-title">签名者证书</div>
                    <div class="signers-container">
                        ${signersHtml}
                    </div>
                </div>
            `;
        }

        detailsPanel.innerHTML = `
            <div class="details-container">
                ${hashesHtml}
                ${componentsHtml}
                ${signatureHtml}
            </div>
        `;

        // 初始化组件折叠/展开功能
        initComponentsToggle();

        // 初始化哈希值点击复制功能
        initHashCopy();
    }

    /**
     * 构建四大组件HTML
     * @param {Object} components - 组件数据
     * @returns {string} HTML字符串
     */
    function buildComponentsHtml(components) {
        if (!components) {
            return '';
        }

        const componentTypes = [
            { key: 'activities', name: 'Activity' },
            { key: 'services', name: 'Service' },
            { key: 'receivers', name: 'Receiver' },
            { key: 'providers', name: 'Provider' }
        ];

        let html = '<div class="details-section components-section">';
        html += '<div class="details-section-title">四大组件</div>';
        html += '<div class="components-wrapper">';

        for (const type of componentTypes) {
            const items = components[type.key] || [];
            const count = items.length;

            html += `
                <div class="component-group" data-component="${type.key}">
                    <div class="component-header">
                        <div class="component-header-left">
                            <span class="component-name">${type.name}</span>
                            <span class="component-count">${count}</span>
                        </div>
                        <div class="component-toggle collapsed">
                            <span class="toggle-icon">▼</span>
                        </div>
                    </div>
                    <div class="component-content collapsed">
                        <div class="component-list">
                            ${items.length > 0
                                ? items.map(item => `<div class="component-item" title="${escapeHtml(item)}">${escapeHtml(item)}</div>`).join('')
                                : '<div class="component-empty">无</div>'
                            }
                        </div>
                    </div>
                </div>
            `;
        }

        html += '</div></div>';
        return html;
    }

    /**
     * 初始化组件折叠/展开功能
     */
    function initComponentsToggle() {
        const componentGroups = document.querySelectorAll('.component-group');

        componentGroups.forEach(group => {
            const header = group.querySelector('.component-header');
            const toggle = group.querySelector('.component-toggle');
            const content = group.querySelector('.component-content');

            // 移除可能存在的旧事件监听器（通过克隆节点）
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);

            // 重新获取引用
            const newToggle = group.querySelector('.component-toggle');
            const newContent = group.querySelector('.component-content');

            newHeader.addEventListener('click', () => {
                const isCollapsed = newContent.classList.contains('collapsed');

                if (isCollapsed) {
                    // 展开
                    newContent.classList.remove('collapsed');
                    newToggle.classList.remove('collapsed');
                } else {
                    // 收起
                    newContent.classList.add('collapsed');
                    newToggle.classList.add('collapsed');
                }
            });
        });
    }

    /**
     * 初始化哈希值点击复制功能
     */
    function initHashCopy() {
        const hashValues = document.querySelectorAll('.hash-value[data-hash]');

        hashValues.forEach(element => {
            element.style.cursor = 'pointer';
            element.addEventListener('click', async () => {
                const hash = element.dataset.hash;
                if (hash) {
                    try {
                        await navigator.clipboard.writeText(hash);
                        // 显示复制成功的视觉反馈
                        const originalText = element.textContent;
                        element.textContent = '已复制!';
                        element.classList.add('copied');
                        setTimeout(() => {
                            element.textContent = originalText;
                            element.classList.remove('copied');
                        }, 1000);
                    } catch (err) {
                        console.error('复制失败:', err);
                        // 备用方案：使用旧的复制方法
                        const textArea = document.createElement('textarea');
                        textArea.value = hash;
                        textArea.style.position = 'fixed';
                        textArea.style.left = '-9999px';
                        document.body.appendChild(textArea);
                        textArea.select();
                        try {
                            document.execCommand('copy');
                            element.textContent = '已复制!';
                            element.classList.add('copied');
                            setTimeout(() => {
                                element.textContent = hash;
                                element.classList.remove('copied');
                            }, 1000);
                        } catch (e) {
                            console.error('备用复制方法失败:', e);
                        }
                        document.body.removeChild(textArea);
                    }
                }
            });
        });
    }

    // 暴露模块接口
    window.DetailsModule = {
        init,
        load,
        loadDetails,
        renderDetails,
        buildComponentsHtml,
        initComponentsToggle,
        initHashCopy
    };

})();
