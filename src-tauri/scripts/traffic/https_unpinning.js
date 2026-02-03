/**
 * HTTPS无视证书脚本
 * 功能：使所有HTTPS请求忽略证书验证错误
 * 适用：配合代理抓包工具使用
 */

Java.perform(function () {
    console.log("[*] 开始加载HTTPS无视证书脚本...");

    // ======== 1. 创建信任所有证书的TrustManager ========
    try {
        var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
        var SSLContext = Java.use("javax.net.ssl.SSLContext");

        // 创建一个信任所有证书的TrustManager
        var TrustAllManager = Java.registerClass({
            name: "com.frida.TrustAllManager",
            implements: [X509TrustManager],
            methods: {
                checkClientTrusted: function (chain, authType) {
                    // 信任所有客户端证书
                },
                checkServerTrusted: function (chain, authType) {
                    // 信任所有服务器证书
                },
                getAcceptedIssuers: function () {
                    return [];
                }
            }
        });

        // 设置默认SSLContext
        var trustManagers = [TrustAllManager.$new()];
        var sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, trustManagers, Java.use("java.security.SecureRandom").$new());
        SSLContext.setDefault(sslContext);

        console.log("[+] 默认SSLContext已替换为信任所有证书");
    } catch (e) {
        console.log("[-] SSLContext替换失败: " + e);
    }

    // ======== 2. 信任所有HostnameVerifier ========
    try {
        var HostnameVerifier = Java.use("javax.net.ssl.HostnameVerifier");
        var HttpsURLConnection = Java.use("javax.net.ssl.HttpsURLConnection");

        // 创建信任所有主机名的Verifier
        var TrustAllHostnameVerifier = Java.registerClass({
            name: "com.frida.TrustAllHostnameVerifier",
            implements: [HostnameVerifier],
            methods: {
                verify: function (hostname, session) {
                    return true;
                }
            }
        });

        HttpsURLConnection.setDefaultHostnameVerifier(TrustAllHostnameVerifier.$new());
        console.log("[+] 默认HostnameVerifier已替换");
    } catch (e) {
        console.log("[-] HostnameVerifier替换失败: " + e);
    }

    // ======== 3. Hook SSLContext.init ========
    try {
        var SSLContext = Java.use("javax.net.ssl.SSLContext");

        SSLContext.init.implementation = function (keyManager, trustManager, secureRandom) {
            console.log("[+] SSLContext.init被调用，注入信任所有证书的TrustManager");

            var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
            var TrustAllCerts = Java.registerClass({
                name: "com.frida.TrustAllCerts" + Math.random().toString(36).substr(2, 9),
                implements: [X509TrustManager],
                methods: {
                    checkClientTrusted: function (chain, authType) { },
                    checkServerTrusted: function (chain, authType) { },
                    getAcceptedIssuers: function () { return []; }
                }
            });

            var trustAllArray = [TrustAllCerts.$new()];
            return this.init(keyManager, trustAllArray, secureRandom);
        };

        console.log("[+] SSLContext.init Hook完成");
    } catch (e) {
        console.log("[-] SSLContext.init Hook失败: " + e);
    }

    // ======== 4. Hook TrustManagerFactory ========
    try {
        var TrustManagerFactory = Java.use("javax.net.ssl.TrustManagerFactory");

        TrustManagerFactory.getTrustManagers.implementation = function () {
            console.log("[+] TrustManagerFactory.getTrustManagers被调用，返回信任所有证书");

            var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
            var TrustAll = Java.registerClass({
                name: "com.frida.TrustAll" + Math.random().toString(36).substr(2, 9),
                implements: [X509TrustManager],
                methods: {
                    checkClientTrusted: function (chain, authType) { },
                    checkServerTrusted: function (chain, authType) { },
                    getAcceptedIssuers: function () { return []; }
                }
            });

            return [TrustAll.$new()];
        };

        console.log("[+] TrustManagerFactory Hook完成");
    } catch (e) {
        console.log("[-] TrustManagerFactory Hook失败: " + e);
    }

    // ======== 5. Hook X509TrustManager方法 ========
    try {
        var TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");

        TrustManagerImpl.checkServerTrusted.overload("[Ljava.security.cert.X509Certificate;", "java.lang.String").implementation = function (chain, authType) {
            console.log("[+] TrustManagerImpl.checkServerTrusted绕过");
            return;
        };

        TrustManagerImpl.checkServerTrusted.overload("[Ljava.security.cert.X509Certificate;", "java.lang.String", "java.lang.String").implementation = function (chain, authType, host) {
            console.log("[+] TrustManagerImpl.checkServerTrusted绕过: " + host);
            return;
        };

        console.log("[+] TrustManagerImpl Hook完成");
    } catch (e) {
        console.log("[-] TrustManagerImpl Hook失败: " + e);
    }

    // ======== 6. Hook WebView SSL错误 ========
    try {
        var WebViewClient = Java.use("android.webkit.WebViewClient");

        WebViewClient.onReceivedSslError.implementation = function (view, handler, error) {
            console.log("[+] WebView SSL错误被忽略: " + error.toString());
            handler.proceed();
        };

        console.log("[+] WebViewClient Hook完成");
    } catch (e) {
        console.log("[-] WebViewClient Hook失败: " + e);
    }

    // ======== 7. Hook OkHttp SSLSocketFactory ========
    try {
        var OkHttpClientBuilder = Java.use("okhttp3.OkHttpClient$Builder");

        OkHttpClientBuilder.sslSocketFactory.overload("javax.net.ssl.SSLSocketFactory", "javax.net.ssl.X509TrustManager").implementation = function (sslSocketFactory, trustManager) {
            console.log("[+] OkHttp sslSocketFactory被调用，注入信任所有证书");

            var SSLContext = Java.use("javax.net.ssl.SSLContext");
            var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");

            var TrustAll = Java.registerClass({
                name: "com.frida.OkHttpTrustAll",
                implements: [X509TrustManager],
                methods: {
                    checkClientTrusted: function (chain, authType) { },
                    checkServerTrusted: function (chain, authType) { },
                    getAcceptedIssuers: function () { return []; }
                }
            });

            var trustAllManager = TrustAll.$new();
            var sslCtx = SSLContext.getInstance("TLS");
            sslCtx.init(null, [trustAllManager], Java.use("java.security.SecureRandom").$new());

            return this.sslSocketFactory(sslCtx.getSocketFactory(), trustAllManager);
        };

        console.log("[+] OkHttp sslSocketFactory Hook完成");
    } catch (e) {
        console.log("[-] OkHttp Hook失败: " + e);
    }

    // ======== 8. 允许明文流量 ========
    try {
        var NetworkSecurityConfig = Java.use("android.security.net.config.NetworkSecurityConfig");

        NetworkSecurityConfig.isCleartextTrafficPermitted.overload().implementation = function () {
            console.log("[+] 允许明文流量");
            return true;
        };

        NetworkSecurityConfig.isCleartextTrafficPermitted.overload("java.lang.String").implementation = function (hostname) {
            console.log("[+] 允许明文流量: " + hostname);
            return true;
        };

        console.log("[+] NetworkSecurityConfig Hook完成");
    } catch (e) {
        console.log("[-] NetworkSecurityConfig Hook失败: " + e);
    }

    console.log("[*] HTTPS无视证书脚本加载完成");
    console.log("[!] 提示: 此脚本用于配合代理抓包工具使用");
});
