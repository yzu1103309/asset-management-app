import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    getPropertyItemYears,
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItem,
} from "./propertyItemStore.ts";
import {
    expandLegacyAnnualStatusEntries,
    getStoredAnnualStatusBarcodes,
    parsePropertyStatusEntryKey,
    type PropertyStatus,
} from "./propertyStatusStore.ts";

export type AnnualPropertyListItem = PropertyItem & {
    status: PropertyStatus;
    entityIndex: number;
};

function compareItemNumber(a: string, b: string): number {
    return a.localeCompare(b, undefined, {numeric: true, sensitivity: "base"});
}

export function sortAnnualPropertyListItems(items: AnnualPropertyListItem[]): AnnualPropertyListItem[] {
    return [...items].sort((a, b) => {
        const itemNumberOrder = compareItemNumber(a.itemNumber, b.itemNumber);
        if (itemNumberOrder !== 0) return itemNumberOrder;

        const barcodeOrder = a.barcode.localeCompare(b.barcode, undefined, {numeric: true, sensitivity: "base"});
        if (barcodeOrder !== 0) return barcodeOrder;

        return a.entityIndex - b.entityIndex;
    });
}

export async function getAvailablePropertyYears(): Promise<string[]> {
    const itemsByBarcode = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    return getPropertyItemYears(itemsByBarcode);
}

export async function getAnnualPropertyItems(year: string, status: PropertyStatus): Promise<AnnualPropertyListItem[]> {
    const [storedItemsValue, barcodes] = await Promise.all([
        AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY),
        getStoredAnnualStatusBarcodes(year, status),
    ]);
    const itemsByBarcode = parseStoredPropertyItems(storedItemsValue);

    const statusEntryKeys = expandLegacyAnnualStatusEntries(barcodes, (barcode) => itemsByBarcode[barcode]?.length ?? 0);

    return sortAnnualPropertyListItems(statusEntryKeys.flatMap((entryKey) => {
        const parsedEntry = parsePropertyStatusEntryKey(entryKey);
        if (!parsedEntry) return [];

        const item = itemsByBarcode[parsedEntry.barcode]?.[parsedEntry.entityIndex];
        if (!item) return [];

        return [{
            ...item,
            status,
            entityIndex: parsedEntry.entityIndex,
        }];
    }));
}

export async function getPropertyItemsByBarcode(barcode: string): Promise<PropertyItem[]> {
    const itemsByBarcode = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    return itemsByBarcode[barcode] ?? [];
}
