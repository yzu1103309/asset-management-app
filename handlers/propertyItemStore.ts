import type {ParsedPropertyItem} from "./propertyHtmlParser.ts";

export const PROPERTY_ITEMS_STORAGE_KEY = "@ncu-property-checking/property-items:v1";

export type PropertyLocation = {
    areaId: string | null;
    areaName: string | null;
    description: string | null;
};

export type PropertyPhoto = {
    id: string;
    uri: string;
    fileName: string;
    mimeType: "image/jpeg";
    width: number;
    height: number;
    size: number;
    createdAt: string;
};

export type PropertyItem = ParsedPropertyItem & {
    createdAt: string;
    updatedAt: string;
    sourceYears: string[];
    location: PropertyLocation;
    note: string | null;
    photos?: PropertyPhoto[];
};

export type PropertyItemsByBarcode = Record<string, PropertyItem[]>;

export type PropertyItemsMergeResult = {
    items: PropertyItemsByBarcode;
    createdCount: number;
    updatedCount: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPropertyItemArray(value: unknown): PropertyItem[] {
    if (Array.isArray(value)) return value as PropertyItem[];
    if (isObject(value)) return [value as PropertyItem];

    return [];
}

export function parseStoredPropertyItems(value: string | null): PropertyItemsByBarcode {
    if (value === null) return {};

    try {
        const parsed: unknown = JSON.parse(value);
        if (!isObject(parsed)) throw new Error("not an object");

        return Object.fromEntries(
            Object.entries(parsed).map(([barcode, itemOrItems]) => [barcode, toPropertyItemArray(itemOrItems)])
        );
    } catch {
        throw new Error("本機財產資料格式無法讀取，為避免覆蓋資料，已中止匯入。");
    }
}

export function getPropertyItemYears(itemsByBarcode: PropertyItemsByBarcode): string[] {
    const years = new Set<string>();

    for (const items of Object.values(itemsByBarcode)) {
        for (const item of items) {
            item.sourceYears.forEach((year) => years.add(year));
        }
    }

    return [...years].sort((a, b) => Number(b) - Number(a));
}

function getUpdatedSourceYears(previousItem: PropertyItem | undefined, sourceYear: string | undefined): string[] {
    const previousSourceYears = previousItem?.sourceYears ?? [];

    return sourceYear && !previousSourceYears.includes(sourceYear)
        ? [...previousSourceYears, sourceYear]
        : previousSourceYears;
}

function findPreviousItemIndex(bucket: PropertyItem[], importedItem: ParsedPropertyItem, occurrenceIndex: number, usedIndexes: Set<number>): number {
    const byItemNumber = bucket.findIndex((item, index) => !usedIndexes.has(index) && item.itemNumber === importedItem.itemNumber);
    if (byItemNumber >= 0) return byItemNumber;

    const byPropertyName = bucket.findIndex((item, index) => !usedIndexes.has(index) && item.propertyName === importedItem.propertyName);
    if (byPropertyName >= 0) return byPropertyName;

    return !usedIndexes.has(occurrenceIndex) && bucket[occurrenceIndex] ? occurrenceIndex : -1;
}

export function mergePropertyItems(
    storedItems: PropertyItemsByBarcode,
    importedItems: ParsedPropertyItem[],
    importedAt: string,
    sourceYear?: string,
): PropertyItemsMergeResult {
    const mergedItems: PropertyItemsByBarcode = {...storedItems};
    const nextBuckets = new Map<string, PropertyItem[]>();
    const usedPreviousIndexes = new Map<string, Set<number>>();
    let createdCount = 0;
    let updatedCount = 0;

    for (const importedItem of importedItems) {
        const previousBucket = storedItems[importedItem.barcode] ?? [];
        const nextBucket = nextBuckets.get(importedItem.barcode) ?? [];
        const usedIndexes = usedPreviousIndexes.get(importedItem.barcode) ?? new Set<number>();
        const previousIndex = findPreviousItemIndex(previousBucket, importedItem, nextBucket.length, usedIndexes);
        const previousItem = previousIndex >= 0 ? previousBucket[previousIndex] : undefined;

        if (previousItem) {
            usedIndexes.add(previousIndex);
            updatedCount += 1;
        } else {
            createdCount += 1;
        }

        nextBucket.push({
            ...previousItem,
            ...importedItem,
            createdAt: previousItem?.createdAt ?? importedAt,
            updatedAt: importedAt,
            sourceYears: getUpdatedSourceYears(previousItem, sourceYear),
            location: previousItem?.location ?? {
                areaId: null,
                areaName: null,
                description: null,
            },
            note: previousItem?.note ?? null,
        });

        nextBuckets.set(importedItem.barcode, nextBucket);
        usedPreviousIndexes.set(importedItem.barcode, usedIndexes);
    }

    for (const [barcode, nextBucket] of nextBuckets) {
        const previousBucket = storedItems[barcode] ?? [];
        const usedIndexes = usedPreviousIndexes.get(barcode) ?? new Set<number>();
        const preservedItems = previousBucket.filter((_, index) => !usedIndexes.has(index));
        mergedItems[barcode] = [...nextBucket, ...preservedItems];
    }

    return {items: mergedItems, createdCount, updatedCount};
}
