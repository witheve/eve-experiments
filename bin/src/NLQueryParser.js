var app_1 = require("./app");
(function (NodeTypes) {
    NodeTypes[NodeTypes["ENTITY"] = 0] = "ENTITY";
    NodeTypes[NodeTypes["COLLECTION"] = 1] = "COLLECTION";
    NodeTypes[NodeTypes["ATTRIBUTE"] = 2] = "ATTRIBUTE";
    NodeTypes[NodeTypes["NUMBER"] = 3] = "NUMBER";
    NodeTypes[NodeTypes["STRING"] = 4] = "STRING";
    NodeTypes[NodeTypes["FUNCTION"] = 5] = "FUNCTION";
})(exports.NodeTypes || (exports.NodeTypes = {}));
var NodeTypes = exports.NodeTypes;
(function (Intents) {
    Intents[Intents["QUERY"] = 0] = "QUERY";
    Intents[Intents["INSERT"] = 1] = "INSERT";
    Intents[Intents["MOREINFO"] = 2] = "MOREINFO";
    Intents[Intents["NORESULT"] = 3] = "NORESULT";
})(exports.Intents || (exports.Intents = {}));
var Intents = exports.Intents;
// Entry point for NLQP
function parse(queryString, lastParse) {
    var tree;
    var context;
    var tokens;
    // If this is the first run, then create a root node.
    if (lastParse === undefined) {
        var rootToken = newToken("root");
        rootToken.properties.push(Properties.ROOT);
        tree = newNode(rootToken);
        tree.found = true;
        context = newContext();
        tokens = [rootToken];
    }
    else {
        tree = lastParse.tree;
        context = lastParse.context;
        tokens = lastParse.tokens;
    }
    // Now do something with the query string
    var words = normalizeQueryString(queryString);
    for (var _i = 0; _i < words.length; _i++) {
        var word = words[_i];
        // From a token
        var token = formToken(word);
        // Link new token with the rest
        var lastToken = tokens[tokens.length - 1];
        lastToken.next = token;
        token.prev = lastToken;
        tokens.push(token);
        // Add the token to the tree
        var node = newNode(token);
        var treeResult = formTree(node, tree, context);
        tree = treeResult.tree;
        context = treeResult.context;
    }
    // Manage context
    context.entities = context.found.filter(function (n) { return n.hasProperty(Properties.ENTITY) && !n.hasProperty(Properties.SUBSUMED) && !n.hasProperty(Properties.IMPLICIT); });
    context.collections = context.found.filter(function (n) { return n.hasProperty(Properties.COLLECTION) && !n.hasProperty(Properties.SUBSUMED) && !n.hasProperty(Properties.IMPLICIT); });
    context.attributes = context.found.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE) && !n.hasProperty(Properties.SUBSUMED) && !n.hasProperty(Properties.IMPLICIT); });
    context.maybeAttributes = context.maybeAttributes.filter(function (n) { return !n.hasProperty(Properties.SUBSUMED); });
    context.maybeCollections = context.maybeCollections.filter(function (n) { return !n.hasProperty(Properties.SUBSUMED); });
    context.maybeEntities = context.maybeEntities.filter(function (n) { return !n.hasProperty(Properties.SUBSUMED); });
    // Manage results
    var intent = Intents.NORESULT;
    var query = newQuery();
    var insertResults = [];
    if (allFound(tree)) {
        var inserts = context.internalFxns.filter(function (f) { return f.fxn.type === FunctionTypes.INSERT; });
        if (inserts.length > 0) {
            intent = Intents.INSERT;
            // Format each insert
            for (var _a = 0; _a < inserts.length; _a++) {
                var insert = inserts[_a];
                if (insert.children.every(function (c) { return c.found; })) {
                    // Collapse the result root if every node doesn't have a child
                    if (insert.children[2].children.length > 1 && insert.children[2].children.every(function (c) { return c.children.length === 0; })) {
                        var nName = insert.children[2].children.map(function (c) { return c.name; }).join(" ");
                        var nToken = newToken(nName);
                        var nNode = newNode(nToken);
                        nNode.found = true;
                        nNode.type = NodeTypes.STRING;
                        insert.children[2].children.map(removeNode);
                        insert.children[2].addChild(nNode);
                    }
                    var insertResult = {
                        entity: insert.children[0].children[0],
                        attribute: insert.children[1].children[0],
                        value: insert.children[2].children[0],
                    };
                    insertResults.push(insertResult);
                }
            }
        }
        else if (context.maybeAttributes.length > 0) {
            intent = Intents.MOREINFO;
        }
        else if (context.found.length > 1 &&
            ((context.attributes.filter(function (a) { return a.attribute.refs === undefined && !a.parent.hasProperty(Properties.ARGUMENT); }).length > 0) ||
                (context.collections.filter(function (c) { return c.relationships.length === 0; }).length > 0))) {
            intent = Intents.NORESULT;
        }
        else {
            intent = Intents.QUERY;
        }
    }
    if (intent === Intents.QUERY) {
        // Create the query from the new tree
        intent = Intents.QUERY;
        log("Building query...");
        query = formQuery(tree);
        if (query.projects.length === 0) {
            intent = Intents.NORESULT;
            query = newQuery();
        }
    }
    return [{ intent: intent, context: context, tokens: tokens, tree: tree, query: query, inserts: insertResults }];
}
exports.parse = parse;
// Returns false if any nodes are not marked found
// Returns true if all nodes are marked found
function treeComplete(node) {
    if (node.found === false) {
        return false;
    }
    else {
        var childrenStatus = node.children.map(treeComplete);
        return childrenStatus.every(function (child) { return child === true; });
    }
}
// Performs some transformations to the query string before tokenizing
function normalizeQueryString(queryString) {
    // Add whitespace before and after separator and operators
    var normalizedQueryString = queryString.replace(/,/g, ' , ');
    normalizedQueryString = normalizedQueryString.replace(/;/g, ' ; ');
    normalizedQueryString = normalizedQueryString.replace(/\+/g, ' + ');
    normalizedQueryString = normalizedQueryString.replace(/\^/g, ' ^ ');
    normalizedQueryString = normalizedQueryString.replace(/-/g, ' - ');
    normalizedQueryString = normalizedQueryString.replace(/\*/g, ' * ');
    normalizedQueryString = normalizedQueryString.replace(/\//g, ' / ');
    normalizedQueryString = normalizedQueryString.replace(/"/g, ' " ');
    // Split possessive endings
    normalizedQueryString = normalizedQueryString.replace(/\'s/g, ' \'s ');
    normalizedQueryString = normalizedQueryString.replace(/s'/g, 's \' ');
    // Clean various symbols we don't want to deal with
    normalizedQueryString = normalizedQueryString.replace(/`|\?|\:|\[|\]|\{|\}|\(|\)|\~|\`|~|@|#|\$|%|&|_|\|/g, ' ');
    // Collapse whitespace   
    normalizedQueryString = normalizedQueryString.replace(/\s+/g, ' ');
    // Split words at whitespace
    var splitStrings = normalizedQueryString.split(" ");
    var words = splitStrings.map(function (text, i) { return { ix: i + 1, text: text }; });
    words = words.filter(function (word) { return word.text !== ""; });
    return words;
}
exports.normalizeQueryString = normalizeQueryString;
function normalizeString(queryString) {
    // Add whitespace before and after separator and operators
    var normalized = queryString.replace(/,/g, ' , ');
    normalized = normalized.replace(/;/g, ' ; ');
    normalized = normalized.replace(/\+/g, ' + ');
    normalized = normalized.replace(/\^/g, ' ^ ');
    normalized = normalized.replace(/-/g, ' - ');
    normalized = normalized.replace(/\*/g, ' * ');
    normalized = normalized.replace(/\//g, ' / ');
    normalized = normalized.replace(/"/g, ' " ');
    // Split possessive endings
    normalized = normalized.replace(/\'s/g, ' \'s ');
    normalized = normalized.replace(/s'/g, 's \' ');
    // Clean various symbols we don't want to deal with
    normalized = normalized.replace(/`|\?|\:|\[|\]|\{|\}|\(|\)|\~|\`|~|@|#|\$|%|&|_|\|/g, ' ');
    // Collapse whitespace   
    normalized = normalized.replace(/\s+/g, ' ');
    normalized = normalized.toLowerCase();
    normalized = singularize(normalized);
    return normalized;
}
exports.normalizeString = normalizeString;
// ----------------------------------------------------------------------------
// Token functions
// ----------------------------------------------------------------------------
var MajorPartsOfSpeech;
(function (MajorPartsOfSpeech) {
    MajorPartsOfSpeech[MajorPartsOfSpeech["ROOT"] = 0] = "ROOT";
    MajorPartsOfSpeech[MajorPartsOfSpeech["VERB"] = 1] = "VERB";
    MajorPartsOfSpeech[MajorPartsOfSpeech["ADJECTIVE"] = 2] = "ADJECTIVE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["ADVERB"] = 3] = "ADVERB";
    MajorPartsOfSpeech[MajorPartsOfSpeech["NOUN"] = 4] = "NOUN";
    MajorPartsOfSpeech[MajorPartsOfSpeech["VALUE"] = 5] = "VALUE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["GLUE"] = 6] = "GLUE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["WHWORD"] = 7] = "WHWORD";
    MajorPartsOfSpeech[MajorPartsOfSpeech["SYMBOL"] = 8] = "SYMBOL";
})(MajorPartsOfSpeech || (MajorPartsOfSpeech = {}));
var MinorPartsOfSpeech;
(function (MinorPartsOfSpeech) {
    MinorPartsOfSpeech[MinorPartsOfSpeech["ROOT"] = 0] = "ROOT";
    // Verb
    MinorPartsOfSpeech[MinorPartsOfSpeech["VB"] = 1] = "VB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBD"] = 2] = "VBD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBN"] = 3] = "VBN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBP"] = 4] = "VBP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBZ"] = 5] = "VBZ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBF"] = 6] = "VBF";
    MinorPartsOfSpeech[MinorPartsOfSpeech["CP"] = 7] = "CP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBG"] = 8] = "VBG";
    // Adjective
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJ"] = 9] = "JJ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJR"] = 10] = "JJR";
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJS"] = 11] = "JJS";
    // Adverb
    MinorPartsOfSpeech[MinorPartsOfSpeech["RB"] = 12] = "RB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["RBR"] = 13] = "RBR";
    MinorPartsOfSpeech[MinorPartsOfSpeech["RBS"] = 14] = "RBS";
    // Noun
    MinorPartsOfSpeech[MinorPartsOfSpeech["NN"] = 15] = "NN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNPA"] = 16] = "NNPA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNAB"] = 17] = "NNAB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NG"] = 18] = "NG";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PRP"] = 19] = "PRP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PP"] = 20] = "PP";
    // Legacy Noun
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNP"] = 21] = "NNP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNPS"] = 22] = "NNPS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNO"] = 23] = "NNO";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNS"] = 24] = "NNS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNA"] = 25] = "NNA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNQ"] = 26] = "NNQ";
    // Glue
    MinorPartsOfSpeech[MinorPartsOfSpeech["FW"] = 27] = "FW";
    MinorPartsOfSpeech[MinorPartsOfSpeech["IN"] = 28] = "IN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MD"] = 29] = "MD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["CC"] = 30] = "CC";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PDT"] = 31] = "PDT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DT"] = 32] = "DT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["UH"] = 33] = "UH";
    MinorPartsOfSpeech[MinorPartsOfSpeech["EX"] = 34] = "EX";
    // Value
    MinorPartsOfSpeech[MinorPartsOfSpeech["CD"] = 35] = "CD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DA"] = 36] = "DA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NU"] = 37] = "NU";
    // Symbol
    MinorPartsOfSpeech[MinorPartsOfSpeech["LT"] = 38] = "LT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["GT"] = 39] = "GT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["GTE"] = 40] = "GTE";
    MinorPartsOfSpeech[MinorPartsOfSpeech["LTE"] = 41] = "LTE";
    MinorPartsOfSpeech[MinorPartsOfSpeech["EQ"] = 42] = "EQ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NEQ"] = 43] = "NEQ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PLUS"] = 44] = "PLUS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MINUS"] = 45] = "MINUS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DIV"] = 46] = "DIV";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MUL"] = 47] = "MUL";
    MinorPartsOfSpeech[MinorPartsOfSpeech["POW"] = 48] = "POW";
    MinorPartsOfSpeech[MinorPartsOfSpeech["SEP"] = 49] = "SEP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["POS"] = 50] = "POS";
    // Wh- word
    MinorPartsOfSpeech[MinorPartsOfSpeech["WDT"] = 51] = "WDT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WP"] = 52] = "WP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WPO"] = 53] = "WPO";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WRB"] = 54] = "WRB"; // Wh-adverb (however whenever where why)
})(MinorPartsOfSpeech || (MinorPartsOfSpeech = {}));
function newToken(text) {
    var token = formToken({ ix: 0, text: text });
    token.properties.push(Properties.IMPLICIT);
    return token;
}
function cloneToken(token) {
    var clone = {
        ix: token.ix,
        originalWord: token.originalWord,
        normalizedWord: token.normalizedWord,
        POS: token.POS,
        properties: [],
    };
    token.properties.map(function (property) { return clone.properties.push(property); });
    return clone;
}
var Properties;
(function (Properties) {
    // Node properties
    Properties[Properties["ROOT"] = 0] = "ROOT";
    // EVE types
    Properties[Properties["COLLECTION"] = 1] = "COLLECTION";
    Properties[Properties["ENTITY"] = 2] = "ENTITY";
    Properties[Properties["ATTRIBUTE"] = 3] = "ATTRIBUTE";
    Properties[Properties["FUNCTION"] = 4] = "FUNCTION";
    Properties[Properties["QUANTITY"] = 5] = "QUANTITY";
    Properties[Properties["STRING"] = 6] = "STRING";
    // Function properties  
    Properties[Properties["OUTPUT"] = 7] = "OUTPUT";
    Properties[Properties["INPUT"] = 8] = "INPUT";
    Properties[Properties["ARGUMENT"] = 9] = "ARGUMENT";
    Properties[Properties["AGGREGATE"] = 10] = "AGGREGATE";
    Properties[Properties["CALCULATE"] = 11] = "CALCULATE";
    Properties[Properties["OPERATOR"] = 12] = "OPERATOR";
    // Token properties
    Properties[Properties["PROPER"] = 13] = "PROPER";
    Properties[Properties["PLURAL"] = 14] = "PLURAL";
    Properties[Properties["POSSESSIVE"] = 15] = "POSSESSIVE";
    Properties[Properties["BACKRELATIONSHIP"] = 16] = "BACKRELATIONSHIP";
    Properties[Properties["COMPARATIVE"] = 17] = "COMPARATIVE";
    Properties[Properties["SUPERLATIVE"] = 18] = "SUPERLATIVE";
    Properties[Properties["PRONOUN"] = 19] = "PRONOUN";
    Properties[Properties["SEPARATOR"] = 20] = "SEPARATOR";
    Properties[Properties["CONJUNCTION"] = 21] = "CONJUNCTION";
    Properties[Properties["QUOTED"] = 22] = "QUOTED";
    Properties[Properties["SETTER"] = 23] = "SETTER";
    Properties[Properties["SUBSUMED"] = 24] = "SUBSUMED";
    Properties[Properties["COMPOUND"] = 25] = "COMPOUND";
    // Modifiers
    Properties[Properties["NEGATES"] = 26] = "NEGATES";
    Properties[Properties["GROUPING"] = 27] = "GROUPING";
    Properties[Properties["IMPLICIT"] = 28] = "IMPLICIT";
    Properties[Properties["STOPPARSE"] = 29] = "STOPPARSE";
})(Properties || (Properties = {}));
// take an input string, extract tokens
function formToken(word) {
    // Every word is tagged a noun unless some rule says otherwise
    var POS = MinorPartsOfSpeech.NN;
    var properties = [];
    var originalWord = word.text;
    var normalizedWord = originalWord;
    var found = false;
    var upperCaseLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    var lowerCaseLetters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
    var digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    var separators = [',', ':', ';', '"'];
    var operators = ['+', '-', '*', '/', '^'];
    var comparators = ['>', '>=', '<', '<=', '=', '!='];
    // Most of the following vectors were taken from NLP Compromise
    // https://github.com/nlp-compromise/nlp_compromise
    // Copyright (c) 2016 Spencer Kelly: 
    // Licensed under the MIT License: https://github.com/nlp-compromise/nlp_compromise/blob/master/LICENSE.txt
    var preDeterminers = ['all'];
    var determiners = ['this', 'any', 'enough', 'each', 'every', 'these', 'another', 'plenty', 'whichever', 'neither', 'an', 'a', 'least', 'own', 'few', 'both', 'those', 'the', 'that', 'various', 'what', 'either', 'much', 'some', 'else', 'no'];
    var copulae = ['am', 'is', 'are', 'was', 'were', 'as', 'am', 'be', 'has', 'become', 'became', 'seemed', 'seems', 'seeming'];
    var conjunctions = ['yet', 'therefore', 'or', 'while', 'nor', 'whether', 'though', 'because', 'but', 'for', 'and', 'if', 'before', 'although', 'plus', 'versus', 'not'];
    var prepositions = ['with', 'until', 'onto', 'of', 'into', 'out', 'except', 'across', 'by', 'between', 'at', 'down', 'as', 'from', 'around', 'among', 'upon', 'amid', 'to', 'along', 'since', 'about', 'off', 'on', 'within', 'in', 'during', 'per', 'without', 'throughout', 'through', 'than', 'via', 'up', 'unlike', 'despite', 'below', 'unless', 'towards', 'besides', 'after', 'whereas', 'amongst', 'atop', 'barring', 'circa', 'mid', 'midst', 'notwithstanding', 'sans', 'thru', 'till', 'versus'];
    var possessivePronouns = ['mine', 'something', 'none', 'anything', 'anyone', 'theirs', 'himself', 'ours', 'his', 'my', 'their', 'yours', 'your', 'our', 'its', 'nothing', 'herself', 'hers', 'themselves', 'everything', 'myself', 'itself', 'her'];
    var personalPronouns = ['it', 'they', 'i', 'them', 'you', 'she', 'me', 'he', 'him', 'ourselves', 'us', 'we', 'yourself'];
    var modals = ['can', 'may', 'could', 'might', 'will', 'would', 'must', 'shall', 'should', 'ought'];
    var whPronouns = ['who', 'what', 'whom'];
    var whDeterminers = ['whatever', 'which'];
    var whPossessivePronoun = ['whose'];
    var whAdverbs = ['how', 'when', 'however', 'whenever', 'where', 'why'];
    var verbs = ['have', 'do'];
    var adverbs = ['there'];
    // We have three cases: the word is a symbol (of which there are various kinds), a number, or a string
    // ----------------------
    // Case 1: handle symbols
    // ----------------------
    if (!found) {
        if (operators.indexOf(originalWord) >= 0) {
            found = true;
            properties.push(Properties.OPERATOR);
            switch (originalWord) {
                case "+":
                    POS = MinorPartsOfSpeech.PLUS;
                    break;
                case "-":
                    POS = MinorPartsOfSpeech.MINUS;
                    break;
                case "*":
                    POS = MinorPartsOfSpeech.MUL;
                    break;
                case "/":
                    POS = MinorPartsOfSpeech.DIV;
                    break;
                case "^":
                    POS = MinorPartsOfSpeech.POW;
                    break;
            }
        }
        else if (comparators.indexOf(originalWord) >= 0) {
            found = true;
            properties.push(Properties.COMPARATIVE);
            switch (originalWord) {
                case ">":
                    POS = MinorPartsOfSpeech.GT;
                    break;
                case ">=":
                    POS = MinorPartsOfSpeech.GTE;
                    break;
                case "<":
                    POS = MinorPartsOfSpeech.LT;
                    break;
                case "<=":
                    POS = MinorPartsOfSpeech.LTE;
                    break;
                case "=":
                    POS = MinorPartsOfSpeech.EQ;
                    break;
                case "!=":
                    POS = MinorPartsOfSpeech.NEQ;
                    break;
            }
        }
        else if (separators.indexOf(originalWord) >= 0) {
            found = true;
            properties.push(Properties.SEPARATOR);
            POS = MinorPartsOfSpeech.SEP;
            if (originalWord === "\"") {
                properties.push(Properties.QUOTED);
            }
        }
        else if (originalWord === "'s" || originalWord === "'") {
            properties.push(Properties.POSSESSIVE);
            POS = MinorPartsOfSpeech.POS;
        }
    }
    // ----------------------
    // Case 2: handle numbers
    // ----------------------
    if (!found) {
        if (digits.indexOf(originalWord[0]) >= 0 && isNumeric(originalWord)) {
            found = true;
            properties.push(Properties.QUANTITY);
            POS = MinorPartsOfSpeech.NU;
        }
    }
    // ----------------------
    // Case 3: handle strings
    // ----------------------
    if (!found) {
        // Normalize the word
        normalizedWord = normalizedWord.toLowerCase();
        var before_1 = normalizedWord;
        normalizedWord = singularize(normalizedWord);
        if (before_1 !== normalizedWord) {
            properties.push(Properties.PLURAL);
        }
        // Find the POS in the dictionary, apply some properties based on the word
        // Determiners
        if (determiners.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.DT;
        }
        else if (modals.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.MD;
        }
        else if (preDeterminers.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.PDT;
        }
        else if (copulae.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.CP;
        }
        else if (prepositions.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.IN;
        }
        else if (personalPronouns.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.PRP;
            properties.push(Properties.PRONOUN);
        }
        else if (possessivePronouns.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.PRP;
            properties.push(Properties.PRONOUN);
            properties.push(Properties.POSSESSIVE);
        }
        else if (conjunctions.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.CC;
            properties.push(Properties.CONJUNCTION);
        }
        else if (whPronouns.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WP;
        }
        else if (whDeterminers.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WDT;
        }
        else if (whAdverbs.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WRB;
        }
        else if (whPossessivePronoun.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.WPO;
            properties.push(Properties.POSSESSIVE);
        }
        else if (verbs.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.VB;
        }
        else if (adverbs.indexOf(normalizedWord) >= 0) {
            POS = MinorPartsOfSpeech.RB;
        }
        // Set grouping property
        var groupingWords = ['per', 'by'];
        var negatingWords = ['except', 'without', 'sans', 'not', 'nor', 'neither', 'no'];
        var pluralWords = ['their'];
        if (groupingWords.indexOf(normalizedWord) >= 0) {
            properties.push(Properties.GROUPING);
        }
        else if (negatingWords.indexOf(normalizedWord) >= 0) {
            properties.push(Properties.NEGATES);
        }
        else if (pluralWords.indexOf(normalizedWord) >= 0) {
            properties.push(Properties.PLURAL);
        }
        // If the word is still a noun, if it is upper case than it is a proper noun 
        if (getMajorPOS(POS) === MajorPartsOfSpeech.NOUN) {
            if (upperCaseLetters.indexOf(originalWord[0]) >= 0) {
                properties.push(Properties.PROPER);
            }
        }
    }
    // Build the token
    var token = {
        ix: word.ix,
        originalWord: word.text,
        normalizedWord: normalizedWord,
        POS: POS,
        properties: properties,
    };
    return token;
}
function getMajorPOS(minorPartOfSpeech) {
    // ROOT
    if (minorPartOfSpeech === MinorPartsOfSpeech.ROOT) {
        return MajorPartsOfSpeech.ROOT;
    }
    // Verb
    var verbs = ['VB', 'VBD', 'VBN', 'VBP', 'VBZ', 'VBF', 'VBG'];
    if (verbs.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.VERB;
    }
    // Adjective
    var adjectives = ['JJ', 'JJR', 'JJS'];
    if (adjectives.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.ADJECTIVE;
    }
    // Adverb
    var adverbs = ['RB', 'RBR', 'RBS'];
    if (adverbs.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.ADVERB;
    }
    // Noun
    var nouns = ['NN', 'NNA', 'NNPA', 'NNAB', 'NNP', 'NNPS', 'NNS', 'NNQ', 'NNO', 'NG', 'PRP', 'PP'];
    if (nouns.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.NOUN;
    }
    // Value
    var values = ['CD', 'DA', 'NU'];
    if (values.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.VALUE;
    }
    // Glue
    var glues = ['FW', 'IN', 'CP', 'MD', 'CC', 'PDT', 'DT', 'UH', 'EX'];
    if (glues.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.GLUE;
    }
    // Symbol
    var symbols = ['LT', 'GT', 'LTE', 'GTE', 'EQ', 'NEQ',
        'PLUS', 'MINUS', 'DIV', 'MUL', 'POW',
        'SEP', 'POS'];
    if (symbols.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.SYMBOL;
    }
    // Wh-Word
    var whWords = ['WDT', 'WP', 'WPO', 'WRB'];
    if (whWords.indexOf(MinorPartsOfSpeech[minorPartOfSpeech]) >= 0) {
        return MajorPartsOfSpeech.WHWORD;
    }
}
// Wrap pluralize to special case certain words it gets wrong
// @HACK data singularizes to datum, which is correct, but we
// have a collection called test data, which NLQP turns into test datum
function singularize(word) {
    // split word at spaces
    var words = word.split(" ");
    if (words.length === 1) {
        var specialCases = ["his", "times", "has", "downstairs", "its", "'s", "data", "are", "was"];
        for (var _i = 0; _i < specialCases.length; _i++) {
            var specialCase = specialCases[_i];
            if (specialCase === word) {
                return word;
            }
        }
        return pluralize(word, 1);
    }
    return words.map(singularize).join(" ");
}
exports.singularize = singularize;
function cloneNode(node) {
    var token = cloneToken(node.token);
    var cloneNode = newNode(token);
    cloneNode.entity = node.entity;
    cloneNode.collection = node.collection;
    cloneNode.attribute = node.attribute;
    cloneNode.fxn = node.fxn;
    cloneNode.found = node.found;
    node.properties.map(function (property) { return cloneNode.properties.push(property); });
    return cloneNode;
}
function newNode(token) {
    var node = {
        ix: token.ix,
        name: token.normalizedWord,
        parent: undefined,
        children: [],
        token: token,
        properties: token.properties,
        relationships: [],
        representations: {
            entity: undefined,
            collection: undefined,
            attribute: undefined,
            fxn: undefined,
        },
        found: false,
        foundReps: false,
        hasProperty: hasProperty,
        toString: nodeToString,
        next: nextNode,
        prev: previousNode,
        addChild: addChild,
    };
    token.node = node;
    function hasProperty(property) {
        var found = node.properties.indexOf(property);
        if (found !== -1) {
            return true;
        }
        else {
            return false;
        }
    }
    function nextNode() {
        var token = node.token;
        var nextToken = token.next;
        if (nextToken !== undefined) {
            return nextToken.node;
        }
        return undefined;
    }
    function previousNode() {
        var token = node.token;
        var prevToken = token.prev;
        if (prevToken !== undefined) {
            return prevToken.node;
        }
        return undefined;
    }
    function addChild(newChild) {
        node.children.push(newChild);
        newChild.parent = node;
    }
    function nodeToString(depth) {
        if (depth === undefined) {
            depth = 0;
        }
        var childrenStrings = node.children.map(function (childNode) { return childNode.toString(depth + 1); }).join("\n");
        var children = childrenStrings.length > 0 ? "\n" + childrenStrings : "";
        var indent = Array(depth + 1).join(" ");
        var index = node.ix === undefined ? "+ " : node.ix + ": ";
        var properties = node.properties.length === 0 ? "" : "(" + node.properties.map(function (property) { return Properties[property]; }).join("|") + ")";
        var attribute = node.attribute === undefined ? "" : "[" + node.attribute.variable + "]";
        var entity = node.entity === undefined ? "" : "[" + node.entity.displayName + "]";
        var collection = node.collection === undefined ? "" : "[" + node.collection.displayName + "]";
        var fxn = node.fxn === undefined ? "" : "[" + node.fxn.name + "]";
        var found = node.found ? "*" : " ";
        properties = properties.length === 2 ? "" : properties;
        var nodeString = "|" + found + indent + index + node.name + " " + fxn + entity + collection + attribute + " " + properties + children;
        return nodeString;
    }
    return node;
}
//------------------------------------
// Various node manipulation functions
//------------------------------------
// Removes the node and its children from the tree, 
// and makes it a child of the target node
function reroot(node, target) {
    node.parent.children.splice(node.parent.children.indexOf(node), 1);
    target.addChild(node);
}
// Removes a node from the tree
// The node's children get added to its parent
// returns the node or undefined if the operation failed
function removeNode(node) {
    if (node.hasProperty(Properties.ROOT)) {
        return undefined;
    }
    if (node.parent === undefined && node.children.length === 0) {
        return undefined;
    }
    var children = node.children;
    var parent = node.parent;
    // Rewire
    if (parent !== undefined) {
        parent.children = parent.children.concat(children);
        parent.children.sort(function (a, b) { return a.ix - b.ix; });
        parent.children.splice(parent.children.indexOf(node), 1);
        children.map(function (child) { return child.parent = parent; });
        if (parent.hasProperty(Properties.ARGUMENT)) {
            if (parent.children.length === 0) {
                parent.found = false;
            }
        }
    }
    // Get rid of references on current node
    node.parent = undefined;
    node.children = [];
    return node;
}
function removeBranch(node) {
    var parent = node.parent;
    if (parent !== undefined) {
        parent.children.splice(parent.children.indexOf(node), 1);
        node.parent = undefined;
        return node;
    }
    return undefined;
}
// Returns the first ancestor node that has been found
function previouslyMatched(node, ignoreFunctions) {
    if (ignoreFunctions === undefined) {
        ignoreFunctions = false;
    }
    if (node.parent === undefined) {
        return undefined;
    }
    else if (!ignoreFunctions &&
        (node.parent.hasProperty(Properties.SETTER) ||
            (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION)))) {
        return undefined;
    }
    else if (node.parent.hasProperty(Properties.ENTITY) ||
        node.parent.hasProperty(Properties.ATTRIBUTE) ||
        node.parent.hasProperty(Properties.COLLECTION)) {
        return node.parent;
    }
    else {
        return previouslyMatched(node.parent, ignoreFunctions);
    }
}
// Returns the first ancestor node that has been found
function previouslyMatchedEntityOrCollection(node, ignoreFunctions) {
    if (ignoreFunctions === undefined) {
        ignoreFunctions = false;
    }
    if (node.parent === undefined) {
        return undefined;
    }
    else if (!ignoreFunctions &&
        (node.parent.hasProperty(Properties.SETTER) ||
            (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION)))) {
        return undefined;
    }
    else if (node.parent.hasProperty(Properties.ENTITY) ||
        node.parent.hasProperty(Properties.COLLECTION)) {
        return node.parent;
    }
    else {
        return previouslyMatchedEntityOrCollection(node.parent, ignoreFunctions);
    }
}
// Returns the first ancestor node that has been found
function previouslyMatchedAttribute(node, ignoreFunctions) {
    if (ignoreFunctions === undefined) {
        ignoreFunctions = false;
    }
    if (node.parent === undefined) {
        return undefined;
    }
    else if (!ignoreFunctions &&
        (node.parent.hasProperty(Properties.SETTER) ||
            (node.parent.hasProperty(Properties.FUNCTION) && !node.parent.hasProperty(Properties.CONJUNCTION)))) {
        return undefined;
    }
    else if (node.parent.hasProperty(Properties.ATTRIBUTE)) {
        return node.parent;
    }
    else {
        return previouslyMatchedAttribute(node.parent, ignoreFunctions);
    }
}
// Inserts a node after the target, moving all of the
// target's children to the node
// Before: [Target] -> [Children]
// After:  [Target] -> [Node] -> [Children]
function insertAfterNode(node, target) {
    node.parent = target;
    node.children = target.children;
    target.children.map(function (n) { return n.parent = node; });
    target.children = [node];
}
function insertBeforeNode(node, target) {
    var parent = target.parent;
    if (parent !== undefined) {
        parent.addChild(node);
        parent.children.splice(parent.children.indexOf(target), 1);
        node.addChild(target);
    }
}
// Find all leaf nodes stemming from a given node
function findLeafNodes(node) {
    if (node.children.length === 0) {
        return [node];
    }
    else {
        var foundLeafs = node.children.map(findLeafNodes);
        var flatLeafs = flattenNestedArray(foundLeafs);
        return flatLeafs;
    }
}
/*function moveNode(node: Node, target: Node): void {
  if (node.hasProperty(Properties.ROOT)) {
    return;
  }
  let parent = node.parent;
  parent.children.splice(parent.children.indexOf(node),1);
  parent.children = parent.children.concat(node.children);
  node.children.map((child) => child.parent = parent);
  node.children = [];
  node.parent = target;
  target.children.push(node);
}*/
// Finds a parent node with the specified property, 
// returns undefined if no node was found
function findParentWithProperty(node, property) {
    if (node.parent === undefined) {
        return undefined;
    }
    else if (node.parent.hasProperty(property)) {
        return node.parent;
    }
    else {
        return findParentWithProperty(node.parent, property);
    }
}
// Finds a parent node with the specified property, 
// returns undefined if no node was found
function findChildWithProperty(node, property) {
    if (node.children.length === 0) {
        return undefined;
    }
    if (node.hasProperty(property)) {
        return node;
    }
    else {
        var childrenWithProperty = node.children.filter(function (child) { return child.hasProperty(property); });
        if (childrenWithProperty !== undefined) {
            return childrenWithProperty[0];
        }
        else {
            var results = node.children.map(function (child) { return findChildWithProperty(child, property); }).filter(function (result) { return result !== undefined; });
            if (results.length > 0) {
                return results[0];
            }
        }
    }
}
// Finds a parent node with the specified POS, 
// returns undefined if no node was found
function findParentWithPOS(node, majorPOS) {
    if (getMajorPOS(node.token.POS) === MajorPartsOfSpeech.ROOT) {
        return undefined;
    }
    if (getMajorPOS(node.parent.token.POS) === majorPOS) {
        return node.parent;
    }
    else {
        return findParentWithPOS(node.parent, majorPOS);
    }
}
/*
// Sets node to be a sibling of its parent
// Before: [Grandparent] -> [Parent] -> [Node]
// After:  [Grandparent] -> [Parent]
//                       -> [Node]
function promoteNode(node: Node): void {
  if (node.parent.hasProperty(Properties.ROOT)) {
    return;
  }
  let newSibling = node.parent;
  let newParent = newSibling.parent;
  // Set parent
  node.parent = newParent;
  // Remove node from parent's children
  newSibling.children.splice(newSibling.children.indexOf(node),1);
  // Add node to new parent's children
  newParent.children.push(node);
}*/
// Makes the node's parent a child of the node.
// The node's grandparent is then the node's parent
// Before: [Grandparent] -> [Parent] -> [Node]
// After: [Grandparen] -> [Node] -> [Parent]
function makeParentChild(node) {
    var parent = node.parent;
    // Do not swap with root
    if (parent.hasProperty(Properties.ROOT)) {
        return;
    }
    // Set parents
    node.parent = parent.parent;
    parent.parent = node;
    // Remove node as a child from parent
    parent.children.splice(parent.children.indexOf(node), 1);
    // Set children
    node.children = node.children.concat(parent);
    node.parent.children.push(node);
    node.parent.children.splice(node.parent.children.indexOf(parent), 1);
}
// Swaps a node with its parent. The node's parent
// is then the parent's parent, and its child is the parent.
// The parent gets the node's children
function swapWithParent(node) {
    var parent = node.parent;
    var pparent = parent.parent;
    if (parent.hasProperty(Properties.ROOT)) {
        return;
    }
    parent.parent = node;
    parent.children = node.children;
    pparent.children.splice(pparent.children.indexOf(parent), 1);
    node.parent = pparent;
    node.children = [parent];
    pparent.children.push(node);
}
function newContext() {
    return {
        entities: [],
        collections: [],
        attributes: [],
        fxns: [],
        groupings: [],
        relationships: [],
        found: [],
        arguments: [],
        maybeEntities: [],
        maybeAttributes: [],
        maybeCollections: [],
        maybeFunctions: [],
        maybeArguments: [],
        internalFxns: [],
        nodes: [],
        stateFlags: { list: false, insert: false },
    };
}
(function (FunctionTypes) {
    FunctionTypes[FunctionTypes["FILTER"] = 0] = "FILTER";
    FunctionTypes[FunctionTypes["AGGREGATE"] = 1] = "AGGREGATE";
    FunctionTypes[FunctionTypes["BOOLEAN"] = 2] = "BOOLEAN";
    FunctionTypes[FunctionTypes["CALCULATE"] = 3] = "CALCULATE";
    FunctionTypes[FunctionTypes["INSERT"] = 4] = "INSERT";
    FunctionTypes[FunctionTypes["SELECT"] = 5] = "SELECT";
    FunctionTypes[FunctionTypes["GROUP"] = 6] = "GROUP";
    FunctionTypes[FunctionTypes["NEGATE"] = 7] = "NEGATE";
})(exports.FunctionTypes || (exports.FunctionTypes = {}));
var FunctionTypes = exports.FunctionTypes;
function stringToFunction(word) {
    var all = [Properties.ENTITY, Properties.ATTRIBUTE, Properties.COLLECTION, Properties.FUNCTION, Properties.ROOT];
    var CFA = [Properties.COLLECTION, Properties.FUNCTION, Properties.ATTRIBUTE];
    var filterFields = [{ name: "a", types: [Properties.ATTRIBUTE, Properties.QUANTITY] },
        { name: "b", types: [Properties.ATTRIBUTE, Properties.QUANTITY] }
    ];
    var calculateFields = [{ name: "result", types: [Properties.OUTPUT] },
        { name: "a", types: [Properties.ATTRIBUTE, Properties.QUANTITY] },
        { name: "b", types: [Properties.ATTRIBUTE, Properties.QUANTITY] }
    ];
    switch (word) {
        case "after":
        case ">":
            return { name: ">", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "before":
        case "<":
            return { name: "<", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case ">=":
            return { name: ">=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "<=":
            return { name: "<=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "=":
            return { name: "=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "!=":
            return { name: "!=", type: FunctionTypes.FILTER, fields: filterFields, project: false };
        case "taller":
            return { name: ">", type: FunctionTypes.FILTER, attribute: "height", fields: filterFields, project: false };
        case "shorter":
            return { name: "<", type: FunctionTypes.FILTER, attribute: "length", fields: filterFields, project: false };
        case "longer":
            return { name: ">", type: FunctionTypes.FILTER, attribute: "length", fields: filterFields, project: false };
        case "younger":
            return { name: "<", type: FunctionTypes.FILTER, attribute: "age", fields: filterFields, project: false };
        case "&":
        case "and":
            return { name: "and", type: FunctionTypes.BOOLEAN, fields: [], project: false };
        case "or":
            return { name: "or", type: FunctionTypes.BOOLEAN, fields: [], project: false };
        case "total":
        case "sum":
            return { name: "sum", type: FunctionTypes.AGGREGATE, fields: [{ name: "sum", types: [Properties.OUTPUT] },
                    { name: "value", types: [Properties.ATTRIBUTE] }], project: true, projectedAs: "sum" };
        case "count":
        case "number of":
        case "count the number of":
        case "count number of":
        case "how many":
            return { name: "count", type: FunctionTypes.AGGREGATE, fields: [{ name: "count", types: [Properties.OUTPUT] },
                    { name: "root", types: all }], project: true, projectedAs: "count" };
        case "average":
        case "avg":
        case "mean":
            return { name: "average", type: FunctionTypes.AGGREGATE, fields: [{ name: "average", types: [Properties.OUTPUT] },
                    { name: "value", types: [Properties.ATTRIBUTE] }], project: true, projectedAs: "average" };
        case "plus":
        case "add":
        case "+":
            return { name: "+", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "+" };
        case "subtract":
        case "minus":
        case "-":
            return { name: "-", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "-" };
        case "times":
        case "multiply":
        case "multiplied":
        case "multiplied by":
        case "*":
            return { name: "*", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "*" };
        case "divide":
        case "divided":
        case "divided by":
        case "/":
            return { name: "/", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "/" };
        case "^":
            return { name: "^", type: FunctionTypes.CALCULATE, fields: calculateFields, project: true, projectedAs: "^" };
        case "is":
        case "is a":
        case "is an":
            return { name: "insert", type: FunctionTypes.INSERT, fields: [{ name: "entity", types: [Properties.ENTITY] },
                    { name: "attribute", types: [Properties.ATTRIBUTE] },
                    { name: "root", types: all }], project: false };
        /*case "are":
          return {name: "insert", type: FunctionTypes.INSERT, fields: [{name: "collection", types: [Properties.COLLECTION]},
                                                                       {name: "collection", types: [Properties.COLLECTION]}], project: false};*/
        case "his":
        case "hers":
        case "their":
        case "its":
        case "'s":
        case "'":
            return { name: "select", type: FunctionTypes.SELECT, fields: [{ name: "subject", types: [Properties.ENTITY, Properties.COLLECTION, Properties.ATTRIBUTE] }], project: false };
        case "by":
        case "grouped by":
        case "per":
            return { name: "group", type: FunctionTypes.GROUP, fields: [{ name: "root", types: all },
                    { name: "collection", types: [Properties.COLLECTION, Properties.ATTRIBUTE] }], project: false };
        case "except":
        case "without":
        case "not":
        case "aren't":
            return { name: "negate", type: FunctionTypes.NEGATE, fields: [{ name: "negated", types: CFA }], project: false };
        default:
            return undefined;
    }
}
function findFunction(node, context) {
    log("Searching for function: " + node.name);
    var fxn = stringToFunction(node.name);
    if (fxn === undefined) {
        log(" Not Found: " + node.name);
        return false;
    }
    // Insert function needs to follow a possessive function
    if (fxn.type === FunctionTypes.INSERT && !context.found.some(function (n) { return n.hasProperty(Properties.POSSESSIVE); })) {
        return false;
    }
    log(" Found: " + fxn.name);
    node.fxn = fxn;
    fxn.node = node;
    // Add arguments to the node
    var args = fxn.fields.map(function (field, i) {
        var argToken = newToken(field.name);
        var argNode = newNode(argToken);
        argNode.properties.push(Properties.ARGUMENT);
        if (fxn.project && i === 0) {
            argNode.properties.push(Properties.OUTPUT);
            argNode.found = true;
            var outputToken = newToken("output" + context.fxns.length);
            var outputNode = newNode(outputToken);
            var outputAttribute = {
                id: outputNode.name,
                displayName: outputNode.name,
                variable: outputNode.name,
                node: outputNode,
                project: false,
            };
            outputNode.attribute = outputAttribute;
            outputNode.properties.push(Properties.OUTPUT);
            outputNode.found = true;
            argNode.addChild(outputNode);
        }
        else {
            argNode.properties.push(Properties.INPUT);
        }
        argNode.properties = argNode.properties.concat(field.types);
        context.arguments.push(argNode);
        return argNode;
    });
    node.properties.push(Properties.FUNCTION);
    for (var _i = 0; _i < args.length; _i++) {
        var arg = args[_i];
        node.addChild(arg);
    }
    node.found = true;
    node.type = NodeTypes.FUNCTION;
    if (node.fxn.type === FunctionTypes.AGGREGATE ||
        node.fxn.type === FunctionTypes.CALCULATE ||
        node.fxn.type === FunctionTypes.FILTER) {
        context.fxns.push(node);
    }
    context.internalFxns.push(node);
    return true;
}
function formTree(node, tree, context) {
    log("--------------------------------");
    log(node.toString());
    log(context);
    if (context.nodes.indexOf(node) === -1) {
        context.nodes.push(node);
    }
    // Don't do anything with subsumed nodes
    if (node.hasProperty(Properties.SUBSUMED)) {
        log("Skipping...");
        return { tree: tree, context: context };
    }
    // -------------------------------------
    // Step 1: Build n-grams
    // -------------------------------------
    log("ngrams:");
    // Flatten the tree
    var nextNode = tree;
    var nodes = [];
    while (nextNode !== undefined) {
        nodes.push(nextNode);
        nextNode = nextNode.next();
    }
    // Build ngrams
    // Initialize the ngrams with 1-grams
    var ngrams = nodes.map(function (node) { return [node]; });
    // Shift off the root node
    ngrams.shift();
    var n = 4;
    var m = ngrams.length;
    var offset = 0;
    for (var i = 0; i < n - 1; i++) {
        var newNgrams = [];
        for (var j = offset; j < ngrams.length; j++) {
            var thisNgram = ngrams[j];
            var nextNgram = ngrams[j + 1];
            // Break at the end of the ngrams
            if (nextNgram === undefined) {
                break;
            }
            // From the new ngram
            var newNgram = thisNgram.concat([nextNgram[nextNgram.length - 1]]);
            newNgrams.push(newNgram);
        }
        offset = ngrams.length;
        ngrams = ngrams.concat(newNgrams);
    }
    // Check each ngram for a display name
    var matchedNgrams = [];
    for (var i = ngrams.length - 1; i >= 0; i--) {
        var ngram = ngrams[i];
        var allFound_1 = ngram.every(function (node) { return node.found; });
        if (allFound_1 !== true) {
            var displayName = ngram.map(function (node) { return node.name; }).join(" ").replace(/ '/g, '\'');
            log(displayName);
            var foundName = app_1.eve.findOne("index name", { name: displayName });
            // If the display name is in the system, mark all the nodes as found 
            if (foundName !== undefined) {
                ngram.map(function (node) { return node.found = true; });
                matchedNgrams.push(ngram);
            }
            else {
                var foundAttribute = app_1.eve.findOne("entity eavs", { attribute: displayName });
                if (foundAttribute !== undefined) {
                    ngram.map(function (node) { return node.found = true; });
                    matchedNgrams.push(ngram);
                }
                else {
                    var fxn = stringToFunction(displayName);
                    if (fxn !== undefined) {
                        ngram.map(function (node) { return node.found = true; });
                        // "engineers are employees" asserts that every engineer is also an employee
                        // "engineers that are employees" is asking for the intersection of engineers and employees
                        // "that" is a determiner, which cnages the meaning of the sentence, so we prevent 
                        // an insert using this heuristic 
                        if (fxn.type === FunctionTypes.INSERT &&
                            (ngram[0].prev().token.POS === MinorPartsOfSpeech.DT ||
                                getMajorPOS(ngram[0].prev().token.POS) === MajorPartsOfSpeech.WHWORD)) {
                            return { tree: tree, context: context };
                        }
                        else {
                            matchedNgrams.push(ngram);
                        }
                    }
                }
            }
        }
    }
    // Turn matched ngrams into compound nodes  
    for (var _i = 0; _i < matchedNgrams.length; _i++) {
        var ngram = matchedNgrams[_i];
        // Don't do anything for 1-grams
        if (ngram.length === 1) {
            ngram[0].found = false;
            continue;
        }
        var displayName = ngram.map(function (node) { return node.name; }).join(" ").replace(/ '/g, '\'');
        log("Creating compound node: " + displayName);
        var lastGram = ngram[ngram.length - 1];
        var compoundToken = newToken(displayName);
        compoundToken.prev = ngram[0].token.prev;
        var compoundNode = newNode(compoundToken);
        compoundNode.constituents = ngram;
        compoundNode.constituents.map(function (node) { return node.properties.push(Properties.SUBSUMED); });
        compoundNode.ix = lastGram.ix;
        // Inherit properties from the nodes
        compoundNode.properties = lastGram.properties;
        compoundNode.properties.push(Properties.COMPOUND);
        compoundNode.properties.splice(compoundNode.properties.indexOf(Properties.SUBSUMED), 1); // Don't inherit subsumed property
        // The compound node results from the new node,
        // so the compound node replaces it
        node = compoundNode;
    }
    log('-------');
    // -------------------------------------
    // Step 2: Identify the node
    // -------------------------------------
    // If the node is a quantity, just build an attribute
    if (node.hasProperty(Properties.QUANTITY)) {
        var quantityAttribute = {
            id: node.name,
            displayName: node.name,
            variable: node.name,
            node: node,
            project: false,
            handled: true,
        };
        node.quantity = parseFloat(node.name);
        node.properties.push(Properties.ATTRIBUTE);
        node.type = NodeTypes.NUMBER;
        node.attribute = quantityAttribute;
        node.found = true;
    }
    // Find a collection, entity, attribute, or function
    if (!node.found) {
        findCollection(node, context);
        if (!node.found) {
            findAttribute(node, context);
            if (!node.found) {
                findEntity(node, context);
                if (!node.found) {
                    findFunction(node, context);
                    if (!node.found) {
                        log(node.name + " was not found anywhere!");
                    }
                }
            }
        }
    }
    // If the node wasn't found at all, don't try to place it anywhere
    if (!node.found && context.stateFlags.insert === false) {
        if (getMajorPOS(node.token.POS) === MajorPartsOfSpeech.NOUN) {
            if (node.hasProperty(Properties.PROPER)) {
                context.maybeEntities.push(node);
            }
            else if (node.hasProperty(Properties.PLURAL)) {
                context.maybeCollections.push(node);
            }
            else {
                context.maybeAttributes.push(node);
            }
        }
        return { tree: tree, context: context };
    }
    else if (!node.found && context.stateFlags.insert === true) {
        var root = context.arguments.filter(function (a) { return a.hasProperty(Properties.ROOT); }).pop();
        if (root !== undefined) {
            node.found = true;
            addNodeToFunction(node, root.parent, context);
        }
        context.maybeAttributes.push(node);
        return { tree: tree, context: context };
    }
    else if (node.found && !node.foundReps) {
        findAlternativeRepresentations(node);
    }
    // -------------------------------------
    // Step 3: Insert the node into the tree
    // -------------------------------------
    log("Matching: " + node.name);
    // If the node is compound, replace the last subsumed node with it
    if (node.hasProperty(Properties.COMPOUND)) {
        var subsumedNode = node.constituents[node.constituents.length - 2];
        if (subsumedNode.parent !== undefined) {
            log("Replacing \"" + subsumedNode.name + "\" with \"" + node.name + "\"");
            insertBeforeNode(node, subsumedNode);
            removeBranch(subsumedNode);
            var children = subsumedNode.children;
            // Relinquish children
            for (var _a = 0; _a < children.length; _a++) {
                var child = children[_a];
                if (child.hasProperty(Properties.ARGUMENT)) {
                    for (var _b = 0, _c = child.children; _b < _c.length; _b++) {
                        var grandChild = _c[_b];
                        removeBranch(grandChild);
                        formTree(grandChild, tree, context);
                    }
                }
                else {
                    removeBranch(child);
                    formTree(child, tree, context);
                }
            }
            // filter context
            context.internalFxns = context.internalFxns.filter(function (f) { return !f.hasProperty(Properties.SUBSUMED); });
            context.arguments = context.arguments.filter(function (a) { return !a.parent.hasProperty(Properties.SUBSUMED); });
            return { tree: tree, context: context };
        }
    }
    // Handle functions
    if (node.hasProperty(Properties.FUNCTION)) {
        // Find an argument to attach the node to
        var functionArg = context.arguments.filter(function (n) { return n.hasProperty(Properties.FUNCTION) && n.parent !== node && !n.found; });
        if (functionArg.length > 0) {
            var arg = functionArg.pop();
            addNodeToFunction(node, arg.parent, context);
        }
        else {
            tree.addChild(node);
        }
        // If the node is a grouping node, attach the old root to the new one
        if (node.fxn.type === FunctionTypes.GROUP) {
            var newRoot = node.children[0];
            for (var _d = 0, _e = tree.children; _d < _e.length; _d++) {
                var child = _e[_d];
                if (child === node) {
                    continue;
                }
                else {
                    reroot(child, newRoot);
                }
                newRoot.found = true;
            }
        }
        else if (node.fxn.type === FunctionTypes.INSERT) {
            // Find an entity
            var entity = context.found.filter(function (n) { return n.hasProperty(Properties.ENTITY) && n.ix < node.ix; }).pop();
            if (entity !== undefined) {
                removeNode(entity);
                addNodeToFunction(entity, node, context);
                // Find an attribute
                var attribute = context.found.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE) && n.ix > entity.ix; }).pop();
                if (attribute !== undefined) {
                    removeNode(attribute);
                    addNodeToFunction(attribute, node, context);
                }
                else {
                    var attributeNodes = context.nodes.filter(function (ma) { return ma.ix > entity.ix + 1; });
                    attributeNodes.pop();
                    if (attributeNodes.length > 0) {
                        attributeNodes.map(removeNode);
                        var nName = attributeNodes.map(function (ma) { return ma.name; }).join(" ");
                        var nToken = newToken(nName);
                        nToken.ix = attributeNodes[0].ix;
                        var nNode = newNode(nToken);
                        nNode.type = NodeTypes.STRING;
                        nNode.found = true;
                        nNode.properties.push(Properties.ATTRIBUTE);
                        addNodeToFunction(nNode, node, context);
                    }
                }
            }
        }
        else if (node.fxn.type === FunctionTypes.FILTER) {
            // If an attribute is specified, create an attribute node for each one
            if (node.fxn.attribute !== undefined) {
                // LHS
                var nToken = newToken(node.fxn.attribute);
                var nNode = newNode(nToken);
                formTree(nNode, tree, context);
                // RHS
                nToken = newToken(node.fxn.attribute);
                nNode = newNode(nToken);
                findAttribute(nNode, context);
                addNodeToFunction(nNode, node, context);
            }
            else {
                var orphans = context.found.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE); });
                for (var _f = 0; _f < orphans.length; _f++) {
                    var orphan = orphans[_f];
                    removeNode(orphan);
                    formTree(orphan, tree, context);
                    // Break when all args are filled
                    if (node.children.every(function (n) { return n.found; })) {
                        break;
                    }
                }
            }
        }
        else if (node.fxn.type === FunctionTypes.NEGATE) {
        }
        else if (node.fxn.type === FunctionTypes.CALCULATE) {
            var AQFs = context.nodes.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE) ||
                n.hasProperty(Properties.QUANTITY) ||
                n.hasProperty(Properties.FUNCTION); });
            for (var _g = 0; _g < AQFs.length; _g++) {
                var aqf = AQFs[_g];
                if (aqf.parent !== undefined && aqf.parent.hasProperty(Properties.ARGUMENT)) {
                    continue;
                }
                if (aqf.hasProperty(Properties.FUNCTION)) {
                    if (aqf.fxn.type === FunctionTypes.AGGREGATE) {
                        removeBranch(aqf);
                    }
                    else {
                        continue;
                    }
                }
                else {
                    removeNode(aqf);
                }
                formTree(aqf, tree, context);
                if (node.children.every(function (n) { return n.found; })) {
                    break;
                }
            }
        }
        else {
            if (node.fxn.fields.length > 0) {
                for (var i = context.found.length - 1; i >= 0; i--) {
                    var foundNode = context.found[i];
                    removeNode(foundNode);
                    formTree(foundNode, tree, context);
                    // Break when all args are filled
                    if (node.children.every(function (n) { return n.found; })) {
                        break;
                    }
                }
            }
        }
    }
    else {
        // Find a relationship if we have to
        var relationship = { type: RelationshipTypes.NONE };
        if (node.relationships.length === 0) {
            //let orphans = tree.children.filter((child) => child.relationships.length === 0 && child.children.length === 0);  
            for (var i = context.found.length - 1; i >= 0; i--) {
                var foundNode = context.found[i];
                if (foundNode === node) {
                    continue;
                }
                if (node.relationships.length === 0) {
                    removeNode(node);
                }
                relationship = findRelationship(node, foundNode, context);
                if (relationship.type !== RelationshipTypes.NONE) {
                    break;
                }
                else if (relationship.type === RelationshipTypes.NONE) {
                    if (foundNode.hasProperty(Properties.POSSESSIVE) && !node.hasProperty(Properties.QUANTITY)) {
                        context.maybeAttributes.push(node);
                    }
                }
            }
        }
        // Place the node onto a function if one is open
        var openFunctions = context.internalFxns.filter(function (fxn) { return !fxn.children.every(function (c) { return c.found; }); });
        for (var _h = 0; _h < openFunctions.length; _h++) {
            var fxnNode = openFunctions[_h];
            var added = addNodeToFunction(node, fxnNode, context);
            if (added) {
                relationship.type = RelationshipTypes.DIRECT;
                break;
            }
        }
        // If no relationships were found, stick the node onto the root
        if (node.parent === undefined && node.relationships.length === 0) {
            tree.addChild(node);
        }
        else if (node.parent === undefined) {
            var relatedNodes = node.relationships.map(function (r) { return r.nodes; });
            var flatRelatedNodes = flattenNestedArray(relatedNodes);
            var relatedAttribute = flatRelatedNodes.filter(function (n) { return n.hasProperty(Properties.ATTRIBUTE); }).shift();
            if (relatedAttribute !== undefined) {
                var root = findParentWithProperty(relatedAttribute, Properties.ROOT);
                if (root !== undefined) {
                    root.addChild(node);
                }
                else {
                    tree.addChild(node);
                }
            }
            else {
                tree.addChild(node);
            }
        }
        // Finally add any nodes implicit in the relationship    
        if (relationship.implicitNodes !== undefined && relationship.implicitNodes.length > 0) {
            for (var _j = 0, _k = relationship.implicitNodes; _j < _k.length; _j++) {
                var implNode = _k[_j];
                formTree(implNode, tree, context);
            }
        }
    }
    // Switch state
    if (node.fxn && node.fxn.type === FunctionTypes.INSERT) {
        context.stateFlags.insert = true;
    }
    log("Tree:");
    log(tree.toString());
    return { tree: tree, context: context };
}
// Find all the representations of a thing
function findAlternativeRepresentations(node) {
    var attr = findEveAttribute(node.name);
    var coll = findEveCollection(node.name);
    var ent = findEveEntity(node.name);
    var fxn = stringToFunction(node.name);
    node.representations = {
        collection: coll,
        entity: ent,
        attribute: attr,
        fxn: fxn,
    };
    node.foundReps = true;
}
// Swap the representation of the node with another one
// Clears all attributes related to the old rep, and adds a new one
function changeRepresentation(node, rep, context) {
    // Clear the node
    node.found = false;
    if (node.collection !== undefined) {
        node.collection = undefined;
        node.properties.splice(node.properties.indexOf(Properties.COLLECTION), 1);
    }
    else if (node.entity !== undefined) {
        node.entity = undefined;
        node.properties.splice(node.properties.indexOf(Properties.ENTITY), 1);
    }
    else if (node.attribute !== undefined) {
        node.attribute = undefined;
        node.properties.splice(node.properties.indexOf(Properties.ATTRIBUTE), 1);
    }
    else if (node.fxn !== undefined) {
        node.fxn = undefined;
        node.properties.splice(node.properties.indexOf(Properties.FUNCTION), 1);
    }
    // Switch the representation
    if (rep === Properties.COLLECTION) {
        if (node.representations.collection) {
            findCollection(node, context);
            return true;
        }
    }
    else if (rep === Properties.ENTITY) {
        if (node.representations.entity) {
            findEntity(node, context);
            return true;
        }
    }
    else if (rep === Properties.ATTRIBUTE) {
        if (node.representations.attribute) {
            findAttribute(node, context);
            return true;
        }
    }
    else if (rep === Properties.FUNCTION) {
        if (node.representations.fxn) {
            findFunction(node, context);
            return true;
        }
    }
    return false;
}
// Adds a node to an argument. If adding the node completes a select,
// a new node will be returned
function addNodeToFunction(node, fxnNode, context) {
    log("Matching \"" + node.name + "\" with function \"" + fxnNode.name + "\"");
    // Find the correct arg
    var arg;
    if (node.hasProperty(Properties.ENTITY)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.ENTITY) && !c.found; }).shift();
    }
    else if (node.hasProperty(Properties.COLLECTION)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.COLLECTION) && !c.found; }).shift();
    }
    else if (node.hasProperty(Properties.ATTRIBUTE)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.ATTRIBUTE) && !c.found; }).shift();
    }
    else if (node.hasProperty(Properties.FUNCTION)) {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.FUNCTION) && !c.found; }).shift();
    }
    else {
        arg = fxnNode.children.filter(function (c) { return c.hasProperty(Properties.ROOT); }).shift();
    }
    // Add the node to the arg
    if (arg !== undefined) {
        if (fxnNode.fxn.type === FunctionTypes.GROUP && arg.name === "collection") {
            context.groupings.push(node);
            arg.addChild(node);
        }
        else if (fxnNode.fxn.type === FunctionTypes.SELECT) {
            var root = findParentWithProperty(fxnNode, Properties.ROOT);
            removeBranch(fxnNode);
            context.arguments.splice(context.arguments.indexOf(node.children[0]), 1);
            context.internalFxns.splice(context.internalFxns.indexOf(fxnNode), 1);
            node.properties.push(Properties.POSSESSIVE);
            root.addChild(node);
            return true;
        }
        else {
            arg.addChild(node);
        }
        arg.found = true;
        return true;
    }
    else {
        return false;
    }
}
function cloneCollection(collection) {
    var clone = {
        id: collection.id,
        displayName: collection.displayName,
        node: collection.node,
        variable: collection.variable,
        project: collection.project,
    };
    return clone;
}
// Returns the entity with the given display name.
// If the entity is not found, returns undefined
// Two error modes here: 
// 1) the name is not found in "display name"
// 2) the name is found in "display name" but not found in "entity"
// can 2) ever happen?
// Returns the collection with the given display name.
function findEveEntity(search) {
    log("Searching for entity: " + search);
    var foundEntity;
    var name;
    // Try to find by display name first
    var display = app_1.eve.findOne("index name", { name: search });
    if (display !== undefined) {
        foundEntity = app_1.eve.findOne("entity", { entity: display.id });
        name = search;
    }
    else {
        foundEntity = app_1.eve.findOne("entity", { entity: search });
    }
    // Build the entity
    if (foundEntity !== undefined) {
        if (name === undefined) {
            display = app_1.eve.findOne("display name", { id: search });
            name = display.name;
        }
        var entity = {
            id: foundEntity.entity,
            displayName: name,
            variable: name.replace(/ /g, ''),
            project: true,
            entityAttr: false,
            entityVar: false,
            valueVar: false,
        };
        log(" Found: " + entity.id);
        return entity;
    }
    else {
        log(" Not found: " + search);
        return undefined;
    }
}
// Returns the collection with the given display name.
function findEveCollection(search) {
    log("Searching for collection: " + search);
    var foundCollection;
    var name;
    // Try to find by display name first
    var display = app_1.eve.findOne("index name", { name: search });
    if (display !== undefined) {
        foundCollection = app_1.eve.findOne("collection", { collection: display.id });
        name = search;
    }
    else {
        foundCollection = app_1.eve.findOne("collection", { collection: search });
    }
    // Build the collection
    if (foundCollection !== undefined) {
        if (name === undefined) {
            display = app_1.eve.findOne("display name", { id: search });
            name = display.name;
        }
        var collection = {
            id: foundCollection.collection,
            displayName: name,
            variable: name.replace(/ /g, ''),
            project: true,
        };
        log(" Found: " + collection.id);
        return collection;
    }
    else {
        log(" Not found: " + search);
        return undefined;
    }
}
// Returns the attribute with the given display name attached to the given entity
// If the entity does not have that attribute, or the entity does not exist, returns undefined
function findEveAttribute(name) {
    log("Searching for attribute: " + name);
    var foundAttribute = app_1.eve.findOne("entity eavs", { attribute: name });
    if (foundAttribute !== undefined) {
        var attribute = {
            id: foundAttribute.attribute,
            displayName: name,
            variable: name.replace(/ /g, ''),
            project: true,
        };
        log(" Found: " + name);
        log(attribute);
        return attribute;
    }
    log(" Not found: " + name);
    return undefined;
}
var RelationshipTypes;
(function (RelationshipTypes) {
    RelationshipTypes[RelationshipTypes["NONE"] = 0] = "NONE";
    RelationshipTypes[RelationshipTypes["DIRECT"] = 1] = "DIRECT";
    RelationshipTypes[RelationshipTypes["ONEHOP"] = 2] = "ONEHOP";
    RelationshipTypes[RelationshipTypes["TWOHOP"] = 3] = "TWOHOP";
    RelationshipTypes[RelationshipTypes["INTERSECTION"] = 4] = "INTERSECTION";
})(RelationshipTypes || (RelationshipTypes = {}));
function findRelationship(nodeA, nodeB, context) {
    var relationship = { type: RelationshipTypes.NONE };
    if ((nodeA === nodeB) ||
        (context.stateFlags.insert) ||
        (nodeA.hasProperty(Properties.QUANTITY) && nodeB.hasProperty(Properties.QUANTITY))) {
        return relationship;
    }
    log("Finding relationship between \"" + nodeA.name + "\" and \"" + nodeB.name + "\"");
    // Sort the nodes in order
    // 1) Collection 
    // 2) Entity 
    // 3) Attribute
    // 4) Function
    // 5) Quantity
    // 6) String
    nodeA.properties.sort(function (a, b) { return a - b; });
    nodeB.properties.sort(function (a, b) { return a - b; });
    var nodes = [nodeA, nodeB].sort(function (a, b) { return a.properties[0] - b.properties[0]; });
    nodeA = nodes[0];
    nodeB = nodes[1];
    // Find the proper relationship
    if (nodeA.hasProperty(Properties.ENTITY) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
        relationship = findEntToAttrRelationship(nodeA, nodeB, context);
    }
    else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
        relationship = findCollToAttrRelationship(nodeA, nodeB, context);
    }
    else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.COLLECTION)) {
        relationship = findCollToCollRelationship(nodeA, nodeB, context);
    }
    else if (nodeA.hasProperty(Properties.ATTRIBUTE) && nodeB.hasProperty(Properties.ATTRIBUTE)) {
        relationship = findAttrToAttrRelationship(nodeA, nodeB, context);
    }
    else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.ENTITY)) {
        relationship = findCollToEntRelationship(nodeA, nodeB, context);
    }
    // Add relationships to the nodes and context
    if (relationship.type !== RelationshipTypes.NONE) {
        nodeA.relationships.push(relationship);
        nodeB.relationships.push(relationship);
        context.relationships.push(relationship);
    }
    else {
        nodes = [nodeA, nodeB].sort(function (a, b) { return a.ix - b.ix; });
        nodeA = nodes[0];
        nodeB = nodes[1];
        var repChanged = false;
        // If one node is possessive, it suggests the other should be represented as an attribute of the first
        if (nodeA.hasProperty(Properties.POSSESSIVE) && !nodeB.hasProperty(Properties.ATTRIBUTE) && nodeB.representations.attribute !== undefined) {
            repChanged = changeRepresentation(nodeB, Properties.ATTRIBUTE, context);
        }
        else if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.COLLECTION) && nodeB.representations.attribute !== undefined) {
            repChanged = changeRepresentation(nodeB, Properties.ATTRIBUTE, context);
        }
        if (repChanged) {
            relationship = findRelationship(nodeA, nodeB, context);
        }
    }
    return relationship;
}
// e.g. Corey's wife's age
function findAttrToAttrRelationship(attrA, attrB, context) {
    log("Finding Attr -> Attr relationship between \"" + attrA.name + "\" and \"" + attrB.name + "\"...");
    console.log(attrA);
    console.log(attrB);
    if (attrA.hasProperty(Properties.QUANTITY)) {
        var temp = attrA;
        attrA = attrB;
        attrB = temp;
    }
    // e.g. employees whose salary is 10
    if (attrA.relationships.length > 0 && attrB.hasProperty(Properties.QUANTITY) && !attrA.parent.hasProperty(Properties.ARGUMENT)) {
        attrA.attribute.variable = "" + attrB.quantity;
        attrA.attribute.attributeVar = false;
        attrA.attribute.project = false;
        return { type: RelationshipTypes.DIRECT, nodes: [attrA, attrB] };
    }
    else {
        return { type: RelationshipTypes.NONE };
    }
    // Check whether one of the attributes is an entity attribute
    var direct = false;
    if (attrA.hasProperty(Properties.POSSESSIVE)) {
        direct = true;
    }
    else if (attrB.hasProperty(Properties.POSSESSIVE)) {
        var tNode = attrA;
        attrA = attrB;
        attrB = tNode;
        direct = true;
    }
    if (direct) {
        log("  Found a direct relationship");
        // Create an entity attribute
        var entityAttr = attrA.attribute;
        var ent = {
            id: entityAttr.variable,
            displayName: entityAttr.variable,
            variable: entityAttr.variable,
            project: false,
            entityAttr: true,
            entityVar: false,
            valueVar: false,
        };
        var nToken = newToken(entityAttr.variable);
        var nNode = newNode(nToken);
        nNode.entity = ent;
        ent.node = nNode;
        attrB.attribute.variable = attrA.attribute.variable + "|" + attrB.attribute.id;
        attrB.attribute.refs = [nNode];
        return { type: RelationshipTypes.DIRECT, nodes: [attrA, attrB] };
    }
    return { type: RelationshipTypes.NONE };
}
// e.g. "meetings john was in"
function findCollToEntRelationship(coll, ent, context) {
    log("Finding Coll -> Ent relationship between \"" + coll.name + "\" and \"" + ent.name + "\"...");
    /*if (coll === "collections") {
      if (eve.findOne("collection entities", { entity: nodeB.entity.id })) {
        return { type: RelationshipTypes.DIRECT };
      }
    }
    if (eve.findOne("collection entities", { collection: coll.collection.id, entity: ent.entity.id })) {
      log("  Found Direct relationship")
      return { type: RelationshipTypes.DIRECT };
    }*/
    var eveRelationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.collection.id }, "collection")
        .select("directionless links", { entity: ["collection", "entity"], link: ent.entity.id }, "links")
        .exec();
    if (eveRelationship.unprojected.length) {
        var entities = extractFromUnprojected(eveRelationship.unprojected, 1, 2, "link");
        var collections = findCommonCollections(entities);
        var collLinkID;
        if (collections.length > 0) {
            log("  Found Direct Relationship");
            var entity = ent.entity;
            entity.entityVar = true;
            entity.project = false;
            entity.variable = coll.collection.variable;
            var relationship = { type: RelationshipTypes.DIRECT, nodes: [coll, ent] };
            return relationship;
        }
    }
    /*
    // e.g. events with chris granger (events -> meetings -> chris granger)
    let relationships2 = eve.query(``)
      .select("collection entities", { collection: coll }, "collection")
      .select("directionless links", { entity: ["collection", "entity"] }, "links")
      .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
      .exec();
    if (relationships2.unprojected.length) {
      let entities = extractFromUnprojected(relationships2.unprojected, 1, 3);
      return { type: RelationshipTypes.TWOHOP };
    }*/
    log("  No relationship found");
    return { type: RelationshipTypes.NONE };
}
function findEntToAttrRelationship(ent, attr, context) {
    log("Finding Ent -> Attr relationship between \"" + ent.name + "\" and \"" + attr.name + "\"...");
    // If the node already has a relationship, then treat the entity as filtering the node
    if (attr.relationships.length > 0) {
        attr.attribute.variable = ent.entity.id;
        attr.attribute.attributeVar = false;
        attr.attribute.project = false;
        ent.entity.project = false;
        ent.entity.handled = true;
        return { type: RelationshipTypes.DIRECT, nodes: [ent, attr] };
    }
    // Check for a direct relationship
    // e.g. "Josh's age"
    var eveRelationship = app_1.eve.findOne("entity eavs", { entity: ent.entity.id, attribute: attr.attribute.id });
    if (eveRelationship) {
        log("  Found a direct relationship.");
        var attribute = attr.attribute;
        var varName = (ent.name + "|" + attr.name).replace(/ /g, '');
        attribute.variable = varName;
        attribute.refs = [ent];
        attribute.project = true;
        ent.entity.handled = true;
        return { type: RelationshipTypes.DIRECT, nodes: [ent, attr], implicitNodes: [] };
    }
    // Check for a one-hop relationship
    // e.g. "Salaries in engineering"
    eveRelationship = app_1.eve.query("")
        .select("directionless links", { entity: ent.entity.id }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr.attribute.id }, "eav")
        .exec();
    if (eveRelationship.unprojected.length) {
        log(eveRelationship);
        // Fill in the attribute
        var entities = extractFromUnprojected(eveRelationship.unprojected, 0, 2, "link");
        var collections = findCommonCollections(entities);
        var collLinkID;
        if (collections.length > 0) {
            log("  Found One-Hop Relationship");
            // @HACK Choose the correct collection in a smart way. 
            // Largest collection other than entity or testdata?
            collLinkID = collections[0];
            var foundCollection = findEveCollection(collLinkID);
            var linkToken = newToken(foundCollection.displayName);
            var linkCollection = newNode(linkToken);
            findCollection(linkCollection, context);
            var attribute = attr.attribute;
            var varName = (linkCollection.name + "|" + attr.name).replace(/ /g, '');
            attribute.variable = varName;
            attribute.refs = [linkCollection];
            // Find the one-hop link
            var getAttr = app_1.eve.query("")
                .select("directionless links", { entity: ent.entity.id }, "links")
                .select("entity eavs", { entity: ["links", "link"], value: ent.entity.id }, "eav")
                .exec();
            var attributes = extractFromUnprojected(getAttr.unprojected, 1, 2, "attribute");
            attributes = attributes.filter(onlyUnique);
            var attrLinkID;
            var nNode;
            var implicitNodes = [];
            if (attributes.length > 0) {
                attrLinkID = attributes[0];
                // Build a link attribute node
                var newName = attrLinkID;
                var nToken = newToken(newName);
                nNode = newNode(nToken);
                var nAttribute = {
                    id: attrLinkID,
                    refs: [linkCollection],
                    node: nNode,
                    displayName: attrLinkID,
                    variable: "\"" + ent.entity.id + "\"",
                    project: false,
                };
                nNode.attribute = nAttribute;
                nNode.properties.push(Properties.ATTRIBUTE);
                nNode.found = true;
                implicitNodes.push(nNode);
            }
            // Project what we need to
            attribute.project = true;
            ent.entity.project = false;
            ent.entity.handled = true;
            var relationship = { type: RelationshipTypes.ONEHOP, nodes: [ent, attr], implicitNodes: implicitNodes };
            if (nNode !== undefined) {
                nNode.relationships.push(relationship);
            }
            return relationship;
        }
    }
    /*
    let relationships2 = eve.query(``)
      .select("directionless links", { entity: entity.id }, "links")
      .select("directionless links", { entity: ["links", "link"] }, "links2")
      .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
      .exec();
    if (relationships2.unprojected.length) {
      let entities = extractFromUnprojected(relationships2.unprojected, 0, 3);
      let entities2 = extractFromUnprojected(relationships2.unprojected, 1, 3);
      //return { distance: 2, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }*/
    log("  No relationship found.");
    return { type: RelationshipTypes.NONE };
}
function findCollToCollRelationship(collA, collB, context) {
    log("Finding Coll -> Coll relationship between \"" + collA.collection.displayName + "\" and \"" + collB.collection.displayName + "\"...");
    // are there things in both sets?
    var intersection = app_1.eve.query(collA.collection.displayName + "->" + collB.collection.displayName)
        .select("collection entities", { collection: collA.collection.id }, "collA")
        .select("collection entities", { collection: collB.collection.id, entity: ["collA", "entity"] }, "collB")
        .exec();
    // is there a relationship between things in both sets
    var eveRelationship = app_1.eve.query("relationships between " + collA.collection.displayName + " and " + collB.collection.displayName)
        .select("collection entities", { collection: collA.collection.id }, "collA")
        .select("directionless links", { entity: ["collA", "entity"] }, "links")
        .select("collection entities", { collection: collB.collection.id, entity: ["links", "link"] }, "collB")
        .group([["links", "link"]])
        .aggregate("count", {}, "count")
        .project({ type: ["links", "link"], count: ["count", "count"] })
        .exec();
    var maxRel = { type: "", count: 0 };
    for (var _i = 0, _a = eveRelationship.results; _i < _a.length; _i++) {
        var result = _a[_i];
        if (result.count > maxRel.count)
            maxRel = result;
    }
    // we divide by two because unprojected results pack rows next to eachother
    // and we have two selects.
    var intersectionSize = intersection.unprojected.length / 2;
    if (maxRel.count > intersectionSize) {
        /*
        console.log(eveRelationship)
        let entities = extractFromUnprojected(eveRelationship.unprojected,1,2,"link").filter((e) => e !== undefined);
        let collections = findCommonCollections(entities);
        console.log(entities);
        console.log(collections)
        console.log(findEveCollection(collections[0]));*/
        log(" Direct relationship found");
        var nName = collA.name + "|" + collB.name;
        var nToken = newToken(nName);
        var nNode = newNode(nToken);
        // Create a link eav
        var entity = {
            id: nName,
            displayName: nName,
            variable: collB.collection.variable,
            value: collA.collection.variable,
            project: false,
            entityAttr: false,
            entityVar: true,
            valueVar: true,
            node: nNode,
            handled: false,
        };
        nNode.properties.push(Properties.ENTITY);
        nNode.entity = entity;
        nNode.found = true;
        collB.addChild(nNode);
        var relationship = { type: RelationshipTypes.DIRECT, nodes: [collA, collB] };
        nNode.relationships.push(relationship);
        return relationship;
    }
    else if (intersectionSize > 0) {
        log(" Found Intersection relationship.");
        collA.collection.variable = collB.collection.variable;
        collB.collection.project = true;
        collA.collection.project = false;
        return { type: RelationshipTypes.INTERSECTION, nodes: [collA, collB] };
    }
    else if (maxRel.count === 0 && intersectionSize === 0) {
        log("  No relationship found2");
        return { type: RelationshipTypes.NONE };
    }
    else {
        // @TODO
        log("  No relationship found3");
        return { type: RelationshipTypes.NONE };
    }
}
exports.findCollToCollRelationship = findCollToCollRelationship;
function findCollToAttrRelationship(coll, attr, context) {
    // Finds a direct relationship between collection and attribute
    // e.g. "pets' lengths"" => pet -> length
    log("Finding Coll -> Attr relationship between \"" + coll.name + "\" and \"" + attr.name + "\"...");
    var eveRelationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.collection.id }, "collection")
        .select("entity eavs", { entity: ["collection", "entity"], attribute: attr.attribute.id }, "eav")
        .exec();
    if (eveRelationship.unprojected.length > 0) {
        log("  Found Direct Relationship");
        // Build an attribute node
        var attribute = attr.attribute;
        var varName = (coll.name + "|" + attr.name).replace(/ /g, '');
        attribute.variable = varName;
        attribute.refs = [coll];
        attribute.project = true;
        return { type: RelationshipTypes.DIRECT, nodes: [coll, attr], implicitNodes: [] };
    }
    // Finds a one hop relationship
    // e.g. "department salaries" => department -> employee -> salary
    eveRelationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.collection.id }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr.attribute.id }, "eav")
        .exec();
    if (eveRelationship.unprojected.length > 0) {
        log("  Found One-Hop Relationship");
        log(eveRelationship);
        // Find the one-hop link
        var entities = extractFromUnprojected(eveRelationship.unprojected, 1, 3, "link");
        var collections = findCommonCollections(entities);
        var linkID;
        if (collections.length > 0) {
            // @HACK Choose the correct collection in a smart way. 
            // Largest collection other than entity or testdata?
            linkID = collections[0];
        }
        // Fill in the attribute
        var foundCollection = findEveCollection(linkID);
        var linkToken = newToken(foundCollection.displayName);
        var linkCollection = newNode(linkToken);
        findCollection(linkCollection, context);
        var attribute = attr.attribute;
        var varName = (linkCollection.name + "|" + attr.name).replace(/ /g, '');
        attribute.variable = varName;
        attribute.refs = [linkCollection];
        attribute.project = true;
        // Build a link attribute node
        var newName = coll.collection.variable;
        var nToken = newToken(newName);
        var nNode = newNode(nToken);
        var nAttribute = {
            id: coll.collection.displayName,
            refs: [linkCollection],
            node: nNode,
            displayName: newName,
            variable: newName,
            project: false,
        };
        nNode.attribute = nAttribute;
        nNode.properties.push(Properties.ATTRIBUTE);
        nNode.found = true;
        // Project what we need to
        linkCollection.collection.project = true;
        coll.collection.project = true;
        var relationship = { type: RelationshipTypes.ONEHOP, nodes: [coll, attr], implicitNodes: [nNode] };
        nNode.relationships.push(relationship);
        linkCollection.relationships.push(relationship);
        return relationship;
    }
    /*
    // Not sure if this one works... using the entity table, a 2 hop link can
    // be found almost anywhere, yielding results like
    // e.g. "Pets heights" => pets -> snake -> entity -> corey -> height
     relationship = eve.query(``)
      .select("collection entities", { collection: coll.id }, "collection")
      .select("directionless links", { entity: ["collection", "entity"] }, "links")
      .select("directionless links", { entity: ["links", "link"] }, "links2")
     .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
      .exec();
    if (relationship.unprojected.length > 0) {
      return true;
    }*/
    log("  No relationship found");
    return { type: RelationshipTypes.NONE };
}
// Extracts entities from unprojected results
function extractFromUnprojected(coll, ix, size, field) {
    var results = [];
    for (var i = 0, len = coll.length; i < len; i += size) {
        results.push(coll[i + ix][field]);
    }
    return results;
}
// Find collections that entities have in common
function findCommonCollections(entities) {
    var intersection = entityTocollectionsArray(entities[0]);
    intersection.sort();
    for (var _i = 0, _a = entities.slice(1); _i < _a.length; _i++) {
        var entId = _a[_i];
        var cur = entityTocollectionsArray(entId);
        cur.sort();
        arrayIntersect(intersection, cur);
    }
    intersection.sort(function (a, b) {
        return app_1.eve.findOne("collection", { collection: a })["count"] - app_1.eve.findOne("collection", { collection: b })["count"];
    });
    return intersection;
}
function entityTocollectionsArray(entity) {
    var entities = app_1.eve.find("collection entities", { entity: entity });
    return entities.map(function (a) { return a["collection"]; });
}
function findCollection(node, context) {
    var collection;
    collection = findEveCollection(node.name);
    if (collection !== undefined) {
        context.found.push(node);
        collection.node = node;
        node.collection = collection;
        node.representations.collection = collection;
        node.type = NodeTypes.COLLECTION;
        node.found = true;
        node.properties.push(Properties.COLLECTION);
        return true;
    }
    return false;
}
function findEntity(node, context) {
    var entity;
    entity = findEveEntity(node.name);
    if (entity !== undefined) {
        context.found.push(node);
        entity.node = node;
        node.entity = entity;
        node.representations.entity = entity;
        node.type = NodeTypes.ENTITY;
        node.found = true;
        node.properties.push(Properties.ENTITY);
        return true;
    }
    return false;
}
function findAttribute(node, context) {
    if (node.name === "is a") {
        return false;
    }
    var attribute;
    attribute = findEveAttribute(node.name);
    if (attribute !== undefined) {
        context.found.push(node);
        attribute.node = node;
        node.attribute = attribute;
        node.representations.attribute = attribute;
        node.type = NodeTypes.ATTRIBUTE;
        node.found = true;
        node.properties.push(Properties.ATTRIBUTE);
        return true;
    }
    return false;
}
function addFieldsToProject(projectFields, fields) {
    var field;
    for (var _i = 0; _i < fields.length; _i++) {
        field = fields[_i];
        var matchingFields = projectFields.filter(function (f) { return f.name === field.name; });
        if (matchingFields.length === 0) {
            projectFields.push(field);
        }
    }
}
function negateTerm(term) {
    if (term.table === "entity eavs" && term.fields[2] !== undefined && term.fields[2].name === "value") {
        term.fields.splice(2, 1);
    }
    var negate = newQuery([term]);
    negate.type = "negate";
    return negate;
}
function newQuery(terms, subqueries, projects) {
    if (terms === undefined) {
        terms = [];
    }
    if (subqueries === undefined) {
        subqueries = [];
    }
    if (projects === undefined) {
        projects = [];
    }
    // Dedupe terms
    var termStrings = terms.map(termToString);
    var uniqueTerms = termStrings.map(function (value, index, self) {
        return self.indexOf(value) === index;
    });
    terms = terms.filter(function (term, index) { return uniqueTerms[index]; });
    var query = {
        type: "query",
        terms: terms,
        subqueries: subqueries,
        projects: projects,
        toString: queryToString,
    };
    function queryToString(depth) {
        if (query.terms.length === 0 && query.projects.length === 0) {
            return "";
        }
        if (depth === undefined) {
            depth = 0;
        }
        var indent = Array(depth + 1).join("\t");
        var queryString = indent + "(";
        // Map each term/subquery/project to a string
        var typeString = query.type;
        var termString = query.terms.map(function (term) { return termToString(term, depth + 1); }).join("\n");
        var subqueriesString = query.subqueries.map(function (query) { return query.toString(depth + 1); }).join("\n");
        var projectsString = query.projects.map(function (term) { return termToString(term, depth + 1); }).join("\n");
        // Now compose the query string
        queryString += typeString;
        queryString += termString === "" ? "" : "\n" + termString;
        queryString += subqueriesString === "" ? "" : "\n" + subqueriesString;
        queryString += projectsString === "" ? "" : "\n" + projectsString;
        // Close out the query
        queryString += "\n" + indent + ")";
        return queryString;
    }
    function termToString(term, depth) {
        if (depth === undefined) {
            depth = 0;
        }
        var indent = Array(depth + 1).join("\t");
        var termString = indent + "(";
        termString += term.type + " ";
        termString += "" + (term.table === undefined ? "" : "\"" + term.table + "\" ");
        termString += term.fields.map(function (field) { return (":" + field.name + " " + (field.variable ? field.value : "\"" + field.value + "\"")); }).join(" ");
        termString += ")";
        return termString;
    }
    return query;
}
exports.newQuery = newQuery;
function formQuery(node) {
    var query = newQuery();
    var projectFields = [];
    //--------------------------
    // Handle the children nodes
    //--------------------------
    var childQueries = node.children.map(formQuery);
    // Subsume child queries
    var combinedProjectFields = [];
    for (var _i = 0; _i < childQueries.length; _i++) {
        var cQuery = childQueries[_i];
        query.terms = query.terms.concat(cQuery.terms);
        query.subqueries = query.subqueries.concat(cQuery.subqueries);
        // Combine unnamed projects
        for (var _a = 0, _b = cQuery.projects; _a < _b.length; _a++) {
            var project = _b[_a];
            if (project.table === undefined) {
                addFieldsToProject(combinedProjectFields, project.fields);
            }
        }
    }
    if (combinedProjectFields.length > 0) {
        projectFields = combinedProjectFields;
    }
    // Sort terms
    query.terms = query.terms.sort(function (a, b) {
        var aRank = setRank(a.table);
        var bRank = setRank(b.table);
        function setRank(table) {
            if (table === "entity eavs") {
                return 1;
            }
            else if (table === "directionless links") {
                return 2;
            }
            else if (table === "is a attributes") {
                return 3;
            }
            else {
                return 4;
            }
        }
        return aRank - bRank;
    });
    //-------------------------
    // Handle the current node
    //-------------------------
    // Just return at the root
    if (node.hasProperty(Properties.ROOT) || node.hasProperty(Properties.ARGUMENT)) {
        if (projectFields.length > 0) {
            var project = {
                type: "project!",
                fields: projectFields,
            };
            query.projects.push(project);
        }
        return query;
    }
    // Handle functions -------------------------------
    if (node.hasProperty(Properties.FUNCTION) &&
        node.fxn.type === FunctionTypes.NEGATE) {
        log("Building negate term for: " + node.name);
        var negatedTerm = query.terms.pop();
        var negatedQuery = negateTerm(negatedTerm);
        query.subqueries.push(negatedQuery);
        projectFields = [];
    }
    if (node.hasProperty(Properties.FUNCTION) && (node.fxn.type === FunctionTypes.AGGREGATE ||
        node.fxn.type === FunctionTypes.CALCULATE ||
        node.fxn.type === FunctionTypes.FILTER)) {
        // Collection all input and output nodes which were found
        var allArgsFound = node.children.every(function (child) { return child.found; });
        // If we have the right number of arguments, proceed
        var output;
        if (allArgsFound) {
            log("Building function term for: " + node.name);
            var args = node.children.filter(function (child) { return child.hasProperty(Properties.ARGUMENT); }).map(function (arg) { return arg.children[0]; });
            var fields = args.map(function (arg, i) {
                if (arg.parent.hasProperty(Properties.ROOT)) {
                    return undefined;
                }
                return { name: node.fxn.fields[i].name,
                    value: arg.attribute.variable,
                    variable: true };
            }).filter(function (f) { return f !== undefined; });
            var term = {
                type: "select",
                table: node.fxn.name,
                fields: fields,
                node: node,
            };
            query.terms.push(term);
            // project output if necessary
            if (node.fxn.project === true) {
                projectFields = args.filter(function (arg) { return arg.parent.hasProperty(Properties.OUTPUT); })
                    .map(function (arg) {
                    return { name: node.fxn.name,
                        value: arg.attribute.variable,
                        variable: true };
                });
                args.map(function (a) {
                    if (a.hasProperty(Properties.ATTRIBUTE)) {
                        a.attribute.project = false;
                        a.attribute.projectedAs = undefined;
                    }
                    else if (a.hasProperty(Properties.COLLECTION)) {
                        a.collection.project = false;
                        a.collection.projectedAs = undefined;
                    }
                });
                query.projects = []; // Clears all previous projects
            }
        }
    }
    if (node.hasProperty(Properties.FUNCTION) && (node.fxn.type === FunctionTypes.GROUP)) {
        var allArgsFound = node.children.every(function (child) { return child.found; });
        if (allArgsFound) {
            log("Building function term for: " + node.name);
            var groupNode = node.children[1].children[0];
            if (groupNode.hasProperty(Properties.COLLECTION)) {
                groupNode.collection.handled = false;
            }
            else if (groupNode.hasProperty(Properties.ATTRIBUTE)) {
                groupNode.attribute.handled = false;
            }
            var subquery = query;
            var query2 = formQuery(groupNode);
            query = newQuery();
            query.subqueries.push(subquery);
            query.terms = query.terms.concat(query2.terms);
        }
    }
    // Handle attributes -------------------------------
    if (node.hasProperty(Properties.ATTRIBUTE) && !node.attribute.handled) {
        log("Building attribute term for: " + node.name);
        var fields = [];
        var attr = node.attribute;
        if (attr.refs !== undefined) {
            for (var _c = 0, _d = attr.refs; _c < _d.length; _c++) {
                var ref = _d[_c];
                var entityVar = ref.entity !== undefined ? ref.entity.id : ref.collection.variable;
                var fieldVar = ref.entity !== undefined && ref.entity.entityAttr === false ? false : true;
                if (fields.length === 0) {
                    var entityField = {
                        name: "entity",
                        value: entityVar,
                        variable: fieldVar,
                    };
                    fields.push(entityField);
                }
                // Build a query for each ref and merge it with the current query
                var refQuery = formQuery(ref);
                query.terms = query.terms.concat(refQuery.terms);
                if (refQuery.projects.length > 0) {
                    addFieldsToProject(projectFields, refQuery.projects[0].fields);
                }
            }
        }
        var attrField = {
            name: "attribute",
            value: attr.id,
            variable: false
        };
        fields.push(attrField);
        var valueField = {
            name: "value",
            value: attr.variable,
            variable: attr.attributeVar !== undefined ? attr.attributeVar : true,
        };
        fields.push(valueField);
        var term = {
            type: "select",
            table: "entity eavs",
            fields: fields,
            node: node,
        };
        query.terms.push(term);
        // project if necessary
        if (node.attribute.project) {
            var projectAttribute = {
                name: attr.displayName.replace(/ /g, ''),
                value: attr.variable,
                variable: true
            };
            attr.projectedAs = projectAttribute.name;
            addFieldsToProject(projectFields, [projectAttribute]);
        }
        node.attribute.handled = true;
    }
    // Handle collections -------------------------------
    if (node.hasProperty(Properties.COLLECTION) && !node.collection.handled) {
        log("Building collection term for: " + node.name);
        var collection = node.collection;
        var entityField = {
            name: "entity",
            value: collection.variable,
            variable: true
        };
        var collectionField = {
            name: "collection",
            value: collection.id,
            variable: false
        };
        var term = {
            type: "select",
            table: "is a attributes",
            fields: [entityField, collectionField],
            node: node,
        };
        query.terms.push(term);
        // project if necessary
        if (node.collection.project) {
            var projectCollection = {
                name: collection.variable.replace(/ /g, ''),
                value: collection.variable,
                variable: true
            };
            collection.projectedAs = projectCollection.name;
            addFieldsToProject(projectFields, [projectCollection]);
        }
        node.collection.handled = true;
    }
    // Handle entities -------------------------------
    if (node.hasProperty(Properties.ENTITY) && !node.entity.handled) {
        log("Building entity term for: " + node.name);
        var entity = node.entity;
        var fields = [];
        var entityField = {
            name: "entity",
            value: entity.entityVar ? entity.variable : entity.id,
            variable: entity.entityVar,
        };
        fields.push(entityField);
        if (entity.entityVar) {
            var valueField = {
                name: entity.entityVar ? "link" : "value",
                value: entity.valueVar ? entity.value : entity.id,
                variable: entity.valueVar,
            };
            fields.push(valueField);
        }
        var term = {
            type: "select",
            table: entity.entityVar ? "directionless links" : "entity eavs",
            fields: fields,
            node: node,
        };
        query.terms.push(term);
        // project if necessary
        if (entity.project === true) {
            var projectEntity = {
                name: entity.displayName.replace(/ /g, ''),
                value: entity.id,
                variable: false
            };
            entity.projectedAs = projectEntity.name;
            addFieldsToProject(projectFields, [projectEntity]);
        }
        node.entity.handled = true;
    }
    // Project something if necessary       
    if (projectFields.length > 0) {
        var project = {
            type: "project!",
            fields: projectFields,
        };
        query.projects.push(project);
    }
    return query;
}
// ----------------------------------------------------------------------------
// Debug utility functions
// ---------------------------------------------------------------------------- 
var divider = "--------------------------------------------------------------------------------";
exports.debug = false;
function log(x) {
    if (exports.debug) {
        console.log(x);
    }
}
function tokenToString(token, s1, s2, s3, s4, s5) {
    var properties = "(" + token.properties.map(function (property) { return Properties[property]; }).join("|") + ")";
    properties = properties.length === 2 ? "" : properties;
    var tokenSpan = token.start === undefined ? " " : " [" + token.start + "-" + token.end + "] ";
    var spacer1 = Array(s1 - ("" + token.ix).length + 1).join(" ");
    var spacer2 = Array(s2 - ("" + token.originalWord).length + 1).join(" ");
    var spacer3 = Array(s3 - ("" + token.normalizedWord).length + 1).join(" ");
    var spacer4 = Array(s4 - ("" + MajorPartsOfSpeech[getMajorPOS(token.POS)]).length + 1).join(" ");
    var spacer5 = Array(s5 - ("" + MinorPartsOfSpeech[token.POS]).length + 1).join(" ");
    var tokenString = token.ix + ":" + spacer1 + " " + token.originalWord + spacer2 + " | " + token.normalizedWord + spacer3 + " | " + MajorPartsOfSpeech[getMajorPOS(token.POS)] + spacer4 + " | " + MinorPartsOfSpeech[token.POS] + spacer5 + " | " + properties;
    return tokenString;
}
function tokenArrayToString(tokens) {
    var s1 = ("" + tokens[tokens.length - 1].ix).length;
    var s2 = tokens.map(function (token) { return token.originalWord.length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var s3 = tokens.map(function (token) { return token.normalizedWord.length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var s4 = tokens.map(function (token) { return ("" + MajorPartsOfSpeech[getMajorPOS(token.POS)]).length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var s5 = tokens.map(function (token) { return ("" + MinorPartsOfSpeech[token.POS]).length; }).reduce(function (a, b) {
        if (b > a) {
            return b;
        }
        else {
            return a;
        }
    });
    var tokenArrayString = tokens.map(function (token) { return tokenToString(token, s1, s2, s3, s4, s5); }).join("\n");
    return divider + "\n" + tokenArrayString + "\n" + divider;
}
exports.tokenArrayToString = tokenArrayToString;
// ----------------------------------------------------------------------------
// Utility functions
// ----------------------------------------------------------------------------
function flattenNestedArray(nestedArray) {
    var flattened = [].concat.apply([], nestedArray);
    return flattened;
}
function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}
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
function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}
function allFound(node) {
    var cFound = node.children.map(allFound).every(function (c) { return c; });
    if (cFound && node.found) {
        return true;
    }
    else {
        return false;
    }
}
window["NLQP"] = exports;
//# sourceMappingURL=NLQueryParser.js.map