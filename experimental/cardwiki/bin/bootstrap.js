var utils_1 = require("./utils");
var runtime = require("./runtime");
var wiki = require("./wiki");
var app = require("./app");
var app_1 = require("./app");
var parser_1 = require("./parser");
var uiRenderer_1 = require("./uiRenderer");
exports.ixer = app_1.eve;
//-----------------------------------------------------------------------------
// Utilities
//-----------------------------------------------------------------------------
function queryFromSearch(search) {
    var result = wiki.newSearch(search);
    result.query.ordinal();
    return result.query;
}
function queryFromPlanDSL(str) {
    return wiki.planToQuery(parser_1.parsePlan(str));
}
exports.queryFromPlanDSL = queryFromPlanDSL;
function queryFromQueryDSL(ixer, str) {
    var plan = parser_1.parseQuery(str);
    var query = new runtime.Query(ixer);
    var ix = 0;
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        var id = step.id || step.type + "||" + ix;
        if (step.type === "select")
            query.select(step["view"], step["join"] || {}, step.id);
        else if (step.type === "deselect")
            query.deselect(step["view"], step["join"] || {});
        else if (step.type === "calculate")
            query.calculate(step["func"], step["args"], step.id);
        else if (step.type === "aggregate")
            query.aggregate(step["func"], step["args"], step.id);
        else if (step.type === "ordinal")
            query.ordinal();
        else if (step.type === "group")
            query.group(step["groups"]);
        else if (step.type === "sort")
            query.sort(step["sorts"]);
        else if (step.type === "limit")
            query.limit(step["limit"]);
        else if (step.type === "project")
            query.project(step["mapping"]);
        else
            throw new Error("Unknown query step type '" + step.type + "'");
    }
    return query;
}
exports.queryFromQueryDSL = queryFromQueryDSL;
function UIFromDSL(str) {
    function processElem(data) {
        var elem = new uiRenderer_1.UI(data.id || uuid());
        if (data.binding)
            elem.bind(queryFromPlanDSL(data.binding));
        if (data.embedded)
            elem.embed(data.embedded);
        if (data.attributes)
            elem.attributes(data.attributes);
        if (data.events)
            elem.events(data.events);
        if (data.children) {
            for (var _i = 0, _a = data.children; _i < _a.length; _i++) {
                var child = _a[_i];
                elem.child(processElem(child));
            }
        }
        return elem;
    }
    return processElem(parser_1.parseUI(str));
}
exports.UIFromDSL = UIFromDSL;
var BSPhase = (function () {
    function BSPhase(ixer, changeset) {
        if (changeset === void 0) { changeset = ixer.diff(); }
        this.ixer = ixer;
        this.changeset = changeset;
        this._views = {};
        this._viewFields = {};
        this._entities = [];
        this._uis = [];
    }
    BSPhase.prototype.viewKind = function (view) {
        return this._views[view];
    };
    BSPhase.prototype.viewFields = function (view) {
        return this._viewFields[view];
    };
    BSPhase.prototype.apply = function (nukeExisting) {
        for (var view in this._views) {
            if (this._views[view] === "table")
                exports.ixer.addTable(view, this.viewFields[view]);
        }
        if (nukeExisting) {
            for (var view in this._views) {
                if (this._views[view] !== "table") {
                    this.changeset.merge(runtime.Query.remove(view, this.ixer));
                }
            }
            for (var _i = 0, _a = this._entities; _i < _a.length; _i++) {
                var entity = _a[_i];
                this.changeset.remove("builtin entity", { entity: entity });
            }
            for (var _b = 0, _c = this._uis; _b < _c.length; _b++) {
                var ui = _c[_b];
                this.changeset.merge(uiRenderer_1.UI.remove(ui, this.ixer));
            }
        }
        exports.ixer.applyDiff(this.changeset);
    };
    //-----------------------------------------------------------------------------
    // Macros
    //-----------------------------------------------------------------------------
    BSPhase.prototype.addFact = function (table, fact) {
        this.changeset.add(table, fact);
        return this;
    };
    BSPhase.prototype.addEntity = function (entity, name, kinds, attributes, extraContent) {
        this._entities.push(entity);
        var content = (_a = ["\n      # ", " (", ")\n    "], _a.raw = ["\n      # ", " (", ")\n    "], utils_1.unpad(6)(_a, utils_1.titlecase(name), kinds.map(function (kind) { return ("{is a: " + kind + "}"); }).join(", ")));
        if (attributes) {
            content += "## Attributes\n";
            for (var attr in attributes)
                content += attr + ": {" + attr + ": " + attributes[attr] + "}\n      ";
        }
        if (extraContent)
            content += "\n" + extraContent;
        this.addFact("builtin entity", { entity: entity, content: content });
        return this;
        var _a;
    };
    BSPhase.prototype.addView = function (view, kind, fields) {
        this._views[view] = kind;
        this._viewFields[view] = fields;
        this.addFact("view", { view: view, kind: kind });
        for (var _i = 0; _i < fields.length; _i++) {
            var field = fields[_i];
            this.addFact("field", { view: view, field: field });
        }
        this.addEntity(view, view, ["system", kind], undefined, (_a = ["\n      ## Fields\n      ", "\n    "], _a.raw = ["\n      ## Fields\n      ", "\n    "], utils_1.unpad(6)(_a, fields.map(function (field) { return ("* " + field); }).join("\n      "))));
        return this;
        var _a;
    };
    BSPhase.prototype.addTable = function (view, fields) {
        this.addView(view, "table", fields);
        return this;
    };
    BSPhase.prototype.addUnion = function (view, fields, builtin) {
        if (builtin === void 0) { builtin = true; }
        this.addView(view, "union", fields);
        if (builtin) {
            var table = "builtin " + view;
            this.addTable(table, fields);
            this.addUnionMember(view, table);
        }
        return this;
    };
    BSPhase.prototype.addUnionMember = function (union, member, mapping) {
        // apply the natural mapping.
        if (!mapping) {
            if (this.viewKind(union) !== "union")
                throw new Error("Union '" + union + "' must be added before adding members");
            mapping = {};
            for (var _i = 0, _a = this.viewFields(union); _i < _a.length; _i++) {
                var field = _a[_i];
                mapping[field] = field;
            }
        }
        var action = union + " <-- " + member + " <-- " + JSON.stringify(mapping);
        this.addFact("action", { view: union, action: action, kind: "union", ix: 0 })
            .addFact("action source", { action: action, "source view": member });
        for (var field in mapping)
            this.addFact("action mapping", { action: action, from: field, "to source": member, "to field": mapping[field] });
        return this;
    };
    BSPhase.prototype.addQuery = function (view, query) {
        query.name = view;
        this.addView(view, "query", Object.keys(query.projectionMap || {}));
        this.changeset.merge(query.changeset(this.ixer));
        return this;
    };
    BSPhase.prototype.addUI = function (id, ui) {
        ui.id = id;
        this._uis.push(id);
        this.addEntity(id, id, ["system", "ui"]);
        this.changeset.merge(ui.changeset(this.ixer));
        return this;
    };
    return BSPhase;
})();
app.init("bootstrap", function bootstrap() {
    //-----------------------------------------------------------------------------
    // Entity System
    //-----------------------------------------------------------------------------
    var phase = new BSPhase(app_1.eve);
    phase.addTable("manual entity", ["entity", "content"]);
    phase.addTable("action entity", ["entity", "content", "source"]);
    phase.addEntity("collection", "collection", ["system"])
        .addEntity("system", "system", ["collection"])
        .addEntity("union", "union", ["system", "collection"])
        .addEntity("query", "query", ["system", "collection"])
        .addEntity("table", "table", ["system", "collection"])
        .addEntity("ui", "ui", ["system", "collection"]);
    phase.addUnion("entity", ["entity", "content"], false)
        .addUnionMember("entity", "manual entity")
        .addUnionMember("entity", "action entity")
        .addUnionMember("entity", "unmodified added bits")
        .addUnionMember("entity", "automatic collection entities")
        .addTable("builtin entity", ["entity", "content"])
        .addQuery("unmodified builtin entities", queryFromQueryDSL(phase.ixer, (_a = ["\n      select builtin entity as [builtin]\n      deselect manual entity {entity: [builtin, entity]}\n      deselect action entity {entity: [builtin, entity]}\n      project {entity: [builtin, entity]; content: [builtin, content]}\n    "], _a.raw = ["\n      select builtin entity as [builtin]\n      deselect manual entity {entity: [builtin, entity]}\n      deselect action entity {entity: [builtin, entity]}\n      project {entity: [builtin, entity]; content: [builtin, content]}\n    "], utils_1.unpad(4)(_a))))
        .addUnionMember("entity", "unmodified builtin entities");
    phase.addQuery("unmodified added bits", queryFromQueryDSL(phase.ixer, (_b = ["\n    select added bits as [added]\n    deselect manual entity {entity: [added, entity]}\n    project {entity: [added, entity]; content: [added, content]}\n  "], _b.raw = ["\n    select added bits as [added]\n    deselect manual entity {entity: [added, entity]}\n    project {entity: [added, entity]; content: [added, content]}\n  "], utils_1.unpad(4)(_b))));
    phase.addQuery("parsed eavs", queryFromQueryDSL(phase.ixer, (_c = ["\n    select entity as [entity]\n    calculate parse eavs {entity: [entity, entity]; text: [entity, content]} as [parsed]\n    project {entity: [entity, entity]; attribute: [parsed, attribute]; value: [parsed, value]}\n  "], _c.raw = ["\n    select entity as [entity]\n    calculate parse eavs {entity: [entity, entity]; text: [entity, content]} as [parsed]\n    project {entity: [entity, entity]; attribute: [parsed, attribute]; value: [parsed, value]}\n  "], utils_1.unpad(4)(_c))));
    phase.addUnion("entity eavs", ["entity", "attribute", "value"])
        .addUnionMember("entity eavs", "parsed eavs")
        .addUnionMember("entity eavs", "added eavs");
    phase.addQuery("is a attributes", queryFromQueryDSL(phase.ixer, (_d = ["\n    select entity eavs {attribute: is a} as [is a]\n    project {collection: [is a, value]; entity: [is a, entity]}\n  "], _d.raw = ["\n    select entity eavs {attribute: is a} as [is a]\n    project {collection: [is a, value]; entity: [is a, entity]}\n  "], utils_1.unpad(4)(_d))));
    // @HACK: this view is required because you can't currently join a select on the result of a function.
    // so we create a version of the eavs table that already has everything lowercased.
    phase.addQuery("lowercase eavs", queryFromQueryDSL(phase.ixer, (_e = ["\n    select entity eavs as [eav]\n    calculate lowercase {text: [eav, value]} as [lower]\n    project {entity: [eav, entity];  attribute: [eav, attribute]; value: [lower, result]}\n  "], _e.raw = ["\n    select entity eavs as [eav]\n    calculate lowercase {text: [eav, value]} as [lower]\n    project {entity: [eav, entity];  attribute: [eav, attribute]; value: [lower, result]}\n  "], utils_1.unpad(4)(_e))));
    phase.addQuery("entity links", queryFromQueryDSL(phase.ixer, (_f = ["\n    select lowercase eavs as [eav]\n    select entity {entity: [eav, value]} as [entity]\n    project {entity: [eav, entity]; link: [entity, entity]; type: [eav, attribute]}\n  "], _f.raw = ["\n    select lowercase eavs as [eav]\n    select entity {entity: [eav, value]} as [entity]\n    project {entity: [eav, entity]; link: [entity, entity]; type: [eav, attribute]}\n  "], utils_1.unpad(4)(_f))));
    phase.addUnion("directionless links", ["entity", "link"])
        .addUnionMember("directionless links", "entity links")
        .addUnionMember("directionless links", "entity links", { entity: "link", link: "entity" });
    phase.addUnion("collection entities", ["entity", "collection"])
        .addUnionMember("collection entities", "is a attributes")
        .addUnionMember("collection entities", "added collections");
    phase.addQuery("collection", queryFromQueryDSL(phase.ixer, (_g = ["\n    select collection entities as [coll]\n    group {[coll, collection]}\n    aggregate count as [count]\n    project {collection: [coll, collection]; count: [count, count]}\n  "], _g.raw = ["\n    select collection entities as [coll]\n    group {[coll, collection]}\n    aggregate count as [count]\n    project {collection: [coll, collection]; count: [count, count]}\n  "], utils_1.unpad(4)(_g))));
    phase.addQuery("automatic collection entities", queryFromQueryDSL(phase.ixer, (_h = ["\n    select collection as [coll]\n    deselect manual entity {entity: [coll, collection]}\n    deselect builtin entity {entity: [coll, collection]}\n    calculate collection content {collection: [coll, collection]} as [content]\n    project {entity: [coll, collection]; content: [content,content]}\n  "], _h.raw = ["\n    select collection as [coll]\n    deselect manual entity {entity: [coll, collection]}\n    deselect builtin entity {entity: [coll, collection]}\n    calculate collection content {collection: [coll, collection]} as [content]\n    project {entity: [coll, collection]; content: [content,content]}\n  "], utils_1.unpad(4)(_h))));
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // UI
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    // @FIXME: These should probably be unionized.
    function resolve(table, fields) {
        return fields.map(function (field) { return (table + ": " + field); });
    }
    phase.addTable("ui template", resolve("ui template", ["template", "parent", "ix"]));
    phase.addTable("ui template binding", resolve("ui template binding", ["template", "query"]));
    phase.addTable("ui embed", resolve("ui embed", ["embed", "template", "parent", "ix"]));
    phase.addTable("ui embed scope", resolve("ui embed scope", ["embed", "key", "value"]));
    phase.addTable("ui embed scope binding", resolve("ui embed scope binding", ["embed", "key", "source", "alias"]));
    phase.addTable("ui attribute", resolve("ui attribute", ["template", "property", "value"]));
    phase.addTable("ui attribute binding", resolve("ui attribute binding", ["template", "property", "source", "alias"]));
    phase.addTable("ui event", resolve("ui event", ["template", "event"]));
    phase.addTable("ui event state", resolve("ui event state", ["template", "event", "key", "value"]));
    phase.addTable("ui event state binding", resolve("ui event state binding", ["template", "event", "key", "source", "alias"]));
    phase.addTable("system ui", ["template"]);
    phase.addFact("system ui", { template: "wiki root" });
    var wikiRoot = UIFromDSL((_j = ["\n    div wiki-root {color: red}\n      header\n        > perf stats\n      content\n        search container search-container {top: [search, top]; left: [search, left]}\n          ~ gather search as [search]\n          ~   lookup top\n          ~   lookup left\n          ~   lookup search\n          header search-header\n            div search-input { text: [search, search]}\n  "], _j.raw = ["\n    div wiki-root {color: red}\n      header\n        > perf stats\n      content\n        search container search-container {top: [search, top]; left: [search, left]}\n          ~ gather search as [search]\n          ~   lookup top\n          ~   lookup left\n          ~   lookup search\n          header search-header\n            div search-input { text: [search, search]}\n  "], utils_1.unpad(4)(_j)));
    phase.addUI("wiki root", wikiRoot);
    window["uu"] = wikiRoot;
    phase.addUI("perf stats", UIFromDSL((_k = ["\n    row perf-stats\n      ~ find render performance statistics as [perf stats]\n      ~   # Horrible hack (finds don't create source fields), disregard this\n      ~   lookup perf stats\n      ~   lookup root\n      ~   lookup ui compile\n      ~   lookup render\n      ~   lookup update\n      label {text: root}\n        span {text: [perf stats, root]}\n      label {text: ui compile}\n        span {text: [perf stats, ui compile]}\n      label {text: render}\n        span {text: [perf stats, render]}\n      label {text: update}\n        span {text: [perf stats, update]}\n  "], _k.raw = ["\n    row perf-stats\n      ~ find render performance statistics as [perf stats]\n      ~   # Horrible hack (finds don't create source fields), disregard this\n      ~   lookup perf stats\n      ~   lookup root\n      ~   lookup ui compile\n      ~   lookup render\n      ~   lookup update\n      label {text: root}\n        span {text: [perf stats, root]}\n      label {text: ui compile}\n        span {text: [perf stats, ui compile]}\n      label {text: render}\n        span {text: [perf stats, render]}\n      label {text: update}\n        span {text: [perf stats, update]}\n  "], utils_1.unpad(4)(_k))));
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // Wiki Logic
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    phase.addUnion("search", ["id", "top", "left"]);
    phase.addUnion("search query", ["id", "search"]);
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // Testing
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    var testData = {
        "test data": ["collection"],
        pet: ["collection"],
        exotic: ["collection"],
        dangerous: ["collection"],
        cat: ["pet"],
        dog: ["pet"],
        fish: ["pet"],
        snake: ["pet", "exotic"],
        koala: ["pet", "exotic"],
        sloth: ["pet", "exotic"],
        kangaroo: ["exotic"],
        giraffe: ["exotic"],
        gorilla: ["exotic", "dangerous"]
    };
    var testAttrs = {
        cat: { length: 4 },
        dog: { length: 3 },
        fish: { length: 1 },
        snake: { length: 4 },
        koala: { length: 3 },
        sloth: { length: 3 }
    };
    for (var entity in testData)
        phase.addEntity(entity, entity, ["test data"].concat(testData[entity]), testAttrs[entity]);
    phase.addQuery("exotic pet", queryFromPlanDSL((_l = ["\n    gather pet as [animal]\n      intersect exotic\n      lookup length as [animal length]\n      filterByEntity ! snake\n      filter > { a: [animal length, value]; b: 1 }\n  "], _l.raw = ["\n    gather pet as [animal]\n      intersect exotic\n      lookup length as [animal length]\n      filterByEntity ! snake\n      filter > { a: [animal length, value]; b: 1 }\n  "], utils_1.unpad(4)(_l))));
    var example = UIFromDSL((_m = ["\n    div example {color: fuchsia}\n      header {text: header}\n      content\n        div pet\n          ~ gather pet as [pet]\n          ~   lookup length\n          ~# calculate + {a: [pet, pet]; b: [pet, length]} as [label]\n          span {text: [pet, pet]}\n            @ click {foo: bar; baz: [pet, pet]}\n          label {text: enemy}\n            input\n              @ change {pet: [pet, pet]; enemy: [*event*, value]}\n          span {text: [pet, length]}\n      footer {text: footer}\n  "], _m.raw = ["\n    div example {color: fuchsia}\n      header {text: header}\n      content\n        div pet\n          ~ gather pet as [pet]\n          ~   lookup length\n          ~# calculate + {a: [pet, pet]; b: [pet, length]} as [label]\n          span {text: [pet, pet]}\n            @ click {foo: bar; baz: [pet, pet]}\n          label {text: enemy}\n            input\n              @ change {pet: [pet, pet]; enemy: [*event*, value]}\n          span {text: [pet, length]}\n      footer {text: footer}\n  "], utils_1.unpad(4)(_m)));
    phase.addUI("example ui", example);
    // phase.apply(true);
    window["p"] = phase;
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
});
window["bootstrap"] = exports;
//# sourceMappingURL=bootstrap.js.map