var app = require("../src/app");
//import {root} from "../src/queryParser";
var queryParser_1 = require("../src/queryParser");
require("../src/wiki");
app.renderRoots["wiki"] = root;
var tests = [
    {
        query: "corey's salary",
        expected: [
            { type: queryParser_1.StepType.FIND, subject: "corey" },
            { type: queryParser_1.StepType.LOOKUP, subject: "salary" }
        ],
    },
];
//---------------------------------------------------------
// Validate queries
//---------------------------------------------------------
// Test the actualStep and expectedStep for equivalence
function validateStep(actualStep, expectedStep) {
    if (actualStep === undefined || actualStep.type !== expectedStep.type || actualStep.subject !== expectedStep.subject || actualStep.deselected !== expectedStep.deselected) {
        return false;
    }
    // Compare args
    if (expectedStep.args !== undefined) {
        var ix = 0;
        for (var _i = 0, _a = expectedStep.args; _i < _a.length; _i++) {
            var exArg = _a[_i];
            if (actualStep.argArray === undefined) {
                return false;
            }
            var arg = actualStep.argArray[ix];
            if (arg.found !== exArg.subject) {
                return false;
            }
            if (exArg.parent && (!arg.parent || arg.parent.found !== exArg.parent)) {
                return false;
            }
            ix++;
        }
    }
    // Compare fields
    if ((expectedStep.field !== undefined && actualStep.field !== undefined) &&
        (actualStep.field.parent !== expectedStep.field.parent || actualStep.field.subject !== expectedStep.field.subject)) {
        return false;
    }
    // Compare values
    if ((expectedStep.value !== undefined && actualStep.value !== undefined) &&
        (actualStep.value !== expectedStep.value)) {
        return false;
    }
    return true;
}
// Test the actual plan and expected plan for equivalence.
// Equivelence here means the expected and actual plans have the same
// steps. Order of steps does not matter.
// Doesn't return anything, adds a `valid` member to the plan and each step
// indicating its validitity state
function validatePlan(actualPlan, expectedPlan) {
    var expectedPlanLength = expectedPlan.length;
    // Mark all steps as Unvalidated
    actualPlan.map(function (step) { return step.valid = queryParser_1.Validated.UNVALIDATED; });
    // If no expected plan is provided, we cannot validate any steps
    if (expectedPlan.length === 0) {
        actualPlan.valid = queryParser_1.Validated.UNVALIDATED;
        return;
    }
    // Loop through the steps of the actual plan and test it against candidate steps.
    // When a match is found, remove it from the canditate steps. Continue until all
    // actual steps are validated.
    // @HACK: this is not entirely correct. We still need to check that the step is
    // attached to the correct root
    var invalidSteps = actualPlan.length;
    for (var _i = 0; _i < actualPlan.length; _i++) {
        var actualStep = actualPlan[_i];
        for (var ix in expectedPlan) {
            if (validateStep(actualStep, expectedPlan[ix])) {
                actualStep.valid = queryParser_1.Validated.VALID;
                invalidSteps--;
                expectedPlan.splice(ix, 1);
                break;
            }
            actualStep.valid = queryParser_1.Validated.INVALID;
        }
    }
    var consumedPlanSteps = expectedPlanLength - expectedPlan.length;
    // If every expected step is consumed, and all found steps are valid, the plan is valid
    if (consumedPlanSteps === expectedPlanLength && invalidSteps === 0) {
        actualPlan.valid = queryParser_1.Validated.VALID;
    }
    else {
        actualPlan.valid = queryParser_1.Validated.INVALID;
    }
}
//---------------------------------------------------------
// Debug drawing
//---------------------------------------------------------
function groupTree(root) {
    if (root.type === queryParser_1.TokenTypes.TEXT)
        return;
    var kids = root.children.map(groupTree);
    var relationship = "root";
    var unfound = "";
    var distance = "";
    var nodes = "";
    if (root.relationship) {
        relationship = queryParser_1.RelationshipTypes[root.relationship.type];
        unfound = root.relationship.unfound ? " (unfound)" : unfound;
        distance = " (" + root.relationship.distance + ")";
        if (root.relationship.nodes && root.relationship.nodes.length) {
            nodes = " (" + root.relationship.nodes.map(function (nodes) { return nodes[0]; }).join(", ") + ")";
        }
    }
    return { c: "", children: [
            { c: "node " + queryParser_1.TokenTypes[root.type], text: root.found + " (" + relationship + ")" + unfound + distance + nodes },
            { c: "kids", children: kids },
        ] };
}
function validateTestQuery(test) {
    var start = performance.now();
    var _a = queryParser_1.queryToPlan(test.query), tokens = _a.tokens, tree = _a.tree, plan = _a.plan;
    validatePlan(plan, test.expected);
    return { valid: plan.valid, tokens: tokens, tree: tree, plan: plan, expectedPlan: test.expected, searchString: test.query, time: performance.now() - start };
}
function queryTestUI(result) {
    var tokens = result.tokens, tree = result.tree, plan = result.plan, expectedPlan = result.expectedPlan, valid = result.valid, searchString = result.searchString;
    //tokens
    var tokensNode = { c: "tokens", children: [
            { c: "header", text: "Tokens" },
            { c: "kids", children: tokens.map(function (token) {
                    return { c: "node " + queryParser_1.TokenTypes[token.type], text: token.found + " (" + queryParser_1.TokenTypes[token.type] + ")" };
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
                            //console.log(root);
                            return { c: "tokens", children: [
                                    { c: "node " + queryParser_1.TokenTypes[root.type], text: "" + root.found },
                                    { c: "kids", children: root.args.map(function (token) {
                                            //console.log(token);
                                            var parent = token.parent ? token.parent.found + "." : "";
                                            return { c: "node " + queryParser_1.TokenTypes[token.type], text: "" + parent + token.found };
                                        }) }
                                ] };
                        }) },
                    { c: "header2", text: "Groups" },
                    { c: "kids", children: tree.groups.map(function (root) {
                            return { c: "node " + queryParser_1.TokenTypes[root.type], text: "" + root.found };
                        }) },
                ] }
        ] };
    // Format a step for display
    function StepToDisplay(step) {
        if (step.argArray === undefined && step.args !== undefined) {
            step.argArray = step.args;
        }
        var args = "";
        if (step.argArray) {
            args = " (" + step.argArray.map(function (arg) {
                var parent = "";
                if (arg.parent !== undefined && arg.parent.found !== undefined) {
                    parent = arg.parent.found + ".";
                }
                else if (arg.parent !== undefined && arg.parent.found === undefined) {
                    parent = arg.parent + ".";
                }
                return parent + (arg.found !== undefined ? arg.found : arg.subject);
            }).join(", ") + ")";
        }
        var deselected = step.deselected ? "!" : "";
        return { c: "step v" + step.valid, text: queryParser_1.StepType[step.type] + " " + deselected + step.subject + args };
    }
    // Format the plan for display
    var planDisplay = plan.map(StepToDisplay);
    var planNode = { c: "tokens", children: [
            { c: "header", text: "Plan" },
            { c: "kids", children: planDisplay }
        ] };
    // Display extra steps
    var extraStepsNode = {};
    if (expectedPlan.length != 0) {
        var unusedPlanDisplay = expectedPlan.map(StepToDisplay);
        extraStepsNode = { c: "tokens", children: [
                { c: "header", text: "Unused Steps" },
                { c: "kids", children: unusedPlanDisplay }
            ] };
    }
    // The final display for rendering
    return { c: "search v" + valid, click: toggleQueryResult, children: [
            { c: "search-header", text: "" + searchString },
            { c: "search-body", children: [
                    tokensNode,
                    treeNode,
                    planNode,
                    extraStepsNode,
                    { c: "tokens", children: [
                            { c: "header", text: "Performance" },
                            { c: "kids", children: [
                                    { c: "time", text: "Total: " + result.time.toFixed(2) + "ms" },
                                ] }
                        ] }
                ] }
        ] };
}
function toggleQueryResult(evt, elem) {
}
function root() {
    var results = [];
    var resultStats = { unvalidated: 0, succeeded: 0, failed: 0 };
    for (var _i = 0; _i < tests.length; _i++) {
        var test_1 = tests[_i];
        var result = validateTestQuery(test_1);
        results.push(result);
        if (result.valid === queryParser_1.Validated.UNVALIDATED) {
            resultStats.unvalidated++;
        }
        else if (result.valid === queryParser_1.Validated.INVALID) {
            resultStats.failed++;
        }
        else {
            resultStats.succeeded++;
        }
    }
    var resultItems = results.map(queryTestUI);
    var totalParseTime = 0;
    var minParseTime = Infinity;
    var maxParseTime = 0;
    for (var _a = 0; _a < results.length; _a++) {
        var result = results[_a];
        totalParseTime += result.time;
        if (minParseTime > result.time)
            minParseTime = result.time;
        if (maxParseTime < result.time)
            maxParseTime = result.time;
    }
    var averageParseTime = totalParseTime / results.length;
    return { id: "root", c: "test-root", children: [
            { c: "stats row", children: [
                    { c: "failed", text: resultStats.failed },
                    { c: "succeeded", text: resultStats.succeeded },
                    { c: "unvalidated", text: resultStats.unvalidated },
                ] },
            { c: "perf", text: "min: " + minParseTime.toFixed(2) + "ms | max: " + maxParseTime.toFixed(2) + "ms | average: " + averageParseTime.toFixed(2) + "ms" },
            { children: resultItems }
        ] };
}
exports.root = root;
//# sourceMappingURL=queryParserTest.js.map