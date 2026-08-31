import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sharing from "expo-sharing";
import {File, Paths} from "expo-file-system";
import {
    getPropertyItemYears,
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
} from "./propertyItemStore.ts";
import {
    getAnnualStatusStorageKey,
    PROPERTY_STATUS_VALUES,
    type PropertyStatus,
} from "./propertyStatusStore.ts";
import {
    buildPropertyExcelXlsx,
    buildPropertyExcelRows,
    getPropertyExcelFileName,
    type AnnualStatusEntriesByYear,
} from "./propertyExcelExportCore.ts";

const PROPERTY_EXCEL_FILE_PATTERN = /^財產清點資料_\d{8}-\d{6}\.xlsx?$/;

export type PropertyExcelExportResult = {
    uri: string;
    fileName: string;
    rowCount: number;
    cleanupUris: string[];
};

async function getAnnualStatusEntriesByYear(years: string[]): Promise<AnnualStatusEntriesByYear> {
    const entries = await Promise.all(years.map(async (year) => {
        const statusEntries = await Promise.all(PROPERTY_STATUS_VALUES.map(async (status) => {
            const value = await AsyncStorage.getItem(getAnnualStatusStorageKey(year, status));
            let parsed: unknown;

            try {
                parsed = value === null ? [] : JSON.parse(value);
            } catch {
                parsed = [];
            }

            return [status, Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []] as const;
        }));

        return [year, Object.fromEntries(statusEntries) as Record<PropertyStatus, string[]>] as const;
    }));

    return Object.fromEntries(entries);
}

export async function createPropertyExcelFile(): Promise<PropertyExcelExportResult> {
    cleanupStalePropertyExcelFiles();

    const itemsByBarcode = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const years = getPropertyItemYears(itemsByBarcode);
    const annualStatusEntriesByYear = await getAnnualStatusEntriesByYear(years);
    const rows = buildPropertyExcelRows(itemsByBarcode, years, annualStatusEntriesByYear);

    if (rows.length === 0) {
        throw new Error("目前沒有可匯出的財產資料。");
    }

    const fileName = getPropertyExcelFileName();
    const file = new File(Paths.cache, fileName);
    if (file.exists) file.delete();
    file.create({overwrite: true});
    file.write(buildPropertyExcelXlsx(rows, years));

    return {
        uri: file.uri,
        fileName,
        rowCount: rows.length,
        cleanupUris: [file.uri],
    };
}

export async function sharePropertyExcelFile(uri: string): Promise<boolean> {
    if (!(await Sharing.isAvailableAsync())) return false;

    await Sharing.shareAsync(uri, {
        dialogTitle: "匯出 Excel 檔",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        UTI: "org.openxmlformats.spreadsheetml.sheet",
    });

    return true;
}

export function cleanupPropertyExcelFile(result: PropertyExcelExportResult): void {
    result.cleanupUris.forEach((uri) => {
        try {
            const file = new File(uri);
            if (file.exists) file.delete();
        } catch (error) {
            console.warn("刪除 Excel 匯出暫存檔失敗:", uri, error);
        }
    });
}

export function cleanupStalePropertyExcelFiles(): number {
    let deletedCount = 0;

    try {
        for (const item of Paths.cache.list()) {
            if (!(item instanceof File)) continue;
            if (!PROPERTY_EXCEL_FILE_PATTERN.test(item.name)) continue;

            try {
                item.delete();
                deletedCount += 1;
            } catch (error) {
                console.warn("刪除舊 Excel 匯出暫存檔失敗:", item.uri, error);
            }
        }
    } catch (error) {
        console.warn("掃描 Excel 匯出暫存檔失敗:", error);
    }

    return deletedCount;
}
