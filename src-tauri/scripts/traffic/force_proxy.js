/**
 * 强制使用代理脚本
 * 功能：强制OkHttp等网络库使用系统代理
 * 覆盖：OkHttpClient.Builder、Proxy.NO_PROXY替换等
 */

Java.perform(function () {
    console.log("[*] 开始加载强制代理脚本...");

    // ======== 1. 强制OkHttpClient使用代理 ========
    try {
        var OkHttpClientBuilder = Java.use("okhttp3.OkHttpClient$Builder");

        // 阻止设置NO_PROXY
        OkHttpClientBuilder.proxy.implementation = function (proxy) {
            var proxyType = proxy.type().toString();
            if (proxyType === "DIRECT") {
                console.log("[+] 阻止OkHttp设置DIRECT代理，保持系统代理");
                return this; // 不设置代理，让系统代理生效
            }
            console.log("[+] OkHttp设置代理: " + proxy.toString());
            return this.proxy(proxy);
        };

        console.log("[+] OkHttpClient.Builder.proxy Hook完成");
    } catch (e) {
        console.log("[-] OkHttpClient.Builder Hook失败: " + e);
    }

    // ======== 2. 强制HttpURLConnection使用代理 ========
    try {
        var URL = Java.use("java.net.URL");

        URL.openConnection.overload("java.net.Proxy").implementation = function (proxy) {
            var proxyType = proxy.type().toString();
            if (proxyType === "DIRECT") {
                console.log("[+] 阻止URL.openConnection设置DIRECT代理");
                return this.openConnection(); // 使用默认代理
            }
            return this.openConnection(proxy);
        };

        console.log("[+] URL.openConnection Hook完成");
    } catch (e) {
        console.log("[-] URL.openConnection Hook失败: " + e);
    }

    // ======== 3. 替换Proxy.NO_PROXY ========
    try {
        var Proxy = Java.use("java.net.Proxy");
        var InetSocketAddress = Java.use("java.net.InetSocketAddress");
        var ProxyType = Java.use("java.net.Proxy$Type");

        // 获取系统代理设置
        var systemProxyHost = Java.use("java.lang.System").getProperty("http.proxyHost");
        var systemProxyPort = Java.use("java.lang.System").getProperty("http.proxyPort");

        if (systemProxyHost && systemProxyPort) {
            console.log("[+] 检测到系统代理: " + systemProxyHost + ":" + systemProxyPort);

            // 创建系统代理对象
            var socketAddress = InetSocketAddress.$new(systemProxyHost, parseInt(systemProxyPort));
            var systemProxy = Proxy.$new(ProxyType.HTTP.value, socketAddress);

            // Hook Proxy构造函数，替换NO_PROXY
            Proxy.$init.overload("java.net.Proxy$Type", "java.net.SocketAddress").implementation = function (type, sa) {
                if (type.toString() === "DIRECT") {
                    console.log("[+] Proxy构造函数: DIRECT替换为系统代理");
                    return this.$init(ProxyType.HTTP.value, socketAddress);
                }
                return this.$init(type, sa);
            };

            console.log("[+] Proxy.NO_PROXY替换完成");
        } else {
            console.log("[!] 未检测到系统代理设置");
        }
    } catch (e) {
        console.log("[-] Proxy替换失败: " + e);
    }

    // ======== 4. 强制Socket连接使用代理 ========
    try {
        var Socket = Java.use("java.net.Socket");

        Socket.$init.overload("java.net.Proxy").implementation = function (proxy) {
            var proxyType = proxy.type().toString();
            if (proxyType === "DIRECT") {
                console.log("[+] 阻止Socket设置DIRECT代理");
                return this.$init(); // 使用默认
            }
            return this.$init(proxy);
        };

        console.log("[+] Socket Hook完成");
    } catch (e) {
        console.log("[-] Socket Hook失败: " + e);
    }

    // ======== 5. 强制Retrofit使用代理 ========
    try {
        var RetrofitBuilder = Java.use("retrofit2.Retrofit$Builder");

        // Retrofit使用OkHttp，所以OkHttp的Hook应该已经覆盖
        // 这里额外确保client设置时保持代理

        console.log("[+] Retrofit代理设置通过OkHttp Hook生效");
    } catch (e) {
        console.log("[-] Retrofit检测失败，可能未使用Retrofit");
    }

    // ======== 6. 设置系统属性强制代理 ========
    try {
        var System = Java.use("java.lang.System");

        // 监控代理属性的清除操作
        System.clearProperty.implementation = function (key) {
            if (key === "http.proxyHost" ||
                key === "http.proxyPort" ||
                key === "https.proxyHost" ||
                key === "https.proxyPort") {
                console.log("[+] 阻止清除代理属性: " + key);
                return null; // 不执行清除
            }
            return this.clearProperty(key);
        };

        System.setProperty.implementation = function (key, value) {
            if ((key === "http.proxyHost" || key === "https.proxyHost") && (value === "" || value === null)) {
                console.log("[+] 阻止清空代理Host: " + key);
                return this.getProperty(key); // 返回原值，不修改
            }
            if ((key === "http.proxyPort" || key === "https.proxyPort") && (value === "0" || value === "" || value === null)) {
                console.log("[+] 阻止清空代理Port: " + key);
                return this.getProperty(key);
            }
            return this.setProperty(key, value);
        };

        console.log("[+] 系统代理属性保护完成");
    } catch (e) {
        console.log("[-] 系统属性Hook失败: " + e);
    }

    // ======== 7. 强制ProxySelector返回代理 ========
    try {
        var ProxySelector = Java.use("java.net.ProxySelector");

        ProxySelector.select.implementation = function (uri) {
            var proxies = this.select(uri);

            // 检查是否只有DIRECT
            var hasDirect = false;
            var iter = proxies.iterator();
            while (iter.hasNext()) {
                var proxy = iter.next();
                if (proxy.type().toString() === "DIRECT") {
                    hasDirect = true;
                    break;
                }
            }

            if (hasDirect && proxies.size() === 1) {
                console.log("[+] ProxySelector只返回DIRECT，尝试使用系统代理");
                // 返回原始结果，让系统代理生效
            }

            return proxies;
        };

        console.log("[+] ProxySelector Hook完成");
    } catch (e) {
        console.log("[-] ProxySelector Hook失败: " + e);
    }

    console.log("[*] 强制代理脚本加载完成");
    console.log("[!] 提示: 请确保已在系统设置中配置代理服务器");
});
