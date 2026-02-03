/**
 * 绕过调试检测脚本
 * 功能：绕过各种反调试检测
 * 覆盖：ptrace、TracerPid、isDebuggerConnected、Debug类等
 */

Java.perform(function () {
    console.log("[*] 开始加载调试检测绕过脚本...");

    // ======== 1. 绕过Debug.isDebuggerConnected ========
    try {
        var Debug = Java.use("android.os.Debug");

        Debug.isDebuggerConnected.implementation = function () {
            console.log("[+] Debug.isDebuggerConnected返回false");
            return false;
        };

        Debug.waitingForDebugger.implementation = function () {
            console.log("[+] Debug.waitingForDebugger返回false");
            return false;
        };

        console.log("[+] Debug类Hook完成");
    } catch (e) {
        console.log("[-] Debug类Hook失败: " + e);
    }

    // ======== 2. 绕过ApplicationInfo flags检测 ========
    try {
        var ApplicationInfo = Java.use("android.content.pm.ApplicationInfo");

        // FLAG_DEBUGGABLE = 0x2
        var originalFlags = ApplicationInfo.flags.value;

        Object.defineProperty(ApplicationInfo.class, "flags", {
            get: function () {
                return this._flags & ~0x2; // 移除FLAG_DEBUGGABLE
            },
            set: function (val) {
                this._flags = val;
            }
        });

        console.log("[+] ApplicationInfo.flags Hook完成");
    } catch (e) {
        console.log("[-] ApplicationInfo.flags Hook失败: " + e);
    }

    // ======== 3. 绕过ActivityManager检测调试进程 ========
    try {
        var ActivityManager = Java.use("android.app.ActivityManager");

        ActivityManager.isUserAMonkey.implementation = function () {
            console.log("[+] isUserAMonkey返回false");
            return false;
        };

        console.log("[+] ActivityManager Hook完成");
    } catch (e) {
        console.log("[-] ActivityManager Hook失败: " + e);
    }

    // ======== 4. 绕过Settings.Global/Secure检测 ========
    try {
        var SettingsGlobal = Java.use("android.provider.Settings$Global");

        SettingsGlobal.getInt.overload("android.content.ContentResolver", "java.lang.String", "int").implementation = function (resolver, name, def) {
            if (name === "adb_enabled" || name === "development_settings_enabled") {
                console.log("[+] Settings.Global." + name + " 返回0");
                return 0;
            }
            return this.getInt(resolver, name, def);
        };

        SettingsGlobal.getInt.overload("android.content.ContentResolver", "java.lang.String").implementation = function (resolver, name) {
            if (name === "adb_enabled" || name === "development_settings_enabled") {
                console.log("[+] Settings.Global." + name + " 返回0");
                return 0;
            }
            return this.getInt(resolver, name);
        };

        console.log("[+] Settings.Global Hook完成");
    } catch (e) {
        console.log("[-] Settings.Global Hook失败: " + e);
    }

    // ======== 5. 绕过读取/proc/self/status检测TracerPid ========
    try {
        var BufferedReader = Java.use("java.io.BufferedReader");

        BufferedReader.readLine.implementation = function () {
            var line = this.readLine();
            if (line !== null && line.indexOf("TracerPid") !== -1) {
                console.log("[+] 修改TracerPid为0");
                return "TracerPid:\t0";
            }
            return line;
        };

        console.log("[+] TracerPid检测绕过完成");
    } catch (e) {
        console.log("[-] TracerPid检测绕过失败: " + e);
    }

    // ======== 6. Native层ptrace检测绕过 ========
    try {
        var ptracePtr = Module.findExportByName(null, "ptrace");
        if (ptracePtr) {
            Interceptor.attach(ptracePtr, {
                onEnter: function (args) {
                    this.request = args[0].toInt32();
                    // PTRACE_TRACEME = 0
                    if (this.request === 0) {
                        console.log("[+] 检测到ptrace(PTRACE_TRACEME)调用");
                    }
                },
                onLeave: function (retval) {
                    if (this.request === 0) {
                        console.log("[+] ptrace返回0（假装成功）");
                        retval.replace(0);
                    }
                }
            });
            console.log("[+] Native ptrace Hook完成");
        }
    } catch (e) {
        console.log("[-] Native ptrace Hook失败: " + e);
    }

    // ======== 7. 绕过fork检测调试器 ========
    try {
        var forkPtr = Module.findExportByName("libc.so", "fork");
        if (forkPtr) {
            Interceptor.attach(forkPtr, {
                onLeave: function (retval) {
                    // 如果是反调试的fork检测，可以在这里处理
                    // 通常fork后子进程会尝试ptrace父进程
                }
            });
            console.log("[+] Native fork监控完成");
        }
    } catch (e) {
        console.log("[-] Native fork Hook失败: " + e);
    }

    // ======== 8. 绕过时间检测（调试时代码执行变慢） ========
    try {
        var SystemClock = Java.use("android.os.SystemClock");

        var timeOffset = 0;
        var lastTime = 0;

        SystemClock.elapsedRealtime.implementation = function () {
            var realTime = this.elapsedRealtime();
            // 如果时间差太大（可能是调试导致），调整返回值
            if (lastTime > 0 && realTime - lastTime > 5000) {
                timeOffset += (realTime - lastTime - 100);
                console.log("[+] 检测到时间跳跃，调整时间偏移");
            }
            lastTime = realTime;
            return realTime - timeOffset;
        };

        console.log("[+] SystemClock时间检测绕过完成");
    } catch (e) {
        console.log("[-] SystemClock Hook失败: " + e);
    }

    // ======== 9. 绕过Build.TYPE检测 ========
    try {
        var Build = Java.use("android.os.Build");
        Build.TYPE.value = "user";
        console.log("[+] Build.TYPE已设置为user");
    } catch (e) {
        console.log("[-] Build.TYPE设置失败: " + e);
    }

    // ======== 10. 绕过运行时检测Frida/Xposed ========
    try {
        // 隐藏Frida特征进程名
        var Runtime = Java.use("java.lang.Runtime");

        Runtime.exec.overload("java.lang.String").implementation = function (cmd) {
            if (cmd.indexOf("frida") !== -1 ||
                cmd.indexOf("xposed") !== -1 ||
                cmd.indexOf("substrate") !== -1) {
                console.log("[+] 阻止检测命令: " + cmd);
                throw Java.use("java.io.IOException").$new("Permission denied");
            }
            return this.exec(cmd);
        };

        console.log("[+] Frida/Xposed检测绕过完成");
    } catch (e) {
        console.log("[-] Frida/Xposed检测绕过失败: " + e);
    }

    console.log("[*] 调试检测绕过脚本加载完成");
});
