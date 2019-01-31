var runtime;
(function (runtime) {
    //---------------------------------------------------------
    // Runtime
    //---------------------------------------------------------
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
    runtime.removeFact = removeFact;
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
        return "for (var i = 0, len = unprojected.length; i < len; i += " + distance + ") {\n        var j = i, " + items.join(", ") + ";\n        for(; j > " + (distance - 1) + " && (" + conditions.join(" || ") + "); j -= " + distance + ") {\n          " + repositioned.join(";\n") + "\n        }\n        " + itemAssignments.join(";\n") + "\n    }";
    }
    function generateCollector(keys) {
        var code = "";
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
        code += "\nfor(var ix = 0, len = removes.length; ix < len; ix++) {\n  var remove = removes[ix];\n  " + removes + "\n}\nfor(var ix = 0, len = adds.length; ix < len; ix++) {\n  var add = adds[ix];\n  var cursor = index;\n  var value;\n  " + checks + "  cursor.push(add);\n}\nreturn index;";
        return new Function("index", "adds", "removes", "equals", code);
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
            tableDiff.adds.push.apply(tableDiff.adds, objs);
        };
        Diff.prototype.removeFacts = function (table, objs) {
            var tableDiff = this.ensureTable(table);
            this.length += objs.length;
            tableDiff.removes.push.apply(tableDiff.removes, objs);
        };
        Diff.prototype.remove = function (table, query) {
            var tableDiff = this.ensureTable(table);
            var found = this.ixer.find(table, query);
            this.length += found.length;
            tableDiff.removes.push.apply(tableDiff.removes, found);
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
            var _a = trigger.exec(), results = _a.results, unprojected = _a.unprojected;
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
            var handled = {};
            var remaining = Object.keys(startingTriggers);
            for (var ix = 0; ix < remaining.length; ix++) {
                var trigger = remaining[ix];
                if (handled[trigger])
                    continue;
                this.clearTable(trigger);
                handled[trigger] = true;
                remaining.push.apply(remaining, Object.keys(this.table(trigger).triggers));
            }
            for (var _i = 0, _a = Object.keys(handled); _i < _a.length; _i++) {
                var trigger = _a[_i];
                var view = this.table(trigger).view;
                if (view) {
                    this.execTrigger(view);
                }
            }
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
        Indexer.prototype.serialize = function () {
            var dump = {};
            for (var tableName in this.tables) {
                var table = this.tables[tableName];
                if (!table.isView) {
                    dump[tableName] = table.table;
                }
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
            var cleared = {};
            var round = 0;
            if (triggers)
                this.transitivelyClearTriggers(triggers);
            while (triggers) {
                // console.group(`ROUND ${round}`);
                triggers = this.execTriggers(triggers);
                round++;
            }
        };
        Indexer.prototype.table = function (tableId) {
            var table = this.tables[tableId];
            if (table)
                return table;
            return this.addTable(tableId);
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
        Indexer.prototype.asView = function (query) {
            var name = query.name;
            var view = this.table(name);
            view.view = query;
            view.isView = true;
            for (var _i = 0, _a = query.tables; _i < _a.length; _i++) {
                var tableName = _a[_i];
                var table = this.table(tableName);
                table.triggers[name] = query;
            }
            var nextRound = this.execTrigger(query);
            while (nextRound) {
                nextRound = this.execTriggers(nextRound);
            }
            ;
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
    runtime.QueryFunctions = {};
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
        runtime.QueryFunctions[name] = opts;
    }
    runtime.define = define;
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
            if (!runtime.QueryFunctions[funcName].filter) {
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
        Query.prototype.applyAliases = function (joinMap) {
            for (var field in joinMap) {
                var joinInfo = joinMap[field];
                if (joinInfo.constructor !== Array || typeof joinInfo[0] === "number")
                    continue;
                var joinTable = joinInfo[0];
                if (this.aliases[joinTable] !== undefined) {
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
                var funcInfo = runtime.QueryFunctions[name_1];
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
            if (this.aggregates.length || sorts.length || this.limitInfo) {
                // we need to store group info for post processing of the unprojected results
                // this will indicate what group number, if any, that each unprojected result belongs to
                root.children.unshift({ type: "declaration", var: "groupInfo", value: "[]" });
                returns.push("groupInfo");
                var aggregateChildren = [];
                for (var _h = 0, _j = this.aggregates; _h < _j.length; _h++) {
                    var func = _j[_h];
                    var args = func.args, name_2 = func.name, ix = func.ix;
                    var funcInfo = runtime.QueryFunctions[name_2];
                    this.applyAliases(args);
                    root.children.unshift({ type: "functionDeclaration", ix: ix, info: funcInfo });
                    aggregateChildren.push({ type: "functionCall", ix: ix, resultsIx: results.length, args: args, info: funcInfo, unprojected: true, children: [] });
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
                        groupLimitCheck = "if(perGroupCount === " + root.limit.perGroup + ") {\n              while(!differentGroup) {\n                nextIx += " + root.size + ";\n                if(nextIx >= len) break;\n                groupInfo[nextIx] = undefined;\n                differentGroup = " + groupCheck + ";\n              }\n            }";
                    }
                    var groupDifference = "";
                    var groupInfo = "";
                    if (this.groups) {
                        groupDifference = "\n            perGroupCount++\n            var differentGroup = " + groupCheck + ";\n            " + groupLimitCheck + "\n            if(differentGroup) {\n              " + projection + "\n              " + aggregateResets.join("\n") + "\n              perGroupCount = 0;\n              resultCount++;\n            }\n";
                        groupInfo = "groupInfo[ix] = resultCount;";
                    }
                    else {
                        groupDifference = "resultCount++;\n";
                        groupInfo = "groupInfo[ix] = 0;";
                    }
                    // if there are neither aggregates to calculate nor groups to build,
                    // then we just need to worry about limiting
                    if (!this.groups && aggregateCalls.length === 0) {
                        code = "var ix = 0;\n                    var resultCount = 0;\n                    var len = unprojected.length;\n                    while(ix < len) {\n                      " + resultsCheck + "\n                      " + projection + "\n                      groupInfo[ix] = resultCount;\n                      resultCount++;\n                      ix += " + root.size + ";\n                    }\n";
                        break;
                    }
                    code = "var resultCount = 0;\n                  var perGroupCount = 0;\n                  var ix = 0;\n                  var nextIx = 0;\n                  var len = unprojected.length;\n                  " + aggregateStates.join("\n") + "\n                  while(ix < len) {\n                    " + aggregateCalls.join("") + "\n                    " + groupInfo + "\n                    if(ix + " + root.size + " === len) {\n                      " + projection + "\n\n                      break;\n                    }\n                    nextIx += " + root.size + ";\n                    " + groupDifference + "\n                    " + resultsCheck + "\n                    ix = nextIx;\n                  }\n";
                    break;
                case "projection":
                    var projectedVars = [];
                    for (var newField in root.projectionMap) {
                        var mapping = root.projectionMap[newField];
                        var value = "";
                        if (mapping.constructor === Array) {
                            if (!root.unprojected || root.unprojected[mapping[0]]) {
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
            return this.compiled(this.ixer, runtime.QueryFunctions);
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
    runtime.SUCCEED = [{ success: true }];
    runtime.FAIL = [];
    function indexer() {
        return new Indexer();
    }
    runtime.indexer = indexer;
})(runtime || (runtime = {}));
//# sourceMappingURL=runtime.js.map