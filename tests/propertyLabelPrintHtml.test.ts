import assert from "node:assert/strict";
import test from "node:test";
import {
    buildPropertyLabelPrintHtml,
    getPropertyLabelPrintItems,
    makeQrSvg,
} from "../handlers/propertyLabelPrintHtml.ts";
import type {PropertyItemsByBarcode} from "../handlers/propertyItemStore.ts";

const storedItems: PropertyItemsByBarcode = {
    "3140101-03-40745": [
        {
            barcode: "3140101-03-40745",
            itemNumber: "2",
            propertyName: "測試螢幕",
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:00:00.000Z",
            sourceYears: ["115"],
            location: {areaId: null, areaName: null, description: null},
            note: null,
        },
    ],
    "3140101-03-00427": [
        {
            barcode: "3140101-03-00427",
            itemNumber: "1",
            propertyName: "測試筆電",
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:00:00.000Z",
            sourceYears: ["115"],
            location: {areaId: null, areaName: null, description: null},
            note: null,
        },
    ],
};

test("prepares property label print items sorted by item number", () => {
    assert.deepEqual(getPropertyLabelPrintItems(storedItems).map((item) => item.barcode), [
        "3140101-03-00427",
        "3140101-03-40745",
    ]);
});

test("filters property label print items by queued barcode", () => {
    assert.deepEqual(getPropertyLabelPrintItems(storedItems, ["3140101-03-40745"]), [
        {
            barcode: "3140101-03-40745",
            itemNumber: "2",
            propertyName: "測試螢幕",
        },
    ]);
});

test("builds an A4 3 by 9 property label HTML page with QR code SVG", () => {
    const html = buildPropertyLabelPrintHtml(getPropertyLabelPrintItems(storedItems), {
        kaiuFontDataUri: "data:font/truetype;base64,MOCK_KAIU_FONT",
        timesFontDataUri: "data:font/truetype;base64,MOCK_TIMES_FONT",
    });

    assert.match(html, /size: A4 portrait/);
    assert.match(html, /font-family: "NCU Label"/);
    assert.match(html, /MOCK_KAIU_FONT/);
    assert.match(html, /MOCK_TIMES_FONT/);
    assert.match(html, /unicode-range: U\+0000-024F/);
    assert.match(html, /unicode-range: U\+2E80-2EFF/);
    assert.match(html, /grid-template-columns: repeat\(3, 7cm\)/);
    assert.match(html, /grid-auto-rows: 3.3cm/);
    assert.match(html, /width: 1.5cm/);
    assert.match(html, /flex: 0 0 2.8em/);
    assert.equal((html.match(/<div class="label(?:\s|")/g) ?? []).length, 2);
    assert.match(html, /3140101-03-00427/);
    assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test("generates a QR SVG matrix for the barcode", () => {
    const svg = makeQrSvg("3140101-03-40745");

    assert.match(svg, /viewBox="0 0 21 21"/);
    assert.match(svg, /<rect x="/);
});
