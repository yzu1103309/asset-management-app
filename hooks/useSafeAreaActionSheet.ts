import {useCallback} from "react";
import {Platform, StyleSheet} from "react-native";
import {
    type ActionSheetOptions,
    useActionSheet as useBaseActionSheet,
} from "@expo/react-native-action-sheet";
import {useSafeAreaInsets} from "react-native-safe-area-context";

export function useSafeAreaActionSheet() {
    const {showActionSheetWithOptions} = useBaseActionSheet();
    const insets = useSafeAreaInsets();

    const showSafeAreaActionSheetWithOptions = useCallback(
        (options: ActionSheetOptions, callback: (index?: number) => void | Promise<void>) => {
            if (Platform.OS !== "android" || insets.bottom <= 0) {
                showActionSheetWithOptions(options, callback);
                return;
            }

            const containerStyle = StyleSheet.flatten(options.containerStyle) ?? {};
            const existingPaddingBottom = typeof containerStyle.paddingBottom === "number"
                ? containerStyle.paddingBottom
                : 0;

            showActionSheetWithOptions({
                ...options,
                containerStyle: {
                    ...containerStyle,
                    paddingBottom: existingPaddingBottom + insets.bottom,
                },
            }, callback);
        },
        [insets.bottom, showActionSheetWithOptions],
    );

    return {
        showActionSheetWithOptions: showSafeAreaActionSheetWithOptions,
    };
}
