import big5Cp950Table from "./big5Cp950Table.ts";

export type ParsedPropertyItem = {
    itemNumber: string;
    barcode: string;
    propertyName: string;
};

export type PropertyHtmlParseResult = {
    items: ParsedPropertyItem[];
    skippedRowCount: number;
    duplicateBarcodeCount: number;
    sourceYear?: string;
};

export class PropertyHtmlParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PropertyHtmlParseError";
    }
}

type TableCell = {
    text: string;
    colspan: number;
};

type Big5TableChunk = readonly [string, ...(string | number)[]];

const REQUIRED_HEADERS = ["itemNumber", "propertyNumber", "propertyName"] as const;

function decodeHtmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": "\"",
        "&#39;": "'",
        "&nbsp;": " ",
    };

    const withNamedEntities = value.replace(/&(amp|lt|gt|quot|nbsp);|&#39;/gi, (entity) => namedEntities[entity.toLowerCase()] ?? entity);

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

function htmlToText(value: string): string {
    return decodeHtmlEntities(
        value
            .replace(/<!--([\s\S]*?)-->/g, "")
            .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, " ")
            .replace(/<[^>]+>/g, " ")
    ).replace(/\s+/g, " ").trim();
}

function getColspan(attributes: string): number {
    const match = attributes.match(/\bcolspan\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    const colspan = value ? Number.parseInt(value, 10) : 1;

    return Number.isSafeInteger(colspan) && colspan > 0 ? colspan : 1;
}

function parseCells(rowHtml: string): TableCell[] {
    const cells: TableCell[] = [];
    // The 財產系統 export omits </td>, so the next cell or row is the boundary.
    const cellPattern = /<t[hd]\b([^>]*)>([\s\S]*?)(?=<t[hd]\b|<\/tr\s*>|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = cellPattern.exec(rowHtml)) !== null) {
        cells.push({
            text: htmlToText(match[2]),
            colspan: getColspan(match[1]),
        });
    }

    return cells;
}

function parseRows(tableHtml: string): string[][] {
    const rows: string[][] = [];
    // The report also omits </tr>; each following <tr> starts a new row.
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table\s*>|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = rowPattern.exec(tableHtml)) !== null) {
        const row: string[] = [];
        for (const cell of parseCells(match[1])) {
            row.push(cell.text, ...Array.from({length: cell.colspan - 1}, () => ""));
        }
        if (row.length > 0) rows.push(row);
    }

    return rows;
}

let big5CharacterMap: Map<number, string> | undefined;

function getBig5CharacterMap(): Map<number, string> {
    if (big5CharacterMap) return big5CharacterMap;

    const mapping = new Map<number, string>();
    for (const chunk of big5Cp950Table as unknown as readonly Big5TableChunk[]) {
        let code = Number.parseInt(chunk[0], 16);
        let previousCodePoint: number | undefined;

        for (const part of chunk.slice(1)) {
            if (typeof part === "string") {
                for (const character of part) {
                    mapping.set(code, character);
                    previousCodePoint = character.codePointAt(0);
                    code += 1;
                }
                continue;
            }

            if (previousCodePoint === undefined) continue;
            for (let index = 0; index < part; index += 1) {
                previousCodePoint += 1;
                mapping.set(code, String.fromCodePoint(previousCodePoint));
                code += 1;
            }
        }
    }

    big5CharacterMap = mapping;
    return mapping;
}

export function decodeBig5(bytes: Uint8Array): string {
    const mapping = getBig5CharacterMap();
    let decoded = "";

    for (let index = 0; index < bytes.length; index += 1) {
        const lead = bytes[index];
        if (lead <= 0x7f) {
            decoded += String.fromCharCode(lead);
            continue;
        }

        const trail = bytes[index + 1];
        const isValidTrail = trail !== undefined && ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0xa1 && trail <= 0xfe));
        if (!isValidTrail) {
            decoded += "�";
            continue;
        }

        decoded += mapping.get((lead << 8) | trail) ?? "�";
        index += 1;
    }

    return decoded;
}

function getDeclaredCharset(bytes: Uint8Array): string | undefined {
    const head = String.fromCharCode(...bytes.slice(0, 2048));
    return head.match(/charset\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
}

/** Decodes an export using its declared charset before parsing its HTML. */
export function decodePropertyHtml(bytes: Uint8Array): string {
    const charset = getDeclaredCharset(bytes);
    if (charset === "big5" || charset === "big-5" || charset === "cp950" || charset === "ms950" || charset === "windows-950") {
        return decodeBig5(bytes);
    }

    return new TextDecoder("utf-8").decode(bytes);
}

function normalizeHeader(value: string): string {
    return value.replace(/[\s　]/g, "").replace(/[：:]/g, "").trim();
}

function getHeaderIndexes(row: string[]): Record<typeof REQUIRED_HEADERS[number], number> | null {
    const headers = row.map(normalizeHeader);
    const itemNumber = headers.findIndex((header) => header === "項次" || header === "序號");
    const propertyNumber = headers.findIndex((header) => header.includes("財產編號"));
    const propertyName = headers.findIndex((header) => header.includes("財產名稱"));

    if (itemNumber < 0 || propertyNumber < 0 || propertyName < 0) return null;

    return {itemNumber, propertyNumber, propertyName};
}

function extractRowsWithHeaders(html: string): Array<{ rows: string[][]; headerRowIndex: number; indexes: Record<typeof REQUIRED_HEADERS[number], number> }> {
    const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi;
    const tableCandidates: string[][][] = [];
    const matches: Array<{ rows: string[][]; headerRowIndex: number; indexes: Record<typeof REQUIRED_HEADERS[number], number> }> = [];
    let tableMatch: RegExpExecArray | null;

    while ((tableMatch = tablePattern.exec(html)) !== null) {
        tableCandidates.push(parseRows(tableMatch[1]));
    }

    if (tableCandidates.length === 0) tableCandidates.push(parseRows(html));

    for (const rows of tableCandidates) {
        for (let headerRowIndex = 0; headerRowIndex < rows.length; headerRowIndex += 1) {
            const indexes = getHeaderIndexes(rows[headerRowIndex]);
            if (indexes) {
                matches.push({rows, headerRowIndex, indexes});
                break;
            }
        }
    }

    if (matches.length > 0) return matches;

    throw new PropertyHtmlParseError("找不到「項次」、「財產編號」與「財產名稱」欄位，請確認選擇的是財產系統匯出的 HTML 檔。");
}

/** Converts the comma-separated 財產編號 to the hyphenated Code 39 barcode value. */
export function propertyNumberToBarcode(propertyNumber: string): string {
    return propertyNumber
        .replace(/[，,]/g, "-")
        .replace(/\s+/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function isPropertyNumber(value: string): boolean {
    return /^\d+(?:-\d+)+[，,]\d+$/.test(value.replace(/\s+/g, ""));
}

export function parsePropertyExportYear(html: string): string | undefined {
    const text = htmlToText(html);
    return text.match(/(?:^|\D)(\d{3})\s*年度\s*財物?盤點單/)?.[1];
}

/** Parses a 財產系統 HTML export without relying on browser-only DOM APIs. */
export function parsePropertyHtml(html: string): PropertyHtmlParseResult {
    const tables = extractRowsWithHeaders(html);
    const items: ParsedPropertyItem[] = [];
    const seenBarcodes = new Set<string>();
    let skippedRowCount = 0;
    let duplicateBarcodeCount = 0;

    for (const {rows, headerRowIndex, indexes} of tables) {
        for (const row of rows.slice(headerRowIndex + 1)) {
            // The second header row has only the three check-status cells.
            if (row.length <= Math.max(indexes.itemNumber, indexes.propertyNumber, indexes.propertyName) + 1) continue;

            const itemNumber = row[indexes.itemNumber]?.trim() ?? "";
            const sourcePropertyNumber = row[indexes.propertyNumber]?.trim() ?? "";
            const propertyName = row[indexes.propertyName]?.trim() ?? "";
            const barcode = propertyNumberToBarcode(sourcePropertyNumber);

            if (!itemNumber && !sourcePropertyNumber && !propertyName) continue;
            if (!itemNumber || !propertyName || !isPropertyNumber(sourcePropertyNumber)) {
                skippedRowCount += 1;
                continue;
            }

            if (seenBarcodes.has(barcode)) {
                duplicateBarcodeCount += 1;
            }

            seenBarcodes.add(barcode);
            items.push({itemNumber, barcode, propertyName});
        }
    }

    if (items.length === 0) {
        throw new PropertyHtmlParseError("檔案沒有可匯入的財產資料，請確認每列都包含項次、財產編號及財產名稱。");
    }

    return {items, skippedRowCount, duplicateBarcodeCount, sourceYear: parsePropertyExportYear(html)};
}

export function parsePropertyHtmlBytes(bytes: Uint8Array): PropertyHtmlParseResult {
    return parsePropertyHtml(decodePropertyHtml(bytes));
}
