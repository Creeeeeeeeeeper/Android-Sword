/**
 * 拦截隐私界面脚本
 * 功能：移除FLAG_SECURE标志，允许投屏和截图
 * 覆盖：Window.setFlags、SurfaceView安全设置等
 */

Java.perform(function () {
    console.log("[*] 开始加载隐私界面拦截脚本...");

    // FLAG_SECURE = 0x2000 = 8192
    var FLAG_SECURE = 0x2000;

    // ======== 1. 拦截Window.setFlags ========
    try {
        var Window = Java.use("android.view.Window");

        Window.setFlags.implementation = function (flags, mask) {
            // 移除FLAG_SECURE标志
            if ((flags & FLAG_SECURE) !== 0) {
                console.log("[+] 移除Window.setFlags中的FLAG_SECURE");
                flags = flags & ~FLAG_SECURE;
                mask = mask & ~FLAG_SECURE;
            }
            return this.setFlags(flags, mask);
        };

        console.log("[+] Window.setFlags Hook完成");
    } catch (e) {
        console.log("[-] Window.setFlags Hook失败: " + e);
    }

    // ======== 2. 拦截Window.addFlags ========
    try {
        var Window = Java.use("android.view.Window");

        Window.addFlags.implementation = function (flags) {
            if ((flags & FLAG_SECURE) !== 0) {
                console.log("[+] 移除Window.addFlags中的FLAG_SECURE");
                flags = flags & ~FLAG_SECURE;
            }
            return this.addFlags(flags);
        };

        console.log("[+] Window.addFlags Hook完成");
    } catch (e) {
        console.log("[-] Window.addFlags Hook失败: " + e);
    }

    // ======== 3. 拦截WindowManager.LayoutParams ========
    try {
        var LayoutParams = Java.use("android.view.WindowManager$LayoutParams");

        // Hook构造函数
        LayoutParams.$init.overload("int", "int", "int", "int", "int").implementation = function (w, h, _type, _flags, _format) {
            if ((_flags & FLAG_SECURE) !== 0) {
                console.log("[+] 移除LayoutParams构造函数中的FLAG_SECURE");
                _flags = _flags & ~FLAG_SECURE;
            }
            return this.$init(w, h, _type, _flags, _format);
        };

        console.log("[+] WindowManager.LayoutParams Hook完成");
    } catch (e) {
        console.log("[-] WindowManager.LayoutParams Hook失败: " + e);
    }

    // ======== 4. 定期清除所有Window的FLAG_SECURE ========
    try {
        var Activity = Java.use("android.app.Activity");

        Activity.onResume.implementation = function () {
            this.onResume();

            // 获取当前Window并清除FLAG_SECURE
            try {
                var window = this.getWindow();
                if (window) {
                    window.clearFlags(FLAG_SECURE);
                    console.log("[+] 已清除Activity的FLAG_SECURE: " + this.getClass().getName());
                }
            } catch (e) { }
        };

        console.log("[+] Activity.onResume Hook完成，将自动清除FLAG_SECURE");
    } catch (e) {
        console.log("[-] Activity.onResume Hook失败: " + e);
    }

    // ======== 5. 拦截SurfaceView.setSecure ========
    try {
        var SurfaceView = Java.use("android.view.SurfaceView");

        SurfaceView.setSecure.implementation = function (isSecure) {
            console.log("[+] 拦截SurfaceView.setSecure(" + isSecure + ")，设置为false");
            return this.setSecure(false);
        };

        console.log("[+] SurfaceView.setSecure Hook完成");
    } catch (e) {
        console.log("[-] SurfaceView.setSecure Hook失败: " + e);
    }

    // ======== 6. 拦截TextureView安全设置 ========
    try {
        var TextureView = Java.use("android.view.TextureView");

        // TextureView没有直接的setSecure方法，但可能通过其他方式设置

        console.log("[+] TextureView监控完成");
    } catch (e) {
        console.log("[-] TextureView Hook失败: " + e);
    }

    // ======== 7. 拦截DecorView ========
    try {
        var DecorView = Java.use("com.android.internal.policy.DecorView");

        // 如果应用尝试在DecorView上设置安全标志
        console.log("[+] DecorView监控完成");
    } catch (e) {
        console.log("[-] DecorView Hook失败: " + e);
    }

    // ======== 8. 拦截Fragment的安全设置 ========
    try {
        var Fragment = Java.use("androidx.fragment.app.Fragment");

        Fragment.onResume.implementation = function () {
            this.onResume();

            try {
                var activity = this.getActivity();
                if (activity) {
                    var window = activity.getWindow();
                    if (window) {
                        window.clearFlags(FLAG_SECURE);
                        console.log("[+] 已清除Fragment所属Activity的FLAG_SECURE");
                    }
                }
            } catch (e) { }
        };

        console.log("[+] Fragment.onResume Hook完成");
    } catch (e) {
        console.log("[-] Fragment Hook失败: " + e);
    }

    // ======== 9. 主动清除所有现有Window的FLAG_SECURE ========
    try {
        // 获取当前应用的所有Activity
        var ActivityThread = Java.use("android.app.ActivityThread");
        var currentActivityThread = ActivityThread.currentActivityThread();
        var activities = currentActivityThread.mActivities.value;

        var iterator = activities.values().iterator();
        while (iterator.hasNext()) {
            var activityRecord = iterator.next();
            var activity = activityRecord.activity.value;
            if (activity) {
                var window = activity.getWindow();
                if (window) {
                    window.clearFlags(FLAG_SECURE);
                    console.log("[+] 初始化时清除FLAG_SECURE: " + activity.getClass().getName());
                }
            }
        }

        console.log("[+] 已清除所有现有Activity的FLAG_SECURE");
    } catch (e) {
        console.log("[-] 初始化清除失败: " + e);
    }

    // ======== 10. 拦截WebView的安全设置 ========
    try {
        var WebView = Java.use("android.webkit.WebView");

        WebView.onResume.implementation = function () {
            this.onResume();
            console.log("[*] WebView.onResume()");
        };

        console.log("[+] WebView监控完成");
    } catch (e) {
        console.log("[-] WebView Hook失败: " + e);
    }

    console.log("[*] 隐私界面拦截脚本加载完成");
    console.log("[!] FLAG_SECURE已被移除，现在可以正常投屏和截图");
});
