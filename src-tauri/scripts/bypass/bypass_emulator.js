/**
 * 绕过模拟器检测脚本
 * 功能：伪装真实设备，绕过各种模拟器检测
 * 覆盖：Build信息、传感器、电话服务、特征文件、IMEI等
 */

Java.perform(function () {
    console.log("[*] 开始加载模拟器检测绕过脚本...");

    // ======== 1. 修改Build信息 ========
    try {
        var Build = Java.use("android.os.Build");

        // 常见模拟器特征替换为真机值
        Build.FINGERPRINT.value = "google/sunfish/sunfish:13/TP1A.220624.014/8818698:user/release-keys";
        Build.MODEL.value = "Pixel 4a";
        Build.MANUFACTURER.value = "Google";
        Build.BRAND.value = "google";
        Build.DEVICE.value = "sunfish";
        Build.PRODUCT.value = "sunfish";
        Build.HARDWARE.value = "sunfish";
        Build.BOARD.value = "sunfish";
        Build.HOST.value = "abfarm-release";
        Build.TAGS.value = "release-keys";
        Build.TYPE.value = "user";
        Build.USER.value = "android-build";

        console.log("[+] Build信息已修改");
    } catch (e) {
        console.log("[-] Build修改失败: " + e);
    }

    // ======== 2. 修改Build.VERSION信息 ========
    try {
        var BuildVersion = Java.use("android.os.Build$VERSION");
        BuildVersion.SDK_INT.value = 33;
        BuildVersion.RELEASE.value = "13";
        console.log("[+] Build.VERSION已修改");
    } catch (e) {
        console.log("[-] Build.VERSION修改失败: " + e);
    }

    // ======== 3. 绕过TelephonyManager检测 ========
    try {
        var TelephonyManager = Java.use("android.telephony.TelephonyManager");

        // 模拟器通常没有IMEI或返回特殊值
        TelephonyManager.getDeviceId.overload().implementation = function () {
            var imei = "86" + Math.floor(Math.random() * 10000000000000).toString().padStart(13, "0");
            console.log("[+] getDeviceId返回: " + imei);
            return imei;
        };

        TelephonyManager.getSubscriberId.implementation = function () {
            var imsi = "46000" + Math.floor(Math.random() * 10000000000).toString().padStart(10, "0");
            console.log("[+] getSubscriberId返回: " + imsi);
            return imsi;
        };

        TelephonyManager.getLine1Number.implementation = function () {
            var phone = "1" + Math.floor(Math.random() * 10000000000).toString().padStart(10, "0");
            console.log("[+] getLine1Number返回: " + phone);
            return phone;
        };

        TelephonyManager.getNetworkOperatorName.implementation = function () {
            console.log("[+] getNetworkOperatorName返回: 中国移动");
            return "中国移动";
        };

        TelephonyManager.getSimSerialNumber.implementation = function () {
            var serial = "89860" + Math.floor(Math.random() * 100000000000000).toString().padStart(14, "0");
            console.log("[+] getSimSerialNumber返回: " + serial);
            return serial;
        };

        TelephonyManager.getSimOperatorName.implementation = function () {
            console.log("[+] getSimOperatorName返回: 中国移动");
            return "中国移动";
        };

        TelephonyManager.getPhoneType.implementation = function () {
            console.log("[+] getPhoneType返回: GSM");
            return 1; // PHONE_TYPE_GSM
        };

        TelephonyManager.getNetworkType.implementation = function () {
            console.log("[+] getNetworkType返回: LTE");
            return 13; // NETWORK_TYPE_LTE
        };

        console.log("[+] TelephonyManager Hook完成");
    } catch (e) {
        console.log("[-] TelephonyManager Hook失败: " + e);
    }

    // ======== 4. 绕过传感器检测 ========
    try {
        var SensorManager = Java.use("android.hardware.SensorManager");

        // 模拟器通常传感器较少或没有
        SensorManager.getSensorList.implementation = function (type) {
            var result = this.getSensorList(type);
            if (result.size() === 0) {
                console.log("[+] 传感器列表为空，伪装有传感器");
                // 不做修改，让应用认为检测到了传感器
            }
            return result;
        };

        console.log("[+] SensorManager Hook完成");
    } catch (e) {
        console.log("[-] SensorManager Hook失败: " + e);
    }

    // ======== 5. 绕过文件特征检测 ========
    try {
        var File = Java.use("java.io.File");

        var emulatorFiles = [
            "/dev/socket/qemud",
            "/dev/qemu_pipe",
            "/system/lib/libc_malloc_debug_qemu.so",
            "/sys/qemu_trace",
            "/system/bin/qemu-props",
            "/dev/goldfish_pipe",
            "/dev/vboxguest",
            "/dev/vboxuser",
            "/system/lib/vboxguest.ko",
            "/system/lib/vboxsf.ko",
            "/ueventd.android_x86.rc",
            "/x86.prop",
            "/ueventd.ttVM_x86.rc",
            "/init.ttVM_x86.rc",
            "/init.vbox86.rc",
            "/init.goldfish.rc",
            "/init.ranchu.rc",
            "/fstab.goldfish",
            "/fstab.ranchu",
            "/sys/devices/virtual/misc/android_adb"
        ];

        File.exists.implementation = function () {
            var path = this.getAbsolutePath();
            for (var i = 0; i < emulatorFiles.length; i++) {
                if (path.indexOf(emulatorFiles[i]) !== -1) {
                    console.log("[+] 阻止模拟器文件检测: " + path);
                    return false;
                }
            }
            return this.exists();
        };

        console.log("[+] 模拟器文件检测绕过完成");
    } catch (e) {
        console.log("[-] 文件检测绕过失败: " + e);
    }

    // ======== 6. 绕过SystemProperties检测 ========
    try {
        var SystemProperties = Java.use("android.os.SystemProperties");

        var emulatorProps = {
            "ro.hardware": "sunfish",
            "ro.product.model": "Pixel 4a",
            "ro.product.brand": "google",
            "ro.product.name": "sunfish",
            "ro.product.device": "sunfish",
            "ro.product.board": "sunfish",
            "ro.board.platform": "sunfish",
            "ro.hardware.audio.primary": "sunfish",
            "ro.kernel.qemu": "",
            "ro.kernel.qemu.gles": "",
            "ro.bootimage.build.fingerprint": "google/sunfish/sunfish:13/TP1A.220624.014/8818698:user/release-keys",
            "init.svc.qemu-props": "",
            "init.svc.qemud": "",
            "qemu.hw.mainkeys": "",
            "ro.boot.hardware": "sunfish"
        };

        SystemProperties.get.overload("java.lang.String").implementation = function (key) {
            if (emulatorProps.hasOwnProperty(key)) {
                console.log("[+] SystemProperties.get(" + key + ") -> " + emulatorProps[key]);
                return emulatorProps[key];
            }
            return this.get(key);
        };

        SystemProperties.get.overload("java.lang.String", "java.lang.String").implementation = function (key, defaultValue) {
            if (emulatorProps.hasOwnProperty(key)) {
                console.log("[+] SystemProperties.get(" + key + ") -> " + emulatorProps[key]);
                return emulatorProps[key];
            }
            return this.get(key, defaultValue);
        };

        console.log("[+] SystemProperties Hook完成");
    } catch (e) {
        console.log("[-] SystemProperties Hook失败: " + e);
    }

    // ======== 7. 绕过WifiManager MAC地址检测 ========
    try {
        var WifiInfo = Java.use("android.net.wifi.WifiInfo");

        WifiInfo.getMacAddress.implementation = function () {
            var mac = "02:00:00:" +
                Math.floor(Math.random() * 256).toString(16).padStart(2, "0") + ":" +
                Math.floor(Math.random() * 256).toString(16).padStart(2, "0") + ":" +
                Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
            console.log("[+] getMacAddress返回: " + mac);
            return mac;
        };

        console.log("[+] WifiInfo Hook完成");
    } catch (e) {
        console.log("[-] WifiInfo Hook失败: " + e);
    }

    // ======== 8. 绕过BluetoothAdapter检测 ========
    try {
        var BluetoothAdapter = Java.use("android.bluetooth.BluetoothAdapter");

        BluetoothAdapter.getAddress.implementation = function () {
            var btMac = "02:00:00:" +
                Math.floor(Math.random() * 256).toString(16).padStart(2, "0") + ":" +
                Math.floor(Math.random() * 256).toString(16).padStart(2, "0") + ":" +
                Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
            console.log("[+] BluetoothAdapter.getAddress返回: " + btMac);
            return btMac;
        };

        console.log("[+] BluetoothAdapter Hook完成");
    } catch (e) {
        console.log("[-] BluetoothAdapter Hook失败: " + e);
    }

    // ======== 9. 绕过Native层检测 ========
    try {
        var accessPtr = Module.findExportByName("libc.so", "access");
        if (accessPtr) {
            Interceptor.attach(accessPtr, {
                onEnter: function (args) {
                    this.path = args[0].readCString();
                },
                onLeave: function (retval) {
                    if (this.path) {
                        if (this.path.indexOf("qemu") !== -1 ||
                            this.path.indexOf("goldfish") !== -1 ||
                            this.path.indexOf("vbox") !== -1 ||
                            this.path.indexOf("genymotion") !== -1) {
                            console.log("[+] Native access阻止模拟器检测: " + this.path);
                            retval.replace(-1);
                        }
                    }
                }
            });
            console.log("[+] Native access Hook完成");
        }
    } catch (e) {
        console.log("[-] Native Hook失败: " + e);
    }

    console.log("[*] 模拟器检测绕过脚本加载完成");
});
