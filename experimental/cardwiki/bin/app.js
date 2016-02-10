/// <reference path="microReact.ts" />
/// <reference path="../vendor/marked.d.ts" />
var microReact = require("./microReact");
var runtime = require("./runtime");
var uiRenderer_1 = require("./uiRenderer");
exports.syncedTables = ["manual entity", "view", "action", "action source", "action mapping", "action mapping constant", "action mapping sorted", "action mapping limit", "add collection action", "add eav action", "add bit action"];
exports.eveLocalStorageKey = "eve";
//---------------------------------------------------------
// Renderer
//---------------------------------------------------------
var perfStats;
var updateStat = 0;
function initRenderer() {
    exports.renderer = new microReact.Renderer();
    exports.uiRenderer = new uiRenderer_1.UIRenderer(exports.eve);
    document.body.appendChild(exports.renderer.content);
    window.addEventListener("resize", render);
    perfStats = document.createElement("div");
    perfStats.id = "perfStats";
    document.body.appendChild(perfStats);
}
var performance = window["performance"] || { now: function () { return (new Date()).getTime(); } };
exports.renderRoots = {};
function render() {
    if (!exports.renderer)
        return;
    exports.renderer.queued = true;
    // @FIXME: why does using request animation frame cause events to stack up and the renderer to get behind?
    setTimeout(function () {
        // requestAnimationFrame(function() {
        var stats = {};
        var start = performance.now();
        var trees = [];
        for (var root in exports.renderRoots) {
            trees.push(exports.renderRoots[root]());
        }
        stats.root = (performance.now() - start).toFixed(2);
        if (+stats.root > 10)
            console.log("Slow root: " + stats.root);
        start = performance.now();
        var dynamicUI = exports.eve.find("system ui").map(function (ui) { return ui["template"]; });
        if (window["DEBUG"] && window["DEBUG"].UI_COMPILE) {
            console.log("compiling", dynamicUI);
            console.log("*", exports.uiRenderer.compile(dynamicUI));
        }
        trees.push.apply(trees, exports.uiRenderer.compile(dynamicUI));
        stats.uiCompile = (performance.now() - start).toFixed(2);
        if (+stats.uiCompile > 10)
            console.log("Slow ui compile: " + stats.uiCompile);
        start = performance.now();
        exports.renderer.render(trees);
        stats.render = (performance.now() - start).toFixed(2);
        stats.update = updateStat.toFixed(2);
        perfStats.textContent = "";
        perfStats.textContent += "root: " + stats.root;
        perfStats.textContent += " | ui compile: " + stats.uiCompile;
        perfStats.textContent += " | render: " + stats.render;
        perfStats.textContent += " | update: " + stats.update;
        exports.renderer.queued = false;
        var changeset = exports.eve.diff();
        changeset.remove("builtin entity", { entity: "render performance statistics" });
        changeset.add("builtin entity", { entity: "render performance statistics", content: "\n    # Render performance statistics ({is a: system})\n    root: {root: " + stats.root + "}\n    ui compile: {ui compile: " + stats.uiCompile + "}\n    render: {render: " + stats.render + "}\n    update: {update: " + stats.update + "}\n    Horrible hack, disregard this: {perf stats: render performance statistics}\n    " });
        exports.eve.applyDiff(changeset);
    }, 16);
}
exports.render = render;
//---------------------------------------------------------
// Dispatch
//---------------------------------------------------------
var dispatches = {};
function handle(event, func) {
    if (dispatches[event]) {
        console.error("Overwriting handler for '" + event + "'");
    }
    dispatches[event] = func;
}
exports.handle = handle;
function dispatch(event, info, dispatchInfo) {
    var result = dispatchInfo;
    if (!result) {
        result = exports.eve.diff();
        result.meta.render = true;
        result.meta.store = true;
    }
    result.dispatch = function (event, info) {
        return dispatch(event, info, result);
    };
    result.commit = function () {
        var start = performance.now();
        exports.eve.applyDiff(result);
        if (result.meta.render) {
            render();
        }
        if (result.meta.store) {
            var serialized = exports.eve.serialize(true);
            if (exports.eveLocalStorageKey === "eve") {
                for (var _i = 0; _i < exports.syncedTables.length; _i++) {
                    var synced = exports.syncedTables[_i];
                    delete serialized[synced];
                }
                sendChangeSet(result);
            }
            localStorage[exports.eveLocalStorageKey] = JSON.stringify(serialized);
        }
        updateStat = performance.now() - start;
    };
    var func = dispatches[event];
    if (!func) {
        console.error("No dispatches for '" + event + "' with " + JSON.stringify(info));
    }
    else {
        func(result, info);
    }
    return result;
}
exports.dispatch = dispatch;
//---------------------------------------------------------
// State
//---------------------------------------------------------
exports.eve = runtime.indexer();
exports.initializers = {};
exports.activeSearches = {};
function init(name, func) {
    exports.initializers[name] = func;
}
exports.init = init;
function executeInitializers() {
    for (var initName in exports.initializers) {
        exports.initializers[initName]();
    }
}
//---------------------------------------------------------
// Websocket
//---------------------------------------------------------
var me = localStorage["me"] || uuid();
localStorage["me"] = me;
function connectToServer() {
    exports.socket = new WebSocket("ws://" + (window.location.hostname || "localhost") + ":8080");
    exports.socket.onerror = function () {
        console.error("Failed to connect to server, falling back to local storage");
        exports.eveLocalStorageKey = "local-eve";
        executeInitializers();
        render();
    };
    exports.socket.onopen = function () {
        sendServer("connect", me);
    };
    exports.socket.onmessage = function (data) {
        var parsed = JSON.parse(data.data);
        console.log("WS MESSAGE:", parsed);
        if (parsed.kind === "load") {
            exports.eve.load(parsed.data);
            executeInitializers();
            render();
        }
        else if (parsed.kind === "changeset") {
            var diff = exports.eve.diff();
            diff.tables = parsed.data;
            exports.eve.applyDiff(diff);
            render();
        }
    };
}
function sendServer(messageKind, data) {
    if (!exports.socket)
        return;
    exports.socket.send(JSON.stringify({ kind: messageKind, me: me, time: (new Date).getTime(), data: data }));
}
function sendChangeSet(changeset) {
    if (!exports.socket)
        return;
    var changes = {};
    var send = false;
    for (var _i = 0; _i < exports.syncedTables.length; _i++) {
        var table = exports.syncedTables[_i];
        if (changeset.tables[table]) {
            send = true;
            changes[table] = changeset.tables[table];
        }
    }
    if (send)
        sendServer("changeset", changes);
}
//---------------------------------------------------------
// Go
//---------------------------------------------------------
document.addEventListener("DOMContentLoaded", function (event) {
    initRenderer();
    connectToServer();
    render();
});
init("load data", function () {
    var stored = localStorage[exports.eveLocalStorageKey];
    exports.eve.load(stored);
    console.log(JSON.parse(stored));
});
//# sourceMappingURL=app.js.map