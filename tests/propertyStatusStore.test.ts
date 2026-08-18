import assert from "node:assert/strict";
import test from "node:test";
import {
    expandLegacyAnnualStatusEntries,
    getAnnualPropertyStatusEntryKeysForItems,
    getPropertyStatusEntryKey,
    mergeImportedBarcodesIntoAnnualStatusBarcodes,
    mergeImportedEntriesIntoAnnualStatusEntries,
    moveBarcodeToPropertyStatus,
    movePropertyStatusEntryToStatus,
    parsePropertyStatusEntryKey,
} from "../handlers/propertyStatusStore.ts";

test("moves a barcode into the target annual status and removes it from other statuses", () => {
    const result = moveBarcodeToPropertyStatus({
        unknown: ["A-001", "B-002"],
        checked: ["C-003"],
        pending: ["A-001", "D-004"],
    }, "A-001", "checked");

    assert.deepEqual(result.unknown, ["B-002"]);
    assert.deepEqual(result.checked, ["C-003", "A-001"]);
    assert.deepEqual(result.pending, ["D-004"]);
});

test("does not duplicate a barcode already in the target status", () => {
    const result = moveBarcodeToPropertyStatus({
        unknown: ["B-002"],
        checked: ["A-001", "A-001"],
        pending: [],
    }, "A-001", "checked");

    assert.deepEqual(result.unknown, ["B-002"]);
    assert.deepEqual(result.checked, ["A-001"]);
    assert.deepEqual(result.pending, []);
});

test("merges newly imported barcodes into unknown without touching checked or pending", () => {
    const result = mergeImportedBarcodesIntoAnnualStatusBarcodes({
        unknown: ["A-001"],
        checked: ["B-002"],
        pending: ["C-003"],
    }, ["A-001", "B-002", "C-003", "D-004", "D-004"]);

    assert.deepEqual(result.unknown, ["A-001", "D-004"]);
    assert.deepEqual(result.checked, ["B-002"]);
    assert.deepEqual(result.pending, ["C-003"]);
});

test("builds and parses property status entity keys", () => {
    const entryKey = getPropertyStatusEntryKey("3140101-03-40745", 1);

    assert.equal(entryKey, "3140101-03-40745::entity:1");
    assert.deepEqual(parsePropertyStatusEntryKey(entryKey), {
        barcode: "3140101-03-40745",
        entityIndex: 1,
    });
    assert.equal(parsePropertyStatusEntryKey("3140101-03-40745"), null);
});

test("expands legacy barcode status entries to entity keys", () => {
    assert.deepEqual(
        expandLegacyAnnualStatusEntries(["A-001", "B-002::entity:0"], (barcode) => barcode === "A-001" ? 2 : 0),
        ["A-001::entity:0", "A-001::entity:1", "B-002::entity:0"],
    );
});

test("moves only the selected entity status when a legacy barcode entry exists", () => {
    const result = movePropertyStatusEntryToStatus({
        unknown: ["A-001"],
        checked: [],
        pending: [],
    }, "A-001::entity:0", "checked", {
        legacyBarcode: "A-001",
        legacyEntityCount: 2,
    });

    assert.deepEqual(result.unknown, ["A-001::entity:1"]);
    assert.deepEqual(result.checked, ["A-001::entity:0"]);
    assert.deepEqual(result.pending, []);
});

test("merges newly imported entity entries into unknown without touching checked or pending", () => {
    const result = mergeImportedEntriesIntoAnnualStatusEntries({
        unknown: ["A-001::entity:0"],
        checked: ["A-001::entity:1"],
        pending: [],
    }, ["A-001::entity:0", "A-001::entity:1", "B-002::entity:0"]);

    assert.deepEqual(result.unknown, ["A-001::entity:0", "B-002::entity:0"]);
    assert.deepEqual(result.checked, ["A-001::entity:1"]);
    assert.deepEqual(result.pending, []);
});

test("treats a legacy assigned barcode as all of its entity entries during merge", () => {
    const result = mergeImportedEntriesIntoAnnualStatusEntries({
        unknown: [],
        checked: ["A-001"],
        pending: [],
    }, ["A-001::entity:0", "A-001::entity:1", "B-002::entity:0"]);

    assert.deepEqual(result.unknown, ["B-002::entity:0"]);
    assert.deepEqual(result.checked, ["A-001"]);
    assert.deepEqual(result.pending, []);
});

test("gets annual status entry keys for each entity in the imported year", () => {
    const result = getAnnualPropertyStatusEntryKeysForItems({
        "A-001": [
            {
                itemNumber: "1",
                barcode: "A-001",
                propertyName: "第一個實體",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceYears: ["115"],
                location: {areaId: null, areaName: null, description: null},
                note: null,
            },
            {
                itemNumber: "2",
                barcode: "A-001",
                propertyName: "第二個實體",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceYears: ["115"],
                location: {areaId: null, areaName: null, description: null},
                note: null,
            },
        ],
        "B-002": [
            {
                itemNumber: "3",
                barcode: "B-002",
                propertyName: "不同年度",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                sourceYears: ["116"],
                location: {areaId: null, areaName: null, description: null},
                note: null,
            },
        ],
    }, "115");

    assert.deepEqual(result, ["A-001::entity:0", "A-001::entity:1"]);
});
