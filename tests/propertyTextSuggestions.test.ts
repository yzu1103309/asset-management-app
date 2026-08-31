import assert from "node:assert/strict";
import test from "node:test";
import {
    addPropertyTextSuggestion,
    getSuggestedPropertyTextSuggestions,
} from "../handlers/propertyTextSuggestions.ts";

test("adds text suggestions newest first without duplicates", () => {
    assert.deepEqual(
        addPropertyTextSuggestion(["A308 桌上", "B213 櫃內"], "A308 桌上"),
        ["A308 桌上", "B213 櫃內"],
    );
    assert.deepEqual(
        addPropertyTextSuggestion(["A308 桌上"], "  B213   櫃內  "),
        ["B213   櫃內", "A308 桌上"],
    );
});

test("suggests direct and fuzzy text suggestions from current input", () => {
    const suggestions = [
        "E6-A308 桌上",
        "E6-B213 螢幕旁",
        "網路交換器旁",
        "無線控制平台旁",
    ];

    assert.deepEqual(getSuggestedPropertyTextSuggestions("A308", suggestions), ["E6-A308 桌上"]);
    assert.deepEqual(getSuggestedPropertyTextSuggestions("交換", suggestions), ["網路交換器旁"]);
    assert.equal(getSuggestedPropertyTextSuggestions("無線平台", suggestions)[0], "無線控制平台旁");
});
