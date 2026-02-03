/**
 * 带壳Hook脚本
 * 功能：等待加壳应用脱壳完成后自动执行Hook
 * 支持：监听ClassLoader加载，在真实DEX加载后执行回调
 */

Java.perform(function () {
    console.log("[*] 开始加载带壳Hook脚本...");

    var targetClasses = [];  // 用户可以添加想要Hook的类名
    var hookedClasses = {};
    var realClassLoaderFound = false;

    // ======== 配置：添加你要Hook的目标类 ========
    // 示例：targetClasses.push("com.example.MainActivity");

    // ======== 1. 监听ClassLoader加载 ========
    try {
        var ClassLoader = Java.use("java.lang.ClassLoader");

        ClassLoader.loadClass.overload("java.lang.String").implementation = function (className) {
            var result = this.loadClass(className);

            // 检测是否是真实的业务类（非壳类）
            if (className && !className.startsWith("com.stub.") &&
                !className.startsWith("com.secneo.") &&
                !className.startsWith("com.secshell.") &&
                !className.startsWith("com.qihoo.") &&
                !className.startsWith("com.tencent.bugly") &&
                !className.startsWith("com.wrapper.") &&
                !className.startsWith("com.bangcle.") &&
                !className.startsWith("com.ijiami.") &&
                !className.startsWith("s.h.e.l.l.") &&
                !className.startsWith("android.") &&
                !className.startsWith("androidx.") &&
                !className.startsWith("java.") &&
                !className.startsWith("kotlin.") &&
                !className.startsWith("dalvik.") &&
                !className.startsWith("sun.") &&
                !className.startsWith("com.google.") &&
                !className.startsWith("org.apache.")) {

                if (!realClassLoaderFound) {
                    console.log("[+] 检测到真实业务类加载: " + className);
                    realClassLoaderFound = true;

                    // 延迟执行用户Hook
                    setTimeout(function () {
                        console.log("[*] 壳已脱落，开始执行用户Hook...");
                        executeUserHooks();
                    }, 1000);
                }

                // 检查是否是目标类
                if (targetClasses.indexOf(className) !== -1 && !hookedClasses[className]) {
                    console.log("[+] 目标类已加载: " + className);
                    hookedClasses[className] = true;
                }
            }

            return result;
        };

        console.log("[+] ClassLoader.loadClass Hook完成");
    } catch (e) {
        console.log("[-] ClassLoader Hook失败: " + e);
    }

    // ======== 2. 监听DexClassLoader ========
    try {
        var DexClassLoader = Java.use("dalvik.system.DexClassLoader");

        DexClassLoader.$init.overload("java.lang.String", "java.lang.String", "java.lang.String", "java.lang.ClassLoader").implementation = function (dexPath, optimizedDirectory, libraryPath, parent) {
            console.log("[+] DexClassLoader创建:");
            console.log("    dexPath: " + dexPath);
            console.log("    optimizedDirectory: " + optimizedDirectory);

            var result = this.$init(dexPath, optimizedDirectory, libraryPath, parent);

            // 保存ClassLoader引用，以便后续使用
            storeClassLoader(result);

            return result;
        };

        console.log("[+] DexClassLoader Hook完成");
    } catch (e) {
        console.log("[-] DexClassLoader Hook失败: " + e);
    }

    // ======== 3. 监听InMemoryDexClassLoader ========
    try {
        var InMemoryDexClassLoader = Java.use("dalvik.system.InMemoryDexClassLoader");

        InMemoryDexClassLoader.$init.overload("java.nio.ByteBuffer", "java.lang.ClassLoader").implementation = function (buffer, parent) {
            console.log("[+] InMemoryDexClassLoader创建，内存DEX大小: " + buffer.remaining());

            var result = this.$init(buffer, parent);
            storeClassLoader(result);

            return result;
        };

        console.log("[+] InMemoryDexClassLoader Hook完成");
    } catch (e) {
        console.log("[-] InMemoryDexClassLoader Hook失败: " + e);
    }

    // ======== 4. 存储ClassLoader并尝试Hook ========
    var storedClassLoaders = [];

    function storeClassLoader(classLoader) {
        storedClassLoaders.push(classLoader);
        console.log("[+] 已保存ClassLoader，当前数量: " + storedClassLoaders.length);

        // 尝试加载目标类
        setTimeout(function () {
            tryLoadTargetClasses(classLoader);
        }, 500);
    }

    function tryLoadTargetClasses(classLoader) {
        for (var i = 0; i < targetClasses.length; i++) {
            var className = targetClasses[i];
            if (hookedClasses[className]) continue;

            try {
                var clazz = classLoader.loadClass(className);
                if (clazz) {
                    console.log("[+] 成功加载目标类: " + className);
                    hookedClasses[className] = true;
                }
            } catch (e) {
                // 类不在这个ClassLoader中
            }
        }
    }

    // ======== 5. 执行用户Hook ========
    function executeUserHooks() {
        console.log("[*] ========== 开始执行用户Hook ==========");

        // 枚举所有ClassLoader
        Java.enumerateClassLoaders({
            onMatch: function (loader) {
                try {
                    // 尝试用这个ClassLoader来Hook
                    Java.classFactory.loader = loader;

                    // 在这里添加你的Hook代码
                    // 示例：hookTargetMethod();

                    console.log("[+] 尝试ClassLoader: " + loader.toString());
                } catch (e) { }
            },
            onComplete: function () {
                console.log("[*] ClassLoader枚举完成");
            }
        });

        // ======== 示例Hook代码 ========
        // hookTargetMethod();
    }

    // ======== 示例：Hook目标方法 ========
    function hookTargetMethod() {
        // 示例：Hook某个类的方法
        // try {
        //     var TargetClass = Java.use("com.example.TargetClass");
        //     TargetClass.targetMethod.implementation = function() {
        //         console.log("[+] targetMethod被调用");
        //         return this.targetMethod();
        //     };
        // } catch (e) {
        //     console.log("[-] Hook失败: " + e);
        // }
    }

    // ======== 6. 主动搜索并Hook ========
    function searchAndHook(className, methodName) {
        console.log("[*] 搜索并Hook: " + className + "." + methodName);

        Java.enumerateClassLoaders({
            onMatch: function (loader) {
                try {
                    Java.classFactory.loader = loader;
                    var clazz = Java.use(className);

                    if (clazz && clazz[methodName]) {
                        clazz[methodName].implementation = function () {
                            console.log("[+] " + className + "." + methodName + " 被调用");
                            console.log("    参数: " + JSON.stringify(arguments));
                            return this[methodName].apply(this, arguments);
                        };
                        console.log("[+] 成功Hook: " + className + "." + methodName);
                    }
                } catch (e) { }
            },
            onComplete: function () { }
        });
    }

    // ======== 7. 检测壳类型 ========
    function detectShellType() {
        var shellTypes = {
            "com.stub.StubApp": "360加固",
            "com.secneo.apkwrapper": "梆梆加固",
            "com.tencent.bugly": "腾讯乐固",
            "com.ijiami": "爱加密",
            "com.secshell.shellwrapper": "通付盾",
            "com.bangcle.everisk": "梆梆企业版",
            "s.h.e.l.l.S": "百度加固"
        };

        Java.enumerateLoadedClasses({
            onMatch: function (className) {
                for (var prefix in shellTypes) {
                    if (className.startsWith(prefix)) {
                        console.log("[!] 检测到加固类型: " + shellTypes[prefix]);
                        console.log("    特征类: " + className);
                    }
                }
            },
            onComplete: function () { }
        });
    }

    // 启动时检测壳类型
    setTimeout(detectShellType, 1000);

    // 导出搜索Hook函数供外部调用
    global.searchAndHook = searchAndHook;

    console.log("[*] 带壳Hook脚本加载完成");
    console.log("[!] 提示: 使用 searchAndHook('类名', '方法名') 来Hook目标方法");
});
