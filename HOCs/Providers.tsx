import { ThemeProvider } from "react-native-magnus";
import { SpinnerProvider } from "@/context/SpinnerContext";
import {SafeAreaProvider} from "react-native-safe-area-context";
import { ActionSheetProvider } from "@expo/react-native-action-sheet";
import {PromptProvider} from "@/hooks/usePrompt";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as NavigationBar from 'expo-navigation-bar';
import {Platform} from "react-native";
import {useEffect} from "react";
import {PropertyYearProvider} from "@/context/PropertyYearContext";

interface ProvidersProps {
    children: React.ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
    useEffect(() => {
        if (Platform.OS === 'android') {
            // Set the navigation bar style
            NavigationBar.setStyle('light');
        }
    }, []);
    return (
            <GestureHandlerRootView style={{flex: 1}}>
                <SafeAreaProvider>
                    <ThemeProvider>
                        <PromptProvider>
                            <SpinnerProvider>
                                <PropertyYearProvider>
                                    <ActionSheetProvider>
                                        {children}
                                    </ActionSheetProvider>
                                </PropertyYearProvider>
                            </SpinnerProvider>
                        </PromptProvider>
                    </ThemeProvider>
                </SafeAreaProvider>
            </GestureHandlerRootView>
    );
}
