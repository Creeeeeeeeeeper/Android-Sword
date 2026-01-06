Java.perform(function () {
    function showStacks() {
        console.log(
            Java.use("android.util.Log")
                .getStackTraceString(
                    Java.use("java.lang.Throwable").$new()
                )
        );
    }

    Java.use("java.io.File").$init.overload("java.lang.String").implementation = function (str) {
        if (str.toLowerCase().endsWith("/su") || str.toLowerCase() == "su") {
            console.log("发现检测su文件");
            showStacks();
        }
        return this.$init(str);
    }
    Java.use("java.lang.Runtime").exec.overload("java.lang.String").implementation = function (str) {
        if (str.endsWith("/su") || str == "su") {
            console.log("发现尝试执行su命令的行为");
            showStacks();
        }
        return this.exec(str);
    }
    Java.use("java.lang.Runtime").exec.overload("[Ljava.lang.String;").implementation = function (stringArray) {
        for (var i = 0; i < stringArray.length; i++) {
            if (stringArray[i].includes("su") || stringArray[i].includes("/su") || stringArray[i] == "su") {
                console.log("发现尝试执行su命令的行为");
                showStacks();
                break;
            }
        }
        return this.exec(stringArray);
    }
    Java.use("java.lang.ProcessBuilder").$init.overload("[Ljava.lang.String;").implementation = function (stringArray) {
        for (var i = 0; i < stringArray.length; i++) {
            if (stringArray[i].includes("su") || stringArray[i].includes("/su") || stringArray[i] == "su") {
                console.log("发现尝试执行su命令的行为");
                showStacks();
                break;
            }
        }
        return this.$init(stringArray);
    }
});


Java.perform(function () {
    console.log("[*] 开始绕过root检测...");

    // 1. Hook File构造函数，返回不存在的文件
    var File = Java.use("java.io.File");
    File.$init.overload("java.lang.String").implementation = function (path) {
        var result = this.$init(path);
        if (path.indexOf("su") !== -1 ||
            path.indexOf("/system/bin/") !== -1 ||
            path.indexOf("/system/xbin/") !== -1 ||
            path.indexOf("/sbin/") !== -1 ||
            path.indexOf("/vendor/bin/") !== -1 ||
            path.indexOf("busybox") !== -1 ||
            path.indexOf("magisk") !== -1) {
            console.log("[+] 拦截File检测: " + path);
        }
        return result;
    };

    // Hook exists()方法，对敏感路径返回false
    File.exists.implementation = function () {
        var path = this.getAbsolutePath();
        if (path.indexOf("su") !== -1 ||
            path.indexOf("/system/bin/") !== -1 ||
            path.indexOf("/system/xbin/") !== -1 ||
            path.indexOf("/sbin/") !== -1 ||
            path.indexOf("/vendor/bin/") !== -1 ||
            path.indexOf("busybox") !== -1 ||
            path.indexOf("magisk") !== -1 ||
            path.indexOf("superuser") !== -1) {
            console.log("[+] 阻止exists()检测: " + path);
            return false;
        }
        return this.exists();
    };

    // Hook canExecute()方法
    File.canExecute.implementation = function () {
        var path = this.getAbsolutePath();
        if (path.indexOf("su") !== -1 || path.indexOf("busybox") !== -1) {
            console.log("[+] 阻止canExecute()检测: " + path);
            return false;
        }
        return this.canExecute();
    };

    // 2. Hook Runtime.exec()方法
    var Runtime = Java.use("java.lang.Runtime");
    Runtime.exec.overload("java.lang.String").implementation = function (cmd) {
        if (cmd.indexOf("su") !== -1 ||
            cmd.indexOf("which") !== -1 ||
            cmd.indexOf("busybox") !== -1 ||
            cmd.indexOf("id") === 0) {
            console.log("[+] 阻止exec命令: " + cmd);
            throw Java.use("java.io.IOException").$new("Permission denied");
        }
        return this.exec(cmd);
    };

    Runtime.exec.overload("[Ljava.lang.String;").implementation = function (cmdArray) {
        var cmd = cmdArray.join(" ");
        if (cmd.indexOf("su") !== -1 ||
            cmd.indexOf("which") !== -1 ||
            cmd.indexOf("busybox") !== -1 ||
            cmd.indexOf("id") === 0) {
            console.log("[+] 阻止exec命令数组: " + cmd);
            throw Java.use("java.io.IOException").$new("Permission denied");
        }
        return this.exec(cmdArray);
    };

    // 3. Hook ProcessBuilder
    var ProcessBuilder = Java.use("java.lang.ProcessBuilder");
    ProcessBuilder.$init.overload("[Ljava.lang.String;").implementation = function (cmdArray) {
        var cmd = cmdArray.join(" ");
        if (cmd.indexOf("su") !== -1 ||
            cmd.indexOf("which") !== -1 ||
            cmd.indexOf("busybox") !== -1) {
            console.log("[+] 阻止ProcessBuilder: " + cmd);
            cmdArray[0] = "/system/bin/echo";
        }
        return this.$init(cmdArray);
    };

    // 4. Hook常见的Native检测方法
    try {
        var Build = Java.use("android.os.Build");
        Build.TAGS.value = "release-keys";
        console.log("[+] 修改Build.TAGS为release-keys");
    } catch (e) { }

    // 5. Hook包管理器检测root应用
    try {
        var PackageManager = Java.use("android.content.pm.PackageManager");
        PackageManager.getPackageInfo.overload("java.lang.String", "int").implementation = function (packageName,
            flags) {
            if (packageName.indexOf("superuser") !== -1 ||
                packageName.indexOf("magisk") !== -1 ||
                packageName.indexOf("busybox") !== -1 ||
                packageName.indexOf("kinguser") !== -1) {
                console.log("[+] 阻止包检测: " + packageName);
                throw Java.use("android.content.pm.PackageManager$NameNotFoundException").$new();
            }
            return this.getPackageInfo(packageName, flags);
        };
    } catch (e) { }

    // 6. Hook System.getProperty检测
    var System = Java.use("java.lang.System");
    System.getProperty.overload("java.lang.String").implementation = function (key) {
        if (key === "ro.debuggable" || key === "ro.secure") {
            console.log("[+] 修改系统属性: " + key);
            return "0";
        }
        return this.getProperty(key);
    };

    console.log("[*] Root检测绕过脚本加载完成");
});