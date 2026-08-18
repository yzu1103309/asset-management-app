import AsyncStorage from "@react-native-async-storage/async-storage";

export const AREA_LAYOUT_STORAGE_KEY = "@ncu-property-checking/area-layout:v1";
export const DRAWIO_A4_MAX_EDGE = 1169;

export type AreaLayoutAreaShape = "rectangle" | "ellipse";

export type AreaLayoutArea = {
    id: string;
    name: string;
    sourceValue: string;
    style: string;
    shape: AreaLayoutAreaShape;
    dashed: boolean;
    rounded: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type AreaLayout = {
    importedAt: string;
    sourceName?: string;
    page: {
        width: number;
        height: number;
    };
    areas: AreaLayoutArea[];
};

function decodeXmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": "\"",
        "&apos;": "'",
        "&#39;": "'",
        "&nbsp;": " ",
    };

    const withNamedEntities = value.replace(/&(amp|lt|gt|quot|apos|nbsp);|&#39;/gi, (entity) => namedEntities[entity.toLowerCase()] ?? entity);

    return withNamedEntities.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, numericEntity: string) => {
        const codePoint = numericEntity[0].toLowerCase() === "x"
            ? Number.parseInt(numericEntity.slice(1), 16)
            : Number.parseInt(numericEntity, 10);

        try {
            return String.fromCodePoint(codePoint);
        } catch {
            return _;
        }
    });
}

function parseAttributes(value: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(value)) !== null) {
        attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "");
    }

    return attributes;
}

function drawioValueToText(value: string | undefined): string {
    return decodeXmlEntities(value ?? "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/(?:div|p|li)>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getNumber(value: string | undefined, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStyleEntries(style: string | undefined): Record<string, string | true> {
    const entries: Record<string, string | true> = {};

    (style ?? "")
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
            const separatorIndex = entry.indexOf("=");
            if (separatorIndex === -1) {
                entries[entry] = true;
                return;
            }

            entries[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1);
        });

    return entries;
}

export function getAreaShapeFromStyle(style: string | undefined): AreaLayoutAreaShape {
    const entries = parseStyleEntries(style);
    const explicitShape = typeof entries.shape === "string" ? entries.shape : undefined;

    return entries.ellipse === true || explicitShape === "ellipse" ? "ellipse" : "rectangle";
}

export function isAreaDashedFromStyle(style: string | undefined): boolean {
    const entries = parseStyleEntries(style);

    return entries.dashed === "1" || entries.dashed === true;
}

export function isAreaRoundedFromStyle(style: string | undefined): boolean {
    const entries = parseStyleEntries(style);

    return entries.rounded === "1";
}

export function parseDrawioAreaLayout(xml: string, sourceName?: string): AreaLayout {
    const graphModelAttributes = parseAttributes(xml.match(/<mxGraphModel\b([^>]*)>/i)?.[1] ?? "");
    const pageWidth = getNumber(graphModelAttributes.pageWidth, 0);
    const pageHeight = getNumber(graphModelAttributes.pageHeight, 0);
    const xmlWithoutSelfClosingCells = xml.replace(/<mxCell\b[^>]*\/>/gi, "");
    const areas: AreaLayoutArea[] = [];
    const cellPattern = /<mxCell\b([^>]*)>([\s\S]*?)<\/mxCell>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellPattern.exec(xmlWithoutSelfClosingCells)) !== null) {
        const cellAttributes = parseAttributes(cellMatch[1]);
        if (cellAttributes.vertex !== "1") continue;

        const geometryAttributes = parseAttributes(cellMatch[2].match(/<mxGeometry\b([^>]*)\/?>/i)?.[1] ?? "");
        const width = getNumber(geometryAttributes.width, 0);
        const height = getNumber(geometryAttributes.height, 0);
        if (width <= 0 || height <= 0) continue;

        const sourceValue = cellAttributes.value ?? "";
        const style = cellAttributes.style ?? "";
        areas.push({
            id: cellAttributes.id,
            name: drawioValueToText(sourceValue),
            sourceValue,
            style,
            shape: getAreaShapeFromStyle(style),
            dashed: isAreaDashedFromStyle(style),
            rounded: isAreaRoundedFromStyle(style),
            x: getNumber(geometryAttributes.x, 0),
            y: getNumber(geometryAttributes.y, 0),
            width,
            height,
        });
    }

    if (areas.length === 0) {
        throw new Error("找不到可匯入的 drawio 區域方塊，請確認圖檔中有可顯示的矩形或文字方塊。");
    }

    const contentWidth = Math.max(...areas.map((area) => area.x + area.width));
    const contentHeight = Math.max(...areas.map((area) => area.y + area.height));
    const normalizedPageWidth = pageWidth || contentWidth;
    const normalizedPageHeight = pageHeight || contentHeight;
    const maxLayoutEdge = Math.max(normalizedPageWidth, normalizedPageHeight, contentWidth, contentHeight);

    if (maxLayoutEdge > DRAWIO_A4_MAX_EDGE) {
        throw new Error(`空間配置圖尺寸超過支援範圍，最大邊不可超過 A4 最大邊 ${DRAWIO_A4_MAX_EDGE}。`);
    }

    return {
        importedAt: new Date().toISOString(),
        sourceName,
        page: {
            width: normalizedPageWidth,
            height: normalizedPageHeight,
        },
        areas,
    };
}

export async function saveAreaLayout(layout: AreaLayout): Promise<void> {
    await AsyncStorage.setItem(AREA_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

export async function getStoredAreaLayout(): Promise<AreaLayout | null> {
    const value = await AsyncStorage.getItem(AREA_LAYOUT_STORAGE_KEY);
    return value ? JSON.parse(value) as AreaLayout : null;
}
