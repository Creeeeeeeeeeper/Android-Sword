/**
 * 拦截应用退出脚本
 * 功能：拦截应用的各种退出方式，防止应用自动退出
 * 覆盖：System.exit、Process.killProcess、Activity.finish等
 */

Java.perform(function () {
    console.log("[*] 开始加载应用退出拦截脚本...");

    // ======== 1. 拦截System.exit ========
    try {
        var System = Java.use("java.lang.System");

        System.exit.implementation = function (status) {
            console.log("[!] 拦截System.exit(" + status + ")");
            showStackTrace();
            // 不执行退出
        };

        console.log("[+] System.exit Hook完成");
    } catch (e) {
        console.log("[-] System.exit Hook失败: " + e);
    }

    // ======== 2. 拦截Runtime.exit ========
    try {
        var Runtime = Java.use("java.lang.Runtime");

        Runtime.exit.implementation = function (status) {
            console.log("[!] 拦截Runtime.exit(" + status + ")");
            showStackTrace();
            // 不执行退出
        };

        console.log("[+] Runtime.exit Hook完成");
    } catch (e) {
        console.log("[-] Runtime.exit Hook失败: " + e);
    }

    // ======== 3. 拦截Process.killProcess ========
    try {
        var Process = Java.use("android.os.Process");

        Process.killProcess.implementation = function (pid) {
            var myPid = Process.myPid();
            if (pid === myPid) {
                console.log("[!] 拦截Process.killProcess(自身进程PID: " + pid + ")");
                showStackTrace();
                // 不执行杀进程
            } else {
                console.log("[*] Process.killProcess(PID: " + pid + ")，允许执行");
                this.killProcess(pid);
            }
        };

        console.log("[+] Process.killProcess Hook完成");
    } catch (e) {
        console.log("[-] Process.killProcess Hook失败: " + e);
    }

    // ======== 4. 拦截Activity.finish ========
    try {
        var Activity = Java.use("android.app.Activity");

        Activity.finish.overload().implementation = function () {
            console.log("[!] 拦截Activity.finish(): " + this.getClass().getName());
            showStackTrace();
            // 不执行finish
        };

        Activity.finish.overload("int").implementation = function (finishTask) {
            console.log("[!] 拦截Activity.finish(" + finishTask + "): " + this.getClass().getName());
            showStackTrace();
            // 不执行finish
        };

        console.log("[+] Activity.finish Hook完成");
    } catch (e) {
        console.log("[-] Activity.finish Hook失败: " + e);
    }

    // ======== 5. 拦截Activity.finishAffinity ========
    try {
        var Activity = Java.use("android.app.Activity");

        Activity.finishAffinity.implementation = function () {
            console.log("[!] 拦截Activity.finishAffinity(): " + this.getClass().getName());
            showStackTrace();
            // 不执行
        };

        console.log("[+] Activity.finishAffinity Hook完成");
    } catch (e) {
        console.log("[-] Activity.finishAffinity Hook失败: " + e);
    }

    // ======== 6. 拦截Activity.finishAndRemoveTask ========
    try {
        var Activity = Java.use("android.app.Activity");

        Activity.finishAndRemoveTask.implementation = function () {
            console.log("[!] 拦截Activity.finishAndRemoveTask(): " + this.getClass().getName());
            showStackTrace();
            // 不执行
        };

        console.log("[+] Activity.finishAndRemoveTask Hook完成");
    } catch (e) {
        console.log("[-] Activity.finishAndRemoveTask Hook失败: " + e);
    }

    // ======== 7. 拦截Activity.moveTaskToBack ========
    try {
        var Activity = Java.use("android.app.Activity");

        Activity.moveTaskToBack.implementation = function (nonRoot) {
            console.log("[!] 拦截Activity.moveTaskToBack(" + nonRoot + "): " + this.getClass().getName());
            showStackTrace();
            return false; // 返回false表示未移动
        };

        console.log("[+] Activity.moveTaskToBack Hook完成");
    } catch (e) {
        console.log("[-] Activity.moveTaskToBack Hook失败: " + e);
    }

    // ======== 8. 拦截ActivityManager.forceStopPackage ========
    try {
        var ActivityManager = Java.use("android.app.ActivityManager");

        ActivityManager.forceStopPackage.implementation = function (packageName) {
            console.log("[!] 拦截ActivityManager.forceStopPackage: " + packageName);
            showStackTrace();
            // 不执行
        };

        console.log("[+] ActivityManager.forceStopPackage Hook完成");
    } catch (e) {
        console.log("[-] ActivityManager.forceStopPackage Hook失败: " + e);
    }

    // ======== 9. 拦截Native层exit ========
    try {
        var exitPtr = Module.findExportByName("libc.so", "exit");
        if (exitPtr) {
            Interceptor.attach(exitPtr, {
                onEnter: function (args) {
                    console.log("[!] 拦截Native exit(" + args[0].toInt32() + ")");
                    // 打印调用栈
                    console.log(Thread.backtrace(this.context, Backtracer.ACCURATE).map(DebugSymbol.fromAddress).join("\n"));
                    // 阻止退出 - 替换为无操作
                }
            });
            console.log("[+] Native exit Hook完成");
        }

        var _exitPtr = Module.findExportByName("libc.so", "_exit");
        if (_exitPtr) {
            Interceptor.attach(_exitPtr, {
                onEnter: function (args) {
                    console.log("[!] 拦截Native _exit(" + args[0].toInt32() + ")");
                }
            });
            console.log("[+] Native _exit Hook完成");
        }
    } catch (e) {
        console.log("[-] Native exit Hook失败: " + e);
    }

    // ======== 10. 拦截abort ========
    try {
        var abortPtr = Module.findExportByName("libc.so", "abort");
        if (abortPtr) {
            Interceptor.attach(abortPtr, {
                onEnter: function (args) {
                    console.log("[!] 拦截Native abort()");
                    console.log(Thread.backtrace(this.context, Backtracer.ACCURATE).map(DebugSymbol.fromAddress).join("\n"));
                }
            });
            console.log("[+] Native abort Hook完成");
        }
    } catch (e) {
        console.log("[-] Native abort Hook失败: " + e);
    }

    // ======== 辅助函数：打印Java堆栈 ========
    function showStackTrace() {
        try {
            var Log = Java.use("android.util.Log");
            var Throwable = Java.use("java.lang.Throwable");
            var stackTrace = Log.getStackTraceString(Throwable.$new());
            console.log("[Stack Trace]\n" + stackTrace);
        } catch (e) {
            console.log("[-] 无法获取堆栈: " + e);
        }
    }

    console.log("[*] 应用退出拦截脚本加载完成");
    console.log("[!] 注意: 应用尝试退出时将被拦截并显示调用栈");
});
