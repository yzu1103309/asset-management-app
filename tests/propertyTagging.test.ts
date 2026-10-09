import assert from "node:assert/strict";
import test from "node:test";
import {
    filterPropertyTagCategories,
    formatPropertyTagsForCard,
    getVisiblePropertyTagCategories,
    getPropertyTagsFromItems,
    mergePropertyTagCategories,
    normalizePropertyTag,
    parsePropertyTagCategories,
    propertyItemHasTag,
} from "../handlers/propertyTagging.ts";
import type {PropertyItem} from "../handlers/propertyItemStore.ts";

test("normalizes and deduplicates property tag categories", () => {
    assert.equal(normalizePropertyTag("  ＩＰ   設備  "), "IP 設備");
    assert.equal(normalizePropertyTag("ABCDEFGHIJKLM"), "ABCDEFGHIJKL");
    assert.equal(normalizePropertyTag("😀😀😀😀😀😀😀😀😀😀😀😀😀"), "😀😀😀😀😀😀😀😀😀😀😀😀");
    assert.deepEqual(
        mergePropertyTagCategories(["網路設備", "IP 末碼 80"], [" ip 末碼 80 ", "借用中"]),
        ["借用中", "網路設備", "IP 末碼 80"],
    );
    assert.equal(propertyItemHasTag(["IP 末碼 80"], "ip 末碼 80"), true);
});

test("formats property tags as a single card summary", () => {
    assert.equal(
        formatPropertyTagsForCard(["GPU Server", "  ＩＰ   末碼 80  "]),
        "#GPU Server #IP 末碼 80",
    );
    assert.equal(formatPropertyTagsForCard(undefined), "");
});

test("parses tag category storage defensively", () => {
    assert.deepEqual(parsePropertyTagCategories(null), []);
    assert.deepEqual(parsePropertyTagCategories("not-json"), []);
    assert.deepEqual(parsePropertyTagCategories(JSON.stringify(["A", 12, "a", "B"])), ["A", "B"]);
});

test("searches existing property tag categories by all query tokens", () => {
    const categories = ["IP 末碼 80", "IP 末碼 81", "待確認位置", "網路設備"];

    assert.deepEqual(filterPropertyTagCategories(categories, "ip 80"), ["IP 末碼 80"]);
    assert.deepEqual(filterPropertyTagCategories(categories, "位置"), ["待確認位置"]);
    assert.deepEqual(filterPropertyTagCategories(categories, ""), categories);
    assert.deepEqual(
        getVisiblePropertyTagCategories(categories, ["網路設備"], "ip 80"),
        ["網路設備", "IP 末碼 80"],
    );
});

test("collects only tag categories still associated with property entities", () => {
    const baseItem = {
        barcode: "3140101-03-40745",
    } as PropertyItem;
    const items = {
        "3140101-03-40745": [
            {...baseItem, tags: ["網路設備", "待確認"]},
            {...baseItem, tags: ["網路設備"]},
        ],
        "3140101-03-99999": [{...baseItem, barcode: "3140101-03-99999"}],
    };

    assert.deepEqual(getPropertyTagsFromItems(items), ["待確認", "網路設備"]);
});
