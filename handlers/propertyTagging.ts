import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItem,
    type PropertyItemsByBarcode,
} from "./propertyItemStore.ts";

export const PROPERTY_TAG_CATEGORIES_STORAGE_KEY = "@ncu-property-checking/property-tag-categories:v1";
export const MAX_PROPERTY_TAG_LENGTH = 12;
export const MAX_PROPERTY_TAG_COUNT = 3;

export type PropertyTaggingUpdateResult = {
    item: PropertyItem;
    categories: string[];
};

export function normalizePropertyTag(value: string): string {
    const normalizedValue = value.normalize("NFKC").replace(/\s+/g, " ").trim();
    return Array.from(normalizedValue).slice(0, MAX_PROPERTY_TAG_LENGTH).join("");
}

export function getPropertyTagsForCard(tags: readonly string[] | undefined): string[] {
    return (tags ?? [])
        .map((tag) => normalizePropertyTag(tag))
        .filter(Boolean);
}

export function formatPropertyTagsForCard(tags: readonly string[] | undefined): string {
    return getPropertyTagsForCard(tags).map((tag) => `#${tag}`).join(" ");
}

function getPropertyTagIdentity(value: string): string {
    return normalizePropertyTag(value).toLocaleLowerCase("zh-Hant-TW");
}

export function mergePropertyTagCategories(...groups: readonly string[][]): string[] {
    const categoryByIdentity = new Map<string, string>();

    for (const group of groups) {
        for (const value of group) {
            const category = normalizePropertyTag(value);
            const identity = getPropertyTagIdentity(category);
            if (!category || categoryByIdentity.has(identity)) continue;

            categoryByIdentity.set(identity, category);
        }
    }

    return [...categoryByIdentity.values()].sort((a, b) => a.localeCompare(b, "zh-Hant-TW", {
        numeric: true,
        sensitivity: "base",
    }));
}

export function parsePropertyTagCategories(value: string | null): string[] {
    if (!value) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];

        return mergePropertyTagCategories(parsed.filter((item): item is string => typeof item === "string"));
    } catch {
        return [];
    }
}

export function getPropertyTagsFromItems(itemsByBarcode: PropertyItemsByBarcode): string[] {
    return mergePropertyTagCategories(
        Object.values(itemsByBarcode).flatMap((items) => items.flatMap((item) => item.tags ?? [])),
    );
}

export function propertyItemHasTag(tags: readonly string[] | undefined, tag: string): boolean {
    const targetIdentity = getPropertyTagIdentity(tag);
    return !!targetIdentity && (tags ?? []).some((value) => getPropertyTagIdentity(value) === targetIdentity);
}

export function filterPropertyTagCategories(categories: readonly string[], keyword: string): string[] {
    const normalizedKeyword = getPropertyTagIdentity(keyword);
    if (!normalizedKeyword) return [...categories];

    const tokens = normalizedKeyword.split(" ").filter(Boolean);
    return categories.filter((category) => {
        const identity = getPropertyTagIdentity(category);
        return tokens.every((token) => identity.includes(token));
    });
}

export function getVisiblePropertyTagCategories(
    categories: readonly string[],
    selectedTags: readonly string[],
    keyword: string,
): string[] {
    const selectedTagIdentities = new Set(selectedTags.map(getPropertyTagIdentity));

    return [
        ...selectedTags,
        ...filterPropertyTagCategories(categories, keyword).filter(
            (tag) => !selectedTagIdentities.has(getPropertyTagIdentity(tag)),
        ),
    ];
}

export async function getStoredPropertyTagCategories(): Promise<string[]> {
    const [categoryValue, propertyItemsValue] = await Promise.all([
        AsyncStorage.getItem(PROPERTY_TAG_CATEGORIES_STORAGE_KEY),
        AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY),
    ]);
    const items = parseStoredPropertyItems(propertyItemsValue);

    return mergePropertyTagCategories(
        parsePropertyTagCategories(categoryValue),
        getPropertyTagsFromItems(items),
    );
}

export async function setPropertyItemTagSelected(
    barcode: string,
    entityIndex: number,
    tag: string,
    selected: boolean,
): Promise<PropertyTaggingUpdateResult> {
    const normalizedTag = normalizePropertyTag(tag);
    if (!normalizedTag) throw new Error("分類標記名稱不可為空白。");

    const [propertyItemsValue, categoryValue] = await Promise.all([
        AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY),
        AsyncStorage.getItem(PROPERTY_TAG_CATEGORIES_STORAGE_KEY),
    ]);
    const storedItems = parseStoredPropertyItems(propertyItemsValue);
    const bucket = storedItems[barcode];
    const currentItem = bucket?.[entityIndex];
    if (!bucket || !currentItem) throw new Error("找不到要更新的財產資料。");

    const currentTags = mergePropertyTagCategories(currentItem.tags ?? []);
    const alreadySelected = propertyItemHasTag(currentTags, normalizedTag);
    if (selected && !alreadySelected && currentTags.length >= MAX_PROPERTY_TAG_COUNT) {
        throw new Error(`每項財產最多只能加入 ${MAX_PROPERTY_TAG_COUNT} 個分類標記。`);
    }
    const nextTags = selected
        ? mergePropertyTagCategories(currentTags, [normalizedTag])
        : currentTags.filter((value) => !propertyItemHasTag([value], normalizedTag));
    const updatedItem: PropertyItem = {
        ...currentItem,
        tags: nextTags,
        updatedAt: new Date().toISOString(),
    };
    const nextBucket = [...bucket];
    nextBucket[entityIndex] = updatedItem;
    const nextItems = {...storedItems, [barcode]: nextBucket};
    const nextCategories = mergePropertyTagCategories(
        parsePropertyTagCategories(categoryValue),
        getPropertyTagsFromItems(nextItems),
        [normalizedTag],
    );

    await AsyncStorage.multiSet([
        [PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify(nextItems)],
        [PROPERTY_TAG_CATEGORIES_STORAGE_KEY, JSON.stringify(nextCategories)],
    ]);

    return {item: updatedItem, categories: nextCategories};
}

export async function pruneUnusedPropertyTagCategories(): Promise<string[]> {
    const propertyItemsValue = await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY);
    const storedItems = parseStoredPropertyItems(propertyItemsValue);
    const nextCategories = getPropertyTagsFromItems(storedItems);

    await AsyncStorage.setItem(PROPERTY_TAG_CATEGORIES_STORAGE_KEY, JSON.stringify(nextCategories));
    return nextCategories;
}
