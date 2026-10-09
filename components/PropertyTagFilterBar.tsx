import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from "react-native";
import {Icon} from "react-native-magnus";

type PropertyTagFilterBarProps = {
    tags: string[];
    selectedTags: string[];
    onToggle: (tag: string) => void;
};

export default function PropertyTagFilterBar({
    tags,
    selectedTags,
    onToggle,
}: PropertyTagFilterBarProps) {
    if (tags.length === 0) return null;

    const selectedTagSet = new Set(selectedTags);

    return (
        <View style={styles.row}>
            <View style={styles.label}>
                <Icon name="tag" fontFamily="Feather" color="gray500" fontSize="sm" />
                <Text style={styles.labelText}>分類</Text>
            </View>
            <ScrollView
                horizontal
                style={styles.scroll}
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                contentContainerStyle={styles.content}
            >
                {tags.map((tag) => {
                    const selected = selectedTagSet.has(tag);
                    return (
                        <TouchableOpacity
                            key={tag}
                            activeOpacity={0.75}
                            accessibilityRole="checkbox"
                            accessibilityState={{checked: selected}}
                            onPress={() => onToggle(tag)}
                            style={[styles.chip, selected && styles.chipSelected]}
                        >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                                # {tag}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: 34,
        marginBottom: 6,
        flexDirection: "row",
        alignItems: "center",
    },
    label: {
        flexShrink: 0,
        marginHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    labelText: {
        color: "#667085",
        fontSize: 12,
        fontWeight: "600",
    },
    scroll: {
        flex: 1,
    },
    content: {
        paddingRight: 6,
        gap: 7,
    },
    chip: {
        minHeight: 30,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        backgroundColor: "#F8FAFC",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#CBD5E1",
    },
    chipSelected: {
        backgroundColor: "#EFF6FF",
        borderColor: "#60A5FA",
    },
    chipText: {
        color: "#667085",
        fontSize: 12,
    },
    chipTextSelected: {
        color: "#1D4ED8",
        fontWeight: "700",
    },
});
