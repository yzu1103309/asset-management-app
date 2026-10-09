import Fuse, {type IFuseOptions} from "fuse.js";
import type {AnnualPropertyListItem} from "./propertyList.ts";
import {normalizeBarcodeCompact, propertyBarcodeMatchesSearchQuery} from "./propertyBarcode.ts";
import {propertyItemHasTag} from "./propertyTagging.ts";

const SEARCH_OPTIONS: IFuseOptions<AnnualPropertyListItem> = {
    keys: [
        {name: "propertyName", weight: 0.6},
        {name: "itemNumber", weight: 0.2},
        {name: "note", weight: 0.2},
        {name: "tags", weight: 0.35},
    ],
    threshold: 0.35,
    ignoreLocation: true,
};
const BARCODE_FRAGMENT_MIN_DIGITS = 3;

function normalizeSearchText(value: string | null | undefined): string {
    return (value ?? "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeSearchQuery(value: string): string {
    return normalizeSearchText(value).replace(/(^|\s)#\s*/g, "$1").trim();
}

function getTokenMatchScore(
    item: AnnualPropertyListItem,
    normalizedQuery: string,
    queryTokens: string[],
): number | null {
    const fields = [item.propertyName, item.itemNumber, item.note, ...(item.tags ?? [])]
        .map(normalizeSearchText)
        .filter(Boolean);

    if (fields.some((field) => field.includes(normalizedQuery))) return 0;

    const sameFieldSpans = fields.flatMap((field) => {
        const positions = queryTokens.map((token) => field.indexOf(token));
        if (positions.some((position) => position < 0)) return [];

        return [Math.max(...positions) - Math.min(...positions)];
    });
    if (sameFieldSpans.length > 0) {
        return 1 + Math.min(...sameFieldSpans) / 10_000;
    }

    const allTokensMatch = queryTokens.every((token) => (
        fields.some((field) => field.includes(token))
    ));

    return allTokensMatch ? 2 : null;
}

function isBarcodeSearchQuery(value: string): boolean {
    const normalizedValue = normalizeBarcodeCompact(value);
    return normalizedValue.length >= BARCODE_FRAGMENT_MIN_DIGITS && /^\d+$/.test(normalizedValue) && /^[\d\s,，-]+$/.test(value);
}

export function searchPropertyItems(query: string, items: AnnualPropertyListItem[]): AnnualPropertyListItem[] {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return items;

    if (isBarcodeSearchQuery(trimmedQuery)) {
        const normalizedQuery = normalizeSearchQuery(trimmedQuery);
        return items.filter((item) => (
            propertyBarcodeMatchesSearchQuery(item.barcode, trimmedQuery)
            || normalizeSearchText(item.note).includes(normalizedQuery)
            || (item.tags ?? []).some((tag) => normalizeSearchText(tag).includes(normalizedQuery))
        ));
    }

    const normalizedQuery = normalizeSearchQuery(trimmedQuery);
    if (!normalizedQuery) return items;
    const queryTokens = normalizedQuery.split(" ").filter(Boolean);
    const directMatches = items
        .map((item, originalIndex) => ({
            item,
            originalIndex,
            score: getTokenMatchScore(item, normalizedQuery, queryTokens),
        }))
        .filter((entry): entry is typeof entry & {score: number} => entry.score !== null)
        .sort((a, b) => a.score - b.score || a.originalIndex - b.originalIndex)
        .map((entry) => entry.item);
    const directMatchSet = new Set(directMatches);
    const fuzzyMatches = new Fuse(
        items.filter((item) => !directMatchSet.has(item)),
        SEARCH_OPTIONS,
    )
        .search(normalizedQuery)
        .map((result) => result.item);

    return [...directMatches, ...fuzzyMatches];
}

export function filterPropertyItemsByTags(
    items: AnnualPropertyListItem[],
    selectedTags: readonly string[],
): AnnualPropertyListItem[] {
    if (selectedTags.length === 0) return items;

    return items.filter((item) => (
        selectedTags.every((tag) => propertyItemHasTag(item.tags, tag))
    ));
}
