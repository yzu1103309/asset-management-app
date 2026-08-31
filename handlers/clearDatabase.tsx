import type {ActionSheetOptions} from "@expo/react-native-action-sheet";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {Alert} from "react-native";
import {PROPERTY_ITEMS_STORAGE_KEY} from "./propertyItemStore.ts";
import {PROPERTY_STATUS_VALUES} from "./propertyStatusStore.ts";
import {AREA_LAYOUT_STORAGE_KEY} from "./areaLayout.ts";
import {PROPERTY_LABEL_QUEUE_STORAGE_KEY} from "./propertyLabelQueue.ts";
import {PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY} from "./propertyTextSuggestions.ts";

const PROPERTY_STATUS_STORAGE_KEY_PATTERN = new RegExp(`^\\d{3}_(${PROPERTY_STATUS_VALUES.join("|")})$`);

function isPropertyStorageKey(key: string): boolean {
    return key === PROPERTY_ITEMS_STORAGE_KEY
        || key === AREA_LAYOUT_STORAGE_KEY
        || key === PROPERTY_LABEL_QUEUE_STORAGE_KEY
        || key === PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY
        || PROPERTY_STATUS_STORAGE_KEY_PATTERN.test(key);
}

export async function clearAllLocalData(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const propertyKeys = keys.filter(isPropertyStorageKey);

    if (propertyKeys.length === 0) return;

    await AsyncStorage.multiRemove(propertyKeys);
}

export async function clearDatabase(showActionSheetWithOptions: (options: ActionSheetOptions, callback: (i?: number) => (void | Promise<void>)) => void)
{
    const options = ['確定清除', '取消'];

    showActionSheetWithOptions(
        {options, cancelButtonIndex: 1, destructiveButtonIndex: 0},
        async (selectedIndex) => {
            switch (selectedIndex) {
                case 0:
                    try {
                        await clearAllLocalData();
                        Alert.alert("清除完成", "本機財產資料已清除。");
                    } catch (e) {
                        Alert.alert(
                            '發生錯誤',
                            '資料清除失敗'
                        )
                        console.log(e)
                    }
            }
        }
    )
}
