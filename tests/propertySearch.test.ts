import assert from "node:assert/strict";
import test from "node:test";
import {searchPropertyItems} from "../handlers/propertySearch.ts";
import type {AnnualPropertyListItem} from "../handlers/propertyList.ts";

const items: AnnualPropertyListItem[] = [
    {
        itemNumber: "1",
        barcode: "1234567-01-10001",
        propertyName: "測試筆記型電腦",
        status: "unknown",
        entityIndex: 0,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        sourceYears: ["115"],
        location: {
            areaId: null,
            areaName: null,
            description: null,
        },
        note: null,
    },
    {
        itemNumber: "2",
        barcode: "9988776-03-30001",
        propertyName: "測試交換器",
        status: "unknown",
        entityIndex: 0,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        sourceYears: ["115"],
        location: {
            areaId: null,
            areaName: null,
            description: null,
        },
        note: null,
    },
];

test("searches property items by barcode", () => {
    assert.deepEqual(searchPropertyItems("9988776-03-30001", items).map((item) => item.barcode), ["9988776-03-30001"]);
});

test("searches property items by exact barcode without separators", () => {
    assert.deepEqual(searchPropertyItems("99887760330001", items).map((item) => item.barcode), ["9988776-03-30001"]);
});

test("searches property items by barcode prefix without fuzzy matching", () => {
    assert.deepEqual(searchPropertyItems("9988776-03", items).map((item) => item.barcode), ["9988776-03-30001"]);
    assert.deepEqual(searchPropertyItems("998877603", items).map((item) => item.barcode), ["9988776-03-30001"]);
    assert.deepEqual(searchPropertyItems("9988776-04", items), []);
});

test("searches property items by exact barcode fragment without separators", () => {
    assert.deepEqual(searchPropertyItems("30001", items).map((item) => item.barcode), ["9988776-03-30001"]);
    assert.deepEqual(searchPropertyItems("760330", items).map((item) => item.barcode), ["9988776-03-30001"]);
    assert.deepEqual(searchPropertyItems("30002", items), []);
});

test("searches property items by property name", () => {
    assert.deepEqual(searchPropertyItems("筆記", items).map((item) => item.barcode), ["1234567-01-10001"]);
});

test("returns original items for blank queries", () => {
    assert.equal(searchPropertyItems(" ", items), items);
});
