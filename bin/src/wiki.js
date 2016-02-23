"use strict";
var app = require("./app");
var bootstrap = require("./bootstrap");
var ui = require("./ui");
var utils_1 = require("./utils");
app.renderRoots["wiki"] = ui.root;
// @HACK: we have to use bootstrap in some way to get it to actually be included and
// executed
var ixer = bootstrap.ixer;
function initSearches(eve) {
    for (var _i = 0, _a = eve.find("ui pane"); _i < _a.length; _i++) {
        var pane = _a[_i];
        if (eve.findOne("entity", { entity: pane.contains }))
            continue;
    }
}
app.init("wiki", function () {
    document.body.classList.add(localStorage["theme"] || "light");
    app.activeSearches = {};
    initSearches(app.eve);
    window.history.replaceState({ root: true }, null, window.location.hash);
    var mainPane = app.eve.findOne("ui pane", { pane: "p1" });
    var path = utils_1.location();
    var _a = path.split("/"), _ = _a[0], kind = _a[1], _b = _a[2], raw = _b === void 0 ? "" : _b;
    var content = utils_1.deslugify(raw) || "home";
    var cur = app.dispatch("set pane", { paneId: mainPane.pane, contains: content });
    if (content && !app.eve.findOne("query to id", { query: content })) {
        cur.dispatch("insert query", { query: content });
    }
    cur.commit();
});
window.addEventListener("hashchange", function () {
    var mainPane = app.eve.findOne("ui pane", { pane: "p1" });
    var path = utils_1.location();
    var _a = path.split("/"), _ = _a[0], kind = _a[1], _b = _a[2], raw = _b === void 0 ? "" : _b;
    var content = utils_1.deslugify(raw) || "home";
    content = ui.asEntity(content) || content;
    if (mainPane.contains === content)
        return;
    var cur = app.dispatch("set pane", { paneId: mainPane.pane, contains: content });
    if (content && !app.eve.findOne("query to id", { query: content })) {
        cur.dispatch("insert query", { query: content });
    }
    cur.commit();
});
//# sourceMappingURL=wiki.js.map