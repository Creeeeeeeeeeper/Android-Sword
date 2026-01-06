// 应用信息测试脚本
// 获取当前应用的基本信息、设备信息、当前Activity，并监控Activity切换事件
// 注意：此脚本会被自动包装在 waitForApplication 中

Java.perform(function() {
    console.log("[+] App Info Script executing!");

    // 获取当前应用上下文
    var ActivityThread = Java.use("android.app.ActivityThread");
    var currentApplication = ActivityThread.currentApplication();
    var context = currentApplication.getApplicationContext();

    // 获取包信息
    var packageManager = context.getPackageManager();
    var packageName = context.getPackageName();
    var packageInfo = packageManager.getPackageInfo(packageName, 0);

    console.log("\n========== 应用信息 ==========");
    console.log("[*] 包名: " + packageName);
    console.log("[*] 版本名: " + packageInfo.versionName.value);
    console.log("[*] 版本号: " + packageInfo.versionCode.value);

    // 获取应用名称
    var appInfo = packageManager.getApplicationInfo(packageName, 0);
    var appName = packageManager.getApplicationLabel(appInfo);
    console.log("[*] 应用名: " + appName);

    // 获取设备信息
    var Build = Java.use("android.os.Build");
    var BuildVERSION = Java.use("android.os.Build$VERSION");

    console.log("\n========== 设备信息 ==========");
    console.log("[*] 品牌: " + Build.BRAND.value);
    console.log("[*] 型号: " + Build.MODEL.value);
    console.log("[*] 设备: " + Build.DEVICE.value);
    console.log("[*] Android版本: " + BuildVERSION.RELEASE.value);
    console.log("[*] SDK版本: " + BuildVERSION.SDK_INT.value);

    // 获取当前Activity
    console.log("\n========== 当前Activity ==========");
    try {
        var currentActivityThread = ActivityThread.currentActivityThread();
        var mActivities = currentActivityThread.mActivities.value;
        var activityList = mActivities.values().toArray();

        if (activityList.length === 0) {
            console.log("[*] 暂无Activity（应用刚启动）");
        }

        for (var i = 0; i < activityList.length; i++) {
            var activityRecord = activityList[i];
            var activityField = activityRecord.getClass().getDeclaredField("activity");
            activityField.setAccessible(true);
            var activity = activityField.get(activityRecord);
            if (activity != null) {
                console.log("[*] Activity: " + activity.getClass().getName());
            }
        }
    } catch (e) {
        console.log("[!] 获取Activity失败: " + e);
    }

    // 监控Activity生命周期
    console.log("\n========== 开始监控Activity切换 ==========");

    var Activity = Java.use("android.app.Activity");

    Activity.onCreate.overload("android.os.Bundle").implementation = function(savedInstanceState) {
        console.log("[Activity] onCreate: " + this.getClass().getName());
        return this.onCreate(savedInstanceState);
    };

    Activity.onResume.implementation = function() {
        console.log("[Activity] onResume: " + this.getClass().getName());
        return this.onResume();
    };

    Activity.onPause.implementation = function() {
        console.log("[Activity] onPause: " + this.getClass().getName());
        return this.onPause();
    };

    Activity.onDestroy.implementation = function() {
        console.log("[Activity] onDestroy: " + this.getClass().getName());
        return this.onDestroy();
    };

    console.log("[+] Activity监控已启动，操作APP查看Activity切换日志");
});
