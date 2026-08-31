import assert from "node:assert/strict";
import test from "node:test";
import {deflateRawSync} from "node:zlib";
import {parsePropertySpreadsheetBytes} from "../handlers/propertySpreadsheetParser.ts";

type TestZipEntry = {
    name: string;
    content: string;
};

function writeUint16(output: number[], value: number): void {
    output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output: number[], value: number): void {
    output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendBytes(output: number[], bytes: Uint8Array): void {
    for (const byte of bytes) output.push(byte);
}

function makeDeflatedTestXlsx(entries: TestZipEntry[]): Uint8Array {
    const output: number[] = [];
    const centralDirectory: number[] = [];

    for (const entry of entries) {
        const localHeaderOffset = output.length;
        const nameBytes = new TextEncoder().encode(entry.name);
        const contentBytes = new TextEncoder().encode(entry.content);
        const compressedBytes = deflateRawSync(contentBytes);

        writeUint32(output, 0x04034b50);
        writeUint16(output, 20);
        writeUint16(output, 0x0800);
        writeUint16(output, 8);
        writeUint16(output, 0);
        writeUint16(output, 0);
        writeUint32(output, 0);
        writeUint32(output, compressedBytes.length);
        writeUint32(output, contentBytes.length);
        writeUint16(output, nameBytes.length);
        writeUint16(output, 0);
        appendBytes(output, nameBytes);
        appendBytes(output, compressedBytes);

        writeUint32(centralDirectory, 0x02014b50);
        writeUint16(centralDirectory, 20);
        writeUint16(centralDirectory, 20);
        writeUint16(centralDirectory, 0x0800);
        writeUint16(centralDirectory, 8);
        writeUint16(centralDirectory, 0);
        writeUint16(centralDirectory, 0);
        writeUint32(centralDirectory, 0);
        writeUint32(centralDirectory, compressedBytes.length);
        writeUint32(centralDirectory, contentBytes.length);
        writeUint16(centralDirectory, nameBytes.length);
        writeUint16(centralDirectory, 0);
        writeUint16(centralDirectory, 0);
        writeUint16(centralDirectory, 0);
        writeUint16(centralDirectory, 0);
        writeUint32(centralDirectory, 0);
        writeUint32(centralDirectory, localHeaderOffset);
        appendBytes(centralDirectory, nameBytes);
    }

    const centralDirectoryOffset = output.length;
    output.push(...centralDirectory);
    writeUint32(output, 0x06054b50);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, entries.length);
    writeUint16(output, entries.length);
    writeUint32(output, centralDirectory.length);
    writeUint32(output, centralDirectoryOffset);
    writeUint16(output, 0);

    return Uint8Array.from(output);
}

function makeSharedStringXlsx(sheetName: string): Uint8Array {
    return makeDeflatedTestXlsx([
        {
            name: "xl/workbook.xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
        },
        {
            name: "xl/sharedStrings.xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>財產編號</t></si><si><t>名稱</t></si><si><t>保管人</t></si><si><t>3140101-03-29578</t></si><si><t>A&amp;B &lt;測試&gt;</t></si><si><t>王小明</t></si></sst>`,
        },
        {
            name: "xl/worksheets/sheet1.xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row></sheetData></worksheet>`,
        },
    ]);
}

test("parses deflated xlsx with shared strings and sheet year", () => {
    const result = parsePropertySpreadsheetBytes(makeSharedStringXlsx("115年度"), "mock.xlsx", new Date("2026-08-31T00:00:00"));

    assert.deepEqual(result.sourceYears, ["115"]);
    assert.equal(result.itemsByYear["115"][0].itemNumber, "1");
    assert.equal(result.itemsByYear["115"][0].barcode, "3140101-03-29578");
    assert.equal(result.itemsByYear["115"][0].propertyName, "A&B <測試>");
    assert.equal(result.itemsByYear["115"][0].custodianName, "王小明");
});

test("uses the current western year for a single non-year worksheet", () => {
    const result = parsePropertySpreadsheetBytes(makeSharedStringXlsx("sheet1"), "mock.xlsx", new Date("2026-08-31T00:00:00"));

    assert.deepEqual(result.sourceYears, ["2026"]);
});

test("uses provided single-sheet fallback year", () => {
    const result = parsePropertySpreadsheetBytes(makeSharedStringXlsx("sheet1"), "mock.xlsx", {
        now: new Date("2026-08-31T00:00:00"),
        singleSheetFallbackYear: "115",
    });

    assert.deepEqual(result.sourceYears, ["115"]);
});
