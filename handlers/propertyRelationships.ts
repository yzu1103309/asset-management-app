import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    getPropertyEntityKey,
    getPropertyItemByEntityKey,
    parsePropertyEntityKey,
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItem,
    type PropertyItemsByBarcode,
} from "./propertyItemStore.ts";
import {itemExistsInPropertyYear} from "./propertyYears.ts";

export type PropertyRelationshipTarget = {
    entityKey: string;
    barcode: string;
    entityIndex: number;
    item: PropertyItem;
};

function uniqueEntityKeys(keys: Array<string | null | undefined>): string[] {
    return [...new Set(keys.filter((key): key is string => typeof key === "string" && parsePropertyEntityKey(key) !== null))];
}

function getItem(itemsByBarcode: PropertyItemsByBarcode, entityKey: string): PropertyItem {
    const item = getPropertyItemByEntityKey(itemsByBarcode, entityKey);
    if (!item) throw new Error("找不到指定的財產實體。");

    return item;
}

function updateItem(
    itemsByBarcode: PropertyItemsByBarcode,
    entityKey: string,
    updater: (item: PropertyItem) => PropertyItem,
): PropertyItemsByBarcode {
    const parsedKey = parsePropertyEntityKey(entityKey);
    if (!parsedKey) throw new Error("財產實體識別碼格式不正確。");

    const bucket = itemsByBarcode[parsedKey.barcode];
    const currentItem = bucket?.[parsedKey.entityIndex];
    if (!bucket || !currentItem) throw new Error("找不到要更新的財產實體。");

    return {
        ...itemsByBarcode,
        [parsedKey.barcode]: bucket.map((item, index) => index === parsedKey.entityIndex ? updater(item) : item),
    };
}

function isDescendantOf(
    itemsByBarcode: PropertyItemsByBarcode,
    ancestorKey: string,
    targetKey: string,
    visited = new Set<string>(),
): boolean {
    if (visited.has(ancestorKey)) return false;
    visited.add(ancestorKey);

    const ancestor = getPropertyItemByEntityKey(itemsByBarcode, ancestorKey);
    if (!ancestor) return false;

    for (const childKey of uniqueEntityKeys(ancestor.childEntityKeys ?? [])) {
        if (childKey === targetKey || isDescendantOf(itemsByBarcode, childKey, targetKey, visited)) return true;
    }

    return false;
}

export function isPropertyRelationshipDescendant(
    itemsByBarcode: PropertyItemsByBarcode,
    ancestorKey: string,
    targetKey: string,
): boolean {
    return isDescendantOf(itemsByBarcode, ancestorKey, targetKey);
}

export function setPropertyItemParentInMemory(
    itemsByBarcode: PropertyItemsByBarcode,
    childKey: string,
    parentKey: string | null,
): PropertyItemsByBarcode {
    const currentChild = getItem(itemsByBarcode, childKey);
    const normalizedParentKey = parentKey && parsePropertyEntityKey(parentKey) ? parentKey : null;
    const previousParentKey = currentChild.parentEntityKey ?? null;
    const now = new Date().toISOString();

    if (normalizedParentKey === childKey) throw new Error("財產實體不能設定自己為上層。");
    if (normalizedParentKey) {
        getItem(itemsByBarcode, normalizedParentKey);
        if (isDescendantOf(itemsByBarcode, childKey, normalizedParentKey)) {
            throw new Error("此設定會形成循環附屬關係。");
        }
    }
    if (previousParentKey === normalizedParentKey) return itemsByBarcode;

    let nextItems = itemsByBarcode;
    if (previousParentKey && getPropertyItemByEntityKey(nextItems, previousParentKey)) {
        nextItems = updateItem(nextItems, previousParentKey, (parentItem) => ({
            ...parentItem,
            childEntityKeys: uniqueEntityKeys(parentItem.childEntityKeys ?? []).filter((key) => key !== childKey),
            updatedAt: now,
        }));
    }

    if (normalizedParentKey) {
        nextItems = updateItem(nextItems, normalizedParentKey, (parentItem) => ({
            ...parentItem,
            childEntityKeys: uniqueEntityKeys([...(parentItem.childEntityKeys ?? []), childKey]),
            updatedAt: now,
        }));
    }

    nextItems = updateItem(nextItems, childKey, (childItem) => ({
        ...childItem,
        parentEntityKey: normalizedParentKey,
        updatedAt: now,
    }));

    return nextItems;
}

async function updateStoredRelationships(
    updater: (itemsByBarcode: PropertyItemsByBarcode) => PropertyItemsByBarcode,
): Promise<PropertyItemsByBarcode> {
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const nextItems = updater(storedItems);

    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify(nextItems));

    return nextItems;
}

export function getRelationshipTargets(
    itemsByBarcode: PropertyItemsByBarcode,
    year?: string | null,
): PropertyRelationshipTarget[] {
    return Object.entries(itemsByBarcode).flatMap(([barcode, items]) => (
        items.flatMap((item, entityIndex) => {
            if (year && !itemExistsInPropertyYear(item.sourceYears, year)) return [];

            return [{
                entityKey: getPropertyEntityKey(barcode, entityIndex),
                barcode,
                entityIndex,
                item,
            }];
        })
    ));
}

export async function getStoredRelationshipTargets(year?: string | null): Promise<PropertyRelationshipTarget[]> {
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));

    return getRelationshipTargets(storedItems, year);
}

export async function getStoredRelationshipItemsByBarcode(): Promise<PropertyItemsByBarcode> {
    return parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
}

export async function setPropertyItemParent(
    barcode: string,
    entityIndex: number,
    parentEntityKey: string | null,
): Promise<PropertyItemsByBarcode> {
    const childKey = getPropertyEntityKey(barcode, entityIndex);

    return updateStoredRelationships((itemsByBarcode) => setPropertyItemParentInMemory(itemsByBarcode, childKey, parentEntityKey));
}

export function addPropertyItemChildInMemory(
    itemsByBarcode: PropertyItemsByBarcode,
    parentKey: string,
    childKey: string,
): PropertyItemsByBarcode {
    return setPropertyItemParentInMemory(itemsByBarcode, childKey, parentKey);
}

export async function addPropertyItemChild(
    barcode: string,
    entityIndex: number,
    childEntityKey: string,
): Promise<PropertyItemsByBarcode> {
    const parentKey = getPropertyEntityKey(barcode, entityIndex);

    return updateStoredRelationships((itemsByBarcode) => addPropertyItemChildInMemory(itemsByBarcode, parentKey, childEntityKey));
}

export function removePropertyItemChildInMemory(
    itemsByBarcode: PropertyItemsByBarcode,
    parentKey: string,
    childKey: string,
): PropertyItemsByBarcode {
    const childItem = getItem(itemsByBarcode, childKey);
    const now = new Date().toISOString();
    let nextItems = updateItem(itemsByBarcode, parentKey, (parentItem) => ({
        ...parentItem,
        childEntityKeys: uniqueEntityKeys(parentItem.childEntityKeys ?? []).filter((key) => key !== childKey),
        updatedAt: now,
    }));

    if (childItem.parentEntityKey === parentKey) {
        nextItems = updateItem(nextItems, childKey, (nextChildItem) => ({
            ...nextChildItem,
            parentEntityKey: null,
            updatedAt: now,
        }));
    }

    return nextItems;
}

export async function removePropertyItemChild(
    barcode: string,
    entityIndex: number,
    childEntityKey: string,
): Promise<PropertyItemsByBarcode> {
    const parentKey = getPropertyEntityKey(barcode, entityIndex);

    return updateStoredRelationships((itemsByBarcode) => removePropertyItemChildInMemory(itemsByBarcode, parentKey, childEntityKey));
}
