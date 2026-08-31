import {propertyNumberToBarcode, type ParsedPropertyItem} from "./propertyHtmlParser.ts";

type SpreadsheetSheet = {
    name: string;
    rows: string[][];
};

type HeaderIndexes = {
    itemNumber?: number;
    propertyNumber: number;
    propertyName: number;
    custodianName: number;
};

type ZipEntry = {
    name: string;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    dataOffset: number;
};

type HuffmanTable = {
    map: Map<number, number>;
    maxBits: number;
};

export type PropertySpreadsheetParseResult = {
    itemsByYear: Record<string, ParsedPropertyItem[]>;
    sourceYears: string[];
    skippedRowCount: number;
    duplicateBarcodeCount: number;
};

export type PropertySpreadsheetParseOptions = {
    now?: Date;
    singleSheetFallbackYear?: string;
};
type ResolvedPropertySpreadsheetParseOptions = {
    now: Date;
    singleSheetFallbackYear?: string;
};

class BitReader {
    private bitBuffer = 0;
    private bitLength = 0;
    private offset = 0;
    private readonly bytes: Uint8Array;

    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
    }

    readBits(count: number): number {
        while (this.bitLength < count) {
            if (this.offset >= this.bytes.length) throw new Error("Invalid deflate stream.");

            this.bitBuffer |= this.bytes[this.offset] << this.bitLength;
            this.bitLength += 8;
            this.offset += 1;
        }

        const value = this.bitBuffer & ((1 << count) - 1);
        this.bitBuffer >>>= count;
        this.bitLength -= count;

        return value;
    }

    alignToByte(): void {
        this.bitBuffer = 0;
        this.bitLength = 0;
    }
}

const LENGTH_BASES = [
    3, 4, 5, 6, 7, 8, 9, 10,
    11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115,
    131, 163, 195, 227, 258,
];
const LENGTH_EXTRA_BITS = [
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4,
    5, 5, 5, 5, 0,
];
const DISTANCE_BASES = [
    1, 2, 3, 4, 5, 7, 9, 13,
    17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073,
    4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA_BITS = [
    0, 0, 0, 0, 1, 1, 2, 2,
    3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13,
];

function decodeHtmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": "\"",
        "&#39;": "'",
        "&nbsp;": " ",
        "&apos;": "'",
    };

    const withNamedEntities = value.replace(/&(amp|lt|gt|quot|nbsp|apos);|&#39;/gi, (entity) => namedEntities[entity.toLowerCase()] ?? entity);

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

function stripXmlNamespaces(value: string): string {
    return value.replace(/(<\/?)([A-Za-z0-9_]+):/g, "$1");
}

function htmlToText(value: string): string {
    return decodeHtmlEntities(
        value
            .replace(/<!--([\s\S]*?)-->/g, "")
            .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, " ")
            .replace(/<[^>]+>/g, " ")
    ).replace(/\s+/g, " ").trim();
}

function parseAttributes(value: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(value)) !== null) {
        attributes[match[1]] = decodeHtmlEntities(match[2] ?? match[3] ?? "");
    }

    return attributes;
}

function normalizeHeader(value: string): string {
    return value.replace(/[\s　]/g, "").replace(/[：:]/g, "").trim();
}

function getHeaderIndexes(row: string[]): HeaderIndexes | null {
    const headers = row.map(normalizeHeader);
    const itemNumber = headers.findIndex((header) => header === "項次" || header === "序號");
    const propertyNumber = headers.findIndex((header) => header.includes("財產編號") || header === "財編" || header === "財產號碼");
    const propertyName = headers.findIndex((header) => header.includes("財產名稱") || header === "名稱" || header === "品名" || header === "財產名");
    const custodianName = headers.findIndex((header) => header.includes("保管人"));

    if (propertyNumber < 0 || propertyName < 0 || custodianName < 0) return null;

    return {
        ...(itemNumber >= 0 ? {itemNumber} : {}),
        propertyNumber,
        propertyName,
        custodianName,
    };
}

function getSheetYear(sheetName: string, sheetCount: number, now: Date, singleSheetFallbackYear?: string): string {
    const year = sheetName.match(/(?:^|\D)(\d{3,4})(?:\D|$)/)?.[1];
    if (year) return year;
    if (sheetCount === 1) return singleSheetFallbackYear ?? String(now.getFullYear());

    throw new Error("Excel 檔有多個分頁時，請將每個分頁名稱設定為年度，例如「115」或「2026」。");
}

function parseSheetsToItems(sheets: SpreadsheetSheet[], options: ResolvedPropertySpreadsheetParseOptions): PropertySpreadsheetParseResult {
    const itemsByYear: Record<string, ParsedPropertyItem[]> = {};
    const seenEntries = new Set<string>();
    let skippedRowCount = 0;
    let duplicateBarcodeCount = 0;

    for (const sheet of sheets) {
        const headerRowIndex = sheet.rows.findIndex((row) => getHeaderIndexes(row) !== null);
        if (headerRowIndex < 0) {
            skippedRowCount += sheet.rows.length;
            continue;
        }

        const indexes = getHeaderIndexes(sheet.rows[headerRowIndex]);
        if (!indexes) continue;

        const sourceYear = getSheetYear(sheet.name, sheets.length, options.now, options.singleSheetFallbackYear);
        const yearItems = itemsByYear[sourceYear] ?? [];

        for (const row of sheet.rows.slice(headerRowIndex + 1)) {
            const sourcePropertyNumber = row[indexes.propertyNumber]?.trim() ?? "";
            const propertyName = row[indexes.propertyName]?.trim() ?? "";
            const custodianName = row[indexes.custodianName]?.trim() ?? "";
            const itemNumber = indexes.itemNumber !== undefined
                ? row[indexes.itemNumber]?.trim() || String(yearItems.length + 1)
                : String(yearItems.length + 1);
            const barcode = propertyNumberToBarcode(sourcePropertyNumber);

            if (!sourcePropertyNumber && !propertyName && !custodianName) continue;
            if (!barcode || !propertyName || !custodianName) {
                skippedRowCount += 1;
                continue;
            }

            const entryKey = `${sourceYear}:${barcode}`;
            if (seenEntries.has(entryKey)) duplicateBarcodeCount += 1;
            seenEntries.add(entryKey);

            yearItems.push({
                itemNumber,
                barcode,
                propertyName,
                custodianName,
            });
        }

        itemsByYear[sourceYear] = yearItems;
    }

    const sourceYears = Object.keys(itemsByYear).filter((year) => itemsByYear[year].length > 0);
    if (sourceYears.length === 0) {
        throw new Error("檔案沒有可匯入的財產資料，請確認欄位包含「財產編號」、「名稱」與「保管人」。");
    }

    return {itemsByYear, sourceYears, skippedRowCount, duplicateBarcodeCount};
}

function readUint16(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function reverseBits(value: number, bitLength: number): number {
    let reversed = 0;

    for (let index = 0; index < bitLength; index += 1) {
        reversed = (reversed << 1) | (value & 1);
        value >>>= 1;
    }

    return reversed;
}

function buildHuffmanTable(lengths: number[]): HuffmanTable {
    const maxBits = Math.max(...lengths, 0);
    const blCount = Array.from({length: maxBits + 1}, () => 0);
    const nextCode = Array.from({length: maxBits + 1}, () => 0);
    const map = new Map<number, number>();
    let code = 0;

    for (const length of lengths) {
        if (length > 0) blCount[length] += 1;
    }

    for (let bits = 1; bits <= maxBits; bits += 1) {
        code = (code + blCount[bits - 1]) << 1;
        nextCode[bits] = code;
    }

    lengths.forEach((length, symbol) => {
        if (length === 0) return;

        const reversedCode = reverseBits(nextCode[length], length);
        map.set((length << 16) | reversedCode, symbol);
        nextCode[length] += 1;
    });

    return {map, maxBits};
}

function decodeHuffmanSymbol(reader: BitReader, table: HuffmanTable): number {
    let code = 0;

    for (let bits = 1; bits <= table.maxBits; bits += 1) {
        code |= reader.readBits(1) << (bits - 1);

        const symbol = table.map.get((bits << 16) | code);
        if (symbol !== undefined) return symbol;
    }

    throw new Error("Invalid deflate Huffman code.");
}

function getFixedHuffmanTables(): {literalLengthTable: HuffmanTable; distanceTable: HuffmanTable} {
    const literalLengthLengths = Array.from({length: 288}, (_, index) => {
        if (index <= 143) return 8;
        if (index <= 255) return 9;
        if (index <= 279) return 7;

        return 8;
    });
    const distanceLengths = Array.from({length: 32}, () => 5);

    return {
        literalLengthTable: buildHuffmanTable(literalLengthLengths),
        distanceTable: buildHuffmanTable(distanceLengths),
    };
}

function getDynamicHuffmanTables(reader: BitReader): {literalLengthTable: HuffmanTable; distanceTable: HuffmanTable} {
    const literalLengthCodeCount = reader.readBits(5) + 257;
    const distanceCodeCount = reader.readBits(5) + 1;
    const codeLengthCodeCount = reader.readBits(4) + 4;
    const codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const codeLengthLengths = Array.from({length: 19}, () => 0);

    for (let index = 0; index < codeLengthCodeCount; index += 1) {
        codeLengthLengths[codeLengthOrder[index]] = reader.readBits(3);
    }

    const codeLengthTable = buildHuffmanTable(codeLengthLengths);
    const lengths: number[] = [];
    const totalCodeCount = literalLengthCodeCount + distanceCodeCount;

    while (lengths.length < totalCodeCount) {
        const symbol = decodeHuffmanSymbol(reader, codeLengthTable);

        if (symbol <= 15) {
            lengths.push(symbol);
        } else if (symbol === 16) {
            const repeatCount = reader.readBits(2) + 3;
            const previousLength = lengths[lengths.length - 1] ?? 0;
            lengths.push(...Array.from({length: repeatCount}, () => previousLength));
        } else if (symbol === 17) {
            lengths.push(...Array.from({length: reader.readBits(3) + 3}, () => 0));
        } else if (symbol === 18) {
            lengths.push(...Array.from({length: reader.readBits(7) + 11}, () => 0));
        } else {
            throw new Error("Invalid deflate code length symbol.");
        }
    }

    return {
        literalLengthTable: buildHuffmanTable(lengths.slice(0, literalLengthCodeCount)),
        distanceTable: buildHuffmanTable(lengths.slice(literalLengthCodeCount)),
    };
}

function inflateCompressedBlocks(
    reader: BitReader,
    literalLengthTable: HuffmanTable,
    distanceTable: HuffmanTable,
    output: number[],
): void {
    while (true) {
        const symbol = decodeHuffmanSymbol(reader, literalLengthTable);

        if (symbol < 256) {
            output.push(symbol);
            continue;
        }

        if (symbol === 256) return;
        if (symbol < 257 || symbol > 285) throw new Error("Invalid deflate length symbol.");

        const lengthIndex = symbol - 257;
        const length = LENGTH_BASES[lengthIndex] + reader.readBits(LENGTH_EXTRA_BITS[lengthIndex]);
        const distanceSymbol = decodeHuffmanSymbol(reader, distanceTable);
        if (distanceSymbol >= DISTANCE_BASES.length) throw new Error("Invalid deflate distance symbol.");

        const distance = DISTANCE_BASES[distanceSymbol] + reader.readBits(DISTANCE_EXTRA_BITS[distanceSymbol]);
        if (distance <= 0 || distance > output.length) throw new Error("Invalid deflate distance.");

        for (let index = 0; index < length; index += 1) {
            output.push(output[output.length - distance]);
        }
    }
}

function inflateRaw(bytes: Uint8Array): Uint8Array {
    const reader = new BitReader(bytes);
    const output: number[] = [];
    let isFinalBlock = false;

    while (!isFinalBlock) {
        isFinalBlock = reader.readBits(1) === 1;
        const blockType = reader.readBits(2);

        if (blockType === 0) {
            reader.alignToByte();
            const length = reader.readBits(16);
            const inverseLength = reader.readBits(16);
            if (((length ^ inverseLength) & 0xffff) !== 0xffff) throw new Error("Invalid deflate stored block length.");

            for (let index = 0; index < length; index += 1) {
                output.push(reader.readBits(8));
            }
        } else if (blockType === 1) {
            const tables = getFixedHuffmanTables();
            inflateCompressedBlocks(reader, tables.literalLengthTable, tables.distanceTable, output);
        } else if (blockType === 2) {
            const tables = getDynamicHuffmanTables(reader);
            inflateCompressedBlocks(reader, tables.literalLengthTable, tables.distanceTable, output);
        } else {
            throw new Error("Unsupported deflate block type.");
        }
    }

    return Uint8Array.from(output);
}

function getZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
    let endOfCentralDirectoryOffset = -1;
    const searchStart = Math.max(0, bytes.length - 0xffff - 22);

    for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
        if (readUint32(bytes, offset) === 0x06054b50) {
            endOfCentralDirectoryOffset = offset;
            break;
        }
    }

    if (endOfCentralDirectoryOffset < 0) throw new Error("找不到 XLSX ZIP central directory。");

    const entryCount = readUint16(bytes, endOfCentralDirectoryOffset + 10);
    let centralDirectoryOffset = readUint32(bytes, endOfCentralDirectoryOffset + 16);
    const entries = new Map<string, ZipEntry>();

    for (let index = 0; index < entryCount; index += 1) {
        if (readUint32(bytes, centralDirectoryOffset) !== 0x02014b50) throw new Error("XLSX ZIP central directory 格式錯誤。");

        const compressionMethod = readUint16(bytes, centralDirectoryOffset + 10);
        const compressedSize = readUint32(bytes, centralDirectoryOffset + 20);
        const uncompressedSize = readUint32(bytes, centralDirectoryOffset + 24);
        const fileNameLength = readUint16(bytes, centralDirectoryOffset + 28);
        const extraLength = readUint16(bytes, centralDirectoryOffset + 30);
        const commentLength = readUint16(bytes, centralDirectoryOffset + 32);
        const localHeaderOffset = readUint32(bytes, centralDirectoryOffset + 42);
        const name = new TextDecoder("utf-8").decode(bytes.slice(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + fileNameLength));

        if (readUint32(bytes, localHeaderOffset) !== 0x04034b50) throw new Error("XLSX ZIP local header 格式錯誤。");

        const localFileNameLength = readUint16(bytes, localHeaderOffset + 26);
        const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
        const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;

        entries.set(name, {name, compressionMethod, compressedSize, uncompressedSize, dataOffset});
        centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
}

function readZipEntry(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Uint8Array | null {
    const entry = entries.get(name);
    if (!entry) return null;

    const compressedBytes = bytes.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);

    if (entry.compressionMethod === 0) return compressedBytes;
    if (entry.compressionMethod === 8) {
        const inflated = inflateRaw(compressedBytes);
        if (entry.uncompressedSize > 0 && inflated.length !== entry.uncompressedSize) {
            throw new Error(`XLSX ZIP entry 解壓大小不符合：${entry.name}`);
        }

        return inflated;
    }

    throw new Error(`不支援的 XLSX ZIP 壓縮方式：${entry.compressionMethod}`);
}

function readZipEntryText(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): string {
    const entryBytes = readZipEntry(bytes, entries, name);
    if (!entryBytes) throw new Error(`XLSX 缺少必要檔案：${name}`);

    return new TextDecoder("utf-8").decode(entryBytes);
}

function resolveRelationshipTarget(basePath: string, target: string): string {
    if (target.startsWith("/")) return target.replace(/^\//, "");

    const parts = basePath.split("/");
    parts.pop();

    for (const part of target.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
            parts.pop();
            continue;
        }
        parts.push(part);
    }

    return parts.join("/");
}

function parseSharedStrings(xml: string): string[] {
    const values: string[] = [];
    const normalizedXml = stripXmlNamespaces(xml);
    const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemPattern.exec(normalizedXml)) !== null) {
        const texts = [...itemMatch[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
            .map((match) => decodeHtmlEntities(match[1]));
        values.push(texts.join(""));
    }

    return values;
}

function getCellColumnIndex(reference: string | undefined, fallbackIndex: number): number {
    const letters = reference?.match(/^[A-Z]+/i)?.[0];
    if (!letters) return fallbackIndex;

    return [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function getCellValue(cellXml: string, type: string | undefined, sharedStrings: string[]): string {
    if (type === "inlineStr") {
        return [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
            .map((match) => decodeHtmlEntities(match[1]))
            .join("");
    }

    const value = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";
    if (type === "s") return sharedStrings[Number(value)] ?? "";

    return decodeHtmlEntities(value);
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
    const normalizedXml = stripXmlNamespaces(xml);
    const rows: string[][] = [];
    const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(normalizedXml)) !== null) {
        const cells: string[] = [];
        const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
        let cellMatch: RegExpExecArray | null;
        let fallbackColumnIndex = 0;

        while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
            const attributes = parseAttributes(cellMatch[1]);
            const columnIndex = getCellColumnIndex(attributes.r, fallbackColumnIndex);
            cells[columnIndex] = getCellValue(cellMatch[2], attributes.t, sharedStrings).trim();
            fallbackColumnIndex = columnIndex + 1;
        }

        if (cells.some((cell) => !!cell)) rows.push(cells);
    }

    return rows;
}

function parseWorkbookSheets(workbookXml: string, workbookRelationshipsXml: string): {name: string; path: string}[] {
    const relationships = new Map<string, string>();
    const relationshipPattern = /<Relationship\b([^>]*)\/?>/gi;
    let relationshipMatch: RegExpExecArray | null;

    while ((relationshipMatch = relationshipPattern.exec(workbookRelationshipsXml)) !== null) {
        const attributes = parseAttributes(relationshipMatch[1]);
        if (!attributes.Id || !attributes.Target) continue;

        relationships.set(attributes.Id, resolveRelationshipTarget("xl/workbook.xml", attributes.Target));
    }

    const sheets: {name: string; path: string}[] = [];
    const sheetPattern = /<sheet\b([^>]*)\/?>/gi;
    let sheetMatch: RegExpExecArray | null;

    while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
        const attributes = parseAttributes(sheetMatch[1]);
        const relationshipId = attributes["r:id"] ?? attributes.id;
        if (!attributes.name || !relationshipId) continue;

        const path = relationships.get(relationshipId);
        if (!path) continue;

        sheets.push({name: attributes.name, path});
    }

    return sheets;
}

function parseXlsxSheets(bytes: Uint8Array): SpreadsheetSheet[] {
    const entries = getZipEntries(bytes);
    const workbookXml = readZipEntryText(bytes, entries, "xl/workbook.xml");
    const workbookRelationshipsXml = readZipEntryText(bytes, entries, "xl/_rels/workbook.xml.rels");
    const sharedStringsXml = readZipEntry(bytes, entries, "xl/sharedStrings.xml");
    const sharedStrings = sharedStringsXml ? parseSharedStrings(new TextDecoder("utf-8").decode(sharedStringsXml)) : [];

    return parseWorkbookSheets(workbookXml, workbookRelationshipsXml).map((sheet) => ({
        name: sheet.name,
        rows: parseWorksheetRows(readZipEntryText(bytes, entries, sheet.path), sharedStrings),
    }));
}

function parseHtmlTableRows(html: string): string[][] {
    const rows: string[][] = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table\s*>|$)/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(html)) !== null) {
        const cells: string[] = [];
        const cellPattern = /<t[hd]\b[^>]*>([\s\S]*?)(?=<t[hd]\b|<\/tr\s*>|$)/gi;
        let cellMatch: RegExpExecArray | null;

        while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
            cells.push(htmlToText(cellMatch[1]));
        }

        if (cells.length > 0) rows.push(cells);
    }

    return rows;
}

function parseSpreadsheetMlSheets(xml: string): SpreadsheetSheet[] {
    const normalizedXml = stripXmlNamespaces(xml);
    const sheets: SpreadsheetSheet[] = [];
    const sheetPattern = /<Worksheet\b([^>]*)>([\s\S]*?)<\/Worksheet>/gi;
    let sheetMatch: RegExpExecArray | null;

    while ((sheetMatch = sheetPattern.exec(normalizedXml)) !== null) {
        const attributes = parseAttributes(sheetMatch[1]);
        const rows = [...sheetMatch[2].matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi)].map((rowMatch) => (
            [...rowMatch[1].matchAll(/<Cell\b[^>]*>([\s\S]*?)<\/Cell>/gi)].map((cellMatch) => htmlToText(cellMatch[1]))
        ));

        sheets.push({name: attributes.Name ?? attributes["ss:Name"] ?? `Sheet${sheets.length + 1}`, rows});
    }

    return sheets;
}

function parseTextSpreadsheetSheets(text: string, sourceName?: string): SpreadsheetSheet[] {
    const spreadsheetMlSheets = parseSpreadsheetMlSheets(text);
    if (spreadsheetMlSheets.length > 0) return spreadsheetMlSheets;

    const rows = parseHtmlTableRows(text);
    if (rows.length > 0) return [{name: sourceName ?? "Sheet1", rows}];

    throw new Error("無法解析此 XLS 文字表格，請改用 .xlsx 或 HTML 表格。");
}

function looksLikeTextFile(bytes: Uint8Array): boolean {
    const head = new TextDecoder("utf-8", {fatal: false}).decode(bytes.slice(0, 256)).trimStart();

    return head.startsWith("<") || head.includes("<html") || head.includes("<Workbook");
}

function getParseOptions(options?: Date | PropertySpreadsheetParseOptions): ResolvedPropertySpreadsheetParseOptions {
    if (options instanceof Date) {
        return {now: options};
    }

    return {
        now: options?.now ?? new Date(),
        ...(options?.singleSheetFallbackYear ? {singleSheetFallbackYear: options.singleSheetFallbackYear} : {}),
    };
}

export function getPropertySpreadsheetSheetNames(bytes: Uint8Array, sourceName?: string): string[] {
    const lowerName = sourceName?.toLowerCase() ?? "";

    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        return parseXlsxSheets(bytes).map((sheet) => sheet.name);
    }

    if (lowerName.endsWith(".xlsx")) {
        throw new Error("此 .xlsx 檔不是有效的 ZIP/OpenXML 格式。");
    }

    if (looksLikeTextFile(bytes)) {
        const text = new TextDecoder("utf-8", {fatal: false}).decode(bytes);
        return parseTextSpreadsheetSheets(text, sourceName).map((sheet) => sheet.name);
    }

    throw new Error("目前不支援舊式 binary .xls。請另存為 .xlsx 後再匯入。");
}

export function parsePropertySpreadsheetBytes(bytes: Uint8Array, sourceName?: string, options?: Date | PropertySpreadsheetParseOptions): PropertySpreadsheetParseResult {
    const lowerName = sourceName?.toLowerCase() ?? "";
    const parseOptions = getParseOptions(options);

    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        return parseSheetsToItems(parseXlsxSheets(bytes), parseOptions);
    }

    if (lowerName.endsWith(".xlsx")) {
        throw new Error("此 .xlsx 檔不是有效的 ZIP/OpenXML 格式。");
    }

    if (looksLikeTextFile(bytes)) {
        const text = new TextDecoder("utf-8", {fatal: false}).decode(bytes);
        return parseSheetsToItems(parseTextSpreadsheetSheets(text, sourceName), parseOptions);
    }

    throw new Error("目前不支援舊式 binary .xls。請另存為 .xlsx 後再匯入。");
}
