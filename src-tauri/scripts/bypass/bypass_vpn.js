/**
 * 绕过VPN检测脚本
 * 功能：绕过应用的VPN/代理检测
 * 覆盖：NetworkInterface、ConnectivityManager、ProxyInfo等
 */

Java.perform(function () {
    console.log("[*] 开始加载VPN检测绕过脚本...");

    // ======== 1. 绕过NetworkInterface检测 ========
    try {
        var NetworkInterface = Java.use("java.net.NetworkInterface");

        // 隐藏VPN网络接口名称
        NetworkInterface.getName.implementation = function () {
            var name = this.getName();
            if (name !== null && (name.indexOf("tun") !== -1 ||
                name.indexOf("tap") !== -1 ||
                name.indexOf("ppp") !== -1 ||
                name.indexOf("pptp") !== -1)) {
                console.log("[+] 隐藏VPN接口: " + name);
                return "wlan0";
            }
            return name;
        };

        NetworkInterface.getDisplayName.implementation = function () {
            var name = this.getDisplayName();
            if (name !== null && (name.indexOf("tun") !== -1 ||
                name.indexOf("tap") !== -1 ||
                name.indexOf("ppp") !== -1)) {
                console.log("[+] 隐藏VPN显示名称: " + name);
                return "wlan0";
            }
            return name;
        };

        console.log("[+] NetworkInterface Hook完成");
    } catch (e) {
        console.log("[-] NetworkInterface Hook失败: " + e);
    }

    // ======== 2. 绕过ConnectivityManager VPN检测 ========
    try {
        var ConnectivityManager = Java.use("android.net.ConnectivityManager");

        // getNetworkInfo方法检测
        ConnectivityManager.getNetworkInfo.overload("int").implementation = function (networkType) {
            // TYPE_VPN = 17
            if (networkType === 17) {
                console.log("[+] 阻止VPN网络类型查询");
                return null;
            }
            return this.getNetworkInfo(networkType);
        };

        console.log("[+] ConnectivityManager.getNetworkInfo Hook完成");
    } catch (e) {
        console.log("[-] ConnectivityManager.getNetworkInfo Hook失败: " + e);
    }

    // ======== 3. 绕过NetworkCapabilities VPN检测 ========
    try {
        var NetworkCapabilities = Java.use("android.net.NetworkCapabilities");

        NetworkCapabilities.hasTransport.implementation = function (transportType) {
            // TRANSPORT_VPN = 4
            if (transportType === 4) {
                console.log("[+] 阻止VPN传输类型检测");
                return false;
            }
            return this.hasTransport(transportType);
        };

        NetworkCapabilities.hasCapability.implementation = function (capability) {
            // NET_CAPABILITY_NOT_VPN = 15
            if (capability === 15) {
                console.log("[+] 返回NOT_VPN为true");
                return true;
            }
            return this.hasCapability(capability);
        };

        console.log("[+] NetworkCapabilities Hook完成");
    } catch (e) {
        console.log("[-] NetworkCapabilities Hook失败: " + e);
    }

    // ======== 4. 绕过代理检测 ========
    try {
        var System = Java.use("java.lang.System");

        System.getProperty.overload("java.lang.String").implementation = function (key) {
            if (key === "http.proxyHost" ||
                key === "http.proxyPort" ||
                key === "https.proxyHost" ||
                key === "https.proxyPort" ||
                key === "socksProxyHost" ||
                key === "socksProxyPort") {
                console.log("[+] 隐藏代理属性: " + key);
                return null;
            }
            return this.getProperty(key);
        };

        console.log("[+] System.getProperty Hook完成");
    } catch (e) {
        console.log("[-] System.getProperty Hook失败: " + e);
    }

    // ======== 5. 绕过ProxyInfo检测 ========
    try {
        var ProxyInfo = Java.use("android.net.ProxyInfo");

        ProxyInfo.getHost.implementation = function () {
            console.log("[+] 隐藏ProxyInfo.getHost");
            return null;
        };

        ProxyInfo.getPort.implementation = function () {
            console.log("[+] 隐藏ProxyInfo.getPort");
            return 0;
        };

        console.log("[+] ProxyInfo Hook完成");
    } catch (e) {
        console.log("[-] ProxyInfo Hook失败: " + e);
    }

    // ======== 6. 绕过Proxy.getDefaultPort检测 ========
    try {
        var Proxy = Java.use("java.net.Proxy");

        Proxy.type.implementation = function () {
            var proxyType = this.type();
            if (proxyType.toString() !== "DIRECT") {
                console.log("[+] 修改代理类型为DIRECT");
                return Java.use("java.net.Proxy$Type").DIRECT.value;
            }
            return proxyType;
        };

        console.log("[+] Proxy Hook完成");
    } catch (e) {
        console.log("[-] Proxy Hook失败: " + e);
    }

    // ======== 7. 绕过文件检测 /sys/class/net/tun ========
    try {
        var File = Java.use("java.io.File");

        var originalExists = File.exists.implementation;

        File.exists.implementation = function () {
            var path = this.getAbsolutePath();
            if (path.indexOf("/sys/class/net/tun") !== -1 ||
                path.indexOf("/sys/class/net/tap") !== -1 ||
                path.indexOf("/sys/class/net/ppp") !== -1) {
                console.log("[+] 隐藏VPN网络接口文件: " + path);
                return false;
            }
            return this.exists();
        };

        console.log("[+] VPN文件检测绕过完成");
    } catch (e) {
        console.log("[-] VPN文件检测绕过失败: " + e);
    }

    // ======== 8. 绕过读取/proc/net/route检测 ========
    try {
        var FileReader = Java.use("java.io.FileReader");
        var BufferedReader = Java.use("java.io.BufferedReader");

        BufferedReader.readLine.implementation = function () {
            var line = this.readLine();
            if (line !== null && (line.indexOf("tun") !== -1 ||
                line.indexOf("tap") !== -1 ||
                line.indexOf("ppp") !== -1)) {
                console.log("[+] 过滤VPN路由信息: " + line);
                return this.readLine(); // 跳过这一行
            }
            return line;
        };

        console.log("[+] /proc/net/route检测绕过完成");
    } catch (e) {
        console.log("[-] 路由检测绕过失败: " + e);
    }

    console.log("[*] VPN检测绕过脚本加载完成");
});
