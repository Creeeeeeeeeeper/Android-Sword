var strcmp = Module.findExportByName(null, "strcmp")

Interceptor.attach(strcmp, {
    onEnter: function (args) {
        console.log(`[strcmp]: ${args[0].readCString()}, "vs", ${args[1].readCString()}`);
    },
    onLeave: function (result) {
        
    }
});