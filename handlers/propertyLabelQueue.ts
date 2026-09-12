import AsyncStorage from "@react-native-async-storage/async-storage";
import {getPropertyEntityKey, parsePropertyEntityKey} from "./propertyItemStore.ts";

export const PROPERTY_LABEL_QUEUE_STORAGE_KEY = "@ncu-property-checking/property-label-queue:v1";

function normalizeBarcode(barcode: string): string {
    return barcode.trim();
}

function uniqueBarcodes(barcodes: string[]): string[] {
    return [...new Set(barcodes.map(normalizeBarcode).filter(Boolean))];
}

export function parseStoredPropertyLabelQueue(value: string | null): string[] {
    if (value === null) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) throw new Error("not an array");

        return uniqueBarcodes(parsed.filter((item): item is string => typeof item === "string"));
    } catch {
        throw new Error("本機待製作財產標籤清單格式無法讀取。");
    }
}

export function addBarcodeToPropertyLabelQueue(queue: string[], barcode: string): string[] {
    return uniqueBarcodes([...queue, barcode]);
}

export function removeBarcodeFromPropertyLabelQueue(queue: string[], barcode: string): string[] {
    const normalizedBarcode = normalizeBarcode(barcode);

    return uniqueBarcodes(queue).filter((item) => item !== normalizedBarcode);
}

export async function getPropertyLabelQueue(): Promise<string[]> {
    return parseStoredPropertyLabelQueue(await AsyncStorage.getItem(PROPERTY_LABEL_QUEUE_STORAGE_KEY));
}

export async function isBarcodeInPropertyLabelQueue(barcode: string): Promise<boolean> {
    const normalizedBarcode = normalizeBarcode(barcode);
    if (!normalizedBarcode) return false;

    return (await getPropertyLabelQueue()).includes(normalizedBarcode);
}

function expandLegacyBarcodeQueueEntry(queue: string[], barcode: string, entityCount: number): string[] {
    const normalizedBarcode = normalizeBarcode(barcode);
    const normalizedQueue = uniqueBarcodes(queue);
    if (!normalizedQueue.includes(normalizedBarcode)) return normalizedQueue;

    return uniqueBarcodes([
        ...normalizedQueue.filter((entry) => entry !== normalizedBarcode),
        ...Array.from({length: Math.max(entityCount, 0)}, (_, entityIndex) => (
            getPropertyEntityKey(normalizedBarcode, entityIndex)
        )),
    ]);
}

export function getPropertyLabelEntityQueueEntry(barcode: string, entityIndex: number): string {
    return getPropertyEntityKey(normalizeBarcode(barcode), entityIndex);
}

export function isPropertyEntityInLabelQueue(
    queue: string[],
    barcode: string,
    entityIndex: number,
): boolean {
    const normalizedBarcode = normalizeBarcode(barcode);
    const entityEntry = getPropertyLabelEntityQueueEntry(normalizedBarcode, entityIndex);
    const normalizedQueue = uniqueBarcodes(queue);

    // A pre-split, legacy barcode entry intentionally applies to all entities.
    return normalizedQueue.includes(entityEntry) || normalizedQueue.includes(normalizedBarcode);
}

export async function isPropertyEntityInPropertyLabelQueue(
    barcode: string,
    entityIndex: number,
): Promise<boolean> {
    return isPropertyEntityInLabelQueue(await getPropertyLabelQueue(), barcode, entityIndex);
}

export async function addPropertyLabelEntity(
    barcode: string,
    entityIndex: number,
    entityCount: number,
): Promise<string[]> {
    const queue = await getPropertyLabelQueue();
    const expandedQueue = expandLegacyBarcodeQueueEntry(queue, barcode, entityCount);
    const nextQueue = uniqueBarcodes([
        ...expandedQueue,
        getPropertyLabelEntityQueueEntry(barcode, entityIndex),
    ]);
    await AsyncStorage.setItem(PROPERTY_LABEL_QUEUE_STORAGE_KEY, JSON.stringify(nextQueue));

    return nextQueue;
}

export async function removePropertyLabelEntity(
    barcode: string,
    entityIndex: number,
    entityCount: number,
): Promise<string[]> {
    const expandedQueue = expandLegacyBarcodeQueueEntry(await getPropertyLabelQueue(), barcode, entityCount);
    const entityEntry = getPropertyLabelEntityQueueEntry(barcode, entityIndex);
    const nextQueue = expandedQueue.filter((entry) => entry !== entityEntry);
    await AsyncStorage.setItem(PROPERTY_LABEL_QUEUE_STORAGE_KEY, JSON.stringify(nextQueue));

    return nextQueue;
}

/**
 * Keeps queued entity labels aligned with a resized split group. Legacy barcode
 * entries intentionally stay untouched because they represent every entity.
 */
export function remapPropertyLabelQueueEntityEntries(
    queue: string[],
    barcode: string,
    indexMap: ReadonlyMap<number, readonly number[]>,
): string[] {
    return uniqueBarcodes(queue.flatMap((entry) => {
        const parsed = parsePropertyEntityKey(entry);
        if (!parsed || parsed.barcode !== barcode) return [entry];

        // Labels are individually selected, so a newly-created split entity is
        // not implicitly added just because its source entity was queued.
        const nextEntityIndex = indexMap.get(parsed.entityIndex)?.[0];
        return nextEntityIndex === undefined ? [] : [getPropertyEntityKey(barcode, nextEntityIndex)];
    }));
}

export async function remapStoredPropertyLabelQueueEntities(
    barcode: string,
    indexMap: ReadonlyMap<number, readonly number[]>,
): Promise<string[]> {
    const nextQueue = remapPropertyLabelQueueEntityEntries(await getPropertyLabelQueue(), barcode, indexMap);
    await AsyncStorage.setItem(PROPERTY_LABEL_QUEUE_STORAGE_KEY, JSON.stringify(nextQueue));

    return nextQueue;
}

export async function addPropertyLabelBarcode(barcode: string): Promise<string[]> {
    const nextQueue = addBarcodeToPropertyLabelQueue(await getPropertyLabelQueue(), barcode);
    await AsyncStorage.setItem(PROPERTY_LABEL_QUEUE_STORAGE_KEY, JSON.stringify(nextQueue));

    return nextQueue;
}

export async function removePropertyLabelBarcode(barcode: string): Promise<string[]> {
    const nextQueue = removeBarcodeFromPropertyLabelQueue(await getPropertyLabelQueue(), barcode);
    await AsyncStorage.setItem(PROPERTY_LABEL_QUEUE_STORAGE_KEY, JSON.stringify(nextQueue));

    return nextQueue;
}

export async function clearPropertyLabelQueue(): Promise<void> {
    await AsyncStorage.setItem(PROPERTY_LABEL_QUEUE_STORAGE_KEY, JSON.stringify([]));
}
