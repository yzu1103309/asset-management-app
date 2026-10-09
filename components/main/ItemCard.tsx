import {memo} from "react";
import {Pressable, StyleSheet, View} from "react-native";
import {Text} from "react-native-magnus";
import type {PropertyStatus} from "@/handlers/propertyStatusStore";
import {PROPERTY_STATUS_CARD_SHADOW_COLOR, PROPERTY_STATUS_COLORS} from "@/constants/propertyStatusColors";
import {getPropertyTagsForCard} from "@/handlers/propertyTagging";

const absoluteFill = {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

type ItemCardProps = {
    itemNumber: string;
    barcode: string;
    propertyName: string;
    location?: {
        areaName: string | null;
        description: string | null;
    } | null;
    note?: string | null;
    tags?: string[];
    status: PropertyStatus;
    onPress?: () => void;
};

const ItemCard = memo(function ItemCard({itemNumber, barcode, propertyName, location, note, tags, status, onPress}: ItemCardProps) {
    const statusStyle = PROPERTY_STATUS_COLORS[status];
    const locationText = [location?.areaName, location?.description]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .join("／");
    const noteText = note?.trim();
    const locationSummary = locationText ? `@ ${locationText}${noteText ? `（${noteText}）` : ""}` : null;
    const cardTags = getPropertyTagsForCard(tags);

    return (
        <Pressable
            disabled={!onPress}
            onPress={onPress}
        >
            {({pressed}) => (
                <View
                    style={[
                        styles.card,
                        {
                            backgroundColor: statusStyle.cardBg,
                            shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
                        },
                    ]}
                >
                    <View
                        style={[styles.itemNumberBox, {backgroundColor: statusStyle.numberBg}]}
                    >
                        <Text fontSize={14} fontWeight="bold" color={statusStyle.numberColor} numberOfLines={1}>
                            {itemNumber}
                        </Text>
                    </View>
                    <View style={styles.content}>
                        <Text mb={2} fontSize={16} fontWeight="bold" color={statusStyle.barcodeColor} numberOfLines={1}>
                            {barcode}
                        </Text>
                        <Text mt={2} fontSize={14} color={statusStyle.barcodeColor} lineHeight={19} numberOfLines={1}>
                            {propertyName}
                        </Text>
                        {locationSummary && (
                            <Text mt={4} fontSize={12} color={statusStyle.nameColor} lineHeight={17} numberOfLines={1}>
                                {locationSummary}
                            </Text>
                        )}
                        {cardTags.length > 0 && (
                            <View style={styles.tagList}>
                                {cardTags.map((tag, index) => (
                                    <View
                                        key={`${tag}:${index}`}
                                        style={styles.tagItem}
                                    >
                                        <Text
                                            fontSize={12}
                                            color={statusStyle.nameColor}
                                            lineHeight={17}
                                            numberOfLines={1}
                                            style={{
                                                textDecorationLine: "underline",
                                                textDecorationStyle: "solid",
                                                textDecorationColor: statusStyle.nameColor,
                                            }}
                                        >
                                            # {tag}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>
                    {pressed && <View pointerEvents="none" style={styles.pressedOverlay} />}
                </View>
            )}
        </Pressable>
    );
});

export default ItemCard;

const styles = StyleSheet.create({
    card: {
        marginBottom: 12,
        marginHorizontal: 6,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        // minHeight: 76,
        shadowOffset: {
            width: 0,
            height: 5,
        },
        shadowOpacity: 0.16,
        shadowRadius: 12,
        elevation: 4,
    },
    itemNumberBox: {
        minWidth: 32,
        minHeight: 32,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 10,
        borderRadius: 8,
        paddingHorizontal: 5
    },
    content: {
        flex: 1,
    },
    tagList: {
        marginTop: 4,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        overflow: "hidden",
    },
    tagItem: {
        flexShrink: 0,
    },
    pressedOverlay: {
        ...absoluteFill,
        backgroundColor: "rgba(17, 24, 39, 0.05)",
        borderRadius: 10,
    },
});
