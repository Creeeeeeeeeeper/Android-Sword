Java.perform(function () {
    const StringClass = Java.use("java.lang.String");
    StringClass.equals.overload('java.lang.Object').implementation = function (obj) {
        const currentString = this.toString();
        const targetString = (obj !== null) ? obj.toString() : "null";
        console.log(`[equals()]: "${currentString}" vs "${targetString}"`);
        const originalResult = this.equals(obj);
        return originalResult;
    };

    // 忽略大小写
    StringClass.equalsIgnoreCase.overload('java.lang.String').implementation = function (str) {
        const currentString = this.toString();
        const targetString = (str !== null) ? str.toString() : "null";
        console.log(`[equalsIgnoreCase()]: "${currentString}" vs "${targetString}"`);
        return this.equalsIgnoreCase(str);
    };

    // 内容比较
    StringClass.contentEquals.overload('java.lang.StringBuffer').implementation = function (cs) {
        const currentString = this.toString();
        const targetString = (cs !== null) ? cs.toString() : "null";
        console.log(`[contentEquals()]: "${currentString}" vs "${targetString}"`);
        return this.contentEquals(cs);
    }
    StringClass.contentEquals.overload('java.lang.CharSequence').implementation = function (cs) {
        const currentString = this.toString();
        const targetString = (cs !== null) ? cs.toString() : "null";
        console.log(`[contentEquals()]: "${currentString}" vs "${targetString}"`);
        return this.contentEquals(cs);
    }
});