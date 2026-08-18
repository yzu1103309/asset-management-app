import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {Asset} from "expo-asset";
import {File, Paths} from "expo-file-system";
import {buildPropertyLabelPrintHtml, type PropertyLabelPrintItem} from "./propertyLabelPrintHtml.ts";

const A4_WIDTH_POINTS = 595.3;
const A4_HEIGHT_POINTS = 841.9;
const KAIU_FONT_MODULE = require("../assets/fonts/kaiu.ttf");
const TIMES_FONT_MODULE = require("../assets/fonts/times.ttf");
const PROPERTY_LABEL_PDF_FILE_PATTERN = /^財產標籤_(全部|待製作)_\d{8}-\d{6}\.pdf$/;

export type PropertyLabelPdfExportResult = {
    uri: string;
    fileName: string;
    numberOfPages: number;
    cleanupUris: string[];
};

export type PropertyLabelPdfKind = "全部" | "待製作";

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

export function getPropertyLabelPdfFileName(kind: PropertyLabelPdfKind, date = new Date()): string {
    return sanitizeFileName(`財產標籤_${kind}_${formatTimestamp(date)}.pdf`);
}

export async function createPropertyLabelPdf(
    items: PropertyLabelPrintItem[],
    kind: PropertyLabelPdfKind,
): Promise<PropertyLabelPdfExportResult> {
    cleanupStalePropertyLabelPdfs();

    const [kaiuFontDataUri, timesFontDataUri] = await Promise.all([
        getFontDataUri(KAIU_FONT_MODULE, "kaiu"),
        getFontDataUri(TIMES_FONT_MODULE, "times"),
    ]);
    const result = await Print.printToFileAsync({
        html: buildPropertyLabelPrintHtml(items, {kaiuFontDataUri, timesFontDataUri}),
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

    if (namedFile.exists) namedFile.delete();
    generatedFile.copy(namedFile);

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
