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
//# sourceMappingURL=utils.js.map