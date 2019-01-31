/// <reference path="microReact.ts" />
/// <reference path="runtime.ts" />
var app;
(function (app) {
    //---------------------------------------------------------
    // Renderer
    //---------------------------------------------------------
    var perfStats;
    var updateStat = 0;
    function initRenderer() {
        app.renderer = new microReact.Renderer();
        document.body.appendChild(app.renderer.content);
        window.addEventListener("resize", render);
        perfStats = document.createElement("div");
        perfStats.id = "perfStats";
        document.body.appendChild(perfStats);
    }
    var performance = window["performance"] || { now: function () { return (new Date()).getTime(); } };
    app.renderRoots = {};
    function render() {
        app.renderer.queued = true;
        // @FIXME: why does using request animation frame cause events to stack up and the renderer to get behind?
        setTimeout(function () {
            // requestAnimationFrame(function() {
            var start = performance.now();
            var trees = [];
            for (var root in app.renderRoots) {
                trees.push(app.renderRoots[root]());
            }
            var total = performance.now() - start;
            if (total > 10) {
                console.log("Slow root: " + total);
            }
            perfStats.textContent = "";
            perfStats.textContent += "root: " + total.toFixed(2);
            var start = performance.now();
            app.renderer.render(trees);
            var total = performance.now() - start;
            perfStats.textContent += " | render: " + total.toFixed(2);
            perfStats.textContent += " | update: " + updateStat.toFixed(2);
            app.renderer.queued = false;
        }, 16);
    }
    app.render = render;
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
    app.handle = handle;
    function dispatch(event, info, dispatchInfo) {
        var result = dispatchInfo;
        if (!result) {
            result = app.eve.diff();
            result.meta.render = true;
            result.meta.store = true;
        }
        result.dispatch = function (event, info) {
            return dispatch(event, info, result);
        };
        result.commit = function () {
            var start = performance.now();
            app.eve.applyDiff(result);
            if (result.meta.render) {
                render();
            }
            if (result.meta.store) {
                localStorage["eve"] = app.eve.serialize();
            }
            updateStat = performance.now() - start;
            console.log("UPDATE TOOK: ", updateStat);
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
    app.dispatch = dispatch;
    //---------------------------------------------------------
    // State
    //---------------------------------------------------------
    app.eve = runtime.indexer();
    app.initializers = {};
    function init(name, func) {
        app.initializers[name] = func;
    }
    app.init = init;
    function executeInitializers() {
        for (var initName in app.initializers) {
            app.initializers[initName]();
        }
    }
    //---------------------------------------------------------
    // Go
    //---------------------------------------------------------
    document.addEventListener("DOMContentLoaded", function (event) {
        initRenderer();
        executeInitializers();
        render();
    });
})(app || (app = {}));
//# sourceMappingURL=app.js.map