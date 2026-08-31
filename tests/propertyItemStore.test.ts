import assert from "node:assert/strict";
import test from "node:test";
import {
    getPropertyItemYears,
    mergePropertyItems,
    parseStoredPropertyItems,
    type PropertyItemsByBarcode,
} from "../handlers/propertyItemStore.ts";

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
