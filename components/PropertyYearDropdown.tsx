import {MenuView, type MenuAction, type NativeActionEvent} from "@expo/ui/community/menu";
import {useCallback, useMemo} from "react";
import {StyleSheet, View, type StyleProp, type ViewStyle} from "react-native";
import {Icon, Text} from "react-native-magnus";
import {usePropertyYear} from "@/context/PropertyYearContext";

const YEAR_PICKER_BLUE = "#2563EB";

type PropertyYearDropdownProps = {
    prefix?: string;
    disabledLabel?: string;
    compact?: boolean;
    containerStyle?: StyleProp<ViewStyle>;
    onBeforeSelect?: () => void;
    onAfterSelect?: () => void;
    onSelectionAccepted?: (year: string) => void | Promise<void>;
    hideWhenDisabled?: boolean;
};

export default function PropertyYearDropdown({
    prefix,
    disabledLabel = "尚未匯入",
    compact = false,
    containerStyle,
    onBeforeSelect,
    onAfterSelect,
    onSelectionAccepted,
    hideWhenDisabled = false,
}: PropertyYearDropdownProps) {
    const {availableYears, selectedYear, requestSelectYear} = usePropertyYear();
    const enabled = availableYears.length > 0;
    const selectedValue = selectedYear ?? availableYears[0] ?? "";
    const menuActions = useMemo<MenuAction[]>(() => (
        availableYears.map((year) => ({
            id: year,
            title: `${year} 年度`,
            titleColor: YEAR_PICKER_BLUE,
            state: year === selectedValue ? "on" : undefined,
        }))
    ), [availableYears, selectedValue]);

    const handlePressAction = useCallback((event: NativeActionEvent) => {
        const year = event.nativeEvent.event;
        if (!year || year === selectedYear) return;

        void (async () => {
            onBeforeSelect?.();
            try {
                const accepted = await requestSelectYear(year);
                if (accepted) {
                    await onSelectionAccepted?.(year);
                }
            } finally {
                onAfterSelect?.();
            }
        })();
    }, [onAfterSelect, onBeforeSelect, onSelectionAccepted, requestSelectYear, selectedYear]);

    if (!enabled) {
        if (hideWhenDisabled) return null;

        return (
            <View style={[styles.container, compact && styles.containerCompact, containerStyle]}>
                {prefix ? (
                    <View style={[styles.prefixContainer, compact && styles.prefixContainerCompact]}>
                        <Text fontSize={compact ? "xs" : "sm"} color="gray600">
                            {prefix}
                        </Text>
                    </View>
                ) : null}
                <View style={[styles.disabledBox, compact && styles.compactBox]}>
                    <Text fontSize={compact ? "sm" : "md"} fontWeight="bold" color="gray500">
                        {disabledLabel}
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, compact && styles.containerCompact, containerStyle]}>
            <MenuView
                title="選擇盤點年度"
                actions={menuActions}
                onPressAction={handlePressAction}
                style={compact ? styles.compactMenuHost : styles.menuHost}
            >
                <View style={[styles.menuHitArea, compact && styles.compactMenuHitArea]}>
                    {prefix ? (
                        <View style={[styles.prefixContainer, compact && styles.prefixContainerCompact]}>
                            <Text fontSize={compact ? "xs" : "sm"} color="gray600">
                                {prefix}
                            </Text>
                        </View>
                    ) : null}
                    <View style={[styles.pickerBox, compact && styles.compactBox]}>
                        <View style={[styles.menuTrigger, compact && styles.compactMenuTrigger]}>
                            <Text fontSize={compact ? "sm" : "md"} fontWeight="bold" color={YEAR_PICKER_BLUE}>
                                {selectedValue} 年度
                            </Text>
                            <Icon
                                name="chevron-down"
                                fontFamily="Feather"
                                color={YEAR_PICKER_BLUE}
                                fontSize={compact ? 14 : 16}
                                ml={compact ? 2 : "xs"}
                            />
                        </View>
                    </View>
                </View>
            </MenuView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
    },
    containerCompact: {
        alignSelf: "center",
        justifyContent: "center",
    },
    prefixContainer: {
        flexShrink: 0,
        marginRight: 8,
    },
    prefixContainerCompact: {
        marginRight: 5,
    },
    pickerBox: {
        alignSelf: "center",
    },
    compactBox: {
        minWidth: 88,
        maxWidth: 100,
        marginLeft: 0,
    },
    menuHost: {
        alignSelf: "center",
    },
    compactMenuHost: {
        alignSelf: "center",
    },
    menuHitArea: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
    },
    compactMenuHitArea: {
        justifyContent: "center",
    },
    menuTrigger: {
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F3F4F6",
    },
    compactMenuTrigger: {
        minHeight: 26,
        paddingHorizontal: 6,
    },
    disabledBox: {
        minHeight: 36,
        minWidth: 118,
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.6,
    },
});
