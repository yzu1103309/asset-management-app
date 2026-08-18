import assert from "node:assert/strict";
import test from "node:test";
import {sortAnnualPropertyListItems, type AnnualPropertyListItem} from "../handlers/propertyList.ts";

function makeItem(itemNumber: string, barcode: string, entityIndex = 0): AnnualPropertyListItem {
    return {
        itemNumber,
        barcode,
        entityIndex,
        status: "unknown",
        propertyName: `測試項目 ${itemNumber}`,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sourceYears: ["115"],
        location: {
            areaId: null,
            areaName: null,
            description: null,
        },
        note: null,
    };
}

test("sorts annual property list items by numeric item number", () => {
    const result = sortAnnualPropertyListItems([
        makeItem("10", "B-010"),
        makeItem("2", "B-002"),
        makeItem("1", "B-001"),
    ]);

    assert.deepEqual(result.map((item) => item.itemNumber), ["1", "2", "10"]);
});

test("sorts equal item numbers by barcode and entity index", () => {
    const result = sortAnnualPropertyListItems([
        makeItem("2", "B-002", 1),
        makeItem("2", "B-001", 0),
        makeItem("2", "B-002", 0),
    ]);

    assert.deepEqual(result.map((item) => `${item.barcode}:${item.entityIndex}`), ["B-001:0", "B-002:0", "B-002:1"]);
});
