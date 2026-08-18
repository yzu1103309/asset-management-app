import {
    View,
    StyleSheet,
    Alert,
    Linking,
    InteractionManager,
    TouchableOpacity,
    ActivityIndicator,
    PanResponder,
    AppState,
    type AppStateStatus,
    type GestureResponderEvent,
} from "react-native";
import { CameraView, useCameraPermissions } from 'expo-camera';
import {router, useFocusEffect} from "expo-router";
import {useSpinner} from "@/context/SpinnerContext";
import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Text, Button, Icon} from "react-native-magnus";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import SearchModal from "@/components/SearchModal";

const CAMERA_IDLE_TIMEOUT_MS = 60 * 1000;
const CAMERA_READY_RETRY_MS = 1500;
const CAMERA_READY_MAX_RETRIES = 2;
const SCANNER_CAMERA_DEBUG_CONTROLS = false;
const AUTO_CAMERA_LENS = "__auto__";
const DEFAULT_SCANNER_CAMERA_ZOOM = 0.16;
const SCANNER_CAMERA_ZOOM_PRESETS = [
    {label: "較廣", value: 0.08},
    {label: "標準", value: DEFAULT_SCANNER_CAMERA_ZOOM},
    {label: "放大", value: 0.24},
    {label: "最大", value: 0.32},
];
const SCANNER_CAMERA_DEBUG_MIN_ZOOM = 0;
const SCANNER_CAMERA_DEBUG_MAX_ZOOM = 0.3;
const SCANNER_CAMERA_DEBUG_ZOOM_STEP = 0.01;
const SCANNER_CAMERA_DEBUG_ZOOM_OPTIONS = [
    {label: "0", value: 0},
    {label: "0.05", value: 0.05},
    {label: "0.1", value: 0.1},
    {label: "0.2", value: 0.2},
    {label: "0.3", value: 0.3},
];

const clampCameraZoom = (zoom: number) => {
    const clamped = Math.min(SCANNER_CAMERA_DEBUG_MAX_ZOOM, Math.max(SCANNER_CAMERA_DEBUG_MIN_ZOOM, zoom));
    return Math.round(clamped / SCANNER_CAMERA_DEBUG_ZOOM_STEP) * SCANNER_CAMERA_DEBUG_ZOOM_STEP;
};

type ScannerCameraProps = {
    sessionKey: number;
    customAutoFocus: boolean;
    selectedLens?: string;
    zoom: number;
    enableTorch: boolean;
    onAvailableLensesChanged: (lenses: string[]) => void;
    onBarcodeScanned: (isbn: string) => void;
    onReady: () => void;
};

const ScannerCamera = memo(function ScannerCamera({
    sessionKey,
    customAutoFocus,
    selectedLens,
    zoom,
    enableTorch,
    onAvailableLensesChanged,
    onBarcodeScanned,
    onReady,
}: ScannerCameraProps) {
    return (
        <CameraView
            key={sessionKey}
            active={true}
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{
                barcodeTypes: ["code39", "qr"],
            }}
            onAvailableLensesChanged={({lenses}) => onAvailableLensesChanged(lenses)}
            onBarcodeScanned={(scanningResult) => onBarcodeScanned(scanningResult.data)}
            selectedLens={selectedLens}
            zoom={zoom}
            enableTorch={enableTorch}
            autofocus={customAutoFocus ? "on" : "off"}
            onCameraReady={onReady}
        />
    );
});

export default function Scanner() {
    const [permission, requestPermission] = useCameraPermissions();
    const [isScannerFocused, setIsScannerFocused] = useState(false);
    const [isAppActive, setIsAppActive] = useState(AppState.currentState === "active");
    const [isCameraActive, setIsCameraActive] = useState(true);
    const [isCameraLoading, setIsCameraLoading] = useState(true);
    const [cameraSessionKey, setCameraSessionKey] = useState(0);
    const [customAutoFocus, setCustomAutoFocus] = useState(false);
    const [availableLenses, setAvailableLenses] = useState<string[]>([]);
    const [autoSelectedLens, setAutoSelectedLens] = useState<string | undefined>(undefined);
    const [debugSelectedLens, setDebugSelectedLens] = useState(AUTO_CAMERA_LENS);
    const [scannerZoom, setScannerZoom] = useState(DEFAULT_SCANNER_CAMERA_ZOOM);
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [debugZoom, setDebugZoom] = useState(DEFAULT_SCANNER_CAMERA_ZOOM);
    const [debugZoomTrackWidth, setDebugZoomTrackWidth] = useState(0);
    const [modalVisible, setModalVisible] = useState(false);
    const [scanned, setScanned] = useState("")
    const reopenSearchOnFocusRef = useRef(false);
    const searchOpenRequestIdRef = useRef(0);
    const pauseCameraTaskRef = useRef<{cancel: () => void} | null>(null);
    const resumeCameraTaskRef = useRef<{cancel: () => void} | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleAlertVisibleRef = useRef(false);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const scannerFocusedRef = useRef(false);
    const permissionMissingLogKeyRef = useRef<string | null>(null);
    const selectedLensRef = useRef<string | undefined>(undefined);
    const cameraReadyRetryCountRef = useRef(0);
    const debugZoomDragStartRef = useRef(DEFAULT_SCANNER_CAMERA_ZOOM);
    const insets = useSafeAreaInsets()

    // console.log("Scanner Page Rerender")

    const cancelPendingCameraPause = () => {
        if(pauseCameraTaskRef.current) {
            pauseCameraTaskRef.current.cancel();
            pauseCameraTaskRef.current = null;
        }
    };

    const cancelPendingCameraResume = () => {
        if(resumeCameraTaskRef.current) {
            resumeCameraTaskRef.current.cancel();
            resumeCameraTaskRef.current = null;
        }
    };

    const clearCameraIdleTimer = () => {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    };

    const pauseCamera = useCallback((reason: string) => {
        clearCameraIdleTimer();
        cancelPendingCameraResume();
        setIsCameraActive(false);
        setIsCameraLoading(false);
    }, []);

    const activateCamera = useCallback((reason: string) => {
        clearCameraIdleTimer();
        idleAlertVisibleRef.current = false;
        cameraReadyRetryCountRef.current = 0;
        cancelPendingCameraPause();
        cancelPendingCameraResume();
        setIsCameraLoading(true);
        setIsCameraActive(true);
        setCameraSessionKey((key) => key + 1);
    }, []);

    const queueCameraActivation = useCallback((reason: string, restartSession = true) => {
        clearCameraIdleTimer();
        idleAlertVisibleRef.current = false;
        cameraReadyRetryCountRef.current = 0;
        cancelPendingCameraPause();
        cancelPendingCameraResume();
        setIsCameraActive(false);
        setIsCameraLoading(true);

        resumeCameraTaskRef.current = InteractionManager.runAfterInteractions(() => {
            setIsCameraActive(true);
            if (restartSession) {
                setCameraSessionKey((key) => key + 1);
            }
            resumeCameraTaskRef.current = null;
        });
    }, []);

    const resetCameraIdleTimer = useCallback(() => {
        clearCameraIdleTimer();
        if (!isAppActive || !isScannerFocused || !isCameraActive || modalVisible || !permission?.granted) return;

        idleTimerRef.current = setTimeout(() => {
            if (idleAlertVisibleRef.current) return;

            if (appStateRef.current !== "active" || !scannerFocusedRef.current) {
                pauseCamera("idle_timeout_while_not_foreground");
                return;
            }

            idleAlertVisibleRef.current = true;
            pauseCamera("idle_timeout_auto_sleep");
            Alert.alert(
                "相機已休眠",
                "已經一段時間沒有使用\n已先暫停相機",
                [
                    {
                        text: "開啟相機",
                        style: "cancel",
                        onPress: () => {
                            idleAlertVisibleRef.current = false;
                            activateCamera("idle_sleep_cancelled");
                        },
                    },
                    {
                        text: "維持休眠",
                        onPress: () => {
                            idleAlertVisibleRef.current = false;
                        },
                    },
                ],
            );
        }, CAMERA_IDLE_TIMEOUT_MS);
    }, [activateCamera, isAppActive, isCameraActive, isScannerFocused, modalVisible, pauseCamera, permission?.granted]);

    const openSearchModal = useCallback(() => {
        reopenSearchOnFocusRef.current = false;
        searchOpenRequestIdRef.current += 1;
        const requestId = searchOpenRequestIdRef.current;
        setModalVisible(false);
        cancelPendingCameraPause();
        cancelPendingCameraResume();
        clearCameraIdleTimer();
        pauseCamera("search_modal_open_requested");
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (searchOpenRequestIdRef.current !== requestId) return;
                setModalVisible(true);
            });
        });
    }, [pauseCamera]);

    const closeSearchModal = useCallback(() => {
        reopenSearchOnFocusRef.current = false;
        searchOpenRequestIdRef.current += 1;
        cancelPendingCameraPause();
        cancelPendingCameraResume();
        setModalVisible(false);
        queueCameraActivation("search_modal_closed");
    }, [queueCameraActivation]);

    const handleSearchNavigation = useCallback((shouldReopenOnReturn: boolean) => {
        reopenSearchOnFocusRef.current = shouldReopenOnReturn;
        searchOpenRequestIdRef.current += 1;
        cancelPendingCameraPause();
        cancelPendingCameraResume();
        clearCameraIdleTimer();
        setModalVisible(false);
        pauseCamera("search_result_navigation");
    }, [pauseCamera]);

    async function handlePermission() {
        try {
            const response = await requestPermission();
            console.log("Permission response:", response);
            if(!response.canAskAgain) {
                Alert.alert(
                    '權限請求失敗',
                    '請手動至設定開啟本軟體之相機權限',
                    [{text: '確定前往', onPress: async () => await Linking.openSettings()}]
                )
            }
        }
        catch (error) {
            console.log("Error requesting permission:", error);
        }
    }

    /* Autofocus seems already fixed in Expo SDK 54?
        useEffect(() => {
            const interval = setInterval(() => {
                if(permission?.granted && isCameraActive){
                    if (customAutoFocus) {
                        setCustomAutoFocus(false)
                    } else {
                        setCustomAutoFocus(true)
                    }
                }
            }, 800);
            return () => clearInterval(interval);
        });
    */

    useFocusEffect(
        useCallback(() => {
            const shouldReopenSearch = reopenSearchOnFocusRef.current;

            console.log("Reopen search on focus:", shouldReopenSearch)
            scannerFocusedRef.current = true;
            setIsScannerFocused(true);
            setModalVisible(shouldReopenSearch)
            if (shouldReopenSearch) {
                pauseCamera("scanner_focus_reopen_search");
            } else {
                queueCameraActivation("scanner_focus");
            }
            setScanned("")

            return () => {
                searchOpenRequestIdRef.current += 1;
                cancelPendingCameraPause();
                cancelPendingCameraResume();
                clearCameraIdleTimer();
                idleAlertVisibleRef.current = false;
                scannerFocusedRef.current = false;
                setIsScannerFocused(false);
                setModalVisible(false)
                setIsCameraActive(false);
                setIsCameraLoading(false);
            };
        }, [pauseCamera, queueCameraActivation])
    );

    useEffect(() => {
        const handleAppStateChange = (nextState: AppStateStatus) => {
            const wasActive = appStateRef.current === "active";
            const isNowActive = nextState === "active";

            appStateRef.current = nextState;
            setIsAppActive(isNowActive);

            if (!isNowActive) {
                idleAlertVisibleRef.current = false;
                clearCameraIdleTimer();
                cancelPendingCameraPause();
                cancelPendingCameraResume();
                if (scannerFocusedRef.current) {
                    pauseCamera("app_state_not_active");
                }
                return;
            }

            if (!wasActive && scannerFocusedRef.current && !modalVisible) {
                queueCameraActivation("app_state_active");
            }
        };

        const subscription = AppState.addEventListener("change", handleAppStateChange);

        return () => subscription.remove();
    }, [modalVisible, pauseCamera, queueCameraActivation]);

    useEffect(() => {
        return () => {
            searchOpenRequestIdRef.current += 1;
            cancelPendingCameraPause();
            cancelPendingCameraResume();
            clearCameraIdleTimer();
        };
    }, []);

    const shouldMountCamera = !!permission?.granted && isAppActive && isScannerFocused && !modalVisible && isCameraActive;
    const effectiveSelectedLens = SCANNER_CAMERA_DEBUG_CONTROLS && debugSelectedLens !== AUTO_CAMERA_LENS
        ? debugSelectedLens
        : autoSelectedLens;
    const effectiveCameraZoom = SCANNER_CAMERA_DEBUG_CONTROLS ? debugZoom : scannerZoom;
    const debugZoomRatio = (debugZoom - SCANNER_CAMERA_DEBUG_MIN_ZOOM) / (SCANNER_CAMERA_DEBUG_MAX_ZOOM - SCANNER_CAMERA_DEBUG_MIN_ZOOM);

    const updateDebugZoomFromLocation = useCallback((event: GestureResponderEvent) => {
        if (!debugZoomTrackWidth) return;

        const ratio = Math.min(1, Math.max(0, event.nativeEvent.locationX / debugZoomTrackWidth));
        const nextZoom = SCANNER_CAMERA_DEBUG_MIN_ZOOM + ratio * (SCANNER_CAMERA_DEBUG_MAX_ZOOM - SCANNER_CAMERA_DEBUG_MIN_ZOOM);
        setDebugZoom(clampCameraZoom(nextZoom));
    }, [debugZoomTrackWidth]);

    const debugZoomPanResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => SCANNER_CAMERA_DEBUG_CONTROLS,
        onMoveShouldSetPanResponder: () => SCANNER_CAMERA_DEBUG_CONTROLS,
        onPanResponderGrant: (event) => {
            debugZoomDragStartRef.current = debugZoom;
            updateDebugZoomFromLocation(event);
        },
        onPanResponderMove: (_, gestureState) => {
            if (!debugZoomTrackWidth) return;

            const zoomRange = SCANNER_CAMERA_DEBUG_MAX_ZOOM - SCANNER_CAMERA_DEBUG_MIN_ZOOM;
            const nextZoom = debugZoomDragStartRef.current + (gestureState.dx / debugZoomTrackWidth) * zoomRange;
            setDebugZoom(clampCameraZoom(nextZoom));
        },
    }), [debugZoom, debugZoomTrackWidth, updateDebugZoomFromLocation]);

    useEffect(() => {
        if (shouldMountCamera) {
            setIsCameraLoading(true);
        } else {
            cameraReadyRetryCountRef.current = 0;
            setIsCameraLoading(false);
            setTorchEnabled(false);
        }
    }, [cameraSessionKey, shouldMountCamera]);

    useEffect(() => {
        if (!shouldMountCamera || !isCameraLoading) return;

        const timer = setTimeout(() => {
            if (cameraReadyRetryCountRef.current >= CAMERA_READY_MAX_RETRIES) {
                return;
            }

            cameraReadyRetryCountRef.current += 1;
            setCameraSessionKey((key) => key + 1);
        }, CAMERA_READY_RETRY_MS);

        return () => clearTimeout(timer);
    }, [cameraSessionKey, isCameraLoading, shouldMountCamera]);

    useEffect(() => {
        resetCameraIdleTimer();
        return clearCameraIdleTimer;
    }, [resetCameraIdleTimer]);

    const {showSpinner, hideSpinner} = useSpinner()

    // on barcode scanned logic
    useEffect(() => {
        (async () => {
            if (scanned)
            {
                router.navigate({ pathname: "/stacks/details", params: { barcode: scanned }});
            }
        })()
    }, [scanned]);

    const navigate = useCallback((isbn: string) => {
        clearCameraIdleTimer();
        setScanned(isbn)
    }, []);

    const resolvePreferredBackLens = useCallback((lenses: string[]) => {
        console.log("Available Lenses: ", lenses)
        if (!lenses.length) return undefined;
        if (lenses.length === 1) return lenses[0];

        const exactBackCamera = lenses.find((lens) => lens === "Back Camera");
        if (exactBackCamera) return exactBackCamera;

        const normalized = lenses.map((lens) => ({
            original: lens,
            lower: lens.toLowerCase(),
        }));

        const isUltraWide = (name: string) =>
            name.includes("ultra") || name.includes("0.5") || name.includes("超廣角");

        const isTelephoto = (name: string) =>
            name.includes("tele") || name.includes("長焦") || name.includes("望遠") || name.includes("2x") || name.includes("3x") || name.includes("5x");

        const preferred = normalized.find(({lower, original}) => {
            return !isUltraWide(lower) && !isUltraWide(original) && !isTelephoto(lower) && !isTelephoto(original);
        });

        return preferred?.original;
    }, []);

    const handleAvailableLensesChanged = useCallback((lenses: string[]) => {
        setAvailableLenses(lenses);
        const preferredLens = resolvePreferredBackLens(lenses);
        setAutoSelectedLens(preferredLens);
        selectedLensRef.current = SCANNER_CAMERA_DEBUG_CONTROLS && debugSelectedLens !== AUTO_CAMERA_LENS
            ? debugSelectedLens
            : preferredLens;
        if (debugSelectedLens !== AUTO_CAMERA_LENS && !lenses.includes(debugSelectedLens)) {
            setDebugSelectedLens(AUTO_CAMERA_LENS);
        }
    }, [debugSelectedLens, resolvePreferredBackLens]);

    useEffect(() => {
        selectedLensRef.current = effectiveSelectedLens;
    }, [effectiveCameraZoom, effectiveSelectedLens]);

    const handleCameraReady = useCallback(() => {
        cameraReadyRetryCountRef.current = 0;
        setIsCameraLoading(false);
    }, [effectiveCameraZoom]);

    useEffect(() => {
        if (!permission || (permission?.granted && isCameraLoading)) {
            // Camera permissions are still loading,
            // or permission granted but camera still loading.
            showSpinner();
        } else {
            hideSpinner();
        }
    }, [permission, isCameraLoading]);

    useEffect(() => {
        if (!permission || permission.granted) return;

        const logKey = `${permission.status}:${permission.canAskAgain}`;
        if (permissionMissingLogKeyRef.current === logKey) return;

        permissionMissingLogKeyRef.current = logKey;
    }, [permission]);

    const searchButton = useMemo(() => (
        <Button bg="orange400" m="lg" rounded={15} block={true} fontSize="xl" fontWeight="bold" textAlignVertical="bottom"
                                  suffix={<Icon mx="sm" name="search" color="white" fontFamily="FontAwesome" />}
                                  onPress={openSearchModal}
        >
            無法掃描？嘗試手動搜尋
        </Button>
    ), [openSearchModal]);

    const modalComp = useMemo(() => (<SearchModal
        visible={modalVisible}
        onClose={closeSearchModal}
        onNavigate={handleSearchNavigation}
    ></SearchModal>), [closeSearchModal, handleSearchNavigation, modalVisible])

    if (!!permission && !permission.granted) {
        console.log("Permission", permission);
        // Camera permissions are not granted yet.
        return (
            <View style={[styles.container, {marginTop: insets.top}]}>
                <Text style={styles.message} fontWeight="bold" fontSize="xl">尚未取得相機權限！</Text>
                <Button block={true} rounded="circle" fontWeight="bold" mx="xl" mb="lg"
                        onPress={handlePermission} fontSize="lg" bg="purple500"
                        prefix={<Icon mx="sm" name="camera" color="white" fontFamily="FontAwesome" />}
                >
                    請求相機權限
                </Button>
                {searchButton}
                {modalComp}
            </View>
        );
    }

    return (
        <View style={[styles.container, {marginTop: insets.top}]}>
            <Text style={{fontSize: 20, fontWeight: "bold", paddingBottom: 20}}>請掃描財產標籤上的條碼</Text>
            <View style={styles.cameraFrame}>
                {shouldMountCamera ? (
                    <ScannerCamera
                        sessionKey={cameraSessionKey}
                        customAutoFocus={customAutoFocus}
                        selectedLens={effectiveSelectedLens}
                        zoom={effectiveCameraZoom}
                        enableTorch={torchEnabled}
                        onAvailableLensesChanged={handleAvailableLensesChanged}
                        onBarcodeScanned={navigate}
                        onReady={handleCameraReady}
                    />
                ) : (
                    <View style={styles.cameraPlaceholder} />
                )}
                {shouldMountCamera && !isCameraLoading && (
                    <View style={styles.scanGuideOverlay} pointerEvents="none">
                        <View style={styles.scanGuideBox}>
                            <View style={[styles.scanGuideCorner, styles.scanGuideCornerTopLeft]} />
                            <View style={[styles.scanGuideCorner, styles.scanGuideCornerTopRight]} />
                            <View style={[styles.scanGuideCorner, styles.scanGuideCornerBottomLeft]} />
                            <View style={[styles.scanGuideCorner, styles.scanGuideCornerBottomRight]} />
                        </View>
                        {/*<Text mt="sm" color="white" fontSize="sm" fontWeight="bold" textAlign="center">*/}
                        {/*    將 Code39 條碼橫向放滿框線*/}
                        {/*</Text>*/}
                    </View>
                )}
                {shouldMountCamera && isCameraLoading && (
                    <View style={styles.cameraLoadingOverlay} pointerEvents="none">
                        <ActivityIndicator color="white" size="large" />
                        <Text mt="sm" color="white" fontSize="md" fontWeight="bold">
                            相機啟動中
                        </Text>
                    </View>
                )}
                {isScannerFocused && !modalVisible && !isCameraActive && !isCameraLoading && (
                    <TouchableOpacity
                        style={styles.cameraSleepOverlay}
                        activeOpacity={0.85}
                        onPress={() => activateCamera("sleep_overlay_pressed")}
                    >
                        <Icon name="camera-off" color="white" fontSize={36} fontFamily="Feather" />
                        <Text mt="md" color="white" fontSize="lg" fontWeight="bold">
                            相機休眠中
                        </Text>
                        <Text mt="xs" color="gray300" fontSize="sm">
                            點一下啟動相機
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
            <View style={styles.scannerControlPanel}>
                <TouchableOpacity
                    activeOpacity={0.82}
                    disabled={!shouldMountCamera}
                    style={[
                        styles.torchButton,
                        torchEnabled && styles.torchButtonActive,
                        !shouldMountCamera && styles.scannerControlDisabled,
                    ]}
                    onPress={() => setTorchEnabled((enabled) => !enabled)}
                >
                    <Icon
                        name={torchEnabled ? "flashlight-off" : "flashlight"}
                        fontFamily="MaterialCommunityIcons"
                        fontSize={20}
                        color={torchEnabled ? "#92400E" : "#1F2937"}
                        mr="xs"
                    />
                    <Text fontSize="sm" fontWeight="bold" color={torchEnabled ? "#92400E" : "#1F2937"}>
                        {torchEnabled ? "關閉" : "開啟"}{"手電筒"}
                    </Text>
                </TouchableOpacity>
                <View style={styles.zoomPresetRow}>
                    {SCANNER_CAMERA_ZOOM_PRESETS.map((preset) => {
                        const selected = Math.abs(scannerZoom - preset.value) < 0.001;

                        return (
                            <TouchableOpacity
                                key={preset.label}
                                activeOpacity={0.82}
                                style={[styles.zoomPresetChip, selected && styles.zoomPresetChipSelected]}
                                onPress={() => setScannerZoom(preset.value)}
                            >
                                <Text fontSize="sm" fontWeight="bold" color={selected ? "white" : "gray800"}>
                                    {preset.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                {/*<Text mt={6} color="gray600" fontSize="xs" textAlign="center">*/}
                {/*    目前縮放：{effectiveCameraZoom.toFixed(2)}*/}
                {/*</Text>*/}
            </View>
            {SCANNER_CAMERA_DEBUG_CONTROLS && (
                <View style={styles.debugPanel}>
                    <Text fontSize="sm" fontWeight="bold">Camera Debug</Text>
                    <Text mt="xs" fontSize="xs" color="gray600">
                        Applied: {effectiveSelectedLens ?? "system default"} / zoom {effectiveCameraZoom.toFixed(2)}
                    </Text>
                    <Text mt="sm" fontSize="xs" fontWeight="bold" color="gray700">Lens</Text>
                    <View style={styles.debugRow}>
                        {[AUTO_CAMERA_LENS, ...availableLenses].map((lens) => {
                            const label = lens === AUTO_CAMERA_LENS ? `Auto (${autoSelectedLens ?? "default"})` : lens;
                            const selected = debugSelectedLens === lens;
                            return (
                                <TouchableOpacity
                                    key={lens}
                                    style={[styles.debugChip, selected && styles.debugChipSelected]}
                                    activeOpacity={0.8}
                                    onPress={() => setDebugSelectedLens(lens)}
                                >
                                    <Text fontSize="xs" color={selected ? "white" : "gray800"}>
                                        {label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <Text mt="sm" fontSize="xs" fontWeight="bold" color="gray700">Zoom</Text>
                    <View
                        style={styles.debugZoomSlider}
                        onLayout={(event) => setDebugZoomTrackWidth(event.nativeEvent.layout.width)}
                        {...debugZoomPanResponder.panHandlers}
                    >
                        <View style={styles.debugZoomTrack} pointerEvents="none" />
                        <View style={[styles.debugZoomTrackFill, {width: `${debugZoomRatio * 100}%`}]} pointerEvents="none" />
                        <View style={[styles.debugZoomThumb, {left: `${debugZoomRatio * 100}%`}]} pointerEvents="none" />
                    </View>
                    <View style={styles.debugZoomScale}>
                        <Text fontSize="xs" color="gray600">{SCANNER_CAMERA_DEBUG_MIN_ZOOM.toFixed(2)}</Text>
                        <Text fontSize="xs" color="gray600">{SCANNER_CAMERA_DEBUG_MAX_ZOOM.toFixed(2)}</Text>
                    </View>
                    <View style={styles.debugRow}>
                        {SCANNER_CAMERA_DEBUG_ZOOM_OPTIONS.map((option) => {
                            const selected = debugZoom === option.value;
                            return (
                                <TouchableOpacity
                                    key={option.label}
                                    style={[styles.debugChip, selected && styles.debugChipSelected]}
                                    activeOpacity={0.8}
                                    onPress={() => setDebugZoom(option.value)}
                                >
                                    <Text fontSize="xs" color={selected ? "white" : "gray800"}>
                                        {option.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            )}
            {searchButton}
            {modalComp}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: "center",
        padding: 30
    },
    message: {
        textAlign: 'center',
        paddingBottom: 10,
    },
    camera: {
        width: "100%",
        height: "100%",
        borderStyle: "solid",
        borderColor: "black",
        borderRadius: 15,
        backgroundColor: "#111827",
        overflow: "hidden"
    },
    cameraFrame: {
        width: "92%",
        height: 190,
        borderRadius: 15,
        backgroundColor: "#111827",
        overflow: "hidden",
    },
    cameraPlaceholder: {
        width: "100%",
        height: "100%",
        borderStyle: "solid",
        borderColor: "black",
        borderRadius: 15,
        backgroundColor: "#111827",
    },
    cameraLoadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#111827",
        borderRadius: 15,
    },
    cameraSleepOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(17, 24, 39, 0.88)",
        borderRadius: 15,
    },
    scanGuideOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
        backgroundColor: "rgba(0, 0, 0, 0.08)",
    },
    scanGuideBox: {
        width: "100%",
        height: 125,
        position: "relative",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.38)",
        backgroundColor: "rgba(255, 255, 255, 0.04)",
    },
    scanGuideCorner: {
        position: "absolute",
        width: 24,
        height: 24,
        borderColor: "#FBBF24",
    },
    scanGuideCornerTopLeft: {
        top: -1,
        left: -1,
        borderTopWidth: 4,
        borderLeftWidth: 4,
        borderTopLeftRadius: 12,
    },
    scanGuideCornerTopRight: {
        top: -1,
        right: -1,
        borderTopWidth: 4,
        borderRightWidth: 4,
        borderTopRightRadius: 12,
    },
    scanGuideCornerBottomLeft: {
        bottom: -1,
        left: -1,
        borderBottomWidth: 4,
        borderLeftWidth: 4,
        borderBottomLeftRadius: 12,
    },
    scanGuideCornerBottomRight: {
        right: -1,
        bottom: -1,
        borderRightWidth: 4,
        borderBottomWidth: 4,
        borderBottomRightRadius: 12,
    },
    scannerControlPanel: {
        width: "92%",
        marginTop: 12,
        padding: 10,
        borderRadius: 16,
        backgroundColor: "#F3F4F6",
    },
    torchButton: {
        minHeight: 42,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#D1D5DB",
        backgroundColor: "white",
    },
    torchButtonActive: {
        borderColor: "#FBBF24",
        backgroundColor: "#FEF3C7",
    },
    scannerControlDisabled: {
        opacity: 0.45,
    },
    zoomPresetRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 10,
    },
    zoomPresetChip: {
        flex: 1,
        minHeight: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#D1D5DB",
        backgroundColor: "white",
    },
    zoomPresetChipSelected: {
        borderColor: "#2563EB",
        backgroundColor: "#2563EB",
    },
    debugPanel: {
        width: "100%",
        marginTop: 12,
        padding: 10,
        borderRadius: 8,
        backgroundColor: "#F3F4F6",
    },
    debugRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 8,
    },
    debugChip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#D1D5DB",
        backgroundColor: "white",
    },
    debugChipSelected: {
        borderColor: "#4F46E5",
        backgroundColor: "#4F46E5",
    },
    debugZoomSlider: {
        width: "100%",
        height: 32,
        justifyContent: "center",
        marginTop: 8,
    },
    debugZoomTrack: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#D1D5DB",
    },
    debugZoomTrackFill: {
        position: "absolute",
        left: 0,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#4F46E5",
    },
    debugZoomThumb: {
        position: "absolute",
        width: 18,
        height: 18,
        marginLeft: -9,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: "white",
        backgroundColor: "#4F46E5",
    },
    debugZoomScale: {
        flexDirection: "row",
        justifyContent: "space-between",
    },
    text: {
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
    },
});
