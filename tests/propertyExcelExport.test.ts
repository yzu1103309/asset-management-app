import assert from "node:assert/strict";
import test from "node:test";
import {
    buildPropertyExcelXlsx,
    buildPropertyExcelRows,
    getPropertyExcelFileName,
} from "../handlers/propertyExcelExportCore.ts";
import {getPropertyStatusEntryKey} from "../handlers/propertyStatusStore.ts";
import type {PropertyItemsByBarcode} from "../handlers/propertyItemStore.ts";

const itemsByBarcode: PropertyItemsByBarcode = {
    "3140101-03-29578": [
        {
            itemNumber: "2",
            barcode: "3140101-03-29578",
            propertyName: "測試財產 A",
            custodianName: "王小明",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            sourceYears: ["115", "116"],
            location: {
                areaId: "area-a",
                areaName: "A 區",
                description: "第一層",
            },
            note: "需補標籤",
            photos: [
                {
                    id: "photo-1",
                    uri: "file:///photo-1.jpg",
                    fileName: "photo-1.jpg",
                    mimeType: "image/jpeg",
                    width: 100,
                    height: 100,
                    size: 5000,
                    createdAt: "2026-01-03T00:00:00.000Z",
                },
            ],
        },
        {
            itemNumber: "10",
            barcode: "3140101-03-29578",
            propertyName: "測試財產 B",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            sourceYears: ["116"],
            location: {
                areaId: null,
                areaName: null,
                description: null,
            },
            note: null,
        },
    ],
};

test("builds Excel rows with per-entity annual statuses", () => {
    const rows = buildPropertyExcelRows(itemsByBarcode, ["116", "115"], {
        "115": {
            unknown: [getPropertyStatusEntryKey("3140101-03-29578", 0)],
            checked: [],
            pending: [],
        },
        "116": {
            unknown: [],
            checked: [getPropertyStatusEntryKey("3140101-03-29578", 0)],
            pending: [getPropertyStatusEntryKey("3140101-03-29578", 1)],
        },
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].itemNumber, "2");
    assert.equal(rows[0].statusesByYear["115"], "未清點");
    assert.equal(rows[0].statusesByYear["116"], "已確認");
    assert.equal(rows[0].custodianName, "王小明");
    assert.equal(rows[0].areaName, "A 區");
    assert.equal(rows[1].statusesByYear["115"], "");
    assert.equal(rows[1].statusesByYear["116"], "待處理");
});

test("exports item numbers from each annual source year", () => {
    const rows = buildPropertyExcelRows({
        "A-001": [
            {
                itemNumber: "1",
                itemNumbersByYear: {
                    "114": "1",
                    "115": "8",
                },
                barcode: "A-001",
                propertyName: "跨年度財產",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                sourceYears: ["114", "115"],
                location: {
                    areaId: null,
                    areaName: null,
                    description: null,
                },
                note: null,
            },
        ],
    }, ["115", "114"], {
        "114": {
            unknown: [getPropertyStatusEntryKey("A-001", 0)],
            checked: [],
            pending: [],
        },
        "115": {
            unknown: [getPropertyStatusEntryKey("A-001", 0)],
            checked: [],
            pending: [],
        },
    });
    const xlsx = buildPropertyExcelXlsx(rows, ["115", "114"], new Date("2026-08-31T05:06:07"));
    const decoded = new TextDecoder().decode(xlsx);

    assert.match(decoded, /<c r="A2" s="0" t="inlineStr"><is><t>8<\/t><\/is><\/c>/);
    assert.match(decoded, /<c r="A2" s="0" t="inlineStr"><is><t>1<\/t><\/is><\/c>/);
});

test("exports every split physical entity with its display number and local name", () => {
    const rows = buildPropertyExcelRows({
        "A-002": [
            {
                itemNumber: "32",
                barcode: "A-002",
                propertyName: "主機及螢幕",
                custodianName: "王小明",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                sourceYears: ["115"],
                location: {areaId: "a", areaName: "辦公室", description: "桌上"},
                note: "主機",
                split: {groupId: "split-1", part: 1, name: "ASUS 自組電腦"},
            },
            {
                itemNumber: "32",
                barcode: "A-002",
                propertyName: "主機及螢幕",
                custodianName: "王小明",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                sourceYears: ["115"],
                location: {areaId: "b", areaName: "會議室", description: "牆上"},
                note: "螢幕",
                split: {groupId: "split-1", part: 2, name: "DELL 24 吋螢幕"},
                parentEntityKey: "A-002::entity:0",
            },
        ],
    }, ["115"], {
        "115": {
            unknown: [getPropertyStatusEntryKey("A-002", 0)],
            checked: [getPropertyStatusEntryKey("A-002", 1)],
            pending: [],
        },
    });

    assert.deepEqual(rows.map((row) => ({
        itemNumber: row.itemNumber,
        propertyName: row.propertyName,
        parentProperty: row.parentProperty,
        status: row.statusesByYear["115"],
        areaName: row.areaName,
        note: row.note,
    })), [
        {itemNumber: "32-1", propertyName: "ASUS 自組電腦", parentProperty: "", status: "未清點", areaName: "辦公室", note: "主機"},
        {itemNumber: "32-2", propertyName: "DELL 24 吋螢幕", parentProperty: "ASUS 自組電腦\n（A-002）", status: "已確認", areaName: "會議室", note: "螢幕"},
    ]);

    const decoded = new TextDecoder().decode(buildPropertyExcelXlsx(rows, ["115"], new Date("2026-08-31T05:06:07")));
    assert.match(decoded, /<mergeCells count="1"><mergeCell ref="B2:B3"\/><\/mergeCells>/);
});

test("builds minimal xlsx workbook with annual worksheets and escaped user content", () => {
    const rows = buildPropertyExcelRows({
        "A-001": [
            {
                itemNumber: "1",
                barcode: "A-001",
                propertyName: "A&B <測試>",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                sourceYears: ["115"],
                location: {
                    areaId: null,
                    areaName: null,
                    description: null,
                },
                note: "\"quoted\"",
            },
        ],
    }, ["115"], {
        "115": {
            unknown: ["A-001"],
            checked: [],
            pending: [],
        },
    });
    const xlsx = buildPropertyExcelXlsx(rows, ["115"], new Date("2026-08-31T05:06:07"));
    const decoded = new TextDecoder().decode(xlsx);

    assert.equal(xlsx[0], 0x50);
    assert.equal(xlsx[1], 0x4b);
    assert.match(decoded, /xl\/worksheets\/sheet1\.xml/);
    assert.match(decoded, /xl\/styles\.xml/);
    assert.match(decoded, /name="115年度"/);
    assert.match(decoded, /A&amp;B &lt;測試&gt;/);
    assert.match(decoded, /&quot;quoted&quot;/);
    assert.match(decoded, /盤點狀態/);
    assert.match(decoded, /<c r="E1" s="1" t="inlineStr">/);
    assert.match(decoded, /<c r="E2" s="2" t="inlineStr">/);
    assert.match(decoded, /<c r="C2" s="5" t="inlineStr">/);
    assert.match(decoded, /<cellXfs count="6">/);
    assert.doesNotMatch(decoded, /同財編實體序號/);
    assert.doesNotMatch(decoded, /匯入年度/);
    assert.doesNotMatch(decoded, /位置區域 ID/);
    assert.doesNotMatch(decoded, /照片數/);
    assert.doesNotMatch(decoded, /建立時間/);
    assert.doesNotMatch(decoded, /更新時間/);
});

test("uses a meaningful xlsx filename", () => {
    assert.equal(
        getPropertyExcelFileName(new Date("2026-08-31T05:06:07")),
        "財產清點資料_20260831-050607.xlsx",
    );
});
