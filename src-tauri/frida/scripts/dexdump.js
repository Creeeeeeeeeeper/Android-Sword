#!/usr/bin/env node

/**
 * DEX Dump Wrapper Script
 * 自动执行 frida-dexdump 并保存到 temp 目录
 * 
 * Usage: node dexdump.js <package_name>
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 配置
const FRIDA_DEXDUMP = path.join(__dirname, '..', 'tools', 'python', 'Scripts', 'frida-dexdump.exe');
const ADB_PATH = path.join(__dirname, '..', 'tools', 'scrcpy-win64-v3.3.4', 'adb.exe');
const TEMP_DIR = path.join(__dirname, '..', 'temp');

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
DEX Dump Wrapper
================

自动执行 frida-dexdump 提取应用的DEX文件

用法:
  node dexdump.js <包名>

参数:
  <包名>          目标应用的包名 (必需)

选项:
  -h, --help     显示帮助信息

示例:
  node dexdump.js com.example.app
  node dexdump.js net.net

输出:
  DEX文件将保存到: temp/<包名>_<时间戳>/

前置要求:
  1. 设备已连接并开启USB调试
  2. frida-server已在设备上运行
  3. 目标应用已安装

命令说明:
  实际执行: frida-dexdump -U -f <包名> -o temp/<包名>_<时间戳>
  
  -U         : 使用USB连接的设备
  -f <包名>  : Spawn模式启动应用
  -o <路径>  : 输出目录
    `);
}

/**
 * 生成时间戳
 */
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hour}${minute}${second}`;
}

/**
 * 确保目录存在
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[+] 创建目录: ${dir}`);
    }
}

/**
 * 检查ADB设备连接
 */
function checkAdbDevice() {
    console.log('[*] 检查ADB设备连接...');

    // 检查ADB是否存在
    if (!fs.existsSync(ADB_PATH)) {
        console.error(`[!] 错误: 找不到 adb.exe`);
        console.error(`[!] 期望路径: ${ADB_PATH}`);
        return false;
    }

    try {
        // 执行 adb devices
        const output = execSync(`"${ADB_PATH}" devices`, { encoding: 'utf8' });
        const lines = output.split('\n').filter(line => line.trim() && !line.includes('List of devices'));

        if (lines.length === 0) {
            console.error('[!] 错误: 未检测到已连接的设备');
            console.error('[!] 请确保:');
            console.error('    1. 设备已通过USB连接');
            console.error('    2. 设备已开启USB调试');
            console.error('    3. 已授权调试连接');
            return false;
        }

        // 显示已连接的设备
        console.log(`[+] 已连接 ${lines.length} 个设备:`);
        lines.forEach(line => {
            const match = line.trim().match(/^(\S+)\s+(\S+)/);
            if (match) {
                const [, deviceId, status] = match;
                const statusText = status === 'device' ? '已授权' : status;
                console.log(`    - ${deviceId} (${statusText})`);
            }
        });

        return true;
    } catch (error) {
        console.error(`[!] ADB检查失败: ${error.message}`);
        return false;
    }
}

/**
 * 检查应用是否安装
 */
function checkAppInstalled(packageName) {
    console.log(`[*] 检查应用是否安装: ${packageName}...`);

    try {
        const output = execSync(`"${ADB_PATH}" shell pm list packages | grep "${packageName}"`, { encoding: 'utf8' });

        if (output.includes(packageName)) {
            console.log(`[+] 应用已安装: ${packageName}`);
            return true;
        } else {
            console.error(`[!] 错误: 应用未安装: ${packageName}`);
            console.error('[!] 请先安装目标应用');
            return false;
        }
    } catch (error) {
        // grep没有找到匹配时会返回非零退出码
        console.error(`[!] 错误: 应用未安装: ${packageName}`);
        console.error('[!] 请先安装目标应用');
        return false;
    }
}

/**
 * 执行 frida-dexdump
 */
function runDexDump(packageName) {
    console.log('\n' + '='.repeat(80));
    console.log('Frida DEX Dump');
    console.log('='.repeat(80) + '\n');

    // 1. 检查 ADB 设备连接
    if (!checkAdbDevice()) {
        console.log('\n' + '='.repeat(80));
        process.exit(1);
    }

    // 2. 检查应用是否安装
    if (!checkAppInstalled(packageName)) {
        console.log('\n' + '='.repeat(80));
        process.exit(1);
    }

    // 生成输出目录名
    const timestamp = getTimestamp();
    const outputDir = path.join(TEMP_DIR, `${packageName}_${timestamp}`);

    // 确保temp目录存在
    ensureDir(TEMP_DIR);

    console.log(`\n[*] 目标包名: ${packageName}`);
    console.log(`[*] 输出目录: ${outputDir}`);
    console.log(`[*] frida-dexdump: ${FRIDA_DEXDUMP}`);
    console.log(`[*] ADB路径: ${ADB_PATH}\n`);

    // 检查 frida-dexdump 是否存在
    if (!fs.existsSync(FRIDA_DEXDUMP)) {
        console.error(`[!] 错误: 找不到 frida-dexdump`);
        console.error(`[!] 期望路径: ${FRIDA_DEXDUMP}`);
        console.error(`[!] 请确保已安装 frida-dexdump 到虚拟环境中`);
        process.exit(1);
    }

    // 构建命令参数
    const args = [
        '-U',              // USB设备
        '-f', packageName, // Spawn模式
        '-o', outputDir    // 输出目录
    ];

    console.log(`[*] 执行命令: ${path.basename(FRIDA_DEXDUMP)} ${args.join(' ')}\n`);
    console.log('='.repeat(80));
    console.log('[*] 正在dump DEX文件，请稍候...\n');

    // 执行命令
    const proc = spawn(FRIDA_DEXDUMP, args, {
        stdio: 'inherit',  // 继承stdio以显示输出
        shell: true        // 使用shell执行
    });

    proc.on('error', (error) => {
        console.error(`\n[!] 执行失败: ${error.message}`);
        process.exit(1);
    });

    proc.on('close', (code) => {
        console.log('\n' + '='.repeat(80));
        if (code === 0) {
            console.log('[+] DEX Dump 完成!');
            console.log(`[+] 输出目录: ${outputDir}`);

            // 列出输出文件
            if (fs.existsSync(outputDir)) {
                const files = fs.readdirSync(outputDir);
                if (files.length > 0) {
                    console.log(`[+] 提取的文件 (${files.length}个):`);
                    files.forEach(file => {
                        const filePath = path.join(outputDir, file);
                        const stats = fs.statSync(filePath);
                        const size = (stats.size / 1024).toFixed(2);
                        console.log(`    - ${file} (${size} KB)`);
                    });
                } else {
                    console.log('[!] 输出目录为空');
                }
            }
        } else {
            console.log(`[!] DEX Dump 失败 (退出码: ${code})`);
            console.log('\n可能的原因:');
            console.log('  1. frida-server未运行');
            console.log('  2. 应用有反调试保护');
            console.log('  3. frida版本不兼容');
            console.log('\n排查步骤:');
            console.log(`  1. 检查frida-server: "${ADB_PATH}" shell "ps | grep frida"`);
            console.log('  2. 尝试手动启动frida-server');
            console.log('  3. 检查frida版本匹配');
        }
        console.log('='.repeat(80) + '\n');
        process.exit(code);
    });
}

/**
 * 主函数
 */
function main() {
    const args = process.argv.slice(2);
    
    // 显示帮助
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        showHelp();
        process.exit(0);
    }
    
    const packageName = args[0];
    
    // 验证包名格式（简单检查）
    if (!packageName.includes('.')) {
        console.error('\n[!] 错误: 包名格式不正确');
        console.error('[!] 包名应该类似: com.example.app\n');
        process.exit(1);
    }
    
    runDexDump(packageName);
}

// 执行主函数
if (require.main === module) {
    main();
}

module.exports = { runDexDump };
