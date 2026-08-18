import Fuse, {type IFuseOptions} from "fuse.js";
import type {AnnualPropertyListItem} from "./propertyList.ts";

const SEARCH_OPTIONS: IFuseOptions<AnnualPropertyListItem> = {
    keys: [
        {name: "propertyName", weight: 0.75},
        {name: "itemNumber", weight: 0.25},
    ],
    threshold: 0.35,
    ignoreLocation: true,
};
const BARCODE_FRAGMENT_MIN_DIGITS = 4;

function normalizeBarcode(value: string): string {
    return value.replace(/[-,，\s]/g, "");
}

function isBarcodeSearchQuery(value: string): boolean {
    const normalizedValue = normalizeBarcode(value);
    return normalizedValue.length >= BARCODE_FRAGMENT_MIN_DIGITS && /^\d+$/.test(normalizedValue) && /^[\d\s,，-]+$/.test(value);
}

export function searchPropertyItems(query: string, items: AnnualPropertyListItem[]): AnnualPropertyListItem[] {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return items;

    if (isBarcodeSearchQuery(trimmedQuery)) {
        const normalizedQuery = normalizeBarcode(trimmedQuery);
        return items.filter((item) => normalizeBarcode(item.barcode).includes(normalizedQuery));
    }

    return new Fuse(items, SEARCH_OPTIONS)
        .search(trimmedQuery)
        .map((result) => result.item);
}
