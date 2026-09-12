import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    getPropertyEntityKey,
    getPropertyItemDisplayName,
    parsePropertyEntityKey,
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItem,
    type PropertyItemsByBarcode,
} from "./propertyItemStore.ts";
import {
    expandLegacyAnnualStatusEntries,
    parsePropertyStatusEntryKey,
    PROPERTY_STATUS_VALUES,
} from "./propertyStatusStore.ts";
import {remapStoredPropertyLabelQueueEntities} from "./propertyLabelQueue.ts";

type EntityIndexMap = Map<number, number[]>;

export type PropertyItemSplitResult = {
    items: PropertyItemsByBarcode;
    selectedEntityIndex: number;
};

export type PropertySplitEntityInput = {
    name: string;
    /** Present only for an already-saved split entity. */
    existingPart?: number;
};

function createSplitGroupId(): string {
    return `split-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSplitGroupIndexes(bucket: PropertyItem[], entityIndex: number): number[] {
    const groupId = bucket[entityIndex]?.split?.groupId;
    if (!groupId) return [entityIndex];

    return bucket.flatMap((item, index) => item.split?.groupId === groupId ? [index] : []);
}

function remapRelationshipKey(key: string | null | undefined, barcode: string, indexMap: EntityIndexMap): string | null {
    if (!key) return null;
    const parsed = parsePropertyEntityKey(key);
    if (!parsed || parsed.barcode !== barcode) return key;

    const nextIndex = indexMap.get(parsed.entityIndex)?.[0];
    return nextIndex === undefined ? null : getPropertyEntityKey(barcode, nextIndex);
}

function remapRelationships(itemsByBarcode: PropertyItemsByBarcode, barcode: string, indexMap: EntityIndexMap): PropertyItemsByBarcode {
    return Object.fromEntries(Object.entries(itemsByBarcode).map(([itemBarcode, bucket]) => [itemBarcode, bucket.map((item) => {
        const parentEntityKey = remapRelationshipKey(item.parentEntityKey, barcode, indexMap);
        const childEntityKeys = [...new Set((item.childEntityKeys ?? [])
            .map((key) => remapRelationshipKey(key, barcode, indexMap))
            .filter((key): key is string => !!key))];

        return {
            ...item,
            parentEntityKey,
            childEntityKeys,
        };
    })]));
}

function getSingleTargetIndexMap(indexMap: EntityIndexMap): EntityIndexMap {
    return new Map([...indexMap].map(([index, targets]) => [index, targets.slice(0, 1)]));
}

function parseStoredEntries(value: string | null): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

export function remapPropertyStatusEntries(
    entries: string[],
    barcode: string,
    oldEntityCount: number,
    indexMap: EntityIndexMap,
): string[] {
    const expanded = expandLegacyAnnualStatusEntries(entries, (legacyBarcode) => (
        legacyBarcode === barcode ? oldEntityCount : 0
    ));

    return [...new Set(expanded.flatMap((entry) => {
        const parsed = parsePropertyStatusEntryKey(entry);
        if (!parsed || parsed.barcode !== barcode) return [entry];

        return (indexMap.get(parsed.entityIndex) ?? []).map((entityIndex) => (
            `${barcode}::entity:${entityIndex}`
        ));
    }))];
}

async function remapStoredAnnualStatuses(barcode: string, oldEntityCount: number, indexMap: EntityIndexMap): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const statusKeyPattern = new RegExp(`^\\d{3,4}_(${PROPERTY_STATUS_VALUES.join("|")})$`);
    const statusKeys = keys.filter((key) => statusKeyPattern.test(key));

    await Promise.all(statusKeys.map(async (key) => {
        const entries = parseStoredEntries(await AsyncStorage.getItem(key));
        const remapped = remapPropertyStatusEntries(entries, barcode, oldEntityCount, indexMap);
        await AsyncStorage.setItem(key, JSON.stringify(remapped));
    }));
}

function normalizeSplitEntities(entities: PropertySplitEntityInput[]): PropertySplitEntityInput[] {
    if (entities.length < 2 || entities.length > 20) {
        throw new Error("請保留 2 到 20 個實體。");
    }

    return entities.map((entity) => {
        const name = entity.name.trim();
        if (!name) throw new Error("請填寫每個實體的名稱。");
        return {...entity, name};
    });
}

/**
 * Changes the physical entity count for one imported property item. The original
 * imported fields remain on every entity; local fields are kept per entity.
 */
export async function setPropertyItemSplitEntities(
    barcode: string,
    entityIndex: number,
    requestedEntities: PropertySplitEntityInput[],
): Promise<PropertyItemSplitResult> {
    const entities = normalizeSplitEntities(requestedEntities);
    const count = entities.length;
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const bucket = storedItems[barcode];
    const currentItem = bucket?.[entityIndex];
    if (!bucket || !currentItem) throw new Error("找不到要拆分的財產資料。");

    const groupIndexes = getSplitGroupIndexes(bucket, entityIndex);
    const groupItems = groupIndexes
        .map((index) => ({item: bucket[index], index}))
        .sort((a, b) => (a.item.split?.part ?? 1) - (b.item.split?.part ?? 1));
    const groupId = currentItem.split?.groupId ?? createSplitGroupId();
    const isNewSplit = !currentItem.split?.groupId;
    const now = new Date().toISOString();
    const sourceItem = currentItem;
    const existingItemByPart = new Map(groupItems.map(({item}) => [item.split?.part, item]));
    const retainedItems = entities.map((entity, partIndex) => {
        const existingItem = entity.existingPart
            ? existingItemByPart.get(entity.existingPart)
            : isNewSplit && partIndex === 0 ? sourceItem : undefined;
        if (entity.existingPart && !existingItem) throw new Error("找不到要保留的拆分實體。");
        if (!isNewSplit && existingItem && getPropertyItemDisplayName(existingItem) !== entity.name) {
            throw new Error("已儲存的實體名稱無法更改；請先取消拆分後重新設定。");
        }
        if (existingItem) {
            return {
                ...existingItem,
                updatedAt: now,
                split: {groupId, part: partIndex + 1, name: entity.name},
            };
        }
        return {
            ...sourceItem,
            updatedAt: now,
            location: {areaId: null, areaName: null, description: null},
            note: null,
            photos: [],
            parentEntityKey: null,
            childEntityKeys: [],
            split: {groupId, part: partIndex + 1, name: entity.name},
        };
    });

    const firstGroupIndex = Math.min(...groupIndexes);
    const groupIndexSet = new Set(groupIndexes);
    const indexMap: EntityIndexMap = new Map();
    let nextIndex = 0;
    const nextBucket: PropertyItem[] = [];
    for (let oldIndex = 0; oldIndex < bucket.length; oldIndex += 1) {
        if (oldIndex === firstGroupIndex) {
            const selectedPart = groupItems.findIndex(({index}) => index === entityIndex);
            const selectedNewIndex = nextIndex + Math.min(Math.max(selectedPart, 0), retainedItems.length - 1);
            for (const {index} of groupItems) {
                const existingPart = bucket[index].split?.part;
                const nextPartIndex = isNewSplit
                    ? 0
                    : entities.findIndex((entity) => entity.existingPart === existingPart);
                indexMap.set(index, nextPartIndex >= 0 ? [nextIndex + nextPartIndex] : []);
            }
            const addedIndexes = entities.flatMap((entity, partIndex) => entity.existingPart ? [] : [nextIndex + partIndex]);
            if (addedIndexes.length > 0) {
                indexMap.set(entityIndex, [...(indexMap.get(entityIndex) ?? []), ...addedIndexes]);
            }
            nextBucket.push(...retainedItems);
            nextIndex += retainedItems.length;
            // Kept to make the selected entity explicit for callers after reindexing.
            indexMap.set(entityIndex, indexMap.get(entityIndex)?.length ? indexMap.get(entityIndex)! : [selectedNewIndex]);
            continue;
        }
        if (groupIndexSet.has(oldIndex)) continue;

        indexMap.set(oldIndex, [nextIndex]);
        nextBucket.push(bucket[oldIndex]);
        nextIndex += 1;
    }

    const withBucket = {...storedItems, [barcode]: nextBucket};
    const items = remapRelationships(withBucket, barcode, getSingleTargetIndexMap(indexMap));
    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify(items));
    await Promise.all([
        remapStoredAnnualStatuses(barcode, bucket.length, indexMap),
        remapStoredPropertyLabelQueueEntities(barcode, getSingleTargetIndexMap(indexMap)),
    ]);

    return {
        items,
        selectedEntityIndex: indexMap.get(entityIndex)?.[0] ?? firstGroupIndex,
    };
}

/** Consolidates a locally split item and retains the first part's local records. */
export async function cancelPropertyItemSplit(
    barcode: string,
    entityIndex: number,
): Promise<PropertyItemSplitResult> {
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const bucket = storedItems[barcode];
    const currentItem = bucket?.[entityIndex];
    if (!bucket || !currentItem?.split?.groupId) throw new Error("此財產尚未拆分成多個實體。");

    const groupIndexes = getSplitGroupIndexes(bucket, entityIndex);
    const firstGroupIndex = Math.min(...groupIndexes);
    const firstItem = groupIndexes
        .map((index) => bucket[index])
        .sort((a, b) => (a.split?.part ?? 1) - (b.split?.part ?? 1))[0];
    const indexMap: EntityIndexMap = new Map();
    const groupIndexSet = new Set(groupIndexes);
    const nextBucket: PropertyItem[] = [];
    let nextIndex = 0;

    for (let oldIndex = 0; oldIndex < bucket.length; oldIndex += 1) {
        if (oldIndex === firstGroupIndex) {
            groupIndexes.forEach((index) => indexMap.set(index, index === firstGroupIndex ? [nextIndex] : []));
            nextBucket.push({...firstItem, updatedAt: new Date().toISOString(), split: undefined});
            nextIndex += 1;
            continue;
        }
        if (groupIndexSet.has(oldIndex)) continue;
        indexMap.set(oldIndex, [nextIndex]);
        nextBucket.push(bucket[oldIndex]);
        nextIndex += 1;
    }

    const withBucket = {...storedItems, [barcode]: nextBucket};
    const items = remapRelationships(withBucket, barcode, getSingleTargetIndexMap(indexMap));
    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify(items));
    await Promise.all([
        remapStoredAnnualStatuses(barcode, bucket.length, indexMap),
        remapStoredPropertyLabelQueueEntities(barcode, getSingleTargetIndexMap(indexMap)),
    ]);

    return {items, selectedEntityIndex: indexMap.get(entityIndex)?.[0] ?? firstGroupIndex};
}
