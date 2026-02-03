/**
 * DEX脱壳脚本
 * 功能：通用DEX脱壳，支持主流加固方案
 * 支持：360加固、腾讯乐固、爱加密、梆梆加固等
 */

Java.perform(function () {
    console.log("[*] 开始加载DEX脱壳脚本...");

    var outputDir = "/data/local/tmp/dex_dump/";

    // 确保输出目录存在
    try {
        var File = Java.use("java.io.File");
        var dir = File.$new(outputDir);
        if (!dir.exists()) {
            dir.mkdirs();
            console.log("[+] 创建输出目录: " + outputDir);
        }
    } catch (e) {
        console.log("[-] 创建目录失败: " + e);
        outputDir = "/sdcard/dex_dump/";
        console.log("[*] 使用备用目录: " + outputDir);
    }

    var dumpedDexes = {};

    // ======== 1. Hook DexFile加载 ========
    try {
        var DexFile = Java.use("dalvik.system.DexFile");

        DexFile.$init.overload("java.io.File").implementation = function (file) {
            var path = file.getAbsolutePath();
            console.log("[+] DexFile加载: " + path);
            dumpDexFromPath(path);
            return this.$init(file);
        };

        DexFile.$init.overload("java.lang.String").implementation = function (path) {
            console.log("[+] DexFile加载: " + path);
            dumpDexFromPath(path);
            return this.$init(path);
        };

        console.log("[+] DexFile Hook完成");
    } catch (e) {
        console.log("[-] DexFile Hook失败: " + e);
    }

    // ======== 2. Hook InMemoryDexClassLoader (Android 8.0+) ========
    try {
        var InMemoryDexClassLoader = Java.use("dalvik.system.InMemoryDexClassLoader");

        InMemoryDexClassLoader.$init.overload("java.nio.ByteBuffer", "java.lang.ClassLoader").implementation = function (buffer, parent) {
            console.log("[+] InMemoryDexClassLoader加载，大小: " + buffer.remaining());
            dumpDexFromBuffer(buffer);
            return this.$init(buffer, parent);
        };

        InMemoryDexClassLoader.$init.overload("[Ljava.nio.ByteBuffer;", "java.lang.ClassLoader").implementation = function (buffers, parent) {
            console.log("[+] InMemoryDexClassLoader加载多个DEX，数量: " + buffers.length);
            for (var i = 0; i < buffers.length; i++) {
                if (buffers[i]) {
                    dumpDexFromBuffer(buffers[i]);
                }
            }
            return this.$init(buffers, parent);
        };

        console.log("[+] InMemoryDexClassLoader Hook完成");
    } catch (e) {
        console.log("[-] InMemoryDexClassLoader Hook失败: " + e);
    }

    // ======== 3. Hook BaseDexClassLoader ========
    try {
        var BaseDexClassLoader = Java.use("dalvik.system.BaseDexClassLoader");

        BaseDexClassLoader.$init.overload("java.lang.String", "java.io.File", "java.lang.String", "java.lang.ClassLoader").implementation = function (dexPath, optimizedDirectory, libraryPath, parent) {
            console.log("[+] BaseDexClassLoader加载: " + dexPath);
            if (dexPath) {
                dumpDexFromPath(dexPath);
            }
            return this.$init(dexPath, optimizedDirectory, libraryPath, parent);
        };

        console.log("[+] BaseDexClassLoader Hook完成");
    } catch (e) {
        console.log("[-] BaseDexClassLoader Hook失败: " + e);
    }

    // ======== 4. Hook PathClassLoader ========
    try {
        var PathClassLoader = Java.use("dalvik.system.PathClassLoader");

        PathClassLoader.$init.overload("java.lang.String", "java.lang.ClassLoader").implementation = function (dexPath, parent) {
            console.log("[+] PathClassLoader加载: " + dexPath);
            if (dexPath) {
                dumpDexFromPath(dexPath);
            }
            return this.$init(dexPath, parent);
        };

        PathClassLoader.$init.overload("java.lang.String", "java.lang.String", "java.lang.ClassLoader").implementation = function (dexPath, libraryPath, parent) {
            console.log("[+] PathClassLoader加载: " + dexPath);
            if (dexPath) {
                dumpDexFromPath(dexPath);
            }
            return this.$init(dexPath, libraryPath, parent);
        };

        console.log("[+] PathClassLoader Hook完成");
    } catch (e) {
        console.log("[-] PathClassLoader Hook失败: " + e);
    }

    // ======== 5. Hook DexClassLoader ========
    try {
        var DexClassLoader = Java.use("dalvik.system.DexClassLoader");

        DexClassLoader.$init.overload("java.lang.String", "java.lang.String", "java.lang.String", "java.lang.ClassLoader").implementation = function (dexPath, optimizedDirectory, libraryPath, parent) {
            console.log("[+] DexClassLoader加载: " + dexPath);
            if (dexPath) {
                dumpDexFromPath(dexPath);
            }
            return this.$init(dexPath, optimizedDirectory, libraryPath, parent);
        };

        console.log("[+] DexClassLoader Hook完成");
    } catch (e) {
        console.log("[-] DexClassLoader Hook失败: " + e);
    }

    // ======== 6. 通过内存搜索DEX ========
    function searchAndDumpDex() {
        console.log("[*] 开始内存搜索DEX...");

        try {
            var modules = Process.enumerateModules();
            for (var i = 0; i < modules.length; i++) {
                var module = modules[i];
                if (module.name.indexOf("libart") !== -1 || module.name.indexOf("libdvm") !== -1) {
                    continue;
                }

                try {
                    var ranges = module.enumerateRanges("r--");
                    for (var j = 0; j < ranges.length; j++) {
                        var range = ranges[j];
                        if (range.size > 0x70) {
                            var magic = Memory.readByteArray(range.base, 4);
                            var magicStr = Array.prototype.map.call(new Uint8Array(magic), function (x) {
                                return String.fromCharCode(x);
                            }).join("");

                            if (magicStr === "dex\n") {
                                var fileSize = Memory.readU32(range.base.add(0x20));
                                if (fileSize > 0 && fileSize < range.size) {
                                    var dexHash = Memory.readByteArray(range.base, 0x20);
                                    var hashStr = Array.prototype.map.call(new Uint8Array(dexHash), function (x) {
                                        return x.toString(16).padStart(2, "0");
                                    }).join("");

                                    if (!dumpedDexes[hashStr]) {
                                        console.log("[+] 发现DEX: " + range.base + ", 大小: " + fileSize);
                                        saveDex(range.base, fileSize);
                                        dumpedDexes[hashStr] = true;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { }
            }
        } catch (e) {
            console.log("[-] 内存搜索失败: " + e);
        }
    }

    // ======== 辅助函数：从路径Dump DEX ========
    function dumpDexFromPath(path) {
        try {
            var File = Java.use("java.io.File");
            var FileInputStream = Java.use("java.io.FileInputStream");
            var ByteArrayOutputStream = Java.use("java.io.ByteArrayOutputStream");

            var file = File.$new(path);
            if (file.exists() && file.isFile()) {
                var fis = FileInputStream.$new(file);
                var baos = ByteArrayOutputStream.$new();
                var buffer = Java.array("byte", new Array(4096).fill(0));
                var len;

                while ((len = fis.read(buffer)) !== -1) {
                    baos.write(buffer, 0, len);
                }

                fis.close();
                var data = baos.toByteArray();
                baos.close();

                // 检查是否为DEX文件
                if (data.length > 4 && data[0] === 0x64 && data[1] === 0x65 && data[2] === 0x78) {
                    saveToFile(data, path);
                }
            }
        } catch (e) {
            console.log("[-] 从路径Dump失败: " + e);
        }
    }

    // ======== 辅助函数：从ByteBuffer Dump DEX ========
    function dumpDexFromBuffer(buffer) {
        try {
            var position = buffer.position();
            var remaining = buffer.remaining();

            if (remaining > 0) {
                var data = Java.array("byte", new Array(remaining).fill(0));
                buffer.get(data);
                buffer.position(position); // 恢复位置

                // 检查是否为DEX文件
                if (data.length > 4 && data[0] === 0x64 && data[1] === 0x65 && data[2] === 0x78) {
                    saveToFile(data, "memory_dex");
                }
            }
        } catch (e) {
            console.log("[-] 从Buffer Dump失败: " + e);
        }
    }

    // ======== 辅助函数：保存DEX到Native内存 ========
    function saveDex(base, size) {
        try {
            var timestamp = Date.now();
            var filename = outputDir + "dump_" + timestamp + "_" + size + ".dex";

            var File = Java.use("java.io.File");
            var FileOutputStream = Java.use("java.io.FileOutputStream");

            var dexData = Memory.readByteArray(base, size);
            var file = File.$new(filename);
            var fos = FileOutputStream.$new(file);
            fos.write(Java.array("byte", Array.from(new Uint8Array(dexData))));
            fos.close();

            console.log("[+] DEX已保存: " + filename);
        } catch (e) {
            console.log("[-] 保存DEX失败: " + e);
        }
    }

    // ======== 辅助函数：保存Java数组到文件 ========
    function saveToFile(data, source) {
        try {
            var timestamp = Date.now();
            var sourceName = source.replace(/[^a-zA-Z0-9]/g, "_");
            var filename = outputDir + "dump_" + sourceName + "_" + timestamp + ".dex";

            var File = Java.use("java.io.File");
            var FileOutputStream = Java.use("java.io.FileOutputStream");

            var file = File.$new(filename);
            var fos = FileOutputStream.$new(file);
            fos.write(data);
            fos.close();

            console.log("[+] DEX已保存: " + filename + " (大小: " + data.length + ")");
        } catch (e) {
            console.log("[-] 保存失败: " + e);
        }
    }

    // 延迟执行内存搜索
    setTimeout(function () {
        searchAndDumpDex();
    }, 3000);

    console.log("[*] DEX脱壳脚本加载完成");
    console.log("[!] DEX文件将保存到: " + outputDir);
});
