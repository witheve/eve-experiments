(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/// <reference path="microReact.ts" />
/// <reference path="../vendor/marked.d.ts" />
var microReact = require("./microReact");
var runtime = require("./runtime");
exports.syncedTables = ["manual entity", "view", "action", "action source", "action mapping", "action mapping constant", "action mapping sorted", "action mapping limit", "add collection action", "add eav action", "add bit action"];
exports.eveLocalStorageKey = "eve";
//---------------------------------------------------------
// Renderer
//---------------------------------------------------------
var perfStats;
var updateStat = 0;
function initRenderer() {
    exports.renderer = new microReact.Renderer();
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
        var start = performance.now();
        var trees = [];
        for (var root in exports.renderRoots) {
            trees.push(exports.renderRoots[root]());
        }
        var total = performance.now() - start;
        if (total > 10) {
            console.log("Slow root: " + total);
        }
        perfStats.textContent = "";
        perfStats.textContent += "root: " + total.toFixed(2);
        var start = performance.now();
        exports.renderer.render(trees);
        var total = performance.now() - start;
        perfStats.textContent += " | render: " + total.toFixed(2);
        perfStats.textContent += " | update: " + updateStat.toFixed(2);
        exports.renderer.queued = false;
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

},{"./microReact":2,"./runtime":4}],2:[function(require,module,exports){
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
var app_1 = require("./app");
var app = require("./app");
window["eve"] = app_1.eve;
var entities = { "egg": "egg", "chicken": "chicken" };
var collections = { "dish": "dish" };
var attributes = {};
var modifiers = { "and": "and", "or": "or", "without": "without", "aren t": "aren t" };
var patterns = {};
var TokenTypes;
(function (TokenTypes) {
    TokenTypes[TokenTypes["entity"] = 0] = "entity";
    TokenTypes[TokenTypes["collection"] = 1] = "collection";
    TokenTypes[TokenTypes["attribute"] = 2] = "attribute";
    TokenTypes[TokenTypes["modifier"] = 3] = "modifier";
    TokenTypes[TokenTypes["pattern"] = 4] = "pattern";
})(TokenTypes || (TokenTypes = {}));
function checkForToken(token) {
    var found;
    if (found = app_1.eve.findOne("entity", { entity: token })) {
        return { found: found, type: TokenTypes.entity };
    }
    else if (found = app_1.eve.findOne("collection", { collection: token })) {
        return { found: found, type: TokenTypes.collection };
    }
    else if (found = app_1.eve.findOne("entity eavs", { attribute: token })) {
        return { found: found, type: TokenTypes.attribute };
    }
    else if (found = modifiers[token]) {
        return { found: found, type: TokenTypes.modifier };
    }
    else if (found = patterns[token]) {
        return { found: found, type: TokenTypes.pattern };
    }
    return {};
}
function getTokens(string) {
    // remove all non-word non-space characters
    var cleaned = string.replace(/[^\s\w]/gi, " ").toLowerCase();
    var words = cleaned.split(" ");
    var front = 0;
    var back = words.length;
    var results = [];
    var pos = 0;
    while (front < words.length) {
        var str = words.slice(front, back).join(" ");
        var orig = str;
        var _a = checkForToken(str), found = _a.found, type = _a.type;
        if (!found) {
            str = pluralize(str, 1);
            var _b = checkForToken(str), found = _b.found, type = _b.type;
            if (!found) {
                str = pluralize(str, 2);
                var _c = checkForToken(str), found = _c.found, type = _c.type;
            }
        }
        if (found) {
            results.push({ found: str, orig: orig, pos: pos, type: type, info: found, id: uuid(), children: [] });
            front = back;
            pos += orig.length + 1;
            back = words.length;
        }
        else if (back - 1 > front) {
            back--;
        }
        else {
            back = words.length;
            pos += words[front].length + 1;
            front++;
        }
    }
    return results;
}
var tokenRelationships = (_a = {},
    _a[TokenTypes.collection] = (_b = {},
        _b[TokenTypes.collection] = "collection to collection",
        _b[TokenTypes.entity] = "collection to entity",
        _b[TokenTypes.attribute] = "collection to attribute",
        _b
    ),
    _a[TokenTypes.entity] = (_c = {},
        _c[TokenTypes.entity] = "entity to entity",
        _c[TokenTypes.attribute] = "entity to attribute",
        _c
    ),
    _a
);
function determineRelationship(parent, child) {
    return tokenRelationships[parent.type][child.type];
}
function tokensToTree(tokens) {
    var roots = [];
    var operations = [];
    var groups = [];
    // Find the direct object
    // The direct object is the first collection we find, or if there are none,
    // the first entity, or finally the first attribute.
    var directObject;
    for (var _i = 0; _i < tokens.length; _i++) {
        var token = tokens[_i];
        if (token.type === TokenTypes.collection) {
            directObject = token;
            break;
        }
        else if (token.type === TokenTypes.entity) {
            directObject = token;
        }
        else if (token.type === TokenTypes.attribute && !directObject) {
            directObject = token;
        }
    }
    if (!directObject)
        return { directObject: directObject, roots: roots, operations: operations, groups: groups };
    // the direct object is always the first root
    roots.push(directObject);
    // we need to keep state as we traverse the tokens for modifiers and patterns
    var state = {};
    // as we parse the query we may encounter other subjects in the sentence, we
    // need a reference to those previous subjects to see if the current token is
    // related to that or the directObject
    var indirectObject = directObject;
    for (var _a = 0; _a < tokens.length; _a++) {
        var token = tokens[_a];
        var type = token.type, info = token.info, found = token.found;
        // deal with modifiers
        if (type === TokenTypes.modifier) {
            continue;
        }
        // deal with patterns
        if (type === TokenTypes.pattern) {
            continue;
        }
        // once modifiers and patterns have been applied, we don't need to worry
        // about the directObject as it's already been asigned to the first root.
        if (directObject === token)
            continue;
        if (directObject === indirectObject) {
            directObject.children.push(token);
            token.relationship = determineRelationship(directObject, token);
        }
    }
    return { directObject: directObject, roots: roots, operations: operations, groups: groups };
}
function treeToPlan(tree) {
    return [];
}
function groupTree(root) {
    var kids = root.children.map(groupTree);
    return { c: "", children: [
            { c: "node " + TokenTypes[root.type], text: root.found + " (" + (root.relationship || "root") + ")" },
            { c: "kids", children: kids },
        ] };
}
function testSearch(search) {
    var tokens = getTokens(search);
    var tree = tokensToTree(tokens);
    var plan = treeToPlan(tree);
    //tokens
    var tokensNode = { c: "tokens", children: [
            { c: "header", text: "Tokens" },
            { c: "kids", children: tokens.map(function (token) {
                    return { c: "node " + TokenTypes[token.type], text: token.found + " (" + TokenTypes[token.type] + ")" };
                }) }
        ] };
    //tree
    var treeNode = { c: "tree", children: [
            { c: "header", text: "Tree" },
            { c: "kids", children: [
                    { c: "header2", text: "Roots" },
                    { c: "kids", children: tree.roots.map(groupTree) },
                    { c: "header2", text: "Operations" },
                    { c: "kids", children: tree.operations.map(groupTree) },
                    { c: "header2", text: "Groups" },
                    { c: "kids", children: tree.groups.map(groupTree) },
                ] }
        ] };
    //tokens
    var planNode = { c: "tokens", children: [
            { c: "header", text: "Plan" },
            { c: "kids", children: plan.map(function (step) {
                    return { c: "node", text: step.type + " (" + step.found + ")" };
                }) }
        ] };
    return { c: "search", children: [
            { c: "search-header", text: "" + search },
            tokensNode,
            treeNode,
            planNode,
        ] };
}
function root() {
    return { id: "root", c: "test-root", children: [
            testSearch("dishes with eggs and chicken"),
            testSearch("dishes without eggs and chicken"),
            testSearch("dishes without eggs or chicken"),
            testSearch("dishes with eggs that aren't desserts"),
        ] };
}
app.renderRoots["wiki"] = root;
var _a, _b, _c;

},{"./app":1}],4:[function(require,module,exports){
var runtime = exports;
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
function indexOfFact(haystack, needle, equals) {
    if (equals === void 0) { equals = objectsIdentical; }
    var ix = 0;
    for (var _i = 0; _i < haystack.length; _i++) {
        var fact = haystack[_i];
        if (equals(fact, needle)) {
            return ix;
        }
        ix++;
    }
    return -1;
}
function removeFact(haystack, needle, equals) {
    var ix = indexOfFact(haystack, needle, equals);
    if (ix > -1)
        haystack.splice(ix, 1);
    return haystack;
}
exports.removeFact = removeFact;
function generateEqualityFn(keys) {
    return new Function("a", "b", "return " + keys.map(function (key, ix) {
        if (key.constructor === Array) {
            return "a[" + key[0] + "]['" + key[1] + "'] === b[" + key[0] + "]['" + key[1] + "']";
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
            keyStrings.push("a[" + key[0] + "]['" + key[1] + "']");
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
            removes += "[remove[" + key[0] + "]['" + key[1] + "']]";
        }
        else {
            removes += "[remove['" + key + "']]";
        }
    }
    removes += ";\nruntime.removeFact(cur, remove, equals);";
    for (var _a = 0; _a < keys.length; _a++) {
        var key = keys[_a];
        ix++;
        if (key.constructor === Array) {
            checks += "value = add[" + key[0] + "]['" + key[1] + "']\n";
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
    return (new Function("index", "adds", "removes", "equals", code)).bind(runtime);
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
    };
    Diff.prototype.addMany = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.adds, objs);
    };
    Diff.prototype.removeFacts = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.removes, objs);
    };
    Diff.prototype.remove = function (table, query) {
        var tableDiff = this.ensureTable(table);
        var found = this.ixer.find(table, query);
        this.length += found.length;
        mergeArrays(tableDiff.removes, found);
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
var Indexer = (function () {
    function Indexer() {
        this.tables = {};
    }
    Indexer.prototype.addTable = function (name, keys) {
        if (keys === void 0) { keys = []; }
        var table = this.tables[name];
        if (table && keys.length) {
            table.fields = keys;
            table.stringify = generateStringFn(keys);
            table.equals = generateEqualityFn(keys);
        }
        else {
            table = this.tables[name] = { table: [], factHash: {}, indexes: {}, triggers: {}, fields: keys, stringify: generateStringFn(keys), equals: generateEqualityFn(keys) };
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
        var localHash = {};
        var hashToFact = {};
        var hashes = [];
        for (var _i = 0; _i < adds.length; _i++) {
            var add = adds[_i];
            var hash = stringify(add);
            if (localHash[hash] === undefined) {
                localHash[hash] = 1;
                hashToFact[hash] = add;
                hashes.push(hash);
            }
            else {
                localHash[hash]++;
            }
        }
        for (var _a = 0; _a < removes.length; _a++) {
            var remove = removes[_a];
            var hash = stringify(remove);
            if (localHash[hash] === undefined) {
                localHash[hash] = -1;
                hashToFact[hash] = remove;
                hashes.push(hash);
            }
            else {
                localHash[hash]--;
            }
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
                factHash[hash] = true;
            }
            else if (count < 0 && factHash[hash]) {
                var fact = hashToFact[hash];
                realRemoves.push(fact);
                removeFact(facts, fact, table.equals);
                factHash[hash] = undefined;
            }
        }
        return { adds: realAdds, removes: realRemoves };
    };
    Indexer.prototype.collector = function (keys) {
        return {
            index: {},
            collect: generateCollector(keys)
        };
    };
    Indexer.prototype.factToIndex = function (table, fact) {
        var keys = Object.keys(fact);
        keys.sort();
        var indexName = keys.join("|");
        var index = table.indexes[indexName];
        if (!index) {
            index = table.indexes[indexName] = this.collector(keys);
            index.collect(index.index, table.table, [], table.equals);
        }
        var cursor = index.index;
        for (var _i = 0; _i < keys.length; _i++) {
            var key = keys[_i];
            cursor = cursor[fact[key]];
            if (!cursor)
                return [];
        }
        return cursor;
    };
    Indexer.prototype.execDiff = function (diff) {
        var triggers = {};
        var realDiffs = {};
        for (var tableId in diff.tables) {
            var tableDiff = diff.tables[tableId];
            if (!tableDiff.adds.length && !tableDiff.removes.length)
                continue;
            var realDiff = this.updateTable(tableId, tableDiff.adds, tableDiff.removes);
            // go through all the indexes and update them.
            var table = this.tables[tableId];
            for (var indexName in table.indexes) {
                var index = table.indexes[indexName];
                index.collect(index.index, realDiff.adds, realDiff.removes, table.equals);
            }
            for (var triggerName in table.triggers) {
                var trigger = table.triggers[triggerName];
                triggers[triggerName] = trigger;
            }
            realDiffs[tableId] = realDiff;
        }
        return { triggers: triggers, realDiffs: realDiffs };
    };
    Indexer.prototype.execTrigger = function (trigger) {
        var table = this.table(trigger.name);
        var _a = trigger.exec() || {}, results = _a.results, unprojected = _a.unprojected;
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
        this.applyDiff(diff);
    };
    Indexer.prototype.diff = function () {
        return new Diff(this);
    };
    Indexer.prototype.applyDiff = function (diff) {
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
    Indexer.prototype.index = function (tableId, keys) {
        var table = this.table(tableId);
        if (!table) {
            table = this.addTable(tableId);
        }
        keys.sort();
        var indexName = keys.join("|");
        var index = table.indexes[indexName];
        if (!index) {
            index = table.indexes[indexName] = this.collector(keys);
            if (table.fields.length)
                index.collect(index.index, table.facts, [], table.equals);
        }
        return index.index;
    };
    Indexer.prototype.find = function (tableId, query) {
        var table = this.tables[tableId];
        if (!table) {
            return [];
        }
        else if (!query) {
            return table.table;
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
    Indexer.prototype.trigger = function (name, table, exec) {
        var tables = (typeof table === "string") ? [table] : table;
        var trigger = { name: name, tables: tables, exec: exec };
        for (var _i = 0; _i < tables.length; _i++) {
            var tableId = tables[_i];
            var table_2 = this.table(tableId);
            table_2.triggers[name] = trigger;
        }
        var nextRound = this.execTrigger(trigger);
        while (nextRound) {
            nextRound = this.execTriggers(nextRound);
        }
        ;
    };
    Indexer.prototype.asView = function (query) {
        var name = query.name;
        var view = this.table(name);
        view.view = query;
        view.isView = true;
        this.trigger(name, query.tables, query.exec.bind(query));
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
    return Indexer;
})();
exports.Indexer = Indexer;
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
    Query.prototype.select = function (table, join, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        this.unprojectedSize++;
        this.tables.push(table);
        this.joins.push({ negated: false, table: table, join: join, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.deselect = function (table, join) {
        this.dirty = true;
        this.tables.push(table);
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
        return this;
    };
    Query.prototype.group = function (groups) {
        this.dirty = true;
        this.groups = groups;
        return this;
    };
    Query.prototype.sort = function (sorts) {
        this.dirty = true;
        this.sorts = sorts;
        return this;
    };
    Query.prototype.limit = function (limitInfo) {
        this.dirty = true;
        this.limitInfo = limitInfo;
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
        var returns = ["unprojected"];
        // we need an array to store our unprojected results
        root.children.push({ type: "declaration", var: "unprojected", value: "[]" });
        // run through each table nested in the order they were given doing pairwise
        // joins along the way.
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var table = join.table, ix = join.ix, negated = join.negated;
            var cur = {
                type: "select",
                table: table,
                ix: ix,
                negated: negated,
                children: [],
                join: false
            };
            // we only want to eat the cost of dealing with indexes
            // if we are actually joining on something
            var joinMap = join.join;
            this.applyAliases(joinMap);
            if (Object.keys(joinMap).length !== 0) {
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
                if (root.join) {
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
                }
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
                    resultsCheck = "if(resultCount === " + root.limit.results + ") break;";
                }
                var groupLimitCheck = "";
                if (root.limit && root.limit.perGroup && root.groups) {
                    groupLimitCheck = "if(perGroupCount === " + root.limit.perGroup + ") {\n            while(!differentGroup) {\n              nextIx += " + root.size + ";\n              if(nextIx >= len) break;\n              groupInfo[nextIx] = undefined;\n              differentGroup = " + groupCheck + ";\n            }\n          }";
                }
                var groupDifference = "";
                var groupInfo = "";
                if (this.groups) {
                    groupDifference = "\n          perGroupCount++\n          var differentGroup = " + groupCheck + ";\n          " + groupLimitCheck + "\n          if(differentGroup) {\n            " + projection + "\n            " + aggregateResets.join("\n") + "\n            perGroupCount = 0;\n            resultCount++;\n          }\n";
                    groupInfo = "groupInfo[ix] = resultCount;";
                }
                else {
                    groupDifference = "resultCount++;\n";
                    groupInfo = "groupInfo[ix] = 0;";
                }
                // if there are neither aggregates to calculate nor groups to build,
                // then we just need to worry about limiting
                if (!this.groups && aggregateCalls.length === 0) {
                    code = "var ix = 0;\n                  var resultCount = 0;\n                  var len = unprojected.length;\n                  while(ix < len) {\n                    " + resultsCheck + "\n                    " + (ordinal || "") + "\n                    " + projection + "\n                    groupInfo[ix] = resultCount;\n                    resultCount++;\n                    ix += " + root.size + ";\n                  }\n";
                    break;
                }
                code = "var resultCount = 0;\n                var perGroupCount = 0;\n                var ix = 0;\n                var nextIx = 0;\n                var len = unprojected.length;\n                " + aggregateStates.join("\n") + "\n                while(ix < len) {\n                  " + aggregateCalls.join("") + "\n                  " + groupInfo + "\n                  " + (ordinal || "") + "\n                  if(ix + " + root.size + " === len) {\n                    " + projection + "\n                    break;\n                  }\n                  nextIx += " + root.size + ";\n                  " + groupDifference + "\n                  " + resultsCheck + "\n                  ix = nextIx;\n                }\n";
                break;
            case "projection":
                var projectedVars = [];
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
                    projectedVars.push("'" + newField + "': " + value);
                }
                code += "results.push({ " + projectedVars.join(", ") + " });\n";
                break;
            case "return":
                var returns = [];
                for (var _m = 0, _o = root.vars; _m < _o.length; _m++) {
                    var curVar = _o[_m];
                    returns.push(curVar + ": " + curVar);
                }
                code += "return {" + returns.join(", ") + "};";
                break;
        }
        return code;
    };
    Query.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "QueryFunctions", code);
        this.dirty = false;
        return this;
    };
    Query.prototype.exec = function () {
        if (this.dirty) {
            this.compile();
        }
        return this.compiled(this.ixer, exports.QueryFunctions);
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
    Union.prototype.stateful = function () {
        this.dirty = true;
        this.isStateful = true;
        return this;
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
    Union.prototype.ununion = function (tableName, mapping) {
        this.dirty = true;
        this.ensureHasher(mapping);
        this.tables.push(tableName);
        this.sources.push({ type: "-", table: tableName, mapping: mapping });
        return this;
    };
    Union.prototype.toAST = function () {
        var root = { type: "union", children: [] };
        root.children.push({ type: "declaration", var: "results", value: "[]" });
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
                action = { type: "result", ix: ix };
            }
            else {
                action = { type: "removeResult", ix: ix };
            }
            root.children.push({
                type: "source",
                ix: ix,
                table: source.table,
                mapping: source.mapping,
                children: [action]
            });
            ix++;
        }
        root.children.push({ type: "hashesToResults" });
        root.children.push({ type: "return", vars: ["results", "hashes"] });
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
                code += "var sourceRows" + ix + " = ixer.table('" + root.table + "').table;\n";
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
                code += "hashes[hasher(mappedRow" + ix + ")] = mappedRow" + ix + ";\n";
                break;
            case "removeResult":
                var ix = root.ix;
                code += "hashes[hasher(mappedRow" + ix + ")] = false;\n";
                break;
            case "hashesToResults":
                code += "var hashKeys = Object.keys(hashes);\n";
                code += "for(var hashKeyIx = 0, hashKeyLen = hashKeys.length; hashKeyIx < hashKeyLen; hashKeyIx++) {\n";
                code += "var value = hashes[hashKeys[hashKeyIx]];\n";
                code += "if(value !== false) {\n";
                code += "results.push(value);\n";
                code += "}\n";
                code += "}\n";
                break;
            case "return":
                code += "return {" + root.vars.join(", ") + "};";
                break;
        }
        return code;
    };
    Union.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "hasher", "prevHashes", code);
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
        var results = this.compiled(this.ixer, this.hasher, this.prev.hashes);
        this.prev = results;
        return results;
    };
    return Union;
})();
//---------------------------------------------------------
// Public API
//---------------------------------------------------------
exports.SUCCEED = [{ success: true }];
exports.FAIL = [];
function indexer() {
    return new Indexer();
}
exports.indexer = indexer;

},{}]},{},[3])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYXBwLnRzIiwic3JjL21pY3JvUmVhY3QudHMiLCJzcmMvcXVlcnlQYXJzZXIudHMiLCJzcmMvcnVudGltZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBLHNDQUFzQztBQUN0Qyw4Q0FBOEM7QUFDOUMsSUFBWSxVQUFVLFdBQU0sY0FBYyxDQUFDLENBQUE7QUFDM0MsSUFBWSxPQUFPLFdBQU0sV0FBVyxDQUFDLENBQUE7QUFJMUIsb0JBQVksR0FBRyxDQUFDLGVBQWUsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxnQkFBZ0IsRUFBRSx5QkFBeUIsRUFBRSx1QkFBdUIsRUFBRSxzQkFBc0IsRUFBRSx1QkFBdUIsRUFBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0FBQy9OLDBCQUFrQixHQUFHLEtBQUssQ0FBQztBQUV0QywyREFBMkQ7QUFDM0QsV0FBVztBQUNYLDJEQUEyRDtBQUUzRCxJQUFJLFNBQVMsQ0FBQztBQUNkLElBQUksVUFBVSxHQUFHLENBQUMsQ0FBQztBQUVuQjtJQUNFLGdCQUFRLEdBQUcsSUFBSSxVQUFVLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDckMsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsZ0JBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM1QyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQzFDLFNBQVMsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzFDLFNBQVMsQ0FBQyxFQUFFLEdBQUcsV0FBVyxDQUFDO0lBQzNCLFFBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQ3ZDLENBQUM7QUFFRCxJQUFJLFdBQVcsR0FBRyxNQUFNLENBQUMsYUFB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RCxDQUFDO1lBQ0QsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLElBQUksS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztnQkFDeEIsRUFBRSxDQUFBLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztvQkFBQyxTQUFTLENBQUMsSUFBSSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUM7Z0JBQ3pDLElBQUk7b0JBQUMsS0FBSyxDQUFDLElBQUksR0FBRyxHQUFHLENBQUMsSUFBSSxLQUFLLFNBQVMsR0FBRyxFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQztZQUM3RCxDQUFDO1lBQ0QsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztnQkFDeEIsRUFBRSxDQUFBLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQztvQkFBQyxTQUFTLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUM7Z0JBQ3RDLElBQUk7b0JBQUMsS0FBSyxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxLQUFLLFNBQVMsR0FBRyxFQUFFLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQztZQUN4RCxDQUFDO1lBQ0QsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLE1BQU0sS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztnQkFDOUIsRUFBRSxDQUFBLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztvQkFBQyxTQUFTLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUM7Z0JBQy9DLElBQUk7b0JBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxHQUFHLENBQUMsTUFBTSxLQUFLLFNBQVMsR0FBRyxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQztZQUNyRSxDQUFDO1lBQ0QsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLEtBQUssS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztnQkFDNUIsRUFBRSxDQUFBLENBQUMs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LENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQzNELEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQztvQkFBQyxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUMxRCxFQUFFLENBQUEsQ0FBQyxHQUFHLENBQUMsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDL0QsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLEVBQUUsS0FBSyxJQUFJLENBQUMsRUFBRSxDQUFDO29CQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQzlELEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEtBQUssSUFBSSxDQUFDLEVBQUUsQ0FBQztvQkFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUMvRCxFQUFFLENBQUEsQ0FBQyxHQUFHLENBQUMsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDOUQsRUFBRSxDQUFBLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDO29CQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQzFELEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEtBQUssSUFBSSxDQUFD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SSxDQUFDLFNBQVMsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQztnQkFBQyxHQUFHLENBQUMsU0FBUyxHQUFHLEdBQUcsQ0FBQyxPQUFPLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzFHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLFFBQVEsQ0FBQztnQkFBQyxHQUFHLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxRQUFRLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLFVBQVUsQ0FBQztnQkFBQyxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsQ0FBQyxVQUFVLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ3RILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLFVBQVUsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxVQUFVLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ3JILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLFFBQVEsQ0FBQztnQkFBQyxHQUFHLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxRQUFRLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFBQyxHQUFHLENBQUMsV0FBVyxHQUFHLEdBQUcsQ0FBQyxTQUFTLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xILEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQztnQkFBQyxHQUFHLENBQUMsU0FBUyxHQUFHLEdBQUcsQ0FBQyxPQUFPLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzFHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQztnQkFBQyxHQUFHLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlGLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQztnQkFBQyxHQUFHLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlGLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEtBQUssSUFBSSxDQUFDLE1BQU0sQ0FBQztnQkFBQyxHQUFHLENBQUMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxNQUFNLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ3RHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFBQyxHQUFHLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQztnQkFBQyxHQUFHLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQzlGLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFBQyxHQUFHLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxNQUFNLEtBQUssSUFBSSxDQUFDLE1BQU0sQ0FBQztnQkFBQyxHQUFHLENBQUMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxNQUFNLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ3RHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFBQyxHQUFHLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBQ2xHLEVBQUUsQ0FBQSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQztnQkFBQyxHQUFHLENBQUMsU0FBUyxHQUFHLEdBQUcsQ0FBQyxPQUFPLEtBQUssU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1lBRTFHLEVBQUUsQ0FBQSxDQUFDLElBQUksS0FBSyxPQUFPLElBQUksSUFBSSxLQUFLLFVBQVUsSUFBSSxJQUFJLEtBQUssT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDL0Qs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QkFBSyxHQUFMO1FBQ0UsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztRQUN6QyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2xCLE1BQU0sQ0FBQyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBQ0Qsb0JBQUksR0FBSjtRQUNFLEVBQUUsQ0FBQSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQ2QsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ2pCLENBQUM7UUFDRCxJQUFJLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RFLElBQUksQ0FBQyxJQUFJLEdBQUcsT0FBTyxDQUFDO1FBQ3BCLE1BQU0sQ0FBQyxPQUFPLENBQUM7SUFDakIsQ0FBQztJQUVILFlBQUM7QUFBRCxDQTVKQSxBQTRKQyxJQUFBO0FBRUQsMkRBQTJEO0FBQzNELGFBQWE7QUFDYiwyREFBMkQ7QUFFOUMsZUFBTyxHQUFHLENBQUMsRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQztBQUM1QixZQUFJLEdBQUcsRUFBRSxDQUFDO0FBRXZCO0lBQ0UsTUFBTSxDQUFDLElBQUksT0FBTyxFQUFFLENBQUM7QUFDdkIsQ0FBQztBQUZlLGVBQU8sVUFFdEIsQ0FBQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvLy8gPHJlZmVyZW5jZSBwYXRoPVwibWljcm9SZWFjdC50c1wiIC8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vdmVuZG9yL21hcmtlZC5kLnRzXCIgLz5cbmltcG9ydCAqIGFzIG1pY3JvUmVhY3QgZnJvbSBcIi4vbWljcm9SZWFjdFwiO1xuaW1wb3J0ICogYXMgcnVudGltZSBmcm9tIFwiLi9ydW50aW1lXCI7XG5cbmRlY2xhcmUgdmFyIHV1aWQ7XG5cbmV4cG9ydCB2YXIgc3luY2VkVGFibGVzID0gW1wibWFudWFsIGVudGl0eVwiLCBcInZpZXdcIiwgXCJhY3Rpb25cIiwgXCJhY3Rpb24gc291cmNlXCIsIFwiYWN0aW9uIG1hcHBpbmdcIiwgXCJhY3Rpb24gbWFwcGluZyBjb25zdGFudFwiLCBcImFjdGlvbiBtYXBwaW5nIHNvcnRlZFwiLCBcImFjdGlvbiBtYXBwaW5nIGxpbWl0XCIsIFwiYWRkIGNvbGxlY3Rpb24gYWN0aW9uXCIsIFwiYWRkIGVhdiBhY3Rpb25cIiwgXCJhZGQgYml0IGFjdGlvblwiXTtcbmV4cG9ydCB2YXIgZXZlTG9jYWxTdG9yYWdlS2V5ID0gXCJldmVcIjtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlcmVyXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG52YXIgcGVyZlN0YXRzO1xudmFyIHVwZGF0ZVN0YXQgPSAwO1xuZXhwb3J0IHZhciByZW5kZXJlcjtcbmZ1bmN0aW9uIGluaXRSZW5kZXJlcigpIHtcbiAgcmVuZGVyZXIgPSBuZXcgbWljcm9SZWFjdC5SZW5kZXJlcigpO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHJlbmRlcmVyLmNvbnRlbnQpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInJlc2l6ZVwiLCByZW5kZXIpO1xuICBwZXJmU3RhdHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBwZXJmU3RhdHMuaWQgPSBcInBlcmZTdGF0c1wiO1xuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHBlcmZTdGF0cyk7XG59XG5cbnZhciBwZXJmb3JtYW5jZSA9IHdpbmRvd1tcInBlcmZvcm1hbmNlXCJdIHx8IHsgbm93OiAoKSA9PiAobmV3IERhdGUoKSkuZ2V0VGltZSgpIH1cblxuZXhwb3J0IHZhciByZW5kZXJSb290cyA9IHt9O1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlcigpIHtcbiAgaWYoIXJlbmRlcmVyKSByZXR1cm47XG4gIHJlbmRlcmVyLnF1ZXVlZCA9IHRydWU7XG4gIC8vIEBGSVhNRTogd2h5IGRvZXMgdXNpbmcgcmVxdWVzdCBhbmltYXRpb24gZnJhbWUgY2F1c2UgZXZlbnRzIHRvIHN0YWNrIHVwIGFuZCB0aGUgcmVuZGVyZXIgdG8gZ2V0IGJlaGluZD9cbiAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAvLyByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgbGV0IHRyZWVzID0gW107XG4gICAgZm9yICh2YXIgcm9vdCBpbiByZW5kZXJSb290cykge1xuICAgICAgdHJlZXMucHVzaChyZW5kZXJSb290c1tyb290XSgpKTtcbiAgICB9XG4gICAgdmFyIHRvdGFsID0gcGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydDtcbiAgICBpZiAodG90YWwgPiAxMCkge1xuICAgICAgY29uc29sZS5sb2coXCJTbG93IHJvb3Q6IFwiICsgdG90YWwpO1xuICAgIH1cbiAgICBwZXJmU3RhdHMudGV4dENvbnRlbnQgPSBcIlwiO1xuICAgIHBlcmZTdGF0cy50ZXh0Q29udGVudCArPSBgcm9vdDogJHt0b3RhbC50b0ZpeGVkKDIpIH1gO1xuICAgIHZhciBzdGFydCA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgIHJlbmRlcmVyLnJlbmRlcih0cmVlcyk7XG4gICAgdmFyIHRvdGFsID0gcGVyZm9ybWFuY2Uubm93KCkgLSBzdGFydDtcbiAgICBwZXJmU3RhdHMudGV4dENvbnRlbnQgKz0gYCB8IHJlbmRlcjogJHt0b3RhbC50b0ZpeGVkKDIpIH1gO1xuICAgIHBlcmZTdGF0cy50ZXh0Q29udGVudCArPSBgIHwgdXBkYXRlOiAke3VwZGF0ZVN0YXQudG9GaXhlZCgyKSB9YDtcbiAgICByZW5kZXJlci5xdWV1ZWQgPSBmYWxzZTtcbiAgfSwgMTYpO1xufVxuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGlzcGF0Y2hcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmxldCBkaXNwYXRjaGVzID0ge307XG5cbmV4cG9ydCBmdW5jdGlvbiBoYW5kbGUoZXZlbnQsIGZ1bmMpIHtcbiAgaWYgKGRpc3BhdGNoZXNbZXZlbnRdKSB7XG4gICAgY29uc29sZS5lcnJvcihgT3ZlcndyaXRpbmcgaGFuZGxlciBmb3IgJyR7ZXZlbnR9J2ApO1xuICB9XG4gIGRpc3BhdGNoZXNbZXZlbnRdID0gZnVuYztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRpc3BhdGNoKGV2ZW50OiBzdHJpbmcsIGluZm8/OiB7IFtrZXk6IHN0cmluZ106IGFueSB9LCBkaXNwYXRjaEluZm8/KSB7XG4gIGxldCByZXN1bHQgPSBkaXNwYXRjaEluZm87XG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmVzdWx0ID0gZXZlLmRpZmYoKTtcbiAgICByZXN1bHQubWV0YS5yZW5kZXIgPSB0cnVlO1xuICAgIHJlc3VsdC5tZXRhLnN0b3JlID0gdHJ1ZTtcbiAgfVxuICByZXN1bHQuZGlzcGF0Y2ggPSAoZXZlbnQsIGluZm8pID0+IHtcbiAgICByZXR1cm4gZGlzcGF0Y2goZXZlbnQsIGluZm8sIHJlc3VsdCk7XG4gIH07XG4gIHJlc3VsdC5jb21taXQgPSAoKSA9PiB7XG4gICAgdmFyIHN0YXJ0ID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgZXZlLmFwcGx5RGlmZihyZXN1bHQpO1xuICAgIGlmIChyZXN1bHQubWV0YS5yZW5kZXIpIHtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgICBpZiAocmVzdWx0Lm1ldGEuc3RvcmUpIHtcbiAgICAgIGxldCBzZXJpYWxpemVkID0gZXZlLnNlcmlhbGl6ZSh0cnVlKTtcbiAgICAgIGlmIChldmVMb2NhbFN0b3JhZ2VLZXkgPT09IFwiZXZlXCIpIHtcbiAgICAgICAgZm9yIChsZXQgc3luY2VkIG9mIHN5bmNlZFRhYmxlcykge1xuICAgICAgICAgIGRlbGV0ZSBzZXJpYWxpemVkW3N5bmNlZF07XG4gICAgICAgIH1cbiAgICAgICAgc2VuZENoYW5nZVNldChyZXN1bHQpO1xuICAgICAgfVxuICAgICAgbG9jYWxTdG9yYWdlW2V2ZUxvY2FsU3RvcmFnZUtleV0gPSBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVkKTtcbiAgICB9XG4gICAgdXBkYXRlU3RhdCA9IHBlcmZvcm1hbmNlLm5vdygpIC0gc3RhcnQ7XG4gIH1cbiAgbGV0IGZ1bmMgPSBkaXNwYXRjaGVzW2V2ZW50XTtcbiAgaWYgKCFmdW5jKSB7XG4gICAgY29uc29sZS5lcnJvcihgTm8gZGlzcGF0Y2hlcyBmb3IgJyR7ZXZlbnR9JyB3aXRoICR7SlNPTi5zdHJpbmdpZnkoaW5mbykgfWApO1xuICB9IGVsc2Uge1xuICAgIGZ1bmMocmVzdWx0LCBpbmZvKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdGF0ZVxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHZhciBldmUgPSBydW50aW1lLmluZGV4ZXIoKTtcbmV4cG9ydCB2YXIgaW5pdGlhbGl6ZXJzID0ge307XG5leHBvcnQgdmFyIGFjdGl2ZVNlYXJjaGVzID0ge307XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0KG5hbWUsIGZ1bmMpIHtcbiAgaW5pdGlhbGl6ZXJzW25hbWVdID0gZnVuYztcbn1cblxuZnVuY3Rpb24gZXhlY3V0ZUluaXRpYWxpemVycygpIHtcbiAgZm9yIChsZXQgaW5pdE5hbWUgaW4gaW5pdGlhbGl6ZXJzKSB7XG4gICAgaW5pdGlhbGl6ZXJzW2luaXROYW1lXSgpO1xuICB9XG59XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBXZWJzb2NrZXRcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnZhciBtZSA9IGxvY2FsU3RvcmFnZVtcIm1lXCJdIHx8IHV1aWQoKTtcbmxvY2FsU3RvcmFnZVtcIm1lXCJdID0gbWU7XG5cbmV4cG9ydCB2YXIgc29ja2V0O1xuZnVuY3Rpb24gY29ubmVjdFRvU2VydmVyKCkge1xuICBzb2NrZXQgPSBuZXcgV2ViU29ja2V0KGB3czovLyR7d2luZG93LmxvY2F0aW9uLmhvc3RuYW1lIHx8IFwibG9jYWxob3N0XCJ9OjgwODBgKTtcbiAgc29ja2V0Lm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBjb25uZWN0IHRvIHNlcnZlciwgZmFsbGluZyBiYWNrIHRvIGxvY2FsIHN0b3JhZ2VcIik7XG4gICAgZXZlTG9jYWxTdG9yYWdlS2V5ID0gXCJsb2NhbC1ldmVcIjtcbiAgICBleGVjdXRlSW5pdGlhbGl6ZXJzKCk7XG4gICAgcmVuZGVyKCk7XG4gIH1cbiAgc29ja2V0Lm9ub3BlbiA9ICgpID0+IHtcbiAgICBzZW5kU2VydmVyKFwiY29ubmVjdFwiLCBtZSk7XG4gIH1cbiAgc29ja2V0Lm9ubWVzc2FnZSA9IChkYXRhKSA9PiB7XG4gICAgbGV0IHBhcnNlZCA9IEpTT04ucGFyc2UoZGF0YS5kYXRhKTtcbiAgICBjb25zb2xlLmxvZyhcIldTIE1FU1NBR0U6XCIsIHBhcnNlZCk7XG5cbiAgICBpZiAocGFyc2VkLmtpbmQgPT09IFwibG9hZFwiKSB7XG4gICAgICBldmUubG9hZChwYXJzZWQuZGF0YSk7XG4gICAgICBleGVjdXRlSW5pdGlhbGl6ZXJzKCk7XG4gICAgICByZW5kZXIoKTtcbiAgICB9IGVsc2UgaWYgKHBhcnNlZC5raW5kID09PSBcImNoYW5nZXNldFwiKSB7XG4gICAgICBsZXQgZGlmZiA9IGV2ZS5kaWZmKCk7XG4gICAgICBkaWZmLnRhYmxlcyA9IHBhcnNlZC5kYXRhO1xuICAgICAgZXZlLmFwcGx5RGlmZihkaWZmKTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgfTtcbn1cblxuZnVuY3Rpb24gc2VuZFNlcnZlcihtZXNzYWdlS2luZCwgZGF0YSkge1xuICBpZiAoIXNvY2tldCkgcmV0dXJuO1xuICBzb2NrZXQuc2VuZChKU09OLnN0cmluZ2lmeSh7IGtpbmQ6IG1lc3NhZ2VLaW5kLCBtZSwgdGltZTogKG5ldyBEYXRlKS5nZXRUaW1lKCksIGRhdGEgfSkpO1xufVxuXG5mdW5jdGlvbiBzZW5kQ2hhbmdlU2V0KGNoYW5nZXNldCkge1xuICBpZiAoIXNvY2tldCkgcmV0dXJuO1xuICBsZXQgY2hhbmdlcyA9IHt9O1xuICBsZXQgc2VuZCA9IGZhbHNlO1xuICBmb3IgKGxldCB0YWJsZSBvZiBzeW5jZWRUYWJsZXMpIHtcbiAgICBpZiAoY2hhbmdlc2V0LnRhYmxlc1t0YWJsZV0pIHtcbiAgICAgIHNlbmQgPSB0cnVlO1xuICAgICAgY2hhbmdlc1t0YWJsZV0gPSBjaGFuZ2VzZXQudGFibGVzW3RhYmxlXTtcbiAgICB9XG4gIH1cbiAgaWYgKHNlbmQpIHNlbmRTZXJ2ZXIoXCJjaGFuZ2VzZXRcIiwgY2hhbmdlcyk7XG59XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHb1xuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIiwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgaW5pdFJlbmRlcmVyKCk7XG4gIGNvbm5lY3RUb1NlcnZlcigpO1xuICByZW5kZXIoKTtcbn0pO1xuIiwiZGVjbGFyZSB2YXIgVmVsb2NpdHk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGFuZGxlcjxUIGV4dGVuZHMgRXZlbnQ+IHtcbiAgKGV2dDpULCBlbGVtOkVsZW1lbnQpOiB2b2lkXG59XG5leHBvcnQgaW50ZXJmYWNlIFJlbmRlckhhbmRsZXIge1xuICAobm9kZTpIVE1MRWxlbWVudCwgZWxlbTpFbGVtZW50KTogdm9pZFxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEVsZW1lbnQge1xuICB0PzpzdHJpbmdcbiAgYz86c3RyaW5nXG4gIGlkPzpzdHJpbmdcbiAgcGFyZW50PzpzdHJpbmdcbiAgY2hpbGRyZW4/OkVsZW1lbnRbXVxuICBpeD86bnVtYmVyXG4gIGtleT86c3RyaW5nXG4gIGRpcnR5Pzpib29sZWFuXG4gIHNlbWFudGljPzpzdHJpbmdcbiAgdHdlZW4/OiBhbnlcbiAgZW50ZXI/OiBhbnlcbiAgbGVhdmU/OiBhbnlcbiAgZGVidWc/OmFueVxuXG4gIC8vIENvbnRlbnRcbiAgY29udGVudEVkaXRhYmxlPzpib29sZWFuXG4gIGNoZWNrZWQ/OmJvb2xlYW5cbiAgZHJhZ2dhYmxlPzpib29sZWFuXG4gIGhyZWY/OnN0cmluZ1xuICBwbGFjZWhvbGRlcj86c3RyaW5nXG4gIHNlbGVjdGVkPzpib29sZWFuXG4gIHRhYmluZGV4PzpudW1iZXJcbiAgdGV4dD86c3RyaW5nXG4gIHN0cmljdFRleHQ/OiBib29sZWFuXG4gIHR5cGU/OnN0cmluZ1xuICB2YWx1ZT86c3RyaW5nXG5cbiAgc3R5bGU/OiBzdHJpbmcsXG5cbiAgLy8gU3R5bGVzIChTdHJ1Y3R1cmUpXG4gIGZsZXg/Om51bWJlcnxzdHJpbmdcbiAgbGVmdD86bnVtYmVyfHN0cmluZ1xuICB0b3A/Om51bWJlcnxzdHJpbmdcbiAgd2lkdGg/Om51bWJlcnxzdHJpbmdcbiAgaGVpZ2h0PzpudW1iZXJ8c3RyaW5nXG4gIHRleHRBbGlnbj86c3RyaW5nXG4gIHRyYW5zZm9ybT86c3RyaW5nXG4gIHZlcnRpY2FsQWxpZ24/OnN0cmluZ1xuICB6SW5kZXg/Om51bWJlclxuXG4gIC8vIFN0eWxlcyAoQWVzdGhldGljKVxuICBiYWNrZ3JvdW5kQ29sb3I/OnN0cmluZ1xuICBiYWNrZ3JvdW5kSW1hZ2U/OnN0cmluZ1xuICBib3JkZXI/OnN0cmluZ1xuICBib3JkZXJDb2xvcj86c3RyaW5nXG4gIGJvcmRlcldpZHRoPzpudW1iZXJ8c3RyaW5nXG4gIGJvcmRlclJhZGl1cz86bnVtYmVyfHN0cmluZ1xuICBjb2xvcj86c3RyaW5nXG4gIGNvbHNwYW4/Om51bWJlclxuICBmb250RmFtaWx5PzpzdHJpbmdcbiAgZm9udFNpemU/OnN0cmluZ1xuICBvcGFjaXR5PzpudW1iZXJcblxuICAvLyBTdmdcbiAgc3ZnPzpib29sZWFuXG4gIHg/Om51bWJlcnxzdHJpbmdcbiAgeT86bnVtYmVyfHN0cmluZ1xuICBkeD86bnVtYmVyfHN0cmluZ1xuICBkeT86bnVtYmVyfHN0cmluZ1xuICBjeD86bnVtYmVyfHN0cmluZ1xuICBjeT86bnVtYmVyfHN0cmluZ1xuICByPzpudW1iZXJ8c3RyaW5nXG4gIGQ/Om51bWJlcnxzdHJpbmdcbiAgZmlsbD86c3RyaW5nXG4gIHN0cm9rZT86c3RyaW5nXG4gIHN0cm9rZVdpZHRoPzpzdHJpbmdcbiAgc3RhcnRPZmZzZXQ/Om51bWJlcnxzdHJpbmdcbiAgdGV4dEFuY2hvcj86c3RyaW5nXG4gIHZpZXdCb3g/OnN0cmluZ1xuICB4bGlua2hyZWY/OnN0cmluZ1xuXG4gIC8vIEV2ZW50c1xuICBkYmxjbGljaz86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBjbGljaz86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBjb250ZXh0bWVudT86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBtb3VzZWRvd24/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgbW91c2Vtb3ZlPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIG1vdXNldXA/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgbW91c2VvdmVyPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIG1vdXNlb3V0PzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIG1vdXNlbGVhdmU/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgbW91c2V3aGVlbD86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBkcmFnb3Zlcj86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBkcmFnc3RhcnQ/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgZHJhZ2VuZD86SGFuZGxlcjxNb3VzZUV2ZW50PlxuICBkcmFnPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIGRyb3A/OkhhbmRsZXI8TW91c2VFdmVudD5cbiAgc2Nyb2xsPzpIYW5kbGVyPE1vdXNlRXZlbnQ+XG4gIGZvY3VzPzpIYW5kbGVyPEZvY3VzRXZlbnQ+XG4gIGJsdXI/OkhhbmRsZXI8Rm9jdXNFdmVudD5cbiAgaW5wdXQ/OkhhbmRsZXI8RXZlbnQ+XG4gIGNoYW5nZT86SGFuZGxlcjxFdmVudD5cbiAga2V5dXA/OkhhbmRsZXI8S2V5Ym9hcmRFdmVudD5cbiAga2V5ZG93bj86SGFuZGxlcjxLZXlib2FyZEV2ZW50PlxuXG4gIHBvc3RSZW5kZXI/OlJlbmRlckhhbmRsZXJcblxuICBbYXR0cjpzdHJpbmddOiBhbnlcbn1cblxuZnVuY3Rpb24gbm93KCkge1xuICBpZih3aW5kb3cucGVyZm9ybWFuY2UpIHtcbiAgICByZXR1cm4gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpO1xuICB9XG4gIHJldHVybiAobmV3IERhdGUoKSkuZ2V0VGltZSgpO1xufVxuXG5mdW5jdGlvbiBzaGFsbG93RXF1YWxzKGEsIGIpIHtcbiAgaWYoYSA9PT0gYikgcmV0dXJuIHRydWU7XG4gIGlmKCFhIHx8ICFiKSByZXR1cm4gZmFsc2U7XG4gIGZvcih2YXIgayBpbiBhKSB7XG4gICAgaWYoYVtrXSAhPT0gYltrXSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGZvcih2YXIgayBpbiBiKSB7XG4gICAgaWYoYltrXSAhPT0gYVtrXSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG5mdW5jdGlvbiBwb3N0QW5pbWF0aW9uUmVtb3ZlKGVsZW1lbnRzKSB7XG4gIGZvcihsZXQgZWxlbSBvZiBlbGVtZW50cykge1xuICAgIGlmKGVsZW0ucGFyZW50Tm9kZSkgZWxlbS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsZW0pO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBSZW5kZXJlciB7XG4gIGNvbnRlbnQ6IEhUTUxFbGVtZW50O1xuICBlbGVtZW50Q2FjaGU6IHtbaWQ6c3RyaW5nXTogSFRNTEVsZW1lbnR9O1xuICBwcmV2VHJlZTp7W2lkOnN0cmluZ106IEVsZW1lbnR9O1xuICB0cmVlOntbaWQ6c3RyaW5nXTogRWxlbWVudH07XG4gIHBvc3RSZW5kZXJzOiBFbGVtZW50W107XG4gIGxhc3REaWZmOiB7YWRkczogc3RyaW5nW10sIHVwZGF0ZXM6IHt9fTtcbiAgcXVldWVkOiBib29sZWFuO1xuICBoYW5kbGVFdmVudDogKGFueSk7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuY29udGVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGhpcy5jb250ZW50LmNsYXNzTmFtZSA9IFwiX19yb290XCI7XG4gICAgdGhpcy5lbGVtZW50Q2FjaGUgPSB7IFwiX19yb290XCI6IHRoaXMuY29udGVudCB9O1xuICAgIHRoaXMucHJldlRyZWUgPSB7fTtcbiAgICB0aGlzLnRyZWUgPSB7fTtcbiAgICB0aGlzLnBvc3RSZW5kZXJzID0gW107XG4gICAgdGhpcy5sYXN0RGlmZiA9IHthZGRzOiBbXSwgdXBkYXRlczoge319O1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLmhhbmRsZUV2ZW50ID0gZnVuY3Rpb24gaGFuZGxlRXZlbnQoZTogRXZlbnQpIHtcbiAgICAgIHZhciBpZCA9IChlLmN1cnJlbnRUYXJnZXQgfHwgZS50YXJnZXQpW1wiX2lkXCJdO1xuICAgICAgdmFyIGVsZW0gPSBzZWxmLnRyZWVbaWRdO1xuICAgICAgaWYgKCFlbGVtKSByZXR1cm47XG4gICAgICB2YXIgaGFuZGxlciA9IGVsZW1bZS50eXBlXTtcbiAgICAgIGlmIChoYW5kbGVyKSB7IGhhbmRsZXIoZSwgZWxlbSk7IH1cbiAgICB9O1xuICB9XG4gIHJlc2V0KCkge1xuICAgIHRoaXMucHJldlRyZWUgPSB0aGlzLnRyZWU7XG4gICAgdGhpcy50cmVlID0ge307XG4gICAgdGhpcy5wb3N0UmVuZGVycyA9IFtdO1xuICB9XG5cbiAgZG9taWZ5KCkge1xuICAgIHZhciBmYWtlUHJldjpFbGVtZW50ID0ge307IC8vY3JlYXRlIGFuIGVtcHR5IG9iamVjdCBvbmNlIGluc3RlYWQgb2YgZXZlcnkgaW5zdGFuY2Ugb2YgdGhlIGxvb3BcbiAgICB2YXIgZWxlbWVudHMgPSB0aGlzLnRyZWU7XG4gICAgdmFyIHByZXZFbGVtZW50cyA9IHRoaXMucHJldlRyZWU7XG4gICAgdmFyIGRpZmYgPSB0aGlzLmxhc3REaWZmO1xuICAgIHZhciBhZGRzID0gZGlmZi5hZGRzO1xuICAgIHZhciB1cGRhdGVzID0gZGlmZi51cGRhdGVzO1xuICAgIHZhciBlbGVtS2V5cyA9IE9iamVjdC5rZXlzKHVwZGF0ZXMpO1xuICAgIHZhciBlbGVtZW50Q2FjaGUgPSB0aGlzLmVsZW1lbnRDYWNoZTtcbiAgICB2YXIgdGVtcFR3ZWVuOmFueSA9IHt9O1xuXG4gICAgLy9DcmVhdGUgYWxsIHRoZSBuZXcgZWxlbWVudHMgdG8gZW5zdXJlIHRoYXQgdGhleSdyZSB0aGVyZSB3aGVuIHRoZXkgbmVlZCB0byBiZVxuICAgIC8vcGFyZW50ZWRcbiAgICBmb3IodmFyIGkgPSAwLCBsZW4gPSBhZGRzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB2YXIgaWQgPSBhZGRzW2ldO1xuICAgICAgdmFyIGN1ciA9IGVsZW1lbnRzW2lkXTtcbiAgICAgIHZhciBkaXY6IGFueTtcbiAgICAgIGlmIChjdXIuc3ZnKSB7XG4gICAgICAgIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsIGN1ci50IHx8IFwicmVjdFwiKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoY3VyLnQgfHwgXCJkaXZcIik7XG4gICAgICB9XG4gICAgICBkaXYuX2lkID0gaWQ7XG4gICAgICBlbGVtZW50Q2FjaGVbaWRdID0gZGl2O1xuICAgICAgaWYoY3VyLmVudGVyKSB7XG4gICAgICAgIGlmKGN1ci5lbnRlci5kZWxheSkge1xuICAgICAgICAgIGN1ci5lbnRlci5kaXNwbGF5ID0gXCJhdXRvXCI7XG4gICAgICAgICAgZGl2LnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgfVxuXG4gICAgICAgIFZlbG9jaXR5KGRpdiwgY3VyLmVudGVyLCBjdXIuZW50ZXIpO1xuXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yKHZhciBpID0gMCwgbGVuID0gZWxlbUtleXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHZhciBpZCA9IGVsZW1LZXlzW2ldO1xuICAgICAgdmFyIGN1ciA9IGVsZW1lbnRzW2lkXTtcbiAgICAgIHZhciBwcmV2ID0gcHJldkVsZW1lbnRzW2lkXSB8fCBmYWtlUHJldjtcbiAgICAgIHZhciB0eXBlID0gdXBkYXRlc1tpZF07XG4gICAgICB2YXIgZGl2O1xuICAgICAgaWYodHlwZSA9PT0gXCJyZXBsYWNlZFwiKSB7XG4gICAgICAgIHZhciBtZSA9IGVsZW1lbnRDYWNoZVtpZF07XG4gICAgICAgIGlmIChtZS5wYXJlbnROb2RlKSBtZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG1lKTtcbiAgICAgICAgaWYgKGN1ci5zdmcpIHtcbiAgICAgICAgICBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBjdXIudCB8fCBcInJlY3RcIik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChjdXIudCB8fCBcImRpdlwiKTtcbiAgICAgICAgfVxuICAgICAgICBkaXYuX2lkID0gaWQ7XG4gICAgICAgIGVsZW1lbnRDYWNoZVtpZF0gPSBkaXY7XG4gICAgICB9IGVsc2UgaWYgKHR5cGUgPT09IFwicmVtb3ZlZFwiKSB7XG4gICAgICAgIC8vTk9URTogQmF0Y2hpbmcgdGhlIHJlbW92ZXMgc3VjaCB0aGF0IHlvdSBvbmx5IHJlbW92ZSB0aGUgcGFyZW50XG4gICAgICAgIC8vZGlkbid0IGFjdHVhbGx5IG1ha2UgdGhpcyBmYXN0ZXIgc3VycHJpc2luZ2x5LiBHaXZlbiB0aGF0IHRoaXNcbiAgICAgICAgLy9zdHJhdGVneSBpcyBtdWNoIHNpbXBsZXIgYW5kIHRoZXJlJ3Mgbm8gbm90aWNhYmxlIHBlcmYgZGlmZmVyZW5jZVxuICAgICAgICAvL3dlJ2xsIGp1c3QgZG8gdGhlIGR1bWIgdGhpbmcgYW5kIHJlbW92ZSBhbGwgdGhlIGNoaWxkcmVuIG9uZSBieSBvbmUuXG4gICAgICAgIHZhciBtZSA9IGVsZW1lbnRDYWNoZVtpZF1cbiAgICAgICAgaWYocHJldi5sZWF2ZSkge1xuICAgICAgICAgIHByZXYubGVhdmUuY29tcGxldGUgPSBwb3N0QW5pbWF0aW9uUmVtb3ZlO1xuICAgICAgICAgIGlmKHByZXYubGVhdmUuYWJzb2x1dGUpIHtcbiAgICAgICAgICAgIG1lLnN0eWxlLnBvc2l0aW9uID0gXCJhYnNvbHV0ZVwiO1xuICAgICAgICAgIH1cbiAgICAgICAgICBWZWxvY2l0eShtZSwgcHJldi5sZWF2ZSwgcHJldi5sZWF2ZSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZihtZS5wYXJlbnROb2RlKSBtZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG1lKTtcbiAgICAgICAgZWxlbWVudENhY2hlW2lkXSA9IG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGl2ID0gZWxlbWVudENhY2hlW2lkXTtcbiAgICAgIH1cblxuICAgICAgdmFyIHN0eWxlID0gZGl2LnN0eWxlO1xuICAgICAgaWYoY3VyLmMgIT09IHByZXYuYykgZGl2LmNsYXNzTmFtZSA9IGN1ci5jO1xuICAgICAgaWYoY3VyLmRyYWdnYWJsZSAhPT0gcHJldi5kcmFnZ2FibGUpIGRpdi5kcmFnZ2FibGUgPSBjdXIuZHJhZ2dhYmxlID09PSB1bmRlZmluZWQgPyBudWxsIDogXCJ0cnVlXCI7XG4gICAgICBpZihjdXIuY29udGVudEVkaXRhYmxlICE9PSBwcmV2LmNvbnRlbnRFZGl0YWJsZSkgZGl2LmNvbnRlbnRFZGl0YWJsZSA9IGN1ci5jb250ZW50RWRpdGFibGUgfHwgXCJpbmhlcml0XCI7XG4gICAgICBpZihjdXIuY29sc3BhbiAhPT0gcHJldi5jb2xzcGFuKSBkaXYuY29sU3BhbiA9IGN1ci5jb2xzcGFuO1xuICAgICAgaWYoY3VyLnBsYWNlaG9sZGVyICE9PSBwcmV2LnBsYWNlaG9sZGVyKSBkaXYucGxhY2Vob2xkZXIgPSBjdXIucGxhY2Vob2xkZXI7XG4gICAgICBpZihjdXIuc2VsZWN0ZWQgIT09IHByZXYuc2VsZWN0ZWQpIGRpdi5zZWxlY3RlZCA9IGN1ci5zZWxlY3RlZDtcbiAgICAgIGlmKGN1ci52YWx1ZSAhPT0gcHJldi52YWx1ZSkgZGl2LnZhbHVlID0gY3VyLnZhbHVlO1xuICAgICAgaWYoY3VyLnQgPT09IFwiaW5wdXRcIiAmJiBjdXIudHlwZSAhPT0gcHJldi50eXBlKSBkaXYudHlwZSA9IGN1ci50eXBlO1xuICAgICAgaWYoY3VyLnQgPT09IFwiaW5wdXRcIiAmJiBjdXIuY2hlY2tlZCAhPT0gcHJldi5jaGVja2VkKSBkaXYuY2hlY2tlZCA9IGN1ci5jaGVja2VkO1xuICAgICAgaWYoKGN1ci50ZXh0ICE9PSBwcmV2LnRleHQgfHwgY3VyLnN0cmljdFRleHQpICYmIGRpdi50ZXh0Q29udGVudCAhPT0gY3VyLnRleHQpIGRpdi50ZXh0Q29udGVudCA9IGN1ci50ZXh0ID09PSB1bmRlZmluZWQgPyBcIlwiIDogY3VyLnRleHQ7XG4gICAgICBpZihjdXIudGFiaW5kZXggIT09IHByZXYudGFiaW5kZXgpIGRpdi5zZXRBdHRyaWJ1dGUoXCJ0YWJpbmRleFwiLCBjdXIudGFiaW5kZXgpO1xuICAgICAgaWYoY3VyLmhyZWYgIT09IHByZXYuaHJlZikgZGl2LnNldEF0dHJpYnV0ZShcImhyZWZcIiwgY3VyLmhyZWYpO1xuXG4gICAgICAvLyBhbmltYXRlYWJsZSBwcm9wZXJ0aWVzXG4gICAgICB2YXIgdHdlZW4gPSBjdXIudHdlZW4gfHwgdGVtcFR3ZWVuO1xuICAgICAgaWYoY3VyLmZsZXggIT09IHByZXYuZmxleCkge1xuICAgICAgICBpZih0d2Vlbi5mbGV4KSB0ZW1wVHdlZW4uZmxleCA9IGN1ci5mbGV4O1xuICAgICAgICBlbHNlIHN0eWxlLmZsZXggPSBjdXIuZmxleCA9PT0gdW5kZWZpbmVkID8gXCJcIiA6IGN1ci5mbGV4O1xuICAgICAgfVxuICAgICAgaWYoY3VyLmxlZnQgIT09IHByZXYubGVmdCkge1xuICAgICAgICAgIGlmKHR3ZWVuLmxlZnQpIHRlbXBUd2Vlbi5sZWZ0ID0gY3VyLmxlZnQ7XG4gICAgICAgICAgZWxzZSBzdHlsZS5sZWZ0ID0gY3VyLmxlZnQgPT09IHVuZGVmaW5lZCA/IFwiXCIgOiBjdXIubGVmdDtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci50b3AgIT09IHByZXYudG9wKSB7XG4gICAgICAgIGlmKHR3ZWVuLnRvcCkgdGVtcFR3ZWVuLnRvcCA9IGN1ci50b3A7XG4gICAgICAgIGVsc2Ugc3R5bGUudG9wID0gY3VyLnRvcCA9PT0gdW5kZWZpbmVkID8gXCJcIiA6IGN1ci50b3A7XG4gICAgICB9XG4gICAgICBpZihjdXIuaGVpZ2h0ICE9PSBwcmV2LmhlaWdodCkge1xuICAgICAgICBpZih0d2Vlbi5oZWlnaHQpIHRlbXBUd2Vlbi5oZWlnaHQgPSBjdXIuaGVpZ2h0O1xuICAgICAgICBlbHNlIHN0eWxlLmhlaWdodCA9IGN1ci5oZWlnaHQgPT09IHVuZGVmaW5lZCA/IFwiYXV0b1wiIDogY3VyLmhlaWdodDtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci53aWR0aCAhPT0gcHJldi53aWR0aCkge1xuICAgICAgICBpZih0d2Vlbi53aWR0aCkgdGVtcFR3ZWVuLndpZHRoID0gY3VyLndpZHRoO1xuICAgICAgICBlbHNlIHN0eWxlLndpZHRoID0gY3VyLndpZHRoID09PSB1bmRlZmluZWQgPyBcImF1dG9cIiA6IGN1ci53aWR0aDtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci56SW5kZXggIT09IHByZXYuekluZGV4KSB7XG4gICAgICAgIGlmKHR3ZWVuLnpJbmRleCkgdGVtcFR3ZWVuLnpJbmRleCA9IGN1ci56SW5kZXg7XG4gICAgICAgIGVsc2Ugc3R5bGUuekluZGV4ID0gY3VyLnpJbmRleDtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci5iYWNrZ3JvdW5kQ29sb3IgIT09IHByZXYuYmFja2dyb3VuZENvbG9yKSB7XG4gICAgICAgIGlmKHR3ZWVuLmJhY2tncm91bmRDb2xvcikgdGVtcFR3ZWVuLmJhY2tncm91bmRDb2xvciA9IGN1ci5iYWNrZ3JvdW5kQ29sb3I7XG4gICAgICAgIGVsc2Ugc3R5bGUuYmFja2dyb3VuZENvbG9yID0gY3VyLmJhY2tncm91bmRDb2xvciB8fCBcInRyYW5zcGFyZW50XCI7XG4gICAgICB9XG4gICAgICBpZihjdXIuYm9yZGVyQ29sb3IgIT09IHByZXYuYm9yZGVyQ29sb3IpIHtcbiAgICAgICAgaWYodHdlZW4uYm9yZGVyQ29sb3IpIHRlbXBUd2Vlbi5ib3JkZXJDb2xvciA9IGN1ci5ib3JkZXJDb2xvcjtcbiAgICAgICAgZWxzZSBzdHlsZS5ib3JkZXJDb2xvciA9IGN1ci5ib3JkZXJDb2xvciB8fCBcIm5vbmVcIjtcbiAgICAgIH1cbiAgICAgIGlmKGN1ci5ib3JkZXJXaWR0aCAhPT0gcHJldi5ib3JkZXJXaWR0aCkge1xuICAgICAgICBpZih0d2Vlbi5ib3JkZXJXaWR0aCkgdGVtcFR3ZWVuLmJvcmRlcldpZHRoID0gY3VyLmJvcmRlcldpZHRoO1xuICAgICAgICBlbHNlIHN0eWxlLmJvcmRlcldpZHRoID0gY3VyLmJvcmRlcldpZHRoIHx8IDA7XG4gICAgICB9XG4gICAgICBpZihjdXIuYm9yZGVyUmFkaXVzICE9PSBwcmV2LmJvcmRlclJhZGl1cykge1xuICAgICAgICBpZih0d2Vlbi5ib3JkZXJSYWRpdXMpIHRlbXBUd2Vlbi5ib3JkZXJSYWRpdXMgPSBjdXIuYm9yZGVyUmFkaXVzO1xuICAgICAgICBlbHNlIHN0eWxlLmJvcmRlclJhZGl1cyA9IChjdXIuYm9yZGVyUmFkaXVzIHx8IDApICsgXCJweFwiO1xuICAgICAgfVxuICAgICAgaWYoY3VyLm9wYWNpdHkgIT09IHByZXYub3BhY2l0eSkge1xuICAgICAgICBpZih0d2Vlbi5vcGFjaXR5KSB0ZW1wVHdlZW4ub3BhY2l0eSA9IGN1ci5vcGFjaXR5O1xuICAgICAgICBlbHNlIHN0eWxlLm9wYWNpdHkgPSBjdXIub3BhY2l0eSA9PT0gdW5kZWZpbmVkID8gMSA6IGN1ci5vcGFjaXR5O1xuICAgICAgfVxuICAgICAgaWYoY3VyLmZvbnRTaXplICE9PSBwcmV2LmZvbnRTaXplKSB7XG4gICAgICAgIGlmKHR3ZWVuLmZvbnRTaXplKSB0ZW1wVHdlZW4uZm9udFNpemUgPSBjdXIuZm9udFNpemU7XG4gICAgICAgIGVsc2Ugc3R5bGUuZm9udFNpemUgPSBjdXIuZm9udFNpemU7XG4gICAgICB9XG4gICAgICBpZihjdXIuY29sb3IgIT09IHByZXYuY29sb3IpIHtcbiAgICAgICAgaWYodHdlZW4uY29sb3IpIHRlbXBUd2Vlbi5jb2xvciA9IGN1ci5jb2xvcjtcbiAgICAgICAgZWxzZSBzdHlsZS5jb2xvciA9IGN1ci5jb2xvciB8fCBcImluaGVyaXRcIjtcbiAgICAgIH1cblxuICAgICAgbGV0IGFuaW1LZXlzID0gT2JqZWN0LmtleXModGVtcFR3ZWVuKTtcbiAgICAgIGlmKGFuaW1LZXlzLmxlbmd0aCkge1xuICAgICAgICBWZWxvY2l0eShkaXYsIHRlbXBUd2VlbiwgdHdlZW4pO1xuICAgICAgICB0ZW1wVHdlZW4gPSB7fTtcbiAgICAgIH1cblxuICAgICAgLy8gbm9uLWFuaW1hdGlvbiBzdHlsZSBwcm9wZXJ0aWVzXG4gICAgICBpZihjdXIuYmFja2dyb3VuZEltYWdlICE9PSBwcmV2LmJhY2tncm91bmRJbWFnZSkgc3R5bGUuYmFja2dyb3VuZEltYWdlID0gYHVybCgnJHtjdXIuYmFja2dyb3VuZEltYWdlfScpYDtcbiAgICAgIGlmKGN1ci5ib3JkZXIgIT09IHByZXYuYm9yZGVyKSBzdHlsZS5ib3JkZXIgPSBjdXIuYm9yZGVyIHx8IFwibm9uZVwiO1xuICAgICAgaWYoY3VyLnRleHRBbGlnbiAhPT0gcHJldi50ZXh0QWxpZ24pIHtcbiAgICAgICAgc3R5bGUuYWxpZ25JdGVtcyA9IGN1ci50ZXh0QWxpZ247XG4gICAgICAgIGlmKGN1ci50ZXh0QWxpZ24gPT09IFwiY2VudGVyXCIpIHtcbiAgICAgICAgICBzdHlsZS50ZXh0QWxpZ24gPSBcImNlbnRlclwiO1xuICAgICAgICB9IGVsc2UgaWYoY3VyLnRleHRBbGlnbiA9PT0gXCJmbGV4LWVuZFwiKSB7XG4gICAgICAgICAgc3R5bGUudGV4dEFsaWduID0gXCJyaWdodFwiO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHN0eWxlLnRleHRBbGlnbiA9IFwibGVmdFwiO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZihjdXIudmVydGljYWxBbGlnbiAhPT0gcHJldi52ZXJ0aWNhbEFsaWduKSBzdHlsZS5qdXN0aWZ5Q29udGVudCA9IGN1ci52ZXJ0aWNhbEFsaWduO1xuICAgICAgaWYoY3VyLmZvbnRGYW1pbHkgIT09IHByZXYuZm9udEZhbWlseSkgc3R5bGUuZm9udEZhbWlseSA9IGN1ci5mb250RmFtaWx5IHx8IFwiaW5oZXJpdFwiO1xuICAgICAgaWYoY3VyLnRyYW5zZm9ybSAhPT0gcHJldi50cmFuc2Zvcm0pIHN0eWxlLnRyYW5zZm9ybSA9IGN1ci50cmFuc2Zvcm0gfHwgXCJub25lXCI7XG4gICAgICBpZihjdXIuc3R5bGUgIT09IHByZXYuc3R5bGUpIGRpdi5zZXRBdHRyaWJ1dGUoXCJzdHlsZVwiLCBjdXIuc3R5bGUpO1xuXG4gICAgICAvLyBkZWJ1Zy9wcm9ncmFtbWF0aWMgcHJvcGVydGllc1xuICAgICAgaWYoY3VyLnNlbWFudGljICE9PSBwcmV2LnNlbWFudGljKSBkaXYuc2V0QXR0cmlidXRlKFwiZGF0YS1zZW1hbnRpY1wiLCBjdXIuc2VtYW50aWMpO1xuICAgICAgaWYoY3VyLmRlYnVnICE9PSBwcmV2LmRlYnVnKSBkaXYuc2V0QXR0cmlidXRlKFwiZGF0YS1kZWJ1Z1wiLCBjdXIuZGVidWcpO1xuXG4gICAgICAvLyBTVkcgcHJvcGVydGllc1xuICAgICAgaWYoY3VyLnN2Zykge1xuICAgICAgICBpZihjdXIuZmlsbCAhPT0gcHJldi5maWxsKSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJmaWxsXCIsIGN1ci5maWxsKTtcbiAgICAgICAgaWYoY3VyLnN0cm9rZSAhPT0gcHJldi5zdHJva2UpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInN0cm9rZVwiLCBjdXIuc3Ryb2tlKTtcbiAgICAgICAgaWYoY3VyLnN0cm9rZVdpZHRoICE9PSBwcmV2LnN0cm9rZVdpZHRoKSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJzdHJva2Utd2lkdGhcIiwgY3VyLnN0cm9rZVdpZHRoKTtcbiAgICAgICAgaWYoY3VyLmQgIT09IHByZXYuZCkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiZFwiLCBjdXIuZCk7XG4gICAgICAgIGlmKGN1ci5jICE9PSBwcmV2LmMpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcImNsYXNzXCIsIGN1ci5jKTtcbiAgICAgICAgaWYoY3VyLnggIT09IHByZXYueCkgIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInhcIiwgY3VyLngpO1xuICAgICAgICBpZihjdXIueSAhPT0gcHJldi55KSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ5XCIsIGN1ci55KTtcbiAgICAgICAgaWYoY3VyLmR4ICE9PSBwcmV2LmR4KSAgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiZHhcIiwgY3VyLmR4KTtcbiAgICAgICAgaWYoY3VyLmR5ICE9PSBwcmV2LmR5KSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJkeVwiLCBjdXIuZHkpO1xuICAgICAgICBpZihjdXIuY3ggIT09IHByZXYuY3gpICBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJjeFwiLCBjdXIuY3gpO1xuICAgICAgICBpZihjdXIuY3kgIT09IHByZXYuY3kpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcImN5XCIsIGN1ci5jeSk7XG4gICAgICAgIGlmKGN1ci5yICE9PSBwcmV2LnIpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInJcIiwgY3VyLnIpO1xuICAgICAgICBpZihjdXIuaGVpZ2h0ICE9PSBwcmV2LmhlaWdodCkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiaGVpZ2h0XCIsIGN1ci5oZWlnaHQpO1xuICAgICAgICBpZihjdXIud2lkdGggIT09IHByZXYud2lkdGgpICBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ3aWR0aFwiLCBjdXIud2lkdGgpO1xuICAgICAgICBpZihjdXIueGxpbmtocmVmICE9PSBwcmV2LnhsaW5raHJlZikgIGRpdi5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIFwiaHJlZlwiLCBjdXIueGxpbmtocmVmKTtcbiAgICAgICAgaWYoY3VyLnN0YXJ0T2Zmc2V0ICE9PSBwcmV2LnN0YXJ0T2Zmc2V0KSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJzdGFydE9mZnNldFwiLCBjdXIuc3RhcnRPZmZzZXQpO1xuICAgICAgICBpZihjdXIuaWQgIT09IHByZXYuaWQpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcImlkXCIsIGN1ci5pZCk7XG4gICAgICAgIGlmKGN1ci52aWV3Qm94ICE9PSBwcmV2LnZpZXdCb3gpIGRpdi5zZXRBdHRyaWJ1dGVOUyhudWxsLCBcInZpZXdCb3hcIiwgY3VyLnZpZXdCb3gpO1xuICAgICAgICBpZihjdXIudHJhbnNmb3JtICE9PSBwcmV2LnRyYW5zZm9ybSkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwidHJhbnNmb3JtXCIsIGN1ci50cmFuc2Zvcm0pO1xuICAgICAgICBpZihjdXIuZHJhZ2dhYmxlICE9PSBwcmV2LmRyYWdnYWJsZSkgZGl2LnNldEF0dHJpYnV0ZU5TKG51bGwsIFwiZHJhZ2dhYmxlXCIsIGN1ci5kcmFnZ2FibGUpO1xuICAgICAgICBpZihjdXIudGV4dEFuY2hvciAhPT0gcHJldi50ZXh0QW5jaG9yKSBkaXYuc2V0QXR0cmlidXRlTlMobnVsbCwgXCJ0ZXh0LWFuY2hvclwiLCBjdXIudGV4dEFuY2hvcik7XG4gICAgICB9XG5cbiAgICAgIC8vZXZlbnRzXG4gICAgICBpZihjdXIuZGJsY2xpY2sgIT09IHByZXYuZGJsY2xpY2spIGRpdi5vbmRibGNsaWNrID0gY3VyLmRibGNsaWNrICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmNsaWNrICE9PSBwcmV2LmNsaWNrKSBkaXYub25jbGljayA9IGN1ci5jbGljayAhPT0gdW5kZWZpbmVkID8gdGhpcy5oYW5kbGVFdmVudCA6IHVuZGVmaW5lZDtcbiAgICAgIGlmKGN1ci5jb250ZXh0bWVudSAhPT0gcHJldi5jb250ZXh0bWVudSkgZGl2Lm9uY29udGV4dG1lbnUgPSBjdXIuY29udGV4dG1lbnUgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIubW91c2Vkb3duICE9PSBwcmV2Lm1vdXNlZG93bikgZGl2Lm9ubW91c2Vkb3duID0gY3VyLm1vdXNlZG93biAhPT0gdW5kZWZpbmVkID8gdGhpcy5oYW5kbGVFdmVudCA6IHVuZGVmaW5lZDtcbiAgICAgIGlmKGN1ci5tb3VzZW1vdmUgIT09IHByZXYubW91c2Vtb3ZlKSBkaXYub25tb3VzZW1vdmUgPSBjdXIubW91c2Vtb3ZlICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNldXAgIT09IHByZXYubW91c2V1cCkgZGl2Lm9ubW91c2V1cCA9IGN1ci5tb3VzZXVwICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNlb3ZlciAhPT0gcHJldi5tb3VzZW92ZXIpIGRpdi5vbm1vdXNlb3ZlciA9IGN1ci5tb3VzZW92ZXIgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIubW91c2VvdXQgIT09IHByZXYubW91c2VvdXQpIGRpdi5vbm1vdXNlb3V0ID0gY3VyLm1vdXNlb3V0ICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNlbGVhdmUgIT09IHByZXYubW91c2VsZWF2ZSkgZGl2Lm9ubW91c2VsZWF2ZSA9IGN1ci5tb3VzZWxlYXZlICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLm1vdXNld2hlZWwgIT09IHByZXYubW91c2V3aGVlbCkgZGl2Lm9ubW91c2VoZWVsID0gY3VyLm1vdXNld2hlZWwgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJhZ292ZXIgIT09IHByZXYuZHJhZ292ZXIpIGRpdi5vbmRyYWdvdmVyID0gY3VyLmRyYWdvdmVyICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmRyYWdzdGFydCAhPT0gcHJldi5kcmFnc3RhcnQpIGRpdi5vbmRyYWdzdGFydCA9IGN1ci5kcmFnc3RhcnQgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJhZ2VuZCAhPT0gcHJldi5kcmFnZW5kKSBkaXYub25kcmFnZW5kID0gY3VyLmRyYWdlbmQgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJhZyAhPT0gcHJldi5kcmFnKSBkaXYub25kcmFnID0gY3VyLmRyYWcgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuZHJvcCAhPT0gcHJldi5kcm9wKSBkaXYub25kcm9wID0gY3VyLmRyb3AgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuc2Nyb2xsICE9PSBwcmV2LnNjcm9sbCkgZGl2Lm9uc2Nyb2xsID0gY3VyLnNjcm9sbCAhPT0gdW5kZWZpbmVkID8gdGhpcy5oYW5kbGVFdmVudCA6IHVuZGVmaW5lZDtcbiAgICAgIGlmKGN1ci5mb2N1cyAhPT0gcHJldi5mb2N1cykgZGl2Lm9uZm9jdXMgPSBjdXIuZm9jdXMgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuYmx1ciAhPT0gcHJldi5ibHVyKSBkaXYub25ibHVyID0gY3VyLmJsdXIgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIuaW5wdXQgIT09IHByZXYuaW5wdXQpIGRpdi5vbmlucHV0ID0gY3VyLmlucHV0ICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmNoYW5nZSAhPT0gcHJldi5jaGFuZ2UpIGRpdi5vbmNoYW5nZSA9IGN1ci5jaGFuZ2UgIT09IHVuZGVmaW5lZCA/IHRoaXMuaGFuZGxlRXZlbnQgOiB1bmRlZmluZWQ7XG4gICAgICBpZihjdXIua2V5dXAgIT09IHByZXYua2V5dXApIGRpdi5vbmtleXVwID0gY3VyLmtleXVwICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuICAgICAgaWYoY3VyLmtleWRvd24gIT09IHByZXYua2V5ZG93bikgZGl2Lm9ua2V5ZG93biA9IGN1ci5rZXlkb3duICE9PSB1bmRlZmluZWQgPyB0aGlzLmhhbmRsZUV2ZW50IDogdW5kZWZpbmVkO1xuXG4gICAgICBpZih0eXBlID09PSBcImFkZGVkXCIgfHwgdHlwZSA9PT0gXCJyZXBsYWNlZFwiIHx8IHR5cGUgPT09IFwibW92ZWRcIikge1xuICAgICAgICB2YXIgcGFyZW50RWwgPSBlbGVtZW50Q2FjaGVbY3VyLnBhcmVudF07XG4gICAgICAgIGlmKHBhcmVudEVsKSB7XG4gICAgICAgICAgaWYoY3VyLml4ID49IHBhcmVudEVsLmNoaWxkcmVuLmxlbmd0aCkge1xuICAgICAgICAgICAgcGFyZW50RWwuYXBwZW5kQ2hpbGQoZGl2KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFyZW50RWwuaW5zZXJ0QmVmb3JlKGRpdiwgcGFyZW50RWwuY2hpbGRyZW5bY3VyLml4XSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZGlmZigpIHtcbiAgICB2YXIgYSA9IHRoaXMucHJldlRyZWU7XG4gICAgdmFyIGIgPSB0aGlzLnRyZWU7XG4gICAgdmFyIGFzID0gT2JqZWN0LmtleXMoYSk7XG4gICAgdmFyIGJzID0gT2JqZWN0LmtleXMoYik7XG4gICAgdmFyIHVwZGF0ZWQgPSB7fTtcbiAgICB2YXIgYWRkcyA9IFtdO1xuICAgIGZvcih2YXIgaSA9IDAsIGxlbiA9IGFzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB2YXIgaWQgPSBhc1tpXTtcbiAgICAgIHZhciBjdXJBID0gYVtpZF07XG4gICAgICB2YXIgY3VyQiA9IGJbaWRdO1xuICAgICAgaWYoY3VyQiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHVwZGF0ZWRbaWRdID0gXCJyZW1vdmVkXCI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYoY3VyQS50ICE9PSBjdXJCLnQpIHtcbiAgICAgICAgdXBkYXRlZFtpZF0gPSBcInJlcGxhY2VkXCI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYoY3VyQS5peCAhPT0gY3VyQi5peCB8fCBjdXJBLnBhcmVudCAhPT0gY3VyQi5wYXJlbnQpIHtcbiAgICAgICAgdXBkYXRlZFtpZF0gPSBcIm1vdmVkXCI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZighY3VyQi5kaXJ0eVxuICAgICAgICAgICYmIGN1ckEuYyA9PT0gY3VyQi5jXG4gICAgICAgICAgJiYgY3VyQS5rZXkgPT09IGN1ckIua2V5XG4gICAgICAgICAgJiYgY3VyQS50YWJpbmRleCA9PT0gY3VyQi50YWJpbmRleFxuICAgICAgICAgICYmIGN1ckEuaHJlZiA9PT0gY3VyQi5ocmVmXG4gICAgICAgICAgJiYgY3VyQS5wbGFjZWhvbGRlciA9PT0gY3VyQi5wbGFjZWhvbGRlclxuICAgICAgICAgICYmIGN1ckEuc2VsZWN0ZWQgPT09IGN1ckIuc2VsZWN0ZWRcbiAgICAgICAgICAmJiBjdXJBLmRyYWdnYWJsZSA9PT0gY3VyQi5kcmFnZ2FibGVcbiAgICAgICAgICAmJiBjdXJBLmNvbnRlbnRFZGl0YWJsZSA9PT0gY3VyQi5jb250ZW50RWRpdGFibGVcbiAgICAgICAgICAmJiBjdXJBLnZhbHVlID09PSBjdXJCLnZhbHVlXG4gICAgICAgICAgJiYgY3VyQS50eXBlID09PSBjdXJCLnR5cGVcbiAgICAgICAgICAmJiBjdXJBLmNoZWNrZWQgPT09IGN1ckIuY2hlY2tlZFxuICAgICAgICAgICYmIGN1ckEudGV4dCA9PT0gY3VyQi50ZXh0XG4gICAgICAgICAgJiYgY3VyQS50b3AgPT09IGN1ckIudG9wXG4gICAgICAgICAgJiYgY3VyQS5mbGV4ID09PSBjdXJCLmZsZXhcbiAgICAgICAgICAmJiBjdXJBLmxlZnQgPT09IGN1ckIubGVmdFxuICAgICAgICAgICYmIGN1ckEud2lkdGggPT09IGN1ckIud2lkdGhcbiAgICAgICAgICAmJiBjdXJBLmhlaWdodCA9PT0gY3VyQi5oZWlnaHRcbiAgICAgICAgICAmJiBjdXJBLnpJbmRleCA9PT0gY3VyQi56SW5kZXhcbiAgICAgICAgICAmJiBjdXJBLmJhY2tncm91bmRDb2xvciA9PT0gY3VyQi5iYWNrZ3JvdW5kQ29sb3JcbiAgICAgICAgICAmJiBjdXJBLmJhY2tncm91bmRJbWFnZSA9PT0gY3VyQi5iYWNrZ3JvdW5kSW1hZ2VcbiAgICAgICAgICAmJiBjdXJBLmNvbG9yID09PSBjdXJCLmNvbG9yXG4gICAgICAgICAgJiYgY3VyQS5jb2xzcGFuID09PSBjdXJCLmNvbHNwYW5cbiAgICAgICAgICAmJiBjdXJBLmJvcmRlciA9PT0gY3VyQi5ib3JkZXJcbiAgICAgICAgICAmJiBjdXJBLmJvcmRlckNvbG9yID09PSBjdXJCLmJvcmRlckNvbG9yXG4gICAgICAgICAgJiYgY3VyQS5ib3JkZXJXaWR0aCA9PT0gY3VyQi5ib3JkZXJXaWR0aFxuICAgICAgICAgICYmIGN1ckEuYm9yZGVyUmFkaXVzID09PSBjdXJCLmJvcmRlclJhZGl1c1xuICAgICAgICAgICYmIGN1ckEub3BhY2l0eSA9PT0gY3VyQi5vcGFjaXR5XG4gICAgICAgICAgJiYgY3VyQS5mb250RmFtaWx5ID09PSBjdXJCLmZvbnRGYW1pbHlcbiAgICAgICAgICAmJiBjdXJBLmZvbnRTaXplID09PSBjdXJCLmZvbnRTaXplXG4gICAgICAgICAgJiYgY3VyQS50ZXh0QWxpZ24gPT09IGN1ckIudGV4dEFsaWduXG4gICAgICAgICAgJiYgY3VyQS50cmFuc2Zvcm0gPT09IGN1ckIudHJhbnNmb3JtXG4gICAgICAgICAgJiYgY3VyQS52ZXJ0aWNhbEFsaWduID09PSBjdXJCLnZlcnRpY2FsQWxpZ25cbiAgICAgICAgICAmJiBjdXJBLnNlbWFudGljID09PSBjdXJCLnNlbWFudGljXG4gICAgICAgICAgJiYgY3VyQS5kZWJ1ZyA9PT0gY3VyQi5kZWJ1Z1xuICAgICAgICAgICYmIGN1ckEuc3R5bGUgPT09IGN1ckIuc3R5bGVcbiAgICAgICAgICAmJiAoY3VyQi5zdmcgPT09IHVuZGVmaW5lZCB8fCAoXG4gICAgICAgICAgICAgIGN1ckEueCA9PT0gY3VyQi54XG4gICAgICAgICAgICAgICYmIGN1ckEueSA9PT0gY3VyQi55XG4gICAgICAgICAgICAgICYmIGN1ckEuZHggPT09IGN1ckIuZHhcbiAgICAgICAgICAgICAgJiYgY3VyQS5keSA9PT0gY3VyQi5keVxuICAgICAgICAgICAgICAmJiBjdXJBLmN4ID09PSBjdXJCLmN4XG4gICAgICAgICAgICAgICYmIGN1ckEuY3kgPT09IGN1ckIuY3lcbiAgICAgICAgICAgICAgJiYgY3VyQS5yID09PSBjdXJCLnJcbiAgICAgICAgICAgICAgJiYgY3VyQS5kID09PSBjdXJCLmRcbiAgICAgICAgICAgICAgJiYgY3VyQS5maWxsID09PSBjdXJCLmZpbGxcbiAgICAgICAgICAgICAgJiYgY3VyQS5zdHJva2UgPT09IGN1ckIuc3Ryb2tlXG4gICAgICAgICAgICAgICYmIGN1ckEuc3Ryb2tlV2lkdGggPT09IGN1ckIuc3Ryb2tlV2lkdGhcbiAgICAgICAgICAgICAgJiYgY3VyQS5zdGFydE9mZnNldCA9PT0gY3VyQi5zdGFydE9mZnNldFxuICAgICAgICAgICAgICAmJiBjdXJBLnRleHRBbmNob3IgPT09IGN1ckIudGV4dEFuY2hvclxuICAgICAgICAgICAgICAmJiBjdXJBLnZpZXdCb3ggPT09IGN1ckIudmlld0JveFxuICAgICAgICAgICAgICAmJiBjdXJBLnhsaW5raHJlZiA9PT0gY3VyQi54bGlua2hyZWYpKVxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICB1cGRhdGVkW2lkXSA9IFwidXBkYXRlZFwiO1xuICAgIH1cbiAgICBmb3IodmFyIGkgPSAwLCBsZW4gPSBicy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgdmFyIGlkID0gYnNbaV07XG4gICAgICB2YXIgY3VyQSA9IGFbaWRdO1xuICAgICAgaWYoY3VyQSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGFkZHMucHVzaChpZCk7XG4gICAgICAgIHVwZGF0ZWRbaWRdID0gXCJhZGRlZFwiO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5sYXN0RGlmZiA9IHthZGRzOiBhZGRzLCB1cGRhdGVzOiB1cGRhdGVkfTtcbiAgICByZXR1cm4gdGhpcy5sYXN0RGlmZjtcbiAgfVxuXG4gIHByZXBhcmUocm9vdDpFbGVtZW50KSB7XG4gICAgdmFyIGVsZW1MZW4gPSAxO1xuICAgIHZhciB0cmVlID0gdGhpcy50cmVlO1xuICAgIHZhciBlbGVtZW50cyA9IFtyb290XTtcbiAgICB2YXIgZWxlbTpFbGVtZW50O1xuICAgIGZvcih2YXIgZWxlbUl4ID0gMDsgZWxlbUl4IDwgZWxlbUxlbjsgZWxlbUl4KyspIHtcbiAgICAgIGVsZW0gPSBlbGVtZW50c1tlbGVtSXhdO1xuICAgICAgaWYoZWxlbS5wYXJlbnQgPT09IHVuZGVmaW5lZCkgZWxlbS5wYXJlbnQgPSBcIl9fcm9vdFwiO1xuICAgICAgdHJlZVtlbGVtLmlkXSA9IGVsZW07XG4gICAgICBpZihlbGVtLnBvc3RSZW5kZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBvc3RSZW5kZXJzLnB1c2goZWxlbSk7XG4gICAgICB9XG4gICAgICB2YXIgY2hpbGRyZW4gPSBlbGVtLmNoaWxkcmVuO1xuICAgICAgaWYoY2hpbGRyZW4gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBmb3IodmFyIGNoaWxkSXggPSAwLCBsZW4gPSBjaGlsZHJlbi5sZW5ndGg7IGNoaWxkSXggPCBsZW47IGNoaWxkSXgrKykge1xuICAgICAgICAgIHZhciBjaGlsZCA9IGNoaWxkcmVuW2NoaWxkSXhdO1xuICAgICAgICAgIGlmKGNoaWxkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgICAgIGlmKGNoaWxkLmlkID09PSB1bmRlZmluZWQpIHsgY2hpbGQuaWQgPSBlbGVtLmlkICsgXCJfX1wiICsgY2hpbGRJeDsgfVxuICAgICAgICAgIGlmKGNoaWxkLml4ID09PSB1bmRlZmluZWQpIHsgY2hpbGQuaXggPSBjaGlsZEl4OyB9XG4gICAgICAgICAgaWYoY2hpbGQucGFyZW50ID09PSB1bmRlZmluZWQpIHsgY2hpbGQucGFyZW50ID0gZWxlbS5pZDsgfVxuICAgICAgICAgIGVsZW1lbnRzLnB1c2goY2hpbGQpO1xuICAgICAgICAgIGVsZW1MZW4rKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJlZTtcbiAgfVxuXG4gIHBvc3REb21pZnkoKSB7XG4gICAgdmFyIHBvc3RSZW5kZXJzID0gdGhpcy5wb3N0UmVuZGVycztcbiAgICB2YXIgZGlmZiA9IHRoaXMubGFzdERpZmYudXBkYXRlcztcbiAgICB2YXIgZWxlbWVudENhY2hlID0gdGhpcy5lbGVtZW50Q2FjaGU7XG4gICAgZm9yKHZhciBpID0gMCwgbGVuID0gcG9zdFJlbmRlcnMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHZhciBlbGVtID0gcG9zdFJlbmRlcnNbaV07XG4gICAgICB2YXIgaWQgPSBlbGVtLmlkO1xuICAgICAgaWYoZGlmZltpZF0gPT09IFwidXBkYXRlZFwiIHx8IGRpZmZbaWRdID09PSBcImFkZGVkXCIgfHwgZGlmZltpZF0gPT09IFwicmVwbGFjZWRcIiB8fCBlbGVtLmRpcnR5KSB7XG4gICAgICAgIGVsZW0ucG9zdFJlbmRlcihlbGVtZW50Q2FjaGVbZWxlbS5pZF0sIGVsZW0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJlbmRlcihlbGVtczpFbGVtZW50W10pIHtcbiAgICAgIHRoaXMucmVzZXQoKTtcbiAgICAvLyBXZSBzb3J0IGVsZW1lbnRzIGJ5IGRlcHRoIHRvIGFsbG93IHRoZW0gdG8gYmUgc2VsZiByZWZlcmVudGlhbC5cbiAgICBlbGVtcy5zb3J0KChhLCBiKSA9PiAoYS5wYXJlbnQgPyBhLnBhcmVudC5zcGxpdChcIl9fXCIpLmxlbmd0aCA6IDApIC0gKGIucGFyZW50ID8gYi5wYXJlbnQuc3BsaXQoXCJfX1wiKS5sZW5ndGggOiAwKSk7XG4gICAgbGV0IHN0YXJ0ID0gbm93KCk7XG4gICAgZm9yKGxldCBlbGVtIG9mIGVsZW1zKSB7XG4gICAgICBsZXQgcG9zdCA9IHRoaXMucHJlcGFyZShlbGVtKTtcblxuICAgIH1cbiAgICBsZXQgcHJlcGFyZSA9IG5vdygpO1xuICAgIGxldCBkID0gdGhpcy5kaWZmKCk7XG4gICAgbGV0IGRpZmYgPSBub3coKTtcbiAgICB0aGlzLmRvbWlmeSgpO1xuICAgIGxldCBkb21pZnkgPSBub3coKTtcbiAgICB0aGlzLnBvc3REb21pZnkoKTtcbiAgICBsZXQgcG9zdERvbWlmeSA9IG5vdygpO1xuICAgIGxldCB0aW1lID0gbm93KCkgLSBzdGFydDtcbiAgICBpZih0aW1lID4gNSkge1xuICAgICAgY29uc29sZS5sb2coXCJzbG93IHJlbmRlciAoPiA1bXMpOiBcIiwgdGltZSwge1xuICAgICAgICBwcmVwYXJlOiBwcmVwYXJlIC0gc3RhcnQsXG4gICAgICAgIGRpZmY6IGRpZmYgLSBwcmVwYXJlLFxuICAgICAgICBkb21pZnk6IGRvbWlmeSAtIGRpZmYsXG4gICAgICAgIHBvc3REb21pZnk6IHBvc3REb21pZnkgLSBkb21pZnlcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0ICogYXMgbWljcm9SZWFjdCBmcm9tIFwiLi9taWNyb1JlYWN0XCI7XG5pbXBvcnQgKiBhcyBydW50aW1lIGZyb20gXCIuL3J1bnRpbWVcIjtcbmltcG9ydCB7ZXZlfSBmcm9tIFwiLi9hcHBcIjtcbmltcG9ydCAqIGFzIGFwcCBmcm9tIFwiLi9hcHBcIjtcbmltcG9ydCAqIGFzIHdpa2kgZnJvbSBcIi4vd2lraVwiO1xuXG5cbmRlY2xhcmUgdmFyIHBsdXJhbGl6ZTtcbmRlY2xhcmUgdmFyIHV1aWQ7XG5cbndpbmRvd1tcImV2ZVwiXSA9IGV2ZTtcblxudmFyIGVudGl0aWVzID0ge1wiZWdnXCI6IFwiZWdnXCIsIFwiY2hpY2tlblwiOiBcImNoaWNrZW5cIn07XG52YXIgY29sbGVjdGlvbnMgPSB7XCJkaXNoXCI6IFwiZGlzaFwifTtcbnZhciBhdHRyaWJ1dGVzID0ge307XG52YXIgbW9kaWZpZXJzID0ge1wiYW5kXCI6IFwiYW5kXCIsIFwib3JcIjogXCJvclwiLCBcIndpdGhvdXRcIjogXCJ3aXRob3V0XCIsIFwiYXJlbiB0XCI6IFwiYXJlbiB0XCJ9O1xudmFyIHBhdHRlcm5zID0ge307XG5cbmVudW0gVG9rZW5UeXBlcyB7XG4gIGVudGl0eSxcbiAgY29sbGVjdGlvbixcbiAgYXR0cmlidXRlLFxuICBtb2RpZmllcixcbiAgcGF0dGVybixcbn1cblxuZnVuY3Rpb24gY2hlY2tGb3JUb2tlbih0b2tlbik6IGFueSB7XG4gIHZhciBmb3VuZDtcblx0aWYoZm91bmQgPSBldmUuZmluZE9uZShcImVudGl0eVwiLCB7ZW50aXR5OiB0b2tlbn0pKSB7XG4gICAgcmV0dXJuIHtmb3VuZCwgdHlwZTogVG9rZW5UeXBlcy5lbnRpdHl9O1xuICB9IGVsc2UgaWYoZm91bmQgPSBldmUuZmluZE9uZShcImNvbGxlY3Rpb25cIiwge2NvbGxlY3Rpb246IHRva2VufSkpIHtcbiAgICByZXR1cm4ge2ZvdW5kLCB0eXBlOiBUb2tlblR5cGVzLmNvbGxlY3Rpb259O1xuICB9IGVsc2UgaWYoZm91bmQgPSBldmUuZmluZE9uZShcImVudGl0eSBlYXZzXCIsIHthdHRyaWJ1dGU6IHRva2VufSkpIHtcbiAgICByZXR1cm4ge2ZvdW5kLCB0eXBlOiBUb2tlblR5cGVzLmF0dHJpYnV0ZX07XG4gIH0gZWxzZSBpZihmb3VuZCA9IG1vZGlmaWVyc1t0b2tlbl0pIHtcbiAgICByZXR1cm4ge2ZvdW5kLCB0eXBlOiBUb2tlblR5cGVzLm1vZGlmaWVyfTtcbiAgfSBlbHNlIGlmKGZvdW5kID0gcGF0dGVybnNbdG9rZW5dKSB7XG4gICAgcmV0dXJuIHtmb3VuZCwgdHlwZTogVG9rZW5UeXBlcy5wYXR0ZXJufTtcbiAgfVxuICByZXR1cm4ge307XG59XG5cbmZ1bmN0aW9uIGdldFRva2VucyhzdHJpbmcpIHtcbiAgLy8gcmVtb3ZlIGFsbCBub24td29yZCBub24tc3BhY2UgY2hhcmFjdGVyc1xuICBsZXQgY2xlYW5lZCA9IHN0cmluZy5yZXBsYWNlKC9bXlxcc1xcd10vZ2ksIFwiIFwiKS50b0xvd2VyQ2FzZSgpO1xuICBsZXQgd29yZHMgPSBjbGVhbmVkLnNwbGl0KFwiIFwiKTtcbiAgbGV0IGZyb250ID0gMDtcbiAgbGV0IGJhY2sgPSB3b3Jkcy5sZW5ndGg7XG4gIGxldCByZXN1bHRzID0gW107XG4gIGxldCBwb3MgPSAwO1xuICB3aGlsZShmcm9udCA8IHdvcmRzLmxlbmd0aCkge1xuICAgIGxldCBzdHIgPSB3b3Jkcy5zbGljZShmcm9udCwgYmFjaykuam9pbihcIiBcIik7XG4gICAgbGV0IG9yaWcgPSBzdHI7XG4gICAgdmFyIHtmb3VuZCwgdHlwZX0gPSBjaGVja0ZvclRva2VuKHN0cik7XG4gICAgaWYoIWZvdW5kKSB7XG4gICAgICBzdHIgPSBwbHVyYWxpemUoc3RyLCAxKTtcbiAgICAgIHZhciB7Zm91bmQsIHR5cGV9ID0gY2hlY2tGb3JUb2tlbihzdHIpO1xuICAgICAgaWYoIWZvdW5kKSB7XG4gICAgICAgIHN0ciA9IHBsdXJhbGl6ZShzdHIsIDIpO1xuICAgICAgICB2YXIge2ZvdW5kLCB0eXBlfSA9IGNoZWNrRm9yVG9rZW4oc3RyKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYoZm91bmQpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7Zm91bmQ6IHN0ciwgb3JpZywgcG9zLCB0eXBlLCBpbmZvOiBmb3VuZCwgaWQ6IHV1aWQoKSwgY2hpbGRyZW46IFtdfSk7XG4gICAgICBmcm9udCA9IGJhY2s7XG4gICAgICBwb3MgKz0gb3JpZy5sZW5ndGggKyAxO1xuICAgICAgYmFjayA9IHdvcmRzLmxlbmd0aDtcbiAgICB9IGVsc2UgaWYoYmFjayAtIDEgPiBmcm9udCkge1xuICAgICAgYmFjay0tO1xuICAgIH0gZWxzZSB7XG4gICAgICBiYWNrID0gd29yZHMubGVuZ3RoO1xuICAgICAgcG9zICs9IHdvcmRzW2Zyb250XS5sZW5ndGggKyAxO1xuICAgICAgZnJvbnQrKztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbnZhciB0b2tlblJlbGF0aW9uc2hpcHMgPSB7XG4gIFtUb2tlblR5cGVzLmNvbGxlY3Rpb25dOiB7XG4gICAgW1Rva2VuVHlwZXMuY29sbGVjdGlvbl06IFwiY29sbGVjdGlvbiB0byBjb2xsZWN0aW9uXCIsXG4gICAgW1Rva2VuVHlwZXMuZW50aXR5XTogXCJjb2xsZWN0aW9uIHRvIGVudGl0eVwiLFxuICAgIFtUb2tlblR5cGVzLmF0dHJpYnV0ZV06IFwiY29sbGVjdGlvbiB0byBhdHRyaWJ1dGVcIixcbiAgfSxcbiAgW1Rva2VuVHlwZXMuZW50aXR5XToge1xuICAgIFtUb2tlblR5cGVzLmVudGl0eV06IFwiZW50aXR5IHRvIGVudGl0eVwiLFxuICAgIFtUb2tlblR5cGVzLmF0dHJpYnV0ZV06IFwiZW50aXR5IHRvIGF0dHJpYnV0ZVwiLFxuICB9LFxufVxuXG5mdW5jdGlvbiBkZXRlcm1pbmVSZWxhdGlvbnNoaXAocGFyZW50LCBjaGlsZCkge1xuICByZXR1cm4gdG9rZW5SZWxhdGlvbnNoaXBzW3BhcmVudC50eXBlXVtjaGlsZC50eXBlXTtcbn1cblxuZnVuY3Rpb24gdG9rZW5zVG9UcmVlKHRva2Vucykge1xuICBsZXQgcm9vdHMgPSBbXTtcbiAgbGV0IG9wZXJhdGlvbnMgPSBbXTtcbiAgbGV0IGdyb3VwcyA9IFtdO1xuICAvLyBGaW5kIHRoZSBkaXJlY3Qgb2JqZWN0XG4gIC8vIFRoZSBkaXJlY3Qgb2JqZWN0IGlzIHRoZSBmaXJzdCBjb2xsZWN0aW9uIHdlIGZpbmQsIG9yIGlmIHRoZXJlIGFyZSBub25lLFxuICAvLyB0aGUgZmlyc3QgZW50aXR5LCBvciBmaW5hbGx5IHRoZSBmaXJzdCBhdHRyaWJ1dGUuXG4gIGxldCBkaXJlY3RPYmplY3Q7XG4gIGZvcihsZXQgdG9rZW4gb2YgdG9rZW5zKSB7XG4gICAgaWYodG9rZW4udHlwZSA9PT0gVG9rZW5UeXBlcy5jb2xsZWN0aW9uKSB7XG4gICAgICBkaXJlY3RPYmplY3QgPSB0b2tlbjtcbiAgICAgIGJyZWFrO1xuICAgIH0gZWxzZSBpZih0b2tlbi50eXBlID09PSBUb2tlblR5cGVzLmVudGl0eSkge1xuICAgICAgZGlyZWN0T2JqZWN0ID0gdG9rZW47XG4gICAgfSBlbHNlIGlmKHRva2VuLnR5cGUgPT09IFRva2VuVHlwZXMuYXR0cmlidXRlICYmICFkaXJlY3RPYmplY3QpIHtcbiAgICAgIGRpcmVjdE9iamVjdCA9IHRva2VuO1xuICAgIH1cbiAgfVxuXG4gIGlmKCFkaXJlY3RPYmplY3QpIHJldHVybiB7ZGlyZWN0T2JqZWN0LCByb290cywgb3BlcmF0aW9ucywgZ3JvdXBzfTtcblxuICAvLyB0aGUgZGlyZWN0IG9iamVjdCBpcyBhbHdheXMgdGhlIGZpcnN0IHJvb3RcbiAgcm9vdHMucHVzaChkaXJlY3RPYmplY3QpO1xuICAvLyB3ZSBuZWVkIHRvIGtlZXAgc3RhdGUgYXMgd2UgdHJhdmVyc2UgdGhlIHRva2VucyBmb3IgbW9kaWZpZXJzIGFuZCBwYXR0ZXJuc1xuICBsZXQgc3RhdGUgPSB7fTtcbiAgLy8gYXMgd2UgcGFyc2UgdGhlIHF1ZXJ5IHdlIG1heSBlbmNvdW50ZXIgb3RoZXIgc3ViamVjdHMgaW4gdGhlIHNlbnRlbmNlLCB3ZVxuICAvLyBuZWVkIGEgcmVmZXJlbmNlIHRvIHRob3NlIHByZXZpb3VzIHN1YmplY3RzIHRvIHNlZSBpZiB0aGUgY3VycmVudCB0b2tlbiBpc1xuICAvLyByZWxhdGVkIHRvIHRoYXQgb3IgdGhlIGRpcmVjdE9iamVjdFxuICBsZXQgaW5kaXJlY3RPYmplY3QgPSBkaXJlY3RPYmplY3Q7XG5cbiAgZm9yKGxldCB0b2tlbiBvZiB0b2tlbnMpIHtcbiAgICBsZXQge3R5cGUsIGluZm8sIGZvdW5kfSA9IHRva2VuO1xuXG4gICAgLy8gZGVhbCB3aXRoIG1vZGlmaWVyc1xuICAgIGlmKHR5cGUgPT09IFRva2VuVHlwZXMubW9kaWZpZXIpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBkZWFsIHdpdGggcGF0dGVybnNcbiAgICBpZih0eXBlID09PSBUb2tlblR5cGVzLnBhdHRlcm4pIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIG9uY2UgbW9kaWZpZXJzIGFuZCBwYXR0ZXJucyBoYXZlIGJlZW4gYXBwbGllZCwgd2UgZG9uJ3QgbmVlZCB0byB3b3JyeVxuICAgIC8vIGFib3V0IHRoZSBkaXJlY3RPYmplY3QgYXMgaXQncyBhbHJlYWR5IGJlZW4gYXNpZ25lZCB0byB0aGUgZmlyc3Qgcm9vdC5cbiAgICBpZihkaXJlY3RPYmplY3QgPT09IHRva2VuKSBjb250aW51ZTtcblxuICAgIGlmKGRpcmVjdE9iamVjdCA9PT0gaW5kaXJlY3RPYmplY3QpIHtcbiAgICAgIGRpcmVjdE9iamVjdC5jaGlsZHJlbi5wdXNoKHRva2VuKTtcbiAgICAgIHRva2VuLnJlbGF0aW9uc2hpcCA9IGRldGVybWluZVJlbGF0aW9uc2hpcChkaXJlY3RPYmplY3QsIHRva2VuKTtcbiAgICB9XG5cbiAgfVxuXG4gIHJldHVybiB7ZGlyZWN0T2JqZWN0LCByb290cywgb3BlcmF0aW9ucywgZ3JvdXBzfTtcbn1cblxuZnVuY3Rpb24gdHJlZVRvUGxhbih0cmVlKSB7XG4gIHJldHVybiBbXTtcbn1cblxuZnVuY3Rpb24gZ3JvdXBUcmVlKHJvb3QpIHtcbiAgbGV0IGtpZHMgPSByb290LmNoaWxkcmVuLm1hcChncm91cFRyZWUpO1xuICByZXR1cm4ge2M6IFwiXCIsIGNoaWxkcmVuOiBbXG4gICAge2M6IGBub2RlICR7VG9rZW5UeXBlc1tyb290LnR5cGVdfWAsIHRleHQ6IGAke3Jvb3QuZm91bmR9ICgke3Jvb3QucmVsYXRpb25zaGlwIHx8IFwicm9vdFwifSlgfSxcbiAgICB7YzogXCJraWRzXCIsIGNoaWxkcmVuOiBraWRzfSxcbiAgXX07XG59XG5cbmZ1bmN0aW9uIHRlc3RTZWFyY2goc2VhcmNoKSB7XG4gIGxldCB0b2tlbnMgPSBnZXRUb2tlbnMoc2VhcmNoKTtcbiAgbGV0IHRyZWUgPSB0b2tlbnNUb1RyZWUodG9rZW5zKTtcbiAgbGV0IHBsYW4gPSB0cmVlVG9QbGFuKHRyZWUpO1xuXG4gIC8vdG9rZW5zXG4gIGxldCB0b2tlbnNOb2RlID0ge2M6IFwidG9rZW5zXCIsIGNoaWxkcmVuOiBbXG4gICAge2M6IFwiaGVhZGVyXCIsIHRleHQ6IFwiVG9rZW5zXCJ9LFxuICAgIHtjOiBcImtpZHNcIiwgY2hpbGRyZW46IHRva2Vucy5tYXAoKHRva2VuKSA9PiB7XG4gICAgICByZXR1cm4ge2M6IGBub2RlICR7VG9rZW5UeXBlc1t0b2tlbi50eXBlXX1gLCB0ZXh0OiBgJHt0b2tlbi5mb3VuZH0gKCR7VG9rZW5UeXBlc1t0b2tlbi50eXBlXX0pYH1cbiAgICB9KX1cbiAgXX07XG5cbiAgLy90cmVlXG4gIGxldCB0cmVlTm9kZSA9IHtjOiBcInRyZWVcIiwgY2hpbGRyZW46IFtcbiAgICB7YzogXCJoZWFkZXJcIiwgdGV4dDogXCJUcmVlXCJ9LFxuICAgIHtjOiBcImtpZHNcIiwgY2hpbGRyZW46IFtcbiAgICAgIHtjOiBcImhlYWRlcjJcIiwgdGV4dDogXCJSb290c1wifSxcbiAgICAgIHtjOiBcImtpZHNcIiwgY2hpbGRyZW46IHRyZWUucm9vdHMubWFwKGdyb3VwVHJlZSl9LFxuICAgICAge2M6IFwiaGVhZGVyMlwiLCB0ZXh0OiBcIk9wZXJhdGlvbnNcIn0sXG4gICAgICB7YzogXCJraWRzXCIsIGNoaWxkcmVuOiB0cmVlLm9wZXJhdGlvbnMubWFwKGdyb3VwVHJlZSl9LFxuICAgICAge2M6IFwiaGVhZGVyMlwiLCB0ZXh0OiBcIkdyb3Vwc1wifSxcbiAgICAgIHtjOiBcImtpZHNcIiwgY2hpbGRyZW46IHRyZWUuZ3JvdXBzLm1hcChncm91cFRyZWUpfSxcbiAgICBdfVxuICBdfTtcblxuICAvL3Rva2Vuc1xuICBsZXQgcGxhbk5vZGUgPSB7YzogXCJ0b2tlbnNcIiwgY2hpbGRyZW46IFtcbiAgICB7YzogXCJoZWFkZXJcIiwgdGV4dDogXCJQbGFuXCJ9LFxuICAgIHtjOiBcImtpZHNcIiwgY2hpbGRyZW46IHBsYW4ubWFwKChzdGVwKSA9PiB7XG4gICAgICByZXR1cm4ge2M6IFwibm9kZVwiLCB0ZXh0OiBgJHtzdGVwLnR5cGV9ICgke3N0ZXAuZm91bmR9KWB9XG4gICAgfSl9XG4gIF19O1xuXG4gIHJldHVybiB7YzogXCJzZWFyY2hcIiwgY2hpbGRyZW46IFtcbiAgICB7YzogXCJzZWFyY2gtaGVhZGVyXCIsIHRleHQ6IGAke3NlYXJjaH1gfSxcbiAgICB0b2tlbnNOb2RlLFxuICAgIHRyZWVOb2RlLFxuICAgIHBsYW5Ob2RlLFxuICBdfTtcbn1cblxuZnVuY3Rpb24gcm9vdCgpIHtcbiAgcmV0dXJuIHtpZDogXCJyb290XCIsIGM6IFwidGVzdC1yb290XCIsIGNoaWxkcmVuOiBbXG4gICAgdGVzdFNlYXJjaChcImRpc2hlcyB3aXRoIGVnZ3MgYW5kIGNoaWNrZW5cIiksXG4gICAgdGVzdFNlYXJjaChcImRpc2hlcyB3aXRob3V0IGVnZ3MgYW5kIGNoaWNrZW5cIiksXG4gICAgdGVzdFNlYXJjaChcImRpc2hlcyB3aXRob3V0IGVnZ3Mgb3IgY2hpY2tlblwiKSxcbiAgICB0ZXN0U2VhcmNoKFwiZGlzaGVzIHdpdGggZWdncyB0aGF0IGFyZW4ndCBkZXNzZXJ0c1wiKSxcbiAgXX07XG59XG5cbmFwcC5yZW5kZXJSb290c1tcIndpa2lcIl0gPSByb290OyIsIi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSdW50aW1lXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZGVjbGFyZSB2YXIgZXhwb3J0cztcbmxldCBydW50aW1lID0gZXhwb3J0cztcblxuZnVuY3Rpb24gb2JqZWN0c0lkZW50aWNhbChhOntba2V5OnN0cmluZ106IGFueX0sIGI6e1trZXk6c3RyaW5nXTogYW55fSk6Ym9vbGVhbiB7XG4gIHZhciBhS2V5cyA9IE9iamVjdC5rZXlzKGEpO1xuICBmb3IodmFyIGtleSBvZiBhS2V5cykge1xuICAgIC8vVE9ETzogaGFuZGxlIG5vbi1zY2FsYXIgdmFsdWVzXG4gICAgaWYoYVtrZXldICE9PSBiW2tleV0pIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gaW5kZXhPZkZhY3QoaGF5c3RhY2ssIG5lZWRsZSwgZXF1YWxzID0gb2JqZWN0c0lkZW50aWNhbCkge1xuICBsZXQgaXggPSAwO1xuICBmb3IobGV0IGZhY3Qgb2YgaGF5c3RhY2spIHtcbiAgICBpZihlcXVhbHMoZmFjdCwgbmVlZGxlKSkge1xuICAgICAgcmV0dXJuIGl4O1xuICAgIH1cbiAgICBpeCsrO1xuICB9XG4gIHJldHVybiAtMTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUZhY3QoaGF5c3RhY2ssIG5lZWRsZSwgZXF1YWxzPykge1xuICBsZXQgaXggPSBpbmRleE9mRmFjdChoYXlzdGFjaywgbmVlZGxlLCBlcXVhbHMpO1xuICBpZihpeCA+IC0xKSBoYXlzdGFjay5zcGxpY2UoaXgsIDEpO1xuICByZXR1cm4gaGF5c3RhY2s7XG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlRXF1YWxpdHlGbihrZXlzKSB7XG4gIHJldHVybiBuZXcgRnVuY3Rpb24oXCJhXCIsIFwiYlwiLCAgYHJldHVybiAke2tleXMubWFwKGZ1bmN0aW9uKGtleSwgaXgpIHtcbiAgICBpZihrZXkuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICByZXR1cm4gYGFbJHtrZXlbMF19XVsnJHtrZXlbMV19J10gPT09IGJbJHtrZXlbMF19XVsnJHtrZXlbMV19J11gO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYGFbXCIke2tleX1cIl0gPT09IGJbXCIke2tleX1cIl1gO1xuICAgIH1cbiAgfSkuam9pbihcIiAmJiBcIil9O2ApXG59XG5cbmZ1bmN0aW9uIGdlbmVyYXRlU3RyaW5nRm4oa2V5cykge1xuICBsZXQga2V5U3RyaW5ncyA9IFtdO1xuICBmb3IobGV0IGtleSBvZiBrZXlzKSB7XG4gICAgaWYoa2V5LmNvbnN0cnVjdG9yID09PSBBcnJheSkge1xuICAgICAga2V5U3RyaW5ncy5wdXNoKGBhWyR7a2V5WzBdfV1bJyR7a2V5WzFdfSddYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGtleVN0cmluZ3MucHVzaChgYVsnJHtrZXl9J11gKTtcbiAgICB9XG4gIH1cbiAgbGV0IGZpbmFsID0ga2V5U3RyaW5ncy5qb2luKCcgKyBcInxcIiArICcpO1xuICByZXR1cm4gbmV3IEZ1bmN0aW9uKFwiYVwiLCAgYHJldHVybiAke2ZpbmFsfTtgKTtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVVbnByb2plY3RlZFNvcnRlckNvZGUodW5wcm9qZWN0ZWRTaXplLCBzb3J0cykge1xuICBsZXQgY29uZGl0aW9ucyA9IFtdO1xuICBsZXQgcGF0aCA9IFtdO1xuICBsZXQgZGlzdGFuY2UgPSB1bnByb2plY3RlZFNpemU7XG4gIGZvcihsZXQgc29ydCBvZiBzb3J0cykge1xuICAgIGxldCBjb25kaXRpb24gPSBcIlwiO1xuICAgIGZvcihsZXQgcHJldiBvZiBwYXRoKSB7XG4gICAgICBsZXQgW3RhYmxlLCBrZXldID0gcHJldjtcbiAgICAgIGNvbmRpdGlvbiArPSBgdW5wcm9qZWN0ZWRbai0ke2Rpc3RhbmNlIC0gdGFibGV9XVsnJHtrZXl9J10gPT09IGl0ZW0ke3RhYmxlfVsnJHtrZXl9J10gJiYgYDtcbiAgICB9XG4gICAgbGV0IFt0YWJsZSwga2V5LCBkaXJdID0gc29ydDtcbiAgICBsZXQgb3AgPSBcIj5cIjtcbiAgICBpZihkaXIgPT09IFwiZGVzY2VuZGluZ1wiKSB7XG4gICAgICBvcCA9IFwiPFwiO1xuICAgIH1cbiAgICBjb25kaXRpb24gKz0gYHVucHJvamVjdGVkW2otJHtkaXN0YW5jZSAtIHRhYmxlfV1bJyR7a2V5fSddICR7b3B9IGl0ZW0ke3RhYmxlfVsnJHtrZXl9J11gO1xuICAgIGNvbmRpdGlvbnMucHVzaChjb25kaXRpb24pO1xuICAgIHBhdGgucHVzaChzb3J0KTtcbiAgfVxuICBsZXQgaXRlbXMgPSBbXTtcbiAgbGV0IHJlcG9zaXRpb25lZCA9IFtdO1xuICBsZXQgaXRlbUFzc2lnbm1lbnRzID0gW107XG4gIGZvcihsZXQgaXggPSAwOyBpeCA8IGRpc3RhbmNlOyBpeCsrKSB7XG4gICAgaXRlbXMucHVzaChgaXRlbSR7aXh9ID0gdW5wcm9qZWN0ZWRbaiske2l4fV1gKTtcbiAgICByZXBvc2l0aW9uZWQucHVzaChgdW5wcm9qZWN0ZWRbaiske2l4fV0gPSB1bnByb2plY3RlZFtqIC0gJHtkaXN0YW5jZSAtIGl4fV1gKTtcbiAgICBpdGVtQXNzaWdubWVudHMucHVzaCgoYHVucHJvamVjdGVkW2orJHtpeH1dID0gaXRlbSR7aXh9YCkpO1xuICB9XG4gIHJldHVybiBgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHVucHJvamVjdGVkLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAke2Rpc3RhbmNlfSkge1xuICAgICAgdmFyIGogPSBpLCAke2l0ZW1zLmpvaW4oXCIsIFwiKX07XG4gICAgICBmb3IoOyBqID4gJHtkaXN0YW5jZSAtIDF9ICYmICgke2NvbmRpdGlvbnMuam9pbihcIiB8fCBcIil9KTsgaiAtPSAke2Rpc3RhbmNlfSkge1xuICAgICAgICAke3JlcG9zaXRpb25lZC5qb2luKFwiO1xcblwiKX1cbiAgICAgIH1cbiAgICAgICR7aXRlbUFzc2lnbm1lbnRzLmpvaW4oXCI7XFxuXCIpfVxuICB9YDtcbn1cblxuZnVuY3Rpb24gZ2VuZXJhdGVDb2xsZWN0b3Ioa2V5cykge1xuICBsZXQgY29kZSA9IGB2YXIgcnVudGltZSA9IHRoaXM7XFxuYDtcbiAgbGV0IGl4ID0gMDtcbiAgbGV0IGNoZWNrcyA9IFwiXCI7XG4gIGxldCByZW1vdmVzID0gXCJ2YXIgY3VyID0gaW5kZXhcIjtcbiAgZm9yKGxldCBrZXkgb2Yga2V5cykge1xuICAgIGlmKGtleS5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpIHtcbiAgICAgIHJlbW92ZXMgKz0gYFtyZW1vdmVbJHtrZXlbMF19XVsnJHtrZXlbMV19J11dYDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVtb3ZlcyArPSBgW3JlbW92ZVsnJHtrZXl9J11dYDtcbiAgICB9XG4gIH1cbiAgcmVtb3ZlcyArPSBcIjtcXG5ydW50aW1lLnJlbW92ZUZhY3QoY3VyLCByZW1vdmUsIGVxdWFscyk7XCI7XG4gIGZvcihsZXQga2V5IG9mIGtleXMpIHtcbiAgICBpeCsrO1xuICAgIGlmKGtleS5jb25zdHJ1Y3RvciA9PT0gQXJyYXkpIHtcbiAgICAgIGNoZWNrcyArPSBgdmFsdWUgPSBhZGRbJHtrZXlbMF19XVsnJHtrZXlbMV19J11cXG5gO1xuICAgIH0gZWxzZSB7XG4gICAgICBjaGVja3MgKz0gYHZhbHVlID0gYWRkWycke2tleX0nXVxcbmA7XG4gICAgfVxuICAgIGxldCBwYXRoID0gYGN1cnNvclt2YWx1ZV1gO1xuICAgIGNoZWNrcyArPSBgaWYoISR7cGF0aH0pICR7cGF0aH0gPSBgO1xuICAgIGlmKGl4ID09PSBrZXlzLmxlbmd0aCkge1xuICAgICAgY2hlY2tzICs9IFwiW11cXG5cIjtcbiAgICB9IGVsc2Uge1xuICAgICAgY2hlY2tzICs9IFwie31cXG5cIjtcbiAgICB9XG4gICAgY2hlY2tzICs9IGBjdXJzb3IgPSAke3BhdGh9XFxuYDtcbiAgfVxuICBjb2RlICs9IGBcbmZvcih2YXIgaXggPSAwLCBsZW4gPSByZW1vdmVzLmxlbmd0aDsgaXggPCBsZW47IGl4KyspIHtcbnZhciByZW1vdmUgPSByZW1vdmVzW2l4XTtcbiR7cmVtb3Zlc31cbn1cbmZvcih2YXIgaXggPSAwLCBsZW4gPSBhZGRzLmxlbmd0aDsgaXggPCBsZW47IGl4KyspIHtcbnZhciBhZGQgPSBhZGRzW2l4XTtcbnZhciBjdXJzb3IgPSBpbmRleDtcbnZhciB2YWx1ZTtcbiR7Y2hlY2tzfSAgY3Vyc29yLnB1c2goYWRkKTtcbn1cbnJldHVybiBpbmRleDtgXG4gIHJldHVybiAobmV3IEZ1bmN0aW9uKFwiaW5kZXhcIiwgXCJhZGRzXCIsIFwicmVtb3Zlc1wiLCBcImVxdWFsc1wiLCBjb2RlKSkuYmluZChydW50aW1lKTtcbn1cblxuZnVuY3Rpb24gbWVyZ2VBcnJheXMoYXMsIGJzKSB7XG4gIGxldCBpeCA9IGFzLmxlbmd0aDtcbiAgbGV0IHN0YXJ0ID0gaXg7XG4gIGZvcihsZXQgYiBvZiBicykge1xuICAgIGFzW2l4XSA9IGJzW2l4IC0gc3RhcnRdO1xuICAgIGl4Kys7XG4gIH1cbiAgcmV0dXJuIGFzO1xufVxuXG5jbGFzcyBEaWZmIHtcbiAgdGFibGVzO1xuICBsZW5ndGg7XG4gIGl4ZXI7XG4gIG1ldGE7XG4gIGNvbnN0cnVjdG9yKGl4ZXIpIHtcbiAgICB0aGlzLml4ZXIgPSBpeGVyO1xuICAgIHRoaXMudGFibGVzID0ge307XG4gICAgdGhpcy5sZW5ndGggPSAwO1xuICAgIHRoaXMubWV0YSA9IHt9O1xuICB9XG4gIGVuc3VyZVRhYmxlKHRhYmxlKSB7XG4gICAgbGV0IHRhYmxlRGlmZiA9IHRoaXMudGFibGVzW3RhYmxlXTtcbiAgICBpZighdGFibGVEaWZmKSB7XG4gICAgICB0YWJsZURpZmYgPSB0aGlzLnRhYmxlc1t0YWJsZV0gPSB7YWRkczogW10sIHJlbW92ZXM6IFtdfTtcbiAgICB9XG4gICAgcmV0dXJuIHRhYmxlRGlmZjtcbiAgfVxuICBhZGQodGFibGUsIG9iaikge1xuICAgIGxldCB0YWJsZURpZmYgPSB0aGlzLmVuc3VyZVRhYmxlKHRhYmxlKTtcbiAgICB0aGlzLmxlbmd0aCsrO1xuICAgIHRhYmxlRGlmZi5hZGRzLnB1c2gob2JqKTtcbiAgfVxuICBhZGRNYW55KHRhYmxlLCBvYmpzKSB7XG4gICAgbGV0IHRhYmxlRGlmZiA9IHRoaXMuZW5zdXJlVGFibGUodGFibGUpO1xuICAgIHRoaXMubGVuZ3RoICs9IG9ianMubGVuZ3RoO1xuICAgIG1lcmdlQXJyYXlzKHRhYmxlRGlmZi5hZGRzLCBvYmpzKTtcbiAgfVxuICByZW1vdmVGYWN0cyh0YWJsZSwgb2Jqcykge1xuICAgIGxldCB0YWJsZURpZmYgPSB0aGlzLmVuc3VyZVRhYmxlKHRhYmxlKTtcbiAgICB0aGlzLmxlbmd0aCArPSBvYmpzLmxlbmd0aDtcbiAgICBtZXJnZUFycmF5cyh0YWJsZURpZmYucmVtb3Zlcywgb2Jqcyk7XG4gIH1cbiAgcmVtb3ZlKHRhYmxlLCBxdWVyeT8pIHtcbiAgICBsZXQgdGFibGVEaWZmID0gdGhpcy5lbnN1cmVUYWJsZSh0YWJsZSk7XG4gICAgbGV0IGZvdW5kID0gdGhpcy5peGVyLmZpbmQodGFibGUsIHF1ZXJ5KTtcbiAgICB0aGlzLmxlbmd0aCArPSBmb3VuZC5sZW5ndGg7XG4gICAgbWVyZ2VBcnJheXModGFibGVEaWZmLnJlbW92ZXMsIGZvdW5kKTtcbiAgfVxuICBtZXJnZShkaWZmKSB7XG4gICAgZm9yKGxldCB0YWJsZSBpbiBkaWZmLnRhYmxlcykge1xuICAgICAgbGV0IHRhYmxlRGlmZiA9IGRpZmYudGFibGVzW3RhYmxlXTtcbiAgICAgIHRoaXMuYWRkTWFueSh0YWJsZSwgdGFibGVEaWZmLmFkZHMpO1xuICAgICAgdGhpcy5yZW1vdmVGYWN0cyh0YWJsZSwgdGFibGVEaWZmLnJlbW92ZXMpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICByZXZlcnNlKCkge1xuICAgIGxldCByZXZlcnNlZCA9IG5ldyBEaWZmKHRoaXMuaXhlcik7XG4gICAgZm9yKGxldCB0YWJsZSBpbiB0aGlzLnRhYmxlcykge1xuICAgICAgbGV0IGRpZmYgPSB0aGlzLnRhYmxlc1t0YWJsZV07XG4gICAgICByZXZlcnNlZC5hZGRNYW55KHRhYmxlLCBkaWZmLnJlbW92ZXMpO1xuICAgICAgcmV2ZXJzZWQucmVtb3ZlRmFjdHModGFibGUsIGRpZmYuYWRkcyk7XG4gICAgfVxuICAgIHJldHVybiByZXZlcnNlZDtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSW5kZXhlciB7XG4gIHRhYmxlcztcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy50YWJsZXMgPSB7fTtcbiAgfVxuICBhZGRUYWJsZShuYW1lLCBrZXlzID0gW10pIHtcbiAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlc1tuYW1lXTtcbiAgICBpZih0YWJsZSAmJiBrZXlzLmxlbmd0aCkge1xuICAgICAgdGFibGUuZmllbGRzID0ga2V5cztcbiAgICAgIHRhYmxlLnN0cmluZ2lmeSA9IGdlbmVyYXRlU3RyaW5nRm4oa2V5cyk7XG4gICAgICB0YWJsZS5lcXVhbHMgPSBnZW5lcmF0ZUVxdWFsaXR5Rm4oa2V5cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhYmxlID0gdGhpcy50YWJsZXNbbmFtZV0gPSB7dGFibGU6IFtdLCBmYWN0SGFzaDoge30sIGluZGV4ZXM6IHt9LCB0cmlnZ2Vyczoge30sIGZpZWxkczoga2V5cywgc3RyaW5naWZ5OiBnZW5lcmF0ZVN0cmluZ0ZuKGtleXMpLCBlcXVhbHM6IGdlbmVyYXRlRXF1YWxpdHlGbihrZXlzKX07XG4gICAgfVxuICAgIHJldHVybiB0YWJsZTtcbiAgfVxuICBjbGVhclRhYmxlKG5hbWUpIHtcbiAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlc1tuYW1lXTtcbiAgICBpZighdGFibGUpIHJldHVybjtcblxuICAgIHRhYmxlLnRhYmxlID0gW107XG4gICAgdGFibGUuZmFjdEhhc2ggPSB7fTtcbiAgICBmb3IobGV0IGluZGV4TmFtZSBpbiB0YWJsZS5pbmRleGVzKSB7XG4gICAgICB0YWJsZS5pbmRleGVzW2luZGV4TmFtZV0uaW5kZXggPSB7fTtcbiAgICB9XG4gIH1cbiAgdXBkYXRlVGFibGUodGFibGVJZCwgYWRkcywgcmVtb3Zlcykge1xuICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW3RhYmxlSWRdO1xuICAgIGlmKCF0YWJsZSB8fCAhdGFibGUuZmllbGRzLmxlbmd0aCkge1xuICAgICAgbGV0IGV4YW1wbGUgPSBhZGRzWzBdIHx8IHJlbW92ZXNbMF07XG4gICAgICB0YWJsZSA9IHRoaXMuYWRkVGFibGUodGFibGVJZCwgT2JqZWN0LmtleXMoZXhhbXBsZSkpO1xuICAgIH1cbiAgICBsZXQgc3RyaW5naWZ5ID0gdGFibGUuc3RyaW5naWZ5O1xuICAgIGxldCBmYWN0cyA9IHRhYmxlLnRhYmxlO1xuICAgIGxldCBmYWN0SGFzaCA9IHRhYmxlLmZhY3RIYXNoO1xuICAgIGxldCBsb2NhbEhhc2ggPSB7fTtcbiAgICBsZXQgaGFzaFRvRmFjdCA9IHt9O1xuICAgIGxldCBoYXNoZXMgPSBbXTtcbiAgICBmb3IobGV0IGFkZCBvZiBhZGRzKSB7XG4gICAgICBsZXQgaGFzaCA9IHN0cmluZ2lmeShhZGQpO1xuICAgICAgaWYobG9jYWxIYXNoW2hhc2hdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbG9jYWxIYXNoW2hhc2hdID0gMTtcbiAgICAgICAgaGFzaFRvRmFjdFtoYXNoXSA9IGFkZDtcbiAgICAgICAgaGFzaGVzLnB1c2goaGFzaCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2NhbEhhc2hbaGFzaF0rKztcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yKGxldCByZW1vdmUgb2YgcmVtb3Zlcykge1xuICAgICAgbGV0IGhhc2ggPSBzdHJpbmdpZnkocmVtb3ZlKTtcbiAgICAgIGlmKGxvY2FsSGFzaFtoYXNoXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvY2FsSGFzaFtoYXNoXSA9IC0xO1xuICAgICAgICBoYXNoVG9GYWN0W2hhc2hdID0gcmVtb3ZlO1xuICAgICAgICBoYXNoZXMucHVzaChoYXNoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvY2FsSGFzaFtoYXNoXS0tO1xuICAgICAgfVxuICAgIH1cbiAgICBsZXQgcmVhbEFkZHMgPSBbXTtcbiAgICBsZXQgcmVhbFJlbW92ZXMgPSBbXTtcbiAgICBmb3IobGV0IGhhc2ggb2YgaGFzaGVzKSB7XG4gICAgICBsZXQgY291bnQgPSBsb2NhbEhhc2hbaGFzaF07XG4gICAgICBpZihjb3VudCA+IDAgJiYgIWZhY3RIYXNoW2hhc2hdKSB7XG4gICAgICAgIGxldCBmYWN0ID0gaGFzaFRvRmFjdFtoYXNoXTtcbiAgICAgICAgcmVhbEFkZHMucHVzaChmYWN0KTtcbiAgICAgICAgZmFjdHMucHVzaChmYWN0KTtcbiAgICAgICAgZmFjdEhhc2hbaGFzaF0gPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmKGNvdW50IDwgMCAmJiBmYWN0SGFzaFtoYXNoXSkge1xuICAgICAgICBsZXQgZmFjdCA9IGhhc2hUb0ZhY3RbaGFzaF07XG4gICAgICAgIHJlYWxSZW1vdmVzLnB1c2goZmFjdCk7XG4gICAgICAgIHJlbW92ZUZhY3QoZmFjdHMsIGZhY3QsIHRhYmxlLmVxdWFscyk7XG4gICAgICAgIGZhY3RIYXNoW2hhc2hdID0gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge2FkZHM6cmVhbEFkZHMsIHJlbW92ZXM6cmVhbFJlbW92ZXN9O1xuICB9XG5cbiAgY29sbGVjdG9yKGtleXMpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaW5kZXg6IHt9LFxuICAgICAgY29sbGVjdDogZ2VuZXJhdGVDb2xsZWN0b3Ioa2V5cyksXG4gICAgfVxuICB9XG4gIGZhY3RUb0luZGV4KHRhYmxlLCBmYWN0KSB7XG4gICAgbGV0IGtleXMgPSBPYmplY3Qua2V5cyhmYWN0KTtcbiAgICBrZXlzLnNvcnQoKTtcbiAgICBsZXQgaW5kZXhOYW1lID0ga2V5cy5qb2luKFwifFwiKTtcbiAgICBsZXQgaW5kZXggPSB0YWJsZS5pbmRleGVzW2luZGV4TmFtZV07XG4gICAgaWYoIWluZGV4KSB7XG4gICAgICBpbmRleCA9IHRhYmxlLmluZGV4ZXNbaW5kZXhOYW1lXSA9IHRoaXMuY29sbGVjdG9yKGtleXMpO1xuICAgICAgaW5kZXguY29sbGVjdChpbmRleC5pbmRleCwgdGFibGUudGFibGUsIFtdLCB0YWJsZS5lcXVhbHMpO1xuICAgIH1cbiAgICBsZXQgY3Vyc29yID0gaW5kZXguaW5kZXg7XG4gICAgZm9yKGxldCBrZXkgb2Yga2V5cykge1xuICAgICAgY3Vyc29yID0gY3Vyc29yW2ZhY3Rba2V5XV07XG4gICAgICBpZighY3Vyc29yKSByZXR1cm4gW107XG4gICAgfVxuICAgIHJldHVybiBjdXJzb3I7XG4gIH1cbiAgZXhlY0RpZmYoZGlmZikge1xuICAgIGxldCB0cmlnZ2VycyA9IHt9O1xuICAgIGxldCByZWFsRGlmZnMgPSB7fTtcbiAgICBmb3IobGV0IHRhYmxlSWQgaW4gZGlmZi50YWJsZXMpIHtcbiAgICAgIGxldCB0YWJsZURpZmYgPSBkaWZmLnRhYmxlc1t0YWJsZUlkXTtcbiAgICAgIGlmKCF0YWJsZURpZmYuYWRkcy5sZW5ndGggJiYgIXRhYmxlRGlmZi5yZW1vdmVzLmxlbmd0aCkgY29udGludWU7XG4gICAgICBsZXQgcmVhbERpZmYgPSB0aGlzLnVwZGF0ZVRhYmxlKHRhYmxlSWQsIHRhYmxlRGlmZi5hZGRzLCB0YWJsZURpZmYucmVtb3Zlcyk7XG4gICAgICAvLyBnbyB0aHJvdWdoIGFsbCB0aGUgaW5kZXhlcyBhbmQgdXBkYXRlIHRoZW0uXG4gICAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlc1t0YWJsZUlkXTtcbiAgICAgIGZvcihsZXQgaW5kZXhOYW1lIGluIHRhYmxlLmluZGV4ZXMpIHtcbiAgICAgICAgbGV0IGluZGV4ID0gdGFibGUuaW5kZXhlc1tpbmRleE5hbWVdO1xuICAgICAgICBpbmRleC5jb2xsZWN0KGluZGV4LmluZGV4LCByZWFsRGlmZi5hZGRzLCByZWFsRGlmZi5yZW1vdmVzLCB0YWJsZS5lcXVhbHMpO1xuICAgICAgfVxuICAgICAgZm9yKGxldCB0cmlnZ2VyTmFtZSBpbiB0YWJsZS50cmlnZ2Vycykge1xuICAgICAgICBsZXQgdHJpZ2dlciA9IHRhYmxlLnRyaWdnZXJzW3RyaWdnZXJOYW1lXTtcbiAgICAgICAgdHJpZ2dlcnNbdHJpZ2dlck5hbWVdID0gdHJpZ2dlcjtcbiAgICAgIH1cbiAgICAgIHJlYWxEaWZmc1t0YWJsZUlkXSA9IHJlYWxEaWZmO1xuICAgIH1cbiAgICByZXR1cm4ge3RyaWdnZXJzLCByZWFsRGlmZnN9O1xuICB9XG4gIGV4ZWNUcmlnZ2VyKHRyaWdnZXIpIHtcbiAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlKHRyaWdnZXIubmFtZSk7XG4gICAgbGV0IHtyZXN1bHRzLCB1bnByb2plY3RlZH0gPSB0cmlnZ2VyLmV4ZWMoKSB8fCB7fTtcbiAgICBpZighcmVzdWx0cykgcmV0dXJuO1xuICAgIGxldCBwcmV2UmVzdWx0cyA9IHRhYmxlLmZhY3RIYXNoO1xuICAgIGxldCBwcmV2SGFzaGVzID0gT2JqZWN0LmtleXMocHJldlJlc3VsdHMpO1xuICAgIHRhYmxlLnVucHJvamVjdGVkID0gdW5wcm9qZWN0ZWQ7XG4gICAgaWYocmVzdWx0cykge1xuICAgICAgbGV0IGRpZmYgPSBuZXcgRGlmZih0aGlzKTtcbiAgICAgIHRoaXMuY2xlYXJUYWJsZSh0cmlnZ2VyLm5hbWUpO1xuICAgICAgZGlmZi5hZGRNYW55KHRyaWdnZXIubmFtZSwgcmVzdWx0cyk7XG4gICAgICBsZXQge3RyaWdnZXJzfSA9IHRoaXMuZXhlY0RpZmYoZGlmZik7XG4gICAgICBsZXQgbmV3SGFzaGVzID0gdGFibGUuZmFjdEhhc2g7XG4gICAgICBpZihwcmV2SGFzaGVzLmxlbmd0aCA9PT0gT2JqZWN0LmtleXMobmV3SGFzaGVzKS5sZW5ndGgpIHtcbiAgICAgICAgbGV0IHNhbWUgPSB0cnVlO1xuICAgICAgICBmb3IobGV0IGhhc2ggb2YgcHJldkhhc2hlcykge1xuICAgICAgICAgIGlmKCFuZXdIYXNoZXNbaGFzaF0pIHtcbiAgICAgICAgICAgIHNhbWUgPSBmYWxzZTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2FtZSA/IHVuZGVmaW5lZCA6IHRyaWdnZXJzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHRyaWdnZXJzO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgdHJhbnNpdGl2ZWx5Q2xlYXJUcmlnZ2VycyhzdGFydGluZ1RyaWdnZXJzKSB7XG4gICAgbGV0IGNsZWFyZWQgPSB7fTtcbiAgICBsZXQgcmVtYWluaW5nID0gT2JqZWN0LmtleXMoc3RhcnRpbmdUcmlnZ2Vycyk7XG5cbiAgICBmb3IobGV0IGl4ID0gMDsgaXggPCByZW1haW5pbmcubGVuZ3RoOyBpeCsrKSB7XG4gICAgICBsZXQgdHJpZ2dlciA9IHJlbWFpbmluZ1tpeF07XG4gICAgICBpZihjbGVhcmVkW3RyaWdnZXJdKSBjb250aW51ZTtcbiAgICAgIHRoaXMuY2xlYXJUYWJsZSh0cmlnZ2VyKTtcbiAgICAgIGNsZWFyZWRbdHJpZ2dlcl0gPSB0cnVlO1xuICAgICAgcmVtYWluaW5nLnB1c2guYXBwbHkocmVtYWluaW5nLCBPYmplY3Qua2V5cyh0aGlzLnRhYmxlKHRyaWdnZXIpLnRyaWdnZXJzKSk7XG4gICAgICAvLyBjb25zb2xlLmxvZyhcIkNMRUFSRUQ6IFwiLCB0cmlnZ2VyKTtcbiAgICB9XG4gICAgcmV0dXJuIGNsZWFyZWQ7XG4gIH1cbiAgZXhlY1RyaWdnZXJzKHRyaWdnZXJzKSB7XG4gICAgbGV0IG5ld1RyaWdnZXJzID0ge307XG4gICAgbGV0IHJldHJpZ2dlciA9IGZhbHNlO1xuICAgIGZvcihsZXQgdHJpZ2dlck5hbWUgaW4gdHJpZ2dlcnMpIHtcbiAgICAgIC8vIGNvbnNvbGUubG9nKFwiQ2FsbGluZzpcIiwgdHJpZ2dlck5hbWUpO1xuICAgICAgbGV0IHRyaWdnZXIgPSB0cmlnZ2Vyc1t0cmlnZ2VyTmFtZV07XG4gICAgICBsZXQgbmV4dFJvdW5kID0gdGhpcy5leGVjVHJpZ2dlcih0cmlnZ2VyKTtcbiAgICAgIGlmKG5leHRSb3VuZCkge1xuICAgICAgICByZXRyaWdnZXIgPSB0cnVlO1xuICAgICAgICBmb3IobGV0IHRyaWdnZXIgaW4gbmV4dFJvdW5kKSB7XG4gICAgICAgICAgLy8gY29uc29sZS5sb2coXCJRdWV1aW5nOlwiLCB0cmlnZ2VyKTtcbiAgICAgICAgICBuZXdUcmlnZ2Vyc1t0cmlnZ2VyXSA9IG5leHRSb3VuZFt0cmlnZ2VyXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZihyZXRyaWdnZXIpIHtcbiAgICAgIHJldHVybiBuZXdUcmlnZ2VycztcbiAgICB9XG4gIH1cbiAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gSW5kZXhlciBQdWJsaWMgQVBJXG4gIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIHNlcmlhbGl6ZShhc09iamVjdD8pIHtcbiAgICBsZXQgZHVtcCA9IHt9O1xuICAgIGZvcihsZXQgdGFibGVOYW1lIGluIHRoaXMudGFibGVzKSB7XG4gICAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlc1t0YWJsZU5hbWVdO1xuICAgICAgaWYoIXRhYmxlLmlzVmlldykge1xuICAgICAgICBkdW1wW3RhYmxlTmFtZV0gPSB0YWJsZS50YWJsZTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYoYXNPYmplY3QpIHtcbiAgICAgIHJldHVybiBkdW1wO1xuICAgIH1cbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZHVtcCk7XG4gIH1cbiAgbG9hZChzZXJpYWxpemVkKSB7XG4gICAgbGV0IGR1bXAgPSBKU09OLnBhcnNlKHNlcmlhbGl6ZWQpO1xuICAgIGxldCBkaWZmID0gdGhpcy5kaWZmKCk7XG4gICAgZm9yKGxldCB0YWJsZU5hbWUgaW4gZHVtcCkge1xuICAgICAgZGlmZi5hZGRNYW55KHRhYmxlTmFtZSwgZHVtcFt0YWJsZU5hbWVdKTtcbiAgICB9XG4gICAgdGhpcy5hcHBseURpZmYoZGlmZik7XG4gIH1cbiAgZGlmZigpIHtcbiAgICByZXR1cm4gbmV3IERpZmYodGhpcyk7XG4gIH1cbiAgYXBwbHlEaWZmKGRpZmY6RGlmZikge1xuICAgIGxldCB7dHJpZ2dlcnMsIHJlYWxEaWZmc30gPSB0aGlzLmV4ZWNEaWZmKGRpZmYpO1xuICAgIGxldCBjbGVhcmVkO1xuICAgIGxldCByb3VuZCA9IDA7XG4gICAgaWYodHJpZ2dlcnMpIGNsZWFyZWQgPSB0aGlzLnRyYW5zaXRpdmVseUNsZWFyVHJpZ2dlcnModHJpZ2dlcnMpO1xuICAgIHdoaWxlKHRyaWdnZXJzKSB7XG4gICAgICBmb3IobGV0IHRyaWdnZXIgaW4gdHJpZ2dlcnMpIHtcbiAgICAgICAgY2xlYXJlZFt0cmlnZ2VyXSA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgLy8gY29uc29sZS5ncm91cChgUk9VTkQgJHtyb3VuZH1gKTtcbiAgICAgIHRyaWdnZXJzID0gdGhpcy5leGVjVHJpZ2dlcnModHJpZ2dlcnMpO1xuICAgICAgcm91bmQrKztcbiAgICAgIC8vIGNvbnNvbGUuZ3JvdXBFbmQoKTtcbiAgICB9XG4gICAgZm9yKGxldCB0cmlnZ2VyIG9mIE9iamVjdC5rZXlzKGNsZWFyZWQpKSB7XG4gICAgICBpZighY2xlYXJlZFt0cmlnZ2VyXSkgY29udGludWU7XG4gICAgICBsZXQgdmlldyA9IHRoaXMudGFibGUodHJpZ2dlcikudmlldztcbiAgICAgIGlmKHZpZXcpIHtcbiAgICAgICAgdGhpcy5leGVjVHJpZ2dlcih2aWV3KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgdGFibGUodGFibGVJZCkge1xuICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW3RhYmxlSWRdO1xuICAgIGlmKHRhYmxlKSByZXR1cm4gdGFibGU7XG4gICAgcmV0dXJuIHRoaXMuYWRkVGFibGUodGFibGVJZCk7XG4gIH1cbiAgaW5kZXgodGFibGVJZDpzdHJpbmcsIGtleXM6YW55W10pIHtcbiAgICBsZXQgdGFibGUgPSB0aGlzLnRhYmxlKHRhYmxlSWQpO1xuICAgIGlmKCF0YWJsZSkge1xuICAgICAgdGFibGUgPSB0aGlzLmFkZFRhYmxlKHRhYmxlSWQpO1xuICAgIH1cbiAgICBrZXlzLnNvcnQoKTtcbiAgICBsZXQgaW5kZXhOYW1lID0ga2V5cy5qb2luKFwifFwiKTtcbiAgICBsZXQgaW5kZXggPSB0YWJsZS5pbmRleGVzW2luZGV4TmFtZV07XG4gICAgaWYoIWluZGV4KSB7XG4gICAgICBpbmRleCA9IHRhYmxlLmluZGV4ZXNbaW5kZXhOYW1lXSA9IDxhbnk+dGhpcy5jb2xsZWN0b3Ioa2V5cyk7XG4gICAgICBpZih0YWJsZS5maWVsZHMubGVuZ3RoKSBpbmRleC5jb2xsZWN0KGluZGV4LmluZGV4LCB0YWJsZS5mYWN0cywgW10sIHRhYmxlLmVxdWFscyk7XG4gICAgfVxuICAgIHJldHVybiBpbmRleC5pbmRleDtcbiAgfVxuICBmaW5kKHRhYmxlSWQsIHF1ZXJ5Pykge1xuICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW3RhYmxlSWRdO1xuICAgIGlmKCF0YWJsZSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH0gZWxzZSBpZighcXVlcnkpIHtcbiAgICAgIHJldHVybiB0YWJsZS50YWJsZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuZmFjdFRvSW5kZXgodGFibGUsIHF1ZXJ5KTtcbiAgICB9XG4gIH1cbiAgZmluZE9uZSh0YWJsZUlkLCBxdWVyeT8pIHtcbiAgICByZXR1cm4gdGhpcy5maW5kKHRhYmxlSWQsIHF1ZXJ5KVswXTtcbiAgfVxuICBxdWVyeShuYW1lID0gXCJ1bmtub3duXCIpIHtcbiAgICByZXR1cm4gbmV3IFF1ZXJ5KHRoaXMsIG5hbWUpO1xuICB9XG4gIHVuaW9uKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IFVuaW9uKHRoaXMsIG5hbWUpO1xuICB9XG4gIHRyaWdnZXIobmFtZTpzdHJpbmcsIHRhYmxlOnN0cmluZ3xzdHJpbmdbXSwgZXhlYzooaXhlcjpJbmRleGVyKSA9PiB2b2lkKSB7XG4gICAgbGV0IHRhYmxlcyA9ICh0eXBlb2YgdGFibGUgPT09IFwic3RyaW5nXCIpID8gW3RhYmxlXSA6IHRhYmxlO1xuICAgIGxldCB0cmlnZ2VyID0ge25hbWUsIHRhYmxlcywgZXhlY307XG4gICAgZm9yKGxldCB0YWJsZUlkIG9mIHRhYmxlcykge1xuICAgICAgbGV0IHRhYmxlID0gdGhpcy50YWJsZSh0YWJsZUlkKTtcbiAgICAgIHRhYmxlLnRyaWdnZXJzW25hbWVdID0gdHJpZ2dlcjtcbiAgICB9XG4gICAgbGV0IG5leHRSb3VuZCA9IHRoaXMuZXhlY1RyaWdnZXIodHJpZ2dlcik7XG4gICAgd2hpbGUobmV4dFJvdW5kKSB7XG4gICAgICBuZXh0Um91bmQgPSB0aGlzLmV4ZWNUcmlnZ2VycyhuZXh0Um91bmQpO1xuICAgIH07XG4gIH1cblxuICBhc1ZpZXcocXVlcnk6UXVlcnl8VW5pb24pIHtcbiAgICBsZXQgbmFtZSA9IHF1ZXJ5Lm5hbWU7XG4gICAgbGV0IHZpZXcgPSB0aGlzLnRhYmxlKG5hbWUpO1xuICAgIHZpZXcudmlldyA9IHF1ZXJ5O1xuICAgIHZpZXcuaXNWaWV3ID0gdHJ1ZTtcbiAgICB0aGlzLnRyaWdnZXIobmFtZSwgcXVlcnkudGFibGVzLCBxdWVyeS5leGVjLmJpbmQocXVlcnkpKTtcbiAgfVxuICByZW1vdmVWaWV3KGlkOnN0cmluZykge1xuICAgIGZvcihsZXQgdGFibGUgb2YgdGhpcy50YWJsZXMpIHtcbiAgICAgIGRlbGV0ZSB0YWJsZS50cmlnZ2Vyc1tpZF07XG4gICAgfVxuICB9XG4gIHRvdGFsRmFjdHMoKSB7XG4gICAgbGV0IHRvdGFsID0gMDtcbiAgICBmb3IobGV0IHRhYmxlTmFtZSBpbiB0aGlzLnRhYmxlcykge1xuICAgICAgdG90YWwgKz0gdGhpcy50YWJsZXNbdGFibGVOYW1lXS50YWJsZS5sZW5ndGg7XG4gICAgfVxuICAgIHJldHVybiB0b3RhbDtcbiAgfVxufVxuXG5leHBvcnQgdmFyIFF1ZXJ5RnVuY3Rpb25zID0ge31cbnZhciBTVFJJUF9DT01NRU5UUyA9IC8oKFxcL1xcLy4qJCl8KFxcL1xcKltcXHNcXFNdKj9cXCpcXC8pKS9tZztcbnZhciBBUkdVTUVOVF9OQU1FUyA9IC8oW15cXHMsXSspL2c7XG5mdW5jdGlvbiBnZXRQYXJhbU5hbWVzKGZ1bmMpIHtcbiAgdmFyIGZuU3RyID0gZnVuYy50b1N0cmluZygpLnJlcGxhY2UoU1RSSVBfQ09NTUVOVFMsICcnKTtcbiAgdmFyIHJlc3VsdCA9IGZuU3RyLnNsaWNlKGZuU3RyLmluZGV4T2YoJygnKSsxLCBmblN0ci5pbmRleE9mKCcpJykpLm1hdGNoKEFSR1VNRU5UX05BTUVTKTtcbiAgaWYocmVzdWx0ID09PSBudWxsKVxuICAgIHJlc3VsdCA9IFtdO1xuICByZXR1cm4gcmVzdWx0O1xufVxuZXhwb3J0IGZ1bmN0aW9uIGRlZmluZShuYW1lLCBvcHRzLCBmdW5jKSB7XG4gIGxldCBwYXJhbXMgPSBnZXRQYXJhbU5hbWVzKGZ1bmMpO1xuICBvcHRzLm5hbWUgPSBuYW1lO1xuICBvcHRzLnBhcmFtcyA9IHBhcmFtcztcbiAgb3B0cy5mdW5jID0gZnVuYztcbiAgUXVlcnlGdW5jdGlvbnNbbmFtZV0gPSBvcHRzO1xufVxuXG5jbGFzcyBRdWVyeSB7XG4gIHRhYmxlcztcbiAgam9pbnM7XG4gIGRpcnR5O1xuICBjb21waWxlZDtcbiAgaXhlcjtcbiAgYWxpYXNlcztcbiAgZnVuY3M7XG4gIG5hbWU7XG4gIHByb2plY3Rpb25NYXA7XG4gIGxpbWl0SW5mbztcbiAgZ3JvdXBzO1xuICBzb3J0cztcbiAgYWdncmVnYXRlcztcbiAgdW5wcm9qZWN0ZWRTaXplO1xuICBoYXNPcmRpbmFsO1xuICBjb25zdHJ1Y3RvcihpeGVyLCBuYW1lID0gXCJ1bmtub3duXCIpIHtcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIHRoaXMuaXhlciA9IGl4ZXI7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgdGhpcy50YWJsZXMgPSBbXTtcbiAgICB0aGlzLmpvaW5zID0gW107XG4gICAgdGhpcy5hbGlhc2VzID0ge307XG4gICAgdGhpcy5mdW5jcyA9IFtdO1xuICAgIHRoaXMuYWdncmVnYXRlcyA9IFtdO1xuICAgIHRoaXMudW5wcm9qZWN0ZWRTaXplID0gMDtcbiAgICB0aGlzLmhhc09yZGluYWwgPSBmYWxzZTtcbiAgfVxuICBzZWxlY3QodGFibGUsIGpvaW4sIGFzPykge1xuICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICAgIGlmKGFzKSB7XG4gICAgICB0aGlzLmFsaWFzZXNbYXNdID0gT2JqZWN0LmtleXModGhpcy5hbGlhc2VzKS5sZW5ndGg7XG4gICAgfVxuICAgIHRoaXMudW5wcm9qZWN0ZWRTaXplKys7XG4gICAgdGhpcy50YWJsZXMucHVzaCh0YWJsZSk7XG4gICAgdGhpcy5qb2lucy5wdXNoKHtuZWdhdGVkOiBmYWxzZSwgdGFibGUsIGpvaW4sIGFzLCBpeDogdGhpcy5hbGlhc2VzW2FzXX0pO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGRlc2VsZWN0KHRhYmxlLCBqb2luKSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgdGhpcy50YWJsZXMucHVzaCh0YWJsZSk7XG4gICAgdGhpcy5qb2lucy5wdXNoKHtuZWdhdGVkOiB0cnVlLCB0YWJsZSwgam9pbiwgaXg6IHRoaXMuam9pbnMubGVuZ3RoICogMTAwMH0pO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGNhbGN1bGF0ZShmdW5jTmFtZSwgYXJncywgYXM/KSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgaWYoYXMpIHtcbiAgICAgIHRoaXMuYWxpYXNlc1thc10gPSBPYmplY3Qua2V5cyh0aGlzLmFsaWFzZXMpLmxlbmd0aDtcbiAgICB9XG4gICAgaWYoIVF1ZXJ5RnVuY3Rpb25zW2Z1bmNOYW1lXS5maWx0ZXIpIHtcbiAgICAgIHRoaXMudW5wcm9qZWN0ZWRTaXplKys7XG4gICAgfVxuICAgIHRoaXMuZnVuY3MucHVzaCh7bmFtZTogZnVuY05hbWUsIGFyZ3MsIGFzLCBpeDogdGhpcy5hbGlhc2VzW2FzXX0pO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIHByb2plY3QocHJvamVjdGlvbk1hcCkge1xuICAgIHRoaXMucHJvamVjdGlvbk1hcCA9IHByb2plY3Rpb25NYXA7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgZ3JvdXAoZ3JvdXBzKSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgdGhpcy5ncm91cHMgPSBncm91cHM7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgc29ydChzb3J0cykge1xuICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICAgIHRoaXMuc29ydHMgPSBzb3J0cztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBsaW1pdChsaW1pdEluZm86YW55KSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgdGhpcy5saW1pdEluZm8gPSBsaW1pdEluZm87XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgYWdncmVnYXRlKGZ1bmNOYW1lLCBhcmdzLCBhcz8pIHtcbiAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgICBpZihhcykge1xuICAgICAgdGhpcy5hbGlhc2VzW2FzXSA9IE9iamVjdC5rZXlzKHRoaXMuYWxpYXNlcykubGVuZ3RoO1xuICAgIH1cbiAgICB0aGlzLnVucHJvamVjdGVkU2l6ZSsrO1xuICAgIHRoaXMuYWdncmVnYXRlcy5wdXNoKHtuYW1lOiBmdW5jTmFtZSwgYXJncywgYXMsIGl4OiB0aGlzLmFsaWFzZXNbYXNdfSk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgb3JkaW5hbCgpIHtcbiAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgICB0aGlzLmhhc09yZGluYWwgPSB0cnVlO1xuICAgIHRoaXMudW5wcm9qZWN0ZWRTaXplKys7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgYXBwbHlBbGlhc2VzKGpvaW5NYXApIHtcbiAgICBmb3IobGV0IGZpZWxkIGluIGpvaW5NYXApIHtcbiAgICAgIGxldCBqb2luSW5mbyA9IGpvaW5NYXBbZmllbGRdO1xuICAgICAgaWYoam9pbkluZm8uY29uc3RydWN0b3IgIT09IEFycmF5IHx8IHR5cGVvZiBqb2luSW5mb1swXSA9PT0gXCJudW1iZXJcIikgY29udGludWU7XG4gICAgICBsZXQgam9pblRhYmxlID0gam9pbkluZm9bMF07XG4gICAgICBpZihqb2luVGFibGUgPT09IFwib3JkaW5hbFwiKSB7XG4gICAgICAgIGpvaW5JbmZvWzBdID0gdGhpcy51bnByb2plY3RlZFNpemUgLSAxO1xuICAgICAgfSBlbHNlIGlmKHRoaXMuYWxpYXNlc1tqb2luVGFibGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgam9pbkluZm9bMF0gPSB0aGlzLmFsaWFzZXNbam9pblRhYmxlXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgYWxpYXMgdXNlZDogXCIgKyBqb2luVGFibGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICB0b0FTVCgpIHtcbiAgICBsZXQgY3Vyc29yID0ge3R5cGU6IFwicXVlcnlcIixcbiAgICAgICAgICAgICAgICAgIGNoaWxkcmVuOiBbXX07XG4gICAgbGV0IHJvb3QgPSBjdXJzb3I7XG4gICAgbGV0IHJlc3VsdHMgPSBbXTtcbiAgICAvLyBieSBkZWZhdWx0IHRoZSBvbmx5IHRoaW5nIHdlIHJldHVybiBhcmUgdGhlIHVucHJvamVjdGVkIHJlc3VsdHNcbiAgICBsZXQgcmV0dXJucyA9IFtcInVucHJvamVjdGVkXCJdO1xuXG4gICAgLy8gd2UgbmVlZCBhbiBhcnJheSB0byBzdG9yZSBvdXIgdW5wcm9qZWN0ZWQgcmVzdWx0c1xuICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJkZWNsYXJhdGlvblwiLCB2YXI6IFwidW5wcm9qZWN0ZWRcIiwgdmFsdWU6IFwiW11cIn0pO1xuXG4gICAgLy8gcnVuIHRocm91Z2ggZWFjaCB0YWJsZSBuZXN0ZWQgaW4gdGhlIG9yZGVyIHRoZXkgd2VyZSBnaXZlbiBkb2luZyBwYWlyd2lzZVxuICAgIC8vIGpvaW5zIGFsb25nIHRoZSB3YXkuXG4gICAgZm9yKGxldCBqb2luIG9mIHRoaXMuam9pbnMpIHtcbiAgICAgIGxldCB7dGFibGUsIGl4LCBuZWdhdGVkfSA9IGpvaW47XG4gICAgICBsZXQgY3VyID0ge1xuICAgICAgICB0eXBlOiBcInNlbGVjdFwiLFxuICAgICAgICB0YWJsZSxcbiAgICAgICAgaXgsXG4gICAgICAgIG5lZ2F0ZWQsXG4gICAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgICAgam9pbjogZmFsc2UsXG4gICAgICB9O1xuICAgICAgLy8gd2Ugb25seSB3YW50IHRvIGVhdCB0aGUgY29zdCBvZiBkZWFsaW5nIHdpdGggaW5kZXhlc1xuICAgICAgLy8gaWYgd2UgYXJlIGFjdHVhbGx5IGpvaW5pbmcgb24gc29tZXRoaW5nXG4gICAgICBsZXQgam9pbk1hcCA9IGpvaW4uam9pbjtcbiAgICAgIHRoaXMuYXBwbHlBbGlhc2VzKGpvaW5NYXApO1xuICAgICAgaWYoT2JqZWN0LmtleXMoam9pbk1hcCkubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgIHJvb3QuY2hpbGRyZW4udW5zaGlmdCh7dHlwZTogXCJkZWNsYXJhdGlvblwiLCB2YXI6IGBxdWVyeSR7aXh9YCwgdmFsdWU6IFwie31cIn0pO1xuICAgICAgICBjdXIuam9pbiA9IGpvaW5NYXA7XG4gICAgICB9XG4gICAgICBjdXJzb3IuY2hpbGRyZW4ucHVzaChjdXIpO1xuICAgICAgaWYoIW5lZ2F0ZWQpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHt0eXBlOiBcInNlbGVjdFwiLCBpeH0pO1xuICAgICAgfVxuXG4gICAgICBjdXJzb3IgPSBjdXI7XG4gICAgfVxuICAgIC8vIGF0IHRoZSBib3R0b20gb2YgdGhlIGpvaW5zLCB3ZSBjYWxjdWxhdGUgYWxsIHRoZSBmdW5jdGlvbnMgYmFzZWQgb24gdGhlIHZhbHVlc1xuICAgIC8vIGNvbGxlY3RlZFxuICAgIGZvcihsZXQgZnVuYyBvZiB0aGlzLmZ1bmNzKSB7XG4gICAgICBsZXQge2FyZ3MsIG5hbWUsIGl4fSA9IGZ1bmM7XG4gICAgICBsZXQgZnVuY0luZm8gPSBRdWVyeUZ1bmN0aW9uc1tuYW1lXTtcbiAgICAgIHRoaXMuYXBwbHlBbGlhc2VzKGFyZ3MpO1xuICAgICAgcm9vdC5jaGlsZHJlbi51bnNoaWZ0KHt0eXBlOiBcImZ1bmN0aW9uRGVjbGFyYXRpb25cIiwgaXgsIGluZm86IGZ1bmNJbmZvfSk7XG4gICAgICBpZihmdW5jSW5mby5tdWx0aSB8fCBmdW5jSW5mby5maWx0ZXIpIHtcbiAgICAgICAgbGV0IG5vZGUgPSB7dHlwZTogXCJmdW5jdGlvbkNhbGxNdWx0aVJldHVyblwiLCBpeCwgYXJncywgaW5mbzogZnVuY0luZm8sIGNoaWxkcmVuOiBbXX07XG4gICAgICAgIGN1cnNvci5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICAgICAgICBjdXJzb3IgPSBub2RlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3Vyc29yLmNoaWxkcmVuLnB1c2goe3R5cGU6IFwiZnVuY3Rpb25DYWxsXCIsIGl4LCBhcmdzLCBpbmZvOiBmdW5jSW5mbywgY2hpbGRyZW46IFtdfSk7XG4gICAgICB9XG4gICAgICBpZighZnVuY0luZm8ubm9SZXR1cm4gJiYgIWZ1bmNJbmZvLmZpbHRlcikge1xuICAgICAgICByZXN1bHRzLnB1c2goe3R5cGU6IFwiZnVuY3Rpb25cIiwgaXh9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBub3cgdGhhdCB3ZSdyZSBhdCB0aGUgYm90dG9tIG9mIHRoZSBqb2luLCBzdG9yZSB0aGUgdW5wcm9qZWN0ZWQgcmVzdWx0XG4gICAgY3Vyc29yLmNoaWxkcmVuLnB1c2goe3R5cGU6IFwicmVzdWx0XCIsIHJlc3VsdHN9KTtcblxuICAgIC8vQWdncmVnYXRpb25cbiAgICAvL3NvcnQgdGhlIHVucHJvamVjdGVkIHJlc3VsdHMgYmFzZWQgb24gZ3JvdXBpbmdzIGFuZCB0aGUgZ2l2ZW4gc29ydHNcbiAgICBsZXQgc29ydHMgPSBbXTtcbiAgICBsZXQgYWxyZWFkeVNvcnRlZCA9IHt9O1xuICAgIGlmKHRoaXMuZ3JvdXBzKSB7XG4gICAgICB0aGlzLmFwcGx5QWxpYXNlcyh0aGlzLmdyb3Vwcyk7XG4gICAgICBmb3IobGV0IGdyb3VwIG9mIHRoaXMuZ3JvdXBzKSB7XG4gICAgICAgIGxldCBbdGFibGUsIGZpZWxkXSA9IGdyb3VwO1xuICAgICAgICBzb3J0cy5wdXNoKGdyb3VwKTtcbiAgICAgICAgYWxyZWFkeVNvcnRlZFtgJHt0YWJsZX18JHtmaWVsZH1gXSA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIGlmKHRoaXMuc29ydHMpIHtcbiAgICAgIHRoaXMuYXBwbHlBbGlhc2VzKHRoaXMuc29ydHMpO1xuICAgICAgZm9yKGxldCBzb3J0IG9mIHRoaXMuc29ydHMpIHtcbiAgICAgICAgbGV0IFt0YWJsZSwgZmllbGRdID0gc29ydDtcbiAgICAgICAgaWYoIWFscmVhZHlTb3J0ZWRbYCR7dGFibGV9fCR7ZmllbGR9YF0pIHtcbiAgICAgICAgICBzb3J0cy5wdXNoKHNvcnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHZhciBzaXplID0gdGhpcy51bnByb2plY3RlZFNpemU7XG4gICAgaWYoc29ydHMubGVuZ3RoKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goe3R5cGU6IFwic29ydFwiLCBzb3J0cywgc2l6ZSwgY2hpbGRyZW46IFtdfSk7XG4gICAgfVxuICAgIC8vdGhlbiB3ZSBuZWVkIHRvIHJ1biB0aHJvdWdoIHRoZSBzb3J0ZWQgaXRlbXMgYW5kIGRvIHRoZSBhZ2dyZWdhdGUgYXMgYSBmb2xkLlxuICAgIGlmKHRoaXMuYWdncmVnYXRlcy5sZW5ndGggfHwgc29ydHMubGVuZ3RoIHx8IHRoaXMubGltaXRJbmZvIHx8IHRoaXMuaGFzT3JkaW5hbCkge1xuICAgICAgLy8gd2UgbmVlZCB0byBzdG9yZSBncm91cCBpbmZvIGZvciBwb3N0IHByb2Nlc3Npbmcgb2YgdGhlIHVucHJvamVjdGVkIHJlc3VsdHNcbiAgICAgIC8vIHRoaXMgd2lsbCBpbmRpY2F0ZSB3aGF0IGdyb3VwIG51bWJlciwgaWYgYW55LCB0aGF0IGVhY2ggdW5wcm9qZWN0ZWQgcmVzdWx0IGJlbG9uZ3MgdG9cbiAgICAgIHJvb3QuY2hpbGRyZW4udW5zaGlmdCh7dHlwZTogXCJkZWNsYXJhdGlvblwiLCB2YXI6IFwiZ3JvdXBJbmZvXCIsIHZhbHVlOiBcIltdXCJ9KTtcbiAgICAgIHJldHVybnMucHVzaChcImdyb3VwSW5mb1wiKTtcbiAgICAgIGxldCBhZ2dyZWdhdGVDaGlsZHJlbiA9IFtdO1xuICAgICAgZm9yKGxldCBmdW5jIG9mIHRoaXMuYWdncmVnYXRlcykge1xuICAgICAgICBsZXQge2FyZ3MsIG5hbWUsIGl4fSA9IGZ1bmM7XG4gICAgICAgIGxldCBmdW5jSW5mbyA9IFF1ZXJ5RnVuY3Rpb25zW25hbWVdO1xuICAgICAgICB0aGlzLmFwcGx5QWxpYXNlcyhhcmdzKTtcbiAgICAgICAgcm9vdC5jaGlsZHJlbi51bnNoaWZ0KHt0eXBlOiBcImZ1bmN0aW9uRGVjbGFyYXRpb25cIiwgaXgsIGluZm86IGZ1bmNJbmZvfSk7XG4gICAgICAgIGFnZ3JlZ2F0ZUNoaWxkcmVuLnB1c2goe3R5cGU6IFwiZnVuY3Rpb25DYWxsXCIsIGl4LCByZXN1bHRzSXg6IHJlc3VsdHMubGVuZ3RoLCBhcmdzLCBpbmZvOiBmdW5jSW5mbywgdW5wcm9qZWN0ZWQ6IHRydWUsIGNoaWxkcmVuOiBbXX0pO1xuICAgICAgICByZXN1bHRzLnB1c2goe3R5cGU6IFwicGxhY2Vob2xkZXJcIn0pO1xuICAgICAgfVxuICAgICAgaWYodGhpcy5oYXNPcmRpbmFsID09PSB0cnVlKSB7XG4gICAgICAgIGFnZ3JlZ2F0ZUNoaWxkcmVuLnB1c2goe3R5cGU6IFwib3JkaW5hbFwifSk7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7dHlwZTogXCJwbGFjZWhvbGRlclwifSk7XG4gICAgICB9XG4gICAgICBsZXQgYWdncmVnYXRlID0ge3R5cGU6IFwiYWdncmVnYXRlIGxvb3BcIiwgZ3JvdXBzOiB0aGlzLmdyb3VwcywgbGltaXQ6IHRoaXMubGltaXRJbmZvLCBzaXplLCBjaGlsZHJlbjogYWdncmVnYXRlQ2hpbGRyZW59O1xuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKGFnZ3JlZ2F0ZSk7XG4gICAgICBjdXJzb3IgPSBhZ2dyZWdhdGU7XG4gICAgfVxuXG5cbiAgICBpZih0aGlzLnByb2plY3Rpb25NYXApIHtcbiAgICAgIHRoaXMuYXBwbHlBbGlhc2VzKHRoaXMucHJvamVjdGlvbk1hcCk7XG4gICAgICByb290LmNoaWxkcmVuLnVuc2hpZnQoe3R5cGU6IFwiZGVjbGFyYXRpb25cIiwgdmFyOiBcInJlc3VsdHNcIiwgdmFsdWU6IFwiW11cIn0pO1xuICAgICAgY3Vyc29yLmNoaWxkcmVuLnB1c2goe3R5cGU6IFwicHJvamVjdGlvblwiLCBwcm9qZWN0aW9uTWFwOiB0aGlzLnByb2plY3Rpb25NYXAsIHVucHJvamVjdGVkOiB0aGlzLmFnZ3JlZ2F0ZXMubGVuZ3RofSk7XG4gICAgICByZXR1cm5zLnB1c2goXCJyZXN1bHRzXCIpO1xuICAgIH1cblxuICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJyZXR1cm5cIiwgdmFyczogcmV0dXJuc30pO1xuICAgIHJldHVybiByb290O1xuICB9XG4gIGNvbXBpbGVQYXJhbVN0cmluZyhmdW5jSW5mbywgYXJncywgdW5wcm9qZWN0ZWQgPSBmYWxzZSkge1xuICAgIGxldCBjb2RlID0gXCJcIjtcbiAgICBsZXQgcGFyYW1zID0gZnVuY0luZm8ucGFyYW1zO1xuICAgIGlmKHVucHJvamVjdGVkKSBwYXJhbXMgPSBwYXJhbXMuc2xpY2UoMSk7XG4gICAgZm9yKGxldCBwYXJhbSBvZiBwYXJhbXMpIHtcbiAgICAgIGxldCBhcmcgPSBhcmdzW3BhcmFtXTtcbiAgICAgIGxldCBhcmdDb2RlO1xuICAgICAgaWYoYXJnLmNvbnN0cnVjdG9yID09PSBBcnJheSkge1xuICAgICAgICBsZXQgcHJvcGVydHkgPSBcIlwiO1xuICAgICAgICBpZihhcmdbMV0pIHtcbiAgICAgICAgICBwcm9wZXJ0eSA9IGBbJyR7YXJnWzFdfSddYDtcbiAgICAgICAgfVxuICAgICAgICBpZighdW5wcm9qZWN0ZWQpIHtcbiAgICAgICAgICBhcmdDb2RlID0gYHJvdyR7YXJnWzBdfSR7cHJvcGVydHl9YDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhcmdDb2RlID0gYHVucHJvamVjdGVkW2l4ICsgJHthcmdbMF19XSR7cHJvcGVydHl9YDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXJnQ29kZSA9IEpTT04uc3RyaW5naWZ5KGFyZyk7XG4gICAgICB9XG4gICAgICBjb2RlICs9IGAke2FyZ0NvZGV9LCBgO1xuICAgIH1cbiAgICByZXR1cm4gY29kZS5zdWJzdHJpbmcoMCxjb2RlLmxlbmd0aCAtIDIpO1xuICB9XG4gIGNvbXBpbGVBU1Qocm9vdCkge1xuICAgIGxldCBjb2RlID0gXCJcIjtcbiAgICBsZXQgdHlwZSA9IHJvb3QudHlwZTtcbiAgICBzd2l0Y2godHlwZSkge1xuICAgICAgY2FzZSBcInF1ZXJ5XCI6XG4gICAgICAgIGZvcih2YXIgY2hpbGQgb2Ygcm9vdC5jaGlsZHJlbikge1xuICAgICAgICAgIGNvZGUgKz0gdGhpcy5jb21waWxlQVNUKGNoaWxkKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJkZWNsYXJhdGlvblwiOlxuICAgICAgICBjb2RlICs9IGB2YXIgJHtyb290LnZhcn0gPSAke3Jvb3QudmFsdWV9O1xcbmA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcImZ1bmN0aW9uRGVjbGFyYXRpb25cIjpcbiAgICAgICAgY29kZSArPSBgdmFyIGZ1bmMke3Jvb3QuaXh9ID0gUXVlcnlGdW5jdGlvbnNbJyR7cm9vdC5pbmZvLm5hbWV9J10uZnVuYztcXG5gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJmdW5jdGlvbkNhbGxcIjpcbiAgICAgICAgdmFyIGl4ID0gcm9vdC5peDtcbiAgICAgICAgdmFyIHByZXYgPSBcIlwiO1xuICAgICAgICBpZihyb290LnVucHJvamVjdGVkKSB7XG4gICAgICAgICAgcHJldiA9IGByb3cke2l4fWA7XG4gICAgICAgICAgaWYocm9vdC5pbmZvLnBhcmFtcy5sZW5ndGggPiAxKSBwcmV2ICs9IFwiLFwiXG4gICAgICAgIH1cbiAgICAgICAgY29kZSArPSBgdmFyIHJvdyR7aXh9ID0gZnVuYyR7aXh9KCR7cHJldn0ke3RoaXMuY29tcGlsZVBhcmFtU3RyaW5nKHJvb3QuaW5mbywgcm9vdC5hcmdzLCByb290LnVucHJvamVjdGVkKX0pO1xcbmA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcImZ1bmN0aW9uQ2FsbE11bHRpUmV0dXJuXCI6XG4gICAgICAgIHZhciBpeCA9IHJvb3QuaXg7XG4gICAgICAgIGNvZGUgKz0gYHZhciByb3dzJHtpeH0gPSBmdW5jJHtpeH0oJHt0aGlzLmNvbXBpbGVQYXJhbVN0cmluZyhyb290LmluZm8sIHJvb3QuYXJncyl9KTtcXG5gO1xuICAgICAgICBjb2RlICs9IGBmb3IodmFyIGZ1bmNSZXN1bHRJeCR7aXh9ID0gMCwgZnVuY0xlbiR7aXh9ID0gcm93cyR7aXh9Lmxlbmd0aDsgZnVuY1Jlc3VsdEl4JHtpeH0gPCBmdW5jTGVuJHtpeH07IGZ1bmNSZXN1bHRJeCR7aXh9KyspIHtcXG5gXG4gICAgICAgIGNvZGUgKz0gYHZhciByb3cke2l4fSA9IHJvd3Mke2l4fVtmdW5jUmVzdWx0SXgke2l4fV07XFxuYDtcbiAgICAgICAgZm9yKHZhciBjaGlsZCBvZiByb290LmNoaWxkcmVuKSB7XG4gICAgICAgICAgY29kZSArPSB0aGlzLmNvbXBpbGVBU1QoY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gXCJ9XFxuXCI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInNlbGVjdFwiOlxuICAgICAgICB2YXIgaXggPSByb290Lml4O1xuICAgICAgICBpZihyb290LmpvaW4pIHtcbiAgICAgICAgICBmb3IobGV0IGtleSBpbiByb290LmpvaW4pIHtcbiAgICAgICAgICAgIGxldCBtYXBwaW5nID0gcm9vdC5qb2luW2tleV07XG4gICAgICAgICAgICBpZihtYXBwaW5nLmNvbnN0cnVjdG9yID09PSBBcnJheSkge1xuICAgICAgICAgICAgICBsZXQgW3RhYmxlSXgsIHZhbHVlXSA9IG1hcHBpbmc7XG4gICAgICAgICAgICAgIGNvZGUgKz0gYHF1ZXJ5JHtpeH1bJyR7a2V5fSddID0gcm93JHt0YWJsZUl4fVsnJHt2YWx1ZX0nXTtcXG5gO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY29kZSArPSBgcXVlcnkke2l4fVsnJHtrZXl9J10gPSAke0pTT04uc3RyaW5naWZ5KG1hcHBpbmcpfTtcXG5gO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb2RlICs9IGB2YXIgcm93cyR7aXh9ID0gaXhlci5mYWN0VG9JbmRleChpeGVyLnRhYmxlKCcke3Jvb3QudGFibGV9JyksIHF1ZXJ5JHtpeH0pO1xcbmA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29kZSArPSBgdmFyIHJvd3Mke2l4fSA9IGl4ZXIudGFibGUoJyR7cm9vdC50YWJsZX0nKS50YWJsZTtcXG5gO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFyb290Lm5lZ2F0ZWQpIHtcbiAgICAgICAgICBjb2RlICs9IGBmb3IodmFyIHJvd0l4JHtpeH0gPSAwLCByb3dzTGVuJHtpeH0gPSByb3dzJHtpeH0ubGVuZ3RoOyByb3dJeCR7aXh9IDwgcm93c0xlbiR7aXh9OyByb3dJeCR7aXh9KyspIHtcXG5gXG4gICAgICAgICAgY29kZSArPSBgdmFyIHJvdyR7aXh9ID0gcm93cyR7aXh9W3Jvd0l4JHtpeH1dO1xcbmA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29kZSArPSBgaWYoIXJvd3Mke2l4fS5sZW5ndGgpIHtcXG5gXG4gICAgICAgIH1cbiAgICAgICAgZm9yKHZhciBjaGlsZCBvZiByb290LmNoaWxkcmVuKSB7XG4gICAgICAgICAgY29kZSArPSB0aGlzLmNvbXBpbGVBU1QoY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gXCJ9XFxuXCI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInJlc3VsdFwiOlxuICAgICAgICB2YXIgcmVzdWx0cyA9IFtdO1xuICAgICAgICBmb3IodmFyIHJlc3VsdCBvZiByb290LnJlc3VsdHMpIHtcbiAgICAgICAgICBpZihyZXN1bHQudHlwZSA9PT0gXCJwbGFjZWhvbGRlclwiKSB7XG4gICAgICAgICAgICByZXN1bHRzLnB1c2goXCJ1bmRlZmluZWRcIik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBpeCA9IHJlc3VsdC5peDtcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaChgcm93JHtpeH1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY29kZSArPSBgdW5wcm9qZWN0ZWQucHVzaCgke3Jlc3VsdHMuam9pbihcIiwgXCIpfSk7XFxuYDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwic29ydFwiOlxuICAgICAgICBjb2RlICs9IGdlbmVyYXRlVW5wcm9qZWN0ZWRTb3J0ZXJDb2RlKHJvb3Quc2l6ZSwgcm9vdC5zb3J0cykrXCJcXG5cIjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwiYWdncmVnYXRlIGxvb3BcIjpcbiAgICAgICAgdmFyIHByb2plY3Rpb24gPSBcIlwiO1xuICAgICAgICB2YXIgYWdncmVnYXRlQ2FsbHMgPSBbXTtcbiAgICAgICAgdmFyIGFnZ3JlZ2F0ZVN0YXRlcyA9IFtdO1xuICAgICAgICB2YXIgYWdncmVnYXRlUmVzZXRzID0gW107XG4gICAgICAgIHZhciB1bnByb2plY3RlZCA9IHt9O1xuICAgICAgICB2YXIgb3JkaW5hbDpzdHJpbmd8Ym9vbGVhbiA9IGZhbHNlO1xuICAgICAgICBmb3IobGV0IGFnZyBvZiByb290LmNoaWxkcmVuKSB7XG4gICAgICAgICAgaWYoYWdnLnR5cGUgPT09IFwiZnVuY3Rpb25DYWxsXCIpIHtcbiAgICAgICAgICAgIHVucHJvamVjdGVkW2FnZy5peF0gPSB0cnVlO1xuICAgICAgICAgICAgbGV0IGNvbXBpbGVkID0gdGhpcy5jb21waWxlQVNUKGFnZyk7XG4gICAgICAgICAgICBjb21waWxlZCArPSBgXFxudW5wcm9qZWN0ZWRbaXggKyAke2FnZy5yZXN1bHRzSXh9XSA9IHJvdyR7YWdnLml4fTtcXG5gO1xuICAgICAgICAgICAgYWdncmVnYXRlQ2FsbHMucHVzaChjb21waWxlZCk7XG4gICAgICAgICAgICBhZ2dyZWdhdGVTdGF0ZXMucHVzaChgdmFyIHJvdyR7YWdnLml4fSA9IHt9O2ApO1xuICAgICAgICAgICAgYWdncmVnYXRlUmVzZXRzLnB1c2goYHJvdyR7YWdnLml4fSA9IHt9O2ApO1xuICAgICAgICAgIH0gZWxzZSBpZihhZ2cudHlwZSA9PT0gXCJwcm9qZWN0aW9uXCIpIHtcbiAgICAgICAgICAgIGFnZy51bnByb2plY3RlZCA9IHVucHJvamVjdGVkO1xuICAgICAgICAgICAgcHJvamVjdGlvbiA9IHRoaXMuY29tcGlsZUFTVChhZ2cpO1xuICAgICAgICAgIH0gZWxzZSBpZihhZ2cudHlwZSA9PT0gXCJvcmRpbmFsXCIpIHtcbiAgICAgICAgICAgIG9yZGluYWwgPSBgdW5wcm9qZWN0ZWRbaXgrJHt0aGlzLnVucHJvamVjdGVkU2l6ZSAtIDF9XSA9IHJlc3VsdENvdW50O1xcbmA7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBkaWZmZXJlbnRHcm91cENoZWNrcyA9IFtdO1xuICAgICAgICB2YXIgZ3JvdXBDaGVjayA9IGBmYWxzZWA7XG4gICAgICAgIGlmKHJvb3QuZ3JvdXBzKSB7XG4gICAgICAgICAgZm9yKGxldCBncm91cCBvZiByb290Lmdyb3Vwcykge1xuICAgICAgICAgICAgbGV0IFt0YWJsZSwgZmllbGRdID0gZ3JvdXA7XG4gICAgICAgICAgICBkaWZmZXJlbnRHcm91cENoZWNrcy5wdXNoKGB1bnByb2plY3RlZFtuZXh0SXggKyAke3RhYmxlfV1bJyR7ZmllbGR9J10gIT09IHVucHJvamVjdGVkW2l4ICsgJHt0YWJsZX1dWycke2ZpZWxkfSddYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGdyb3VwQ2hlY2sgPSBgKCR7ZGlmZmVyZW50R3JvdXBDaGVja3Muam9pbihcIiB8fCBcIil9KWA7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcmVzdWx0c0NoZWNrID0gXCJcIjtcbiAgICAgICAgaWYocm9vdC5saW1pdCAmJiByb290LmxpbWl0LnJlc3VsdHMpIHtcbiAgICAgICAgICByZXN1bHRzQ2hlY2sgPSBgaWYocmVzdWx0Q291bnQgPT09ICR7cm9vdC5saW1pdC5yZXN1bHRzfSkgYnJlYWs7YDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZ3JvdXBMaW1pdENoZWNrID0gXCJcIjtcbiAgICAgICAgaWYocm9vdC5saW1pdCAmJiByb290LmxpbWl0LnBlckdyb3VwICYmIHJvb3QuZ3JvdXBzKSB7XG4gICAgICAgICAgZ3JvdXBMaW1pdENoZWNrID0gYGlmKHBlckdyb3VwQ291bnQgPT09ICR7cm9vdC5saW1pdC5wZXJHcm91cH0pIHtcbiAgICAgICAgICAgIHdoaWxlKCFkaWZmZXJlbnRHcm91cCkge1xuICAgICAgICAgICAgICBuZXh0SXggKz0gJHtyb290LnNpemV9O1xuICAgICAgICAgICAgICBpZihuZXh0SXggPj0gbGVuKSBicmVhaztcbiAgICAgICAgICAgICAgZ3JvdXBJbmZvW25leHRJeF0gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgIGRpZmZlcmVudEdyb3VwID0gJHtncm91cENoZWNrfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9YDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZ3JvdXBEaWZmZXJlbmNlID0gXCJcIjtcbiAgICAgICAgdmFyIGdyb3VwSW5mbyA9IFwiXCI7XG4gICAgICAgIGlmKHRoaXMuZ3JvdXBzKSB7XG4gICAgICAgICAgZ3JvdXBEaWZmZXJlbmNlID0gYFxuICAgICAgICAgIHBlckdyb3VwQ291bnQrK1xuICAgICAgICAgIHZhciBkaWZmZXJlbnRHcm91cCA9ICR7Z3JvdXBDaGVja307XG4gICAgICAgICAgJHtncm91cExpbWl0Q2hlY2t9XG4gICAgICAgICAgaWYoZGlmZmVyZW50R3JvdXApIHtcbiAgICAgICAgICAgICR7cHJvamVjdGlvbn1cbiAgICAgICAgICAgICR7YWdncmVnYXRlUmVzZXRzLmpvaW4oXCJcXG5cIil9XG4gICAgICAgICAgICBwZXJHcm91cENvdW50ID0gMDtcbiAgICAgICAgICAgIHJlc3VsdENvdW50Kys7XG4gICAgICAgICAgfVxcbmA7XG4gICAgICAgICAgZ3JvdXBJbmZvID0gXCJncm91cEluZm9baXhdID0gcmVzdWx0Q291bnQ7XCI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZ3JvdXBEaWZmZXJlbmNlID0gXCJyZXN1bHRDb3VudCsrO1xcblwiO1xuICAgICAgICAgIGdyb3VwSW5mbyA9IFwiZ3JvdXBJbmZvW2l4XSA9IDA7XCJcbiAgICAgICAgfVxuICAgICAgICAvLyBpZiB0aGVyZSBhcmUgbmVpdGhlciBhZ2dyZWdhdGVzIHRvIGNhbGN1bGF0ZSBub3IgZ3JvdXBzIHRvIGJ1aWxkLFxuICAgICAgICAvLyB0aGVuIHdlIGp1c3QgbmVlZCB0byB3b3JyeSBhYm91dCBsaW1pdGluZ1xuICAgICAgICBpZighdGhpcy5ncm91cHMgJiYgYWdncmVnYXRlQ2FsbHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgY29kZSA9IGB2YXIgaXggPSAwO1xuICAgICAgICAgICAgICAgICAgdmFyIHJlc3VsdENvdW50ID0gMDtcbiAgICAgICAgICAgICAgICAgIHZhciBsZW4gPSB1bnByb2plY3RlZC5sZW5ndGg7XG4gICAgICAgICAgICAgICAgICB3aGlsZShpeCA8IGxlbikge1xuICAgICAgICAgICAgICAgICAgICAke3Jlc3VsdHNDaGVja31cbiAgICAgICAgICAgICAgICAgICAgJHtvcmRpbmFsIHx8IFwiXCJ9XG4gICAgICAgICAgICAgICAgICAgICR7cHJvamVjdGlvbn1cbiAgICAgICAgICAgICAgICAgICAgZ3JvdXBJbmZvW2l4XSA9IHJlc3VsdENvdW50O1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRDb3VudCsrO1xuICAgICAgICAgICAgICAgICAgICBpeCArPSAke3Jvb3Quc2l6ZX07XG4gICAgICAgICAgICAgICAgICB9XFxuYDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb2RlID0gYHZhciByZXN1bHRDb3VudCA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIHBlckdyb3VwQ291bnQgPSAwO1xuICAgICAgICAgICAgICAgIHZhciBpeCA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIG5leHRJeCA9IDA7XG4gICAgICAgICAgICAgICAgdmFyIGxlbiA9IHVucHJvamVjdGVkLmxlbmd0aDtcbiAgICAgICAgICAgICAgICAke2FnZ3JlZ2F0ZVN0YXRlcy5qb2luKFwiXFxuXCIpfVxuICAgICAgICAgICAgICAgIHdoaWxlKGl4IDwgbGVuKSB7XG4gICAgICAgICAgICAgICAgICAke2FnZ3JlZ2F0ZUNhbGxzLmpvaW4oXCJcIil9XG4gICAgICAgICAgICAgICAgICAke2dyb3VwSW5mb31cbiAgICAgICAgICAgICAgICAgICR7b3JkaW5hbCB8fCBcIlwifVxuICAgICAgICAgICAgICAgICAgaWYoaXggKyAke3Jvb3Quc2l6ZX0gPT09IGxlbikge1xuICAgICAgICAgICAgICAgICAgICAke3Byb2plY3Rpb259XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgbmV4dEl4ICs9ICR7cm9vdC5zaXplfTtcbiAgICAgICAgICAgICAgICAgICR7Z3JvdXBEaWZmZXJlbmNlfVxuICAgICAgICAgICAgICAgICAgJHtyZXN1bHRzQ2hlY2t9XG4gICAgICAgICAgICAgICAgICBpeCA9IG5leHRJeDtcbiAgICAgICAgICAgICAgICB9XFxuYDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwicHJvamVjdGlvblwiOlxuICAgICAgICB2YXIgcHJvamVjdGVkVmFycyA9IFtdO1xuICAgICAgICBmb3IobGV0IG5ld0ZpZWxkIGluIHJvb3QucHJvamVjdGlvbk1hcCkge1xuICAgICAgICAgIGxldCBtYXBwaW5nID0gcm9vdC5wcm9qZWN0aW9uTWFwW25ld0ZpZWxkXTtcbiAgICAgICAgICBsZXQgdmFsdWUgPSBcIlwiO1xuICAgICAgICAgIGlmKG1hcHBpbmcuY29uc3RydWN0b3IgPT09IEFycmF5KSB7XG4gICAgICAgICAgICBpZihtYXBwaW5nWzFdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSBgdW5wcm9qZWN0ZWRbaXggKyAke21hcHBpbmdbMF19XWA7XG4gICAgICAgICAgICB9IGVsc2UgaWYoIXJvb3QudW5wcm9qZWN0ZWQgfHwgcm9vdC51bnByb2plY3RlZFttYXBwaW5nWzBdXSkge1xuICAgICAgICAgICAgICB2YWx1ZSA9IGByb3cke21hcHBpbmdbMF19Wycke21hcHBpbmdbMV19J11gO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdmFsdWUgPSBgdW5wcm9qZWN0ZWRbaXggKyAke21hcHBpbmdbMF19XVsnJHttYXBwaW5nWzFdfSddYDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFsdWUgPSBKU09OLnN0cmluZ2lmeShtYXBwaW5nKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcHJvamVjdGVkVmFycy5wdXNoKGAnJHtuZXdGaWVsZH0nOiAke3ZhbHVlfWApO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gYHJlc3VsdHMucHVzaCh7ICR7cHJvamVjdGVkVmFycy5qb2luKFwiLCBcIil9IH0pO1xcbmA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInJldHVyblwiOlxuICAgICAgICB2YXIgcmV0dXJucyA9IFtdO1xuICAgICAgICBmb3IobGV0IGN1clZhciBvZiByb290LnZhcnMpIHtcbiAgICAgICAgICByZXR1cm5zLnB1c2goYCR7Y3VyVmFyfTogJHtjdXJWYXJ9YCk7XG4gICAgICAgIH1cbiAgICAgICAgY29kZSArPSBgcmV0dXJuIHske3JldHVybnMuam9pbihcIiwgXCIpfX07YDtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBjb2RlO1xuICB9XG4gIGNvbXBpbGUoKSB7XG4gICAgbGV0IGFzdCA9IHRoaXMudG9BU1QoKTtcbiAgICBsZXQgY29kZSA9IHRoaXMuY29tcGlsZUFTVChhc3QpO1xuICAgIHRoaXMuY29tcGlsZWQgPSBuZXcgRnVuY3Rpb24oXCJpeGVyXCIsIFwiUXVlcnlGdW5jdGlvbnNcIiwgY29kZSk7XG4gICAgdGhpcy5kaXJ0eSA9IGZhbHNlO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGV4ZWMoKSB7XG4gICAgaWYodGhpcy5kaXJ0eSkge1xuICAgICAgdGhpcy5jb21waWxlKCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNvbXBpbGVkKHRoaXMuaXhlciwgUXVlcnlGdW5jdGlvbnMpO1xuICB9XG4gIGRlYnVnKCkge1xuICAgIGNvbnNvbGUubG9nKHRoaXMuY29tcGlsZUFTVCh0aGlzLnRvQVNUKCkpKTtcbiAgICBjb25zb2xlLnRpbWUoXCJleGVjXCIpO1xuICAgIHZhciByZXN1bHRzID0gdGhpcy5leGVjKCk7XG4gICAgY29uc29sZS50aW1lRW5kKFwiZXhlY1wiKTtcbiAgICBjb25zb2xlLmxvZyhyZXN1bHRzKTtcbiAgICByZXR1cm4gcmVzdWx0cztcbiAgfVxufVxuXG5jbGFzcyBVbmlvbiB7XG4gIG5hbWU7XG4gIHRhYmxlcztcbiAgc291cmNlcztcbiAgaXNTdGF0ZWZ1bDtcbiAgaGFzaGVyO1xuICBkaXJ0eTtcbiAgcHJldjtcbiAgY29tcGlsZWQ7XG4gIGl4ZXI7XG4gIGNvbnN0cnVjdG9yKGl4ZXIsIG5hbWUgPSBcInVua25vd25cIikge1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgdGhpcy5peGVyID0gaXhlcjtcbiAgICB0aGlzLnRhYmxlcyA9IFtdO1xuICAgIHRoaXMuc291cmNlcyA9IFtdO1xuICAgIHRoaXMuaXNTdGF0ZWZ1bCA9IGZhbHNlO1xuICAgIHRoaXMucHJldiA9IHtyZXN1bHRzOiBbXSwgaGFzaGVzOiB7fX07XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gIH1cbiAgc3RhdGVmdWwoKSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgdGhpcy5pc1N0YXRlZnVsID0gdHJ1ZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBlbnN1cmVIYXNoZXIobWFwcGluZykge1xuICAgIGlmKCF0aGlzLmhhc2hlcikge1xuICAgICAgdGhpcy5oYXNoZXIgPSBnZW5lcmF0ZVN0cmluZ0ZuKE9iamVjdC5rZXlzKG1hcHBpbmcpKTtcbiAgICB9XG4gIH1cbiAgdW5pb24odGFibGVOYW1lLCBtYXBwaW5nKSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgdGhpcy5lbnN1cmVIYXNoZXIobWFwcGluZyk7XG4gICAgdGhpcy50YWJsZXMucHVzaCh0YWJsZU5hbWUpO1xuICAgIHRoaXMuc291cmNlcy5wdXNoKHt0eXBlOiBcIitcIiwgdGFibGU6IHRhYmxlTmFtZSwgbWFwcGluZ30pO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIHVudW5pb24odGFibGVOYW1lLCBtYXBwaW5nKSB7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgdGhpcy5lbnN1cmVIYXNoZXIobWFwcGluZyk7XG4gICAgdGhpcy50YWJsZXMucHVzaCh0YWJsZU5hbWUpO1xuICAgIHRoaXMuc291cmNlcy5wdXNoKHt0eXBlOiBcIi1cIiwgdGFibGU6IHRhYmxlTmFtZSwgbWFwcGluZ30pO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIHRvQVNUKCkge1xuICAgIGxldCByb290ID0ge3R5cGU6IFwidW5pb25cIiwgY2hpbGRyZW46IFtdfTtcbiAgICByb290LmNoaWxkcmVuLnB1c2goe3R5cGU6IFwiZGVjbGFyYXRpb25cIiwgdmFyOiBcInJlc3VsdHNcIiwgdmFsdWU6IFwiW11cIn0pO1xuXG4gICAgbGV0IGhhc2hlc1ZhbHVlID0gXCJ7fVwiO1xuICAgIGlmKHRoaXMuaXNTdGF0ZWZ1bCkge1xuICAgICAgICBoYXNoZXNWYWx1ZSA9IFwicHJldkhhc2hlc1wiO1xuICAgIH1cbiAgICByb290LmNoaWxkcmVuLnB1c2goe3R5cGU6IFwiZGVjbGFyYXRpb25cIiwgdmFyOiBcImhhc2hlc1wiLCB2YWx1ZTogaGFzaGVzVmFsdWV9KTtcblxuICAgIGxldCBpeCA9IDA7XG4gICAgZm9yKGxldCBzb3VyY2Ugb2YgdGhpcy5zb3VyY2VzKSB7XG4gICAgICBsZXQgYWN0aW9uO1xuICAgICAgaWYoc291cmNlLnR5cGUgPT09IFwiK1wiKSB7XG4gICAgICAgIGFjdGlvbiA9IHt0eXBlOiBcInJlc3VsdFwiLCBpeH07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhY3Rpb24gPSB7dHlwZTogXCJyZW1vdmVSZXN1bHRcIiwgaXh9O1xuICAgICAgfVxuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKHtcbiAgICAgICAgdHlwZTogXCJzb3VyY2VcIixcbiAgICAgICAgaXgsXG4gICAgICAgIHRhYmxlOiBzb3VyY2UudGFibGUsXG4gICAgICAgIG1hcHBpbmc6IHNvdXJjZS5tYXBwaW5nLFxuICAgICAgICBjaGlsZHJlbjogW2FjdGlvbl0sXG4gICAgICB9KTtcbiAgICAgIGl4Kys7XG4gICAgfVxuICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJoYXNoZXNUb1Jlc3VsdHNcIn0pO1xuICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7dHlwZTogXCJyZXR1cm5cIiwgdmFyczogW1wicmVzdWx0c1wiLCBcImhhc2hlc1wiXX0pO1xuICAgIHJldHVybiByb290O1xuICB9XG4gIGNvbXBpbGVBU1Qocm9vdCkge1xuICAgIGxldCBjb2RlID0gXCJcIjtcbiAgICBsZXQgdHlwZSA9IHJvb3QudHlwZTtcbiAgICBzd2l0Y2godHlwZSkge1xuICAgICAgY2FzZSBcInVuaW9uXCI6XG4gICAgICAgIGZvcih2YXIgY2hpbGQgb2Ygcm9vdC5jaGlsZHJlbikge1xuICAgICAgICAgIGNvZGUgKz0gdGhpcy5jb21waWxlQVNUKGNoaWxkKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJkZWNsYXJhdGlvblwiOlxuICAgICAgICBjb2RlICs9IGB2YXIgJHtyb290LnZhcn0gPSAke3Jvb3QudmFsdWV9O1xcbmA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInNvdXJjZVwiOlxuICAgICAgICB2YXIgaXggPSByb290Lml4O1xuICAgICAgICBsZXQgbWFwcGluZ0l0ZW1zID0gW107XG4gICAgICAgIGZvcihsZXQga2V5IGluIHJvb3QubWFwcGluZykge1xuICAgICAgICAgIGxldCBtYXBwaW5nID0gcm9vdC5tYXBwaW5nW2tleV07XG4gICAgICAgICAgbGV0IHZhbHVlO1xuICAgICAgICAgIGlmKG1hcHBpbmcuY29uc3RydWN0b3IgPT09IEFycmF5ICYmIG1hcHBpbmcubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICBsZXQgW2ZpZWxkXSA9IG1hcHBpbmc7XG4gICAgICAgICAgICB2YWx1ZSA9IGBzb3VyY2VSb3cke2l4fVsnJHtmaWVsZH0nXWA7XG4gICAgICAgICAgfSBlbHNlIGlmKG1hcHBpbmcuY29uc3RydWN0b3IgPT09IEFycmF5ICYmIG1hcHBpbmcubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgICBsZXQgW18sIGZpZWxkXSA9IG1hcHBpbmc7XG4gICAgICAgICAgICB2YWx1ZSA9IGBzb3VyY2VSb3cke2l4fVsnJHtmaWVsZH0nXWA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlID0gSlNPTi5zdHJpbmdpZnkobWFwcGluZyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIG1hcHBpbmdJdGVtcy5wdXNoKGAnJHtrZXl9JzogJHt2YWx1ZX1gKVxuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gYHZhciBzb3VyY2VSb3dzJHtpeH0gPSBpeGVyLnRhYmxlKCcke3Jvb3QudGFibGV9JykudGFibGU7XFxuYDtcbiAgICAgICAgY29kZSArPSBgZm9yKHZhciByb3dJeCR7aXh9ID0gMCwgcm93c0xlbiR7aXh9ID0gc291cmNlUm93cyR7aXh9Lmxlbmd0aDsgcm93SXgke2l4fSA8IHJvd3NMZW4ke2l4fTsgcm93SXgke2l4fSsrKSB7XFxuYFxuICAgICAgICBjb2RlICs9IGB2YXIgc291cmNlUm93JHtpeH0gPSBzb3VyY2VSb3dzJHtpeH1bcm93SXgke2l4fV07XFxuYDtcbiAgICAgICAgY29kZSArPSBgdmFyIG1hcHBlZFJvdyR7aXh9ID0geyR7bWFwcGluZ0l0ZW1zLmpvaW4oXCIsIFwiKX19O1xcbmBcbiAgICAgICAgZm9yKHZhciBjaGlsZCBvZiByb290LmNoaWxkcmVuKSB7XG4gICAgICAgICAgY29kZSArPSB0aGlzLmNvbXBpbGVBU1QoY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGNvZGUgKz0gXCJ9XFxuXCI7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcInJlc3VsdFwiOlxuICAgICAgICB2YXIgaXggPSByb290Lml4O1xuICAgICAgICBjb2RlICs9IGBoYXNoZXNbaGFzaGVyKG1hcHBlZFJvdyR7aXh9KV0gPSBtYXBwZWRSb3cke2l4fTtcXG5gO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJyZW1vdmVSZXN1bHRcIjpcbiAgICAgICAgdmFyIGl4ID0gcm9vdC5peDtcbiAgICAgICAgY29kZSArPSBgaGFzaGVzW2hhc2hlcihtYXBwZWRSb3cke2l4fSldID0gZmFsc2U7XFxuYDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwiaGFzaGVzVG9SZXN1bHRzXCI6XG4gICAgICAgIGNvZGUgKz0gXCJ2YXIgaGFzaEtleXMgPSBPYmplY3Qua2V5cyhoYXNoZXMpO1xcblwiO1xuICAgICAgICBjb2RlICs9IFwiZm9yKHZhciBoYXNoS2V5SXggPSAwLCBoYXNoS2V5TGVuID0gaGFzaEtleXMubGVuZ3RoOyBoYXNoS2V5SXggPCBoYXNoS2V5TGVuOyBoYXNoS2V5SXgrKykge1xcblwiO1xuICAgICAgICBjb2RlICs9IFwidmFyIHZhbHVlID0gaGFzaGVzW2hhc2hLZXlzW2hhc2hLZXlJeF1dO1xcblwiO1xuICAgICAgICBjb2RlICs9IFwiaWYodmFsdWUgIT09IGZhbHNlKSB7XFxuXCI7XG4gICAgICAgIGNvZGUgKz0gXCJyZXN1bHRzLnB1c2godmFsdWUpO1xcblwiXG4gICAgICAgIGNvZGUgKz0gXCJ9XFxuXCJcbiAgICAgICAgY29kZSArPSBcIn1cXG5cIlxuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJyZXR1cm5cIjpcbiAgICAgICAgY29kZSArPSBgcmV0dXJuIHske3Jvb3QudmFycy5qb2luKFwiLCBcIil9fTtgO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgcmV0dXJuIGNvZGU7XG4gIH1cbiAgY29tcGlsZSgpIHtcbiAgICBsZXQgYXN0ID0gdGhpcy50b0FTVCgpO1xuICAgIGxldCBjb2RlID0gdGhpcy5jb21waWxlQVNUKGFzdCk7XG4gICAgdGhpcy5jb21waWxlZCA9IG5ldyBGdW5jdGlvbihcIml4ZXJcIiwgXCJoYXNoZXJcIiwgXCJwcmV2SGFzaGVzXCIsIGNvZGUpO1xuICAgIHRoaXMuZGlydHkgPSBmYWxzZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICBkZWJ1ZygpIHtcbiAgICBsZXQgY29kZSA9IHRoaXMuY29tcGlsZUFTVCh0aGlzLnRvQVNUKCkpO1xuICAgIGNvbnNvbGUubG9nKGNvZGUpO1xuICAgIHJldHVybiBjb2RlO1xuICB9XG4gIGV4ZWMoKSB7XG4gICAgaWYodGhpcy5kaXJ0eSkge1xuICAgICAgdGhpcy5jb21waWxlKCk7XG4gICAgfVxuICAgIGxldCByZXN1bHRzID0gdGhpcy5jb21waWxlZCh0aGlzLml4ZXIsIHRoaXMuaGFzaGVyLCB0aGlzLnByZXYuaGFzaGVzKTtcbiAgICB0aGlzLnByZXYgPSByZXN1bHRzO1xuICAgIHJldHVybiByZXN1bHRzO1xuICB9XG5cbn1cblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyBBUElcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBjb25zdCBTVUNDRUVEID0gW3tzdWNjZXNzOiB0cnVlfV07XG5leHBvcnQgY29uc3QgRkFJTCA9IFtdO1xuXG5leHBvcnQgZnVuY3Rpb24gaW5kZXhlcigpIHtcbiAgcmV0dXJuIG5ldyBJbmRleGVyKCk7XG59XG4iXX0=
