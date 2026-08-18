import type {PropertyItem, PropertyItemsByBarcode} from "./propertyItemStore.ts";
import VendorQRCodeModule from "qrcode-terminal/vendor/QRCode/index.js";
import VendorQRErrorCorrectLevelModule from "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js";

export type PropertyLabelPrintItem = Pick<PropertyItem, "barcode" | "itemNumber" | "propertyName">;
type VendorQrCodeInstance = {
    addData: (data: string) => void;
    make: () => void;
    getModuleCount: () => number;
    isDark: (row: number, col: number) => boolean;
};
type VendorQrCodeConstructor = new (typeNumber: number, errorCorrectLevel: number) => VendorQrCodeInstance;
const VendorQRCode = VendorQRCodeModule as VendorQrCodeConstructor;
const VendorQRErrorCorrectLevel = VendorQRErrorCorrectLevelModule as {L: number};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function compareItemNumber(a: string, b: string): number {
    const numberA = Number(a);
    const numberB = Number(b);
    if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) return numberA - numberB;

    return a.localeCompare(b, "zh-Hant");
}

export function getPropertyLabelPrintItems(
    itemsByBarcode: PropertyItemsByBarcode,
    barcodeFilter?: string[],
): PropertyLabelPrintItem[] {
    const filterSet = barcodeFilter ? new Set(barcodeFilter) : null;
    const items = Object.values(itemsByBarcode)
        .flat()
        .filter((item) => !filterSet || filterSet.has(item.barcode))
        .map((item) => ({
            barcode: item.barcode,
            itemNumber: item.itemNumber,
            propertyName: item.propertyName,
        }));

    return items.sort((a, b) => compareItemNumber(a.itemNumber, b.itemNumber));
}

export function makeQrSvg(text: string): string {
    const qrCode = new VendorQRCode(-1, VendorQRErrorCorrectLevel.L);
    qrCode.addData(text);
    qrCode.make();

    const moduleCount = qrCode.getModuleCount();
    const rects: string[] = [];
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (qrCode.isDark(row, col)) {
                rects.push(`<rect x="${col}" y="${row}" width="1" height="1"/>`);
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${moduleCount} ${moduleCount}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#FFFFFF"/><g fill="#000000">${rects.join("")}</g></svg>`;
}

function renderLabel(item: PropertyLabelPrintItem): string {
    return `
        <div class="label">
            <div class="label-text">
                <div class="label-title">盤點專用標籤</div>
                <div class="label-row">
                    <span class="label-field">編號：</span>
                    <span class="label-value">${escapeHtml(item.barcode)}</span>
                </div>
                <div class="label-row label-name-row">
                    <span class="label-field">品名：</span>
                    <span class="label-value label-name">${escapeHtml(item.propertyName)}</span>
                </div>
            </div>
            <div class="qr-code">${makeQrSvg(item.barcode)}</div>
        </div>
    `;
}

export function buildPropertyLabelPrintHtml(
    items: PropertyLabelPrintItem[],
    options: {kaiuFontDataUri?: string | null; timesFontDataUri?: string | null} = {},
): string {
    const labelsHtml = items.map(renderLabel).join("");
    const fontFaces = [
        options.timesFontDataUri
            ? `@font-face {
            font-family: "NCU Label";
            src: url("${options.timesFontDataUri}") format("truetype");
            font-weight: normal;
            font-style: normal;
            unicode-range: U+0000-024F, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2200-22FF;
        }`
            : "",
        options.kaiuFontDataUri
            ? `@font-face {
            font-family: "NCU Label";
            src: url("${options.kaiuFontDataUri}") format("truetype");
            font-weight: normal;
            font-style: normal;
            unicode-range: U+2E80-2EFF, U+3000-303F, U+31C0-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF;
        }`
            : "",
    ].filter(Boolean).join("\n");

    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        ${fontFaces}
        @page {
            size: A4 portrait;
            margin: 0;
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        html,
        body {
            width: 21cm;
            min-height: 29.7cm;
            margin: 0;
            padding: 0;
            background: #FFFFFF;
            color: #000000;
            font-family: "NCU Label", "DFKai-SB", "KaiTi", "BiauKai", "Times New Roman", serif;
        }
        .sheet {
            width: 21cm;
            display: grid;
            grid-template-columns: repeat(3, 7cm);
            grid-auto-rows: 3.3cm;
        }
        .label {
            width: 7cm;
            height: 3.3cm;
            padding: 0.18cm 0.45cm;
            display: flex;
            align-items: center;
            justify-content: space-between;
            overflow: hidden;
        }
        .label-text {
            min-width: 0;
            flex: 1;
            padding-right: 0.2cm;
            line-height: 1.18;
        }
        .label-title {
            margin-bottom: 0.16cm;
            font-size: 12.2pt;
            letter-spacing: 0.04em;
        }
        .label-row {
            display: flex;
            align-items: flex-start;
            font-size: 9.2pt;
            line-height: 1.24;
        }
        .label-field {
            flex: 0 0 2.8em;
            white-space: nowrap;
        }
        .label-value {
            min-width: 0;
            flex: 1;
        }
        .label-name-row {
            margin-top: 0.08cm;
        }
        .label-name {
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .qr-code {
            width: 1.5cm;
            height: 1.5cm;
            flex: 0 0 1.5cm;
            margin-left: 0.08cm;
            background: #FFFFFF;
        }
        .qr-code svg {
            width: 1.5cm;
            height: 1.5cm;
            display: block;
        }
    </style>
</head>
<body><main class="sheet">${labelsHtml}</main></body>
</html>`;
}
