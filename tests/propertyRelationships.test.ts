import assert from "node:assert/strict";
import test from "node:test";
import {
    addPropertyItemChildInMemory,
    isPropertyRelationshipDescendant,
    removePropertyItemChildInMemory,
    setPropertyItemParentInMemory,
} from "../handlers/propertyRelationships.ts";
import {
    getPropertyEntityKey,
    type PropertyItem,
    type PropertyItemsByBarcode,
} from "../handlers/propertyItemStore.ts";

const timestamp = "2026-01-01T00:00:00.000Z";

function makeItem(barcode: string, itemNumber: string, propertyName: string): PropertyItem {
    return {
        itemNumber,
        barcode,
        propertyName,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourceYears: ["115"],
        location: {
            areaId: null,
            areaName: null,
            description: null,
        },
        note: null,
    };
}

function makeItems(): PropertyItemsByBarcode {
    return {
        "1000000-00-00001": [makeItem("1000000-00-00001", "1", "主機")],
        "2000000-00-00002": [makeItem("2000000-00-00002", "2", "螢幕")],
        "3000000-00-00003": [makeItem("3000000-00-00003", "3", "鍵盤")],
    };
}

test("setting a parent also records the child on the parent", () => {
    const items = makeItems();
    const parentKey = getPropertyEntityKey("1000000-00-00001", 0);
    const childKey = getPropertyEntityKey("2000000-00-00002", 0);
    const result = setPropertyItemParentInMemory(items, childKey, parentKey);

    assert.equal(result["2000000-00-00002"][0].parentEntityKey, parentKey);
    assert.deepEqual(result["1000000-00-00001"][0].childEntityKeys, [childKey]);
});

test("changing a parent removes the child from the previous parent", () => {
    const items = makeItems();
    const firstParentKey = getPropertyEntityKey("1000000-00-00001", 0);
    const secondParentKey = getPropertyEntityKey("3000000-00-00003", 0);
    const childKey = getPropertyEntityKey("2000000-00-00002", 0);
    const firstResult = setPropertyItemParentInMemory(items, childKey, firstParentKey);
    const secondResult = setPropertyItemParentInMemory(firstResult, childKey, secondParentKey);

    assert.equal(secondResult["2000000-00-00002"][0].parentEntityKey, secondParentKey);
    assert.deepEqual(secondResult["1000000-00-00001"][0].childEntityKeys, []);
    assert.deepEqual(secondResult["3000000-00-00003"][0].childEntityKeys, [childKey]);
});

test("adding a child updates that child's parent", () => {
    const items = makeItems();
    const parentKey = getPropertyEntityKey("1000000-00-00001", 0);
    const childKey = getPropertyEntityKey("2000000-00-00002", 0);
    const result = addPropertyItemChildInMemory(items, parentKey, childKey);

    assert.deepEqual(result["1000000-00-00001"][0].childEntityKeys, [childKey]);
    assert.equal(result["2000000-00-00002"][0].parentEntityKey, parentKey);
});

test("removing a child clears its parent when it points to that parent", () => {
    const items = makeItems();
    const parentKey = getPropertyEntityKey("1000000-00-00001", 0);
    const childKey = getPropertyEntityKey("2000000-00-00002", 0);
    const withChild = addPropertyItemChildInMemory(items, parentKey, childKey);
    const result = removePropertyItemChildInMemory(withChild, parentKey, childKey);

    assert.deepEqual(result["1000000-00-00001"][0].childEntityKeys, []);
    assert.equal(result["2000000-00-00002"][0].parentEntityKey, null);
});

test("rejects relationship cycles", () => {
    const items = makeItems();
    const parentKey = getPropertyEntityKey("1000000-00-00001", 0);
    const childKey = getPropertyEntityKey("2000000-00-00002", 0);
    const withChild = addPropertyItemChildInMemory(items, parentKey, childKey);

    assert.throws(
        () => setPropertyItemParentInMemory(withChild, parentKey, childKey),
        /循環附屬關係/,
    );
});

test("detects descendants for picker filtering", () => {
    const items = makeItems();
    const parentKey = getPropertyEntityKey("1000000-00-00001", 0);
    const childKey = getPropertyEntityKey("2000000-00-00002", 0);
    const grandchildKey = getPropertyEntityKey("3000000-00-00003", 0);
    const withChild = addPropertyItemChildInMemory(items, parentKey, childKey);
    const withGrandchild = addPropertyItemChildInMemory(withChild, childKey, grandchildKey);

    assert.equal(isPropertyRelationshipDescendant(withGrandchild, parentKey, grandchildKey), true);
    assert.equal(isPropertyRelationshipDescendant(withGrandchild, grandchildKey, parentKey), false);
});
