export type PropertyBarcodeLookupMatch = {
    barcode: string;
    matchType: "exact" | "compact" | "same-prefix-padded-tail" | "unique-padded-tail";
};

const BARCODE_SEPARATOR_PATTERN = /[-,，\s]+/;

function hasOwnKey<T>(source: Record<string, T>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(source, key);
}

export function normalizeBarcodeCompact(value: string): string {
    return value.replace(/[-,，\s]/g, "");
}

function normalizeNumericTail(value: string): string | null {
    if (!/^\d+$/.test(value)) return null;

    return value.replace(/^0+/, "") || "0";
}

function parseBarcodeSegments(value: string): {segments: string[]; tail: string | null; prefix: string} | null {
    const segments = value.trim().split(BARCODE_SEPARATOR_PATTERN).filter(Boolean);
    if (segments.length === 0) return null;

    const tail = normalizeNumericTail(segments[segments.length - 1]);
    return {
        segments,
        tail,
        prefix: segments.slice(0, -1).join("-"),
    };
}

export function findPropertyBarcodeLookupMatch<T>(
    itemsByBarcode: Record<string, T>,
    barcode: string,
): PropertyBarcodeLookupMatch | null {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return null;

    if (hasOwnKey(itemsByBarcode, trimmedBarcode)) {
        return {barcode: trimmedBarcode, matchType: "exact"};
    }

    const compactBarcode = normalizeBarcodeCompact(trimmedBarcode);
    const compactMatches = Object.keys(itemsByBarcode).filter((candidate) => (
        normalizeBarcodeCompact(candidate) === compactBarcode
    ));
    if (compactMatches.length === 1) {
        return {barcode: compactMatches[0], matchType: "compact"};
    }

    const parsedBarcode = parseBarcodeSegments(trimmedBarcode);
    if (!parsedBarcode?.tail) return null;

    const samePrefixMatches = Object.keys(itemsByBarcode).filter((candidate) => {
        const parsedCandidate = parseBarcodeSegments(candidate);
        return parsedCandidate?.tail === parsedBarcode.tail
            && parsedCandidate.prefix === parsedBarcode.prefix
            && parsedCandidate.segments.length === parsedBarcode.segments.length;
    });
    if (samePrefixMatches.length === 1) {
        return {barcode: samePrefixMatches[0], matchType: "same-prefix-padded-tail"};
    }

    const tailMatches = Object.keys(itemsByBarcode).filter((candidate) => (
        parseBarcodeSegments(candidate)?.tail === parsedBarcode.tail
    ));
    if (tailMatches.length === 1) {
        return {barcode: tailMatches[0], matchType: "unique-padded-tail"};
    }

    return null;
}

export function propertyBarcodeMatchesSearchQuery(barcode: string, query: string): boolean {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return true;

    const compactQuery = normalizeBarcodeCompact(trimmedQuery);
    if (compactQuery.length >= 4 && normalizeBarcodeCompact(barcode).includes(compactQuery)) {
        return true;
    }

    const parsedQuery = parseBarcodeSegments(trimmedQuery);
    const parsedBarcode = parseBarcodeSegments(barcode);
    if (!parsedQuery?.tail || !parsedBarcode?.tail) return false;

    const queryHasPrefix = parsedQuery.segments.length > 1;
    const sameTail = parsedBarcode.tail === parsedQuery.tail;
    if (!sameTail) return false;

    return queryHasPrefix
        ? parsedBarcode.prefix === parsedQuery.prefix || parsedQuery.tail.length >= 3
        : parsedQuery.tail.length >= 3;
}
