import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {decodePropertyHtml, parsePropertyHtmlBytes} from "../handlers/propertyHtmlParser.ts";

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
