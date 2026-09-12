import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    FlatList,
    KeyboardAvoidingView,
    type LayoutChangeEvent,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    type StyleProp,
    TouchableOpacity,
    useWindowDimensions,
    View,
    type ViewStyle,
} from "react-native";
import {router, useFocusEffect, useLocalSearchParams} from "expo-router";
import {Image as ExpoImage} from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {MenuView, type MenuAction, type NativeActionEvent} from "@expo/ui/community/menu";
import {Gesture, GestureDetector, GestureHandlerRootView} from "react-native-gesture-handler";
import Reanimated, {useAnimatedStyle, useSharedValue, withSpring} from "react-native-reanimated";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {Button, Div, Icon, Input, Text} from "react-native-magnus";
import {getPropertyItemsByBarcodeMatch} from "@/handlers/propertyList";
import type {PropertyItem} from "@/handlers/propertyImport";
import {
    getPropertyEntityKey,
    getPropertyItemDisplayName,
    getPropertyItemDisplayNumber,
    getPropertyItemNumberForYear,
    parsePropertyEntityKey,
    type PropertyItemsByBarcode,
    type PropertyPhoto,
} from "@/handlers/propertyItemStore";
import {
    cancelPropertyItemSplit,
    setPropertyItemSplitEntities,
    type PropertySplitEntityInput,
} from "@/handlers/propertyItemSplits";
import {
    getAreaShapeFromStyle,
    getStoredAreaLayout,
    isAreaDashedFromStyle,
    isAreaRoundedFromStyle,
    type AreaLayout,
    type AreaLayoutArea,
} from "@/handlers/areaLayout";
import {
    expandLegacyAnnualStatusEntries,
    getStoredAnnualStatusBarcodes,
    parsePropertyStatusEntryKey,
    type PropertyStatus,
    updateAnnualPropertyStatus,
} from "@/handlers/propertyStatusStore";
import {PROPERTY_STATUS_CARD_SHADOW_COLOR, PROPERTY_STATUS_COLORS} from "@/constants/propertyStatusColors";
import {
    updatePropertyItemLocationArea,
    updatePropertyItemEditableText,
    type PropertyItemEditableTextField,
} from "@/handlers/updatePropertyItemDetails";
import {useSafeAreaActionSheet} from "@/hooks/useSafeAreaActionSheet";
import {
    addPropertyLabelEntity,
    isPropertyEntityInPropertyLabelQueue,
    removePropertyLabelEntity,
} from "@/handlers/propertyLabelQueue";
import {
    addPropertyItemPhoto,
    compressAndStorePropertyPhoto,
    removePropertyItemPhoto,
} from "@/handlers/propertyItemPhotos";
import {
    getPropertyTextSuggestions,
    getSuggestedPropertyTextSuggestions,
    rememberPropertyTextSuggestion,
} from "@/handlers/propertyTextSuggestions";
import {usePropertyYear} from "@/context/PropertyYearContext";
import {
    comparePropertyYearsDescending,
    isSamePropertyYear,
    itemExistsInPropertyYear,
    propertyYearToWesternNumber,
} from "@/handlers/propertyYears";
import {
    addPropertyItemChild,
    getRelationshipTargets,
    getStoredRelationshipItemsByBarcode,
    isPropertyRelationshipDescendant,
    removePropertyItemChild,
    setPropertyItemParent,
    type PropertyRelationshipTarget,
} from "@/handlers/propertyRelationships";

function getParamValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function parseEntityIndexParam(value: string | undefined): number | null {
    if (value === undefined) return null;

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getPrimarySourceYear(item: PropertyItem): string | null {
    return [...item.sourceYears].sort((a, b) => Number(b) - Number(a))[0] ?? null;
}

const hitSlop = {top: 10, bottom: 10, left: 10, right: 10};
const MAX_PROPERTY_PHOTO_COUNT = 3;
const absoluteFill = {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
    unknown: "未清點",
    checked: "已確認",
    pending: "待處理",
};

function getPropertyRelationshipShortLabel(target: PropertyRelationshipTarget | null, fallbackKey?: string | null): string {
    if (!target) return fallbackKey ? `找不到資料：${fallbackKey}` : "（未設定）";

    return `${getPropertyItemDisplayName(target.item)}\n（${target.barcode}）`;
}

function propertyRelationshipExistsInYear(target: PropertyRelationshipTarget | null, year: string | null): boolean {
    if (!target) return false;
    if (!year) return true;

    return itemExistsInPropertyYear(target.item.sourceYears, year);
}

function getPropertyRelationshipYearStatusLabel(target: PropertyRelationshipTarget | null, year: string | null): string | null {
    if (!target || !year || itemExistsInPropertyYear(target.item.sourceYears, year)) return null;

    const viewingWesternYear = propertyYearToWesternNumber(year);
    const sourceWesternYears = target.item.sourceYears
        .map(propertyYearToWesternNumber)
        .filter((sourceYear): sourceYear is number => sourceYear !== null);

    return viewingWesternYear !== null && sourceWesternYears.some((sourceYear) => sourceYear > viewingWesternYear)
        ? "後續新增"
        : "可能已報廢";
}

function EditableDetailRow({
    label,
    value,
    editable = true,
    onPress,
}: {
    label: string;
    value: string | null | undefined;
    editable?: boolean;
    onPress: () => void;
}) {
    const content = (
        <View style={styles.editableDetailText}>
            <Text fontSize="md" color="gray600" style={styles.detailLabel}>{label}</Text>
            <Text fontSize="lg" color="gray900" style={styles.detailValue}>{value || "（未填寫）"}</Text>
        </View>
    );

    if (!editable) {
        return (
            <View style={styles.detailRow}>
                {content}
            </View>
        );
    }

    return (
        <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={[styles.detailRow, styles.editableDetailRow]}>
            {content}
            <Icon name="edit-2" fontFamily="Feather" fontSize="lg" color="gray500" ml="sm" />
        </TouchableOpacity>
    );
}

function findAreaByName(areas: AreaLayoutArea[], name: string | null | undefined): AreaLayoutArea | null {
    const normalizedName = name?.trim();
    if (!normalizedName) return null;

    return areas.find((area) => area.name.trim() === normalizedName) ?? null;
}

function findAreaByIdOrName(
    areas: AreaLayoutArea[],
    id: string | null | undefined,
    name: string | null | undefined,
): AreaLayoutArea | null {
    const normalizedId = id?.trim();
    const byId = normalizedId ? areas.find((area) => area.id === normalizedId) ?? null : null;

    return byId ?? findAreaByName(areas, name);
}

function AreaLayoutInlinePreview({
    layout,
    currentAreaId,
    currentAreaName,
    selectedAreaIdOverride,
    editable,
    locked,
    showEditButton,
    completionFeedbackMessage,
    completionFeedbackKey,
    onRequestEditMode,
    onSelectArea,
}: {
    layout: AreaLayout | null;
    currentAreaId: string | null | undefined;
    currentAreaName: string | null | undefined;
    selectedAreaIdOverride?: string | null;
    editable: boolean;
    locked: boolean;
    showEditButton: boolean;
    completionFeedbackMessage: string | null;
    completionFeedbackKey: number;
    onRequestEditMode: () => void;
    onSelectArea: (area: AreaLayoutArea | null) => void;
}) {
    const {width: windowWidth, height: windowHeight} = useWindowDimensions();
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
    const completionOpacity = useRef(new Animated.Value(0)).current;
    const completionScale = useRef(new Animated.Value(0.86)).current;
    const previewMargin = 10;

    useEffect(() => {
        if (!layout) {
            setSelectedAreaId(null);
            return;
        }

        const currentArea = findAreaByIdOrName(layout.areas, currentAreaId, currentAreaName);
        setSelectedAreaId(currentArea?.id ?? null);
    }, [currentAreaId, currentAreaName, layout]);

    useEffect(() => {
        if (!completionFeedbackMessage) return;

        completionOpacity.setValue(0);
        completionScale.setValue(0.86);
        Animated.sequence([
            Animated.parallel([
                Animated.timing(completionOpacity, {
                    toValue: 1,
                    duration: 140,
                    useNativeDriver: true,
                }),
                Animated.spring(completionScale, {
                    toValue: 1,
                    friction: 5,
                    tension: 120,
                    useNativeDriver: true,
                }),
            ]),
            Animated.delay(760),
            Animated.timing(completionOpacity, {
                toValue: 0,
                duration: 260,
                useNativeDriver: true,
            }),
        ]).start();
    }, [completionFeedbackKey, completionFeedbackMessage, completionOpacity, completionScale]);

    const displaySelectedAreaId = selectedAreaIdOverride !== undefined ? selectedAreaIdOverride : selectedAreaId;
    const selectedArea = useMemo(
        () => layout?.areas.find((area) => area.id === displaySelectedAreaId) ?? null,
        [displaySelectedAreaId, layout]
    );
    const previewSize = useMemo(() => {
        if (!layout || layout.areas.length === 0) {
            return {scale: 1, width: 0, height: 0, minX: 0, minY: 0, margin: previewMargin};
        }

        const minX = Math.min(...layout.areas.map((area) => area.x));
        const minY = Math.min(...layout.areas.map((area) => area.y));
        const maxX = Math.max(...layout.areas.map((area) => area.x + area.width));
        const maxY = Math.max(...layout.areas.map((area) => area.y + area.height));
        const layoutWidth = Math.max(maxX - minX, 1);
        const layoutHeight = Math.max(maxY - minY, 1);
        const availableWidth = windowWidth - 36;
        const maxHeight = windowHeight * 0.35;
        const availableDrawingWidth = Math.max(availableWidth - previewMargin * 2, 1);
        const availableDrawingHeight = Math.max(maxHeight - previewMargin * 2, 1);
        const scale = Math.min(availableDrawingWidth / layoutWidth, availableDrawingHeight / layoutHeight, 1);

        return {
            scale,
            width: layoutWidth * scale + previewMargin * 2,
            height: layoutHeight * scale + previewMargin * 2,
            minX,
            minY,
            margin: previewMargin,
        };
    }, [layout, previewMargin, windowHeight, windowWidth]);
    const showLockedLocationHint = () => {
        Alert.alert("位置區域已鎖定", "請先進入編輯模式，\n才能更改存放位置");
    };
    const isClearLocationFeedback = completionFeedbackMessage === "已清除位置";

    return (
        <View style={styles.areaPreviewSection}>
            <View style={styles.areaPreviewHeaderRow}>
                <Div row>
                    {showEditButton && (
                        <Icon color="gray600" mr="xs" name="lock" fontFamily="Octicons" />
                    )}
                    <Text fontSize="md" color="gray600" fontWeight="bold">
                        位置區域
                    </Text>
                </Div>
                {showEditButton && (
                    <TouchableOpacity onPress={onRequestEditMode} hitSlop={hitSlop} style={styles.inlineEditButton}>
                        <Icon name="edit-2" fontFamily="Feather" color="blue500" fontSize="lg" mr="xs" />
                        <Text color="blue500" fontWeight="bold" fontSize="md">編輯</Text>
                    </TouchableOpacity>
                )}
            </View>
            {layout ? (
                <><View style={styles.areaPreviewFrame}>
                    <View style={[styles.areaPreviewCanvas, {width: previewSize.width, height: previewSize.height}]}>
                        {layout.areas.map((area) => {
                            const selected = area.id === displaySelectedAreaId;
                            const scaledWidth = area.width * previewSize.scale;
                            const scaledHeight = area.height * previewSize.scale;
                            const shape = area.shape ?? getAreaShapeFromStyle(area.style);
                            const rounded = area.rounded ?? isAreaRoundedFromStyle(area.style);

                            return (
                                <TouchableOpacity
                                    key={area.id}
                                    activeOpacity={0.85}
                                    disabled={!editable && !locked}
                                    onPress={() => {
                                        if (locked) {
                                            showLockedLocationHint();
                                            return;
                                        }

                                        if (!editable) return;

                                        if (selected) {
                                            if (selectedAreaIdOverride === undefined) setSelectedAreaId(null);
                                            onSelectArea(null);
                                            return;
                                        }

                                        if (selectedAreaIdOverride === undefined) setSelectedAreaId(area.id);
                                        onSelectArea(area);
                                    }}
                                    style={[
                                        styles.areaPreviewBox,
                                        {
                                            left: (area.x - previewSize.minX) * previewSize.scale + previewSize.margin,
                                            top: (area.y - previewSize.minY) * previewSize.scale + previewSize.margin,
                                            width: scaledWidth,
                                            height: scaledHeight,
                                            borderRadius: shape === "ellipse"
                                                ? Math.min(scaledWidth, scaledHeight) / 2
                                                : rounded ? 8 : 0,
                                            borderStyle: (area.dashed ?? isAreaDashedFromStyle(area.style)) ? "dashed" : "solid",
                                        },
                                    ]}
                                >
                                    {selected && (
                                        <View
                                            pointerEvents="none"
                                            style={locked ? styles.areaPreviewLockedOverlay : styles.areaPreviewSelectedOverlay}
                                        />
                                    )}
                                    {selected && locked && (
                                        <View pointerEvents="none" style={styles.areaLockedBadge}>
                                            <Icon name="location-pin" fontFamily="Entypo" color="#166534" fontSize="md" />
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                        {locked && !editable && (
                            <TouchableOpacity
                                activeOpacity={1}
                                onPress={showLockedLocationHint}
                                style={styles.areaLockedTouchOverlay}
                            />
                        )}
                        {completionFeedbackMessage && (
                            <Animated.View
                                pointerEvents="none"
                                style={[
                                    styles.areaCompletionFeedback,
                                    isClearLocationFeedback && styles.areaCompletionFeedbackInfo,
                                    {
                                        opacity: completionOpacity,
                                    },
                                ]}
                            >
                                <Animated.View style={[styles.areaCompletionContent, {transform: [{scale: completionScale}]}]}>
                                    <View style={[styles.areaCompletionBadge, isClearLocationFeedback && styles.areaCompletionBadgeInfo]}>
                                        <Icon
                                            name={isClearLocationFeedback ? "info" : "check"}
                                            fontFamily="AntDesign"
                                            color="#FFFFFF"
                                            fontSize="2xl"
                                        />
                                    </View>
                                    <Text
                                        mt="lg"
                                        color={isClearLocationFeedback ? "#1E3A8A" : "gray800"}
                                        fontSize="lg"
                                        fontWeight="bold"
                                    >
                                        {completionFeedbackMessage}
                                    </Text>
                                </Animated.View>
                            </Animated.View>
                        )}
                    </View>
                </View>
                <Text
                    mt={10}
                    fontSize="lg"
                    color={selectedArea || currentAreaName?.trim() ? (locked ? "green600" : "blue400") : "red600"}
                    fontWeight="bold"
                    textAlign="center"
                >
                    {selectedArea ? selectedArea.name : currentAreaName?.trim() || "尚未選取區域"}
                </Text></>
            ) : (
                <View style={styles.areaPreviewEmpty}>
                    <Text color="red600" textAlign="center">尚未匯入空間配置圖！</Text>
                    <Text color="red600" mt="sm" textAlign="center">請先繪製並匯入，再進行盤點作業</Text>
                </View>
            )}
        </View>
    );
}

type EditingTarget = {
    barcode: string;
    entityIndex: number;
    field: PropertyItemEditableTextField;
    title: string;
    value: string;
};

function DetailTextEditModal({
    target,
    saving,
    canEdit,
    suggestions,
    onClose,
    onRequestEdit,
    onSave,
}: {
    target: EditingTarget | null;
    saving: boolean;
    canEdit: boolean;
    suggestions: string[];
    onClose: () => void;
    onRequestEdit: (afterConfirmed: () => void) => void;
    onSave: (value: string) => void | Promise<void>;
}) {
    const [text, setText] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const limit = target?.field === "note" ? 100 : 100;
    const inputHeight = Math.min(44 + Math.max(0, text.split("\n").length - 1) * 25, 220);
    const initialText = target?.value ?? "";
    const textChanged = text !== initialText;
    const filteredSuggestions = useMemo(
        () => getSuggestedPropertyTextSuggestions(text, suggestions),
        [suggestions, text],
    );
    const suggestionsVisibility = useRef(new Animated.Value(0)).current;
    const showSuggestions = isEditing && filteredSuggestions.length > 0;
    const suggestionsAnimatedStyle = {
        opacity: suggestionsVisibility,
        maxHeight: suggestionsVisibility.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 48],
        }),
        marginTop: suggestionsVisibility.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 10],
        }),
    };

    useEffect(() => {
        if (!target) {
            setText("");
            setIsEditing(false);
            return;
        }

        const nextText = target?.value ?? "";
        setText(nextText);
        setIsEditing(!nextText.trim());
    }, [target]);

    useEffect(() => {
        Animated.timing(suggestionsVisibility, {
            toValue: showSuggestions ? 1 : 0,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
        }).start();
    }, [showSuggestions, suggestionsVisibility]);

    const handleTextChange = (nextText: string) => {
        setText(nextText.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").slice(0, limit));
    };
    const confirmClearText = () => {
        if (!text.length) return;

        Alert.alert("清除文字", "確定要清除目前輸入的文字？", [
            {text: "取消", style: "cancel"},
            {
                text: "清除",
                style: "destructive",
                onPress: () => setText(""),
            },
        ]);
    };
    const startEditing = () => {
        if (canEdit) {
            setIsEditing(true);
            return;
        }

        onRequestEdit(() => setIsEditing(true));
    };
    const closeWithDiscardCheck = () => {
        if (!isEditing || !textChanged) {
            onClose();
            return;
        }

        Alert.alert("捨棄變更", "目前內容尚未儲存，確定要捨棄變更？", [
            {text: "取消", style: "cancel"},
            {
                text: "捨棄",
                style: "destructive",
                onPress: onClose,
            },
        ]);
    };

    return (
        <Modal visible={target !== null} transparent animationType="fade" onRequestClose={closeWithDiscardCheck}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.modalOverlay}
            >
                <View style={styles.modalInnerContainer}>
                    <View style={styles.modalHeaderRow}>
                        <Text fontSize="xl" color="gray800" fontWeight="bold" style={styles.modalHeaderTitle} numberOfLines={2}>
                            {target?.title ?? "編輯"}
                        </Text>
                        {isEditing ? (
                            <View style={styles.modalHeaderActions}>
                                <Text
                                    fontSize="lg"
                                    color={text.length >= limit ? "red600" : "gray600"}
                                    style={styles.modalCharacterCount}
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.82}
                                >
                                    {text.length}/{limit}
                                </Text>
                                <TouchableOpacity onPress={confirmClearText} hitSlop={hitSlop} disabled={saving || text.length === 0}>
                                    <Icon name="trash" fontFamily="Feather" color={text.length === 0 ? "gray400" : "gray800"} fontSize="2xl" ml="md" />
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <TouchableOpacity onPress={startEditing} hitSlop={hitSlop} style={styles.modalUpdateButton}>
                                <Icon name="edit-2" fontFamily="Feather" color="gray800" fontSize="xl" mr="xs" />
                                <Text fontSize="lg" color="gray800" fontWeight="bold">更新</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {isEditing ? (
                        <>
                            <Input
                                value={text}
                                autoFocus
                                multiline
                                numberOfLines={Math.max(1, text.split("\n").length)}
                                maxLength={limit}
                                onChangeText={handleTextChange}
                                placeholder="請輸入內容..."
                                scrollEnabled={inputHeight >= 220}
                                h={inputHeight}
                                px={2}
                                fontSize="lg"
                                borderColor="transparent"
                                rounded={0}
                                borderBottomColor="gray800"
                                borderBottomWidth={1}
                                mx="sm"
                                mt="md"
                            />

                            <Animated.View
                                pointerEvents={showSuggestions ? "auto" : "none"}
                                style={[styles.textSuggestionSection, suggestionsAnimatedStyle]}
                            >
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.textSuggestionList}
                                    keyboardShouldPersistTaps="handled"
                                >
                                    {filteredSuggestions.map((suggestion) => (
                                        <TouchableOpacity
                                            key={suggestion}
                                            activeOpacity={0.78}
                                            onPress={() => setText(suggestion)}
                                            style={styles.textSuggestionChip}
                                        >
                                            <Text color="blue700" fontSize="sm" fontWeight="bold" numberOfLines={1}>
                                                {suggestion}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </Animated.View>

                            <View style={styles.modalFooterRow}>
                                <Button
                                    flex={1}
                                    bg="gray500"
                                    mr="sm"
                                    rounded={15}
                                    fontSize="md"
                                    fontWeight="bold"
                                    disabled={saving}
                                    onPress={closeWithDiscardCheck}
                                    prefix={<Icon mr="xs" fontSize="md" name="close" color="white" fontFamily="MaterialCommunityIcons" />}
                                >
                                    取消
                                </Button>
                                <Button
                                    flex={1}
                                    ml="sm"
                                    rounded={15}
                                    fontSize="md"
                                    fontWeight="bold"
                                    disabled={saving}
                                    bg="#4CAF7D"
                                    onPress={() => { void onSave(text); }}
                                    suffix={<Icon ml="xs" fontSize="md" name="save" color="white" fontFamily="Feather" />}
                                >
                                    儲存
                                </Button>
                            </View>
                        </>
                    ) : (
                        <>
                            <ScrollView style={styles.modalReadOnlyScroll} contentContainerStyle={styles.modalReadOnlyContent}>
                                <Text px={2} mx="md" fontSize="lg" color={text.trim() ? "gray800" : "gray600"} textAlign="justify">
                                    {text.trim() || "（尚未填寫）"}
                                </Text>
                            </ScrollView>

                            <Button
                                block
                                bg="gray500"
                                mt="md"
                                my="sm"
                                rounded={15}
                                fontSize="md"
                                fontWeight="bold"
                                onPress={closeWithDiscardCheck}
                            >
                                關閉
                            </Button>
                        </>
                    )}
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

function ZoomablePhotoViewer({
    uri,
    imageSize,
}: {
    uri: string;
    imageSize: {width: number; height: number};
}) {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);
    const lift = useSharedValue(0);

    useEffect(() => {
        scale.value = 1;
        savedScale.value = 1;
        translateX.value = 0;
        translateY.value = 0;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        lift.value = 0;
    }, [imageSize.height, imageSize.width, lift, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, uri]);

    const springConfig = useMemo(() => ({
        damping: 18,
        stiffness: 170,
        mass: 0.8,
    }), []);

    const pinchGesture = useMemo(() => Gesture.Pinch()
        .onBegin(() => {
            lift.value = withSpring(1, springConfig);
        })
        .onUpdate((event) => {
            const nextScale = Math.min(Math.max(savedScale.value * event.scale, 1), 4.4);
            scale.value = nextScale;
        })
        .onFinalize(() => {
            scale.value = withSpring(1, springConfig);
            translateX.value = withSpring(0, springConfig);
            translateY.value = withSpring(0, springConfig);
            savedScale.value = 1;
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
            lift.value = withSpring(0, springConfig);
        }), [imageSize.height, imageSize.width, lift, savedScale, savedTranslateX, savedTranslateY, scale, springConfig, translateX, translateY]);

    const panGesture = useMemo(() => Gesture.Pan()
        .minDistance(2)
        .onBegin(() => {
            lift.value = withSpring(1, springConfig);
        })
        .onUpdate((event) => {
            if (scale.value <= 1) {
                translateX.value = 0;
                translateY.value = 0;
                return;
            }

            const maxX = Math.max(0, (imageSize.width * (scale.value - 1)) / 2);
            const maxY = Math.max(0, (imageSize.height * (scale.value - 1)) / 2);
            const overDrag = 42;

            translateX.value = Math.min(Math.max(savedTranslateX.value + event.translationX, -maxX - overDrag), maxX + overDrag);
            translateY.value = Math.min(Math.max(savedTranslateY.value + event.translationY, -maxY - overDrag), maxY + overDrag);
        })
        .onFinalize(() => {
            scale.value = withSpring(1, springConfig);
            translateX.value = withSpring(0, springConfig);
            translateY.value = withSpring(0, springConfig);
            savedScale.value = 1;
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
            lift.value = withSpring(0, springConfig);
        }), [imageSize.height, imageSize.width, lift, savedScale, savedTranslateX, savedTranslateY, scale, springConfig, translateX, translateY]);

    const doubleTapGesture = useMemo(() => Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(260)
        .onEnd(() => {
            const zoomed = scale.value > 1.05;
            const nextScale = zoomed ? 1 : 2;

            scale.value = withSpring(nextScale, springConfig);
            savedScale.value = nextScale;
            translateX.value = withSpring(0, springConfig);
            translateY.value = withSpring(0, springConfig);
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
        }), [savedScale, savedTranslateX, savedTranslateY, scale, springConfig, translateX, translateY]);

    const composedGesture = useMemo(
        () => Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture),
        [doubleTapGesture, panGesture, pinchGesture],
    );
    const floatingStyle = useAnimatedStyle(() => ({
        transform: [
            {scale: 1 + lift.value * 0.02},
        ],
    }));
    const imageAnimatedStyle = useAnimatedStyle(() => ({
        transform: [
            {translateX: translateX.value},
            {translateY: translateY.value},
            {scale: scale.value},
        ],
    }));

    return (
        <GestureDetector gesture={composedGesture}>
            <Reanimated.View style={[styles.photoPreviewImageWrap, imageSize, floatingStyle]}>
                <Reanimated.View style={[styles.photoZoomContent, imageSize, imageAnimatedStyle]}>
                    <ExpoImage source={{uri}} style={[styles.photoPreviewImage, imageSize]} contentFit="contain" />
                </Reanimated.View>
            </Reanimated.View>
        </GestureDetector>
    );
}

function PropertyPhotoPreviewModal({
    photo,
    onClose,
    onDelete,
    onSaveToLibrary,
    savingToLibrary,
}: {
    photo: PropertyPhoto | null;
    onClose: () => void;
    onDelete: () => void;
    onSaveToLibrary: () => void;
    savingToLibrary: boolean;
}) {
    const {width: windowWidth, height: windowHeight} = useWindowDimensions();
    const [displayPhoto, setDisplayPhoto] = useState<PropertyPhoto | null>(photo);
    const activePhoto = photo ?? displayPhoto;

    useEffect(() => {
        if (photo) setDisplayPhoto(photo);
    }, [photo]);

    const imageSize = useMemo(() => {
        const maxWidth = Math.min(Math.max(windowWidth - 72, 240), 406);
        const maxHeight = Math.max(windowHeight * 0.62, 280);
        const photoWidth = activePhoto?.width ?? 0;
        const photoHeight = activePhoto?.height ?? 0;

        if (!photoWidth || !photoHeight) {
            return {
                width: Math.min(maxWidth, 360),
                height: Math.min(maxHeight, 420),
            };
        }

        const scale = Math.min(maxWidth / photoWidth, maxHeight / photoHeight, 1);

        return {
            width: photoWidth * scale,
            height: photoHeight * scale,
        };
    }, [activePhoto?.height, activePhoto?.width, windowHeight, windowWidth]);

    return (
        <Modal visible={photo !== null} transparent animationType="fade" onRequestClose={onClose} onDismiss={() => setDisplayPhoto(null)}>
            <GestureHandlerRootView style={styles.photoPreviewModalRoot}>
                <Pressable style={styles.photoPreviewOverlay} onPress={onClose}>
                    <Pressable
                        style={[styles.photoPreviewPanel, {width: Math.max(imageSize.width + 24, 230)}]}
                        onPress={(event) => event.stopPropagation()}
                    >
                        {activePhoto && (
                            <ZoomablePhotoViewer uri={activePhoto.uri} imageSize={imageSize} />
                        )}
                        <View style={styles.photoPreviewActionsRow}>
                            <TouchableOpacity activeOpacity={0.78} onPress={onDelete} style={[styles.photoPreviewActionButton, styles.photoPreviewDeleteButton]}>
                                <Icon name="trash-2" fontFamily="Feather" color="#FFFFFF" fontSize="lg" mr="xs" />
                                <Text color="#FFFFFF" fontSize="md" fontWeight="bold">刪除此照片</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.78}
                                disabled={savingToLibrary}
                                onPress={onSaveToLibrary}
                                style={[styles.photoPreviewActionButton, styles.photoPreviewSaveButton, savingToLibrary && styles.photoPreviewActionButtonDisabled]}
                            >
                                <Icon name="download" fontFamily="Feather" color="#1D4ED8" fontSize="lg" mr="xs" />
                                <Text color="#1D4ED8" fontSize="md" fontWeight="bold">
                                    {savingToLibrary ? "儲存中" : "儲存至相簿"}
                                </Text>
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity activeOpacity={0.78} onPress={onClose} style={styles.photoPreviewCloseButton}>
                            <Text color="gray700" fontSize="md" fontWeight="bold">關閉</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            </GestureHandlerRootView>
        </Modal>
    );
}

function PhotoSourceMenu({
    addingPhoto,
    children,
    onSelect,
    triggerStyle,
}: {
    addingPhoto: boolean;
    children: React.ReactNode;
    onSelect: (source: "camera" | "library") => void;
    triggerStyle?: StyleProp<ViewStyle>;
}) {
    const actions = useMemo<MenuAction[]>(() => [
        {
            id: "camera",
            title: "拍照",
            image: "camera",
            attributes: addingPhoto ? {disabled: true} : undefined,
        },
        {
            id: "library",
            title: "從圖庫選擇",
            image: "photo.on.rectangle",
            attributes: addingPhoto ? {disabled: true} : undefined,
        },
    ], [addingPhoto]);
    const handlePressAction = useCallback((event: NativeActionEvent) => {
        const source = event.nativeEvent.event;
        if (source !== "camera" && source !== "library") return;

        onSelect(source);
    }, [onSelect]);

    const menu = (
        <MenuView
            title="新增照片"
            actions={actions}
            onPressAction={handlePressAction}
            style={triggerStyle ? styles.addPhotoMenuInnerTrigger : undefined}
        >
            {children}
        </MenuView>
    );

    if (!triggerStyle) return menu;

    return (
        <View style={triggerStyle}>
            {menu}
        </View>
    );
}

function DetailYearMenu({
    years,
    selectedYear,
    onSelect,
}: {
    years: string[];
    selectedYear: string | null;
    onSelect: (year: string) => void;
}) {
    const actions = useMemo<MenuAction[]>(() => (
        years.map((year) => ({
            id: year,
            title: `${year} 年度`,
            titleColor: "#2563EB",
            state: selectedYear && isSamePropertyYear(year, selectedYear) ? "on" : undefined,
        }))
    ), [selectedYear, years]);
    const handlePressAction = useCallback((event: NativeActionEvent) => {
        onSelect(event.nativeEvent.event);
    }, [onSelect]);

    if (years.length === 0 || !selectedYear) return null;

    return (
        <MenuView title="查看盤點狀態年度" actions={actions} onPressAction={handlePressAction}>
            <View style={styles.detailYearTrigger}>
                <Text color="#2563EB" fontSize="sm" fontWeight="bold">
                    {selectedYear} 年度
                </Text>
                <Icon name="chevron-down" fontFamily="Feather" color="#2563EB" fontSize={14} ml={2} />
            </View>
        </MenuView>
    );
}

type DetailEntityMenuOption = {
    id: string;
    title: string;
};

function DetailEntityMenu({
    index,
    total,
    options,
    onSelect,
    onManageSplit,
    isSplit,
}: {
    index: number;
    total: number;
    options: DetailEntityMenuOption[];
    onSelect: (index: number) => void;
    onManageSplit: () => void;
    isSplit: boolean;
}) {
    const actions = useMemo<MenuAction[]>(() => (
        [...options.map((option, optionIndex) => ({
            id: option.id,
            title: option.title,
            titleColor: "#2563EB",
            state: optionIndex === index ? "on" as const : undefined,
        })), {
            id: "manage-split",
            title: isSplit ? "調整拆分實體" : "拆分為更多實體",
            titleColor: "#2563EB",
            image: "square.split.2x1" as const,
            imageColor: "#2563EB",
        }]
    ), [index, isSplit, options]);
    const handlePressAction = useCallback((event: NativeActionEvent) => {
        if (event.nativeEvent.event === "manage-split") {
            onManageSplit();
            return;
        }
        const nextIndex = Number(event.nativeEvent.event);
        if (!Number.isInteger(nextIndex)) return;

        onSelect(nextIndex);
    }, [onManageSplit, onSelect]);

    return (
        <View style={styles.detailEntityMenuHost}>
            <MenuView title="選擇實體" actions={actions} onPressAction={handlePressAction}>
                <View style={styles.detailEntityTrigger}>
                    <Text textAlign="center" color="gray600" fontWeight="bold" fontSize="sm">
                        實體 {index + 1} / {total}
                    </Text>
                    <Icon name="chevron-down" fontFamily="Feather" color="gray600" fontSize={14} ml={3} />
                </View>
            </MenuView>
        </View>
    );
}

function PropertySplitModal({
    item,
    baseItemNumber,
    initialEntities,
    otherBarcodeEntities,
    saving,
    onClose,
    onSave,
    onCancelSplit,
}: {
    item: PropertyItem | null;
    baseItemNumber: string;
    initialEntities: PropertySplitEntityInput[];
    otherBarcodeEntities: Array<{itemNumber: string; propertyName: string}>;
    saving: boolean;
    onClose: () => void;
    onSave: (entities: PropertySplitEntityInput[]) => void;
    onCancelSplit: () => void;
}) {
    const isAlreadySplit = !!item?.split;
    const [entities, setEntities] = useState(() => initialEntities.map((entity) => ({
        ...entity,
        isExisting: isAlreadySplit,
    })));
    const initialExistingEntityCount = initialEntities.filter((entity) => entity.existingPart !== undefined).length;

    const save = () => {
        if (entities.some((entity) => !entity.name.trim())) {
            Alert.alert("請填寫名稱", "每個拆分實體都必須填寫名稱。");
            return;
        }
        const hasAddedEntity = entities.some((entity) => !entity.isExisting);
        const hasDeletedEntity = entities.filter((entity) => entity.isExisting).length < initialExistingEntityCount;
        const saveEntities = () => onSave(entities.map(({name, existingPart}) => ({
            name,
            ...(existingPart ? {existingPart} : {}),
        })));

        if (isAlreadySplit && !hasAddedEntity && !hasDeletedEntity) {
            onClose();
            return;
        }

        if (hasAddedEntity) {
            Alert.alert(
                "確認拆分名稱",
                "儲存後名稱無法更改；如果要更改名稱，必須重新拆分。是否確定名稱正確？",
                [
                    {text: "返回", style: "cancel"},
                    {text: "確認儲存", onPress: saveEntities},
                ],
            );
            return;
        }

        Alert.alert("確認儲存變更", "確定要儲存刪除實體的變更？", [
            {text: "返回", style: "cancel"},
            {text: "確認儲存", style: "destructive", onPress: saveEntities},
        ]);
    };

    const addEntity = () => {
        if (entities.length >= 20) {
            Alert.alert("已達上限", "最多可拆分為 20 個實體。");
            return;
        }
        setEntities((current) => [...current, {name: "", isExisting: false}]);
    };

    const removeEntity = (index: number) => {
        if (entities.length <= 2) {
            Alert.alert("至少需要兩個實體", "若要回復為單一實體，請使用取消拆分。 ");
            return;
        }
        const remove = () => setEntities((current) => current.filter((_, entityIndex) => entityIndex !== index));
        if (!entities[index].isExisting) {
            remove();
            return;
        }
        Alert.alert("刪除實體？", "此實體的現場資料、照片與盤點狀態會一併移除。", [
            {text: "取消", style: "cancel"},
            {text: "刪除", style: "destructive", onPress: remove},
        ]);
    };

    return (
        <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onClose}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
                <View style={[styles.modalInnerContainer, styles.splitModalContainer]}>
                    <View style={styles.modalHeaderRow}>
                        <Text fontSize="xl" color="gray800" fontWeight="bold" style={styles.modalHeaderTitle}>
                            {isAlreadySplit ? "調整拆分實體" : "拆分為更多實體"}
                        </Text>
                        <TouchableOpacity onPress={onClose} disabled={saving} hitSlop={hitSlop}>
                            <Icon name="close" color="gray700" fontSize="2xl" fontFamily="AntDesign" />
                        </TouchableOpacity>
                    </View>
                    <Text mt="md" color="gray600" fontSize="md">
                        每個實體會分開保存位置、備註、照片及各年度盤點狀態；之後匯入同一筆盤點資料時，拆分方式會保留。
                    </Text>
                    <ScrollView style={styles.splitEntityList} keyboardShouldPersistTaps="handled">
                        {entities.map((entity, index) => (
                            <View key={`${index}:${entities.length}`} style={styles.splitEntityRow}>
                                <View style={styles.splitEntityNumber}>
                                    <Text color="#1D4ED8" fontWeight="bold" fontSize="sm">
                                        {baseItemNumber || "項次"}-{index + 1}
                                    </Text>
                                </View>
                                {entity.isExisting ? (
                                    <View style={styles.splitEntityExistingName}>
                                        <Text color="gray800" fontSize="md" numberOfLines={2}>{entity.name}</Text>
                                    </View>
                                ) : (
                                    <Input
                                        value={entity.name}
                                        onChangeText={(name) => setEntities((current) => current.map((currentEntity, entityIndex) => (
                                            entityIndex === index ? {...currentEntity, name} : currentEntity
                                        )))}
                                        hitSlop={10}
                                        editable={!saving}
                                        flex={1}
                                        minW={0}
                                        px="sm"
                                        h={44}
                                        rounded={9}
                                        borderColor="gray300"
                                        fontSize="md"
                                        placeholder="請輸入實體名稱"
                                    />
                                )}
                                <TouchableOpacity
                                    disabled={saving}
                                    onPress={() => removeEntity(index)}
                                    style={[styles.splitEntityDeleteButton, saving && styles.addPhotoButtonDisabled]}
                                    hitSlop={hitSlop}
                                >
                                    <Icon name="trash-2" fontFamily="Feather" color="#DC2626" fontSize="lg" />
                                </TouchableOpacity>
                            </View>
                        ))}
                        <Button
                            block mt="xs" bg="#EFF6FF" color="#1D4ED8" borderWidth={1} borderColor="#93C5FD" borderStyle="dashed"
                            rounded={12} disabled={saving} onPress={addEntity}
                            prefix={<Icon color="#1D4ED8" fontSize="md" mr="sm" name="add-box" fontFamily="MaterialIcons"/>}
                        >
                            新增更多實體
                        </Button>
                        {otherBarcodeEntities.length > 0 && (
                            <Text mt="sm" mb={6} color="gray500" fontSize="sm">同條碼的其他清單項次</Text>
                        )}
                        {otherBarcodeEntities.map((entity) => (
                            <View key={`${entity.itemNumber}:${entity.propertyName}`} style={[styles.splitEntityRow, styles.splitEntityOtherRow]}>
                                <View style={styles.splitEntityNumber}>
                                    <Text color="gray600" fontWeight="bold" fontSize="sm">{entity.itemNumber}</Text>
                                </View>
                                <View style={styles.splitEntityExistingName}>
                                    <Text color="gray700" fontSize="md" numberOfLines={2}>{entity.propertyName}</Text>
                                </View>
                            </View>
                        ))}
                    </ScrollView>
                    {isAlreadySplit && (
                        <TouchableOpacity disabled={saving} onPress={onCancelSplit} style={styles.cancelSplitButton}>
                            <Text color="#DC2626" fontSize="sm" fontWeight="bold">取消拆分並回復為單一實體</Text>
                        </TouchableOpacity>
                    )}
                    <View style={styles.modalFooterRow}>
                        <Button flex={1} bg="gray500" mr="sm" rounded={15} fontWeight="bold" disabled={saving} onPress={onClose}>
                            取消
                        </Button>
                        <Button flex={1} ml="sm" bg="#4CAF7D" rounded={15} fontWeight="bold" disabled={saving} onPress={save}>
                            {saving ? "儲存中..." : "確認"}
                        </Button>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

type RelationshipPickerMode = "parent" | "child";

type RelationshipPickerState = {
    mode: RelationshipPickerMode;
    title: string;
    targets: PropertyRelationshipTarget[];
};

function RelationshipPickerModal({
    state,
    year,
    onClose,
    onSelect,
}: {
    state: RelationshipPickerState | null;
    year: string | null;
    onClose: () => void;
    onSelect: (target: PropertyRelationshipTarget) => void;
}) {
    const [keyword, setKeyword] = useState("");
    const visible = state !== null;
    const normalizedKeyword = keyword.trim().toLowerCase();
    const pickerTargets = state?.targets;
    const filteredTargets = useMemo(() => {
        const targets = pickerTargets ?? [];
        if (!normalizedKeyword) return targets;

        return targets.filter((target) => {
            const itemNumber = getPropertyItemDisplayNumber(target.item, year);
            return [
                target.barcode,
                itemNumber,
                getPropertyItemDisplayName(target.item),
                target.item.custodianName ?? "",
            ].some((value) => value.toLowerCase().includes(normalizedKeyword));
        });
    }, [normalizedKeyword, pickerTargets, year]);
    const closePicker = () => {
        setKeyword("");
        onClose();
    };
    const selectTarget = (target: PropertyRelationshipTarget) => {
        setKeyword("");
        onSelect(target);
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={closePicker}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalInnerContainer, styles.relationshipPickerContainer]}>
                    <View style={styles.modalHeaderRow}>
                        <Text fontSize="xl" color="gray800" fontWeight="bold" style={styles.modalHeaderTitle} numberOfLines={2}>
                            {state?.title ?? "選擇財產"}
                        </Text>
                        <TouchableOpacity onPress={closePicker} hitSlop={hitSlop}>
                            <Icon name="close" color="gray700" fontSize="2xl" fontFamily="AntDesign" />
                        </TouchableOpacity>
                    </View>
                    <Input
                        value={keyword}
                        onChangeText={setKeyword}
                        mt="md"
                        mb="sm"
                        px="lg"
                        rounded={12}
                        borderColor="gray300"
                        fontSize="md"
                        placeholder="搜尋品名、財產編號、項次或保管人"
                        prefix={<Icon name="search" fontFamily="Feather" color="gray500" fontSize="lg" mr="sm" />}
                    />
                    <FlatList
                        data={filteredTargets}
                        keyExtractor={(target) => target.entityKey}
                        keyboardShouldPersistTaps="handled"
                        style={styles.relationshipPickerList}
                        contentContainerStyle={filteredTargets.length === 0 ? styles.relationshipPickerEmptyContent : styles.relationshipPickerContent}
                        renderItem={({item: target}) => (
                            <TouchableOpacity
                                activeOpacity={0.78}
                                onPress={() => selectTarget(target)}
                                style={styles.relationshipCandidateRow}
                            >
                                <View style={styles.relationshipCandidateText}>
                                    <Text color="gray900" fontWeight="bold" fontSize="md" numberOfLines={1}>
                                        {target.barcode}
                                    </Text>
                                    <Text mt={3} color="gray600" fontSize="sm" numberOfLines={1}>
                                        {getPropertyItemDisplayName(target.item)}
                                    </Text>
                                </View>
                                <Icon name="chevron-right" fontFamily="Feather" color="gray500" fontSize="xl" />
                            </TouchableOpacity>
                        )}
                        ListEmptyComponent={(
                            <View style={styles.relationshipPickerEmpty}>
                                <Text color="gray600" fontSize="md" textAlign="center">
                                    {keyword.trim() ? "沒有符合條件的財產實體" : "沒有可選擇的財產實體"}
                                </Text>
                            </View>
                        )}
                    />
                </View>
            </View>
        </Modal>
    );
}

function RelationshipItemCard({
    target,
    fallbackKey,
    year,
    actionIcon,
    actionDestructive = false,
    onPress,
    onActionPress,
}: {
    target: PropertyRelationshipTarget | null;
    fallbackKey?: string | null;
    year: string | null;
    actionIcon?: string;
    actionDestructive?: boolean;
    onPress: () => void;
    onActionPress?: () => void;
}) {
    const existsInYear = propertyRelationshipExistsInYear(target, year);
    const yearStatusLabel = getPropertyRelationshipYearStatusLabel(target, year);
    const backgroundColor = existsInYear ? "#F8FAFC" : "#FFFBEB";
    const borderColor = existsInYear ? "#CBD5E1" : "#FDE68A";
    const barcodeText = target
        ? `${target.barcode}${yearStatusLabel ? `（${yearStatusLabel}）` : ""}`
        : fallbackKey ?? "找不到財產資料";
    const propertyNameText = target ? getPropertyItemDisplayName(target.item) : "此關係指向的財產資料不存在";

    return (
        <Pressable onPress={onPress}>
            {({pressed}) => (
                <View
                    style={[
                        styles.relationshipItemCard,
                        {
                            backgroundColor,
                            borderColor,
                            shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
                        },
                    ]}
                >
                    <View style={styles.relationshipItemContent}>
                        <Text mb={2} fontSize={12} color="gray900" numberOfLines={1}>
                            {barcodeText}
                        </Text>
                        <Text mt={2} fontSize={14} fontWeight="bold" color="gray700" lineHeight={19} numberOfLines={1}>
                            {propertyNameText}
                        </Text>
                    </View>
                    {actionIcon && onActionPress && (
                        <TouchableOpacity
                            activeOpacity={0.78}
                            onPress={onActionPress}
                            style={[
                                styles.relationshipCardIconButton,
                                actionDestructive && styles.relationshipCardIconButtonDestructive,
                            ]}
                        >
                            <Icon
                                name={actionIcon}
                                fontFamily="Feather"
                                color={actionDestructive ? "#DC2626" : "#1D4ED8"}
                                fontSize="lg"
                            />
                        </TouchableOpacity>
                    )}
                    {pressed && <View pointerEvents="none" style={styles.relationshipPressedOverlay} />}
                </View>
            )}
        </Pressable>
    );
}

function RelationshipPlaceholderButton({
    title,
    icon,
    disabled,
    onPress,
}: {
    title: string;
    icon: string;
    disabled: boolean;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            activeOpacity={0.78}
            disabled={disabled}
            onPress={onPress}
            style={[styles.relationshipPlaceholderButton, disabled && styles.relationshipButtonDisabled]}
        >
            <Icon name={icon} fontFamily="Feather" color="gray800" fontSize="md" mr="xs" />
            <Text color="gray800" fontSize="md" fontWeight="bold">{title}</Text>
        </TouchableOpacity>
    );
}

function PropertyRelationshipSection({
    item,
    entityIndex,
    targets,
    year,
    disabled,
    onOpenParentPicker,
    onOpenChildPicker,
    onClearParent,
    onRemoveChild,
    onOpenTarget,
}: {
    item: PropertyItem;
    entityIndex: number;
    targets: PropertyRelationshipTarget[];
    year: string | null;
    disabled: boolean;
    onOpenParentPicker: () => void;
    onOpenChildPicker: () => void;
    onClearParent: () => void;
    onRemoveChild: (childEntityKey: string) => void;
    onOpenTarget: (target: PropertyRelationshipTarget | null, fallbackKey?: string | null) => void;
}) {
    const currentEntityKey = getPropertyEntityKey(item.barcode, entityIndex);
    const targetByKey = useMemo(() => new Map(targets.map((target) => [target.entityKey, target])), [targets]);
    const parentTarget = item.parentEntityKey ? targetByKey.get(item.parentEntityKey) ?? null : null;
    const childEntityKeys = [...new Set((item.childEntityKeys ?? []).filter((key) => (
        key !== currentEntityKey && parsePropertyEntityKey(key) !== null
    )))];

    return (
        <View style={styles.relationshipSection}>
            <View style={styles.relationshipFieldRow}>
                <View style={styles.relationshipFieldHeader}>
                    <Text fontSize="md" color="gray600" style={styles.detailLabel}>附屬於</Text>
                </View>
                {item.parentEntityKey ? (
                    <RelationshipItemCard
                        target={parentTarget}
                        fallbackKey={item.parentEntityKey}
                        year={year}
                        actionIcon="x"
                        actionDestructive
                        onPress={() => onOpenTarget(parentTarget, item.parentEntityKey)}
                        onActionPress={onClearParent}
                    />
                ) : (
                    <RelationshipPlaceholderButton
                        title="設定上層關聯"
                        icon="git-merge"
                        disabled={disabled}
                        onPress={onOpenParentPicker}
                    />
                )}
            </View>
            <View style={styles.relationshipFieldRow}>
                <View style={styles.relationshipFieldHeader}>
                    <Text fontSize="md" color="gray600" style={styles.detailLabel}>附屬財產</Text>
                </View>
                {childEntityKeys.length === 0 ? (
                    <RelationshipPlaceholderButton
                        title="新增下層附屬財產"
                        icon="plus"
                        disabled={disabled}
                        onPress={onOpenChildPicker}
                    />
                ) : (
                    <>
                        {childEntityKeys.map((childEntityKey) => {
                            const childTarget = targetByKey.get(childEntityKey) ?? null;

                            return (
                                <RelationshipItemCard
                                    key={childEntityKey}
                                    target={childTarget}
                                    fallbackKey={childEntityKey}
                                    year={year}
                                    actionIcon="trash-2"
                                    actionDestructive
                                    onPress={() => onOpenTarget(childTarget, childEntityKey)}
                                    onActionPress={() => onRemoveChild(childEntityKey)}
                                />
                            );
                        })}
                        <RelationshipPlaceholderButton
                            title="新增下層附屬財產"
                            icon="plus"
                            disabled={disabled}
                            onPress={onOpenChildPicker}
                        />
                    </>
                )}
            </View>
        </View>
    );
}

function PropertyDetailBlock({
    item,
    index,
    actualEntityIndex,
    total,
    areaLayout,
    status,
    year,
    onEditText,
    onSelectArea,
    draftLocationArea,
    locationEditMode,
    fieldsEditable,
    statusLocked,
    completionFeedbackMessage,
    completionFeedbackKey,
    onRequestEditMode,
    onAddPhoto,
    onPreviewPhoto,
    onPhotoOptions,
    addingPhoto,
    relationshipTargets,
    relationshipDisabled,
    onOpenParentPicker,
    onOpenChildPicker,
    onClearParent,
    onRemoveChild,
    onOpenRelationshipTarget,
    summaryOnly = false,
    statusTitle = "目前狀態",
    entityOptions = [],
    onSelectEntity,
    onManageSplit,
}: {
    item: PropertyItem;
    index: number;
    actualEntityIndex: number;
    total: number;
    areaLayout: AreaLayout | null;
    status: PropertyStatus;
    year: string | null;
    onEditText: (item: PropertyItem, entityIndex: number, field: PropertyItemEditableTextField) => void;
    onSelectArea: (item: PropertyItem, entityIndex: number, area: AreaLayoutArea | null) => void;
    draftLocationArea: {id: string; name: string} | null;
    locationEditMode: boolean;
    fieldsEditable: boolean;
    statusLocked: boolean;
    completionFeedbackMessage: string | null;
    completionFeedbackKey: number;
    onRequestEditMode: () => void;
    onAddPhoto: (item: PropertyItem, entityIndex: number, source: "camera" | "library") => void;
    onPreviewPhoto: (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => void;
    onPhotoOptions: (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => void;
    addingPhoto: boolean;
    relationshipTargets: PropertyRelationshipTarget[];
    relationshipDisabled: boolean;
    onOpenParentPicker: () => void;
    onOpenChildPicker: () => void;
    onClearParent: () => void;
    onRemoveChild: (childEntityKey: string) => void;
    onOpenRelationshipTarget: (target: PropertyRelationshipTarget | null, fallbackKey?: string | null) => void;
    summaryOnly?: boolean;
    statusTitle?: string;
    entityOptions?: DetailEntityMenuOption[];
    onSelectEntity?: (index: number) => void;
    onManageSplit: () => void;
}) {
    const {width: windowWidth} = useWindowDimensions();
    const statusColors = PROPERTY_STATUS_COLORS[status];
    const [photoSectionWidth, setPhotoSectionWidth] = useState(0);
    const savedAreaId = areaLayout
        ? findAreaByIdOrName(areaLayout.areas, item.location.areaId, item.location.areaName)?.id ?? null
        : item.location.areaId;
    const photoCount = item.photos?.length ?? 0;
    const addPhotoButtonWidth = photoSectionWidth || Math.max(windowWidth - 42, 0);
    const handlePhotoSectionLayout = useCallback((event: LayoutChangeEvent) => {
        const nextWidth = event.nativeEvent.layout.width;

        setPhotoSectionWidth((currentWidth) => (
            Math.abs(currentWidth - nextWidth) < 1 ? currentWidth : nextWidth
        ));
    }, []);
    const singlePhotoThumbSize = useMemo(() => {
        const side = Math.min(Math.max(windowWidth * 0.46, 160), 190);

        return {
            width: side,
            height: side,
        };
    }, [windowWidth]);

    return (
        <Div mb="lg">
            <View
                style={[styles.summaryCard, {backgroundColor: statusColors.cardBg}]}
            >
                {onSelectEntity && (
                    <DetailEntityMenu
                        index={index}
                        total={total}
                        options={entityOptions}
                        onSelect={onSelectEntity}
                        onManageSplit={onManageSplit}
                        isSplit={!!item.split}
                    />
                )}
                <Text textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="2xl">{item.propertyName}</Text>
            </View>
            <View style={styles.summaryMetaRow}>
                <View style={[styles.summarySubCard, {backgroundColor: statusColors.cardBg}]}>
                    <Text textAlign="center" color={statusColors.nameColor} fontWeight="bold" fontSize="md">清單項次</Text>
                    <Text mt={4} textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="xl">{item.itemNumber}</Text>
                </View>
                <View style={[styles.summarySubCard, {backgroundColor: statusColors.cardBg}]}>
                    <Text textAlign="center" color={statusColors.nameColor} fontWeight="bold" fontSize="md" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                        {statusTitle}
                    </Text>
                    <Text mt={4} textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="xl">{PROPERTY_STATUS_LABELS[status]}</Text>
                </View>
                <View style={[styles.summarySubCard, {backgroundColor: statusColors.cardBg}]}>
                    <Text textAlign="center" color={statusColors.nameColor} fontWeight="bold" fontSize="md">保管人</Text>
                    <Text mt={4} textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="xl" numberOfLines={1}>
                        {item.custodianName?.trim() || "未提供"}
                    </Text>
                </View>
            </View>
            {!summaryOnly && (
            <View style={styles.detailCard}>
                <AreaLayoutInlinePreview
                    layout={areaLayout}
                    currentAreaId={item.location.areaId}
                    currentAreaName={item.location.areaName}
                    selectedAreaIdOverride={locationEditMode ? draftLocationArea?.id ?? null : savedAreaId}
                    editable={fieldsEditable}
                    locked={statusLocked && !fieldsEditable}
                    showEditButton={statusLocked && !fieldsEditable}
                    completionFeedbackMessage={completionFeedbackMessage}
                    completionFeedbackKey={completionFeedbackKey}
                    onRequestEditMode={onRequestEditMode}
                    onSelectArea={(area) => onSelectArea(item, actualEntityIndex, area)}
                />
                <EditableDetailRow
                    label="詳細位置描述"
                    value={item.location.description}
                    onPress={() => onEditText(item, actualEntityIndex, "locationDescription")}
                />
                <EditableDetailRow
                    label="其他備註"
                    value={item.note}
                    onPress={() => onEditText(item, actualEntityIndex, "note")}
                />
                <View style={styles.photoSection} onLayout={handlePhotoSectionLayout}>
                    <View style={styles.photoSectionHeader}>
                        <Text fontSize="md" color="gray600" style={[styles.detailLabel, styles.photoSectionTitle]} numberOfLines={1}>財產照片</Text>
                        <Text
                            fontSize="sm"
                            color="gray500"
                            style={styles.photoSectionCount}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.82}
                        >
                            {photoCount} / {MAX_PROPERTY_PHOTO_COUNT}
                        </Text>
                    </View>
                    {photoCount > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                            {item.photos?.map((photo) => (
                                <TouchableOpacity
                                    key={photo.id}
                                    activeOpacity={0.82}
                                    onPress={() => onPreviewPhoto(item, actualEntityIndex, photo)}
                                    onLongPress={() => onPhotoOptions(item, actualEntityIndex, photo)}
                                    style={[styles.photoThumbFrame, photoCount === 1 && singlePhotoThumbSize]}
                                >
                                    <ExpoImage source={{uri: photo.uri}} style={styles.photoThumb} contentFit="cover" />
                                </TouchableOpacity>
                            ))}
                            {photoCount < MAX_PROPERTY_PHOTO_COUNT && (
                                <PhotoSourceMenu addingPhoto={addingPhoto} onSelect={(source) => onAddPhoto(item, actualEntityIndex, source)}>
                                    <View
                                        style={[
                                            styles.photoThumbFrame,
                                            photoCount === 1 && singlePhotoThumbSize,
                                            styles.addPhotoThumbButton,
                                            addingPhoto && styles.addPhotoButtonDisabled,
                                        ]}
                                    >
                                        <Icon name="plus" fontFamily="Feather" color="#2563EB" fontSize="3xl" />
                                        <Text mt={4} color="#1D4ED8" fontSize="sm" fontWeight="bold">新增</Text>
                                    </View>
                                </PhotoSourceMenu>
                            )}
                        </ScrollView>
                    )}
                    {photoCount === 0 && (
                        <PhotoSourceMenu
                            addingPhoto={addingPhoto}
                            onSelect={(source) => onAddPhoto(item, actualEntityIndex, source)}
                            triggerStyle={[styles.addPhotoMenuTrigger]}
                        >
                            <View style={[styles.addPhotoButton, addingPhoto && styles.addPhotoButtonDisabled, {width: addPhotoButtonWidth}]}>
                                <Icon name="library-add" fontFamily="MaterialIcons" color="#2563EB" fontSize="sm" mr="sm" style={styles.addPhotoButtonIcon} />
                                <Text color="#1D4ED8" fontWeight="bold" fontSize="md" style={styles.addPhotoButtonText}>
                                    {addingPhoto ? "處理照片中..." : "新增照片"}
                                </Text>
                            </View>
                        </PhotoSourceMenu>
                    )}
                </View>
                <PropertyRelationshipSection
                    item={item}
                    entityIndex={actualEntityIndex}
                    targets={relationshipTargets}
                    year={year}
                    disabled={relationshipDisabled}
                    onOpenParentPicker={onOpenParentPicker}
                    onOpenChildPicker={onOpenChildPicker}
                    onClearParent={onClearParent}
                    onRemoveChild={onRemoveChild}
                    onOpenTarget={onOpenRelationshipTarget}
                />
            </View>
            )}
        </Div>
    );
}

function EntitySelectionStep({
    items,
    statuses,
    fallbackStatus,
    onSelect,
}: {
    items: PropertyItem[];
    statuses: PropertyStatus[];
    fallbackStatus: PropertyStatus;
    onSelect: (entityIndex: number) => void;
}) {
    return (
        <View style={styles.entitySelectionContainer}>
            <Text fontSize="xl" fontWeight="bold" color="gray900" textAlign="center">
                此財產編號有多個實體
            </Text>
            <Text mt={6} mb={16} fontSize="md" color="gray600" textAlign="center">
                請先選擇要查看或清點的實體。
            </Text>
            {items.map((item, index) => {
                const statusColors = PROPERTY_STATUS_COLORS[statuses[index] ?? fallbackStatus];

                return (
                    <TouchableOpacity
                        key={`${item.barcode}:${index}`}
                        activeOpacity={0.78}
                        onPress={() => onSelect(index)}
                        style={[styles.entityChoiceCard, {backgroundColor: statusColors.cardBg}]}
                    >
                        <View style={[styles.entityChoiceNumber, {backgroundColor: statusColors.numberBg}]}>
                            <Text color={statusColors.numberColor} fontWeight="bold" fontSize="md">{index + 1}</Text>
                        </View>
                        <View style={styles.entityChoiceText}>
                            <Text color={statusColors.barcodeColor} fontWeight="bold" fontSize="lg" numberOfLines={1}>
                                {getPropertyItemDisplayName(item)}
                            </Text>
                            <Text mt={4} color={statusColors.nameColor} fontSize="md" numberOfLines={1}>
                                清單項次：{item.itemNumber}
                            </Text>
                        </View>
                        <Icon name="chevron-right" fontFamily="Feather" fontSize="xl" color={statusColors.nameColor} />
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

export default function Details() {
    const insets = useSafeAreaInsets();
    const {showActionSheetWithOptions} = useSafeAreaActionSheet();
    const {selectedYear: activeInspectionYear} = usePropertyYear();
    const params = useLocalSearchParams<{barcode?: string; serial?: string; entityIndex?: string; status?: string; year?: string}>();
    const routeBarcode = useMemo(() => getParamValue(params.barcode) ?? getParamValue(params.serial), [params.barcode, params.serial]);
    const requestedEntityIndex = useMemo(() => parseEntityIndexParam(getParamValue(params.entityIndex)), [params.entityIndex]);
    const requestedYear = useMemo(() => getParamValue(params.year), [params.year]);
    const [resolvedBarcodeMatch, setResolvedBarcodeMatch] = useState<{request: string; barcode: string} | null>(null);
    const barcode = resolvedBarcodeMatch && resolvedBarcodeMatch.request === routeBarcode
        ? resolvedBarcodeMatch.barcode
        : routeBarcode;
    const [items, setItems] = useState<PropertyItem[]>([]);
    const [areaLayout, setAreaLayout] = useState<AreaLayout | null>(null);
    const [relationshipItemsByBarcode, setRelationshipItemsByBarcode] = useState<PropertyItemsByBarcode>({});
    const [relationshipTargets, setRelationshipTargets] = useState<PropertyRelationshipTarget[]>([]);
    const [relationshipPicker, setRelationshipPicker] = useState<RelationshipPickerState | null>(null);
    const [propertyStatus, setPropertyStatus] = useState<PropertyStatus>("unknown");
    const [entityStatuses, setEntityStatuses] = useState<PropertyStatus[]>([]);
    const [viewingYear, setViewingYear] = useState<string | null>(null);
    const [selectedEntityIndex, setSelectedEntityIndex] = useState<number | null>(() => requestedEntityIndex);
    const [editingLockedFields, setEditingLockedFields] = useState(false);
    const [draftLocationArea, setDraftLocationArea] = useState<{id: string; name: string} | null>(null);
    const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
    const [textSuggestions, setTextSuggestions] = useState<Record<PropertyItemEditableTextField, string[]>>({
        locationDescription: [],
        note: [],
    });
    const [savingEditableText, setSavingEditableText] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [updatingLocationArea, setUpdatingLocationArea] = useState(false);
    const [updatingRelationships, setUpdatingRelationships] = useState(false);
    const [updatingPropertyLabelQueue, setUpdatingPropertyLabelQueue] = useState(false);
    const [addingPhoto, setAddingPhoto] = useState(false);
    const [savingPhotoToLibrary, setSavingPhotoToLibrary] = useState(false);
    const [selectedItemInPropertyLabelQueue, setSelectedItemInPropertyLabelQueue] = useState(false);
    const [splitModalItem, setSplitModalItem] = useState<{item: PropertyItem; entityIndex: number} | null>(null);
    const [savingSplit, setSavingSplit] = useState(false);
    const [loading, setLoading] = useState(true);
    const [statusLoading, setStatusLoading] = useState(true);
    const [resolvedStatusRequestKey, setResolvedStatusRequestKey] = useState<string | null>(null);
    const [locationCompletionMessage, setLocationCompletionMessage] = useState<string | null>(null);
    const [locationCompletionKey, setLocationCompletionKey] = useState(0);
    const [previewingPhoto, setPreviewingPhoto] = useState<{
        item: PropertyItem;
        entityIndex: number;
        photo: PropertyPhoto;
    } | null>(null);
    const locationCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusLookupKey = items.map((item) => item.sourceYears.join(",")).join("|");
    const itemYears = useMemo(() => (
        [...new Set(items.flatMap((item) => item.sourceYears))]
            .filter(Boolean)
            .sort(comparePropertyYearsDescending)
    ), [statusLookupKey, items]);
    const selectedRawItem = selectedEntityIndex !== null ? items[selectedEntityIndex] ?? null : null;
    const selectedRawItemYearsKey = selectedRawItem?.sourceYears.join(",") ?? "";
    const detailYearOptions = useMemo(() => (
        selectedRawItem
            ? [...new Set(selectedRawItem.sourceYears)].filter(Boolean).sort(comparePropertyYearsDescending)
            : itemYears
    ), [itemYears, selectedRawItem, selectedRawItemYearsKey]);
    const visibleEntityIndexes = useMemo(() => (
        items.flatMap((item, entityIndex) => (
            viewingYear && !itemExistsInPropertyYear(item.sourceYears, viewingYear) ? [] : [entityIndex]
        ))
    ), [items, viewingYear]);
    const visibleItems = useMemo(() => (
        visibleEntityIndexes.map((entityIndex) => ({
            ...items[entityIndex],
            itemNumber: getPropertyItemDisplayNumber(items[entityIndex], viewingYear),
            propertyName: getPropertyItemDisplayName(items[entityIndex]),
        }))
    ), [items, viewingYear, visibleEntityIndexes]);
    const entityMenuOptions = useMemo<DetailEntityMenuOption[]>(() => (
        visibleItems.map((item, entityIndex) => ({
            id: String(entityIndex),
            title: `實體 ${entityIndex + 1}｜${item.propertyName}`,
        }))
    ), [visibleItems]);
    const visibleEntityStatuses = useMemo(() => (
        visibleEntityIndexes.map((entityIndex) => entityStatuses[entityIndex] ?? "unknown")
    ), [entityStatuses, visibleEntityIndexes]);
    const selectedItem = selectedEntityIndex !== null && visibleEntityIndexes.includes(selectedEntityIndex)
        ? items[selectedEntityIndex] ?? null
        : null;
    const selectedVisibleEntityIndex = selectedEntityIndex !== null
        ? visibleEntityIndexes.indexOf(selectedEntityIndex)
        : -1;
    const statusRequestKey = useMemo(() => [
        barcode ?? "",
        viewingYear ?? "all-years",
        selectedEntityIndex ?? "select-entity",
        items.map((item) => item.sourceYears.join(",")).join("|"),
    ].join("::"), [barcode, items, selectedEntityIndex, viewingYear]);
    const displayedSelectedItem = selectedItem
        ? {
            ...selectedItem,
            itemNumber: getPropertyItemDisplayNumber(selectedItem, viewingYear),
            propertyName: getPropertyItemDisplayName(selectedItem),
        }
        : null;
    const splitModalInitialEntities = useMemo<PropertySplitEntityInput[]>(() => {
        if (!splitModalItem) return [];
        if (!splitModalItem.item.split) {
            return [{name: splitModalItem.item.propertyName}, {name: ""}];
        }
        return items
            .filter((item) => item.split?.groupId === splitModalItem.item.split?.groupId)
            .sort((a, b) => (a.split?.part ?? 0) - (b.split?.part ?? 0))
            .map((item) => ({name: getPropertyItemDisplayName(item), existingPart: item.split?.part}));
    }, [items, splitModalItem]);
    const splitModalBaseItemNumber = splitModalItem
        ? getPropertyItemNumberForYear(splitModalItem.item, viewingYear)
        : "";
    const splitModalOtherBarcodeEntities = useMemo(() => {
        if (!splitModalItem) return [];
        const currentGroupId = splitModalItem.item.split?.groupId;

        return items.flatMap((item, entityIndex) => {
            const belongsToCurrentItem = currentGroupId
                ? item.split?.groupId === currentGroupId
                : entityIndex === splitModalItem.entityIndex;
            if (belongsToCurrentItem) return [];

            return [{
                itemNumber: getPropertyItemDisplayNumber(item, viewingYear),
                propertyName: getPropertyItemDisplayName(item),
            }];
        });
    }, [items, splitModalItem, viewingYear]);
    const isQuickStatusView = !!viewingYear
        && !!activeInspectionYear
        && !isSamePropertyYear(viewingYear, activeInspectionYear);
    const viewingWesternYear = propertyYearToWesternNumber(viewingYear);
    const activeInspectionWesternYear = propertyYearToWesternNumber(activeInspectionYear);
    const selectedEntityExistsInActiveInspectionYear = !!selectedRawItem
        && itemExistsInPropertyYear(selectedRawItem.sourceYears, activeInspectionYear);
    const isPossiblyRetiredQuickStatusView = isQuickStatusView
        && viewingWesternYear !== null
        && activeInspectionWesternYear !== null
        && viewingWesternYear < activeInspectionWesternYear
        && !selectedEntityExistsInActiveInspectionYear;
    const isPossiblyNewQuickStatusView = isQuickStatusView
        && viewingWesternYear !== null
        && activeInspectionWesternYear !== null
        && viewingWesternYear > activeInspectionWesternYear
        && !selectedEntityExistsInActiveInspectionYear;
    const isSummaryOnlyQuickStatusView = isQuickStatusView && !isPossiblyRetiredQuickStatusView;
    const activeInspectionYearLabel = activeInspectionYear ?? "未選擇";
    const activeInspectionEntityIndexes = useMemo(() => (
        activeInspectionYear
            ? items.flatMap((item, entityIndex) => (
                itemExistsInPropertyYear(item.sourceYears, activeInspectionYear) ? [entityIndex] : []
            ))
            : []
    ), [activeInspectionYear, items]);
    const canReturnToActiveInspectionYear = activeInspectionEntityIndexes.length > 0;
    const currentLocationArea = selectedItem?.location.areaId && selectedItem.location.areaName
        ? {id: selectedItem.location.areaId, name: selectedItem.location.areaName}
        : null;
    const hasSelectedLocationArea = !!selectedItem?.location.areaName?.trim();
    const statusLocked = propertyStatus !== "unknown";
    const locationEditMode = editingLockedFields;
    const fieldsEditable = !statusLocked || locationEditMode;
    // Never render status-dependent details with a prior entity/year's status.
    const pageLoading = loading || statusLoading || resolvedStatusRequestKey !== statusRequestKey;
    const actionDisabled = pageLoading || statusLoading || !selectedItem || updatingStatus || updatingLocationArea || updatingRelationships;
    const relationshipDisabled = pageLoading || !selectedItem || updatingRelationships || isSummaryOnlyQuickStatusView;
    const showFixedActions = !pageLoading && !!selectedItem;
    const contentBottomPadding = showFixedActions
        ? Math.max(insets.bottom, 12) + (isQuickStatusView ? 178 : 156)
        : Math.max(insets.bottom, 12) + 24;
    const requireDraftLocationBeforeSave = statusLocked && !draftLocationArea && !isPossiblyRetiredQuickStatusView;

    const showLocationCompletion = (message = "已更新位置") => {
        if (locationCompletionTimerRef.current) {
            clearTimeout(locationCompletionTimerRef.current);
        }

        setLocationCompletionMessage(message);
        setLocationCompletionKey((key) => key + 1);
        locationCompletionTimerRef.current = setTimeout(() => {
            setLocationCompletionMessage(null);
            locationCompletionTimerRef.current = null;
        }, 1250);
    };

    useEffect(() => {
        return () => {
            if (locationCompletionTimerRef.current) {
                clearTimeout(locationCompletionTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        let mounted = true;

        void (async () => {
            if (!routeBarcode) {
                setResolvedBarcodeMatch(null);
                setItems([]);
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                const [result, targets] = await Promise.all([
                    getPropertyItemsByBarcodeMatch(routeBarcode),
                    getStoredRelationshipItemsByBarcode(),
                ]);
                if (mounted) {
                    setResolvedBarcodeMatch(result ? {request: routeBarcode, barcode: result.barcode} : null);
                    setItems(result?.items ?? []);
                    setRelationshipItemsByBarcode(targets);
                    setRelationshipTargets(getRelationshipTargets(targets));
                }
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [routeBarcode]);

    useFocusEffect(
        useCallback(() => {
            let active = true;

            void (async () => {
                if (!barcode) return;

                try {
                    const nextItemsByBarcode = await getStoredRelationshipItemsByBarcode();
                    if (!active) return;

                    setItems(nextItemsByBarcode[barcode] ?? []);
                    setRelationshipItemsByBarcode(nextItemsByBarcode);
                    setRelationshipTargets(getRelationshipTargets(nextItemsByBarcode));
                } catch (error) {
                    console.error("重新讀取附屬關係資料失敗:", error);
                }
            })();

            return () => {
                active = false;
            };
        }, [barcode]),
    );

    useEffect(() => {
        if (visibleEntityIndexes.length === 0) {
            // Do not clear a route-provided entity before its property bucket loads.
            if (!loading) setSelectedEntityIndex(null);
            return;
        }

        if (visibleEntityIndexes.length === 1) {
            setSelectedEntityIndex(visibleEntityIndexes[0]);
            return;
        }

        // A route entityIndex is only the initial fallback. Once a user picks
        // another entity from the menu, preserve that explicit choice.
        if (selectedEntityIndex !== null && visibleEntityIndexes.includes(selectedEntityIndex)) {
            return;
        }

        if (requestedEntityIndex !== null && visibleEntityIndexes.includes(requestedEntityIndex)) {
            setSelectedEntityIndex(requestedEntityIndex);
            return;
        }

        setSelectedEntityIndex(null);
    }, [loading, requestedEntityIndex, selectedEntityIndex, visibleEntityIndexes]);

    useEffect(() => {
        const routeYear = requestedYear && detailYearOptions.some((year) => isSamePropertyYear(year, requestedYear))
            ? detailYearOptions.find((year) => isSamePropertyYear(year, requestedYear)) ?? requestedYear
            : null;
        const inspectionYear = activeInspectionYear && detailYearOptions.some((year) => isSamePropertyYear(year, activeInspectionYear))
            ? detailYearOptions.find((year) => isSamePropertyYear(year, activeInspectionYear)) ?? activeInspectionYear
            : null;
        const fallbackYear = detailYearOptions[0] ?? null;

        setViewingYear((currentYear) => {
            if (currentYear && detailYearOptions.some((year) => isSamePropertyYear(year, currentYear))) {
                return currentYear;
            }

            return routeYear ?? inspectionYear ?? fallbackYear;
        });
    }, [activeInspectionYear, detailYearOptions, requestedYear]);

    useFocusEffect(
        useCallback(() => {
            let active = true;

            void (async () => {
                setStatusLoading(true);

                try {
                    if (!barcode || items.length === 0) {
                        if (active) {
                            setEntityStatuses([]);
                            setPropertyStatus("unknown");
                            setResolvedStatusRequestKey(statusRequestKey);
                        }
                        return;
                    }

                    const years = viewingYear ? [viewingYear] : itemYears;
                    const nextEntityStatuses = Array<PropertyStatus>(items.length).fill("unknown");
                    const statusPrecedence: PropertyStatus[] = ["unknown", "pending", "checked"];

                    for (const year of years) {
                        for (const status of statusPrecedence) {
                            const statusEntries = expandLegacyAnnualStatusEntries(
                                await getStoredAnnualStatusBarcodes(year, status),
                                (storedBarcode) => storedBarcode === barcode ? items.length : 0,
                            );
                            if (!active) return;

                            for (const entry of statusEntries) {
                                const parsedEntry = parsePropertyStatusEntryKey(entry);
                                if (!parsedEntry || parsedEntry.barcode !== barcode || parsedEntry.entityIndex >= items.length) continue;
                                const item = items[parsedEntry.entityIndex];
                                if (!item || !itemExistsInPropertyYear(item.sourceYears, year)) continue;

                                nextEntityStatuses[parsedEntry.entityIndex] = status;
                            }
                        }
                    }

                    if (active) {
                        setEntityStatuses(nextEntityStatuses);
                        setPropertyStatus(selectedEntityIndex !== null
                            ? nextEntityStatuses[selectedEntityIndex] ?? "unknown"
                            : nextEntityStatuses[visibleEntityIndexes[0] ?? 0] ?? "unknown");
                        setResolvedStatusRequestKey(statusRequestKey);
                    }
                } finally {
                    if (active) setStatusLoading(false);
                }
            })();

            return () => {
                active = false;
            };
        }, [barcode, itemYears, items, selectedEntityIndex, statusRequestKey, viewingYear, visibleEntityIndexes]),
    );

    useEffect(() => {
        if (selectedEntityIndex === null) return;

        setPropertyStatus(entityStatuses[selectedEntityIndex] ?? "unknown");
    }, [entityStatuses, selectedEntityIndex]);

    useEffect(() => {
        setEditingLockedFields(false);
        setDraftLocationArea(null);
    }, [propertyStatus, selectedEntityIndex]);

    useEffect(() => {
        if (!isSummaryOnlyQuickStatusView) return;

        setEditingLockedFields(false);
        setDraftLocationArea(null);
        setEditingTarget(null);
        setPreviewingPhoto(null);
    }, [isSummaryOnlyQuickStatusView]);

    useEffect(() => {
        let mounted = true;

        void (async () => {
            try {
                const layout = await getStoredAreaLayout();
                if (mounted) setAreaLayout(layout);
            } catch {
                if (mounted) setAreaLayout(null);
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        let mounted = true;

        void (async () => {
            if (!selectedItem) {
                setSelectedItemInPropertyLabelQueue(false);
                return;
            }

            try {
                if (selectedEntityIndex === null) return;
                const inQueue = await isPropertyEntityInPropertyLabelQueue(selectedItem.barcode, selectedEntityIndex);
                if (mounted) setSelectedItemInPropertyLabelQueue(inQueue);
            } catch (error) {
                console.warn("讀取待製作財產標籤清單失敗:", error);
                if (mounted) setSelectedItemInPropertyLabelQueue(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [selectedEntityIndex, selectedItem?.barcode]);

    const loadTextSuggestions = async (field: PropertyItemEditableTextField) => {
        try {
            const suggestions = await getPropertyTextSuggestions(field);
            setTextSuggestions((currentSuggestions) => ({
                ...currentSuggestions,
                [field]: suggestions,
            }));
        } catch (error) {
            console.error("讀取文字候選失敗:", error);
        }
    };

    const openTextEditor = (item: PropertyItem, entityIndex: number, field: PropertyItemEditableTextField) => {
        setEditingTarget({
            barcode: item.barcode,
            entityIndex,
            field,
            title: field === "locationDescription" ? "編輯詳細位置描述" : "編輯其他備註",
            value: field === "locationDescription" ? item.location.description ?? "" : item.note ?? "",
        });
        void loadTextSuggestions(field);
    };

    const selectEntity = (entityIndex: number) => {
        setSelectedEntityIndex(entityIndex);
        setEditingLockedFields(false);
        setDraftLocationArea(null);
        setEditingTarget(null);
        setPreviewingPhoto(null);
    };

    const openSplitModal = () => {
        if (!selectedItem || selectedEntityIndex === null) return;
        if (isSummaryOnlyQuickStatusView) {
            Alert.alert("目前無法拆分", "正在快速查看其他年度；請切回該財產可盤點的年度後再操作。");
            return;
        }
        setSplitModalItem({item: selectedItem, entityIndex: selectedEntityIndex});
    };

    const saveSplit = async (entities: PropertySplitEntityInput[]) => {
        if (!splitModalItem) return;
        setSavingSplit(true);
        try {
            const result = await setPropertyItemSplitEntities(
                splitModalItem.item.barcode,
                splitModalItem.entityIndex,
                entities,
            );
            setItems(result.items[splitModalItem.item.barcode] ?? []);
            setRelationshipItemsByBarcode(result.items);
            setRelationshipTargets(getRelationshipTargets(result.items));
            setSelectedEntityIndex(result.selectedEntityIndex);
            setSplitModalItem(null);
        } catch (error) {
            console.error("拆分財產實體失敗:", error);
            Alert.alert("儲存失敗", error instanceof Error ? error.message : "無法更新拆分實體，請稍後再試。");
        } finally {
            setSavingSplit(false);
        }
    };

    const confirmCancelSplit = () => {
        if (!splitModalItem) return;
        Alert.alert(
            "取消拆分？",
            "會保留第一個實體的現場資料；其他實體的照片、位置、備註與盤點狀態將不再保留。",
            [
                {text: "返回", style: "cancel"},
                {
                    text: "取消拆分",
                    style: "destructive",
                    onPress: () => { void (async () => {
                        setSavingSplit(true);
                        try {
                            const result = await cancelPropertyItemSplit(
                                splitModalItem.item.barcode,
                                splitModalItem.entityIndex,
                            );
                            setItems(result.items[splitModalItem.item.barcode] ?? []);
                            setRelationshipItemsByBarcode(result.items);
                            setRelationshipTargets(getRelationshipTargets(result.items));
                            setSelectedEntityIndex(result.selectedEntityIndex);
                            setSplitModalItem(null);
                        } catch (error) {
                            console.error("取消拆分財產實體失敗:", error);
                            Alert.alert("取消失敗", error instanceof Error ? error.message : "無法取消拆分，請稍後再試。");
                        } finally {
                            setSavingSplit(false);
                        }
                    })(); },
                },
            ],
        );
    };

    const requestEditMode = (afterConfirmed?: () => void) => {
        const enterEditMode = () => {
            setDraftLocationArea(currentLocationArea);
            setEditingLockedFields(true);
            afterConfirmed?.();
        };

        if (!statusLocked) {
            enterEditMode();
            return;
        }

        enterEditMode();
    };

    const saveEditableText = async (value: string) => {
        if (!editingTarget) return;

        setSavingEditableText(true);
        try {
            const updatedItem = await updatePropertyItemEditableText(
                editingTarget.barcode,
                editingTarget.entityIndex,
                editingTarget.field,
                value,
            );

            setItems((previousItems) => previousItems.map((item, index) => (
                item.barcode === editingTarget.barcode && index === editingTarget.entityIndex
                    ? updatedItem
                    : item
            )));
            if (value.trim()) {
                const nextSuggestions = await rememberPropertyTextSuggestion(editingTarget.field, value);
                setTextSuggestions((currentSuggestions) => ({
                    ...currentSuggestions,
                    [editingTarget.field]: nextSuggestions,
                }));
            }
            setEditingTarget(null);
        } catch (error) {
            console.error("更新財產文字欄位失敗:", error);
            Alert.alert("儲存失敗", "無法儲存此欄位，請稍後再試。");
        } finally {
            setSavingEditableText(false);
        }
    };

    const selectLocationArea = async (item: PropertyItem, entityIndex: number, area: AreaLayoutArea | null) => {
        if (locationEditMode || !statusLocked) {
            setDraftLocationArea(area ? {id: area.id, name: area.name} : null);
            setEditingLockedFields(true);
            return;
        }

        setItems((previousItems) => previousItems.map((previousItem, index) => (
            previousItem.barcode === item.barcode && index === entityIndex
                ? {
                    ...previousItem,
                    location: {
                        ...previousItem.location,
                        areaId: area?.id ?? null,
                        areaName: area?.name ?? null,
                    },
                }
                : previousItem
        )));

        setUpdatingLocationArea(true);
        try {
            const updatedItem = await updatePropertyItemLocationArea(item.barcode, entityIndex, area ? {
                id: area.id,
                name: area.name,
            } : null);

            setItems((previousItems) => previousItems.map((previousItem, index) => (
                previousItem.barcode === item.barcode && index === entityIndex
                    ? updatedItem
                    : previousItem
            )));
        } catch (error) {
            console.error("更新位置區域失敗:", error);
            Alert.alert("儲存失敗", "無法儲存位置區域，請稍後再試。");
        } finally {
            setUpdatingLocationArea(false);
        }
    };

    const cancelDraftLocationEdit = () => {
        setDraftLocationArea(null);
        setEditingLockedFields(false);
    };

    const saveDraftLocationEdit = async () => {
        if (!selectedItem || selectedEntityIndex === null) return;

        if (requireDraftLocationBeforeSave) {
            Alert.alert("尚未選取位置", "請先在位置圖上選取一個區域後再儲存。");
            return;
        }

        setUpdatingLocationArea(true);
        try {
            const updatedItem = await updatePropertyItemLocationArea(selectedItem.barcode, selectedEntityIndex, draftLocationArea);
            setItems((previousItems) => previousItems.map((previousItem, index) => (
                previousItem.barcode === selectedItem.barcode && index === selectedEntityIndex
                    ? updatedItem
                    : previousItem
            )));
            setEditingLockedFields(false);
            setDraftLocationArea(null);
            if (draftLocationArea) {
                showLocationCompletion();
            } else {
                showLocationCompletion("已清除位置");
            }
        } catch (error) {
            console.error("儲存位置區域失敗:", error);
            Alert.alert("儲存失敗", "無法儲存位置區域，請稍後再試。");
        } finally {
            setUpdatingLocationArea(false);
        }
    };

    const updateSelectedPropertyStatus = async (nextStatus: PropertyStatus) => {
        if (!selectedItem || selectedEntityIndex === null) return;
        if (isQuickStatusView) {
            Alert.alert("無法更新盤點狀態", "正在快速查看非目前盤點年度的盤點狀態。請回到目前盤點年份後再操作。");
            return;
        }

        if (nextStatus === "checked" && !hasSelectedLocationArea) {
            Alert.alert("尚未選取位置", "確認盤點前，請先在位置圖上點選此財產所在區域。");
            return;
        }

        const year = viewingYear && itemExistsInPropertyYear(selectedItem.sourceYears, viewingYear)
            ? viewingYear
            : getPrimarySourceYear(selectedItem);
        if (!year) {
            Alert.alert("無法更新狀態", "此財產沒有可用的匯入年度資料。");
            return;
        }

        setUpdatingStatus(true);
        try {
            await updateAnnualPropertyStatus(year, selectedItem.barcode, selectedEntityIndex, nextStatus, items.length);
            setEntityStatuses((currentStatuses) => {
                const nextStatuses = [...currentStatuses];
                nextStatuses[selectedEntityIndex] = nextStatus;
                return nextStatuses;
            });
            setPropertyStatus(nextStatus);
            setEditingLockedFields(false);
            router.setParams({status: nextStatus});
            Alert.alert("狀態已更新", nextStatus === "checked"
                ? "此財產已確認盤點。\n\n請務必確認該項目實體存在，\n並貼上該年度盤點貼紙。"
                : nextStatus === "pending"
                    ? "此財產已標為待處理。"
                    : "此財產已恢復為未清點。");
        } catch (error) {
            console.error("更新財產狀態失敗:", error);
            Alert.alert("更新失敗", "無法更新財產狀態，請稍後再試。");
        } finally {
            setUpdatingStatus(false);
        }
    };

    const confirmRestoreUnknownStatus = () => {
        showActionSheetWithOptions(
            {
                options: ["恢復未清點狀態", "取消"],
                cancelButtonIndex: 1,
                destructiveButtonIndex: 0,
                useModal: true,
            },
            (index) => {
                if (index === 0) {
                    void updateSelectedPropertyStatus("unknown");
                }
            },
        );
    };

    const requestTextEdit = (afterConfirmed: () => void) => {
        afterConfirmed();
    };

    const importPropertyPhotoAsset = async (
        item: PropertyItem,
        entityIndex: number,
        asset: ImagePicker.ImagePickerAsset,
    ) => {
        setAddingPhoto(true);
        try {
            const photo = await compressAndStorePropertyPhoto({
                uri: asset.uri,
                width: asset.width,
                height: asset.height,
            }, item.barcode, entityIndex);
            const updatedItem = await addPropertyItemPhoto(item.barcode, entityIndex, photo);

            setItems((previousItems) => previousItems.map((previousItem, index) => (
                previousItem.barcode === item.barcode && index === entityIndex
                    ? updatedItem
                    : previousItem
            )));
            Alert.alert("照片已新增", "已保存此照片。");
        } catch (error) {
            console.error("新增財產照片失敗:", error);
            Alert.alert("新增失敗", "無法新增照片，請稍後再試。");
        } finally {
            setAddingPhoto(false);
        }
    };

    const pickPhotoFromCamera = async (item: PropertyItem, entityIndex: number) => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            Alert.alert("需要相機權限", "請允許開啟相機後再拍攝財產照片。");
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 1,
        });
        if (result.canceled || !result.assets?.[0]) return;

        await importPropertyPhotoAsset(item, entityIndex, result.assets[0]);
    };

    const pickPhotoFromLibrary = async (item: PropertyItem, entityIndex: number) => {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert("需要照片權限", "請允許讀取照片後再選擇財產照片。");
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 1,
        });
        if (result.canceled || !result.assets?.[0]) return;

        await importPropertyPhotoAsset(item, entityIndex, result.assets[0]);
    };

    const openAddPhotoMenu = (item: PropertyItem, entityIndex: number, source: "camera" | "library") => {
        if (addingPhoto) return;

        if ((item.photos?.length ?? 0) >= MAX_PROPERTY_PHOTO_COUNT) {
            Alert.alert("照片已達上限", `每個財產實體最多只能保存 ${MAX_PROPERTY_PHOTO_COUNT} 張照片。`);
            return;
        }

        const launchDelay = Platform.OS === "ios" ? 160 : 40;
        setTimeout(() => {
            if (source === "camera") {
                void pickPhotoFromCamera(item, entityIndex);
                return;
            }

            void pickPhotoFromLibrary(item, entityIndex);
        }, launchDelay);
    };

    const openPhotoPreview = (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => {
        setPreviewingPhoto({item, entityIndex, photo});
    };

    const deletePhoto = async (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => {
        setAddingPhoto(true);
        try {
            const updatedItem = await removePropertyItemPhoto(item.barcode, entityIndex, photo.id);
            setItems((previousItems) => previousItems.map((previousItem, index) => (
                previousItem.barcode === item.barcode && index === entityIndex
                    ? updatedItem
                    : previousItem
            )));
            setPreviewingPhoto((current) => current?.photo.id === photo.id ? null : current);
        } catch (error) {
            console.error("刪除財產照片失敗:", error);
            Alert.alert("刪除失敗", "無法刪除此照片，請稍後再試。");
        } finally {
            setAddingPhoto(false);
        }
    };

    const confirmDeletePhoto = (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => {
        Alert.alert("刪除照片", "確定要刪除此照片？", [
            {text: "取消", style: "cancel"},
            {
                text: "刪除",
                style: "destructive",
                onPress: () => { void deletePhoto(item, entityIndex, photo); },
            },
        ]);
    };

    const savePhotoToLibrary = async (photo: PropertyPhoto) => {
        if (savingPhotoToLibrary) return;

        setSavingPhotoToLibrary(true);
        try {
            const MediaLibrary = await import("expo-media-library");
            const available = await MediaLibrary.isAvailableAsync();
            if (!available) {
                Alert.alert("無法儲存", "此裝置目前不支援儲存至相簿。");
                return;
            }

            const permission = await MediaLibrary.requestPermissionsAsync(true);
            if (!permission.granted) {
                Alert.alert("需要相簿權限", "請允許儲存照片至相簿後再試一次。");
                return;
            }

            await MediaLibrary.saveToLibraryAsync(photo.uri);
            Alert.alert("已儲存", "照片已儲存至相簿。");
        } catch (error) {
            console.error("儲存財產照片至相簿失敗:", error);
            Alert.alert("儲存失敗", "無法儲存照片至相簿，請確認已安裝 expo-media-library。");
        } finally {
            setSavingPhotoToLibrary(false);
        }
    };

    const openPhotoOptions = (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => {
        if (addingPhoto || savingPhotoToLibrary) return;

        showActionSheetWithOptions(
            {
                options: ["儲存至相簿", "刪除照片", "取消"],
                cancelButtonIndex: 2,
                destructiveButtonIndex: 1,
                useModal: true,
            },
            (index) => {
                if (index === 0) {
                    void savePhotoToLibrary(photo);
                    return;
                }

                if (index === 1) confirmDeletePhoto(item, entityIndex, photo);
            },
        );
    };

    const addSelectedItemToPropertyLabelQueue = async () => {
        if (!selectedItem || selectedEntityIndex === null) return;

        setUpdatingPropertyLabelQueue(true);
        try {
            await addPropertyLabelEntity(selectedItem.barcode, selectedEntityIndex, items.length);
            setSelectedItemInPropertyLabelQueue(true);
            Alert.alert("已加入", "已加入待製作財產標籤清單。");
        } catch (error) {
            console.error("加入待製作財產標籤清單失敗:", error);
            Alert.alert("加入失敗", "無法加入待製作財產標籤清單，請稍後再試。");
        } finally {
            setUpdatingPropertyLabelQueue(false);
        }
    };

    const removeSelectedItemFromPropertyLabelQueue = async () => {
        if (!selectedItem || selectedEntityIndex === null) return;

        setUpdatingPropertyLabelQueue(true);
        try {
            await removePropertyLabelEntity(selectedItem.barcode, selectedEntityIndex, items.length);
            setSelectedItemInPropertyLabelQueue(false);
            Alert.alert("已移除", "已從待製作財產標籤清單移除。");
        } catch (error) {
            console.error("移除待製作財產標籤清單失敗:", error);
            Alert.alert("移除失敗", "無法移除待製作財產標籤清單，請稍後再試。");
        } finally {
            setUpdatingPropertyLabelQueue(false);
        }
    };

    const confirmRemoveFromPropertyLabelQueue = () => {
        if (!selectedItemInPropertyLabelQueue) return;

        showActionSheetWithOptions(
            {
                options: ["從待製作標籤清單移除", "取消"],
                cancelButtonIndex: 1,
                destructiveButtonIndex: 0,
                useModal: true,
            },
            (index) => {
                if (index === 0) {
                    void removeSelectedItemFromPropertyLabelQueue();
                }
            },
        );
    };

    const handlePropertyLabelQueuePress = () => {
        if (selectedItemInPropertyLabelQueue) {
            Alert.alert("已在清單中", "此財產已在待製作財產標籤清單中，長按可移除。");
            return;
        }

        void addSelectedItemToPropertyLabelQueue();
    };

    const applyRelationshipItems = (nextItemsByBarcode: PropertyItemsByBarcode) => {
        if (barcode) setItems(nextItemsByBarcode[barcode] ?? []);
        setRelationshipItemsByBarcode(nextItemsByBarcode);
        setRelationshipTargets(getRelationshipTargets(nextItemsByBarcode));
    };

    const targetCanBeSelectedInViewingYear = (target: PropertyRelationshipTarget) => (
        !viewingYear || itemExistsInPropertyYear(target.item.sourceYears, viewingYear)
    );

    const runRelationshipUpdate = async (
        updater: () => Promise<PropertyItemsByBarcode>,
        successMessage: string,
    ) => {
        if (updatingRelationships) return;

        setUpdatingRelationships(true);
        try {
            const nextItemsByBarcode = await updater();
            applyRelationshipItems(nextItemsByBarcode);
            setRelationshipPicker(null);
            Alert.alert("附屬關係已更新", successMessage);
        } catch (error) {
            console.error("更新附屬關係失敗:", error);
            Alert.alert("更新失敗", error instanceof Error ? error.message : "無法更新附屬關係，請稍後再試。");
        } finally {
            setUpdatingRelationships(false);
        }
    };

    const getSelectedEntityKey = () => {
        if (!selectedItem || selectedEntityIndex === null) return null;

        return getPropertyEntityKey(selectedItem.barcode, selectedEntityIndex);
    };

    const openParentPicker = () => {
        const currentEntityKey = getSelectedEntityKey();
        if (!currentEntityKey) return;

        const targets = relationshipTargets.filter((target) => (
            target.entityKey !== currentEntityKey
            && target.entityKey !== selectedItem?.parentEntityKey
            && targetCanBeSelectedInViewingYear(target)
            && !isPropertyRelationshipDescendant(relationshipItemsByBarcode, currentEntityKey, target.entityKey)
        ));
        if (targets.length === 0) {
            Alert.alert("沒有可選上層財產", "目前沒有其他財產可設定為上層財產。");
            return;
        }

        setRelationshipPicker({
            mode: "parent",
            title: "設定上層財產",
            targets,
        });
    };

    const openChildPicker = () => {
        const currentEntityKey = getSelectedEntityKey();
        if (!selectedItem || !currentEntityKey) return;

        const currentChildKeys = new Set(selectedItem.childEntityKeys ?? []);
        const targets = relationshipTargets.filter((target) => (
            target.entityKey !== currentEntityKey
            && !currentChildKeys.has(target.entityKey)
            && targetCanBeSelectedInViewingYear(target)
            && !isPropertyRelationshipDescendant(relationshipItemsByBarcode, target.entityKey, currentEntityKey)
        ));
        if (targets.length === 0) {
            Alert.alert("沒有可新增附屬財產", "目前沒有其他可新增的附屬財產。");
            return;
        }

        setRelationshipPicker({
            mode: "child",
            title: "新增附屬財產",
            targets,
        });
    };

    const updateParent = (parentEntityKey: string | null) => {
        if (!selectedItem || selectedEntityIndex === null) return;

        void runRelationshipUpdate(
            () => setPropertyItemParent(selectedItem.barcode, selectedEntityIndex, parentEntityKey),
            parentEntityKey ? "已設定上層財產。" : "已清除上層財產。",
        );
    };

    const addChild = (childEntityKey: string) => {
        if (!selectedItem || selectedEntityIndex === null) return;

        void runRelationshipUpdate(
            () => addPropertyItemChild(selectedItem.barcode, selectedEntityIndex, childEntityKey),
            "已新增附屬財產。",
        );
    };

    const handleRelationshipTargetSelect = (target: PropertyRelationshipTarget) => {
        const currentEntityKey = getSelectedEntityKey();
        if (!currentEntityKey || !relationshipPicker) return;

        if (relationshipPicker.mode === "parent") {
            updateParent(target.entityKey);
            return;
        }

        const currentParentKey = target.item.parentEntityKey ?? null;
        if (currentParentKey && currentParentKey !== currentEntityKey) {
            const previousParentTarget = relationshipTargets.find((candidate) => candidate.entityKey === currentParentKey) ?? null;
            Alert.alert(
                "更改附屬財產的上層？",
                `此財產目前已附屬於其他財產：\n\n${getPropertyRelationshipShortLabel(previousParentTarget, currentParentKey)}\n\n是否覆蓋並更改為目前項目？`,
                [
                    {text: "取消", style: "cancel"},
                    {
                        text: "確認更改",
                        style: "destructive",
                        onPress: () => addChild(target.entityKey),
                    },
                ],
            );
            return;
        }

        addChild(target.entityKey);
    };

    const confirmClearParent = () => {
        if (!selectedItem?.parentEntityKey) return;

        Alert.alert("清除上層財產", "確定要清除此財產的上層財產？", [
            {text: "取消", style: "cancel"},
            {
                text: "清除",
                style: "destructive",
                onPress: () => updateParent(null),
            },
        ]);
    };

    const confirmRemoveChild = (childEntityKey: string) => {
        if (!selectedItem || selectedEntityIndex === null) return;

        const childTarget = relationshipTargets.find((target) => target.entityKey === childEntityKey) ?? null;
        Alert.alert(
            "移除附屬財產",
            `確定要移除此附屬財產？\n${getPropertyRelationshipShortLabel(childTarget, childEntityKey)}`,
            [
                {text: "取消", style: "cancel"},
                {
                    text: "移除",
                    style: "destructive",
                    onPress: () => {
                        void runRelationshipUpdate(
                            () => removePropertyItemChild(selectedItem.barcode, selectedEntityIndex, childEntityKey),
                            "已移除附屬財產。",
                        );
                    },
                },
            ],
        );
    };

    const openRelationshipTarget = (target: PropertyRelationshipTarget | null, fallbackKey?: string | null) => {
        if (!target) {
            Alert.alert("找不到財產資料", fallbackKey ? `此關係指向的財產資料不存在：\n${fallbackKey}` : "此關係指向的財產資料不存在。");
            return;
        }

        const navigateToTarget = () => {
            router.push({
                pathname: "/stacks/details",
                params: {
                    barcode: target.barcode,
                    entityIndex: String(target.entityIndex),
                    ...(viewingYear ? {year: viewingYear} : {}),
                },
            });
        };

        if (!propertyRelationshipExistsInYear(target, viewingYear)) {
            navigateToTarget()
            const viewingWesternYear = propertyYearToWesternNumber(viewingYear);
            const sourceWesternYears = target.item.sourceYears
                .map(propertyYearToWesternNumber)
                .filter((year): year is number => year !== null);
            const sourceYearText = target.item.sourceYears.length > 0 ? target.item.sourceYears.join("、") : "其他";
            const lifecycleText = viewingWesternYear !== null && sourceWesternYears.some((year) => year > viewingWesternYear)
                ? `此財產可能於 ${sourceYearText} 年新增`
                : `此財產可能已於 ${sourceYearText} 年報廢`;

            Alert.alert(
                "財產不屬於目前盤點年度",
                `${viewingYear ? `目前正在盤點 ${viewingYear} 年度\n` : ""}${lifecycleText}\n\n僅顯示該年度的盤點狀態。`,
                [{text: "知道了"}],
            );
            return;
        }

        navigateToTarget();
    };

    return (
        <View style={[styles.container, {paddingTop: Platform.OS === "ios" ? insets.top + 14 : insets.top + 18}]}>
            <View style={styles.headerRow}>
                <View style={styles.backButtonSlot}>
                    <Button
                        p="md"
                        px="lg"
                        color="gray800"
                        bg="white"
                        borderless
                        rounded="circle"
                        borderWidth={0.45}
                        shadow="sm"
                        onPress={() => router.back()}
                        prefix={<Icon name="arrow-left" fontFamily="Feather" fontSize="xl" mr="xs" color="black" />}
                    >
                        返回
                    </Button>
                </View>
                <View style={styles.headerText}>
                    <Text fontSize={22} fontWeight="bold" color="gray900">財產詳細資訊</Text>
                    <Text mt={2} fontSize={14} color="gray600">{barcode? "編號："+barcode : "編號不明"}</Text>
                </View>
                <View style={styles.headerYearSlot}>
                    <DetailYearMenu years={detailYearOptions} selectedYear={viewingYear} onSelect={setViewingYear} />
                </View>
            </View>

            <ScrollView
                contentContainerStyle={[styles.content, {paddingBottom: contentBottomPadding}]}
                showsVerticalScrollIndicator={false}
            >
                {pageLoading && (
                    <View style={styles.loadingState}>
                        <ActivityIndicator color="#2563EB" />
                        <Text mt="sm" color="gray600" fontSize="md">讀取中...</Text>
                    </View>
                )}
                {!pageLoading && items.length === 0 && (
                    <View style={styles.emptyState}>
                        <Text textAlign="center" fontSize="xl" color="gray600">⚠️ 查無此條碼的財產資料</Text>
                    </View>
                )}
                {!pageLoading && requestedEntityIndex === null && visibleItems.length > 1 && selectedEntityIndex === null && (
                    <EntitySelectionStep
                        items={visibleItems}
                        statuses={visibleEntityStatuses}
                        fallbackStatus={propertyStatus}
                        onSelect={(visibleEntityIndex) => {
                            const entityIndex = visibleEntityIndexes[visibleEntityIndex];
                            if (entityIndex !== undefined) selectEntity(entityIndex);
                        }}
                    />
                )}
                {!pageLoading && selectedEntityIndex !== null && selectedItem && displayedSelectedItem && (
                    <PropertyDetailBlock
                        key={`${selectedItem.barcode}:${selectedEntityIndex}`}
                        item={displayedSelectedItem}
                        index={selectedVisibleEntityIndex >= 0 ? selectedVisibleEntityIndex : 0}
                        actualEntityIndex={selectedEntityIndex}
                        total={visibleItems.length}
                        areaLayout={areaLayout}
                        status={propertyStatus}
                        year={viewingYear}
                        onEditText={openTextEditor}
                        onSelectArea={selectLocationArea}
                        draftLocationArea={draftLocationArea}
                        locationEditMode={locationEditMode}
                        fieldsEditable={fieldsEditable}
                        statusLocked={statusLocked}
                        completionFeedbackMessage={locationCompletionMessage}
                        completionFeedbackKey={locationCompletionKey}
                        onRequestEditMode={() => requestEditMode()}
                        onAddPhoto={openAddPhotoMenu}
                        onPreviewPhoto={openPhotoPreview}
                        onPhotoOptions={openPhotoOptions}
                        addingPhoto={addingPhoto}
                        relationshipTargets={relationshipTargets}
                        relationshipDisabled={relationshipDisabled}
                        onOpenParentPicker={openParentPicker}
                        onOpenChildPicker={openChildPicker}
                        onClearParent={confirmClearParent}
                        onRemoveChild={confirmRemoveChild}
                        onOpenRelationshipTarget={openRelationshipTarget}
                        summaryOnly={isSummaryOnlyQuickStatusView}
                        statusTitle={viewingYear ? `${viewingYear} 年狀態` : "目前狀態"}
                        entityOptions={entityMenuOptions}
                        onSelectEntity={(visibleEntityIndex) => {
                            const entityIndex = visibleEntityIndexes[visibleEntityIndex];
                            if (entityIndex !== undefined) selectEntity(entityIndex);
                        }}
                        onManageSplit={openSplitModal}
                    />
                )}
            </ScrollView>

            <DetailTextEditModal
                target={editingTarget}
                saving={savingEditableText}
                canEdit={fieldsEditable}
                suggestions={editingTarget ? textSuggestions[editingTarget.field] : []}
                onClose={() => setEditingTarget(null)}
                onRequestEdit={requestTextEdit}
                onSave={saveEditableText}
            />
            <RelationshipPickerModal
                state={relationshipPicker}
                year={viewingYear}
                onClose={() => setRelationshipPicker(null)}
                onSelect={handleRelationshipTargetSelect}
            />
            <PropertySplitModal
                key={splitModalItem ? `${splitModalItem.item.barcode}:${splitModalItem.entityIndex}:${splitModalInitialEntities.map((entity) => entity.name).join("|")}` : "closed"}
                item={splitModalItem?.item ?? null}
                baseItemNumber={splitModalBaseItemNumber}
                initialEntities={splitModalInitialEntities}
                otherBarcodeEntities={splitModalOtherBarcodeEntities}
                saving={savingSplit}
                onClose={() => !savingSplit && setSplitModalItem(null)}
                onSave={(entities) => { void saveSplit(entities); }}
                onCancelSplit={confirmCancelSplit}
            />
            <PropertyPhotoPreviewModal
                photo={previewingPhoto?.photo ?? null}
                onClose={() => setPreviewingPhoto(null)}
                onDelete={() => {
                    if (!previewingPhoto) return;
                    confirmDeletePhoto(previewingPhoto.item, previewingPhoto.entityIndex, previewingPhoto.photo);
                }}
                onSaveToLibrary={() => {
                    if (!previewingPhoto) return;
                    void savePhotoToLibrary(previewingPhoto.photo);
                }}
                savingToLibrary={savingPhotoToLibrary}
            />
            {showFixedActions && (
            <View style={[styles.fixedActions, {paddingBottom: Math.max(insets.bottom, 12)}]}>
                {locationEditMode && !isSummaryOnlyQuickStatusView ? (
                    <Div row mt="sm">
                        <Button
                            flex={1}
                            mr="xs"
                            bg="gray500"
                            color="#FFFFFF"
                            rounded={12}
                            py="lg"
                            fontWeight="bold"
                            disabled={updatingLocationArea}
                            onPress={cancelDraftLocationEdit}
                            prefix={<Icon name="x" fontFamily="Feather" fontSize="lg" mr="sm" color="#FFFFFF" />}
                        >
                            取消變更
                        </Button>
                        <Button
                            flex={1}
                            ml="xs"
                            bg="blue500"
                            color="#FFFFFF"
                            rounded={12}
                            py="lg"
                            fontWeight="bold"
                            disabled={updatingLocationArea || requireDraftLocationBeforeSave}
                            onPress={() => { void saveDraftLocationEdit(); }}
                            suffix={<Icon name="save" fontFamily="Feather" fontSize="lg" ml="sm" color="#FFFFFF" />}
                        >
                            儲存位置
                        </Button>
                    </Div>
                ) : isQuickStatusView ? (
                    <>
                        <View style={styles.quickStatusNotice}>
                            <Text color="gray700" fontSize="sm" fontWeight="bold" textAlign="center">
                                目前盤點設定：{activeInspectionYearLabel} 年度
                            </Text>
                            <Text mt={4} color="gray600" fontSize="sm" textAlign="center">
                                正在查看 {viewingYear} 年度盤點狀態{isSummaryOnlyQuickStatusView ? "（僅摘要）" : ""}
                            </Text>
                            {isPossiblyRetiredQuickStatusView ? (
                                <Text mt={4} color="gray600" fontSize="sm" textAlign="center">
                                    此財產可能已報廢，可更新現場資料
                                </Text>
                            ) : isPossiblyNewQuickStatusView ? (
                                <Text mt={4} color="gray600" fontSize="sm" textAlign="center">
                                    此財產實體可能於 {viewingYear} 年新增
                                </Text>
                            ) : !canReturnToActiveInspectionYear && (
                                <Text mt={4} color="gray600" fontSize="sm" textAlign="center">
                                    此財產不在目前盤點年度資料中
                                </Text>
                            )}
                        </View>
                        {canReturnToActiveInspectionYear ? (
                            <Button
                                block
                                mt="sm"
                                bg="#2563EB"
                                color="#FFFFFF"
                                rounded={12}
                                py="lg"
                                fontSize="sm"
                                fontWeight="bold"
                                onPress={() => {
                                    if (!activeInspectionYear) return;
                                    const preferredEntityIndex = selectedEntityIndex !== null
                                        && activeInspectionEntityIndexes.includes(selectedEntityIndex)
                                        ? selectedEntityIndex
                                        : activeInspectionEntityIndexes[0];
                                    if (preferredEntityIndex !== undefined) {
                                        setSelectedEntityIndex(preferredEntityIndex);
                                    }
                                    setViewingYear(activeInspectionYear);
                                }}
                                prefix={<Icon name="rotate-ccw" fontFamily="Feather" fontSize="lg" mr="sm" color="#FFFFFF" />}
                            >
                                返回目前盤點年度
                            </Button>
                        ) : (
                            <Button
                                block
                                mt="sm"
                                bg="gray600"
                                color="#FFFFFF"
                                rounded={12}
                                py="lg"
                                fontSize="sm"
                                fontWeight="bold"
                                onPress={() => {if(router.canGoBack()) router.back()}}
                                prefix={<Icon name="arrow-back" fontFamily="Ionicons" fontSize="lg" mr="sm" color="#FFFFFF" />}
                            >
                                返回上頁
                            </Button>
                        )}
                    </>
                ) : (
                    <>
                        <Button
                            block
                            bg={selectedItemInPropertyLabelQueue ? "#7890A5" : "#F4B95F"}
                            color="#FFFFFF"
                            rounded={12}
                            py="lg"
                            fontWeight="bold"
                            disabled={actionDisabled || updatingPropertyLabelQueue}
                            onPress={handlePropertyLabelQueuePress}
                            onLongPress={confirmRemoveFromPropertyLabelQueue}
                            prefix={<Icon name="tag" fontFamily="Feather" fontSize="lg" mr="sm" color="#FFFFFF" />}
                        >
                            {selectedItemInPropertyLabelQueue ? "長按從待製作財產標籤清單移除" : "加入待製作財產標籤清單"}
                        </Button>
                        {propertyStatus === "unknown" ? (
                            <Div row mt="sm">
                                <Button
                                    flex={1}
                                    mr="xs"
                                    bg="#E87979"
                                    color="#FFFFFF"
                                    rounded={12}
                                    py="lg"
                                    fontWeight="bold"
                                    disabled={actionDisabled}
                                    onPress={() => { void updateSelectedPropertyStatus("pending"); }}
                                    prefix={<Icon name="alert-circle" fontFamily="Feather" fontSize="lg" mr="sm" color="#FFFFFF" />}
                                >
                                    標為待處理
                                </Button>
                                <Button
                                    flex={1}
                                    ml="xs"
                                    bg="#4CAF7D"
                                    color="#FFFFFF"
                                    rounded={12}
                                    py="lg"
                                    fontWeight="bold"
                                    disabled={actionDisabled || !hasSelectedLocationArea}
                                    onPress={() => { void updateSelectedPropertyStatus("checked"); }}
                                    suffix={<Icon name="check-circle" fontFamily="Feather" fontSize="lg" ml="sm" color="#FFFFFF" />}
                                >
                                    確認盤點
                                </Button>
                            </Div>
                        ) : (
                            <Button
                                block
                                mt="sm"
                                bg="#7890A5"
                                color="#FFFFFF"
                                rounded={12}
                                py="lg"
                                fontWeight="bold"
                                disabled={actionDisabled}
                                onPress={() => Alert.alert("提示", "請長按此按鈕恢復未清點狀態。")}
                                onLongPress={confirmRestoreUnknownStatus}
                                prefix={<Icon name="rotate-ccw" fontFamily="Feather" fontSize="lg" mr="sm" color="#FFFFFF" />}
                            >
                                長按恢復未清點狀態
                            </Button>
                        )}
                    </>
                )}
            </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "white",
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "stretch",
        paddingHorizontal: 16,
        paddingBottom: 18,
    },
    backButtonSlot: {
        justifyContent: "center",
        marginRight: 12,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    headerYearSlot: {
        justifyContent: "center",
        marginLeft: 8,
    },
    detailYearTrigger: {
        minHeight: 32,
        paddingHorizontal: 10,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
    },
    detailEntityMenuHost: {
        width: "100%",
        alignItems: "center",
        marginBottom: 8,
    },
    detailEntityTrigger: {
        minHeight: 24,
        paddingHorizontal: 4,
        paddingVertical: 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    content: {
        flexGrow: 1,
        paddingHorizontal: 16,
    },
    emptyState: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    loadingState: {
        flex: 1,
        minHeight: 220,
        alignItems: "center",
        justifyContent: "center",
    },
    quickStatusNotice: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: "#F8FAFC",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#CBD5E1",
    },
    summaryCard: {
        minHeight: 88,
        justifyContent: "center",
        paddingHorizontal: 24,
        paddingVertical: 18,
        borderRadius: 18,
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: 5,
        },
        shadowOpacity: 0.14,
        shadowRadius: 12,
        elevation: 4,
    },
    summaryMetaRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 12,
    },
    summarySubCard: {
        flex: 1,
        minWidth: 0,
        justifyContent: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 16,
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: 5,
        },
        shadowOpacity: 0.14,
        shadowRadius: 12,
        elevation: 4,
    },
    detailCard: {
        marginVertical: 12,
        padding: 5,
    },
    inlineEditButton: {
        flexDirection: "row",
        alignItems: "center",
    },
    entitySelectionContainer: {
        paddingTop: 12,
    },
    entityChoiceCard: {
        minHeight: 76,
        marginBottom: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#F8FAFC",
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: 5,
        },
        shadowOpacity: 0.14,
        shadowRadius: 12,
        elevation: 4,
    },
    entityChoiceNumber: {
        width: 34,
        height: 34,
        marginRight: 12,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#7890A5",
    },
    entityChoiceText: {
        flex: 1,
        minWidth: 0,
    },
    detailRow: {
        paddingVertical: 9,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#EAECF0",
    },
    editableDetailRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    editableDetailText: {
        flex: 1,
        minWidth: 0,
    },
    relationshipSection: {
        paddingVertical: 9,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#EAECF0",
    },
    relationshipFieldRow: {
        paddingBottom: 4,
    },
    relationshipFieldHeader: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    relationshipHeaderIconButton: {
        width: 30,
        height: 30,
        alignItems: "center",
        justifyContent: "center",
    },
    relationshipItemCard: {
        minHeight: 68,
        marginTop: 4,
        marginBottom: 2,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        borderWidth: StyleSheet.hairlineWidth,
    },
    relationshipItemContent: {
        flex: 1,
        minWidth: 0,
    },
    relationshipCardIconButton: {
        width: 34,
        height: 34,
        marginLeft: 10,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
    },
    relationshipCardIconButtonDestructive: {
        backgroundColor: "transparent",
        borderColor: "transparent",
    },
    relationshipPressedOverlay: {
        ...absoluteFill,
        backgroundColor: "rgba(17, 24, 39, 0.05)",
        borderRadius: 10,
    },
    relationshipPlaceholderButton: {
        minHeight: 48,
        marginTop: 4,
        marginBottom: 2,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F8FAFC",
        borderWidth: 1,
        borderColor: "#CBD5E1",
        borderStyle: "dashed",
    },
    relationshipParentRow: {
        minHeight: 58,
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#F8FAFC",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#CBD5E1",
    },
    relationshipChildrenHeader: {
        minHeight: 32,
        marginTop: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    relationshipChildRow: {
        minHeight: 50,
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#FFFFFF",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#CBD5E1",
    },
    relationshipInfoText: {
        flex: 1,
        minWidth: 0,
        paddingRight: 8,
    },
    relationshipEmptyText: {
        marginTop: 4,
    },
    relationshipSmallButton: {
        minHeight: 30,
        paddingHorizontal: 10,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
    },
    relationshipIconButton: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FEF2F2",
        borderWidth: 1,
        borderColor: "#FECACA",
    },
    relationshipButtonDisabled: {
        opacity: 0.55,
    },
    photoSection: {
        paddingTop: 9,
        paddingBottom: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#EAECF0",
    },
    photoSectionHeader: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    photoSectionTitle: {
        flex: 1,
        minWidth: 0,
    },
    photoSectionCount: {
        minWidth: 42,
        flexShrink: 0,
        textAlign: "right",
    },
    photoStrip: {
        paddingTop: 4,
        paddingBottom: 4,
        gap: 12,
    },
    photoThumbFrame: {
        width: 120,
        height: 120,
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: "#E5E7EB",
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: 3,
        },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 3,
    },
    photoThumb: {
        width: "100%",
        height: "100%",
    },
    addPhotoThumbButton: {
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
        borderStyle: "dashed",
    },
    addPhotoButton: {
        width: "100%",
        minHeight: 48,
        marginTop: 4,
        marginBottom: 4,
        paddingHorizontal: 14,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
        borderStyle: "dashed",
        flexShrink: 0,
    },
    addPhotoMenuTrigger: {
        width: "100%",
    },
    addPhotoMenuInnerTrigger: {
        alignSelf: "center",
    },
    addPhotoButtonIcon: {
        flexShrink: 0,
    },
    addPhotoButtonText: {
        flexShrink: 1,
        minWidth: 0,
        textAlign: "center",
    },
    addPhotoButtonDisabled: {
        opacity: 0.62,
    },
    photoPreviewModalRoot: {
        flex: 1,
    },
    photoPreviewOverlay: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
        backgroundColor: "rgba(15, 23, 42, 0.62)",
    },
    photoPreviewPanel: {
        maxWidth: 430,
        borderRadius: 20,
        padding: 12,
        alignItems: "center",
        overflow: "visible",
        backgroundColor: "#FFFFFF",
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.18,
        shadowRadius: 18,
        elevation: 8,
    },
    photoPreviewImageWrap: {
        borderRadius: 14,
        overflow: "visible",
        zIndex: 3,
        backgroundColor: "transparent",
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.14,
        shadowRadius: 16,
        elevation: 4,
    },
    photoZoomContent: {
        alignItems: "center",
        justifyContent: "center",
    },
    photoPreviewImage: {
        flexShrink: 0,
        borderRadius: 14,
        backgroundColor: "#F8FAFC",
    },
    photoPreviewActionsRow: {
        width: "100%",
        zIndex: 1,
        flexDirection: "row",
        justifyContent: "center",
        gap: 10,
        marginTop: 10,
    },
    photoPreviewActionButton: {
        flex: 1,
        minHeight: 40,
        paddingHorizontal: 12,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    photoPreviewActionButtonDisabled: {
        opacity: 0.62,
    },
    photoPreviewSaveButton: {
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
    },
    photoPreviewDeleteButton: {
        backgroundColor: "#DC2626",
    },
    photoPreviewCloseButton: {
        width: "100%",
        zIndex: 1,
        minHeight: 38,
        marginTop: 8,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f2f2f2",
    },
    areaPreviewSection: {
        paddingBottom: 12,
        marginBottom: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#EAECF0",
    },
    areaPreviewHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
    },
    areaPreviewFrame: {
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: 14,
        backgroundColor: "#F8FAFC",
    },
    areaPreviewCanvas: {
        position: "relative",
        backgroundColor: "#F8FAFC",
    },
    areaPreviewBox: {
        position: "absolute",
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(71, 85, 105, 0.7)",
        backgroundColor: "rgba(255, 255, 255, 0.5)",
    },
    areaPreviewSelectedOverlay: {
        ...absoluteFill,
        backgroundColor: "rgba(59, 130, 246, 0.28)",
    },
    areaPreviewLockedOverlay: {
        ...absoluteFill,
        backgroundColor: "rgba(34, 197, 94, 0.32)",
    },
    areaLockedBadge: {
        ...absoluteFill,
        alignItems: "center",
        justifyContent: "center",
    },
    areaLockedTouchOverlay: {
        ...absoluteFill,
        backgroundColor: "transparent",
    },
    areaCompletionFeedback: {
        ...absoluteFill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(187, 247, 208, 0.8)",
    },
    areaCompletionFeedbackInfo: {
        backgroundColor: "rgba(219, 234, 254, 0.84)",
    },
    areaCompletionContent: {
        alignItems: "center",
        justifyContent: "center",
    },
    areaCompletionBadge: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#86D9A4",
        borderWidth: 2,
        borderColor: "#FFFFFF",
    },
    areaCompletionBadgeInfo: {
        backgroundColor: "#60A5FA",
    },
    areaPreviewEmpty: {
        minHeight: 120,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 14,
        backgroundColor: "#F8FAFC",
    },
    detailLabel: {
        marginBottom: 3,
    },
    detailValue: {
        lineHeight: 21,
    },
    fixedActions: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 12,
        paddingHorizontal: 16,
        // borderTopWidth: StyleSheet.hairlineWidth,
        // borderTopColor: "#F1E4D2",
        backgroundColor: "white",
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: -4,
        },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 8,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "rgba(15, 23, 42, 0.65)",
    },
    modalInnerContainer: {
        width: "90%",
        maxHeight: "76%",
        paddingVertical: 16,
        paddingHorizontal: 18,
        borderRadius: 15,
        backgroundColor: "white",
    },
    relationshipPickerContainer: {
        height: "76%",
    },
    splitModalContainer: {
        maxWidth: 440,
    },
    splitEntityList: {
        maxHeight: 380,
        marginTop: 14,
    },
    splitEntityRow: {
        minHeight: 54,
        marginBottom: 8,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "#F8FAFC",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#CBD5E1",
    },
    splitEntityOtherRow: {
        backgroundColor: "#F8FAFC",
        borderColor: "#E2E8F0",
        opacity: 0.78,
    },
    splitEntityNumber: {
        minWidth: 15,
        alignItems: "center",
        paddingHorizontal: 5
    },
    splitEntityExistingName: {
        flex: 1,
        minWidth: 0,
        paddingHorizontal: 5,
        paddingVertical: 6,
    },
    splitEntityDeleteButton: {
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        backgroundColor: "#FEF2F2",
    },
    cancelSplitButton: {
        alignSelf: "center",
        marginTop: 12,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    relationshipPickerList: {
        flex: 1,
        marginTop: 4,
    },
    relationshipPickerContent: {
        paddingBottom: 8,
    },
    relationshipPickerEmptyContent: {
        flexGrow: 1,
    },
    relationshipPickerEmpty: {
        flex: 1,
        minHeight: 160,
        alignItems: "center",
        justifyContent: "center",
    },
    relationshipCandidateRow: {
        minHeight: 62,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 8,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#F8FAFC",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#CBD5E1",
    },
    relationshipCandidateText: {
        flex: 1,
        minWidth: 0,
        paddingRight: 8,
    },
    modalHeaderRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginTop: 5,
    },
    modalHeaderTitle: {
        flex: 1,
        minWidth: 0,
        paddingRight: 12,
    },
    modalHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
    },
    modalCharacterCount: {
        minWidth: 64,
        textAlign: "right",
        flexShrink: 0,
    },
    modalUpdateButton: {
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        marginLeft: 12,
    },
    modalReadOnlyScroll: {
        maxHeight: 363,
        marginTop: 15,
    },
    modalReadOnlyContent: {
        paddingBottom: 8,
    },
    textSuggestionSection: {
        marginTop: 10,
        overflow: "hidden",
    },
    textSuggestionList: {
        gap: 8,
        paddingHorizontal: 8,
        paddingTop: 0,
        paddingBottom: 2,
    },
    textSuggestionChip: {
        maxWidth: 220,
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
    },
    modalFooterRow: {
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 10,
        paddingTop: 5,
    },
});
