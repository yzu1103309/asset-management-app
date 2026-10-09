type PdfObject = {
    oldId: number;
    body: string;
    prefix: string;
    isCatalog: boolean;
    isPages: boolean;
    isPage: boolean;
    isXref: boolean;
};

type ParsedPdf = {
    objects: PdfObject[];
    rootPagesObjectId: number;
    pageCount: number;
};

const OBJECT_HEADER_PATTERN = /(^|[\r\n])(\d+)\s+(\d+)\s+obj(?:\s|$)/gm;

function bytesToBinaryString(bytes: Uint8Array): string {
    const chunks: string[] = [];
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
    }

    return chunks.join("");
}

function binaryStringToBytes(value: string): Uint8Array {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
    return bytes;
}

function getObjectPrefix(body: string): string {
    const streamMatch = /\bstream(?:\r\n|\n|\r)/.exec(body);
    return streamMatch ? body.slice(0, streamMatch.index) : body;
}

function parsePdf(bytes: Uint8Array): ParsedPdf {
    const source = bytesToBinaryString(bytes);
    if (!source.startsWith("%PDF-")) throw new Error("無法合併非 PDF 格式的檔案。");

    const headers: {oldId: number; headerStart: number; bodyStart: number}[] = [];
    OBJECT_HEADER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OBJECT_HEADER_PATTERN.exec(source)) !== null) {
        headers.push({
            oldId: Number(match[2]),
            headerStart: match.index + match[1].length,
            bodyStart: OBJECT_HEADER_PATTERN.lastIndex,
        });
    }
    if (headers.length === 0) throw new Error("PDF 內容中找不到可合併的頁面物件。");

    const objects = headers.flatMap((header, index) => {
        const nextHeaderStart = headers[index + 1]?.headerStart ?? source.length;
        const objectEnd = source.lastIndexOf("endobj", nextHeaderStart);
        if (objectEnd < header.bodyStart) return [];

        const body = source.slice(header.bodyStart, objectEnd).replace(/^[\r\n]+|[\r\n]+$/g, "");
        const prefix = getObjectPrefix(body);
        const isCatalog = /\/Type\s*\/Catalog\b/.test(prefix);
        const isPages = /\/Type\s*\/Pages\b/.test(prefix);
        const isPage = /\/Type\s*\/Page\b/.test(prefix) && !isPages;
        const isXref = /\/Type\s*\/XRef\b/.test(prefix);

        if (/\/Type\s*\/ObjStm\b/.test(prefix)) {
            throw new Error("此裝置產生的 PDF 使用不支援的壓縮物件格式，無法合併盤點報告。");
        }

        return [{
            oldId: header.oldId,
            body,
            prefix,
            isCatalog,
            isPages,
            isPage,
            isXref,
        } satisfies PdfObject];
    });
    const catalog = objects.find((object) => object.isCatalog);
    const rootPagesObjectId = Number(catalog?.prefix.match(/\/Pages\s+(\d+)\s+\d+\s+R/)?.[1]);
    if (!catalog || !Number.isInteger(rootPagesObjectId)) {
        throw new Error("PDF 頁面結構不完整，無法合併盤點報告。");
    }

    return {
        objects,
        rootPagesObjectId,
        pageCount: objects.filter((object) => object.isPage).length,
    };
}

function rewriteObjectReferences(body: string, objectIds: Map<number, number>): string {
    const streamMatch = /\bstream(?:\r\n|\n|\r)/.exec(body);
    const prefixEnd = streamMatch?.index ?? body.length;
    const prefix = body.slice(0, prefixEnd).replace(/(\d+)\s+(\d+)\s+R\b/g, (reference, objectIdValue: string) => {
        const nextObjectId = objectIds.get(Number(objectIdValue));
        return nextObjectId ? `${nextObjectId} 0 R` : reference;
    });

    return prefix + body.slice(prefixEnd);
}

function appendParentReference(body: string, parentObjectId: number): string {
    const streamMatch = /\bstream(?:\r\n|\n|\r)/.exec(body);
    const prefixEnd = streamMatch?.index ?? body.length;
    const dictionaryEnd = body.lastIndexOf(">>", prefixEnd);
    if (dictionaryEnd < 0) throw new Error("PDF 頁面樹格式不完整，無法合併盤點報告。");

    return `${body.slice(0, dictionaryEnd)} /Parent ${parentObjectId} 0 R\n${body.slice(dictionaryEnd)}`;
}

/**
 * Merges PDFs produced by Expo Print while retaining each page's original MediaBox.
 * Expo's iOS and Android renderers currently emit direct PDF objects; compressed
 * object streams are rejected explicitly instead of returning a corrupt report.
 */
export function mergePdfBytes(pdfFiles: Uint8Array[]): Uint8Array {
    if (pdfFiles.length === 0) throw new Error("沒有可合併的 PDF 檔案。");
    const parsedPdfs = pdfFiles.map(parsePdf);
    const objectIdMaps: Map<number, number>[] = [];
    let nextObjectId = 1;

    parsedPdfs.forEach((pdf) => {
        const objectIds = new Map<number, number>();
        pdf.objects.forEach((object) => {
            if (object.isCatalog || object.isXref) return;
            objectIds.set(object.oldId, nextObjectId);
            nextObjectId += 1;
        });
        objectIdMaps.push(objectIds);
    });

    const mergedPagesObjectId = nextObjectId;
    const mergedCatalogObjectId = nextObjectId + 1;
    const objectBodies = new Map<number, string>();
    const rootPageTreeIds: number[] = [];

    parsedPdfs.forEach((pdf, pdfIndex) => {
        const objectIds = objectIdMaps[pdfIndex];
        const rootPageTreeId = objectIds.get(pdf.rootPagesObjectId);
        if (!rootPageTreeId) throw new Error("PDF 頁面樹無法對應到合併檔案。");
        rootPageTreeIds.push(rootPageTreeId);

        pdf.objects.forEach((object) => {
            if (object.isCatalog || object.isXref) return;
            const nextId = objectIds.get(object.oldId);
            if (!nextId) return;

            let body = rewriteObjectReferences(object.body, objectIds);
            if (object.oldId === pdf.rootPagesObjectId) {
                body = appendParentReference(body, mergedPagesObjectId);
            }
            objectBodies.set(nextId, body);
        });
    });

    const totalPageCount = parsedPdfs.reduce((count, pdf) => count + pdf.pageCount, 0);
    objectBodies.set(
        mergedPagesObjectId,
        `<< /Type /Pages /Kids [${rootPageTreeIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${totalPageCount} >>`,
    );
    objectBodies.set(mergedCatalogObjectId, `<< /Type /Catalog /Pages ${mergedPagesObjectId} 0 R >>`);

    let output = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
    const offsets = new Map<number, number>();
    [...objectBodies.entries()].sort(([a], [b]) => a - b).forEach(([objectId, body]) => {
        offsets.set(objectId, output.length);
        output += `${objectId} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = output.length;
    const size = mergedCatalogObjectId + 1;
    output += `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let objectId = 1; objectId < size; objectId += 1) {
        const offset = offsets.get(objectId);
        output += offset === undefined
            ? "0000000000 00000 f \n"
            : `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${size} /Root ${mergedCatalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return binaryStringToBytes(output);
}
