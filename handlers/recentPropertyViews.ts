import AsyncStorage from "@react-native-async-storage/async-storage";
import {parsePropertyEntityKey} from "./propertyItemStore.ts";

export const RECENT_PROPERTY_VIEWS_STORAGE_KEY = "@ncu-property-checking/recent-property-views:v1";

const MAX_RECENT_PROPERTY_VIEW_COUNT = 20;

function parseRecentPropertyEntityKeys(value: string | null): string[] {
    if (!value) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];

        return [...new Set(parsed.filter((entry): entry is string => (
            typeof entry === "string" && parsePropertyEntityKey(entry) !== null
        )))];
    } catch {
        return [];
    }
}

export async function getRecentPropertyEntityKeys(): Promise<string[]> {
    return parseRecentPropertyEntityKeys(await AsyncStorage.getItem(RECENT_PROPERTY_VIEWS_STORAGE_KEY));
}

export async function rememberRecentPropertyEntity(entityKey: string): Promise<void> {
    if (!parsePropertyEntityKey(entityKey)) return;

    const currentKeys = await getRecentPropertyEntityKeys();
    const nextKeys = [
        entityKey,
        ...currentKeys.filter((key) => key !== entityKey),
    ].slice(0, MAX_RECENT_PROPERTY_VIEW_COUNT);

    await AsyncStorage.setItem(RECENT_PROPERTY_VIEWS_STORAGE_KEY, JSON.stringify(nextKeys));
}
