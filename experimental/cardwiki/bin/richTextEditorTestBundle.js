(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/// <reference path="microReact.ts" />
/// <reference path="../vendor/marked.d.ts" />
var microReact = require("./microReact");
var runtime = require("./runtime");
var uiRenderer_1 = require("./uiRenderer");
var utils_1 = require("./utils");
exports.syncedTables = ["manual eav", "view", "action", "action source", "action mapping", "action mapping constant", "action mapping sorted", "action mapping limit", "add collection action", "add eav action", "add bit action"];
exports.eveLocalStorageKey = "eve";
//---------------------------------------------------------
// Renderer
//---------------------------------------------------------
var perfStats;
var perfStatsUi;
var updateStat = 0;
function initRenderer() {
    exports.renderer = new microReact.Renderer();
    exports.uiRenderer = new uiRenderer_1.UIRenderer(exports.eve);
    document.body.appendChild(exports.renderer.content);
    window.addEventListener("resize", render);
    perfStatsUi = document.createElement("div");
    perfStatsUi.id = "perfStats";
    document.body.appendChild(perfStatsUi);
}
if (utils_1.ENV === "browser")
    var performance = window["performance"] || { now: function () { return (new Date()).getTime(); } };
exports.renderRoots = {};
function render() {
    if (!exports.renderer || exports.renderer.queued)
        return;
    exports.renderer.queued = true;
    requestAnimationFrame(function () {
        var stats = {};
        var start = performance.now();
        var trees = [];
        for (var root in exports.renderRoots) {
            trees.push(exports.renderRoots[root]());
        }
        stats.root = (performance.now() - start).toFixed(2);
        if (+stats.root > 10)
            console.info("Slow root: " + stats.root);
        start = performance.now();
        var dynamicUI = exports.eve.find("system ui").map(function (ui) { return ui["template"]; });
        if (utils_1.DEBUG && utils_1.DEBUG.UI_COMPILE) {
            console.info("compiling", dynamicUI);
            console.info("*", exports.uiRenderer.compile(dynamicUI));
        }
        trees.push.apply(trees, exports.uiRenderer.compile(dynamicUI));
        stats.uiCompile = (performance.now() - start).toFixed(2);
        if (+stats.uiCompile > 10)
            console.info("Slow ui compile: " + stats.uiCompile);
        start = performance.now();
        exports.renderer.render(trees);
        stats.render = (performance.now() - start).toFixed(2);
        stats.update = updateStat.toFixed(2);
        perfStatsUi.textContent = "";
        perfStatsUi.textContent += "root: " + stats.root;
        perfStatsUi.textContent += " | ui compile: " + stats.uiCompile;
        perfStatsUi.textContent += " | render: " + stats.render;
        perfStatsUi.textContent += " | update: " + stats.update;
        perfStats = stats;
        exports.renderer.queued = false;
    });
}
exports.render = render;
var storeQueued = false;
function storeLocally() {
    if (storeQueued)
        return;
    storeQueued = true;
    setTimeout(function () {
        var serialized = exports.eve.serialize(true);
        if (exports.eveLocalStorageKey === "eve") {
            for (var _i = 0; _i < exports.syncedTables.length; _i++) {
                var synced = exports.syncedTables[_i];
                delete serialized[synced];
            }
        }
        delete serialized["provenance"];
        localStorage[exports.eveLocalStorageKey] = JSON.stringify(serialized);
        storeQueued = false;
    }, 1000);
}
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
        // result.remove("builtin entity", {entity: "render performance statistics"});
        // result.add("builtin entity", {entity: "render performance statistics", content: `
        // # Render performance statistics ({is a: system})
        // root: {root: ${perfStats.root}}
        // ui compile: {ui compile: ${perfStats.uiCompile}}
        // render: {render: ${perfStats.render}}
        // update: {update: ${perfStats.update}}
        // Horrible hack, disregard this: {perf stats: render performance statistics}
        // `});
        if (!runtime.INCREMENTAL) {
            exports.eve.applyDiff(result);
        }
        else {
            exports.eve.applyDiffIncremental(result);
        }
        if (result.meta.render) {
            render();
        }
        if (result.meta.store) {
            storeLocally();
            if (exports.eveLocalStorageKey === "eve") {
                sendChangeSet(result);
            }
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
var me = utils_1.uuid();
if (this.localStorage) {
    if (localStorage["me"])
        me = localStorage["me"];
    else
        localStorage["me"] = me;
}
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
if (utils_1.ENV === "browser") {
    document.addEventListener("DOMContentLoaded", function (event) {
        initRenderer();
        connectToServer();
        render();
    });
}
init("load data", function () {
    var stored = localStorage[exports.eveLocalStorageKey];
    if (stored) {
        exports.eve.load(stored);
    }
});
if (utils_1.ENV === "browser")
    window["app"] = exports;

},{"./microReact":2,"./runtime":4,"./uiRenderer":5,"./utils":6}],2:[function(require,module,exports){
function now() {
    if (window.performance) {
        return window.performance.now();
    }
    return (new Date()).getTime();
}
function shallowEquals(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    for (var k in a) {
        if (a[k] !== b[k])
            return false;
    }
    for (var k in b) {
        if (b[k] !== a[k])
            return false;
    }
    return true;
}
function postAnimationRemove(elements) {
    for (var _i = 0; _i < elements.length; _i++) {
        var elem = elements[_i];
        if (elem.parentNode)
            elem.parentNode.removeChild(elem);
    }
}
var Renderer = (function () {
    function Renderer() {
        this.content = document.createElement("div");
        this.content.className = "__root";
        this.elementCache = { "__root": this.content };
        this.prevTree = {};
        this.tree = {};
        this.postRenders = [];
        this.lastDiff = { adds: [], updates: {} };
        var self = this;
        this.handleEvent = function handleEvent(e) {
            var id = (e.currentTarget || e.target)["_id"];
            var elem = self.tree[id];
            if (!elem)
                return;
            var handler = elem[e.type];
            if (handler) {
                handler(e, elem);
            }
        };
    }
    Renderer.prototype.reset = function () {
        this.prevTree = this.tree;
        this.tree = {};
        this.postRenders = [];
    };
    Renderer.prototype.domify = function () {
        var fakePrev = {}; //create an empty object once instead of every instance of the loop
        var elements = this.tree;
        var prevElements = this.prevTree;
        var diff = this.lastDiff;
        var adds = diff.adds;
        var updates = diff.updates;
        var elemKeys = Object.keys(updates);
        var elementCache = this.elementCache;
        var tempTween = {};
        //Create all the new elements to ensure that they're there when they need to be
        //parented
        for (var i = 0, len = adds.length; i < len; i++) {
            var id = adds[i];
            var cur = elements[id];
            var div;
            if (cur.svg) {
                div = document.createElementNS("http://www.w3.org/2000/svg", cur.t || "rect");
            }
            else {
                div = document.createElement(cur.t || "div");
            }
            div._id = id;
            elementCache[id] = div;
            if (cur.enter) {
                if (cur.enter.delay) {
                    cur.enter.display = "auto";
                    div.style.display = "none";
                }
                Velocity(div, cur.enter, cur.enter);
            }
        }
        for (var i = 0, len = elemKeys.length; i < len; i++) {
            var id = elemKeys[i];
            var cur = elements[id];
            var prev = prevElements[id] || fakePrev;
            var type = updates[id];
            var div;
            if (type === "replaced") {
                var me = elementCache[id];
                if (me.parentNode)
                    me.parentNode.removeChild(me);
                if (cur.svg) {
                    div = document.createElementNS("http://www.w3.org/2000/svg", cur.t || "rect");
                }
                else {
                    div = document.createElement(cur.t || "div");
                }
                div._id = id;
                elementCache[id] = div;
            }
            else if (type === "removed") {
                //NOTE: Batching the removes such that you only remove the parent
                //didn't actually make this faster surprisingly. Given that this
                //strategy is much simpler and there's no noticable perf difference
                //we'll just do the dumb thing and remove all the children one by one.
                var me = elementCache[id];
                if (prev.leave) {
                    prev.leave.complete = postAnimationRemove;
                    if (prev.leave.absolute) {
                        me.style.position = "absolute";
                    }
                    Velocity(me, prev.leave, prev.leave);
                }
                else if (me.parentNode)
                    me.parentNode.removeChild(me);
                elementCache[id] = null;
                continue;
            }
            else {
                div = elementCache[id];
            }
            var style = div.style;
            if (cur.c !== prev.c)
                div.className = cur.c;
            if (cur.draggable !== prev.draggable)
                div.draggable = cur.draggable === undefined ? null : "true";
            if (cur.contentEditable !== prev.contentEditable)
                div.contentEditable = cur.contentEditable || "inherit";
            if (cur.colspan !== prev.colspan)
                div.colSpan = cur.colspan;
            if (cur.placeholder !== prev.placeholder)
                div.placeholder = cur.placeholder;
            if (cur.selected !== prev.selected)
                div.selected = cur.selected;
            if (cur.value !== prev.value)
                div.value = cur.value;
            if (cur.t === "input" && cur.type !== prev.type)
                div.type = cur.type;
            if (cur.t === "input" && cur.checked !== prev.checked)
                div.checked = cur.checked;
            if ((cur.text !== prev.text || cur.strictText) && div.textContent !== cur.text)
                div.textContent = cur.text === undefined ? "" : cur.text;
            if (cur.tabindex !== prev.tabindex)
                div.setAttribute("tabindex", cur.tabindex);
            if (cur.href !== prev.href)
                div.setAttribute("href", cur.href);
            // animateable properties
            var tween = cur.tween || tempTween;
            if (cur.flex !== prev.flex) {
                if (tween.flex)
                    tempTween.flex = cur.flex;
                else
                    style.flex = cur.flex === undefined ? "" : cur.flex;
            }
            if (cur.left !== prev.left) {
                if (tween.left)
                    tempTween.left = cur.left;
                else
                    style.left = cur.left === undefined ? "" : cur.left;
            }
            if (cur.top !== prev.top) {
                if (tween.top)
                    tempTween.top = cur.top;
                else
                    style.top = cur.top === undefined ? "" : cur.top;
            }
            if (cur.height !== prev.height) {
                if (tween.height)
                    tempTween.height = cur.height;
                else
                    style.height = cur.height === undefined ? "auto" : cur.height;
            }
            if (cur.width !== prev.width) {
                if (tween.width)
                    tempTween.width = cur.width;
                else
                    style.width = cur.width === undefined ? "auto" : cur.width;
            }
            if (cur.zIndex !== prev.zIndex) {
                if (tween.zIndex)
                    tempTween.zIndex = cur.zIndex;
                else
                    style.zIndex = cur.zIndex;
            }
            if (cur.backgroundColor !== prev.backgroundColor) {
                if (tween.backgroundColor)
                    tempTween.backgroundColor = cur.backgroundColor;
                else
                    style.backgroundColor = cur.backgroundColor || "transparent";
            }
            if (cur.borderColor !== prev.borderColor) {
                if (tween.borderColor)
                    tempTween.borderColor = cur.borderColor;
                else
                    style.borderColor = cur.borderColor || "none";
            }
            if (cur.borderWidth !== prev.borderWidth) {
                if (tween.borderWidth)
                    tempTween.borderWidth = cur.borderWidth;
                else
                    style.borderWidth = cur.borderWidth || 0;
            }
            if (cur.borderRadius !== prev.borderRadius) {
                if (tween.borderRadius)
                    tempTween.borderRadius = cur.borderRadius;
                else
                    style.borderRadius = (cur.borderRadius || 0) + "px";
            }
            if (cur.opacity !== prev.opacity) {
                if (tween.opacity)
                    tempTween.opacity = cur.opacity;
                else
                    style.opacity = cur.opacity === undefined ? 1 : cur.opacity;
            }
            if (cur.fontSize !== prev.fontSize) {
                if (tween.fontSize)
                    tempTween.fontSize = cur.fontSize;
                else
                    style.fontSize = cur.fontSize;
            }
            if (cur.color !== prev.color) {
                if (tween.color)
                    tempTween.color = cur.color;
                else
                    style.color = cur.color || "inherit";
            }
            var animKeys = Object.keys(tempTween);
            if (animKeys.length) {
                Velocity(div, tempTween, tween);
                tempTween = {};
            }
            // non-animation style properties
            if (cur.backgroundImage !== prev.backgroundImage)
                style.backgroundImage = "url('" + cur.backgroundImage + "')";
            if (cur.border !== prev.border)
                style.border = cur.border || "none";
            if (cur.textAlign !== prev.textAlign) {
                style.alignItems = cur.textAlign;
                if (cur.textAlign === "center") {
                    style.textAlign = "center";
                }
                else if (cur.textAlign === "flex-end") {
                    style.textAlign = "right";
                }
                else {
                    style.textAlign = "left";
                }
            }
            if (cur.verticalAlign !== prev.verticalAlign)
                style.justifyContent = cur.verticalAlign;
            if (cur.fontFamily !== prev.fontFamily)
                style.fontFamily = cur.fontFamily || "inherit";
            if (cur.transform !== prev.transform)
                style.transform = cur.transform || "none";
            if (cur.style !== prev.style)
                div.setAttribute("style", cur.style);
            if (cur.dangerouslySetInnerHTML !== prev.dangerouslySetInnerHTML)
                div.innerHTML = cur.dangerouslySetInnerHTML;
            // debug/programmatic properties
            if (cur.semantic !== prev.semantic)
                div.setAttribute("data-semantic", cur.semantic);
            if (cur.debug !== prev.debug)
                div.setAttribute("data-debug", cur.debug);
            // SVG properties
            if (cur.svg) {
                if (cur.fill !== prev.fill)
                    div.setAttributeNS(null, "fill", cur.fill);
                if (cur.stroke !== prev.stroke)
                    div.setAttributeNS(null, "stroke", cur.stroke);
                if (cur.strokeWidth !== prev.strokeWidth)
                    div.setAttributeNS(null, "stroke-width", cur.strokeWidth);
                if (cur.d !== prev.d)
                    div.setAttributeNS(null, "d", cur.d);
                if (cur.c !== prev.c)
                    div.setAttributeNS(null, "class", cur.c);
                if (cur.x !== prev.x)
                    div.setAttributeNS(null, "x", cur.x);
                if (cur.y !== prev.y)
                    div.setAttributeNS(null, "y", cur.y);
                if (cur.dx !== prev.dx)
                    div.setAttributeNS(null, "dx", cur.dx);
                if (cur.dy !== prev.dy)
                    div.setAttributeNS(null, "dy", cur.dy);
                if (cur.cx !== prev.cx)
                    div.setAttributeNS(null, "cx", cur.cx);
                if (cur.cy !== prev.cy)
                    div.setAttributeNS(null, "cy", cur.cy);
                if (cur.r !== prev.r)
                    div.setAttributeNS(null, "r", cur.r);
                if (cur.height !== prev.height)
                    div.setAttributeNS(null, "height", cur.height);
                if (cur.width !== prev.width)
                    div.setAttributeNS(null, "width", cur.width);
                if (cur.xlinkhref !== prev.xlinkhref)
                    div.setAttributeNS('http://www.w3.org/1999/xlink', "href", cur.xlinkhref);
                if (cur.startOffset !== prev.startOffset)
                    div.setAttributeNS(null, "startOffset", cur.startOffset);
                if (cur.id !== prev.id)
                    div.setAttributeNS(null, "id", cur.id);
                if (cur.viewBox !== prev.viewBox)
                    div.setAttributeNS(null, "viewBox", cur.viewBox);
                if (cur.transform !== prev.transform)
                    div.setAttributeNS(null, "transform", cur.transform);
                if (cur.draggable !== prev.draggable)
                    div.setAttributeNS(null, "draggable", cur.draggable);
                if (cur.textAnchor !== prev.textAnchor)
                    div.setAttributeNS(null, "text-anchor", cur.textAnchor);
            }
            //events
            if (cur.dblclick !== prev.dblclick)
                div.ondblclick = cur.dblclick !== undefined ? this.handleEvent : undefined;
            if (cur.click !== prev.click)
                div.onclick = cur.click !== undefined ? this.handleEvent : undefined;
            if (cur.contextmenu !== prev.contextmenu)
                div.oncontextmenu = cur.contextmenu !== undefined ? this.handleEvent : undefined;
            if (cur.mousedown !== prev.mousedown)
                div.onmousedown = cur.mousedown !== undefined ? this.handleEvent : undefined;
            if (cur.mousemove !== prev.mousemove)
                div.onmousemove = cur.mousemove !== undefined ? this.handleEvent : undefined;
            if (cur.mouseup !== prev.mouseup)
                div.onmouseup = cur.mouseup !== undefined ? this.handleEvent : undefined;
            if (cur.mouseover !== prev.mouseover)
                div.onmouseover = cur.mouseover !== undefined ? this.handleEvent : undefined;
            if (cur.mouseout !== prev.mouseout)
                div.onmouseout = cur.mouseout !== undefined ? this.handleEvent : undefined;
            if (cur.mouseleave !== prev.mouseleave)
                div.onmouseleave = cur.mouseleave !== undefined ? this.handleEvent : undefined;
            if (cur.mousewheel !== prev.mousewheel)
                div.onmouseheel = cur.mousewheel !== undefined ? this.handleEvent : undefined;
            if (cur.dragover !== prev.dragover)
                div.ondragover = cur.dragover !== undefined ? this.handleEvent : undefined;
            if (cur.dragstart !== prev.dragstart)
                div.ondragstart = cur.dragstart !== undefined ? this.handleEvent : undefined;
            if (cur.dragend !== prev.dragend)
                div.ondragend = cur.dragend !== undefined ? this.handleEvent : undefined;
            if (cur.drag !== prev.drag)
                div.ondrag = cur.drag !== undefined ? this.handleEvent : undefined;
            if (cur.drop !== prev.drop)
                div.ondrop = cur.drop !== undefined ? this.handleEvent : undefined;
            if (cur.scroll !== prev.scroll)
                div.onscroll = cur.scroll !== undefined ? this.handleEvent : undefined;
            if (cur.focus !== prev.focus)
                div.onfocus = cur.focus !== undefined ? this.handleEvent : undefined;
            if (cur.blur !== prev.blur)
                div.onblur = cur.blur !== undefined ? this.handleEvent : undefined;
            if (cur.input !== prev.input)
                div.oninput = cur.input !== undefined ? this.handleEvent : undefined;
            if (cur.change !== prev.change)
                div.onchange = cur.change !== undefined ? this.handleEvent : undefined;
            if (cur.keyup !== prev.keyup)
                div.onkeyup = cur.keyup !== undefined ? this.handleEvent : undefined;
            if (cur.keydown !== prev.keydown)
                div.onkeydown = cur.keydown !== undefined ? this.handleEvent : undefined;
            if (type === "added" || type === "replaced" || type === "moved") {
                var parentEl = elementCache[cur.parent];
                if (parentEl) {
                    if (cur.ix >= parentEl.children.length) {
                        parentEl.appendChild(div);
                    }
                    else {
                        parentEl.insertBefore(div, parentEl.children[cur.ix]);
                    }
                }
            }
        }
    };
    Renderer.prototype.diff = function () {
        var a = this.prevTree;
        var b = this.tree;
        var as = Object.keys(a);
        var bs = Object.keys(b);
        var updated = {};
        var adds = [];
        for (var i = 0, len = as.length; i < len; i++) {
            var id = as[i];
            var curA = a[id];
            var curB = b[id];
            if (curB === undefined) {
                updated[id] = "removed";
                continue;
            }
            if (curA.t !== curB.t) {
                updated[id] = "replaced";
                continue;
            }
            if (curA.ix !== curB.ix || curA.parent !== curB.parent) {
                updated[id] = "moved";
                continue;
            }
            if (!curB.dirty
                && curA.c === curB.c
                && curA.key === curB.key
                && curA.dangerouslySetInnerHTML === curB.dangerouslySetInnerHTML
                && curA.tabindex === curB.tabindex
                && curA.href === curB.href
                && curA.placeholder === curB.placeholder
                && curA.selected === curB.selected
                && curA.draggable === curB.draggable
                && curA.contentEditable === curB.contentEditable
                && curA.value === curB.value
                && curA.type === curB.type
                && curA.checked === curB.checked
                && curA.text === curB.text
                && curA.top === curB.top
                && curA.flex === curB.flex
                && curA.left === curB.left
                && curA.width === curB.width
                && curA.height === curB.height
                && curA.zIndex === curB.zIndex
                && curA.backgroundColor === curB.backgroundColor
                && curA.backgroundImage === curB.backgroundImage
                && curA.color === curB.color
                && curA.colspan === curB.colspan
                && curA.border === curB.border
                && curA.borderColor === curB.borderColor
                && curA.borderWidth === curB.borderWidth
                && curA.borderRadius === curB.borderRadius
                && curA.opacity === curB.opacity
                && curA.fontFamily === curB.fontFamily
                && curA.fontSize === curB.fontSize
                && curA.textAlign === curB.textAlign
                && curA.transform === curB.transform
                && curA.verticalAlign === curB.verticalAlign
                && curA.semantic === curB.semantic
                && curA.debug === curB.debug
                && curA.style === curB.style
                && (curB.svg === undefined || (curA.x === curB.x
                    && curA.y === curB.y
                    && curA.dx === curB.dx
                    && curA.dy === curB.dy
                    && curA.cx === curB.cx
                    && curA.cy === curB.cy
                    && curA.r === curB.r
                    && curA.d === curB.d
                    && curA.fill === curB.fill
                    && curA.stroke === curB.stroke
                    && curA.strokeWidth === curB.strokeWidth
                    && curA.startOffset === curB.startOffset
                    && curA.textAnchor === curB.textAnchor
                    && curA.viewBox === curB.viewBox
                    && curA.xlinkhref === curB.xlinkhref))) {
                continue;
            }
            updated[id] = "updated";
        }
        for (var i = 0, len = bs.length; i < len; i++) {
            var id = bs[i];
            var curA = a[id];
            if (curA === undefined) {
                adds.push(id);
                updated[id] = "added";
                continue;
            }
        }
        this.lastDiff = { adds: adds, updates: updated };
        return this.lastDiff;
    };
    Renderer.prototype.prepare = function (root) {
        var elemLen = 1;
        var tree = this.tree;
        var elements = [root];
        var elem;
        for (var elemIx = 0; elemIx < elemLen; elemIx++) {
            elem = elements[elemIx];
            if (elem.parent === undefined)
                elem.parent = "__root";
            if (elem.id === undefined)
                elem.id = "__root__" + elemIx;
            tree[elem.id] = elem;
            if (elem.postRender !== undefined) {
                this.postRenders.push(elem);
            }
            var children = elem.children;
            if (children !== undefined) {
                for (var childIx = 0, len = children.length; childIx < len; childIx++) {
                    var child = children[childIx];
                    if (child === undefined)
                        continue;
                    if (child.id === undefined) {
                        child.id = elem.id + "__" + childIx;
                    }
                    if (child.ix === undefined) {
                        child.ix = childIx;
                    }
                    if (child.parent === undefined) {
                        child.parent = elem.id;
                    }
                    elements.push(child);
                    elemLen++;
                }
            }
        }
        return tree;
    };
    Renderer.prototype.postDomify = function () {
        var postRenders = this.postRenders;
        var diff = this.lastDiff.updates;
        var elementCache = this.elementCache;
        for (var i = 0, len = postRenders.length; i < len; i++) {
            var elem = postRenders[i];
            var id = elem.id;
            if (diff[id] === "updated" || diff[id] === "added" || diff[id] === "replaced" || elem.dirty) {
                elem.postRender(elementCache[elem.id], elem);
            }
        }
    };
    Renderer.prototype.render = function (elems) {
        this.reset();
        // We sort elements by depth to allow them to be self referential.
        elems.sort(function (a, b) { return (a.parent ? a.parent.split("__").length : 0) - (b.parent ? b.parent.split("__").length : 0); });
        var start = now();
        for (var _i = 0; _i < elems.length; _i++) {
            var elem = elems[_i];
            var post = this.prepare(elem);
        }
        var prepare = now();
        var d = this.diff();
        var diff = now();
        this.domify();
        var domify = now();
        this.postDomify();
        var postDomify = now();
        var time = now() - start;
        if (time > 5) {
            console.log("slow render (> 5ms): ", time, {
                prepare: prepare - start,
                diff: diff - prepare,
                domify: domify - diff,
                postDomify: postDomify - domify
            });
        }
    };
    return Renderer;
})();
exports.Renderer = Renderer;

},{}],3:[function(require,module,exports){
var microReact_1 = require("./microReact");
function replaceAll(str, find, replace) {
    var regex = new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
    return str.replace(regex, replace);
}
function wrapWithMarkdown(cm, wrapping) {
    cm.operation(function () {
        var from = cm.getCursor("from");
        // if there's something selected wrap it
        if (cm.somethingSelected()) {
            var selected = cm.getSelection();
            var cleaned = replaceAll(selected, wrapping, "");
            if (selected.substring(0, wrapping.length) === wrapping
                && selected.substring(selected.length - wrapping.length) === wrapping) {
                cm.replaceRange(cleaned, from, cm.getCursor("to"));
                cm.setSelection(from, cm.getCursor("from"));
            }
            else {
                cm.replaceRange("" + wrapping + cleaned + wrapping, from, cm.getCursor("to"));
                cm.setSelection(from, cm.getCursor("from"));
            }
        }
        else {
            cm.replaceRange("" + wrapping + wrapping, from);
            var newLocation = { line: from.line, ch: from.ch + wrapping.length };
            cm.setCursor(newLocation);
        }
    });
}
function prefixWithMarkdown(cm, prefix) {
    cm.operation(function () {
        var from = cm.getCursor("from");
        var to = cm.getCursor("to");
        var toPrefix = [];
        for (var lineIx = from.line; lineIx <= to.line; lineIx++) {
            var currentPrefix = cm.getRange({ line: lineIx, ch: 0 }, { line: lineIx, ch: prefix.length });
            if (currentPrefix !== prefix && currentPrefix !== "") {
                toPrefix.push(lineIx);
            }
        }
        // if everything in the selection has been prefixed, then we need to unprefix
        if (toPrefix.length === 0) {
            for (var lineIx = from.line; lineIx <= to.line; lineIx++) {
                cm.replaceRange("", { line: lineIx, ch: 0 }, { line: lineIx, ch: prefix.length });
            }
        }
        else {
            for (var _i = 0; _i < toPrefix.length; _i++) {
                var lineIx = toPrefix[_i];
                cm.replaceRange(prefix, { line: lineIx, ch: 0 });
            }
        }
    });
}
var RichTextEditor = (function () {
    function RichTextEditor(node, getEmbed, getInline, removeInline) {
        //format bar
        this.formatBarDelay = 100;
        this.showingFormatBar = false;
        this.formatBarElement = null;
        this.marks = [];
        this.meta = {};
        this.getEmbed = getEmbed;
        this.getInline = getInline;
        this.removeInline = removeInline;
        var cm = this.cmInstance = new CodeMirror(node, {
            lineWrapping: true,
            autoCloseBrackets: true,
            viewportMargin: Infinity,
            extraKeys: {
                "Cmd-B": function (cm) {
                    wrapWithMarkdown(cm, "**");
                },
                "Cmd-I": function (cm) {
                    wrapWithMarkdown(cm, "_");
                },
            }
        });
        var self = this;
        cm.on("changes", function (cm, changes) {
            self.onChanges(cm, changes);
            if (self.onUpdate) {
                self.onUpdate(self.meta, cm.getValue());
            }
        });
        cm.on("cursorActivity", function (cm) { self.onCursorActivity(cm); });
        cm.on("mousedown", function (cm, e) { self.onMouseDown(cm, e); });
        cm.getWrapperElement().addEventListener("mouseup", function (e) {
            self.onMouseUp(cm, e);
        });
    }
    RichTextEditor.prototype.showFormatBar = function () {
        this.showingFormatBar = true;
        var renderer = new microReact_1.Renderer();
        var cm = this.cmInstance;
        var head = cm.getCursor("head");
        var from = cm.getCursor("from");
        var to = cm.getCursor("to");
        var start = cm.cursorCoords(head, "local");
        var top = start.bottom + 5;
        console.log(head, from, to);
        if ((head.line === from.line && head.ch === from.ch)
            || (cm.cursorCoords(from, "local").top === cm.cursorCoords(to, "local").top)) {
            top = start.top - 40;
        }
        var barSize = 300 / 2;
        var item = { c: "formatBar", style: "position:absolute; left: " + (start.left - barSize) + "px; top:" + top + "px;", children: [
                { c: "button ", text: "H1", click: function () { prefixWithMarkdown(cm, "# "); } },
                { c: "button ", text: "H2", click: function () { prefixWithMarkdown(cm, "## "); } },
                { c: "sep" },
                { c: "button bold", text: "B", click: function () { wrapWithMarkdown(cm, "**"); } },
                { c: "button italic", text: "I", click: function () { wrapWithMarkdown(cm, "_"); } },
                { c: "sep" },
                { c: "button ", text: "-", click: function () { prefixWithMarkdown(cm, "- "); } },
                { c: "button ", text: "1.", click: function () { prefixWithMarkdown(cm, "1. "); } },
                { c: "button ", text: "[ ]", click: function () { prefixWithMarkdown(cm, "[ ] "); } },
                { c: "sep" },
                { c: "button ", text: "link" },
            ] };
        renderer.render([item]);
        var elem = renderer.content.firstChild;
        this.formatBarElement = elem;
        cm.getWrapperElement().appendChild(elem);
        // this.cmInstance.addWidget(pos, elem);
    };
    RichTextEditor.prototype.hideFormatBar = function () {
        this.showingFormatBar = false;
        this.formatBarElement.parentNode.removeChild(this.formatBarElement);
        this.formatBarElement = null;
    };
    RichTextEditor.prototype.onChanges = function (cm, changes) {
        var self = this;
        for (var _i = 0; _i < changes.length; _i++) {
            var change = changes[_i];
            var removed = change.removed.join("\n");
            var matches = removed.match(/({[^]*?})/gm);
            if (!matches)
                continue;
            for (var _a = 0; _a < matches.length; _a++) {
                var match = matches[_a];
                this.removeInline(this.meta, match);
            }
        }
        cm.operation(function () {
            var content = cm.getValue();
            var parts = content.split(/({[^]*?})/gm);
            var ix = 0;
            for (var _i = 0, _a = self.marks; _i < _a.length; _i++) {
                var mark = _a[_i];
                mark.clear();
            }
            self.marks = [];
            var cursorIx = cm.indexFromPos(cm.getCursor("from"));
            for (var _b = 0; _b < parts.length; _b++) {
                var part = parts[_b];
                if (part[0] === "{") {
                    var _c = self.markEmbeddedQuery(cm, part, ix), mark = _c.mark, replacement = _c.replacement;
                    if (mark)
                        self.marks.push(mark);
                    if (replacement)
                        part = replacement;
                }
                ix += part.length;
            }
        });
    };
    RichTextEditor.prototype.onCursorActivity = function (cm) {
        if (!cm.somethingSelected()) {
            var cursor = cm.getCursor("from");
            var marks = cm.findMarksAt(cursor);
            for (var _i = 0; _i < marks.length; _i++) {
                var mark = marks[_i];
                if (mark.needsReplacement) {
                    var _a = mark.find(), from = _a.from, to = _a.to;
                    var ix = cm.indexFromPos(from);
                    var text = cm.getRange(from, to);
                    mark.clear();
                    var newMark = this.markEmbeddedQuery(cm, text, ix).mark;
                    if (newMark)
                        this.marks.push(newMark);
                }
            }
        }
        if (this.showingFormatBar && !cm.somethingSelected()) {
            this.hideFormatBar();
        }
    };
    RichTextEditor.prototype.onMouseUp = function (cm, e) {
        if (!this.showingFormatBar) {
            var self = this;
            clearTimeout(this.timeout);
            this.timeout = setTimeout(function () {
                if (cm.somethingSelected()) {
                    self.showFormatBar();
                }
            }, this.formatBarDelay);
        }
    };
    RichTextEditor.prototype.onMouseDown = function (cm, e) {
        var cursor = cm.coordsChar({ left: e.clientX, top: e.clientY });
        var pos = cm.indexFromPos(cursor);
        var marks = cm.findMarksAt(cursor);
        for (var _i = 0, _a = this.marks; _i < _a.length; _i++) {
            var mark = _a[_i];
            if (mark.info && mark.info.to) {
            }
        }
    };
    RichTextEditor.prototype.markEmbeddedQuery = function (cm, query, ix) {
        var cursorIx = cm.indexFromPos(cm.getCursor("from"));
        var mark, replacement;
        var start = cm.posFromIndex(ix);
        var stop = cm.posFromIndex(ix + query.length);
        // as long as our cursor isn't in this span
        if (query !== "{}" && (cursorIx <= ix || cursorIx >= ix + query.length)) {
            // check if this is a query that's defining an inline attribute
            // e.g. {age: 30}
            var adjusted = this.getInline(this.meta, query);
            if (adjusted !== query) {
                replacement = adjusted;
                cm.replaceRange(adjusted, start, stop);
            }
            else {
                mark = cm.markText(start, stop, { replacedWith: this.getEmbed(this.meta, query.substring(1, query.length - 1)) });
            }
        }
        else {
            mark = cm.markText(start, stop, { className: "embed-code" });
            mark.needsReplacement = true;
        }
        return { mark: mark, replacement: replacement };
    };
    return RichTextEditor;
})();
exports.RichTextEditor = RichTextEditor;
function createEditor(getEmbed, getInline, removeInline) {
    return function wrapRichTextEditor(node, elem) {
        var editor = node.editor;
        var cm;
        if (!editor) {
            editor = node.editor = new RichTextEditor(node, getEmbed, getInline, removeInline);
            cm = node.editor.cmInstance;
            cm.focus();
        }
        else {
            cm = node.editor.cmInstance;
        }
        editor.onUpdate = elem.change;
        editor.meta = elem.meta || editor.meta;
        var doc = cm.getDoc();
        if (doc.getValue() !== elem.value) {
            doc.setValue(elem.value || "");
            doc.clearHistory();
            doc.setCursor({ line: 1, ch: 0 });
        }
        cm.refresh();
    };
}
exports.createEditor = createEditor;

},{"./microReact":2}],4:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime = exports;
exports.MAX_NUMBER = 9007199254740991;
exports.INCREMENTAL = false;
function objectsIdentical(a, b) {
    var aKeys = Object.keys(a);
    for (var _i = 0; _i < aKeys.length; _i++) {
        var key = aKeys[_i];
        //TODO: handle non-scalar values
        if (a[key] !== b[key])
            return false;
    }
    return true;
}
function indexOfFact(haystack, needle) {
    var ix = 0;
    for (var _i = 0; _i < haystack.length; _i++) {
        var fact = haystack[_i];
        if (fact.__id === needle.__id) {
            return ix;
        }
        ix++;
    }
    return -1;
}
function removeFact(haystack, needle) {
    var ix = indexOfFact(haystack, needle);
    if (ix > -1)
        haystack.splice(ix, 1);
    return haystack;
}
exports.removeFact = removeFact;
function diffAddsAndRemoves(adds, removes) {
    var localHash = {};
    var hashToFact = {};
    var hashes = [];
    for (var _i = 0; _i < adds.length; _i++) {
        var add = adds[_i];
        var hash = add.__id;
        if (localHash[hash] === undefined) {
            localHash[hash] = 1;
            hashToFact[hash] = add;
            hashes.push(hash);
        }
        else {
            localHash[hash]++;
        }
        add.__id = hash;
    }
    for (var _a = 0; _a < removes.length; _a++) {
        var remove = removes[_a];
        var hash = remove.__id;
        if (localHash[hash] === undefined) {
            localHash[hash] = -1;
            hashToFact[hash] = remove;
            hashes.push(hash);
        }
        else {
            localHash[hash]--;
        }
        remove.__id = hash;
    }
    var realAdds = [];
    var realRemoves = [];
    for (var _b = 0; _b < hashes.length; _b++) {
        var hash = hashes[_b];
        var count = localHash[hash];
        if (count > 0) {
            var fact = hashToFact[hash];
            realAdds.push(fact);
        }
        else if (count < 0) {
            var fact = hashToFact[hash];
            realRemoves.push(fact);
        }
    }
    return { adds: realAdds, removes: realRemoves };
}
function generateEqualityFn(keys) {
    return new Function("a", "b", "return " + keys.map(function (key, ix) {
        if (key.constructor === Array) {
            return "a['" + key[0] + "']['" + key[1] + "'] === b['" + key[0] + "']['" + key[1] + "']";
        }
        else {
            return "a[\"" + key + "\"] === b[\"" + key + "\"]";
        }
    }).join(" && ") + ";");
}
function generateStringFn(keys) {
    var keyStrings = [];
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            keyStrings.push("a['" + key[0] + "']['" + key[1] + "']");
        }
        else {
            keyStrings.push("a['" + key + "']");
        }
    }
    var final = keyStrings.join(' + "|" + ');
    return new Function("a", "return " + final + ";");
}
function generateUnprojectedSorterCode(unprojectedSize, sorts) {
    var conditions = [];
    var path = [];
    var distance = unprojectedSize;
    for (var _i = 0; _i < sorts.length; _i++) {
        var sort = sorts[_i];
        var condition = "";
        for (var _a = 0; _a < path.length; _a++) {
            var prev = path[_a];
            var table_1 = prev[0], key_1 = prev[1];
            condition += "unprojected[j-" + (distance - table_1) + "]['" + key_1 + "'] === item" + table_1 + "['" + key_1 + "'] && ";
        }
        var table = sort[0], key = sort[1], dir = sort[2];
        var op = ">";
        if (dir === "descending") {
            op = "<";
        }
        condition += "unprojected[j-" + (distance - table) + "]['" + key + "'] " + op + " item" + table + "['" + key + "']";
        conditions.push(condition);
        path.push(sort);
    }
    var items = [];
    var repositioned = [];
    var itemAssignments = [];
    for (var ix = 0; ix < distance; ix++) {
        items.push("item" + ix + " = unprojected[j+" + ix + "]");
        repositioned.push("unprojected[j+" + ix + "] = unprojected[j - " + (distance - ix) + "]");
        itemAssignments.push(("unprojected[j+" + ix + "] = item" + ix));
    }
    return "for (var i = 0, len = unprojected.length; i < len; i += " + distance + ") {\n      var j = i, " + items.join(", ") + ";\n      for(; j > " + (distance - 1) + " && (" + conditions.join(" || ") + "); j -= " + distance + ") {\n        " + repositioned.join(";\n") + "\n      }\n      " + itemAssignments.join(";\n") + "\n  }";
}
function generateCollector(keys) {
    var code = "var runtime = this;\n";
    var ix = 0;
    var checks = "";
    var removes = "var cur = index";
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            removes += "[remove['" + key[0] + "']['" + key[1] + "']]";
        }
        else {
            removes += "[remove['" + key + "']]";
        }
    }
    removes += ";\nruntime.removeFact(cur, remove);";
    for (var _a = 0; _a < keys.length; _a++) {
        var key = keys[_a];
        ix++;
        if (key.constructor === Array) {
            checks += "value = add['" + key[0] + "']['" + key[1] + "']\n";
        }
        else {
            checks += "value = add['" + key + "']\n";
        }
        var path = "cursor[value]";
        checks += "if(!" + path + ") " + path + " = ";
        if (ix === keys.length) {
            checks += "[]\n";
        }
        else {
            checks += "{}\n";
        }
        checks += "cursor = " + path + "\n";
    }
    code += "\nfor(var ix = 0, len = removes.length; ix < len; ix++) {\nvar remove = removes[ix];\n" + removes + "\n}\nfor(var ix = 0, len = adds.length; ix < len; ix++) {\nvar add = adds[ix];\nvar cursor = index;\nvar value;\n" + checks + "  cursor.push(add);\n}\nreturn index;";
    return (new Function("index", "adds", "removes", code)).bind(runtime);
}
function generateCollector2(keys) {
    var hashParts = [];
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            hashParts.push("add['" + key[0] + "']['" + key[1] + "']");
        }
        else {
            hashParts.push("add['" + key + "']");
        }
    }
    var code = "\n    var ixCache = cache.ix;\n    var idCache = cache.id;\n    for(var ix = 0, len = removes.length; ix < len; ix++) {\n      var remove = removes[ix];\n      var id = remove.__id;\n      var key = idCache[id];\n      var factIx = ixCache[id];\n      var facts = index[key];\n      //swap the last fact with this one to prevent holes\n      var lastFact = facts.pop();\n      if(lastFact && lastFact.__id !== remove.__id) {\n        facts[factIx] = lastFact;\n        ixCache[lastFact.__id] = factIx;\n      } else if(facts.length === 0) {\n        delete index[key];\n      }\n      delete idCache[id];\n      delete ixCache[id];\n    }\n    for(var ix = 0, len = adds.length; ix < len; ix++) {\n      var add = adds[ix];\n      var id = add.__id;\n      var key = idCache[id] = " + hashParts.join(" + '|' + ") + ";\n      if(index[key] === undefined) index[key] = [];\n      var arr = index[key];\n      ixCache[id] = arr.length;\n      arr.push(add);\n    }\n    return index;";
    return new Function("index", "adds", "removes", "cache", code);
}
function mergeArrays(as, bs) {
    var ix = as.length;
    var start = ix;
    for (var _i = 0; _i < bs.length; _i++) {
        var b = bs[_i];
        as[ix] = bs[ix - start];
        ix++;
    }
    return as;
}
var Diff = (function () {
    function Diff(ixer) {
        this.ixer = ixer;
        this.tables = {};
        this.length = 0;
        this.meta = {};
    }
    Diff.prototype.ensureTable = function (table) {
        var tableDiff = this.tables[table];
        if (!tableDiff) {
            tableDiff = this.tables[table] = { adds: [], removes: [] };
        }
        return tableDiff;
    };
    Diff.prototype.add = function (table, obj) {
        var tableDiff = this.ensureTable(table);
        this.length++;
        tableDiff.adds.push(obj);
        return this;
    };
    Diff.prototype.addMany = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.adds, objs);
        return this;
    };
    Diff.prototype.removeFacts = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.removes, objs);
        return this;
    };
    Diff.prototype.remove = function (table, query) {
        var tableDiff = this.ensureTable(table);
        var found = this.ixer.find(table, query);
        this.length += found.length;
        mergeArrays(tableDiff.removes, found);
        return this;
    };
    Diff.prototype.merge = function (diff) {
        for (var table in diff.tables) {
            var tableDiff = diff.tables[table];
            this.addMany(table, tableDiff.adds);
            this.removeFacts(table, tableDiff.removes);
        }
        return this;
    };
    Diff.prototype.reverse = function () {
        var reversed = new Diff(this.ixer);
        for (var table in this.tables) {
            var diff = this.tables[table];
            reversed.addMany(table, diff.removes);
            reversed.removeFacts(table, diff.adds);
        }
        return reversed;
    };
    return Diff;
})();
exports.Diff = Diff;
var Indexer = (function () {
    function Indexer() {
        this.tables = {};
        this.globalCount = 0;
        this.edbTables = {};
    }
    Indexer.prototype.addTable = function (name, keys) {
        if (keys === void 0) { keys = []; }
        var table = this.tables[name];
        keys = keys.filter(function (key) { return key !== "__id"; });
        if (table && keys.length) {
            table.fields = keys;
            table.stringify = generateStringFn(keys);
        }
        else {
            table = this.tables[name] = { table: [], hashToIx: {}, factHash: {}, indexes: {}, triggers: {}, fields: keys, stringify: generateStringFn(keys), keyLookup: {} };
            this.edbTables[name] = true;
        }
        for (var _i = 0; _i < keys.length; _i++) {
            var key = keys[_i];
            if (key.constructor === Array) {
                table.keyLookup[key[0]] = key;
            }
            else {
                table.keyLookup[key] = key;
            }
        }
        return table;
    };
    Indexer.prototype.clearTable = function (name) {
        var table = this.tables[name];
        if (!table)
            return;
        table.table = [];
        table.factHash = {};
        for (var indexName in table.indexes) {
            table.indexes[indexName].index = {};
            table.indexes[indexName].cache = { id: {}, ix: {} };
        }
    };
    Indexer.prototype.updateTable = function (tableId, adds, removes) {
        var table = this.tables[tableId];
        if (!table || !table.fields.length) {
            var example = adds[0] || removes[0];
            table = this.addTable(tableId, Object.keys(example));
        }
        var stringify = table.stringify;
        var facts = table.table;
        var factHash = table.factHash;
        var hashToIx = table.hashToIx;
        var localHash = {};
        var hashToFact = {};
        var hashes = [];
        for (var _i = 0; _i < adds.length; _i++) {
            var add = adds[_i];
            var hash = add.__id || stringify(add);
            if (localHash[hash] === undefined) {
                localHash[hash] = 1;
                hashToFact[hash] = add;
                hashes.push(hash);
            }
            else {
                localHash[hash]++;
            }
            add.__id = hash;
        }
        for (var _a = 0; _a < removes.length; _a++) {
            var remove = removes[_a];
            var hash = remove.__id || stringify(remove);
            if (localHash[hash] === undefined) {
                localHash[hash] = -1;
                hashToFact[hash] = remove;
                hashes.push(hash);
            }
            else {
                localHash[hash]--;
            }
            remove.__id = hash;
        }
        var realAdds = [];
        var realRemoves = [];
        for (var _b = 0; _b < hashes.length; _b++) {
            var hash = hashes[_b];
            var count = localHash[hash];
            if (count > 0 && !factHash[hash]) {
                var fact = hashToFact[hash];
                realAdds.push(fact);
                facts.push(fact);
                factHash[hash] = fact;
                hashToIx[hash] = facts.length - 1;
            }
            else if (count < 0 && factHash[hash]) {
                var fact = hashToFact[hash];
                var ix = hashToIx[hash];
                //swap the last fact with this one to prevent holes
                var lastFact = facts.pop();
                if (lastFact && lastFact.__id !== fact.__id) {
                    facts[ix] = lastFact;
                    hashToIx[lastFact.__id] = ix;
                }
                realRemoves.push(fact);
                delete factHash[hash];
                delete hashToIx[hash];
            }
        }
        return { adds: realAdds, removes: realRemoves };
    };
    Indexer.prototype.collector = function (keys) {
        return {
            index: {},
            cache: { id: {}, ix: {} },
            hasher: generateStringFn(keys),
            collect: generateCollector2(keys),
        };
    };
    Indexer.prototype.factToIndex = function (table, fact) {
        var keys = Object.keys(fact);
        if (!keys.length)
            return table.table.slice();
        var index = this.index(table, keys);
        var result = index.index[index.hasher(fact)];
        if (result) {
            return result.slice();
        }
        return [];
    };
    Indexer.prototype.execDiff = function (diff) {
        var triggers = {};
        var realDiffs = {};
        var tableIds = Object.keys(diff.tables);
        for (var _i = 0; _i < tableIds.length; _i++) {
            var tableId = tableIds[_i];
            var tableDiff = diff.tables[tableId];
            if (tableDiff.adds.length === 0 && tableDiff.removes.length === 0)
                continue;
            var realDiff = this.updateTable(tableId, tableDiff.adds, tableDiff.removes);
            // go through all the indexes and update them.
            var table = this.tables[tableId];
            var indexes = Object.keys(table.indexes);
            for (var _a = 0; _a < indexes.length; _a++) {
                var indexName = indexes[_a];
                var index = table.indexes[indexName];
                index.collect(index.index, realDiff.adds, realDiff.removes, index.cache);
            }
            var curTriggers = Object.keys(table.triggers);
            for (var _b = 0; _b < curTriggers.length; _b++) {
                var triggerName = curTriggers[_b];
                var trigger = table.triggers[triggerName];
                triggers[triggerName] = trigger;
            }
            realDiffs[tableId] = realDiff;
        }
        return { triggers: triggers, realDiffs: realDiffs };
    };
    Indexer.prototype.execTrigger = function (trigger) {
        var table = this.table(trigger.name);
        // since views might be changed during the triggering process, we want to favor
        // just using the view itself as the trigger if it is one. Otherwise, we use the
        // trigger's exec function. This ensures that if a view is recompiled and added
        // that any already queued triggers will use the updated version of the view instead
        // of the old queued one.
        var _a = (table.view ? table.view.exec() : trigger.exec(this)) || {}, _b = _a.results, results = _b === void 0 ? undefined : _b, _c = _a.unprojected, unprojected = _c === void 0 ? undefined : _c;
        if (!results)
            return;
        var prevResults = table.factHash;
        var prevHashes = Object.keys(prevResults);
        table.unprojected = unprojected;
        if (results) {
            var diff = new Diff(this);
            this.clearTable(trigger.name);
            diff.addMany(trigger.name, results);
            var triggers = this.execDiff(diff).triggers;
            var newHashes = table.factHash;
            if (prevHashes.length === Object.keys(newHashes).length) {
                var same = true;
                for (var _i = 0; _i < prevHashes.length; _i++) {
                    var hash = prevHashes[_i];
                    if (!newHashes[hash]) {
                        same = false;
                        break;
                    }
                }
                return same ? undefined : triggers;
            }
            else {
                return triggers;
            }
        }
        return;
    };
    Indexer.prototype.transitivelyClearTriggers = function (startingTriggers) {
        var cleared = {};
        var remaining = Object.keys(startingTriggers);
        for (var ix = 0; ix < remaining.length; ix++) {
            var trigger = remaining[ix];
            if (cleared[trigger])
                continue;
            this.clearTable(trigger);
            cleared[trigger] = true;
            remaining.push.apply(remaining, Object.keys(this.table(trigger).triggers));
        }
        return cleared;
    };
    Indexer.prototype.execTriggers = function (triggers) {
        var newTriggers = {};
        var retrigger = false;
        for (var triggerName in triggers) {
            // console.log("Calling:", triggerName);
            var trigger = triggers[triggerName];
            var nextRound = this.execTrigger(trigger);
            if (nextRound) {
                retrigger = true;
                for (var trigger_1 in nextRound) {
                    // console.log("Queuing:", trigger);
                    newTriggers[trigger_1] = nextRound[trigger_1];
                }
            }
        }
        if (retrigger) {
            return newTriggers;
        }
    };
    //---------------------------------------------------------
    // Indexer Public API
    //---------------------------------------------------------
    Indexer.prototype.serialize = function (asObject) {
        var dump = {};
        for (var tableName in this.tables) {
            var table = this.tables[tableName];
            if (!table.isView) {
                dump[tableName] = table.table;
            }
        }
        if (asObject) {
            return dump;
        }
        return JSON.stringify(dump);
    };
    Indexer.prototype.load = function (serialized) {
        var dump = JSON.parse(serialized);
        var diff = this.diff();
        for (var tableName in dump) {
            diff.addMany(tableName, dump[tableName]);
        }
        if (exports.INCREMENTAL) {
            this.applyDiffIncremental(diff);
        }
        else {
            this.applyDiff(diff);
        }
    };
    Indexer.prototype.diff = function () {
        return new Diff(this);
    };
    Indexer.prototype.applyDiff = function (diff) {
        if (exports.INCREMENTAL) {
            return this.applyDiffIncremental(diff);
        }
        var _a = this.execDiff(diff), triggers = _a.triggers, realDiffs = _a.realDiffs;
        var cleared;
        var round = 0;
        if (triggers)
            cleared = this.transitivelyClearTriggers(triggers);
        while (triggers) {
            for (var trigger in triggers) {
                cleared[trigger] = false;
            }
            // console.group(`ROUND ${round}`);
            triggers = this.execTriggers(triggers);
            round++;
        }
        for (var _i = 0, _b = Object.keys(cleared); _i < _b.length; _i++) {
            var trigger = _b[_i];
            if (!cleared[trigger])
                continue;
            var view = this.table(trigger).view;
            if (view) {
                this.execTrigger(view);
            }
        }
    };
    Indexer.prototype.table = function (tableId) {
        var table = this.tables[tableId];
        if (table)
            return table;
        return this.addTable(tableId);
    };
    Indexer.prototype.index = function (tableOrId, keys) {
        var table;
        if (typeof tableOrId === "string")
            table = this.table(tableOrId);
        else
            table = tableOrId;
        keys.sort();
        var indexName = keys.filter(function (key) { return key !== "__id"; }).join("|");
        var index = table.indexes[indexName];
        if (!index) {
            var tableKeys = [];
            for (var _i = 0; _i < keys.length; _i++) {
                var key = keys[_i];
                tableKeys.push(table.keyLookup[key] || key);
            }
            index = table.indexes[indexName] = this.collector(tableKeys);
            index.collect(index.index, table.table, [], index.cache);
        }
        return index;
    };
    Indexer.prototype.find = function (tableId, query) {
        var table = this.tables[tableId];
        if (!table) {
            return [];
        }
        else if (!query) {
            return table.table.slice();
        }
        else {
            return this.factToIndex(table, query);
        }
    };
    Indexer.prototype.findOne = function (tableId, query) {
        return this.find(tableId, query)[0];
    };
    Indexer.prototype.query = function (name) {
        if (name === void 0) { name = "unknown"; }
        return new Query(this, name);
    };
    Indexer.prototype.union = function (name) {
        return new Union(this, name);
    };
    Indexer.prototype.trigger = function (name, table, exec, execIncremental) {
        var tables = (typeof table === "string") ? [table] : table;
        var trigger = { name: name, tables: tables, exec: exec, execIncremental: execIncremental };
        for (var _i = 0; _i < tables.length; _i++) {
            var tableId = tables[_i];
            var table_2 = this.table(tableId);
            table_2.triggers[name] = trigger;
        }
        if (!exports.INCREMENTAL) {
            var nextRound = this.execTrigger(trigger);
            while (nextRound) {
                nextRound = this.execTriggers(nextRound);
            }
            ;
        }
        else {
            if (!tables.length) {
                return exec(this);
            }
            var initial = (_a = {}, _a[tables[0]] = { adds: this.tables[tables[0]].table, removes: [] }, _a);
            var _b = this.execTriggerIncremental(trigger, initial), triggers = _b.triggers, changes = _b.changes;
            while (triggers) {
                var results = this.execTriggersIncremental(triggers, changes);
                if (!results)
                    break;
                triggers = results.triggers;
                changes = results.changes;
            }
        }
        var _a;
    };
    Indexer.prototype.asView = function (query) {
        var name = query.name;
        if (this.tables[name]) {
            this.removeView(name);
        }
        var view = this.table(name);
        this.edbTables[name] = false;
        view.view = query;
        view.isView = true;
        this.trigger(name, query.tables, query.exec.bind(query), query.execIncremental.bind(query));
    };
    Indexer.prototype.removeView = function (id) {
        for (var _i = 0, _a = this.tables; _i < _a.length; _i++) {
            var table = _a[_i];
            delete table.triggers[id];
        }
    };
    Indexer.prototype.totalFacts = function () {
        var total = 0;
        for (var tableName in this.tables) {
            total += this.tables[tableName].table.length;
        }
        return total;
    };
    Indexer.prototype.factsPerTable = function () {
        var info = {};
        for (var tableName in this.tables) {
            info[tableName] = this.tables[tableName].table.length;
        }
        return info;
    };
    Indexer.prototype.applyDiffIncremental = function (diff) {
        if (diff.length === 0)
            return;
        // console.log("DIFF SIZE: ", diff.length, diff);
        var _a = this.execDiff(diff), triggers = _a.triggers, realDiffs = _a.realDiffs;
        var round = 0;
        var changes = realDiffs;
        while (triggers) {
            // console.group(`ROUND ${round}`);
            // console.log("CHANGES: ", changes);
            var results = this.execTriggersIncremental(triggers, changes);
            // console.groupEnd();
            if (!results)
                break;
            triggers = results.triggers;
            changes = results.changes;
            round++;
        }
    };
    Indexer.prototype.execTriggerIncremental = function (trigger, changes) {
        var table = this.table(trigger.name);
        var adds, provenance, removes, info;
        if (trigger.execIncremental) {
            info = trigger.execIncremental(changes, table) || {};
            adds = info.adds;
            removes = info.removes;
        }
        else {
            trigger.exec();
            return;
        }
        var diff = new runtime.Diff(this);
        if (adds.length) {
            diff.addMany(trigger.name, adds);
        }
        if (removes.length) {
            diff.removeFacts(trigger.name, removes);
        }
        var updated = this.execDiff(diff);
        var realDiffs = updated.realDiffs;
        if (realDiffs[trigger.name] && (realDiffs[trigger.name].adds.length || realDiffs[trigger.name].removes)) {
            return { changes: realDiffs[trigger.name], triggers: updated.triggers };
        }
        else {
            return {};
        }
    };
    Indexer.prototype.execTriggersIncremental = function (triggers, changes) {
        var newTriggers = {};
        var nextChanges = {};
        var retrigger = false;
        var triggerKeys = Object.keys(triggers);
        for (var _i = 0; _i < triggerKeys.length; _i++) {
            var triggerName = triggerKeys[_i];
            // console.log("Calling:", triggerName);
            var trigger = triggers[triggerName];
            var nextRound = this.execTriggerIncremental(trigger, changes);
            if (nextRound && nextRound.changes) {
                nextChanges[triggerName] = nextRound.changes;
                if (nextRound.triggers) {
                    var nextRoundKeys = Object.keys(nextRound.triggers);
                    for (var _a = 0; _a < nextRoundKeys.length; _a++) {
                        var trigger_2 = nextRoundKeys[_a];
                        if (trigger_2 && nextRound.triggers[trigger_2]) {
                            retrigger = true;
                            // console.log("Queuing:", trigger);
                            newTriggers[trigger_2] = nextRound.triggers[trigger_2];
                        }
                    }
                }
            }
        }
        if (retrigger) {
            return { changes: nextChanges, triggers: newTriggers };
        }
    };
    return Indexer;
})();
exports.Indexer = Indexer;
function addProvenanceTable(ixer) {
    var table = ixer.addTable("provenance", ["table", ["row", "__id"], "row instance", "source", ["source row", "__id"]]);
    // generate some indexes that we know we're going to need upfront
    ixer.index("provenance", ["table", "row"]);
    ixer.index("provenance", ["table", "row instance"]);
    ixer.index("provenance", ["table", "source", "source row"]);
    ixer.index("provenance", ["table"]);
    return ixer;
}
exports.addProvenanceTable = addProvenanceTable;
function mappingToDiff(diff, action, mapping, aliases, reverseLookup) {
    for (var from in mapping) {
        var to = mapping[from];
        if (to.constructor === Array) {
            var source = to[0];
            if (typeof source === "number") {
                source = aliases[reverseLookup[source]];
            }
            else {
                source = aliases[source];
            }
            diff.add("action mapping", { action: action, from: from, "to source": source, "to field": to[1] });
        }
        else {
            diff.add("action mapping constant", { action: action, from: from, value: to });
        }
    }
    return diff;
}
exports.QueryFunctions = {};
var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
var ARGUMENT_NAMES = /([^\s,]+)/g;
function getParamNames(func) {
    var fnStr = func.toString().replace(STRIP_COMMENTS, '');
    var result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
    if (result === null)
        result = [];
    return result;
}
function define(name, opts, func) {
    var params = getParamNames(func);
    opts.name = name;
    opts.params = params;
    opts.func = func;
    exports.QueryFunctions[name] = opts;
}
exports.define = define;
var Query = (function () {
    function Query(ixer, name) {
        if (name === void 0) { name = "unknown"; }
        this.name = name;
        this.ixer = ixer;
        this.dirty = true;
        this.tables = [];
        this.joins = [];
        this.aliases = {};
        this.funcs = [];
        this.aggregates = [];
        this.unprojectedSize = 0;
        this.hasOrdinal = false;
    }
    Query.remove = function (view, ixer) {
        var diff = ixer.diff();
        diff.remove("view", { view: view });
        for (var _i = 0, _a = ixer.find("action", { view: view }); _i < _a.length; _i++) {
            var actionItem = _a[_i];
            var action = actionItem.action;
            diff.remove("action", { action: action });
            diff.remove("action source", { action: action });
            diff.remove("action mapping", { action: action });
            diff.remove("action mapping constant", { action: action });
            diff.remove("action mapping sorted", { action: action });
            diff.remove("action mapping limit", { action: action });
        }
        return diff;
    };
    Query.prototype.changeset = function (ixer) {
        var diff = ixer.diff();
        var aliases = {};
        var reverseLookup = {};
        for (var alias in this.aliases) {
            reverseLookup[this.aliases[alias]] = alias;
        }
        var view = this.name;
        diff.add("view", { view: view, kind: "query" });
        //joins
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var action = utils_1.uuid();
            aliases[join.as] = action;
            if (!join.negated) {
                diff.add("action", { view: view, action: action, kind: "select", ix: join.ix });
            }
            else {
                diff.add("action", { view: view, action: action, kind: "deselect", ix: join.ix });
            }
            diff.add("action source", { action: action, "source view": join.table });
            mappingToDiff(diff, action, join.join, aliases, reverseLookup);
        }
        //functions
        for (var _b = 0, _c = this.funcs; _b < _c.length; _b++) {
            var func = _c[_b];
            var action = utils_1.uuid();
            aliases[func.as] = action;
            diff.add("action", { view: view, action: action, kind: "calculate", ix: func.ix });
            diff.add("action source", { action: action, "source view": func.name });
            mappingToDiff(diff, action, func.args, aliases, reverseLookup);
        }
        //aggregates
        for (var _d = 0, _e = this.aggregates; _d < _e.length; _d++) {
            var agg = _e[_d];
            var action = utils_1.uuid();
            aliases[agg.as] = action;
            diff.add("action", { view: view, action: action, kind: "aggregate", ix: agg.ix });
            diff.add("action source", { action: action, "source view": agg.name });
            mappingToDiff(diff, action, agg.args, aliases, reverseLookup);
        }
        //sort
        if (this.sorts) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "sort", ix: exports.MAX_NUMBER });
            var ix = 0;
            for (var _f = 0, _g = this.sorts; _f < _g.length; _f++) {
                var sort = _g[_f];
                var source = sort[0], field = sort[1], direction = sort[2];
                if (typeof source === "number") {
                    source = aliases[reverseLookup[source]];
                }
                else {
                    source = aliases[source];
                }
                diff.add("action mapping sorted", { action: action, ix: ix, source: source, field: field, direction: direction });
                ix++;
            }
        }
        //group
        if (this.groups) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "group", ix: exports.MAX_NUMBER });
            var ix = 0;
            for (var _h = 0, _j = this.groups; _h < _j.length; _h++) {
                var group = _j[_h];
                var source = group[0], field = group[1];
                if (typeof source === "number") {
                    source = aliases[reverseLookup[source]];
                }
                else {
                    source = aliases[source];
                }
                diff.add("action mapping sorted", { action: action, ix: ix, source: source, field: field, direction: "ascending" });
                ix++;
            }
        }
        //limit
        if (this.limitInfo) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "limit", ix: exports.MAX_NUMBER });
            for (var limitType in this.limitInfo) {
                diff.add("action mapping limit", { action: action, "limit type": limitType, value: this.limitInfo[limitType] });
            }
        }
        //projection
        if (this.projectionMap) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "project", ix: exports.MAX_NUMBER });
            mappingToDiff(diff, action, this.projectionMap, aliases, reverseLookup);
        }
        return diff;
    };
    Query.prototype.validateFields = function (tableName, joinObject) {
        var table = this.ixer.table(tableName);
        for (var field in joinObject) {
            if (table.fields.length && !table.keyLookup[field]) {
                throw new Error("Table '" + tableName + "' doesn't have a field '" + field + "'.\n\nAvailable fields: " + table.fields.join(", "));
            }
            var joinInfo = joinObject[field];
            if (joinInfo.constructor === Array) {
                var joinNumber = joinInfo[0], referencedField = joinInfo[1];
                if (typeof joinNumber !== "number") {
                    joinNumber = this.aliases[joinNumber];
                }
                var join = this.joins[joinNumber];
                if (join && join.ix === joinNumber) {
                    var referencedTable = this.ixer.table(join.table);
                    if (!referencedTable.fields.length)
                        continue;
                    if (!referencedTable.keyLookup[referencedField]) {
                        throw new Error("Table '" + join.table + "' doesn't have a field '" + referencedField + "'.\n\nAvailable fields: " + referencedTable.fields.join(", "));
                    }
                }
            }
        }
    };
    Query.prototype.select = function (table, join, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        this.unprojectedSize++;
        this.tables.push(table);
        this.validateFields(table, join);
        this.joins.push({ negated: false, table: table, join: join, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.deselect = function (table, join) {
        this.dirty = true;
        this.tables.push(table);
        this.validateFields(table, join);
        this.joins.push({ negated: true, table: table, join: join, ix: this.joins.length * 1000 });
        return this;
    };
    Query.prototype.calculate = function (funcName, args, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        if (!exports.QueryFunctions[funcName].filter) {
            this.unprojectedSize++;
        }
        this.funcs.push({ name: funcName, args: args, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.project = function (projectionMap) {
        this.projectionMap = projectionMap;
        this.validateFields(undefined, projectionMap);
        return this;
    };
    Query.prototype.group = function (groups) {
        this.dirty = true;
        if (groups[0] && groups[0].constructor === Array) {
            this.groups = groups;
        }
        else {
            if (!this.groups)
                this.groups = [];
            this.groups.push(groups);
        }
        return this;
    };
    Query.prototype.sort = function (sorts) {
        this.dirty = true;
        if (sorts[0] && sorts[0].constructor === Array) {
            this.sorts = sorts;
        }
        else {
            if (!this.sorts)
                this.sorts = [];
            this.sorts.push(sorts);
        }
        return this;
    };
    Query.prototype.limit = function (limitInfo) {
        this.dirty = true;
        if (!this.limitInfo) {
            this.limitInfo = {};
        }
        for (var key in limitInfo) {
            this.limitInfo[key] = limitInfo[key];
        }
        return this;
    };
    Query.prototype.aggregate = function (funcName, args, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        this.unprojectedSize++;
        this.aggregates.push({ name: funcName, args: args, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.ordinal = function () {
        this.dirty = true;
        this.hasOrdinal = true;
        this.unprojectedSize++;
        return this;
    };
    Query.prototype.applyAliases = function (joinMap) {
        for (var field in joinMap) {
            var joinInfo = joinMap[field];
            if (joinInfo.constructor !== Array || typeof joinInfo[0] === "number")
                continue;
            var joinTable = joinInfo[0];
            if (joinTable === "ordinal") {
                joinInfo[0] = this.unprojectedSize - 1;
            }
            else if (this.aliases[joinTable] !== undefined) {
                joinInfo[0] = this.aliases[joinTable];
            }
            else {
                throw new Error("Invalid alias used: " + joinTable);
            }
        }
    };
    Query.prototype.toAST = function () {
        var cursor = { type: "query",
            children: [] };
        var root = cursor;
        var results = [];
        // by default the only thing we return are the unprojected results
        var returns = ["unprojected", "provenance"];
        // we need an array to store our unprojected results
        root.children.push({ type: "declaration", var: "unprojected", value: "[]" });
        root.children.push({ type: "declaration", var: "provenance", value: "[]" });
        root.children.push({ type: "declaration", var: "projected", value: "{}" });
        // run through each table nested in the order they were given doing pairwise
        // joins along the way.
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var table = join.table, ix = join.ix, negated = join.negated;
            var cur = {
                type: "select",
                table: table,
                passed: ix === 0,
                ix: ix,
                negated: negated,
                children: [],
                join: false,
            };
            // we only want to eat the cost of dealing with indexes
            // if we are actually joining on something
            var joinMap = join.join;
            this.applyAliases(joinMap);
            if (joinMap && Object.keys(joinMap).length !== 0) {
                root.children.unshift({ type: "declaration", var: "query" + ix, value: "{}" });
                cur.join = joinMap;
            }
            cursor.children.push(cur);
            if (!negated) {
                results.push({ type: "select", ix: ix });
            }
            cursor = cur;
        }
        // at the bottom of the joins, we calculate all the functions based on the values
        // collected
        for (var _b = 0, _c = this.funcs; _b < _c.length; _b++) {
            var func = _c[_b];
            var args = func.args, name_1 = func.name, ix = func.ix;
            var funcInfo = exports.QueryFunctions[name_1];
            this.applyAliases(args);
            root.children.unshift({ type: "functionDeclaration", ix: ix, info: funcInfo });
            if (funcInfo.multi || funcInfo.filter) {
                var node = { type: "functionCallMultiReturn", ix: ix, args: args, info: funcInfo, children: [] };
                cursor.children.push(node);
                cursor = node;
            }
            else {
                cursor.children.push({ type: "functionCall", ix: ix, args: args, info: funcInfo, children: [] });
            }
            if (!funcInfo.noReturn && !funcInfo.filter) {
                results.push({ type: "function", ix: ix });
            }
        }
        // now that we're at the bottom of the join, store the unprojected result
        cursor.children.push({ type: "result", results: results });
        //Aggregation
        //sort the unprojected results based on groupings and the given sorts
        var sorts = [];
        var alreadySorted = {};
        if (this.groups) {
            this.applyAliases(this.groups);
            for (var _d = 0, _e = this.groups; _d < _e.length; _d++) {
                var group = _e[_d];
                var table = group[0], field = group[1];
                sorts.push(group);
                alreadySorted[(table + "|" + field)] = true;
            }
        }
        if (this.sorts) {
            this.applyAliases(this.sorts);
            for (var _f = 0, _g = this.sorts; _f < _g.length; _f++) {
                var sort = _g[_f];
                var table = sort[0], field = sort[1];
                if (!alreadySorted[(table + "|" + field)]) {
                    sorts.push(sort);
                }
            }
        }
        var size = this.unprojectedSize;
        if (sorts.length) {
            root.children.push({ type: "sort", sorts: sorts, size: size, children: [] });
        }
        //then we need to run through the sorted items and do the aggregate as a fold.
        if (this.aggregates.length || sorts.length || this.limitInfo || this.hasOrdinal) {
            // we need to store group info for post processing of the unprojected results
            // this will indicate what group number, if any, that each unprojected result belongs to
            root.children.unshift({ type: "declaration", var: "groupInfo", value: "[]" });
            returns.push("groupInfo");
            var aggregateChildren = [];
            for (var _h = 0, _j = this.aggregates; _h < _j.length; _h++) {
                var func = _j[_h];
                var args = func.args, name_2 = func.name, ix = func.ix;
                var funcInfo = exports.QueryFunctions[name_2];
                this.applyAliases(args);
                root.children.unshift({ type: "functionDeclaration", ix: ix, info: funcInfo });
                aggregateChildren.push({ type: "functionCall", ix: ix, resultsIx: results.length, args: args, info: funcInfo, unprojected: true, children: [] });
                results.push({ type: "placeholder" });
            }
            if (this.hasOrdinal === true) {
                aggregateChildren.push({ type: "ordinal" });
                results.push({ type: "placeholder" });
            }
            var aggregate = { type: "aggregate loop", groups: this.groups, limit: this.limitInfo, size: size, children: aggregateChildren };
            root.children.push(aggregate);
            cursor = aggregate;
        }
        if (this.projectionMap) {
            this.applyAliases(this.projectionMap);
            root.children.unshift({ type: "declaration", var: "results", value: "[]" });
            if (exports.INCREMENTAL) {
                cursor.children.push({ type: "provenance" });
            }
            cursor.children.push({ type: "projection", projectionMap: this.projectionMap, unprojected: this.aggregates.length });
            returns.push("results");
        }
        root.children.push({ type: "return", vars: returns });
        return root;
    };
    Query.prototype.compileParamString = function (funcInfo, args, unprojected) {
        if (unprojected === void 0) { unprojected = false; }
        var code = "";
        var params = funcInfo.params;
        if (unprojected)
            params = params.slice(1);
        for (var _i = 0; _i < params.length; _i++) {
            var param = params[_i];
            var arg = args[param];
            var argCode = void 0;
            if (arg.constructor === Array) {
                var property = "";
                if (arg[1]) {
                    property = "['" + arg[1] + "']";
                }
                if (!unprojected) {
                    argCode = "row" + arg[0] + property;
                }
                else {
                    argCode = "unprojected[ix + " + arg[0] + "]" + property;
                }
            }
            else {
                argCode = JSON.stringify(arg);
            }
            code += argCode + ", ";
        }
        return code.substring(0, code.length - 2);
    };
    Query.prototype.compileAST = function (root) {
        var code = "";
        var type = root.type;
        switch (type) {
            case "query":
                for (var _i = 0, _a = root.children; _i < _a.length; _i++) {
                    var child = _a[_i];
                    code += this.compileAST(child);
                }
                break;
            case "declaration":
                code += "var " + root.var + " = " + root.value + ";\n";
                break;
            case "functionDeclaration":
                code += "var func" + root.ix + " = QueryFunctions['" + root.info.name + "'].func;\n";
                break;
            case "functionCall":
                var ix = root.ix;
                var prev = "";
                if (root.unprojected) {
                    prev = "row" + ix;
                    if (root.info.params.length > 1)
                        prev += ",";
                }
                code += "var row" + ix + " = func" + ix + "(" + prev + this.compileParamString(root.info, root.args, root.unprojected) + ");\n";
                break;
            case "functionCallMultiReturn":
                var ix = root.ix;
                code += "var rows" + ix + " = func" + ix + "(" + this.compileParamString(root.info, root.args) + ");\n";
                code += "for(var funcResultIx" + ix + " = 0, funcLen" + ix + " = rows" + ix + ".length; funcResultIx" + ix + " < funcLen" + ix + "; funcResultIx" + ix + "++) {\n";
                code += "var row" + ix + " = rows" + ix + "[funcResultIx" + ix + "];\n";
                for (var _b = 0, _c = root.children; _b < _c.length; _b++) {
                    var child = _c[_b];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "select":
                var ix = root.ix;
                if (root.passed) {
                    code += "var rows" + ix + " = rootRows;\n";
                }
                else if (root.join) {
                    for (var key in root.join) {
                        var mapping = root.join[key];
                        if (mapping.constructor === Array) {
                            var tableIx = mapping[0], value = mapping[1];
                            code += "query" + ix + "['" + key + "'] = row" + tableIx + "['" + value + "'];\n";
                        }
                        else {
                            code += "query" + ix + "['" + key + "'] = " + JSON.stringify(mapping) + ";\n";
                        }
                    }
                    code += "var rows" + ix + " = ixer.factToIndex(ixer.table('" + root.table + "'), query" + ix + ");\n";
                }
                else {
                    code += "var rows" + ix + " = ixer.table('" + root.table + "').table;\n";
                }
                if (!root.negated) {
                    code += "for(var rowIx" + ix + " = 0, rowsLen" + ix + " = rows" + ix + ".length; rowIx" + ix + " < rowsLen" + ix + "; rowIx" + ix + "++) {\n";
                    code += "var row" + ix + " = rows" + ix + "[rowIx" + ix + "];\n";
                }
                else {
                    code += "if(!rows" + ix + ".length) {\n";
                }
                for (var _d = 0, _e = root.children; _d < _e.length; _d++) {
                    var child = _e[_d];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "result":
                var results = [];
                for (var _f = 0, _g = root.results; _f < _g.length; _f++) {
                    var result = _g[_f];
                    if (result.type === "placeholder") {
                        results.push("undefined");
                    }
                    else {
                        var ix_1 = result.ix;
                        results.push("row" + ix_1);
                    }
                }
                code += "unprojected.push(" + results.join(", ") + ");\n";
                break;
            case "sort":
                code += generateUnprojectedSorterCode(root.size, root.sorts) + "\n";
                break;
            case "aggregate loop":
                var projection = "";
                var aggregateCalls = [];
                var aggregateStates = [];
                var aggregateResets = [];
                var unprojected = {};
                var ordinal = false;
                var provenanceCode;
                for (var _h = 0, _j = root.children; _h < _j.length; _h++) {
                    var agg = _j[_h];
                    if (agg.type === "functionCall") {
                        unprojected[agg.ix] = true;
                        var compiled = this.compileAST(agg);
                        compiled += "\nunprojected[ix + " + agg.resultsIx + "] = row" + agg.ix + ";\n";
                        aggregateCalls.push(compiled);
                        aggregateStates.push("var row" + agg.ix + " = {};");
                        aggregateResets.push("row" + agg.ix + " = {};");
                    }
                    else if (agg.type === "projection") {
                        agg.unprojected = unprojected;
                        projection = this.compileAST(agg);
                    }
                    else if (agg.type === "ordinal") {
                        ordinal = "unprojected[ix+" + (this.unprojectedSize - 1) + "] = resultCount;\n";
                    }
                    else if (agg.type === "provenance") {
                        provenanceCode = this.compileAST(agg);
                    }
                }
                var aggregateCallsCode = aggregateCalls.join("");
                var differentGroupChecks = [];
                var groupCheck = "false";
                if (root.groups) {
                    for (var _k = 0, _l = root.groups; _k < _l.length; _k++) {
                        var group = _l[_k];
                        var table = group[0], field = group[1];
                        differentGroupChecks.push("unprojected[nextIx + " + table + "]['" + field + "'] !== unprojected[ix + " + table + "]['" + field + "']");
                    }
                    groupCheck = "(" + differentGroupChecks.join(" || ") + ")";
                }
                var resultsCheck = "";
                if (root.limit && root.limit.results) {
                    var limitValue = root.limit.results;
                    var offset = root.limit.offset;
                    if (offset) {
                        limitValue += offset;
                        projection = "if(resultCount >= " + offset + ") {\n              " + projection + "\n            }";
                    }
                    resultsCheck = "if(resultCount === " + limitValue + ") break;";
                }
                var groupLimitCheck = "";
                if (root.limit && root.limit.perGroup && root.groups) {
                    var limitValue = root.limit.perGroup;
                    var offset = root.limit.offset;
                    if (offset) {
                        limitValue += offset;
                        aggregateCallsCode = "if(perGroupCount >= " + offset + ") {\n              " + aggregateCallsCode + "\n            }";
                    }
                    groupLimitCheck = "if(perGroupCount === " + limitValue + ") {\n            while(!differentGroup) {\n              nextIx += " + root.size + ";\n              if(nextIx >= len) break;\n              groupInfo[nextIx] = undefined;\n              differentGroup = " + groupCheck + ";\n            }\n          }";
                }
                var groupDifference = "";
                var groupInfo = "";
                if (this.groups) {
                    groupInfo = "groupInfo[ix] = resultCount;";
                    var groupProjection = projection + "resultCount++;";
                    if (root.limit && root.limit.offset) {
                        groupProjection = "if(perGroupCount > " + root.limit.offset + ") {\n              " + groupProjection + "\n            }";
                        groupInfo = "if(perGroupCount >= " + root.limit.offset + ") {\n              " + groupInfo + "\n            }";
                    }
                    groupDifference = "\n          perGroupCount++\n          var differentGroup = " + groupCheck + ";\n          " + groupLimitCheck + "\n          if(differentGroup) {\n            " + groupProjection + "\n            " + aggregateResets.join("\n") + "\n            perGroupCount = 0;\n          }\n";
                }
                else {
                    groupDifference = "resultCount++;\n";
                    groupInfo = "groupInfo[ix] = 0;";
                }
                // if there are neither aggregates to calculate nor groups to build,
                // then we just need to worry about limiting
                if (!this.groups && aggregateCalls.length === 0) {
                    code = "var ix = 0;\n                  var resultCount = 0;\n                  var len = unprojected.length;\n                  while(ix < len) {\n                    " + resultsCheck + "\n                    " + (ordinal || "") + "\n                    " + provenanceCode + "\n                    " + projection + "\n                    groupInfo[ix] = resultCount;\n                    resultCount++;\n                    ix += " + root.size + ";\n                  }\n";
                    break;
                }
                code = "var resultCount = 0;\n                var perGroupCount = 0;\n                var ix = 0;\n                var nextIx = 0;\n                var len = unprojected.length;\n                " + aggregateStates.join("\n") + "\n                while(ix < len) {\n                  " + aggregateCallsCode + "\n                  " + groupInfo + "\n                  " + (ordinal || "") + "\n                  " + provenanceCode + "\n                  if(ix + " + root.size + " === len) {\n                    " + projection + "\n                    break;\n                  }\n                  nextIx += " + root.size + ";\n                  " + groupDifference + "\n                  " + resultsCheck + "\n                  ix = nextIx;\n                }\n";
                break;
            case "projection":
                var projectedVars = [];
                var idStringParts = [];
                for (var newField in root.projectionMap) {
                    var mapping = root.projectionMap[newField];
                    var value = "";
                    if (mapping.constructor === Array) {
                        if (mapping[1] === undefined) {
                            value = "unprojected[ix + " + mapping[0] + "]";
                        }
                        else if (!root.unprojected || root.unprojected[mapping[0]]) {
                            value = "row" + mapping[0] + "['" + mapping[1] + "']";
                        }
                        else {
                            value = "unprojected[ix + " + mapping[0] + "]['" + mapping[1] + "']";
                        }
                    }
                    else {
                        value = JSON.stringify(mapping);
                    }
                    projectedVars.push("projected['" + newField.replace(/'/g, "\\'") + "'] = " + value);
                    idStringParts.push(value);
                }
                code += projectedVars.join(";\n") + "\n";
                code += "projected.__id = " + idStringParts.join(" + \"|\" + ") + ";\n";
                code += "results.push(projected);\n";
                code += "projected = {};\n";
                break;
            case "provenance":
                var provenance = "var provenance__id = '';\n";
                var ids = [];
                for (var _m = 0, _o = this.joins; _m < _o.length; _m++) {
                    var join = _o[_m];
                    if (join.negated)
                        continue;
                    provenance += "provenance__id = tableId + '|' + projected.__id + '|' + rowInstance + '|" + join.table + "|' + row" + join.ix + ".__id; \n";
                    provenance += "provenance.push({table: tableId, row: projected, \"row instance\": rowInstance, source: \"" + join.table + "\", \"source row\": row" + join.ix + "});\n";
                    ids.push("row" + join.ix + ".__id");
                }
                code = "var rowInstance = " + ids.join(" + '|' + ") + ";\n        " + provenance;
                break;
            case "return":
                var returns = [];
                for (var _p = 0, _q = root.vars; _p < _q.length; _p++) {
                    var curVar = _q[_p];
                    returns.push(curVar + ": " + curVar);
                }
                code += "return {" + returns.join(", ") + "};";
                break;
        }
        return code;
    };
    // given a set of changes and a join order, determine the root facts that need
    // to be joined again to cover all the adds
    Query.prototype.reverseJoin = function (joins) {
        var changed = joins[0];
        var reverseJoinMap = {};
        // collect all the constraints and reverse them
        for (var _i = 0; _i < joins.length; _i++) {
            var join = joins[_i];
            for (var key in join.join) {
                var _a = join.join[key], source = _a[0], field = _a[1];
                if (source <= changed.ix) {
                    if (!reverseJoinMap[source]) {
                        reverseJoinMap[source] = {};
                    }
                    if (!reverseJoinMap[source][field])
                        reverseJoinMap[source][field] = [join.ix, key];
                }
            }
        }
        var recurse = function (joins, joinIx) {
            var code = "";
            if (joinIx >= joins.length) {
                return "others.push(row0)";
            }
            var _a = joins[joinIx], table = _a.table, ix = _a.ix, negated = _a.negated;
            var joinMap = joins[joinIx].join;
            // we only care about this guy if he's joined with at least one thing
            if (!reverseJoinMap[ix] && joinIx < joins.length - 1)
                return recurse(joins, joinIx + 1);
            else if (!reverseJoinMap)
                return "";
            var mappings = [];
            for (var key in reverseJoinMap[ix]) {
                var _b = reverseJoinMap[ix][key], sourceIx = _b[0], field = _b[1];
                if (sourceIx === changed.ix || reverseJoinMap[sourceIx] !== undefined) {
                    mappings.push("'" + key + "': row" + sourceIx + "['" + field + "']");
                }
            }
            for (var key in joinMap) {
                var value = joinMap[key];
                if (value.constructor !== Array) {
                    mappings.push("'" + key + "': " + JSON.stringify(value));
                }
            }
            if (negated) {
            }
            code += "\n            var rows" + ix + " = eve.find('" + table + "', {" + mappings.join(", ") + "});\n            for(var rowsIx" + ix + " = 0, rowsLen" + ix + " = rows" + ix + ".length; rowsIx" + ix + " < rowsLen" + ix + "; rowsIx" + ix + "++) {\n                var row" + ix + " = rows" + ix + "[rowsIx" + ix + "];\n                " + recurse(joins, joinIx + 1) + "\n            }\n            ";
            return code;
        };
        return recurse(joins, 1);
    };
    Query.prototype.compileIncrementalRowFinderCode = function () {
        var code = "var others = [];\n";
        var reversed = this.joins.slice().reverse();
        var checks = [];
        var ix = 0;
        for (var _i = 0; _i < reversed.length; _i++) {
            var join = reversed[_i];
            // we don't want to do this for the root
            if (ix === reversed.length - 1)
                break;
            checks.push("\n\t\t\tif(changes[\"" + join.table + "\"] && changes[\"" + join.table + "\"].adds) {\n                var curChanges" + join.ix + " = changes[\"" + join.table + "\"].adds;\n                for(var changeIx" + join.ix + " = 0, changeLen" + join.ix + " = curChanges" + join.ix + ".length; changeIx" + join.ix + " < changeLen" + join.ix + "; changeIx" + join.ix + "++) {\n                    var row" + join.ix + " = curChanges" + join.ix + "[changeIx" + join.ix + "];\n\t\t\t\t\t" + this.reverseJoin(reversed.slice(ix)) + "\n\t\t\t\t}\n\t\t\t}");
            ix++;
        }
        code += checks.join(" else");
        var last = reversed[ix];
        code += "\n\t\t\tif(changes[\"" + last.table + "\"] && changes[\"" + last.table + "\"].adds) {\n                var curChanges = changes[\"" + last.table + "\"].adds;\n\t\t\t\tfor(var changeIx = 0, changeLen = curChanges.length; changeIx < changeLen; changeIx++) {\n\t\t\t\t\tothers.push(curChanges[changeIx]);\n\t\t\t\t}\n\t\t\t}\n\t\t\treturn others;";
        return code;
    };
    Query.prototype.incrementalRemove = function (changes) {
        var ixer = this.ixer;
        var rowsToPostCheck = [];
        var provenanceDiff = this.ixer.diff();
        var removes = [];
        var indexes = ixer.table("provenance").indexes;
        var sourceRowLookup = indexes["source|source row|table"].index;
        var rowInstanceLookup = indexes["row instance|table"].index;
        var tableRowLookup = indexes["row|table"].index;
        var provenanceRemoves = [];
        var visited = {};
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var change = changes[join.table];
            if (!visited[join.table] && change && change.removes.length) {
                visited[join.table] = true;
                for (var _b = 0, _c = change.removes; _b < _c.length; _b++) {
                    var remove = _c[_b];
                    var provenances = sourceRowLookup[join.table + '|' + remove.__id + '|' + this.name];
                    if (provenances) {
                        for (var _d = 0; _d < provenances.length; _d++) {
                            var provenance = provenances[_d];
                            if (!visited[provenance["row instance"]]) {
                                visited[provenance["row instance"]] = true;
                                var relatedProvenance = rowInstanceLookup[provenance["row instance"] + '|' + provenance.table];
                                for (var _e = 0; _e < relatedProvenance.length; _e++) {
                                    var related = relatedProvenance[_e];
                                    provenanceRemoves.push(related);
                                }
                            }
                            rowsToPostCheck.push(provenance);
                        }
                    }
                }
            }
        }
        provenanceDiff.removeFacts("provenance", provenanceRemoves);
        ixer.applyDiffIncremental(provenanceDiff);
        var isEdb = ixer.edbTables;
        for (var _f = 0; _f < rowsToPostCheck.length; _f++) {
            var row = rowsToPostCheck[_f];
            var supports = tableRowLookup[row.row.__id + '|' + row.table];
            if (!supports || supports.length === 0) {
                removes.push(row.row);
            }
        }
        return removes;
    };
    Query.prototype.canBeIncremental = function () {
        if (this.aggregates.length)
            return false;
        if (this.sorts)
            return false;
        if (this.groups)
            return false;
        if (this.limitInfo)
            return false;
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            if (join.negated)
                return false;
        }
        if (!this.joins.length)
            return false;
        return true;
    };
    Query.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "QueryFunctions", "tableId", "rootRows", code);
        if (this.canBeIncremental()) {
            this.incrementalRowFinder = new Function("changes", this.compileIncrementalRowFinderCode());
        }
        else {
            this.incrementalRowFinder = undefined;
        }
        this.dirty = false;
        return this;
    };
    Query.prototype.exec = function () {
        if (this.dirty) {
            this.compile();
        }
        var root = this.joins[0];
        var rows;
        if (root) {
            rows = this.ixer.find(root.table, root.join);
        }
        else {
            rows = [];
        }
        return this.compiled(this.ixer, exports.QueryFunctions, this.name, rows);
    };
    Query.prototype.execIncremental = function (changes, table) {
        if (this.dirty) {
            this.compile();
        }
        if (this.incrementalRowFinder) {
            var potentialRows = this.incrementalRowFinder(changes);
            // if the root select has some constant filters, then
            // the above rows need to be filtered down to only those that
            // match.
            var rows = [];
            var root = this.joins[0];
            var rootKeys = Object.keys(root.join);
            if (rootKeys.length > 0) {
                rowLoop: for (var _i = 0; _i < potentialRows.length; _i++) {
                    var row = potentialRows[_i];
                    for (var _a = 0; _a < rootKeys.length; _a++) {
                        var key = rootKeys[_a];
                        if (row[key] !== root.join[key])
                            continue rowLoop;
                    }
                    rows.push(row);
                }
            }
            else {
                rows = potentialRows;
            }
            var results = this.compiled(this.ixer, exports.QueryFunctions, this.name, rows);
            var adds = [];
            var prevHashes = table.factHash;
            var prevKeys = Object.keys(prevHashes);
            var suggestedRemoves = this.incrementalRemove(changes);
            var realDiff = diffAddsAndRemoves(results.results, suggestedRemoves);
            for (var _b = 0, _c = realDiff.adds; _b < _c.length; _b++) {
                var result = _c[_b];
                var id = result.__id;
                if (prevHashes[id] === undefined) {
                    adds.push(result);
                }
            }
            var diff = this.ixer.diff();
            diff.addMany("provenance", results.provenance);
            this.ixer.applyDiffIncremental(diff);
            // console.log("INC PROV DIFF", this.name, diff.length);
            return { provenance: results.provenance, adds: adds, removes: realDiff.removes };
        }
        else {
            var results = this.exec();
            var adds = [];
            var removes = [];
            var prevHashes = table.factHash;
            var prevKeys = Object.keys(prevHashes);
            var newHashes = {};
            for (var _d = 0, _e = results.results; _d < _e.length; _d++) {
                var result = _e[_d];
                var id = result.__id;
                newHashes[id] = result;
                if (prevHashes[id] === undefined) {
                    adds.push(result);
                }
            }
            for (var _f = 0; _f < prevKeys.length; _f++) {
                var hash = prevKeys[_f];
                var value = newHashes[hash];
                if (value === undefined) {
                    removes.push(prevHashes[hash]);
                }
            }
            var realDiff = diffAddsAndRemoves(adds, removes);
            var diff = this.ixer.diff();
            diff.remove("provenance", { table: this.name });
            diff.addMany("provenance", results.provenance);
            this.ixer.applyDiffIncremental(diff);
            // console.log("FULL PROV SIZE", this.name, diff.length);
            return { provenance: results.provenance, adds: realDiff.adds, removes: realDiff.removes };
        }
    };
    Query.prototype.debug = function () {
        console.log(this.compileAST(this.toAST()));
        console.time("exec");
        var results = this.exec();
        console.timeEnd("exec");
        console.log(results);
        return results;
    };
    return Query;
})();
exports.Query = Query;
var Union = (function () {
    function Union(ixer, name) {
        if (name === void 0) { name = "unknown"; }
        this.name = name;
        this.ixer = ixer;
        this.tables = [];
        this.sources = [];
        this.isStateful = false;
        this.prev = { results: [], hashes: {} };
        this.dirty = true;
    }
    Union.prototype.changeset = function (ixer) {
        var diff = ixer.diff();
        diff.add("view", { view: this.name, kind: "union" });
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            if (source.type === "+") {
                var action = utils_1.uuid();
                diff.add("action", { view: this.name, action: action, kind: "union", ix: 0 });
                diff.add("action source", { action: action, "source view": source.table });
                for (var field in source.mapping) {
                    var mapped = source.mapping[field];
                    if (mapped.constructor === Array)
                        diff.add("action mapping", { action: action, from: field, "to source": source.table, "to field": mapped[0] });
                    else
                        diff.add("action mapping constant", { action: action, from: field, value: mapped });
                }
            }
            else
                throw new Error("Unknown source type: '" + source.type + "'");
        }
        return diff;
    };
    Union.prototype.ensureHasher = function (mapping) {
        if (!this.hasher) {
            this.hasher = generateStringFn(Object.keys(mapping));
        }
    };
    Union.prototype.union = function (tableName, mapping) {
        this.dirty = true;
        this.ensureHasher(mapping);
        this.tables.push(tableName);
        this.sources.push({ type: "+", table: tableName, mapping: mapping });
        return this;
    };
    Union.prototype.toAST = function () {
        var root = { type: "union", children: [] };
        root.children.push({ type: "declaration", var: "results", value: "[]" });
        root.children.push({ type: "declaration", var: "provenance", value: "[]" });
        var hashesValue = "{}";
        if (this.isStateful) {
            hashesValue = "prevHashes";
        }
        root.children.push({ type: "declaration", var: "hashes", value: hashesValue });
        var ix = 0;
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var action = void 0;
            if (source.type === "+") {
                action = { type: "result", ix: ix, children: [{ type: "provenance", source: source, ix: ix }] };
            }
            root.children.push({
                type: "source",
                ix: ix,
                table: source.table,
                mapping: source.mapping,
                children: [action],
            });
            ix++;
        }
        root.children.push({ type: "hashesToResults" });
        root.children.push({ type: "return", vars: ["results", "hashes", "provenance"] });
        return root;
    };
    Union.prototype.compileAST = function (root) {
        var code = "";
        var type = root.type;
        switch (type) {
            case "union":
                for (var _i = 0, _a = root.children; _i < _a.length; _i++) {
                    var child = _a[_i];
                    code += this.compileAST(child);
                }
                break;
            case "declaration":
                code += "var " + root.var + " = " + root.value + ";\n";
                break;
            case "source":
                var ix = root.ix;
                var mappingItems = [];
                for (var key in root.mapping) {
                    var mapping = root.mapping[key];
                    var value = void 0;
                    if (mapping.constructor === Array && mapping.length === 1) {
                        var field = mapping[0];
                        value = "sourceRow" + ix + "['" + field + "']";
                    }
                    else if (mapping.constructor === Array && mapping.length === 2) {
                        var _ = mapping[0], field = mapping[1];
                        value = "sourceRow" + ix + "['" + field + "']";
                    }
                    else {
                        value = JSON.stringify(mapping);
                    }
                    mappingItems.push("'" + key + "': " + value);
                }
                code += "var sourceRows" + ix + " = changes['" + root.table + "'];\n";
                code += "for(var rowIx" + ix + " = 0, rowsLen" + ix + " = sourceRows" + ix + ".length; rowIx" + ix + " < rowsLen" + ix + "; rowIx" + ix + "++) {\n";
                code += "var sourceRow" + ix + " = sourceRows" + ix + "[rowIx" + ix + "];\n";
                code += "var mappedRow" + ix + " = {" + mappingItems.join(", ") + "};\n";
                for (var _b = 0, _c = root.children; _b < _c.length; _b++) {
                    var child = _c[_b];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "result":
                var ix = root.ix;
                code += "var hash" + ix + " = hasher(mappedRow" + ix + ");\n";
                code += "mappedRow" + ix + ".__id = hash" + ix + ";\n";
                code += "hashes[hash" + ix + "] = mappedRow" + ix + ";\n";
                for (var _d = 0, _e = root.children; _d < _e.length; _d++) {
                    var child = _e[_d];
                    code += this.compileAST(child);
                }
                break;
            case "removeResult":
                var ix = root.ix;
                code += "hashes[hasher(mappedRow" + ix + ")] = false;\n";
                break;
            case "hashesToResults":
                code += "var hashKeys = Object.keys(hashes);\n";
                code += "for(var hashKeyIx = 0, hashKeyLen = hashKeys.length; hashKeyIx < hashKeyLen; hashKeyIx++) {\n";
                code += "var curHashKey = hashKeys[hashKeyIx];";
                code += "var value = hashes[curHashKey];\n";
                code += "if(value !== false) {\n";
                code += "value.__id = curHashKey;\n";
                code += "results.push(value);\n";
                code += "}\n";
                code += "}\n";
                break;
            case "provenance":
                var source = root.source.table;
                var ix = root.ix;
                var provenance = "var provenance__id = '';\n";
                provenance += "provenance__id = '" + this.name + "|' + mappedRow" + ix + ".__id + '|' + rowInstance + '|" + source + "|' + sourceRow" + ix + ".__id; \n";
                provenance += "provenance.push({table: '" + this.name + "', row: mappedRow" + ix + ", \"row instance\": rowInstance, source: \"" + source + "\", \"source row\": sourceRow" + ix + "});\n";
                code = "var rowInstance = \"" + source + "|\" + mappedRow" + ix + ".__id;\n        " + provenance;
                break;
            case "return":
                code += "return {" + root.vars.map(function (name) { return (name + ": " + name); }).join(", ") + "};";
                break;
        }
        return code;
    };
    Union.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "hasher", "changes", code);
        this.dirty = false;
        return this;
    };
    Union.prototype.debug = function () {
        var code = this.compileAST(this.toAST());
        console.log(code);
        return code;
    };
    Union.prototype.exec = function () {
        if (this.dirty) {
            this.compile();
        }
        var changes = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            changes[source.table] = this.ixer.table(source.table).table;
        }
        var results = this.compiled(this.ixer, this.hasher, changes);
        return results;
    };
    Union.prototype.incrementalRemove = function (changes) {
        var ixer = this.ixer;
        var rowsToPostCheck = [];
        var provenanceDiff = this.ixer.diff();
        var removes = [];
        var indexes = ixer.table("provenance").indexes;
        var sourceRowLookup = indexes["source|source row|table"].index;
        var rowInstanceLookup = indexes["row instance|table"].index;
        var tableRowLookup = indexes["row|table"].index;
        var provenanceRemoves = [];
        var visited = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var change = changes[source.table];
            if (!visited[source.table] && change && change.removes.length) {
                visited[source.table] = true;
                for (var _b = 0, _c = change.removes; _b < _c.length; _b++) {
                    var remove = _c[_b];
                    var provenances = sourceRowLookup[source.table + '|' + remove.__id + '|' + this.name];
                    if (provenances) {
                        for (var _d = 0; _d < provenances.length; _d++) {
                            var provenance = provenances[_d];
                            if (!visited[provenance["row instance"]]) {
                                visited[provenance["row instance"]] = true;
                                var relatedProvenance = rowInstanceLookup[provenance["row instance"] + '|' + provenance.table];
                                for (var _e = 0; _e < relatedProvenance.length; _e++) {
                                    var related = relatedProvenance[_e];
                                    provenanceRemoves.push(related);
                                }
                            }
                            rowsToPostCheck.push(provenance);
                        }
                    }
                }
            }
        }
        provenanceDiff.removeFacts("provenance", provenanceRemoves);
        ixer.applyDiffIncremental(provenanceDiff);
        var isEdb = ixer.edbTables;
        for (var _f = 0; _f < rowsToPostCheck.length; _f++) {
            var row = rowsToPostCheck[_f];
            var supports = tableRowLookup[row.row.__id + '|' + row.table];
            if (!supports || supports.length === 0) {
                removes.push(row.row);
            }
            else if (this.sources.length > 2) {
                var supportsToRemove = [];
                // otherwise if there are supports, then we need to walk the support
                // graph backwards and make sure every supporting row terminates at an
                // edb value. If not, then that support also needs to be removed
                for (var _g = 0; _g < supports.length; _g++) {
                    var support = supports[_g];
                    // if the support is already an edb, we're good to go.
                    if (isEdb[support.source])
                        continue;
                    if (!tableRowLookup[support["source row"].__id + '|' + support.source]) {
                        supportsToRemove.push(support);
                        continue;
                    }
                    // get all the supports for this support
                    var nodes = tableRowLookup[support["source row"].__id + '|' + support.source].slice();
                    var nodeIx = 0;
                    // iterate through all the nodes, if they have further supports then
                    // assume this node is ok and add those supports to the list of nodes to
                    // check. If we run into a node with no supports it must either be an edb
                    // or it's unsupported and this row instance needs to be removed.
                    while (nodeIx < nodes.length) {
                        var node = nodes[nodeIx];
                        if (isEdb[node.source]) {
                            nodeIx++;
                            continue;
                        }
                        var nodeSupports = tableRowLookup[node["source row"].__id + '|' + node.source];
                        if (!nodeSupports || nodeSupports.length === 0) {
                            supportsToRemove.push(support);
                            break;
                        }
                        else {
                            for (var _h = 0; _h < nodeSupports.length; _h++) {
                                var nodeSupport = nodeSupports[_h];
                                nodes.push(nodeSupport);
                            }
                            nodeIx++;
                        }
                    }
                }
                if (supportsToRemove.length) {
                    // we need to remove all the supports
                    var provenanceRemoves_1 = [];
                    for (var _j = 0; _j < supportsToRemove.length; _j++) {
                        var support = supportsToRemove[_j];
                        var relatedProvenance = rowInstanceLookup[support["row instance"] + '|' + support.table];
                        for (var _k = 0; _k < relatedProvenance.length; _k++) {
                            var related = relatedProvenance[_k];
                            provenanceRemoves_1.push(related);
                        }
                    }
                    var diff = ixer.diff();
                    diff.removeFacts("provenance", provenanceRemoves_1);
                    ixer.applyDiffIncremental(diff);
                    // now that all the unsupported provenances have been removed, check if there's anything
                    // left.
                    if (!tableRowLookup[row.row.__id + '|' + row.table] || tableRowLookup[row.row.__id + '|' + row.table].length === 0) {
                        removes.push(row.row);
                    }
                }
            }
        }
        return removes;
    };
    Union.prototype.execIncremental = function (changes, table) {
        if (this.dirty) {
            this.compile();
        }
        var sourceChanges = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var value = void 0;
            if (!changes[source.table]) {
                value = [];
            }
            else {
                value = changes[source.table].adds;
            }
            sourceChanges[source.table] = value;
        }
        var results = this.compiled(this.ixer, this.hasher, sourceChanges);
        var adds = [];
        var prevHashes = table.factHash;
        var prevKeys = Object.keys(prevHashes);
        var suggestedRemoves = this.incrementalRemove(changes);
        var realDiff = diffAddsAndRemoves(results.results, suggestedRemoves);
        for (var _b = 0, _c = realDiff.adds; _b < _c.length; _b++) {
            var result = _c[_b];
            var id = result.__id;
            if (prevHashes[id] === undefined) {
                adds.push(result);
            }
        }
        var diff = this.ixer.diff();
        diff.addMany("provenance", results.provenance);
        this.ixer.applyDiffIncremental(diff);
        return { provenance: results.provenance, adds: adds, removes: realDiff.removes };
    };
    return Union;
})();
exports.Union = Union;
//---------------------------------------------------------
// Builtin Primitives
//---------------------------------------------------------
runtime.define("count", { aggregate: true, result: "count" }, function (prev) {
    if (!prev.count) {
        prev.count = 0;
    }
    prev.count++;
    return prev;
});
runtime.define("sum", { aggregate: true, result: "sum" }, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
    }
    prev.sum += value;
    return prev;
});
runtime.define("average", { aggregate: true, result: "average" }, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
        prev.count = 0;
    }
    prev.count++;
    prev.sum += value;
    prev.average = prev.sum / prev.count;
    return prev;
});
runtime.define("lowercase", { result: "lowercase" }, function (text) {
    if (typeof text === "string") {
        return { result: text.toLowerCase() };
    }
    return { result: text };
});
runtime.define("=", { filter: true }, function (a, b) {
    return a === b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define(">", { filter: true }, function (a, b) {
    return a > b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("<", { filter: true }, function (a, b) {
    return a < b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define(">=", { filter: true }, function (a, b) {
    return a >= b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("<=", { filter: true }, function (a, b) {
    return a <= b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("+", { result: "result" }, function (a, b) {
    return { result: a + b };
});
runtime.define("-", { result: "result" }, function (a, b) {
    return { result: a - b };
});
runtime.define("*", { result: "result" }, function (a, b) {
    return { result: a * b };
});
runtime.define("/", { result: "result" }, function (a, b) {
    return { result: a / b };
});
//---------------------------------------------------------
// AST and compiler
//---------------------------------------------------------
// view: view, kind[union|query|table]
// action: view, action, kind[select|calculate|project|union|ununion|stateful|limit|sort|group|aggregate], ix
// action source: action, source view
// action mapping: action, from, to source, to field
// action mapping constant: action, from, value
function addRecompileTriggers(eve) {
    var recompileTrigger = {
        exec: function (ixer) {
            for (var _i = 0, _a = ixer.find("view"); _i < _a.length; _i++) {
                var view = _a[_i];
                if (view.kind === "table")
                    continue;
                var query = compile(ixer, view.view);
                ixer.asView(query);
            }
            return {};
        }
    };
    eve.addTable("view", ["view", "kind"]);
    eve.addTable("action", ["view", "action", "kind", "ix"]);
    eve.addTable("action source", ["action", "source view"]);
    eve.addTable("action mapping", ["action", "from", "to source", "to field"]);
    eve.addTable("action mapping constant", ["action", "from", "value"]);
    eve.addTable("action mapping sorted", ["action", "ix", "source", "field", "direction"]);
    eve.addTable("action mapping limit", ["action", "limit type", "value"]);
    eve.table("view").triggers["recompile"] = recompileTrigger;
    eve.table("action").triggers["recompile"] = recompileTrigger;
    eve.table("action source").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping constant").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping sorted").triggers["recompile"] = recompileTrigger;
    eve.table("action mapping limit").triggers["recompile"] = recompileTrigger;
    return eve;
}
function compile(ixer, viewId) {
    var view = ixer.findOne("view", { view: viewId });
    if (!view) {
        throw new Error("No view found for " + viewId + ".");
    }
    var compiled = ixer[view.kind](viewId);
    var actions = ixer.find("action", { view: viewId });
    if (!actions) {
        throw new Error("View " + viewId + " has no actions.");
    }
    // sort actions by ix
    actions.sort(function (a, b) { return a.ix - b.ix; });
    for (var _i = 0; _i < actions.length; _i++) {
        var action = actions[_i];
        var actionKind = action.kind;
        if (actionKind === "limit") {
            var limit = {};
            for (var _a = 0, _b = ixer.find("action mapping limit", { action: action.action }); _a < _b.length; _a++) {
                var limitMapping = _b[_a];
                limit[limitMapping["limit type"]] = limitMapping["value"];
            }
            compiled.limit(limit);
        }
        else if (actionKind === "sort" || actionKind === "group") {
            var sorted = [];
            var mappings = ixer.find("action mapping sorted", { action: action.action });
            mappings.sort(function (a, b) { return a.ix - b.ix; });
            for (var _c = 0; _c < mappings.length; _c++) {
                var mapping = mappings[_c];
                sorted.push([mapping["source"], mapping["field"], mapping["direction"]]);
            }
            if (sorted.length) {
                compiled[actionKind](sorted);
            }
            else {
                throw new Error(actionKind + " without any mappings: " + action.action);
            }
        }
        else {
            var mappings = ixer.find("action mapping", { action: action.action });
            var mappingObject = {};
            for (var _d = 0; _d < mappings.length; _d++) {
                var mapping = mappings[_d];
                var source_1 = mapping["to source"];
                var field = mapping["to field"];
                if (actionKind === "union" || actionKind === "ununion") {
                    mappingObject[mapping.from] = [field];
                }
                else {
                    mappingObject[mapping.from] = [source_1, field];
                }
            }
            var constants = ixer.find("action mapping constant", { action: action.action });
            for (var _e = 0; _e < constants.length; _e++) {
                var constant = constants[_e];
                mappingObject[constant.from] = constant.value;
            }
            var source = ixer.findOne("action source", { action: action.action });
            if (!source && actionKind !== "project") {
                throw new Error(actionKind + " action without a source in '" + viewId + "'");
            }
            if (actionKind !== "project") {
                compiled[actionKind](source["source view"], mappingObject, action.action);
            }
            else {
                compiled[actionKind](mappingObject);
            }
        }
    }
    return compiled;
}
exports.compile = compile;
//---------------------------------------------------------
// Public API
//---------------------------------------------------------
exports.SUCCEED = [{ success: true }];
exports.FAIL = [];
function indexer() {
    var ixer = new Indexer();
    addProvenanceTable(ixer);
    addRecompileTriggers(ixer);
    return ixer;
}
exports.indexer = indexer;
if (utils_1.ENV === "browser")
    window["runtime"] = exports;

},{"./utils":6}],5:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime_1 = require("./runtime");
function resolve(table, fact) {
    var neue = {};
    for (var field in fact)
        neue[(table + ": " + field)] = fact[field];
    return neue;
}
function humanize(table, fact) {
    var neue = {};
    for (var field in fact)
        neue[field.slice(table.length + 2)] = fact[field];
    return neue;
}
function resolvedAdd(changeset, table, fact) {
    return changeset.add(table, resolve(table, fact));
}
function resolvedRemove(changeset, table, fact) {
    return changeset.remove(table, resolve(table, fact));
}
function humanizedFind(ixer, table, query) {
    var results = [];
    for (var _i = 0, _a = ixer.find(table, resolve(table, query)); _i < _a.length; _i++) {
        var fact = _a[_i];
        results.push(humanize(table, fact));
    }
    var diag = {};
    for (var table_1 in ixer.tables)
        diag[table_1] = ixer.tables[table_1].table.length;
    return results;
}
var UI = (function () {
    function UI(id) {
        this.id = id;
        this._children = [];
        this._attributes = {};
        this._events = {};
    }
    UI.remove = function (template, ixer) {
        var changeset = ixer.diff();
        resolvedRemove(changeset, "ui template", { template: template });
        resolvedRemove(changeset, "ui template binding", { template: template });
        var bindings = humanizedFind(ixer, "ui template binding", { template: template });
        for (var _i = 0; _i < bindings.length; _i++) {
            var binding = bindings[_i];
            changeset.merge(runtime_1.Query.remove(binding.binding, ixer));
        }
        resolvedRemove(changeset, "ui embed", { template: template });
        var embeds = humanizedFind(ixer, "ui embed", { template: template });
        for (var _a = 0; _a < embeds.length; _a++) {
            var embed = embeds[_a];
            resolvedRemove(changeset, "ui embed scope", { template: template, embed: embed.embed });
            resolvedRemove(changeset, "ui embed scope binding", { template: template, embed: embed.embed });
        }
        resolvedRemove(changeset, "ui attribute", { template: template });
        resolvedRemove(changeset, "ui attribute binding", { template: template });
        resolvedRemove(changeset, "ui event", { template: template });
        var events = humanizedFind(ixer, "ui event", { template: template });
        for (var _b = 0; _b < events.length; _b++) {
            var event_1 = events[_b];
            resolvedRemove(changeset, "ui event state", { template: template, event: event_1.event });
            resolvedRemove(changeset, "ui event state binding", { template: template, event: event_1.event });
        }
        for (var _c = 0, _d = humanizedFind(ixer, "ui template", { parent: template }); _c < _d.length; _c++) {
            var child = _d[_c];
            changeset.merge(UI.remove(child.template, ixer));
        }
        return changeset;
    };
    UI.prototype.copy = function () {
        var neue = new UI(this.id);
        neue._binding = this._binding;
        neue._embedded = this._embedded;
        neue._children = this._children;
        neue._attributes = this._attributes;
        neue._events = this._events;
        neue._parent = this._parent;
        return neue;
    };
    UI.prototype.changeset = function (ixer) {
        var changeset = ixer.diff();
        var parent = this._attributes["parent"] || (this._parent && this._parent.id) || "";
        var ix = this._attributes["ix"];
        if (ix === undefined)
            ix = (this._parent && this._parent._children.indexOf(this));
        if (ix === -1 || ix === undefined)
            ix = "";
        if (this._embedded)
            parent = "";
        resolvedAdd(changeset, "ui template", { template: this.id, parent: parent, ix: ix });
        if (this._binding) {
            if (!this._binding.name || this._binding.name === "unknown")
                this._binding.name = "bound view " + this.id;
            changeset.merge(this._binding.changeset(ixer));
            resolvedAdd(changeset, "ui template binding", { template: this.id, binding: this._binding.name });
        }
        if (this._embedded) {
            var embed = utils_1.uuid();
            resolvedAdd(changeset, "ui embed", { embed: embed, template: this.id, parent: (this._parent || {}).id, ix: ix });
            for (var key in this._embedded) {
                var value = this._attributes[key];
                if (value instanceof Array)
                    resolvedAdd(changeset, "ui embed scope binding", { embed: embed, key: key, source: value[0], alias: value[1] });
                else
                    resolvedAdd(changeset, "ui embed scope", { embed: embed, key: key, value: value });
            }
        }
        for (var property in this._attributes) {
            var value = this._attributes[property];
            if (value instanceof Array)
                resolvedAdd(changeset, "ui attribute binding", { template: this.id, property: property, source: value[0], alias: value[1] });
            else
                resolvedAdd(changeset, "ui attribute", { template: this.id, property: property, value: value });
        }
        for (var event_2 in this._events) {
            resolvedAdd(changeset, "ui event", { template: this.id, event: event_2 });
            var state = this._events[event_2];
            for (var key in state) {
                var value = state[key];
                if (value instanceof Array)
                    resolvedAdd(changeset, "ui event state binding", { template: this.id, event: event_2, key: key, source: value[0], alias: value[1] });
                else
                    resolvedAdd(changeset, "ui event state", { template: this.id, event: event_2, key: key, value: value });
            }
        }
        for (var _i = 0, _a = this._children; _i < _a.length; _i++) {
            var child = _a[_i];
            changeset.merge(child.changeset(ixer));
        }
        return changeset;
    };
    UI.prototype.load = function (template, ixer, parent) {
        var fact = humanizedFind(ixer, "ui template", { template: template })[0];
        if (!fact)
            return this;
        if (parent || fact.parent)
            this._parent = parent || new UI(this._parent);
        var binding = humanizedFind(ixer, "ui template binding", { template: template })[0];
        if (binding)
            this.bind((new runtime_1.Query(ixer, binding.binding)));
        var embed = humanizedFind(ixer, "ui embed", { template: template, parent: this._parent ? this._parent.id : "" })[0];
        if (embed) {
            var scope = {};
            for (var _i = 0, _a = humanizedFind(ixer, "ui embed scope", { embed: embed.embed }); _i < _a.length; _i++) {
                var attr = _a[_i];
                scope[attr.key] = attr.value;
            }
            for (var _b = 0, _c = humanizedFind(ixer, "ui embed scope binding", { embed: embed.embed }); _b < _c.length; _b++) {
                var attr = _c[_b];
                scope[attr.key] = [attr.source, attr.alias];
            }
            this.embed(scope);
        }
        for (var _d = 0, _e = humanizedFind(ixer, "ui attribute", { template: template }); _d < _e.length; _d++) {
            var attr = _e[_d];
            this.attribute(attr.property, attr.value);
        }
        for (var _f = 0, _g = humanizedFind(ixer, "ui attribute binding", { template: template }); _f < _g.length; _f++) {
            var attr = _g[_f];
            this.attribute(attr.property, [attr.source, attr.alias]);
        }
        for (var _h = 0, _j = humanizedFind(ixer, "ui event", { template: template }); _h < _j.length; _h++) {
            var event_3 = _j[_h];
            var state = {};
            for (var _k = 0, _l = humanizedFind(ixer, "ui event state", { template: template, event: event_3.event }); _k < _l.length; _k++) {
                var attr = _l[_k];
                state[event_3.key] = event_3.value;
            }
            for (var _m = 0, _o = humanizedFind(ixer, "ui event state binding", { template: template, event: event_3.event }); _m < _o.length; _m++) {
                var attr = _o[_m];
                state[event_3.key] = [event_3.source, event_3.alias];
            }
            this.event(event_3.event, state);
        }
        for (var _p = 0, _q = humanizedFind(ixer, "ui template", { parent: template }); _p < _q.length; _p++) {
            var child = _q[_p];
            this.child((new UI(child.template)).load(child.template, ixer, this));
        }
        return this;
    };
    UI.prototype.children = function (neue, append) {
        if (append === void 0) { append = false; }
        if (!neue)
            return this._children;
        if (!append)
            this._children.length = 0;
        for (var _i = 0; _i < neue.length; _i++) {
            var child = neue[_i];
            var copied = child.copy();
            copied._parent = this;
            this._children.push(copied);
        }
        return this._children;
    };
    UI.prototype.child = function (child, ix, embed) {
        child = child.copy();
        child._parent = this;
        if (embed)
            child.embed(embed);
        if (!ix)
            this._children.push(child);
        else
            this._children.splice(ix, 0, child);
        return child;
    };
    UI.prototype.removeChild = function (ix) {
        return this._children.splice(ix, 1);
    };
    UI.prototype.attributes = function (properties, merge) {
        if (merge === void 0) { merge = false; }
        if (!properties)
            return this._attributes;
        if (!merge) {
            for (var prop in this._attributes)
                delete this._attributes[prop];
        }
        for (var prop in properties)
            this._attributes[prop] = properties[prop];
        return this;
    };
    UI.prototype.attribute = function (property, value) {
        if (value === undefined)
            return this._attributes[property];
        this._attributes[property] = value;
        return this;
    };
    UI.prototype.removeAttribute = function (property) {
        delete this._attributes[property];
        return this;
    };
    UI.prototype.events = function (events, merge) {
        if (merge === void 0) { merge = false; }
        if (!events)
            return this._events;
        if (!merge) {
            for (var event_4 in this._events)
                delete this._events[event_4];
        }
        for (var event_5 in events)
            this._events[event_5] = events[event_5];
        return this;
    };
    UI.prototype.event = function (event, state) {
        if (state === undefined)
            return this._events[event];
        this._attributes[event] = state;
        return this;
    };
    UI.prototype.removeEvent = function (event) {
        delete this._events[event];
        return this;
    };
    UI.prototype.embed = function (scope) {
        if (scope === void 0) { scope = {}; }
        if (!scope) {
            this._embedded = undefined;
            return this;
        }
        if (scope === true)
            scope = {};
        this._embedded = scope;
        return this;
    };
    UI.prototype.bind = function (binding) {
        this._binding = binding;
        return this;
    };
    return UI;
})();
exports.UI = UI;
// @TODO: Finish reference impl.
// @TODO: Then build bit-generating version
var UIRenderer = (function () {
    function UIRenderer(ixer) {
        this.ixer = ixer;
        this.compiled = 0;
        this._tagCompilers = {};
        this._handlers = [];
    }
    UIRenderer.prototype.compile = function (roots) {
        if (utils_1.DEBUG.RENDERER)
            console.group("ui compile");
        var compiledElems = [];
        for (var _i = 0; _i < roots.length; _i++) {
            var root = roots[_i];
            // @TODO: reparent dynamic roots if needed.
            if (typeof root === "string") {
                var elems = this._compileWrapper(root, compiledElems.length);
                compiledElems.push.apply(compiledElems, elems);
                var base = this.ixer.findOne("ui template", { "ui template: template": root });
                if (!base)
                    continue;
                var parent_1 = base["ui template: parent"];
                if (parent_1) {
                    for (var _a = 0; _a < elems.length; _a++) {
                        var elem = elems[_a];
                        elem.parent = parent_1;
                    }
                }
            }
            else {
                if (!root.ix)
                    root.ix = compiledElems.length;
                compiledElems.push(root);
            }
        }
        if (utils_1.DEBUG.RENDERER)
            console.groupEnd();
        return compiledElems;
    };
    UIRenderer.prototype._compileWrapper = function (template, baseIx, constraints, bindingStack, depth) {
        if (constraints === void 0) { constraints = {}; }
        if (bindingStack === void 0) { bindingStack = []; }
        if (depth === void 0) { depth = 0; }
        var elems = [];
        var binding = this.ixer.findOne("ui template binding", { "ui template binding: template": template });
        if (!binding) {
            var elem = this._compileElement(template, bindingStack, depth);
            if (elem)
                elems[0] = elem;
        }
        else {
            var boundQuery = binding["ui template binding: binding"];
            var facts = this.getBoundFacts(boundQuery, constraints);
            var ix = 0;
            for (var _i = 0; _i < facts.length; _i++) {
                var fact = facts[_i];
                bindingStack.push(fact);
                var elem = this._compileElement(template, bindingStack, depth);
                bindingStack.pop();
                if (elem)
                    elems.push(elem);
            }
        }
        elems.sort(function (a, b) { return a.ix - b.ix; });
        var prevIx = undefined;
        for (var _a = 0; _a < elems.length; _a++) {
            var elem = elems[_a];
            elem.ix = elem.ix ? elem.ix + baseIx : baseIx;
            if (elem.ix === prevIx)
                elem.ix++;
            prevIx = elem.ix;
        }
        return elems;
    };
    UIRenderer.prototype._compileElement = function (template, bindingStack, depth) {
        if (utils_1.DEBUG.RENDERER)
            console.log(utils_1.repeat("  ", depth) + "* compile", template);
        var elementToChildren = this.ixer.index("ui template", ["ui template: parent"]);
        var elementToEmbeds = this.ixer.index("ui embed", ["ui embed: parent"]);
        var embedToScope = this.ixer.index("ui embed scope", ["ui embed scope: embed"]);
        var embedToScopeBinding = this.ixer.index("ui embed scope binding", ["ui embed scope binding: embed"]);
        var elementToAttrs = this.ixer.index("ui attribute", ["ui attribute: template"]);
        var elementToAttrBindings = this.ixer.index("ui attribute binding", ["ui attribute binding: template"]);
        var elementToEvents = this.ixer.index("ui event", ["ui event: template"]);
        this.compiled++;
        var base = this.ixer.findOne("ui template", { "ui template: template": template });
        if (!base) {
            console.warn("ui template " + template + " does not exist. Ignoring.");
            return undefined;
        }
        var attrs = elementToAttrs[template];
        var boundAttrs = elementToAttrBindings[template];
        var events = elementToEvents[template];
        // Handle meta properties
        var elem = { _template: template, ix: base["ui template: ix"] };
        // Handle static properties
        if (attrs) {
            for (var _i = 0; _i < attrs.length; _i++) {
                var _a = attrs[_i], prop = _a["ui attribute: property"], val = _a["ui attribute: value"];
                elem[prop] = val;
            }
        }
        // Handle bound properties
        if (boundAttrs) {
            // @FIXME: What do with source?
            for (var _b = 0; _b < boundAttrs.length; _b++) {
                var _c = boundAttrs[_b], prop = _c["ui attribute binding: property"], source = _c["ui attribute binding: source"], alias = _c["ui attribute binding: alias"];
                elem[prop] = this.getBoundValue(source, alias, bindingStack);
            }
        }
        // Attach event handlers
        if (events) {
            for (var _d = 0; _d < events.length; _d++) {
                var event_6 = events[_d]["ui event: event"];
                elem[event_6] = this.generateEventHandler(elem, event_6, bindingStack);
            }
        }
        // Compile children
        var children = elementToChildren[template] || [];
        var embeds = elementToEmbeds[template] || [];
        if (children.length || embeds.length) {
            elem.children = [];
            var childIx = 0, embedIx = 0;
            while (childIx < children.length || embedIx < embeds.length) {
                var child = children[childIx];
                var embed = embeds[embedIx];
                var add = void 0, constraints = {}, childBindingStack = bindingStack;
                if (!embed || child && child.ix <= embed.ix) {
                    add = children[childIx++]["ui template: template"];
                    // Resolve bound aliases into constraints
                    constraints = this.getBoundScope(bindingStack);
                }
                else {
                    add = embeds[embedIx++]["ui embed: template"];
                    for (var _e = 0, _f = embedToScope[embed["ui embed: embed"]] || []; _e < _f.length; _e++) {
                        var scope = _f[_e];
                        constraints[scope["ui embed scope: key"]] = scope["ui embed scope: value"];
                    }
                    for (var _g = 0, _h = embedToScopeBinding[embed["ui embed: embed"]] || []; _g < _h.length; _g++) {
                        var scope = _h[_g];
                        // @FIXME: What do about source?
                        var key = scope["ui embed scope binding: key"], source = scope["ui embed scope binding: source"], alias = scope["ui embed scope binding: alias"];
                        constraints[key] = this.getBoundValue(source, alias, bindingStack);
                    }
                    childBindingStack = [constraints];
                }
                elem.children.push.apply(elem.children, this._compileWrapper(add, elem.children.length, constraints, childBindingStack, depth + 1));
            }
        }
        if (this._tagCompilers[elem.t]) {
            try {
                this._tagCompilers[elem.t](elem);
            }
            catch (err) {
                console.warn("Failed to compile template: '" + template + "' due to '" + err + "' for element '" + JSON.stringify(elem) + "'");
                elem.t = "ui-error";
            }
        }
        return elem;
    };
    UIRenderer.prototype.getBoundFacts = function (query, constraints) {
        return this.ixer.find(query, constraints);
    };
    UIRenderer.prototype.getBoundScope = function (bindingStack) {
        var scope = {};
        for (var _i = 0; _i < bindingStack.length; _i++) {
            var fact = bindingStack[_i];
            for (var alias in fact)
                scope[alias] = fact[alias];
        }
        return scope;
    };
    //@FIXME: What do about source?
    UIRenderer.prototype.getBoundValue = function (source, alias, bindingStack) {
        for (var ix = bindingStack.length - 1; ix >= 0; ix--) {
            var fact = bindingStack[ix];
            if (source in fact && fact[alias])
                return fact[alias];
        }
    };
    UIRenderer.prototype.generateEventHandler = function (elem, event, bindingStack) {
        var template = elem["_template"];
        var memoKey = template + "::" + event;
        var attrKey = event + "::state";
        elem[attrKey] = this.getEventState(template, event, bindingStack);
        if (this._handlers[memoKey])
            return this._handlers[memoKey];
        var self = this;
        if (event === "change" || event === "input") {
            this._handlers[memoKey] = function (evt, elem) {
                var props = {};
                if (elem.t === "select" || elem.t === "input" || elem.t === "textarea")
                    props.value = evt.target.value;
                if (elem.type === "checkbox")
                    props.value = evt.target.checked;
                self.handleEvent(template, event, evt, elem, props);
            };
        }
        else {
            this._handlers[memoKey] = function (evt, elem) {
                self.handleEvent(template, event, evt, elem, {});
            };
        }
        return this._handlers[memoKey];
    };
    UIRenderer.prototype.handleEvent = function (template, eventName, event, elem, eventProps) {
        var attrKey = eventName + "::state";
        var state = elem[attrKey];
        var content = (_a = ["\n      # ", " ({is a: event})\n      ## Meta\n      event target: {event target: ", "}\n      event template: {event template: ", "}\n      event type: {event type: ", "}\n\n      ## State\n    "], _a.raw = ["\n      # ", " ({is a: event})\n      ## Meta\n      event target: {event target: ", "}\n      event template: {event template: ", "}\n      event type: {event type: ", "}\n\n      ## State\n    "], utils_1.unpad(6)(_a, eventName, elem.id, template, eventName));
        if (state["*event*"]) {
            for (var prop in state["*event*"])
                content += prop + ": {" + prop + ": " + eventProps[state["*event*"][prop]] + "}\n";
        }
        for (var prop in state) {
            if (prop === "*event*")
                continue;
            content += prop + ": {" + prop + ": " + state[prop] + "}\n";
        }
        var changeset = this.ixer.diff();
        var raw = utils_1.uuid();
        var entity = eventName + " event " + raw.slice(-12);
        changeset.add("builtin entity", { entity: entity, content: content });
        this.ixer.applyDiff(changeset);
        console.log(entity);
        var _a;
    };
    UIRenderer.prototype.getEventState = function (template, event, bindingStack) {
        var state = {};
        var staticAttrs = this.ixer.find("ui event state", { "ui event state: template": template, "ui event state: event": event });
        for (var _i = 0; _i < staticAttrs.length; _i++) {
            var _a = staticAttrs[_i], key = _a["ui event state: key"], val = _a["ui event state: value"];
            state[key] = val;
        }
        var boundAttrs = this.ixer.find("ui event state binding", { "ui event state binding: template": template, "ui event state binding: event": event });
        for (var _b = 0; _b < boundAttrs.length; _b++) {
            var _c = boundAttrs[_b], key = _c["ui event state binding: key"], source = _c["ui event state binding: source"], alias = _c["ui event state binding: alias"];
            if (source === "*event*") {
                state["*event*"] = state["*event*"] || {};
                state["*event*"][key] = alias;
            }
            else {
                state[key] = this.getBoundValue(source, alias, bindingStack);
            }
        }
        return state;
    };
    return UIRenderer;
})();
exports.UIRenderer = UIRenderer;
if (this.window)
    window["uiRenderer"] = exports;

},{"./runtime":4,"./utils":6}],6:[function(require,module,exports){
var uuid_1 = require("../vendor/uuid");
exports.uuid = uuid_1.v4;
exports.ENV = "browser";
try {
    window;
}
catch (err) {
    exports.ENV = "node";
}
exports.DEBUG = {};
if (exports.ENV === "browser")
    window["DEBUG"] = exports.DEBUG;
exports.unpad = function (indent) {
    if (exports.unpad.memo[indent])
        return exports.unpad.memo[indent];
    return exports.unpad.memo[indent] = function (strings) {
        var values = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            values[_i - 1] = arguments[_i];
        }
        if (!strings.length)
            return;
        var res = "";
        var ix = 0;
        for (var _a = 0; _a < strings.length; _a++) {
            var str = strings[_a];
            res += str + (values.length > ix ? values[ix++] : "");
        }
        if (res[0] === "\n")
            res = res.slice(1);
        var charIx = 0;
        while (true) {
            res = res.slice(0, charIx) + res.slice(charIx + indent);
            charIx = res.indexOf("\n", charIx) + 1;
            if (!charIx)
                break;
        }
        return res;
    };
};
exports.unpad.memo = {};
function repeat(str, length) {
    var len = length / str.length;
    var res = "";
    for (var ix = 0; ix < len; ix++)
        res += str;
    return (res.length > length) ? res.slice(0, length) : res;
}
exports.repeat = repeat;
function underline(startIx, length) {
    return repeat(" ", startIx) + "^" + repeat("~", length - 1);
}
exports.underline = underline;
function capitalize(word) {
    return word[0].toUpperCase() + word.slice(1);
}
exports.capitalize = capitalize;
function titlecase(name) {
    return name.split(" ").map(capitalize).join(" ");
}
exports.titlecase = titlecase;
exports.string = {
    unpad: exports.unpad,
    repeat: repeat,
    underline: underline,
    capitalize: capitalize,
    titlecase: titlecase
};
function tail(arr) {
    return arr[arr.length - 1];
}
exports.tail = tail;
exports.array = {
    tail: tail
};
function coerceInput(input) {
    // http://jsperf.com/regex-vs-plus-coercion
    if (!isNaN(+input))
        return +input;
    else if (input === "true")
        return true;
    else if (input === "false")
        return false;
    return input;
}
exports.coerceInput = coerceInput;
// Shallow copy the given object.
function copy(obj) {
    if (!obj || typeof obj !== "object")
        return obj;
    if (obj instanceof Array)
        return obj.slice();
    var res = {};
    for (var key in obj)
        res[key] = obj[key];
    return res;
}
exports.copy = copy;

},{"../vendor/uuid":10}],7:[function(require,module,exports){
var app = require("../src/app");
var richTextEditor_1 = require("../src/richTextEditor");
function embedQuery(query) {
    var span = document.createElement("span");
    span.textContent = "Exec " + query;
    span.classList.add("link");
    return span;
}
function replaceInlineAttribute(query) {
    return "{" + uuid() + "}";
}
function removeAttribute(sourceId) {
}
function CMSearchBox2(node, elem) {
    var editor = node.editor;
    var cm;
    if (!editor) {
        node.editor = new richTextEditor_1.RichTextEditor(node, embedQuery, replaceInlineAttribute, removeAttribute);
        cm = node.editor.cmInstance;
        cm.focus();
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value || "");
    }
    cm.refresh();
    cm.getWrapperElement().setAttribute("style", "flex: 1; font-family: 'Helvetica Neue'; font-weight:400; ");
}
var testText2 = "# Engineering\n\nEngineering is a {department} at {Kodowa} and stuff.\n";
function root() {
    return { id: "root", style: "flex: 1; background: #666; align-items: stretch;", children: [
            { t: "style", text: "\n      .link { color: #00F; border-bottom:1px solid #00f; }\n      .bold { font-weight: bold; }\n      .italic { font-style: italic; }\n      .CodeMirror .header { font-size:20pt; }\n      .header-padding { height:20px; }\n      .placeholder { color: #bbb; position:absolute; pointer-events:none; }\n    " },
            { style: " background: #fff; padding:10px 10px; margin: 100px auto; width: 800px; flex: 1;", postRender: CMSearchBox2, value: testText2 },
        ] };
}
app.renderRoots["richEditorTest"] = root;

},{"../src/app":1,"../src/richTextEditor":3}],8:[function(require,module,exports){

},{}],9:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],10:[function(require,module,exports){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

(function() {
  var _global = this;

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng;

  // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
  //
  // Moderately fast, high quality
  if (typeof(_global.require) == 'function') {
    try {
      var _rb = _global.require('crypto').randomBytes;
      _rng = _rb && function() {return _rb(16);};
    } catch(e) {}
  }

  if (!_rng && _global.crypto && crypto.getRandomValues) {
    // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
    //
    // Moderately fast, high quality
    var _rnds8 = new Uint8Array(16);
    _rng = function whatwgRNG() {
      crypto.getRandomValues(_rnds8);
      return _rnds8;
    };
  }

  if (!_rng) {
    // Math.random()-based (RNG)
    //
    // If all else fails, use Math.random().  It's fast, but is of unspecified
    // quality.
    var  _rnds = new Array(16);
    _rng = function() {
      for (var i = 0, r; i < 16; i++) {
        if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
      }

      return _rnds;
    };
  }

  // Buffer class to use
  var BufferClass = typeof(_global.Buffer) == 'function' ? _global.Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = options.clockseq != null ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = options.msecs != null ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = options.nsecs != null ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) == 'string') {
      buf = options == 'binary' ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;

  if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define(function() {return uuid;});
  } else if (typeof(module) != 'undefined' && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else {
    // Publish as global (in browsers)
    var _previousRoot = _global.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _global.uuid = _previousRoot;
      return uuid;
    };

    _global.uuid = uuid;
  }
}).call(this);

},{}]},{},[7,8,9])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy93YXRjaGlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwic3JjL2FwcC50cyIsInNyYy9taWNyb1JlYWN0LnRzIiwic3JjL3JpY2hUZXh0RWRpdG9yLnRzIiwic3JjL3J1bnRpbWUudHMiLCJzcmMvdWlSZW5kZXJlci50cyIsInNyYy91dGlscy50cyIsInRlc3QvcmljaFRleHRFZGl0b3IudHMiLCJ0eXBpbmdzL2NvZGVtaXJyb3IvY29kZW1pcnJvci5kLnRzIiwidmVuZG9yL3V1aWQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQSxzQ0FBc0M7QUFDdEMsOENBQThDO0FBQzlDLElBQVksVUFBVSxXQUFNLGNBQWMsQ0FBQyxDQUFBO0FBQzNDLElBQVksT0FBTyxXQUFNLFdBQVcsQ0FBQyxDQUFBO0FBQ3JDLDJCQUF5QixjQUFjLENBQUMsQ0FBQTtBQUN4QyxzQkFBK0IsU0FBUyxDQUFDLENBQUE7QUFHOUIsb0JBQVksR0FBRyxDQUFDLFlBQVksRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxnQkFBZ0IsRUFBRSx5QkFBeUIsRUFBRSx1QkFBdUIsRUFBRSxzQkFBc0IsRUFBRSx1QkFBdUIsRUFBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0FBQzVOLDBCQUFrQixHQUFHLEtBQUssQ0FBQztBQUV0QywyREFBMkQ7QUFDM0QsV0FBVztBQUNYLDJEQUEyRDtBQUUzRCxJQUFJLFNBQVMsQ0FBQztBQUNkLElBQUksV0FBVyxDQUFDO0FBQ2hCLElBQUksVUFBVSxHQUFHLENBQUMsQ0FBQztBQUduQjtJQUNFLGdCQUFRLEdBQUcsSUFBSSxVQUFVLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDckMsa0JBQVUsR0FBRyxJQUFJLHVCQUFVLENBQUMsV0FBRyxDQUFDLENBQUM7SUFDakMsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLENB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QUFNLENBQUMsQ0FBQztnQkFDOUUsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLFdBQVcsS0FBSyxJQUFJLENBQUMsV0FBVyxDQUFDO29CQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUM7Z0JBQ25HLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQztvQkFBQyxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUMxRCxFQUFFLENBQUEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUM7b0JBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDOUQsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDO29CQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQzNELEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQztvQkFBQyxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUMxRCxFQUFFLENBQUEsQ0FBQyxHQUFHLENBQUMsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDL0QsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLEVBQUUsS0FBSyxJQUFJLENBQUMsRUFBRSxDQUFDO29CQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMs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U0FBUyxDQUFDO1lBQzlHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFBQyxHQUFHLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxXQUFXLEtBQUssSUFBSSxDQUFDLFdBQVcsQ0FBQztnQkFBQyxHQUFHLENBQUMsYUFBYSxHQUFHLEdBQUcsQ0FBQyxXQUFXLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzFILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQztnQkFBQyxHQUFHLENBQUMsU0FBUyxHQUFHLEdBQUcsQ0FBQyxPQUFPLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzFHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLFFBQVEsQ0FBQztnQkFBQyxHQUFHLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxRQUFRLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLFVBQVUsQ0FBQztnQkFBQyxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsQ0FBQyxVQUFVLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ3RILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLFVBQVUsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxVQUFVLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ3JILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLFFBQVEsQ0FBQztnQkFBQyxHQUFHLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxRQUFRLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQztnQkFBQyxHQUFHLENBQUMsU0FBUyxHQUFHLEdBQUcsQ0FBQyxPQUFPLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzFHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQztnQkFBQyxHQUFHLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlGLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQztnQkFBQyxHQUFHLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlGLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEtBQUssSUFBSSxDQUFDLE1BQU0sQ0FBQztnQkFBQyxHQUFHLENBQUMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxNQUFNLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ3RHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFBQyxHQUFHLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQztnQkFBQyxHQUFHLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlGLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFBQyxHQUFHLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEtBQUssSUFB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R0FBRyxJQUFJLENBQUM7OztBQ3pEekM7Ozs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8vIDxyZWZlcmVuY2UgcGF0aD1cIm1pY3JvUmVhY3QudHNcIiAvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4uL3ZlbmRvci9tYXJrZWQuZC50c1wiIC8+XG5pbXBvcnQgKiBhcyBtaWNyb1JlYWN0IGZyb20gXCIuL21pY3JvUmVhY3RcIjtcbmltcG9ydCAqIGFzIHJ1bnRpbWUgZnJvbSBcIi4vcnVudGltZVwiO1xuaW1wb3J0IHtVSVJlbmRlcmVyfSBmcm9tIFwiLi91aVJlbmRlcmVyXCI7XG5pbXBvcnQge0VOViwgREVCVUcsIHV1aWR9IGZyb20gXCIuL3V0aWxzXCI7XG5cblxuZXhwb3J0IHZhciBzeW5jZWRUYWJsZXMgPSBbXCJtYW51YWwgZWF2XCIsIFwidmlld1wiLCBcImFjdGlvblwiLCBcImFjdGlvbiBzb3VyY2VcIiwgXCJhY3Rpb24gbWFwcGluZ1wiLCBcImFjdGlvbiBtYXBwaW5nIGNvbnN0YW50XCIsIFwiYWN0aW9uIG1hcHBpbmcgc29ydGVkXCIsIFwiYWN0aW9uIG1hcHBpbmcgbGltaXRcIiwgXCJhZGQgY29sbGVjdGlvbiBhY3Rpb25cIiwgXCJhZGQgZWF2IGFjdGlvblwiLCBcImFkZCBiaXQgYWN0aW9uXCJdO1xuZXhwb3J0IHZhciBldmVMb2NhbFN0b3JhZ2VLZXkgPSBcImV2ZVwiO1xuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyZXJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnZhciBwZXJmU3RhdHM7XG52YXIgcGVyZlN0YXRzVWk7XG52YXIgdXBkYXRlU3RhdCA9IDA7XG5leHBvcnQgdmFyIHJlbmRlcmVyO1xuZXhwb3J0IHZhciB1aVJlbmRlcmVyO1xuZnVuY3Rpb24gaW5pdFJlbmRlcmVyKCkge1xuICByZW5kZXJlciA9IG5ldyBtaWNyb1JlYWN0LlJlbmRlcmVyKCk7XG4gIHVpUmVuZGVyZXIgPSBuZXcgVUlSZW5kZXJlcihldmUpO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHJlbmRlcmVyLmNvbnRlbnQpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInJlc2l6ZVwiLCByZW5kZXIpO1xuICBwZXJmU3RhdHNVaSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHBlcmZTdGF0c1VpLmlkID0gXCJwZXJmU3RhdHNcIjtcbiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChwZXJmU3RhdHNVaSk7XG59XG5cbmlmKEVOViA9PT0gXCJicm93c2VyXCIpIHZhciBwZXJmb3JtYW5jZSA9IHdpbmRvd1tcInBlcmZvcm1hbmNlXCJdIHx8IHsgbm93OiAoKSA9PiAobmV3IERhdGUoKSkuZ2V0VGltZSgpIH1cblxuZXhwb3J0IHZhciByZW5kZXJSb290cyA9IHt9O1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlcigpIHtcbiAgaWYoIXJlbmRlcmVyIHx8IHJlbmRlcmVyLnF1ZXVlZCkgcmV0dXJuO1xuICByZW5kZXJlci5xdWV1ZWQgPSB0cnVlO1xuICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnVuY3Rpb24oKSB7XG4gICAgbGV0IHN0YXRzOmFueSA9IHt9O1xuICAgIGxldCBzdGFydCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuXG4gICAgbGV0IHRyZWVzID0gW107XG4gICAgZm9yICh2YXIgcm9vdCBpbiByZW5kZXJSb290cykge1xuICAgICAgdHJlZXMucHVzaChyZW5kZXJSb290c1tyb290XSgpKTtcbiAgICB9XG5cbiAgICBzdGF0cy5yb290ID0gKHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnQpLnRvRml4ZWQoMik7XG4gICAgaWYgKCtzdGF0cy5yb290ID4gMTApIGNvbnNvbGUuaW5mbyhcIlNsb3cgcm9vdDogXCIgKyBzdGF0cy5yb290KTtcblxuICAgIHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgbGV0IGR5bmFtaWNVSSA9IGV2ZS5maW5kKFwic3lzdGVtIHVpXCIpLm1hcCgodWkpID0+IHVpW1widGVtcGxhdGVcIl0pO1xuICAgIGlmKERFQlVHICYmIERFQlVHLlVJX0NPTVBJTEUpIHtcbiAgICAgIGNvbnNvbGUuaW5mbyhcImNvbXBpbGluZ1wiLCBkeW5hbWljVUkpO1xuICAgICAgY29uc29sZS5pbmZvKFwiKlwiLCB1aVJlbmRlcmVyLmNvbXBpbGUoZHluYW1pY1VJKSk7XG4gICAgfVxuICAgIHRyZWVzLnB1c2guYXBwbHkodHJlZXMsIHVpUmVuZGVyZXIuY29tcGlsZShkeW5hbWljVUkpKTtcbiAgICBzdGF0cy51aUNvbXBpbGUgPSAocGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydCkudG9GaXhlZCgyKTtcbiAgICBpZiAoK3N0YXRzLnVpQ29tcGlsZSA+IDEwKSBjb25zb2xlLmluZm8oXCJTbG93IHVpIGNvbXBpbGU6IFwiICsgc3RhdHMudWlDb21waWxlKTtcblxuICAgIHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgcmVuZGVyZXIucmVuZGVyKHRyZWVzKTtcbiAgICBzdGF0cy5yZW5kZXIgPSAocGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydCkudG9GaXhlZCgyKTtcbiAgICBzdGF0cy51cGRhdGUgPSB1cGRhdGVTdGF0LnRvRml4ZWQoMik7XG5cbiAgICBwZXJmU3RhdHNVaS50ZXh0Q29udGVudCA9IFwiXCI7XG4gICAgcGVyZlN0YXRzVWkudGV4dENvbnRlbnQgKz0gYHJvb3Q6ICR7c3RhdHMucm9vdH1gO1xuICAgIHBlcmZTdGF0c1VpLnRleHRDb250ZW50ICs9IGAgfCB1aSBjb21waWxlOiAke3N0YXRzLnVpQ29tcGlsZX1gO1xuICAgIHBlcmZTdGF0c1VpLnRleHRDb250ZW50ICs9IGAgfCByZW5kZXI6ICR7c3RhdHMucmVuZGVyfWA7XG4gICAgcGVyZlN0YXRzVWkudGV4dENvbnRlbnQgKz0gYCB8IHVwZGF0ZTogJHtzdGF0cy51cGRhdGV9YDtcbiAgICBwZXJmU3RhdHMgPSBzdGF0cztcblxuICAgIHJlbmRlcmVyLnF1ZXVlZCA9IGZhbHNlO1xuICB9KTtcbn1cblxudmFyIHN0b3JlUXVldWVkID0gZmFsc2U7XG5mdW5jdGlvbiBzdG9yZUxvY2FsbHkoKSB7XG4gIGlmKHN0b3JlUXVldWVkKSByZXR1cm47XG4gIHN0b3JlUXVldWVkID0gdHJ1ZTtcbiAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgbGV0IHNlcmlhbGl6ZWQgPSBldmUuc2VyaWFsaXplKHRydWUpO1xuICAgIGlmIChldmVMb2NhbFN0b3JhZ2VLZXkgPT09IFwiZXZlXCIpIHtcbiAgICAgIGZvciAobGV0IHN5bmNlZCBvZiBzeW5jZWRUYWJsZXMpIHtcbiAgICAgICAgZGVsZXRlIHNlcmlhbGl6ZWRbc3luY2VkXTtcbiAgICAgIH1cbiAgICB9XG4gICAgZGVsZXRlIHNlcmlhbGl6ZWRbXCJwcm92ZW5hbmNlXCJdO1xuICAgIGxvY2FsU3RvcmFnZVtldmVMb2NhbFN0b3JhZ2VLZXldID0gSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZCk7XG4gICAgc3RvcmVRdWV1ZWQgPSBmYWxzZTtcbiAgfSwgMTAwMCk7XG59XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEaXNwYXRjaFxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxubGV0IGRpc3BhdGNoZXMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGhhbmRsZShldmVudCwgZnVuYykge1xuICBpZiAoZGlzcGF0Y2hlc1tldmVudF0pIHtcbiAgICBjb25zb2xlLmVycm9yKGBPdmVyd3JpdGluZyBoYW5kbGVyIGZvciAnJHtldmVudH0nYCk7XG4gIH1cbiAgZGlzcGF0Y2hlc1tldmVudF0gPSBmdW5jO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGlzcGF0Y2goZXZlbnQ6IHN0cmluZywgaW5mbz86IHsgW2tleTogc3RyaW5nXTogYW55IH0sIGRpc3BhdGNoSW5mbz8pIHtcbiAgbGV0IHJlc3VsdCA9IGRpc3BhdGNoSW5mbztcbiAgaWYgKCFyZXN1bHQpIHtcbiAgICByZXN1bHQgPSBldmUuZGlmZigpO1xuICAgIHJlc3VsdC5tZXRhLnJlbmRlciA9IHRydWU7XG4gICAgcmVzdWx0Lm1ldGEuc3RvcmUgPSB0cnVlO1xuICB9XG4gIHJlc3VsdC5kaXNwYXRjaCA9IChldmVudCwgaW5mbykgPT4ge1xuICAgIHJldHVybiBkaXNwYXRjaChldmVudCwgaW5mbywgcmVzdWx0KTtcbiAgfTtcbiAgcmVzdWx0LmNvbW1pdCA9ICgpID0+IHtcbiAgICB2YXIgc3RhcnQgPSBwZXJmb3JtYW5jZS5ub3coKTtcbiAgICAvLyByZXN1bHQucmVtb3ZlKFwiYnVpbHRpbiBlbnRpdHlcIiwge2VudGl0eTogXCJyZW5kZXIgcGVyZm9ybWFuY2Ugc3RhdGlzdGljc1wifSk7XG4gICAgLy8gcmVzdWx0LmFkZChcImJ1aWx0aW4gZW50aXR5XCIsIHtlbnRpdHk6IFwicmVuZGVyIHBlcmZvcm1hbmNlIHN0YXRpc3RpY3NcIiwgY29udGVudDogYFxuICAgIC8vICMgUmVuZGVyIHBlcmZvcm1hbmNlIHN0YXRpc3RpY3MgKHtpcyBhOiBzeXN0ZW19KVxuICAgIC8vIHJvb3Q6IHtyb290OiAke3BlcmZTdGF0cy5yb290fX1cbiAgICAvLyB1aSBjb21waWxlOiB7dWkgY29tcGlsZTogJHtwZXJmU3RhdHMudWlDb21waWxlfX1cbiAgICAvLyByZW5kZXI6IHtyZW5kZXI6ICR7cGVyZlN0YXRzLnJlbmRlcn19XG4gICAgLy8gdXBkYXRlOiB7dXBkYXRlOiAke3BlcmZTdGF0cy51cGRhdGV9fVxuICAgIC8vIEhvcnJpYmxlIGhhY2ssIGRpc3JlZ2FyZCB0aGlzOiB7cGVyZiBzdGF0czogcmVuZGVyIHBlcmZvcm1hbmNlIHN0YXRpc3RpY3N9XG4gICAgLy8gYH0pO1xuICAgIGlmKCFydW50aW1lLklOQ1JFTUVOVEFMKSB7XG4gICAgICBldmUuYXBwbHlEaWZmKHJlc3VsdCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGV2ZS5hcHBseURpZmZJbmNyZW1lbnRhbChyZXN1bHQpO1xuICAgIH1cbiAgICBpZiAocmVzdWx0Lm1ldGEucmVuZGVyKSB7XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gICAgaWYgKHJlc3VsdC5tZXRhLnN0b3JlKSB7XG4gICAgICBzdG9yZUxvY2FsbHkoKTtcbiAgICAgIGlmIChldmVMb2NhbFN0b3JhZ2VLZXkgPT09IFwiZXZlXCIpIHtcbiAgICAgICAgc2VuZENoYW5nZVNldChyZXN1bHQpO1xuICAgICAgfVxuICAgIH1cbiAgICB1cGRhdGVTdGF0ID0gcGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydDtcbiAgfVxuICBsZXQgZnVuYyA9IGRpc3BhdGNoZXNbZXZlbnRdO1xuICBpZiAoIWZ1bmMpIHtcbiAgICBjb25zb2xlLmVycm9yKGBObyBkaXNwYXRjaGVzIGZvciAnJHtldmVudH0nIHdpdGggJHtKU09OLnN0cmluZ2lmeShpbmZvKSB9YCk7XG4gIH0gZWxzZSB7XG4gICAgZnVuYyhyZXN1bHQsIGluZm8pO1xuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFN0YXRlXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdmFyIGV2ZSA9IHJ1bnRpbWUuaW5kZXhlcigpO1xuZXhwb3J0IHZhciBpbml0aWFsaXplcnMgPSB7fTtcbmV4cG9ydCB2YXIgYWN0aXZlU2VhcmNoZXMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQobmFtZSwgZnVuYykge1xuICBpbml0aWFsaXplcnNbbmFtZV0gPSBmdW5jO1xufVxuXG5mdW5jdGlvbiBleGVjdXRlSW5pdGlhbGl6ZXJzKCkge1xuICBmb3IgKGxldCBpbml0TmFtZSBpbiBpbml0aWFsaXplcnMpIHtcbiAgICBpbml0aWFsaXplcnNbaW5pdE5hbWVdKCk7XG4gIH1cbn1cblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFdlYnNvY2tldFxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudmFyIG1lID0gdXVpZCgpO1xuaWYodGhpcy5sb2NhbFN0b3JhZ2UpIHtcbiAgaWYobG9jYWxTdG9yYWdlW1wibWVcIl0pIG1lID0gbG9jYWxTdG9yYWdlW1wibWVcIl07XG4gIGVsc2UgbG9jYWxTdG9yYWdlW1wibWVcIl0gPSBtZTtcbn1cblxuZXhwb3J0IHZhciBzb2NrZXQ7XG5mdW5jdGlvbiBjb25uZWN0VG9TZXJ2ZXIoKSB7XG4gIHNvY2tldCA9IG5ldyBXZWJTb2NrZXQoYHdzOi8vJHt3aW5kb3cubG9jYXRpb24uaG9zdG5hbWUgfHwgXCJsb2NhbGhvc3RcIn06ODA4MGApO1xuICBzb2NrZXQub25lcnJvciA9ICgpID0+IHtcbiAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIGNvbm5lY3QgdG8gc2VydmVyLCBmYWxsaW5nIGJhY2sgdG8gbG9jYWwgc3RvcmFnZVwiKTtcbiAgICBldmVMb2NhbFN0b3JhZ2VLZXkgPSBcImxvY2FsLWV2ZVwiO1xuICAgIGV4ZWN1dGVJbml0aWFsaXplcnMoKTtcbiAgICByZW5kZXIoKTtcbiAgfVxuICBzb2NrZXQub25vcGVuID0gKCkgPT4ge1xuICAgIHNlbmRTZXJ2ZXIoXCJjb25uZWN0XCIsIG1lKTtcbiAgfVxuICBzb2NrZXQub25tZXNzYWdlID0gKGRhdGEpID0+IHtcbiAgICBsZXQgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhLmRhdGEpO1xuICAgIGNvbnNvbGUubG9nKFwiV1MgTUVTU0FHRTpcIiwgcGFyc2VkKTtcblxuICAgIGlmIChwYXJzZWQua2luZCA9PT0gXCJsb2FkXCIpIHtcbiAgICAgIGV2ZS5sb2FkKHBhcnNlZC5kYXRhKTtcbiAgICAgIGV4ZWN1dGVJbml0aWFsaXplcnMoKTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH0gZWxzZSBpZiAocGFyc2VkLmtpbmQgPT09IFwiY2hhbmdlc2V0XCIpIHtcbiAgICAgIGxldCBkaWZmID0gZXZlLmRpZmYoKTtcbiAgICAgIGRpZmYudGFibGVzID0gcGFyc2VkLmRhdGE7XG4gICAgICBldmUuYXBwbHlEaWZmKGRpZmYpO1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICB9O1xufVxuXG5mdW5jdGlvbiBzZW5kU2VydmVyKG1lc3NhZ2VLaW5kLCBkYXRhKSB7XG4gIGlmICghc29ja2V0KSByZXR1cm47XG4gIHNvY2tldC5zZW5kKEpTT04uc3RyaW5naWZ5KHsga2luZDogbWVzc2FnZUtpbmQsIG1lLCB0aW1lOiAobmV3IERhdGUpLmdldFRpbWUoKSwgZGF0YSB9KSk7XG59XG5cbmZ1bmN0aW9uIHNlbmRDaGFuZ2VTZXQoY2hhbmdlc2V0KSB7XG4gIGlmICghc29ja2V0KSByZXR1cm47XG4gIGxldCBjaGFuZ2VzID0ge307XG4gIGxldCBzZW5kID0gZmFsc2U7XG4gIGZvciAobGV0IHRhYmxlIG9mIHN5bmNlZFRhYmxlcykge1xuICAgIGlmIChjaGFuZ2VzZXQudGFibGVzW3RhYmxlXSkge1xuICAgICAgc2VuZCA9IHRydWU7XG4gICAgICBjaGFuZ2VzW3RhYmxlXSA9IGNoYW5nZXNldC50YWJsZXNbdGFibGVdO1xuICAgIH1cbiAgfVxuICBpZiAoc2VuZCkgc2VuZFNlcnZlcihcImNoYW5nZXNldFwiLCBjaGFuZ2VzKTtcbn1cblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdvXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuaWYoRU5WID09PSBcImJyb3dzZXJcIikge1xuICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwiRE9NQ29udGVudExvYWRlZFwiLCBmdW5jdGlvbihldmVudCkge1xuICAgIGluaXRSZW5kZXJlcigpO1xuICAgIGNvbm5lY3RUb1NlcnZlcigpO1xuICAgIHJlbmRlcigpO1xuICB9KTtcbn1cblxuaW5pdChcImxvYWQgZGF0YVwiLGZ1bmN0aW9uKCkge1xuICBsZXQgc3RvcmVkID0gbG9jYWxTdG9yYWdlW2V2ZUxvY2FsU3RvcmFnZUtleV07XG4gIGlmKHN0b3JlZCkge1xuICAgIGV2ZS5sb2FkKHN0b3JlZCk7XG4gIH1cbn0pO1xuXG5kZWNsYXJlIHZhciBleHBvcnRzO1xuaWYoRU5WID09PSBcImJyb3dzZXJcIikgd2luZG93W1wiYXBwXCJdID0gZXhwb3J0czsiLCJkZWNsYXJlIHZhciBWZWxvY2l0eTtcblxuZXhwb3J0IGludGVyZmFjZSBIYW5kbGVyPFQgZXh0ZW5kcyBFdmVudD4ge1xuICAoZXZ0OlQsIGVsZW06RWxlbWVudCk6IHZvaWRcbn1cbmV4cG9ydCBpbnRlcmZhY2UgUmVuZGVySGFuZGxlciB7XG4gIChub2RlOkhUTUxFbGVtZW50LCBlbGVtOkVsZW1lbnQpOiB2b2lkXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRWxlbWVudCB7XG4gIHQ/OnN0cmluZ1xuICBjPzpzdHJpbmdcbiAgaWQ/OnN0cmluZ1xuICBwYXJlbnQ/OnN0cmluZ1xuICBjaGlsZHJlbj86RWxlbWVudFtdXG4gIGl4PzpudW1iZXJcbiAga2V5PzpzdHJpbmdcbiAgZGlydHk/OmJvb2xlYW5cbiAgc2VtYW50aWM/OnN0cmluZ1xuICB0d2Vlbj86IGFueVxuICBlbnRlcj86IGFueVxuICBsZWF2ZT86IGFueVxuICBkZWJ1Zz86YW55XG5cbiAgLy8gQ29udGVudFxuICBjb250ZW50RWRpdGFibGU/OmJvb2xlYW5cbiAgY2hlY2tlZD86Ym9vbGVhblxuICBkcmFnZ2FibGU/OmJvb2xlYW5cbiAgaHJlZj86c3RyaW5nXG4gIHBsYWNlaG9sZGVyPzpzdHJpbmdcbiAgc2VsZWN0ZWQ/OmJvb2xlYW5cbiAgdGFiaW5kZXg/Om51bWJlclxuICB0ZXh0PzpzdHJpbmdcbiAgc3RyaWN0VGV4dD86IGJvb2xlYW5cbiAgdHlwZT86c3RyaW5nXG4gIHZhbHVlPzpzdHJpbmdcbiAgZGFuZ2Vyb3VzbHlTZXRJbm5lckhUTUw/OnN0cmluZ1xuXG4gIHN0eWxlPzogc3RyaW5nLFxuXG4gIC8vIFN0eWxlcyAoU3RydWN0dXJlKVxuICBmbGV4PzpudW1iZXJ8c3RyaW5nXG4gIGxlZnQ/Om51bWJlcnxzdHJpbmdcbiAgdG9wPzpudW1iZXJ8c3RyaW5nXG4gIHdpZHRoPzpudW1iZXJ8c3RyaW5nXG4gIGhlaWdodD86bnVtYmVyfHN0cmluZ1xuICB0ZXh0QWxpZ24/OnN0cmluZ1xuICB0cmFuc2Zvcm0/OnN0cmluZ1xuICB2ZXJ0aWNhbEFsaWduPzpzdHJpbmdcbiAgekluZGV4PzpudW1iZXJcblxuICAvLyBTdHlsZXMgKEFlc3RoZXRpYylcbiAgYmFja2dyb3VuZENvbG9yPzpzdHJpbmdcbiAgYmFja2dyb3VuZEltYWdlPzpzdHJpbmdcbiAgYm9yZGVyPzpzdHJpbmdcbiAgYm9yZGVyQ29sb3I/OnN0cmluZ1xuICBib3JkZXJXaWR0aD86bnVtYmVyfHN0cmluZ1xuICBib3JkZXJSYWRpdXM/Om51bWJlcnxzdHJpbmdcbiAgY29sb3I/OnN0cmluZ1xuICBjb2xzcGFuPzpudW1iZXJcbiAgZm9udEZhbWlseT86c3RyaW5nXG4gIGZvbnRTaXplPzpzdHJpbmdcbiAgb3BhY2l0eT86bnVtYmVyXG5cbiAgLy8gU3ZnXG4gIHN2Zz86Ym9vbGVhblxuICB4PzpudW1iZXJ8c3RyaW5nXG4gIHk/Om51bWJlcnxzdHJpbmdcbiAgZHg/Om51bWJlcnxzdHJpbmdcbiAgZHk/Om51bWJlcnxzdHJpbmdcbiAgY3g/Om51bWJlcnxzdHJpbmdcbiAgY3k/Om51bWJlcnxzdHJpbmdcbiAgcj86bnVtYmVyfHN0cmluZ1xuICBkPzpudW1iZXJ8c3RyaW5nXG4gIGZpbGw/OnN0cmluZ1xuICBzdHJva2U/OnN0cmluZ1xuICBzdHJva2VXaWR0aD86c3RyaW5nXG4gIHN0YXJ0T2Zmc2V0PzpudW1iZXJ8c3RyaW5nXG4gIHRleHRBbmNob3I/OnN0cmluZ1xuICB2aWV3Qm94PzpzdHJpbmdcbiAgeGxpbmtocmVmPzpzdHJpbmdcblxuICAvLyBFdmVudHNcbiAgZGJsY2xpY2s/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgY2xpY2s/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgY29udGV4dG1lbnU/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgbW91c2Vkb3duPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIG1vdXNlbW92ZT86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBtb3VzZXVwPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIG1vdXNlb3Zlcj86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBtb3VzZW91dD86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBtb3VzZWxlYXZlPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIG1vdXNld2hlZWw/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgZHJhZ292ZXI/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgZHJhZ3N0YXJ0PzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIGRyYWdlbmQ/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgZHJhZz86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBkcm9wPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIHNjcm9sbD86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBmb2N1cz86SGFuZGxlcjxGb2N1c0V2ZW50PlxuICBibHVyPzpIYW5kbGVyPEZvY3VzRXZlbnQ+XG4gIGlucHV0PzpIYW5kbGVyPEV2ZW50PlxuICBjaGFuZ2U/OkhhbmRsZXI8RXZlbnQ+XG4gIGtleXVwPzpIYW5kbGVyPEtleWJvYXJkRXZlbnQ+XG4gIGtleWRvd24/OkhhbmRsZXI8S2V5Ym9hcmRFdmVudD5cblxuICBwb3N0UmVuZGVyPzpSZW5kZXJIYW5kbGVyXG5cbiAgW2F0dHI6c3RyaW5nXTogYW55XG59XG5cbmZ1bmN0aW9uIG5vdygpIHtcbiAgaWYod2luZG93LnBlcmZvcm1hbmNlKSB7XG4gICAgcmV0dXJuIHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKTtcbiAgfVxuICByZXR1cm4gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcbn1cblxuZnVuY3Rpb24gc2hhbGxvd0VxdWFscyhhLCBiKSB7XG4gIGlmKGEgPT09IGIpIHJldHVybiB0cnVlO1xuICBpZighYSB8fCAhYikgcmV0dXJuIGZhbHNlO1xuICBmb3IodmFyIGsgaW4gYSkge1xuICAgIGlmKGFba10gIT09IGJba10pIHJldHVybiBmYWxzZTtcbiAgfVxuICBmb3IodmFyIGsgaW4gYikge1xuICAgIGlmKGJba10gIT09IGFba10pIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gcG9zdEFuaW1hdGlvblJlbW92ZShlbGVtZW50cykge1xuICBmb3IobGV0IGVsZW0gb2YgZWxlbWVudHMpIHtcbiAgICBpZihlbGVtLnBhcmVudE5vZGUpIGVsZW0ucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChlbGVtKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgUmVuZGVyZXIge1xuICBjb250ZW50OiBIVE1MRWxlbWVudDtcbiAgZWxlbWVudENhY2hlOiB7W2lkOnN0cmluZ106IEhUTUxFbGVtZW50fTtcbiAgcHJldlRyZWU6e1tpZDpzdHJpbmddOiBFbGVtZW50fTtcbiAgdHJlZTp7W2lkOnN0cmluZ106IEVsZW1lbnR9O1xuICBwb3N0UmVuZGVyczogRWxlbWVudFtdO1xuICBsYXN0RGlmZjoge2FkZHM6IHN0cmluZ1tdLCB1cGRhdGVzOiB7fX07XG4gIHF1ZXVlZDogYm9vbGVhbjtcbiAgaGFuZGxlRXZlbnQ6IChhbnkpO1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLmNvbnRlbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRoaXMuY29udGVudC5jbGFzc05hbWUgPSBcIl9fcm9vdFwiO1xuICAgIHRoaXMuZWxlbWVudENhY2hlID0geyBcIl9fcm9vdFwiOiB0aGlzLmNvbnRlbnQgfTtcbiAgICB0aGlzLnByZXZUcmVlID0ge307XG4gICAgdGhpcy50cmVlID0ge307XG4gICAgdGhpcy5wb3N0UmVuZGVycyA9IFtdO1xuICAgIHRoaXMubGFzdERpZmYgPSB7YWRkczogW10sIHVwZGF0ZXM6IHt9fTtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdGhpcy5oYW5kbGVFdmVudCA9IGZ1bmN0aW9uIGhhbmRsZUV2ZW50KGU6IEV2ZW50KSB7XG4gICAgICB2YXIgaWQgPSAoZS5jdXJyZW50VGFyZ2V0IHx8IGUudGFyZ2V0KVtcIl9pZFwiXTtcbiAgICAgIHZhciBlbGVtID0gc2VsZi50cmVlW2lkXTtcbiAgICAgIGlmICghZWxlbSkgcmV0dXJuO1xuICAgICAgdmFyIGhhbmRsZXIgPSBlbGVtW2UudHlwZV07XG4gICAgICBpZiAoaGFuZGxlcikgeyBoYW5kbGVyKGUsIGVsZW0pOyB9XG4gICAgfTtcbiAgfVxuICByZXNldCgpIHtcbiAgICB0aGlzLnByZXZUcmVlID0gdGhpcy50cmVlO1xuICAgIHRoaXMudHJlZSA9IHt9O1xuICAgIHRoaXMucG9zdFJlbmRlcnMgPSBbXTtcbiAgfVxuXG4gIGRvbWlmeSgpIHtcbiAgICB2YXIgZmFrZVByZXY6RWxlbWVudCA9IHt9OyAvL2NyZWF0ZSBhbiBlbXB0eSBvYmplY3Qgb25jZSBpbnN0ZWFkIG9mIGV2ZXJ5IGluc3RhbmNlIG9mIHRoZSBsb29wXG4gICAgdmFyIGVsZW1lbnRzID0gdGhpcy50cmVlO1xuICAgIHZhciBwcmV2RWxlbWVudHMgPSB0aGlzLnByZXZUcmVlO1xuICAgIHZhciBkaWZmID0gdGhpcy5sYXN0RGlmZjtcbiAgICB2YXIgYWRkcyA9IGRpZmYuYWRkcztcbiAgICB2YXIgdXBkYXRlcyA9IGRpZmYudXBkYXRlcztcbiAgICB2YXIgZWxlbUtleXMgPSBPYmplY3Qua2V5cyh1cGRhdGVzKTtcbiAgICB2YXIgZWxlbWVudENhY2hlID0gdGhpcy5lbGVtZW50Q2FjaGU7XG4gICAgdmFyIHRlbXBUd2VlbjphbnkgPSB7fTtcblxuICAgIC8vQ3JlYXRlIGFsbCB0aGUgbmV3IGVsZW1lbnRzIHRvIGVuc3VyZSB0aGF0IHRoZXkncmUgdGhlcmUgd2hlbiB0aGV5IG5lZWQgdG8gYmVcbiAgICAvL3BhcmVudGVkXG4gICAgZm9yKHZhciBpID0gMCwgbGVuID0gYWRkcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgdmFyIGlkID0gYWRkc1tpXTtcbiAgICAgIHZhciBjdXIgPSBlbGVtZW50c1tpZF07XG4gICAgICB2YXIgZGl2OiBhbnk7XG4gICAgICBpZiAoY3VyLnN2Zykge1xuICAgICAgICBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBjdXIudCB8fCBcInJlY3RcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KGN1ci50IHx8IFwiZGl2XCIpO1xuICAgICAgfVxuICAgICAgZGl2Ll9pZCA9IGlkO1xuICAgICAgZWxlbWVudENhY2hlW2lkXSA9IGRpdjtcbiAgICAgIGlmKGN1ci5lbnRlcikge1xuICAgICAgICBpZihjdXIuZW50ZXIuZGVsYXkpIHtcbiAgICAgICAgICBjdXIuZW50ZXIuZGlzcGxheSA9IFwiYXV0b1wiO1xuICAgICAgICAgIGRpdi5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgIH1cblxuICAgICAgICBWZWxvY2l0eShkaXYsIGN1ci5lbnRlciwgY3VyLmVudGVyKTtcblxuICAgICAgfVxuICAgIH1cblxuICAgIGZvcih2YXIgaSA9IDAsIGxlbiA9IGVsZW1LZXlzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB2YXIgaWQgPSBlbGVtS2V5c1tpXTtcbiAgICAgIHZhciBjdXIgPSBlbGVtZW50c1tpZF07XG4gICAgICB2YXIgcHJldiA9IHByZXZFbGVtZW50c1tpZF0gfHwgZmFrZVByZXY7XG4gICAgICB2YXIgdHlwZSA9IHVwZGF0ZXNbaWRdO1xuICAgICAgdmFyIGRpdjtcbiAgICAgIGlmKHR5cGUgPT09IFwicmVwbGFjZWRcIikge1xuICAgICAgICB2YXIgbWUgPSBlbGVtZW50Q2FjaGVbaWRdO1xuICAgICAgICBpZiAobWUucGFyZW50Tm9kZSkgbWUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChtZSk7XG4gICAgICAgIGlmIChjdXIuc3ZnKSB7XG4gICAgICAgICAgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiwgY3VyLnQgfHwgXCJyZWN0XCIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoY3VyLnQgfHwgXCJkaXZcIik7XG4gICAgICAgIH1cbiAgICAgICAgZGl2Ll9pZCA9IGlkO1xuICAgICAgICBlbGVtZW50Q2FjaGVbaWRdID0gZGl2O1xuICAgICAgfSBlbHNlIGlmICh0eXBlID09PSBcInJlbW92ZWRcIikge1xuICAgICAgICAvL05PVEU6IEJhdGNoaW5nIHRoZSByZW1vdmVzIHN1Y2ggdGhhdCB5b3Ugb25seSByZW1vdmUgdGhlIHBhcmVudFxuICAgICAgICAvL2RpZG4ndCBhY3R1YWxseSBtYWtlIHRoaXMgZmFzdGVyIHN1cnByaXNpbmdseS4gR2l2ZW4gdGhhdCB0aGlzXG4gICAgICAgIC8vc3RyYXRlZ3kgaXMgbXVjaCBzaW1wbGVyIGFuZCB0aGVyZSdzIG5vIG5vdGljYWJsZSBwZXJmIGRpZmZlcmVuY2VcbiAgICAgICAgLy93ZSdsbCBqdXN0IGRvIHRoZSBkdW1iIHRoaW5nIGFuZCByZW1vdmUgYWxsIHRoZSBjaGlsZHJlbiBvbmUgYnkgb25lLlxuICAgICAgICB2YXIgbWUgPSBlbGVtZW50Q2FjaGVbaWRdXG4gICAgICAgIGlmKHByZXYubGVhdmUpIHtcbiAgICAgICAgICBwcmV2LmxlYXZlLmNvbXBsZXRlID0gcG9zdEFuaW1hdGlvblJlbW92ZTtcbiAgICAgICAgICBpZihwcmV2LmxlYXZlLmFic29sdXRlKSB7XG4gICAgICAgICAgICBtZS5zdHlsZS5wb3NpdGlvbiA9IFwiYWJzb2x1dGVcIjtcbiAgICAgICAgICB9XG4gICAgICAgICAgVmVsb2NpdHkobWUsIHByZXYubGVhdmUsIHByZXYubGVhdmUpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYobWUucGFyZW50Tm9kZSkgbWUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChtZSk7XG4gICAgICAgIGVsZW1lbnRDYWNoZVtpZF0gPSBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpdiA9IGVsZW1lbnRDYWNoZVtpZF07XG4gICAgICB9XG5cbiAgICAgIHZhciBzdHlsZSA9IGRpdi5zdHlsZTtcbiAgICAgIGlmKGN1ci5jICE9PSBwcmV2LmMpIGRpdi5jbGFzc05hbWUgPSBjdXIuYztcbiAgICAgIGlmKGN1ci5kcmFnZ2FibGUgIT09IHByZXYuZHJhZ2dhYmxlKSBkaXYuZHJhZ2dhYmxlID0gY3VyLmRyYWdnYWJsZSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFwidHJ1ZVwiO1xuICAgICAgaWYoY3VyLmNvbnRlbnRFZGl0YWJsZSAhPT0gcHJldi5jb250ZW50RWRpdGFibGUpIGRpdi5jb250ZW50RWRpdGFibGUgPSBjdXIuY29udGVudEVkaXRhYmxlIHx8IFwiaW5oZXJpdFwiO1xuICAgICAgaWYoY3VyLmNvbHNwYW4gIT09IHByZXYuY29sc3BhbikgZGl2LmNvbFNwYW4gPSBjdXIuY29sc3BhbjtcbiAgICAgIGlmKGN1ci5wbGFjZWhvbGRlciAhPT0gcHJldi5wbGFjZWhvbGRlcikgZGl2LnBsYWNlaG9sZGVyID0gY3VyLnBsYWNlaG9sZGVyO1xuICAgICAgaWYoY3VyLnNlbGVjdGVkICE9PSBwcmV2LnNlbGVjdGVkKSBkaXYuc2VsZWN0ZWQgPSBjdXIuc2VsZWN0ZWQ7XG4gICAgICBpZihjdXIudmFsdWUgIT09IHByZXYudmFsdWUpIGRpdi52YWx1ZSA9IGN1ci52YWx1ZTtcbiAgICAgIGlmKGN1ci50ID09PSBcImlucHV0XCIgJiYgY3VyLnR5cGUgIT09IHByZXYudHlwZSkgZGl2LnR5cGUgPSBjdXIudHlwZTtcbiAgICAgIGlmKGN1ci50ID09PSBcImlucHV0XCIgJiYgY3VyLmNoZWNrZWQgIT09IHByZXYuY2hlY2tlZCkgZGl2LmNoZWNrZWQgPSBjdXIuY2hlY2tlZDtcbiAgICAgIGlmKChjdXIudGV4dCAhPT0gcHJldi50ZXh0IHx8IGN1ci5zdHJpY3RUZXh0KSAmJiBkaXYudGV4dENvbnRlbnQgIT09IGN1ci50ZXh0KSBkaXYudGV4dENvbnRlbnQgPSBjdXIudGV4dCA9PT0gdW5kZWZpbmVkID8gXCJcIiA6IGN1ci50ZXh0O1xuICAgICAgaWYoY3VyLnRhYmluZGV4ICE9PSBwcmV2LnRhYmluZGV4KSBkaXYuc2V0QXR0cmlidXRlKFwidGFiaW5kZXhcIiwgY3VyLnRhYmluZGV4KTtcbiAgICAgIGlmKGN1ci5ocmVmICE9PSBwcmV2LmhyZWYpIGRpdi5zZXRBdHRyaWJ1dGUoXCJocmVmXCIsIGN1ci5ocmVmKTtcblxuICAgICAgLy8gYW5pbWF0ZWFibGUgcHJvcGVydGllc1xuICAgICAgdmFyIHR3ZWVuID0gY3VyLnR3ZWVuIHx8IHRlbXBUd2VlbjtcbiAgICAgIGlmKGN1ci5mbGV4ICE9PSBwcmV2LmZsZXgpIHtcbiAgICAgICAgaWYodHdlZW4uZmxleCkgdGVtcFR3ZWVuLmZsZXggPSBjdXIuZmxleDtcbiAgICAgICAgZWxzZSBzdHlsZS5mbGV4ID0gY3VyLmZsZXggPT09IHVuZGVmaW5lZCA/IFwiXCIgOiBjdXIuZmxleDtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci5sZWZ0ICE9PSBwcmV2LmxlZnQpIHtcbiAgICAgICAgICBpZih0d2Vlbi5sZWZ0KSB0ZW1wVHdlZW4ubGVmdCA9IGN1ci5sZWZ0O1xuICAgICAgICAgIGVsc2Ugc3R5bGUubGVmdCA9IGN1ci5sZWZ0ID09PSB1bmRlZmluZWQgPyBcIlwiIDogY3VyLmxlZnQ7XG4gICAgICB9XG4gICAgICBpZihjdXIudG9wICE9PSBwcmV2LnRvcCkge1xuICAgICAgICBpZih0d2Vlbi50b3ApIHRlbXBUd2Vlbi50b3AgPSBjdXIudG9wO1xuICAgICAgICBlbHNlIHN0eWxlLnRvcCA9IGN1ci50b3AgPT09IHVuZGVmaW5lZCA/IFwiXCIgOiBjdXIudG9wO1xuICAgICAgfVxuICAgICAgaWYoY3VyLmhlaWdodCAhPT0gcHJldi5oZWlnaHQpIHtcbiAgICAgICAgaWYodHdlZW4uaGVpZ2h0KSB0ZW1wVHdlZW4uaGVpZ2h0ID0gY3VyLmhlaWdodDtcbiAgICAgICAgZWxzZSBzdHlsZS5oZWlnaHQgPSBjdXIuaGVpZ2h0ID09PSB1bmRlZmluZWQgPyBcImF1dG9cIiA6IGN1ci5oZWlnaHQ7XG4gICAgICB9XG4gICAgICBpZihjdXIud2lkdGggIT09IHByZXYud2lkdGgpIHtcbiAgICAgICAgaWYodHdlZW4ud2lkdGgpIHRlbXBUd2Vlbi53aWR0aCA9IGN1ci53aWR0aDtcbiAgICAgICAgZWxzZSBzdHlsZS53aWR0aCA9IGN1ci53aWR0aCA9PT0gdW5kZWZpbmVkID8gXCJhdXRvXCIgOiBjdXIud2lkdGg7XG4gICAgICB9XG4gICAgICBpZihjdXIuekluZGV4ICE9PSBwcmV2LnpJbmRleCkge1xuICAgICAgICBpZih0d2Vlbi56SW5kZXgpIHRlbXBUd2Vlbi56SW5kZXggPSBjdXIuekluZGV4O1xuICAgICAgICBlbHNlIHN0eWxlLnpJbmRleCA9IGN1ci56SW5kZXg7XG4gICAgICB9XG4gICAgICBpZihjdXIuYmFja2dyb3VuZENvbG9yICE9PSBwcmV2LmJhY2tncm91bmRDb2xvcikge1xuICAgICAgICBpZih0d2Vlbi5iYWNrZ3JvdW5kQ29sb3IpIHRlbXBUd2Vlbi5iYWNrZ3JvdW5kQ29sb3IgPSBjdXIuYmFja2dyb3VuZENvbG9yO1xuICAgICAgICBlbHNlIHN0eWxlLmJhY2tncm91bmRDb2xvciA9IGN1ci5iYWNrZ3JvdW5kQ29sb3IgfHwgXCJ0cmFuc3BhcmVudFwiO1xuICAgICAgfVxuICAgICAgaWYoY3VyLmJvcmRlckNvbG9yICE9PSBwcmV2LmJvcmRlckNvbG9yKSB7XG4gICAgICAgIGlmKHR3ZWVuLmJvcmRlckNvbG9yKSB0ZW1wVHdlZW4uYm9yZGVyQ29sb3IgPSBjdXIuYm9yZGVyQ29sb3I7XG4gICAgICAgIGVsc2Ugc3R5bGUuYm9yZGVyQ29sb3IgPSBjdXIuYm9yZGVyQ29sb3IgfHwgXCJub25lXCI7XG4gICAgICB9XG4gICAgICBpZihjdXIuYm9yZGVyV2lkdGggIT09IHByZXYuYm9yZGVyV2lkdGgpIHtcbiAgICAgICAgaWYodHdlZW4uYm9yZGVyV2lkdGgpIHRlbXBUd2Vlbi5ib3JkZXJXaWR0aCA9IGN1ci5ib3JkZXJXaWR0aDtcbiAgICAgICAgZWxzZSBzdHlsZS5ib3JkZXJXaWR0aCA9IGN1ci5ib3JkZXJXaWR0aCB8fCAwO1xuICAgICAgfVxuICAgICAgaWYoY3VyLmJvcmRlclJhZGl1cyAhPT0gcHJldi5ib3JkZXJSYWRpdXMpIHtcbiAgICAgICAgaWYodHdlZW4uYm9yZGVyUmFkaXVzKSB0ZW1wVHdlZW4uYm9yZGVyUmFkaXVzID0gY3VyLmJvcmRlclJhZGl1cztcbiAgICAgICAgZWxzZSBzdHlsZS5ib3JkZXJSYWRpdXMgPSAoY3VyLmJvcmRlclJhZGl1cyB8fCAwKSArIFwicHhcIjtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci5vcGFjaXR5ICE9PSBwcmV2Lm9wYWNpdHkpIHtcbiAgICAgICAgaWYodHdlZW4ub3BhY2l0eSkgdGVtcFR3ZWVuLm9wYWNpdHkgPSBjdXIub3BhY2l0eTtcbiAgICAgICAgZWxzZSBzdHlsZS5vcGFjaXR5ID0gY3VyLm9wYWNpdHkgPT09IHVuZGVmaW5lZCA/IDEgOiBjdXIub3BhY2l0eTtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci5mb250U2l6ZSAhPT0gcHJldi5mb250U2l6ZSkge1xuICAgICAgICBpZih0d2Vlbi5mb250U2l6ZSkgdGVtcFR3ZWVuLmZvbnRTaXplID0gY3VyLmZvbnRTaXplO1xuICAgICAgICBlbHNlIHN0eWxlLmZvbnRTaXplID0gY3VyLmZvbnRTaXplO1xuICAgICAgfVxuICAgICAgaWYoY3VyLmNvbG9yICE9PSBwcmV2LmNvbG9yKSB7XG4gICAgICAgIGlmKHR3ZWVuLmNvbG9yKSB0ZW1wVHdlZW4uY29sb3IgPSBjdXIuY29sb3I7XG4gICAgICAgIGVsc2Ugc3R5bGUuY29sb3IgPSBjdXIuY29sb3IgfHwgXCJpbmhlcml0XCI7XG4gICAgICB9XG5cbiAgICAgIGxldCBhbmltS2V5cyA9IE9iamVjdC5rZXlzKHRlbXBUd2Vlbik7XG4gICAgICBpZihhbmltS2V5cy5sZW5ndGgpIHtcbiAgICAgICAgVmVsb2NpdHkoZGl2LCB0ZW1wVHdlZW4sIHR3ZWVuKTtcbiAgICAgICAgdGVtcFR3ZWVuID0ge307XG4gICAgICB9XG5cbiAgICAgIC8vIG5vbi1hbmltYXRpb24gc3R5bGUgcHJvcGVydGllc1xuICAgICAgaWYoY3VyLmJhY2tncm91bmRJbWFnZSAhPT0gcHJldi5iYWNrZ3JvdW5kSW1hZ2UpIHN0eWxlLmJhY2tncm91bmRJbWFnZSA9IGB1cmwoJyR7Y3VyLmJhY2tncm91bmRJbWFnZX0nKWA7XG4gICAgICBpZihjdXIuYm9yZGVyICE9PSBwcmV2LmJvcmRlcikgc3R5bGUuYm9yZGVyID0gY3VyLmJvcmRlciB8fCBcIm5vbmVcIjtcbiAgICAgIGlmKGN1ci50ZXh0QWxpZ24gIT09IHByZXYudGV4dEFsaWduKSB7XG4gICAgICAgIHN0eWxlLmFsaWduSXRlbXMgPSBjdXIudGV4dEFsaWduO1xuICAgICAgICBpZihjdXIudGV4dEFsaWduID09PSBcImNlbnRlclwiKSB7XG4gICAgICAgICAgc3R5bGUudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcbiAgICAgICAgfSBlbHNlIGlmKGN1ci50ZXh0QWxpZ24gPT09IFwiZmxleC1lbmRcIikge1xuICAgICAgICAgIHN0eWxlLnRleHRBbGlnbiA9IFwicmlnaHRcIjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzdHlsZS50ZXh0QWxpZ24gPSBcImxlZnRcIjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYoY3VyLnZlcnRpY2FsQWxpZ24gIT09IHByZXYudmVydGljYWxBbGlnbikgc3R5bGUuanVzdGlmeUNvbnRlbnQgPSBjdXIudmVydGljYWxBbGlnbjtcbiAgICAgIGlmKGN1ci5mb250RmFtaWx5ICE9PSBwcmV2LmZvbnRGYW1pbHkpIHN0eWxlLmZvbnRGYW1pbHkgPSBjdXIuZm9udEZhbWlseSB8fCBcImluaGVyaXRcIjtcbiAgICAgIGlmKGN1ci50cmFuc2Zvcm0gIT09IHByZXYudHJhbnNmb3JtKSBzdHlsZS50cmFuc2Zvcm0gPSBjdXIudHJhbnNmb3JtIHx8IFwibm9uZVwiO1xuICAgICAgaWYoY3VyLnN0eWxlICE9PSBwcmV2LnN0eWxlKSBkaXYuc2V0QXR0cmlidXRlKFwic3R5bGVcIiwgY3VyLnN0eWxlKTtcblxuICAgICAgaWYoY3VyLmRhbmdlcm91c2x5U2V0SW5uZXJIVE1MICE9PSBwcmV2LmRhbmdlcm91c2x5U2V0SW5uZXJIVE1MKSBkaXYuaW5uZXJIVE1MID0gY3VyLmRhbmdlcm91c2x5U2V0SW5uZXJIVE1MO1xuXG4gICAgICAvLyBkZWJ1Zy9wcm9ncmFtbWF0aWMgcHJvcGVydGllc1xuICAgICAgaWYoY3VyLnNlbWFudGljICE9PSBwcmV2LnNlbWFudGljKSBkaXYuc2V0QXR0cmlidXRlKFwiZGF0YS1zZW1hbnRpY1wiLCBjdXIuc2VtYW50aWMpO1xuICAgICAgaWYoY3VyLmRlYnVnICE9PSBwcmV2LmRlYnVnKSBkaXYuc2V0QXR0cmlidXRlKFwiZGF0YS1kZWJ1Z1wiLCBjdXIuZGVidWcpO1xuXG4gICAgICAvLyBTVkcgcHJvcGVydGllc1xuICAgICAgaWYoY3VyLnN2Zykge1xuICAgICAgICBpZihjdXIuZmlsbCAhPT0gcHJldi5maWxsKSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJmaWxsXCIsIGN1ci5maWxsKTtcbiAgICAgICAgaWYoY3VyLnN0cm9rZSAhPT0gcHJldi5zdHJva2UpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInN0cm9rZVwiLCBjdXIuc3Ryb2tlKTtcbiAgICAgICAgaWYoY3VyLnN0cm9rZVdpZHRoICE9PSBwcmV2LnN0cm9rZVdpZHRoKSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJzdHJva2Utd2lkdGhcIiwgY3VyLnN0cm9rZVdpZHRoKTtcbiAgICAgICAgaWYoY3VyLmQgIT09IHByZXYuZCkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiZFwiLCBjdXIuZCk7XG4gICAgICAgIGlmKGN1ci5jICE9PSBwcmV2LmMpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcImNsYXNzXCIsIGN1ci5jKTtcbiAgICAgICAgaWYoY3VyLnggIT09IHByZXYueCkgIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInhcIiwgY3VyLngpO1xuICAgICAgICBpZihjdXIueSAhPT0gcHJldi55KSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ5XCIsIGN1ci55KTtcbiAgICAgICAgaWYoY3VyLmR4ICE9PSBwcmV2LmR4KSAgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiZHhcIiwgY3VyLmR4KTtcbiAgICAgICAgaWYoY3VyLmR5ICE9PSBwcmV2LmR5KSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJkeVwiLCBjdXIuZHkpO1xuICAgICAgICBpZihjdXIuY3ggIT09IHByZXYuY3gpICBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJjeFwiLCBjdXIuY3gpO1xuICAgICAgICBpZihjdXIuY3kgIT09IHByZXYuY3kpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcImN5XCIsIGN1ci5jeSk7XG4gICAgICAgIGlmKGN1ci5yICE9PSBwcmV2LnIpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInJcIiwgY3VyLnIpO1xuICAgICAgICBpZihjdXIuaGVpZ2h0ICE9PSBwcmV2LmhlaWdodCkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiaGVpZ2h0XCIsIGN1ci5oZWlnaHQpO1xuICAgICAgICBpZihjdXIud2lkdGggIT09IHByZXYud2lkdGgpICBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ3aWR0aFwiLCBjdXIud2lkdGgpO1xuICAgICAgICBpZihjdXIueGxpbmtocmVmICE9PSBwcmV2LnhsaW5raHJlZikgIGRpdi5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIFwiaHJlZlwiLCBjdXIueGxpbmtocmVmKTtcbiAgICAgICAgaWYoY3VyLnN0YXJ0T2Zmc2V0ICE9PSBwcmV2LnN0YXJ0T2Zmc2V0KSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJzdGFydE9mZnNldFwiLCBjdXIuc3RhcnRPZmZzZXQpO1xuICAgICAgICBpZihjdXIuaWQgIT09IHByZXYuaWQpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcImlkXCIsIGN1ci5pZCk7XG4gICAgICAgIGlmKGN1ci52aWV3Qm94ICE9PSBwcmV2LnZpZXdCb3gpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInZpZXdCb3hcIiwgY3VyLnZpZXdCb3gpO1xuICAgICAgICBpZihjdXIudHJhbnNmb3JtICE9PSBwcmV2LnRyYW5zZm9ybSkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwidHJhbnNmb3JtXCIsIGN1ci50cmFuc2Zvcm0pO1xuICAgICAgICBpZihjdXIuZHJhZ2dhYmxlICE9PSBwcmV2LmRyYWdnYWJsZSkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiZHJhZ2dhYmxlXCIsIGN1ci5kcmFnZ2FibGUpO1xuICAgICAgICBpZihjdXIudGV4dEFuY2hvciAhPT0gcHJldi50ZXh0QW5jaG9yKSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ0ZXh0LWFuY2hvclwiLCBjdXIudGV4dEFuY2hvcik7XG4gICAgICB9XG5cbiAgICAgIC8vZXZlbnRzXG4gICAgICBpZihjdXIuZGJsY2xpY2sgIT09IHByZXYuZGJsY2xpY2spIGRpdi5vbmRibGNsaWNrID0gY3VyLmRibGNsaWNrICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmNsaWNrICE9PSBwcmV2LmNsaWNrKSBkaXYub25jbGljayA9IGN1ci5jbGljayAhPT0gdW5kZWZpbmVkID8gdGhpcy5oYW5kbGVFdmVudCA6IHVuZGVmaW5lZDtcbiAgICAgIGlmKGN1ci5jb250ZXh0bWVudSAhPT0gcHJldi5jb250ZXh0bWVudSkgZGl2Lm9uY29udGV4dG1lbnUgPSBjdXIuY29udGV4dG1lbnUgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIubW91c2Vkb3duICE9PSBwcmV2Lm1vdXNlZG93bikgZGl2Lm9ubW91c2Vkb3duID0gY3VyLm1vdXNlZG93biAhPT0gdW5kZWZpbmVkID8gdGhpcy5oYW5kbGVFdmVudCA6IHVuZGVmaW5lZDtcbiAgICAgIGlmKGN1ci5tb3VzZW1vdmUgIT09IHByZXYubW91c2Vtb3ZlKSBkaXYub25tb3VzZW1vdmUgPSBjdXIubW91c2Vtb3ZlICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNldXAgIT09IHByZXYubW91c2V1cCkgZGl2Lm9ubW91c2V1cCA9IGN1ci5tb3VzZXVwICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNlb3ZlciAhPT0gcHJldi5tb3VzZW92ZXIpIGRpdi5vbm1vdXNlb3ZlciA9IGN1ci5tb3VzZW92ZXIgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIubW91c2VvdXQgIT09IHByZXYubW91c2VvdXQpIGRpdi5vbm1vdXNlb3V0ID0gY3VyLm1vdXNlb3V0ICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNlbGVhdmUgIT09IHByZXYubW91c2VsZWF2ZSkgZGl2Lm9ubW91c2VsZWF2ZSA9IGN1ci5tb3VzZWxlYXZlICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNld2hlZWwgIT09IHByZXYubW91c2V3aGVlbCkgZGl2Lm9ubW91c2VoZWVsID0gY3VyLm1vdXNld2hlZWwgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJhZ292ZXIgIT09IHByZXYuZHJhZ292ZXIpIGRpdi5vbmRyYWdvdmVyID0gY3VyLmRyYWdvdmVyICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmRyYWdzdGFydCAhPT0gcHJldi5kcmFnc3RhcnQpIGRpdi5vbmRyYWdzdGFydCA9IGN1ci5kcmFnc3RhcnQgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJhZ2VuZCAhPT0gcHJldi5kcmFnZW5kKSBkaXYub25kcmFnZW5kID0gY3VyLmRyYWdlbmQgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJhZyAhPT0gcHJldi5kcmFnKSBkaXYub25kcmFnID0gY3VyLmRyYWcgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJvcCAhPT0gcHJldi5kcm9wKSBkaXYub25kcm9wID0gY3VyLmRyb3AgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuc2Nyb2xsICE9PSBwcmV2LnNjcm9sbCkgZGl2Lm9uc2Nyb2xsID0gY3VyLnNjcm9sbCAhPT0gdW5kZWZpbmVkID8gdGhpcy5oYW5kbGVFdmVudCA6IHVuZGVmaW5lZDtcbiAgICAgIGlmKGN1ci5mb2N1cyAhPT0gcHJldi5mb2N1cykgZGl2Lm9uZm9jdXMgPSBjdXIuZm9jdXMgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuYmx1ciAhPT0gcHJldi5ibHVyKSBkaXYub25ibHVyID0gY3VyLmJsdXIgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuaW5wdXQgIT09IHByZXYuaW5wdXQpIGRpdi5vbmlucHV0ID0gY3VyLmlucHV0ICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmNoYW5nZSAhPT0gcHJldi5jaGFuZ2UpIGRpdi5vbmNoYW5nZSA9IGN1ci5jaGFuZ2UgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIua2V5dXAgIT09IHByZXYua2V5dXApIGRpdi5vbmtleXVwID0gY3VyLmtleXVwICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmtleWRvd24gIT09IHByZXYua2V5ZG93bikgZGl2Lm9ua2V5ZG93biA9IGN1ci5rZXlkb3duICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuXG4gICAgICBpZih0eXBlID09PSBcImFkZGVkXCIgfHwgdHlwZSA9PT0gXCJyZXBsYWNlZFwiIHx8IHR5cGUgPT09IFwibW92ZWRcIikge1xuICAgICAgICB2YXIgcGFyZW50RWwgPSBlbGVtZW50Q2FjaGVbY3VyLnBhcmVudF07XG4gICAgICAgIGlmKHBhcmVudEVsKSB7XG4gICAgICAgICAgaWYoY3VyLml4ID49IHBhcmVudEVsLmNoaWxkcmVuLmxlbmd0aCkge1xuICAgICAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQoZGl2KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFyZW50RWwuaW5zZXJ0QmVmb3JlKGRpdiwgcGFyZW50RWwuY2hpbGRyZW5bY3VyLml4XSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZGlmZigpIHtcbiAgICB2YXIgYSA9IHRoaXMucHJldlRyZWU7XG4gICAgdmFyIGIgPSB0aGlzLnRyZWU7XG4gICAgdmFyIGFzID0gT2JqZWN0LmtleXMoYSk7XG4gICAgdmFyIGJzID0gT2JqZWN0LmtleXMoYik7XG4gICAgdmFyIHVwZGF0ZWQgPSB7fTtcbiAgICB2YXIgYWRkcyA9IFtdO1xuICAgIGZvcih2YXIgaSA9IDAsIGxlbiA9IGFzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB2YXIgaWQgPSBhc1tpXTtcbiAgICAgIHZhciBjdXJBID0gYVtpZF07XG4gICAgICB2YXIgY3VyQiA9IGJbaWRdO1xuICAgICAgaWYoY3VyQiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHVwZGF0ZWRbaWRdID0gXCJyZW1vdmVkXCI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYoY3VyQS50ICE9PSBjdXJCLnQpIHtcbiAgICAgICAgdXBkYXRlZFtpZF0gPSBcInJlcGxhY2VkXCI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYoY3VyQS5peCAhPT0gY3VyQi5peCB8fCBjdXJBLnBhcmVudCAhPT0gY3VyQi5wYXJlbnQpIHtcbiAgICAgICAgdXBkYXRlZFtpZF0gPSBcIm1vdmVkXCI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZighY3VyQi5kaXJ0eVxuICAgICAgICAgICYmIGN1ckEuYyA9PT0gY3VyQi5jXG4gICAgICAgICAgJiYgY3VyQS5rZXkgPT09IGN1ckIua2V5XG4gICAgICAgICAgJiYgY3VyQS5kYW5nZXJvdXNseVNldElubmVySFRNTCA9PT0gY3VyQi5kYW5nZXJvdXNseVNldElubmVySFRNTFxuICAgICAgICAgICYmIGN1ckEudGFiaW5kZXggPT09IGN1ckIudGFiaW5kZXhcbiAgICAgICAgICAmJiBjdXJBLmhyZWYgPT09IGN1ckIuaHJlZlxuICAgICAgICAgICYmIGN1ckEucGxhY2Vob2xkZXIgPT09IGN1ckIucGxhY2Vob2xkZXJcbiAgICAgICAgICAmJiBjdXJBLnNlbGVjdGVkID09PSBjdXJCLnNlbGVjdGVkXG4gICAgICAgICAgJiYgY3VyQS5kcmFnZ2FibGUgPT09IGN1ckIuZHJhZ2dhYmxlXG4gICAgICAgICAgJiYgY3VyQS5jb250ZW50RWRpdGFibGUgPT09IGN1ckIuY29udGVudEVkaXRhYmxlXG4gICAgICAgICAgJiYgY3VyQS52YWx1ZSA9PT0gY3VyQi52YWx1ZVxuICAgICAgICAgICYmIGN1ckEudHlwZSA9PT0gY3VyQi50eXBlXG4gICAgICAgICAgJiYgY3VyQS5jaGVja2VkID09PSBjdXJCLmNoZWNrZWRcbiAgICAgICAgICAmJiBjdXJBLnRleHQgPT09IGN1ckIudGV4dFxuICAgICAgICAgICYmIGN1ckEudG9wID09PSBjdXJCLnRvcFxuICAgICAgICAgICYmIGN1ckEuZmxleCA9PT0gY3VyQi5mbGV4XG4gICAgICAgICAgJiYgY3VyQS5sZWZ0ID09PSBjdXJCLmxlZnRcbiAgICAgICAgICAmJiBjdXJBLndpZHRoID09PSBjdXJCLndpZHRoXG4gICAgICAgICAgJiYgY3VyQS5oZWlnaHQgPT09IGN1ckIuaGVpZ2h0XG4gICAgICAgICAgJiYgY3VyQS56SW5kZXggPT09IGN1ckIuekluZGV4XG4gICAgICAgICAgJiYgY3VyQS5iYWNrZ3JvdW5kQ29sb3IgPT09IGN1ckIuYmFja2dyb3VuZENvbG9yXG4gICAgICAgICAgJiYgY3VyQS5iYWNrZ3JvdW5kSW1hZ2UgPT09IGN1ckIuYmFja2dyb3VuZEltYWdlXG4gICAgICAgICAgJiYgY3VyQS5jb2xvciA9PT0gY3VyQi5jb2xvclxuICAgICAgICAgICYmIGN1ckEuY29sc3BhbiA9PT0gY3VyQi5jb2xzcGFuXG4gICAgICAgICAgJiYgY3VyQS5ib3JkZXIgPT09IGN1ckIuYm9yZGVyXG4gICAgICAgICAgJiYgY3VyQS5ib3JkZXJDb2xvciA9PT0gY3VyQi5ib3JkZXJDb2xvclxuICAgICAgICAgICYmIGN1ckEuYm9yZGVyV2lkdGggPT09IGN1ckIuYm9yZGVyV2lkdGhcbiAgICAgICAgICAmJiBjdXJBLmJvcmRlclJhZGl1cyA9PT0gY3VyQi5ib3JkZXJSYWRpdXNcbiAgICAgICAgICAmJiBjdXJBLm9wYWNpdHkgPT09IGN1ckIub3BhY2l0eVxuICAgICAgICAgICYmIGN1ckEuZm9udEZhbWlseSA9PT0gY3VyQi5mb250RmFtaWx5XG4gICAgICAgICAgJiYgY3VyQS5mb250U2l6ZSA9PT0gY3VyQi5mb250U2l6ZVxuICAgICAgICAgICYmIGN1ckEudGV4dEFsaWduID09PSBjdXJCLnRleHRBbGlnblxuICAgICAgICAgICYmIGN1ckEudHJhbnNmb3JtID09PSBjdXJCLnRyYW5zZm9ybVxuICAgICAgICAgICYmIGN1ckEudmVydGljYWxBbGlnbiA9PT0gY3VyQi52ZXJ0aWNhbEFsaWduXG4gICAgICAgICAgJiYgY3VyQS5zZW1hbnRpYyA9PT0gY3VyQi5zZW1hbnRpY1xuICAgICAgICAgICYmIGN1ckEuZGVidWcgPT09IGN1ckIuZGVidWdcbiAgICAgICAgICAmJiBjdXJBLnN0eWxlID09PSBjdXJCLnN0eWxlXG4gICAgICAgICAgJiYgKGN1ckIuc3ZnID09PSB1bmRlZmluZWQgfHwgKFxuICAgICAgICAgICAgICBjdXJBLnggPT09IGN1ckIueFxuICAgICAgICAgICAgICAmJiBjdXJBLnkgPT09IGN1ckIueVxuICAgICAgICAgICAgICAmJiBjdXJBLmR4ID09PSBjdXJCLmR4XG4gICAgICAgICAgICAgICYmIGN1ckEuZHkgPT09IGN1ckIuZHlcbiAgICAgICAgICAgICAgJiYgY3VyQS5jeCA9PT0gY3VyQi5jeFxuICAgICAgICAgICAgICAmJiBjdXJBLmN5ID09PSBjdXJCLmN5XG4gICAgICAgICAgICAgICYmIGN1ckEuciA9PT0gY3VyQi5yXG4gICAgICAgICAgICAgICYmIGN1ckEuZCA9PT0gY3VyQi5kXG4gICAgICAgICAgICAgICYmIGN1ckEuZmlsbCA9PT0gY3VyQi5maWxsXG4gICAgICAgICAgICAgICYmIGN1ckEuc3Ryb2tlID09PSBjdXJCLnN0cm9rZVxuICAgICAgICAgICAgICAmJiBjdXJBLnN0cm9rZVdpZHRoID09PSBjdXJCLnN0cm9rZVdpZHRoXG4gICAgICAgICAgICAgICYmIGN1ckEuc3RhcnRPZmZzZXQgPT09IGN1ckIuc3RhcnRPZmZzZXRcbiAgICAgICAgICAgICAgJiYgY3VyQS50ZXh0QW5jaG9yID09PSBjdXJCLnRleHRBbmNob3JcbiAgICAgICAgICAgICAgJiYgY3VyQS52aWV3Qm94ID09PSBjdXJCLnZpZXdCb3hcbiAgICAgICAgICAgICAgJiYgY3VyQS54bGlua2hyZWYgPT09IGN1ckIueGxpbmtocmVmKSlcbiAgICAgICAgICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdXBkYXRlZFtpZF0gPSBcInVwZGF0ZWRcIjtcbiAgICB9XG4gICAgZm9yKHZhciBpID0gMCwgbGVuID0gYnMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHZhciBpZCA9IGJzW2ldO1xuICAgICAgdmFyIGN1ckEgPSBhW2lkXTtcbiAgICAgIGlmKGN1ckEgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBhZGRzLnB1c2goaWQpO1xuICAgICAgICB1cGRhdGVkW2lkXSA9IFwiYWRkZWRcIjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMubGFzdERpZmYgPSB7YWRkczogYWRkcywgdXBkYXRlczogdXBkYXRlZH07XG4gICAgcmV0dXJuIHRoaXMubGFzdERpZmY7XG4gIH1cblxuICBwcmVwYXJlKHJvb3Q6RWxlbWVudCkge1xuICAgIHZhciBlbGVtTGVuID0gMTtcbiAgICB2YXIgdHJlZSA9IHRoaXMudHJlZTtcbiAgICB2YXIgZWxlbWVudHMgPSBbcm9vdF07XG4gICAgdmFyIGVsZW06RWxlbWVudDtcbiAgICBmb3IodmFyIGVsZW1JeCA9IDA7IGVsZW1JeCA8IGVsZW1MZW47IGVsZW1JeCsrKSB7XG4gICAgICBlbGVtID0gZWxlbWVudHNbZWxlbUl4XTtcbiAgICAgIGlmKGVsZW0ucGFyZW50ID09PSB1bmRlZmluZWQpIGVsZW0ucGFyZW50ID0gXCJfX3Jvb3RcIjtcbiAgICAgIGlmKGVsZW0uaWQgPT09IHVuZGVmaW5lZCkgZWxlbS5pZCA9IFwiX19yb290X19cIiArIGVsZW1JeDtcbiAgICAgIHRyZWVbZWxlbS5pZF0gPSBlbGVtO1xuICAgICAgaWYoZWxlbS5wb3N0UmVuZGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wb3N0UmVuZGVycy5wdXNoKGVsZW0pO1xuICAgICAgfVxuICAgICAgdmFyIGNoaWxkcmVuID0gZWxlbS5jaGlsZHJlbjtcbiAgICAgIGlmKGNoaWxkcmVuICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZm9yKHZhciBjaGlsZEl4ID0gMCwgbGVuID0gY2hpbGRyZW4ubGVuZ3RoOyBjaGlsZEl4IDwgbGVuOyBjaGlsZEl4KyspIHtcbiAgICAgICAgICB2YXIgY2hpbGQgPSBjaGlsZHJlbltjaGlsZEl4XTtcbiAgICAgICAgICBpZihjaGlsZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgICAgICBpZihjaGlsZC5pZCA9PT0gdW5kZWZpbmVkKSB7IGNoaWxkLmlkID0gZWxlbS5pZCArIFwiX19cIiArIGNoaWxkSXg7IH1cbiAgICAgICAgICBpZihjaGlsZC5peCA9PT0gdW5kZWZpbmVkKSB7IGNoaWxkLml4ID0gY2hpbGRJeDsgfVxuICAgICAgICAgIGlmKGNoaWxkLnBhcmVudCA9PT0gdW5kZWZpbmVkKSB7IGNoaWxkLnBhcmVudCA9IGVsZW0uaWQ7IH1cbiAgICAgICAgICBlbGVtZW50cy5wdXNoKGNoaWxkKTtcbiAgICAgICAgICBlbGVtTGVuKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRyZWU7XG4gIH1cblxuICBwb3N0RG9taWZ5KCkge1xuICAgIHZhciBwb3N0UmVuZGVycyA9IHRoaXMucG9zdFJlbmRlcnM7XG4gICAgdmFyIGRpZmYgPSB0aGlzLmxhc3REaWZmLnVwZGF0ZXM7XG4gICAgdmFyIGVsZW1lbnRDYWNoZSA9IHRoaXMuZWxlbWVudENhY2hlO1xuICAgIGZvcih2YXIgaSA9IDAsIGxlbiA9IHBvc3RSZW5kZXJzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB2YXIgZWxlbSA9IHBvc3RSZW5kZXJzW2ldO1xuICAgICAgdmFyIGlkID0gZWxlbS5pZDtcbiAgICAgIGlmKGRpZmZbaWRdID09PSBcInVwZGF0ZWRcIiB8fCBkaWZmW2lkXSA9PT0gXCJhZGRlZFwiIHx8IGRpZmZbaWRdID09PSBcInJlcGxhY2VkXCIgfHwgZWxlbS5kaXJ0eSkge1xuICAgICAgICBlbGVtLnBvc3RSZW5kZXIoZWxlbWVudENhY2hlW2VsZW0uaWRdLCBlbGVtKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZW5kZXIoZWxlbXM6RWxlbWVudFtdKSB7XG4gICAgICB0aGlzLnJlc2V0KCk7XG4gICAgLy8gV2Ugc29ydCBlbGVtZW50cyBieSBkZXB0aCB0byBhbGxvdyB0aGVtIHRvIGJlIHNlbGYgcmVmZXJlbnRpYWwuXG4gICAgZWxlbXMuc29ydCgoYSwgYikgPT4gKGEucGFyZW50ID8gYS5wYXJlbnQuc3BsaXQoXCJfX1wiKS5sZW5ndGggOiAwKSAtIChiLnBhcmVudCA/IGIucGFyZW50LnNwbGl0KFwiX19cIikubGVuZ3RoIDogMCkpO1xuICAgIGxldCBzdGFydCA9IG5vdygpO1xuICAgIGZvcihsZXQgZWxlbSBvZiBlbGVtcykge1xuICAgICAgbGV0IHBvc3QgPSB0aGlzLnByZXBhcmUoZWxlbSk7XG5cbiAgICB9XG4gICAgbGV0IHByZXBhcmUgPSBub3coKTtcbiAgICBsZXQgZCA9IHRoaXMuZGlmZigpO1xuICAgIGxldCBkaWZmID0gbm93KCk7XG4gICAgdGhpcy5kb21pZnkoKTtcbiAgICBsZXQgZG9taWZ5ID0gbm93KCk7XG4gICAgdGhpcy5wb3N0RG9taWZ5KCk7XG4gICAgbGV0IHBvc3REb21pZnkgPSBub3coKTtcbiAgICBsZXQgdGltZSA9IG5vdygpIC0gc3RhcnQ7XG4gICAgaWYodGltZSA+IDUpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwic2xvdyByZW5kZXIgKD4gNW1zKTogXCIsIHRpbWUsIHtcbiAgICAgICAgcHJlcGFyZTogcHJlcGFyZSAtIHN0YXJ0LFxuICAgICAgICBkaWZmOiBkaWZmIC0gcHJlcGFyZSxcbiAgICAgICAgZG9taWZ5OiBkb21pZnkgLSBkaWZmLFxuICAgICAgICBwb3N0RG9taWZ5OiBwb3N0RG9taWZ5IC0gZG9taWZ5XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCAqIGFzIGFwcCBmcm9tIFwiLi9hcHBcIjtcbmltcG9ydCB7UmVuZGVyZXJ9IGZyb20gXCIuL21pY3JvUmVhY3RcIjtcbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCJtYXJrZWQtYXN0L21hcmtlZC5kLnRzXCIgLz5cbmltcG9ydCAqIGFzIG1hcmtlZCBmcm9tIFwibWFya2VkLWFzdFwiO1xuXG5kZWNsYXJlIHZhciBDb2RlTWlycm9yO1xuZGVjbGFyZSB2YXIgdXVpZDtcblxuZnVuY3Rpb24gcmVwbGFjZUFsbChzdHIsIGZpbmQsIHJlcGxhY2UpIHtcbiAgbGV0IHJlZ2V4ID0gbmV3IFJlZ0V4cChmaW5kLnJlcGxhY2UoL1stXFwvXFxcXF4kKis/LigpfFtcXF17fV0vZywgJ1xcXFwkJicpLCAnZycpO1xuICByZXR1cm4gc3RyLnJlcGxhY2UocmVnZXgsIHJlcGxhY2UpO1xufVxuXG5mdW5jdGlvbiB3cmFwV2l0aE1hcmtkb3duKGNtLCB3cmFwcGluZykge1xuICBjbS5vcGVyYXRpb24oKCkgPT4ge1xuICAgIGxldCBmcm9tID0gY20uZ2V0Q3Vyc29yKFwiZnJvbVwiKTtcbiAgICAvLyBpZiB0aGVyZSdzIHNvbWV0aGluZyBzZWxlY3RlZCB3cmFwIGl0XG4gICAgaWYgKGNtLnNvbWV0aGluZ1NlbGVjdGVkKCkpIHtcbiAgICAgIGxldCBzZWxlY3RlZCA9IGNtLmdldFNlbGVjdGlvbigpO1xuICAgICAgbGV0IGNsZWFuZWQgPSByZXBsYWNlQWxsKHNlbGVjdGVkLCB3cmFwcGluZywgXCJcIik7XG4gICAgICBpZiAoc2VsZWN0ZWQuc3Vic3RyaW5nKDAsIHdyYXBwaW5nLmxlbmd0aCkgPT09IHdyYXBwaW5nXG4gICAgICAgICYmIHNlbGVjdGVkLnN1YnN0cmluZyhzZWxlY3RlZC5sZW5ndGggLSB3cmFwcGluZy5sZW5ndGgpID09PSB3cmFwcGluZykge1xuICAgICAgICBjbS5yZXBsYWNlUmFuZ2UoY2xlYW5lZCwgZnJvbSwgY20uZ2V0Q3Vyc29yKFwidG9cIikpO1xuICAgICAgICBjbS5zZXRTZWxlY3Rpb24oZnJvbSwgY20uZ2V0Q3Vyc29yKFwiZnJvbVwiKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjbS5yZXBsYWNlUmFuZ2UoYCR7d3JhcHBpbmd9JHtjbGVhbmVkfSR7d3JhcHBpbmd9YCwgZnJvbSwgY20uZ2V0Q3Vyc29yKFwidG9cIikpO1xuICAgICAgICBjbS5zZXRTZWxlY3Rpb24oZnJvbSwgY20uZ2V0Q3Vyc29yKFwiZnJvbVwiKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNtLnJlcGxhY2VSYW5nZShgJHt3cmFwcGluZ30ke3dyYXBwaW5nfWAsIGZyb20pO1xuICAgICAgbGV0IG5ld0xvY2F0aW9uID0geyBsaW5lOiBmcm9tLmxpbmUsIGNoOiBmcm9tLmNoICsgd3JhcHBpbmcubGVuZ3RoIH07XG4gICAgICBjbS5zZXRDdXJzb3IobmV3TG9jYXRpb24pO1xuICAgIH1cbiAgfSlcbn1cblxuZnVuY3Rpb24gcHJlZml4V2l0aE1hcmtkb3duKGNtLCBwcmVmaXgpIHtcbiAgY20ub3BlcmF0aW9uKCgpID0+IHtcbiAgICBsZXQgZnJvbSA9IGNtLmdldEN1cnNvcihcImZyb21cIik7XG4gICAgbGV0IHRvID0gY20uZ2V0Q3Vyc29yKFwidG9cIik7XG4gICAgbGV0IHRvUHJlZml4ID0gW107XG4gICAgZm9yKGxldCBsaW5lSXggPSBmcm9tLmxpbmU7IGxpbmVJeCA8PSB0by5saW5lOyBsaW5lSXgrKykge1xuICAgICAgdmFyIGN1cnJlbnRQcmVmaXggPSBjbS5nZXRSYW5nZSh7bGluZTogbGluZUl4LCBjaDogMH0sIHtsaW5lOiBsaW5lSXgsIGNoOiBwcmVmaXgubGVuZ3RofSk7XG4gICAgICBpZihjdXJyZW50UHJlZml4ICE9PSBwcmVmaXggJiYgY3VycmVudFByZWZpeCAhPT0gXCJcIikge1xuICAgICAgICB0b1ByZWZpeC5wdXNoKGxpbmVJeCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gaWYgZXZlcnl0aGluZyBpbiB0aGUgc2VsZWN0aW9uIGhhcyBiZWVuIHByZWZpeGVkLCB0aGVuIHdlIG5lZWQgdG8gdW5wcmVmaXhcbiAgICBpZih0b1ByZWZpeC5sZW5ndGggPT09IDApIHtcbiAgICAgZm9yKGxldCBsaW5lSXggPSBmcm9tLmxpbmU7IGxpbmVJeCA8PSB0by5saW5lOyBsaW5lSXgrKykge1xuICAgICAgIGNtLnJlcGxhY2VSYW5nZShcIlwiLCB7bGluZTogbGluZUl4LCBjaDogMH0sIHtsaW5lOiBsaW5lSXgsIGNoOiBwcmVmaXgubGVuZ3RofSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvcihsZXQgbGluZUl4IG9mIHRvUHJlZml4KSB7XG4gICAgICAgIGNtLnJlcGxhY2VSYW5nZShwcmVmaXgsIHtsaW5lOiBsaW5lSXgsIGNoOiAwfSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuZXhwb3J0IGNsYXNzIFJpY2hUZXh0RWRpdG9yIHtcblxuICBjbUluc3RhbmNlO1xuICBtYXJrczogYW55W107XG4gIHRpbWVvdXQ7XG4gIG1ldGE6IGFueTtcbiAgLy9mb3JtYXQgYmFyXG4gIGZvcm1hdEJhckRlbGF5ID0gMTAwO1xuICBzaG93aW5nRm9ybWF0QmFyID0gZmFsc2U7XG4gIGZvcm1hdEJhckVsZW1lbnQ6RWxlbWVudCA9IG51bGw7XG4gIC8vIGV2ZW50c1xuICBvblVwZGF0ZTogKG1ldGE6IGFueSwgY29udGVudDogc3RyaW5nKSA9PiB2b2lkO1xuICBnZXRFbWJlZDogKG1ldGE6IGFueSwgcXVlcnk6IHN0cmluZykgPT4gRWxlbWVudDtcbiAgZ2V0SW5saW5lOiAobWV0YTogYW55LCBxdWVyeTogc3RyaW5nKSA9PiBzdHJpbmc7XG4gIHJlbW92ZUlubGluZTogKG1ldGE6IGFueSwgcXVlcnk6IHN0cmluZykgPT4gdm9pZDtcblxuICBjb25zdHJ1Y3Rvcihub2RlLCBnZXRFbWJlZCwgZ2V0SW5saW5lLCByZW1vdmVJbmxpbmUpIHtcbiAgICB0aGlzLm1hcmtzID0gW107XG4gICAgdGhpcy5tZXRhID0ge307XG4gICAgdGhpcy5nZXRFbWJlZCA9IGdldEVtYmVkO1xuICAgIHRoaXMuZ2V0SW5saW5lID0gZ2V0SW5saW5lO1xuICAgIHRoaXMucmVtb3ZlSW5saW5lID0gcmVtb3ZlSW5saW5lO1xuICAgIGxldCBjbSA9IHRoaXMuY21JbnN0YW5jZSA9IG5ldyBDb2RlTWlycm9yKG5vZGUsIHtcbiAgICAgIGxpbmVXcmFwcGluZzogdHJ1ZSxcbiAgICAgIGF1dG9DbG9zZUJyYWNrZXRzOiB0cnVlLFxuICAgICAgdmlld3BvcnRNYXJnaW46IEluZmluaXR5LFxuICAgICAgZXh0cmFLZXlzOiB7XG4gICAgICAgIFwiQ21kLUJcIjogKGNtKSA9PiB7XG4gICAgICAgICAgd3JhcFdpdGhNYXJrZG93bihjbSwgXCIqKlwiKTtcbiAgICAgICAgfSxcbiAgICAgICAgXCJDbWQtSVwiOiAoY20pID0+IHtcbiAgICAgICAgICB3cmFwV2l0aE1hcmtkb3duKGNtLCBcIl9cIik7XG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgY20ub24oXCJjaGFuZ2VzXCIsIChjbSwgY2hhbmdlcykgPT4ge1xuICAgICAgc2VsZi5vbkNoYW5nZXMoY20sIGNoYW5nZXMpO1xuICAgICAgaWYgKHNlbGYub25VcGRhdGUpIHtcbiAgICAgICAgc2VsZi5vblVwZGF0ZShzZWxmLm1ldGEsIGNtLmdldFZhbHVlKCkpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNtLm9uKFwiY3Vyc29yQWN0aXZpdHlcIiwgKGNtKSA9PiB7IHNlbGYub25DdXJzb3JBY3Rpdml0eShjbSkgfSk7XG4gICAgY20ub24oXCJtb3VzZWRvd25cIiwgKGNtLCBlKSA9PiB7IHNlbGYub25Nb3VzZURvd24oY20sIGUpIH0pO1xuICAgIGNtLmdldFdyYXBwZXJFbGVtZW50KCkuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgKGUpID0+IHtcbiAgICAgIHNlbGYub25Nb3VzZVVwKGNtLCBlKTtcbiAgICB9KTtcbiAgfVxuXG4gIHNob3dGb3JtYXRCYXIoKSB7XG4gICAgdGhpcy5zaG93aW5nRm9ybWF0QmFyID0gdHJ1ZTtcbiAgICB2YXIgcmVuZGVyZXIgPSBuZXcgUmVuZGVyZXIoKTtcbiAgICB2YXIgY20gPSB0aGlzLmNtSW5zdGFuY2U7XG4gICAgbGV0IGhlYWQgPSBjbS5nZXRDdXJzb3IoXCJoZWFkXCIpO1xuICAgIGxldCBmcm9tID0gY20uZ2V0Q3Vyc29yKFwiZnJvbVwiKTtcbiAgICBsZXQgdG8gPSBjbS5nZXRDdXJzb3IoXCJ0b1wiKTtcbiAgICBsZXQgc3RhcnQgPSBjbS5jdXJzb3JDb29yZHMoaGVhZCwgXCJsb2NhbFwiKTtcbiAgICBsZXQgdG9wID0gc3RhcnQuYm90dG9tICsgNTtcbiAgICBjb25zb2xlLmxvZyhoZWFkLCBmcm9tLCB0byk7XG4gICAgaWYoKGhlYWQubGluZSA9PT0gZnJvbS5saW5lICYmIGhlYWQuY2ggPT09IGZyb20uY2gpXG4gICAgICAgfHwgKGNtLmN1cnNvckNvb3Jkcyhmcm9tLCBcImxvY2FsXCIpLnRvcCA9PT0gY20uY3Vyc29yQ29vcmRzKHRvLCBcImxvY2FsXCIpLnRvcCkpIHtcbiAgICAgIHRvcCA9IHN0YXJ0LnRvcCAtIDQwO1xuICAgIH1cbiAgICBsZXQgYmFyU2l6ZSA9IDMwMCAvIDI7XG4gICAgdmFyIGl0ZW0gPSB7YzogXCJmb3JtYXRCYXJcIiwgc3R5bGU6IGBwb3NpdGlvbjphYnNvbHV0ZTsgbGVmdDogJHtzdGFydC5sZWZ0IC0gYmFyU2l6ZX1weDsgdG9wOiR7dG9wfXB4O2AsIGNoaWxkcmVuOiBbXG4gICAgICB7YzogXCJidXR0b24gXCIsIHRleHQ6IFwiSDFcIiwgY2xpY2s6ICgpID0+IHsgcHJlZml4V2l0aE1hcmtkb3duKGNtLCBcIiMgXCIpOyB9fSxcbiAgICAgIHtjOiBcImJ1dHRvbiBcIiwgdGV4dDogXCJIMlwiLCBjbGljazogKCkgPT4geyBwcmVmaXhXaXRoTWFya2Rvd24oY20sIFwiIyMgXCIpOyB9fSxcbiAgICAgIHtjOiBcInNlcFwifSxcbiAgICAgIHtjOiBcImJ1dHRvbiBib2xkXCIsIHRleHQ6IFwiQlwiLCBjbGljazogKCkgPT4geyB3cmFwV2l0aE1hcmtkb3duKGNtLCBcIioqXCIpOyB9fSxcbiAgICAgIHtjOiBcImJ1dHRvbiBpdGFsaWNcIiwgdGV4dDogXCJJXCIsIGNsaWNrOiAoKSA9PiB7IHdyYXBXaXRoTWFya2Rvd24oY20sIFwiX1wiKTsgfX0sXG4gICAgICB7YzogXCJzZXBcIn0sXG4gICAgICB7YzogXCJidXR0b24gXCIsIHRleHQ6IFwiLVwiLCBjbGljazogKCkgPT4geyBwcmVmaXhXaXRoTWFya2Rvd24oY20sIFwiLSBcIik7IH19LFxuICAgICAge2M6IFwiYnV0dG9uIFwiLCB0ZXh0OiBcIjEuXCIsIGNsaWNrOiAoKSA9PiB7IHByZWZpeFdpdGhNYXJrZG93bihjbSwgXCIxLiBcIik7IH19LFxuICAgICAge2M6IFwiYnV0dG9uIFwiLCB0ZXh0OiBcIlsgXVwiLCBjbGljazogKCkgPT4geyBwcmVmaXhXaXRoTWFya2Rvd24oY20sIFwiWyBdIFwiKTsgfX0sXG4gICAgICB7YzogXCJzZXBcIn0sXG4gICAgICB7YzogXCJidXR0b24gXCIsIHRleHQ6IFwibGlua1wifSxcbiAgICBdfTtcbiAgICByZW5kZXJlci5yZW5kZXIoW2l0ZW1dKTtcbiAgICBsZXQgZWxlbSA9IDxFbGVtZW50PnJlbmRlcmVyLmNvbnRlbnQuZmlyc3RDaGlsZDtcbiAgICB0aGlzLmZvcm1hdEJhckVsZW1lbnQgPSBlbGVtO1xuICAgIGNtLmdldFdyYXBwZXJFbGVtZW50KCkuYXBwZW5kQ2hpbGQoZWxlbSk7XG4gICAgLy8gdGhpcy5jbUluc3RhbmNlLmFkZFdpZGdldChwb3MsIGVsZW0pO1xuICB9XG5cbiAgaGlkZUZvcm1hdEJhcigpIHtcbiAgICB0aGlzLnNob3dpbmdGb3JtYXRCYXIgPSBmYWxzZTtcbiAgICB0aGlzLmZvcm1hdEJhckVsZW1lbnQucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLmZvcm1hdEJhckVsZW1lbnQpO1xuICAgIHRoaXMuZm9ybWF0QmFyRWxlbWVudCA9IG51bGw7XG4gIH1cblxuICBvbkNoYW5nZXMoY20sIGNoYW5nZXMpIHtcbiAgICBsZXQgc2VsZiA9IHRoaXM7XG4gICAgZm9yIChsZXQgY2hhbmdlIG9mIGNoYW5nZXMpIHtcbiAgICAgIGxldCByZW1vdmVkID0gY2hhbmdlLnJlbW92ZWQuam9pbihcIlxcblwiKTtcbiAgICAgIGxldCBtYXRjaGVzID0gcmVtb3ZlZC5tYXRjaCgvKHtbXl0qP30pL2dtKTtcbiAgICAgIGlmICghbWF0Y2hlcykgY29udGludWU7XG4gICAgICBmb3IgKGxldCBtYXRjaCBvZiBtYXRjaGVzKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlSW5saW5lKHRoaXMubWV0YSwgbWF0Y2gpO1xuICAgICAgfVxuICAgIH1cbiAgICBjbS5vcGVyYXRpb24oKCkgPT4ge1xuICAgICAgbGV0IGNvbnRlbnQgPSBjbS5nZXRWYWx1ZSgpO1xuICAgICAgbGV0IHBhcnRzID0gY29udGVudC5zcGxpdCgvKHtbXl0qP30pL2dtKTtcbiAgICAgIGxldCBpeCA9IDA7XG4gICAgICBmb3IgKGxldCBtYXJrIG9mIHNlbGYubWFya3MpIHtcbiAgICAgICAgbWFyay5jbGVhcigpO1xuICAgICAgfVxuICAgICAgc2VsZi5tYXJrcyA9IFtdO1xuICAgICAgbGV0IGN1cnNvckl4ID0gY20uaW5kZXhGcm9tUG9zKGNtLmdldEN1cnNvcihcImZyb21cIikpO1xuICAgICAgZm9yIChsZXQgcGFydCBvZiBwYXJ0cykge1xuICAgICAgICBpZiAocGFydFswXSA9PT0gXCJ7XCIpIHtcbiAgICAgICAgICBsZXQge21hcmssIHJlcGxhY2VtZW50fSA9IHNlbGYubWFya0VtYmVkZGVkUXVlcnkoY20sIHBhcnQsIGl4KTtcbiAgICAgICAgICBpZiAobWFyaykgc2VsZi5tYXJrcy5wdXNoKG1hcmspO1xuICAgICAgICAgIGlmKHJlcGxhY2VtZW50KSBwYXJ0ID0gcmVwbGFjZW1lbnQ7XG4gICAgICAgIH1cbiAgICAgICAgaXggKz0gcGFydC5sZW5ndGg7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBvbkN1cnNvckFjdGl2aXR5KGNtKSB7XG4gICAgaWYgKCFjbS5zb21ldGhpbmdTZWxlY3RlZCgpKSB7XG4gICAgICBsZXQgY3Vyc29yID0gY20uZ2V0Q3Vyc29yKFwiZnJvbVwiKTtcbiAgICAgIGxldCBtYXJrcyA9IGNtLmZpbmRNYXJrc0F0KGN1cnNvcik7XG4gICAgICBmb3IgKGxldCBtYXJrIG9mIG1hcmtzKSB7XG4gICAgICAgIGlmIChtYXJrLm5lZWRzUmVwbGFjZW1lbnQpIHtcbiAgICAgICAgICBsZXQge2Zyb20sIHRvfSA9IG1hcmsuZmluZCgpO1xuICAgICAgICAgIGxldCBpeCA9IGNtLmluZGV4RnJvbVBvcyhmcm9tKTtcbiAgICAgICAgICBsZXQgdGV4dCA9IGNtLmdldFJhbmdlKGZyb20sIHRvKTtcbiAgICAgICAgICBtYXJrLmNsZWFyKCk7XG4gICAgICAgICAgbGV0IHttYXJrOm5ld01hcmt9ID0gdGhpcy5tYXJrRW1iZWRkZWRRdWVyeShjbSwgdGV4dCwgaXgpO1xuICAgICAgICAgIGlmIChuZXdNYXJrKSB0aGlzLm1hcmtzLnB1c2gobmV3TWFyayk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgaWYodGhpcy5zaG93aW5nRm9ybWF0QmFyICYmICFjbS5zb21ldGhpbmdTZWxlY3RlZCgpKSB7XG4gICAgICB0aGlzLmhpZGVGb3JtYXRCYXIoKTtcbiAgICB9XG4gIH1cblxuICBvbk1vdXNlVXAoY20sIGUpIHtcbiAgICBpZighdGhpcy5zaG93aW5nRm9ybWF0QmFyKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgICAgIHRoaXMudGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBpZiAoY20uc29tZXRoaW5nU2VsZWN0ZWQoKSkge1xuICAgICAgICAgIHNlbGYuc2hvd0Zvcm1hdEJhcigpO1xuICAgICAgICB9XG4gICAgICB9LCB0aGlzLmZvcm1hdEJhckRlbGF5KTtcbiAgICB9XG4gIH1cblxuICBvbk1vdXNlRG93bihjbSwgZSkge1xuICAgIGxldCBjdXJzb3IgPSBjbS5jb29yZHNDaGFyKHsgbGVmdDogZS5jbGllbnRYLCB0b3A6IGUuY2xpZW50WSB9KTtcbiAgICBsZXQgcG9zID0gY20uaW5kZXhGcm9tUG9zKGN1cnNvcik7XG4gICAgbGV0IG1hcmtzID0gY20uZmluZE1hcmtzQXQoY3Vyc29yKTtcbiAgICBmb3IgKGxldCBtYXJrIG9mIHRoaXMubWFya3MpIHtcbiAgICAgIGlmIChtYXJrLmluZm8gJiYgbWFyay5pbmZvLnRvKSB7XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKFwiR09UTzogXCIsIG1hcmsuaW5mby50byk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgbWFya0VtYmVkZGVkUXVlcnkoY20sIHF1ZXJ5LCBpeCkge1xuICAgIGxldCBjdXJzb3JJeCA9IGNtLmluZGV4RnJvbVBvcyhjbS5nZXRDdXJzb3IoXCJmcm9tXCIpKTtcbiAgICBsZXQgbWFyaywgcmVwbGFjZW1lbnQ7XG4gICAgbGV0IHN0YXJ0ID0gY20ucG9zRnJvbUluZGV4KGl4KTtcbiAgICBsZXQgc3RvcCA9IGNtLnBvc0Zyb21JbmRleChpeCArIHF1ZXJ5Lmxlbmd0aCk7XG4gICAgLy8gYXMgbG9uZyBhcyBvdXIgY3Vyc29yIGlzbid0IGluIHRoaXMgc3BhblxuICAgIGlmIChxdWVyeSAhPT0gXCJ7fVwiICYmIChjdXJzb3JJeCA8PSBpeCB8fCBjdXJzb3JJeCA+PSBpeCArIHF1ZXJ5Lmxlbmd0aCkpIHtcbiAgICAgIC8vIGNoZWNrIGlmIHRoaXMgaXMgYSBxdWVyeSB0aGF0J3MgZGVmaW5pbmcgYW4gaW5saW5lIGF0dHJpYnV0ZVxuICAgICAgLy8gZS5nLiB7YWdlOiAzMH1cbiAgICAgIGxldCBhZGp1c3RlZCA9IHRoaXMuZ2V0SW5saW5lKHRoaXMubWV0YSwgcXVlcnkpXG4gICAgICBpZiAoYWRqdXN0ZWQgIT09IHF1ZXJ5KSB7XG4gICAgICAgIHJlcGxhY2VtZW50ID0gYWRqdXN0ZWQ7XG4gICAgICAgIGNtLnJlcGxhY2VSYW5nZShhZGp1c3RlZCwgc3RhcnQsIHN0b3ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWFyayA9IGNtLm1hcmtUZXh0KHN0YXJ0LCBzdG9wLCB7IHJlcGxhY2VkV2l0aDogdGhpcy5nZXRFbWJlZCh0aGlzLm1ldGEsIHF1ZXJ5LnN1YnN0cmluZygxLCBxdWVyeS5sZW5ndGggLSAxKSkgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG1hcmsgPSBjbS5tYXJrVGV4dChzdGFydCwgc3RvcCwgeyBjbGFzc05hbWU6IFwiZW1iZWQtY29kZVwiIH0pO1xuICAgICAgbWFyay5uZWVkc1JlcGxhY2VtZW50ID0gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHttYXJrLCByZXBsYWNlbWVudH07XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVkaXRvcihnZXRFbWJlZDogKG1ldGE6IGFueSwgcXVlcnk6IHN0cmluZykgPT4gRWxlbWVudCxcbiAgZ2V0SW5saW5lOiAobWV0YTogYW55LCBxdWVyeTogc3RyaW5nKSA9PiBzdHJpbmcsXG4gIHJlbW92ZUlubGluZTogKG1ldGE6IGFueSwgcXVlcnk6IHN0cmluZykgPT4gdm9pZCkge1xuICByZXR1cm4gZnVuY3Rpb24gd3JhcFJpY2hUZXh0RWRpdG9yKG5vZGUsIGVsZW0pIHtcbiAgICBsZXQgZWRpdG9yID0gbm9kZS5lZGl0b3I7XG4gICAgbGV0IGNtOkNvZGVNaXJyb3IuRWRpdG9yO1xuICAgIGlmICghZWRpdG9yKSB7XG4gICAgICBlZGl0b3IgPSBub2RlLmVkaXRvciA9IG5ldyBSaWNoVGV4dEVkaXRvcihub2RlLCBnZXRFbWJlZCwgZ2V0SW5saW5lLCByZW1vdmVJbmxpbmUpO1xuICAgICAgY20gPSBub2RlLmVkaXRvci5jbUluc3RhbmNlO1xuICAgICAgY20uZm9jdXMoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY20gPSBub2RlLmVkaXRvci5jbUluc3RhbmNlO1xuICAgIH1cbiAgICBlZGl0b3Iub25VcGRhdGUgPSBlbGVtLmNoYW5nZTtcbiAgICBlZGl0b3IubWV0YSA9IGVsZW0ubWV0YSB8fCBlZGl0b3IubWV0YTtcbiAgICBsZXQgZG9jID0gY20uZ2V0RG9jKCk7XG4gICAgaWYgKGRvYy5nZXRWYWx1ZSgpICE9PSBlbGVtLnZhbHVlKSB7XG4gICAgICBkb2Muc2V0VmFsdWUoZWxlbS52YWx1ZSB8fCBcIlwiKTtcbiAgICAgIGRvYy5jbGVhckhpc3RvcnkoKTtcbiAgICAgIGRvYy5zZXRDdXJzb3Ioe2xpbmU6IDEsIGNoOiAwfSk7XG4gICAgfVxuICAgIGNtLnJlZnJlc2goKTtcbiAgfVxufVxuIiwiaW1wb3J0IHtFTlYsIHV1aWR9IGZyb20gXCIuL3V0aWxzXCI7XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSdW50aW1lXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZGVjbGFyZSB2YXIgZXhwb3J0cztcbmxldCBydW50aW1lID0gZXhwb3J0cztcblxuZXhwb3J0IHZhciBNQVhfTlVNQkVSID0gOTAwNzE5OTI1NDc0MDk5MTtcbmV4cG9ydCB2YXIgSU5DUkVNRU5UQUwgPSBmYWxzZTtcblxuZnVuY3Rpb24gb2JqZWN0c0lkZW50aWNhbChhOntba2V5OnN0cmluZ106IGFueX0sIGI6e1trZXk6c3RyaW5nXTogYW55fSk6Ym9vbGVhbiB7XG4gIHZhciBhS2V5cyA9IE9iamVjdC5rZXlzKGEpO1xuICBmb3IodmFyIGtleSBvZiBhS2V5cykge1xuICAgIC8vVE9ETzogaGFuZGxlIG5vbi1zY2FsYXIgdmFsdWVzXG4gICAgaWYoYVtrZXldICE9PSBiW2tleV0pIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gaW5kZXhPZkZhY3QoaGF5c3RhY2ssIG5lZWRsZSkge1xuICBsZXQgaXggPSAwO1xuICBmb3IobGV0IGZhY3Qgb2YgaGF5c3RhY2spIHtcbiAgICBpZihmYWN0Ll9faWQgPT09IG5lZWRsZS5fX2lkKSB7XG4gICAgICByZXR1cm4gaXg7XG4gICAgfVxuICAgIGl4Kys7XG4gIH1cbiAgcmV0dXJuIC0xO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlRmFjdChoYXlzdGFjaywgbmVlZGxlKSB7XG4gIGxldCBpeCA9IGluZGV4T2ZGYWN0KGhheXN0YWNrLCBuZWVkbGUpO1xuICBpZihpeCA+IC0xKSBoYXlzdGFjay5zcGxpY2UoaXgsIDEpO1xuICByZXR1cm4gaGF5c3RhY2s7XG59XG5cbmZ1bmN0aW9uIGRpZmZBZGRzQW5kUmVtb3ZlcyhhZGRzLCByZW1vdmVzKSB7XG4gIGxldCBsb2NhbEhhc2ggPSB7fTtcbiAgbGV0IGhhc2hUb0ZhY3QgPSB7fTtcbiAgbGV0IGhhc2hlcyA9IFtdO1xuICBmb3IobGV0IGFkZCBvZiBhZGRzKSB7XG4gICAgbGV0IGhhc2ggPSBhZGQuX19pZDtcbiAgICBpZihsb2NhbEhhc2hbaGFzaF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgbG9jYWxIYXNoW2hhc2hdID0gMTtcbiAgICAgIGhhc2hUb0ZhY3RbaGFzaF0gPSBhZGQ7XG4gICAgICBoYXNoZXMucHVzaChoYXNoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9jYWxIYXNoW2hhc2hdKys7XG4gICAgfVxuICAgIGFkZC5fX2lkID0gaGFzaDtcbiAgfVxuICBmb3IobGV0IHJlbW92ZSBvZiByZW1vdmVzKSB7XG4gICAgbGV0IGhhc2ggPSByZW1vdmUuX19pZDtcbiAgICBpZihsb2NhbEhhc2hbaGFzaF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgbG9jYWxIYXNoW2hhc2hdID0gLTE7XG4gICAgICBoYXNoVG9GYWN0W2hhc2hdID0gcmVtb3ZlO1xuICAgICAgaGFzaGVzLnB1c2goaGFzaCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvY2FsSGFzaFtoYXNoXS0tO1xuICAgIH1cbiAgICByZW1vdmUuX19pZCA9IGhhc2g7XG4gIH1cbiAgbGV0IHJlYWxBZGRzID0gW107XG4gIGxldCByZWFsUmVtb3ZlcyA9IFtdO1xuICBmb3IobGV0IGhhc2ggb2YgaGFzaGVzKSB7XG4gICAgbGV0IGNvdW50ID0gbG9jYWxIYXNoW2hhc2hdO1xuICAgIGlmKGNvdW50ID4gMCkge1xuICAgICAgbGV0IGZhY3QgPSBoYXNoVG9GYWN0W2hhc2hdO1xuICAgICAgcmVhbEFkZHMucHVzaChmYWN0KTtcbiAgICB9IGVsc2UgaWYoY291bnQgPCAwKSB7XG4gICAgICBsZXQgZmFjdCA9IGhhc2hUb0ZhY3RbaGFzaF07XG4gICAgICByZWFsUmVtb3Zlcy5wdXNoKGZhY3QpO1xuICAgIH1cbiAgfVxuICByZXR1cm4ge2FkZHM6cmVhbEFkZHMsIHJlbW92ZXM6cmVhbFJlbW92ZXN9O1xufVxuXG5mdW5jdGlvbiBnZW5lcmF0ZUVxdWFsaXR5Rm4oa2V5cykge1xuICByZXR1cm4gbmV3IEZ1bmN0aW9uKFwiYVwiLCBcImJcIiwgIGByZXR1cm4gJHtrZXlzLm1hcChmdW5jdGlvbihrZXksIGl4KSB7XG4gICAgaWYoa2V5LmNvbnN0cnVjdG9yID09PSBBcnJheSkge1xuICAgICAgcmV0dXJuIGBhWycke2tleVswXX0nXVsnJHtrZXlbMV19J10gPT09IGJbJyR7a2V5WzBdfSddWycke2tleVsxXX0nXWA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBgYVtcIiR7a2V5fVwiXSA9PT0gYltcIiR7a2V5fVwiXWA7XG4gICAgfVxuICB9KS5qb2luKFwiICYmIFwiKX07YClcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVTdHJpbmdGbihrZXlzKSB7XG4gIGxldCBrZXlTdHJpbmdzID0gW107XG4gIGZvcihsZXQga2V5IG9mIGtleXMpIHtcbiAgICBpZihrZXkuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICBrZXlTdHJpbmdzLnB1c2goYGFbJyR7a2V5WzBdfSddWycke2tleVsxXX0nXWApO1xuICAgIH0gZWxzZSB7XG4gICAgICBrZXlTdHJpbmdzLnB1c2goYGFbJyR7a2V5fSddYCk7XG4gICAgfVxuICB9XG4gIGxldCBmaW5hbCA9IGtleVN0cmluZ3Muam9pbignICsgXCJ8XCIgKyAnKTtcbiAgcmV0dXJuIG5ldyBGdW5jdGlvbihcImFcIiwgIGByZXR1cm4gJHtmaW5hbH07YCk7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlVW5wcm9qZWN0ZWRTb3J0ZXJDb2RlKHVucHJvamVjdGVkU2l6ZSwgc29ydHMpIHtcbiAgbGV0IGNvbmRpdGlvbnMgPSBbXTtcbiAgbGV0IHBhdGggPSBbXTtcbiAgbGV0IGRpc3RhbmNlID0gdW5wcm9qZWN0ZWRTaXplO1xuICBmb3IobGV0IHNvcnQgb2Ygc29ydHMpIHtcbiAgICBsZXQgY29uZGl0aW9uID0gXCJcIjtcbiAgICBmb3IobGV0IHByZXYgb2YgcGF0aCkge1xuICAgICAgbGV0IFt0YWJsZSwga2V5XSA9IHByZXY7XG4gICAgICBjb25kaXRpb24gKz0gYHVucHJvamVjdGVkW2otJHtkaXN0YW5jZSAtIHRhYmxlfV1bJyR7a2V5fSddID09PSBpdGVtJHt0YWJsZX1bJyR7a2V5fSddICYmIGA7XG4gICAgfVxuICAgIGxldCBbdGFibGUsIGtleSwgZGlyXSA9IHNvcnQ7XG4gICAgbGV0IG9wID0gXCI+XCI7XG4gICAgaWYoZGlyID09PSBcImRlc2NlbmRpbmdcIikge1xuICAgICAgb3AgPSBcIjxcIjtcbiAgICB9XG4gICAgY29uZGl0aW9uICs9IGB1bnByb2plY3RlZFtqLSR7ZGlzdGFuY2UgLSB0YWJsZX1dWycke2tleX0nXSAke29wfSBpdGVtJHt0YWJsZX1bJyR7a2V5fSddYDtcbiAgICBjb25kaXRpb25zLnB1c2goY29uZGl0aW9uKTtcbiAgICBwYXRoLnB1c2goc29ydCk7XG4gIH1cbiAgbGV0IGl0ZW1zID0gW107XG4gIGxldCByZXBvc2l0aW9uZWQgPSBbXTtcbiAgbGV0IGl0ZW1Bc3NpZ25tZW50cyA9IFtdO1xuICBmb3IobGV0IGl4ID0gMDsgaXggPCBkaXN0YW5jZTsgaXgrKykge1xuICAgIGl0ZW1zLnB1c2goYGl0ZW0ke2l4fSA9IHVucHJvamVjdGVkW2orJHtpeH1dYCk7XG4gICAgcmVwb3NpdGlvbmVkLnB1c2goYHVucHJvamVjdGVkW2orJHtpeH1dID0gdW5wcm9qZWN0ZWRbaiAtICR7ZGlzdGFuY2UgLSBpeH1dYCk7XG4gICAgaXRlbUFzc2lnbm1lbnRzLnB1c2goKGB1bnByb2plY3RlZFtqKyR7aXh9XSA9IGl0ZW0ke2l4fWApKTtcbiAgfVxuICByZXR1cm4gYGZvciAodmFyIGkgPSAwLCBsZW4gPSB1bnByb2plY3RlZC5sZW5ndGg7IGkgPCBsZW47IGkgKz0gJHtkaXN0YW5jZX0pIHtcbiAgICAgIHZhciBqID0gaSwgJHtpdGVtcy5qb2luKFwiLCBcIil9O1xuICAgICAgZm9yKDsgaiA+ICR7ZGlzdGFuY2UgLSAxfSAmJiAoJHtjb25kaXRpb25zLmpvaW4oXCIgfHwgXCIpfSk7IGogLT0gJHtkaXN0YW5jZX0pIHtcbiAgICAgICAgJHtyZXBvc2l0aW9uZWQuam9pbihcIjtcXG5cIil9XG4gICAgICB9XG4gICAgICAke2l0ZW1Bc3NpZ25tZW50cy5qb2luKFwiO1xcblwiKX1cbiAgfWA7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlQ29sbGVjdG9yKGtleXMpIHtcbiAgbGV0IGNvZGUgPSBgdmFyIHJ1bnRpbWUgPSB0aGlzO1xcbmA7XG4gIGxldCBpeCA9IDA7XG4gIGxldCBjaGVja3MgPSBcIlwiO1xuICBsZXQgcmVtb3ZlcyA9IFwidmFyIGN1ciA9IGluZGV4XCI7XG4gIGZvcihsZXQga2V5IG9mIGtleXMpIHtcbiAgICBpZihrZXkuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICByZW1vdmVzICs9IGBbcmVtb3ZlWycke2tleVswXX0nXVsnJHtrZXlbMV19J11dYDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVtb3ZlcyArPSBgW3JlbW92ZVsnJHtrZXl9J11dYDtcbiAgICB9XG4gIH1cbiAgcmVtb3ZlcyArPSBcIjtcXG5ydW50aW1lLnJlbW92ZUZhY3QoY3VyLCByZW1vdmUpO1wiO1xuICBmb3IobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgaXgrKztcbiAgICBpZihrZXkuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICBjaGVja3MgKz0gYHZhbHVlID0gYWRkWycke2tleVswXX0nXVsnJHtrZXlbMV19J11cXG5gO1xuICAgIH0gZWxzZSB7XG4gICAgICBjaGVja3MgKz0gYHZhbHVlID0gYWRkWycke2tleX0nXVxcbmA7XG4gICAgfVxuICAgIGxldCBwYXRoID0gYGN1cnNvclt2YWx1ZV1gO1xuICAgIGNoZWNrcyArPSBgaWYoISR7cGF0aH0pICR7cGF0aH0gPSBgO1xuICAgIGlmKGl4ID09PSBrZXlzLmxlbmd0aCkge1xuICAgICAgY2hlY2tzICs9IFwiW11cXG5cIjtcbiAgICB9IGVsc2Uge1xuICAgICAgY2hlY2tzICs9IFwie31cXG5cIjtcbiAgICB9XG4gICAgY2hlY2tzICs9IGBjdXJzb3IgPSAke3BhdGh9XFxuYDtcbiAgfVxuICBjb2RlICs9IGBcbmZvcih2YXIgaXggPSAwLCBsZW4gPSByZW1vdmVzLmxlbmd0aDsgaXggPCBsZW47IGl4KyspIHtcbnZhciByZW1vdmUgPSByZW1vdmVzW2l4XTtcbiR7cmVtb3Zlc31cbn1cbmZvcih2YXIgaXggPSAwLCBsZW4gPSBhZGRzLmxlbmd0aDsgaXggPCBsZW47IGl4KyspIHtcbnZhciBhZGQgPSBhZGRzW2l4XTtcbnZhciBjdXJzb3IgPSBpbmRleDtcbnZhciB2YWx1ZTtcbiR7Y2hlY2tzfSAgY3Vyc29yLnB1c2goYWRkKTtcbn1cbnJldHVybiBpbmRleDtgXG4gIHJldHVybiAobmV3IEZ1bmN0aW9uKFwiaW5kZXhcIiwgXCJhZGRzXCIsIFwicmVtb3Zlc1wiLCBjb2RlKSkuYmluZChydW50aW1lKTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVDb2xsZWN0b3IyKGtleXMpIHtcbiAgbGV0IGhhc2hQYXJ0cyA9IFtdO1xuICBmb3IobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgaWYoa2V5LmNvbnN0cnVjdG9yID09PSBBcnJheSkge1xuICAgICAgaGFzaFBhcnRzLnB1c2goYGFkZFsnJHtrZXlbMF19J11bJyR7a2V5WzFdfSddYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGhhc2hQYXJ0cy5wdXNoKGBhZGRbJyR7a2V5fSddYCk7XG4gICAgfVxuICB9XG4gIGxldCBjb2RlID0gYFxuICAgIHZhciBpeENhY2hlID0gY2FjaGUuaXg7XG4gICAgdmFyIGlkQ2FjaGUgPSBjYWNoZS5pZDtcbiAgICBmb3IodmFyIGl4ID0gMCwgbGVuID0gcmVtb3Zlcy5sZW5ndGg7IGl4IDwgbGVuOyBpeCsrKSB7XG4gICAgICB2YXIgcmVtb3ZlID0gcmVtb3Zlc1tpeF07XG4gICAgICB2YXIgaWQgPSByZW1vdmUuX19pZDtcbiAgICAgIHZhciBrZXkgPSBpZENhY2hlW2lkXTtcbiAgICAgIHZhciBmYWN0SXggPSBpeENhY2hlW2lkXTtcbiAgICAgIHZhciBmYWN0cyA9IGluZGV4W2tleV07XG4gICAgICAvL3N3YXAgdGhlIGxhc3QgZmFjdCB3aXRoIHRoaXMgb25lIHRvIHByZXZlbnQgaG9sZXNcbiAgICAgIHZhciBsYXN0RmFjdCA9IGZhY3RzLnBvcCgpO1xuICAgICAgaWYobGFzdEZhY3QgJiYgbGFzdEZhY3QuX19pZCAhPT0gcmVtb3ZlLl9faWQpIHtcbiAgICAgICAgZmFjdHNbZmFjdEl4XSA9IGxhc3RGYWN0O1xuICAgICAgICBpeENhY2hlW2xhc3RGYWN0Ll9faWRdID0gZmFjdEl4O1xuICAgICAgfSBlbHNlIGlmKGZhY3RzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBkZWxldGUgaW5kZXhba2V5XTtcbiAgICAgIH1cbiAgICAgIGRlbGV0ZSBpZENhY2hlW2lkXTtcbiAgICAgIGRlbGV0ZSBpeENhY2hlW2lkXTtcbiAgICB9XG4gICAgZm9yKHZhciBpeCA9IDAsIGxlbiA9IGFkZHMubGVuZ3RoOyBpeCA8IGxlbjsgaXgrKykge1xuICAgICAgdmFyIGFkZCA9IGFkZHNbaXhdO1xuICAgICAgdmFyIGlkID0gYWRkLl9faWQ7XG4gICAgICB2YXIga2V5ID0gaWRDYWNoZVtpZF0gPSAke2hhc2hQYXJ0cy5qb2luKFwiICsgJ3wnICsgXCIpfTtcbiAgICAgIGlmKGluZGV4W2tleV0gPT09IHVuZGVmaW5lZCkgaW5kZXhba2V5XSA9IFtdO1xuICAgICAgdmFyIGFyciA9IGluZGV4W2tleV07XG4gICAgICBpeENhY2hlW2lkXSA9IGFyci5sZW5ndGg7XG4gICAgICBhcnIucHVzaChhZGQpO1xuICAgIH1cbiAgICByZXR1cm4gaW5kZXg7YDtcbiAgICByZXR1cm4gbmV3IEZ1bmN0aW9uKFwiaW5kZXhcIiwgXCJhZGRzXCIsIFwicmVtb3Zlc1wiLCBcImNhY2hlXCIsIGNvZGUpO1xufVxuXG5mdW5jdGlvbiBtZXJnZUFycmF5cyhhcywgYnMpIHtcbiAgbGV0IGl4ID0gYXMubGVuZ3RoO1xuICBsZXQgc3RhcnQgPSBpeDtcbiAgZm9yKGxldCBiIG9mIGJzKSB7XG4gICAgYXNbaXhdID0gYnNbaXggLSBzdGFydF07XG4gICAgaXgrKztcbiAgfVxuICByZXR1cm4gYXM7XG59XG5cbmV4cG9ydCBjbGFzcyBEaWZmIHtcbiAgdGFibGVzO1xuICBsZW5ndGg7XG4gIGl4ZXI7XG4gIG1ldGE7XG4gIGNvbnN0cnVjdG9yKGl4ZXIpIHtcbiAgICB0aGlzLml4ZXIgPSBpeGVyO1xuICAgIHRoaXMudGFibGVzID0ge307XG4gICAgdGhpcy5sZW5ndGggPSAwO1xuICAgIHRoaXMubWV0YSA9IHt9O1xuICB9XG4gIGVuc3VyZVRhYmxlKHRhYmxlKSB7XG4gICAgbGV0IHRhYmxlRGlmZiA9IHRoaXMudGFibGVzW3RhYmxlXTtcbiAgICBpZighdGFibGVEaWZmKSB7XG4gICAgICB0YWJsZURpZmYgPSB0aGlzLnRhYmxlc1t0YWJsZV0gPSB7YWRkczogW10sIHJlbW92ZXM6IFtdfTtcbiAgICB9XG4gICAgcmV0dXJuIHRhYmxlRGlmZjtcbiAgfVxuICBhZGQodGFibGUsIG9iaikge1xuICAgIGxldCB0YWJsZURpZmYgPSB0aGlzLmVuc3VyZVRhYmxlKHRhYmxlKTtcbiAgICB0aGlzLmxlbmd0aCsrO1xuICAgIHRhYmxlRGlmZi5hZGRzLnB1c2gob2JqKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBhZGRNYW55KHRhYmxlLCBvYmpzKSB7XG4gICAgbGV0IHRhYmxlRGlmZiA9IHRoaXMuZW5zdXJlVGFibGUodGFibGUpO1xuICAgIHRoaXMubGVuZ3RoICs9IG9ianMubGVuZ3RoO1xuICAgIG1lcmdlQXJyYXlzKHRhYmxlRGlmZi5hZGRzLCBvYmpzKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICByZW1vdmVGYWN0cyh0YWJsZSwgb2Jqcykge1xuICAgIGxldCB0YWJsZURpZmYgPSB0aGlzLmVuc3VyZVRhYmxlKHRhYmxlKTtcbiAgICB0aGlzLmxlbmd0aCArPSBvYmpzLmxlbmd0aDtcbiAgICBtZXJnZUFycmF5cyh0YWJsZURpZmYucmVtb3Zlcywgb2Jqcyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgcmVtb3ZlKHRhYmxlLCBxdWVyeT8pIHtcbiAgICBsZXQgdGFibGVEaWZmID0gdGhpcy5lbnN1cmVUYWJsZSh0YWJsZSk7XG4gICAgbGV0IGZvdW5kID0gdGhpcy5peGVyLmZpbmQodGFibGUsIHF1ZXJ5KTtcbiAgICB0aGlzLmxlbmd0aCArPSBmb3VuZC5sZW5ndGg7XG4gICAgbWVyZ2VBcnJheXModGFibGVEaWZmLnJlbW92ZXMsIGZvdW5kKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBtZXJnZShkaWZmKSB7XG4gICAgZm9yKGxldCB0YWJsZSBpbiBkaWZmLnRhYmxlcykge1xuICAgICAgbGV0IHRhYmxlRGlmZiA9IGRpZmYudGFibGVzW3RhYmxlXTtcbiAgICAgIHRoaXMuYWRkTWFueSh0YWJsZSwgdGFibGVEaWZmLmFkZHMpO1xuICAgICAgdGhpcy5yZW1vdmVGYWN0cyh0YWJsZSwgdGFibGVEaWZmLnJlbW92ZXMpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICByZXZlcnNlKCkge1xuICAgIGxldCByZXZlcnNlZCA9IG5ldyBEaWZmKHRoaXMuaXhlcik7XG4gICAgZm9yKGxldCB0YWJsZSBpbiB0aGlzLnRhYmxlcykge1xuICAgICAgbGV0IGRpZmYgPSB0aGlzLnRhYmxlc1t0YWJsZV07XG4gICAgICByZXZlcnNlZC5hZGRNYW55KHRhYmxlLCBkaWZmLnJlbW92ZXMpO1xuICAgICAgcmV2ZXJzZWQucmVtb3ZlRmFjdHModGFibGUsIGRpZmYuYWRkcyk7XG4gICAgfVxuICAgIHJldHVybiByZXZlcnNlZDtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSW5kZXhlciB7XG4gIHRhYmxlcztcbiAgZ2xvYmFsQ291bnQ7XG4gIGVkYlRhYmxlcztcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy50YWJsZXMgPSB7fTtcbiAgICB0aGlzLmdsb2JhbENvdW50ID0gMDtcbiAgICB0aGlzLmVkYlRhYmxlcyA9IHt9O1xuICB9XG4gIGFkZFRhYmxlKG5hbWUsIGtleXMgPSBbXSkge1xuICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW25hbWVdO1xuICAgIGtleXMgPSBrZXlzLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiX19pZFwiKTtcbiAgICBpZih0YWJsZSAmJiBrZXlzLmxlbmd0aCkge1xuICAgICAgdGFibGUuZmllbGRzID0ga2V5cztcbiAgICAgIHRhYmxlLnN0cmluZ2lmeSA9IGdlbmVyYXRlU3RyaW5nRm4oa2V5cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhYmxlID0gdGhpcy50YWJsZXNbbmFtZV0gPSB7dGFibGU6IFtdLCBoYXNoVG9JeDoge30sIGZhY3RIYXNoOiB7fSwgaW5kZXhlczoge30sIHRyaWdnZXJzOiB7fSwgZmllbGRzOiBrZXlzLCBzdHJpbmdpZnk6IGdlbmVyYXRlU3RyaW5nRm4oa2V5cyksIGtleUxvb2t1cDoge319O1xuICAgICAgdGhpcy5lZGJUYWJsZXNbbmFtZV0gPSB0cnVlO1xuICAgIH1cbiAgICBmb3IobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgICBpZihrZXkuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICAgIHRhYmxlLmtleUxvb2t1cFtrZXlbMF1dID0ga2V5O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGFibGUua2V5TG9va3VwW2tleV0gPSBrZXk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0YWJsZTtcbiAgfVxuICBjbGVhclRhYmxlKG5hbWUpIHtcbiAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlc1tuYW1lXTtcbiAgICBpZighdGFibGUpIHJldHVybjtcblxuICAgIHRhYmxlLnRhYmxlID0gW107XG4gICAgdGFibGUuZmFjdEhhc2ggPSB7fTtcbiAgICBmb3IobGV0IGluZGV4TmFtZSBpbiB0YWJsZS5pbmRleGVzKSB7XG4gICAgICB0YWJsZS5pbmRleGVzW2luZGV4TmFtZV0uaW5kZXggPSB7fTtcbiAgICAgIHRhYmxlLmluZGV4ZXNbaW5kZXhOYW1lXS5jYWNoZSA9IHtpZDoge30sIGl4OiB7fX07XG4gICAgfVxuICB9XG4gIHVwZGF0ZVRhYmxlKHRhYmxlSWQsIGFkZHMsIHJlbW92ZXMpIHtcbiAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlc1t0YWJsZUlkXTtcbiAgICBpZighdGFibGUgfHwgIXRhYmxlLmZpZWxkcy5sZW5ndGgpIHtcbiAgICAgIGxldCBleGFtcGxlID0gYWRkc1swXSB8fCByZW1vdmVzWzBdO1xuICAgICAgdGFibGUgPSB0aGlzLmFkZFRhYmxlKHRhYmxlSWQsIE9iamVjdC5rZXlzKGV4YW1wbGUpKTtcbiAgICB9XG4gICAgbGV0IHN0cmluZ2lmeSA9IHRhYmxlLnN0cmluZ2lmeTtcbiAgICBsZXQgZmFjdHMgPSB0YWJsZS50YWJsZTtcbiAgICBsZXQgZmFjdEhhc2ggPSB0YWJsZS5mYWN0SGFzaDtcbiAgICBsZXQgaGFzaFRvSXggPSB0YWJsZS5oYXNoVG9JeDtcbiAgICBsZXQgbG9jYWxIYXNoID0ge307XG4gICAgbGV0IGhhc2hUb0ZhY3QgPSB7fTtcbiAgICBsZXQgaGFzaGVzID0gW107XG4gICAgZm9yKGxldCBhZGQgb2YgYWRkcykge1xuICAgICAgbGV0IGhhc2ggPSBhZGQuX19pZCB8fCBzdHJpbmdpZnkoYWRkKTtcbiAgICAgIGlmKGxvY2FsSGFzaFtoYXNoXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvY2FsSGFzaFtoYXNoXSA9IDE7XG4gICAgICAgIGhhc2hUb0ZhY3RbaGFzaF0gPSBhZGQ7XG4gICAgICAgIGhhc2hlcy5wdXNoKGhhc2gpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9jYWxIYXNoW2hhc2hdKys7XG4gICAgICB9XG4gICAgICBhZGQuX19pZCA9IGhhc2g7XG4gICAgfVxuICAgIGZvcihsZXQgcmVtb3ZlIG9mIHJlbW92ZXMpIHtcbiAgICAgIGxldCBoYXNoID0gcmVtb3ZlLl9faWQgfHwgc3RyaW5naWZ5KHJlbW92ZSk7XG4gICAgICBpZihsb2NhbEhhc2hbaGFzaF0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBsb2NhbEhhc2hbaGFzaF0gPSAtMTtcbiAgICAgICAgaGFzaFRvRmFjdFtoYXNoXSA9IHJlbW92ZTtcbiAgICAgICAgaGFzaGVzLnB1c2goaGFzaCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2NhbEhhc2hbaGFzaF0tLTtcbiAgICAgIH1cbiAgICAgIHJlbW92ZS5fX2lkID0gaGFzaDtcbiAgICB9XG4gICAgbGV0IHJlYWxBZGRzID0gW107XG4gICAgbGV0IHJlYWxSZW1vdmVzID0gW107XG4gICAgZm9yKGxldCBoYXNoIG9mIGhhc2hlcykge1xuICAgICAgbGV0IGNvdW50ID0gbG9jYWxIYXNoW2hhc2hdO1xuICAgICAgaWYoY291bnQgPiAwICYmICFmYWN0SGFzaFtoYXNoXSkge1xuICAgICAgICBsZXQgZmFjdCA9IGhhc2hUb0ZhY3RbaGFzaF07XG4gICAgICAgIHJlYWxBZGRzLnB1c2goZmFjdCk7XG4gICAgICAgIGZhY3RzLnB1c2goZmFjdCk7XG4gICAgICAgIGZhY3RIYXNoW2hhc2hdID0gZmFjdDtcbiAgICAgICAgaGFzaFRvSXhbaGFzaF0gPSBmYWN0cy5sZW5ndGggLSAxO1xuICAgICAgfSBlbHNlIGlmKGNvdW50IDwgMCAmJiBmYWN0SGFzaFtoYXNoXSkge1xuICAgICAgICBsZXQgZmFjdCA9IGhhc2hUb0ZhY3RbaGFzaF07XG4gICAgICAgIGxldCBpeCA9IGhhc2hUb0l4W2hhc2hdO1xuICAgICAgICAvL3N3YXAgdGhlIGxhc3QgZmFjdCB3aXRoIHRoaXMgb25lIHRvIHByZXZlbnQgaG9sZXNcbiAgICAgICAgbGV0IGxhc3RGYWN0ID0gZmFjdHMucG9wKCk7XG4gICAgICAgIGlmKGxhc3RGYWN0ICYmIGxhc3RGYWN0Ll9faWQgIT09IGZhY3QuX19pZCkge1xuICAgICAgICAgIGZhY3RzW2l4XSA9IGxhc3RGYWN0O1xuICAgICAgICAgIGhhc2hUb0l4W2xhc3RGYWN0Ll9faWRdID0gaXg7XG4gICAgICAgIH1cbiAgICAgICAgcmVhbFJlbW92ZXMucHVzaChmYWN0KTtcbiAgICAgICAgZGVsZXRlIGZhY3RIYXNoW2hhc2hdO1xuICAgICAgICBkZWxldGUgaGFzaFRvSXhbaGFzaF07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7YWRkczpyZWFsQWRkcywgcmVtb3ZlczpyZWFsUmVtb3Zlc307XG4gIH1cblxuICBjb2xsZWN0b3Ioa2V5cykge1xuICAgIHJldHVybiB7XG4gICAgICBpbmRleDoge30sXG4gICAgICBjYWNoZToge2lkOiB7fSwgaXg6IHt9fSxcbiAgICAgIGhhc2hlcjogZ2VuZXJhdGVTdHJpbmdGbihrZXlzKSxcbiAgICAgIGNvbGxlY3Q6IGdlbmVyYXRlQ29sbGVjdG9yMihrZXlzKSxcbiAgICB9XG4gIH1cbiAgZmFjdFRvSW5kZXgodGFibGUsIGZhY3QpIHtcbiAgICBsZXQga2V5cyA9IE9iamVjdC5rZXlzKGZhY3QpO1xuICAgIGlmKCFrZXlzLmxlbmd0aCkgcmV0dXJuIHRhYmxlLnRhYmxlLnNsaWNlKCk7XG4gICAgbGV0IGluZGV4ID0gdGhpcy5pbmRleCh0YWJsZSwga2V5cyk7XG4gICAgbGV0IHJlc3VsdCA9IGluZGV4LmluZGV4W2luZGV4Lmhhc2hlcihmYWN0KV07XG4gICAgaWYocmVzdWx0KSB7XG4gICAgICByZXR1cm4gcmVzdWx0LnNsaWNlKCk7XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuICBleGVjRGlmZihkaWZmOiBEaWZmKToge3RyaWdnZXJzOiBhbnksIHJlYWxEaWZmczogYW55fSB7XG4gICAgbGV0IHRyaWdnZXJzID0ge307XG4gICAgbGV0IHJlYWxEaWZmcyA9IHt9O1xuICAgIGxldCB0YWJsZUlkcyA9IE9iamVjdC5rZXlzKGRpZmYudGFibGVzKTtcbiAgICBmb3IobGV0IHRhYmxlSWQgb2YgdGFibGVJZHMpIHtcbiAgICAgIGxldCB0YWJsZURpZmYgPSBkaWZmLnRhYmxlc1t0YWJsZUlkXTtcbiAgICAgIGlmKHRhYmxlRGlmZi5hZGRzLmxlbmd0aCA9PT0gMCAmJiB0YWJsZURpZmYucmVtb3Zlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgbGV0IHJlYWxEaWZmID0gdGhpcy51cGRhdGVUYWJsZSh0YWJsZUlkLCB0YWJsZURpZmYuYWRkcywgdGFibGVEaWZmLnJlbW92ZXMpO1xuICAgICAgLy8gZ28gdGhyb3VnaCBhbGwgdGhlIGluZGV4ZXMgYW5kIHVwZGF0ZSB0aGVtLlxuICAgICAgbGV0IHRhYmxlID0gdGhpcy50YWJsZXNbdGFibGVJZF07XG4gICAgICBsZXQgaW5kZXhlcyA9IE9iamVjdC5rZXlzKHRhYmxlLmluZGV4ZXMpO1xuICAgICAgZm9yKGxldCBpbmRleE5hbWUgb2YgaW5kZXhlcykge1xuICAgICAgICBsZXQgaW5kZXggPSB0YWJsZS5pbmRleGVzW2luZGV4TmFtZV07XG4gICAgICAgIGluZGV4LmNvbGxlY3QoaW5kZXguaW5kZXgsIHJlYWxEaWZmLmFkZHMsIHJlYWxEaWZmLnJlbW92ZXMsIGluZGV4LmNhY2hlKTtcbiAgICAgIH1cbiAgICAgIGxldCBjdXJUcmlnZ2VycyA9IE9iamVjdC5rZXlzKHRhYmxlLnRyaWdnZXJzKTtcbiAgICAgIGZvcihsZXQgdHJpZ2dlck5hbWUgb2YgY3VyVHJpZ2dlcnMpIHtcbiAgICAgICAgbGV0IHRyaWdnZXIgPSB0YWJsZS50cmlnZ2Vyc1t0cmlnZ2VyTmFtZV07XG4gICAgICAgIHRyaWdnZXJzW3RyaWdnZXJOYW1lXSA9IHRyaWdnZXI7XG4gICAgICB9XG4gICAgICByZWFsRGlmZnNbdGFibGVJZF0gPSByZWFsRGlmZjtcbiAgICB9XG4gICAgcmV0dXJuIHt0cmlnZ2VycywgcmVhbERpZmZzfTtcbiAgfVxuICBleGVjVHJpZ2dlcih0cmlnZ2VyKSB7XG4gICAgbGV0IHRhYmxlID0gdGhpcy50YWJsZSh0cmlnZ2VyLm5hbWUpXG4gICAgLy8gc2luY2Ugdmlld3MgbWlnaHQgYmUgY2hhbmdlZCBkdXJpbmcgdGhlIHRyaWdnZXJpbmcgcHJvY2Vzcywgd2Ugd2FudCB0byBmYXZvclxuICAgIC8vIGp1c3QgdXNpbmcgdGhlIHZpZXcgaXRzZWxmIGFzIHRoZSB0cmlnZ2VyIGlmIGl0IGlzIG9uZS4gT3RoZXJ3aXNlLCB3ZSB1c2UgdGhlXG4gICAgLy8gdHJpZ2dlcidzIGV4ZWMgZnVuY3Rpb24uIFRoaXMgZW5zdXJlcyB0aGF0IGlmIGEgdmlldyBpcyByZWNvbXBpbGVkIGFuZCBhZGRlZFxuICAgIC8vIHRoYXQgYW55IGFscmVhZHkgcXVldWVkIHRyaWdnZXJzIHdpbGwgdXNlIHRoZSB1cGRhdGVkIHZlcnNpb24gb2YgdGhlIHZpZXcgaW5zdGVhZFxuICAgIC8vIG9mIHRoZSBvbGQgcXVldWVkIG9uZS5cbiAgICBsZXQge3Jlc3VsdHMgPSB1bmRlZmluZWQsIHVucHJvamVjdGVkID0gdW5kZWZpbmVkfSA9ICh0YWJsZS52aWV3ID8gdGFibGUudmlldy5leGVjKCkgOiB0cmlnZ2VyLmV4ZWModGhpcykpIHx8IHt9O1xuICAgIGlmKCFyZXN1bHRzKSByZXR1cm47XG4gICAgbGV0IHByZXZSZXN1bHRzID0gdGFibGUuZmFjdEhhc2g7XG4gICAgbGV0IHByZXZIYXNoZXMgPSBPYmplY3Qua2V5cyhwcmV2UmVzdWx0cyk7XG4gICAgdGFibGUudW5wcm9qZWN0ZWQgPSB1bnByb2plY3RlZDtcbiAgICBpZihyZXN1bHRzKSB7XG4gICAgICBsZXQgZGlmZiA9IG5ldyBEaWZmKHRoaXMpO1xuICAgICAgdGhpcy5jbGVhclRhYmxlKHRyaWdnZXIubmFtZSk7XG4gICAgICBkaWZmLmFkZE1hbnkodHJpZ2dlci5uYW1lLCByZXN1bHRzKTtcbiAgICAgIGxldCB7dHJpZ2dlcnN9ID0gdGhpcy5leGVjRGlmZihkaWZmKTtcbiAgICAgIGxldCBuZXdIYXNoZXMgPSB0YWJsZS5mYWN0SGFzaDtcbiAgICAgIGlmKHByZXZIYXNoZXMubGVuZ3RoID09PSBPYmplY3Qua2V5cyhuZXdIYXNoZXMpLmxlbmd0aCkge1xuICAgICAgICBsZXQgc2FtZSA9IHRydWU7XG4gICAgICAgIGZvcihsZXQgaGFzaCBvZiBwcmV2SGFzaGVzKSB7XG4gICAgICAgICAgaWYoIW5ld0hhc2hlc1toYXNoXSkge1xuICAgICAgICAgICAgc2FtZSA9IGZhbHNlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzYW1lID8gdW5kZWZpbmVkIDogdHJpZ2dlcnM7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdHJpZ2dlcnM7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICB0cmFuc2l0aXZlbHlDbGVhclRyaWdnZXJzKHN0YXJ0aW5nVHJpZ2dlcnMpIHtcbiAgICBsZXQgY2xlYXJlZCA9IHt9O1xuICAgIGxldCByZW1haW5pbmcgPSBPYmplY3Qua2V5cyhzdGFydGluZ1RyaWdnZXJzKTtcblxuICAgIGZvcihsZXQgaXggPSAwOyBpeCA8IHJlbWFpbmluZy5sZW5ndGg7IGl4KyspIHtcbiAgICAgIGxldCB0cmlnZ2VyID0gcmVtYWluaW5nW2l4XTtcbiAgICAgIGlmKGNsZWFyZWRbdHJpZ2dlcl0pIGNvbnRpbnVlO1xuICAgICAgdGhpcy5jbGVhclRhYmxlKHRyaWdnZXIpO1xuICAgICAgY2xlYXJlZFt0cmlnZ2VyXSA9IHRydWU7XG4gICAgICByZW1haW5pbmcucHVzaC5hcHBseShyZW1haW5pbmcsIE9iamVjdC5rZXlzKHRoaXMudGFibGUodHJpZ2dlcikudHJpZ2dlcnMpKTtcbiAgICAgIC8vIGNvbnNvbGUubG9nKFwiQ0xFQVJFRDogXCIsIHRyaWdnZXIpO1xuICAgIH1cbiAgICByZXR1cm4gY2xlYXJlZDtcbiAgfVxuICBleGVjVHJpZ2dlcnModHJpZ2dlcnMpIHtcbiAgICBsZXQgbmV3VHJpZ2dlcnMgPSB7fTtcbiAgICBsZXQgcmV0cmlnZ2VyID0gZmFsc2U7XG4gICAgZm9yKGxldCB0cmlnZ2VyTmFtZSBpbiB0cmlnZ2Vycykge1xuICAgICAgLy8gY29uc29sZS5sb2coXCJDYWxsaW5nOlwiLCB0cmlnZ2VyTmFtZSk7XG4gICAgICBsZXQgdHJpZ2dlciA9IHRyaWdnZXJzW3RyaWdnZXJOYW1lXTtcbiAgICAgIGxldCBuZXh0Um91bmQgPSB0aGlzLmV4ZWNUcmlnZ2VyKHRyaWdnZXIpO1xuICAgICAgaWYobmV4dFJvdW5kKSB7XG4gICAgICAgIHJldHJpZ2dlciA9IHRydWU7XG4gICAgICAgIGZvcihsZXQgdHJpZ2dlciBpbiBuZXh0Um91bmQpIHtcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcIlF1ZXVpbmc6XCIsIHRyaWdnZXIpO1xuICAgICAgICAgIG5ld1RyaWdnZXJzW3RyaWdnZXJdID0gbmV4dFJvdW5kW3RyaWdnZXJdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmKHJldHJpZ2dlcikge1xuICAgICAgcmV0dXJuIG5ld1RyaWdnZXJzO1xuICAgIH1cbiAgfVxuICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBJbmRleGVyIFB1YmxpYyBBUElcbiAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgc2VyaWFsaXplKGFzT2JqZWN0Pykge1xuICAgIGxldCBkdW1wID0ge307XG4gICAgZm9yKGxldCB0YWJsZU5hbWUgaW4gdGhpcy50YWJsZXMpIHtcbiAgICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW3RhYmxlTmFtZV07XG4gICAgICBpZighdGFibGUuaXNWaWV3KSB7XG4gICAgICAgIGR1bXBbdGFibGVOYW1lXSA9IHRhYmxlLnRhYmxlO1xuICAgICAgfVxuICAgIH1cbiAgICBpZihhc09iamVjdCkge1xuICAgICAgcmV0dXJuIGR1bXA7XG4gICAgfVxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShkdW1wKTtcbiAgfVxuICBsb2FkKHNlcmlhbGl6ZWQpIHtcbiAgICBsZXQgZHVtcCA9IEpTT04ucGFyc2Uoc2VyaWFsaXplZCk7XG4gICAgbGV0IGRpZmYgPSB0aGlzLmRpZmYoKTtcbiAgICBmb3IobGV0IHRhYmxlTmFtZSBpbiBkdW1wKSB7XG4gICAgICBkaWZmLmFkZE1hbnkodGFibGVOYW1lLCBkdW1wW3RhYmxlTmFtZV0pO1xuICAgIH1cbiAgICBpZihJTkNSRU1FTlRBTCkge1xuICAgICAgdGhpcy5hcHBseURpZmZJbmNyZW1lbnRhbChkaWZmKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5hcHBseURpZmYoZGlmZik7XG4gICAgfVxuICB9XG4gIGRpZmYoKSB7XG4gICAgcmV0dXJuIG5ldyBEaWZmKHRoaXMpO1xuICB9XG4gIGFwcGx5RGlmZihkaWZmOkRpZmYpIHtcbiAgICBpZihJTkNSRU1FTlRBTCkge1xuICAgICAgcmV0dXJuIHRoaXMuYXBwbHlEaWZmSW5jcmVtZW50YWwoZGlmZik7XG4gICAgfVxuICAgIGxldCB7dHJpZ2dlcnMsIHJlYWxEaWZmc30gPSB0aGlzLmV4ZWNEaWZmKGRpZmYpO1xuICAgIGxldCBjbGVhcmVkO1xuICAgIGxldCByb3VuZCA9IDA7XG4gICAgaWYodHJpZ2dlcnMpIGNsZWFyZWQgPSB0aGlzLnRyYW5zaXRpdmVseUNsZWFyVHJpZ2dlcnModHJpZ2dlcnMpO1xuICAgIHdoaWxlKHRyaWdnZXJzKSB7XG4gICAgICBmb3IobGV0IHRyaWdnZXIgaW4gdHJpZ2dlcnMpIHtcbiAgICAgICAgY2xlYXJlZFt0cmlnZ2VyXSA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgLy8gY29uc29sZS5ncm91cChgUk9VTkQgJHtyb3VuZH1gKTtcbiAgICAgIHRyaWdnZXJzID0gdGhpcy5leGVjVHJpZ2dlcnModHJpZ2dlcnMpO1xuICAgICAgcm91bmQrKztcbiAgICAgIC8vIGNvbnNvbGUuZ3JvdXBFbmQoKTtcbiAgICB9XG4gICAgZm9yKGxldCB0cmlnZ2VyIG9mIE9iamVjdC5rZXlzKGNsZWFyZWQpKSB7XG4gICAgICBpZighY2xlYXJlZFt0cmlnZ2VyXSkgY29udGludWU7XG4gICAgICBsZXQgdmlldyA9IHRoaXMudGFibGUodHJpZ2dlcikudmlldztcbiAgICAgIGlmKHZpZXcpIHtcbiAgICAgICAgdGhpcy5leGVjVHJpZ2dlcih2aWV3KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgdGFibGUodGFibGVJZCkge1xuICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW3RhYmxlSWRdO1xuICAgIGlmKHRhYmxlKSByZXR1cm4gdGFibGU7XG4gICAgcmV0dXJuIHRoaXMuYWRkVGFibGUodGFibGVJZCk7XG4gIH1cbiAgaW5kZXgodGFibGVPcklkOnN0cmluZ3x7fSwga2V5czphbnlbXSkge1xuICAgIGxldCB0YWJsZTtcbiAgICBpZih0eXBlb2YgdGFibGVPcklkID09PSBcInN0cmluZ1wiKSB0YWJsZSA9IHRoaXMudGFibGUodGFibGVPcklkKTtcbiAgICBlbHNlIHRhYmxlID0gdGFibGVPcklkO1xuICAgIGtleXMuc29ydCgpO1xuICAgIGxldCBpbmRleE5hbWUgPSBrZXlzLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiX19pZFwiKS5qb2luKFwifFwiKTtcbiAgICBsZXQgaW5kZXggPSB0YWJsZS5pbmRleGVzW2luZGV4TmFtZV07XG4gICAgaWYoIWluZGV4KSB7XG4gICAgICBsZXQgdGFibGVLZXlzID0gW107XG4gICAgICBmb3IobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgICAgIHRhYmxlS2V5cy5wdXNoKHRhYmxlLmtleUxvb2t1cFtrZXldIHx8IGtleSk7XG4gICAgICB9XG4gICAgICBpbmRleCA9IHRhYmxlLmluZGV4ZXNbaW5kZXhOYW1lXSA9IHRoaXMuY29sbGVjdG9yKHRhYmxlS2V5cyk7XG4gICAgICBpbmRleC5jb2xsZWN0KGluZGV4LmluZGV4LCB0YWJsZS50YWJsZSwgW10sIGluZGV4LmNhY2hlKTtcbiAgICB9XG4gICAgcmV0dXJuIGluZGV4O1xuICB9XG4gIGZpbmQodGFibGVJZCwgcXVlcnk/KSB7XG4gICAgbGV0IHRhYmxlID0gdGhpcy50YWJsZXNbdGFibGVJZF07XG4gICAgaWYoIXRhYmxlKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIGlmKCFxdWVyeSkge1xuICAgICAgcmV0dXJuIHRhYmxlLnRhYmxlLnNsaWNlKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLmZhY3RUb0luZGV4KHRhYmxlLCBxdWVyeSk7XG4gICAgfVxuICB9XG4gIGZpbmRPbmUodGFibGVJZCwgcXVlcnk/KSB7XG4gICAgcmV0dXJuIHRoaXMuZmluZCh0YWJsZUlkLCBxdWVyeSlbMF07XG4gIH1cbiAgcXVlcnkobmFtZSA9IFwidW5rbm93blwiKSB7XG4gICAgcmV0dXJuIG5ldyBRdWVyeSh0aGlzLCBuYW1lKTtcbiAgfVxuICB1bmlvbihuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBVbmlvbih0aGlzLCBuYW1lKTtcbiAgfVxuICB0cmlnZ2VyKG5hbWU6c3RyaW5nLCB0YWJsZTpzdHJpbmd8c3RyaW5nW10sIGV4ZWM6KGl4ZXI6SW5kZXhlcikgPT4gdm9pZCwgZXhlY0luY3JlbWVudGFsPzooY2hhbmdlczphbnkpID0+IGFueSkge1xuICAgIGxldCB0YWJsZXMgPSAodHlwZW9mIHRhYmxlID09PSBcInN0cmluZ1wiKSA/IFt0YWJsZV0gOiB0YWJsZTtcbiAgICBsZXQgdHJpZ2dlciA9IHtuYW1lLCB0YWJsZXMsIGV4ZWMsIGV4ZWNJbmNyZW1lbnRhbH07XG4gICAgZm9yKGxldCB0YWJsZUlkIG9mIHRhYmxlcykge1xuICAgICAgbGV0IHRhYmxlID0gdGhpcy50YWJsZSh0YWJsZUlkKTtcbiAgICAgIHRhYmxlLnRyaWdnZXJzW25hbWVdID0gdHJpZ2dlcjtcbiAgICB9XG4gICAgaWYoIUlOQ1JFTUVOVEFMKSB7XG4gICAgICBsZXQgbmV4dFJvdW5kID0gdGhpcy5leGVjVHJpZ2dlcih0cmlnZ2VyKTtcbiAgICAgIHdoaWxlKG5leHRSb3VuZCkge1xuICAgICAgICBuZXh0Um91bmQgPSB0aGlzLmV4ZWNUcmlnZ2VycyhuZXh0Um91bmQpO1xuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYoIXRhYmxlcy5sZW5ndGgpIHsgcmV0dXJuIGV4ZWModGhpcyk7IH1cbiAgICAgIGxldCBpbml0aWFsID0ge1t0YWJsZXNbMF1dOiB7YWRkczogdGhpcy50YWJsZXNbdGFibGVzWzBdXS50YWJsZSwgcmVtb3ZlczogW119fTtcbiAgICAgIGxldCB7dHJpZ2dlcnMsIGNoYW5nZXN9ID0gdGhpcy5leGVjVHJpZ2dlckluY3JlbWVudGFsKHRyaWdnZXIsIGluaXRpYWwpO1xuICAgICAgd2hpbGUodHJpZ2dlcnMpIHtcbiAgICAgICAgbGV0IHJlc3VsdHMgPSB0aGlzLmV4ZWNUcmlnZ2Vyc0luY3JlbWVudGFsKHRyaWdnZXJzLCBjaGFuZ2VzKTtcbiAgICAgICAgaWYoIXJlc3VsdHMpIGJyZWFrXG4gICAgICAgIHRyaWdnZXJzID0gcmVzdWx0cy50cmlnZ2VycztcbiAgICAgICAgY2hhbmdlcyA9IHJlc3VsdHMuY2hhbmdlcztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc1ZpZXcocXVlcnk6UXVlcnl8VW5pb24pIHtcbiAgICBsZXQgbmFtZSA9IHF1ZXJ5Lm5hbWU7XG4gICAgaWYodGhpcy50YWJsZXNbbmFtZV0pIHtcbiAgICAgIHRoaXMucmVtb3ZlVmlldyhuYW1lKTtcbiAgICB9XG4gICAgbGV0IHZpZXcgPSB0aGlzLnRhYmxlKG5hbWUpO1xuICAgIHRoaXMuZWRiVGFibGVzW25hbWVdID0gZmFsc2U7XG4gICAgdmlldy52aWV3ID0gcXVlcnk7XG4gICAgdmlldy5pc1ZpZXcgPSB0cnVlO1xuICAgIHRoaXMudHJpZ2dlcihuYW1lLCBxdWVyeS50YWJsZXMsIHF1ZXJ5LmV4ZWMuYmluZChxdWVyeSksIHF1ZXJ5LmV4ZWNJbmNyZW1lbnRhbC5iaW5kKHF1ZXJ5KSk7XG4gIH1cbiAgcmVtb3ZlVmlldyhpZDpzdHJpbmcpIHtcbiAgICBmb3IobGV0IHRhYmxlIG9mIHRoaXMudGFibGVzKSB7XG4gICAgICBkZWxldGUgdGFibGUudHJpZ2dlcnNbaWRdO1xuICAgIH1cbiAgfVxuICB0b3RhbEZhY3RzKCkge1xuICAgIGxldCB0b3RhbCA9IDA7XG4gICAgZm9yKGxldCB0YWJsZU5hbWUgaW4gdGhpcy50YWJsZXMpIHtcbiAgICAgIHRvdGFsICs9IHRoaXMudGFibGVzW3RhYmxlTmFtZV0udGFibGUubGVuZ3RoO1xuICAgIH1cbiAgICByZXR1cm4gdG90YWw7XG4gIH1cbiAgZmFjdHNQZXJUYWJsZSgpIHtcbiAgICBsZXQgaW5mbyA9IHt9O1xuICAgIGZvcihsZXQgdGFibGVOYW1lIGluIHRoaXMudGFibGVzKSB7XG4gICAgICBpbmZvW3RhYmxlTmFtZV0gPSB0aGlzLnRhYmxlc1t0YWJsZU5hbWVdLnRhYmxlLmxlbmd0aDtcbiAgICB9XG4gICAgcmV0dXJuIGluZm87XG4gIH1cblxuICBhcHBseURpZmZJbmNyZW1lbnRhbChkaWZmOkRpZmYpIHtcbiAgICBpZihkaWZmLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIC8vIGNvbnNvbGUubG9nKFwiRElGRiBTSVpFOiBcIiwgZGlmZi5sZW5ndGgsIGRpZmYpO1xuXHRcdGxldCB7dHJpZ2dlcnMsIHJlYWxEaWZmc30gPSB0aGlzLmV4ZWNEaWZmKGRpZmYpO1xuXHRcdGxldCByb3VuZCA9IDA7XG4gICAgbGV0IGNoYW5nZXMgPSByZWFsRGlmZnM7XG5cdFx0d2hpbGUodHJpZ2dlcnMpIHtcblx0XHQgIC8vIGNvbnNvbGUuZ3JvdXAoYFJPVU5EICR7cm91bmR9YCk7XG4gICAgICAvLyBjb25zb2xlLmxvZyhcIkNIQU5HRVM6IFwiLCBjaGFuZ2VzKTtcblx0XHQgIGxldCByZXN1bHRzID0gdGhpcy5leGVjVHJpZ2dlcnNJbmNyZW1lbnRhbCh0cmlnZ2VycywgY2hhbmdlcyk7XG4gICAgICAvLyBjb25zb2xlLmdyb3VwRW5kKCk7XG4gICAgICBpZighcmVzdWx0cykgYnJlYWtcbiAgICAgIHRyaWdnZXJzID0gcmVzdWx0cy50cmlnZ2VycztcbiAgICAgIGNoYW5nZXMgPSByZXN1bHRzLmNoYW5nZXNcblx0XHQgIHJvdW5kKys7XG5cdFx0fVxuXHR9XG5cbiAgZXhlY1RyaWdnZXJJbmNyZW1lbnRhbCh0cmlnZ2VyLCBjaGFuZ2VzKTphbnkge1xuICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGUodHJpZ2dlci5uYW1lKTtcbiAgICBsZXQgYWRkcywgcHJvdmVuYW5jZSwgcmVtb3ZlcywgaW5mbztcbiAgICBpZih0cmlnZ2VyLmV4ZWNJbmNyZW1lbnRhbCkge1xuICAgICAgaW5mbyA9IHRyaWdnZXIuZXhlY0luY3JlbWVudGFsKGNoYW5nZXMsIHRhYmxlKSB8fCB7fTtcbiAgICAgIGFkZHMgPSBpbmZvLmFkZHM7XG4gICAgICByZW1vdmVzID0gaW5mby5yZW1vdmVzO1xuICAgIH0gZWxzZSB7XG4gICAgICB0cmlnZ2VyLmV4ZWMoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgbGV0IGRpZmYgPSBuZXcgcnVudGltZS5EaWZmKHRoaXMpO1xuICAgIGlmKGFkZHMubGVuZ3RoKSB7XG4gICAgICBkaWZmLmFkZE1hbnkodHJpZ2dlci5uYW1lLCBhZGRzKTtcbiAgICB9XG4gICAgaWYocmVtb3Zlcy5sZW5ndGgpIHtcbiAgICAgIGRpZmYucmVtb3ZlRmFjdHModHJpZ2dlci5uYW1lLCByZW1vdmVzKTtcbiAgICB9XG4gICAgbGV0IHVwZGF0ZWQgPSB0aGlzLmV4ZWNEaWZmKGRpZmYpO1xuICAgIGxldCB7cmVhbERpZmZzfSA9IHVwZGF0ZWQ7XG4gICAgaWYocmVhbERpZmZzW3RyaWdnZXIubmFtZV0gJiYgKHJlYWxEaWZmc1t0cmlnZ2VyLm5hbWVdLmFkZHMubGVuZ3RoIHx8IHJlYWxEaWZmc1t0cmlnZ2VyLm5hbWVdLnJlbW92ZXMpKSB7XG4gICAgICByZXR1cm4ge2NoYW5nZXM6IHJlYWxEaWZmc1t0cmlnZ2VyLm5hbWVdLCB0cmlnZ2VyczogdXBkYXRlZC50cmlnZ2Vyc307XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB7fTtcbiAgICB9XG4gIH1cblxuICBleGVjVHJpZ2dlcnNJbmNyZW1lbnRhbCh0cmlnZ2VycywgY2hhbmdlcykge1xuICAgIGxldCBuZXdUcmlnZ2VycyA9IHt9O1xuICAgIGxldCBuZXh0Q2hhbmdlcyA9IHt9O1xuICAgIGxldCByZXRyaWdnZXIgPSBmYWxzZTtcbiAgICBsZXQgdHJpZ2dlcktleXMgPSBPYmplY3Qua2V5cyh0cmlnZ2Vycyk7XG4gICAgZm9yKGxldCB0cmlnZ2VyTmFtZSBvZiB0cmlnZ2VyS2V5cykge1xuICAgICAgLy8gY29uc29sZS5sb2coXCJDYWxsaW5nOlwiLCB0cmlnZ2VyTmFtZSk7XG4gICAgICBsZXQgdHJpZ2dlciA9IHRyaWdnZXJzW3RyaWdnZXJOYW1lXTtcbiAgICAgIGxldCBuZXh0Um91bmQgPSB0aGlzLmV4ZWNUcmlnZ2VySW5jcmVtZW50YWwodHJpZ2dlciwgY2hhbmdlcyk7XG4gICAgICBpZihuZXh0Um91bmQgJiYgbmV4dFJvdW5kLmNoYW5nZXMpIHtcbiAgICAgICAgbmV4dENoYW5nZXNbdHJpZ2dlck5hbWVdID0gbmV4dFJvdW5kLmNoYW5nZXM7XG4gICAgICAgIGlmKG5leHRSb3VuZC50cmlnZ2Vycykge1xuXG4gICAgICAgICAgbGV0IG5leHRSb3VuZEtleXMgPSBPYmplY3Qua2V5cyhuZXh0Um91bmQudHJpZ2dlcnMpO1xuICAgICAgICAgIGZvcihsZXQgdHJpZ2dlciBvZiBuZXh0Um91bmRLZXlzKSB7XG4gICAgICAgICAgICBpZih0cmlnZ2VyICYmIG5leHRSb3VuZC50cmlnZ2Vyc1t0cmlnZ2VyXSkge1xuICAgICAgICAgICAgICByZXRyaWdnZXIgPSB0cnVlO1xuICAgICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcIlF1ZXVpbmc6XCIsIHRyaWdnZXIpO1xuICAgICAgICAgICAgICBuZXdUcmlnZ2Vyc1t0cmlnZ2VyXSA9IG5leHRSb3VuZC50cmlnZ2Vyc1t0cmlnZ2VyXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgaWYocmV0cmlnZ2VyKSB7XG4gICAgICByZXR1cm4ge2NoYW5nZXM6IG5leHRDaGFuZ2VzLCB0cmlnZ2VyczogbmV3VHJpZ2dlcnN9O1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkUHJvdmVuYW5jZVRhYmxlKGl4ZXIpIHtcbiAgbGV0IHRhYmxlID0gaXhlci5hZGRUYWJsZShcInByb3ZlbmFuY2VcIiwgW1widGFibGVcIiwgW1wicm93XCIsIFwiX19pZFwiXSwgXCJyb3cgaW5zdGFuY2VcIiwgXCJzb3VyY2VcIiwgW1wic291cmNlIHJvd1wiLCBcIl9faWRcIl1dKTtcbiAgLy8gZ2VuZXJhdGUgc29tZSBpbmRleGVzIHRoYXQgd2Uga25vdyB3ZSdyZSBnb2luZyB0byBuZWVkIHVwZnJvbnRcbiAgaXhlci5pbmRleChcInByb3ZlbmFuY2VcIiwgW1widGFibGVcIiwgXCJyb3dcIl0pO1xuICBpeGVyLmluZGV4KFwicHJvdmVuYW5jZVwiLCBbXCJ0YWJsZVwiLCBcInJvdyBpbnN0YW5jZVwiXSk7XG4gIGl4ZXIuaW5kZXgoXCJwcm92ZW5hbmNlXCIsIFtcInRhYmxlXCIsIFwic291cmNlXCIsIFwic291cmNlIHJvd1wiXSk7XG4gIGl4ZXIuaW5kZXgoXCJwcm92ZW5hbmNlXCIsIFtcInRhYmxlXCJdKTtcbiAgcmV0dXJuIGl4ZXI7XG59XG5cbmZ1bmN0aW9uIG1hcHBpbmdUb0RpZmYoZGlmZiwgYWN0aW9uLCBtYXBwaW5nLCBhbGlhc2VzLCByZXZlcnNlTG9va3VwKSB7XG4gIGZvcihsZXQgZnJvbSBpbiBtYXBwaW5nKSB7XG4gICAgbGV0IHRvID0gbWFwcGluZ1tmcm9tXTtcbiAgICBpZih0by5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpIHtcbiAgICAgIGxldCBzb3VyY2UgPSB0b1swXTtcbiAgICAgIGlmKHR5cGVvZiBzb3VyY2UgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgc291cmNlID0gYWxpYXNlc1tyZXZlcnNlTG9va3VwW3NvdXJjZV1dO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc291cmNlID0gYWxpYXNlc1tzb3VyY2VdO1xuICAgICAgfVxuICAgICAgZGlmZi5hZGQoXCJhY3Rpb24gbWFwcGluZ1wiLCB7YWN0aW9uLCBmcm9tLCBcInRvIHNvdXJjZVwiOiBzb3VyY2UsIFwidG8gZmllbGRcIjogdG9bMV19KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZGlmZi5hZGQoXCJhY3Rpb24gbWFwcGluZyBjb25zdGFudFwiLCB7YWN0aW9uLCBmcm9tLCB2YWx1ZTogdG99KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRpZmY7XG59XG5cbmV4cG9ydCB2YXIgUXVlcnlGdW5jdGlvbnMgPSB7fVxudmFyIFNUUklQX0NPTU1FTlRTID0gLygoXFwvXFwvLiokKXwoXFwvXFwqW1xcc1xcU10qP1xcKlxcLykpL21nO1xudmFyIEFSR1VNRU5UX05BTUVTID0gLyhbXlxccyxdKykvZztcbmZ1bmN0aW9uIGdldFBhcmFtTmFtZXMoZnVuYykge1xuICB2YXIgZm5TdHIgPSBmdW5jLnRvU3RyaW5nKCkucmVwbGFjZShTVFJJUF9DT01NRU5UUywgJycpO1xuICB2YXIgcmVzdWx0ID0gZm5TdHIuc2xpY2UoZm5TdHIuaW5kZXhPZignKCcpKzEsIGZuU3RyLmluZGV4T2YoJyknKSkubWF0Y2goQVJHVU1FTlRfTkFNRVMpO1xuICBpZihyZXN1bHQgPT09IG51bGwpXG4gICAgcmVzdWx0ID0gW107XG4gIHJldHVybiByZXN1bHQ7XG59XG5leHBvcnQgZnVuY3Rpb24gZGVmaW5lKG5hbWUsIG9wdHMsIGZ1bmMpIHtcbiAgbGV0IHBhcmFtcyA9IGdldFBhcmFtTmFtZXMoZnVuYyk7XG4gIG9wdHMubmFtZSA9IG5hbWU7XG4gIG9wdHMucGFyYW1zID0gcGFyYW1zO1xuICBvcHRzLmZ1bmMgPSBmdW5jO1xuICBRdWVyeUZ1bmN0aW9uc1tuYW1lXSA9IG9wdHM7XG59XG5cbmV4cG9ydCBjbGFzcyBRdWVyeSB7XG4gIHRhYmxlcztcbiAgam9pbnM7XG4gIGRpcnR5O1xuICBjb21waWxlZDtcbiAgaXhlcjtcbiAgYWxpYXNlcztcbiAgZnVuY3M7XG4gIG5hbWU7XG4gIHByb2plY3Rpb25NYXA7XG4gIGxpbWl0SW5mbztcbiAgZ3JvdXBzO1xuICBzb3J0cztcbiAgYWdncmVnYXRlcztcbiAgdW5wcm9qZWN0ZWRTaXplO1xuICBoYXNPcmRpbmFsO1xuICBpbmNyZW1lbnRhbFJvd0ZpbmRlcjtcblxuICBzdGF0aWMgcmVtb3ZlKHZpZXc6IHN0cmluZywgaXhlcjpJbmRleGVyKSB7XG4gICAgbGV0IGRpZmYgPSBpeGVyLmRpZmYoKTtcbiAgICBkaWZmLnJlbW92ZShcInZpZXdcIiwge3ZpZXd9KTtcbiAgICBmb3IobGV0IGFjdGlvbkl0ZW0gb2YgaXhlci5maW5kKFwiYWN0aW9uXCIsIHt2aWV3fSkpIHtcbiAgICAgIGxldCBhY3Rpb24gPSBhY3Rpb25JdGVtLmFjdGlvbjtcbiAgICAgIGRpZmYucmVtb3ZlKFwiYWN0aW9uXCIsIHthY3Rpb259KTtcbiAgICAgIGRpZmYucmVtb3ZlKFwiYWN0aW9uIHNvdXJjZVwiLCB7YWN0aW9ufSk7XG4gICAgICBkaWZmLnJlbW92ZShcImFjdGlvbiBtYXBwaW5nXCIsIHthY3Rpb259KTtcbiAgICAgIGRpZmYucmVtb3ZlKFwiYWN0aW9uIG1hcHBpbmcgY29uc3RhbnRcIiwge2FjdGlvbn0pO1xuICAgICAgZGlmZi5yZW1vdmUoXCJhY3Rpb24gbWFwcGluZyBzb3J0ZWRcIiwge2FjdGlvbn0pO1xuICAgICAgZGlmZi5yZW1vdmUoXCJhY3Rpb24gbWFwcGluZyBsaW1pdFwiLCB7YWN0aW9ufSk7XG4gICAgfVxuICAgIHJldHVybiBkaWZmO1xuICB9XG5cbiAgY29uc3RydWN0b3IoaXhlciwgbmFtZSA9IFwidW5rbm93blwiKSB7XG4gICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB0aGlzLml4ZXIgPSBpeGVyO1xuICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICAgIHRoaXMudGFibGVzID0gW107XG4gICAgdGhpcy5qb2lucyA9IFtdO1xuICAgIHRoaXMuYWxpYXNlcyA9IHt9O1xuICAgIHRoaXMuZnVuY3MgPSBbXTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBbXTtcbiAgICB0aGlzLnVucHJvamVjdGVkU2l6ZSA9IDA7XG4gICAgdGhpcy5oYXNPcmRpbmFsID0gZmFsc2U7XG4gIH1cbiAgY2hhbmdlc2V0KGl4ZXI6SW5kZXhlcikge1xuICAgIGxldCBkaWZmID0gaXhlci5kaWZmKCk7XG4gICAgbGV0IGFsaWFzZXMgPSB7fTtcbiAgICBsZXQgcmV2ZXJzZUxvb2t1cCA9IHt9O1xuICAgIGZvcihsZXQgYWxpYXMgaW4gdGhpcy5hbGlhc2VzKSB7XG4gICAgICByZXZlcnNlTG9va3VwW3RoaXMuYWxpYXNlc1thbGlhc11dID0gYWxpYXM7XG4gICAgfVxuICAgIGxldCB2aWV3ID0gdGhpcy5uYW1lO1xuICAgIGRpZmYuYWRkKFwidmlld1wiLCB7dmlldywga2luZDogXCJxdWVyeVwifSk7XG4gICAgLy9qb2luc1xuICAgIGZvcihsZXQgam9pbiBvZiB0aGlzLmpvaW5zKSB7XG4gICAgICBsZXQgYWN0aW9uID0gdXVpZCgpO1xuICAgICAgYWxpYXNlc1tqb2luLmFzXSA9IGFjdGlvbjtcbiAgICAgIGlmKCFqb2luLm5lZ2F0ZWQpIHtcbiAgICAgICAgZGlmZi5hZGQoXCJhY3Rpb25cIiwge3ZpZXcsIGFjdGlvbiwga2luZDogXCJzZWxlY3RcIiwgaXg6IGpvaW4uaXh9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpZmYuYWRkKFwiYWN0aW9uXCIsIHt2aWV3LCBhY3Rpb24sIGtpbmQ6IFwiZGVzZWxlY3RcIiwgaXg6IGpvaW4uaXh9KTtcbiAgICAgIH1cbiAgICAgIGRpZmYuYWRkKFwiYWN0aW9uIHNvdXJjZVwiLCB7YWN0aW9uLCBcInNvdXJjZSB2aWV3XCI6IGpvaW4udGFibGV9KTtcbiAgICAgIG1hcHBpbmdUb0RpZmYoZGlmZiwgYWN0aW9uLCBqb2luLmpvaW4sIGFsaWFzZXMsIHJldmVyc2VMb29rdXApO1xuICAgIH1cbiAgICAvL2Z1bmN0aW9uc1xuICAgIGZvcihsZXQgZnVuYyBvZiB0aGlzLmZ1bmNzKSB7XG4gICAgICBsZXQgYWN0aW9uID0gdXVpZCgpO1xuICAgICAgYWxpYXNlc1tmdW5jLmFzXSA9IGFjdGlvbjtcbiAgICAgIGRpZmYuYWRkKFwiYWN0aW9uXCIsIHt2aWV3LCBhY3Rpb24sIGtpbmQ6IFwiY2FsY3VsYXRlXCIsIGl4OiBmdW5jLml4fSk7XG4gICAgICBkaWZmLmFkZChcImFjdGlvbiBzb3VyY2VcIiwge2FjdGlvbiwgXCJzb3VyY2Ugdmlld1wiOiBmdW5jLm5hbWV9KTtcbiAgICAgIG1hcHBpbmdUb0RpZmYoZGlmZiwgYWN0aW9uLCBmdW5jLmFyZ3MsIGFsaWFzZXMsIHJldmVyc2VMb29rdXApO1xuICAgIH1cbiAgICAvL2FnZ3JlZ2F0ZXNcbiAgICBmb3IobGV0IGFnZyBvZiB0aGlzLmFnZ3JlZ2F0ZXMpIHtcbiAgICAgIGxldCBhY3Rpb24gPSB1dWlkKCk7XG4gICAgICBhbGlhc2VzW2FnZy5hc10gPSBhY3Rpb247XG4gICAgICBkaWZmLmFkZChcImFjdGlvblwiLCB7dmlldywgYWN0aW9uLCBraW5kOiBcImFnZ3JlZ2F0ZVwiLCBpeDogYWdnLml4fSk7XG4gICAgICBkaWZmLmFkZChcImFjdGlvbiBzb3VyY2VcIiwge2FjdGlvbiwgXCJzb3VyY2Ugdmlld1wiOiBhZ2cubmFtZX0pO1xuICAgICAgbWFwcGluZ1RvRGlmZihkaWZmLCBhY3Rpb24sIGFnZy5hcmdzLCBhbGlhc2VzLCByZXZlcnNlTG9va3VwKTtcbiAgICB9XG4gICAgLy9zb3J0XG4gICAgaWYodGhpcy5zb3J0cykge1xuICAgICAgbGV0IGFjdGlvbiA9IHV1aWQoKTtcbiAgICAgIGRpZmYuYWRkKFwiYWN0aW9uXCIsIHt2aWV3LCBhY3Rpb24sIGtpbmQ6IFwic29ydFwiLCBpeDogTUFYX05VTUJFUn0pO1xuICAgICAgbGV0IGl4ID0gMDtcbiAgICAgIGZvcihsZXQgc29ydCBvZiB0aGlzLnNvcnRzKSB7XG4gICAgICAgIGxldCBbc291cmNlLCBmaWVsZCwgZGlyZWN0aW9uXSA9IHNvcnQ7XG4gICAgICAgIGlmKHR5cGVvZiBzb3VyY2UgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICBzb3VyY2UgPSBhbGlhc2VzW3JldmVyc2VMb29rdXBbc291cmNlXV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc291cmNlID0gYWxpYXNlc1tzb3VyY2VdO1xuICAgICAgICB9XG4gICAgICAgIGRpZmYuYWRkKFwiYWN0aW9uIG1hcHBpbmcgc29ydGVkXCIsIHthY3Rpb24sIGl4LCBzb3VyY2UsIGZpZWxkLCBkaXJlY3Rpb259KTtcbiAgICAgICAgaXgrKztcbiAgICAgIH1cbiAgICB9XG4gICAgLy9ncm91cFxuICAgIGlmKHRoaXMuZ3JvdXBzKSB7XG4gICAgICBsZXQgYWN0aW9uID0gdXVpZCgpO1xuICAgICAgZGlmZi5hZGQoXCJhY3Rpb25cIiwge3ZpZXcsIGFjdGlvbiwga2luZDogXCJncm91cFwiLCBpeDogTUFYX05VTUJFUn0pO1xuICAgICAgbGV0IGl4ID0gMDtcbiAgICAgIGZvcihsZXQgZ3JvdXAgb2YgdGhpcy5ncm91cHMpIHtcbiAgICAgICAgbGV0IFtzb3VyY2UsIGZpZWxkXSA9IGdyb3VwO1xuICAgICAgICBpZih0eXBlb2Ygc291cmNlID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgc291cmNlID0gYWxpYXNlc1tyZXZlcnNlTG9va3VwW3NvdXJjZV1dO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNvdXJjZSA9IGFsaWFzZXNbc291cmNlXTtcbiAgICAgICAgfVxuICAgICAgICBkaWZmLmFkZChcImFjdGlvbiBtYXBwaW5nIHNvcnRlZFwiLCB7YWN0aW9uLCBpeCwgc291cmNlLCBmaWVsZCwgZGlyZWN0aW9uOiBcImFzY2VuZGluZ1wifSk7XG4gICAgICAgIGl4Kys7XG4gICAgICB9XG4gICAgfVxuICAgIC8vbGltaXRcbiAgICBpZih0aGlzLmxpbWl0SW5mbykge1xuICAgICAgbGV0IGFjdGlvbiA9IHV1aWQoKTtcbiAgICAgIGRpZmYuYWRkKFwiYWN0aW9uXCIsIHt2aWV3LCBhY3Rpb24sIGtpbmQ6IFwibGltaXRcIiwgaXg6IE1BWF9OVU1CRVJ9KTtcbiAgICAgIGZvcihsZXQgbGltaXRUeXBlIGluIHRoaXMubGltaXRJbmZvKSB7XG4gICAgICAgIGRpZmYuYWRkKFwiYWN0aW9uIG1hcHBpbmcgbGltaXRcIiwge2FjdGlvbiwgXCJsaW1pdCB0eXBlXCI6IGxpbWl0VHlwZSwgdmFsdWU6IHRoaXMubGltaXRJbmZvW2xpbWl0VHlwZV19KTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy9wcm9qZWN0aW9uXG4gICAgaWYodGhpcy5wcm9qZWN0aW9uTWFwKSB7XG4gICAgICBsZXQgYWN0aW9uID0gdXVpZCgpO1xuICAgICAgZGlmZi5hZGQoXCJhY3Rpb25cIiwge3ZpZXcsIGFjdGlvbiwga2luZDogXCJwcm9qZWN0XCIsIGl4OiBNQVhfTlVNQkVSfSk7XG4gICAgICBtYXBwaW5nVG9EaWZmKGRpZmYsIGFjdGlvbiwgdGhpcy5wcm9qZWN0aW9uTWFwLCBhbGlhc2VzLCByZXZlcnNlTG9va3VwKTtcbiAgICB9XG4gICAgcmV0dXJuIGRpZmY7XG4gIH1cbiAgdmFsaWRhdGVGaWVsZHModGFibGVOYW1lLCBqb2luT2JqZWN0KSB7XG4gICAgbGV0IHRhYmxlID0gdGhpcy5peGVyLnRhYmxlKHRhYmxlTmFtZSk7XG4gICAgZm9yIChsZXQgZmllbGQgaW4gam9pbk9iamVjdCkge1xuICAgICAgaWYgKHRhYmxlLmZpZWxkcy5sZW5ndGggJiYgIXRhYmxlLmtleUxvb2t1cFtmaWVsZF0pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUYWJsZSAnJHt0YWJsZU5hbWV9JyBkb2Vzbid0IGhhdmUgYSBmaWVsZCAnJHtmaWVsZH0nLlxcblxcbkF2YWlsYWJsZSBmaWVsZHM6ICR7dGFibGUuZmllbGRzLmpvaW4oXCIsIFwiKX1gKTtcbiAgICAgIH1cbiAgICAgIGxldCBqb2luSW5mbyA9IGpvaW5PYmplY3RbZmllbGRdO1xuICAgICAgaWYoam9pbkluZm8uY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICAgIGxldCBbam9pbk51bWJlciwgcmVmZXJlbmNlZEZpZWxkXSA9IGpvaW5JbmZvO1xuICAgICAgICBpZiAodHlwZW9mIGpvaW5OdW1iZXIgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICBqb2luTnVtYmVyID0gdGhpcy5hbGlhc2VzW2pvaW5OdW1iZXJdO1xuICAgICAgICB9XG4gICAgICAgIGxldCBqb2luID0gdGhpcy5qb2luc1tqb2luTnVtYmVyXTtcbiAgICAgICAgaWYgKGpvaW4gJiYgam9pbi5peCA9PT0gam9pbk51bWJlcikge1xuICAgICAgICAgIGxldCByZWZlcmVuY2VkVGFibGUgPSB0aGlzLml4ZXIudGFibGUoam9pbi50YWJsZSk7XG4gICAgICAgICAgaWYgKCFyZWZlcmVuY2VkVGFibGUuZmllbGRzLmxlbmd0aCkgY29udGludWU7XG4gICAgICAgICAgaWYgKCFyZWZlcmVuY2VkVGFibGUua2V5TG9va3VwW3JlZmVyZW5jZWRGaWVsZF0pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGFibGUgJyR7am9pbi50YWJsZX0nIGRvZXNuJ3QgaGF2ZSBhIGZpZWxkICcke3JlZmVyZW5jZWRGaWVsZH0nLlxcblxcbkF2YWlsYWJsZSBmaWVsZHM6ICR7cmVmZXJlbmNlZFRhYmxlLmZpZWxkcy5qb2luKFwiLCBcIil9YCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHNlbGVjdCh0YWJsZSwgam9pbiwgYXM/KSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgaWYoYXMpIHtcbiAgICAgIHRoaXMuYWxpYXNlc1thc10gPSBPYmplY3Qua2V5cyh0aGlzLmFsaWFzZXMpLmxlbmd0aDtcbiAgICB9XG4gICAgdGhpcy51bnByb2plY3RlZFNpemUrKztcbiAgICB0aGlzLnRhYmxlcy5wdXNoKHRhYmxlKTtcbiAgICB0aGlzLnZhbGlkYXRlRmllbGRzKHRhYmxlLCBqb2luKTtcbiAgICB0aGlzLmpvaW5zLnB1c2goe25lZ2F0ZWQ6IGZhbHNlLCB0YWJsZSwgam9pbiwgYXMsIGl4OiB0aGlzLmFsaWFzZXNbYXNdfSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgZGVzZWxlY3QodGFibGUsIGpvaW4pIHtcbiAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgICB0aGlzLnRhYmxlcy5wdXNoKHRhYmxlKTtcbiAgICB0aGlzLnZhbGlkYXRlRmllbGRzKHRhYmxlLCBqb2luKTtcbiAgICB0aGlzLmpvaW5zLnB1c2goe25lZ2F0ZWQ6IHRydWUsIHRhYmxlLCBqb2luLCBpeDogdGhpcy5qb2lucy5sZW5ndGggKiAxMDAwfSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgY2FsY3VsYXRlKGZ1bmNOYW1lLCBhcmdzLCBhcz8pIHtcbiAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgICBpZihhcykge1xuICAgICAgdGhpcy5hbGlhc2VzW2FzXSA9IE9iamVjdC5rZXlzKHRoaXMuYWxpYXNlcykubGVuZ3RoO1xuICAgIH1cbiAgICBpZighUXVlcnlGdW5jdGlvbnNbZnVuY05hbWVdLmZpbHRlcikge1xuICAgICAgdGhpcy51bnByb2plY3RlZFNpemUrKztcbiAgICB9XG4gICAgdGhpcy5mdW5jcy5wdXNoKHtuYW1lOiBmdW5jTmFtZSwgYXJncywgYXMsIGl4OiB0aGlzLmFsaWFzZXNbYXNdfSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgcHJvamVjdChwcm9qZWN0aW9uTWFwKSB7XG4gICAgdGhpcy5wcm9qZWN0aW9uTWFwID0gcHJvamVjdGlvbk1hcDtcbiAgICB0aGlzLnZhbGlkYXRlRmllbGRzKHVuZGVmaW5lZCwgcHJvamVjdGlvbk1hcCk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgZ3JvdXAoZ3JvdXBzKSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgaWYoZ3JvdXBzWzBdICYmIGdyb3Vwc1swXS5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpIHtcbiAgICAgIHRoaXMuZ3JvdXBzID0gZ3JvdXBzO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZighdGhpcy5ncm91cHMpIHRoaXMuZ3JvdXBzID0gW107XG4gICAgICB0aGlzLmdyb3Vwcy5wdXNoKGdyb3Vwcyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIHNvcnQoc29ydHMpIHtcbiAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgICBpZihzb3J0c1swXSAmJiBzb3J0c1swXS5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpIHtcbiAgICAgIHRoaXMuc29ydHMgPSBzb3J0cztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYoIXRoaXMuc29ydHMpIHRoaXMuc29ydHMgPSBbXTtcbiAgICAgIHRoaXMuc29ydHMucHVzaChzb3J0cyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGxpbWl0KGxpbWl0SW5mbzphbnkpIHtcbiAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgICBpZighdGhpcy5saW1pdEluZm8pIHtcbiAgICAgIHRoaXMubGltaXRJbmZvID0ge307XG4gICAgfVxuICAgIGZvcihsZXQga2V5IGluIGxpbWl0SW5mbykge1xuICAgICAgdGhpcy5saW1pdEluZm9ba2V5XSA9IGxpbWl0SW5mb1trZXldO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBhZ2dyZWdhdGUoZnVuY05hbWUsIGFyZ3MsIGFzPykge1xuICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICAgIGlmKGFzKSB7XG4gICAgICB0aGlzLmFsaWFzZXNbYXNdID0gT2JqZWN0LmtleXModGhpcy5hbGlhc2VzKS5sZW5ndGg7XG4gICAgfVxuICAgIHRoaXMudW5wcm9qZWN0ZWRTaXplKys7XG4gICAgdGhpcy5hZ2dyZWdhdGVzLnB1c2goe25hbWU6IGZ1bmNOYW1lLCBhcmdzLCBhcywgaXg6IHRoaXMuYWxpYXNlc1thc119KTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBvcmRpbmFsKCkge1xuICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICAgIHRoaXMuaGFzT3JkaW5hbCA9IHRydWU7XG4gICAgdGhpcy51bnByb2plY3RlZFNpemUrKztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBhcHBseUFsaWFzZXMoam9pbk1hcCkge1xuICAgIGZvcihsZXQgZmllbGQgaW4gam9pbk1hcCkge1xuICAgICAgbGV0IGpvaW5JbmZvID0gam9pbk1hcFtmaWVsZF07XG4gICAgICBpZihqb2luSW5mby5jb25zdHJ1Y3RvciAhPT0gQXJyYXkgfHwgdHlwZW9mIGpvaW5JbmZvWzBdID09PSBcIm51bWJlclwiKSBjb250aW51ZTtcbiAgICAgIGxldCBqb2luVGFibGUgPSBqb2luSW5mb1swXTtcbiAgICAgIGlmKGpvaW5UYWJsZSA9PT0gXCJvcmRpbmFsXCIpIHtcbiAgICAgICAgam9pbkluZm9bMF0gPSB0aGlzLnVucHJvamVjdGVkU2l6ZSAtIDE7XG4gICAgICB9IGVsc2UgaWYodGhpcy5hbGlhc2VzW2pvaW5UYWJsZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBqb2luSW5mb1swXSA9IHRoaXMuYWxpYXNlc1tqb2luVGFibGVdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBhbGlhcyB1c2VkOiBcIiArIGpvaW5UYWJsZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHRvQVNUKCkge1xuICAgIGxldCBjdXJzb3IgPSB7dHlwZTogXCJxdWVyeVwiLFxuICAgICAgICAgICAgICAgICAgY2hpbGRyZW46IFtdfTtcbiAgICBsZXQgcm9vdCA9IGN1cnNvcjtcbiAgICBsZXQgcmVzdWx0cyA9IFtdO1xuICAgIC8vIGJ5IGRlZmF1bHQgdGhlIG9ubHkgdGhpbmcgd2UgcmV0dXJuIGFyZSB0aGUgdW5wcm9qZWN0ZWQgcmVzdWx0c1xuICAgIGxldCByZXR1cm5zID0gW1widW5wcm9qZWN0ZWRcIiwgXCJwcm92ZW5hbmNlXCJdO1xuXG4gICAgLy8gd2UgbmVlZCBhbiBhcnJheSB0byBzdG9yZSBvdXIgdW5wcm9qZWN0ZWQgcmVzdWx0c1xuICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJkZWNsYXJhdGlvblwiLCB2YXI6IFwidW5wcm9qZWN0ZWRcIiwgdmFsdWU6IFwiW11cIn0pO1xuICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJkZWNsYXJhdGlvblwiLCB2YXI6IFwicHJvdmVuYW5jZVwiLCB2YWx1ZTogXCJbXVwifSk7XG4gICAgcm9vdC5jaGlsZHJlbi5wdXNoKHt0eXBlOiBcImRlY2xhcmF0aW9uXCIsIHZhcjogXCJwcm9qZWN0ZWRcIiwgdmFsdWU6IFwie31cIn0pO1xuXG4gICAgLy8gcnVuIHRocm91Z2ggZWFjaCB0YWJsZSBuZXN0ZWQgaW4gdGhlIG9yZGVyIHRoZXkgd2VyZSBnaXZlbiBkb2luZyBwYWlyd2lzZVxuICAgIC8vIGpvaW5zIGFsb25nIHRoZSB3YXkuXG4gICAgZm9yKGxldCBqb2luIG9mIHRoaXMuam9pbnMpIHtcbiAgICAgIGxldCB7dGFibGUsIGl4LCBuZWdhdGVkfSA9IGpvaW47XG4gICAgICBsZXQgY3VyID0ge1xuICAgICAgICB0eXBlOiBcInNlbGVjdFwiLFxuICAgICAgICB0YWJsZSxcbiAgICAgICAgcGFzc2VkOiBpeCA9PT0gMCxcbiAgICAgICAgaXgsXG4gICAgICAgIG5lZ2F0ZWQsXG4gICAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgICAgam9pbjogZmFsc2UsXG4gICAgICB9O1xuICAgICAgLy8gd2Ugb25seSB3YW50IHRvIGVhdCB0aGUgY29zdCBvZiBkZWFsaW5nIHdpdGggaW5kZXhlc1xuICAgICAgLy8gaWYgd2UgYXJlIGFjdHVhbGx5IGpvaW5pbmcgb24gc29tZXRoaW5nXG4gICAgICBsZXQgam9pbk1hcCA9IGpvaW4uam9pbjtcbiAgICAgIHRoaXMuYXBwbHlBbGlhc2VzKGpvaW5NYXApO1xuICAgICAgaWYoam9pbk1hcCAmJiBPYmplY3Qua2V5cyhqb2luTWFwKS5sZW5ndGggIT09IDApIHtcbiAgICAgICAgcm9vdC5jaGlsZHJlbi51bnNoaWZ0KHt0eXBlOiBcImRlY2xhcmF0aW9uXCIsIHZhcjogYHF1ZXJ5JHtpeH1gLCB2YWx1ZTogXCJ7fVwifSk7XG4gICAgICAgIGN1ci5qb2luID0gam9pbk1hcDtcbiAgICAgIH1cbiAgICAgIGN1cnNvci5jaGlsZHJlbi5wdXNoKGN1cik7XG4gICAgICBpZighbmVnYXRlZCkge1xuICAgICAgICByZXN1bHRzLnB1c2goe3R5cGU6IFwic2VsZWN0XCIsIGl4fSk7XG4gICAgICB9XG5cbiAgICAgIGN1cnNvciA9IGN1cjtcbiAgICB9XG4gICAgLy8gYXQgdGhlIGJvdHRvbSBvZiB0aGUgam9pbnMsIHdlIGNhbGN1bGF0ZSBhbGwgdGhlIGZ1bmN0aW9ucyBiYXNlZCBvbiB0aGUgdmFsdWVzXG4gICAgLy8gY29sbGVjdGVkXG4gICAgZm9yKGxldCBmdW5jIG9mIHRoaXMuZnVuY3MpIHtcbiAgICAgIGxldCB7YXJncywgbmFtZSwgaXh9ID0gZnVuYztcbiAgICAgIGxldCBmdW5jSW5mbyA9IFF1ZXJ5RnVuY3Rpb25zW25hbWVdO1xuICAgICAgdGhpcy5hcHBseUFsaWFzZXMoYXJncyk7XG4gICAgICByb290LmNoaWxkcmVuLnVuc2hpZnQoe3R5cGU6IFwiZnVuY3Rpb25EZWNsYXJhdGlvblwiLCBpeCwgaW5mbzogZnVuY0luZm99KTtcbiAgICAgIGlmKGZ1bmNJbmZvLm11bHRpIHx8IGZ1bmNJbmZvLmZpbHRlcikge1xuICAgICAgICBsZXQgbm9kZSA9IHt0eXBlOiBcImZ1bmN0aW9uQ2FsbE11bHRpUmV0dXJuXCIsIGl4LCBhcmdzLCBpbmZvOiBmdW5jSW5mbywgY2hpbGRyZW46IFtdfTtcbiAgICAgICAgY3Vyc29yLmNoaWxkcmVuLnB1c2gobm9kZSk7XG4gICAgICAgIGN1cnNvciA9IG5vZGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjdXJzb3IuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJmdW5jdGlvbkNhbGxcIiwgaXgsIGFyZ3MsIGluZm86IGZ1bmNJbmZvLCBjaGlsZHJlbjogW119KTtcbiAgICAgIH1cbiAgICAgIGlmKCFmdW5jSW5mby5ub1JldHVybiAmJiAhZnVuY0luZm8uZmlsdGVyKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7dHlwZTogXCJmdW5jdGlvblwiLCBpeH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIG5vdyB0aGF0IHdlJ3JlIGF0IHRoZSBib3R0b20gb2YgdGhlIGpvaW4sIHN0b3JlIHRoZSB1bnByb2plY3RlZCByZXN1bHRcbiAgICBjdXJzb3IuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJyZXN1bHRcIiwgcmVzdWx0c30pO1xuXG4gICAgLy9BZ2dyZWdhdGlvblxuICAgIC8vc29ydCB0aGUgdW5wcm9qZWN0ZWQgcmVzdWx0cyBiYXNlZCBvbiBncm91cGluZ3MgYW5kIHRoZSBnaXZlbiBzb3J0c1xuICAgIGxldCBzb3J0cyA9IFtdO1xuICAgIGxldCBhbHJlYWR5U29ydGVkID0ge307XG4gICAgaWYodGhpcy5ncm91cHMpIHtcbiAgICAgIHRoaXMuYXBwbHlBbGlhc2VzKHRoaXMuZ3JvdXBzKTtcbiAgICAgIGZvcihsZXQgZ3JvdXAgb2YgdGhpcy5ncm91cHMpIHtcbiAgICAgICAgbGV0IFt0YWJsZSwgZmllbGRdID0gZ3JvdXA7XG4gICAgICAgIHNvcnRzLnB1c2goZ3JvdXApO1xuICAgICAgICBhbHJlYWR5U29ydGVkW2Ake3RhYmxlfXwke2ZpZWxkfWBdID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYodGhpcy5zb3J0cykge1xuICAgICAgdGhpcy5hcHBseUFsaWFzZXModGhpcy5zb3J0cyk7XG4gICAgICBmb3IobGV0IHNvcnQgb2YgdGhpcy5zb3J0cykge1xuICAgICAgICBsZXQgW3RhYmxlLCBmaWVsZF0gPSBzb3J0O1xuICAgICAgICBpZighYWxyZWFkeVNvcnRlZFtgJHt0YWJsZX18JHtmaWVsZH1gXSkge1xuICAgICAgICAgIHNvcnRzLnB1c2goc29ydCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgdmFyIHNpemUgPSB0aGlzLnVucHJvamVjdGVkU2l6ZTtcbiAgICBpZihzb3J0cy5sZW5ndGgpIHtcbiAgICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJzb3J0XCIsIHNvcnRzLCBzaXplLCBjaGlsZHJlbjogW119KTtcbiAgICB9XG4gICAgLy90aGVuIHdlIG5lZWQgdG8gcnVuIHRocm91Z2ggdGhlIHNvcnRlZCBpdGVtcyBhbmQgZG8gdGhlIGFnZ3JlZ2F0ZSBhcyBhIGZvbGQuXG4gICAgaWYodGhpcy5hZ2dyZWdhdGVzLmxlbmd0aCB8fCBzb3J0cy5sZW5ndGggfHwgdGhpcy5saW1pdEluZm8gfHwgdGhpcy5oYXNPcmRpbmFsKSB7XG4gICAgICAvLyB3ZSBuZWVkIHRvIHN0b3JlIGdyb3VwIGluZm8gZm9yIHBvc3QgcHJvY2Vzc2luZyBvZiB0aGUgdW5wcm9qZWN0ZWQgcmVzdWx0c1xuICAgICAgLy8gdGhpcyB3aWxsIGluZGljYXRlIHdoYXQgZ3JvdXAgbnVtYmVyLCBpZiBhbnksIHRoYXQgZWFjaCB1bnByb2plY3RlZCByZXN1bHQgYmVsb25ncyB0b1xuICAgICAgcm9vdC5jaGlsZHJlbi51bnNoaWZ0KHt0eXBlOiBcImRlY2xhcmF0aW9uXCIsIHZhcjogXCJncm91cEluZm9cIiwgdmFsdWU6IFwiW11cIn0pO1xuICAgICAgcmV0dXJucy5wdXNoKFwiZ3JvdXBJbmZvXCIpO1xuICAgICAgbGV0IGFnZ3JlZ2F0ZUNoaWxkcmVuID0gW107XG4gICAgICBmb3IobGV0IGZ1bmMgb2YgdGhpcy5hZ2dyZWdhdGVzKSB7XG4gICAgICAgIGxldCB7YXJncywgbmFtZSwgaXh9ID0gZnVuYztcbiAgICAgICAgbGV0IGZ1bmNJbmZvID0gUXVlcnlGdW5jdGlvbnNbbmFtZV07XG4gICAgICAgIHRoaXMuYXBwbHlBbGlhc2VzKGFyZ3MpO1xuICAgICAgICByb290LmNoaWxkcmVuLnVuc2hpZnQoe3R5cGU6IFwiZnVuY3Rpb25EZWNsYXJhdGlvblwiLCBpeCwgaW5mbzogZnVuY0luZm99KTtcbiAgICAgICAgYWdncmVnYXRlQ2hpbGRyZW4ucHVzaCh7dHlwZTogXCJmdW5jdGlvbkNhbGxcIiwgaXgsIHJlc3VsdHNJeDogcmVzdWx0cy5sZW5ndGgsIGFyZ3MsIGluZm86IGZ1bmNJbmZvLCB1bnByb2plY3RlZDogdHJ1ZSwgY2hpbGRyZW46IFtdfSk7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7dHlwZTogXCJwbGFjZWhvbGRlclwifSk7XG4gICAgICB9XG4gICAgICBpZih0aGlzLmhhc09yZGluYWwgPT09IHRydWUpIHtcbiAgICAgICAgYWdncmVnYXRlQ2hpbGRyZW4ucHVzaCh7dHlwZTogXCJvcmRpbmFsXCJ9KTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHt0eXBlOiBcInBsYWNlaG9sZGVyXCJ9KTtcbiAgICAgIH1cbiAgICAgIGxldCBhZ2dyZWdhdGUgPSB7dHlwZTogXCJhZ2dyZWdhdGUgbG9vcFwiLCBncm91cHM6IHRoaXMuZ3JvdXBzLCBsaW1pdDogdGhpcy5saW1pdEluZm8sIHNpemUsIGNoaWxkcmVuOiBhZ2dyZWdhdGVDaGlsZHJlbn07XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goYWdncmVnYXRlKTtcbiAgICAgIGN1cnNvciA9IGFnZ3JlZ2F0ZTtcbiAgICB9XG5cblxuICAgIGlmKHRoaXMucHJvamVjdGlvbk1hcCkge1xuICAgICAgdGhpcy5hcHBseUFsaWFzZXModGhpcy5wcm9qZWN0aW9uTWFwKTtcbiAgICAgIHJvb3QuY2hpbGRyZW4udW5zaGlmdCh7dHlwZTogXCJkZWNsYXJhdGlvblwiLCB2YXI6IFwicmVzdWx0c1wiLCB2YWx1ZTogXCJbXVwifSk7XG4gICAgICBpZihJTkNSRU1FTlRBTCkge1xuICAgICAgICBjdXJzb3IuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJwcm92ZW5hbmNlXCJ9KTtcbiAgICAgIH1cbiAgICAgIGN1cnNvci5jaGlsZHJlbi5wdXNoKHt0eXBlOiBcInByb2plY3Rpb25cIiwgcHJvamVjdGlvbk1hcDogdGhpcy5wcm9qZWN0aW9uTWFwLCB1bnByb2plY3RlZDogdGhpcy5hZ2dyZWdhdGVzLmxlbmd0aH0pO1xuICAgICAgcmV0dXJucy5wdXNoKFwicmVzdWx0c1wiKTtcbiAgICB9XG5cbiAgICByb290LmNoaWxkcmVuLnB1c2goe3R5cGU6IFwicmV0dXJuXCIsIHZhcnM6IHJldHVybnN9KTtcbiAgICByZXR1cm4gcm9vdDtcbiAgfVxuICBjb21waWxlUGFyYW1TdHJpbmcoZnVuY0luZm8sIGFyZ3MsIHVucHJvamVjdGVkID0gZmFsc2UpIHtcbiAgICBsZXQgY29kZSA9IFwiXCI7XG4gICAgbGV0IHBhcmFtcyA9IGZ1bmNJbmZvLnBhcmFtcztcbiAgICBpZih1bnByb2plY3RlZCkgcGFyYW1zID0gcGFyYW1zLnNsaWNlKDEpO1xuICAgIGZvcihsZXQgcGFyYW0gb2YgcGFyYW1zKSB7XG4gICAgICBsZXQgYXJnID0gYXJnc1twYXJhbV07XG4gICAgICBsZXQgYXJnQ29kZTtcbiAgICAgIGlmKGFyZy5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpIHtcbiAgICAgICAgbGV0IHByb3BlcnR5ID0gXCJcIjtcbiAgICAgICAgaWYoYXJnWzFdKSB7XG4gICAgICAgICAgcHJvcGVydHkgPSBgWycke2FyZ1sxXX0nXWA7XG4gICAgICAgIH1cbiAgICAgICAgaWYoIXVucHJvamVjdGVkKSB7XG4gICAgICAgICAgYXJnQ29kZSA9IGByb3cke2FyZ1swXX0ke3Byb3BlcnR5fWA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXJnQ29kZSA9IGB1bnByb2plY3RlZFtpeCArICR7YXJnWzBdfV0ke3Byb3BlcnR5fWA7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFyZ0NvZGUgPSBKU09OLnN0cmluZ2lmeShhcmcpO1xuICAgICAgfVxuICAgICAgY29kZSArPSBgJHthcmdDb2RlfSwgYDtcbiAgICB9XG4gICAgcmV0dXJuIGNvZGUuc3Vic3RyaW5nKDAsY29kZS5sZW5ndGggLSAyKTtcbiAgfVxuICBjb21waWxlQVNUKHJvb3QpIHtcbiAgICBsZXQgY29kZSA9IFwiXCI7XG4gICAgbGV0IHR5cGUgPSByb290LnR5cGU7XG4gICAgc3dpdGNoKHR5cGUpIHtcbiAgICAgIGNhc2UgXCJxdWVyeVwiOlxuICAgICAgICBmb3IodmFyIGNoaWxkIG9mIHJvb3QuY2hpbGRyZW4pIHtcbiAgICAgICAgICBjb2RlICs9IHRoaXMuY29tcGlsZUFTVChjaGlsZCk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwiZGVjbGFyYXRpb25cIjpcbiAgICAgICAgY29kZSArPSBgdmFyICR7cm9vdC52YXJ9ID0gJHtyb290LnZhbHVlfTtcXG5gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJmdW5jdGlvbkRlY2xhcmF0aW9uXCI6XG4gICAgICAgIGNvZGUgKz0gYHZhciBmdW5jJHtyb290Lml4fSA9IFF1ZXJ5RnVuY3Rpb25zWycke3Jvb3QuaW5mby5uYW1lfSddLmZ1bmM7XFxuYDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwiZnVuY3Rpb25DYWxsXCI6XG4gICAgICAgIHZhciBpeCA9IHJvb3QuaXg7XG4gICAgICAgIHZhciBwcmV2ID0gXCJcIjtcbiAgICAgICAgaWYocm9vdC51bnByb2plY3RlZCkge1xuICAgICAgICAgIHByZXYgPSBgcm93JHtpeH1gO1xuICAgICAgICAgIGlmKHJvb3QuaW5mby5wYXJhbXMubGVuZ3RoID4gMSkgcHJldiArPSBcIixcIlxuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gYHZhciByb3cke2l4fSA9IGZ1bmMke2l4fSgke3ByZXZ9JHt0aGlzLmNvbXBpbGVQYXJhbVN0cmluZyhyb290LmluZm8sIHJvb3QuYXJncywgcm9vdC51bnByb2plY3RlZCl9KTtcXG5gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJmdW5jdGlvbkNhbGxNdWx0aVJldHVyblwiOlxuICAgICAgICB2YXIgaXggPSByb290Lml4O1xuICAgICAgICBjb2RlICs9IGB2YXIgcm93cyR7aXh9ID0gZnVuYyR7aXh9KCR7dGhpcy5jb21waWxlUGFyYW1TdHJpbmcocm9vdC5pbmZvLCByb290LmFyZ3MpfSk7XFxuYDtcbiAgICAgICAgY29kZSArPSBgZm9yKHZhciBmdW5jUmVzdWx0SXgke2l4fSA9IDAsIGZ1bmNMZW4ke2l4fSA9IHJvd3Mke2l4fS5sZW5ndGg7IGZ1bmNSZXN1bHRJeCR7aXh9IDwgZnVuY0xlbiR7aXh9OyBmdW5jUmVzdWx0SXgke2l4fSsrKSB7XFxuYFxuICAgICAgICBjb2RlICs9IGB2YXIgcm93JHtpeH0gPSByb3dzJHtpeH1bZnVuY1Jlc3VsdEl4JHtpeH1dO1xcbmA7XG4gICAgICAgIGZvcih2YXIgY2hpbGQgb2Ygcm9vdC5jaGlsZHJlbikge1xuICAgICAgICAgIGNvZGUgKz0gdGhpcy5jb21waWxlQVNUKGNoaWxkKTtcbiAgICAgICAgfVxuICAgICAgICBjb2RlICs9IFwifVxcblwiO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJzZWxlY3RcIjpcbiAgICAgICAgdmFyIGl4ID0gcm9vdC5peDtcbiAgICAgICAgaWYocm9vdC5wYXNzZWQpIHtcbiAgICAgICAgICBjb2RlICs9IGB2YXIgcm93cyR7aXh9ID0gcm9vdFJvd3M7XFxuYDtcbiAgICAgICAgfSBlbHNlIGlmKHJvb3Quam9pbikge1xuICAgICAgICAgIGZvcihsZXQga2V5IGluIHJvb3Quam9pbikge1xuICAgICAgICAgICAgbGV0IG1hcHBpbmcgPSByb290LmpvaW5ba2V5XTtcbiAgICAgICAgICAgIGlmKG1hcHBpbmcuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICAgICAgICAgIGxldCBbdGFibGVJeCwgdmFsdWVdID0gbWFwcGluZztcbiAgICAgICAgICAgICAgY29kZSArPSBgcXVlcnkke2l4fVsnJHtrZXl9J10gPSByb3cke3RhYmxlSXh9Wycke3ZhbHVlfSddO1xcbmA7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb2RlICs9IGBxdWVyeSR7aXh9Wycke2tleX0nXSA9ICR7SlNPTi5zdHJpbmdpZnkobWFwcGluZyl9O1xcbmA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvZGUgKz0gYHZhciByb3dzJHtpeH0gPSBpeGVyLmZhY3RUb0luZGV4KGl4ZXIudGFibGUoJyR7cm9vdC50YWJsZX0nKSwgcXVlcnkke2l4fSk7XFxuYDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb2RlICs9IGB2YXIgcm93cyR7aXh9ID0gaXhlci50YWJsZSgnJHtyb290LnRhYmxlfScpLnRhYmxlO1xcbmA7XG4gICAgICAgIH1cbiAgICAgICAgaWYoIXJvb3QubmVnYXRlZCkge1xuICAgICAgICAgIGNvZGUgKz0gYGZvcih2YXIgcm93SXgke2l4fSA9IDAsIHJvd3NMZW4ke2l4fSA9IHJvd3Mke2l4fS5sZW5ndGg7IHJvd0l4JHtpeH0gPCByb3dzTGVuJHtpeH07IHJvd0l4JHtpeH0rKykge1xcbmBcbiAgICAgICAgICBjb2RlICs9IGB2YXIgcm93JHtpeH0gPSByb3dzJHtpeH1bcm93SXgke2l4fV07XFxuYDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb2RlICs9IGBpZighcm93cyR7aXh9Lmxlbmd0aCkge1xcbmBcbiAgICAgICAgfVxuICAgICAgICBmb3IodmFyIGNoaWxkIG9mIHJvb3QuY2hpbGRyZW4pIHtcbiAgICAgICAgICBjb2RlICs9IHRoaXMuY29tcGlsZUFTVChjaGlsZCk7XG4gICAgICAgIH1cbiAgICAgICAgY29kZSArPSBcIn1cXG5cIjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwicmVzdWx0XCI6XG4gICAgICAgIHZhciByZXN1bHRzID0gW107XG4gICAgICAgIGZvcih2YXIgcmVzdWx0IG9mIHJvb3QucmVzdWx0cykge1xuICAgICAgICAgIGlmKHJlc3VsdC50eXBlID09PSBcInBsYWNlaG9sZGVyXCIpIHtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaChcInVuZGVmaW5lZFwiKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbGV0IGl4ID0gcmVzdWx0Lml4O1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKGByb3cke2l4fWApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb2RlICs9IGB1bnByb2plY3RlZC5wdXNoKCR7cmVzdWx0cy5qb2luKFwiLCBcIil9KTtcXG5gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJzb3J0XCI6XG4gICAgICAgIGNvZGUgKz0gZ2VuZXJhdGVVbnByb2plY3RlZFNvcnRlckNvZGUocm9vdC5zaXplLCByb290LnNvcnRzKStcIlxcblwiO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJhZ2dyZWdhdGUgbG9vcFwiOlxuICAgICAgICB2YXIgcHJvamVjdGlvbiA9IFwiXCI7XG4gICAgICAgIHZhciBhZ2dyZWdhdGVDYWxscyA9IFtdO1xuICAgICAgICB2YXIgYWdncmVnYXRlU3RhdGVzID0gW107XG4gICAgICAgIHZhciBhZ2dyZWdhdGVSZXNldHMgPSBbXTtcbiAgICAgICAgdmFyIHVucHJvamVjdGVkID0ge307XG4gICAgICAgIHZhciBvcmRpbmFsOnN0cmluZ3xib29sZWFuID0gZmFsc2U7XG4gICAgICAgIHZhciBwcm92ZW5hbmNlQ29kZTtcbiAgICAgICAgZm9yKGxldCBhZ2cgb2Ygcm9vdC5jaGlsZHJlbikge1xuICAgICAgICAgIGlmKGFnZy50eXBlID09PSBcImZ1bmN0aW9uQ2FsbFwiKSB7XG4gICAgICAgICAgICB1bnByb2plY3RlZFthZ2cuaXhdID0gdHJ1ZTtcbiAgICAgICAgICAgIGxldCBjb21waWxlZCA9IHRoaXMuY29tcGlsZUFTVChhZ2cpO1xuICAgICAgICAgICAgY29tcGlsZWQgKz0gYFxcbnVucHJvamVjdGVkW2l4ICsgJHthZ2cucmVzdWx0c0l4fV0gPSByb3cke2FnZy5peH07XFxuYDtcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZUNhbGxzLnB1c2goY29tcGlsZWQpO1xuICAgICAgICAgICAgYWdncmVnYXRlU3RhdGVzLnB1c2goYHZhciByb3cke2FnZy5peH0gPSB7fTtgKTtcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZVJlc2V0cy5wdXNoKGByb3cke2FnZy5peH0gPSB7fTtgKTtcbiAgICAgICAgICB9IGVsc2UgaWYoYWdnLnR5cGUgPT09IFwicHJvamVjdGlvblwiKSB7XG4gICAgICAgICAgICBhZ2cudW5wcm9qZWN0ZWQgPSB1bnByb2plY3RlZDtcbiAgICAgICAgICAgIHByb2plY3Rpb24gPSB0aGlzLmNvbXBpbGVBU1QoYWdnKTtcbiAgICAgICAgICB9IGVsc2UgaWYoYWdnLnR5cGUgPT09IFwib3JkaW5hbFwiKSB7XG4gICAgICAgICAgICBvcmRpbmFsID0gYHVucHJvamVjdGVkW2l4KyR7dGhpcy51bnByb2plY3RlZFNpemUgLSAxfV0gPSByZXN1bHRDb3VudDtcXG5gO1xuICAgICAgICAgIH0gZWxzZSBpZihhZ2cudHlwZSA9PT0gXCJwcm92ZW5hbmNlXCIpIHtcbiAgICAgICAgICAgIHByb3ZlbmFuY2VDb2RlID0gdGhpcy5jb21waWxlQVNUKGFnZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBhZ2dyZWdhdGVDYWxsc0NvZGUgPSBhZ2dyZWdhdGVDYWxscy5qb2luKFwiXCIpO1xuXG4gICAgICAgIHZhciBkaWZmZXJlbnRHcm91cENoZWNrcyA9IFtdO1xuICAgICAgICB2YXIgZ3JvdXBDaGVjayA9IGBmYWxzZWA7XG4gICAgICAgIGlmKHJvb3QuZ3JvdXBzKSB7XG4gICAgICAgICAgZm9yKGxldCBncm91cCBvZiByb290Lmdyb3Vwcykge1xuICAgICAgICAgICAgbGV0IFt0YWJsZSwgZmllbGRdID0gZ3JvdXA7XG4gICAgICAgICAgICBkaWZmZXJlbnRHcm91cENoZWNrcy5wdXNoKGB1bnByb2plY3RlZFtuZXh0SXggKyAke3RhYmxlfV1bJyR7ZmllbGR9J10gIT09IHVucHJvamVjdGVkW2l4ICsgJHt0YWJsZX1dWycke2ZpZWxkfSddYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGdyb3VwQ2hlY2sgPSBgKCR7ZGlmZmVyZW50R3JvdXBDaGVja3Muam9pbihcIiB8fCBcIil9KWA7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcmVzdWx0c0NoZWNrID0gXCJcIjtcbiAgICAgICAgaWYocm9vdC5saW1pdCAmJiByb290LmxpbWl0LnJlc3VsdHMpIHtcbiAgICAgICAgICBsZXQgbGltaXRWYWx1ZSA9IHJvb3QubGltaXQucmVzdWx0cztcbiAgICAgICAgICBsZXQgb2Zmc2V0ID0gcm9vdC5saW1pdC5vZmZzZXQ7XG4gICAgICAgICAgaWYob2Zmc2V0KSB7XG4gICAgICAgICAgICBsaW1pdFZhbHVlICs9IG9mZnNldDtcbiAgICAgICAgICAgIHByb2plY3Rpb24gPSBgaWYocmVzdWx0Q291bnQgPj0gJHtvZmZzZXR9KSB7XG4gICAgICAgICAgICAgICR7cHJvamVjdGlvbn1cbiAgICAgICAgICAgIH1gO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXN1bHRzQ2hlY2sgPSBgaWYocmVzdWx0Q291bnQgPT09ICR7bGltaXRWYWx1ZX0pIGJyZWFrO2A7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGdyb3VwTGltaXRDaGVjayA9IFwiXCI7XG4gICAgICAgIGlmKHJvb3QubGltaXQgJiYgcm9vdC5saW1pdC5wZXJHcm91cCAmJiByb290Lmdyb3Vwcykge1xuICAgICAgICAgIGxldCBsaW1pdFZhbHVlID0gcm9vdC5saW1pdC5wZXJHcm91cDtcbiAgICAgICAgICBsZXQgb2Zmc2V0ID0gcm9vdC5saW1pdC5vZmZzZXQ7XG4gICAgICAgICAgaWYob2Zmc2V0KSB7XG4gICAgICAgICAgICBsaW1pdFZhbHVlICs9IG9mZnNldDtcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZUNhbGxzQ29kZSA9IGBpZihwZXJHcm91cENvdW50ID49ICR7b2Zmc2V0fSkge1xuICAgICAgICAgICAgICAke2FnZ3JlZ2F0ZUNhbGxzQ29kZX1cbiAgICAgICAgICAgIH1gO1xuICAgICAgICAgIH1cbiAgICAgICAgICBncm91cExpbWl0Q2hlY2sgPSBgaWYocGVyR3JvdXBDb3VudCA9PT0gJHtsaW1pdFZhbHVlfSkge1xuICAgICAgICAgICAgd2hpbGUoIWRpZmZlcmVudEdyb3VwKSB7XG4gICAgICAgICAgICAgIG5leHRJeCArPSAke3Jvb3Quc2l6ZX07XG4gICAgICAgICAgICAgIGlmKG5leHRJeCA+PSBsZW4pIGJyZWFrO1xuICAgICAgICAgICAgICBncm91cEluZm9bbmV4dEl4XSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgZGlmZmVyZW50R3JvdXAgPSAke2dyb3VwQ2hlY2t9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1gO1xuICAgICAgICB9XG4gICAgICAgIHZhciBncm91cERpZmZlcmVuY2UgPSBcIlwiO1xuICAgICAgICB2YXIgZ3JvdXBJbmZvID0gXCJcIjtcbiAgICAgICAgaWYodGhpcy5ncm91cHMpIHtcbiAgICAgICAgICBncm91cEluZm8gPSBcImdyb3VwSW5mb1tpeF0gPSByZXN1bHRDb3VudDtcIjtcbiAgICAgICAgICBsZXQgZ3JvdXBQcm9qZWN0aW9uID0gYCR7cHJvamVjdGlvbn1yZXN1bHRDb3VudCsrO2BcbiAgICAgICAgICBpZihyb290LmxpbWl0ICYmIHJvb3QubGltaXQub2Zmc2V0KSB7XG4gICAgICAgICAgICBncm91cFByb2plY3Rpb24gPSBgaWYocGVyR3JvdXBDb3VudCA+ICR7cm9vdC5saW1pdC5vZmZzZXR9KSB7XG4gICAgICAgICAgICAgICR7Z3JvdXBQcm9qZWN0aW9ufVxuICAgICAgICAgICAgfWA7XG4gICAgICAgICAgICBncm91cEluZm8gPSBgaWYocGVyR3JvdXBDb3VudCA+PSAke3Jvb3QubGltaXQub2Zmc2V0fSkge1xuICAgICAgICAgICAgICAke2dyb3VwSW5mb31cbiAgICAgICAgICAgIH1gO1xuICAgICAgICAgIH1cbiAgICAgICAgICBncm91cERpZmZlcmVuY2UgPSBgXG4gICAgICAgICAgcGVyR3JvdXBDb3VudCsrXG4gICAgICAgICAgdmFyIGRpZmZlcmVudEdyb3VwID0gJHtncm91cENoZWNrfTtcbiAgICAgICAgICAke2dyb3VwTGltaXRDaGVja31cbiAgICAgICAgICBpZihkaWZmZXJlbnRHcm91cCkge1xuICAgICAgICAgICAgJHtncm91cFByb2plY3Rpb259XG4gICAgICAgICAgICAke2FnZ3JlZ2F0ZVJlc2V0cy5qb2luKFwiXFxuXCIpfVxuICAgICAgICAgICAgcGVyR3JvdXBDb3VudCA9IDA7XG4gICAgICAgICAgfVxcbmA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZ3JvdXBEaWZmZXJlbmNlID0gXCJyZXN1bHRDb3VudCsrO1xcblwiO1xuICAgICAgICAgIGdyb3VwSW5mbyA9IFwiZ3JvdXBJbmZvW2l4XSA9IDA7XCJcbiAgICAgICAgfVxuICAgICAgICAvLyBpZiB0aGVyZSBhcmUgbmVpdGhlciBhZ2dyZWdhdGVzIHRvIGNhbGN1bGF0ZSBub3IgZ3JvdXBzIHRvIGJ1aWxkLFxuICAgICAgICAvLyB0aGVuIHdlIGp1c3QgbmVlZCB0byB3b3JyeSBhYm91dCBsaW1pdGluZ1xuICAgICAgICBpZighdGhpcy5ncm91cHMgJiYgYWdncmVnYXRlQ2FsbHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgY29kZSA9IGB2YXIgaXggPSAwO1xuICAgICAgICAgICAgICAgICAgdmFyIHJlc3VsdENvdW50ID0gMDtcbiAgICAgICAgICAgICAgICAgIHZhciBsZW4gPSB1bnByb2plY3RlZC5sZW5ndGg7XG4gICAgICAgICAgICAgICAgICB3aGlsZShpeCA8IGxlbikge1xuICAgICAgICAgICAgICAgICAgICAke3Jlc3VsdHNDaGVja31cbiAgICAgICAgICAgICAgICAgICAgJHtvcmRpbmFsIHx8IFwiXCJ9XG4gICAgICAgICAgICAgICAgICAgICR7cHJvdmVuYW5jZUNvZGV9XG4gICAgICAgICAgICAgICAgICAgICR7cHJvamVjdGlvbn1cbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBJbmZvW2l4XSA9IHJlc3VsdENvdW50O1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRDb3VudCsrO1xuICAgICAgICAgICAgICAgICAgICBpeCArPSAke3Jvb3Quc2l6ZX07XG4gICAgICAgICAgICAgICAgICB9XFxuYDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb2RlID0gYHZhciByZXN1bHRDb3VudCA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIHBlckdyb3VwQ291bnQgPSAwO1xuICAgICAgICAgICAgICAgIHZhciBpeCA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIG5leHRJeCA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIGxlbiA9IHVucHJvamVjdGVkLmxlbmd0aDtcbiAgICAgICAgICAgICAgICAke2FnZ3JlZ2F0ZVN0YXRlcy5qb2luKFwiXFxuXCIpfVxuICAgICAgICAgICAgICAgIHdoaWxlKGl4IDwgbGVuKSB7XG4gICAgICAgICAgICAgICAgICAke2FnZ3JlZ2F0ZUNhbGxzQ29kZX1cbiAgICAgICAgICAgICAgICAgICR7Z3JvdXBJbmZvfVxuICAgICAgICAgICAgICAgICAgJHtvcmRpbmFsIHx8IFwiXCJ9XG4gICAgICAgICAgICAgICAgICAke3Byb3ZlbmFuY2VDb2RlfVxuICAgICAgICAgICAgICAgICAgaWYoaXggKyAke3Jvb3Quc2l6ZX0gPT09IGxlbikge1xuICAgICAgICAgICAgICAgICAgICAke3Byb2plY3Rpb259XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgbmV4dEl4ICs9ICR7cm9vdC5zaXplfTtcbiAgICAgICAgICAgICAgICAgICR7Z3JvdXBEaWZmZXJlbmNlfVxuICAgICAgICAgICAgICAgICAgJHtyZXN1bHRzQ2hlY2t9XG4gICAgICAgICAgICAgICAgICBpeCA9IG5leHRJeDtcbiAgICAgICAgICAgICAgICB9XFxuYDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwicHJvamVjdGlvblwiOlxuICAgICAgICB2YXIgcHJvamVjdGVkVmFycyA9IFtdO1xuICAgICAgICB2YXIgaWRTdHJpbmdQYXJ0cyA9IFtdO1xuICAgICAgICBmb3IobGV0IG5ld0ZpZWxkIGluIHJvb3QucHJvamVjdGlvbk1hcCkge1xuICAgICAgICAgIGxldCBtYXBwaW5nID0gcm9vdC5wcm9qZWN0aW9uTWFwW25ld0ZpZWxkXTtcbiAgICAgICAgICBsZXQgdmFsdWUgPSBcIlwiO1xuICAgICAgICAgIGlmKG1hcHBpbmcuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICAgICAgICBpZihtYXBwaW5nWzFdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSBgdW5wcm9qZWN0ZWRbaXggKyAke21hcHBpbmdbMF19XWA7XG4gICAgICAgICAgICB9IGVsc2UgaWYoIXJvb3QudW5wcm9qZWN0ZWQgfHwgcm9vdC51bnByb2plY3RlZFttYXBwaW5nWzBdXSkge1xuICAgICAgICAgICAgICB2YWx1ZSA9IGByb3cke21hcHBpbmdbMF19Wycke21hcHBpbmdbMV19J11gO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSBgdW5wcm9qZWN0ZWRbaXggKyAke21hcHBpbmdbMF19XVsnJHttYXBwaW5nWzFdfSddYDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFsdWUgPSBKU09OLnN0cmluZ2lmeShtYXBwaW5nKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJvamVjdGVkVmFycy5wdXNoKGBwcm9qZWN0ZWRbJyR7bmV3RmllbGQucmVwbGFjZSgvJy9nLCBcIlxcXFwnXCIpfSddID0gJHt2YWx1ZX1gKTtcbiAgICAgICAgICBpZFN0cmluZ1BhcnRzLnB1c2godmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gcHJvamVjdGVkVmFycy5qb2luKFwiO1xcblwiKSArIFwiXFxuXCI7XG4gICAgICAgIGNvZGUgKz0gYHByb2plY3RlZC5fX2lkID0gJHtpZFN0cmluZ1BhcnRzLmpvaW4oYCArIFwifFwiICsgYCl9O1xcbmA7XG4gICAgICAgIGNvZGUgKz0gYHJlc3VsdHMucHVzaChwcm9qZWN0ZWQpO1xcbmA7XG4gICAgICAgIGNvZGUgKz0gYHByb2plY3RlZCA9IHt9O1xcbmA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInByb3ZlbmFuY2VcIjpcbiAgICAgICAgdmFyIHByb3ZlbmFuY2UgPSBcInZhciBwcm92ZW5hbmNlX19pZCA9ICcnO1xcblwiO1xuICAgICAgICB2YXIgaWRzID0gW107XG4gICAgICAgIGZvcihsZXQgam9pbiBvZiB0aGlzLmpvaW5zKSB7XG4gICAgICAgICAgaWYoam9pbi5uZWdhdGVkKSBjb250aW51ZTtcbiAgICAgICAgICBwcm92ZW5hbmNlICs9IGBwcm92ZW5hbmNlX19pZCA9IHRhYmxlSWQgKyAnfCcgKyBwcm9qZWN0ZWQuX19pZCArICd8JyArIHJvd0luc3RhbmNlICsgJ3wke2pvaW4udGFibGV9fCcgKyByb3cke2pvaW4uaXh9Ll9faWQ7IFxcbmA7XG4gICAgICAgICAgcHJvdmVuYW5jZSArPSBgcHJvdmVuYW5jZS5wdXNoKHt0YWJsZTogdGFibGVJZCwgcm93OiBwcm9qZWN0ZWQsIFwicm93IGluc3RhbmNlXCI6IHJvd0luc3RhbmNlLCBzb3VyY2U6IFwiJHtqb2luLnRhYmxlfVwiLCBcInNvdXJjZSByb3dcIjogcm93JHtqb2luLml4fX0pO1xcbmA7XG4gICAgICAgICAgaWRzLnB1c2goYHJvdyR7am9pbi5peH0uX19pZGApO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgPSBgdmFyIHJvd0luc3RhbmNlID0gJHtpZHMuam9pbihcIiArICd8JyArIFwiKX07XG4gICAgICAgICR7cHJvdmVuYW5jZX1gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJyZXR1cm5cIjpcbiAgICAgICAgdmFyIHJldHVybnMgPSBbXTtcbiAgICAgICAgZm9yKGxldCBjdXJWYXIgb2Ygcm9vdC52YXJzKSB7XG4gICAgICAgICAgcmV0dXJucy5wdXNoKGAke2N1clZhcn06ICR7Y3VyVmFyfWApO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gYHJldHVybiB7JHtyZXR1cm5zLmpvaW4oXCIsIFwiKX19O2A7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgICByZXR1cm4gY29kZTtcbiAgfVxuICAvLyBnaXZlbiBhIHNldCBvZiBjaGFuZ2VzIGFuZCBhIGpvaW4gb3JkZXIsIGRldGVybWluZSB0aGUgcm9vdCBmYWN0cyB0aGF0IG5lZWRcbiAgLy8gdG8gYmUgam9pbmVkIGFnYWluIHRvIGNvdmVyIGFsbCB0aGUgYWRkc1xuICByZXZlcnNlSm9pbihqb2lucykge1xuICAgIGxldCBjaGFuZ2VkID0gam9pbnNbMF07XG4gICAgbGV0IHJldmVyc2VKb2luTWFwID0ge307XG4gICAgLy8gY29sbGVjdCBhbGwgdGhlIGNvbnN0cmFpbnRzIGFuZCByZXZlcnNlIHRoZW1cbiAgICBmb3IgKGxldCBqb2luIG9mIGpvaW5zKSB7XG4gICAgICBmb3IgKGxldCBrZXkgaW4gam9pbi5qb2luKSB7XG4gICAgICAgIGxldCBbc291cmNlLCBmaWVsZF0gPSBqb2luLmpvaW5ba2V5XTtcbiAgICAgICAgaWYgKHNvdXJjZSA8PSBjaGFuZ2VkLml4KSB7XG4gICAgICAgICAgaWYgKCFyZXZlcnNlSm9pbk1hcFtzb3VyY2VdKSB7XG4gICAgICAgICAgICByZXZlcnNlSm9pbk1hcFtzb3VyY2VdID0ge307XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmKCFyZXZlcnNlSm9pbk1hcFtzb3VyY2VdW2ZpZWxkXSkgcmV2ZXJzZUpvaW5NYXBbc291cmNlXVtmaWVsZF0gPSBbam9pbi5peCwga2V5XTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICB2YXIgcmVjdXJzZSA9IChqb2lucywgam9pbkl4KSA9PiB7XG4gICAgICB2YXIgY29kZSA9IFwiXCI7XG4gICAgICBpZiAoam9pbkl4ID49IGpvaW5zLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gXCJvdGhlcnMucHVzaChyb3cwKVwiO1xuICAgICAgfVxuICAgICAgbGV0IHt0YWJsZSwgaXgsIG5lZ2F0ZWR9ID0gam9pbnNbam9pbkl4XTtcbiAgICAgIGxldCBqb2luTWFwID0gam9pbnNbam9pbkl4XS5qb2luO1xuICAgICAgLy8gd2Ugb25seSBjYXJlIGFib3V0IHRoaXMgZ3V5IGlmIGhlJ3Mgam9pbmVkIHdpdGggYXQgbGVhc3Qgb25lIHRoaW5nXG4gICAgICBpZiAoIXJldmVyc2VKb2luTWFwW2l4XSAmJiBqb2luSXggPCBqb2lucy5sZW5ndGggLSAxKSByZXR1cm4gcmVjdXJzZShqb2lucywgam9pbkl4ICsgMSk7XG4gICAgICBlbHNlIGlmKCFyZXZlcnNlSm9pbk1hcCkgcmV0dXJuIFwiXCI7XG4gICAgICBsZXQgbWFwcGluZ3MgPSBbXTtcbiAgICAgIGZvciAobGV0IGtleSBpbiByZXZlcnNlSm9pbk1hcFtpeF0pIHtcbiAgICAgICAgbGV0IFtzb3VyY2VJeCwgZmllbGRdID0gcmV2ZXJzZUpvaW5NYXBbaXhdW2tleV07XG4gICAgICAgIGlmKHNvdXJjZUl4ID09PSBjaGFuZ2VkLml4IHx8IHJldmVyc2VKb2luTWFwW3NvdXJjZUl4XSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbWFwcGluZ3MucHVzaChgJyR7a2V5fSc6IHJvdyR7c291cmNlSXh9Wycke2ZpZWxkfSddYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZvcihsZXQga2V5IGluIGpvaW5NYXApIHtcbiAgICAgICAgbGV0IHZhbHVlID0gam9pbk1hcFtrZXldO1xuICAgICAgICBpZih2YWx1ZS5jb25zdHJ1Y3RvciAhPT0gQXJyYXkpIHtcbiAgICAgICAgICBtYXBwaW5ncy5wdXNoKGAnJHtrZXl9JzogJHtKU09OLnN0cmluZ2lmeSh2YWx1ZSl9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChuZWdhdGVkKSB7XG4gICAgICAgIC8vQFRPRE86IGRlYWwgd2l0aCBuZWdhdGlvbjtcbiAgICAgIH1cbiAgICAgIGNvZGUgKz0gYFxuICAgICAgICAgICAgdmFyIHJvd3Mke2l4fSA9IGV2ZS5maW5kKCcke3RhYmxlfScsIHske21hcHBpbmdzLmpvaW4oXCIsIFwiKSB9fSk7XG4gICAgICAgICAgICBmb3IodmFyIHJvd3NJeCR7aXh9ID0gMCwgcm93c0xlbiR7aXh9ID0gcm93cyR7aXh9Lmxlbmd0aDsgcm93c0l4JHtpeH0gPCByb3dzTGVuJHtpeH07IHJvd3NJeCR7aXh9KyspIHtcbiAgICAgICAgICAgICAgICB2YXIgcm93JHtpeH0gPSByb3dzJHtpeH1bcm93c0l4JHtpeH1dO1xuICAgICAgICAgICAgICAgICR7cmVjdXJzZShqb2lucywgam9pbkl4ICsgMSkgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYDtcbiAgICAgIHJldHVybiBjb2RlO1xuICAgIH1cbiAgICByZXR1cm4gcmVjdXJzZShqb2lucywgMSk7XG5cdH1cbiAgY29tcGlsZUluY3JlbWVudGFsUm93RmluZGVyQ29kZSgpIHtcbiAgICAgIGxldCBjb2RlID0gXCJ2YXIgb3RoZXJzID0gW107XFxuXCI7XG4gICAgICBsZXQgcmV2ZXJzZWQgPSB0aGlzLmpvaW5zLnNsaWNlKCkucmV2ZXJzZSgpO1xuICAgICAgbGV0IGNoZWNrcyA9IFtdO1xuICAgICAgbGV0IGl4ID0gMDtcbiAgICAgIGZvciAobGV0IGpvaW4gb2YgcmV2ZXJzZWQpIHtcbiAgICAgICAgICAvLyB3ZSBkb24ndCB3YW50IHRvIGRvIHRoaXMgZm9yIHRoZSByb290XG4gICAgICAgICAgaWYgKGl4ID09PSByZXZlcnNlZC5sZW5ndGggLSAxKSBicmVhaztcbiAgICAgICAgICBjaGVja3MucHVzaChgXG5cdFx0XHRpZihjaGFuZ2VzW1wiJHtqb2luLnRhYmxlfVwiXSAmJiBjaGFuZ2VzW1wiJHtqb2luLnRhYmxlfVwiXS5hZGRzKSB7XG4gICAgICAgICAgICAgICAgdmFyIGN1ckNoYW5nZXMke2pvaW4uaXh9ID0gY2hhbmdlc1tcIiR7am9pbi50YWJsZX1cIl0uYWRkcztcbiAgICAgICAgICAgICAgICBmb3IodmFyIGNoYW5nZUl4JHtqb2luLml4fSA9IDAsIGNoYW5nZUxlbiR7am9pbi5peH0gPSBjdXJDaGFuZ2VzJHtqb2luLml4fS5sZW5ndGg7IGNoYW5nZUl4JHtqb2luLml4fSA8IGNoYW5nZUxlbiR7am9pbi5peH07IGNoYW5nZUl4JHtqb2luLml4fSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciByb3cke2pvaW4uaXh9ID0gY3VyQ2hhbmdlcyR7am9pbi5peH1bY2hhbmdlSXgke2pvaW4uaXh9XTtcblx0XHRcdFx0XHQke3RoaXMucmV2ZXJzZUpvaW4ocmV2ZXJzZWQuc2xpY2UoaXgpKX1cblx0XHRcdFx0fVxuXHRcdFx0fWApO1xuICAgICAgICAgIGl4Kys7XG4gICAgICB9XG4gICAgICBjb2RlICs9IGNoZWNrcy5qb2luKFwiIGVsc2VcIik7XG4gICAgICB2YXIgbGFzdCA9IHJldmVyc2VkW2l4XTtcbiAgICAgIGNvZGUgKz0gYFxuXHRcdFx0aWYoY2hhbmdlc1tcIiR7bGFzdC50YWJsZX1cIl0gJiYgY2hhbmdlc1tcIiR7bGFzdC50YWJsZX1cIl0uYWRkcykge1xuICAgICAgICAgICAgICAgIHZhciBjdXJDaGFuZ2VzID0gY2hhbmdlc1tcIiR7bGFzdC50YWJsZX1cIl0uYWRkcztcblx0XHRcdFx0Zm9yKHZhciBjaGFuZ2VJeCA9IDAsIGNoYW5nZUxlbiA9IGN1ckNoYW5nZXMubGVuZ3RoOyBjaGFuZ2VJeCA8IGNoYW5nZUxlbjsgY2hhbmdlSXgrKykge1xuXHRcdFx0XHRcdG90aGVycy5wdXNoKGN1ckNoYW5nZXNbY2hhbmdlSXhdKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIG90aGVycztgO1xuICAgICAgcmV0dXJuIGNvZGU7XG4gIH1cbiAgaW5jcmVtZW50YWxSZW1vdmUoY2hhbmdlcykge1xuICAgIGxldCBpeGVyID0gdGhpcy5peGVyO1xuICAgIGxldCByb3dzVG9Qb3N0Q2hlY2sgPSBbXTtcbiAgICBsZXQgcHJvdmVuYW5jZURpZmYgPSB0aGlzLml4ZXIuZGlmZigpO1xuICAgIGxldCByZW1vdmVzID0gW107XG4gICAgbGV0IGluZGV4ZXMgPSBpeGVyLnRhYmxlKFwicHJvdmVuYW5jZVwiKS5pbmRleGVzO1xuICAgIGxldCBzb3VyY2VSb3dMb29rdXAgPSBpbmRleGVzW1wic291cmNlfHNvdXJjZSByb3d8dGFibGVcIl0uaW5kZXg7XG4gICAgbGV0IHJvd0luc3RhbmNlTG9va3VwID0gaW5kZXhlc1tcInJvdyBpbnN0YW5jZXx0YWJsZVwiXS5pbmRleDtcbiAgICBsZXQgdGFibGVSb3dMb29rdXAgPSBpbmRleGVzW1wicm93fHRhYmxlXCJdLmluZGV4O1xuICAgIGxldCBwcm92ZW5hbmNlUmVtb3ZlcyA9IFtdO1xuICAgIGxldCB2aXNpdGVkID0ge31cbiAgICBmb3IobGV0IGpvaW4gb2YgdGhpcy5qb2lucykge1xuICAgICAgbGV0IGNoYW5nZSA9IGNoYW5nZXNbam9pbi50YWJsZV07XG4gICAgICBpZighdmlzaXRlZFtqb2luLnRhYmxlXSAmJiBjaGFuZ2UgJiYgY2hhbmdlLnJlbW92ZXMubGVuZ3RoKSB7XG4gICAgICAgIHZpc2l0ZWRbam9pbi50YWJsZV0gPSB0cnVlO1xuICAgICAgICBmb3IobGV0IHJlbW92ZSBvZiBjaGFuZ2UucmVtb3Zlcykge1xuICAgICAgICAgIGxldCBwcm92ZW5hbmNlcyA9IHNvdXJjZVJvd0xvb2t1cFtqb2luLnRhYmxlICsgJ3wnICsgcmVtb3ZlLl9faWQgKyAnfCcgKyB0aGlzLm5hbWVdXG4gICAgICAgICAgaWYocHJvdmVuYW5jZXMpIHtcbiAgICAgICAgICAgIGZvcihsZXQgcHJvdmVuYW5jZSBvZiBwcm92ZW5hbmNlcykge1xuICAgICAgICAgICAgICBpZighdmlzaXRlZFtwcm92ZW5hbmNlW1wicm93IGluc3RhbmNlXCJdXSkge1xuICAgICAgICAgICAgICAgIHZpc2l0ZWRbcHJvdmVuYW5jZVtcInJvdyBpbnN0YW5jZVwiXV0gPSB0cnVlO1xuICAgICAgICAgICAgICAgIGxldCByZWxhdGVkUHJvdmVuYW5jZSA9IHJvd0luc3RhbmNlTG9va3VwW3Byb3ZlbmFuY2VbXCJyb3cgaW5zdGFuY2VcIl0gKyAnfCcgKyBwcm92ZW5hbmNlLnRhYmxlXTtcbiAgICAgICAgICAgICAgICBmb3IobGV0IHJlbGF0ZWQgb2YgcmVsYXRlZFByb3ZlbmFuY2UpIHtcbiAgICAgICAgICAgICAgICAgIHByb3ZlbmFuY2VSZW1vdmVzLnB1c2gocmVsYXRlZCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJvd3NUb1Bvc3RDaGVjay5wdXNoKHByb3ZlbmFuY2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBwcm92ZW5hbmNlRGlmZi5yZW1vdmVGYWN0cyhcInByb3ZlbmFuY2VcIiwgcHJvdmVuYW5jZVJlbW92ZXMpO1xuICAgIGl4ZXIuYXBwbHlEaWZmSW5jcmVtZW50YWwocHJvdmVuYW5jZURpZmYpO1xuICAgIGxldCBpc0VkYiA9IGl4ZXIuZWRiVGFibGVzO1xuICAgIGZvcihsZXQgcm93IG9mIHJvd3NUb1Bvc3RDaGVjaykge1xuICAgICAgbGV0IHN1cHBvcnRzID0gdGFibGVSb3dMb29rdXBbcm93LnJvdy5fX2lkICsgJ3wnICsgcm93LnRhYmxlXTtcbiAgICAgIGlmKCFzdXBwb3J0cyB8fCBzdXBwb3J0cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmVtb3Zlcy5wdXNoKHJvdy5yb3cpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVtb3ZlcztcbiAgfVxuICBjYW5CZUluY3JlbWVudGFsKCkge1xuICAgIGlmKHRoaXMuYWdncmVnYXRlcy5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICBpZih0aGlzLnNvcnRzKSByZXR1cm4gZmFsc2U7XG4gICAgaWYodGhpcy5ncm91cHMpIHJldHVybiBmYWxzZTtcbiAgICBpZih0aGlzLmxpbWl0SW5mbykgcmV0dXJuIGZhbHNlO1xuICAgIGZvcihsZXQgam9pbiBvZiB0aGlzLmpvaW5zKSB7XG4gICAgICBpZihqb2luLm5lZ2F0ZWQpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYoIXRoaXMuam9pbnMubGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgY29tcGlsZSgpIHtcbiAgICBsZXQgYXN0ID0gdGhpcy50b0FTVCgpO1xuICAgIGxldCBjb2RlID0gdGhpcy5jb21waWxlQVNUKGFzdCk7XG4gICAgdGhpcy5jb21waWxlZCA9IG5ldyBGdW5jdGlvbihcIml4ZXJcIiwgXCJRdWVyeUZ1bmN0aW9uc1wiLCBcInRhYmxlSWRcIiwgXCJyb290Um93c1wiLCBjb2RlKTtcbiAgICBpZih0aGlzLmNhbkJlSW5jcmVtZW50YWwoKSkge1xuICAgICAgdGhpcy5pbmNyZW1lbnRhbFJvd0ZpbmRlciA9IG5ldyBGdW5jdGlvbihcImNoYW5nZXNcIiwgdGhpcy5jb21waWxlSW5jcmVtZW50YWxSb3dGaW5kZXJDb2RlKCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmluY3JlbWVudGFsUm93RmluZGVyID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICB0aGlzLmRpcnR5ID0gZmFsc2U7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgZXhlYygpIHtcbiAgICBpZih0aGlzLmRpcnR5KSB7XG4gICAgICB0aGlzLmNvbXBpbGUoKTtcbiAgICB9XG4gICAgbGV0IHJvb3QgPSB0aGlzLmpvaW5zWzBdO1xuICAgIGxldCByb3dzO1xuICAgIGlmKHJvb3QpIHtcbiAgICAgIHJvd3MgPSB0aGlzLml4ZXIuZmluZChyb290LnRhYmxlLCByb290LmpvaW4pO1xuICAgIH0gZWxzZSB7XG4gICAgICByb3dzID0gW107XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNvbXBpbGVkKHRoaXMuaXhlciwgUXVlcnlGdW5jdGlvbnMsIHRoaXMubmFtZSwgcm93cyk7XG4gIH1cbiAgZXhlY0luY3JlbWVudGFsKGNoYW5nZXMsIHRhYmxlKToge3Byb3ZlbmFuY2U6IGFueVtdLCBhZGRzOiBhbnlbXSwgcmVtb3ZlczogYW55W119IHtcbiAgICBpZih0aGlzLmRpcnR5KSB7XG4gICAgICB0aGlzLmNvbXBpbGUoKTtcbiAgICB9XG4gICAgaWYodGhpcy5pbmNyZW1lbnRhbFJvd0ZpbmRlcikge1xuICAgICAgbGV0IHBvdGVudGlhbFJvd3MgPSB0aGlzLmluY3JlbWVudGFsUm93RmluZGVyKGNoYW5nZXMpO1xuICAgICAgLy8gaWYgdGhlIHJvb3Qgc2VsZWN0IGhhcyBzb21lIGNvbnN0YW50IGZpbHRlcnMsIHRoZW5cbiAgICAgIC8vIHRoZSBhYm92ZSByb3dzIG5lZWQgdG8gYmUgZmlsdGVyZWQgZG93biB0byBvbmx5IHRob3NlIHRoYXRcbiAgICAgIC8vIG1hdGNoLlxuICAgICAgbGV0IHJvd3MgPSBbXTtcbiAgICAgIGxldCByb290ID0gdGhpcy5qb2luc1swXTtcbiAgICAgIGxldCByb290S2V5cyA9IE9iamVjdC5rZXlzKHJvb3Quam9pbik7XG4gICAgICBpZihyb290S2V5cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJvd0xvb3A6IGZvcihsZXQgcm93IG9mIHBvdGVudGlhbFJvd3MpIHtcbiAgICAgICAgICBmb3IobGV0IGtleSBvZiByb290S2V5cykge1xuICAgICAgICAgICAgaWYocm93W2tleV0gIT09IHJvb3Quam9pbltrZXldKSBjb250aW51ZSByb3dMb29wO1xuICAgICAgICAgIH1cbiAgICAgICAgICByb3dzLnB1c2gocm93KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcm93cyA9IHBvdGVudGlhbFJvd3M7XG4gICAgICB9XG4gICAgICBsZXQgcmVzdWx0cyA9IHRoaXMuY29tcGlsZWQodGhpcy5peGVyLCBRdWVyeUZ1bmN0aW9ucywgdGhpcy5uYW1lLCByb3dzKTtcbiAgICAgIGxldCBhZGRzID0gW107XG4gICAgICBsZXQgcHJldkhhc2hlcyA9IHRhYmxlLmZhY3RIYXNoO1xuICAgICAgbGV0IHByZXZLZXlzID0gT2JqZWN0LmtleXMocHJldkhhc2hlcyk7XG4gICAgICBsZXQgc3VnZ2VzdGVkUmVtb3ZlcyA9IHRoaXMuaW5jcmVtZW50YWxSZW1vdmUoY2hhbmdlcyk7XG4gICAgICBsZXQgcmVhbERpZmYgPSBkaWZmQWRkc0FuZFJlbW92ZXMocmVzdWx0cy5yZXN1bHRzLCBzdWdnZXN0ZWRSZW1vdmVzKTtcbiAgICAgIGZvcihsZXQgcmVzdWx0IG9mIHJlYWxEaWZmLmFkZHMpIHtcbiAgICAgICAgbGV0IGlkID0gcmVzdWx0Ll9faWQ7XG4gICAgICAgIGlmKHByZXZIYXNoZXNbaWRdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBhZGRzLnB1c2gocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbGV0IGRpZmYgPSB0aGlzLml4ZXIuZGlmZigpO1xuICAgICAgZGlmZi5hZGRNYW55KFwicHJvdmVuYW5jZVwiLCByZXN1bHRzLnByb3ZlbmFuY2UpO1xuICAgICAgdGhpcy5peGVyLmFwcGx5RGlmZkluY3JlbWVudGFsKGRpZmYpO1xuICAgICAgLy8gY29uc29sZS5sb2coXCJJTkMgUFJPViBESUZGXCIsIHRoaXMubmFtZSwgZGlmZi5sZW5ndGgpO1xuICAgICAgcmV0dXJuIHtwcm92ZW5hbmNlOiByZXN1bHRzLnByb3ZlbmFuY2UsIGFkZHMsIHJlbW92ZXM6IHJlYWxEaWZmLnJlbW92ZXN9O1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgcmVzdWx0cyA9IHRoaXMuZXhlYygpO1xuICAgICAgbGV0IGFkZHMgPSBbXTtcbiAgICAgIGxldCByZW1vdmVzID0gW107XG4gICAgICBsZXQgcHJldkhhc2hlcyA9IHRhYmxlLmZhY3RIYXNoO1xuICAgICAgbGV0IHByZXZLZXlzID0gT2JqZWN0LmtleXMocHJldkhhc2hlcyk7XG4gICAgICBsZXQgbmV3SGFzaGVzID0ge307XG4gICAgICBmb3IobGV0IHJlc3VsdCBvZiByZXN1bHRzLnJlc3VsdHMpIHtcbiAgICAgICAgbGV0IGlkID0gcmVzdWx0Ll9faWQ7XG4gICAgICAgIG5ld0hhc2hlc1tpZF0gPSByZXN1bHQ7XG4gICAgICAgIGlmKHByZXZIYXNoZXNbaWRdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBhZGRzLnB1c2gocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZm9yKGxldCBoYXNoIG9mIHByZXZLZXlzKSB7XG4gICAgICAgIGxldCB2YWx1ZSA9IG5ld0hhc2hlc1toYXNoXTtcbiAgICAgICAgaWYodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICByZW1vdmVzLnB1c2gocHJldkhhc2hlc1toYXNoXSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGxldCByZWFsRGlmZiA9IGRpZmZBZGRzQW5kUmVtb3ZlcyhhZGRzLCByZW1vdmVzKTtcbiAgICAgIGxldCBkaWZmID0gdGhpcy5peGVyLmRpZmYoKTtcbiAgICAgIGRpZmYucmVtb3ZlKFwicHJvdmVuYW5jZVwiLCB7dGFibGU6IHRoaXMubmFtZX0pO1xuICAgICAgZGlmZi5hZGRNYW55KFwicHJvdmVuYW5jZVwiLCByZXN1bHRzLnByb3ZlbmFuY2UpO1xuICAgICAgdGhpcy5peGVyLmFwcGx5RGlmZkluY3JlbWVudGFsKGRpZmYpO1xuICAgICAgLy8gY29uc29sZS5sb2coXCJGVUxMIFBST1YgU0laRVwiLCB0aGlzLm5hbWUsIGRpZmYubGVuZ3RoKTtcbiAgICAgIHJldHVybiB7cHJvdmVuYW5jZTogcmVzdWx0cy5wcm92ZW5hbmNlLCBhZGRzOiByZWFsRGlmZi5hZGRzLCByZW1vdmVzOiByZWFsRGlmZi5yZW1vdmVzfTtcbiAgICB9XG4gIH1cbiAgZGVidWcoKSB7XG4gICAgY29uc29sZS5sb2codGhpcy5jb21waWxlQVNUKHRoaXMudG9BU1QoKSkpO1xuICAgIGNvbnNvbGUudGltZShcImV4ZWNcIik7XG4gICAgdmFyIHJlc3VsdHMgPSB0aGlzLmV4ZWMoKTtcbiAgICBjb25zb2xlLnRpbWVFbmQoXCJleGVjXCIpO1xuICAgIGNvbnNvbGUubG9nKHJlc3VsdHMpO1xuICAgIHJldHVybiByZXN1bHRzO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBVbmlvbiB7XG4gIG5hbWU7XG4gIHRhYmxlcztcbiAgc291cmNlcztcbiAgaXNTdGF0ZWZ1bDtcbiAgaGFzaGVyO1xuICBkaXJ0eTtcbiAgcHJldjtcbiAgY29tcGlsZWQ7XG4gIGl4ZXI7XG4gIGNvbnN0cnVjdG9yKGl4ZXIsIG5hbWUgPSBcInVua25vd25cIikge1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgdGhpcy5peGVyID0gaXhlcjtcbiAgICB0aGlzLnRhYmxlcyA9IFtdO1xuICAgIHRoaXMuc291cmNlcyA9IFtdO1xuICAgIHRoaXMuaXNTdGF0ZWZ1bCA9IGZhbHNlO1xuICAgIHRoaXMucHJldiA9IHtyZXN1bHRzOiBbXSwgaGFzaGVzOiB7fX07XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gIH1cbiAgY2hhbmdlc2V0KGl4ZXI6SW5kZXhlcikge1xuICAgIGxldCBkaWZmID0gaXhlci5kaWZmKCk7XG4gICAgZGlmZi5hZGQoXCJ2aWV3XCIsIHt2aWV3OiB0aGlzLm5hbWUsIGtpbmQ6IFwidW5pb25cIn0pO1xuICAgIGZvcihsZXQgc291cmNlIG9mIHRoaXMuc291cmNlcykge1xuICAgICAgaWYoc291cmNlLnR5cGUgPT09IFwiK1wiKSB7XG4gICAgICAgIGxldCBhY3Rpb24gPSB1dWlkKCk7XG4gICAgICAgIGRpZmYuYWRkKFwiYWN0aW9uXCIsIHt2aWV3OiB0aGlzLm5hbWUsIGFjdGlvbiwga2luZDogXCJ1bmlvblwiLCAgaXg6IDB9KTtcbiAgICAgICAgZGlmZi5hZGQoXCJhY3Rpb24gc291cmNlXCIsIHthY3Rpb24sIFwic291cmNlIHZpZXdcIjogc291cmNlLnRhYmxlfSk7XG4gICAgICAgIGZvcihsZXQgZmllbGQgaW4gc291cmNlLm1hcHBpbmcpIHtcbiAgICAgICAgICBsZXQgbWFwcGVkID0gc291cmNlLm1hcHBpbmdbZmllbGRdO1xuICAgICAgICAgIGlmKG1hcHBlZC5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpIGRpZmYuYWRkKFwiYWN0aW9uIG1hcHBpbmdcIiwge2FjdGlvbiwgZnJvbTogZmllbGQsIFwidG8gc291cmNlXCI6IHNvdXJjZS50YWJsZSwgXCJ0byBmaWVsZFwiOiBtYXBwZWRbMF19KVxuICAgICAgICAgIGVsc2UgZGlmZi5hZGQoXCJhY3Rpb24gbWFwcGluZyBjb25zdGFudFwiLCB7YWN0aW9uLCBmcm9tOiBmaWVsZCwgdmFsdWU6IG1hcHBlZH0pO1xuICAgICAgICB9XG5cbiAgICAgIH0gZWxzZSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gc291cmNlIHR5cGU6ICcke3NvdXJjZS50eXBlfSdgKTtcbiAgICB9XG4gICAgcmV0dXJuIGRpZmY7XG4gIH1cbiAgZW5zdXJlSGFzaGVyKG1hcHBpbmcpIHtcbiAgICBpZighdGhpcy5oYXNoZXIpIHtcbiAgICAgIHRoaXMuaGFzaGVyID0gZ2VuZXJhdGVTdHJpbmdGbihPYmplY3Qua2V5cyhtYXBwaW5nKSk7XG4gICAgfVxuICB9XG4gIHVuaW9uKHRhYmxlTmFtZSwgbWFwcGluZykge1xuICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICAgIHRoaXMuZW5zdXJlSGFzaGVyKG1hcHBpbmcpO1xuICAgIHRoaXMudGFibGVzLnB1c2godGFibGVOYW1lKTtcbiAgICB0aGlzLnNvdXJjZXMucHVzaCh7dHlwZTogXCIrXCIsIHRhYmxlOiB0YWJsZU5hbWUsIG1hcHBpbmd9KTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICB0b0FTVCgpIHtcbiAgICBsZXQgcm9vdCA9IHt0eXBlOiBcInVuaW9uXCIsIGNoaWxkcmVuOiBbXX07XG4gICAgcm9vdC5jaGlsZHJlbi5wdXNoKHt0eXBlOiBcImRlY2xhcmF0aW9uXCIsIHZhcjogXCJyZXN1bHRzXCIsIHZhbHVlOiBcIltdXCJ9KTtcbiAgICByb290LmNoaWxkcmVuLnB1c2goe3R5cGU6IFwiZGVjbGFyYXRpb25cIiwgdmFyOiBcInByb3ZlbmFuY2VcIiwgdmFsdWU6IFwiW11cIn0pO1xuXG4gICAgbGV0IGhhc2hlc1ZhbHVlID0gXCJ7fVwiO1xuICAgIGlmKHRoaXMuaXNTdGF0ZWZ1bCkge1xuICAgICAgICBoYXNoZXNWYWx1ZSA9IFwicHJldkhhc2hlc1wiO1xuICAgIH1cbiAgICByb290LmNoaWxkcmVuLnB1c2goe3R5cGU6IFwiZGVjbGFyYXRpb25cIiwgdmFyOiBcImhhc2hlc1wiLCB2YWx1ZTogaGFzaGVzVmFsdWV9KTtcblxuICAgIGxldCBpeCA9IDA7XG4gICAgZm9yKGxldCBzb3VyY2Ugb2YgdGhpcy5zb3VyY2VzKSB7XG4gICAgICBsZXQgYWN0aW9uO1xuICAgICAgaWYoc291cmNlLnR5cGUgPT09IFwiK1wiKSB7XG4gICAgICAgIGFjdGlvbiA9IHt0eXBlOiBcInJlc3VsdFwiLCBpeCwgY2hpbGRyZW46IFt7dHlwZTogXCJwcm92ZW5hbmNlXCIsIHNvdXJjZSwgaXh9XX07XG4gICAgICB9XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goe1xuICAgICAgICB0eXBlOiBcInNvdXJjZVwiLFxuICAgICAgICBpeCxcbiAgICAgICAgdGFibGU6IHNvdXJjZS50YWJsZSxcbiAgICAgICAgbWFwcGluZzogc291cmNlLm1hcHBpbmcsXG4gICAgICAgIGNoaWxkcmVuOiBbYWN0aW9uXSxcbiAgICAgIH0pO1xuICAgICAgaXgrKztcbiAgICB9XG4gICAgcm9vdC5jaGlsZHJlbi5wdXNoKHt0eXBlOiBcImhhc2hlc1RvUmVzdWx0c1wifSk7XG4gICAgcm9vdC5jaGlsZHJlbi5wdXNoKHt0eXBlOiBcInJldHVyblwiLCB2YXJzOiBbXCJyZXN1bHRzXCIsIFwiaGFzaGVzXCIsIFwicHJvdmVuYW5jZVwiXX0pO1xuICAgIHJldHVybiByb290O1xuICB9XG4gIGNvbXBpbGVBU1Qocm9vdCkge1xuICAgIGxldCBjb2RlID0gXCJcIjtcbiAgICBsZXQgdHlwZSA9IHJvb3QudHlwZTtcbiAgICBzd2l0Y2godHlwZSkge1xuICAgICAgY2FzZSBcInVuaW9uXCI6XG4gICAgICAgIGZvcih2YXIgY2hpbGQgb2Ygcm9vdC5jaGlsZHJlbikge1xuICAgICAgICAgIGNvZGUgKz0gdGhpcy5jb21waWxlQVNUKGNoaWxkKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJkZWNsYXJhdGlvblwiOlxuICAgICAgICBjb2RlICs9IGB2YXIgJHtyb290LnZhcn0gPSAke3Jvb3QudmFsdWV9O1xcbmA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInNvdXJjZVwiOlxuICAgICAgICB2YXIgaXggPSByb290Lml4O1xuICAgICAgICBsZXQgbWFwcGluZ0l0ZW1zID0gW107XG4gICAgICAgIGZvcihsZXQga2V5IGluIHJvb3QubWFwcGluZykge1xuICAgICAgICAgIGxldCBtYXBwaW5nID0gcm9vdC5tYXBwaW5nW2tleV07XG4gICAgICAgICAgbGV0IHZhbHVlO1xuICAgICAgICAgIGlmKG1hcHBpbmcuY29uc3RydWN0b3IgPT09IEFycmF5ICYmIG1hcHBpbmcubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICBsZXQgW2ZpZWxkXSA9IG1hcHBpbmc7XG4gICAgICAgICAgICB2YWx1ZSA9IGBzb3VyY2VSb3cke2l4fVsnJHtmaWVsZH0nXWA7XG4gICAgICAgICAgfSBlbHNlIGlmKG1hcHBpbmcuY29uc3RydWN0b3IgPT09IEFycmF5ICYmIG1hcHBpbmcubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgICBsZXQgW18sIGZpZWxkXSA9IG1hcHBpbmc7XG4gICAgICAgICAgICB2YWx1ZSA9IGBzb3VyY2VSb3cke2l4fVsnJHtmaWVsZH0nXWA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlID0gSlNPTi5zdHJpbmdpZnkobWFwcGluZyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG1hcHBpbmdJdGVtcy5wdXNoKGAnJHtrZXl9JzogJHt2YWx1ZX1gKVxuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gYHZhciBzb3VyY2VSb3dzJHtpeH0gPSBjaGFuZ2VzWycke3Jvb3QudGFibGV9J107XFxuYDtcbiAgICAgICAgY29kZSArPSBgZm9yKHZhciByb3dJeCR7aXh9ID0gMCwgcm93c0xlbiR7aXh9ID0gc291cmNlUm93cyR7aXh9Lmxlbmd0aDsgcm93SXgke2l4fSA8IHJvd3NMZW4ke2l4fTsgcm93SXgke2l4fSsrKSB7XFxuYFxuICAgICAgICBjb2RlICs9IGB2YXIgc291cmNlUm93JHtpeH0gPSBzb3VyY2VSb3dzJHtpeH1bcm93SXgke2l4fV07XFxuYDtcbiAgICAgICAgY29kZSArPSBgdmFyIG1hcHBlZFJvdyR7aXh9ID0geyR7bWFwcGluZ0l0ZW1zLmpvaW4oXCIsIFwiKX19O1xcbmBcbiAgICAgICAgZm9yKHZhciBjaGlsZCBvZiByb290LmNoaWxkcmVuKSB7XG4gICAgICAgICAgY29kZSArPSB0aGlzLmNvbXBpbGVBU1QoY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gXCJ9XFxuXCI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInJlc3VsdFwiOlxuICAgICAgICB2YXIgaXggPSByb290Lml4O1xuICAgICAgICBjb2RlICs9IGB2YXIgaGFzaCR7aXh9ID0gaGFzaGVyKG1hcHBlZFJvdyR7aXh9KTtcXG5gO1xuICAgICAgICBjb2RlICs9IGBtYXBwZWRSb3cke2l4fS5fX2lkID0gaGFzaCR7aXh9O1xcbmA7XG4gICAgICAgIGNvZGUgKz0gYGhhc2hlc1toYXNoJHtpeH1dID0gbWFwcGVkUm93JHtpeH07XFxuYDtcbiAgICAgICAgZm9yKHZhciBjaGlsZCBvZiByb290LmNoaWxkcmVuKSB7XG4gICAgICAgICAgY29kZSArPSB0aGlzLmNvbXBpbGVBU1QoY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInJlbW92ZVJlc3VsdFwiOlxuICAgICAgICB2YXIgaXggPSByb290Lml4O1xuICAgICAgICBjb2RlICs9IGBoYXNoZXNbaGFzaGVyKG1hcHBlZFJvdyR7aXh9KV0gPSBmYWxzZTtcXG5gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJoYXNoZXNUb1Jlc3VsdHNcIjpcbiAgICAgICAgY29kZSArPSBcInZhciBoYXNoS2V5cyA9IE9iamVjdC5rZXlzKGhhc2hlcyk7XFxuXCI7XG4gICAgICAgIGNvZGUgKz0gXCJmb3IodmFyIGhhc2hLZXlJeCA9IDAsIGhhc2hLZXlMZW4gPSBoYXNoS2V5cy5sZW5ndGg7IGhhc2hLZXlJeCA8IGhhc2hLZXlMZW47IGhhc2hLZXlJeCsrKSB7XFxuXCI7XG4gICAgICAgIGNvZGUgKz0gXCJ2YXIgY3VySGFzaEtleSA9IGhhc2hLZXlzW2hhc2hLZXlJeF07XCJcbiAgICAgICAgY29kZSArPSBcInZhciB2YWx1ZSA9IGhhc2hlc1tjdXJIYXNoS2V5XTtcXG5cIjtcbiAgICAgICAgY29kZSArPSBcImlmKHZhbHVlICE9PSBmYWxzZSkge1xcblwiO1xuICAgICAgICBjb2RlICs9IFwidmFsdWUuX19pZCA9IGN1ckhhc2hLZXk7XFxuXCI7XG4gICAgICAgIGNvZGUgKz0gXCJyZXN1bHRzLnB1c2godmFsdWUpO1xcblwiO1xuICAgICAgICBjb2RlICs9IFwifVxcblwiO1xuICAgICAgICBjb2RlICs9IFwifVxcblwiO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJwcm92ZW5hbmNlXCI6XG4gICAgICAgIHZhciBzb3VyY2UgPSByb290LnNvdXJjZS50YWJsZTtcbiAgICAgICAgdmFyIGl4ID0gcm9vdC5peDtcbiAgICAgICAgdmFyIHByb3ZlbmFuY2UgPSBcInZhciBwcm92ZW5hbmNlX19pZCA9ICcnO1xcblwiO1xuICAgICAgICBwcm92ZW5hbmNlICs9IGBwcm92ZW5hbmNlX19pZCA9ICcke3RoaXMubmFtZX18JyArIG1hcHBlZFJvdyR7aXh9Ll9faWQgKyAnfCcgKyByb3dJbnN0YW5jZSArICd8JHtzb3VyY2V9fCcgKyBzb3VyY2VSb3cke2l4fS5fX2lkOyBcXG5gO1xuICAgICAgICBwcm92ZW5hbmNlICs9IGBwcm92ZW5hbmNlLnB1c2goe3RhYmxlOiAnJHt0aGlzLm5hbWV9Jywgcm93OiBtYXBwZWRSb3cke2l4fSwgXCJyb3cgaW5zdGFuY2VcIjogcm93SW5zdGFuY2UsIHNvdXJjZTogXCIke3NvdXJjZX1cIiwgXCJzb3VyY2Ugcm93XCI6IHNvdXJjZVJvdyR7aXh9fSk7XFxuYDtcbiAgICAgICAgY29kZSA9IGB2YXIgcm93SW5zdGFuY2UgPSBcIiR7c291cmNlfXxcIiArIG1hcHBlZFJvdyR7aXh9Ll9faWQ7XG4gICAgICAgICR7cHJvdmVuYW5jZX1gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJyZXR1cm5cIjpcbiAgICAgICAgY29kZSArPSBgcmV0dXJuIHske3Jvb3QudmFycy5tYXAoKG5hbWUpID0+IGAke25hbWV9OiAke25hbWV9YCkuam9pbihcIiwgXCIpfX07YDtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBjb2RlO1xuICB9XG4gIGNvbXBpbGUoKSB7XG4gICAgbGV0IGFzdCA9IHRoaXMudG9BU1QoKTtcbiAgICBsZXQgY29kZSA9IHRoaXMuY29tcGlsZUFTVChhc3QpO1xuICAgIHRoaXMuY29tcGlsZWQgPSBuZXcgRnVuY3Rpb24oXCJpeGVyXCIsIFwiaGFzaGVyXCIsIFwiY2hhbmdlc1wiLCBjb2RlKTtcbiAgICB0aGlzLmRpcnR5ID0gZmFsc2U7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgZGVidWcoKSB7XG4gICAgbGV0IGNvZGUgPSB0aGlzLmNvbXBpbGVBU1QodGhpcy50b0FTVCgpKTtcbiAgICBjb25zb2xlLmxvZyhjb2RlKTtcbiAgICByZXR1cm4gY29kZTtcbiAgfVxuICBleGVjKCkge1xuICAgIGlmKHRoaXMuZGlydHkpIHtcbiAgICAgIHRoaXMuY29tcGlsZSgpO1xuICAgIH1cbiAgICBsZXQgY2hhbmdlcyA9IHt9XG4gICAgZm9yKGxldCBzb3VyY2Ugb2YgdGhpcy5zb3VyY2VzKSB7XG4gICAgICBjaGFuZ2VzW3NvdXJjZS50YWJsZV0gPSB0aGlzLml4ZXIudGFibGUoc291cmNlLnRhYmxlKS50YWJsZTtcbiAgICB9XG4gICAgbGV0IHJlc3VsdHMgPSB0aGlzLmNvbXBpbGVkKHRoaXMuaXhlciwgdGhpcy5oYXNoZXIsIGNoYW5nZXMpO1xuICAgIHJldHVybiByZXN1bHRzO1xuICB9XG4gIGluY3JlbWVudGFsUmVtb3ZlKGNoYW5nZXMpIHtcbiAgICBsZXQgaXhlciA9IHRoaXMuaXhlcjtcbiAgICBsZXQgcm93c1RvUG9zdENoZWNrID0gW107XG4gICAgbGV0IHByb3ZlbmFuY2VEaWZmID0gdGhpcy5peGVyLmRpZmYoKTtcbiAgICBsZXQgcmVtb3ZlcyA9IFtdO1xuICAgIGxldCBpbmRleGVzID0gaXhlci50YWJsZShcInByb3ZlbmFuY2VcIikuaW5kZXhlcztcbiAgICBsZXQgc291cmNlUm93TG9va3VwID0gaW5kZXhlc1tcInNvdXJjZXxzb3VyY2Ugcm93fHRhYmxlXCJdLmluZGV4O1xuICAgIGxldCByb3dJbnN0YW5jZUxvb2t1cCA9IGluZGV4ZXNbXCJyb3cgaW5zdGFuY2V8dGFibGVcIl0uaW5kZXg7XG4gICAgbGV0IHRhYmxlUm93TG9va3VwID0gaW5kZXhlc1tcInJvd3x0YWJsZVwiXS5pbmRleDtcbiAgICBsZXQgcHJvdmVuYW5jZVJlbW92ZXMgPSBbXTtcbiAgICBsZXQgdmlzaXRlZCA9IHt9XG4gICAgZm9yKGxldCBzb3VyY2Ugb2YgdGhpcy5zb3VyY2VzKSB7XG4gICAgICBsZXQgY2hhbmdlID0gY2hhbmdlc1tzb3VyY2UudGFibGVdO1xuICAgICAgaWYoIXZpc2l0ZWRbc291cmNlLnRhYmxlXSAmJiBjaGFuZ2UgJiYgY2hhbmdlLnJlbW92ZXMubGVuZ3RoKSB7XG4gICAgICAgIHZpc2l0ZWRbc291cmNlLnRhYmxlXSA9IHRydWU7XG4gICAgICAgIGZvcihsZXQgcmVtb3ZlIG9mIGNoYW5nZS5yZW1vdmVzKSB7XG4gICAgICAgICAgbGV0IHByb3ZlbmFuY2VzID0gc291cmNlUm93TG9va3VwW3NvdXJjZS50YWJsZSArICd8JyArIHJlbW92ZS5fX2lkICsgJ3wnICsgdGhpcy5uYW1lXVxuICAgICAgICAgIGlmKHByb3ZlbmFuY2VzKSB7XG4gICAgICAgICAgICBmb3IobGV0IHByb3ZlbmFuY2Ugb2YgcHJvdmVuYW5jZXMpIHtcbiAgICAgICAgICAgICAgaWYoIXZpc2l0ZWRbcHJvdmVuYW5jZVtcInJvdyBpbnN0YW5jZVwiXV0pIHtcbiAgICAgICAgICAgICAgICB2aXNpdGVkW3Byb3ZlbmFuY2VbXCJyb3cgaW5zdGFuY2VcIl1dID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBsZXQgcmVsYXRlZFByb3ZlbmFuY2UgPSByb3dJbnN0YW5jZUxvb2t1cFtwcm92ZW5hbmNlW1wicm93IGluc3RhbmNlXCJdICsgJ3wnICsgcHJvdmVuYW5jZS50YWJsZV07XG4gICAgICAgICAgICAgICAgZm9yKGxldCByZWxhdGVkIG9mIHJlbGF0ZWRQcm92ZW5hbmNlKSB7XG4gICAgICAgICAgICAgICAgICBwcm92ZW5hbmNlUmVtb3Zlcy5wdXNoKHJlbGF0ZWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByb3dzVG9Qb3N0Q2hlY2sucHVzaChwcm92ZW5hbmNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcHJvdmVuYW5jZURpZmYucmVtb3ZlRmFjdHMoXCJwcm92ZW5hbmNlXCIsIHByb3ZlbmFuY2VSZW1vdmVzKTtcbiAgICBpeGVyLmFwcGx5RGlmZkluY3JlbWVudGFsKHByb3ZlbmFuY2VEaWZmKTtcbiAgICBsZXQgaXNFZGIgPSBpeGVyLmVkYlRhYmxlcztcbiAgICBmb3IobGV0IHJvdyBvZiByb3dzVG9Qb3N0Q2hlY2spIHtcbiAgICAgIGxldCBzdXBwb3J0cyA9IHRhYmxlUm93TG9va3VwW3Jvdy5yb3cuX19pZCArICd8JyArIHJvdy50YWJsZV07XG4gICAgICBpZighc3VwcG9ydHMgfHwgc3VwcG9ydHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJlbW92ZXMucHVzaChyb3cucm93KTtcbiAgICAgIH0gZWxzZSBpZih0aGlzLnNvdXJjZXMubGVuZ3RoID4gMikge1xuICAgICAgICBsZXQgc3VwcG9ydHNUb1JlbW92ZSA9IFtdO1xuICAgICAgICAvLyBvdGhlcndpc2UgaWYgdGhlcmUgYXJlIHN1cHBvcnRzLCB0aGVuIHdlIG5lZWQgdG8gd2FsayB0aGUgc3VwcG9ydFxuICAgICAgICAvLyBncmFwaCBiYWNrd2FyZHMgYW5kIG1ha2Ugc3VyZSBldmVyeSBzdXBwb3J0aW5nIHJvdyB0ZXJtaW5hdGVzIGF0IGFuXG4gICAgICAgIC8vIGVkYiB2YWx1ZS4gSWYgbm90LCB0aGVuIHRoYXQgc3VwcG9ydCBhbHNvIG5lZWRzIHRvIGJlIHJlbW92ZWRcbiAgICAgICAgZm9yKGxldCBzdXBwb3J0IG9mIHN1cHBvcnRzKSB7XG4gICAgICAgICAgLy8gaWYgdGhlIHN1cHBvcnQgaXMgYWxyZWFkeSBhbiBlZGIsIHdlJ3JlIGdvb2QgdG8gZ28uXG4gICAgICAgICAgaWYoaXNFZGJbc3VwcG9ydC5zb3VyY2VdKSBjb250aW51ZTtcbiAgICAgICAgICBpZighdGFibGVSb3dMb29rdXBbc3VwcG9ydFtcInNvdXJjZSByb3dcIl0uX19pZCArICd8JyArIHN1cHBvcnQuc291cmNlXSkge1xuICAgICAgICAgICAgc3VwcG9ydHNUb1JlbW92ZS5wdXNoKHN1cHBvcnQpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGdldCBhbGwgdGhlIHN1cHBvcnRzIGZvciB0aGlzIHN1cHBvcnRcbiAgICAgICAgICBsZXQgbm9kZXMgPSB0YWJsZVJvd0xvb2t1cFtzdXBwb3J0W1wic291cmNlIHJvd1wiXS5fX2lkICsgJ3wnICsgc3VwcG9ydC5zb3VyY2VdLnNsaWNlKCk7XG4gICAgICAgICAgbGV0IG5vZGVJeCA9IDA7XG4gICAgICAgICAgLy8gaXRlcmF0ZSB0aHJvdWdoIGFsbCB0aGUgbm9kZXMsIGlmIHRoZXkgaGF2ZSBmdXJ0aGVyIHN1cHBvcnRzIHRoZW5cbiAgICAgICAgICAvLyBhc3N1bWUgdGhpcyBub2RlIGlzIG9rIGFuZCBhZGQgdGhvc2Ugc3VwcG9ydHMgdG8gdGhlIGxpc3Qgb2Ygbm9kZXMgdG9cbiAgICAgICAgICAvLyBjaGVjay4gSWYgd2UgcnVuIGludG8gYSBub2RlIHdpdGggbm8gc3VwcG9ydHMgaXQgbXVzdCBlaXRoZXIgYmUgYW4gZWRiXG4gICAgICAgICAgLy8gb3IgaXQncyB1bnN1cHBvcnRlZCBhbmQgdGhpcyByb3cgaW5zdGFuY2UgbmVlZHMgdG8gYmUgcmVtb3ZlZC5cbiAgICAgICAgICB3aGlsZShub2RlSXggPCBub2Rlcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxldCBub2RlID0gbm9kZXNbbm9kZUl4XTtcbiAgICAgICAgICAgIGlmKGlzRWRiW25vZGUuc291cmNlXSkge1xuICAgICAgICAgICAgICBub2RlSXgrKztcbiAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsZXQgbm9kZVN1cHBvcnRzID0gdGFibGVSb3dMb29rdXBbbm9kZVtcInNvdXJjZSByb3dcIl0uX19pZCArICd8JyArIG5vZGUuc291cmNlXTtcbiAgICAgICAgICAgIGlmKCFub2RlU3VwcG9ydHMgfHwgbm9kZVN1cHBvcnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICBzdXBwb3J0c1RvUmVtb3ZlLnB1c2goc3VwcG9ydCk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZm9yKGxldCBub2RlU3VwcG9ydCBvZiBub2RlU3VwcG9ydHMpIHtcbiAgICAgICAgICAgICAgICBub2Rlcy5wdXNoKG5vZGVTdXBwb3J0KTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBub2RlSXgrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYoc3VwcG9ydHNUb1JlbW92ZS5sZW5ndGgpIHtcbiAgICAgICAgICAvLyB3ZSBuZWVkIHRvIHJlbW92ZSBhbGwgdGhlIHN1cHBvcnRzXG4gICAgICAgICAgbGV0IHByb3ZlbmFuY2VSZW1vdmVzID0gW107XG4gICAgICAgICAgZm9yKGxldCBzdXBwb3J0IG9mIHN1cHBvcnRzVG9SZW1vdmUpIHtcbiAgICAgICAgICAgIGxldCByZWxhdGVkUHJvdmVuYW5jZSA9IHJvd0luc3RhbmNlTG9va3VwW3N1cHBvcnRbXCJyb3cgaW5zdGFuY2VcIl0gKyAnfCcgKyBzdXBwb3J0LnRhYmxlXTtcbiAgICAgICAgICAgIGZvcihsZXQgcmVsYXRlZCBvZiByZWxhdGVkUHJvdmVuYW5jZSkge1xuICAgICAgICAgICAgICBwcm92ZW5hbmNlUmVtb3Zlcy5wdXNoKHJlbGF0ZWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBsZXQgZGlmZiA9IGl4ZXIuZGlmZigpO1xuICAgICAgICAgIGRpZmYucmVtb3ZlRmFjdHMoXCJwcm92ZW5hbmNlXCIsIHByb3ZlbmFuY2VSZW1vdmVzKTtcbiAgICAgICAgICBpeGVyLmFwcGx5RGlmZkluY3JlbWVudGFsKGRpZmYpO1xuICAgICAgICAgIC8vIG5vdyB0aGF0IGFsbCB0aGUgdW5zdXBwb3J0ZWQgcHJvdmVuYW5jZXMgaGF2ZSBiZWVuIHJlbW92ZWQsIGNoZWNrIGlmIHRoZXJlJ3MgYW55dGhpbmdcbiAgICAgICAgICAvLyBsZWZ0LlxuICAgICAgICAgIGlmKCF0YWJsZVJvd0xvb2t1cFtyb3cucm93Ll9faWQgKyAnfCcgKyByb3cudGFibGVdIHx8IHRhYmxlUm93TG9va3VwW3Jvdy5yb3cuX19pZCArICd8JyArIHJvdy50YWJsZV0ubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZW1vdmVzLnB1c2gocm93LnJvdyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZW1vdmVzO1xuICB9XG4gIGV4ZWNJbmNyZW1lbnRhbChjaGFuZ2VzLCB0YWJsZSk6IHtwcm92ZW5hbmNlOiBhbnlbXSwgYWRkczogYW55W10sIHJlbW92ZXM6IGFueVtdfSB7XG4gICAgaWYodGhpcy5kaXJ0eSkge1xuICAgICAgdGhpcy5jb21waWxlKCk7XG4gICAgfVxuXG4gICAgbGV0IHNvdXJjZUNoYW5nZXMgPSB7fVxuICAgIGZvcihsZXQgc291cmNlIG9mIHRoaXMuc291cmNlcykge1xuICAgICAgbGV0IHZhbHVlO1xuICAgICAgaWYoIWNoYW5nZXNbc291cmNlLnRhYmxlXSkge1xuICAgICAgICB2YWx1ZSA9IFtdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUgPSBjaGFuZ2VzW3NvdXJjZS50YWJsZV0uYWRkcztcbiAgICAgIH1cbiAgICAgIHNvdXJjZUNoYW5nZXNbc291cmNlLnRhYmxlXSA9IHZhbHVlO1xuICAgIH1cbiAgICBsZXQgcmVzdWx0cyA9IHRoaXMuY29tcGlsZWQodGhpcy5peGVyLCB0aGlzLmhhc2hlciwgc291cmNlQ2hhbmdlcyk7XG4gICAgbGV0IGFkZHMgPSBbXTtcbiAgICBsZXQgcHJldkhhc2hlcyA9IHRhYmxlLmZhY3RIYXNoO1xuICAgIGxldCBwcmV2S2V5cyA9IE9iamVjdC5rZXlzKHByZXZIYXNoZXMpO1xuICAgIGxldCBzdWdnZXN0ZWRSZW1vdmVzID0gdGhpcy5pbmNyZW1lbnRhbFJlbW92ZShjaGFuZ2VzKTtcbiAgICBsZXQgcmVhbERpZmYgPSBkaWZmQWRkc0FuZFJlbW92ZXMocmVzdWx0cy5yZXN1bHRzLCBzdWdnZXN0ZWRSZW1vdmVzKTtcbiAgICBmb3IobGV0IHJlc3VsdCBvZiByZWFsRGlmZi5hZGRzKSB7XG4gICAgICBsZXQgaWQgPSByZXN1bHQuX19pZDtcbiAgICAgIGlmKHByZXZIYXNoZXNbaWRdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgYWRkcy5wdXNoKHJlc3VsdCk7XG4gICAgICB9XG4gICAgfVxuICAgIGxldCBkaWZmID0gdGhpcy5peGVyLmRpZmYoKTtcbiAgICBkaWZmLmFkZE1hbnkoXCJwcm92ZW5hbmNlXCIsIHJlc3VsdHMucHJvdmVuYW5jZSk7XG4gICAgdGhpcy5peGVyLmFwcGx5RGlmZkluY3JlbWVudGFsKGRpZmYpO1xuICAgIHJldHVybiB7cHJvdmVuYW5jZTogcmVzdWx0cy5wcm92ZW5hbmNlLCBhZGRzLCByZW1vdmVzOiByZWFsRGlmZi5yZW1vdmVzfTtcbiAgfVxufVxuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQnVpbHRpbiBQcmltaXRpdmVzXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5ydW50aW1lLmRlZmluZShcImNvdW50XCIsIHthZ2dyZWdhdGU6IHRydWUsIHJlc3VsdDogXCJjb3VudFwifSwgZnVuY3Rpb24ocHJldikge1xuICBpZighcHJldi5jb3VudCkge1xuICAgIHByZXYuY291bnQgPSAwO1xuICB9XG4gIHByZXYuY291bnQrKztcbiAgcmV0dXJuIHByZXY7XG59KTtcblxucnVudGltZS5kZWZpbmUoXCJzdW1cIiwge2FnZ3JlZ2F0ZTogdHJ1ZSwgcmVzdWx0OiBcInN1bVwifSwgZnVuY3Rpb24ocHJldiwgdmFsdWUpIHtcbiAgaWYoIXByZXYuc3VtKSB7XG4gICAgcHJldi5zdW0gPSAwO1xuICB9XG4gIHByZXYuc3VtICs9IHZhbHVlO1xuICByZXR1cm4gcHJldjtcbn0pO1xuXG5ydW50aW1lLmRlZmluZShcImF2ZXJhZ2VcIiwge2FnZ3JlZ2F0ZTogdHJ1ZSwgcmVzdWx0OiBcImF2ZXJhZ2VcIn0sIGZ1bmN0aW9uKHByZXYsIHZhbHVlKSB7XG4gIGlmKCFwcmV2LnN1bSkge1xuICAgIHByZXYuc3VtID0gMDtcbiAgICBwcmV2LmNvdW50ID0gMDtcbiAgfVxuICBwcmV2LmNvdW50Kys7XG4gIHByZXYuc3VtICs9IHZhbHVlO1xuICBwcmV2LmF2ZXJhZ2UgPSBwcmV2LnN1bSAvIHByZXYuY291bnQ7XG4gIHJldHVybiBwcmV2O1xufSk7XG5cbnJ1bnRpbWUuZGVmaW5lKFwibG93ZXJjYXNlXCIsIHtyZXN1bHQ6IFwibG93ZXJjYXNlXCJ9LCBmdW5jdGlvbih0ZXh0KSB7XG4gIGlmKHR5cGVvZiB0ZXh0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHtyZXN1bHQ6IHRleHQudG9Mb3dlckNhc2UoKX07XG4gIH1cbiAgcmV0dXJuIHtyZXN1bHQ6IHRleHR9O1xufSlcblxucnVudGltZS5kZWZpbmUoXCI9XCIsIHtmaWx0ZXI6IHRydWV9LCBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhID09PSBiID8gcnVudGltZS5TVUNDRUVEIDogcnVudGltZS5GQUlMO1xufSk7XG5cbnJ1bnRpbWUuZGVmaW5lKFwiPlwiLCB7ZmlsdGVyOiB0cnVlfSwgZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYSA+IGIgPyBydW50aW1lLlNVQ0NFRUQgOiBydW50aW1lLkZBSUw7XG59KTtcblxucnVudGltZS5kZWZpbmUoXCI8XCIsIHtmaWx0ZXI6IHRydWV9LCBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhIDwgYiA/IHJ1bnRpbWUuU1VDQ0VFRCA6IHJ1bnRpbWUuRkFJTDtcbn0pO1xuXG5ydW50aW1lLmRlZmluZShcIj49XCIsIHtmaWx0ZXI6IHRydWV9LCBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhID49IGIgPyBydW50aW1lLlNVQ0NFRUQgOiBydW50aW1lLkZBSUw7XG59KTtcblxucnVudGltZS5kZWZpbmUoXCI8PVwiLCB7ZmlsdGVyOiB0cnVlfSwgZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4gYSA8PSBiID8gcnVudGltZS5TVUNDRUVEIDogcnVudGltZS5GQUlMO1xufSk7XG5cbnJ1bnRpbWUuZGVmaW5lKFwiK1wiLCB7cmVzdWx0OiBcInJlc3VsdFwifSwgZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4ge3Jlc3VsdDogYSArIGJ9O1xufSk7XG5cbnJ1bnRpbWUuZGVmaW5lKFwiLVwiLCB7cmVzdWx0OiBcInJlc3VsdFwifSwgZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4ge3Jlc3VsdDogYSAtIGJ9O1xufSk7XG5cbnJ1bnRpbWUuZGVmaW5lKFwiKlwiLCB7cmVzdWx0OiBcInJlc3VsdFwifSwgZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4ge3Jlc3VsdDogYSAqIGJ9O1xufSk7XG5cbnJ1bnRpbWUuZGVmaW5lKFwiL1wiLCB7cmVzdWx0OiBcInJlc3VsdFwifSwgZnVuY3Rpb24oYSwgYikge1xuICByZXR1cm4ge3Jlc3VsdDogYSAvIGJ9O1xufSk7XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBU1QgYW5kIGNvbXBpbGVyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyB2aWV3OiB2aWV3LCBraW5kW3VuaW9ufHF1ZXJ5fHRhYmxlXVxuLy8gYWN0aW9uOiB2aWV3LCBhY3Rpb24sIGtpbmRbc2VsZWN0fGNhbGN1bGF0ZXxwcm9qZWN0fHVuaW9ufHVudW5pb258c3RhdGVmdWx8bGltaXR8c29ydHxncm91cHxhZ2dyZWdhdGVdLCBpeFxuLy8gYWN0aW9uIHNvdXJjZTogYWN0aW9uLCBzb3VyY2Ugdmlld1xuLy8gYWN0aW9uIG1hcHBpbmc6IGFjdGlvbiwgZnJvbSwgdG8gc291cmNlLCB0byBmaWVsZFxuLy8gYWN0aW9uIG1hcHBpbmcgY29uc3RhbnQ6IGFjdGlvbiwgZnJvbSwgdmFsdWVcblxuZnVuY3Rpb24gYWRkUmVjb21waWxlVHJpZ2dlcnMoZXZlKSB7XG5cbiAgdmFyIHJlY29tcGlsZVRyaWdnZXIgPSB7XG4gICAgZXhlYzogKGl4ZXIpID0+IHtcbiAgICAgIGZvcihsZXQgdmlldyBvZiBpeGVyLmZpbmQoXCJ2aWV3XCIpKSB7XG4gICAgICAgIGlmKHZpZXcua2luZCA9PT0gXCJ0YWJsZVwiKSBjb250aW51ZTtcbiAgICAgICAgbGV0IHF1ZXJ5ID0gY29tcGlsZShpeGVyLCB2aWV3LnZpZXcpO1xuICAgICAgICBpeGVyLmFzVmlldyhxdWVyeSk7XG4gICAgICB9XG4gICAgICByZXR1cm4ge307XG4gICAgfVxuICB9XG5cbiAgZXZlLmFkZFRhYmxlKFwidmlld1wiLCBbXCJ2aWV3XCIsIFwia2luZFwiXSk7XG4gIGV2ZS5hZGRUYWJsZShcImFjdGlvblwiLCBbXCJ2aWV3XCIsIFwiYWN0aW9uXCIsIFwia2luZFwiLCBcIml4XCJdKTtcbiAgZXZlLmFkZFRhYmxlKFwiYWN0aW9uIHNvdXJjZVwiLCBbXCJhY3Rpb25cIiwgXCJzb3VyY2Ugdmlld1wiXSk7XG4gIGV2ZS5hZGRUYWJsZShcImFjdGlvbiBtYXBwaW5nXCIsIFtcImFjdGlvblwiLCBcImZyb21cIiwgXCJ0byBzb3VyY2VcIiwgXCJ0byBmaWVsZFwiXSk7XG4gIGV2ZS5hZGRUYWJsZShcImFjdGlvbiBtYXBwaW5nIGNvbnN0YW50XCIsIFtcImFjdGlvblwiLCBcImZyb21cIiwgXCJ2YWx1ZVwiXSk7XG4gIGV2ZS5hZGRUYWJsZShcImFjdGlvbiBtYXBwaW5nIHNvcnRlZFwiLCBbXCJhY3Rpb25cIiwgXCJpeFwiLCBcInNvdXJjZVwiLCBcImZpZWxkXCIsIFwiZGlyZWN0aW9uXCJdKTtcbiAgZXZlLmFkZFRhYmxlKFwiYWN0aW9uIG1hcHBpbmcgbGltaXRcIiwgW1wiYWN0aW9uXCIsIFwibGltaXQgdHlwZVwiLCBcInZhbHVlXCJdKTtcblxuICBldmUudGFibGUoXCJ2aWV3XCIpLnRyaWdnZXJzW1wicmVjb21waWxlXCJdID0gcmVjb21waWxlVHJpZ2dlcjtcbiAgZXZlLnRhYmxlKFwiYWN0aW9uXCIpLnRyaWdnZXJzW1wicmVjb21waWxlXCJdID0gcmVjb21waWxlVHJpZ2dlcjtcbiAgZXZlLnRhYmxlKFwiYWN0aW9uIHNvdXJjZVwiKS50cmlnZ2Vyc1tcInJlY29tcGlsZVwiXSA9IHJlY29tcGlsZVRyaWdnZXI7XG4gIGV2ZS50YWJsZShcImFjdGlvbiBtYXBwaW5nXCIpLnRyaWdnZXJzW1wicmVjb21waWxlXCJdID0gcmVjb21waWxlVHJpZ2dlcjtcbiAgZXZlLnRhYmxlKFwiYWN0aW9uIG1hcHBpbmcgY29uc3RhbnRcIikudHJpZ2dlcnNbXCJyZWNvbXBpbGVcIl0gPSByZWNvbXBpbGVUcmlnZ2VyO1xuICBldmUudGFibGUoXCJhY3Rpb24gbWFwcGluZyBzb3J0ZWRcIikudHJpZ2dlcnNbXCJyZWNvbXBpbGVcIl0gPSByZWNvbXBpbGVUcmlnZ2VyO1xuICBldmUudGFibGUoXCJhY3Rpb24gbWFwcGluZyBsaW1pdFwiKS50cmlnZ2Vyc1tcInJlY29tcGlsZVwiXSA9IHJlY29tcGlsZVRyaWdnZXI7XG5cbiAgcmV0dXJuIGV2ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGUoaXhlciwgdmlld0lkKSB7XG4gIGxldCB2aWV3ID0gaXhlci5maW5kT25lKFwidmlld1wiLCB7dmlldzogdmlld0lkfSk7XG4gIGlmKCF2aWV3KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyB2aWV3IGZvdW5kIGZvciAke3ZpZXdJZH0uYCk7XG4gIH1cbiAgbGV0IGNvbXBpbGVkID0gaXhlclt2aWV3LmtpbmRdKHZpZXdJZCk7XG4gIGxldCBhY3Rpb25zID0gaXhlci5maW5kKFwiYWN0aW9uXCIsIHt2aWV3OiB2aWV3SWR9KTtcbiAgaWYoIWFjdGlvbnMpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFZpZXcgJHt2aWV3SWR9IGhhcyBubyBhY3Rpb25zLmApO1xuICB9XG4gIC8vIHNvcnQgYWN0aW9ucyBieSBpeFxuICBhY3Rpb25zLnNvcnQoKGEsIGIpID0+IGEuaXggLSBiLml4KTtcbiAgZm9yKGxldCBhY3Rpb24gb2YgYWN0aW9ucykge1xuICAgIGxldCBhY3Rpb25LaW5kID0gYWN0aW9uLmtpbmQ7XG4gICAgaWYoYWN0aW9uS2luZCA9PT0gXCJsaW1pdFwiKSB7XG4gICAgICBsZXQgbGltaXQgPSB7fTtcbiAgICAgIGZvcihsZXQgbGltaXRNYXBwaW5nIG9mIGl4ZXIuZmluZChcImFjdGlvbiBtYXBwaW5nIGxpbWl0XCIsIHthY3Rpb246IGFjdGlvbi5hY3Rpb259KSkge1xuICAgICAgICBsaW1pdFtsaW1pdE1hcHBpbmdbXCJsaW1pdCB0eXBlXCJdXSA9IGxpbWl0TWFwcGluZ1tcInZhbHVlXCJdO1xuICAgICAgfVxuICAgICAgY29tcGlsZWQubGltaXQobGltaXQpO1xuICAgIH0gZWxzZSBpZihhY3Rpb25LaW5kID09PSBcInNvcnRcIiB8fCBhY3Rpb25LaW5kID09PSBcImdyb3VwXCIpIHtcbiAgICAgIGxldCBzb3J0ZWQgPSBbXTtcbiAgICAgIGxldCBtYXBwaW5ncyA9IGl4ZXIuZmluZChcImFjdGlvbiBtYXBwaW5nIHNvcnRlZFwiLCB7YWN0aW9uOiBhY3Rpb24uYWN0aW9ufSk7XG4gICAgICBtYXBwaW5ncy5zb3J0KChhLCBiKSA9PiBhLml4IC0gYi5peCk7XG4gICAgICBmb3IobGV0IG1hcHBpbmcgb2YgbWFwcGluZ3MpIHtcbiAgICAgICAgc29ydGVkLnB1c2goW21hcHBpbmdbXCJzb3VyY2VcIl0sIG1hcHBpbmdbXCJmaWVsZFwiXSwgbWFwcGluZ1tcImRpcmVjdGlvblwiXV0pO1xuICAgICAgfVxuICAgICAgaWYoc29ydGVkLmxlbmd0aCkge1xuICAgICAgICBjb21waWxlZFthY3Rpb25LaW5kXShzb3J0ZWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2FjdGlvbktpbmR9IHdpdGhvdXQgYW55IG1hcHBpbmdzOiAke2FjdGlvbi5hY3Rpb259YClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IG1hcHBpbmdzID0gaXhlci5maW5kKFwiYWN0aW9uIG1hcHBpbmdcIiwge2FjdGlvbjogYWN0aW9uLmFjdGlvbn0pO1xuICAgICAgbGV0IG1hcHBpbmdPYmplY3QgPSB7fTtcbiAgICAgIGZvcihsZXQgbWFwcGluZyBvZiBtYXBwaW5ncykge1xuICAgICAgICBsZXQgc291cmNlID0gbWFwcGluZ1tcInRvIHNvdXJjZVwiXTtcbiAgICAgICAgbGV0IGZpZWxkID0gbWFwcGluZ1tcInRvIGZpZWxkXCJdO1xuICAgICAgICBpZihhY3Rpb25LaW5kID09PSBcInVuaW9uXCIgfHwgYWN0aW9uS2luZCA9PT0gXCJ1bnVuaW9uXCIpIHtcbiAgICAgICAgICBtYXBwaW5nT2JqZWN0W21hcHBpbmcuZnJvbV0gPSBbZmllbGRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1hcHBpbmdPYmplY3RbbWFwcGluZy5mcm9tXSA9IFtzb3VyY2UsIGZpZWxkXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbGV0IGNvbnN0YW50cyA9IGl4ZXIuZmluZChcImFjdGlvbiBtYXBwaW5nIGNvbnN0YW50XCIsIHthY3Rpb246IGFjdGlvbi5hY3Rpb259KTtcbiAgICAgIGZvcihsZXQgY29uc3RhbnQgb2YgY29uc3RhbnRzKSB7XG4gICAgICAgIG1hcHBpbmdPYmplY3RbY29uc3RhbnQuZnJvbV0gPSBjb25zdGFudC52YWx1ZTtcbiAgICAgIH1cbiAgICAgIGxldCBzb3VyY2UgPSBpeGVyLmZpbmRPbmUoXCJhY3Rpb24gc291cmNlXCIsIHthY3Rpb246IGFjdGlvbi5hY3Rpb259KTtcbiAgICAgIGlmKCFzb3VyY2UgJiYgYWN0aW9uS2luZCAhPT0gXCJwcm9qZWN0XCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke2FjdGlvbktpbmR9IGFjdGlvbiB3aXRob3V0IGEgc291cmNlIGluICcke3ZpZXdJZH0nYCk7XG4gICAgICB9XG4gICAgICBpZihhY3Rpb25LaW5kICE9PSBcInByb2plY3RcIikge1xuICAgICAgICBjb21waWxlZFthY3Rpb25LaW5kXShzb3VyY2VbXCJzb3VyY2Ugdmlld1wiXSwgbWFwcGluZ09iamVjdCwgYWN0aW9uLmFjdGlvbik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb21waWxlZFthY3Rpb25LaW5kXShtYXBwaW5nT2JqZWN0KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNvbXBpbGVkO1xufVxuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIEFQSVxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGNvbnN0IFNVQ0NFRUQgPSBbe3N1Y2Nlc3M6IHRydWV9XTtcbmV4cG9ydCBjb25zdCBGQUlMID0gW107XG5cbmV4cG9ydCBmdW5jdGlvbiBpbmRleGVyKCkge1xuICBsZXQgaXhlciA9IG5ldyBJbmRleGVyKCk7XG4gIGFkZFByb3ZlbmFuY2VUYWJsZShpeGVyKTtcbiAgYWRkUmVjb21waWxlVHJpZ2dlcnMoaXhlcik7XG4gIHJldHVybiBpeGVyO1xufVxuXG5pZihFTlYgPT09IFwiYnJvd3NlclwiKSB3aW5kb3dbXCJydW50aW1lXCJdID0gZXhwb3J0cztcbiIsImltcG9ydCB7dW5wYWQsIHJlcGVhdCwgREVCVUcsIHV1aWR9IGZyb20gXCIuL3V0aWxzXCI7XG5pbXBvcnQge0VsZW1lbnQsIEhhbmRsZXJ9IGZyb20gXCIuL21pY3JvUmVhY3RcIjtcbmltcG9ydCB7SW5kZXhlciwgUXVlcnl9IGZyb20gXCIuL3J1bnRpbWVcIjtcblxuZnVuY3Rpb24gcmVzb2x2ZSh0YWJsZSwgZmFjdCkge1xuICBsZXQgbmV1ZSA9IHt9O1xuICBmb3IobGV0IGZpZWxkIGluIGZhY3QpXG4gICAgbmV1ZVtgJHt0YWJsZX06ICR7ZmllbGR9YF0gPSBmYWN0W2ZpZWxkXTtcbiAgcmV0dXJuIG5ldWU7XG59XG5mdW5jdGlvbiBodW1hbml6ZSh0YWJsZSwgZmFjdCkge1xuICBsZXQgbmV1ZSA9IHt9O1xuICBmb3IobGV0IGZpZWxkIGluIGZhY3QpXG4gICAgbmV1ZVtmaWVsZC5zbGljZSh0YWJsZS5sZW5ndGggKyAyKV0gPSBmYWN0W2ZpZWxkXTtcbiAgcmV0dXJuIG5ldWU7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVkQWRkKGNoYW5nZXNldCwgdGFibGUsIGZhY3QpIHtcbiAgcmV0dXJuIGNoYW5nZXNldC5hZGQodGFibGUsIHJlc29sdmUodGFibGUsIGZhY3QpKTtcbn1cbmZ1bmN0aW9uIHJlc29sdmVkUmVtb3ZlKGNoYW5nZXNldCwgdGFibGUsIGZhY3QpIHtcbiAgcmV0dXJuIGNoYW5nZXNldC5yZW1vdmUodGFibGUsIHJlc29sdmUodGFibGUsIGZhY3QpKTtcbn1cbmZ1bmN0aW9uIGh1bWFuaXplZEZpbmQoaXhlcjpJbmRleGVyLCB0YWJsZSwgcXVlcnkpIHtcbiAgbGV0IHJlc3VsdHMgPSBbXTtcbiAgZm9yKGxldCBmYWN0IG9mIGl4ZXIuZmluZCh0YWJsZSwgcmVzb2x2ZSh0YWJsZSwgcXVlcnkpKSkgcmVzdWx0cy5wdXNoKGh1bWFuaXplKHRhYmxlLCBmYWN0KSk7XG4gIGxldCBkaWFnID0ge307XG4gIGZvcihsZXQgdGFibGUgaW4gaXhlci50YWJsZXMpIGRpYWdbdGFibGVdID0gaXhlci50YWJsZXNbdGFibGVdLnRhYmxlLmxlbmd0aDtcbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbmV4cG9ydCBjbGFzcyBVSSB7XG4gIHByb3RlY3RlZCBfYmluZGluZzpRdWVyeTtcbiAgcHJvdGVjdGVkIF9lbWJlZGRlZDp7fTtcbiAgcHJvdGVjdGVkIF9jaGlsZHJlbjpVSVtdID0gW107XG4gIHByb3RlY3RlZCBfYXR0cmlidXRlczp7fSA9IHt9O1xuICBwcm90ZWN0ZWQgX2V2ZW50czp7fSA9IHt9O1xuXG4gIHByb3RlY3RlZCBfcGFyZW50OlVJO1xuXG4gIHN0YXRpYyByZW1vdmUodGVtcGxhdGU6c3RyaW5nLCBpeGVyOkluZGV4ZXIpIHtcbiAgICBsZXQgY2hhbmdlc2V0ID0gaXhlci5kaWZmKCk7XG4gICAgcmVzb2x2ZWRSZW1vdmUoY2hhbmdlc2V0LCBcInVpIHRlbXBsYXRlXCIsIHt0ZW1wbGF0ZX0pO1xuICAgIHJlc29sdmVkUmVtb3ZlKGNoYW5nZXNldCwgXCJ1aSB0ZW1wbGF0ZSBiaW5kaW5nXCIsIHt0ZW1wbGF0ZX0pO1xuICAgIGxldCBiaW5kaW5ncyA9IGh1bWFuaXplZEZpbmQoaXhlciwgXCJ1aSB0ZW1wbGF0ZSBiaW5kaW5nXCIsIHt0ZW1wbGF0ZX0pO1xuICAgIGZvcihsZXQgYmluZGluZyBvZiBiaW5kaW5ncykgY2hhbmdlc2V0Lm1lcmdlKFF1ZXJ5LnJlbW92ZShiaW5kaW5nLmJpbmRpbmcsIGl4ZXIpKTtcbiAgICByZXNvbHZlZFJlbW92ZShjaGFuZ2VzZXQsIFwidWkgZW1iZWRcIiwge3RlbXBsYXRlfSk7XG4gICAgbGV0IGVtYmVkcyA9IGh1bWFuaXplZEZpbmQoaXhlciwgXCJ1aSBlbWJlZFwiLCB7dGVtcGxhdGV9KTtcbiAgICBmb3IobGV0IGVtYmVkIG9mIGVtYmVkcykge1xuICAgICAgcmVzb2x2ZWRSZW1vdmUoY2hhbmdlc2V0LCBcInVpIGVtYmVkIHNjb3BlXCIsIHt0ZW1wbGF0ZSwgZW1iZWQ6IGVtYmVkLmVtYmVkfSk7XG4gICAgICByZXNvbHZlZFJlbW92ZShjaGFuZ2VzZXQsIFwidWkgZW1iZWQgc2NvcGUgYmluZGluZ1wiLCB7dGVtcGxhdGUsIGVtYmVkOiBlbWJlZC5lbWJlZH0pO1xuICAgIH1cbiAgICByZXNvbHZlZFJlbW92ZShjaGFuZ2VzZXQsIFwidWkgYXR0cmlidXRlXCIsIHt0ZW1wbGF0ZX0pO1xuICAgIHJlc29sdmVkUmVtb3ZlKGNoYW5nZXNldCwgXCJ1aSBhdHRyaWJ1dGUgYmluZGluZ1wiLCB7dGVtcGxhdGV9KTtcbiAgICByZXNvbHZlZFJlbW92ZShjaGFuZ2VzZXQsIFwidWkgZXZlbnRcIiwge3RlbXBsYXRlfSk7XG4gICAgbGV0IGV2ZW50cyA9IGh1bWFuaXplZEZpbmQoaXhlciwgXCJ1aSBldmVudFwiLCB7dGVtcGxhdGV9KTtcbiAgICBmb3IobGV0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgICAgcmVzb2x2ZWRSZW1vdmUoY2hhbmdlc2V0LCBcInVpIGV2ZW50IHN0YXRlXCIsIHt0ZW1wbGF0ZSwgZXZlbnQ6IGV2ZW50LmV2ZW50fSk7XG4gICAgICByZXNvbHZlZFJlbW92ZShjaGFuZ2VzZXQsIFwidWkgZXZlbnQgc3RhdGUgYmluZGluZ1wiLCB7dGVtcGxhdGUsIGV2ZW50OiBldmVudC5ldmVudH0pO1xuICAgIH1cblxuICAgIGZvcihsZXQgY2hpbGQgb2YgaHVtYW5pemVkRmluZChpeGVyLCBcInVpIHRlbXBsYXRlXCIsIHtwYXJlbnQ6IHRlbXBsYXRlfSkpIGNoYW5nZXNldC5tZXJnZShVSS5yZW1vdmUoY2hpbGQudGVtcGxhdGUsIGl4ZXIpKTtcbiAgICByZXR1cm4gY2hhbmdlc2V0O1xuICB9XG5cbiAgY29uc3RydWN0b3IocHVibGljIGlkKSB7XG5cbiAgfVxuICBjb3B5KCkge1xuICAgIGxldCBuZXVlID0gbmV3IFVJKHRoaXMuaWQpO1xuICAgIG5ldWUuX2JpbmRpbmcgPSB0aGlzLl9iaW5kaW5nO1xuICAgIG5ldWUuX2VtYmVkZGVkID0gdGhpcy5fZW1iZWRkZWQ7XG4gICAgbmV1ZS5fY2hpbGRyZW4gPSB0aGlzLl9jaGlsZHJlbjtcbiAgICBuZXVlLl9hdHRyaWJ1dGVzID0gdGhpcy5fYXR0cmlidXRlcztcbiAgICBuZXVlLl9ldmVudHMgPSB0aGlzLl9ldmVudHM7XG4gICAgbmV1ZS5fcGFyZW50ID0gdGhpcy5fcGFyZW50O1xuICAgIHJldHVybiBuZXVlO1xuICB9XG4gIGNoYW5nZXNldChpeGVyOkluZGV4ZXIpIHtcbiAgICBsZXQgY2hhbmdlc2V0ID0gaXhlci5kaWZmKCk7XG5cbiAgICBsZXQgcGFyZW50ID0gdGhpcy5fYXR0cmlidXRlc1tcInBhcmVudFwiXSB8fCAodGhpcy5fcGFyZW50ICYmIHRoaXMuX3BhcmVudC5pZCkgfHwgXCJcIjtcbiAgICBsZXQgaXggPSB0aGlzLl9hdHRyaWJ1dGVzW1wiaXhcIl07XG4gICAgaWYoaXggPT09IHVuZGVmaW5lZCkgaXggPSAodGhpcy5fcGFyZW50ICYmIHRoaXMuX3BhcmVudC5fY2hpbGRyZW4uaW5kZXhPZih0aGlzKSk7XG4gICAgaWYoaXggPT09IC0xIHx8IGl4ID09PSB1bmRlZmluZWQpIGl4ID0gXCJcIjtcbiAgICBpZih0aGlzLl9lbWJlZGRlZCkgcGFyZW50ID0gXCJcIjtcblxuICAgIHJlc29sdmVkQWRkKGNoYW5nZXNldCwgXCJ1aSB0ZW1wbGF0ZVwiLCB7dGVtcGxhdGU6IHRoaXMuaWQsIHBhcmVudCwgaXh9KTtcbiAgICBpZih0aGlzLl9iaW5kaW5nKSB7XG4gICAgICBpZighdGhpcy5fYmluZGluZy5uYW1lIHx8IHRoaXMuX2JpbmRpbmcubmFtZSA9PT0gXCJ1bmtub3duXCIpIHRoaXMuX2JpbmRpbmcubmFtZSA9IGBib3VuZCB2aWV3ICR7dGhpcy5pZH1gO1xuICAgICAgY2hhbmdlc2V0Lm1lcmdlKHRoaXMuX2JpbmRpbmcuY2hhbmdlc2V0KGl4ZXIpKTtcbiAgICAgIHJlc29sdmVkQWRkKGNoYW5nZXNldCwgXCJ1aSB0ZW1wbGF0ZSBiaW5kaW5nXCIsIHt0ZW1wbGF0ZTogdGhpcy5pZCwgYmluZGluZzogdGhpcy5fYmluZGluZy5uYW1lfSk7XG4gICAgfVxuICAgIGlmKHRoaXMuX2VtYmVkZGVkKSB7XG4gICAgICBsZXQgZW1iZWQgPSB1dWlkKCk7XG4gICAgICByZXNvbHZlZEFkZChjaGFuZ2VzZXQsIFwidWkgZW1iZWRcIiwge2VtYmVkLCB0ZW1wbGF0ZTogdGhpcy5pZCwgcGFyZW50OiAodGhpcy5fcGFyZW50IHx8IDxhbnk+e30pLmlkLCBpeH0pO1xuICAgICAgZm9yKGxldCBrZXkgaW4gdGhpcy5fZW1iZWRkZWQpIHtcbiAgICAgICAgbGV0IHZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1trZXldO1xuICAgICAgICBpZih2YWx1ZSBpbnN0YW5jZW9mIEFycmF5KSByZXNvbHZlZEFkZChjaGFuZ2VzZXQsIFwidWkgZW1iZWQgc2NvcGUgYmluZGluZ1wiLCB7ZW1iZWQsIGtleSwgc291cmNlOiB2YWx1ZVswXSwgYWxpYXM6IHZhbHVlWzFdfSk7XG4gICAgICAgIGVsc2UgcmVzb2x2ZWRBZGQoY2hhbmdlc2V0LCBcInVpIGVtYmVkIHNjb3BlXCIsIHtlbWJlZCwga2V5LCB2YWx1ZX0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvcihsZXQgcHJvcGVydHkgaW4gdGhpcy5fYXR0cmlidXRlcykge1xuICAgICAgbGV0IHZhbHVlID0gdGhpcy5fYXR0cmlidXRlc1twcm9wZXJ0eV07XG4gICAgICBpZih2YWx1ZSBpbnN0YW5jZW9mIEFycmF5KSByZXNvbHZlZEFkZChjaGFuZ2VzZXQsIFwidWkgYXR0cmlidXRlIGJpbmRpbmdcIiwge3RlbXBsYXRlOiB0aGlzLmlkLCBwcm9wZXJ0eSwgc291cmNlOiB2YWx1ZVswXSwgYWxpYXM6IHZhbHVlWzFdfSk7XG4gICAgICBlbHNlIHJlc29sdmVkQWRkKGNoYW5nZXNldCwgXCJ1aSBhdHRyaWJ1dGVcIiwge3RlbXBsYXRlOiB0aGlzLmlkLCBwcm9wZXJ0eSwgdmFsdWV9KTtcbiAgICB9XG5cbiAgICBmb3IobGV0IGV2ZW50IGluIHRoaXMuX2V2ZW50cykge1xuICAgICAgcmVzb2x2ZWRBZGQoY2hhbmdlc2V0LCBcInVpIGV2ZW50XCIsIHt0ZW1wbGF0ZTogdGhpcy5pZCwgZXZlbnR9KTtcbiAgICAgIGxldCBzdGF0ZSA9IHRoaXMuX2V2ZW50c1tldmVudF07XG4gICAgICBmb3IobGV0IGtleSBpbiBzdGF0ZSkge1xuICAgICAgICBsZXQgdmFsdWUgPSBzdGF0ZVtrZXldO1xuICAgICAgICBpZih2YWx1ZSBpbnN0YW5jZW9mIEFycmF5KVxuICAgICAgICAgIHJlc29sdmVkQWRkKGNoYW5nZXNldCwgXCJ1aSBldmVudCBzdGF0ZSBiaW5kaW5nXCIsIHt0ZW1wbGF0ZTogdGhpcy5pZCwgZXZlbnQsIGtleSwgc291cmNlOiB2YWx1ZVswXSwgYWxpYXM6IHZhbHVlWzFdfSk7XG4gICAgICAgIGVsc2UgcmVzb2x2ZWRBZGQoY2hhbmdlc2V0LCBcInVpIGV2ZW50IHN0YXRlXCIsIHt0ZW1wbGF0ZTogdGhpcy5pZCwgZXZlbnQsIGtleSwgdmFsdWV9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IobGV0IGNoaWxkIG9mIHRoaXMuX2NoaWxkcmVuKSBjaGFuZ2VzZXQubWVyZ2UoY2hpbGQuY2hhbmdlc2V0KGl4ZXIpKTtcblxuICAgIHJldHVybiBjaGFuZ2VzZXQ7XG4gIH1cbiAgbG9hZCh0ZW1wbGF0ZTpzdHJpbmcsIGl4ZXI6SW5kZXhlciwgcGFyZW50PzpVSSkge1xuICAgIGxldCBmYWN0ID0gaHVtYW5pemVkRmluZChpeGVyLCBcInVpIHRlbXBsYXRlXCIsIHt0ZW1wbGF0ZX0pWzBdO1xuICAgIGlmKCFmYWN0KSByZXR1cm4gdGhpcztcbiAgICBpZihwYXJlbnQgfHwgZmFjdC5wYXJlbnQpIHRoaXMuX3BhcmVudCA9IHBhcmVudCB8fCBuZXcgVUkodGhpcy5fcGFyZW50KTtcbiAgICBsZXQgYmluZGluZyA9IGh1bWFuaXplZEZpbmQoaXhlciwgXCJ1aSB0ZW1wbGF0ZSBiaW5kaW5nXCIsIHt0ZW1wbGF0ZX0pWzBdO1xuICAgIGlmKGJpbmRpbmcpIHRoaXMuYmluZCgobmV3IFF1ZXJ5KGl4ZXIsIGJpbmRpbmcuYmluZGluZykpKTtcbiAgICBsZXQgZW1iZWQgPSBodW1hbml6ZWRGaW5kKGl4ZXIsIFwidWkgZW1iZWRcIiwge3RlbXBsYXRlLCBwYXJlbnQ6IHRoaXMuX3BhcmVudCA/IHRoaXMuX3BhcmVudC5pZCA6IFwiXCJ9KVswXTtcbiAgICBpZihlbWJlZCkge1xuICAgICAgbGV0IHNjb3BlID0ge307XG4gICAgICBmb3IobGV0IGF0dHIgb2YgaHVtYW5pemVkRmluZChpeGVyLCBcInVpIGVtYmVkIHNjb3BlXCIsIHtlbWJlZDogZW1iZWQuZW1iZWR9KSkgc2NvcGVbYXR0ci5rZXldID0gYXR0ci52YWx1ZTtcbiAgICAgIGZvcihsZXQgYXR0ciBvZiBodW1hbml6ZWRGaW5kKGl4ZXIsIFwidWkgZW1iZWQgc2NvcGUgYmluZGluZ1wiLCB7ZW1iZWQ6IGVtYmVkLmVtYmVkfSkpIHNjb3BlW2F0dHIua2V5XSA9IFthdHRyLnNvdXJjZSwgYXR0ci5hbGlhc107XG4gICAgICB0aGlzLmVtYmVkKHNjb3BlKTtcbiAgICB9XG5cbiAgICBmb3IobGV0IGF0dHIgb2YgaHVtYW5pemVkRmluZChpeGVyLCBcInVpIGF0dHJpYnV0ZVwiLCB7dGVtcGxhdGV9KSkgdGhpcy5hdHRyaWJ1dGUoYXR0ci5wcm9wZXJ0eSwgYXR0ci52YWx1ZSk7XG4gICAgZm9yKGxldCBhdHRyIG9mIGh1bWFuaXplZEZpbmQoaXhlciwgXCJ1aSBhdHRyaWJ1dGUgYmluZGluZ1wiLCB7dGVtcGxhdGV9KSkgdGhpcy5hdHRyaWJ1dGUoYXR0ci5wcm9wZXJ0eSwgW2F0dHIuc291cmNlLCBhdHRyLmFsaWFzXSk7XG5cbiAgICBmb3IobGV0IGV2ZW50IG9mIGh1bWFuaXplZEZpbmQoaXhlciwgXCJ1aSBldmVudFwiLCB7dGVtcGxhdGV9KSkge1xuICAgICAgbGV0IHN0YXRlID0ge307XG4gICAgICBmb3IobGV0IGF0dHIgb2YgaHVtYW5pemVkRmluZChpeGVyLCBcInVpIGV2ZW50IHN0YXRlXCIsIHt0ZW1wbGF0ZSwgZXZlbnQ6IGV2ZW50LmV2ZW50fSkpIHN0YXRlW2V2ZW50LmtleV0gPSBldmVudC52YWx1ZTtcbiAgICAgIGZvcihsZXQgYXR0ciBvZiBodW1hbml6ZWRGaW5kKGl4ZXIsIFwidWkgZXZlbnQgc3RhdGUgYmluZGluZ1wiLCB7dGVtcGxhdGUsIGV2ZW50OiBldmVudC5ldmVudH0pKSBzdGF0ZVtldmVudC5rZXldID0gW2V2ZW50LnNvdXJjZSwgZXZlbnQuYWxpYXNdXG4gICAgICB0aGlzLmV2ZW50KGV2ZW50LmV2ZW50LCBzdGF0ZSk7XG4gICAgfVxuXG4gICAgZm9yKGxldCBjaGlsZCBvZiBodW1hbml6ZWRGaW5kKGl4ZXIsIFwidWkgdGVtcGxhdGVcIiwge3BhcmVudDogdGVtcGxhdGV9KSlcbiAgICAgIHRoaXMuY2hpbGQoKG5ldyBVSShjaGlsZC50ZW1wbGF0ZSkpLmxvYWQoY2hpbGQudGVtcGxhdGUsIGl4ZXIsIHRoaXMpKTtcblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgY2hpbGRyZW4obmV1ZT86VUlbXSwgYXBwZW5kID0gZmFsc2UpIHtcbiAgICBpZighbmV1ZSkgcmV0dXJuIHRoaXMuX2NoaWxkcmVuO1xuICAgIGlmKCFhcHBlbmQpIHRoaXMuX2NoaWxkcmVuLmxlbmd0aCA9IDA7XG4gICAgZm9yKGxldCBjaGlsZCBvZiBuZXVlKSB7XG4gICAgICBsZXQgY29waWVkID0gY2hpbGQuY29weSgpO1xuICAgICAgY29waWVkLl9wYXJlbnQgPSB0aGlzO1xuICAgICAgdGhpcy5fY2hpbGRyZW4ucHVzaChjb3BpZWQpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fY2hpbGRyZW47XG4gIH1cbiAgY2hpbGQoY2hpbGQ6VUksIGl4PzogbnVtYmVyLCBlbWJlZD86e30pIHtcbiAgICBjaGlsZCA9IGNoaWxkLmNvcHkoKTtcbiAgICBjaGlsZC5fcGFyZW50ID0gdGhpcztcbiAgICBpZihlbWJlZCkgY2hpbGQuZW1iZWQoZW1iZWQpO1xuICAgIGlmKCFpeCkgdGhpcy5fY2hpbGRyZW4ucHVzaChjaGlsZCk7XG4gICAgZWxzZSB0aGlzLl9jaGlsZHJlbi5zcGxpY2UoaXgsIDAsIGNoaWxkKTtcbiAgICByZXR1cm4gY2hpbGQ7XG4gIH1cbiAgcmVtb3ZlQ2hpbGQoaXg6IG51bWJlcikge1xuICAgIHJldHVybiB0aGlzLl9jaGlsZHJlbi5zcGxpY2UoaXgsIDEpO1xuICB9XG5cbiAgYXR0cmlidXRlcyhwcm9wZXJ0aWVzPzoge30sIG1lcmdlID0gZmFsc2UpIHtcbiAgICBpZighcHJvcGVydGllcykgcmV0dXJuIHRoaXMuX2F0dHJpYnV0ZXM7XG4gICAgaWYoIW1lcmdlKSB7XG4gICAgICBmb3IobGV0IHByb3AgaW4gdGhpcy5fYXR0cmlidXRlcykgZGVsZXRlIHRoaXMuX2F0dHJpYnV0ZXNbcHJvcF07XG4gICAgfVxuICAgIGZvcihsZXQgcHJvcCBpbiBwcm9wZXJ0aWVzKSB0aGlzLl9hdHRyaWJ1dGVzW3Byb3BdID0gcHJvcGVydGllc1twcm9wXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBhdHRyaWJ1dGUocHJvcGVydHk6IHN0cmluZywgdmFsdWU/OiBhbnkpIHtcbiAgICBpZih2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1twcm9wZXJ0eV07XG4gICAgdGhpcy5fYXR0cmlidXRlc1twcm9wZXJ0eV0gPSB2YWx1ZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICByZW1vdmVBdHRyaWJ1dGUocHJvcGVydHk6IHN0cmluZykge1xuICAgIGRlbGV0ZSB0aGlzLl9hdHRyaWJ1dGVzW3Byb3BlcnR5XTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGV2ZW50cyhldmVudHM/OiB7fSwgbWVyZ2UgPSBmYWxzZSkge1xuICAgIGlmKCFldmVudHMpIHJldHVybiB0aGlzLl9ldmVudHM7XG4gICAgaWYoIW1lcmdlKSB7XG4gICAgICBmb3IobGV0IGV2ZW50IGluIHRoaXMuX2V2ZW50cykgZGVsZXRlIHRoaXMuX2V2ZW50c1tldmVudF07XG4gICAgfVxuICAgIGZvcihsZXQgZXZlbnQgaW4gZXZlbnRzKSB0aGlzLl9ldmVudHNbZXZlbnRdID0gZXZlbnRzW2V2ZW50XTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBldmVudChldmVudDogc3RyaW5nLCBzdGF0ZT86IGFueSkge1xuICAgIGlmKHN0YXRlID09PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLl9ldmVudHNbZXZlbnRdO1xuICAgIHRoaXMuX2F0dHJpYnV0ZXNbZXZlbnRdID0gc3RhdGU7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgcmVtb3ZlRXZlbnQoZXZlbnQ6IHN0cmluZykge1xuICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbZXZlbnRdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgZW1iZWQoc2NvcGU6e318Ym9vbGVhbiA9IHt9KSB7XG4gICAgaWYoIXNjb3BlKSB7XG4gICAgICB0aGlzLl9lbWJlZGRlZCA9IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICBpZihzY29wZSA9PT0gdHJ1ZSkgc2NvcGUgPSB7fTtcbiAgICB0aGlzLl9lbWJlZGRlZCA9IHNjb3BlO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgYmluZChiaW5kaW5nOlF1ZXJ5KSB7XG4gICAgdGhpcy5fYmluZGluZyA9IGJpbmRpbmc7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbn1cblxuaW50ZXJmYWNlIFVpV2FybmluZyB7XG4gIFwidWkgd2FybmluZzogdGVtcGxhdGVcIjogc3RyaW5nXG4gIFwidWkgd2FybmluZzogd2FybmluZ1wiOiBzdHJpbmdcbn1cblxuLy8gQFRPRE86IEZpbmlzaCByZWZlcmVuY2UgaW1wbC5cbi8vIEBUT0RPOiBUaGVuIGJ1aWxkIGJpdC1nZW5lcmF0aW5nIHZlcnNpb25cbmV4cG9ydCBjbGFzcyBVSVJlbmRlcmVyIHtcbiAgcHVibGljIGNvbXBpbGVkID0gMDtcbiAgcHJvdGVjdGVkIF90YWdDb21waWxlcnM6e1t0YWc6IHN0cmluZ106IChlbGVtOkVsZW1lbnQpID0+IHZvaWR9ID0ge307XG4gIHByb3RlY3RlZCBfaGFuZGxlcnM6SGFuZGxlcjxFdmVudD5bXSA9IFtdO1xuXG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBpeGVyOkluZGV4ZXIpIHt9XG5cbiAgY29tcGlsZShyb290czooc3RyaW5nfEVsZW1lbnQpW10pOkVsZW1lbnRbXSB7XG4gICAgaWYoREVCVUcuUkVOREVSRVIpIGNvbnNvbGUuZ3JvdXAoXCJ1aSBjb21waWxlXCIpO1xuICAgIGxldCBjb21waWxlZEVsZW1zOkVsZW1lbnRbXSA9IFtdO1xuICAgIGZvcihsZXQgcm9vdCBvZiByb290cykge1xuICAgICAgLy8gQFRPRE86IHJlcGFyZW50IGR5bmFtaWMgcm9vdHMgaWYgbmVlZGVkLlxuICAgICAgaWYodHlwZW9mIHJvb3QgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgbGV0IGVsZW1zID0gdGhpcy5fY29tcGlsZVdyYXBwZXIocm9vdCwgY29tcGlsZWRFbGVtcy5sZW5ndGgpO1xuICAgICAgICBjb21waWxlZEVsZW1zLnB1c2guYXBwbHkoY29tcGlsZWRFbGVtcywgZWxlbXMpO1xuICAgICAgICBsZXQgYmFzZSA9IHRoaXMuaXhlci5maW5kT25lKFwidWkgdGVtcGxhdGVcIiwge1widWkgdGVtcGxhdGU6IHRlbXBsYXRlXCI6IHJvb3R9KTtcbiAgICAgICAgaWYoIWJhc2UpIGNvbnRpbnVlO1xuICAgICAgICBsZXQgcGFyZW50ID0gYmFzZVtcInVpIHRlbXBsYXRlOiBwYXJlbnRcIl07XG4gICAgICAgIGlmKHBhcmVudCkge1xuICAgICAgICAgIGZvcihsZXQgZWxlbSBvZiBlbGVtcykgZWxlbS5wYXJlbnQgPSBwYXJlbnQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGVsc2Uge1xuICAgICAgICBpZighcm9vdC5peCkgcm9vdC5peCA9IGNvbXBpbGVkRWxlbXMubGVuZ3RoO1xuICAgICAgICBjb21waWxlZEVsZW1zLnB1c2gocm9vdCk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmKERFQlVHLlJFTkRFUkVSKSBjb25zb2xlLmdyb3VwRW5kKCk7XG4gICAgcmV0dXJuIGNvbXBpbGVkRWxlbXM7XG4gIH1cblxuICBwcm90ZWN0ZWQgX2NvbXBpbGVXcmFwcGVyKHRlbXBsYXRlOnN0cmluZywgYmFzZUl4OiBudW1iZXIsIGNvbnN0cmFpbnRzOnt9ID0ge30sIGJpbmRpbmdTdGFjazphbnlbXSA9IFtdLCBkZXB0aDpudW1iZXIgPSAwKTpFbGVtZW50W10ge1xuICAgIGxldCBlbGVtcyA9IFtdO1xuICAgIGxldCBiaW5kaW5nID0gdGhpcy5peGVyLmZpbmRPbmUoXCJ1aSB0ZW1wbGF0ZSBiaW5kaW5nXCIsIHtcInVpIHRlbXBsYXRlIGJpbmRpbmc6IHRlbXBsYXRlXCI6IHRlbXBsYXRlfSk7XG4gICAgaWYoIWJpbmRpbmcpIHtcbiAgICAgIGxldCBlbGVtID0gdGhpcy5fY29tcGlsZUVsZW1lbnQodGVtcGxhdGUsIGJpbmRpbmdTdGFjaywgZGVwdGgpO1xuICAgICAgaWYoZWxlbSkgZWxlbXNbMF0gPSBlbGVtO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgYm91bmRRdWVyeSA9IGJpbmRpbmdbXCJ1aSB0ZW1wbGF0ZSBiaW5kaW5nOiBiaW5kaW5nXCJdO1xuICAgICAgbGV0IGZhY3RzID0gdGhpcy5nZXRCb3VuZEZhY3RzKGJvdW5kUXVlcnksIGNvbnN0cmFpbnRzKTtcbiAgICAgIGxldCBpeCA9IDA7XG4gICAgICBmb3IobGV0IGZhY3Qgb2YgZmFjdHMpIHtcbiAgICAgICAgYmluZGluZ1N0YWNrLnB1c2goZmFjdCk7XG4gICAgICAgIGxldCBlbGVtID0gdGhpcy5fY29tcGlsZUVsZW1lbnQodGVtcGxhdGUsIGJpbmRpbmdTdGFjaywgZGVwdGgpO1xuICAgICAgICBiaW5kaW5nU3RhY2sucG9wKCk7XG4gICAgICAgIGlmKGVsZW0pIGVsZW1zLnB1c2goZWxlbSk7XG4gICAgICB9XG4gICAgfVxuICAgIGVsZW1zLnNvcnQoKGEsIGIpID0+IGEuaXggLSBiLml4KTtcbiAgICBsZXQgcHJldkl4ID0gdW5kZWZpbmVkO1xuICAgIGZvcihsZXQgZWxlbSBvZiBlbGVtcykge1xuICAgICAgZWxlbS5peCA9IGVsZW0uaXggPyBlbGVtLml4ICsgYmFzZUl4IDogYmFzZUl4O1xuICAgICAgaWYoZWxlbS5peCA9PT0gcHJldkl4KSBlbGVtLml4Kys7XG4gICAgICBwcmV2SXggPSBlbGVtLml4O1xuICAgIH1cbiAgICByZXR1cm4gZWxlbXM7XG4gIH1cblxuICBwcm90ZWN0ZWQgX2NvbXBpbGVFbGVtZW50KHRlbXBsYXRlOnN0cmluZywgYmluZGluZ1N0YWNrOmFueVtdLCBkZXB0aDpudW1iZXIpOkVsZW1lbnQge1xuICAgIGlmKERFQlVHLlJFTkRFUkVSKSBjb25zb2xlLmxvZyhyZXBlYXQoXCIgIFwiLCBkZXB0aCkgKyBcIiogY29tcGlsZVwiLCB0ZW1wbGF0ZSk7XG4gICAgbGV0IGVsZW1lbnRUb0NoaWxkcmVuID0gdGhpcy5peGVyLmluZGV4KFwidWkgdGVtcGxhdGVcIiwgW1widWkgdGVtcGxhdGU6IHBhcmVudFwiXSk7XG4gICAgbGV0IGVsZW1lbnRUb0VtYmVkcyA9IHRoaXMuaXhlci5pbmRleChcInVpIGVtYmVkXCIsIFtcInVpIGVtYmVkOiBwYXJlbnRcIl0pO1xuICAgIGxldCBlbWJlZFRvU2NvcGUgPSB0aGlzLml4ZXIuaW5kZXgoXCJ1aSBlbWJlZCBzY29wZVwiLCBbXCJ1aSBlbWJlZCBzY29wZTogZW1iZWRcIl0pO1xuICAgIGxldCBlbWJlZFRvU2NvcGVCaW5kaW5nID0gdGhpcy5peGVyLmluZGV4KFwidWkgZW1iZWQgc2NvcGUgYmluZGluZ1wiLCBbXCJ1aSBlbWJlZCBzY29wZSBiaW5kaW5nOiBlbWJlZFwiXSk7XG4gICAgbGV0IGVsZW1lbnRUb0F0dHJzID0gdGhpcy5peGVyLmluZGV4KFwidWkgYXR0cmlidXRlXCIsIFtcInVpIGF0dHJpYnV0ZTogdGVtcGxhdGVcIl0pO1xuICAgIGxldCBlbGVtZW50VG9BdHRyQmluZGluZ3MgPSB0aGlzLml4ZXIuaW5kZXgoXCJ1aSBhdHRyaWJ1dGUgYmluZGluZ1wiLCBbXCJ1aSBhdHRyaWJ1dGUgYmluZGluZzogdGVtcGxhdGVcIl0pO1xuICAgIGxldCBlbGVtZW50VG9FdmVudHMgPSB0aGlzLml4ZXIuaW5kZXgoXCJ1aSBldmVudFwiLCBbXCJ1aSBldmVudDogdGVtcGxhdGVcIl0pO1xuICAgIHRoaXMuY29tcGlsZWQrKztcbiAgICBsZXQgYmFzZSA9IHRoaXMuaXhlci5maW5kT25lKFwidWkgdGVtcGxhdGVcIiwge1widWkgdGVtcGxhdGU6IHRlbXBsYXRlXCI6IHRlbXBsYXRlfSk7XG4gICAgaWYoIWJhc2UpIHtcbiAgICAgIGNvbnNvbGUud2FybihgdWkgdGVtcGxhdGUgJHt0ZW1wbGF0ZX0gZG9lcyBub3QgZXhpc3QuIElnbm9yaW5nLmApO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBsZXQgYXR0cnMgPSBlbGVtZW50VG9BdHRyc1t0ZW1wbGF0ZV07XG4gICAgbGV0IGJvdW5kQXR0cnMgPSBlbGVtZW50VG9BdHRyQmluZGluZ3NbdGVtcGxhdGVdO1xuICAgIGxldCBldmVudHMgPSBlbGVtZW50VG9FdmVudHNbdGVtcGxhdGVdO1xuXG4gICAgLy8gSGFuZGxlIG1ldGEgcHJvcGVydGllc1xuICAgIGxldCBlbGVtOkVsZW1lbnQgPSB7X3RlbXBsYXRlOiB0ZW1wbGF0ZSwgaXg6IGJhc2VbXCJ1aSB0ZW1wbGF0ZTogaXhcIl19O1xuXG4gICAgLy8gSGFuZGxlIHN0YXRpYyBwcm9wZXJ0aWVzXG4gICAgaWYoYXR0cnMpIHtcbiAgICAgIGZvcihsZXQge1widWkgYXR0cmlidXRlOiBwcm9wZXJ0eVwiOiBwcm9wLCBcInVpIGF0dHJpYnV0ZTogdmFsdWVcIjogdmFsfSBvZiBhdHRycykgZWxlbVtwcm9wXSA9IHZhbDtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgYm91bmQgcHJvcGVydGllc1xuICAgIGlmKGJvdW5kQXR0cnMpIHtcbiAgICAgIC8vIEBGSVhNRTogV2hhdCBkbyB3aXRoIHNvdXJjZT9cbiAgICAgIGZvcihsZXQge1widWkgYXR0cmlidXRlIGJpbmRpbmc6IHByb3BlcnR5XCI6IHByb3AsIFwidWkgYXR0cmlidXRlIGJpbmRpbmc6IHNvdXJjZVwiOiBzb3VyY2UsIFwidWkgYXR0cmlidXRlIGJpbmRpbmc6IGFsaWFzXCI6IGFsaWFzfSBvZiBib3VuZEF0dHJzKVxuICAgICAgICBlbGVtW3Byb3BdID0gdGhpcy5nZXRCb3VuZFZhbHVlKHNvdXJjZSwgYWxpYXMsIGJpbmRpbmdTdGFjayk7XG4gICAgfVxuXG4gICAgLy8gQXR0YWNoIGV2ZW50IGhhbmRsZXJzXG4gICAgaWYoZXZlbnRzKSB7XG4gICAgICBmb3IobGV0IHtcInVpIGV2ZW50OiBldmVudFwiOiBldmVudH0gb2YgZXZlbnRzKSBlbGVtW2V2ZW50XSA9IHRoaXMuZ2VuZXJhdGVFdmVudEhhbmRsZXIoZWxlbSwgZXZlbnQsIGJpbmRpbmdTdGFjayk7XG4gICAgfVxuXG4gICAgLy8gQ29tcGlsZSBjaGlsZHJlblxuICAgIGxldCBjaGlsZHJlbiA9IGVsZW1lbnRUb0NoaWxkcmVuW3RlbXBsYXRlXSB8fCBbXTtcbiAgICBsZXQgZW1iZWRzID0gZWxlbWVudFRvRW1iZWRzW3RlbXBsYXRlXSB8fCBbXTtcbiAgICBpZihjaGlsZHJlbi5sZW5ndGggfHwgZW1iZWRzLmxlbmd0aCkge1xuICAgICAgZWxlbS5jaGlsZHJlbiA9IFtdO1xuICAgICAgbGV0IGNoaWxkSXggPSAwLCBlbWJlZEl4ID0gMDtcbiAgICAgIHdoaWxlKGNoaWxkSXggPCBjaGlsZHJlbi5sZW5ndGggfHwgZW1iZWRJeCA8IGVtYmVkcy5sZW5ndGgpIHtcbiAgICAgICAgbGV0IGNoaWxkID0gY2hpbGRyZW5bY2hpbGRJeF07XG4gICAgICAgIGxldCBlbWJlZCA9IGVtYmVkc1tlbWJlZEl4XTtcbiAgICAgICAgbGV0IGFkZCwgY29uc3RyYWludHMgPSB7fSwgY2hpbGRCaW5kaW5nU3RhY2sgPSBiaW5kaW5nU3RhY2s7XG4gICAgICAgIGlmKCFlbWJlZCB8fCBjaGlsZCAmJiBjaGlsZC5peCA8PSBlbWJlZC5peCkge1xuICAgICAgICAgIGFkZCA9IGNoaWxkcmVuW2NoaWxkSXgrK11bXCJ1aSB0ZW1wbGF0ZTogdGVtcGxhdGVcIl07XG4gICAgICAgICAgLy8gUmVzb2x2ZSBib3VuZCBhbGlhc2VzIGludG8gY29uc3RyYWludHNcbiAgICAgICAgICBjb25zdHJhaW50cyA9IHRoaXMuZ2V0Qm91bmRTY29wZShiaW5kaW5nU3RhY2spO1xuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYWRkID0gZW1iZWRzW2VtYmVkSXgrK11bXCJ1aSBlbWJlZDogdGVtcGxhdGVcIl07XG4gICAgICAgICAgZm9yKGxldCBzY29wZSBvZiBlbWJlZFRvU2NvcGVbZW1iZWRbXCJ1aSBlbWJlZDogZW1iZWRcIl1dIHx8IFtdKVxuICAgICAgICAgICAgY29uc3RyYWludHNbc2NvcGVbXCJ1aSBlbWJlZCBzY29wZToga2V5XCJdXSA9IHNjb3BlW1widWkgZW1iZWQgc2NvcGU6IHZhbHVlXCJdO1xuXG4gICAgICAgICAgZm9yKGxldCBzY29wZSBvZiBlbWJlZFRvU2NvcGVCaW5kaW5nW2VtYmVkW1widWkgZW1iZWQ6IGVtYmVkXCJdXSB8fCBbXSkge1xuICAgICAgICAgICAgLy8gQEZJWE1FOiBXaGF0IGRvIGFib3V0IHNvdXJjZT9cbiAgICAgICAgICAgIGxldCB7XCJ1aSBlbWJlZCBzY29wZSBiaW5kaW5nOiBrZXlcIjoga2V5LCBcInVpIGVtYmVkIHNjb3BlIGJpbmRpbmc6IHNvdXJjZVwiOiBzb3VyY2UsIFwidWkgZW1iZWQgc2NvcGUgYmluZGluZzogYWxpYXNcIjogYWxpYXN9ID0gc2NvcGU7XG4gICAgICAgICAgICBjb25zdHJhaW50c1trZXldID0gdGhpcy5nZXRCb3VuZFZhbHVlKHNvdXJjZSwgYWxpYXMsIGJpbmRpbmdTdGFjayk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNoaWxkQmluZGluZ1N0YWNrID0gW2NvbnN0cmFpbnRzXTtcbiAgICAgICAgfVxuICAgICAgICBlbGVtLmNoaWxkcmVuLnB1c2guYXBwbHkoZWxlbS5jaGlsZHJlbiwgdGhpcy5fY29tcGlsZVdyYXBwZXIoYWRkLCBlbGVtLmNoaWxkcmVuLmxlbmd0aCwgY29uc3RyYWludHMsIGNoaWxkQmluZGluZ1N0YWNrLCBkZXB0aCArIDEpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZih0aGlzLl90YWdDb21waWxlcnNbZWxlbS50XSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5fdGFnQ29tcGlsZXJzW2VsZW0udF0oZWxlbSk7XG4gICAgICB9IGNhdGNoKGVycikge1xuICAgICAgICBjb25zb2xlLndhcm4oYEZhaWxlZCB0byBjb21waWxlIHRlbXBsYXRlOiAnJHt0ZW1wbGF0ZX0nIGR1ZSB0byAnJHtlcnJ9JyBmb3IgZWxlbWVudCAnJHtKU09OLnN0cmluZ2lmeShlbGVtKX0nYCk7XG4gICAgICAgIGVsZW0udCA9IFwidWktZXJyb3JcIjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZWxlbTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRCb3VuZEZhY3RzKHF1ZXJ5LCBjb25zdHJhaW50cyk6c3RyaW5nW10ge1xuICAgIHJldHVybiB0aGlzLml4ZXIuZmluZChxdWVyeSwgY29uc3RyYWludHMpO1xuICB9XG4gIHByb3RlY3RlZCBnZXRCb3VuZFNjb3BlKGJpbmRpbmdTdGFjazphbnlbXSk6e30ge1xuICAgIGxldCBzY29wZSA9IHt9O1xuICAgIGZvcihsZXQgZmFjdCBvZiBiaW5kaW5nU3RhY2spIHtcbiAgICAgIGZvcihsZXQgYWxpYXMgaW4gZmFjdCkgc2NvcGVbYWxpYXNdID0gZmFjdFthbGlhc107XG4gICAgfVxuICAgIHJldHVybiBzY29wZTtcbiAgfVxuXG4gIC8vQEZJWE1FOiBXaGF0IGRvIGFib3V0IHNvdXJjZT9cbiAgcHJvdGVjdGVkIGdldEJvdW5kVmFsdWUoc291cmNlOnN0cmluZywgYWxpYXM6c3RyaW5nLCBiaW5kaW5nU3RhY2s6YW55W10pOmFueSB7IC8vIEBGSVhNRTogRmluZHMgZG9uJ3QgY3JlYXRlIGEgc291cmNlIGZpZWxkIG9uIHRoZSByZXN1bHQuXG4gICAgZm9yKGxldCBpeCA9IGJpbmRpbmdTdGFjay5sZW5ndGggLSAxOyBpeCA+PSAwOyBpeC0tKSB7XG4gICAgICBsZXQgZmFjdCA9IGJpbmRpbmdTdGFja1tpeF07XG4gICAgICBpZihzb3VyY2UgaW4gZmFjdCAmJiBmYWN0W2FsaWFzXSkgcmV0dXJuIGZhY3RbYWxpYXNdO1xuICAgIH1cbiAgfVxuICBwcm90ZWN0ZWQgZ2VuZXJhdGVFdmVudEhhbmRsZXIoZWxlbTpFbGVtZW50LCBldmVudDpzdHJpbmcsIGJpbmRpbmdTdGFjazphbnlbXSk6SGFuZGxlcjxFdmVudD4ge1xuICAgIGxldCB0ZW1wbGF0ZSA9IGVsZW1bXCJfdGVtcGxhdGVcIl07XG4gICAgbGV0IG1lbW9LZXkgPSBgJHt0ZW1wbGF0ZX06OiR7ZXZlbnR9YDtcbiAgICBsZXQgYXR0cktleSA9IGAke2V2ZW50fTo6c3RhdGVgO1xuICAgIGVsZW1bYXR0cktleV0gPSB0aGlzLmdldEV2ZW50U3RhdGUodGVtcGxhdGUsIGV2ZW50LCBiaW5kaW5nU3RhY2spO1xuICAgIGlmKHRoaXMuX2hhbmRsZXJzW21lbW9LZXldKSByZXR1cm4gdGhpcy5faGFuZGxlcnNbbWVtb0tleV07XG5cbiAgICBsZXQgc2VsZiA9IHRoaXM7XG4gICAgaWYoZXZlbnQgPT09IFwiY2hhbmdlXCIgfHwgZXZlbnQgPT09IFwiaW5wdXRcIikge1xuICAgICAgdGhpcy5faGFuZGxlcnNbbWVtb0tleV0gPSAoZXZ0OkV2ZW50LCBlbGVtOkVsZW1lbnQpID0+IHtcbiAgICAgICAgbGV0IHByb3BzOmFueSA9IHt9O1xuICAgICAgICBpZihlbGVtLnQgPT09IFwic2VsZWN0XCIgfHwgZWxlbS50ID09PSBcImlucHV0XCIgfHwgZWxlbS50ID09PSBcInRleHRhcmVhXCIpIHByb3BzLnZhbHVlID0gKDxIVE1MU2VsZWN0RWxlbWVudHxIVE1MSW5wdXRFbGVtZW50PmV2dC50YXJnZXQpLnZhbHVlO1xuICAgICAgICBpZihlbGVtLnR5cGUgPT09IFwiY2hlY2tib3hcIikgcHJvcHMudmFsdWUgPSAoPEhUTUxJbnB1dEVsZW1lbnQ+ZXZ0LnRhcmdldCkuY2hlY2tlZDtcbiAgICAgICAgc2VsZi5oYW5kbGVFdmVudCh0ZW1wbGF0ZSwgZXZlbnQsIGV2dCwgZWxlbSwgcHJvcHMpO1xuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5faGFuZGxlcnNbbWVtb0tleV0gPSAoZXZ0OkV2ZW50LCBlbGVtOkVsZW1lbnQpID0+IHtcbiAgICAgICAgc2VsZi5oYW5kbGVFdmVudCh0ZW1wbGF0ZSwgZXZlbnQsIGV2dCwgZWxlbSwge30pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9oYW5kbGVyc1ttZW1vS2V5XTtcbiAgfVxuICBwcm90ZWN0ZWQgaGFuZGxlRXZlbnQodGVtcGxhdGU6c3RyaW5nLCBldmVudE5hbWU6c3RyaW5nLCBldmVudDpFdmVudCwgZWxlbTpFbGVtZW50LCBldmVudFByb3BzOnt9KSB7XG4gICAgbGV0IGF0dHJLZXkgPSBgJHtldmVudE5hbWV9OjpzdGF0ZWA7XG4gICAgbGV0IHN0YXRlID0gZWxlbVthdHRyS2V5XTtcbiAgICBsZXQgY29udGVudCA9IHVucGFkKDYpIGBcbiAgICAgICMgJHtldmVudE5hbWV9ICh7aXMgYTogZXZlbnR9KVxuICAgICAgIyMgTWV0YVxuICAgICAgZXZlbnQgdGFyZ2V0OiB7ZXZlbnQgdGFyZ2V0OiAke2VsZW0uaWR9fVxuICAgICAgZXZlbnQgdGVtcGxhdGU6IHtldmVudCB0ZW1wbGF0ZTogJHt0ZW1wbGF0ZX19XG4gICAgICBldmVudCB0eXBlOiB7ZXZlbnQgdHlwZTogJHtldmVudE5hbWV9fVxuXG4gICAgICAjIyBTdGF0ZVxuICAgIGA7XG4gICAgaWYoc3RhdGVbXCIqZXZlbnQqXCJdKSB7XG4gICAgICBmb3IobGV0IHByb3AgaW4gc3RhdGVbXCIqZXZlbnQqXCJdKVxuICAgICAgICBjb250ZW50ICs9IGAke3Byb3B9OiB7JHtwcm9wfTogJHtldmVudFByb3BzW3N0YXRlW1wiKmV2ZW50KlwiXVtwcm9wXV19fVxcbmA7XG4gICAgfVxuICAgIGZvcihsZXQgcHJvcCBpbiBzdGF0ZSkge1xuICAgICAgaWYocHJvcCA9PT0gXCIqZXZlbnQqXCIpIGNvbnRpbnVlO1xuICAgICAgY29udGVudCArPSBgJHtwcm9wfTogeyR7cHJvcH06ICR7c3RhdGVbcHJvcF19fVxcbmBcbiAgICB9XG5cbiAgICBsZXQgY2hhbmdlc2V0ID0gdGhpcy5peGVyLmRpZmYoKTtcbiAgICBsZXQgcmF3ID0gdXVpZCgpO1xuICAgIGxldCBlbnRpdHkgPSBgJHtldmVudE5hbWV9IGV2ZW50ICR7cmF3LnNsaWNlKC0xMil9YDtcbiAgICBjaGFuZ2VzZXQuYWRkKFwiYnVpbHRpbiBlbnRpdHlcIiwge2VudGl0eSwgY29udGVudH0pO1xuICAgIHRoaXMuaXhlci5hcHBseURpZmYoY2hhbmdlc2V0KTtcbiAgICBjb25zb2xlLmxvZyhlbnRpdHkpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEV2ZW50U3RhdGUodGVtcGxhdGU6c3RyaW5nLCBldmVudDpzdHJpbmcsIGJpbmRpbmdTdGFjazphbnlbXSk6e30ge1xuICAgIGxldCBzdGF0ZSA9IHt9O1xuICAgIGxldCBzdGF0aWNBdHRycyA9IHRoaXMuaXhlci5maW5kKFwidWkgZXZlbnQgc3RhdGVcIiwge1widWkgZXZlbnQgc3RhdGU6IHRlbXBsYXRlXCI6IHRlbXBsYXRlLCBcInVpIGV2ZW50IHN0YXRlOiBldmVudFwiOiBldmVudH0pO1xuICAgIGZvcihsZXQge1widWkgZXZlbnQgc3RhdGU6IGtleVwiOiBrZXksIFwidWkgZXZlbnQgc3RhdGU6IHZhbHVlXCI6IHZhbH0gb2Ygc3RhdGljQXR0cnMpIHN0YXRlW2tleV0gPSB2YWw7XG5cbiAgICBsZXQgYm91bmRBdHRycyA9IHRoaXMuaXhlci5maW5kKFwidWkgZXZlbnQgc3RhdGUgYmluZGluZ1wiLCB7XCJ1aSBldmVudCBzdGF0ZSBiaW5kaW5nOiB0ZW1wbGF0ZVwiOiB0ZW1wbGF0ZSwgXCJ1aSBldmVudCBzdGF0ZSBiaW5kaW5nOiBldmVudFwiOiBldmVudH0pO1xuICAgIGZvcihsZXQge1widWkgZXZlbnQgc3RhdGUgYmluZGluZzoga2V5XCI6IGtleSwgXCJ1aSBldmVudCBzdGF0ZSBiaW5kaW5nOiBzb3VyY2VcIjogc291cmNlLCBcInVpIGV2ZW50IHN0YXRlIGJpbmRpbmc6IGFsaWFzXCI6IGFsaWFzfSBvZiBib3VuZEF0dHJzKSB7XG4gICAgICBpZihzb3VyY2UgPT09IFwiKmV2ZW50KlwiKSB7XG4gICAgICAgIHN0YXRlW1wiKmV2ZW50KlwiXSA9IHN0YXRlW1wiKmV2ZW50KlwiXSB8fCB7fTtcbiAgICAgICAgc3RhdGVbXCIqZXZlbnQqXCJdW2tleV0gPSBhbGlhcztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YXRlW2tleV0gPSB0aGlzLmdldEJvdW5kVmFsdWUoc291cmNlLCBhbGlhcywgYmluZGluZ1N0YWNrKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc3RhdGU7XG4gIH1cbn1cblxuZGVjbGFyZSB2YXIgZXhwb3J0cztcbmlmKHRoaXMud2luZG93KSB3aW5kb3dbXCJ1aVJlbmRlcmVyXCJdID0gZXhwb3J0czsiLCJpbXBvcnQge3Y0IGFzIF91dWlkfSBmcm9tIFwiLi4vdmVuZG9yL3V1aWRcIjtcbmV4cG9ydCB2YXIgdXVpZCA9IF91dWlkO1xuXG5leHBvcnQgdmFyIEVOViA9IFwiYnJvd3NlclwiO1xudHJ5IHtcbiAgd2luZG93XG59IGNhdGNoKGVycikge1xuICBFTlYgPSBcIm5vZGVcIjtcbn1cblxuZXhwb3J0IHZhciBERUJVRzphbnkgPSB7XG5cbn07XG5cbmlmKEVOViA9PT0gXCJicm93c2VyXCIpIHdpbmRvd1tcIkRFQlVHXCJdID0gREVCVUc7XG5cbnR5cGUgVGVtcGxhdGVTdHJpbmdUYWcgPSAoc3RyaW5nczpzdHJpbmdbXSwgLi4udmFsdWVzOmFueVtdKSA9PiBzdHJpbmdcbmludGVyZmFjZSB1bnBhZCB7XG4gIChpbmRlbnQ6bnVtYmVyKTogVGVtcGxhdGVTdHJpbmdUYWdcbiAgbWVtbzoge1tpbmRlbnQ6bnVtYmVyXTogVGVtcGxhdGVTdHJpbmdUYWd9XG59XG5leHBvcnQgdmFyIHVucGFkOnVucGFkID0gPGFueT5mdW5jdGlvbihpbmRlbnQpIHtcbiAgaWYodW5wYWQubWVtb1tpbmRlbnRdKSByZXR1cm4gdW5wYWQubWVtb1tpbmRlbnRdO1xuICByZXR1cm4gdW5wYWQubWVtb1tpbmRlbnRdID0gZnVuY3Rpb24oc3RyaW5ncywgLi4udmFsdWVzKSB7XG4gICAgaWYoIXN0cmluZ3MubGVuZ3RoKSByZXR1cm47XG4gICAgbGV0IHJlcyA9IFwiXCI7XG4gICAgbGV0IGl4ID0gMDtcbiAgICBmb3IobGV0IHN0ciBvZiBzdHJpbmdzKSByZXMgKz0gc3RyICsgKHZhbHVlcy5sZW5ndGggPiBpeCA/IHZhbHVlc1tpeCsrXSA6IFwiXCIpO1xuXG4gICAgaWYocmVzWzBdID09PSBcIlxcblwiKSByZXMgPSByZXMuc2xpY2UoMSk7XG4gICAgbGV0IGNoYXJJeCA9IDA7XG4gICAgd2hpbGUodHJ1ZSkge1xuICAgICAgcmVzID0gcmVzLnNsaWNlKDAsIGNoYXJJeCkgKyByZXMuc2xpY2UoY2hhckl4ICsgaW5kZW50KTtcbiAgICAgIGNoYXJJeCA9IHJlcy5pbmRleE9mKFwiXFxuXCIsIGNoYXJJeCkgKyAxO1xuICAgICAgaWYoIWNoYXJJeCkgYnJlYWs7XG4gICAgfVxuICByZXR1cm4gcmVzO1xuICB9XG59O1xudW5wYWQubWVtbyA9IHt9O1xuXG5leHBvcnQgZnVuY3Rpb24gcmVwZWF0KHN0cjpzdHJpbmcsIGxlbmd0aDpudW1iZXIpIHtcbiAgbGV0IGxlbiA9IGxlbmd0aCAvIHN0ci5sZW5ndGg7XG4gIGxldCByZXMgPSBcIlwiO1xuICBmb3IobGV0IGl4ID0gMDsgaXggPCBsZW47IGl4KyspICByZXMgKz0gc3RyO1xuICByZXR1cm4gKHJlcy5sZW5ndGggPiBsZW5ndGgpID8gcmVzLnNsaWNlKDAsIGxlbmd0aCkgOiByZXM7XG59XG5leHBvcnQgZnVuY3Rpb24gdW5kZXJsaW5lKHN0YXJ0SXgsIGxlbmd0aCkge1xuICByZXR1cm4gcmVwZWF0KFwiIFwiLCBzdGFydEl4KSArIFwiXlwiICsgcmVwZWF0KFwiflwiLCBsZW5ndGggLSAxKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhcGl0YWxpemUod29yZDpzdHJpbmcpOnN0cmluZyB7XG4gIHJldHVybiB3b3JkWzBdLnRvVXBwZXJDYXNlKCkgKyB3b3JkLnNsaWNlKDEpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aXRsZWNhc2UobmFtZTpzdHJpbmcpOnN0cmluZyB7XG4gIHJldHVybiBuYW1lLnNwbGl0KFwiIFwiKS5tYXAoY2FwaXRhbGl6ZSkuam9pbihcIiBcIik7XG59XG5cbmV4cG9ydCB2YXIgc3RyaW5nID0ge1xuICB1bnBhZCxcbiAgcmVwZWF0LFxuICB1bmRlcmxpbmUsXG4gIGNhcGl0YWxpemUsXG4gIHRpdGxlY2FzZVxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIHRhaWwoYXJyKSB7XG4gIHJldHVybiBhcnJbYXJyLmxlbmd0aCAtIDFdO1xufVxuXG5leHBvcnQgdmFyIGFycmF5ID0ge1xuICB0YWlsXG59O1xuXG5leHBvcnQgZnVuY3Rpb24gY29lcmNlSW5wdXQoaW5wdXQpIHtcbiAgLy8gaHR0cDovL2pzcGVyZi5jb20vcmVnZXgtdnMtcGx1cy1jb2VyY2lvblxuICBpZiAoIWlzTmFOKCtpbnB1dCkpIHJldHVybiAraW5wdXQ7XG4gIGVsc2UgaWYgKGlucHV0ID09PSBcInRydWVcIikgcmV0dXJuIHRydWU7XG4gIGVsc2UgaWYgKGlucHV0ID09PSBcImZhbHNlXCIpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGlucHV0O1xufVxuXG4vLyBTaGFsbG93IGNvcHkgdGhlIGdpdmVuIG9iamVjdC5cbmV4cG9ydCBmdW5jdGlvbiBjb3B5KG9iaikge1xuICBpZighb2JqIHx8IHR5cGVvZiBvYmogIT09IFwib2JqZWN0XCIpIHJldHVybiBvYmo7XG4gIGlmKG9iaiBpbnN0YW5jZW9mIEFycmF5KSByZXR1cm4gb2JqLnNsaWNlKCk7XG4gIGxldCByZXMgPSB7fTtcbiAgZm9yKGxldCBrZXkgaW4gb2JqKSByZXNba2V5XSA9IG9ialtrZXldO1xuICByZXR1cm4gcmVzO1xufSIsImltcG9ydCAqIGFzIGFwcCBmcm9tIFwiLi4vc3JjL2FwcFwiO1xuaW1wb3J0IHtSaWNoVGV4dEVkaXRvcn0gZnJvbSBcIi4uL3NyYy9yaWNoVGV4dEVkaXRvclwiO1xuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIm1hcmtlZC1hc3QvbWFya2VkLmQudHNcIiAvPlxuaW1wb3J0ICogYXMgbWFya2VkIGZyb20gXCJtYXJrZWQtYXN0XCI7XG5cbmRlY2xhcmUgdmFyIENvZGVNaXJyb3I7XG5kZWNsYXJlIHZhciB1dWlkO1xuXG5mdW5jdGlvbiBlbWJlZFF1ZXJ5KHF1ZXJ5KSB7XG4gIHZhciBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gIHNwYW4udGV4dENvbnRlbnQgPSBgRXhlYyAke3F1ZXJ5fWA7XG4gIHNwYW4uY2xhc3NMaXN0LmFkZChcImxpbmtcIik7XG4gIHJldHVybiBzcGFuO1xufVxuXG5mdW5jdGlvbiByZXBsYWNlSW5saW5lQXR0cmlidXRlKHF1ZXJ5KSB7XG4gIHJldHVybiBgeyR7dXVpZCgpfX1gO1xufVxuXG5mdW5jdGlvbiByZW1vdmVBdHRyaWJ1dGUoc291cmNlSWQpIHtcblxufVxuXG5mdW5jdGlvbiBDTVNlYXJjaEJveDIobm9kZSwgZWxlbSkge1xuICBsZXQgZWRpdG9yID0gbm9kZS5lZGl0b3I7XG4gIGxldCBjbTtcbiAgaWYoIWVkaXRvcikge1xuICAgIG5vZGUuZWRpdG9yID0gbmV3IFJpY2hUZXh0RWRpdG9yKG5vZGUsIGVtYmVkUXVlcnksIHJlcGxhY2VJbmxpbmVBdHRyaWJ1dGUsIHJlbW92ZUF0dHJpYnV0ZSk7XG4gICAgY20gPSBub2RlLmVkaXRvci5jbUluc3RhbmNlO1xuICAgIGNtLmZvY3VzKCk7XG4gIH1cbiAgaWYoY20uZ2V0VmFsdWUoKSAhPT0gZWxlbS52YWx1ZSkge1xuICAgIGNtLnNldFZhbHVlKGVsZW0udmFsdWUgfHwgXCJcIik7XG4gIH1cbiAgY20ucmVmcmVzaCgpO1xuICBjbS5nZXRXcmFwcGVyRWxlbWVudCgpLnNldEF0dHJpYnV0ZShcInN0eWxlXCIsIFwiZmxleDogMTsgZm9udC1mYW1pbHk6ICdIZWx2ZXRpY2EgTmV1ZSc7IGZvbnQtd2VpZ2h0OjQwMDsgXCIpO1xufVxuXG52YXIgdGVzdFRleHQyID0gYCMgRW5naW5lZXJpbmdcblxuRW5naW5lZXJpbmcgaXMgYSB7ZGVwYXJ0bWVudH0gYXQge0tvZG93YX0gYW5kIHN0dWZmLlxuYDtcblxuZnVuY3Rpb24gcm9vdCgpIHtcbiAgcmV0dXJuIHtpZDogXCJyb290XCIsIHN0eWxlOiBcImZsZXg6IDE7IGJhY2tncm91bmQ6ICM2NjY7IGFsaWduLWl0ZW1zOiBzdHJldGNoO1wiLCBjaGlsZHJlbjogW1xuICAgIHt0OiBcInN0eWxlXCIsIHRleHQ6IGBcbiAgICAgIC5saW5rIHsgY29sb3I6ICMwMEY7IGJvcmRlci1ib3R0b206MXB4IHNvbGlkICMwMGY7IH1cbiAgICAgIC5ib2xkIHsgZm9udC13ZWlnaHQ6IGJvbGQ7IH1cbiAgICAgIC5pdGFsaWMgeyBmb250LXN0eWxlOiBpdGFsaWM7IH1cbiAgICAgIC5Db2RlTWlycm9yIC5oZWFkZXIgeyBmb250LXNpemU6MjBwdDsgfVxuICAgICAgLmhlYWRlci1wYWRkaW5nIHsgaGVpZ2h0OjIwcHg7IH1cbiAgICAgIC5wbGFjZWhvbGRlciB7IGNvbG9yOiAjYmJiOyBwb3NpdGlvbjphYnNvbHV0ZTsgcG9pbnRlci1ldmVudHM6bm9uZTsgfVxuICAgIGB9LFxuICAgIHtzdHlsZTogXCIgYmFja2dyb3VuZDogI2ZmZjsgcGFkZGluZzoxMHB4IDEwcHg7IG1hcmdpbjogMTAwcHggYXV0bzsgd2lkdGg6IDgwMHB4OyBmbGV4OiAxO1wiLCBwb3N0UmVuZGVyOiBDTVNlYXJjaEJveDIsIHZhbHVlOiB0ZXN0VGV4dDJ9LFxuICBdfTtcbn1cblxuYXBwLnJlbmRlclJvb3RzW1wicmljaEVkaXRvclRlc3RcIl0gPSByb290OyIsIiIsIi8vICAgICB1dWlkLmpzXG4vL1xuLy8gICAgIENvcHlyaWdodCAoYykgMjAxMC0yMDEyIFJvYmVydCBLaWVmZmVyXG4vLyAgICAgTUlUIExpY2Vuc2UgLSBodHRwOi8vb3BlbnNvdXJjZS5vcmcvbGljZW5zZXMvbWl0LWxpY2Vuc2UucGhwXG5cbihmdW5jdGlvbigpIHtcbiAgdmFyIF9nbG9iYWwgPSB0aGlzO1xuXG4gIC8vIFVuaXF1ZSBJRCBjcmVhdGlvbiByZXF1aXJlcyBhIGhpZ2ggcXVhbGl0eSByYW5kb20gIyBnZW5lcmF0b3IuICBXZSBmZWF0dXJlXG4gIC8vIGRldGVjdCB0byBkZXRlcm1pbmUgdGhlIGJlc3QgUk5HIHNvdXJjZSwgbm9ybWFsaXppbmcgdG8gYSBmdW5jdGlvbiB0aGF0XG4gIC8vIHJldHVybnMgMTI4LWJpdHMgb2YgcmFuZG9tbmVzcywgc2luY2UgdGhhdCdzIHdoYXQncyB1c3VhbGx5IHJlcXVpcmVkXG4gIHZhciBfcm5nO1xuXG4gIC8vIE5vZGUuanMgY3J5cHRvLWJhc2VkIFJORyAtIGh0dHA6Ly9ub2RlanMub3JnL2RvY3MvdjAuNi4yL2FwaS9jcnlwdG8uaHRtbFxuICAvL1xuICAvLyBNb2RlcmF0ZWx5IGZhc3QsIGhpZ2ggcXVhbGl0eVxuICBpZiAodHlwZW9mKF9nbG9iYWwucmVxdWlyZSkgPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRyeSB7XG4gICAgICB2YXIgX3JiID0gX2dsb2JhbC5yZXF1aXJlKCdjcnlwdG8nKS5yYW5kb21CeXRlcztcbiAgICAgIF9ybmcgPSBfcmIgJiYgZnVuY3Rpb24oKSB7cmV0dXJuIF9yYigxNik7fTtcbiAgICB9IGNhdGNoKGUpIHt9XG4gIH1cblxuICBpZiAoIV9ybmcgJiYgX2dsb2JhbC5jcnlwdG8gJiYgY3J5cHRvLmdldFJhbmRvbVZhbHVlcykge1xuICAgIC8vIFdIQVRXRyBjcnlwdG8tYmFzZWQgUk5HIC0gaHR0cDovL3dpa2kud2hhdHdnLm9yZy93aWtpL0NyeXB0b1xuICAgIC8vXG4gICAgLy8gTW9kZXJhdGVseSBmYXN0LCBoaWdoIHF1YWxpdHlcbiAgICB2YXIgX3JuZHM4ID0gbmV3IFVpbnQ4QXJyYXkoMTYpO1xuICAgIF9ybmcgPSBmdW5jdGlvbiB3aGF0d2dSTkcoKSB7XG4gICAgICBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKF9ybmRzOCk7XG4gICAgICByZXR1cm4gX3JuZHM4O1xuICAgIH07XG4gIH1cblxuICBpZiAoIV9ybmcpIHtcbiAgICAvLyBNYXRoLnJhbmRvbSgpLWJhc2VkIChSTkcpXG4gICAgLy9cbiAgICAvLyBJZiBhbGwgZWxzZSBmYWlscywgdXNlIE1hdGgucmFuZG9tKCkuICBJdCdzIGZhc3QsIGJ1dCBpcyBvZiB1bnNwZWNpZmllZFxuICAgIC8vIHF1YWxpdHkuXG4gICAgdmFyICBfcm5kcyA9IG5ldyBBcnJheSgxNik7XG4gICAgX3JuZyA9IGZ1bmN0aW9uKCkge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIHI7IGkgPCAxNjsgaSsrKSB7XG4gICAgICAgIGlmICgoaSAmIDB4MDMpID09PSAwKSByID0gTWF0aC5yYW5kb20oKSAqIDB4MTAwMDAwMDAwO1xuICAgICAgICBfcm5kc1tpXSA9IHIgPj4+ICgoaSAmIDB4MDMpIDw8IDMpICYgMHhmZjtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIF9ybmRzO1xuICAgIH07XG4gIH1cblxuICAvLyBCdWZmZXIgY2xhc3MgdG8gdXNlXG4gIHZhciBCdWZmZXJDbGFzcyA9IHR5cGVvZihfZ2xvYmFsLkJ1ZmZlcikgPT0gJ2Z1bmN0aW9uJyA/IF9nbG9iYWwuQnVmZmVyIDogQXJyYXk7XG5cbiAgLy8gTWFwcyBmb3IgbnVtYmVyIDwtPiBoZXggc3RyaW5nIGNvbnZlcnNpb25cbiAgdmFyIF9ieXRlVG9IZXggPSBbXTtcbiAgdmFyIF9oZXhUb0J5dGUgPSB7fTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCAyNTY7IGkrKykge1xuICAgIF9ieXRlVG9IZXhbaV0gPSAoaSArIDB4MTAwKS50b1N0cmluZygxNikuc3Vic3RyKDEpO1xuICAgIF9oZXhUb0J5dGVbX2J5dGVUb0hleFtpXV0gPSBpO1xuICB9XG5cbiAgLy8gKipgcGFyc2UoKWAgLSBQYXJzZSBhIFVVSUQgaW50byBpdCdzIGNvbXBvbmVudCBieXRlcyoqXG4gIGZ1bmN0aW9uIHBhcnNlKHMsIGJ1Ziwgb2Zmc2V0KSB7XG4gICAgdmFyIGkgPSAoYnVmICYmIG9mZnNldCkgfHwgMCwgaWkgPSAwO1xuXG4gICAgYnVmID0gYnVmIHx8IFtdO1xuICAgIHMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bMC05YS1mXXsyfS9nLCBmdW5jdGlvbihvY3QpIHtcbiAgICAgIGlmIChpaSA8IDE2KSB7IC8vIERvbid0IG92ZXJmbG93IVxuICAgICAgICBidWZbaSArIGlpKytdID0gX2hleFRvQnl0ZVtvY3RdO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gWmVybyBvdXQgcmVtYWluaW5nIGJ5dGVzIGlmIHN0cmluZyB3YXMgc2hvcnRcbiAgICB3aGlsZSAoaWkgPCAxNikge1xuICAgICAgYnVmW2kgKyBpaSsrXSA9IDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJ1ZjtcbiAgfVxuXG4gIC8vICoqYHVucGFyc2UoKWAgLSBDb252ZXJ0IFVVSUQgYnl0ZSBhcnJheSAoYWxhIHBhcnNlKCkpIGludG8gYSBzdHJpbmcqKlxuICBmdW5jdGlvbiB1bnBhcnNlKGJ1Ziwgb2Zmc2V0KSB7XG4gICAgdmFyIGkgPSBvZmZzZXQgfHwgMCwgYnRoID0gX2J5dGVUb0hleDtcbiAgICByZXR1cm4gIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dICtcbiAgICAgICAgICAgIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dICsgJy0nICtcbiAgICAgICAgICAgIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dICsgJy0nICtcbiAgICAgICAgICAgIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dICsgJy0nICtcbiAgICAgICAgICAgIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dICsgJy0nICtcbiAgICAgICAgICAgIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dICtcbiAgICAgICAgICAgIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dICtcbiAgICAgICAgICAgIGJ0aFtidWZbaSsrXV0gKyBidGhbYnVmW2krK11dO1xuICB9XG5cbiAgLy8gKipgdjEoKWAgLSBHZW5lcmF0ZSB0aW1lLWJhc2VkIFVVSUQqKlxuICAvL1xuICAvLyBJbnNwaXJlZCBieSBodHRwczovL2dpdGh1Yi5jb20vTGlvc0svVVVJRC5qc1xuICAvLyBhbmQgaHR0cDovL2RvY3MucHl0aG9uLm9yZy9saWJyYXJ5L3V1aWQuaHRtbFxuXG4gIC8vIHJhbmRvbSAjJ3Mgd2UgbmVlZCB0byBpbml0IG5vZGUgYW5kIGNsb2Nrc2VxXG4gIHZhciBfc2VlZEJ5dGVzID0gX3JuZygpO1xuXG4gIC8vIFBlciA0LjUsIGNyZWF0ZSBhbmQgNDgtYml0IG5vZGUgaWQsICg0NyByYW5kb20gYml0cyArIG11bHRpY2FzdCBiaXQgPSAxKVxuICB2YXIgX25vZGVJZCA9IFtcbiAgICBfc2VlZEJ5dGVzWzBdIHwgMHgwMSxcbiAgICBfc2VlZEJ5dGVzWzFdLCBfc2VlZEJ5dGVzWzJdLCBfc2VlZEJ5dGVzWzNdLCBfc2VlZEJ5dGVzWzRdLCBfc2VlZEJ5dGVzWzVdXG4gIF07XG5cbiAgLy8gUGVyIDQuMi4yLCByYW5kb21pemUgKDE0IGJpdCkgY2xvY2tzZXFcbiAgdmFyIF9jbG9ja3NlcSA9IChfc2VlZEJ5dGVzWzZdIDw8IDggfCBfc2VlZEJ5dGVzWzddKSAmIDB4M2ZmZjtcblxuICAvLyBQcmV2aW91cyB1dWlkIGNyZWF0aW9uIHRpbWVcbiAgdmFyIF9sYXN0TVNlY3MgPSAwLCBfbGFzdE5TZWNzID0gMDtcblxuICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2Jyb29mYS9ub2RlLXV1aWQgZm9yIEFQSSBkZXRhaWxzXG4gIGZ1bmN0aW9uIHYxKG9wdGlvbnMsIGJ1Ziwgb2Zmc2V0KSB7XG4gICAgdmFyIGkgPSBidWYgJiYgb2Zmc2V0IHx8IDA7XG4gICAgdmFyIGIgPSBidWYgfHwgW107XG5cbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgIHZhciBjbG9ja3NlcSA9IG9wdGlvbnMuY2xvY2tzZXEgIT0gbnVsbCA/IG9wdGlvbnMuY2xvY2tzZXEgOiBfY2xvY2tzZXE7XG5cbiAgICAvLyBVVUlEIHRpbWVzdGFtcHMgYXJlIDEwMCBuYW5vLXNlY29uZCB1bml0cyBzaW5jZSB0aGUgR3JlZ29yaWFuIGVwb2NoLFxuICAgIC8vICgxNTgyLTEwLTE1IDAwOjAwKS4gIEpTTnVtYmVycyBhcmVuJ3QgcHJlY2lzZSBlbm91Z2ggZm9yIHRoaXMsIHNvXG4gICAgLy8gdGltZSBpcyBoYW5kbGVkIGludGVybmFsbHkgYXMgJ21zZWNzJyAoaW50ZWdlciBtaWxsaXNlY29uZHMpIGFuZCAnbnNlY3MnXG4gICAgLy8gKDEwMC1uYW5vc2Vjb25kcyBvZmZzZXQgZnJvbSBtc2Vjcykgc2luY2UgdW5peCBlcG9jaCwgMTk3MC0wMS0wMSAwMDowMC5cbiAgICB2YXIgbXNlY3MgPSBvcHRpb25zLm1zZWNzICE9IG51bGwgPyBvcHRpb25zLm1zZWNzIDogbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cbiAgICAvLyBQZXIgNC4yLjEuMiwgdXNlIGNvdW50IG9mIHV1aWQncyBnZW5lcmF0ZWQgZHVyaW5nIHRoZSBjdXJyZW50IGNsb2NrXG4gICAgLy8gY3ljbGUgdG8gc2ltdWxhdGUgaGlnaGVyIHJlc29sdXRpb24gY2xvY2tcbiAgICB2YXIgbnNlY3MgPSBvcHRpb25zLm5zZWNzICE9IG51bGwgPyBvcHRpb25zLm5zZWNzIDogX2xhc3ROU2VjcyArIDE7XG5cbiAgICAvLyBUaW1lIHNpbmNlIGxhc3QgdXVpZCBjcmVhdGlvbiAoaW4gbXNlY3MpXG4gICAgdmFyIGR0ID0gKG1zZWNzIC0gX2xhc3RNU2VjcykgKyAobnNlY3MgLSBfbGFzdE5TZWNzKS8xMDAwMDtcblxuICAgIC8vIFBlciA0LjIuMS4yLCBCdW1wIGNsb2Nrc2VxIG9uIGNsb2NrIHJlZ3Jlc3Npb25cbiAgICBpZiAoZHQgPCAwICYmIG9wdGlvbnMuY2xvY2tzZXEgPT0gbnVsbCkge1xuICAgICAgY2xvY2tzZXEgPSBjbG9ja3NlcSArIDEgJiAweDNmZmY7XG4gICAgfVxuXG4gICAgLy8gUmVzZXQgbnNlY3MgaWYgY2xvY2sgcmVncmVzc2VzIChuZXcgY2xvY2tzZXEpIG9yIHdlJ3ZlIG1vdmVkIG9udG8gYSBuZXdcbiAgICAvLyB0aW1lIGludGVydmFsXG4gICAgaWYgKChkdCA8IDAgfHwgbXNlY3MgPiBfbGFzdE1TZWNzKSAmJiBvcHRpb25zLm5zZWNzID09IG51bGwpIHtcbiAgICAgIG5zZWNzID0gMDtcbiAgICB9XG5cbiAgICAvLyBQZXIgNC4yLjEuMiBUaHJvdyBlcnJvciBpZiB0b28gbWFueSB1dWlkcyBhcmUgcmVxdWVzdGVkXG4gICAgaWYgKG5zZWNzID49IDEwMDAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3V1aWQudjEoKTogQ2FuXFwndCBjcmVhdGUgbW9yZSB0aGFuIDEwTSB1dWlkcy9zZWMnKTtcbiAgICB9XG5cbiAgICBfbGFzdE1TZWNzID0gbXNlY3M7XG4gICAgX2xhc3ROU2VjcyA9IG5zZWNzO1xuICAgIF9jbG9ja3NlcSA9IGNsb2Nrc2VxO1xuXG4gICAgLy8gUGVyIDQuMS40IC0gQ29udmVydCBmcm9tIHVuaXggZXBvY2ggdG8gR3JlZ29yaWFuIGVwb2NoXG4gICAgbXNlY3MgKz0gMTIyMTkyOTI4MDAwMDA7XG5cbiAgICAvLyBgdGltZV9sb3dgXG4gICAgdmFyIHRsID0gKChtc2VjcyAmIDB4ZmZmZmZmZikgKiAxMDAwMCArIG5zZWNzKSAlIDB4MTAwMDAwMDAwO1xuICAgIGJbaSsrXSA9IHRsID4+PiAyNCAmIDB4ZmY7XG4gICAgYltpKytdID0gdGwgPj4+IDE2ICYgMHhmZjtcbiAgICBiW2krK10gPSB0bCA+Pj4gOCAmIDB4ZmY7XG4gICAgYltpKytdID0gdGwgJiAweGZmO1xuXG4gICAgLy8gYHRpbWVfbWlkYFxuICAgIHZhciB0bWggPSAobXNlY3MgLyAweDEwMDAwMDAwMCAqIDEwMDAwKSAmIDB4ZmZmZmZmZjtcbiAgICBiW2krK10gPSB0bWggPj4+IDggJiAweGZmO1xuICAgIGJbaSsrXSA9IHRtaCAmIDB4ZmY7XG5cbiAgICAvLyBgdGltZV9oaWdoX2FuZF92ZXJzaW9uYFxuICAgIGJbaSsrXSA9IHRtaCA+Pj4gMjQgJiAweGYgfCAweDEwOyAvLyBpbmNsdWRlIHZlcnNpb25cbiAgICBiW2krK10gPSB0bWggPj4+IDE2ICYgMHhmZjtcblxuICAgIC8vIGBjbG9ja19zZXFfaGlfYW5kX3Jlc2VydmVkYCAoUGVyIDQuMi4yIC0gaW5jbHVkZSB2YXJpYW50KVxuICAgIGJbaSsrXSA9IGNsb2Nrc2VxID4+PiA4IHwgMHg4MDtcblxuICAgIC8vIGBjbG9ja19zZXFfbG93YFxuICAgIGJbaSsrXSA9IGNsb2Nrc2VxICYgMHhmZjtcblxuICAgIC8vIGBub2RlYFxuICAgIHZhciBub2RlID0gb3B0aW9ucy5ub2RlIHx8IF9ub2RlSWQ7XG4gICAgZm9yICh2YXIgbiA9IDA7IG4gPCA2OyBuKyspIHtcbiAgICAgIGJbaSArIG5dID0gbm9kZVtuXTtcbiAgICB9XG5cbiAgICByZXR1cm4gYnVmID8gYnVmIDogdW5wYXJzZShiKTtcbiAgfVxuXG4gIC8vICoqYHY0KClgIC0gR2VuZXJhdGUgcmFuZG9tIFVVSUQqKlxuXG4gIC8vIFNlZSBodHRwczovL2dpdGh1Yi5jb20vYnJvb2ZhL25vZGUtdXVpZCBmb3IgQVBJIGRldGFpbHNcbiAgZnVuY3Rpb24gdjQob3B0aW9ucywgYnVmLCBvZmZzZXQpIHtcbiAgICAvLyBEZXByZWNhdGVkIC0gJ2Zvcm1hdCcgYXJndW1lbnQsIGFzIHN1cHBvcnRlZCBpbiB2MS4yXG4gICAgdmFyIGkgPSBidWYgJiYgb2Zmc2V0IHx8IDA7XG5cbiAgICBpZiAodHlwZW9mKG9wdGlvbnMpID09ICdzdHJpbmcnKSB7XG4gICAgICBidWYgPSBvcHRpb25zID09ICdiaW5hcnknID8gbmV3IEJ1ZmZlckNsYXNzKDE2KSA6IG51bGw7XG4gICAgICBvcHRpb25zID0gbnVsbDtcbiAgICB9XG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICB2YXIgcm5kcyA9IG9wdGlvbnMucmFuZG9tIHx8IChvcHRpb25zLnJuZyB8fCBfcm5nKSgpO1xuXG4gICAgLy8gUGVyIDQuNCwgc2V0IGJpdHMgZm9yIHZlcnNpb24gYW5kIGBjbG9ja19zZXFfaGlfYW5kX3Jlc2VydmVkYFxuICAgIHJuZHNbNl0gPSAocm5kc1s2XSAmIDB4MGYpIHwgMHg0MDtcbiAgICBybmRzWzhdID0gKHJuZHNbOF0gJiAweDNmKSB8IDB4ODA7XG5cbiAgICAvLyBDb3B5IGJ5dGVzIHRvIGJ1ZmZlciwgaWYgcHJvdmlkZWRcbiAgICBpZiAoYnVmKSB7XG4gICAgICBmb3IgKHZhciBpaSA9IDA7IGlpIDwgMTY7IGlpKyspIHtcbiAgICAgICAgYnVmW2kgKyBpaV0gPSBybmRzW2lpXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYnVmIHx8IHVucGFyc2Uocm5kcyk7XG4gIH1cblxuICAvLyBFeHBvcnQgcHVibGljIEFQSVxuICB2YXIgdXVpZCA9IHY0O1xuICB1dWlkLnYxID0gdjE7XG4gIHV1aWQudjQgPSB2NDtcbiAgdXVpZC5wYXJzZSA9IHBhcnNlO1xuICB1dWlkLnVucGFyc2UgPSB1bnBhcnNlO1xuICB1dWlkLkJ1ZmZlckNsYXNzID0gQnVmZmVyQ2xhc3M7XG5cbiAgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICAgIC8vIFB1Ymxpc2ggYXMgQU1EIG1vZHVsZVxuICAgIGRlZmluZShmdW5jdGlvbigpIHtyZXR1cm4gdXVpZDt9KTtcbiAgfSBlbHNlIGlmICh0eXBlb2YobW9kdWxlKSAhPSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cykge1xuICAgIC8vIFB1Ymxpc2ggYXMgbm9kZS5qcyBtb2R1bGVcbiAgICBtb2R1bGUuZXhwb3J0cyA9IHV1aWQ7XG4gIH0gZWxzZSB7XG4gICAgLy8gUHVibGlzaCBhcyBnbG9iYWwgKGluIGJyb3dzZXJzKVxuICAgIHZhciBfcHJldmlvdXNSb290ID0gX2dsb2JhbC51dWlkO1xuXG4gICAgLy8gKipgbm9Db25mbGljdCgpYCAtIChicm93c2VyIG9ubHkpIHRvIHJlc2V0IGdsb2JhbCAndXVpZCcgdmFyKipcbiAgICB1dWlkLm5vQ29uZmxpY3QgPSBmdW5jdGlvbigpIHtcbiAgICAgIF9nbG9iYWwudXVpZCA9IF9wcmV2aW91c1Jvb3Q7XG4gICAgICByZXR1cm4gdXVpZDtcbiAgICB9O1xuXG4gICAgX2dsb2JhbC51dWlkID0gdXVpZDtcbiAgfVxufSkuY2FsbCh0aGlzKTtcbiJdfQ==
