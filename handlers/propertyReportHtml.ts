import {
    getPropertyItemByEntityKey,
    getPropertyItemDisplayName,
    getPropertyItemDisplayNumber,
    type PropertyItemsByBarcode,
} from "./propertyItemStore.ts";
import {
    expandLegacyAnnualStatusEntries,
    parsePropertyStatusEntryKey,
    PROPERTY_STATUS_VALUES,
    type PropertyStatus,
} from "./propertyStatusStore.ts";
import {itemExistsInPropertyYear} from "./propertyYears.ts";
import type {AreaLayout, AreaLayoutArea} from "./areaLayout.ts";
import {getPropertyTagsForCard} from "./propertyTagging.ts";

export type PropertyReportPhoto = {
    dataUri: string;
    createdAt: string;
};

export type PropertyReportRow = {
    entityKey: string;
    itemNumber: string;
    barcode: string;
    propertyName: string;
    custodianName: string;
    status: PropertyStatus;
    areaName: string;
    locationDescription: string;
    note: string;
    tags: string[];
    parentProperty: string;
    photos: PropertyReportPhoto[];
    hasUnreadablePhotos: boolean;
};

export type PropertyReportSummary = Record<PropertyStatus, number> & {total: number};

export type PropertyReportHtmlOptions = {
    year: string;
    rows: PropertyReportRow[];
    layout: AreaLayout | null;
    generatedAt?: Date;
    kaiuFontDataUri?: string | null;
    timesFontDataUri?: string | null;
    detailsPageMargin?: string;
};

const STATUS_LABELS: Record<PropertyStatus, string> = {
    unknown: "未清點",
    checked: "已確認",
    pending: "待處理",
};
const REPORT_ROW_HEIGHT_MM = 25;
const REPORT_PHOTO_ROW_HEIGHT_MM = 36;
const FIRST_DETAILS_PAGE_ROW_BUDGET_MM = 170;
const CONTINUATION_DETAILS_PAGE_ROW_BUDGET_MM = 180;
const AREA_LABEL_FONT_SIZE = 14;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function compareItemNumber(a: string, b: string): number {
    return a.localeCompare(b, "zh-Hant", {numeric: true, sensitivity: "base"});
}

function getEntityStatusMap(
    itemsByBarcode: PropertyItemsByBarcode,
    statusEntries: Record<PropertyStatus, string[]>,
): Map<string, PropertyStatus> {
    const statuses = new Map<string, PropertyStatus>();

    for (const status of PROPERTY_STATUS_VALUES) {
        const expandedEntries = expandLegacyAnnualStatusEntries(
            statusEntries[status],
            (barcode) => itemsByBarcode[barcode]?.length ?? 0,
        );

        for (const entry of expandedEntries) {
            const parsed = parsePropertyStatusEntryKey(entry);
            if (parsed) statuses.set(`${parsed.barcode}::entity:${parsed.entityIndex}`, status);
        }
    }

    return statuses;
}

function getParentPropertyLabel(
    itemsByBarcode: PropertyItemsByBarcode,
    parentEntityKey: string | null | undefined,
): string {
    const parent = getPropertyItemByEntityKey(itemsByBarcode, parentEntityKey);
    return parent ? `${getPropertyItemDisplayName(parent)}（${parent.barcode}）` : "";
}

export function buildPropertyReportRows(
    itemsByBarcode: PropertyItemsByBarcode,
    year: string,
    statusEntries: Record<PropertyStatus, string[]>,
    photoDataUris: ReadonlyMap<string, string> = new Map(),
): PropertyReportRow[] {
    const statusMap = getEntityStatusMap(itemsByBarcode, statusEntries);
    const rows = Object.entries(itemsByBarcode).flatMap(([barcode, items]) => (
        items.flatMap((item, entityIndex) => {
            if (!itemExistsInPropertyYear(item.sourceYears, year)) return [];

            const entityKey = `${barcode}::entity:${entityIndex}`;
            const itemPhotos = item.photos ?? [];
            const photos = itemPhotos.flatMap((photo) => {
                const dataUri = photoDataUris.get(photo.id);
                return dataUri ? [{dataUri, createdAt: photo.createdAt}] : [];
            });

            return [{
                entityKey,
                itemNumber: getPropertyItemDisplayNumber(item, year),
                barcode,
                propertyName: getPropertyItemDisplayName(item),
                custodianName: item.custodianName ?? "",
                status: statusMap.get(entityKey) ?? "unknown",
                areaName: item.location?.areaName ?? "",
                locationDescription: item.location?.description ?? "",
                note: item.note ?? "",
                tags: getPropertyTagsForCard(item.tags),
                parentProperty: getParentPropertyLabel(itemsByBarcode, item.parentEntityKey),
                photos,
                hasUnreadablePhotos: photos.length < itemPhotos.length,
            } satisfies PropertyReportRow];
        })
    ));

    return rows.sort((a, b) => {
        const itemNumberOrder = compareItemNumber(a.itemNumber, b.itemNumber);
        if (itemNumberOrder !== 0) return itemNumberOrder;

        const barcodeOrder = a.barcode.localeCompare(b.barcode, "zh-Hant", {numeric: true, sensitivity: "base"});
        if (barcodeOrder !== 0) return barcodeOrder;

        return a.entityKey.localeCompare(b.entityKey, "en", {numeric: true});
    });
}

export function getPropertyReportSummary(rows: PropertyReportRow[]): PropertyReportSummary {
    const summary: PropertyReportSummary = {total: rows.length, unknown: 0, checked: 0, pending: 0};
    rows.forEach((row) => {
        summary[row.status] += 1;
    });
    return summary;
}

function getPropertyReportRowHeight(row: PropertyReportRow): number {
    return row.photos.length > 0 ? REPORT_PHOTO_ROW_HEIGHT_MM : REPORT_ROW_HEIGHT_MM;
}

export function paginatePropertyReportRows(rows: PropertyReportRow[]): PropertyReportRow[][] {
    if (rows.length === 0) return [[]];

    const pages: PropertyReportRow[][] = [];
    let currentPage: PropertyReportRow[] = [];
    let usedHeight = 0;
    let pageBudget = FIRST_DETAILS_PAGE_ROW_BUDGET_MM;

    for (const row of rows) {
        const rowHeight = getPropertyReportRowHeight(row);
        if (currentPage.length > 0 && usedHeight + rowHeight > pageBudget) {
            pages.push(currentPage);
            currentPage = [];
            usedHeight = 0;
            pageBudget = CONTINUATION_DETAILS_PAGE_ROW_BUDGET_MM;
        }

        currentPage.push(row);
        usedHeight += rowHeight;
    }

    if (currentPage.length > 0) pages.push(currentPage);
    return pages;
}

function getLayoutBounds(layout: AreaLayout): {minX: number; minY: number; width: number; height: number} {
    const minX = Math.min(0, ...layout.areas.map((area) => area.x));
    const minY = Math.min(0, ...layout.areas.map((area) => area.y));
    const maxX = Math.max(layout.page.width, ...layout.areas.map((area) => area.x + area.width));
    const maxY = Math.max(layout.page.height, ...layout.areas.map((area) => area.y + area.height));
    const padding = Math.max(maxX - minX, maxY - minY) * 0.018;

    return {
        minX: minX - padding,
        minY: minY - padding,
        width: Math.max(maxX - minX + padding * 2, 1),
        height: Math.max(maxY - minY + padding * 2, 1),
    };
}

export function getAreaLayoutReportOrientation(layout: AreaLayout | null): "portrait" | "landscape" {
    if (!layout) return "landscape";
    const bounds = getLayoutBounds(layout);
    return bounds.width > bounds.height ? "landscape" : "portrait";
}

function wrapAreaLabel(label: string, maxCharactersPerLine: number): string[] {
    const remainingCharacters = Array.from(label.replace(/\s+/g, " ").trim());
    const lines: string[] = [];

    while (remainingCharacters.length > 0) {
        if (remainingCharacters.length <= maxCharactersPerLine) {
            lines.push(remainingCharacters.join("").trim());
            break;
        }

        let breakIndex = maxCharactersPerLine;
        const candidate = remainingCharacters.slice(0, maxCharactersPerLine).join("");
        const lastSpace = candidate.lastIndexOf(" ");
        if (lastSpace >= Math.ceil(maxCharactersPerLine * 0.45)) breakIndex = lastSpace;

        lines.push(remainingCharacters.splice(0, breakIndex).join("").trim());
        while (remainingCharacters[0] === " ") remainingCharacters.shift();
    }

    return lines.filter(Boolean);
}

function getAreaLabelLayout(area: AreaLayoutArea, label: string): {fontSize: number; lineHeight: number; lines: string[]} {
    const horizontalPadding = Math.max(3, Math.min(14, area.width * 0.12));
    const verticalPadding = Math.max(3, Math.min(12, area.height * 0.12));
    const availableWidth = Math.max(area.width - horizontalPadding * 2, 1);
    const availableHeight = Math.max(area.height - verticalPadding * 2, 1);

    const lineHeight = AREA_LABEL_FONT_SIZE * 1.22;
    const maxCharactersPerLine = Math.max(1, Math.floor(availableWidth / (AREA_LABEL_FONT_SIZE * 1.05)));
    const maximumLineCount = Math.max(1, Math.floor(availableHeight / lineHeight));
    const wrappedLines = wrapAreaLabel(label, maxCharactersPerLine);

    return {
        fontSize: AREA_LABEL_FONT_SIZE,
        lineHeight,
        lines: wrappedLines.slice(0, maximumLineCount),
    };
}

function renderAreaShape(area: AreaLayoutArea): string {
    const common = `fill="#F8FAFC" stroke="#334155" stroke-width="1.5"${area.dashed ? " stroke-dasharray=\"7 5\"" : ""}`;
    const shape = area.shape === "ellipse"
        ? `<ellipse cx="${area.x + area.width / 2}" cy="${area.y + area.height / 2}" rx="${area.width / 2}" ry="${area.height / 2}" ${common}/>`
        : `<rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="${area.rounded ? Math.min(area.width, area.height) * 0.08 : 0}" ${common}/>`;
    const label = area.name.trim() || "未命名區域";
    const labelLayout = getAreaLabelLayout(area, label);
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    // WebKit does not consistently apply dominant-baseline to tspans with an explicit y.
    // Position the glyph baseline directly so one- and multi-line labels are visually centered.
    const baselineOffset = labelLayout.fontSize * 0.36;
    const firstLineY = centerY - ((labelLayout.lines.length - 1) * labelLayout.lineHeight) / 2 + baselineOffset;
    const labelLines = labelLayout.lines.map((line, index) => (
        `<tspan x="${centerX}" y="${firstLineY + index * labelLayout.lineHeight}">${escapeHtml(line)}</tspan>`
    )).join("");

    return `${shape}<text text-anchor="middle" font-size="${labelLayout.fontSize}" font-weight="700" fill="#0F172A">${labelLines}</text>`;
}

function renderLayout(layout: AreaLayout | null): string {
    if (!layout) {
        return `<div class="layout-empty"><div class="layout-empty-icon">⌑</div><strong>尚未匯入區域配置圖</strong><span>本報告仍包含完整的財產盤點明細。</span></div>`;
    }

    const bounds = getLayoutBounds(layout);
    return `<svg class="layout-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="區域配置圖">
        <rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="#FFFFFF"/>
        ${layout.areas.map(renderAreaShape).join("\n")}
    </svg>`;
}

function renderStatusSummary(summary: PropertyReportSummary): string {
    return `
        <div class="summary-pill summary-total"><span>總數</span><strong>${summary.total}</strong></div>
        <div class="summary-pill summary-checked"><span>已確認</span><strong>${summary.checked}</strong></div>
        <div class="summary-pill summary-pending"><span>待處理</span><strong>${summary.pending}</strong></div>
        <div class="summary-pill summary-unknown"><span>未清點</span><strong>${summary.unknown}</strong></div>`;
}

function formatDateTime(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderPhotos(row: PropertyReportRow): string {
    if (row.photos.length === 0) {
        return row.hasUnreadablePhotos ? `<span class="photo-warning">照片無法讀取</span>` : "";
    }

    return `<div class="photo-grid">${row.photos.map((photo) => (
        `<figure><img src="${photo.dataUri}" alt="${escapeHtml(row.propertyName)}財產照片"/></figure>`
    )).join("")}</div>${row.hasUnreadablePhotos ? `<div class="photo-warning">部分照片無法讀取</div>` : ""}`;
}

function renderText(value: string): string {
    return value.trim() ? escapeHtml(value.trim()).replace(/\r?\n/g, "<br/>") : "";
}

function renderNoteAndTags(row: PropertyReportRow): string {
    const note = renderText(row.note);
    const tags = row.tags.map((tag) => (
        `<div class="property-tag-line"><span class="property-tag"># ${escapeHtml(tag)}</span></div>`
    )).join("");

    return `${note ? `<div class="property-note">${note}</div>` : ""}${tags
        ? `<div class="property-tags${note ? " property-tags-with-note" : ""}">${tags}</div>`
        : ""}`;
}

function renderReportRow(row: PropertyReportRow): string {
    const rowClass = row.photos.length > 0 ? "report-row report-row-with-photo" : "report-row report-row-no-photo";
    return `<tr class="${rowClass}">
        <td class="cell-number"><div class="cell-content">${escapeHtml(row.itemNumber)}</div></td>
        <td class="cell-property">
            <div class="cell-content">
            <strong>${escapeHtml(row.propertyName)}</strong>
            <span class="barcode">${escapeHtml(row.barcode)}</span>
            ${row.parentProperty ? `<span class="parent-property">關聯：${escapeHtml(row.parentProperty)}</span>` : ""}
            </div>
        </td>
        <td class="cell-custodian"><div class="cell-content">${renderText(row.custodianName)}</div></td>
        <td class="cell-status"><div class="cell-content"><span class="status status-${row.status}">${STATUS_LABELS[row.status]}</span></div></td>
        <td class="cell-location"><div class="cell-content"><strong class="area-name">${renderText(row.areaName)}</strong><div class="secondary-text">${renderText(row.locationDescription)}</div></div></td>
        <td class="cell-note"><div class="cell-content">${renderNoteAndTags(row)}</div></td>
        <td class="cell-photos"><div class="cell-content">${renderPhotos(row)}</div></td>
    </tr>`;
}

function renderReportTable(rows: PropertyReportRow[]): string {
    return `<table>
        <colgroup><col class="col-number"/><col class="col-property"/><col class="col-custodian"/><col class="col-status"/><col class="col-location"/><col class="col-note"/><col class="col-photos"/></colgroup>
        <thead><tr><th>項次</th><th>財產資訊</th><th>保管人</th><th>盤點狀態</th><th>存放位置</th><th>備註與分類</th><th>財產照片</th></tr></thead>
        <tbody>${rows.map(renderReportRow).join("\n")}</tbody>
    </table>`;
}

function renderReportPage(
    options: PropertyReportHtmlOptions,
    rows: PropertyReportRow[],
    pageIndex: number,
    generatedAt: Date,
): string {
    return `<section class="report-page${pageIndex === 0 ? " report-page-first" : ""}">
        ${pageIndex === 0 ? `<header class="report-header"><div><h2>${escapeHtml(options.year)} 年度盤點明細</h2></div><div class="report-meta">產生時間<br/>${formatDateTime(generatedAt)}</div></header>` : ""}
        ${renderReportTable(rows)}
    </section>`;
}

function renderReportPages(options: PropertyReportHtmlOptions, generatedAt: Date): string {
    if (options.rows.length === 0) {
        return `<section class="report-page report-page-first"><header class="report-header"><div><h2>${escapeHtml(options.year)} 年度盤點明細</h2></div><div class="report-meta">產生時間<br/>${formatDateTime(generatedAt)}</div></header><div class="empty-report">此年度沒有可輸出的財產項目。</div></section>`;
    }

    const pages = paginatePropertyReportRows(options.rows);
    return pages.map((rows, pageIndex) => renderReportPage(options, rows, pageIndex, generatedAt)).join("\n");
}

type PropertyReportHtmlSection = "all" | "layout" | "details";

function buildPropertyReportHtmlDocument(
    options: PropertyReportHtmlOptions,
    section: PropertyReportHtmlSection,
    singleDetailsPage?: {rows: PropertyReportRow[]; isFirstPage: boolean},
): string {
    const generatedAt = options.generatedAt ?? new Date();
    const summary = getPropertyReportSummary(options.rows);
    const orientation = getAreaLayoutReportOrientation(options.layout);
    const firstPageSize = orientation === "portrait" ? "A4 portrait" : "A4 landscape";
    const firstPageWidth = orientation === "portrait" ? "210mm" : "297mm";
    const firstPageHeight = orientation === "portrait" ? "297mm" : "210mm";
    const detailsPageMargin = options.detailsPageMargin ?? "9mm 8mm 10mm";
    const pageRules = section === "layout"
        ? `@page { size: ${firstPageSize}; margin: 0; }`
        : section === "details"
            ? `@page { size: A4 landscape; margin: ${detailsPageMargin}; }`
            : `@page { size: A4 landscape; margin: ${detailsPageMargin}; }
        @page:first { size: ${firstPageSize}; margin: 0; }`;
    const layoutPageBreak = section === "layout" ? "auto" : "page";
    const fontFaces = [
        options.timesFontDataUri ? `@font-face { font-family: "NCU Report"; src: url("${options.timesFontDataUri}") format("truetype"); unicode-range: U+0000-024F, U+2000-206F; }` : "",
        options.kaiuFontDataUri ? `@font-face { font-family: "NCU Report"; src: url("${options.kaiuFontDataUri}") format("truetype"); unicode-range: U+2E80-2EFF, U+3000-303F, U+31C0-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF; }` : "",
    ].filter(Boolean).join("\n");

    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <style>
        ${fontFaces}
        ${pageRules}
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        html, body { margin: 0; padding: 0; color: #172033; background: #FFFFFF; font-family: "NCU Report", "PingFang TC", "Microsoft JhengHei", sans-serif; }
        .layout-page { width: ${firstPageWidth}; height: ${firstPageHeight}; padding: 10mm 11mm 9mm; display: flex; flex-direction: column; break-after: ${layoutPageBreak}; page-break-after: ${layoutPageBreak === "page" ? "always" : "auto"}; overflow: hidden; background: #FFFFFF; }
        .layout-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 8mm; padding-bottom: 4mm; border-bottom: 1px solid #CBD5E1; }
        .layout-title h1 { margin: 0; font-size: 20pt; line-height: 1.15; letter-spacing: 0.03em; }
        .layout-title p { margin: 1.5mm 0 0; color: #64748B; font-size: 9pt; }
        .summary { display: flex; gap: 2mm; }
        .summary-pill { min-width: 19mm; padding: 1.8mm 2.4mm; border-radius: 2.2mm; display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; font-size: 8pt; }
        .summary-pill strong { font-size: 13pt; }
        .summary-total { background: #E2E8F0; } .summary-checked { background: #DCFCE7; color: #166534; } .summary-pending { background: #FFEDD5; color: #9A3412; } .summary-unknown { background: #F1F5F9; color: #475569; }
        .layout-heading { display: flex; align-items: center; justify-content: space-between; margin: 4mm 0 2.5mm; }
        .layout-heading h2 { margin: 0; font-size: 11pt; }
        .layout-heading span { color: #64748B; font-size: 8pt; }
        .layout-frame { min-height: 0; flex: 1; padding: 2.5mm; border: 1px solid #CBD5E1; border-radius: 3mm; background: #F8FAFC; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .layout-svg { width: 100%; height: 100%; display: block; font-family: "NCU Report", "PingFang TC", "Microsoft JhengHei", sans-serif; }
        .layout-empty { color: #64748B; display: flex; flex-direction: column; align-items: center; gap: 2mm; font-size: 10pt; }
        .layout-empty strong { color: #334155; font-size: 15pt; } .layout-empty-icon { font-size: 36pt; color: #94A3B8; }
        .report-pages { width: 100%; }
        .report-page { width: 100%; break-after: page; page-break-after: always; }
        .report-page:last-child { break-after: auto; page-break-after: auto; }
        .report-header { display: flex; align-items: flex-end; justify-content: space-between; margin: 0 0 4mm; }
        .report-header h2 { margin: 0; font-size: 16pt; } .report-header p { margin: 1mm 0 0; color: #64748B; font-size: 8.5pt; }
        .report-meta { color: #64748B; font-size: 8pt; text-align: right; }
        table { width: 100%; border: 0.25mm solid #CBD5E1; border-radius: 2mm; border-collapse: separate; border-spacing: 0; table-layout: fixed; overflow: hidden; font-size: 8.2pt; }
        thead { display: table-header-group; }
        thead th { padding: 2.2mm 1.5mm; color: #FFFFFF; background: #334155; border-right: 0.3mm solid #64748B; font-weight: 700; line-height: 1.25; text-align: center; }
        thead th:first-child { border-radius: 2mm 0 0 0; } thead th:last-child { border-radius: 0 2mm 0 0; border-right: 0; }
        tbody { break-inside: auto; page-break-inside: auto; }
        tbody tr { break-inside: avoid !important; page-break-inside: avoid !important; }
        tbody td { padding: 2.1mm 1.5mm; vertical-align: middle; border-right: 0.25mm solid #CBD5E1; border-bottom: 0.25mm solid #CBD5E1; line-height: 1.36; overflow-wrap: anywhere; break-inside: avoid !important; page-break-inside: avoid !important; }
        tbody td:last-child { border-right: 0; }
        tbody tr:last-child td { border-bottom: 0; }
        tbody tr:nth-child(even) td { background: #F8FAFC; }
        .report-row-no-photo, .report-row-no-photo td { height: ${REPORT_ROW_HEIGHT_MM}mm; max-height: ${REPORT_ROW_HEIGHT_MM}mm; }
        .report-row-with-photo, .report-row-with-photo td { height: ${REPORT_PHOTO_ROW_HEIGHT_MM}mm; max-height: ${REPORT_PHOTO_ROW_HEIGHT_MM}mm; }
        .cell-content { width: 100%; max-height: ${REPORT_ROW_HEIGHT_MM - 4.2}mm; overflow: hidden; }
        .report-row-with-photo .cell-content { max-height: ${REPORT_PHOTO_ROW_HEIGHT_MM - 4.2}mm; }
        .col-number { width: 5%; } .col-property { width: 19%; } .col-custodian { width: 8%; } .col-status { width: 7%; } .col-location { width: 11%; } .col-note { width: 12%; } .col-photos { width: 38%; }
        .cell-number, .cell-status { text-align: center; } .cell-property strong { display: block; color: #0F172A; font-size: 9pt; }
        .barcode { display: block; margin-top: 1mm; color: #334155; font-family: "Times New Roman", monospace; font-size: 8.3pt; }
        .parent-property { display: block; margin-top: 1mm; color: #64748B; font-size: 7.2pt; }
        .status { display: inline-block; min-width: 15mm; padding: 1.2mm 1.5mm; border-radius: 10mm; font-weight: 700; white-space: nowrap; }
        .status-checked { color: #166534; background: #DCFCE7; } .status-pending { color: #9A3412; background: #FFEDD5; } .status-unknown { color: #475569; background: #E2E8F0; }
        .cell-custodian, .cell-location, .cell-note, .cell-photos { text-align: center; }
        .area-name { display: block; color: #0F172A; } .secondary-text { margin-top: 1mm; color: #475569; }
        .property-note { color: #334155; }
        .property-tags-with-note { margin-top: 1.2mm; }
        .property-tag-line { display: block; margin-top: 0.7mm; text-align: center; }
        .property-tag-line:first-child { margin-top: 0; }
        .property-tag { display: inline-block; max-width: 100%; padding: 0.45mm 1.3mm; border-radius: 10mm; color: #1D4ED8; background: #DBEAFE; font-size: 6.8pt; font-weight: 700; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .photo-grid { display: flex; align-items: center; justify-content: center; gap: 1.6mm; }
        figure { width: calc((100% - 3.2mm) / 3); max-width: 31mm; aspect-ratio: 1 / 1; margin: 0; overflow: hidden; border: 0.25mm solid #CBD5E1; border-radius: 1.5mm; background: #FFFFFF; }
        figure img { width: 100%; aspect-ratio: 1 / 1; display: block; object-fit: cover; }
        .photo-warning { margin-top: 1mm; color: #B45309; font-size: 6.5pt; }
        .empty-report { padding: 30mm; border: 1px solid #CBD5E1; border-radius: 3mm; color: #64748B; text-align: center; }
    </style>
</head>
<body>
    ${section !== "details" ? `<section class="layout-page ${orientation}">
        <header class="layout-header">
            <div class="layout-title"><h1>${escapeHtml(options.year)} 年度財產盤點報告</h1><p>完整區域配置與盤點概況</p></div>
            <div class="summary">${renderStatusSummary(summary)}</div>
        </header>
        <div class="layout-heading"><h2>區域配置圖</h2><span>${options.layout ? `共 ${options.layout.areas.length} 個區域` : "無配置圖資料"}</span></div>
        <div class="layout-frame">${renderLayout(options.layout)}</div>
    </section>` : ""}
    ${section !== "layout" ? `<main class="report-pages">${singleDetailsPage
        ? renderReportPage(options, singleDetailsPage.rows, singleDetailsPage.isFirstPage ? 0 : 1, generatedAt)
        : renderReportPages(options, generatedAt)}</main>` : ""}
</body>
</html>`;
}

export function buildPropertyReportHtml(options: PropertyReportHtmlOptions): string {
    return buildPropertyReportHtmlDocument(options, "all");
}

export function buildPropertyReportLayoutHtml(options: PropertyReportHtmlOptions): string {
    return buildPropertyReportHtmlDocument(options, "layout");
}

export function buildPropertyReportDetailsHtml(options: PropertyReportHtmlOptions): string {
    return buildPropertyReportHtmlDocument(options, "details");
}

export function buildPropertyReportDetailsPageHtml(
    options: PropertyReportHtmlOptions,
    rows: PropertyReportRow[],
    isFirstPage: boolean,
): string {
    return buildPropertyReportHtmlDocument(options, "details", {rows, isFirstPage});
}
