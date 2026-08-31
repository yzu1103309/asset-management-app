import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    parsePropertyHtml,
    parsePropertyHtmlBytes,
    type PropertyHtmlParseResult,
} from "./propertyHtmlParser.ts";
import {
    parsePropertySpreadsheetBytes,
    type PropertySpreadsheetParseOptions,
    type PropertySpreadsheetParseResult,
} from "./propertySpreadsheetParser.ts";
import {
    getPropertyItemYears,
    mergePropertyItems,
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItemsByBarcode,
} from "./propertyItemStore.ts";
import {
    getAnnualPropertyStatusEntryKeysForItems,
    hasAnnualPropertyStatuses,
    initializeAnnualPropertyEntityStatuses,
    mergeImportedEntriesIntoAnnualPropertyStatuses,
} from "./propertyStatusStore.ts";

export {
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItem,
    type PropertyItemsByBarcode,
    type PropertyLocation,
} from "./propertyItemStore.ts";

export type PropertyImportResult = PropertyHtmlParseResult & {
    createdCount: number;
    updatedCount: number;
    sourceYear: string;
    sourceYears: string[];
};

export type PropertyFileImportOptions = {
    spreadsheet?: PropertySpreadsheetParseOptions;
};

function getYearFromFileName(sourceName?: string): string | undefined {
    return sourceName?.match(/(?:^|\D)(\d{3})(?:\D|$)/)?.[1];
}

function getOldestYear(years: string[]): string | null {
    return [...years].sort((a, b) => Number(a) - Number(b))[0] ?? null;
}

export function assertSupportedImportYear(existingYears: string[], sourceYear: string) {
    const oldestYear = getOldestYear(existingYears);
    if (!oldestYear) return;

    if (Number(sourceYear) < Number(oldestYear)) {
        throw new Error(`不支援匯入比初始年度 ${oldestYear} 更舊的財產資料。`);
    }
}

export async function getStoredPropertyItems(): Promise<PropertyItemsByBarcode> {
    return parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
}

/**
 * Parses and merges a 財產系統 HTML export. Existing location and note fields are
 * intentionally retained so later annual imports do not overwrite field work.
 */
export async function importPropertyHtml(html: string, sourceName?: string): Promise<PropertyImportResult> {
    return saveParsedPropertyItems(parsePropertyHtml(html), sourceName);
}

export async function importPropertyHtmlBytes(bytes: Uint8Array, sourceName?: string): Promise<PropertyImportResult> {
    return saveParsedPropertyItems(parsePropertyHtmlBytes(bytes), sourceName);
}

export async function importPropertyFileBytes(bytes: Uint8Array, sourceName?: string, options: PropertyFileImportOptions = {}): Promise<PropertyImportResult> {
    const lowerName = sourceName?.toLowerCase() ?? "";
    const isSpreadsheetFile = /\.(xlsx|xls|xsl)$/i.test(lowerName);
    const isZipBasedSpreadsheet = bytes[0] === 0x50 && bytes[1] === 0x4b;

    return isSpreadsheetFile || isZipBasedSpreadsheet
        ? saveParsedPropertySpreadsheet(parsePropertySpreadsheetBytes(bytes, sourceName, options.spreadsheet))
        : importPropertyHtmlBytes(bytes, sourceName);
}

async function saveParsedPropertyItems(parsed: PropertyHtmlParseResult, sourceName?: string): Promise<PropertyImportResult> {
    const storedItems = await getStoredPropertyItems();
    const importedAt = new Date().toISOString();
    const sourceYear = parsed.sourceYear ?? getYearFromFileName(sourceName);
    if (!sourceYear) {
        throw new Error("找不到盤點年度，請確認檔案標題或檔名包含三位數民國年度。");
    }
    const existingYears = getPropertyItemYears(storedItems);
    assertSupportedImportYear(existingYears, sourceYear);

    const merged = mergePropertyItems(storedItems, parsed.items, importedAt, sourceYear);
    const importedEntryKeys = getAnnualPropertyStatusEntryKeysForItems(merged.items, sourceYear);

    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify(merged.items));
    if (await hasAnnualPropertyStatuses(sourceYear)) {
        await mergeImportedEntriesIntoAnnualPropertyStatuses(sourceYear, importedEntryKeys);
    } else {
        await initializeAnnualPropertyEntityStatuses(sourceYear, importedEntryKeys);
    }

    return {...parsed, sourceYear, sourceYears: [sourceYear], createdCount: merged.createdCount, updatedCount: merged.updatedCount};
}

async function saveParsedPropertySpreadsheet(parsed: PropertySpreadsheetParseResult): Promise<PropertyImportResult> {
    const storedItems = await getStoredPropertyItems();
    const importedAt = new Date().toISOString();
    const sourceYears = parsed.sourceYears;
    const existingYears = getPropertyItemYears(storedItems);

    for (const sourceYear of sourceYears) {
        assertSupportedImportYear(existingYears, sourceYear);
    }

    let mergedItems = storedItems;
    let createdCount = 0;
    let updatedCount = 0;

    for (const sourceYear of sourceYears) {
        const merged = mergePropertyItems(mergedItems, parsed.itemsByYear[sourceYear], importedAt, sourceYear);
        mergedItems = merged.items;
        createdCount += merged.createdCount;
        updatedCount += merged.updatedCount;
    }

    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify(mergedItems));
    await Promise.all(sourceYears.map(async (sourceYear) => {
        const importedEntryKeys = getAnnualPropertyStatusEntryKeysForItems(mergedItems, sourceYear);
        if (await hasAnnualPropertyStatuses(sourceYear)) {
            await mergeImportedEntriesIntoAnnualPropertyStatuses(sourceYear, importedEntryKeys);
        } else {
            await initializeAnnualPropertyEntityStatuses(sourceYear, importedEntryKeys);
        }
    }));

    return {
        items: sourceYears.flatMap((sourceYear) => parsed.itemsByYear[sourceYear]),
        skippedRowCount: parsed.skippedRowCount,
        duplicateBarcodeCount: parsed.duplicateBarcodeCount,
        sourceYear: sourceYears.join(", "),
        sourceYears,
        createdCount,
        updatedCount,
    };
}
