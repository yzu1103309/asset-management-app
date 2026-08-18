import React from "react";
import {
    KeyboardAvoidingView,
    KeyboardAvoidingViewProps,
    Platform,
    StyleProp,
    View,
    ViewStyle,
} from "react-native";

type Props = {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    behavior?: KeyboardAvoidingViewProps["behavior"];
    keyboardVerticalOffset?: number;
};

export default function AndroidKeyboardㄐAvoidingView({
    children,
    style,
    behavior = "padding",
    keyboardVerticalOffset = 0,
}: Props) {
    if (Platform.OS !== "android") {
        return <View style={style}>{children}</View>;
    }

    return (
        <KeyboardAvoidingView
            behavior={behavior}
            keyboardVerticalOffset={keyboardVerticalOffset}
            style={style}
        >
            {children}
        </KeyboardAvoidingView>
    );
}
