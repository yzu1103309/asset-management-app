import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
    decodePropertyHtml,
    parsePropertyHtml,
    parsePropertyHtmlBytes,
    propertyNumberToBarcode,
} from "../handlers/propertyHtmlParser.ts";

function bytesFromHex(hex: string): number[] {
    return Array.from(Buffer.from(hex.replace(/\s+/g, ""), "hex"));
}

function asciiBytes(value: string): number[] {
    return Array.from(Buffer.from(value, "ascii"));
}

test("decodes and parses a legacy property export fixture", () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/mock-property-export.html"));
    const html = decodePropertyHtml(bytes);
    const result = parsePropertyHtmlBytes(bytes);

    assert.match(html, /項次/);
    assert.match(html, /財產編號/);
    assert.match(html, /財產名稱/);
    assert.equal(result.items.length, 6);
    assert.equal(result.duplicateBarcodeCount, 1);
    assert.equal(result.skippedRowCount, 0);
    assert.equal(result.sourceYear, "115");
    assert.deepEqual(result.items.filter((item) => item.barcode === "7654321-02-20001").map((item) => item.itemNumber), ["3", "4"]);
    assert.deepEqual(result.items.find((item) => item.itemNumber === "2"), {
        itemNumber: "2",
        barcode: "1234567-01-10002",
        propertyName: "測試螢幕 & 轉接線",
        custodianName: "李小華",
    });
    assert.deepEqual(result.items.find((item) => item.itemNumber === "6"), {
        itemNumber: "6",
        barcode: "9988776-03-30002",
        propertyName: "測試全形逗號設備",
        custodianName: "陳小美",
    });
});

test("decodes Big5 property export without declared charset", () => {
    const bytes = new Uint8Array([
        ...asciiBytes("<h2><center>"),
        ...bytesFromHex("b0 ea a5 df a4 a4 a5 a1 a4 6a be c7"),
        ...asciiBytes("115"),
        ...bytesFromHex("a6 7e ab d7 b0 5d aa ab bd 4c c2 49 b3 e6"),
        ...asciiBytes("</h2><table><tr><td>"),
        ...bytesFromHex("b6 b5 a6 b8"),
        ...asciiBytes("<td>"),
        ...bytesFromHex("b0 5d b2 a3 bd 73 b8 b9"),
        ...asciiBytes("<td>"),
        ...bytesFromHex("b0 5d b2 a3 a6 57 ba d9"),
        ...asciiBytes("<td>"),
        ...bytesFromHex("ab 4f ba de a4 48"),
        ...asciiBytes("<tr><td>1<td>3140101-03-15500<td>ASUS<td>&nbsp;</table>"),
    ]);
    const html = decodePropertyHtml(bytes);
    const result = parsePropertyHtmlBytes(bytes);

    assert.match(html, /國立中央大學115年度財物盤點單/);
    assert.deepEqual(result.items, [{
        itemNumber: "1",
        barcode: "3140101-03-15500",
        propertyName: "ASUS",
        custodianName: null,
    }]);
    assert.equal(result.sourceYear, "115");
});

test("accepts property numbers that are already hyphenated barcodes", () => {
    const result = parsePropertyHtml(`
        <table>
            <tr><td>項次<td>財產編號<td>財產名稱<td>保管人
            <tr><td>1<td>3140101-03-15500<td>ASUS 個人電腦<td>王小明
        </table>
    `);

    assert.equal(propertyNumberToBarcode("3140101-03-15500"), "3140101-03-15500");
    assert.deepEqual(result.items, [{
        itemNumber: "1",
        barcode: "3140101-03-15500",
        propertyName: "ASUS 個人電腦",
        custodianName: "王小明",
    }]);
});
