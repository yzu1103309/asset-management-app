import AsyncStorage from "@react-native-async-storage/async-storage";

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
