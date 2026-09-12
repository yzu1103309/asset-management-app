import assert from "node:assert/strict";
import test from "node:test";
import {
    addBarcodeToPropertyLabelQueue,
    getPropertyLabelEntityQueueEntry,
    isPropertyEntityInLabelQueue,
    parseStoredPropertyLabelQueue,
    remapPropertyLabelQueueEntityEntries,
    removeBarcodeFromPropertyLabelQueue,
} from "../handlers/propertyLabelQueue.ts";

test("parses and normalizes the stored property label queue", () => {
    assert.deepEqual(
        parseStoredPropertyLabelQueue(JSON.stringify([
            "3140101-03-40745",
            " 3140101-03-40745 ",
            "",
            "3140101-03-00427",
            123,
        ])),
        ["3140101-03-40745", "3140101-03-00427"],
    );
});

test("tracks queued labels per entity while treating a legacy barcode entry as all entities", () => {
    const firstEntity = getPropertyLabelEntityQueueEntry("3140101-03-40745", 0);
    const secondEntity = getPropertyLabelEntityQueueEntry("3140101-03-40745", 1);

    assert.equal(firstEntity, "3140101-03-40745::entity:0");
    assert.equal(isPropertyEntityInLabelQueue([firstEntity], "3140101-03-40745", 0), true);
    assert.equal(isPropertyEntityInLabelQueue([firstEntity], "3140101-03-40745", 1), false);
    assert.equal(isPropertyEntityInLabelQueue(["3140101-03-40745"], "3140101-03-40745", 1), true);
    assert.notEqual(firstEntity, secondEntity);
});

test("removes deleted queued entities and reindexes the remaining queue entries", () => {
    const indexMap = new Map<number, number[]>([
        [0, [0]],
        [1, []],
        [2, [1]],
    ]);

    assert.deepEqual(
        remapPropertyLabelQueueEntityEntries([
            "A-001::entity:0",
            "A-001::entity:1",
            "A-001::entity:2",
            "B-002::entity:0",
            "A-001",
        ], "A-001", indexMap),
        ["A-001::entity:0", "A-001::entity:1", "B-002::entity:0", "A-001"],
    );
});

test("adds a barcode to the property label queue without duplicates", () => {
    assert.deepEqual(
        addBarcodeToPropertyLabelQueue(["3140101-03-40745"], "3140101-03-40745"),
        ["3140101-03-40745"],
    );
    assert.deepEqual(
        addBarcodeToPropertyLabelQueue(["3140101-03-40745"], "3140101-03-00427"),
        ["3140101-03-40745", "3140101-03-00427"],
    );
});

test("removes a barcode from the property label queue", () => {
    assert.deepEqual(
        removeBarcodeFromPropertyLabelQueue([
            "3140101-03-40745",
            "3140101-03-00427",
        ], "3140101-03-40745"),
        ["3140101-03-00427"],
    );
});
