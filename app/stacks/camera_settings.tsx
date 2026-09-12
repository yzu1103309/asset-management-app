import {useCallback, useMemo, useRef, useState} from "react";
import {Alert, ScrollView, StyleSheet, View} from "react-native";
import {Stack, useFocusEffect} from "expo-router";
import {MenuView, type MenuAction, type NativeActionEvent} from "@expo/ui/community/menu";
import {Icon, Text} from "react-native-magnus";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {Section, SettingRow} from "@/components/settings/SettingsRows";
import {
    getAvailableScannerProviders,
    getDefaultScannerSettings,
    getStoredScannerSettings,
    resolveScannerProvider,
    saveScannerSettings,
    SCANNER_BARCODE_FORMATS,
    type ScannerBarcodeFormat,
    type ScannerProvider,
    type ScannerSettings,
} from "@/handlers/scannerSettings";

const PROVIDER_LABELS: Record<ScannerProvider, string> = {
    "vision-camera": "Vision Camera（建議）",
    "expo-camera": "Expo Camera",
};

export default function CameraSettingsScreen() {
    const insets = useSafeAreaInsets();
    const [settings, setSettings] = useState<ScannerSettings>(getDefaultScannerSettings);
    const [loading, setLoading] = useState(true);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const availableProviders = useMemo(() => getAvailableScannerProviders(), []);
    const effectiveProvider = resolveScannerProvider(settings.provider);
    const providerActions = useMemo<MenuAction[]>(() => availableProviders.map((provider) => ({
        id: provider,
        title: PROVIDER_LABELS[provider],
        state: provider === effectiveProvider ? "on" : "off",
        attributes: {disabled: loading},
    })), [availableProviders, effectiveProvider, loading]);

    useFocusEffect(useCallback(() => {
        let active = true;
        setLoading(true);
        void getStoredScannerSettings()
            .then((storedSettings) => {
                if (active) setSettings(storedSettings);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []));

    const persistSettings = useCallback((nextSettings: ScannerSettings) => {
        setSettings(nextSettings);
        saveQueueRef.current = saveQueueRef.current
            .catch(() => undefined)
            .then(() => saveScannerSettings(nextSettings))
            .catch((error) => {
                console.error("儲存掃描設定失敗:", error);
                Alert.alert("儲存失敗", "無法儲存相機設定，請稍後再試。");
            });
    }, []);

    const handleProviderAction = useCallback((event: NativeActionEvent) => {
        const provider = event.nativeEvent.event as ScannerProvider;
        if (!availableProviders.includes(provider)) return;

        persistSettings({...settings, provider});
    }, [availableProviders, persistSettings, settings]);

    const toggleFormat = useCallback((formatId: ScannerBarcodeFormat, enabled: boolean) => {
        const nextFormats = enabled
            ? [...new Set([...settings.enabledFormats, formatId])]
            : settings.enabledFormats.filter((id) => id !== formatId);

        if (nextFormats.length === 0) {
            Alert.alert("至少保留一種條碼", "掃描器需要至少開啟一種條碼格式。");
            return;
        }

        persistSettings({...settings, enabledFormats: nextFormats});
    }, [persistSettings, settings]);

    return (
        <View style={styles.container}>
            <Stack.Screen options={{title: "相機設定", headerBackTitle: "設定"}} />
            <ScrollView
                contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 28}]}
                showsVerticalScrollIndicator={false}
            >
                <Section title="基本設定">
                    <View style={styles.providerRow}>
                        <View style={styles.iconBox}>
                            <Icon name="barcode-scan" fontFamily="MaterialCommunityIcons" fontSize="xl" color="blue500" />
                        </View>
                        <View style={styles.providerText}>
                            <Text fontSize="lg" fontWeight="bold" color="gray900">掃描器提供者</Text>
                        </View>
                        <MenuView
                            title="掃描器提供者"
                            actions={providerActions}
                            onPressAction={handleProviderAction}
                            style={styles.providerMenu}
                        >
                            <View style={[styles.providerTrigger, loading && styles.providerRowDisabled]}>
                                <Text fontSize="sm" color="gray700" style={styles.providerValue}>
                                    {PROVIDER_LABELS[effectiveProvider]}
                                </Text>
                                <Icon name="chevron-down" fontFamily="Feather" fontSize="lg" color="gray500" />
                            </View>
                        </MenuView>
                    </View>
                </Section>

                <Section title="支援的條碼">
                    {SCANNER_BARCODE_FORMATS.map((format) => (
                        <SettingRow
                            key={format.id}
                            title={format.label}
                            description={format.description}
                            icon={format.id === "qr" ? "qrcode" : "barcode"}
                            iconFamily="FontAwesome"
                            value={settings.enabledFormats.includes(format.id)}
                            onValueChange={(enabled) => toggleFormat(format.id, enabled)}
                        />
                    ))}
                </Section>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#F5F6F8",
    },
    content: {
        paddingHorizontal: 18,
        paddingTop: 22,
    },
    providerRow: {
        width: "100%",
        minHeight: 82,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    providerMenu: {
        flexShrink: 0,
    },
    providerTrigger: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingLeft: 8,
    },
    providerRowDisabled: {
        opacity: 0.55,
    },
    iconBox: {
        width: 38,
        height: 38,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F0F2F5",
    },
    providerText: {
        flex: 1,
        paddingHorizontal: 12,
    },
    providerValue: {
        maxWidth: 126,
        marginRight: 6,
        textAlign: "right",
    },
});
