/**
 * 绕过ROOT检测脚本
 * 功能：绕过常见的ROOT检测方法
 * 覆盖：su文件检测、Runtime.exec检测、Build.TAGS检测、包管理器检测、系统属性检测
 */

Java.perform(function () {
    console.log("[*] 开始加载ROOT检测绕过脚本...");

    // ROOT相关路径
    var rootPaths = [
        "/system/app/Superuser.apk",
        "/sbin/su",
        "/system/bin/su",
        "/system/xbin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/system/sd/xbin/su",
        "/system/bin/failsafe/su",
        "/data/local/su",
        "/su/bin/su",
        "/system/bin/.ext/.su",
        "/system/usr/we-need-root/su-backup",
        "/system/xbin/mu",
        "/magisk/.core/bin/su",
        "/sbin/magisk",
        "/system/bin/magisk"
    ];

    // ROOT相关包名
    var rootPackages = [
        "com.noshufou.android.su",
        "com.noshufou.android.su.elite",
        "eu.chainfire.supersu",
        "com.koushikdutta.superuser",
        "com.thirdparty.superuser",
        "com.yellowes.su",
        "com.topjohnwu.magisk",
        "com.kingroot.kinguser",
        "com.kingo.root",
        "com.smedialink.oneclickroot",
        "com.zhiqupk.root.global",
        "com.alephzain.framaroot"
    ];

    // 1. Hook File.exists()
    try {
        var File = Java.use("java.io.File");

        File.exists.implementation = function () {
            var path = this.getAbsolutePath();
            for (var i = 0; i < rootPaths.length; i++) {
                if (path.indexOf(rootPaths[i]) !== -1 ||
                    path.toLowerCase().indexOf("/su") !== -1 ||
                    path.indexOf("busybox") !== -1 ||
                    path.indexOf("magisk") !== -1 ||
                    path.indexOf("superuser") !== -1) {
                    console.log("[+] 阻止File.exists(): " + path);
                    return false;
                }
            }
            return this.exists();
        };

        File.canRead.implementation = function () {
            var path = this.getAbsolutePath();
            if (path.toLowerCase().indexOf("/su") !== -1 || path.indexOf("magisk") !== -1) {
                console.log("[+] 阻止File.canRead(): " + path);
                return false;
            }
            return this.canRead();
        };

        File.canExecute.implementation = function () {
            var path = this.getAbsolutePath();
            if (path.toLowerCase().indexOf("/su") !== -1 || path.indexOf("busybox") !== -1) {
                console.log("[+] 阻止File.canExecute(): " + path);
                return false;
            }
            return this.canExecute();
        };

        console.log("[+] File检测Hook完成");
    } catch (e) {
        console.log("[-] File Hook失败: " + e);
    }

    // 2. Hook Runtime.exec()
    try {
        var Runtime = Java.use("java.lang.Runtime");

        Runtime.exec.overload("java.lang.String").implementation = function (cmd) {
            if (cmd.indexOf("su") !== -1 || cmd.indexOf("which") !== -1 || cmd.indexOf("busybox") !== -1) {
                console.log("[+] 阻止Runtime.exec(): " + cmd);
                throw Java.use("java.io.IOException").$new("Permission denied");
            }
            return this.exec(cmd);
        };

        Runtime.exec.overload("[Ljava.lang.String;").implementation = function (cmdArray) {
            var cmd = Array.prototype.join.call(cmdArray, " ");
            if (cmd.indexOf("su") !== -1 || cmd.indexOf("which") !== -1 || cmd.indexOf("busybox") !== -1) {
                console.log("[+] 阻止Runtime.exec(Array): " + cmd);
                throw Java.use("java.io.IOException").$new("Permission denied");
            }
            return this.exec(cmdArray);
        };

        console.log("[+] Runtime.exec Hook完成");
    } catch (e) {
        console.log("[-] Runtime.exec Hook失败: " + e);
    }

    // 3. Hook ProcessBuilder
    try {
        var ProcessBuilder = Java.use("java.lang.ProcessBuilder");

        ProcessBuilder.start.implementation = function () {
            var cmdList = this.command();
            var cmd = "";
            for (var i = 0; i < cmdList.size(); i++) {
                cmd += cmdList.get(i) + " ";
            }
            if (cmd.indexOf("su") !== -1 || cmd.indexOf("which") !== -1) {
                console.log("[+] 阻止ProcessBuilder.start(): " + cmd);
                throw Java.use("java.io.IOException").$new("Permission denied");
            }
            return this.start();
        };

        console.log("[+] ProcessBuilder Hook完成");
    } catch (e) {
        console.log("[-] ProcessBuilder Hook失败: " + e);
    }

    // 4. Hook Build.TAGS
    try {
        var Build = Java.use("android.os.Build");
        Build.TAGS.value = "release-keys";
        console.log("[+] Build.TAGS 已修改为 release-keys");
    } catch (e) {
        console.log("[-] Build.TAGS修改失败: " + e);
    }

    // 5. Hook PackageManager检测ROOT应用
    try {
        var ApplicationPackageManager = Java.use("android.app.ApplicationPackageManager");

        ApplicationPackageManager.getPackageInfo.overload("java.lang.String", "int").implementation = function (packageName, flags) {
            for (var i = 0; i < rootPackages.length; i++) {
                if (packageName.indexOf(rootPackages[i]) !== -1) {
                    console.log("[+] 阻止检测ROOT应用: " + packageName);
                    throw Java.use("android.content.pm.PackageManager$NameNotFoundException").$new(packageName);
                }
            }
            return this.getPackageInfo(packageName, flags);
        };

        console.log("[+] PackageManager Hook完成");
    } catch (e) {
        console.log("[-] PackageManager Hook失败: " + e);
    }

    // 6. Hook System.getProperty
    try {
        var System = Java.use("java.lang.System");

        System.getProperty.overload("java.lang.String").implementation = function (key) {
            if (key === "ro.debuggable" || key === "ro.secure") {
                console.log("[+] 修改系统属性: " + key + " -> 0");
                return "0";
            }
            return this.getProperty(key);
        };

        console.log("[+] System.getProperty Hook完成");
    } catch (e) {
        console.log("[-] System.getProperty Hook失败: " + e);
    }

    // 7. Hook Native层检测 (access/fopen)
    try {
        var libc = Process.getModuleByName("libc.so");

        // Hook access函数
        var accessPtr = Module.findExportByName("libc.so", "access");
        if (accessPtr) {
            Interceptor.attach(accessPtr, {
                onEnter: function (args) {
                    this.path = args[0].readCString();
                },
                onLeave: function (retval) {
                    if (this.path) {
                        for (var i = 0; i < rootPaths.length; i++) {
                            if (this.path.indexOf(rootPaths[i]) !== -1 ||
                                this.path.indexOf("/su") !== -1 ||
                                this.path.indexOf("magisk") !== -1) {
                                console.log("[+] Native access阻止: " + this.path);
                                retval.replace(-1);
                                break;
                            }
                        }
                    }
                }
            });
            console.log("[+] Native access Hook完成");
        }

        // Hook fopen函数
        var fopenPtr = Module.findExportByName("libc.so", "fopen");
        if (fopenPtr) {
            Interceptor.attach(fopenPtr, {
                onEnter: function (args) {
                    this.path = args[0].readCString();
                },
                onLeave: function (retval) {
                    if (this.path) {
                        for (var i = 0; i < rootPaths.length; i++) {
                            if (this.path.indexOf(rootPaths[i]) !== -1 ||
                                this.path.indexOf("/su") !== -1) {
                                console.log("[+] Native fopen阻止: " + this.path);
                                retval.replace(ptr(0));
                                break;
                            }
                        }
                    }
                }
            });
            console.log("[+] Native fopen Hook完成");
        }
    } catch (e) {
        console.log("[-] Native Hook失败: " + e);
    }

    console.log("[*] ROOT检测绕过脚本加载完成");
});
