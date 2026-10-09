import AsyncStorage from "@react-native-async-storage/async-storage";
import {Asset} from "expo-asset";
import {File, Paths} from "expo-file-system";
import {ImageManipulator, SaveFormat} from "expo-image-manipulator";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {Platform} from "react-native";
import {getStoredAreaLayout} from "./areaLayout.ts";
import {
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItemsByBarcode,
    type PropertyPhoto,
} from "./propertyItemStore.ts";
import {
    getStoredAnnualStatusBarcodes,
    PROPERTY_STATUS_VALUES,
    type PropertyStatus,
} from "./propertyStatusStore.ts";
import {itemExistsInPropertyYear} from "./propertyYears.ts";
import {
    buildPropertyReportDetailsPageHtml,
    buildPropertyReportLayoutHtml,
    buildPropertyReportRows,
    getAreaLayoutReportOrientation,
    paginatePropertyReportRows,
    type PropertyReportRow,
} from "./propertyReportHtml.ts";
import {mergePdfBytes} from "./pdfMerge.ts";

const KAIU_FONT_MODULE = require("../assets/fonts/kaiu.ttf");
const TIMES_FONT_MODULE = require("../assets/fonts/times.ttf");
const PROPERTY_REPORT_FILE_PATTERN = /^盤點報告_.+_\d{8}-\d{6}\.pdf$/;
// Keep source photo quality by default. Set to true to resize report images to
// PROPERTY_REPORT_PHOTO_MAX_SIDE and re-encode them before PDF export.
const PROPERTY_REPORT_COMPRESS_PHOTOS = true;
// Custom fonts make every single-page HTML document much larger. Set to true
// only when identical typography across devices is more important than speed.
const PROPERTY_REPORT_EMBED_FONTS = true;
const PROPERTY_REPORT_PHOTO_MAX_SIDE = 520;
const A4_SHORT_EDGE_POINTS = 595.3;
const A4_LONG_EDGE_POINTS = 841.9;
const REPORT_DATA_READY_PROGRESS = 28;
const DETAILS_PROGRESS_START = 36;
const DETAILS_PROGRESS_END = 90;

export type PropertyReportPdfExportResult = {
    uri: string;
    fileName: string;
    numberOfPages: number;
    itemCount: number;
    cleanupUris: string[];
};

export type PropertyReportPdfProgress = {
    message: string;
    progress: number;
    current?: number;
    total?: number;
};

function padNumber(value: number): string {
    return String(value).padStart(2, "0");
}

function formatTimestamp(date = new Date()): string {
    return [
        date.getFullYear(),
        padNumber(date.getMonth() + 1),
        padNumber(date.getDate()),
        "-",
        padNumber(date.getHours()),
        padNumber(date.getMinutes()),
        padNumber(date.getSeconds()),
    ].join("");
}

function sanitizeFileName(value: string): string {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

export function getPropertyReportPdfFileName(year: string, date = new Date()): string {
    return sanitizeFileName(`盤點報告_${year}_${formatTimestamp(date)}.pdf`);
}

async function getAnnualStatusEntries(year: string): Promise<Record<PropertyStatus, string[]>> {
    const entries = await Promise.all(PROPERTY_STATUS_VALUES.map(async (status) => (
        [status, await getStoredAnnualStatusBarcodes(year, status)] as const
    )));

    return Object.fromEntries(entries) as Record<PropertyStatus, string[]>;
}

function getAnnualPhotos(itemsByBarcode: PropertyItemsByBarcode, year: string): PropertyPhoto[] {
    const photos = Object.values(itemsByBarcode).flatMap((items) => (
        items.flatMap((item) => itemExistsInPropertyYear(item.sourceYears, year) ? item.photos ?? [] : [])
    ));

    return [...new Map(photos.map((photo) => [photo.id, photo])).values()];
}

async function readPhotoDataUris(photos: PropertyPhoto[]): Promise<Map<string, string>> {
    const dataUris = new Map<string, string>();
    const batchSize = 6;

    for (let start = 0; start < photos.length; start += batchSize) {
        const batch = photos.slice(start, start + batchSize);
        const results = await Promise.all(batch.map(async (photo) => {
            let temporaryFile: File | null = null;
            try {
                const file = new File(photo.uri);
                if (!file.exists) return null;

                if (!PROPERTY_REPORT_COMPRESS_PHOTOS
                    || Math.max(photo.width, photo.height) <= PROPERTY_REPORT_PHOTO_MAX_SIDE) {
                    return [photo.id, `data:image/jpeg;base64,${await file.base64()}`] as const;
                }

                const context = ImageManipulator.manipulate(photo.uri);
                context.resize(photo.width >= photo.height
                    ? {width: PROPERTY_REPORT_PHOTO_MAX_SIDE}
                    : {height: PROPERTY_REPORT_PHOTO_MAX_SIDE});
                const rendered = await context.renderAsync();
                const thumbnail = await rendered.saveAsync({
                    compress: 0.75,
                    format: SaveFormat.JPEG,
                });
                temporaryFile = new File(thumbnail.uri);
                const base64 = await temporaryFile.base64();

                return [photo.id, `data:image/jpeg;base64,${base64}`] as const;
            } catch (error) {
                console.warn("盤點報告照片讀取失敗:", photo.uri, error);
                return null;
            } finally {
                try {
                    if (temporaryFile?.exists) temporaryFile.delete();
                } catch {
                    // Cache cleanup failure is non-fatal.
                }
            }
        }));

        results.forEach((result) => {
            if (result) dataUris.set(result[0], result[1]);
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return dataUris;
}

async function hydrateReportPagePhotos(
    rows: PropertyReportRow[],
    photosById: ReadonlyMap<string, PropertyPhoto>,
): Promise<void> {
    const pagePhotos = [...new Set(rows.flatMap((row) => row.photos.map((photo) => photo.id)))]
        .flatMap((photoId) => {
            const photo = photosById.get(photoId);
            return photo ? [photo] : [];
        });
    const pagePhotoDataUris = await readPhotoDataUris(pagePhotos);

    rows.forEach((row) => {
        row.photos.forEach((photo) => {
            photo.dataUri = pagePhotoDataUris.get(photo.id) ?? "";
        });
        row.hasUnreadablePhotos = row.photos.some((photo) => !photo.dataUri);
    });
    pagePhotoDataUris.clear();
}

function releaseReportPagePhotos(rows: PropertyReportRow[]): void {
    rows.forEach((row) => {
        row.photos.forEach((photo) => {
            photo.dataUri = "";
        });
    });
}

function waitForProgressUiTick(): Promise<void> {
    return new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => setTimeout(resolve, 0));
            return;
        }

        setTimeout(resolve, 16);
    });
}

async function getFontDataUri(fontModule: number, fontName: string): Promise<string | null> {
    try {
        const asset = Asset.fromModule(fontModule);
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) return null;

        return `data:font/truetype;base64,${await new File(uri).base64()}`;
    } catch (error) {
        console.warn(`載入盤點報告 ${fontName} 字型失敗，將使用系統字型。`, error);
        return null;
    }
}

export async function createPropertyReportPdf(
    year: string,
    onProgress?: (progress: PropertyReportPdfProgress) => void,
): Promise<PropertyReportPdfExportResult> {
    onProgress?.({message: "清理舊盤點報告", progress: 1});
    cleanupStalePropertyReportPdfs();

    onProgress?.({
        message: "讀取財產與區域資料",
        progress: 2,
    });
    await waitForProgressUiTick();
    const [storedItemsValue, statusEntries, layout, kaiuFontDataUri, timesFontDataUri] = await Promise.all([
        AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY),
        getAnnualStatusEntries(year),
        getStoredAreaLayout(),
        PROPERTY_REPORT_EMBED_FONTS ? getFontDataUri(KAIU_FONT_MODULE, "中文") : Promise.resolve(null),
        PROPERTY_REPORT_EMBED_FONTS ? getFontDataUri(TIMES_FONT_MODULE, "英文") : Promise.resolve(null),
    ]);
    const itemsByBarcode = parseStoredPropertyItems(storedItemsValue);
    const annualPhotos = getAnnualPhotos(itemsByBarcode, year);
    onProgress?.({message: "整理盤點資料", progress: REPORT_DATA_READY_PROGRESS});
    // Keep only metadata until its page is rendered. Holding every photo as a
    // base64 string causes memory pressure that makes later pages slower.
    const rows = buildPropertyReportRows(itemsByBarcode, year, statusEntries);
    const annualPhotosById = new Map(annualPhotos.map((photo) => [photo.id, photo]));

    if (rows.length === 0) {
        throw new Error(`${year} 年度沒有可匯出的財產資料。`);
    }

    const htmlOptions = {
        year,
        rows,
        layout,
        generatedAt: new Date(),
        kaiuFontDataUri,
        timesFontDataUri,
        detailsPageMargin: Platform.OS === "ios" ? "0" : "9mm 10mm",
    };
    const layoutOrientation = getAreaLayoutReportOrientation(layout);
    const createdUris: string[] = [];

    try {
        onProgress?.({
            message: "產生區域配置頁",
            progress: 30,
        });
        await waitForProgressUiTick();
        const layoutResult = await Print.printToFileAsync({
            html: buildPropertyReportLayoutHtml(htmlOptions),
            width: layoutOrientation === "portrait" ? A4_SHORT_EDGE_POINTS : A4_LONG_EDGE_POINTS,
            height: layoutOrientation === "portrait" ? A4_LONG_EDGE_POINTS : A4_SHORT_EDGE_POINTS,
            margins: {left: 0, top: 0, right: 0, bottom: 0},
        });
        createdUris.push(layoutResult.uri);

        const layoutFile = new File(layoutResult.uri);
        const detailPageRows = paginatePropertyReportRows(rows).map((pageRows) => [...pageRows]);
        const detailPageFiles: File[] = [];
        let detailPageCount = 0;
        let completedRowCount = 0;
        onProgress?.({
            message: "產生財產明細頁",
            progress: DETAILS_PROGRESS_START,
            current: 0,
            total: detailPageRows.length,
        });

        for (let pageIndex = 0; pageIndex < detailPageRows.length; pageIndex += 1) {
            let pageCreated = false;
            while (!pageCreated) {
                const pageRows = detailPageRows[pageIndex];
                await waitForProgressUiTick();
                await hydrateReportPagePhotos(pageRows, annualPhotosById);
                const detailResult = await Print.printToFileAsync({
                    html: buildPropertyReportDetailsPageHtml(htmlOptions, pageRows, pageIndex === 0),
                    width: A4_LONG_EDGE_POINTS,
                    height: A4_SHORT_EDGE_POINTS,
                    margins: Platform.OS === "ios"
                        ? {left: 28, top: 28, right: 28, bottom: 28}
                        : {left: 0, top: 0, right: 0, bottom: 0},
                });

                if (detailResult.numberOfPages === 1) {
                    createdUris.push(detailResult.uri);
                    detailPageFiles.push(new File(detailResult.uri));
                    detailPageCount += 1;
                    completedRowCount += pageRows.length;
                    releaseReportPagePhotos(pageRows);
                    onProgress?.({
                        message: "產生財產明細頁",
                        progress: DETAILS_PROGRESS_START
                            + (completedRowCount / rows.length) * (DETAILS_PROGRESS_END - DETAILS_PROGRESS_START),
                        current: detailPageCount,
                        total: detailPageRows.length,
                    });
                    pageCreated = true;
                    continue;
                }

                try {
                    const overflowFile = new File(detailResult.uri);
                    if (overflowFile.exists) overflowFile.delete();
                } catch {
                    // The overflowing trial page is a cache file; cleanup failure is non-fatal.
                }
                releaseReportPagePhotos(pageRows);

                if (pageRows.length <= 1) {
                    throw new Error("單一財產項目的內容高度超過一頁，無法建立不跨頁的盤點報告。");
                }

                const movedRow = pageRows.pop();
                if (!movedRow) throw new Error("重新分配盤點報告頁面時發生錯誤。");
                if (detailPageRows[pageIndex + 1]) {
                    detailPageRows[pageIndex + 1].unshift(movedRow);
                } else {
                    detailPageRows.push([movedRow]);
                }
            }
        }

        onProgress?.({
            message: "合併並整理 PDF",
            progress: DETAILS_PROGRESS_END,
        });
        await waitForProgressUiTick();
        const fileName = getPropertyReportPdfFileName(year);
        const namedFile = new File(Paths.cache, fileName);

        if (namedFile.exists) namedFile.delete();
        namedFile.create({overwrite: true});
        createdUris.unshift(namedFile.uri);
        const pageBytes = await Promise.all([layoutFile, ...detailPageFiles].map((file) => file.bytes()));
        namedFile.write(mergePdfBytes(pageBytes));
        onProgress?.({message: "盤點報告建立完成", progress: 100});

        return {
            uri: namedFile.uri,
            fileName,
            numberOfPages: layoutResult.numberOfPages + detailPageCount,
            itemCount: rows.length,
            cleanupUris: createdUris,
        };
    } catch (error) {
        createdUris.forEach((uri) => {
            try {
                const file = new File(uri);
                if (file.exists) file.delete();
            } catch {
                // Preserve the original export error.
            }
        });
        throw error;
    }
}

export async function sharePropertyReportPdf(uri: string): Promise<boolean> {
    if (!(await Sharing.isAvailableAsync())) return false;

    await Sharing.shareAsync(uri, {
        dialogTitle: "匯出盤點報告",
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
    });
    return true;
}

export function cleanupPropertyReportPdf(result: PropertyReportPdfExportResult): void {
    result.cleanupUris.forEach((uri) => {
        try {
            const file = new File(uri);
            if (file.exists) file.delete();
        } catch (error) {
            console.warn("刪除盤點報告 PDF 暫存檔失敗:", uri, error);
        }
    });
}

export function cleanupStalePropertyReportPdfs(): number {
    let deletedCount = 0;

    try {
        for (const item of Paths.cache.list()) {
            if (!(item instanceof File) || !PROPERTY_REPORT_FILE_PATTERN.test(item.name)) continue;

            try {
                item.delete();
                deletedCount += 1;
            } catch (error) {
                console.warn("刪除舊盤點報告 PDF 失敗:", item.uri, error);
            }
        }
    } catch (error) {
        console.warn("掃描盤點報告 PDF 暫存檔失敗:", error);
    }

    return deletedCount;
}
