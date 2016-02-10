"use strict";
var runtime = require("./runtime");
var queryParser = require("./queryParser");
var app_1 = require("./app");
var app = require("./app");
var MAX_NUMBER = runtime.MAX_NUMBER;
//---------------------------------------------------------
// Entity
//---------------------------------------------------------
function coerceInput(input) {
    if (input.match(/^-?[\d]+$/gim)) {
        return parseInt(input);
    }
    else if (input.match(/^-?[\d]+\.[\d]+$/gim)) {
        return parseFloat(input);
    }
    else if (input === "true") {
        return true;
    }
    else if (input === "false") {
        return false;
    }
    return input;
}
exports.coerceInput = coerceInput;
var breaks = /[{}\|:\n#]/;
var types = {
    "#": "header",
    "{": "link open",
    "}": "link close",
    ":": "assignment"
};
function tokenize(entity) {
    var line = 0;
    var ix = 0;
    var len = entity.length;
    var tokens = [];
    var cur = { ix: ix, line: line, type: "text", text: "" };
    for (; ix < len; ix++) {
        var ch = entity[ix];
        if (ch.match(breaks)) {
            var type = types[ch];
            if (ch === "\n")
                line++;
            if (cur.text !== "" || cur.line !== line) {
                tokens.push(cur);
            }
            if (ch === "\n") {
                cur = { ix: ix + 1, line: line, type: "text", text: "" };
                continue;
            }
            cur = { ix: ix, line: line, type: type, text: ch };
            tokens.push(cur);
            if (types[cur.text]) {
                cur.type = types[cur.text];
            }
            if (type === "header") {
                //trim the next character if it's a space between the header indicator
                //and the text;
                if (entity[ix + 1] === " ")
                    ix++;
            }
            cur = { ix: ix + 1, line: line, type: "text", text: "" };
        }
        else {
            cur.text += ch;
        }
    }
    tokens.push(cur);
    return tokens;
}
function parse(tokens) {
    var links = [];
    var eavs = [];
    var collections = [];
    var state = { items: [] };
    var lines = [];
    var line;
    var lineIx = -1;
    for (var _i = 0; _i < tokens.length; _i++) {
        var token = tokens[_i];
        if (token.line !== lineIx) {
            // this accounts for blank lines.
            while (lineIx < token.line) {
                line = { ix: token.line, header: false, items: [] };
                lines.push(line);
                lineIx++;
            }
        }
        var type = token.type;
        switch (type) {
            case "header":
                line.header = true;
                break;
            case "link open":
                state.capturing = true;
                state.mode = "link";
                state.items.push(token);
                break;
            case "link close":
                state.items.push(token);
                state.type = "link";
                if (state.mode === "assignment") {
                    if (state.attribute === "is a") {
                        state.type = "collection";
                        state.link = state.value;
                    }
                    else {
                        state.type = "eav";
                    }
                    eavs.push(state);
                }
                else {
                    state.type = "eav";
                    state.attribute = "generic related to";
                    state.value = state.link;
                    eavs.push(state);
                }
                line.items.push(state);
                state = { items: [] };
                break;
            case "assignment":
                state.mode = "assignment";
                state.attribute = state.link;
                break;
            case "text":
                if (!state.capturing) {
                    line.items.push(token);
                }
                else if (state.mode === "link") {
                    state.link = token.text.trim();
                    state.items.push(token);
                }
                else if (state.mode === "assignment") {
                    state.value = coerceInput(token.text.trim());
                    state.items.push(token);
                }
                break;
        }
    }
    return { lines: lines, links: links, collections: collections, eavs: eavs };
}
var parseCache;
function parseEntity(entityId, content) {
    if (!parseCache)
        parseCache = {};
    var cached = parseCache[entityId];
    if (!cached || cached[0] !== content) {
        cached = parseCache[entityId] = [content, parse(tokenize(content))];
    }
    return cached[1];
}
function entityToHTML(lines, searchId) {
    var children = [];
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var lineChildren = [];
        var items = line.items;
        for (var _a = 0; _a < items.length; _a++) {
            var item = items[_a];
            if (item.type === "text") {
                lineChildren.push({ t: "span", text: item.text });
                continue;
            }
            if (typeof item.value === "number") {
                lineChildren.push({ t: "span", c: "" + item.type, text: item.value });
                continue;
            }
            if (!item.value && !item.link)
                continue;
            var link = item.type === "eav" ? item.value.toLowerCase() : item.link.toLowerCase();
            var found = app_1.eve.findOne("entity", { entity: link }) || app_1.eve.findOne("collection", { entity: link });
            if (item.type === "eav" && item.attribute !== "generic related to") {
                if (found) {
                    lineChildren.push({ t: "span", c: "link found", text: item.value, linkText: link, click: followLink, searchId: searchId });
                }
                else {
                    lineChildren.push({ t: "span", c: "" + item.type, text: item.value });
                }
            }
            else {
                var type = item.type === "eav" && item.attribute !== "is a" ? "link" : item.type;
                lineChildren.push({ t: "span", c: type + " " + (found ? 'found' : ""), text: item.link, linkText: link, click: followLink, searchId: searchId });
            }
        }
        if (line.header) {
            lineChildren = [{ t: "h1", children: lineChildren }];
        }
        children.push({ t: "pre", c: "" + (line.header ? 'header' : ''), children: lineChildren });
    }
    return children;
}
var modifiers = {
    "per": "group",
    "each": "group",
    "grouped": "group",
    "without": "deselect",
    "not": "deselect",
    "aren't": "deselect",
    "except": "deselect",
    "don't": "deselect"
};
var operations = {
    "sum": { op: "sum", argCount: 1, aggregate: true, args: ["value"] },
    "count": { op: "count", argCount: 0, aggregate: true, args: [] },
    "average": { op: "average", argCount: 1, aggregate: true, args: ["value"] },
    "mean": { op: "average", argCount: 1, aggregate: true, args: ["value"] },
    "top": { op: "sort limit", argCount: 2, direction: "descending" },
    "bottom": { op: "sort limit", argCount: 2, direction: "ascending" },
    "highest": { op: "sort limit", argCount: 1, direction: "descending" },
    "lowest": { op: "sort limit", argCount: 1, direction: "ascending" },
    ">": { op: ">", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    ">=": { op: ">=", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "greater": { op: ">", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "bigger": { op: ">", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "<": { op: "<", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "<=": { op: "<=", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "lower": { op: "<", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "smaller": { op: "<", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "=": { op: "=", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "equal": { op: "=", argCount: 2, infix: true, args: ["a", "b"], filter: true },
    "contains": { op: "contains", argCount: 2, infix: true, args: ["haystack", "needle"] },
    "older": { op: ">", argCount: 2, infix: true, attribute: "age", args: ["a", "b"], filter: true },
    "younger": { op: "<", argCount: 2, infix: true, attribute: "age", args: ["a", "b"], filter: true },
    "+": { op: "+", argCount: 2, infix: true, args: ["a", "b"] },
    "-": { op: "-", argCount: 2, infix: true, args: ["a", "b"] },
    "/": { op: "/", argCount: 2, infix: true, args: ["a", "b"] },
    "*": { op: "*", argCount: 2, infix: true, args: ["a", "b"] }
};
function newSearchTokens(searchString) {
    var cleaned = searchString.toLowerCase();
    var all = queryParser.getTokens(cleaned);
    all.forEach(function (token) {
        token.type = queryParser.TokenTypes[token.type];
        if (token.type === "modifier") {
            token.modifier = modifiers[token.found];
        }
        else if (token.type === "pattern") {
            token.type = "operation";
            token.operation = operations[token.found];
        }
    });
    return all.filter(function (token) { return token.type !== "text"; });
}
function walk(tree, indent) {
    if (indent === void 0) { indent = 0; }
    if (!tree)
        return console.log("UNDEFINED TREE");
    var text = tree.found;
    if (!text && tree.operation) {
        text = tree.operation.op;
    }
    else if (!text && tree.value) {
        text = tree.value;
    }
    if (tree.children) {
        for (var _i = 0, _a = tree.children; _i < _a.length; _i++) {
            var child = _a[_i];
            walk(child, indent + 1);
        }
    }
    console.groupEnd();
}
var tokenRelationships = {
    "collection": {
        "collection": findCollectionToCollectionRelationship,
        "attribute": findCollectionToAttrRelationship,
        "entity": findCollectionToEntRelationship
    },
    "entity": {
        "attribute": findEntToAttrRelationship
    }
};
function tokensToRelationship(token1, token2) {
    var func = tokenRelationships[token1.type];
    if (func)
        func = func[token2.type];
    if (func) {
        return func(token1.found, token2.found);
    }
}
function planTree(searchString) {
    var tokens = newSearchTokens(searchString);
    var tree = { roots: [], operations: [], groups: [] };
    var root;
    var cursor;
    var state = { operationStack: [] };
    // find the root subject which is either the first collection found
    // or if there are not collections, the first entity
    for (var _i = 0; _i < tokens.length; _i++) {
        var token = tokens[_i];
        if (token.type === "collection") {
            token.children = [];
            root = token;
            break;
        }
        else if (token.type === "entity" && (!root || root.type === "attribute")) {
            token.children = [];
            root = token;
        }
        else if (token.type === "attribute" && !root) {
            token.children = [];
            root = token;
        }
    }
    tree.roots.push(root);
    for (var tokenIx = 0, len = tokens.length; tokenIx < len; tokenIx++) {
        var token = tokens[tokenIx];
        token.id = uuid();
        var type = token.type;
        if (state.group && (type === "collection" || type === "attribute")) {
            token.group = true;
            tree.groups.push(token);
        }
        if (token === root)
            continue;
        if (type === "modifier") {
            state[token.modifier] = true;
            continue;
        }
        token.children = [];
        if (type === "operation") {
            if (state.lastValue) {
                state.lastValue = null;
                token.children.push(state.lastValue);
            }
            state.operationStack.push({ cursor: cursor, operator: state.operator });
            state.consuming = true;
            state.operator = token;
            cursor = token;
            continue;
        }
        if (!state.consuming && type === "value") {
            state.lastValue = token;
            continue;
        }
        var maybeSubject = (type === "collection" || type === "entity");
        if (state.deselect && maybeSubject) {
            token.deselect = true;
            state.deselect = false;
        }
        var activeRoot = root;
        if (state.consuming) {
            activeRoot = state.operator;
            var argCount = state.operator.operation.argCount;
            if (state.operator.operation.infix)
                argCount--;
            while (state.operator.children.length > argCount) {
                var item = state.operationStack.pop();
                cursor = item.cursor;
                // we consumed one too many, so push that onto either the parent operator or
                // the root
                var overflowCursor = item.operator ? item.operator : root;
                overflowCursor.children.push(state.operator.children.pop());
                // run through the items, determine if they're a totally different root,
                // or if they belong to the current cursor/root
                var operation = state.operator.operation;
                var operatorChildren = state.operator.children;
                var ix = 0;
                for (var _a = 0; _a < operatorChildren.length; _a++) {
                    var child = operatorChildren[_a];
                    if (child.type === "attribute") {
                        cursor.children.push(child);
                        operatorChildren[ix] = child;
                    }
                    else if (child.type !== "value") {
                        // we have something that could nest.
                        var tip = child;
                        while (tip.children.length) {
                            tip = tip.children[tip.children.length - 1];
                        }
                        if (operation.attribute) {
                            tip.children.push({ type: "attribute", found: operation.attribute, orig: operation.attribute, id: uuid(), children: [] });
                        }
                        // if this is an infix operation, then this is an entirely different root now
                        if (operation.infix) {
                            tree.roots.push(child);
                        }
                        else {
                            throw new Error("Non infix operation with a non-attribute child: " + JSON.stringify(state.operator));
                        }
                        operatorChildren[ix] = tip;
                    }
                    ix++;
                }
                // if this is an infix operator that invokes an attribute, e.g. "older", push
                // that attribute onto the cursor
                if (operation.infix && operation.attribute) {
                    var attr = { type: "attribute", found: operation.attribute, orig: operation.attribute, id: uuid(), children: [] };
                    cursor.children.push(attr);
                    // we also need to add this as the first arg to the function
                    state.operator.children.unshift(attr);
                }
                else if (operation.infix) {
                    // we need to add the closest thing before this as the first arg to the function.
                    var tip = cursor || root;
                    while (tip.children.length) {
                        tip = tip.children[tip.children.length - 1];
                    }
                    state.operator.children.unshift(tip);
                }
                tree.operations.push(state.operator);
                if (item.operator) {
                    activeRoot = state.operator = item.operator;
                    argCount = state.operator.operation.argCount;
                    if (state.operator.operation.infix)
                        argCount--;
                }
                else {
                    // we're done consuming now
                    state.consuming = false;
                    state.operator = null;
                    state.lastValue = false;
                    activeRoot = root;
                    break;
                }
            }
        }
        // if we don't have a cursor, then associate to the root
        if (!cursor) {
            activeRoot.children.push(token);
        }
        else if (type === "value") {
            activeRoot.children.push(token);
        }
        else if (cursor.type === "entity" && type !== "attribute") {
            activeRoot.children.push(token);
        }
        else if (cursor.type === "entity" || cursor.type === "collection") {
            var cursorRel = tokensToRelationship(cursor, token);
            var rootRel = tokensToRelationship(root, token);
            // if this token is an entity and either root or cursor has a direct relationship
            // we don't really want to use that as it's most likely meant to filter a set down
            // instead of reduce the set to exactly one ent
            if (token.type === "entity") {
                if (cursorRel && cursorRel.distance === 0)
                    cursorRel = null;
                if (rootRel && rootRel.distance === 0)
                    rootRel = null;
            }
            if (!cursorRel) {
                activeRoot.children.push(token);
            }
            else if (!rootRel) {
                cursor.children.push(token);
            }
            else if (cursorRel.distance <= rootRel.distance) {
                cursor.children.push(token);
            }
            else {
                // @TODO: maybe if there's a cursorRel we should just always ignore the rootRel even if it
                // is a "better" relationship. Sentence structure-wise it seems pretty likely that attributes
                // following an entity are related to that entity and not something else.
                activeRoot.children.push(token);
            }
        }
        else if (cursor.type === "operation") {
            activeRoot.children.push(token);
        }
        // if this was a subject, then this is now the cursor
        if (maybeSubject) {
            cursor = token;
        }
    }
    if (state.consuming) {
        var item = state.operationStack.pop();
        while (item) {
            cursor = item.cursor || root;
            if (state.operator.children.length > state.operator.operation.argCount) {
                // we consumed one too many, so push that onto either the parent operator or
                // the root
                var overflowCursor = item.operator ? item.operator : root;
                overflowCursor.children.push(state.operator.children.pop());
            }
            // run through the items, determine if they're a totally different root,
            // or if they belong to the current cursor/root
            var operation = state.operator.operation;
            var operatorChildren = state.operator.children;
            var ix = 0;
            for (var _b = 0; _b < operatorChildren.length; _b++) {
                var child = operatorChildren[_b];
                if (child.type === "attribute") {
                    cursor.children.push(child);
                    operatorChildren[ix] = child;
                }
                else if (child.type && child.type !== "value") {
                    // we have something that could nest.
                    var tip = child;
                    while (tip.children.length) {
                        tip = tip.children[0];
                    }
                    if (operation.attribute) {
                        var neueAttr = { type: "attribute", found: operation.attribute, orig: operation.attribute, id: uuid(), children: [] };
                        tip.children.push(neueAttr);
                        tip = neueAttr;
                    }
                    // if this is an infix operation, then this is an entirely different root now
                    if (operation.infix) {
                        tree.roots.push(child);
                    }
                    else {
                        throw new Error("Non infix operation with a non-attribute child: " + JSON.stringify(state.operator));
                    }
                    operatorChildren[ix] = tip;
                }
                ix++;
            }
            // if this is an infix operator that invokes an attribute, e.g. "older", push
            // that attribute onto the cursor
            if (operation.infix && operation.attribute) {
                var attr = { type: "attribute", found: operation.attribute, orig: operation.attribute, id: uuid(), children: [] };
                cursor.children.push(attr);
                // we also need to add this as the first arg to the function
                state.operator.children.unshift(attr);
            }
            else if (operation.infix) {
                // we need to add the closest thing before this as the first arg to the function.
                var tip = cursor || root;
                while (tip.children.length) {
                    tip = tip.children[tip.children.length - 1];
                }
                state.operator.children.unshift(tip);
            }
            tree.operations.push(state.operator);
            if (item.operator) {
                state.operator = item.operator;
            }
            else {
                // we're done consuming now
                state.consuming = false;
                state.operator = null;
                state.lastValue = false;
                break;
            }
            item = state.operationStack.pop();
        }
    }
    if (root)
        walk(root);
    return tree;
}
function ignoreHiddenCollections(colls) {
    for (var _i = 0; _i < colls.length; _i++) {
        var coll = colls[_i];
        if (coll !== "unknown" && coll !== "history" && coll !== "collection") {
            return coll;
        }
    }
}
function nodeToPlanSteps(node, parent, parentPlan) {
    //TODO: figure out what to do with operations
    var id = node.id || uuid();
    var deselect = node.deselect;
    if (parent) {
        var rel = tokensToRelationship(parent, node);
        if (!rel) {
            return [];
        }
        switch (rel.type) {
            case "coll->eav":
                var plan = [];
                var curParent = parentPlan;
                for (var _i = 0, _a = rel.nodes; _i < _a.length; _i++) {
                    var node_1 = _a[_i];
                    var coll = ignoreHiddenCollections(node_1);
                    var item = { type: "gather", relatedTo: curParent, collection: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: "lookup", relatedTo: curParent, attribute: node.found, id: id, deselect: deselect });
                return plan;
                break;
            case "coll->ent":
                var plan = [];
                var curParent = parentPlan;
                for (var _b = 0, _c = rel.nodes; _b < _c.length; _b++) {
                    var node_2 = _c[_b];
                    var coll = ignoreHiddenCollections(node_2);
                    var item = { type: "gather", relatedTo: curParent, collection: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: "filter by entity", relatedTo: curParent, entity: node.found, id: id, deselect: deselect });
                return plan;
                break;
            case "coll->coll":
                if (rel.distance === 0) {
                    return [{ type: "intersect", relatedTo: parentPlan, collection: node.found, id: id, deselect: deselect }];
                }
                else {
                    return [{ type: "gather", relatedTo: parentPlan, collection: node.found, id: id, deselect: deselect }];
                }
                break;
            case "ent->eav":
                if (rel.distance === 0) {
                    return [{ type: "lookup", relatedTo: parentPlan, attribute: node.found, id: id, deselect: deselect }];
                }
                else {
                    var plan_1 = [];
                    var curParent_1 = parentPlan;
                    for (var _d = 0, _e = rel.nodes; _d < _e.length; _d++) {
                        var node_3 = _e[_d];
                        var coll = ignoreHiddenCollections(node_3);
                        var item = { type: "gather", relatedTo: curParent_1, collection: coll, id: uuid() };
                        plan_1.push(item);
                        curParent_1 = item;
                    }
                    plan_1.push({ type: "lookup", relatedTo: curParent_1, attribute: node.found, id: id, deselect: deselect });
                    return plan_1;
                }
                break;
            case "collection->ent":
                break;
        }
    }
    else {
        if (node.type === "collection") {
            return [{ type: "gather", collection: node.found, id: id, deselect: deselect }];
        }
        else if (node.type === "entity") {
            return [{ type: "find", entity: node.found, id: id, deselect: deselect }];
        }
        else if (node.type === "attribute") {
            return [{ type: "lookup", attribute: node.found, id: id, deselect: deselect }];
        }
        return [];
    }
}
function nodeToPlan(tree, parent, parentPlan) {
    if (parent === void 0) { parent = null; }
    if (parentPlan === void 0) { parentPlan = null; }
    if (!tree)
        return [];
    var plan = [];
    //process you, then your children
    plan.push.apply(plan, nodeToPlanSteps(tree, parent, parentPlan));
    var neueParentPlan = plan[plan.length - 1];
    for (var _i = 0, _a = tree.children; _i < _a.length; _i++) {
        var child = _a[_i];
        plan.push.apply(plan, nodeToPlan(child, tree, neueParentPlan));
    }
    return plan;
}
function opToPlan(op, groupLookup) {
    var info = op.operation;
    var args = {};
    var ix = 0;
    if (info.args) {
        for (var _i = 0, _a = info.args; _i < _a.length; _i++) {
            var arg = _a[_i];
            var value = op.children[ix];
            if (value === undefined)
                continue;
            if (value.type && value.type === "value") {
                args[arg] = JSON.parse(value.value);
            }
            else if (value.type) {
                args[arg] = [value.id, "value"];
            }
            else {
                throw new Error("Invalid operation argument: " + JSON.stringify(op));
            }
            ix++;
        }
    }
    if (info.aggregate) {
        return [{ type: "aggregate", aggregate: info.op, args: args, id: uuid() }];
    }
    else if (info.op === "sort limit") {
        var sort, limit, grouped;
        for (var _b = 0, _c = op.children; _b < _c.length; _b++) {
            var child = _c[_b];
            if (child.type && child.type === "value") {
                limit = child.value;
            }
            else {
                sort = [child.id, "value", info.direction];
                grouped = groupLookup[child];
            }
        }
        var plan = [];
        if (sort) {
            plan.push({ type: "sort", id: uuid(), sort: [sort] });
        }
        if (limit) {
            var limitInfo = {};
            if (grouped || Object.keys(groupLookup).length === 0) {
                limitInfo.results = limit;
            }
            else {
                limitInfo.perGroup = limit;
            }
            plan.push({ type: "limit", id: uuid(), limit: limitInfo });
        }
        return plan;
    }
    else if (info.filter) {
        return [{ type: "filter", func: info.op, args: args, id: uuid() }];
    }
    else {
        return [{ type: "calculate", func: info.op, args: args, id: uuid() }];
    }
}
function groupsToPlan(nodes) {
    if (!nodes.length)
        return [];
    var groups = [];
    for (var _i = 0; _i < nodes.length; _i++) {
        var node = nodes[_i];
        if (node.type === "collection") {
            groups.push([node.id, "entity"]);
        }
        else if (node.type === "attribute") {
            groups.push([node.id, "value"]);
        }
        else {
            throw new Error("Invalid node to group on: " + JSON.stringify(nodes));
        }
    }
    return [{ type: "group", id: uuid(), groups: groups, groupNodes: nodes }];
}
function treeToPlan(tree) {
    var plan = [];
    for (var _i = 0, _a = tree.roots; _i < _a.length; _i++) {
        var root_1 = _a[_i];
        plan.push.apply(plan, nodeToPlan(root_1));
    }
    plan.push.apply(plan, groupsToPlan(tree.groups));
    var groupLookup = {};
    for (var _b = 0, _c = tree.groups; _b < _c.length; _b++) {
        var node = _c[_b];
        groupLookup[node.id] = true;
    }
    for (var _d = 0, _e = tree.operations; _d < _e.length; _d++) {
        var op = _e[_d];
        plan.push.apply(plan, opToPlan(op, groupLookup));
    }
    return plan;
}
function safeProjectionName(name, projection) {
    if (!projection[name]) {
        return name;
    }
    var ix = 2;
    while (projection[name]) {
        name = name + " " + ix;
        ix++;
    }
    return name;
}
function planToQuery(plan) {
    var projection = {};
    var query = app_1.eve.query();
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        switch (step.type) {
            case "find":
                // find is a no-op
                step.size = 0;
                break;
            case "gather":
                var join = {};
                if (step.collection) {
                    join.collection = step.collection;
                }
                var related = step.relatedTo;
                if (related) {
                    if (related.type === "find") {
                        step.size = 2;
                        var linkId_1 = step.id + " | link";
                        query.select("directionless links", { entity: related.entity }, linkId_1);
                        join.entity = [linkId_1, "link"];
                        query.select("collection entities", join, step.id);
                    }
                    else {
                        step.size = 2;
                        var linkId_2 = step.id + " | link";
                        query.select("directionless links", { entity: [related.id, "entity"] }, linkId_2);
                        join.entity = [linkId_2, "link"];
                        query.select("collection entities", join, step.id);
                    }
                }
                else {
                    step.size = 1;
                    query.select("collection entities", join, step.id);
                }
                step.name = safeProjectionName(step.collection, projection);
                projection[step.name] = [step.id, "entity"];
                break;
            case "lookup":
                var join = { attribute: step.attribute };
                var related = step.relatedTo;
                if (related) {
                    if (related.type === "find") {
                        join.entity = related.entity;
                    }
                    else {
                        join.entity = [related.id, "entity"];
                    }
                }
                step.size = 1;
                query.select("entity eavs", join, step.id);
                step.name = safeProjectionName(step.attribute, projection);
                projection[step.name] = [step.id, "value"];
                break;
            case "intersect":
                var related = step.relatedTo;
                if (step.deselect) {
                    step.size = 0;
                    query.deselect("collection entities", { collection: step.collection, entity: [related.id, "entity"] });
                }
                else {
                    step.size = 0;
                    query.select("collection entities", { collection: step.collection, entity: [related.id, "entity"] }, step.id);
                }
                break;
            case "filter by entity":
                var related = step.relatedTo;
                var linkId = step.id + " | link";
                if (step.deselect) {
                    step.size = 0;
                    query.deselect("directionless links", { entity: [related.id, "entity"], link: step.entity });
                }
                else {
                    step.size = 1;
                    query.select("directionless links", { entity: [related.id, "entity"], link: step.entity }, step.id);
                }
                break;
            case "filter":
                step.size = 0;
                query.calculate(step.func, step.args, step.id);
                break;
            case "calculate":
                step.size = 1;
                query.calculate(step.func, step.args, step.id);
                step.name = safeProjectionName(step.func, projection);
                projection[step.name] = [step.id, "result"];
                break;
            case "aggregate":
                step.size = 1;
                query.aggregate(step.aggregate, step.args, step.id);
                step.name = safeProjectionName(step.aggregate, projection);
                projection[step.name] = [step.id, step.aggregate];
                break;
            case "group":
                step.size = 0;
                query.group(step.groups);
                break;
            case "sort":
                step.size = 0;
                query.sort(step.sort);
                break;
            case "limit":
                step.size = 0;
                query.limit(step.limit);
                break;
        }
    }
    query.project(projection);
    return query;
}
exports.planToQuery = planToQuery;
function newSearch(searchString) {
    var all = newSearchTokens(searchString);
    var tree = planTree(searchString);
    var plan = treeToPlan(tree);
    var query = planToQuery(plan);
    return { tokens: all, plan: plan, query: query };
}
exports.newSearch = newSearch;
function arrayIntersect(a, b) {
    var ai = 0;
    var bi = 0;
    var result = [];
    while (ai < a.length && bi < b.length) {
        if (a[ai] < b[bi])
            ai++;
        else if (a[ai] > b[bi])
            bi++;
        else {
            result.push(a[ai]);
            ai++;
            bi++;
        }
    }
    return result;
}
function entityTocollectionsArray(entity) {
    var entities = app_1.eve.find("collection entities", { entity: entity });
    return entities.map(function (a) { return a["collection"]; });
}
function extractFromUnprojected(coll, ix, field, size) {
    var results = [];
    for (var i = 0, len = coll.length; i < len; i += size) {
        results.push(coll[i + ix][field]);
    }
    return results;
}
function findCommonCollections(ents) {
    var intersection = entityTocollectionsArray(ents[0]);
    intersection.sort();
    for (var _i = 0, _a = ents.slice(1); _i < _a.length; _i++) {
        var entId = _a[_i];
        var cur = entityTocollectionsArray(entId);
        cur.sort();
        arrayIntersect(intersection, cur);
    }
    intersection.sort(function (a, b) {
        return app_1.eve.findOne("collection", { collection: b })["count"] - app_1.eve.findOne("collection", { collection: a })["count"];
    });
    return intersection;
}
// e.g. "salaries in engineering"
// e.g. "chris's age"
function findEntToAttrRelationship(ent, attr) {
    // check if this ent has that attr
    var directAttribute = app_1.eve.findOne("entity eavs", { entity: ent, attribute: attr });
    if (directAttribute) {
        return { distance: 0, type: "ent->eav" };
    }
    var relationships = app_1.eve.query("")
        .select("entity links", { entity: ent }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 0, "link", 2);
        return { distance: 1, type: "ent->eav", nodes: [findCommonCollections(entities)] };
    }
    var relationships2 = app_1.eve.query("")
        .select("entity links", { entity: ent }, "links")
        .select("entity links", { entity: ["links", "link"] }, "links2")
        .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 0, "link", 3);
        var entities2 = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: "ent->eav", nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }
}
// e.g. "salaries per department"
function findCollectionToAttrRelationship(coll, attr) {
    var direct = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("entity eavs", { entity: ["collection", "entity"], attribute: attr }, "eav")
        .exec();
    if (direct.unprojected.length) {
        return { distance: 0, type: "coll->eav", nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 1, "link", 3);
        return { distance: 1, type: "coll->eav", nodes: [findCommonCollections(entities)] };
    }
    var relationships2 = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("directionless links", { entity: ["links", "link"] }, "links2")
        .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 4);
        var entities2 = extractFromUnprojected(relationships2.unprojected, 2, "link", 4);
        return { distance: 2, type: "coll->eav", nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }
}
// e.g. "meetings john was in"
function findCollectionToEntRelationship(coll, ent) {
    if (coll === "collections") {
        if (app_1.eve.findOne("collection entities", { entity: ent })) {
            return { distance: 0, type: "ent->collection" };
        }
    }
    if (app_1.eve.findOne("collection entities", { collection: coll, entity: ent })) {
        return { distance: 0, type: "coll->ent", nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"], link: ent }, "links")
        .exec();
    if (relationships.unprojected.length) {
        return { distance: 1, type: "coll->ent", nodes: [] };
    }
    // e.g. events with chris granger (events -> meetings -> chris granger)
    var relationships2 = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: "coll->ent", nodes: [findCommonCollections(entities)] };
    }
}
// e.g. "authors and papers"
function findCollectionToCollectionRelationship(coll, coll2) {
    // are there things in both sets?
    var intersection = app_1.eve.query(coll + "->" + coll2)
        .select("collection entities", { collection: coll }, "coll1")
        .select("collection entities", { collection: coll2, entity: ["coll1", "entity"] }, "coll2")
        .exec();
    //is there a relationship between things in both sets
    var relationships = app_1.eve.query("relationships between " + coll + " and " + coll2)
        .select("collection entities", { collection: coll }, "coll1")
        .select("directionless links", { entity: ["coll1", "entity"] }, "links")
        .select("collection entities", { collection: coll2, entity: ["links", "link"] }, "coll2")
        .group([["links", "type"]])
        .aggregate("count", {}, "count")
        .project({ type: ["links", "type"], count: ["count", "count"] })
        .exec();
    var maxRel = { count: 0 };
    for (var _i = 0, _a = relationships.results; _i < _a.length; _i++) {
        var result = _a[_i];
        if (result.count > maxRel.count)
            maxRel = result;
    }
    // we divide by two because unprojected results pack rows next to eachother
    // and we have two selects.
    var intersectionSize = intersection.unprojected.length / 2;
    if (maxRel.count > intersectionSize) {
        return { distance: 1, type: "coll->coll" };
    }
    else if (intersectionSize > maxRel.count) {
        return { distance: 0, type: "coll->coll" };
    }
    else if (maxRel.count === 0 && intersectionSize === 0) {
        return;
    }
    else {
        return { distance: 1, type: "coll->coll" };
    }
}
function CodeMirrorElement(node, elem) {
    var cm = node.editor;
    if (!cm) {
        cm = node.editor = new CodeMirror(node, {
            mode: "gfm",
            lineWrapping: true,
            extraKeys: {
                "Cmd-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    commitEntity(cm, latest);
                },
                "Ctrl-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    commitEntity(cm, latest);
                }
            }
        });
        if (elem.onInput) {
            cm.on("change", elem.onInput);
        }
        if (elem.keydown) {
            cm.on("keydown", function (cm) { elem.keydown(cm, elem); });
        }
        if (elem.blur) {
            cm.on("blur", function (cm) { elem.blur(cm, elem); });
        }
        cm.focus();
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value);
    }
}
function NewBitEditor(node, elem) {
    var cm = node.editor;
    if (!cm) {
        cm = node.editor = new CodeMirror(node, {
            mode: "gfm",
            lineWrapping: true,
            extraKeys: {
                "Cmd-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    submitAction(cm, latest);
                },
                "Ctrl-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    submitAction(cm, latest);
                }
            }
        });
        if (elem.onInput) {
            cm.on("change", elem.onInput);
        }
        if (elem.keydown) {
            cm.on("keydown", function (cm) { elem.keydown(cm, elem); });
        }
        if (elem.blur) {
            cm.on("blur", function (cm) { elem.blur(cm, elem); });
        }
        cm.focus();
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value);
    }
}
function CMSearchBox(node, elem) {
    var cm = node.editor;
    if (!cm) {
        var state = { marks: [] };
        cm = node.editor = new CodeMirror(node, {
            lineWrapping: true,
            extraKeys: {
                "Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    app.dispatch("setSearch", { value: cm.getValue(), searchId: latest.searchId }).commit();
                }
            }
        });
        cm.on("change", function (cm) {
            var value = cm.getValue();
            var tokens = newSearchTokens(value);
            for (var _i = 0, _a = state.marks; _i < _a.length; _i++) {
                var mark = _a[_i];
                mark.clear();
            }
            state.marks = [];
            for (var _b = 0; _b < tokens.length; _b++) {
                var token = tokens[_b];
                var start = cm.posFromIndex(token.pos);
                var stop = cm.posFromIndex(token.pos + token.orig.length);
                state.marks.push(cm.markText(start, stop, { className: token.type }));
            }
        });
        cm.focus();
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value);
    }
}
function entityToGraph(entityId, content) {
    var parsed = parseEntity(entityId, content);
    var links = [];
    for (var _i = 0, _a = parsed.links; _i < _a.length; _i++) {
        var link = _a[_i];
        links.push({ link: link.link.toLowerCase(), type: (link.linkType || "unknown").toLowerCase() });
    }
    for (var _b = 0, _c = parsed.collections; _b < _c.length; _b++) {
        var collection = _c[_b];
        links.push({ link: collection.link.toLowerCase(), type: "collection" });
    }
    return links;
}
//---------------------------------------------------------
// Wiki
//---------------------------------------------------------
var dragging = null;
app.handle("startEditingEntity", function (result, info) {
    result.add("editing", { editing: true, search: info.searchId });
});
app.handle("stopEditingEntity", function (result, info) {
    if (!app_1.eve.findOne("editing"))
        return;
    result.remove("editing");
    var entity = info.entity, value = info.value;
    entity = entity.toLowerCase();
    result.add("manual entity", { entity: entity, content: value });
    result.remove("manual entity", { entity: entity });
});
app.handle("setSearch", function (result, info) {
    var searchId = info.searchId;
    var search = app_1.eve.findOne("search query", { id: searchId })["search"];
    if (search === info.value)
        return;
    if (!app_1.eve.findOne("history stack", { entity: search })) {
        var stack = app_1.eve.find("history stack");
        result.add("history stack", { entity: search, pos: stack.length });
    }
    var newSearchValue = info.value.trim();
    app.activeSearches[searchId] = newSearch(newSearchValue);
    result.remove("builtin search query", { id: searchId });
    result.add("builtin search query", { id: searchId, search: newSearchValue });
});
app.handle("submitAction", function (result, info) {
    var searchId = info.searchId;
    var search = app_1.eve.findOne("search query", { id: searchId })["search"];
    result.merge(saveSearch(search, app.activeSearches[searchId].query));
    if (info.type === "attribute") {
        if (!info.entity || !info.attribute || !info.value)
            return;
        result.merge(addEavAction(search, info.entity, info.attribute, info.value));
    }
    else if (info.type === "collection") {
        result.merge(addToCollectionAction(search, info.entity, info.collection));
    }
    else if (info.type === "bit") {
        result.merge(addBitAction(search, info.template, app.activeSearches[searchId].query));
    }
});
app.handle("addNewSearch", function (result, info) {
    var id = uuid();
    var search = info.search || "foo";
    app.activeSearches[id] = newSearch(search);
    result.add("builtin search", { id: id, top: info.top || 100, left: info.left || 100 });
    result.add("builtin search query", { id: id, search: search });
});
app.handle("removeSearch", function (result, info) {
    var searchId = info.searchId;
    if (!searchId)
        return;
    result.remove("builtin search", { id: searchId });
    result.remove("builtin search query", { id: searchId });
    app.activeSearches[searchId] = null;
});
app.handle("startAddingAction", function (result, info) {
    result.remove("adding action");
    result.add("adding action", { type: info.type, search: info.searchId });
});
app.handle("stopAddingAction", function (result, info) {
    result.remove("adding action");
});
app.handle("removeAction", function (result, info) {
    if (info.type === "eav") {
        result.merge(removeAddEavAction(info.actionId));
    }
    else if (info.type === "collection") {
        result.merge(removeAddToCollectionAction(info.actionId));
    }
    else if (info.type === "bit") {
        result.merge(removeAddBitAction(info.actionId));
    }
});
app.handle("startDragging", function (result, info) {
    var searchId = info.searchId, x = info.x, y = info.y;
    var pos = app_1.eve.findOne("search", { id: searchId });
    dragging = { id: searchId, offsetTop: y - pos.top, offsetLeft: x - pos.left };
});
app.handle("stopDragging", function (result, info) {
    dragging = null;
});
app.handle("moveSearch", function (result, info) {
    var searchId = info.searchId, x = info.x, y = info.y;
    result.remove("builtin search", { id: searchId });
    result.add("builtin search", { id: searchId, top: y - dragging.offsetTop, left: x - dragging.offsetLeft });
});
app.handle("toggleShowPlan", function (result, info) {
    if (app_1.eve.findOne("showPlan", { search: info.searchId })) {
        result.remove("showPlan", { search: info.searchId });
    }
    else {
        result.add("showPlan", { search: info.searchId });
    }
});
function root() {
    if (window["slides"]) {
        return window["slides"].root();
    }
    else {
        return eveRoot();
    }
}
exports.root = root;
function eveRoot() {
    var searchers = [];
    for (var _i = 0, _a = app_1.eve.find("search"); _i < _a.length; _i++) {
        var search = _a[_i];
        searchers.push(newSearchResults(search.id));
    }
    return { id: "root", c: "root", dblclick: addNewSearch, children: [
            //       slideControls(),
            { c: "canvas", mousemove: maybeDrag, children: searchers },
        ] };
}
exports.eveRoot = eveRoot;
function maybeDrag(e, elem) {
    if (dragging) {
        app.dispatch("moveSearch", { searchId: dragging.id, x: e.clientX, y: e.clientY }).commit();
        e.preventDefault();
    }
}
function addNewSearch(e, elem) {
    if (e.target.classList.contains("canvas")) {
        app.dispatch("addNewSearch", { top: e.clientY, left: e.clientX }).commit();
        e.preventDefault();
    }
}
function entityUi(entityId, instance, searchId) {
    if (instance === void 0) { instance = ""; }
    var entity = app_1.eve.findOne("entity", { entity: entityId }) || { content: "" };
    var entityView;
    if (!app_1.eve.findOne("editing", { search: searchId })) {
        entityView = { id: "" + entityId + instance, c: "entity", searchId: searchId, entity: entityId, children: entityToHTML(parseEntity(entityId, entity.content).lines, searchId), dblclick: editEntity, enter: { display: "flex", opacity: 1, duration: 300 } };
    }
    else {
        entityView = { id: "" + entityId + instance + "|editor", c: "entity editor", entity: entityId, searchId: searchId, postRender: CodeMirrorElement, value: entity.content, blur: commitEntity };
    }
    var relatedBits = [];
    for (var _i = 0, _a = app_1.eve.find("added eavs", { entity: entityId }); _i < _a.length; _i++) {
        var added = _a[_i];
        relatedBits.push({ c: "bit attribute", click: followLink, searchId: searchId, linkText: added["source view"], children: [
                { c: "header attribute", text: added.attribute },
                { c: "value", text: added.value },
            ] });
    }
    for (var _b = 0, _c = app_1.eve.find("added collections", { entity: entityId }); _b < _c.length; _b++) {
        var added = _c[_b];
        relatedBits.push({ c: "bit collection", click: followLink, searchId: searchId, linkText: added["source view"], children: [
                { c: "header collection", text: added.collection },
            ] });
    }
    for (var _d = 0, _e = app_1.eve.find("entity links", { link: entityId }); _d < _e.length; _d++) {
        var incoming = _e[_d];
        if (incoming.entity === entityId)
            continue;
        relatedBits.push({ c: "bit entity", click: followLink, searchId: searchId, linkText: incoming.entity, children: [
                { c: "header entity", text: incoming.entity },
            ] });
    }
    return { c: "entity-container", children: [
            entityView,
            { c: "related-bits", children: relatedBits },
        ] };
}
function searchDescription(tokens, plan) {
    var planChildren = [];
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        if (step.type === "gather") {
            var related = step.relatedTo ? "related to those" : "";
            var coll = "anything";
            if (step.collection) {
                coll = pluralize(step.collection, 2);
            }
            planChildren.push({ c: "text collection", text: "gather " + coll + " " + related });
        }
        else if (step.type === "intersect") {
            if (step.deselect) {
                planChildren.push({ c: "text", text: "remove the " + pluralize(step.collection, 2) });
            }
            else {
                planChildren.push({ c: "text", text: "keep only the " + pluralize(step.collection, 2) });
            }
        }
        else if (step.type === "lookup") {
            planChildren.push({ c: "text attribute", text: "lookup " + step.attribute });
        }
        else if (step.type === "find") {
            planChildren.push({ c: "text entity", text: "find " + step.entity });
        }
        else if (step.type === "filter by entity") {
            if (step.deselect) {
                planChildren.push({ c: "text entity", text: "remove anything related to " + step.entity });
            }
            else {
                planChildren.push({ c: "text entity", text: "related to " + step.entity });
            }
        }
        else if (step.type === "filter") {
            planChildren.push({ c: "text operation", text: "filter those by " + step.func });
        }
        else if (step.type === "sort") {
            planChildren.push({ c: "text operation", text: "sort them by " });
        }
        else if (step.type === "group") {
            planChildren.push({ c: "text operation", text: "group them by " });
        }
        else if (step.type === "limit") {
            var limit = void 0;
            if (step.limit.results) {
                limit = "to " + step.limit.results + " results";
            }
            else {
                limit = "to " + step.limit.perGroup + " items per group";
            }
            planChildren.push({ c: "text operation", text: "limit " + limit });
        }
        else if (step.type === "calculate") {
            planChildren.push({ c: "text operation", text: step.type + "->" });
        }
        else if (step.type === "aggregate") {
            planChildren.push({ c: "text operation", text: "" + step.aggregate });
        }
        else {
            planChildren.push({ c: "text", text: step.type + "->" });
        }
    }
    return { c: "container", children: [
            { c: "search-plan", children: planChildren }
        ] };
}
function newSearchResults(searchId) {
    var _a = app_1.eve.findOne("search", { id: searchId }), top = _a.top, left = _a.left;
    var search = app_1.eve.findOne("search query", { id: searchId })["search"];
    var _b = app.activeSearches[searchId], tokens = _b.tokens, plan = _b.plan, query = _b.query;
    var resultItems = [];
    var groupedFields = {};
    if (query && plan.length > 1) {
        // figure out what fields are grouped, if any
        for (var _i = 0; _i < plan.length; _i++) {
            var step = plan[_i];
            if (step.type === "group") {
                for (var _c = 0, _d = step.groupNodes; _c < _d.length; _c++) {
                    var node = _d[_c];
                    var name_1 = void 0;
                    for (var _e = 0; _e < plan.length; _e++) {
                        var searchStep = plan[_e];
                        if (searchStep.id === node.id) {
                            name_1 = searchStep.name;
                            break;
                        }
                    }
                    groupedFields[name_1] = true;
                }
            }
            else if (step.type === "aggregate") {
                groupedFields[step.name] = true;
            }
        }
        var results = query.exec();
        var groupInfo = results.groupInfo;
        var planLength = plan.length;
        row: for (var ix = 0, len = results.unprojected.length; ix < len; ix += query.unprojectedSize) {
            if (groupInfo && ix > groupInfo.length)
                break;
            if (groupInfo && groupInfo[ix] === undefined)
                continue;
            var resultItem = void 0;
            if (groupInfo && !resultItems[groupInfo[ix]]) {
                resultItem = resultItems[groupInfo[ix]] = { c: "path", children: [] };
            }
            else if (!groupInfo) {
                resultItem = { c: "path", children: [] };
                resultItems.push(resultItem);
            }
            else {
                resultItem = resultItems[groupInfo[ix]];
            }
            var planOffset = 0;
            for (var planIx = 0; planIx < planLength; planIx++) {
                var planItem = plan[planIx];
                if (planItem.size) {
                    var resultPart = results.unprojected[ix + planOffset + planItem.size - 1];
                    if (!resultPart)
                        continue row;
                    var text = void 0, klass = void 0, click = void 0, link = void 0;
                    if (planItem.type === "gather") {
                        text = resultPart["entity"];
                        klass = "entity";
                        click = followLink;
                        link = resultPart["entity"];
                        if (planIx > 0) {
                        }
                    }
                    else if (planItem.type === "lookup") {
                        text = resultPart["value"];
                        klass = "attribute";
                    }
                    else if (planItem.type === "aggregate") {
                        text = resultPart[planItem.aggregate];
                        klass = "value";
                    }
                    else if (planItem.type === "filter by entity") {
                    }
                    else {
                        text = JSON.stringify(resultPart);
                    }
                    if (text) {
                        var rand = Math.floor(Math.random() * 20) + 1;
                        var item = { id: searchId + " " + ix + " " + planIx, c: "bit " + klass, text: text, click: click, searchId: searchId, linkText: link, enter: { opacity: 1, duration: rand * 100, delay: ix * 0 } };
                        if (groupedFields[planItem.name] && !resultItem.children[planIx]) {
                            resultItem.children[planIx] = { c: "sub-group", children: [item] };
                        }
                        else if (!groupedFields[planItem.name] && !resultItem.children[planIx]) {
                            resultItem.children[planIx] = { c: "sub-group", children: [item] };
                        }
                        else if (!groupedFields[planItem.name]) {
                            resultItem.children[planIx].children.push(item);
                        }
                    }
                    planOffset += planItem.size;
                }
            }
        }
    }
    var noHeaders = false;
    if (plan.length === 1 && plan[0].type === "find") {
        resultItems.push({ c: "singleton", children: [entityUi(plan[0].entity, searchId, searchId)] });
    }
    else if (plan.length === 1 && plan[0].type === "gather") {
        resultItems.unshift({ c: "singleton", children: [entityUi(plan[0].collection, searchId, searchId)] });
        noHeaders = true;
    }
    else if (plan.length === 0) {
        resultItems.push({ c: "singleton", children: [entityUi(search.toLowerCase(), searchId, searchId)] });
    }
    var actions = [];
    for (var _f = 0, _g = app_1.eve.find("add eav action", { view: search }); _f < _g.length; _f++) {
        var eavAction = _g[_f];
        actions.push({ c: "action", children: [
                { c: "collection", text: "" + pluralize(eavAction.entity, 3) },
                { text: " have " },
                { c: "header attribute", text: eavAction.attribute },
                { text: " = " },
                { c: "value", text: eavAction.field },
                { c: "spacer" },
                { c: "ion-android-close", click: removeAction, actionType: "eav", actionId: eavAction.action }
            ] });
    }
    for (var _h = 0, _j = app_1.eve.find("add collection action", { view: search }); _h < _j.length; _h++) {
        var collectionAction = _j[_h];
        actions.push({ c: "action", children: [
                { c: "collection", text: "" + pluralize(collectionAction.field, 3) },
                { text: " are " },
                { c: "header collection", text: pluralize(collectionAction.collection, 2) },
                { c: "spacer" },
                { c: "ion-android-close", click: removeAction, actionType: "collection", actionId: collectionAction.action }
            ] });
    }
    for (var _k = 0, _l = app_1.eve.find("add bit action", { view: search }); _k < _l.length; _k++) {
        var bitAction = _l[_k];
        var template = bitAction.template, action = bitAction.action;
        actions.push({ c: "action new-bit", children: [
                { c: "description", text: "actions" },
                { c: "bit entity", children: entityToHTML(parseEntity(action, template).lines, null) },
                { c: "spacer" },
                { c: "ion-android-close", click: removeAction, actionType: "bit", actionId: bitAction.action }
            ] });
    }
    var addActionChildren = [];
    var adding = app_1.eve.findOne("adding action", { search: searchId });
    if (adding) {
        if (adding.type === "attribute") {
            addActionChildren.push({ c: "add-attribute", children: [
                    { t: "input", c: "entity", placeholder: "entity" },
                    { text: " have " },
                    { t: "input", c: "attribute", placeholder: "attribute" },
                    { text: " = " },
                    { t: "input", c: "value", placeholder: "value" },
                    { c: "spacer" },
                    { c: "button", text: "submit", click: submitAction, searchId: searchId },
                    { c: "button", text: "cancel", click: stopAddingAction },
                ] });
        }
        else if (adding.type === "collection") {
            addActionChildren.push({ c: "add-collection", children: [
                    { text: "These " },
                    { t: "input", c: "entity", placeholder: "entity" },
                    { text: " are " },
                    { t: "input", c: "collection", placeholder: "collection" },
                    { c: "spacer" },
                    { c: "button", text: "submit", click: submitAction, searchId: searchId },
                    { c: "button", text: "cancel", click: stopAddingAction },
                ] });
        }
        else if (adding.type === "bit") {
            addActionChildren.push({ c: "add-collection", children: [
                    { c: "new-bit-editor", searchId: searchId, value: "hi!", postRender: NewBitEditor },
                    { c: "spacer" },
                    //         {c: "button", text: "submit", click: submitAction},
                    { c: "button", text: "cancel", click: stopAddingAction },
                ] });
        }
    }
    else {
        addActionChildren.push({ c: "", text: "+ entity", actionType: "bit", searchId: searchId, click: startAddingAction });
        addActionChildren.push({ c: "", text: "+ attribute", actionType: "attribute", searchId: searchId, click: startAddingAction });
        addActionChildren.push({ c: "", text: "+ collection", actionType: "collection", searchId: searchId, click: startAddingAction });
    }
    var headers = [];
    // figure out what the headers are
    if (!noHeaders) {
        for (var _m = 0; _m < plan.length; _m++) {
            var step = plan[_m];
            if (step.type === "filter by entity")
                continue;
            if (step.size === 0)
                continue;
            headers.push({ text: step.name });
        }
    }
    var isDragging = dragging && dragging.id === searchId ? "dragging" : "";
    var showPlan = app_1.eve.findOne("showPlan", { search: searchId }) ? searchDescription(tokens, plan) : undefined;
    return { id: searchId + "|container", c: "container search-container " + isDragging, top: top, left: left, children: [
            { c: "search-input", mousedown: startDragging, mouseup: stopDragging, searchId: searchId, children: [
                    { c: "search-box", value: search, postRender: CMSearchBox, searchId: searchId },
                    { c: "ion-android-close close", click: removeSearch, searchId: searchId },
                    { c: "ion-ios-arrow-" + (showPlan ? 'up' : 'down') + " plan", click: toggleShowPlan, searchId: searchId },
                ] },
            showPlan,
            { c: "search-headers", children: headers },
            { c: "search-results", children: resultItems },
            //       randomlyLetter(`I found ${resultItems.length} results.`),
            { c: "", children: actions },
            { c: "add-action", children: addActionChildren }
        ] };
}
exports.newSearchResults = newSearchResults;
function removeAction(e, elem) {
    app.dispatch("removeAction", { type: elem.actionType, actionId: elem.actionId }).commit();
}
function toggleShowPlan(e, elem) {
    app.dispatch("toggleShowPlan", { searchId: elem.searchId }).commit();
}
function startDragging(e, elem) {
    if (e.target === e.currentTarget) {
        app.dispatch("startDragging", { searchId: elem.searchId, x: e.clientX, y: e.clientY }).commit();
    }
}
function stopDragging(e, elem) {
    if (e.target === e.currentTarget) {
        app.dispatch("stopDragging", {}).commit();
    }
}
function removeSearch(e, elem) {
    app.dispatch("removeSearch", { searchId: elem.searchId }).commit();
}
function startAddingAction(e, elem) {
    app.dispatch("startAddingAction", { type: elem.actionType, searchId: elem.searchId }).commit();
}
function stopAddingAction(e, elem) {
    app.dispatch("stopAddingAction", {}).commit();
}
function submitAction(e, elem) {
    var values = { type: app_1.eve.findOne("adding action")["type"],
        searchId: elem.searchId };
    if (values.type === "bit") {
        if (e.getValue) {
            values.template = e.getValue();
        }
        else {
            var editor = e.currentTarget.parentNode.querySelector("new-bit-editor").editor;
            values.template = editor.getValue();
        }
    }
    else {
        var parent_1 = e.currentTarget.parentNode;
        for (var _i = 0, _a = parent_1.childNodes; _i < _a.length; _i++) {
            var child = _a[_i];
            if (child.nodeName === "INPUT") {
                values[child.className] = child.value;
            }
        }
    }
    app.dispatch("submitAction", values)
        .dispatch("stopAddingAction", {})
        .commit();
}
function commitEntity(cm, elem) {
    app.dispatch("stopEditingEntity", { searchId: elem.searchId, entity: elem.entity, value: cm.getValue() }).commit();
}
function editEntity(e, elem) {
    app.dispatch("startEditingEntity", { searchId: elem.searchId, entity: elem.entity }).commit();
    e.preventDefault();
}
function followLink(e, elem) {
    app.dispatch("setSearch", { value: elem.linkText, searchId: elem.searchId }).commit();
}
function saveSearch(name, query) {
    if (!app_1.eve.findOne("view", { view: name })) {
        query.name = name;
        var diff_1 = queryObjectToDiff(query);
        return diff_1;
    }
    else {
        return app_1.eve.diff();
    }
}
function addToCollectionAction(name, field, collection) {
    var diff = app_1.eve.diff();
    // add an action
    var action = name + "|" + field + "|" + collection;
    diff.add("add collection action", { view: name, action: action, field: field, collection: collection });
    diff.add("action", { view: "added collections", action: action, kind: "union", ix: 1 });
    // a source
    diff.add("action source", { action: action, "source view": name });
    // a mapping
    diff.add("action mapping", { action: action, from: "entity", "to source": action, "to field": field });
    diff.add("action mapping constant", { action: action, from: "collection", value: collection });
    diff.add("action mapping constant", { action: action, from: "source view", value: name });
    return diff;
}
function removeAddToCollectionAction(action) {
    var info = app_1.eve.findOne("add collection action", { action: action });
    if (info) {
        var diff_2 = addToCollectionAction(info.view, info.field, info.collection);
        return diff_2.reverse();
    }
    else {
        return app_1.eve.diff();
    }
}
function addEavAction(name, entity, attribute, field) {
    var diff = app_1.eve.diff();
    // add an action
    var action = name + "|" + entity + "|" + attribute + "|" + field;
    diff.add("add eav action", { view: name, action: action, entity: entity, attribute: attribute, field: field });
    diff.add("action", { view: "added eavs", action: action, kind: "union", ix: 1 });
    // a source
    diff.add("action source", { action: action, "source view": name });
    // a mapping
    diff.add("action mapping", { action: action, from: "entity", "to source": action, "to field": entity });
    diff.add("action mapping", { action: action, from: "value", "to source": action, "to field": field });
    diff.add("action mapping constant", { action: action, from: "attribute", value: attribute });
    diff.add("action mapping constant", { action: action, from: "source view", value: name });
    return diff;
}
function removeAddEavAction(action) {
    var info = app_1.eve.findOne("add eav action", { action: action });
    if (info) {
        var diff_3 = addEavAction(info.view, info.entity, info.attribute, info.field);
        return diff_3.reverse();
    }
    else {
        return app_1.eve.diff();
    }
}
function addBitAction(name, template, query) {
    console.log(name, template, query);
    var diff = app_1.eve.diff();
    var names = Object.keys(query.projectionMap);
    // add an action
    var bitQueryId = name + "|bit";
    var action = name + "|" + template;
    diff.add("add bit action", { view: name, action: action, template: template });
    diff.remove("add bit action", { view: name });
    var bitQuery = app_1.eve.query(bitQueryId)
        .select("add bit action", { view: name }, "action")
        .select(name, {}, "table")
        .calculate("bit template", { row: ["table"], name: name, template: ["action", "template"] }, "result")
        .project({ entity: ["result", "entity"], content: ["result", "content"] });
    diff.merge(queryObjectToDiff(bitQuery));
    diff.merge(removeView(bitQueryId));
    diff.add("action", { view: "added bits", action: action, kind: "union", ix: 1 });
    // a source
    diff.add("action source", { action: action, "source view": bitQueryId });
    // a mapping
    diff.add("action mapping", { action: action, from: "entity", "to source": action, "to field": "entity" });
    diff.add("action mapping", { action: action, from: "content", "to source": action, "to field": "content" });
    diff.add("action mapping constant", { action: action, from: "source view", value: name });
    return diff;
}
function removeAddBitAction(action) {
    var info = app_1.eve.findOne("add bit action", { action: action });
    if (info) {
        var diff_4 = addBitAction(info.view, info.entity, info.attribute);
        return diff_4.reverse();
    }
    else {
        return app_1.eve.diff();
    }
}
function removeView(view) {
    return runtime.Query.remove(view, app_1.eve);
}
exports.removeView = removeView;
function clearSaved() {
    var diff = app_1.eve.diff();
    diff.remove("view");
    diff.remove("action");
    diff.remove("action source");
    diff.remove("action mapping");
    diff.remove("action mapping constant");
    diff.remove("action mapping sorted");
    diff.remove("action mapping limit");
    diff.remove("add collection action");
    diff.remove("add eav action");
    return diff;
}
exports.clearSaved = clearSaved;
//---------------------------------------------------------
// AST and compiler
//---------------------------------------------------------
// view: view, kind[union|query|table]
// action: view, action, kind[select|calculate|project|union|ununion|stateful|limit|sort|group|aggregate], ix
// action source: action, source view
// action mapping: action, from, to source, to field
// action mapping constant: action, from, value
var recompileTrigger = {
    exec: function () {
        for (var _i = 0, _a = app_1.eve.find("view"); _i < _a.length; _i++) {
            var view = _a[_i];
            if (view.kind === "table")
                continue;
            var query = compile(app_1.eve, view.view);
            app_1.eve.asView(query);
        }
        return {};
    }
};
app_1.eve.addTable("view", ["view", "kind"]);
app_1.eve.addTable("action", ["view", "action", "kind", "ix"]);
app_1.eve.addTable("action source", ["action", "source view"]);
app_1.eve.addTable("action mapping", ["action", "from", "to source", "to field"]);
app_1.eve.addTable("action mapping constant", ["action", "from", "value"]);
app_1.eve.addTable("action mapping sorted", ["action", "ix", "source", "field", "direction"]);
app_1.eve.addTable("action mapping limit", ["action", "limit type", "value"]);
app_1.eve.table("view").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action source").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping constant").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping sorted").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping limit").triggers["recompile"] = recompileTrigger;
function queryObjectToDiff(query) {
    return query.changeset(app_1.eve);
}
// add the added collections union so that sources can be added to it by
// actions.
var diff = app_1.eve.diff();
diff.add("view", { view: "added collections", kind: "union" });
diff.add("view", { view: "added eavs", kind: "union" });
diff.add("view", { view: "added bits", kind: "union" });
app_1.eve.applyDiff(diff);
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
// Eve functions
//---------------------------------------------------------
runtime.define("entity to graph", { multi: true }, function (entity, text) {
    return entityToGraph(entity, text);
});
runtime.define("parse eavs", { multi: true }, function (entity, text) {
    return parseEntity(entity, text).eavs;
});
runtime.define("bit template", { multi: true }, function (row, name, template) {
    var content = template;
    for (var key in row) {
        var item = row[key];
        content = content.replace(new RegExp("{" + key + "}", "gi"), item);
    }
    var entity;
    var header = content.match(/#.*$/mgi);
    if (header) {
        entity = header[0].replace("#", "").toLowerCase().trim();
    }
    else {
        var rowId = app_1.eve.table(name).stringify(row);
        entity = name + "|" + rowId;
    }
    return [{ entity: entity, content: content }];
});
runtime.define("collection content", {}, function (collection) {
    return { content: "# " + pluralize(collection, 2) };
});
runtime.define("count", {}, function (prev) {
    if (!prev.count) {
        prev.count = 0;
    }
    prev.count++;
    return prev;
});
runtime.define("sum", {}, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
    }
    prev.sum += value;
    return prev;
});
runtime.define("average", {}, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
        prev.count = 0;
    }
    prev.count++;
    prev.sum += value;
    prev.average = prev.sum / prev.count;
    return prev;
});
runtime.define("lowercase", {}, function (text) {
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
runtime.define("+", {}, function (a, b) {
    return { result: a + b };
});
runtime.define("-", {}, function (a, b) {
    return { result: a - b };
});
runtime.define("*", {}, function (a, b) {
    return { result: a * b };
});
runtime.define("/", {}, function (a, b) {
    return { result: a / b };
});
//---------------------------------------------------------
// Queries
//---------------------------------------------------------
// eve.addTable("manual entity", ["entity", "content"]);
// eve.addTable("action entity", ["entity", "content", "source"]);
// eve.asView(eve.union("entity")
//               .union("manual entity", {entity: ["entity"], content: ["content"]})
//               .union("action entity", {entity: ["entity"], content: ["content"]})
//               .union("unmodified added bits", {entity: ["entity"], content: ["content"]})
//               .union("automatic collection entities", {entity: ["entity"], content: ["content"]}));
// eve.asView(eve.query("unmodified added bits")
//               .select("added bits", {}, "added")
//               .deselect("manual entity", {entity: ["added", "entity"]})
//               .project({entity: ["added", "entity"], content: ["added", "content"]}));
// eve.asView(eve.query("parsed eavs")
//             .select("entity", {}, "entity")
//             .calculate("parse eavs", {entity: ["entity", "entity"], text: ["entity", "content"]}, "parsed")
//             .project({entity: ["entity", "entity"], attribute: ["parsed", "attribute"], value: ["parsed", "value"]}));
// eve.asView(eve.union("entity eavs")
//             .union("added collections", {entity: ["entity"], attribute: "is a", value: ["collection"]})
//             .union("parsed eavs", {entity: ["entity"], attribute: ["attribute"], value: ["value"]})
//             // this is a stored union that is used by the add eav action to take query results and
//             // push them into eavs, e.g. sum salaries per department -> [total salary = *]
//             .union("added eavs", {entity: ["entity"], attribute: ["attribute"], value: ["value"]}));
// eve.asView(eve.query("is a attributes")
//               .select("entity eavs", {attribute: "is a"}, "is a")
//               .project({collection: ["is a", "value"], entity: ["is a", "entity"]}));
// @HACK: this view is required because you can't currently join a select on the result of a function.
// so we create a version of the eavs table that already has everything lowercased.
// eve.asView(eve.query("lowercase eavs")
//               .select("entity eavs", {}, "eav")
//               .calculate("lowercase", {text: ["eav", "value"]}, "lower")
//               .project({entity: ["eav", "entity"], attribute: ["eav", "attribute"], value: ["lower", "result"]}));
// eve.asView(eve.query("entity links")
//               .select("lowercase eavs", {}, "eav")
//               .select("entity", {entity: ["eav", "value"]}, "entity")
//               .project({entity: ["eav", "entity"], link: ["entity", "entity"], type: ["eav", "attribute"]}));
// eve.asView(eve.union("directionless links")
//               .union("entity links", {entity: ["entity"], link: ["link"]})
//               .union("entity links", {entity: ["link"], link: ["entity"]}));
// eve.asView(eve.union("collection entities")
//             // the rest of these are editor-level views
//             .union("is a attributes", {entity: ["entity"], collection: ["collection"]})
//             // this is a stored union that is used by the add to collection action to take query results and
//             // push them into collections, e.g. people older than 21 -> [[can drink]]
//             .union("added collections", {entity: ["entity"], collection: ["collection"]}));
// eve.asView(eve.query("collection")
//             .select("collection entities", {}, "collections")
//             .group([["collections", "collection"]])
//             .aggregate("count", {}, "count")
//             .project({collection: ["collections", "collection"], count: ["count", "count"]}));
// eve.asView(eve.query("automatic collection entities")
//               .select("collection", {}, "coll")
//               .deselect("manual entity", {entity: ["coll", "collection"]})
//               .calculate("collection content", {collection: ["coll", "collection"]}, "content")
//               .project({entity: ["coll", "collection"], content: ["content", "content"]}));
//---------------------------------------------------------
// Go
//---------------------------------------------------------
function initSearches() {
    for (var _i = 0, _a = app_1.eve.find("search"); _i < _a.length; _i++) {
        var search = _a[_i];
        app.activeSearches[search.id] = newSearch(app_1.eve.findOne("search query", { id: search.id })["search"]);
    }
}
function initEve() {
    var stored = localStorage[app.eveLocalStorageKey];
    if (!stored) {
        var diff = app_1.eve.diff();
        var id = uuid();
        diff.add("builtin search", { id: id, top: 100, left: 100 });
        diff.add("builtin search query", { id: id, search: "foo" });
        app_1.eve.applyDiff(diff);
    }
    initSearches();
}
app.renderRoots["wiki"] = root;
app.init("wiki", function () {
    document.body.classList.add(localStorage["theme"] || "light");
    app.activeSearches = {};
    initEve();
});
// @TODO: KILL ME
require("./bootstrap");
//# sourceMappingURL=wiki.js.map