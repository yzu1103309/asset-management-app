import {Dimensions} from "react-native";

const screenDimensions = Dimensions.get("screen");

export const centeredEdgeToEdgeModalProps = {
    statusBarTranslucent: true,
    deviceHeight: screenDimensions.height,
    deviceWidth: screenDimensions.width,
} as const;
