import Constants, {ExecutionEnvironment} from "expo-constants";
import {Platform} from "react-native";

export function getBottomModalSafeAreaPadding(bottomInset: number): number {
    if (Platform.OS !== "android") return bottomInset;
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return 0;

    return bottomInset;
}
