var utils_1 = require("./utils");
var app_1 = require("./app");
var ui_1 = require("./ui");
var masonry_1 = require("./masonry");
//------------------------------------------------------------------------------
// Utilities
//------------------------------------------------------------------------------
function resolveName(maybeId) {
    var display = app_1.eve.findOne("display name", { id: maybeId });
    return display ? display.name : maybeId;
}
exports.resolveName = resolveName;
function resolveId(maybeName) {
    var display = app_1.eve.findOne("display name", { name: maybeName });
    return display ? display.id : maybeName;
}
exports.resolveId = resolveId;
function resolveValue(maybeValue) {
    maybeValue = utils_1.coerceInput(maybeValue);
    if (typeof maybeValue !== "string")
        return maybeValue;
    var val = maybeValue.trim();
    if (val.indexOf("=") === 0) {
        // @TODO: Run through the full NLP.
        var search = val.substring(1).trim();
        return resolveId(search);
    }
    return val;
}
exports.resolveValue = resolveValue;
function isEntity(maybeId) {
    return !!app_1.eve.findOne("entity", { entity: maybeId });
}
exports.isEntity = isEntity;
function getNodeContent(node) {
    if (node.nodeName === "INPUT")
        return node.value;
    else
        return node.textContent;
}
exports.getNodeContent = getNodeContent;
function sortByFieldValue(field, direction) {
    if (direction === void 0) { direction = 1; }
    var fwd = direction;
    var back = -1 * direction;
    return function (rowA, rowB) {
        var a = resolveName(resolveValue(rowA[field])), b = resolveName(resolveValue(rowB[field]));
        return (a === b) ? 0 :
            (a === undefined) ? fwd :
                (b === undefined) ? back :
                    (a > b) ? fwd : back;
    };
}
var wordSplitter = /\s+/gi;
var statWeights = { links: 100, pages: 200, words: 1 };
function classifyEntities(rawEntities) {
    var entities = rawEntities.slice();
    var collections = [];
    var systems = [];
    // Measure relatedness + length of entities
    // @TODO: mtimes of entities
    var relatedCounts = {};
    var wordCounts = {};
    var childCounts = {};
    var scores = {};
    for (var _i = 0; _i < entities.length; _i++) {
        var entity_1 = entities[_i];
        var _a = (app_1.eve.findOne("entity", { entity: entity_1 }) || {}).content, content = _a === void 0 ? "" : _a;
        relatedCounts[entity_1] = app_1.eve.find("directionless links", { entity: entity_1 }).length;
        wordCounts[entity_1] = content.trim().replace(wordSplitter, " ").split(" ").length;
        var _b = (app_1.eve.findOne("collection", { collection: entity_1 }) || {}).count, childCount = _b === void 0 ? 0 : _b;
        childCounts[entity_1] = childCount;
        scores[entity_1] =
            relatedCounts[entity_1] * statWeights.links +
                wordCounts[entity_1] * statWeights.words +
                childCounts[entity_1] * statWeights.pages;
    }
    // Separate system entities
    var ix = 0;
    while (ix < entities.length) {
        if (app_1.eve.findOne("is a attributes", { collection: utils_1.builtinId("system"), entity: entities[ix] })) {
            systems.push(entities.splice(ix, 1)[0]);
        }
        else
            ix++;
    }
    // Separate user collections from other entities
    ix = 0;
    while (ix < entities.length) {
        if (childCounts[entities[ix]]) {
            collections.push(entities.splice(ix, 1)[0]);
        }
        else
            ix++;
    }
    return { systems: systems, collections: collections, entities: entities, scores: scores, relatedCounts: relatedCounts, wordCounts: wordCounts, childCounts: childCounts };
}
function getFields(_a) {
    var example = _a.example, whitelist = _a.whitelist, blacklist = _a.blacklist;
    // Determine display fields based on whitelist, blacklist, and the first row
    var fields;
    if (whitelist) {
        fields = whitelist.slice();
    }
    else {
        fields = Object.keys(example);
        if (blacklist) {
            for (var _i = 0; _i < blacklist.length; _i++) {
                var field = blacklist[_i];
                var fieldIx = fields.indexOf(field);
                if (fieldIx !== -1) {
                    fields.splice(fieldIx, 1);
                }
            }
        }
    }
    return fields;
}
exports.getFields = getFields;
//------------------------------------------------------------------------------
// Handlers
//------------------------------------------------------------------------------
function preventDefault(event) {
    event.preventDefault();
}
exports.preventDefault = preventDefault;
function preventDefaultUnlessFocused(event) {
    if (event.target !== document.activeElement)
        event.preventDefault();
}
function closePopup() {
    var popout = app_1.eve.findOne("ui pane", { kind: ui_1.PANE.POPOUT });
    if (popout)
        app_1.dispatch("remove popup", { paneId: popout.pane }).commit();
}
function navigate(event, elem) {
    var paneId = elem.data.paneId;
    if (elem.peek)
        app_1.dispatch("set popout", { parentId: paneId, contains: elem.link, x: event.clientX, y: event.clientY }).commit();
    else
        app_1.dispatch("set pane", { paneId: paneId, contains: elem.link }).commit();
    event.preventDefault();
}
exports.navigate = navigate;
function navigateOrEdit(event, elem) {
    var popout = app_1.eve.findOne("ui pane", { kind: ui_1.PANE.POPOUT });
    var peeking = popout && popout.contains === elem.link;
    if (event.target === document.activeElement) { }
    else if (!peeking)
        navigate(event, elem);
    else {
        closePopup();
        event.target.focus();
    }
}
function blurOnEnter(event, elem) {
    if (event.keyCode === utils_1.KEYS.ENTER) {
        event.target.blur();
        event.preventDefault();
    }
}
//interface TableCellElem extends Element { row: TableRowElem, field: string, rows?: any[]}
//interface TableFieldElem extends Element { table: string, field: string, direction?: number }
function updateEntityValue(event, elem) {
    var value = utils_1.coerceInput(event.detail);
    var tableElem = elem.table, row = elem.row, field = elem.field;
    var entity = tableElem["entity"];
    throw new Error("@TODO: FIXME");
    // let rows = elem.rows || [row];
    // let chain = dispatch();
    // for(let row of rows) {
    //   if(field === "value" && row.value !== value && row.attribute !== undefined) {
    //     chain.dispatch("update entity attribute", {entity, attribute: row.attribute, prev: row.value, value});
    //   } else if(field === "attribute" && row.attribute !== value && row.value !== undefined) {
    //     chain.dispatch("rename entity attribute", {entity, prev: row.attribute, attribute: value, value: row.value});
    //   }
    // }
    // chain.commit();
}
function updateEntityAttributes(event, elem) {
    var _a = elem.row, tableElem = _a.table, row = _a.row;
    var entity = tableElem["entity"];
    if (event.detail === "add") {
        var state = elem["state"]["adder"];
        var valid = elem["fields"].every(function (field) {
            return state[field] !== undefined;
        });
        if (valid) {
            app_1.dispatch("add sourced eav", { entity: entity, attribute: state.attribute, value: resolveValue(state.value) }).commit();
            elem["state"]["adder"] = {};
        }
    }
    else {
        app_1.dispatch("remove entity attribute", { entity: entity, attribute: row.attribute, value: row.value }).commit();
    }
}
function sortTable(event, elem) {
    var table = elem.table, _a = elem.field, field = _a === void 0 ? undefined : _a, _b = elem.direction, direction = _b === void 0 ? undefined : _b;
    if (field === undefined && direction === undefined) {
        field = event.target.value;
        direction = -1;
    }
    app_1.dispatch("sort table", { state: table.state, field: field, direction: direction }).commit();
}
//------------------------------------------------------------------------------
// Embedded cell representation wrapper
//------------------------------------------------------------------------------
var uitk = this;
function embeddedCell(elem) {
    var children = [];
    var childInfo = elem.childInfo, rep = elem.rep;
    if (childInfo.constructor === Array) {
        for (var _i = 0; _i < childInfo.length; _i++) {
            var child = childInfo[_i];
            child["data"] = child["data"] || childInfo.params;
            children.push(uitk[rep](child));
        }
    }
    else {
        children.push(uitk[rep](childInfo));
    }
    children.push({ c: "edit-button-container", children: [
            { c: "edit-button ion-edit", click: elem.click, cell: elem.cell }
        ] });
    return { c: "non-editing-embedded-cell", children: children, cell: elem.cell };
}
exports.embeddedCell = embeddedCell;
//------------------------------------------------------------------------------
// Representations for cards
//------------------------------------------------------------------------------
// @FIXME: if there isn't an ID here, microReact does the wrong thing, investigate
// after the release
function card(elem) {
    elem.c = "card " + (elem.c || "");
    return elem;
}
exports.card = card;
function toggleAddTile(event, elem) {
    app_1.dispatch("toggle add tile", { key: elem.key, entityId: elem.entityId }).commit();
}
function setTileAdder(event, elem) {
    app_1.dispatch("set tile adder", { key: elem.key, adder: elem.adder }).commit();
}
function closeCard(event, elem) {
    app_1.dispatch("close card", { paneId: elem.paneId }).commit();
}
function navigateRoot(event, elem) {
    var root = app_1.eve.findOne("ui pane", { kind: ui_1.PANE.FULL })["pane"];
    app_1.dispatch("set pane", { paneId: root, contains: elem.entityId }).commit();
}
function entity(elem) {
    var entityId = elem.entity;
    var paneId = elem.data.paneId;
    var key = elem.key || entityId + "|" + paneId;
    var state = ui_1.uiState.widget.card[key] || {};
    var name = app_1.eve.findOne("display name", { id: ui_1.asEntity(entityId) }).name;
    var attrs = ui_1.entityTilesUI(entityId, paneId, key);
    attrs.c += " page-attributes";
    // let editor = pageEditor(entityId, paneId, elem.editor);
    var adder = tileAdder({ entityId: entityId, key: key });
    return { c: "entity " + (state.showAdd ? "adding" : ""), children: [
            { c: "header", children: [
                    { text: name },
                    { c: "flex-grow spacer" },
                    { c: "control ion-ios-upload-outline", click: navigateRoot, entityId: entityId },
                    { c: "control " + (state.showAdd ? "ion-android-remove" : "ion-android-add") + " add-tile", click: toggleAddTile, key: key, entityId: entityId },
                    { c: "control ion-android-close", click: closeCard, paneId: paneId },
                ] },
            adder,
            attrs,
        ] };
}
exports.entity = entity;
var measureSpan = document.createElement("span");
measureSpan.className = "measure-span";
document.body.appendChild(measureSpan);
function autosizeInput(node, elem) {
    var minWidth = 50;
    measureSpan.style.fontSize = window.getComputedStyle(node, null)["font-size"];
    measureSpan.textContent = node.value;
    var measuredWidth = measureSpan.getBoundingClientRect().width;
    node.style.width = Math.ceil(Math.max(minWidth, measuredWidth)) + 5 + "px";
}
exports.autosizeInput = autosizeInput;
function autosizeAndFocus(node, elem) {
    autosizeInput(node, elem);
    utils_1.autoFocus(node, elem);
}
exports.autosizeAndFocus = autosizeAndFocus;
function trackPropertyAdderInput(event, elem) {
    var value = event.currentTarget.value;
    app_1.dispatch("set tile adder attribute", { key: elem.key, attribute: elem.attribute, value: value }).commit();
    if (event.currentTarget.nodeName === "INPUT") {
        autosizeInput(event.currentTarget, elem);
    }
}
function adderKeys(event, elem) {
    if (event.keyCode === utils_1.KEYS.ENTER) {
        app_1.dispatch("submit tile adder", { key: elem.key, node: event.currentTarget }).commit();
    }
    else if (event.keyCode === utils_1.KEYS.ESC) {
        app_1.dispatch("toggle add tile", { key: elem.key }).commit();
    }
}
function submitAdder(event, elem) {
    // @HACK: yeah...
    app_1.dispatch("submit tile adder", { key: elem.key, node: event.currentTarget.parentNode.parentNode.firstChild.firstChild }).commit();
}
function submitProperty(adder, state, node) {
    if (state.propertyProperty === undefined || state.propertyValue === undefined)
        return;
    app_1.dispatch("add sourced eav", { entity: state.entityId, attribute: state.propertyProperty, value: state.propertyValue, forceEntity: true }).commit();
    state.propertyValue = undefined;
    state.propertyProperty = undefined;
    //make sure the focus is in the value
    node.parentNode.firstChild.focus();
}
function propertyAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder", children: [
            { children: [
                    { c: "tile small", children: [
                            { c: "tile-content-wrapper", children: [
                                    { t: "input", c: "property", placeholder: "property", value: state.propertyProperty || "", attribute: "propertyProperty", input: trackPropertyAdderInput, postRender: autosizeAndFocus, keydown: adderKeys, entityId: entityId, key: key },
                                    { t: "input", c: "value", placeholder: "value", value: state.propertyValue || "", attribute: "propertyValue", input: trackPropertyAdderInput, postRender: autosizeInput, keydown: adderKeys, entityId: entityId, key: key },
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: key },
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] }
                ] }
        ] };
}
function descriptionAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder description-adder", children: [
            { children: [
                    { c: "tile full", children: [
                            { c: "tile-content-wrapper", children: [
                                    { t: "textarea", c: "value", placeholder: "description", value: state.descriptionValue, attribute: "descriptionValue", input: trackPropertyAdderInput, postRender: utils_1.autoFocus, keydown: adderKeys, entityId: entityId, key: key },
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: key },
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] },
                ] }
        ] };
}
function submitDescription(adder, state, node) {
    var chain = app_1.dispatch("add sourced eav", { entity: state.entityId, attribute: "description", value: state.descriptionValue });
    state.descriptionValue = "";
    chain.dispatch("toggle add tile", { key: state.key }).commit();
}
function autosizeAndStoreListTileItem(event, elem) {
    var node = event.currentTarget;
    app_1.dispatch("add active tile item", { cardId: elem.cardId, attribute: elem.storeAttribute, tileId: elem.tileId, id: elem.storeId, value: node.value }).commit();
    autosizeInput(node, elem);
}
function collectionTileAdder(elem) {
    var values = elem.values, data = elem.data, tileId = elem.tileId, attribute = elem.attribute, cardId = elem.cardId, entityId = elem.entityId, forceActive = elem.forceActive, reverseEntityAndValue = elem.reverseEntityAndValue, noProperty = elem.noProperty, _a = elem.rep, rep = _a === void 0 ? "value" : _a, _b = elem.c, klass = _b === void 0 ? "" : _b;
    tileId = tileId || attribute;
    var state = ui_1.uiState.widget.card[cardId] || {};
    var listChildren = [];
    var added = (state.activeTile ? state.activeTile.itemsToAdd : false) || [];
    var ix = 0;
    for (var _i = 0; _i < added.length; _i++) {
        var add = added[_i];
        listChildren.push({ c: "value", children: [
                { t: "input", placeholder: "add", value: add, attribute: attribute, entityId: entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId: cardId, input: autosizeAndStoreListTileItem, postRender: autosizeAndFocus, keydown: adderKeys, key: cardId }
            ] });
        ix++;
    }
    listChildren.push({ c: "value", children: [
            { t: "input", placeholder: "add item", value: "", attribute: attribute, entityId: entityId, storeAttribute: "itemsToAdd", storeId: ix, cardId: cardId, input: autosizeAndStoreListTileItem, postRender: ix === 0 ? autosizeAndFocus : autosizeInput, keydown: adderKeys, key: cardId }
        ] });
    var size = "full";
    var tileChildren = [];
    tileChildren.push({ t: "input", c: "property", placeholder: "collection name", attribute: "collectionProperty", value: state.collectionProperty, input: trackPropertyAdderInput, key: cardId });
    tileChildren.push({ c: "list", children: listChildren });
    return { c: "property-adder collection-adder", children: [
            { children: [
                    { c: "tile full", children: [
                            { c: "tile-content-wrapper", children: tileChildren },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: cardId },
                                    { c: "ion-close cancel", click: setTileAdder, key: cardId },
                                ] }
                        ] },
                ] }
        ] };
}
function collectionAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    var tile = collectionTileAdder({ values: [], cardId: key, entityId: entityId, forceActive: true, tileId: "collectionAdder", data: {}, noProperty: true, });
    return tile;
}
function submitCollection(adder, state, node) {
    var chain;
    console.log("SUBMIT COLL", state.key);
    // determine whether this is making the current entity a collection, or if this is just a normal collection.
    if (!state.collectionProperty || pluralize(state.collectionProperty.trim(), 1).toLowerCase() === resolveName(state.entityId).toLowerCase()) {
        // this is turning the current entity into a collection
        chain = app_1.dispatch("submit list tile", { cardId: state.key, attribute: "is a", entityId: state.entityId, reverseEntityAndValue: true });
    }
    else {
        chain = app_1.dispatch("submit list tile", { cardId: state.key, attribute: state.collectionProperty, entityId: state.entityId, reverseEntityAndValue: false });
    }
    state.collectionProperty = undefined;
    chain.dispatch("toggle add tile", { key: state.key }).commit();
    console.log(JSON.stringify(state));
}
function imageAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder image-adder", children: [
            { children: [
                    { c: "tile small", children: [
                            { c: "tile-content-wrapper", children: [
                                    { t: "input", c: "value", placeholder: "image url", value: state.imageValue, attribute: "imageValue", input: trackPropertyAdderInput, postRender: autosizeAndFocus, keydown: adderKeys, entityId: entityId, key: key },
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-checkmark submit", click: submitAdder, key: key },
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] }
                ] }
        ] };
}
function submitImage(adder, state, node) {
    var chain = app_1.dispatch("add sourced eav", { entity: state.entityId, attribute: "image", value: "\"" + state.imageValue + "\"" });
    state.imageValue = undefined;
    chain.dispatch("toggle add tile", { key: state.key }).commit();
}
function comingSoonAdderUI(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    return { c: "property-adder", children: [
            { children: [
                    { c: "tile small", children: [
                            { c: "tile-content-wrapper", children: [
                                    { text: "This tile type is coming soon." }
                                ] },
                            { c: "controls flex-row", children: [
                                    { c: "ion-close cancel", click: setTileAdder, key: key },
                                ] }
                        ] }
                ] }
        ] };
}
function tileAdder(elem) {
    var entityId = elem.entityId, key = elem.key;
    var state = ui_1.uiState.widget.card[key] || {};
    var rows = [];
    var klass = "";
    if (!state.adder) {
        var adders = [
            { name: "Property", icon: "ion-compose", ui: propertyAdderUI, submit: submitProperty },
            { name: "Description", icon: "ion-drag", ui: descriptionAdderUI, submit: submitDescription },
            { name: "Collection", klass: "collection", icon: "ion-ios-list-outline", ui: collectionAdderUI, submit: submitCollection },
            { name: "Image", icon: "ion-image", ui: imageAdderUI, submit: submitImage },
            { name: "Document", icon: "ion-document", ui: comingSoonAdderUI },
            { name: "Computed", icon: "ion-calculator", ui: comingSoonAdderUI },
        ];
        var count = 0;
        var curRow = { c: "row flex-row", children: [] };
        for (var _i = 0; _i < adders.length; _i++) {
            var adder = adders[_i];
            curRow.children.push({ c: "tile small", adder: adder, key: key, click: setTileAdder, children: [
                    { c: "tile-content-wrapper", children: [
                            { c: "property", text: adder.name },
                            { c: "value " + adder.icon },
                        ] }
                ] });
            count++;
            if (curRow.children.length === 3 || count === adders.length) {
                rows.push(curRow);
                curRow = { c: "row flex-row", children: [] };
            }
        }
    }
    else {
        var adderElem = { entityId: entityId, key: key };
        if (state.adder.ui) {
            rows.push(state.adder.ui(adderElem));
        }
        klass = state.adder.klass || "";
    }
    return { c: "tile-adder " + klass, children: rows };
}
exports.tileAdder = tileAdder;
function pageEditor(entityId, paneId, elem) {
    var _a = (app_1.eve.findOne("entity", { entity: entityId }) || {}).content, content = _a === void 0 ? undefined : _a;
    var page = app_1.eve.findOne("entity page", { entity: entityId })["page"];
    var name = resolveName(entityId);
    elem.c = "wiki-editor " + (elem.c || "");
    elem.meta = { entityId: entityId, page: page, paneId: paneId };
    elem.options.noFocus = true;
    elem.value = content;
    elem.children = elem.cellItems;
    return elem;
}
exports.pageEditor = pageEditor;
//------------------------------------------------------------------------------
// Representations for Errors
//------------------------------------------------------------------------------
function error(elem) {
    elem.c = "error-rep " + (elem.c || "");
    return elem;
}
exports.error = error;
function name(elem) {
    var entity = elem.entity;
    var _a = (app_1.eve.findOne("display name", { id: entity }) || {}).name, name = _a === void 0 ? entity : _a;
    elem.text = name;
    elem.c = "entity " + (elem.c || "");
    return elem;
}
exports.name = name;
function link(elem) {
    var entity = elem.entity;
    var name = resolveName(entity);
    elem.c = (elem.c || "") + " entity link inline";
    if (!elem["nameAsChild"]) {
        elem.text = elem.text || name;
    }
    else {
        elem.children = [{ text: elem.text || name }];
    }
    elem["link"] = elem["link"] || entity;
    elem.click = elem.click || navigate;
    elem["peek"] = elem["peek"] !== undefined ? elem["peek"] : true;
    return elem;
}
exports.link = link;
function attributes(elem) {
    var entity = elem.entity;
    var attributes = [];
    for (var _i = 0, _a = app_1.eve.find("entity eavs", { entity: entity }); _i < _a.length; _i++) {
        var eav = _a[_i];
        attributes.push({ attribute: eav.attribute, value: eav.value });
    }
    attributes.sort(function (a, b) {
        if (a.attribute === b.attribute)
            return 0;
        else if (a.attribute < b.attribute)
            return -1;
        return 1;
    });
    elem["groups"] = ["attribute"];
    elem["rows"] = attributes;
    elem["editCell"] = updateEntityValue;
    elem["editRow"] = updateEntityAttributes;
    elem["noHeader"] = true;
    return table(elem);
}
exports.attributes = attributes;
function related(elem) {
    var entity = elem.entity, _a = elem.data, data = _a === void 0 ? undefined : _a;
    var name = resolveName(entity);
    var relations = [];
    for (var _i = 0, _b = app_1.eve.find("directionless links", { entity: entity }); _i < _b.length; _i++) {
        var link_1 = _b[_i];
        relations.push(link_1.link);
    }
    elem.c = elem.c !== undefined ? elem.c : "flex-row flex-wrap csv";
    if (relations.length) {
        elem.children = [{ t: "h2", text: name + " is related to " + relations.length + " " + pluralize("entities", relations.length) + ":" }];
        for (var _c = 0; _c < relations.length; _c++) {
            var rel = relations[_c];
            elem.children.push(link({ entity: rel, data: data }));
        }
    }
    else
        elem.text = name + " is not related to any other entities.";
    return elem;
}
exports.related = related;
function index(elem) {
    var entity = elem.entity;
    var name = resolveName(entity);
    var facts = app_1.eve.find("is a attributes", { collection: entity });
    var list = { t: "ul", children: [] };
    for (var _i = 0; _i < facts.length; _i++) {
        var fact = facts[_i];
        list.children.push(link({ t: "li", entity: fact.entity, data: elem.data }));
    }
    elem.children = [
        { t: "h2", text: "There " + pluralize("are", facts.length) + " " + facts.length + " " + pluralize(name, facts.length) + ":" },
        list
    ];
    return elem;
}
exports.index = index;
function view(elem) {
    var entity = elem.entity;
    var name = resolveName(entity);
    // @TODO: Check if given entity is a view, or render an error
    var rows = app_1.eve.find(entity);
    elem["rows"] = rows;
    return table(elem);
}
exports.view = view;
function results(elem) {
    var entity = elem.entity, _a = elem.data, data = _a === void 0 ? undefined : _a;
    elem.children = [name({ entity: entity, data: data })];
    for (var _i = 0, _b = app_1.eve.find("entity eavs", { entity: entity, attribute: "artifact" }); _i < _b.length; _i++) {
        var eav = _b[_i];
        elem.children.push(name({ t: "h3", entity: eav.value, data: data }), view({ entity: eav.value, data: data }));
    }
    return elem;
}
exports.results = results;
function value(elem) {
    var _a = elem.text, val = _a === void 0 ? "" : _a, value = elem.value, _b = elem.autolink, autolink = _b === void 0 ? true : _b, _c = elem.editable, editable = _c === void 0 ? false : _c;
    var field = "text";
    if (editable && value) {
        field = "value";
        val = value;
    }
    elem["original"] = val;
    var cleanup;
    if (isEntity(val)) {
        elem["entity"] = ui_1.asEntity(val);
        elem[field] = resolveName(val);
        if (autolink)
            elem = link(elem);
        if (editable && autolink) {
            elem.mousedown = preventDefaultUnlessFocused;
            elem.click = navigateOrEdit;
            cleanup = closePopup;
        }
    }
    if (editable) {
        if (elem.t !== "input") {
            elem.contentEditable = true;
        }
        elem.placeholder = "<empty>";
        var _blur = elem.blur;
        elem.blur = function (event, elem) {
            var node = event.target;
            if (_blur)
                _blur(event, elem);
            if (node.value === "= " + elem.value)
                node.value = elem.value;
            if (isEntity(elem.value))
                node.classList.add("link");
            if (cleanup)
                cleanup(event, elem);
        };
        var _focus = elem.focus;
        elem.focus = function (event, elem) {
            var node = event.target;
            if (elem.value !== val) {
                node.value = "= " + elem.value;
                node.classList.remove("link");
            }
            if (_focus)
                _focus(event, elem);
        };
    }
    return elem;
}
exports.value = value;
function CSV(elem) {
    var values = elem.values, _a = elem.autolink, autolink = _a === void 0 ? undefined : _a, data = elem.data;
    return { c: "flex-row csv", children: values.map(function (val) { return value({ t: "span", autolink: autolink, text: val, data: data }); }) };
}
exports.CSV = CSV;
function tableBody(elem) {
    var state = elem.state, rows = elem.rows, fields = elem.fields, data = elem.data, _a = elem.groups, groups = _a === void 0 ? [] : _a;
    fields = fields.slice();
    if (!rows.length) {
        elem.text = "<Empty Table>";
        return elem;
    }
    var disabled = {};
    for (var _i = 0, _b = elem.disabled || []; _i < _b.length; _i++) {
        var field_1 = _b[_i];
        disabled[field_1] = true;
    }
    // Strip grouped fields out of display fields -- the former implies the latter and must be handled first
    for (var _c = 0; _c < groups.length; _c++) {
        var field_2 = groups[_c];
        var fieldIx = fields.indexOf(field_2);
        if (fieldIx !== -1) {
            fields.splice(fieldIx, 1);
        }
    }
    // Manage interactivity
    var _d = elem.sortable, sortable = _d === void 0 ? false : _d, editCell = elem.editCell, editGroup = elem.editGroup, removeRow = elem.removeRow;
    if (editCell) {
        var _editCell = editCell;
        editCell = function (event, elem) {
            var val = resolveValue(getNodeContent(event.target));
            if (val === elem["original"])
                return;
            _editCell(new CustomEvent("editcell", { detail: val }), elem);
        };
        var _editGroup = editGroup;
        editGroup = function (event, elem) {
            var val = resolveValue(getNodeContent(event.target));
            if (val === elem["original"])
                return;
            if (_editGroup)
                _editGroup(new CustomEvent("editgroup", { detail: val }), elem);
            else {
                for (var _i = 0, _a = elem.rows; _i < _a.length; _i++) {
                    var row = _a[_i];
                    _editCell(new CustomEvent("editcell", { detail: val }), elem);
                }
            }
        };
    }
    // Sort rows
    if (state.sortField && state.sortDirection) {
        rows.sort(sortByFieldValue(state.sortField, state.sortDirection));
    }
    for (var _e = 0; _e < groups.length; _e++) {
        var field = groups[_e];
        rows.sort(sortByFieldValue(field, field === state.sortField ? state.sortDirection : 1));
    }
    elem.children = [];
    var body = elem;
    var openRows = {};
    var openVals = {};
    for (var _f = 0; _f < rows.length; _f++) {
        var row = rows[_f];
        var group = void 0;
        for (var _g = 0; _g < groups.length; _g++) {
            var field_3 = groups[_g];
            if (openVals[field_3] === row[field_3]) {
                group = openRows[field_3];
                group.children[0].rows.push(row);
            }
            else {
                openVals[field_3] = row[field_3];
                var cur = openRows[field_3] = {
                    c: "table-row grouped",
                    children: [
                        value({
                            c: "column cell",
                            table: elem,
                            field: field_3,
                            rows: [row],
                            text: row[field_3] || "",
                            data: data,
                            editable: !!editGroup && !disabled[field_3],
                            keydown: blurOnEnter,
                            blur: editGroup
                        }),
                        { c: "flex-column flex-grow group", children: [] }
                    ]
                };
                if (group) {
                    group.children[1].children.push(cur);
                }
                else {
                    body.children.push(cur);
                }
                group = cur;
            }
        }
        var rowItem = { c: "table-row", children: [] };
        for (var _h = 0; _h < fields.length; _h++) {
            var field_4 = fields[_h];
            rowItem.children.push(value({
                c: "column cell",
                table: elem,
                field: field_4,
                row: row,
                text: row[field_4] || "",
                data: data,
                editable: !!editCell && !disabled[field_4],
                keydown: blurOnEnter,
                blur: editCell
            }));
        }
        rowItem.children.push({ c: "controls", children: [
                removeRow ? { c: "ion-icon-android-close", row: rowItem, click: removeRow } : undefined
            ] });
        if (group) {
            group.children[1].children.push(rowItem);
        }
        else {
            body.children.push(rowItem);
        }
    }
    elem.c = "table-body " + (elem.c || "");
    return elem;
}
exports.tableBody = tableBody;
function tableHeader(elem) {
    var state = elem.state, fields = elem.fields, _a = elem.groups, groups = _a === void 0 ? [] : _a, _b = elem.sortable, sortable = _b === void 0 ? false : _b, data = elem.data;
    fields = fields.slice();
    // Strip grouped fields out of display fields -- the former implies the latter and must be handled first
    for (var _i = 0; _i < groups.length; _i++) {
        var field = groups[_i];
        var fieldIx = fields.indexOf(field);
        if (fieldIx !== -1) {
            fields.splice(fieldIx, 1);
        }
    }
    var addField = elem.addField, removeField = elem.removeField;
    // Build header
    elem.t = "header";
    elem.c = "table-header " + (elem.c || "");
    elem.children = [];
    for (var _c = 0, _d = groups.concat(fields); _c < _d.length; _c++) {
        var field = _d[_c];
        var isActive = field === state.sortField;
        var direction = isActive ? state.sortDirection : 0;
        var klass = "sort-toggle " + (isActive && direction < 0 ? "ion-arrow-up-b" : "ion-arrow-down-b") + " " + (isActive ? "active" : "");
        elem.children.push({ c: "column field", children: [
                value({ c: "text", text: field, data: data, autolink: false }),
                { c: "flex-grow" },
                { c: "controls", children: [
                        sortable ? { c: klass, table: elem, field: field, direction: -direction || 1, click: sortTable } : undefined,
                        removeField ? { c: "ion-close-round", table: elem, field: field, click: removeField } : undefined
                    ] }
            ] });
    }
    ;
    elem.children.push({ c: "controls", children: [
            addField ? { c: "ion-plus-round add-field-btn", table: elem, click: addField } : undefined
        ] });
    return elem;
}
function tableAdderRow(elem) {
    var row = elem.row, fields = elem.fields, _a = elem.confirm, confirm = _a === void 0 ? true : _a, change = elem.change, submit = elem.submit, data = elem.data;
    elem.c = "table-row table-adder " + (elem.c || "");
    elem.children = [];
    var disabled = {};
    for (var _i = 0, _b = elem.disabled || []; _i < _b.length; _i++) {
        var field = _b[_i];
        disabled[field] = true;
    }
    // By default, accept all changes
    if (!change) {
        change = function (event, cellElem) {
            row[cellElem.field] = resolveValue(getNodeContent(event.target));
        };
    }
    // Wrap submission to point at the adder element instead of the add button
    if (submit) {
        var _submit = submit;
        submit = function (event, _) { return _submit(event, elem); };
    }
    // If we should add without confirmation, submit whenever the row is completely filled in
    if (!confirm && submit) {
        var _change = change;
        change = function (event, cellElem) {
            var valid = !_change(event, cellElem);
            for (var _i = 0; _i < fields.length; _i++) {
                var field = fields[_i];
                if (row[field] === undefined)
                    valid = false;
            }
            if (valid)
                submit(event, elem);
        };
    }
    for (var _c = 0; _c < fields.length; _c++) {
        var field = fields[_c];
        elem.children.push(value({
            c: "column cell " + (disabled[field] ? "disabled" : ""),
            table: elem,
            field: field,
            row: row,
            editable: !disabled[field],
            text: row[field] || "",
            data: data,
            keydown: blurOnEnter,
            blur: change
        }));
    }
    if (confirm) {
        elem.children.push({ c: "controls", children: [{ c: "confirm-row ion-checkmark-round", table: elem, row: row, click: submit }] });
    }
    return elem;
}
exports.tableAdderRow = tableAdderRow;
function createFact(chain, row, _a) {
    var subject = _a.subject, entity = _a.entity, fieldMap = _a.fieldMap, collections = _a.collections;
    var name = row[subject];
    if (!entity) {
        entity = ui_1.asEntity(name);
    }
    if (!entity) {
        entity = utils_1.uuid();
        var pageId = utils_1.uuid();
        console.log(" - creating entity", entity);
        chain.dispatch("create page", { page: pageId, content: "" })
            .dispatch("create entity", { entity: entity, name: name, page: pageId });
    }
    for (var field in fieldMap) {
        console.log(" - adding attr", fieldMap[field], "=", uitk.resolveValue(row[field]), "for", entity);
        chain.dispatch("add sourced eav", { entity: entity, attribute: fieldMap[field], value: uitk.resolveValue(row[field]) });
    }
    if (collections) {
        for (var _i = 0; _i < collections.length; _i++) {
            var coll = collections[_i];
            console.log(" - adding coll", "is a", "=", coll, "for", entity);
            chain.dispatch("add sourced eav", { entity: entity, attribute: "is a", value: coll });
        }
    }
}
function tableStateValid(tableElem) {
    var state = tableElem.state, fields = tableElem.fields, _a = tableElem.groups, groups = _a === void 0 ? [] : _a;
    // A new adder is added every time the previous adder was changes, so the last one is empty.
    var adders = state.adders.slice(0, -1);
    // Ensure all batched changes are valid before committing any of them.
    for (var _i = 0; _i < adders.length; _i++) {
        var adder = adders[_i];
        for (var _b = 0, _c = fields.concat(groups); _b < _c.length; _b++) {
            var field = _c[_b];
            if (adder[field] === undefined || adder[field] === "")
                return false;
        }
    }
    for (var _d = 0, _e = state.changes; _d < _e.length; _d++) {
        var change = _e[_d];
        console.log(change, change.value);
        if (change.value === undefined || change.value === "")
            return false;
    }
    return true;
}
function manageAdders(state, row, field) {
    if (row[field] !== undefined && row[field] !== "") {
        if (row === state.adders[state.adders.length - 1]) {
            // We added a value to the blank adder and need to push a new adder
            state.adders.push({});
        }
    }
    else {
        var ix = 0;
        while (ix < state.adders.length - 1) {
            var adder = state.adders[ix];
            var gc = true;
            for (var field_5 in adder) {
                if (adder[field_5] !== undefined && adder[field_5] !== "") {
                    gc = false;
                    break;
                }
            }
            if (gc) {
                state.adders.splice(ix, 1);
            }
            else {
                ix++;
            }
        }
    }
}
function changeAttributeAdder(event, elem) {
    var tableElem = elem.table, row = elem.row, field = elem.field;
    var state = tableElem.state;
    row[field] = resolveValue(getNodeContent(event.target));
    manageAdders(state, row, field);
    app_1.dispatch("rerender").commit();
}
function changeEntityAdder(event, elem) {
    var tableElem = elem.table, row = elem.row, field = elem.field;
    var state = tableElem.state, subject = tableElem.subject, fieldMap = tableElem.fieldMap;
    row[field] = resolveValue(getNodeContent(event.target));
    if (field === subject) {
        // @NOTE: Should this really be done by inserting "= " when the input is focused?
        var entityId = ui_1.asEntity(resolveValue(row[subject]));
        if (entityId) {
            for (var field_6 in fieldMap) {
                var _a = (app_1.eve.findOne("entity eavs", { entity: entityId, attribute: fieldMap[field_6] }) || {}).value, value_1 = _a === void 0 ? undefined : _a;
                if (!row[field_6] && value_1 !== undefined) {
                    row[field_6] = value_1;
                }
            }
        }
    }
    manageAdders(state, row, field);
    app_1.dispatch("rerender").commit();
}
function updateRowAttribute(event, elem) {
    var field = elem.field, row = elem.row, tableElem = elem.table;
    var state = tableElem.state, subject = tableElem.subject, fieldMap = tableElem.fieldMap;
    var value = resolveValue(event.detail);
    var change;
    for (var _i = 0, _a = state.changes; _i < _a.length; _i++) {
        var cur = _a[_i];
        if (cur.field === field && cur.prev === row[field] && cur.row === row) {
            change = cur;
            break;
        }
    }
    if (!change) {
        change = { field: field, prev: row[field], row: row, value: value };
        state.changes.push(change);
    }
    else {
        change.value = value;
    }
    console.log(state);
    app_1.dispatch("rerender").commit();
}
function commitChanges(event, elem) {
    // @TODO: Batch changes to existing rows in editCell into state.changes[]
    // @TODO: Submit all batched cell changes
    // @TODO: Update resolveValue to use new string semantics
    var tableElem = elem.table;
    var subject = tableElem.subject, fieldMap = tableElem.fieldMap, state = tableElem.state;
    var chain = app_1.dispatch("rerender");
    // A new adder is added every time the previous adder was changes, so the last one is empty.
    var adders = state.adders.slice(0, -1);
    if (tableStateValid(tableElem)) {
        for (var _i = 0; _i < adders.length; _i++) {
            var adder = adders[_i];
            createFact(chain, adder, tableElem);
        }
        for (var _a = 0, _b = state.changes; _a < _b.length; _a++) {
            var _c = _b[_a], field = _c.field, prev = _c.prev, row = _c.row, value_2 = _c.value;
            var entity_2 = row[subject];
            app_1.dispatch("update entity attribute", { entity: entity_2, attribute: fieldMap[field], prev: prev, value: value_2 }).commit();
        }
        state.adders = [{}];
        state.changes = [];
        chain.commit();
    }
    else {
        console.warn("One or more changes is invalid, so all changes have not been committed");
    }
}
function table(elem) {
    var state = elem.state, rows = elem.rows, fields = elem.fields, groups = elem.groups, disabled = elem.disabled, sortable = elem.sortable, editCell = elem.editCell, data = elem.data;
    elem.c = "table-wrapper table " + (elem.c || "");
    elem.children = [
        tableHeader({ state: state, fields: fields, groups: groups, sortable: sortable, data: data }),
        tableBody({ rows: rows, state: state, fields: fields, groups: groups, disabled: disabled, sortable: sortable, editCell: editCell, data: data })
    ];
    return elem;
}
exports.table = table;
function mappedTable(elem) {
    var state = elem.state, entity = elem.entity, subject = elem.subject, fieldMap = elem.fieldMap, collections = elem.collections, data = elem.data;
    // If we're mapped to an entity search we can only add new attributes to that entity
    for (var _i = 0, _a = state.adders; _i < _a.length; _i++) {
        var adder = _a[_i];
        if (entity && adder[subject] !== entity) {
            adder[subject] = entity;
        }
    }
    var rows = elem.rows, fields = elem.fields, groups = elem.groups, _b = elem.disabled, disabled = _b === void 0 ? [subject] : _b, _c = elem.sortable, sortable = _c === void 0 ? true : _c;
    var adderChanged = entity ? changeAttributeAdder : changeEntityAdder;
    var adderDisabled = entity ? [subject] : undefined;
    var stateValid = tableStateValid(elem);
    elem.c = "table-wrapper mapped-table " + (elem.c || "");
    elem.children = [
        tableHeader({ state: state, fields: fields, groups: groups, sortable: sortable, data: data }),
        tableBody({ rows: rows, state: state, fields: fields, groups: groups, disabled: disabled, sortable: sortable, subject: subject, fieldMap: fieldMap, editCell: updateRowAttribute, data: data }),
        { c: "table-adders", children: state.adders.map(function (row) { return tableAdderRow({
                row: row,
                state: state,
                fields: fields,
                disabled: adderDisabled,
                confirm: false,
                subject: subject,
                fieldMap: fieldMap,
                collections: collections,
                change: adderChanged
            }); }) },
        { c: "ion-checkmark-round commit-btn " + (stateValid ? "valid" : "invalid"), table: elem, click: stateValid && commitChanges }
    ];
    return elem;
}
exports.mappedTable = mappedTable;
function tableFilter(elem) {
    var key = elem.key, _a = elem.search, search = _a === void 0 ? undefined : _a, _b = elem.sortFields, sortFields = _b === void 0 ? undefined : _b;
    elem.children = [];
    if (sortFields) {
        var state = ui_1.uiState.widget.table[key] || { sortField: undefined, sortDirection: undefined };
        var sortOpts = [];
        for (var _i = 0; _i < sortFields.length; _i++) {
            var field = sortFields[_i];
            sortOpts.push({ t: "option", text: resolveName(field), value: field, selected: field === state.sortField });
        }
        elem.children.push({ c: "flex-grow" });
        elem.children.push({ c: "sort", children: [
                { text: "Sort by" },
                { t: "select", c: "select-sort-field select", value: state.sortField, children: sortOpts, key: key, change: sortTable },
                { c: "toggle-sort-dir " + (state.sortDirection === -1 ? "ion-arrow-up-b" : "ion-arrow-down-b"), key: key, direction: -state.sortDirection || 1, click: sortTable },
            ] });
    }
    elem.c = "table-filter " + (elem.c || "");
    return elem;
}
exports.tableFilter = tableFilter;
function externalLink(elem) {
    elem.t = "a";
    elem.c = "link " + (elem.c || "");
    elem.href = elem.url;
    elem.text = elem.text || elem.url;
    return elem;
}
exports.externalLink = externalLink;
function externalImage(elem) {
    elem.t = "img";
    elem.c = "img " + (elem.c || "");
    elem.src = elem.url;
    return elem;
}
exports.externalImage = externalImage;
function externalVideo(elem) {
    var ext = elem.url.slice(elem.url.lastIndexOf(".")).trim().toLowerCase();
    var domain = elem.url.slice(elem.url.indexOf("//") + 2).split("/")[0];
    var isFile = ["mp4", "ogv", "webm", "mov", "avi", "flv"].indexOf(ext) !== -1;
    if (isFile) {
        elem.t = "video";
    }
    else {
        elem.t = "iframe";
    }
    elem.c = "video " + (elem.c || "");
    elem.src = elem.url;
    elem.allowfullscreen = true;
    return elem;
}
exports.externalVideo = externalVideo;
function collapsible(elem) {
    if (elem.key === undefined)
        throw new Error("Must specify a key to maintain collapsible state");
    var state = ui_1.uiState.widget.collapsible[elem.key] || { open: elem.open !== undefined ? elem.open : true };
    var content = { children: elem.children };
    var header = { t: "header", children: [{ c: "collapse-toggle " + (state.open ? "ion-chevron-up" : "ion-chevron-down"), collapsible: elem.key, open: state.open, click: toggleCollapse }, elem.header] };
    elem.c = "collapsible " + (elem.c || "");
    elem.children = [header, state.open ? content : undefined];
    return elem;
}
exports.collapsible = collapsible;
function toggleCollapse(evt, elem) {
    app_1.dispatch("toggle collapse", { collapsible: elem.collapsible, open: !elem.open });
}
var directoryTileLayouts = [
    { size: 4, c: "big", format: function (elem) {
            // elem.children.unshift
            elem.children.push();
            return elem;
        } },
    { size: 2, c: "detailed", format: function (elem) {
            elem.children.push();
            return elem;
        } },
    { size: 1, c: "normal", grouped: 2 }
];
var directoryTileStyles = ["tile-style-1", "tile-style-2", "tile-style-3", "tile-style-4", "tile-style-5", "tile-style-6", "tile-style-7"];
function directory(elem) {
    var key = "directory|home"; // @TODO: FIXME
    var MAX_ENTITIES_BEFORE_OVERFLOW = 14;
    var rawEntities = elem.entities, _a = elem.data, data = _a === void 0 ? undefined : _a;
    var _b = classifyEntities(rawEntities), systems = _b.systems, collections = _b.collections, entities = _b.entities, scores = _b.scores, relatedCounts = _b.relatedCounts, wordCounts = _b.wordCounts, childCounts = _b.childCounts;
    var sortByScores = utils_1.sortByLookup(scores);
    entities.sort(sortByScores);
    collections.sort(sortByScores);
    systems.sort(sortByScores);
    var collectionTableState = ui_1.uiState.widget.table[(key + "|collections table")] || { sortField: "score", sortDirection: -1, adders: [] };
    ui_1.uiState.widget.table[(key + "|collections table")] = collectionTableState;
    var entityTableState = ui_1.uiState.widget.table[(key + "|entities table")] || { sortField: "score", sortDirection: -1, adders: [] };
    ui_1.uiState.widget.table[(key + "|entities table")] = entityTableState;
    // Link to entity
    // Peek with most significant statistic (e.g. 13 related; or 14 childrenpages; or 5000 words)
    // Slider pane will all statistics
    // Click opens popup preview
    function getStats(entity) {
        var stats = { name: entity, best: "", links: relatedCounts[entity], pages: childCounts[entity], words: wordCounts[entity] };
        var maxContribution = 0;
        for (var stat in stats) {
            if (!statWeights[stat])
                continue;
            var contribution = stats[stat] * statWeights[stat];
            if (contribution > maxContribution) {
                maxContribution = contribution;
                stats.best = stat;
            }
        }
        return stats;
    }
    function formatTile(entity) {
        var stats = getStats(entity);
        return { size: scores[entity], stats: stats, children: [
                link({ entity: entity, data: data, nameAsChild: true })
            ] };
    }
    function formatList(name, entities, state) {
        var sortOpts = [];
        for (var _i = 0, _a = ["score", "links", "words"]; _i < _a.length; _i++) {
            var field = _a[_i];
            sortOpts.push({ t: "option", text: resolveName(field), value: field, selected: field === state.sortField });
        }
        return { c: "directory-list flex-grow flex-row", children: [
                collapsible({ c: "flex-grow", key: key + "|" + name + " collapsible", header: { text: "Show all " + name }, open: false, children: [
                        { c: "flex-row", children: [
                                { c: "table-wrapper", children: [
                                        tableBody({ rows: entities.map(getStats), fields: ["name"].concat([state.sortField] || []), sortable: false, state: state, data: data }),
                                    ] },
                                { t: "select", c: "select-sort-field select", value: state.sortField, table: { state: state }, children: sortOpts, change: sortTable },
                            ] }
                    ] })
            ] };
    }
    collections = collections.filter(function (coll) { return ui_1.asEntity("test data") !== coll; });
    var highlights = collections.slice(0, 4).concat(entities.slice(0, 4));
    return { c: "directory flex-column", children: [
            { c: "header", children: [
                    { text: "Home" },
                ] },
            { c: "tile-scroll", children: [
                    { c: "tiles", children: [
                            { c: "row flex-row", children: [
                                    { c: "tile full", children: [
                                            { c: "tile-content-wrapper", children: [
                                                    { c: "value text", children: [
                                                            { text: "Welcome to Eve! Here are some of the cards currently in the system:" }
                                                        ] }
                                                ] }
                                        ] },
                                ] },
                            { c: "row flex-row", children: [
                                    exports.masonry({ c: "directory-highlights", rowSize: 6, layouts: directoryTileLayouts, styles: directoryTileStyles, children: highlights.map(formatTile) }),
                                ] }
                        ] }
                ] }
        ] };
}
exports.directory = directory;
exports.masonry = masonry_1.masonry;
//# sourceMappingURL=uitk.js.map