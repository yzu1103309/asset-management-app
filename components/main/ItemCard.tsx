import {memo} from "react";
import {Pressable, StyleSheet, View} from "react-native";
import {Text} from "react-native-magnus";
import type {PropertyStatus} from "@/handlers/propertyStatusStore";
import {PROPERTY_STATUS_CARD_SHADOW_COLOR, PROPERTY_STATUS_COLORS} from "@/constants/propertyStatusColors";

type ItemCardProps = {
    itemNumber: string;
    barcode: string;
    propertyName: string;
    status: PropertyStatus;
    onPress?: () => void;
};

const ItemCard = memo(function ItemCard({itemNumber, barcode, propertyName, status, onPress}: ItemCardProps) {
    const statusStyle = PROPERTY_STATUS_COLORS[status];

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
                        <Text mt={2} fontSize={14} color={statusStyle.nameColor} lineHeight={19} numberOfLines={1}>
                            {propertyName}
                        </Text>
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
        width: 32,
        minHeight: 32,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 10,
        borderRadius: 8,
    },
    content: {
        flex: 1,
    },
    pressedOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(17, 24, 39, 0.05)",
        borderRadius: 10,
    },
});
