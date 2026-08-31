import {useEffect, useMemo, useState} from "react";
import {
    Alert,
    Keyboard,
    Platform,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from "react-native";
import Modal from "react-native-modal";
import {Button, Div, Icon, Input, Text} from "react-native-magnus";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {getBottomModalSafeAreaPadding} from "@/constants/bottomModalSafeArea";
import {
    getAreaShapeFromStyle,
    isAreaDashedFromStyle,
    isAreaRoundedFromStyle,
    type AreaLayout,
    type AreaLayoutArea,
} from "@/handlers/areaLayout";
import AndroidKeyboardAvoidingView from "@/components/AndroidKeyboardAvoidingView";
import {centeredEdgeToEdgeModalProps} from "@/constants/centeredModal";

type AreaLayoutPreviewModalProps = {
    visible: boolean;
    layout: AreaLayout | null;
    onCancel: () => void;
    onConfirm: (layout: AreaLayout) => void | Promise<void>;
};

function getAreaLabel(area: AreaLayoutArea): string {
    return area.name.trim() || "未命名";
}

export default function AreaLayoutPreviewModal({visible, layout, onCancel, onConfirm}: AreaLayoutPreviewModalProps) {
    const {height: windowHeight} = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const bottomModalSafeAreaPadding = getBottomModalSafeAreaPadding(insets.bottom);
    const previewMargin = 10;
    const [draftLayout, setDraftLayout] = useState<AreaLayout | null>(layout);
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
    const [editingAreaName, setEditingAreaName] = useState(false);
    const [areaNameDraft, setAreaNameDraft] = useState("");

    useEffect(() => {
        setDraftLayout(layout);
        setSelectedAreaId(layout?.areas[0]?.id ?? null);
        setEditingAreaName(false);
        setAreaNameDraft("");
    }, [layout]);

    useEffect(() => {
        setEditingAreaName(false);
        setAreaNameDraft("");
    }, [selectedAreaId]);

    const selectedArea = useMemo(
        () => draftLayout?.areas.find((area) => area.id === selectedAreaId) ?? null,
        [draftLayout, selectedAreaId]
    );
    const previewBounds = useMemo(() => {
        if (!draftLayout || draftLayout.areas.length === 0) {
            return {minX: 0, minY: 0, width: 0, height: 0};
        }

        const minX = Math.min(...draftLayout.areas.map((area) => area.x));
        const minY = Math.min(...draftLayout.areas.map((area) => area.y));
        const maxX = Math.max(...draftLayout.areas.map((area) => area.x + area.width));
        const maxY = Math.max(...draftLayout.areas.map((area) => area.y + area.height));

        return {
            minX,
            minY,
            width: Math.max(maxX - minX, 1),
            height: Math.max(maxY - minY, 1),
        };
    }, [draftLayout]);
    const scale = useMemo(() => {
        if (!draftLayout || previewBounds.height === 0) return 1;

        const modalMaxHeight = windowHeight * 0.85;
        const nonPreviewHeight = 224;
        const availablePreviewHeight = Math.max(320, modalMaxHeight - nonPreviewHeight);
        const availableDrawingHeight = Math.max(availablePreviewHeight - previewMargin * 2, 1);
        return Math.min(availableDrawingHeight / previewBounds.height, 1);
    }, [draftLayout, previewBounds.height, previewMargin, windowHeight]);
    const previewSize = useMemo(() => {
        if (!draftLayout) return {width: 0, height: 0};

        return {
            width: previewBounds.width * scale + previewMargin * 2,
            height: previewBounds.height * scale + previewMargin * 2,
        };
    }, [draftLayout, previewBounds.height, previewBounds.width, previewMargin, scale]);
    const areaLabelFontSize = Math.min(Math.max(scale * 16, 10), 14);
    const missingNameCount = draftLayout?.areas.filter((area) => !area.name.trim()).length ?? 0;
    const trimmedAreaNameDraft = areaNameDraft.trim();
    const canSaveAreaName = trimmedAreaNameDraft.length > 0 && trimmedAreaNameDraft.length <= 6;

    const startRenamingSelectedArea = () => {
        if (!selectedArea) return;

        setAreaNameDraft(selectedArea.name);
        setEditingAreaName(true);
    };

    const saveSelectedAreaName = () => {
        if (!selectedArea || !draftLayout || !canSaveAreaName) return;

        const nextName = trimmedAreaNameDraft;

        setDraftLayout({
            ...draftLayout,
            areas: draftLayout.areas.map((area) => (
                area.id === selectedArea.id ? {...area, name: nextName} : area
            )),
        });
        setEditingAreaName(false);
    };

    const confirm = async () => {
        if (!draftLayout) return;

        const missingAreas = draftLayout.areas.filter((area) => !area.name.trim());
        if (missingAreas.length > 0) {
            Alert.alert("尚有未命名區域", `還有 ${missingAreas.length} 個方塊沒有區域名稱，\n請先點選紅色方塊並設定名稱。`);
            setSelectedAreaId(missingAreas[0].id);
            return;
        }

        await onConfirm(draftLayout);
    };

    if (!draftLayout) return null;

    return (
        <>
            <Modal
                isVisible={visible}
                animationIn="slideInUp"
                animationOut="slideOutDown"
                animationInTiming={220}
                animationOutTiming={180}
                useNativeDriver
                useNativeDriverForBackdrop
                hideModalContentWhileAnimating
                hasBackdrop
                backdropOpacity={0.45}
                backdropTransitionOutTiming={1}
                onBackButtonPress={onCancel}
                style={styles.modal}
                {...centeredEdgeToEdgeModalProps}
            >
                    <View style={[styles.panel, {paddingBottom: 24 + bottomModalSafeAreaPadding}]}>
                        <View style={styles.header}>
                            <View>
                                <Text fontSize="xl" fontWeight="bold" color="gray900">預覽空間配置</Text>
                                <Text mt={4} fontSize="sm" color={missingNameCount > 0 ? "red600" : "gray600"}>
                                    {missingNameCount > 0 ? `${missingNameCount} 個方塊尚未命名` : `共 ${draftLayout.areas.length} 個區域`}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.previewViewport}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={[styles.previewCanvas, previewSize]}>
                                    {draftLayout.areas.map((area) => {
                                        const selected = area.id === selectedAreaId;
                                        const missingName = !area.name.trim();
                                        const scaledWidth = area.width * scale;
                                        const scaledHeight = area.height * scale;
                                        const shape = area.shape ?? getAreaShapeFromStyle(area.style);
                                        const rounded = area.rounded ?? isAreaRoundedFromStyle(area.style);

                                        return (
                                            <TouchableOpacity
                                                key={area.id}
                                                activeOpacity={0.8}
                                                onPress={() => setSelectedAreaId(area.id)}
                                                style={[
                                                    styles.areaBox,
                                                    {
                                                        top: (area.y - previewBounds.minY) * scale + previewMargin,
                                                        left: (area.x - previewBounds.minX) * scale + previewMargin,
                                                        width: scaledWidth,
                                                        height: scaledHeight,
                                                        borderRadius: shape === "ellipse"
                                                            ? Math.min(scaledWidth, scaledHeight) / 2
                                                            : rounded ? 8 : 0,
                                                        borderStyle: (area.dashed ?? isAreaDashedFromStyle(area.style)) ? "dashed" : "solid",
                                                    },
                                                ]}
                                            >
                                                <Text fontSize={areaLabelFontSize} fontWeight="bold" color="gray900" textAlign="center" numberOfLines={2}>
                                                    {getAreaLabel(area)}
                                                </Text>
                                                {missingName && <View pointerEvents="none" style={styles.missingOverlay} />}
                                                {selected && <View pointerEvents="none" style={styles.selectedOverlay} />}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </ScrollView>
                        </View>

                        <Div mt="md" rounded={8} bg="gray100" p="md">
                            <Text fontSize="lg" textAlign="center" fontWeight="bold" color="gray900">
                                {selectedArea ? getAreaLabel(selectedArea) : "請點選一個方框"}
                            </Text>
                        </Div>

                        <Div row mt="lg">
                            <Button flex={1} mr="sm" bg="gray300" color="gray800" rounded={8} fontWeight="bold" onPress={onCancel}>
                                取消
                            </Button>
                            <Button flex={1} mx="sm" bg="blue400" rounded={8} fontWeight="bold" disabled={!selectedArea} onPress={startRenamingSelectedArea}>
                                設定名稱
                            </Button>
                            <Button flex={1} ml="sm" bg="green500" rounded={8} fontWeight="bold" onPress={() => { void confirm(); }}>
                                確定匯入
                            </Button>
                        </Div>
                    </View>

                    <Modal
                        isVisible={editingAreaName}
                        animationIn="zoomIn"
                        animationInTiming={260}
                        animationOut="zoomOut"
                        animationOutTiming={180}
                        hasBackdrop
                        backdropOpacity={0.65}
                        backdropTransitionOutTiming={1}
                        avoidKeyboard={Platform.OS === "ios"}
                        onBackdropPress={Keyboard.dismiss}
                        onBackButtonPress={() => setEditingAreaName(false)}
                        {...centeredEdgeToEdgeModalProps}
                    >
                        <AndroidKeyboardAvoidingView style={styles.nameModalBackdrop}>
                        <View style={styles.nameModalPanel}>
                            <Text fontSize="xl" fontWeight="bold" color="gray900" textAlign="center">
                                設定區域名稱
                            </Text>
                            <Text mt={8} fontSize="md" color="gray600" textAlign="center">
                                此名稱會用於現場清點時選擇位置。
                            </Text>
                            <Input
                                mt="lg"
                                value={areaNameDraft}
                                onChangeText={setAreaNameDraft}
                                placeholder="例如：大桌1"
                                textAlign="center"
                                fontWeight="bold"
                                fontSize="lg"
                                borderColor="gray300"
                                rounded={8}
                                autoFocus
                            />
                            <Text mt={6} fontSize="sm" textAlign="right" color={trimmedAreaNameDraft.length <= 6 ? "gray600" : "red600"}>
                                {areaNameDraft.length}/6
                            </Text>

                            <Div row mt="lg">
                                <Button
                                    flex={1}
                                    mr="sm"
                                    bg="gray300"
                                    color="gray800"
                                    rounded={8}
                                    fontWeight="bold"
                                    onPress={() => setEditingAreaName(false)}
                                    prefix={<Icon name="x" fontFamily="Feather" fontSize="lg" mr="xs" color="gray800" />}
                                >
                                    取消
                                </Button>
                                <Button
                                    flex={1}
                                    ml="sm"
                                    bg={canSaveAreaName ? "blue400" : "gray300"}
                                    color="white"
                                    rounded={8}
                                    fontWeight="bold"
                                    disabled={!canSaveAreaName}
                                    onPress={saveSelectedAreaName}
                                    suffix={<Icon name="save" fontFamily="Feather" fontSize="lg" ml="xs" color="white" />}
                                >
                                    儲存名稱
                                </Button>
                            </Div>
                        </View>
                    </AndroidKeyboardAvoidingView>
                    </Modal>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    modal: {
        justifyContent: "flex-end",
        margin: 0,
    },
    panel: {
        width: "100%",
        maxHeight: "85%",
        padding: 18,
        paddingBottom: 24,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        backgroundColor: "white",
    },
    nameModalBackdrop: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 22,
    },
    nameModalPanel: {
        width: "100%",
        maxWidth: 420,
        padding: 20,
        borderRadius: 16,
        backgroundColor: "white",
    },
    header: {
        marginBottom: 14,
    },
    previewViewport: {
        overflow: "hidden",
    },
    previewCanvas: {
        position: "relative",
        borderWidth: 1,
        borderColor: "#D0D5DD",
        backgroundColor: "#F8FAFC",
    },
    areaBox: {
        position: "absolute",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 2,
        borderWidth: 1,
        borderColor: "#667085",
        backgroundColor: "rgba(255, 255, 255, 0.86)",
    },
    missingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(220, 38, 38, 0.35)",
    },
    selectedOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(37, 99, 235, 0.28)",
    },
});
