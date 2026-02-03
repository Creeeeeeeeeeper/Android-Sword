/**
 * SSL证书绕过脚本 (JustTrustMe)
 * 功能：绕过大部分框架的SSL证书校验
 * 覆盖：OkHttp、HttpsURLConnection、TrustManager、WebView、Volley、Apache HTTP等
 */

Java.perform(function () {
    console.log("[*] 开始加载SSL证书绕过脚本...");

    // ======== 1. 通用TrustManager绕过 ========
    try {
        var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
        var SSLContext = Java.use("javax.net.ssl.SSLContext");

        var TrustManager = Java.registerClass({
            name: "com.frida.TrustManager",
            implements: [X509TrustManager],
            methods: {
                checkClientTrusted: function (chain, authType) { },
                checkServerTrusted: function (chain, authType) { },
                getAcceptedIssuers: function () {
                    return [];
                }
            }
        });

        var TrustManagers = [TrustManager.$new()];
        var sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, TrustManagers, Java.use("java.security.SecureRandom").$new());
        SSLContext.setDefault(sslContext);

        console.log("[+] 默认SSLContext已替换");
    } catch (e) {
        console.log("[-] TrustManager绕过失败: " + e);
    }

    // ======== 2. OkHttp3 CertificatePinner绕过 ========
    try {
        var CertificatePinner = Java.use("okhttp3.CertificatePinner");
        CertificatePinner.check.overload("java.lang.String", "java.util.List").implementation = function (hostname, peerCertificates) {
            console.log("[+] OkHttp3 CertificatePinner绕过: " + hostname);
            return;
        };

        CertificatePinner.check.overload("java.lang.String", "[Ljava.security.cert.Certificate;").implementation = function (hostname, peerCertificates) {
            console.log("[+] OkHttp3 CertificatePinner绕过: " + hostname);
            return;
        };

        console.log("[+] OkHttp3 CertificatePinner Hook完成");
    } catch (e) {
        console.log("[-] OkHttp3 Hook失败，可能未使用OkHttp3: " + e);
    }

    // ======== 3. OkHttp3 HostnameVerifier绕过 ========
    try {
        var OkHostnameVerifier = Java.use("okhttp3.internal.tls.OkHostnameVerifier");
        OkHostnameVerifier.verify.overload("java.lang.String", "java.security.cert.X509Certificate").implementation = function (hostname, certificate) {
            console.log("[+] OkHttp3 HostnameVerifier绕过: " + hostname);
            return true;
        };
        OkHostnameVerifier.verify.overload("java.lang.String", "javax.net.ssl.SSLSession").implementation = function (hostname, session) {
            console.log("[+] OkHttp3 HostnameVerifier绕过: " + hostname);
            return true;
        };
        console.log("[+] OkHttp3 HostnameVerifier Hook完成");
    } catch (e) {
        console.log("[-] OkHttp3 HostnameVerifier Hook失败: " + e);
    }

    // ======== 4. HttpsURLConnection绕过 ========
    try {
        var HttpsURLConnection = Java.use("javax.net.ssl.HttpsURLConnection");

        HttpsURLConnection.setDefaultHostnameVerifier.implementation = function (hostnameVerifier) {
            console.log("[+] HttpsURLConnection.setDefaultHostnameVerifier被调用，已忽略");
            return;
        };

        HttpsURLConnection.setSSLSocketFactory.implementation = function (sslSocketFactory) {
            console.log("[+] HttpsURLConnection.setSSLSocketFactory被调用，已忽略");
            return;
        };

        HttpsURLConnection.setHostnameVerifier.implementation = function (hostnameVerifier) {
            console.log("[+] HttpsURLConnection.setHostnameVerifier被调用，已忽略");
            return;
        };

        console.log("[+] HttpsURLConnection Hook完成");
    } catch (e) {
        console.log("[-] HttpsURLConnection Hook失败: " + e);
    }

    // ======== 5. WebView SSL错误处理 ========
    try {
        var WebViewClient = Java.use("android.webkit.WebViewClient");
        WebViewClient.onReceivedSslError.implementation = function (view, handler, error) {
            console.log("[+] WebView SSL错误已忽略");
            handler.proceed();
        };
        console.log("[+] WebViewClient Hook完成");
    } catch (e) {
        console.log("[-] WebViewClient Hook失败: " + e);
    }

    // ======== 6. TrustManagerImpl (Android)绕过 ========
    try {
        var TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");
        TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
            console.log("[+] TrustManagerImpl.verifyChain绕过: " + host);
            return untrustedChain;
        };
        console.log("[+] TrustManagerImpl Hook完成");
    } catch (e) {
        console.log("[-] TrustManagerImpl Hook失败: " + e);
    }

    // ======== 7. Conscrypt绕过 ========
    try {
        var ConscryptTrustManager = Java.use("com.android.org.conscrypt.TrustManagerImpl");
        ConscryptTrustManager.checkTrustedRecursive.implementation = function (certs, ocspData, tlsSctData, host, clientAuth, untrustedChain, trustAnchorChain, used) {
            console.log("[+] Conscrypt checkTrustedRecursive绕过: " + host);
            return Java.use("java.util.ArrayList").$new();
        };
        console.log("[+] Conscrypt Hook完成");
    } catch (e) {
        console.log("[-] Conscrypt Hook失败: " + e);
    }

    // ======== 8. Apache HTTP Client绕过 ========
    try {
        var AbstractVerifier = Java.use("org.apache.http.conn.ssl.AbstractVerifier");
        AbstractVerifier.verify.overload("java.lang.String", "[Ljava.lang.String;", "[Ljava.lang.String;", "boolean").implementation = function (host, cns, subjectAlts, strictWithSubDomains) {
            console.log("[+] Apache AbstractVerifier绕过: " + host);
            return;
        };
        console.log("[+] Apache HTTP Client Hook完成");
    } catch (e) {
        console.log("[-] Apache HTTP Client Hook失败: " + e);
    }

    // ======== 9. Retrofit绕过 ========
    try {
        var PlatformTrustManager = Java.use("okhttp3.internal.platform.Platform");
        PlatformTrustManager.trustManager.implementation = function (sslSocketFactory) {
            console.log("[+] Retrofit Platform.trustManager绕过");
            return null;
        };
        console.log("[+] Retrofit Hook完成");
    } catch (e) {
        console.log("[-] Retrofit Hook失败: " + e);
    }

    // ======== 10. Network Security Config绕过 ========
    try {
        var NetworkSecurityConfig = Java.use("android.security.net.config.NetworkSecurityConfig");
        NetworkSecurityConfig.isCleartextTrafficPermitted.overload().implementation = function () {
            console.log("[+] NetworkSecurityConfig 允许明文流量");
            return true;
        };
        console.log("[+] NetworkSecurityConfig Hook完成");
    } catch (e) {
        console.log("[-] NetworkSecurityConfig Hook失败: " + e);
    }

    // ======== 11. Cronet绕过 ========
    try {
        var CronetEngineBuilderImpl = Java.use("org.chromium.net.impl.CronetEngineBuilderImpl");
        CronetEngineBuilderImpl.enablePublicKeyPinningBypassForLocalTrustAnchors.implementation = function (value) {
            console.log("[+] Cronet公钥固定绕过");
            return this.enablePublicKeyPinningBypassForLocalTrustAnchors(true);
        };
        console.log("[+] Cronet Hook完成");
    } catch (e) {
        console.log("[-] Cronet Hook失败: " + e);
    }

    console.log("[*] SSL证书绕过脚本加载完成");
});
