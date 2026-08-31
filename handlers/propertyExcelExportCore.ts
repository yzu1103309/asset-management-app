import type {PropertyItemsByBarcode} from "./propertyItemStore.ts";
import {
    expandLegacyAnnualStatusEntries,
    parsePropertyStatusEntryKey,
    PROPERTY_STATUS_VALUES,
    type PropertyStatus,
} from "./propertyStatusStore.ts";

const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
    unknown: "未清點",
    checked: "已確認",
    pending: "待處理",
};
const EMPTY_STATUS_ENTRIES: Record<PropertyStatus, string[]> = {
    unknown: [],
    checked: [],
    pending: [],
};
const XLSX_EXPORT_COLUMNS = [
    "項次",
    "財產編號",
    "財產名稱",
    "保管人",
    "盤點狀態",
    "位置區域",
    "詳細位置描述",
    "其他備註",
] as const;
const STATUS_COLUMN_INDEX = XLSX_EXPORT_COLUMNS.findIndex((column) => column === "盤點狀態");
const CELL_STYLE_IDS = {
    body: 0,
    header: 1,
    unknown: 2,
    checked: 3,
    pending: 4,
} as const;
const COLUMN_WIDTHS = [8, 20, 34, 14, 12, 18, 30, 30] as const;

export type PropertyExcelRow = {
    itemNumber: string;
    barcode: string;
    entityIndex: number;
    propertyName: string;
    custodianName: string;
    statusesByYear: Record<string, string>;
    areaName: string;
    locationDescription: string;
    note: string;
};

export type AnnualStatusEntriesByYear = Record<string, Record<PropertyStatus, string[]>>;

type ZipSourceEntry = {
    name: string;
    content: string | Uint8Array;
};

type PreparedZipEntry = {
    name: string;
    nameBytes: Uint8Array;
    contentBytes: Uint8Array;
    crc32: number;
    localHeaderOffset: number;
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

export function getPropertyExcelFileName(date = new Date()): string {
    return sanitizeFileName(`財產清點資料_${formatTimestamp(date)}.xlsx`);
}

function compareItemNumber(a: string, b: string): number {
    const numberA = Number(a);
    const numberB = Number(b);
    if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) return numberA - numberB;

    return a.localeCompare(b, "zh-Hant", {numeric: true, sensitivity: "base"});
}

function sortRows(rows: PropertyExcelRow[]): PropertyExcelRow[] {
    return [...rows].sort((a, b) => {
        const itemNumberOrder = compareItemNumber(a.itemNumber, b.itemNumber);
        if (itemNumberOrder !== 0) return itemNumberOrder;

        const barcodeOrder = a.barcode.localeCompare(b.barcode, "zh-Hant", {numeric: true, sensitivity: "base"});
        if (barcodeOrder !== 0) return barcodeOrder;

        return a.entityIndex - b.entityIndex;
    });
}

function getCellText(value: unknown): string {
    if (value === null || value === undefined) return "";

    return String(value);
}

function sanitizeXmlText(value: string): string {
    return value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getEntityStatusMap(
    itemsByBarcode: PropertyItemsByBarcode,
    statusEntries: Record<PropertyStatus, string[]>,
): Map<string, PropertyStatus> {
    const entityStatusMap = new Map<string, PropertyStatus>();

    for (const status of PROPERTY_STATUS_VALUES) {
        const expandedEntries = expandLegacyAnnualStatusEntries(statusEntries[status], (barcode) => itemsByBarcode[barcode]?.length ?? 0);

        for (const entry of expandedEntries) {
            const parsedEntry = parsePropertyStatusEntryKey(entry);
            if (!parsedEntry) continue;

            entityStatusMap.set(`${parsedEntry.barcode}:${parsedEntry.entityIndex}`, status);
        }
    }

    return entityStatusMap;
}

export function buildPropertyExcelRows(
    itemsByBarcode: PropertyItemsByBarcode,
    years: string[],
    annualStatusEntriesByYear: AnnualStatusEntriesByYear,
): PropertyExcelRow[] {
    const statusMapsByYear = Object.fromEntries(
        years.map((year) => [year, getEntityStatusMap(itemsByBarcode, annualStatusEntriesByYear[year] ?? EMPTY_STATUS_ENTRIES)]),
    ) as Record<string, Map<string, PropertyStatus>>;
    const rows: PropertyExcelRow[] = [];

    for (const [barcode, items] of Object.entries(itemsByBarcode)) {
        items.forEach((item, entityIndex) => {
            const entityKey = `${barcode}:${entityIndex}`;
            const statusesByYear: Record<string, string> = {};

            for (const year of years) {
                if (!item.sourceYears.includes(year)) {
                    statusesByYear[year] = "";
                    continue;
                }

                const status = statusMapsByYear[year].get(entityKey) ?? "unknown";
                statusesByYear[year] = PROPERTY_STATUS_LABELS[status];
            }

            rows.push({
                itemNumber: item.itemNumber,
                barcode: item.barcode,
                entityIndex,
                propertyName: item.propertyName,
                custodianName: item.custodianName ?? "",
                statusesByYear,
                areaName: item.location?.areaName ?? "",
                locationDescription: item.location?.description ?? "",
                note: item.note ?? "",
            });
        });
    }

    return sortRows(rows);
}

function getColumnName(index: number): string {
    let columnIndex = index + 1;
    let columnName = "";

    while (columnIndex > 0) {
        const remainder = (columnIndex - 1) % 26;
        columnName = String.fromCharCode(65 + remainder) + columnName;
        columnIndex = Math.floor((columnIndex - 1) / 26);
    }

    return columnName;
}

function getStatusCellStyleId(value: unknown): number {
    if (value === PROPERTY_STATUS_LABELS.checked) return CELL_STYLE_IDS.checked;
    if (value === PROPERTY_STATUS_LABELS.pending) return CELL_STYLE_IDS.pending;
    if (value === PROPERTY_STATUS_LABELS.unknown) return CELL_STYLE_IDS.unknown;

    return CELL_STYLE_IDS.body;
}

function worksheetCell(value: unknown, columnIndex: number, rowIndex: number, styleId: number = CELL_STYLE_IDS.body): string {
    const reference = `${getColumnName(columnIndex)}${rowIndex}`;

    return `<c r="${reference}" s="${styleId}" t="inlineStr"><is><t>${sanitizeXmlText(getCellText(value))}</t></is></c>`;
}

function worksheetRow(
    values: unknown[],
    rowIndex: number,
    getStyleId: (value: unknown, columnIndex: number) => number = () => CELL_STYLE_IDS.body,
): string {
    return `<row r="${rowIndex}">${values.map((value, columnIndex) => worksheetCell(value, columnIndex, rowIndex, getStyleId(value, columnIndex))).join("")}</row>`;
}

function getYearRows(rows: PropertyExcelRow[], year: string): PropertyExcelRow[] {
    return rows.filter((row) => row.statusesByYear[year] !== "");
}

function getRowValues(row: PropertyExcelRow, year: string): unknown[] {
    return [
        row.itemNumber,
        row.barcode,
        row.propertyName,
        row.custodianName,
        row.statusesByYear[year] ?? "",
        row.areaName,
        row.locationDescription,
        row.note,
    ];
}

function buildWorksheetXml(rows: PropertyExcelRow[], year: string): string {
    const sheetRows = [
        worksheetRow([...XLSX_EXPORT_COLUMNS], 1, () => CELL_STYLE_IDS.header),
        ...getYearRows(rows, year).map((row, index) => worksheetRow(getRowValues(row, year), index + 2, (value, columnIndex) => (
            columnIndex === STATUS_COLUMN_INDEX ? getStatusCellStyleId(value) : CELL_STYLE_IDS.body
        ))),
    ].join("");
    const columnXml = COLUMN_WIDTHS.map((width, index) => (
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    )).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${columnXml}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
}

function sanitizeWorksheetName(value: string): string {
    const sanitized = value.replace(/[\[\]:*?\/\\]/g, " ").trim() || "Sheet";

    return sanitized.slice(0, 31);
}

function buildWorkbookXml(years: string[]): string {
    const sheets = years.map((year, index) => (
        `<sheet name="${sanitizeXmlText(sanitizeWorksheetName(`${year}年度`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function buildWorkbookRelationshipsXml(years: string[]): string {
    const worksheetRelationships = years.map((_, index) => (
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )).join("");
    const styleRelationship = `<Relationship Id="rId${years.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRelationships}${styleRelationship}</Relationships>`;
}

function buildRootRelationshipsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function buildContentTypesXml(years: string[]): string {
    const worksheetOverrides = years.map((_, index) => (
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheetOverrides}</Types>`;
}

function buildStylesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="2">
        <font><sz val="11"/><name val="Arial"/></font>
        <font><b/><sz val="11"/><name val="Arial"/></font>
    </fonts>
    <fills count="6">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFFFEDD5"/><bgColor indexed="64"/></patternFill></fill>
    </fills>
    <borders count="2">
        <border><left/><right/><top/><bottom/><diagonal/></border>
        <border>
            <left style="thin"><color rgb="FFE2E8F0"/></left>
            <right style="thin"><color rgb="FFE2E8F0"/></right>
            <top style="thin"><color rgb="FFE2E8F0"/></top>
            <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
            <diagonal/>
        </border>
    </borders>
    <cellStyleXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    </cellStyleXfs>
    <cellXfs count="5">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
        <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
        <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
        <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
    </cellXfs>
    <cellStyles count="1">
        <cellStyle name="Normal" xfId="0" builtinId="0"/>
    </cellStyles>
</styleSheet>`;
}

function encodeUtf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function createCrc32Table(): Uint32Array {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }

    return table;
}

const CRC32_TABLE = createCrc32Table();

function getCrc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;

    for (const byte of bytes) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function getDosTime(date: Date): number {
    return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function getDosDate(date: Date): number {
    return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function writeUint16(output: number[], value: number): void {
    output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output: number[], value: number): void {
    output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendBytes(output: number[], bytes: Uint8Array): void {
    for (const byte of bytes) {
        output.push(byte);
    }
}

function createLocalFileHeader(entry: PreparedZipEntry, date: Date): Uint8Array {
    const output: number[] = [];

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0x0800);
    writeUint16(output, 0);
    writeUint16(output, getDosTime(date));
    writeUint16(output, getDosDate(date));
    writeUint32(output, entry.crc32);
    writeUint32(output, entry.contentBytes.length);
    writeUint32(output, entry.contentBytes.length);
    writeUint16(output, entry.nameBytes.length);
    writeUint16(output, 0);
    appendBytes(output, entry.nameBytes);

    return Uint8Array.from(output);
}

function createCentralDirectoryHeader(entry: PreparedZipEntry, date: Date): Uint8Array {
    const output: number[] = [];

    writeUint32(output, 0x02014b50);
    writeUint16(output, 20);
    writeUint16(output, 20);
    writeUint16(output, 0x0800);
    writeUint16(output, 0);
    writeUint16(output, getDosTime(date));
    writeUint16(output, getDosDate(date));
    writeUint32(output, entry.crc32);
    writeUint32(output, entry.contentBytes.length);
    writeUint32(output, entry.contentBytes.length);
    writeUint16(output, entry.nameBytes.length);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, 0);
    writeUint32(output, entry.localHeaderOffset);
    appendBytes(output, entry.nameBytes);

    return Uint8Array.from(output);
}

function createEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Uint8Array {
    const output: number[] = [];

    writeUint32(output, 0x06054b50);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, entryCount);
    writeUint16(output, entryCount);
    writeUint32(output, centralDirectorySize);
    writeUint32(output, centralDirectoryOffset);
    writeUint16(output, 0);

    return Uint8Array.from(output);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

function createZip(entries: ZipSourceEntry[], date = new Date()): Uint8Array {
    const preparedEntries: PreparedZipEntry[] = entries.map((entry) => {
        const contentBytes = typeof entry.content === "string" ? encodeUtf8(entry.content) : entry.content;

        return {
            name: entry.name,
            nameBytes: encodeUtf8(entry.name),
            contentBytes,
            crc32: getCrc32(contentBytes),
            localHeaderOffset: 0,
        };
    });
    const localFileChunks: Uint8Array[] = [];
    let offset = 0;

    for (const entry of preparedEntries) {
        entry.localHeaderOffset = offset;
        const localHeader = createLocalFileHeader(entry, date);
        localFileChunks.push(localHeader, entry.contentBytes);
        offset += localHeader.length + entry.contentBytes.length;
    }

    const centralDirectoryOffset = offset;
    const centralDirectoryChunks = preparedEntries.map((entry) => createCentralDirectoryHeader(entry, date));
    const centralDirectorySize = centralDirectoryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const endOfCentralDirectory = createEndOfCentralDirectory(preparedEntries.length, centralDirectorySize, centralDirectoryOffset);

    return concatBytes([...localFileChunks, ...centralDirectoryChunks, endOfCentralDirectory]);
}

export function buildPropertyExcelXlsx(rows: PropertyExcelRow[], years: string[], date = new Date()): Uint8Array {
    const entries: ZipSourceEntry[] = [
        {name: "[Content_Types].xml", content: buildContentTypesXml(years)},
        {name: "_rels/.rels", content: buildRootRelationshipsXml()},
        {name: "xl/workbook.xml", content: buildWorkbookXml(years)},
        {name: "xl/_rels/workbook.xml.rels", content: buildWorkbookRelationshipsXml(years)},
        {name: "xl/styles.xml", content: buildStylesXml()},
        ...years.map((year, index) => ({
            name: `xl/worksheets/sheet${index + 1}.xml`,
            content: buildWorksheetXml(rows, year),
        })),
    ];

    return createZip(entries, date);
}
