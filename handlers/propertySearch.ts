import Fuse, {type IFuseOptions} from "fuse.js";
import type {AnnualPropertyListItem} from "./propertyList.ts";
import {normalizeBarcodeCompact, propertyBarcodeMatchesSearchQuery} from "./propertyBarcode.ts";

const SEARCH_OPTIONS: IFuseOptions<AnnualPropertyListItem> = {
    keys: [
        {name: "propertyName", weight: 0.75},
        {name: "itemNumber", weight: 0.25},
    ],
    threshold: 0.35,
    ignoreLocation: true,
};
const BARCODE_FRAGMENT_MIN_DIGITS = 3;

function isBarcodeSearchQuery(value: string): boolean {
    const normalizedValue = normalizeBarcodeCompact(value);
    return normalizedValue.length >= BARCODE_FRAGMENT_MIN_DIGITS && /^\d+$/.test(normalizedValue) && /^[\d\s,，-]+$/.test(value);
}

export function searchPropertyItems(query: string, items: AnnualPropertyListItem[]): AnnualPropertyListItem[] {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return items;

    if (isBarcodeSearchQuery(trimmedQuery)) {
        return items.filter((item) => propertyBarcodeMatchesSearchQuery(item.barcode, trimmedQuery));
    }

    return new Fuse(items, SEARCH_OPTIONS)
        .search(trimmedQuery)
        .map((result) => result.item);
}
