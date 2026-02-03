/**
 * 拦截应用弹窗脚本
 * 功能：监控并可选择性拦截各种弹窗
 * 覆盖：AlertDialog、Toast、PopupWindow、Snackbar等
 */

Java.perform(function () {
    console.log("[*] 开始加载弹窗拦截脚本...");

    // ======== 1. 拦截AlertDialog ========
    try {
        var AlertDialogBuilder = Java.use("android.app.AlertDialog$Builder");

        AlertDialogBuilder.show.implementation = function () {
            var title = "";
            var message = "";

            try {
                // 尝试获取标题和消息
                var dialog = this.create();
                if (dialog) {
                    var window = dialog.getWindow();
                    // 获取对话框信息
                }
            } catch (e) { }

            console.log("[!] 拦截AlertDialog.show()");
            console.log("    标题: " + this.mTitle);
            showStackTrace();

            // 可以选择性地阻止显示
            // return null;
            return this.show(); // 允许显示但记录日志
        };

        AlertDialogBuilder.create.implementation = function () {
            console.log("[*] AlertDialog.create()被调用");
            return this.create();
        };

        console.log("[+] AlertDialog Hook完成");
    } catch (e) {
        console.log("[-] AlertDialog Hook失败: " + e);
    }

    // ======== 2. 拦截androidx AlertDialog ========
    try {
        var AppCompatAlertDialogBuilder = Java.use("androidx.appcompat.app.AlertDialog$Builder");

        AppCompatAlertDialogBuilder.show.implementation = function () {
            console.log("[!] 拦截AppCompat AlertDialog.show()");
            showStackTrace();
            return this.show();
        };

        console.log("[+] AppCompat AlertDialog Hook完成");
    } catch (e) {
        console.log("[-] AppCompat AlertDialog Hook失败: " + e);
    }

    // ======== 3. 拦截Dialog.show ========
    try {
        var Dialog = Java.use("android.app.Dialog");

        Dialog.show.implementation = function () {
            var dialogClass = this.getClass().getName();
            console.log("[!] 拦截Dialog.show(): " + dialogClass);
            showStackTrace();
            return this.show();
        };

        Dialog.dismiss.implementation = function () {
            console.log("[*] Dialog.dismiss(): " + this.getClass().getName());
            return this.dismiss();
        };

        console.log("[+] Dialog Hook完成");
    } catch (e) {
        console.log("[-] Dialog Hook失败: " + e);
    }

    // ======== 4. 拦截Toast ========
    try {
        var Toast = Java.use("android.widget.Toast");

        Toast.show.implementation = function () {
            console.log("[!] 拦截Toast.show()");

            // 尝试获取Toast文本
            try {
                var view = this.getView();
                if (view) {
                    var textView = view.findViewById(Java.use("android.R$id").message.value);
                    if (textView) {
                        var text = Java.cast(textView, Java.use("android.widget.TextView")).getText();
                        console.log("    内容: " + text);
                    }
                }
            } catch (e) { }

            showStackTrace();
            return this.show();
        };

        Toast.makeText.overload("android.content.Context", "java.lang.CharSequence", "int").implementation = function (context, text, duration) {
            console.log("[*] Toast.makeText: " + text);
            return this.makeText(context, text, duration);
        };

        console.log("[+] Toast Hook完成");
    } catch (e) {
        console.log("[-] Toast Hook失败: " + e);
    }

    // ======== 5. 拦截PopupWindow ========
    try {
        var PopupWindow = Java.use("android.widget.PopupWindow");

        PopupWindow.showAtLocation.overload("android.view.View", "int", "int", "int").implementation = function (parent, gravity, x, y) {
            console.log("[!] 拦截PopupWindow.showAtLocation()");
            console.log("    位置: gravity=" + gravity + ", x=" + x + ", y=" + y);
            showStackTrace();
            return this.showAtLocation(parent, gravity, x, y);
        };

        PopupWindow.showAsDropDown.overload("android.view.View").implementation = function (anchor) {
            console.log("[!] 拦截PopupWindow.showAsDropDown()");
            showStackTrace();
            return this.showAsDropDown(anchor);
        };

        PopupWindow.showAsDropDown.overload("android.view.View", "int", "int").implementation = function (anchor, xoff, yoff) {
            console.log("[!] 拦截PopupWindow.showAsDropDown() offset: " + xoff + ", " + yoff);
            showStackTrace();
            return this.showAsDropDown(anchor, xoff, yoff);
        };

        PopupWindow.showAsDropDown.overload("android.view.View", "int", "int", "int").implementation = function (anchor, xoff, yoff, gravity) {
            console.log("[!] 拦截PopupWindow.showAsDropDown() gravity: " + gravity);
            showStackTrace();
            return this.showAsDropDown(anchor, xoff, yoff, gravity);
        };

        console.log("[+] PopupWindow Hook完成");
    } catch (e) {
        console.log("[-] PopupWindow Hook失败: " + e);
    }

    // ======== 6. 拦截Snackbar ========
    try {
        var Snackbar = Java.use("com.google.android.material.snackbar.Snackbar");

        Snackbar.show.implementation = function () {
            console.log("[!] 拦截Snackbar.show()");
            showStackTrace();
            return this.show();
        };

        Snackbar.make.overload("android.view.View", "java.lang.CharSequence", "int").implementation = function (view, text, duration) {
            console.log("[*] Snackbar.make: " + text);
            return this.make(view, text, duration);
        };

        console.log("[+] Snackbar Hook完成");
    } catch (e) {
        console.log("[-] Snackbar Hook失败，可能未使用Material组件");
    }

    // ======== 7. 拦截ProgressDialog ========
    try {
        var ProgressDialog = Java.use("android.app.ProgressDialog");

        ProgressDialog.show.overload().implementation = function () {
            console.log("[!] 拦截ProgressDialog.show()");
            showStackTrace();
            return this.show();
        };

        console.log("[+] ProgressDialog Hook完成");
    } catch (e) {
        console.log("[-] ProgressDialog Hook失败: " + e);
    }

    // ======== 8. 拦截BottomSheetDialog ========
    try {
        var BottomSheetDialog = Java.use("com.google.android.material.bottomsheet.BottomSheetDialog");

        BottomSheetDialog.show.implementation = function () {
            console.log("[!] 拦截BottomSheetDialog.show()");
            showStackTrace();
            return this.show();
        };

        console.log("[+] BottomSheetDialog Hook完成");
    } catch (e) {
        console.log("[-] BottomSheetDialog Hook失败，可能未使用Material组件");
    }

    // ======== 9. 拦截DialogFragment ========
    try {
        var DialogFragment = Java.use("androidx.fragment.app.DialogFragment");

        DialogFragment.show.overload("androidx.fragment.app.FragmentManager", "java.lang.String").implementation = function (manager, tag) {
            console.log("[!] 拦截DialogFragment.show(): " + this.getClass().getName() + ", tag=" + tag);
            showStackTrace();
            return this.show(manager, tag);
        };

        console.log("[+] DialogFragment Hook完成");
    } catch (e) {
        console.log("[-] DialogFragment Hook失败: " + e);
    }

    // ======== 10. 拦截WindowManager.addView ========
    try {
        var WindowManagerImpl = Java.use("android.view.WindowManagerImpl");

        WindowManagerImpl.addView.implementation = function (view, params) {
            var viewClass = view.getClass().getName();
            console.log("[!] WindowManager.addView: " + viewClass);

            // 检查是否是弹窗类型的View
            var layoutParams = Java.cast(params, Java.use("android.view.WindowManager$LayoutParams"));
            var type = layoutParams.type.value;
            console.log("    窗口类型: " + type);

            return this.addView(view, params);
        };

        console.log("[+] WindowManager.addView Hook完成");
    } catch (e) {
        console.log("[-] WindowManager.addView Hook失败: " + e);
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

    console.log("[*] 弹窗拦截脚本加载完成");
    console.log("[!] 注意: 所有弹窗将被记录，可根据需要修改脚本以阻止特定弹窗");
});
