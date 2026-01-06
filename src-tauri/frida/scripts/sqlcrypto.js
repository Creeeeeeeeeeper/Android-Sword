// 半成品
Java.perform(function () {
    function showStacks() {
        console.log(
            Java.use("android.util.Log")
                .getStackTraceString(
                    Java.use("java.lang.Throwable").$new()
                )
        );
    }

    var ByteString = Java.use("com.android.okhttp.okio.ByteString");
    function toBase64(tag, data) {
        //logOutPut(tag + " Base64: " + ByteString.of(data).base64());
        console.log(tag + " Base64: " + ByteString.of(data).base64());
    }
    function toHex(tag, data) {
        //logOutPut(tag + " Hex: " + ByteString.of(data).hex());
        console.log(tag + " Hex: " + ByteString.of(data).hex());
    }
    function toUtf8(tag, data) {
        //logOutPut(tag + " Utf8: " + ByteString.of(data).utf8());
        console.log(tag + " Utf8: " + ByteString.of(data).utf8());
    }

    /*
        对 net.sqlcipher 进行hook
        net.sqlcipher.database.SQLiteDatabase.openOrCreateDatabase 打开\创建数据库方法
        net.sqlcipher.database.SQLiteDatabase.changePassword 修改\移除密码方法
        net.sqlcipher.database.SQLiteDatabase.execSQL 执行SQL语句方法
    */

    // hook net.sqlcipher.database.SQLiteDatabase.openOrCreateDatabase
    let SQLiteDatabase = Java.use("net.sqlcipher.database.SQLiteDatabase");
    SQLiteDatabase["openOrCreateDatabase"].overload('java.io.File', 'java.lang.String', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str},\n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', 'java.lang.String', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str},\n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', 'java.lang.String', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook) {
        console.log(`SQLiteDatabase.openOrCreateDatabase is called: file=${file}, str=${str}, cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.io.File', 'java.lang.String', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook', 'net.sqlcipher.h').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook, h) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str},\n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}, h=${h}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook, h);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', 'java.lang.String', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook', 'net.sqlcipher.h').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook, h) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str},\n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}, h=${h}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook, h);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.io.File', 'java.lang.String', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory').implementation = function (file, str, cursorFactory) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str},\n cursorFactory=${cursorFactory}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', 'java.lang.String', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory').implementation = function (file, str, cursorFactory) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str},\n cursorFactory=${cursorFactory}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', '[B', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory').implementation = function (file, str, cursorFactory) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n cursorFactory=${cursorFactory}`);
        toBase64("password", str)
        toHex("password", str)
        toUtf8("password", str)
        let result = this["openOrCreateDatabase"](file, str, cursorFactory);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', '[B', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}`);
        toBase64("password", str)
        toHex("password", str)
        toUtf8("password", str)
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', '[B', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook', 'net.sqlcipher.h').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook, h) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}, h=${h}`);
        toBase64("password", str)
        toHex("password", str)
        toUtf8("password", str)
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook, h);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', '[C', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook', 'net.sqlcipher.h').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook, h) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str}, \n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}, h=${h}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook, h);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', '[C', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory', 'net.sqlcipher.database.SQLiteDatabaseHook').implementation = function (file, str, cursorFactory, sQLiteDatabaseHook) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str}, \n cursorFactory=${cursorFactory}, sQLiteDatabaseHook=${sQLiteDatabaseHook}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory, sQLiteDatabaseHook);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };
    SQLiteDatabase["openOrCreateDatabase"].overload('java.lang.String', '[C', 'net.sqlcipher.database.SQLiteDatabase$CursorFactory').implementation = function (file, str, cursorFactory) {
        console.log(`SQLiteDatabase.openOrCreateDatabase: \n path=${file},\n password=${str},\n cursorFactory=${cursorFactory}`);
        let result = this["openOrCreateDatabase"](file, str, cursorFactory);
        console.log(`SQLiteDatabase.openOrCreateDatabase result=${result}`);
        return result;
    };


    // hook net.sqlcipher.database.SQLiteDatabase.changePassword
    SQLiteDatabase["changePassword"].overload('java.lang.String').implementation = function (str) {
        console.log(`SQLiteDatabase.changePassword: password=${str}`);
        this["changePassword"](str);
    };
    SQLiteDatabase["changePassword"].overload('[C').implementation = function (cArr) {
        console.log(`SQLiteDatabase.changePassword: password=${cArr}`);
        this["changePassword"](cArr);
    };

    // hook net.sqlcipher.database.SQLiteDatabase.execSQL
    SQLiteDatabase["execSQL"].overload('java.lang.String').implementation = function (str) {
        console.log(`执行SQL指令: ${str}`);
        this["execSQL"](str);
    };
    SQLiteDatabase["rawExecSQL"].implementation = function (str) {
        console.log(`执行SQL指令: ${str}`);
        this["rawExecSQL"](str);
    };

    /*
        对 com.tencent.wcdb.database.SQLiteDatabase 进行hook
        微信WCDB数据库 (WeChat Database)
    */
    try {
        let WcdbSQLiteDatabase = Java.use("com.tencent.wcdb.database.SQLiteDatabase");

        // Hook openDatabase - 打开数据库
        WcdbSQLiteDatabase["openDatabase"].overload('java.lang.String', '[B', 'com.tencent.wcdb.database.SQLiteCipherSpec', 'com.tencent.wcdb.database.SQLiteDatabase$CursorFactory', 'int', 'com.tencent.wcdb.DatabaseErrorHandler', 'int').implementation = function (path, password, cipherSpec, cursorFactory, flags, errorHandler, lookasideSlotSize) {
            console.log(`[WCDB] SQLiteDatabase.openDatabase called:`);
            console.log(`  path: ${path}`);
            console.log(`  cipherSpec: ${cipherSpec}`);
            console.log(`  cursorFactory: ${cursorFactory}`);
            console.log(`  flags: ${flags}`);
            console.log(`  errorHandler: ${errorHandler}`);
            console.log(`  lookasideSlotSize: ${lookasideSlotSize}`);
            if (password != null && password.length > 0) {
                toBase64("[WCDB] password", password);
                toHex("[WCDB] password", password);
                toUtf8("[WCDB] password", password);
            } else {
                console.log(`  password: null or empty`);
            }
            let result = this["openDatabase"](path, password, cipherSpec, cursorFactory, flags, errorHandler, lookasideSlotSize);
            console.log(`[WCDB] SQLiteDatabase.openDatabase result: ${result}`);
            return result;
        };

        // Hook openDatabase - 简化版本
        WcdbSQLiteDatabase["openDatabase"].overload('java.lang.String', '[B', 'com.tencent.wcdb.database.SQLiteCipherSpec', 'com.tencent.wcdb.database.SQLiteDatabase$CursorFactory', 'int').implementation = function (path, password, cipherSpec, cursorFactory, flags) {
            console.log(`[WCDB] SQLiteDatabase.openDatabase called:`);
            console.log(`  path: ${path}`);
            console.log(`  cipherSpec: ${cipherSpec}`);
            console.log(`  cursorFactory: ${cursorFactory}`);
            console.log(`  flags: ${flags}`);
            if (password != null && password.length > 0) {
                toBase64("[WCDB] password", password);
                toHex("[WCDB] password", password);
                toUtf8("[WCDB] password", password);
            } else {
                console.log(`  password: null or empty`);
            }
            let result = this["openDatabase"](path, password, cipherSpec, cursorFactory, flags);
            console.log(`[WCDB] SQLiteDatabase.openDatabase result: ${result}`);
            return result;
        };

        // Hook changePassword - 修改密码
        WcdbSQLiteDatabase["changePassword"].overload('[B').implementation = function (password) {
            console.log(`[WCDB] SQLiteDatabase.changePassword called:`);
            if (password != null && password.length > 0) {
                toBase64("[WCDB] new password", password);
                toHex("[WCDB] new password", password);
                toUtf8("[WCDB] new password", password);
            } else {
                console.log(`  new password: null or empty (removing encryption)`);
            }
            this["changePassword"](password);
        };

        // Hook execSQL - 执行SQL语句
        WcdbSQLiteDatabase["execSQL"].overload('java.lang.String').implementation = function (sql) {
            console.log(`[WCDB] 执行SQL指令: ${sql}`);
            this["execSQL"](sql);
        };

        WcdbSQLiteDatabase["execSQL"].overload('java.lang.String', '[Ljava.lang.Object;').implementation = function (sql, bindArgs) {
            console.log(`[WCDB] 执行SQL指令: ${sql}`);
            console.log(`[WCDB] 绑定参数: ${bindArgs}`);
            this["execSQL"](sql, bindArgs);
        };

        // Hook rawExecSQL - 原始SQL执行
        if (WcdbSQLiteDatabase.rawExecSQL) {
            WcdbSQLiteDatabase["rawExecSQL"].implementation = function (sql) {
                console.log(`[WCDB] 执行原始SQL指令: ${sql}`);
                this["rawExecSQL"](sql);
            };
        }

        console.log("[+] WCDB (WeChat Database) hooks installed successfully");
    } catch (e) {
        console.log("[-] WCDB not found or hook failed: " + e.message);
    }
})