import AsyncStorage from "@react-native-async-storage/async-storage";

export const APP_MEMO_STORAGE_KEY = "@ncu-property-checking/memo:v1";

export async function getStoredAppMemo(): Promise<string> {
    return await AsyncStorage.getItem(APP_MEMO_STORAGE_KEY) ?? "";
}

export async function saveAppMemo(value: string): Promise<void> {
    if (!value.trim()) {
        await AsyncStorage.removeItem(APP_MEMO_STORAGE_KEY);
        return;
    }

    await AsyncStorage.setItem(APP_MEMO_STORAGE_KEY, value);
}
