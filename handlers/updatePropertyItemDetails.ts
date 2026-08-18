import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItem,
} from "@/handlers/propertyItemStore";

export type PropertyItemEditableTextField = "locationDescription" | "note";

function normalizeEditableText(value: string): string | null {
    const normalized = value.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
    return normalized || null;
}

export async function updatePropertyItemEditableText(
    barcode: string,
    entityIndex: number,
    field: PropertyItemEditableTextField,
    value: string,
): Promise<PropertyItem> {
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const bucket = storedItems[barcode];
    const currentItem = bucket?.[entityIndex];

    if (!bucket || !currentItem) {
        throw new Error("找不到要更新的財產資料。");
    }

    const normalizedValue = normalizeEditableText(value);
    const updatedItem: PropertyItem = {
        ...currentItem,
        updatedAt: new Date().toISOString(),
        ...(field === "locationDescription"
            ? {
                location: {
                    ...currentItem.location,
                    description: normalizedValue,
                },
            }
            : {
                note: normalizedValue,
            }),
    };

    const nextBucket = [...bucket];
    nextBucket[entityIndex] = updatedItem;

    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify({
        ...storedItems,
        [barcode]: nextBucket,
    }));

    return updatedItem;
}

export async function updatePropertyItemLocationArea(
    barcode: string,
    entityIndex: number,
    area: {id: string; name: string} | null,
): Promise<PropertyItem> {
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const bucket = storedItems[barcode];
    const currentItem = bucket?.[entityIndex];

    if (!bucket || !currentItem) {
        throw new Error("找不到要更新的財產資料。");
    }

    const updatedItem: PropertyItem = {
        ...currentItem,
        updatedAt: new Date().toISOString(),
        location: {
            ...currentItem.location,
            areaId: area?.id ?? null,
            areaName: area?.name ?? null,
        },
    };

    const nextBucket = [...bucket];
    nextBucket[entityIndex] = updatedItem;

    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify({
        ...storedItems,
        [barcode]: nextBucket,
    }));

    return updatedItem;
}
