var app_1 = require("./app");
function bench2(size, offset) {
    if (offset === void 0) { offset = 0; }
    var items = [];
    console.time("create");
    var set = new ImmutableSet(function (v) { return (v.entity + "|" + v.attribute + "|" + v.value); });
    for (var i = 0; i < size; i++) {
        set._dangerouslyAdd({ entity: "entity" + i, attribute: "name", value: i });
    }
    //     var set = new ImmutableSet((v) => `${v.entity}|${v.attribute}|${v.value}`).addMany(items);
    console.timeEnd("create");
    return set;
}
function bench3(size, offset) {
    if (offset === void 0) { offset = 0; }
    var items = [];
    console.time("create");
    var diff = app_1.eve.diff();
    for (var i = 0; i < size; i++) {
        items[i] = { entity: "entity" + i, attribute: "name", value: i };
    }
    diff.addMany("foo", items);
    app_1.eve.applyDiff(diff);
    console.timeEnd("create");
    return items;
}
var ImmutableSet = (function () {
    function ImmutableSet(toKey) {
        this.keys = [];
        this.values = [];
        this.map = {};
        this.toKey = toKey;
        this.size = 0;
    }
    ImmutableSet.prototype._create = function (keys, values, map) {
        var set = new ImmutableSet(this.toKey);
        set.map = map;
        set.keys = keys;
        set.values = values;
        set.size = keys.length;
        return set;
    };
    ImmutableSet.prototype.dupMap = function () {
        var map = this.map;
        var keys = this.keys;
        var sub = {};
        for (var _i = 0; _i < keys.length; _i++) {
            var key = keys[_i];
            sub[key] = map[key];
        }
        return sub;
    };
    ImmutableSet.prototype.add = function (v) {
        var map = this.map;
        var k = this.toKey(v);
        if (map[k] !== undefined) {
            return this;
        }
        else {
            var map_1 = this.dupMap();
            var keys = this.keys.slice();
            var values = this.values.slice();
            keys.push(k);
            values.push(v);
            map_1[k] = v;
            return this._create(keys, values, map_1);
        }
    };
    ImmutableSet.prototype._dangerouslyAdd = function (v) {
        var map = this.map;
        var k = this.toKey(v);
        if (map[k] !== undefined) {
            return this;
        }
        else {
            var keys = this.keys;
            var values = this.values;
            keys.push(k);
            values.push(v);
            map[k] = v;
            this.size++;
            return this;
        }
    };
    ImmutableSet.prototype.remove = function (v) {
        var map = this.map;
        var k = this.toKey(v);
        if (map[k] === undefined) {
            return this;
        }
        else {
            var map_2 = this.dupMap();
            var curKeys = this.keys;
            var curValues = this.values;
            var keys = [];
            var values = [];
            var newIx = 0;
            for (var keyIx = 0, len = this.size; keyIx < len; keyIx++) {
                var curKey = curKeys[keyIx];
                if (curKey !== k) {
                    keys[newIx] = curKey;
                    values[newIx] = curValues[keyIx];
                    newIx++;
                }
            }
            map_2[k] === undefined;
            return this._create(keys, values, map_2);
        }
    };
    ImmutableSet.prototype.addMany = function (vs) {
        var curMap = this.map;
        var map;
        var keys;
        var values;
        var changed = false;
        for (var _i = 0; _i < vs.length; _i++) {
            var v = vs[_i];
            var k = this.toKey(v);
            if (curMap[k] !== undefined) {
                continue;
            }
            else {
                if (changed === false) {
                    changed = true;
                    map = this.dupMap();
                    keys = this.keys.slice();
                    values = this.values.slice();
                }
                keys.push(k);
                values.push(v);
                map[k] = v;
            }
        }
        if (!changed)
            return this;
        return this._create(keys, values, map);
    };
    ImmutableSet.prototype.removeMany = function (vs) {
        var curMap = this.map;
        var toRemove = {};
        var map;
        var changed = false;
        for (var _i = 0; _i < vs.length; _i++) {
            var v = vs[_i];
            var k = this.toKey(v);
            if (curMap[k] === undefined) {
                continue;
            }
            else {
                if (changed === false) {
                    changed = true;
                    map = this.dupMap();
                }
                map[k] === undefined;
            }
        }
        if (changed === false)
            return this;
        var curKeys = this.keys;
        var curValues = this.values;
        var keys = [];
        var values = [];
        var newIx = 0;
        for (var keyIx = 0, len = this.size; keyIx < len; keyIx++) {
            var curKey = curKeys[keyIx];
            if (toRemove[curKey] === undefined) {
                keys[newIx] = curKey;
                values[newIx] = curValues[keyIx];
                newIx++;
            }
        }
        return this._create(keys, values, map);
    };
    ImmutableSet.prototype.equal = function (set) {
        if (set === this)
            return true;
        if (set.size !== this.size)
            return false;
        var map = set.map;
        for (var _i = 0, _a = this.keys; _i < _a.length; _i++) {
            var key = _a[_i];
            if (map[key] === undefined) {
                return false;
            }
        }
        return true;
    };
    ImmutableSet.prototype.diff = function (set) {
        var adds = [];
        var removes = [];
        var diff = { adds: adds, removes: removes };
        if (set === this)
            return diff;
        var curMap = this.map;
        var map = set.map;
        // what was removed
        for (var _i = 0, _a = this.keys; _i < _a.length; _i++) {
            var key = _a[_i];
            if (map[key] === undefined) {
                removes.push(curMap[key]);
            }
        }
        // what was added
        for (var _b = 0, _c = set.keys; _b < _c.length; _b++) {
            var key = _c[_b];
            if (curMap[key] === undefined) {
                adds.push(map[key]);
            }
        }
        return diff;
    };
    return ImmutableSet;
})();
//   var set = bench2(10000);
//   console.time("set2");
//   var set2 = set.add({entity: "foo", attribute: "name", value: "bar"});
//   console.timeEnd("set2");
//   console.time("diff");
//   console.log(set.diff(set2));
//   console.timeEnd("diff");
//   bench3(10000)
//# sourceMappingURL=immutable.js.map