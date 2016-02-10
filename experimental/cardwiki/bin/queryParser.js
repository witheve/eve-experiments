var app_1 = require("./app");
window["eve"] = app_1.eve;
//---------------------------------------------------------
// Token types
//---------------------------------------------------------
(function (TokenTypes) {
    TokenTypes[TokenTypes["entity"] = 0] = "entity";
    TokenTypes[TokenTypes["collection"] = 1] = "collection";
    TokenTypes[TokenTypes["attribute"] = 2] = "attribute";
    TokenTypes[TokenTypes["modifier"] = 3] = "modifier";
    TokenTypes[TokenTypes["pattern"] = 4] = "pattern";
    TokenTypes[TokenTypes["value"] = 5] = "value";
    TokenTypes[TokenTypes["text"] = 6] = "text";
})(exports.TokenTypes || (exports.TokenTypes = {}));
var TokenTypes = exports.TokenTypes;
//---------------------------------------------------------
// Modifiers
//---------------------------------------------------------
var modifiers = {
    "and": { and: true },
    "or": { or: true },
    "without": { deselected: true },
    "aren't": { deselected: true },
    "don't": { deselected: true },
    "per": { group: true },
    ",": { separator: true },
    "all": { every: true },
    "every": { every: true }
};
//---------------------------------------------------------
// Patterns
//---------------------------------------------------------
var patterns = {
    "older": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age >" }]
    },
    "younger": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age <" }]
    },
    "cheaper": {
        type: "rewrite",
        rewrites: [{ attribute: "price", text: "price <" }, { attribute: "cost", text: "cost <" }]
    },
    "greater than": {
        type: "rewrite",
        rewrites: [{ text: ">" }]
    },
    "years old": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age" }]
    },
    "sum": {
        type: "aggregate",
        op: "sum",
        args: ["a"]
    },
    "top": {
        type: "sort and limit",
        resultingIndirectObject: 1,
        args: ["limit", "attribute"]
    },
    "<": {
        type: "filter",
        op: "<",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"]
    },
    ">": {
        type: "filter",
        op: ">",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"]
    }
};
//---------------------------------------------------------
// Tokenizer
//---------------------------------------------------------
function checkForToken(token) {
    var found;
    if (!token)
        return {};
    if (found = app_1.eve.findOne("collection", { collection: token })) {
        return { found: found, type: TokenTypes.collection };
    }
    else if (found = app_1.eve.findOne("entity", { entity: token })) {
        return { found: found, type: TokenTypes.entity };
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
    else if (token.match(/^-?[\d]+$/gm)) {
        return { type: TokenTypes.value, found: JSON.parse(token), valueType: "number" };
    }
    else if (token.match(/^["][^"]*["]$/gm)) {
        return { type: TokenTypes.value, found: JSON.parse(token), valueType: "string" };
    }
    else if (found = token.match(/^([\d]+)-([\d]+)$/gm)) {
        return { type: TokenTypes.value, found: token, valueType: "range", start: found[1], stop: found[2] };
    }
    return {};
}
function getTokens(string) {
    // remove all non-word non-space characters
    var cleaned = string.replace(/'s/gi, "  ").toLowerCase();
    cleaned = cleaned.replace(/[,.?!]/gi, " , ");
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
            if (orig) {
                results.push({ found: orig, orig: orig, pos: pos, type: TokenTypes.text });
            }
            back = words.length;
            pos += words[front].length + 1;
            front++;
        }
    }
    return results;
}
exports.getTokens = getTokens;
//---------------------------------------------------------
// Relationships between tokens
//---------------------------------------------------------
var RelationshipTypes;
(function (RelationshipTypes) {
    RelationshipTypes[RelationshipTypes["none"] = 0] = "none";
    RelationshipTypes[RelationshipTypes["entityToEntity"] = 1] = "entityToEntity";
    RelationshipTypes[RelationshipTypes["entityToAttribute"] = 2] = "entityToAttribute";
    RelationshipTypes[RelationshipTypes["collectionToCollection"] = 3] = "collectionToCollection";
    RelationshipTypes[RelationshipTypes["collectionIntersection"] = 4] = "collectionIntersection";
    RelationshipTypes[RelationshipTypes["collectionToEntity"] = 5] = "collectionToEntity";
    RelationshipTypes[RelationshipTypes["collectionToAttribute"] = 6] = "collectionToAttribute";
})(RelationshipTypes || (RelationshipTypes = {}));
var tokenRelationships = (_a = {},
    _a[TokenTypes.collection] = (_b = {},
        _b[TokenTypes.collection] = findCollectionToCollectionRelationship,
        _b[TokenTypes.entity] = findCollectionToEntRelationship,
        _b[TokenTypes.attribute] = findCollectionToAttrRelationship,
        _b
    ),
    _a[TokenTypes.entity] = (_c = {},
        _c[TokenTypes.entity] = findEntToEntRelationship,
        _c[TokenTypes.attribute] = findEntToAttrRelationship,
        _c
    ),
    _a
);
function determineRelationship(parent, child) {
    if (!tokenRelationships[parent.type] || !tokenRelationships[parent.type][child.type])
        return { distance: Infinity, type: RelationshipTypes.none };
    return tokenRelationships[parent.type][child.type](parent.found, child.found);
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
function findEntToEntRelationship(ent, ent2) {
    return { distance: Infinity, type: RelationshipTypes.entityToEntity };
}
// e.g. "salaries in engineering"
// e.g. "chris's age"
function findEntToAttrRelationship(ent, attr) {
    // check if this ent has that attr
    var directAttribute = app_1.eve.findOne("entity eavs", { entity: ent, attribute: attr });
    if (directAttribute) {
        return { distance: 0, type: RelationshipTypes.entityToAttribute };
    }
    var relationships = app_1.eve.query("")
        .select("entity links", { entity: ent }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 0, "link", 2);
        return { distance: 1, type: RelationshipTypes.entityToAttribute, nodes: [findCommonCollections(entities)] };
    }
    var relationships2 = app_1.eve.query("")
        .select("entity links", { entity: ent }, "links")
        .select("entity links", { entity: ["links", "link"] }, "links2")
        .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 0, "link", 3);
        var entities2 = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: RelationshipTypes.entityToAttribute, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }
    //otherwise we assume it's direct and mark it as unfound.
    return { distance: 0, type: RelationshipTypes.entityToAttribute, unfound: true };
}
// e.g. "salaries per department"
function findCollectionToAttrRelationship(coll, attr) {
    var direct = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("entity eavs", { entity: ["collection", "entity"], attribute: attr }, "eav")
        .exec();
    if (direct.unprojected.length) {
        return { distance: 0, type: RelationshipTypes.collectionToAttribute, nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 1, "link", 3);
        return { distance: 1, type: RelationshipTypes.collectionToAttribute, nodes: [findCommonCollections(entities)] };
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
        return { distance: 2, type: RelationshipTypes.collectionToAttribute, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
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
        return { distance: 0, type: RelationshipTypes.collectionToEntity, nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"], link: ent }, "links")
        .exec();
    if (relationships.unprojected.length) {
        return { distance: 1, type: RelationshipTypes.collectionToEntity, nodes: [] };
    }
    // e.g. events with chris granger (events -> meetings -> chris granger)
    var relationships2 = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: RelationshipTypes.collectionToEntity, nodes: [findCommonCollections(entities)] };
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
        return { distance: 1, type: RelationshipTypes.collectionToCollection };
    }
    else if (intersectionSize > maxRel.count) {
        return { distance: 0, type: RelationshipTypes.collectionIntersection };
    }
    else if (maxRel.count === 0 && intersectionSize === 0) {
        return;
    }
    else {
        return { distance: 1, type: RelationshipTypes.collectionToCollection };
    }
}
//---------------------------------------------------------
// Token tree
//---------------------------------------------------------
function tokensToTree(origTokens) {
    var tokens = origTokens;
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
    var tree = { directObject: directObject, roots: roots, operations: operations, groups: groups };
    if (!directObject)
        return tree;
    // the direct object is always the first root
    roots.push(directObject);
    // we need to keep state as we traverse the tokens for modifiers and patterns
    var state = { patternStack: [], currentPattern: null, lastAttribute: null };
    // as we parse the query we may encounter other subjects in the sentence, we
    // need a reference to those previous subjects to see if the current token is
    // related to that or the directObject
    var indirectObject = directObject;
    for (var tokenIx = 0, len = tokens.length; tokenIx < len; tokenIx++) {
        var token = tokens[tokenIx];
        var type = token.type, info = token.info, found = token.found;
        // check if the last pass finshed our current pattern.
        if (state.currentPattern && state.currentPattern.args.length) {
            var args = state.currentPattern.args;
            var infoArgs = state.currentPattern.info.args;
            var latestArg = args[args.length - 1];
            var latestArgComplete = latestArg.type === TokenTypes.attribute || latestArg.type === TokenTypes.value;
            while (args.length === infoArgs.length && latestArgComplete) {
                var resultingIndirectObject = state.currentPattern.info.resultingIndirectObject;
                if (resultingIndirectObject !== undefined) {
                    indirectObject = args[resultingIndirectObject];
                }
                else {
                    indirectObject = state.currentPattern;
                }
                state.currentPattern = state.patternStack.pop();
                if (!state.currentPattern)
                    break;
                args = state.currentPattern.args;
                infoArgs = state.currentPattern.info.args;
                args.push(indirectObject);
                latestArg = args[args.length - 1];
                latestArgComplete = latestArg.type === TokenTypes.attribute || latestArg.type === TokenTypes.value;
            }
        }
        // deal with modifiers
        if (type === TokenTypes.modifier) {
            // if this is a deselect modifier, we need to roll forward through the tokens
            // to figure out roughly how far the deselection should go. Also if we run into
            // an and or an or, we need to deal with that specially.
            if (info.deselected) {
                // we're going to move forward from this token and deselect as we go
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.text) {
                    localTokenIx++;
                }
                // negate until we find a reason to stop
                while (localTokenIx < len) {
                    var localToken = tokens[localTokenIx];
                    if (localToken.type === TokenTypes.text) {
                        break;
                    }
                    localToken.deselected = true;
                    localTokenIx++;
                }
            }
            // if we're dealing with an "or" we have two cases, we're either dealing with a negation
            // or a split. If this is a deselected or, we don't really need to do anything because that
            // means we just do a deselected join. If it's not negated though, we're now dealing with
            // a second query context. e.g. people who are employees or spouses of employees
            if (info.or && !token.deslected) {
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.text) {
                    localTokenIx++;
                }
                // consume until we hit a separator
                while (localTokenIx < len) {
                    var localToken = tokens[localTokenIx];
                    if (localToken.type === TokenTypes.text) {
                        break;
                    }
                    localTokenIx++;
                }
            }
            // a group adds a group for the next collection and checks to see if there's an and
            // or a separator that would indicate multiple groupings
            if (info.group) {
                // we're going to move forward from this token and deselect as we go
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.text) {
                    localTokenIx++;
                }
                // if we've run out of tokens, bail
                if (localTokenIx === len)
                    break;
                // otherwise, the next thing we found is what we're trying to group by
                var localToken = tokens[localTokenIx];
                localToken.grouped = true;
                groups.push(localToken);
                localTokenIx++;
                // now we have to check if we're trying to group by multiple things, e.g.
                // "per department and age" or "per department, team, and age"
                var next = tokens[localTokenIx];
                while (next && next.type === TokenTypes.modifier && (next.info.separator || next.info.and)) {
                    localTokenIx++;
                    next = tokens[localTokenIx];
                    // if we have another modifier directly after (e.g. ", and") loop again
                    // to see if this is valid.
                    if (next && next.type === TokenTypes.modifier) {
                        continue;
                    }
                    next.grouped = true;
                    groups.push(next);
                    localTokenIx++;
                    next = tokens[localTokenIx];
                }
            }
            continue;
        }
        // deal with patterns
        if (type === TokenTypes.pattern) {
            if (info.type === "rewrite") {
                var newText = void 0;
                // if we only have one possible rewrite, we can just take it
                if (info.rewrites.length === 1) {
                    newText = info.rewrites[0].text;
                }
                else {
                    // @TODO: we have to go through every possibility and deal with it
                    newText = info.rewrites[0].text;
                }
                // Tokenize the new string
                var newTokens = getTokens(newText);
                // Splice in the new tokens, adjust the length and make sure we revisit this token.
                len += newTokens.length;
                tokens.splice.apply(tokens, [tokenIx + 1, 0].concat(newTokens));
                // apply any deselects, or's, or and's to this token
                for (var _a = 0; _a < newTokens.length; _a++) {
                    var newToken = newTokens[_a];
                    newToken.deselected = token.deselected;
                    newToken.and = token.and;
                    newToken.or = token.or;
                }
                continue;
            }
            else {
                // otherwise it's an operation of some kind
                operations.push(token);
                // keep track of any other patterns we're trying to fill right now
                if (state.currentPattern) {
                    state.patternStack.push(state.currentPattern);
                }
                state.currentPattern = token;
                state.currentPattern.args = [];
            }
            if (info.infix) {
                state.currentPattern.args.push(indirectObject);
            }
            continue;
        }
        // deal with values
        if (type === TokenTypes.value) {
            // if we still have a currentPattern to fill
            if (state.currentPattern && state.currentPattern.args.length < state.currentPattern.info.args.length) {
                state.currentPattern.args.push(token);
            }
            continue;
        }
        //We don't do anything with text nodes at this point
        if (type === TokenTypes.text)
            continue;
        // once modifiers and patterns have been applied, we don't need to worry
        // about the directObject as it's already been asigned to the first root.
        if (directObject === token) {
            indirectObject = directObject;
            continue;
        }
        if (directObject === indirectObject) {
            directObject.children.push(token);
            token.relationship = determineRelationship(directObject, token);
            token.parent = directObject;
            indirectObject = token;
        }
        else {
            var potentialParent = indirectObject;
            // if our indirect object is an attribute and we encounter another one, we want to check
            // the parent of this node for a match
            if (indirectObject.type === TokenTypes.attribute && token.type === TokenTypes.attribute) {
                potentialParent = indirectObject.parent;
            }
            // if the indirect object is an attribute, anything other than another attribute will create
            // a new root
            if (indirectObject.type === TokenTypes.attribute && token.type !== TokenTypes.attribute) {
                var rootRel = determineRelationship(directObject, token);
                if (!rootRel || (rootRel.distance === 0 && token.type === TokenTypes.entity)) {
                    indirectObject = token;
                    roots.push(indirectObject);
                }
                else {
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
            }
            else if (potentialParent.type === TokenTypes.entity && token.type !== TokenTypes.attribute) {
                directObject.children.push(token);
                token.relationship = determineRelationship(directObject, token);
                token.parent = directObject;
                indirectObject = token;
            }
            else {
                var cursorRel = determineRelationship(potentialParent, token);
                var rootRel = determineRelationship(directObject, token);
                // if this token is an entity and either the directObject or indirectObject has a direct relationship
                // we don't really want to use that as it's most likely meant to filter a set down
                // instead of reduce the set to exactly one member.
                if (token.type === TokenTypes.entity) {
                    if (cursorRel && cursorRel.distance === 0)
                        cursorRel = null;
                    if (rootRel && rootRel.distance === 0)
                        rootRel = null;
                }
                if (!cursorRel) {
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
                else if (!rootRel) {
                    potentialParent.children.push(token);
                    token.relationship = cursorRel;
                    token.parent = potentialParent;
                }
                else if (cursorRel.distance <= rootRel.distance) {
                    potentialParent.children.push(token);
                    token.relationship = cursorRel;
                    token.parent = potentialParent;
                }
                else {
                    // @TODO: maybe if there's a cursorRel we should just always ignore the rootRel even if it
                    // is a "better" relationship. Sentence structure-wise it seems pretty likely that attributes
                    // following an entity are related to that entity and not something else.
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
                indirectObject = token;
            }
        }
        // if we are still looking to fill in a pattern
        if (state.currentPattern) {
            var args = state.currentPattern.args;
            var infoArgs = state.currentPattern.info.args;
            var latestArg = args[args.length - 1];
            var latestArgComplete = !latestArg || latestArg.type === TokenTypes.attribute || latestArg.type === TokenTypes.value;
            var firstArg = args[0];
            if (!latestArgComplete && indirectObject.type === TokenTypes.attribute) {
                args.pop();
                args.push(indirectObject);
            }
            else if (latestArgComplete && args.length < infoArgs.length) {
                args.push(indirectObject);
                latestArg = indirectObject;
            }
        }
    }
    // if we've run out of tokens and are still looking to fill in a pattern,
    // we might need to carry the attribute through.
    if (state.currentPattern && state.currentPattern.args.length) {
        var args = state.currentPattern.args;
        var infoArgs = state.currentPattern.info.args;
        var latestArg = args[args.length - 1];
        var latestArgComplete = latestArg.type === TokenTypes.attribute || latestArg.type === TokenTypes.value;
        var firstArg = args[0];
        // e.g. people older than chris granger => people age > chris granger age
        if (!latestArgComplete && firstArg && firstArg.type === TokenTypes.attribute) {
            var newArg = { type: firstArg.type, found: firstArg.found, orig: firstArg.orig, info: firstArg.info, id: uuid(), children: [] };
            var cursorRel = determineRelationship(latestArg, newArg);
            newArg.relationship = cursorRel;
            newArg.parent = latestArg;
            latestArg.children.push(newArg);
            args.pop();
            args.push(newArg);
        }
    }
    return tree;
}
//---------------------------------------------------------
// Query plans
//---------------------------------------------------------
var StepTypes;
(function (StepTypes) {
    StepTypes[StepTypes["find"] = 0] = "find";
    StepTypes[StepTypes["gather"] = 1] = "gather";
    StepTypes[StepTypes["lookup"] = 2] = "lookup";
    StepTypes[StepTypes["filterByEntity"] = 3] = "filterByEntity";
    StepTypes[StepTypes["intersect"] = 4] = "intersect";
    StepTypes[StepTypes["calculate"] = 5] = "calculate";
    StepTypes[StepTypes["aggregate"] = 6] = "aggregate";
    StepTypes[StepTypes["filter"] = 7] = "filter";
    StepTypes[StepTypes["sort"] = 8] = "sort";
    StepTypes[StepTypes["limit"] = 9] = "limit";
    StepTypes[StepTypes["group"] = 10] = "group";
})(StepTypes || (StepTypes = {}));
function ignoreHiddenCollections(colls) {
    for (var _i = 0; _i < colls.length; _i++) {
        var coll = colls[_i];
        if (coll !== "generic related to") {
            return coll;
        }
    }
}
function nodeToPlanSteps(node, parent, parentPlan) {
    //TODO: figure out what to do with operations
    var id = node.id || uuid();
    var deselected = node.deselected;
    var rel = node.relationship;
    if (parent && rel) {
        switch (rel.type) {
            case RelationshipTypes.collectionToAttribute:
                var plan = [];
                var curParent = parentPlan;
                for (var _i = 0, _a = rel.nodes; _i < _a.length; _i++) {
                    var node_1 = _a[_i];
                    var coll = ignoreHiddenCollections(node_1);
                    var item = { type: StepTypes.gather, relatedTo: curParent, subject: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: StepTypes.lookup, relatedTo: curParent, subject: node.found, id: id, deselected: deselected });
                return plan;
                break;
            case RelationshipTypes.collectionToEntity:
                var plan = [];
                var curParent = parentPlan;
                for (var _b = 0, _c = rel.nodes; _b < _c.length; _b++) {
                    var node_2 = _c[_b];
                    var coll = ignoreHiddenCollections(node_2);
                    var item = { type: StepTypes.gather, relatedTo: curParent, subject: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: StepTypes.filterByEntity, relatedTo: curParent, subject: node.found, id: id, deselected: deselected });
                return plan;
                break;
            case RelationshipTypes.collectionToCollection:
                return [{ type: StepTypes.gather, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                break;
            case RelationshipTypes.collectionIntersection:
                return [{ type: StepTypes.intersect, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                break;
            case RelationshipTypes.entityToAttribute:
                if (rel.distance === 0) {
                    return [{ type: StepTypes.lookup, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                }
                else {
                    var plan_1 = [];
                    var curParent_1 = parentPlan;
                    for (var _d = 0, _e = rel.nodes; _d < _e.length; _d++) {
                        var node_3 = _e[_d];
                        var coll = ignoreHiddenCollections(node_3);
                        var item = { type: StepTypes.gather, relatedTo: curParent_1, subject: coll, id: uuid() };
                        plan_1.push(item);
                        curParent_1 = item;
                    }
                    plan_1.push({ type: StepTypes.lookup, relatedTo: curParent_1, subject: node.found, id: id, deselected: deselected });
                    return plan_1;
                }
                break;
        }
    }
    else {
        if (node.type === TokenTypes.collection) {
            return [{ type: StepTypes.gather, subject: node.found, id: id, deselected: deselected }];
        }
        else if (node.type === TokenTypes.entity) {
            return [{ type: StepTypes.find, subject: node.found, id: id, deselected: deselected }];
        }
        else if (node.type === TokenTypes.attribute) {
            return [{ type: StepTypes.lookup, subject: node.found, id: id, deselected: deselected }];
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
function opToPlan(op) {
    var info = op.info;
    var args = {};
    if (info.args) {
        var ix = 0;
        for (var _i = 0, _a = info.args; _i < _a.length; _i++) {
            var arg = _a[_i];
            var argValue = op.args[ix];
            if (argValue === undefined)
                continue;
            if (argValue.type === TokenTypes.value) {
                args[arg] = JSON.parse(argValue.orig);
            }
            else if (argValue.type === TokenTypes.attribute) {
                args[arg] = [argValue.id, "value"];
            }
            else {
                console.error("Invalid operation argument: " + argValue.orig + " for " + op.found);
            }
            ix++;
        }
    }
    if (info.type === "aggregate") {
        return [{ type: StepTypes.aggregate, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
    else if (info.type === "sort and limit") {
        return [];
    }
    else if (info.type === "filter") {
        return [{ type: StepTypes.filter, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
    else {
        return [{ type: StepTypes.calculate, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
}
// Since intermediate plan steps can end up duplicated, we need to walk the plan to find
// nodes that are exactly the same and only do them once. E.g. salaries per department and age
// will bring in two employee gathers.
function dedupePlan(plan) {
    var dupes = {};
    // for every node in the plan backwards
    for (var planIx = plan.length - 1; planIx > -1; planIx--) {
        var step = plan[planIx];
        // check all preceding nodes for a node that is equivalent
        for (var dupeIx = planIx - 1; dupeIx > -1; dupeIx--) {
            var dupe = plan[dupeIx];
            // equivalency requires the same type, subject, deselect, and parent
            if (step.type === dupe.type && step.subject === dupe.subject && step.deselected === dupe.deselected && step.relatedTo === dupe.relatedTo) {
                // store the dupe and what node will replace it
                dupes[step.id] = dupe.id;
            }
        }
    }
    return plan.filter(function (step) {
        // remove anything we found to be a dupe
        if (dupes[step.id])
            return false;
        // if this step references a dupe, relate it to the new node
        if (dupes[step.relatedTo]) {
            step.relatedTo = dupes[step.relatedTo];
        }
        return true;
    });
}
function treeToPlan(tree) {
    var plan = [];
    for (var _i = 0, _a = tree.roots; _i < _a.length; _i++) {
        var root_1 = _a[_i];
        plan = plan.concat(nodeToPlan(root_1));
    }
    plan = dedupePlan(plan);
    for (var _b = 0, _c = tree.groups; _b < _c.length; _b++) {
        var group = _c[_b];
        plan.push({ type: StepTypes.group, subject: group.found, subjectNode: group });
    }
    for (var _d = 0, _e = tree.operations; _d < _e.length; _d++) {
        var op = _e[_d];
        plan = plan.concat(opToPlan(op));
    }
    return plan;
}
//---------------------------------------------------------
// Test queries
//---------------------------------------------------------
function validateStep(step, expected) {
    if (!step || step.type !== expected.type || step.subject !== expected.subject || step.deselected !== expected.deselected) {
        return false;
    }
    if (expected.args) {
        var ix = 0;
        for (var _i = 0, _a = expected.args; _i < _a.length; _i++) {
            var exArg = _a[_i];
            var arg = step.argArray[ix];
            if (arg.found !== exArg.subject) {
                return false;
            }
            if (exArg.parent && (!arg.parent || arg.parent.found !== exArg.parent)) {
                return false;
            }
            ix++;
        }
    }
    return true;
}
function validatePlan(plan, expected) {
    var ix = 0;
    for (var _i = 0; _i < expected.length; _i++) {
        var exStep = expected[_i];
        var step = plan[ix];
        if (!validateStep(step, exStep))
            return false;
        ix++;
    }
    return true;
}
var tests = {
    "chris granger's age": {
        expected: [{ type: StepTypes.find, subject: "chris granger" }, { type: StepTypes.lookup, subject: "age" }]
    },
    "robert attorri's age": {
        expected: [{ type: StepTypes.find, subject: "robert attorri" }, { type: StepTypes.lookup, subject: "age" }]
    },
    "people older than chris granger": {
        expected: [
            { type: StepTypes.gather, subject: "person" },
            { type: StepTypes.lookup, subject: "age" },
            { type: StepTypes.find, subject: "chris granger" },
            { type: StepTypes.lookup, subject: "age" },
            { type: StepTypes.filter, subject: ">", args: [
                    { parent: "person", subject: "age" },
                    { parent: "chris granger", subject: "age" }
                ] }
        ]
    },
    "people whose age < 30": {
        expected: [
            { type: StepTypes.gather, subject: "person" },
            { type: StepTypes.lookup, subject: "age" },
            { type: StepTypes.filter, subject: "<", args: [
                    { parent: "person", subject: "age" },
                    { subject: "30" }
                ] }
        ]
    },
    "people whose age < chris granger's age": {
        expected: [
            { type: StepTypes.gather, subject: "person" },
            { type: StepTypes.lookup, subject: "age" },
            { type: StepTypes.find, subject: "chris granger" },
            { type: StepTypes.lookup, subject: "age" },
            { type: StepTypes.filter, subject: "<", args: [
                    { parent: "person", subject: "age" },
                    { parent: "chris granger", subject: "age" }
                ] }
        ]
    },
    "people whose age < chris granger's": {
        expected: [
            { type: StepTypes.gather, subject: "person" },
            { type: StepTypes.lookup, subject: "age" },
            { type: StepTypes.find, subject: "chris granger" },
            { type: StepTypes.lookup, subject: "age" },
            { type: StepTypes.filter, subject: "<", args: [
                    { parent: "person", subject: "age" },
                    { parent: "chris granger", subject: "age" }
                ] }
        ]
    },
    "people older than chris granger and younger than edward norton": {},
    "people between 50 and 65 years old": {},
    "people whose age is between 50 and 65": {},
    "people who are 50-65 years old": {},
    "people older than chris granger's spouse": {},
    "people older than their spouse": {},
    "people who are either heads or spouses of heads": {},
    "people who have a hair color of red or black": {},
    "people who have neither attended a meeting nor had a one-on-one": {},
    "salaries per department": {
        expected: [{ type: StepTypes.gather, subject: "department" }, { type: StepTypes.gather, subject: "employee" }, { type: StepTypes.lookup, subject: "salary" }, { type: StepTypes.group, subject: "department" }]
    },
    "salaries per department and age": {
        expected: [{ type: StepTypes.gather, subject: "department" }, { type: StepTypes.gather, subject: "employee" }, { type: StepTypes.lookup, subject: "salary" }, { type: StepTypes.lookup, subject: "age" }, { type: StepTypes.group, subject: "department" }, { type: StepTypes.group, subject: "age" }]
    },
    "salaries per department, employee, and age": {
        expected: [{ type: StepTypes.gather, subject: "department" }, { type: StepTypes.gather, subject: "employee" }, { type: StepTypes.lookup, subject: "salary" }, { type: StepTypes.lookup, subject: "age" }, { type: StepTypes.group, subject: "department" }, { type: StepTypes.group, subject: "employee" }, { type: StepTypes.group, subject: "age" }]
    },
    "sum of the salaries per department": {
        expected: [{ type: StepTypes.gather, subject: "department" }, { type: StepTypes.gather, subject: "employee" }, { type: StepTypes.lookup, subject: "salary" }, { type: StepTypes.group, subject: "department" }, { type: StepTypes.aggregate, subject: "sum", args: [{ parent: "department", subject: "salary" }] }]
    },
    "top 2 salaries per department": {},
    "sum of the top 2 salaries per department": {},
    "departments where all the employees are male": {},
    "departments where all the employees are over-40 males": {},
    "employees whose sales are greater than their salary": {},
    "count employees and their spouses": {},
    "dishes with eggs and chicken": {
        expected: [{ type: StepTypes.gather, subject: "dish" }, { type: StepTypes.filterByEntity, subject: "egg" }, { type: StepTypes.filterByEntity, subject: "chicken" }]
    },
    "dishes with eggs or chicken": {},
    "dishes without eggs and chicken": {},
    "dishes without eggs or chicken": {
        expected: [{ type: StepTypes.gather, subject: "dish" }, { type: StepTypes.filterByEntity, subject: "egg", deselected: true }, { type: StepTypes.filterByEntity, subject: "chicken", deselected: true }]
    },
    "dishes with eggs that aren't desserts": {
        expected: [{ type: StepTypes.gather, subject: "dish" }, { type: StepTypes.filterByEntity, subject: "egg" }, { type: StepTypes.intersect, subject: "dessert", deselected: true }]
    },
    "dishes that don't have eggs or chicken": {
        expected: [{ type: StepTypes.gather, subject: "dish" }, { type: StepTypes.filterByEntity, subject: "egg", deselected: true }, { type: StepTypes.filterByEntity, subject: "chicken", deselected: true }]
    },
    "dishes with a cook time < 30 that have eggs and are sweet": {},
    "dishes that take 30 minutes to an hour": {},
    "dishes that take 30-60 minutes": {},
    "people who live alone": {},
    "everyone in this room speaks at least two languages": {},
    "at least two languages are spoken by everyone in this room": {},
    "friends older than the average age of people with pets": {},
    "meetings john was in in the last 10 days": {},
    "parts that have a color of \"red\", \"green\", \"blue\", or \"yellow\"": {},
    "per book get the average price of books(2) that are cheaper": {},
    "per book get the average price of books(2) that cost less": {},
    "per book get the average price of books(2) where books(2) price < book price": {},
    "head's last name = employee's last name and head != employee and head's department = employee's department": {},
    "person loves person(2) and person(2) loves person(3) and person(3) loves person": {},
    "employee salary / employee's department total cost ": {},
    "Return the average number of publications by Bob in each year": {},
    "Return authors who have more papers than Bob in VLDB after 2000": {},
    "Return the conference in each area whose papers have the most total citations": {},
    "return all conferences in the database area": {},
    "return all the organizations, where the number of papers by the organization is more than the number of authors in IBM": {},
    "return all the authors, where the number of papers by the author in VLDB is more than the number of papers in ICDE": {},
    "Where are the restaurants in San Francisco that serve good French food?": {},
    "What are the population sizes of cities that are located in California?": {},
    "What are the names of rivers in the state that has the largest city in the united states of america?": {},
    "What is the average elevation of the highest points in each state?": {},
    "What jobs as a senior software developer are available in houston but not san antonio?": {}
};
//---------------------------------------------------------
// Debug drawing
//---------------------------------------------------------
function groupTree(root) {
    if (root.type === TokenTypes.text)
        return;
    var kids = root.children.map(groupTree);
    var relationship = "root";
    var unfound = "";
    var distance = "";
    var nodes = "";
    if (root.relationship) {
        relationship = RelationshipTypes[root.relationship.type];
        unfound = root.relationship.unfound ? " (unfound)" : unfound;
        distance = " (" + root.relationship.distance + ")";
        if (root.relationship.nodes && root.relationship.nodes.length) {
            nodes = " (" + root.relationship.nodes.map(function (nodes) { return nodes[0]; }).join(", ") + ")";
        }
    }
    return { c: "", children: [
            { c: "node " + TokenTypes[root.type], text: root.found + " (" + relationship + ")" + unfound + distance + nodes },
            { c: "kids", children: kids },
        ] };
}
function testSearch(search, info) {
    var start = performance.now();
    var tokens = getTokens(search);
    var tree = tokensToTree(tokens);
    var plan = treeToPlan(tree);
    var valid;
    var expectedPlan;
    if (info.expected) {
        var expected = info.expected;
        valid = validatePlan(plan, expected);
        expectedPlan = expected.map(function (step, ix) {
            var actual = plan[ix];
            var validStep = "";
            var deselected = step.deselected ? "!" : "";
            if (!actual) {
                return { state: "missing", message: StepTypes[step.type] + " " + deselected + step.subject };
            }
            if (validateStep(actual, step)) {
                return { state: "valid", message: "valid" };
            }
            else {
                return { state: "invalid", message: StepTypes[step.type] + " " + deselected + step.subject };
            }
        });
    }
    return { tokens: tokens, tree: tree, plan: plan, valid: valid, validated: !!info.expected, expectedPlan: expectedPlan, search: search, time: performance.now() - start };
}
function searchResultUi(result) {
    var tokens = result.tokens, tree = result.tree, plan = result.plan, valid = result.valid, validated = result.validated, expectedPlan = result.expectedPlan, search = result.search;
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
                    { c: "kids", children: tree.operations.map(function (root) {
                            console.log(root);
                            return { c: "tokens", children: [
                                    { c: "node " + TokenTypes[root.type], text: "" + root.found },
                                    { c: "kids", children: root.args.map(function (token) {
                                            var parent = token.parent ? token.parent.found + "." : "";
                                            return { c: "node " + TokenTypes[token.type], text: "" + parent + token.found };
                                        }) }
                                ] };
                        }) },
                    { c: "header2", text: "Groups" },
                    { c: "kids", children: tree.groups.map(function (root) {
                            return { c: "node " + TokenTypes[root.type], text: "" + root.found };
                        }) },
                ] }
        ] };
    //plan
    var planNode;
    var klass = "";
    if (validated) {
        if (!valid)
            klass += "failed";
        else
            klass += "succeeded";
        planNode = { c: "tokens", children: [
                { c: "header", text: "Plan" },
                { c: "kids", children: expectedPlan.map(function (info, ix) {
                        var actual = plan[ix];
                        var message = "";
                        if (info.state !== "valid") {
                            message = " :: expected " + info.message;
                            if (info.state === "missing") {
                                return { c: "step " + info.state, text: "none " + message };
                            }
                        }
                        var args = "";
                        if (actual.argArray) {
                            args = " " + actual.argArray.map(function (arg) { return arg.found; }).join(", ");
                        }
                        return { c: "step " + info.state, text: StepTypes[actual.type] + " " + (actual.deselected ? "!" : "") + actual.subject + args + message };
                    }) }
            ] };
    }
    else {
        planNode = { c: "tokens", children: [
                { c: "header", text: "Plan" },
                { c: "kids", children: plan.map(function (step) {
                        var deselected = step.deselected ? "!" : "";
                        var args = "";
                        if (step.argArray) {
                            args = " " + step.argArray.map(function (arg) { return arg.found; }).join(", ");
                        }
                        return { c: "node", text: StepTypes[step.type] + " " + deselected + step.subject + args };
                    }) }
            ] };
    }
    return { c: "search " + klass, children: [
            { c: "search-header", text: "" + search },
            tokensNode,
            treeNode,
            planNode,
            { c: "tokens", children: [
                    { c: "header", text: "Performance" },
                    { c: "kids", children: [
                            { c: "time", text: "Total: " + result.time.toFixed(2) + "ms" },
                        ] }
                ] }
        ] };
}
function root() {
    var results = [];
    var resultStats = { unvalidated: 0, succeeded: 0, failed: 0 };
    for (var test in tests) {
        var result = testSearch(test, tests[test]);
        results.push(result);
        if (!result.validated) {
            resultStats.unvalidated++;
        }
        else if (result.valid === false) {
            resultStats.failed++;
        }
        else {
            resultStats.succeeded++;
        }
    }
    var resultItems = results.map(searchResultUi);
    return { id: "root", c: "test-root", children: [
            { c: "stats row", children: [
                    { c: "failed", text: resultStats.failed },
                    { c: "succeeded", text: resultStats.succeeded },
                    { c: "unvalidated", text: resultStats.unvalidated },
                ] },
            { children: resultItems }
        ] };
}
exports.root = root;
//---------------------------------------------------------
// Utils
//---------------------------------------------------------
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
var _a, _b, _c;
//# sourceMappingURL=queryParser.js.map