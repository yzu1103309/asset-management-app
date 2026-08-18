// hooks/usePrompt.tsx
import React, { createContext, useContext, useState, ReactNode } from "react";
import Modal from "react-native-modal";
import {Keyboard, Platform, View} from "react-native";
import {Button, Div, Icon, Input, Text} from "react-native-magnus";
import AndroidKeyboardAvoidingView from "@/components/AndroidKeyboardAvoidingView";
import {centeredEdgeToEdgeModalProps} from "@/constants/centeredModal";

interface PromptOptions {
    title: string;
    message?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    confirmBtnColor?: string;
}

type PromptContextType = (options: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<PromptContextType | null>(null);

export const usePrompt = () => {
    const ctx = useContext(PromptContext);
    if (!ctx) throw new Error("usePrompt must be used within <PromptProvider>");
    return ctx;
};

export const PromptProvider = ({ children }: { children: ReactNode }) => {
    const [visible, setVisible] = useState(false);
    const [options, setOptions] = useState<PromptOptions | null>(null);
    const [value, setValue] = useState("");
    const [resolver, setResolver] = useState<((v: string | null) => void) | null>(null);

    const prompt: PromptContextType = (opts) => {
        setOptions(opts);
        setValue(opts.defaultValue ?? "");
        setVisible(true);
        return new Promise((resolve) => setResolver(() => resolve));
    };

    const submit = () => {
        resolver?.(value.trim());
        setVisible(false);
    };

    const cancel = () => {
        resolver?.(null);
        setVisible(false);
    };

    return (
        <PromptContext.Provider value={prompt}>
            {children}

            <Modal
                isVisible={visible}
                animationIn="zoomIn"
                animationInTiming={300}
                animationOut="zoomOut"
                animationOutTiming={300}
                hasBackdrop
                onBackButtonPress={cancel}
                backdropOpacity={0.65}
                backdropTransitionOutTiming={1}
                avoidKeyboard={Platform.OS === "ios"}
                onBackdropPress={Keyboard.dismiss}
                {...centeredEdgeToEdgeModalProps}
            >
                <AndroidKeyboardAvoidingView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <View
                        style={{
                            width: "90%",
                            backgroundColor: "white",
                            borderRadius: 12,
                            padding: 20,
                            paddingHorizontal: 30,
                            alignItems: "center",
                        }}
                    >
                        <Text fontSize="xl" fontWeight="bold">
                            {options?.title}
                        </Text>
                        {options?.message && (
                            <View style={{width: "100%", marginTop: 18, marginBottom: 8}}>
                                {options.message.split("\n").map((line, index) => (
                                    <Text
                                        key={`${index}-${line}`}
                                        w="100%"
                                        fontSize="lg"
                                        lineHeight={25}
                                        textAlign="center"
                                        style={{flexWrap: "wrap"}}
                                    >
                                        {line}
                                    </Text>
                                ))}
                            </View>
                        )}

                        <Input
                            mt="md" textAlign="center"
                            value={value} borderWidth={1.5}
                            onChangeText={setValue} fontWeight="bold"
                            placeholder={options?.placeholder ?? ""}
                            style={{
                                borderWidth: 1,
                                borderColor: "#BBB",
                                borderRadius: 6,
                                width: "100%",
                                padding: 8,
                                marginBottom: 15,
                            }}
                            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                        />

                        <Div row w="100%" justifyContent="space-between">
                            <Button bg="gray300" color="gray800" block textAlignVertical="bottom"
                                    w="48%" rounded={10} fontWeight="bold" onPress={cancel}
                                    prefix={<Icon mr="sm" name="close-circle" color="gray800" fontFamily="AntDesign" />}
                            >
                                {options?.cancelText ?? "取消"}
                            </Button>
                            <Button bg={options?.confirmBtnColor || "blue400"} onPress={submit} block
                                    rounded={10} w="48%" fontWeight="bold" textAlignVertical="bottom"
                                    suffix={<Icon ml="sm" name="check-circle-fill" color="white" fontFamily="Octicons" />}
                            >
                                {options?.confirmText ?? "確認"}
                            </Button>
                        </Div>
                    </View>
                </AndroidKeyboardAvoidingView>
            </Modal>
        </PromptContext.Provider>
    );
};
