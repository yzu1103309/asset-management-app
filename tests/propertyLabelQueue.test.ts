import assert from "node:assert/strict";
import test from "node:test";
import {
    addBarcodeToPropertyLabelQueue,
    parseStoredPropertyLabelQueue,
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
