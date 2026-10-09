import assert from "node:assert/strict";
import test from "node:test";
import type {AreaLayout} from "../handlers/areaLayout.ts";
import {
    buildPropertyReportDetailsHtml,
    buildPropertyReportDetailsPageHtml,
    buildPropertyReportHtml,
    buildPropertyReportRows,
    getAreaLayoutReportOrientation,
    getPropertyReportSummary,
    paginatePropertyReportRows,
} from "../handlers/propertyReportHtml.ts";
import type {PropertyItemsByBarcode} from "../handlers/propertyItemStore.ts";

const itemsByBarcode: PropertyItemsByBarcode = {
    "3140101-03-40745": [
        {
            itemNumber: "8",
            barcode: "3140101-03-40745",
            propertyName: "桌上型電腦",
            custodianName: "王小明",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            sourceYears: ["114", "115"],
            itemNumbersByYear: {"114": "3", "115": "8"},
            location: {areaId: "area-a", areaName: "辦公區", description: "靠窗第一桌"},
            note: "螢幕有刮痕 & 待確認",
            tags: ["機房設備", "GPU <Server>"],
            photos: [{
                id: "photo-a",
                uri: "file:///photo-a.jpg",
                fileName: "photo-a.jpg",
                mimeType: "image/jpeg",
                width: 800,
                height: 600,
                size: 12000,
                createdAt: "2026-01-03T00:00:00.000Z",
            }],
        },
        {
            itemNumber: "9",
            barcode: "3140101-03-40745",
            propertyName: "桌上型電腦（二）",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            sourceYears: ["115"],
            location: {areaId: null, areaName: null, description: null},
            note: null,
        },
    ],
};

const portraitLayout: AreaLayout = {
    importedAt: "2026-01-01T00:00:00.000Z",
    page: {width: 600, height: 900},
    areas: [
        {
            id: "area-a",
            name: "辦公區",
            sourceValue: "辦公區",
            style: "rounded=1",
            shape: "rectangle",
            dashed: false,
            rounded: true,
            x: 50,
            y: 100,
            width: 500,
            height: 300,
        },
        {
            id: "area-b",
            name: "超級長的會議空間名稱",
            sourceValue: "超級長的會議空間名稱",
            style: "",
            shape: "rectangle",
            dashed: false,
            rounded: false,
            x: 50,
            y: 450,
            width: 90,
            height: 80,
        },
    ],
};

test("builds annual report rows per entity and expands legacy barcode statuses", () => {
    const rows = buildPropertyReportRows(itemsByBarcode, "115", {
        unknown: [],
        checked: ["3140101-03-40745"],
        pending: [],
    }, new Map([["photo-a", "data:image/jpeg;base64,abc123"]]));

    assert.equal(rows.length, 2);
    assert.equal(rows[0].itemNumber, "8");
    assert.equal(rows[0].status, "checked");
    assert.equal(rows[1].status, "checked");
    assert.deepEqual(rows[0].tags, ["機房設備", "GPU <Server>"]);
    assert.equal(rows[0].photos[0].dataUri, "data:image/jpeg;base64,abc123");
    assert.deepEqual(getPropertyReportSummary(rows), {total: 2, unknown: 0, checked: 2, pending: 0});
});

test("uses the layout aspect ratio for the first page and keeps report pages landscape", () => {
    const rows = buildPropertyReportRows(itemsByBarcode, "115", {
        unknown: ["3140101-03-40745::entity:0"],
        checked: [],
        pending: ["3140101-03-40745::entity:1"],
    }, new Map([["photo-a", "data:image/jpeg;base64,abc123"]]));
    const html = buildPropertyReportHtml({
        year: "115",
        rows,
        layout: portraitLayout,
        generatedAt: new Date("2026-09-27T08:30:00"),
    });

    assert.equal(getAreaLayoutReportOrientation(portraitLayout), "portrait");
    assert.match(html, /@page \{ size: A4 landscape;/);
    assert.match(html, /@page:first \{ size: A4 portrait;/);
    assert.match(html, /辦公區/);
    assert.match(html, /螢幕有刮痕 &amp; 待確認/);
    assert.match(html, />備註與分類</);
    assert.match(html, /<span class="property-tag"># 機房設備<\/span>/);
    assert.match(html, /<span class="property-tag"># GPU &lt;Server&gt;<\/span>/);
    assert.ok(html.indexOf("螢幕有刮痕 &amp; 待確認") < html.indexOf("# 機房設備"));
    assert.equal((html.match(/class="property-tag-line"/g) ?? []).length, 2);
    assert.match(html, /data:image\/jpeg;base64,abc123/);
    assert.match(html, /status-pending/);
    assert.ok((html.match(/<tspan/g) ?? []).length > portraitLayout.areas.length);
    assert.equal((html.match(/font-size="14"/g) ?? []).length, portraitLayout.areas.length);
    assert.doesNotMatch(html, /dominant-baseline=/);
    assert.match(html, />財產照片</);
    assert.match(html, /aspect-ratio: 1 \/ 1/);
    assert.match(html, /page-break-inside: avoid !important/);
    assert.doesNotMatch(html, /現場照片|未填寫|<figcaption>|共 2 個財產實體/);

    const detailsHtml = buildPropertyReportDetailsHtml({
        year: "115",
        rows,
        layout: portraitLayout,
        detailsPageMargin: "11mm",
    });
    assert.match(detailsHtml, /@page \{ size: A4 landscape; margin: 11mm; \}/);
});

test("uses landscape for a wide area layout", () => {
    const wideLayout: AreaLayout = {
        ...portraitLayout,
        page: {width: 1000, height: 500},
    };

    assert.equal(getAreaLayoutReportOrientation(wideLayout), "landscape");
});

test("paginates fixed-height rows into independent closed tables", () => {
    const baseRows = buildPropertyReportRows(itemsByBarcode, "115", {
        unknown: ["3140101-03-40745::entity:0", "3140101-03-40745::entity:1"],
        checked: [],
        pending: [],
    }, new Map([["photo-a", "data:image/jpeg;base64,abc123"]]));
    const noPhotoRows = Array.from({length: 18}, (_, index) => ({
        ...baseRows[1],
        entityKey: `no-photo-${index}`,
    }));
    const noPhotoPages = paginatePropertyReportRows(noPhotoRows);

    assert.deepEqual(noPhotoPages.map((page) => page.length), [6, 7, 5]);

    const photoRows = Array.from({length: 7}, (_, index) => ({
        ...baseRows[0],
        entityKey: `photo-${index}`,
    }));
    assert.deepEqual(paginatePropertyReportRows(photoRows).map((page) => page.length), [4, 3]);

    const html = buildPropertyReportDetailsHtml({
        year: "115",
        rows: noPhotoRows,
        layout: portraitLayout,
    });
    assert.equal((html.match(/<section class="report-page/g) ?? []).length, 3);
    assert.equal((html.match(/<table>/g) ?? []).length, 3);
    assert.equal((html.match(/<\/table>/g) ?? []).length, 3);
    assert.equal((html.match(/class="report-header"/g) ?? []).length, 1);
    assert.equal((html.match(/<tr class="report-row report-row-no-photo"/g) ?? []).length, 18);

    const singlePageHtml = buildPropertyReportDetailsPageHtml({
        year: "115",
        rows: noPhotoRows,
        layout: portraitLayout,
    }, noPhotoPages[1], false);
    assert.equal((singlePageHtml.match(/<section class="report-page/g) ?? []).length, 1);
    assert.equal((singlePageHtml.match(/<table>/g) ?? []).length, 1);
    assert.doesNotMatch(singlePageHtml, /class="report-header"/);
});
