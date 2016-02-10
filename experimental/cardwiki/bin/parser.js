var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var utils_1 = require("./utils");
var wiki_1 = require("./wiki");
var ParseError = (function (_super) {
    __extends(ParseError, _super);
    function ParseError(message, line, lineIx, charIx, length) {
        if (charIx === void 0) { charIx = 0; }
        if (length === void 0) { length = line.length - charIx; }
        _super.call(this, message);
        this.message = message;
        this.line = line;
        this.lineIx = lineIx;
        this.charIx = charIx;
        this.length = length;
        this.name = "Parse Error";
    }
    ParseError.prototype.toString = function () {
        return (_a = ["\n      ", ": ", "\n      ", "\n      ", "\n      ", "\n    "], _a.raw = ["\n      ", ": ", "\n      ", "\n      ", "\n      ", "\n    "], utils_1.unpad(6)(_a, this.name, this.message, this.lineIx !== undefined ? "On line " + (this.lineIx + 1) + ":" + this.charIx : "", this.line, utils_1.underline(this.charIx, this.length)));
        var _a;
    };
    return ParseError;
})(Error);
function readWhile(str, substring, startIx) {
    var endIx = startIx;
    while (str[endIx] === substring)
        endIx++;
    return str.slice(startIx, endIx);
}
function readUntil(str, sentinel, startIx, unsatisfiedErr) {
    var endIx = str.indexOf(sentinel, startIx);
    if (endIx === -1) {
        if (unsatisfiedErr)
            return unsatisfiedErr;
        return str.slice(startIx);
    }
    return str.slice(startIx, endIx);
}
function getAlias(line, lineIx, charIx) {
    var alias = uuid();
    var aliasIx = line.lastIndexOf("as [");
    if (aliasIx !== -1) {
        alias = readUntil(line, "]", aliasIx + 4, new ParseError("Alias must terminate in a closing ']'", line, lineIx, line.length));
        if (alias instanceof Error)
            return alias;
    }
    else
        aliasIx = undefined;
    return [alias, aliasIx];
}
function maybeCoerceAlias(maybeAlias) {
    if (maybeAlias[0] === "[") {
        if (maybeAlias[maybeAlias.length - 1] !== "]")
            return new Error("Attribute aliases must terminate in a closing ']'");
        var _a = maybeAlias.slice(1, -1).split(","), source = _a[0], attribute = _a[1];
        if (!attribute)
            return new Error("Attribute aliases must contain a source, attribute pair");
        return [source.trim(), attribute.trim()];
    }
    return wiki_1.coerceInput(maybeAlias);
}
function getMapArgs(line, lineIx, charIx) {
    var args = {};
    if (line[charIx] === "{") {
        var endIx = line.indexOf("}", charIx);
        if (endIx === -1)
            return [new ParseError("Args must terminate in a closing '}'", line, lineIx, line.length), line.length];
        var syntaxErrorIx = line.indexOf("],");
        if (syntaxErrorIx !== -1)
            return [new ParseError("Args are delimited by ';', not ','", line, lineIx, syntaxErrorIx + 1, 0), charIx];
        for (var _i = 0, _a = line.slice(++charIx, endIx).split(";"); _i < _a.length; _i++) {
            var pair = _a[_i];
            var _b = pair.split(":"), key = _b[0], val = _b[1];
            if (key === undefined || val === undefined)
                return [new ParseError("Args must be specified in key: value pairs", line, lineIx, charIx, pair.length), charIx + pair.length + 1];
            var coerced = args[key.trim()] = maybeCoerceAlias(val.trim());
            if (coerced instanceof Error) {
                var valIx = charIx + pair.indexOf("[");
                return [new ParseError(coerced.message, line, lineIx, valIx), valIx];
            }
            charIx += pair.length + 1;
        }
        return [args, endIx + 1];
    }
    return [undefined, charIx];
}
function getListArgs(line, lineIx, charIx) {
    var args = [];
    if (line[charIx] === "{") {
        var endIx = line.indexOf("}", charIx);
        if (endIx === -1)
            return [new ParseError("Args must terminate in a closing '}'", line, lineIx, line.length), line.length];
        var syntaxErrorIx = line.indexOf("],");
        if (syntaxErrorIx !== -1)
            return [new ParseError("Args are delimited by ';', not ','", line, lineIx, syntaxErrorIx + 1, 0), charIx];
        for (var _i = 0, _a = line.slice(++charIx, endIx).split(";"); _i < _a.length; _i++) {
            var val = _a[_i];
            var coerced = maybeCoerceAlias(val.trim());
            if (coerced instanceof Error) {
                var valIx = charIx + val.indexOf("[");
                return [new ParseError(coerced.message, line, lineIx, valIx), valIx];
            }
            args.push(coerced);
            charIx += alert.length + 1;
        }
        return [args, charIx];
    }
    return [undefined, charIx];
}
function getDeselect(line, lineIx, charIx) {
    var deselect = false;
    if (line[charIx] === "!") {
        deselect = true;
        charIx++;
        while (line[charIx] === " ")
            charIx++;
    }
    return [deselect, charIx];
}
var parsePlanStep = (_a = {},
    _a["#"] = function () {
        return;
    },
    // Sources
    _a.find = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var entity = line.slice(charIx, aliasIx).trim();
        if (!entity)
            return new ParseError("Find step must specify a valid entity id", line, lineIx, charIx);
        var step = { type: "find", id: alias, entity: entity };
        return step;
    },
    _a.gather = function (line, lineIx, charIx, relatedTo) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var collection = line.slice(charIx, aliasIx).trim();
        if (!collection)
            return new ParseError("Gather step must specify a valid collection id", line, lineIx, charIx);
        var step = { type: "gather", id: alias, collection: collection, relatedTo: relatedTo };
        return step;
    },
    // Joins
    _a.lookup = function (line, lineIx, charIx, relatedTo) {
        if (!relatedTo)
            return new ParseError("Lookup step must be a child of a root", line, lineIx, charIx);
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var deselect;
        _b = getDeselect(line, lineIx, charIx), deselect = _b[0], charIx = _b[1];
        var attribute = line.slice(charIx, aliasIx).trim();
        if (!attribute)
            return new ParseError("Lookup step must specify a valid attribute id.", line, lineIx, charIx);
        var step = { type: "lookup", id: alias, attribute: attribute, deselect: deselect, relatedTo: relatedTo };
        return step;
        var _b;
    },
    _a.intersect = function (line, lineIx, charIx, relatedTo) {
        if (!relatedTo)
            return new ParseError("Lookup step must be a child of a root", line, lineIx, charIx);
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var deselect;
        _b = getDeselect(line, lineIx, charIx), deselect = _b[0], charIx = _b[1];
        var collection = line.slice(charIx, aliasIx).trim();
        if (!collection)
            return new ParseError("Intersect step must specify a valid collection id", line, lineIx, charIx);
        var step = { type: "intersect", id: alias, collection: collection, deselect: deselect, relatedTo: relatedTo };
        return step;
        var _b;
    },
    _a.filterByEntity = function (line, lineIx, charIx, relatedTo) {
        if (!relatedTo)
            return new ParseError("Lookup step must be a child of a root", line, lineIx, charIx);
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var deselect;
        _b = getDeselect(line, lineIx, charIx), deselect = _b[0], charIx = _b[1];
        var entity = line.slice(charIx, aliasIx).trim();
        if (!entity)
            return new ParseError("Intersect step must specify a valid entity id", line, lineIx, charIx, entity.length);
        var step = { type: "filter by entity", id: alias, entity: entity, deselect: deselect, relatedTo: relatedTo };
        return step;
        var _b;
    },
    // Calculations
    _a.filter = function (line, lineIx, charIx) {
        // filter positive
        // filter >; a: 7, b: [person age]
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var filter = readUntil(line, "{", charIx); // @NOTE: Need to remove alias
        charIx += filter.length;
        filter = filter.trim();
        if (!filter)
            return new ParseError("Filter step must specify a valid filter fn", line, lineIx, lastIx);
        var args;
        _b = getMapArgs(line, lineIx, charIx), args = _b[0], charIx = _b[1];
        if (args instanceof Error)
            return args;
        if (line.length > charIx)
            return new ParseError("Filter step contains extraneous text", line, lineIx, charIx);
        var step = { type: "filter", id: alias, func: filter, args: args };
        return step;
        var _b;
    },
    _a.calculate = function (line, lineIx, charIx) {
        // filter positive
        // filter >; a: 7, b: [person age]
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var filter = readUntil(line, "{", charIx); // @NOTE: Need to remove alias
        charIx += filter.length;
        filter = filter.trim();
        if (!filter)
            return new ParseError("Calculate step must specify a valid calculate fn", line, lineIx, lastIx);
        var args;
        _b = getMapArgs(line, lineIx, charIx), args = _b[0], charIx = _b[1];
        if (args instanceof Error)
            return args;
        var step = { type: "calculate", id: alias, func: filter, args: args };
        return step;
        var _b;
    },
    _a
);
function parsePlan(str) {
    var plan = [];
    var errors = [];
    var lineIx = 0;
    var lines = str.split("\n");
    var stack = [];
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var charIx = 0;
        while (line[charIx] === " ")
            charIx++;
        var indent = charIx;
        if (line[charIx] === undefined)
            continue;
        var related = void 0;
        for (var stackIx = stack.length - 1; stackIx >= 0; stackIx--) {
            if (indent > stack[stackIx].indent) {
                related = stack[stackIx].step;
                break;
            }
            else
                stack.pop();
        }
        var keyword = readUntil(line, " ", charIx);
        charIx += keyword.length;
        var step = void 0;
        if (parsePlanStep[keyword])
            step = parsePlanStep[keyword](line, lineIx, charIx, related);
        else
            step = new ParseError("Keyword '" + keyword + "' is not a valid plan step, ignoring", line, lineIx, charIx - keyword.length, keyword.length);
        if (step && step["args"]) {
            var args = step["args"];
            for (var arg in args) {
                if (args[arg] instanceof Array) {
                    var source = args[arg][0];
                    var valid = false;
                    for (var _a = 0; _a < plan.length; _a++) {
                        var step_1 = plan[_a];
                        if (step_1.id === source) {
                            valid = true;
                            break;
                        }
                    }
                    if (!valid) {
                        step = new ParseError("Alias source '" + source + "' does not exist in plan", line, lineIx, line.indexOf("[" + source + ",") + 1, source.length);
                    }
                }
            }
        }
        if (step instanceof Error)
            errors.push(step);
        else if (step) {
            plan.push(step);
            stack.push({ indent: indent, step: step });
        }
        lineIx++;
    }
    if (errors.length) {
        for (var _b = 0; _b < errors.length; _b++) {
            var err = errors[_b];
            console.error(err);
        }
    }
    return plan;
}
exports.parsePlan = parsePlan;
var parseQueryStep = (_b = {},
    _b["#"] = function () {
        return;
    },
    _b.select = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var viewRaw = readUntil(line, "{", charIx).slice(0, aliasIx ? aliasIx - charIx : undefined);
        charIx += viewRaw.length;
        var view = viewRaw.trim();
        if (!view)
            return new ParseError("Select step must specify a valid view id", line, lineIx, lastIx, viewRaw.length);
        var join;
        _b = getMapArgs(line, lineIx, charIx), join = _b[0], charIx = _b[1];
        if (join instanceof Error)
            return join;
        var step = { type: "select", id: alias, view: view, join: join };
        return step;
        var _b;
    },
    _b.deselect = function (line, lineIx, charIx) {
        var step = parseQueryStep["select"](line, lineIx, charIx);
        if (step instanceof Error)
            return step;
        step.type = "deselect";
        return step;
    },
    _b.calculate = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var funcRaw = readUntil(line, "{", charIx).slice(0, aliasIx ? aliasIx - charIx : undefined);
        charIx += funcRaw.length;
        var func = funcRaw.trim();
        if (!func)
            return new ParseError("Calculate step must specify a valid function id", line, lineIx, lastIx, funcRaw.length);
        var args;
        _b = getMapArgs(line, lineIx, charIx), args = _b[0], charIx = _b[1];
        if (args instanceof Error)
            return args;
        var step = { type: "calculate", id: alias, func: func, args: args };
        return step;
        var _b;
    },
    _b.aggregate = function (line, lineIx, charIx) {
        var step = parseQueryStep["calculate"](line, lineIx, charIx);
        if (step instanceof Error)
            return step;
        step.type = "aggregate";
        return step;
    },
    _b.ordinal = function (line, lineIx, charIx) {
        var step = { type: "ordinal" };
        return step;
    },
    _b.group = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var groups;
        _a = getListArgs(line, lineIx, charIx), groups = _a[0], charIx = _a[1];
        if (groups instanceof Error)
            return groups;
        var step = { type: "group", groups: groups };
        return step;
        var _a;
    },
    _b.sort = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var sorts;
        _a = getListArgs(line, lineIx, charIx), sorts = _a[0], charIx = _a[1];
        if (sorts instanceof Error)
            return sorts;
        var step = { type: "sort", sorts: sorts };
        return step;
        var _a;
    },
    _b.limit = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var args;
        _a = getMapArgs(line, lineIx, charIx), args = _a[0], charIx = _a[1];
        if (args instanceof Error)
            return args;
        for (var _i = 0, _b = Object.keys(args); _i < _b.length; _i++) {
            var key = _b[_i];
            if (key !== "results" && key !== "perGroup")
                return new ParseError("Limit may only apply perGroup or to results", line, lineIx, charIx);
        }
        var step = { type: "limit", limit: args };
        return step;
        var _a;
    },
    _b.project = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var args;
        _a = getMapArgs(line, lineIx, charIx), args = _a[0], charIx = _a[1];
        if (args instanceof Error)
            return args;
        var step = { type: "project", mapping: args };
        return step;
        var _a;
    },
    _b
);
function parseQuery(str) {
    var plan = [];
    var errors = [];
    var lineIx = 0;
    var lines = str.split("\n");
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var charIx = 0;
        while (line[charIx] === " ")
            charIx++;
        if (line[charIx] === undefined)
            continue;
        var keyword = readUntil(line, " ", charIx);
        charIx += keyword.length;
        var step = void 0;
        if (parseQueryStep[keyword])
            step = parseQueryStep[keyword](line, lineIx, charIx);
        else
            step = new ParseError("Keyword '" + keyword + "' is not a valid query step, ignoring", line, lineIx, charIx - keyword.length, keyword.length);
        if (step && step["args"]) {
            var args = step["args"];
            for (var arg in args) {
                if (args[arg] instanceof Array) {
                    var source = args[arg][0];
                    var valid = false;
                    for (var _a = 0; _a < plan.length; _a++) {
                        var step_2 = plan[_a];
                        if (step_2.id === source) {
                            valid = true;
                            break;
                        }
                    }
                    if (!valid) {
                        step = new ParseError("Alias source '" + source + "' does not exist in query", line, lineIx, line.indexOf("[" + source + ",") + 1, source.length);
                    }
                }
            }
        }
        if (step instanceof Error)
            errors.push(step);
        else if (step)
            plan.push(step);
        lineIx++;
    }
    if (errors.length) {
        // @FIXME: Return errors instead of logging them.
        for (var _b = 0; _b < errors.length; _b++) {
            var err = errors[_b];
            console.error(err.toString());
        }
    }
    return plan;
}
exports.parseQuery = parseQuery;
function parseUI(str) {
    var root = {};
    var errors = [];
    var lineIx = 0;
    var lines = str.split("\n");
    var stack = [{ indent: -2, elem: root }];
    // @FIXME: Chunk into element chunks instead of lines to enable in-argument continuation.
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var charIx = 0;
        while (line[charIx] === " ")
            charIx++;
        var indent = charIx;
        if (line[charIx] === undefined)
            continue;
        var parent_1 = void 0;
        for (var stackIx = stack.length - 1; stackIx >= 0; stackIx--) {
            if (indent > stack[stackIx].indent) {
                parent_1 = stack[stackIx].elem;
                break;
            }
            else
                stack.pop();
        }
        var keyword = readUntil(line, " ", charIx);
        charIx += keyword.length;
        if (keyword[0] === "~") {
            charIx -= keyword.length - 1;
            if (!parent_1.binding)
                parent_1.binding = line.slice(charIx);
            else
                parent_1.binding += "\n" + line.slice(charIx);
            charIx = line.length;
        }
        else if (keyword[0] === "@") {
            charIx -= keyword.length - 1;
            var err = void 0;
            while (line[charIx] === " ")
                charIx++;
            var lastIx = charIx;
            var eventRaw = readUntil(line, "{", charIx);
            charIx += eventRaw.length;
            var event_1 = eventRaw.trim();
            if (!event_1)
                err = new ParseError("UI event must specify a valid event name", line, lineIx, lastIx, eventRaw.length);
            var state = void 0;
            _a = getMapArgs(line, lineIx, charIx), state = _a[0], charIx = _a[1];
            if (state instanceof Error && !err)
                err = state;
            if (err) {
                errors.push(err);
                lineIx++;
                continue;
            }
            if (!parent_1.events)
                parent_1.events = {};
            parent_1.events[event_1] = state;
        }
        else if (keyword[0] === ">") {
            charIx -= keyword.length - 1;
            var err = void 0;
            while (line[charIx] === " ")
                charIx++;
            var lastIx = charIx;
            var embedIdRaw = readUntil(line, "{", charIx);
            charIx += embedIdRaw.length;
            var embedId = embedIdRaw.trim();
            if (!embedId)
                err = new ParseError("UI embed must specify a valid element id", line, lineIx, lastIx, embedIdRaw.length);
            var scope = void 0;
            _b = getMapArgs(line, lineIx, charIx), _c = _b[0], scope = _c === void 0 ? {} : _c, charIx = _b[1];
            if (scope instanceof Error && !err)
                err = scope;
            if (err) {
                errors.push(err);
                lineIx++;
                continue;
            }
            var elem = { embedded: scope, id: embedId };
            if (!parent_1.children)
                parent_1.children = [];
            parent_1.children.push(elem);
            stack.push({ indent: indent, elem: elem });
        }
        else {
            var err = void 0;
            if (!keyword)
                err = new ParseError("UI element must specify a valid tag name", line, lineIx, charIx, 0);
            while (line[charIx] === " ")
                charIx++;
            var classesRaw = readUntil(line, "{", charIx);
            charIx += classesRaw.length;
            var classes = classesRaw.trim();
            var attributes = void 0;
            _d = getMapArgs(line, lineIx, charIx), _e = _d[0], attributes = _e === void 0 ? {} : _e, charIx = _d[1];
            if (attributes instanceof Error && !err)
                err = attributes;
            if (err) {
                errors.push(err);
                lineIx++;
                continue;
            }
            attributes["t"] = keyword;
            if (classes)
                attributes["c"] = classes;
            var elem = { id: attributes["id"], attributes: attributes };
            if (!parent_1.children)
                parent_1.children = [];
            parent_1.children.push(elem);
            stack.push({ indent: indent, elem: elem });
        }
        lineIx++;
    }
    if (errors.length) {
        for (var _f = 0; _f < errors.length; _f++) {
            var err = errors[_f];
            console.error(err);
        }
    }
    return root;
    var _a, _b, _c, _d, _e;
}
exports.parseUI = parseUI;
window["parser"] = exports;
var _a, _b;
//# sourceMappingURL=parser.js.map