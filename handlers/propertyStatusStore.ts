import AsyncStorage from "@react-native-async-storage/async-storage";
import type {PropertyItemsByBarcode} from "./propertyItemStore.ts";

export const PROPERTY_STATUS_VALUES = ["unknown", "checked", "pending"] as const;
const PROPERTY_STATUS_ENTITY_KEY_SEPARATOR = "::entity:";

export type PropertyStatus = typeof PROPERTY_STATUS_VALUES[number];

export function getAnnualStatusStorageKey(year: string, status: PropertyStatus): string {
    return `${year}_${status}`;
}

function getUniqueBarcodes(barcodes: string[]): string[] {
    return [...new Set(barcodes)];
}

function getUniqueEntries(entries: string[]): string[] {
    return [...new Set(entries)];
}

export function getPropertyStatusEntryKey(barcode: string, entityIndex: number): string {
    return `${barcode}${PROPERTY_STATUS_ENTITY_KEY_SEPARATOR}${entityIndex}`;
}

export function parsePropertyStatusEntryKey(entry: string): {barcode: string; entityIndex: number} | null {
    const separatorIndex = entry.lastIndexOf(PROPERTY_STATUS_ENTITY_KEY_SEPARATOR);
    if (separatorIndex < 0) return null;

    const barcode = entry.slice(0, separatorIndex);
    const entityIndex = Number(entry.slice(separatorIndex + PROPERTY_STATUS_ENTITY_KEY_SEPARATOR.length));
    if (!barcode || !Number.isInteger(entityIndex) || entityIndex < 0) return null;

    return {barcode, entityIndex};
}

export function getPropertyStatusEntryKeysForBarcode(barcode: string, entityCount: number): string[] {
    return Array.from({length: Math.max(entityCount, 0)}, (_, entityIndex) => getPropertyStatusEntryKey(barcode, entityIndex));
}

export function getAnnualPropertyStatusEntryKeysForItems(itemsByBarcode: PropertyItemsByBarcode, year: string): string[] {
    return Object.entries(itemsByBarcode).flatMap(([barcode, items]) => (
        items.flatMap((item, entityIndex) => (
            item.sourceYears.includes(year) ? [getPropertyStatusEntryKey(barcode, entityIndex)] : []
        ))
    ));
}

export function expandLegacyAnnualStatusEntries(
    entries: string[],
    getEntityCount: (barcode: string) => number,
): string[] {
    return getUniqueEntries(entries.flatMap((entry) => {
        if (parsePropertyStatusEntryKey(entry)) return [entry];

        const entityCount = getEntityCount(entry);
        return entityCount > 0 ? getPropertyStatusEntryKeysForBarcode(entry, entityCount) : [entry];
    }));
}

function parseStoredBarcodeArray(value: string | null): string[] {
    if (value === null) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

export function moveBarcodeToPropertyStatus(
    statusBarcodes: Record<PropertyStatus, string[]>,
    barcode: string,
    nextStatus: PropertyStatus,
): Record<PropertyStatus, string[]> {
    const nextStatusBarcodes: Record<PropertyStatus, string[]> = {
        unknown: [],
        checked: [],
        pending: [],
    };

    for (const status of PROPERTY_STATUS_VALUES) {
        nextStatusBarcodes[status] = getUniqueBarcodes(statusBarcodes[status]).filter((storedBarcode) => storedBarcode !== barcode);
    }

    nextStatusBarcodes[nextStatus] = getUniqueBarcodes([...nextStatusBarcodes[nextStatus], barcode]);

    return nextStatusBarcodes;
}

export function movePropertyStatusEntryToStatus(
    statusEntries: Record<PropertyStatus, string[]>,
    entryKey: string,
    nextStatus: PropertyStatus,
    options: {legacyBarcode?: string; legacyEntityCount?: number} = {},
): Record<PropertyStatus, string[]> {
    const expandedStatusEntries: Record<PropertyStatus, string[]> = {
        unknown: [],
        checked: [],
        pending: [],
    };
    const legacyBarcode = options.legacyBarcode;
    const legacyEntityCount = options.legacyEntityCount ?? 0;

    for (const status of PROPERTY_STATUS_VALUES) {
        expandedStatusEntries[status] = expandLegacyAnnualStatusEntries(statusEntries[status], (barcode) => (
            barcode === legacyBarcode ? legacyEntityCount : 0
        ));
    }

    const nextStatusEntries: Record<PropertyStatus, string[]> = {
        unknown: [],
        checked: [],
        pending: [],
    };

    for (const status of PROPERTY_STATUS_VALUES) {
        nextStatusEntries[status] = getUniqueEntries(expandedStatusEntries[status]).filter((storedEntry) => storedEntry !== entryKey);
    }

    nextStatusEntries[nextStatus] = getUniqueEntries([...nextStatusEntries[nextStatus], entryKey]);

    return nextStatusEntries;
}

export function mergeImportedBarcodesIntoAnnualStatusBarcodes(
    statusBarcodes: Record<PropertyStatus, string[]>,
    importedBarcodes: string[],
): Record<PropertyStatus, string[]> {
    const nextStatusBarcodes: Record<PropertyStatus, string[]> = {
        unknown: getUniqueBarcodes(statusBarcodes.unknown),
        checked: getUniqueBarcodes(statusBarcodes.checked),
        pending: getUniqueBarcodes(statusBarcodes.pending),
    };
    const assignedBarcodes = new Set([
        ...nextStatusBarcodes.unknown,
        ...nextStatusBarcodes.checked,
        ...nextStatusBarcodes.pending,
    ]);
    const newlyImportedBarcodes = getUniqueBarcodes(importedBarcodes)
        .filter((barcode) => !assignedBarcodes.has(barcode));

    nextStatusBarcodes.unknown = getUniqueBarcodes([
        ...nextStatusBarcodes.unknown,
        ...newlyImportedBarcodes,
    ]);

    return nextStatusBarcodes;
}

export async function initializeAnnualPropertyStatuses(year: string, barcodes: string[]): Promise<void> {
    const uniqueBarcodes = getUniqueBarcodes(barcodes);

    await Promise.all([
        AsyncStorage.setItem(getAnnualStatusStorageKey(year, "unknown"), JSON.stringify(uniqueBarcodes)),
        AsyncStorage.setItem(getAnnualStatusStorageKey(year, "checked"), JSON.stringify([])),
        AsyncStorage.setItem(getAnnualStatusStorageKey(year, "pending"), JSON.stringify([])),
    ]);
}

export async function hasAnnualPropertyStatuses(year: string): Promise<boolean> {
    const values = await Promise.all(PROPERTY_STATUS_VALUES.map((status) => {
        return AsyncStorage.getItem(getAnnualStatusStorageKey(year, status));
    }));

    return values.some((value) => value !== null);
}

export async function getStoredAnnualStatusBarcodes(year: string, status: PropertyStatus): Promise<string[]> {
    return parseStoredBarcodeArray(await AsyncStorage.getItem(getAnnualStatusStorageKey(year, status)));
}

export async function mergeImportedBarcodesIntoAnnualPropertyStatuses(year: string, importedBarcodes: string[]): Promise<void> {
    const statusEntries = await Promise.all(PROPERTY_STATUS_VALUES.map(async (status) => {
        return [status, await getStoredAnnualStatusBarcodes(year, status)] as const;
    }));
    const statusBarcodes = Object.fromEntries(statusEntries) as Record<PropertyStatus, string[]>;
    const nextStatusBarcodes = mergeImportedBarcodesIntoAnnualStatusBarcodes(statusBarcodes, importedBarcodes);

    await Promise.all(PROPERTY_STATUS_VALUES.map((status) => {
        return AsyncStorage.setItem(getAnnualStatusStorageKey(year, status), JSON.stringify(nextStatusBarcodes[status]));
    }));
}

export async function initializeAnnualPropertyEntityStatuses(year: string, entryKeys: string[]): Promise<void> {
    const uniqueEntryKeys = getUniqueEntries(entryKeys);

    await Promise.all([
        AsyncStorage.setItem(getAnnualStatusStorageKey(year, "unknown"), JSON.stringify(uniqueEntryKeys)),
        AsyncStorage.setItem(getAnnualStatusStorageKey(year, "checked"), JSON.stringify([])),
        AsyncStorage.setItem(getAnnualStatusStorageKey(year, "pending"), JSON.stringify([])),
    ]);
}

export function mergeImportedEntriesIntoAnnualStatusEntries(
    statusEntries: Record<PropertyStatus, string[]>,
    importedEntries: string[],
): Record<PropertyStatus, string[]> {
    const nextStatusEntries: Record<PropertyStatus, string[]> = {
        unknown: getUniqueEntries(statusEntries.unknown),
        checked: getUniqueEntries(statusEntries.checked),
        pending: getUniqueEntries(statusEntries.pending),
    };
    const assignedEntries = new Set([
        ...nextStatusEntries.unknown,
        ...nextStatusEntries.checked,
        ...nextStatusEntries.pending,
    ]);
    const assignedLegacyBarcodes = new Set(
        [...assignedEntries].filter((entry) => parsePropertyStatusEntryKey(entry) === null),
    );
    const newlyImportedEntries = getUniqueEntries(importedEntries)
        .filter((entry) => {
            if (assignedEntries.has(entry)) return false;

            const parsedEntry = parsePropertyStatusEntryKey(entry);
            return !parsedEntry || !assignedLegacyBarcodes.has(parsedEntry.barcode);
        });

    nextStatusEntries.unknown = getUniqueEntries([
        ...nextStatusEntries.unknown,
        ...newlyImportedEntries,
    ]);

    return nextStatusEntries;
}

export async function mergeImportedEntriesIntoAnnualPropertyStatuses(year: string, importedEntries: string[]): Promise<void> {
    const statusEntries = await Promise.all(PROPERTY_STATUS_VALUES.map(async (status) => {
        return [status, await getStoredAnnualStatusBarcodes(year, status)] as const;
    }));
    const currentStatusEntries = Object.fromEntries(statusEntries) as Record<PropertyStatus, string[]>;
    const nextStatusEntries = mergeImportedEntriesIntoAnnualStatusEntries(currentStatusEntries, importedEntries);

    await Promise.all(PROPERTY_STATUS_VALUES.map((status) => {
        return AsyncStorage.setItem(getAnnualStatusStorageKey(year, status), JSON.stringify(nextStatusEntries[status]));
    }));
}

export async function updateAnnualPropertyStatus(
    year: string,
    barcode: string,
    entityIndex: number,
    nextStatus: PropertyStatus,
    entityCountForBarcode: number,
): Promise<void> {
    const statusEntries = await Promise.all(PROPERTY_STATUS_VALUES.map(async (status) => {
        return [status, await getStoredAnnualStatusBarcodes(year, status)] as const;
    }));
    const statusBarcodes = Object.fromEntries(statusEntries) as Record<PropertyStatus, string[]>;
    const nextStatusBarcodes = movePropertyStatusEntryToStatus(
        statusBarcodes,
        getPropertyStatusEntryKey(barcode, entityIndex),
        nextStatus,
        {legacyBarcode: barcode, legacyEntityCount: entityCountForBarcode},
    );

    await Promise.all(PROPERTY_STATUS_VALUES.map((status) => {
        return AsyncStorage.setItem(getAnnualStatusStorageKey(year, status), JSON.stringify(nextStatusBarcodes[status]));
    }));
}
