import assert from "node:assert/strict";
import test from "node:test";
import {filterPropertyItemsByTags, searchPropertyItems} from "../handlers/propertySearch.ts";
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
        note: "借給王老師使用，IP 末碼 80，備註代碼 24680",
        tags: ["GPU Server", "機房設備"],
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
        note: "IP 80",
        tags: ["網路設備"],
    },
    {
        itemNumber: "3",
        barcode: "3140306-03-544",
        propertyName: "測試顯示卡",
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
        note: "只有 IP 記錄",
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

test("searches property items by zero-padded barcode tail", () => {
    assert.deepEqual(searchPropertyItems("544", items).map((item) => item.barcode), ["3140306-03-544"]);
    assert.deepEqual(searchPropertyItems("00544", items).map((item) => item.barcode), ["3140306-03-544"]);
    assert.deepEqual(searchPropertyItems("3140306-03-00544", items).map((item) => item.barcode), ["3140306-03-544"]);
    assert.deepEqual(searchPropertyItems("3140106-03-00544", items).map((item) => item.barcode), ["3140306-03-544"]);
});

test("searches property items by property name", () => {
    assert.deepEqual(searchPropertyItems("筆記", items).map((item) => item.barcode), ["1234567-01-10001"]);
});

test("searches property items by note", () => {
    assert.deepEqual(searchPropertyItems("王老師", items).map((item) => item.barcode), ["1234567-01-10001"]);
    assert.deepEqual(searchPropertyItems("24680", items).map((item) => item.barcode), ["1234567-01-10001"]);
});

test("searches property items by tags", () => {
    assert.deepEqual(searchPropertyItems("gpu server", items).map((item) => item.barcode), ["1234567-01-10001"]);
    assert.deepEqual(searchPropertyItems("# GPU Server", items).map((item) => item.barcode), ["1234567-01-10001"]);
    assert.deepEqual(searchPropertyItems("網路", items).map((item) => item.barcode), ["9988776-03-30001"]);
});

test("filters property items by every selected tag", () => {
    assert.deepEqual(
        filterPropertyItemsByTags(items, ["GPU Server", "機房設備"]).map((item) => item.barcode),
        ["1234567-01-10001"],
    );
    assert.deepEqual(filterPropertyItemsByTags(items, ["不存在"]), []);
    assert.equal(filterPropertyItemsByTags(items, []), items);
});

test("combines selected tags with a later keyword search", () => {
    const taggedItems = filterPropertyItemsByTags(items, ["GPU Server"]);

    assert.deepEqual(searchPropertyItems("王老師", taggedItems).map((item) => item.barcode), ["1234567-01-10001"]);
    assert.deepEqual(searchPropertyItems("交換器", taggedItems), []);
});

test("ranks notes matching every query token before partial fuzzy matches", () => {
    assert.deepEqual(
        searchPropertyItems("ip 80", items).slice(0, 2).map((item) => item.barcode),
        ["9988776-03-30001", "1234567-01-10001"],
    );
});

test("returns original items for blank queries", () => {
    assert.equal(searchPropertyItems(" ", items), items);
});
