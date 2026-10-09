import assert from "node:assert/strict";
import test from "node:test";
import {mergePdfBytes} from "../handlers/pdfMerge.ts";

function createSinglePagePdf(width: number, height: number, label: string): Uint8Array {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
        `<< /Length ${label.length} >>\nstream\n${label}\nendstream`,
    ];
    let source = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((body, index) => {
        offsets.push(source.length);
        source += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = source.length;
    source += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Uint8Array.from(source, (character) => character.charCodeAt(0));
}

function toAscii(bytes: Uint8Array): string {
    return String.fromCharCode(...bytes);
}

test("merges portrait and landscape PDFs without changing either MediaBox", () => {
    const merged = toAscii(mergePdfBytes([
        createSinglePagePdf(595.3, 841.9, "portrait-content"),
        createSinglePagePdf(841.9, 595.3, "landscape-content"),
    ]));

    assert.match(merged, /\/Count 2/);
    assert.match(merged, /\/MediaBox \[0 0 595\.3 841\.9\]/);
    assert.match(merged, /\/MediaBox \[0 0 841\.9 595\.3\]/);
    assert.match(merged, /portrait-content/);
    assert.match(merged, /landscape-content/);
    assert.equal((merged.match(/\/Type \/Catalog/g) ?? []).length, 1);
    assert.match(merged, /xref\n0 \d+/);
});

test("rejects PDF object streams instead of returning a corrupt file", () => {
    const source = `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /Type /ObjStm /N 0 /First 0 /Length 0 >>\nstream\n\nendstream\nendobj\n%%EOF`;

    assert.throws(
        () => mergePdfBytes([Uint8Array.from(source, (character) => character.charCodeAt(0))]),
        /壓縮物件格式/,
    );
});
