import React, { memo } from "react";
import { StyleSheet, Switch, TouchableOpacity, View } from "react-native";
import { Icon, Text } from "react-native-magnus";

type SettingRowProps = {
    title: string;
    description?: string;
    icon: string;
    iconFamily: React.ComponentProps<typeof Icon>["fontFamily"];
    value: boolean;
    onValueChange: (value: boolean) => void;
};

type MenuRowProps = {
    title: string;
    description?: string;
    icon: string;
    iconFamily: React.ComponentProps<typeof Icon>["fontFamily"];
    color?: string;
    onPress: () => void;
};

export const Section = memo(({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
        <Text fontSize="lg" fontWeight="bold" color="gray800" mb="md">{title}</Text>
        <View style={styles.sectionBody}>{children}</View>
    </View>
));
Section.displayName = "Section";

export const SettingRow = memo(({ title, description, icon, iconFamily, value, onValueChange }: SettingRowProps) => (
    <View style={styles.row}>
        <View style={styles.iconBox}>
            <Icon name={icon} fontFamily={iconFamily} fontSize="xl" color="gray800" />
        </View>
        <View style={styles.rowText}>
            <Text fontSize="lg" fontWeight="bold" color="gray900">{title}</Text>
            {description && <Text mt={4} fontSize="sm" color="gray600" lineHeight={18}>{description}</Text>}
        </View>
        <Switch style={{ alignSelf: "center" }} value={value} onValueChange={onValueChange} />
    </View>
));
SettingRow.displayName = "SettingRow";

export const MenuRow = memo(({ title, description, icon, iconFamily, color = "gray800", onPress }: MenuRowProps) => (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: "#F7F7F7" }]}>
            <Icon name={icon} fontFamily={iconFamily} fontSize="xl" color={color} />
        </View>
        <View style={styles.rowText}>
            <Text fontSize="lg" fontWeight="bold" color="gray900">{title}</Text>
            {description && <Text mt={4} fontSize="sm" color="gray600" lineHeight={18}>{description}</Text>}
        </View>
        <Icon name="chevron-right" fontFamily="Feather" fontSize="xl" color="gray500" />
    </TouchableOpacity>
));
MenuRow.displayName = "MenuRow";

const styles = StyleSheet.create({
    section: {
        marginBottom: 24,
    },
    sectionBody: {
        backgroundColor: "white",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#E3E6EA",
        overflow: "hidden",
    },
    row: {
        minHeight: 72,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#D9DEE5",
    },
    rowText: {
        flex: 1,
        paddingHorizontal: 12,
    },
    iconBox: {
        width: 38,
        height: 38,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F0F2F5",
    },
});
