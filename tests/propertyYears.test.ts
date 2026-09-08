import assert from "node:assert/strict";
import test from "node:test";
import {
    itemExistsInPropertyYear,
    propertyYearToWesternNumber,
    isSamePropertyYear,
} from "../handlers/propertyYears.ts";

test("treats western and ROC property years as the same year", () => {
    assert.equal(propertyYearToWesternNumber("115"), 2026);
    assert.equal(propertyYearToWesternNumber("2026"), 2026);
    assert.equal(isSamePropertyYear("115", "2026"), true);
    assert.equal(itemExistsInPropertyYear(["115"], "2026"), true);
    assert.equal(itemExistsInPropertyYear(["2026"], "115"), true);
});

