import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
    getPropertyItemNumberForYear,
    getPropertyItemYears,
    mergePropertyItems,
    parseStoredPropertyItems,
    type PropertyItemsByBarcode,
} from "../handlers/propertyItemStore.ts";
import {parsePropertySpreadsheetBytes} from "../handlers/propertySpreadsheetParser.ts";

const importedAt = "2026-08-14T00:00:00.000Z";

test("merges duplicate barcodes as multiple stored property items", () => {
    const result = mergePropertyItems({}, [
        {
            itemNumber: "3",
            barcode: "7654321-02-20001",
            propertyName: "測試印表機",
        },
        {
            itemNumber: "4",
            barcode: "7654321-02-20001",
            propertyName: "測試印表機附件",
        },
    ], importedAt, "115");

    assert.equal(result.createdCount, 2);
    assert.equal(result.updatedCount, 0);
    assert.deepEqual(result.items["7654321-02-20001"].map((item) => item.itemNumber), ["3", "4"]);
    assert.deepEqual(result.items["7654321-02-20001"].map((item) => item.sourceYears), [["115"], ["115"]]);
});

test("preserves existing field data when duplicate barcode entries are reimported", () => {
    const storedItems: PropertyItemsByBarcode = {
        "7654321-02-20001": [
            {
                itemNumber: "3",
                barcode: "7654321-02-20001",
                propertyName: "測試印表機",
                custodianName: "舊保管人",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceYears: ["114"],
                location: {
                    areaId: "lab-a",
                    areaName: "Lab A",
                    description: "桌上",
                },
                note: "已貼標籤",
            },
            {
                itemNumber: "4",
                barcode: "7654321-02-20001",
                propertyName: "測試印表機附件",
                createdAt: "2026-01-02T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                sourceYears: ["114"],
                location: {
                    areaId: "cabinet-b",
                    areaName: "Cabinet B",
                    description: "抽屜",
                },
                note: null,
            },
        ],
    };

    const result = mergePropertyItems(storedItems, [
        {
            itemNumber: "3",
            barcode: "7654321-02-20001",
            propertyName: "測試印表機",
            custodianName: "新保管人",
        },
        {
            itemNumber: "4",
            barcode: "7654321-02-20001",
            propertyName: "測試印表機附件更新",
        },
    ], importedAt, "115");

    assert.equal(result.createdCount, 0);
    assert.equal(result.updatedCount, 2);
    assert.equal(result.items["7654321-02-20001"][0].note, "已貼標籤");
    assert.equal(result.items["7654321-02-20001"][0].custodianName, "新保管人");
    assert.deepEqual(result.items["7654321-02-20001"][0].location, storedItems["7654321-02-20001"][0].location);
    assert.deepEqual(result.items["7654321-02-20001"][1].location, storedItems["7654321-02-20001"][1].location);
    assert.deepEqual(result.items["7654321-02-20001"].map((item) => item.sourceYears), [["114", "115"], ["114", "115"]]);
    assert.equal(result.items["7654321-02-20001"][1].propertyName, "測試印表機附件更新");
});

test("stores item numbers by source year without overwriting previous years", () => {
    const storedItems: PropertyItemsByBarcode = {
        "7654321-02-20001": [
            {
                itemNumber: "1",
                itemNumbersByYear: {
                    "114": "1",
                },
                barcode: "7654321-02-20001",
                propertyName: "設備 B",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceYears: ["114"],
                location: {
                    areaId: null,
                    areaName: null,
                    description: null,
                },
                note: null,
            },
        ],
    };

    const result = mergePropertyItems(storedItems, [
        {
            itemNumber: "2",
            barcode: "7654321-02-20001",
            propertyName: "設備 B",
        },
    ], importedAt, "115");

    const item = result.items["7654321-02-20001"][0];

    assert.equal(getPropertyItemNumberForYear(item, "114"), "1");
    assert.equal(getPropertyItemNumberForYear(item, "115"), "2");
    assert.equal(getPropertyItemNumberForYear(item, "2026"), "2");
    assert.equal(item.itemNumber, "1");
});

test("does not match a new annual duplicate item by another year's item number", () => {
    const storedItems: PropertyItemsByBarcode = {
        "7654321-02-20001": [
            {
                itemNumber: "1",
                itemNumbersByYear: {
                    "114": "1",
                },
                barcode: "7654321-02-20001",
                propertyName: "設備 B",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceYears: ["114"],
                location: {
                    areaId: "cabinet-b",
                    areaName: "Cabinet B",
                    description: null,
                },
                note: "現場資料",
            },
        ],
    };

    const result = mergePropertyItems(storedItems, [
        {
            itemNumber: "1",
            barcode: "7654321-02-20001",
            propertyName: "設備 A",
        },
        {
            itemNumber: "2",
            barcode: "7654321-02-20001",
            propertyName: "設備 B",
        },
    ], importedAt, "115");

    assert.equal(result.createdCount, 1);
    assert.equal(result.updatedCount, 1);

    const items = result.items["7654321-02-20001"];
    const itemA = items.find((item) => item.propertyName === "設備 A");
    const itemB = items.find((item) => item.propertyName === "設備 B");

    assert.ok(itemA);
    assert.ok(itemB);
    assert.deepEqual(itemA.sourceYears, ["115"]);
    assert.deepEqual(itemB.sourceYears, ["114", "115"]);
    assert.equal(getPropertyItemNumberForYear(itemB, "114"), "1");
    assert.equal(getPropertyItemNumberForYear(itemB, "115"), "2");
    assert.equal(itemB.note, "現場資料");
    assert.equal(itemB.location.areaName, "Cabinet B");
});

test("merges the multi-year example spreadsheet without cross-year duplicate barcode mismatches", () => {
    const parsed = parsePropertySpreadsheetBytes(
        new Uint8Array(readFileSync("ex-data/example-import-multi.xlsx")),
        "example-import-multi.xlsx",
        {singleSheetFallbackYear: "115"},
    );
    let mergedItems: PropertyItemsByBarcode = {};

    for (const sourceYear of parsed.sourceYears) {
        mergedItems = mergePropertyItems(mergedItems, parsed.itemsByYear[sourceYear], importedAt, sourceYear).items;
    }

    const items = mergedItems["3140101-03-33703"];
    const computer = items.find((item) => item.propertyName.includes("個人電腦主機"));
    const gpu = items.find((item) => item.propertyName.includes("RTX2080Ti"));

    assert.ok(computer);
    assert.ok(gpu);
    assert.deepEqual(computer.sourceYears, ["114", "115"]);
    assert.equal(getPropertyItemNumberForYear(computer, "114"), "28");
    assert.equal(getPropertyItemNumberForYear(computer, "115"), "27");
    assert.deepEqual(gpu.sourceYears, ["114"]);
    assert.equal(getPropertyItemNumberForYear(gpu, "114"), "27");
});

test("normalizes the previous single-item storage shape to arrays", () => {
    const storedItems = parseStoredPropertyItems(JSON.stringify({
        "1234567-01-10001": {
            itemNumber: "1",
            barcode: "1234567-01-10001",
            propertyName: "測試筆記型電腦",
            createdAt: importedAt,
            updatedAt: importedAt,
            sourceYears: [],
            location: {
                areaId: null,
                areaName: null,
                description: null,
            },
            note: null,
        },
    }));

    assert.equal(storedItems["1234567-01-10001"].length, 1);
    assert.equal(storedItems["1234567-01-10001"][0].propertyName, "測試筆記型電腦");
});

test("returns available property years from stored items", () => {
    const storedItems: PropertyItemsByBarcode = {
        "1234567-01-10001": [
            {
                itemNumber: "1",
                barcode: "1234567-01-10001",
                propertyName: "測試筆記型電腦",
                createdAt: importedAt,
                updatedAt: importedAt,
                sourceYears: ["114", "115"],
                location: {
                    areaId: null,
                    areaName: null,
                    description: null,
                },
                note: null,
            },
        ],
        "9988776-03-30001": [
            {
                itemNumber: "5",
                barcode: "9988776-03-30001",
                propertyName: "測試交換器",
                createdAt: importedAt,
                updatedAt: importedAt,
                sourceYears: ["113"],
                location: {
                    areaId: null,
                    areaName: null,
                    description: null,
                },
                note: null,
            },
        ],
    };

    assert.deepEqual(getPropertyItemYears(storedItems), ["115", "114", "113"]);
});
