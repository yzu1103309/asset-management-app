import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from "react-native";
import {router, useFocusEffect, useLocalSearchParams} from "expo-router";
import {Image as ExpoImage} from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {Gesture, GestureDetector, GestureHandlerRootView} from "react-native-gesture-handler";
import Reanimated, {useAnimatedStyle, useSharedValue, withSpring} from "react-native-reanimated";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {Button, Div, Icon, Input, Text} from "react-native-magnus";
import {getPropertyItemsByBarcode} from "@/handlers/propertyList";
import type {PropertyItem} from "@/handlers/propertyImport";
import type {PropertyPhoto} from "@/handlers/propertyItemStore";
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
    addPropertyLabelBarcode,
    isBarcodeInPropertyLabelQueue,
    removePropertyLabelBarcode,
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

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
    unknown: "未清點",
    checked: "已確認",
    pending: "待處理",
};

function EditableDetailRow({label, value, onPress}: {label: string; value: string | null | undefined; onPress: () => void}) {
    return (
        <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={[styles.detailRow, styles.editableDetailRow]}>
            <View style={styles.editableDetailText}>
                <Text fontSize="md" color="gray600" style={styles.detailLabel}>{label}</Text>
                <Text fontSize="lg" color="gray900" style={styles.detailValue}>{value || "（未填寫）"}</Text>
            </View>
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
                        <Text fontSize="xl" color="gray800" fontWeight="bold">
                            {target?.title ?? "編輯"}
                        </Text>
                        {isEditing ? (
                            <View style={styles.modalHeaderActions}>
                                <Text fontSize="lg" color={text.length >= limit ? "red600" : "gray600"}>
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

                            {filteredSuggestions.length > 0 && (
                                <View style={styles.textSuggestionSection}>
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
                                </View>
                            )}

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

function PhotoSourceModal({
    visible,
    addingPhoto,
    onClose,
    onCamera,
    onLibrary,
}: {
    visible: boolean;
    addingPhoto: boolean;
    onClose: () => void;
    onCamera: () => void;
    onLibrary: () => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.photoSourceOverlay}>
                <View style={styles.photoSourcePanel}>
                    <Text fontSize="xl" fontWeight="bold" color="gray900" textAlign="center">
                        新增照片
                    </Text>
                    <Text mt={6} mb={16} fontSize="md" color="gray600" textAlign="center">
                        選擇照片來源
                    </Text>
                    <TouchableOpacity activeOpacity={0.78} disabled={addingPhoto} onPress={onCamera} style={styles.photoSourceOption}>
                        <Icon name="camera-outline" fontFamily="Ionicons" color="#2563EB" fontSize="xl" mr="md" />
                        <Text color="gray900" fontSize="lg" fontWeight="bold">拍照</Text>
                    </TouchableOpacity>
                    <TouchableOpacity activeOpacity={0.78} disabled={addingPhoto} onPress={onLibrary} style={styles.photoSourceOption}>
                        <Icon name="images-outline" fontFamily="Ionicons" color="#2563EB" fontSize="xl" mr="md" />
                        <Text color="gray900" fontSize="lg" fontWeight="bold">從圖庫選擇</Text>
                    </TouchableOpacity>
                    <Button block mt="md" bg="gray200" color="gray800" rounded={12} onPress={onClose} disabled={addingPhoto}>
                        取消
                    </Button>
                </View>
            </View>
        </Modal>
    );
}

function PropertyDetailBlock({
    item,
    index,
    total,
    areaLayout,
    status,
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
}: {
    item: PropertyItem;
    index: number;
    total: number;
    areaLayout: AreaLayout | null;
    status: PropertyStatus;
    onEditText: (item: PropertyItem, entityIndex: number, field: PropertyItemEditableTextField) => void;
    onSelectArea: (item: PropertyItem, entityIndex: number, area: AreaLayoutArea | null) => void;
    draftLocationArea: {id: string; name: string} | null;
    locationEditMode: boolean;
    fieldsEditable: boolean;
    statusLocked: boolean;
    completionFeedbackMessage: string | null;
    completionFeedbackKey: number;
    onRequestEditMode: () => void;
    onAddPhoto: (item: PropertyItem, entityIndex: number) => void;
    onPreviewPhoto: (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => void;
    onPhotoOptions: (item: PropertyItem, entityIndex: number, photo: PropertyPhoto) => void;
    addingPhoto: boolean;
}) {
    const {width: windowWidth} = useWindowDimensions();
    const statusColors = PROPERTY_STATUS_COLORS[status];
    const savedAreaId = areaLayout
        ? findAreaByIdOrName(areaLayout.areas, item.location.areaId, item.location.areaName)?.id ?? null
        : item.location.areaId;
    const photoCount = item.photos?.length ?? 0;
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
                {total > 1 && (
                    <Text mb={8} textAlign="center" color={statusColors.nameColor} fontWeight="bold" fontSize="sm">
                        實體 {index + 1} / {total}
                    </Text>
                )}
                <Text textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="2xl">{item.propertyName}</Text>
            </View>
            <View style={styles.summaryMetaRow}>
                <View style={[styles.summarySubCard, {backgroundColor: statusColors.cardBg}]}>
                    <Text textAlign="center" color={statusColors.nameColor} fontWeight="bold" fontSize="md">清單項次</Text>
                    <Text mt={4} textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="xl">{item.itemNumber}</Text>
                </View>
                <View style={[styles.summarySubCard, {backgroundColor: statusColors.cardBg}]}>
                    <Text textAlign="center" color={statusColors.nameColor} fontWeight="bold" fontSize="md">目前狀態</Text>
                    <Text mt={4} textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="xl">{PROPERTY_STATUS_LABELS[status]}</Text>
                </View>
                <View style={[styles.summarySubCard, {backgroundColor: statusColors.cardBg}]}>
                    <Text textAlign="center" color={statusColors.nameColor} fontWeight="bold" fontSize="md">保管人</Text>
                    <Text mt={4} textAlign="center" color={statusColors.barcodeColor} fontWeight="bold" fontSize="xl" numberOfLines={1}>
                        {item.custodianName?.trim() || "未提供"}
                    </Text>
                </View>
            </View>
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
                    onSelectArea={(area) => onSelectArea(item, index, area)}
                />
                <EditableDetailRow label="詳細位置描述" value={item.location.description} onPress={() => onEditText(item, index, "locationDescription")} />
                <EditableDetailRow label="其他備註" value={item.note} onPress={() => onEditText(item, index, "note")} />
                <View style={styles.photoSectionHeader}>
                    <Text fontSize="md" color="gray600" style={styles.detailLabel}>財產照片</Text>
                    <Text fontSize="sm" color="gray500">{photoCount} / {MAX_PROPERTY_PHOTO_COUNT}</Text>
                </View>
                {photoCount > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                        {item.photos?.map((photo) => (
                            <TouchableOpacity
                                key={photo.id}
                                activeOpacity={0.82}
                                onPress={() => onPreviewPhoto(item, index, photo)}
                                onLongPress={() => onPhotoOptions(item, index, photo)}
                                style={[styles.photoThumbFrame, photoCount === 1 && singlePhotoThumbSize]}
                            >
                                <ExpoImage source={{uri: photo.uri}} style={styles.photoThumb} contentFit="cover" />
                            </TouchableOpacity>
                        ))}
                        {photoCount < MAX_PROPERTY_PHOTO_COUNT && (
                            <TouchableOpacity
                                activeOpacity={0.78}
                                disabled={addingPhoto}
                                onPress={() => onAddPhoto(item, index)}
                                style={[
                                    styles.photoThumbFrame,
                                    photoCount === 1 && singlePhotoThumbSize,
                                    styles.addPhotoThumbButton,
                                    addingPhoto && styles.addPhotoButtonDisabled,
                                ]}
                            >
                                <Icon name="plus" fontFamily="Feather" color="#2563EB" fontSize="3xl" />
                                <Text mt={4} color="#1D4ED8" fontSize="sm" fontWeight="bold">新增</Text>
                            </TouchableOpacity>
                        )}
                    </ScrollView>
                )}
                {photoCount === 0 && (
                    <TouchableOpacity
                        activeOpacity={0.78}
                        disabled={addingPhoto}
                        onPress={() => onAddPhoto(item, index)}
                        style={[styles.addPhotoButton, addingPhoto && styles.addPhotoButtonDisabled]}
                    >
                        <Icon name="library-add" fontFamily="MaterialIcons" color="#2563EB" fontSize="md" mr="sm" />
                        <Text color="#1D4ED8" fontWeight="bold" fontSize="lg">
                            {addingPhoto ? "處理照片中..." : "新增照片"}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
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
                                {item.propertyName}
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
    const params = useLocalSearchParams<{barcode?: string; serial?: string; entityIndex?: string; status?: string; year?: string}>();
    const barcode = useMemo(() => getParamValue(params.barcode) ?? getParamValue(params.serial), [params.barcode, params.serial]);
    const requestedEntityIndex = useMemo(() => parseEntityIndexParam(getParamValue(params.entityIndex)), [params.entityIndex]);
    const requestedYear = useMemo(() => getParamValue(params.year), [params.year]);
    const [items, setItems] = useState<PropertyItem[]>([]);
    const [areaLayout, setAreaLayout] = useState<AreaLayout | null>(null);
    const [propertyStatus, setPropertyStatus] = useState<PropertyStatus>("unknown");
    const [entityStatuses, setEntityStatuses] = useState<PropertyStatus[]>([]);
    const [selectedEntityIndex, setSelectedEntityIndex] = useState<number | null>(null);
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
    const [updatingPropertyLabelQueue, setUpdatingPropertyLabelQueue] = useState(false);
    const [addingPhoto, setAddingPhoto] = useState(false);
    const [savingPhotoToLibrary, setSavingPhotoToLibrary] = useState(false);
    const [selectedItemInPropertyLabelQueue, setSelectedItemInPropertyLabelQueue] = useState(false);
    const [loading, setLoading] = useState(true);
    const [statusLoading, setStatusLoading] = useState(true);
    const [locationCompletionMessage, setLocationCompletionMessage] = useState<string | null>(null);
    const [locationCompletionKey, setLocationCompletionKey] = useState(0);
    const [previewingPhoto, setPreviewingPhoto] = useState<{
        item: PropertyItem;
        entityIndex: number;
        photo: PropertyPhoto;
    } | null>(null);
    const [photoSourceTarget, setPhotoSourceTarget] = useState<{
        item: PropertyItem;
        entityIndex: number;
    } | null>(null);
    const [photoSourceLaunchKey, setPhotoSourceLaunchKey] = useState(0);
    const locationCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingPhotoSourceRequestRef = useRef<{
        source: "camera" | "library";
        item: PropertyItem;
        entityIndex: number;
    } | null>(null);
    const selectedItem = selectedEntityIndex !== null ? items[selectedEntityIndex] ?? null : null;
    const statusLookupKey = items.map((item) => item.sourceYears.join(",")).join("|");
    const currentLocationArea = selectedItem?.location.areaId && selectedItem.location.areaName
        ? {id: selectedItem.location.areaId, name: selectedItem.location.areaName}
        : null;
    const hasSelectedLocationArea = !!selectedItem?.location.areaName?.trim();
    const statusLocked = propertyStatus !== "unknown";
    const locationEditMode = editingLockedFields;
    const fieldsEditable = !statusLocked || locationEditMode;
    const pageLoading = loading || statusLoading;
    const actionDisabled = pageLoading || !selectedItem || updatingStatus || updatingLocationArea;
    const showFixedActions = !pageLoading && !!selectedItem;
    const contentBottomPadding = showFixedActions ? Math.max(insets.bottom, 12) + 156 : Math.max(insets.bottom, 12) + 24;

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
            if (!barcode) {
                setItems([]);
                setLoading(false);
                return;
            }

            try {
                const result = await getPropertyItemsByBarcode(barcode);
                if (mounted) setItems(result);
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [barcode]);

    useEffect(() => {
        if (items.length === 0) {
            setSelectedEntityIndex(null);
            return;
        }

        if (items.length === 1) {
            setSelectedEntityIndex(0);
            return;
        }

        if (requestedEntityIndex !== null && requestedEntityIndex < items.length) {
            setSelectedEntityIndex(requestedEntityIndex);
            return;
        }

        setSelectedEntityIndex(null);
    }, [items.length, requestedEntityIndex]);

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
                        }
                        return;
                    }

                    const itemYears = [...new Set(statusLookupKey.split("|").flatMap((sourceYears) => sourceYears.split(",")).filter(Boolean))];
                    const years = requestedYear && itemYears.includes(requestedYear) ? [requestedYear] : itemYears;
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

                                nextEntityStatuses[parsedEntry.entityIndex] = status;
                            }
                        }
                    }

                    if (active) {
                        setEntityStatuses(nextEntityStatuses);
                        setPropertyStatus(selectedEntityIndex !== null
                            ? nextEntityStatuses[selectedEntityIndex] ?? "unknown"
                            : nextEntityStatuses[0] ?? "unknown");
                    }
                } finally {
                    if (active) setStatusLoading(false);
                }
            })();

            return () => {
                active = false;
            };
        }, [barcode, items.length, requestedYear, selectedEntityIndex, statusLookupKey]),
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
                const inQueue = await isBarcodeInPropertyLabelQueue(selectedItem.barcode);
                if (mounted) setSelectedItemInPropertyLabelQueue(inQueue);
            } catch (error) {
                console.warn("讀取待製作財產標籤清單失敗:", error);
                if (mounted) setSelectedItemInPropertyLabelQueue(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [selectedItem?.barcode]);

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
        if (!barcode) return;

        router.push({
            pathname: "/stacks/details",
            params: {
                barcode,
                entityIndex: String(entityIndex),
                status: entityStatuses[entityIndex] ?? propertyStatus,
                ...(requestedYear ? {year: requestedYear} : {}),
            },
        });
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

        if (statusLocked && !draftLocationArea) {
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

        if (nextStatus === "checked" && !hasSelectedLocationArea) {
            Alert.alert("尚未選取位置", "確認盤點前，請先在位置圖上點選此財產所在區域。");
            return;
        }

        const year = requestedYear && selectedItem.sourceYears.includes(requestedYear)
            ? requestedYear
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

    const openAddPhotoMenu = (item: PropertyItem, entityIndex: number) => {
        if (addingPhoto) return;
        if ((item.photos?.length ?? 0) >= MAX_PROPERTY_PHOTO_COUNT) {
            Alert.alert("照片已達上限", `每個財產實體最多只能保存 ${MAX_PROPERTY_PHOTO_COUNT} 張照片。`);
            return;
        }

        setPhotoSourceTarget({item, entityIndex});
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

    const queuePhotoSourceLaunch = (source: "camera" | "library") => {
        if (!photoSourceTarget || addingPhoto) return;

        pendingPhotoSourceRequestRef.current = {
            source,
            item: photoSourceTarget.item,
            entityIndex: photoSourceTarget.entityIndex,
        };
        setPhotoSourceTarget(null);
        setPhotoSourceLaunchKey((key) => key + 1);
    };

    useEffect(() => {
        if (photoSourceTarget !== null) return;

        const request = pendingPhotoSourceRequestRef.current;
        if (!request) return;

        pendingPhotoSourceRequestRef.current = null;
        const launchTimer = setTimeout(() => {
            if (request.source === "camera") {
                void pickPhotoFromCamera(request.item, request.entityIndex);
                return;
            }

            void pickPhotoFromLibrary(request.item, request.entityIndex);
        }, Platform.OS === "ios" ? 520 : 280);

        return () => clearTimeout(launchTimer);
    }, [photoSourceLaunchKey, photoSourceTarget]);

    const addSelectedItemToPropertyLabelQueue = async () => {
        if (!selectedItem) return;

        setUpdatingPropertyLabelQueue(true);
        try {
            await addPropertyLabelBarcode(selectedItem.barcode);
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
        if (!selectedItem) return;

        setUpdatingPropertyLabelQueue(true);
        try {
            await removePropertyLabelBarcode(selectedItem.barcode);
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
                {!pageLoading && items.length > 1 && selectedEntityIndex === null && (
                    <EntitySelectionStep
                        items={items}
                        statuses={entityStatuses}
                        fallbackStatus={propertyStatus}
                        onSelect={selectEntity}
                    />
                )}
                {!pageLoading && selectedItem && (
                    <PropertyDetailBlock
                        key={`${selectedItem.barcode}:${selectedEntityIndex}`}
                        item={selectedItem}
                        index={selectedEntityIndex ?? 0}
                        total={items.length}
                        areaLayout={areaLayout}
                        status={propertyStatus}
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
            <PhotoSourceModal
                visible={photoSourceTarget !== null}
                addingPhoto={addingPhoto}
                onClose={() => setPhotoSourceTarget(null)}
                onCamera={() => queuePhotoSourceLaunch("camera")}
                onLibrary={() => queuePhotoSourceLaunch("library")}
            />

            {showFixedActions && (
            <View style={[styles.fixedActions, {paddingBottom: Math.max(insets.bottom, 12)}]}>
                {locationEditMode ? (
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
                            disabled={updatingLocationArea || (statusLocked && !draftLocationArea)}
                            onPress={() => { void saveDraftLocationEdit(); }}
                            suffix={<Icon name="save" fontFamily="Feather" fontSize="lg" ml="sm" color="#FFFFFF" />}
                        >
                            儲存位置
                        </Button>
                    </Div>
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
    },
    photoSectionHeader: {
        marginTop: 12,
        marginBottom: 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    photoStrip: {
        paddingTop: 8,
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
        minHeight: 48,
        marginTop: 12,
        marginBottom: 4,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
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
    photoSourceOverlay: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
        backgroundColor: "rgba(15, 23, 42, 0.46)",
    },
    photoSourcePanel: {
        width: "100%",
        maxWidth: 390,
        padding: 18,
        borderRadius: 20,
        backgroundColor: "#FFFFFF",
        shadowColor: PROPERTY_STATUS_CARD_SHADOW_COLOR,
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 8,
    },
    photoSourceOption: {
        minHeight: 56,
        marginBottom: 10,
        borderRadius: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#EFF6FF",
        borderWidth: 1,
        borderColor: "#BFDBFE",
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
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(59, 130, 246, 0.28)",
    },
    areaPreviewLockedOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(34, 197, 94, 0.32)",
    },
    areaLockedBadge: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
    },
    areaLockedTouchOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "transparent",
    },
    areaCompletionFeedback: {
        ...StyleSheet.absoluteFillObject,
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
    modalHeaderRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginTop: 5,
    },
    modalHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
    },
    modalUpdateButton: {
        flexDirection: "row",
        alignItems: "center",
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
        marginTop: 5,
        paddingTop: 5,
    },
});
