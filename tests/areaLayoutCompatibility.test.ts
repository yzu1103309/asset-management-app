import assert from "node:assert/strict";
import test from "node:test";
import type {AreaLayout} from "../handlers/areaLayout.ts";
import {collectBoundAreaReferences, findMissingAreaLayoutBindings} from "../handlers/areaLayoutCompatibility.ts";
import type {PropertyItem, PropertyItemsByBarcode} from "../handlers/propertyItemStore.ts";

function makeLayout(areas: Array<{id: string; name: string}>): AreaLayout {
    return {
        importedAt: "2026-08-16T00:00:00.000Z",
        page: {width: 400, height: 300},
        areas: areas.map((area, index) => ({
            ...area,
            sourceValue: area.name,
            style: "",
            shape: "rectangle",
            dashed: false,
            rounded: false,
            x: index * 100,
            y: 0,
            width: 80,
            height: 60,
        })),
    };
}

function makeItem(
    barcode: string,
    itemNumber: string,
    location: {areaId: string | null; areaName: string | null},
): PropertyItem {
    return {
        barcode,
        itemNumber,
        propertyName: `測試財產 ${itemNumber}`,
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
        sourceYears: ["115"],
        location: {
            ...location,
            description: null,
        },
        note: null,
    };
}

test("collects bound area references from stored property items", () => {
    const itemsByBarcode: PropertyItemsByBarcode = {
        "1111111-01-10001": [
            makeItem("1111111-01-10001", "1", {areaId: "area-a", areaName: "A 區"}),
            makeItem("1111111-01-10001", "2", {areaId: "area-a", areaName: "A 區"}),
        ],
        "2222222-02-20002": [
            makeItem("2222222-02-20002", "3", {areaId: null, areaName: null}),
            makeItem("2222222-02-20002", "4", {areaId: null, areaName: "B 區"}),
        ],
    };

    assert.deepEqual(collectBoundAreaReferences(itemsByBarcode), [
        {areaId: "area-a", areaName: "A 區", itemCount: 2},
        {areaId: null, areaName: "B 區", itemCount: 1},
    ]);
});

test("does not report a missing binding when the new layout matches by id or name", () => {
    const nextLayout = makeLayout([
        {id: "area-a", name: "已改名 A 區"},
        {id: "new-area-b", name: "B 區"},
    ]);
    const itemsByBarcode: PropertyItemsByBarcode = {
        "1111111-01-10001": [
            makeItem("1111111-01-10001", "1", {areaId: "area-a", areaName: "A 區"}),
        ],
        "2222222-02-20002": [
            makeItem("2222222-02-20002", "2", {areaId: "old-area-b", areaName: "B 區"}),
        ],
    };

    assert.deepEqual(findMissingAreaLayoutBindings(nextLayout, itemsByBarcode), []);
});

test("reports bindings that cannot be matched by id or name in the new layout", () => {
    const nextLayout = makeLayout([{id: "area-a", name: "A 區"}]);
    const itemsByBarcode: PropertyItemsByBarcode = {
        "1111111-01-10001": [
            makeItem("1111111-01-10001", "1", {areaId: "missing-area", areaName: "舊 C 區"}),
            makeItem("1111111-01-10001", "2", {areaId: "missing-area", areaName: "舊 C 區"}),
        ],
    };

    assert.deepEqual(findMissingAreaLayoutBindings(nextLayout, itemsByBarcode), [
        {areaId: "missing-area", areaName: "舊 C 區", itemCount: 2},
    ]);
});
