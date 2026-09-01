import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {Asset} from "expo-asset";
import {File, Paths} from "expo-file-system";
import {buildPropertyLabelPrintHtmlAsync, type PropertyLabelPrintItem} from "./propertyLabelPrintHtml.ts";

const A4_WIDTH_POINTS = 595.3;
const A4_HEIGHT_POINTS = 841.9;
const KAIU_FONT_MODULE = require("../assets/fonts/kaiu.ttf");
const TIMES_FONT_MODULE = require("../assets/fonts/times.ttf");
const PROPERTY_LABEL_PDF_FILE_PATTERN = /^財產標籤_(全部|待製作)_\d{8}-\d{6}\.pdf$/;
const PROPERTY_LABEL_PROGRESS_MILLISECONDS_PER_PERCENT = 300;

export type PropertyLabelPdfExportResult = {
    uri: string;
    fileName: string;
    numberOfPages: number;
    cleanupUris: string[];
};

export type PropertyLabelPdfKind = "全部" | "待製作";

export type PropertyLabelPdfProgress = {
    message: string;
    progress: number;
    targetProgress?: number;
    millisecondsPerPercent?: number;
    active?: boolean;
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

function waitForProgressUiTick(): Promise<void> {
    return new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => {
                setTimeout(resolve, 0);
            });
            return;
        }

        setTimeout(resolve, 16);
    });
}

export function getPropertyLabelPdfFileName(kind: PropertyLabelPdfKind, date = new Date()): string {
    return sanitizeFileName(`財產標籤_${kind}_${formatTimestamp(date)}.pdf`);
}

export async function createPropertyLabelPdf(
    items: PropertyLabelPrintItem[],
    kind: PropertyLabelPdfKind,
    onProgress?: (progress: PropertyLabelPdfProgress) => void,
): Promise<PropertyLabelPdfExportResult> {
    onProgress?.({message: "清理舊標籤檔", progress: 5});
    cleanupStalePropertyLabelPdfs();

    onProgress?.({
        message: "載入標籤字型",
        progress: 20,
        targetProgress: 50,
        millisecondsPerPercent: PROPERTY_LABEL_PROGRESS_MILLISECONDS_PER_PERCENT,
        active: true,
    });
    await waitForProgressUiTick();
    const [kaiuFontDataUri, timesFontDataUri] = await Promise.all([
        getFontDataUri(KAIU_FONT_MODULE, "kaiu"),
        getFontDataUri(TIMES_FONT_MODULE, "times"),
    ]);
    onProgress?.({
        message: "產生標籤內容",
        progress: 50,
        targetProgress: 75,
        millisecondsPerPercent: PROPERTY_LABEL_PROGRESS_MILLISECONDS_PER_PERCENT,
        active: true,
    });
    await waitForProgressUiTick();
    const html = await buildPropertyLabelPrintHtmlAsync(items, {kaiuFontDataUri, timesFontDataUri});
    onProgress?.({
        message: `產生 ${items.length} 張標籤 PDF`,
        progress: 80,
        targetProgress: 90,
        millisecondsPerPercent: PROPERTY_LABEL_PROGRESS_MILLISECONDS_PER_PERCENT,
        active: true,
    });
    await waitForProgressUiTick();
    const result = await Print.printToFileAsync({
        html,
        width: A4_WIDTH_POINTS,
        height: A4_HEIGHT_POINTS,
        margins: {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
    });
    const generatedFile = new File(result.uri);
    const fileName = getPropertyLabelPdfFileName(kind);
    const namedFile = new File(Paths.cache, fileName);

    onProgress?.({message: "整理輸出檔案", progress: 95});
    if (namedFile.exists) namedFile.delete();
    generatedFile.copy(namedFile);
    onProgress?.({message: "PDF 建立完成", progress: 100});

    return {
        uri: namedFile.uri,
        fileName,
        numberOfPages: result.numberOfPages,
        cleanupUris: [namedFile.uri, generatedFile.uri],
    };
}

async function getFontDataUri(fontModule: number, fontName: string): Promise<string | null> {
    try {
        const asset = Asset.fromModule(fontModule);
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) return null;

        return `data:font/truetype;base64,${await new File(uri).base64()}`;
    } catch (error) {
        console.warn(`載入 ${fontName} 字體失敗，將使用 fallback 字體。`, error);
        return null;
    }
}

export async function sharePropertyLabelPdf(uri: string, dialogTitle: string): Promise<boolean> {
    if (!(await Sharing.isAvailableAsync())) return false;

    await Sharing.shareAsync(uri, {
        dialogTitle,
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
    });

    return true;
}

export function cleanupPropertyLabelPdf(result: PropertyLabelPdfExportResult): void {
    result.cleanupUris.forEach((uri) => {
        try {
            const file = new File(uri);
            if (file.exists) file.delete();
        } catch (error) {
            console.warn("刪除財產標籤 PDF 暫存檔失敗:", uri, error);
        }
    });
}

export function cleanupStalePropertyLabelPdfs(): number {
    let deletedCount = 0;

    try {
        for (const item of Paths.cache.list()) {
            if (!(item instanceof File)) continue;
            if (!PROPERTY_LABEL_PDF_FILE_PATTERN.test(item.name)) continue;

            try {
                item.delete();
                deletedCount += 1;
            } catch (error) {
                console.warn("刪除舊財產標籤 PDF 暫存檔失敗:", item.uri, error);
            }
        }
    } catch (error) {
        console.warn("掃描財產標籤 PDF 暫存檔失敗:", error);
    }

    return deletedCount;
}
