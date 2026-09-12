import {
    View,
    StyleSheet,
    Alert,
    Linking,
    TouchableOpacity,
    ActivityIndicator,
    AppState,
    type AppStateStatus,
} from "react-native";
import {CameraView, useCameraPermissions, type BarcodeType} from "expo-camera";
import {router, type Href, useFocusEffect} from "expo-router";
import {memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType} from "react";
import {Text, Button, Icon, Div} from "react-native-magnus";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import SearchModal from "@/components/SearchModal";
import PropertyYearDropdown from "@/components/PropertyYearDropdown";
import {usePropertyYear} from "@/context/PropertyYearContext";
import {getPropertyItemsByBarcode, getPropertyItemsByBarcodeMatch} from "@/handlers/propertyList";
import {
    comparePropertyYearsDescending,
    itemExistsInPropertyYear,
    propertyYearToWesternNumber,
} from "@/handlers/propertyYears";
import {
    getDefaultScannerSettings,
    getExpoCameraBarcodeTypes,
    getStoredScannerSettings,
    getVisionCameraBarcodeFormats,
    resolveScannerProvider,
    type ScannerProvider,
    type ScannerSettings,
    type VisionCameraBarcodeFormat,
} from "@/handlers/scannerSettings";

type ClipboardModule = {
    setStringAsync: (text: string) => Promise<boolean>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Clipboard = require("expo-clipboard") as ClipboardModule;

const CAMERA_IDLE_TIMEOUT_MS = 60 * 1000;
const CAMERA_LOADING_TIMEOUT_MS = 10 * 1000;
const CAMERA_REVEAL_DELAY_MS = 300;
const SCAN_CONFIRMATION_WINDOW_MS = 1800;
type ScannerZoomPresetId = "wide" | "standard" | "closer" | "maximum";
const SCANNER_CAMERA_ZOOM_PRESETS = [
    {id: "wide", label: "較廣", expoZoom: 0.08, visionZoom: 1},
    {id: "standard", label: "標準", expoZoom: 0.16, visionZoom: 1.25},
    {id: "closer", label: "放大", expoZoom: 0.24, visionZoom: 1.75},
    {id: "maximum", label: "最大", expoZoom: 0.32, visionZoom: 2.5},
] as const satisfies readonly {
    id: ScannerZoomPresetId;
    label: string;
    expoZoom: number;
    visionZoom: number;
}[];
const absoluteFill = {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

type ScannerBarcodeScan = {
    value: string;
    format?: string;
};

type ScanConfirmationState = {
    count: number;
    firstSeenAt: number;
    lastSeenAt: number;
};

function getItemSourceYears(items: Awaited<ReturnType<typeof getPropertyItemsByBarcode>>): string[] {
    return [...new Set(items.flatMap((item) => item.sourceYears))].sort(comparePropertyYearsDescending);
}

function normalizeScannedBarcodeValue(value: string): string {
    return value.trim();
}

function isSingleHitBarcodeFormat(format: string | undefined): boolean {
    return format === "qr"
        || format === "qr-code"
        || format === "aztec"
        || format === "datamatrix"
        || format === "data-matrix"
        || format === "pdf417"
        || format === "pdf-417";
}

function getScanConfirmationPolicy(provider: ScannerProvider, format: string | undefined): {requiredCount: number; requiredSpanMs: number} {
    if (isSingleHitBarcodeFormat(format)) {
        return {requiredCount: 1, requiredSpanMs: 0};
    }

    return provider === "vision-camera"
        ? {requiredCount: 3, requiredSpanMs: 220}
        : {requiredCount: 2, requiredSpanMs: 120};
}

function showCameraErrorAlert(title: string, error: unknown) {
    const fullError = error instanceof Error && error.stack ? error.stack : String(error);
    const errorSummary = fullError.split(/\r?\n/).slice(0, 2).join("\n");

    void Clipboard.setStringAsync(fullError)
        .then(() => Alert.alert(`${title}（完整錯誤已複製）`, errorSummary))
        .catch((clipboardError) => {
            console.error("複製相機錯誤失敗:", clipboardError);
            Alert.alert(title, errorSummary);
        });
}

function ScannerTitle() {
    return (
        <View style={styles.scannerTitleRow}>
            <Text numberOfLines={1} style={styles.scannerTitle}>請掃描財產標籤上的條碼</Text>
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="開啟相機設定"
                activeOpacity={0.72}
                hitSlop={{top: 8, right: 8, bottom: 8, left: 8}}
                style={styles.cameraSettingsButton}
                onPress={() => router.push("/stacks/camera_settings" as Href)}
            >
                <Icon name="settings" fontFamily="Feather" fontSize={17} color="#4B5563" />
            </TouchableOpacity>
        </View>
    );
}

type ScannerCameraProps = {
    barcodeTypes: BarcodeType[];
    zoom: number;
    enableTorch: boolean;
    onBarcodeScanned: (scan: ScannerBarcodeScan) => void;
    onError: (error: Error) => void;
    onReady: () => void;
};

const ScannerCamera = memo(function ScannerCamera({
    barcodeTypes,
    zoom,
    enableTorch,
    onBarcodeScanned,
    onError,
    onReady,
}: ScannerCameraProps) {
    const [isReady, setIsReady] = useState(false);
    const handleReady = useCallback(() => {
        setIsReady(true);
        onReady();
    }, [onReady]);

    return (
        <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{
                barcodeTypes,
            }}
            onBarcodeScanned={isReady
                ? (scanningResult) => onBarcodeScanned({
                    value: scanningResult.raw ?? scanningResult.data,
                    format: scanningResult.type,
                })
                : undefined}
            zoom={zoom}
            enableTorch={isReady && enableTorch}
            autofocus="off"
            onCameraReady={handleReady}
            onMountError={({message}) => onError(new Error(message))}
        />
    );
});

type VisionCameraScannerProps = {
    active: boolean;
    barcodeFormats: VisionCameraBarcodeFormat[];
    enableTorch: boolean;
    zoom: number;
    onBarcodeScanned: (scan: ScannerBarcodeScan) => void;
    onError: (error: Error) => void;
    onReady: () => void;
};

let visionCameraModulePromise: Promise<{default: ComponentType<VisionCameraScannerProps>}> | null = null;

function loadVisionCameraScanner() {
    visionCameraModulePromise ??= import("@/components/scanner/VisionCameraScanner")
        .catch((error: unknown) => {
            visionCameraModulePromise = null;
            throw error;
        });
    return visionCameraModulePromise;
}

function VisionCameraScannerSlot(props: VisionCameraScannerProps) {
    const [ScannerComponent, setScannerComponent] = useState<ComponentType<VisionCameraScannerProps> | null>(null);
    const {onError} = props;

    useEffect(() => {
        let active = true;
        void loadVisionCameraScanner()
            .then(({default: component}) => {
                if (active) setScannerComponent(() => component);
            })
            .catch((error: unknown) => {
                if (active) onError(error instanceof Error ? error : new Error(String(error)));
            });

        return () => {
            active = false;
        };
    }, [onError]);

    return ScannerComponent ? <ScannerComponent {...props} /> : null;
}

export default function Scanner() {
    const [permission, requestPermission] = useCameraPermissions();
    const [scannerSettings, setScannerSettings] = useState<ScannerSettings>(getDefaultScannerSettings);
    const [scannerSettingsLoading, setScannerSettingsLoading] = useState(true);
    const [runtimeProviderOverride, setRuntimeProviderOverride] = useState<ScannerProvider | null>(null);
    const [isScannerFocused, setIsScannerFocused] = useState(false);
    const [isAppActive, setIsAppActive] = useState(AppState.currentState === "active");
    const [isCameraActive, setIsCameraActive] = useState(true);
    const [isCameraLoading, setIsCameraLoading] = useState(true);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [scannerZoomPreset, setScannerZoomPreset] = useState<ScannerZoomPresetId>("standard");
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const {availableYears, selectedYear, loading: yearsLoading, refreshYears} = usePropertyYear();
    const reopenSearchOnFocusRef = useRef(false);
    const searchOpenRequestIdRef = useRef(0);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cameraRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scanConfirmationRef = useRef<Map<string, ScanConfirmationState>>(new Map());
    const cameraReadyReportedRef = useRef(false);
    const idleAlertVisibleRef = useRef(false);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const scannerFocusedRef = useRef(false);
    const barcodeScanHandlingRef = useRef(false);
    const visionFallbackShownRef = useRef(false);
    const expoCameraErrorShownRef = useRef(false);
    const insets = useSafeAreaInsets()
    const hasImportedPropertyYears = availableYears.length > 0;
    const configuredProvider = resolveScannerProvider(scannerSettings.provider);
    const activeProvider = runtimeProviderOverride ?? configuredProvider;
    const usesExpoCamera = activeProvider === "expo-camera";
    const activeZoomPreset = SCANNER_CAMERA_ZOOM_PRESETS.find(({id}) => id === scannerZoomPreset)
        ?? SCANNER_CAMERA_ZOOM_PRESETS[1];
    const expoCameraBarcodeTypes = useMemo(
        () => getExpoCameraBarcodeTypes(scannerSettings.enabledFormats),
        [scannerSettings.enabledFormats],
    );
    const visionCameraBarcodeFormats = useMemo(
        () => getVisionCameraBarcodeFormats(scannerSettings.enabledFormats),
        [scannerSettings.enabledFormats],
    );

    const clearCameraIdleTimer = useCallback(() => {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    const clearCameraRevealTimer = useCallback(() => {
        if (cameraRevealTimerRef.current) {
            clearTimeout(cameraRevealTimerRef.current);
            cameraRevealTimerRef.current = null;
        }
    }, []);

    const resetScanConfirmation = useCallback(() => {
        scanConfirmationRef.current.clear();
    }, []);

    const confirmScanCandidate = useCallback((scan: ScannerBarcodeScan): string | null => {
        const value = normalizeScannedBarcodeValue(scan.value);
        if (!value) return null;

        const now = Date.now();
        const confirmation = scanConfirmationRef.current;
        for (const [candidateValue, state] of confirmation) {
            if (now - state.lastSeenAt > SCAN_CONFIRMATION_WINDOW_MS) {
                confirmation.delete(candidateValue);
            }
        }

        const previousState = confirmation.get(value);
        const nextState: ScanConfirmationState = previousState
            ? {
                count: previousState.count + 1,
                firstSeenAt: previousState.firstSeenAt,
                lastSeenAt: now,
            }
            : {
                count: 1,
                firstSeenAt: now,
                lastSeenAt: now,
            };
        confirmation.set(value, nextState);

        const policy = getScanConfirmationPolicy(activeProvider, scan.format);
        if (nextState.count < policy.requiredCount) return null;
        if (now - nextState.firstSeenAt < policy.requiredSpanMs) return null;

        confirmation.clear();
        return value;
    }, [activeProvider]);

    const pauseCamera = useCallback(() => {
        clearCameraIdleTimer();
        clearCameraRevealTimer();
        resetScanConfirmation();
        cameraReadyReportedRef.current = false;
        setIsCameraReady(false);
        setIsCameraActive(false);
        setIsCameraLoading(false);
        setTorchEnabled(false);
    }, [clearCameraIdleTimer, clearCameraRevealTimer, resetScanConfirmation]);

    const activateCamera = useCallback(() => {
        clearCameraIdleTimer();
        clearCameraRevealTimer();
        resetScanConfirmation();
        cameraReadyReportedRef.current = false;
        idleAlertVisibleRef.current = false;
        setIsCameraReady(false);
        setIsCameraLoading(true);
        setTorchEnabled(false);
        setIsCameraActive(true);
    }, [clearCameraIdleTimer, clearCameraRevealTimer, resetScanConfirmation]);

    const resetCameraIdleTimer = useCallback(() => {
        clearCameraIdleTimer();
        if (
            yearsLoading ||
            !hasImportedPropertyYears ||
            !isAppActive ||
            !isScannerFocused ||
            !isCameraActive ||
            modalVisible ||
            !permission?.granted
        ) return;

        idleTimerRef.current = setTimeout(() => {
            if (idleAlertVisibleRef.current) return;

            if (appStateRef.current !== "active" || !scannerFocusedRef.current) {
                pauseCamera();
                return;
            }

            idleAlertVisibleRef.current = true;
            pauseCamera();
            Alert.alert(
                "相機已休眠",
                "已經一段時間沒有使用\n已先暫停相機",
                [
                    {
                        text: "開啟相機",
                        style: "cancel",
                        onPress: () => {
                            idleAlertVisibleRef.current = false;
                            activateCamera();
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
    }, [activateCamera, clearCameraIdleTimer, hasImportedPropertyYears, isAppActive, isCameraActive, isScannerFocused, modalVisible, pauseCamera, permission?.granted, yearsLoading]);

    const openSearchModal = useCallback(() => {
        reopenSearchOnFocusRef.current = false;
        searchOpenRequestIdRef.current += 1;
        const requestId = searchOpenRequestIdRef.current;
        setModalVisible(false);
        pauseCamera();
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
        setModalVisible(false);
        activateCamera();
    }, [activateCamera]);

    const pauseForYearSelection = useCallback(() => {
        pauseCamera();
    }, [pauseCamera]);

    const resumeAfterYearSelection = useCallback(() => {
        if (scannerFocusedRef.current && !modalVisible) {
            activateCamera();
        }
    }, [activateCamera, modalVisible]);

    const handleSearchNavigation = useCallback((shouldReopenOnReturn: boolean) => {
        reopenSearchOnFocusRef.current = shouldReopenOnReturn;
        searchOpenRequestIdRef.current += 1;
        setModalVisible(false);
        pauseCamera();
    }, [pauseCamera]);

    async function handlePermission() {
        try {
            const response = await requestPermission();
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

    useFocusEffect(
        useCallback(() => {
            let focusActive = true;
            const shouldReopenSearch = reopenSearchOnFocusRef.current;

            scannerFocusedRef.current = true;
            visionFallbackShownRef.current = false;
            expoCameraErrorShownRef.current = false;
            setIsCameraReady(false);
            setIsScannerFocused(true);
            void refreshYears();
            setScannerSettingsLoading(true);
            setRuntimeProviderOverride(null);
            void getStoredScannerSettings()
                .then((storedSettings) => {
                    if (focusActive) setScannerSettings(storedSettings);
                })
                .catch((error) => console.error("讀取掃描設定失敗:", error))
                .finally(() => {
                    if (focusActive) setScannerSettingsLoading(false);
                });
            setModalVisible(shouldReopenSearch)
            if (shouldReopenSearch) {
                pauseCamera();
            } else {
                activateCamera();
            }
            resetScanConfirmation();

            return () => {
                focusActive = false;
                searchOpenRequestIdRef.current += 1;
                clearCameraIdleTimer();
                clearCameraRevealTimer();
                idleAlertVisibleRef.current = false;
                scannerFocusedRef.current = false;
                setIsScannerFocused(false);
                setModalVisible(false)
                setIsCameraReady(false);
                setIsCameraActive(false);
                setIsCameraLoading(false);
                setTorchEnabled(false);
                resetScanConfirmation();
            };
        }, [activateCamera, clearCameraIdleTimer, clearCameraRevealTimer, pauseCamera, refreshYears, resetScanConfirmation])
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
                if (scannerFocusedRef.current) {
                    pauseCamera();
                }
                return;
            }

            if (!wasActive && scannerFocusedRef.current && !modalVisible) {
                activateCamera();
            }
        };

        const subscription = AppState.addEventListener("change", handleAppStateChange);

        return () => subscription.remove();
    }, [activateCamera, clearCameraIdleTimer, modalVisible, pauseCamera]);

    useEffect(() => {
        return () => {
            searchOpenRequestIdRef.current += 1;
            clearCameraIdleTimer();
            clearCameraRevealTimer();
        };
    }, [clearCameraIdleTimer, clearCameraRevealTimer]);

    const shouldMountCamera = !scannerSettingsLoading && !!permission?.granted && hasImportedPropertyYears && !yearsLoading && isAppActive && isScannerFocused && !modalVisible && isCameraActive;

    useEffect(() => {
        if (!shouldMountCamera || !isCameraLoading) return;

        const timer = setTimeout(() => {
            if (cameraReadyReportedRef.current) return;

            setIsCameraLoading(false);
            Alert.alert(
                "相機啟動逾時",
                `${usesExpoCamera ? "Expo Camera" : "Vision Camera"} 未在 ${CAMERA_LOADING_TIMEOUT_MS / 1000} 秒內回報預覽已啟動。`,
            );
        }, CAMERA_LOADING_TIMEOUT_MS);

        return () => clearTimeout(timer);
    }, [isCameraLoading, shouldMountCamera, usesExpoCamera]);

    useEffect(() => {
        resetCameraIdleTimer();
        return clearCameraIdleTimer;
    }, [clearCameraIdleTimer, resetCameraIdleTimer]);

    const openScannedDetails = useCallback((barcode: string) => {
        router.navigate({
            pathname: "/stacks/details",
            params: selectedYear
                ? {barcode, year: selectedYear}
                : {barcode},
        });
    }, [selectedYear]);

    const navigate = useCallback((scan: ScannerBarcodeScan) => {
        if (barcodeScanHandlingRef.current) return;

        const isbn = confirmScanCandidate(scan);
        if (!isbn) return;

        barcodeScanHandlingRef.current = true;
        clearCameraIdleTimer();

        void (async () => {
            let shouldReleaseScanner = true;

            try {
                const propertyMatch = await getPropertyItemsByBarcodeMatch(isbn);
                const navigationBarcode = propertyMatch?.barcode ?? isbn;

                if (selectedYear) {
                    const scannedItems = propertyMatch?.items ?? [];
                    const sourceYears = getItemSourceYears(scannedItems);
                    const existsInSelectedYear = sourceYears.length === 0
                        || itemExistsInPropertyYear(sourceYears, selectedYear);

                    if (!existsInSelectedYear) {
                        const selectedWesternYear = propertyYearToWesternNumber(selectedYear);
                        const sourceWesternYears = sourceYears
                            .map(propertyYearToWesternNumber)
                            .filter((year): year is number => year !== null);
                        const sourceYearText = sourceYears.length > 0 ? sourceYears.join("、") : "其他";
                        const releaseScanner = () => {
                            barcodeScanHandlingRef.current = false;
                        };

                        shouldReleaseScanner = false;
                        openScannedDetails(navigationBarcode);
                        if (selectedWesternYear !== null && sourceWesternYears.some((year) => year > selectedWesternYear)) {
                            Alert.alert(
                                "不屬於目前盤點年度",
                                `目前正在盤點 ${selectedYear} 年度。\n此財產可能於 ${sourceYearText} 年新增。\n\n僅顯示該年度的盤點狀態。`,
                                [{text: "知道了", onPress: releaseScanner}],
                                {cancelable: true, onDismiss: releaseScanner},
                            );
                            return;
                        }

                        Alert.alert(
                            "不屬於目前盤點年度",
                            `目前正在盤點 ${selectedYear} 年度。\n此財產可能已於 ${sourceYearText} 年報廢。\n\n僅顯示該年度的盤點狀態。`,
                            [{text: "知道了", onPress: releaseScanner}],
                            {cancelable: true, onDismiss: releaseScanner},
                        );
                        return;
                    }
                }

                openScannedDetails(navigationBarcode);
            } catch (error) {
                console.error("檢查掃描財產年度失敗:", error);
                openScannedDetails(isbn);
            } finally {
                if (shouldReleaseScanner) {
                    setTimeout(() => {
                        barcodeScanHandlingRef.current = false;
                    }, 600);
                }
            }
        })();
    }, [clearCameraIdleTimer, confirmScanCandidate, openScannedDetails, selectedYear]);

    const handleVisionCameraError = useCallback((error: Error) => {
        if (visionFallbackShownRef.current) return;

        visionFallbackShownRef.current = true;
        console.error("Vision Camera 啟動失敗:", error);
        setIsCameraReady(false);
        setRuntimeProviderOverride("expo-camera");
        activateCamera();
        showCameraErrorAlert("Vision Camera 無法使用，已改用 Expo Camera", error);
    }, [activateCamera]);

    const handleCameraReady = useCallback(() => {
        cameraReadyReportedRef.current = true;
        resetScanConfirmation();
        clearCameraRevealTimer();
        cameraRevealTimerRef.current = setTimeout(() => {
            cameraRevealTimerRef.current = null;
            setIsCameraReady(true);
            setIsCameraLoading(false);
        }, CAMERA_REVEAL_DELAY_MS);
    }, [clearCameraRevealTimer, resetScanConfirmation]);

    const handleExpoCameraError = useCallback((error: Error) => {
        console.error("Expo Camera 啟動失敗:", error);
        clearCameraRevealTimer();
        cameraReadyReportedRef.current = false;
        setIsCameraReady(false);
        setIsCameraLoading(false);
        if (expoCameraErrorShownRef.current) return;

        expoCameraErrorShownRef.current = true;
        showCameraErrorAlert("Expo Camera 無法啟動", error);
    }, [clearCameraRevealTimer]);

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

    if (yearsLoading || scannerSettingsLoading) {
        return (
            <View style={[styles.container, {marginTop: insets.top}]}>
                <View style={styles.loadingState}>
                    <ActivityIndicator color="#2563EB" size="large" />
                    <Text mt="md" color="gray700" fontSize="lg" fontWeight="bold">
                        準備掃描器中
                    </Text>
                </View>
            </View>
        );
    }

    if (!hasImportedPropertyYears) {
        return (
            <View style={[styles.container, {marginTop: insets.top}]}>
                <View style={styles.emptyImportState}>
                    <View style={styles.emptyImportIconCircle}>
                        <Icon
                            name="database-import-outline"
                            fontFamily="MaterialCommunityIcons"
                            color="#2563EB"
                            fontSize={34}
                        />
                    </View>
                    <Text mt="lg" color="gray900" fontSize="xl" fontWeight="bold" textAlign="center">
                        尚未匯入盤點資料
                    </Text>
                    <Text mt="sm" color="gray600" fontSize="md" textAlign="center" lineHeight={22}>
                        請先匯入空間配置圖與財產資料
                    </Text>
                    <TouchableOpacity
                        activeOpacity={0.82}
                        style={styles.goSettingsButton}
                        onPress={() => router.navigate("/settings")}
                    >
                        <Icon name="settings" color="white" fontSize={18} fontFamily="Feather" mr="sm" />
                        <Text color="white" fontSize="md" fontWeight="bold">
                            立即前往建立資料
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    if (!!permission && !permission.granted) {
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
            <View style={styles.headerBlock}>
                <ScannerTitle />
                <Div row justifyContent="center" alignItems="center" style={styles.yearHintRow}>
                    <PropertyYearDropdown
                        compact
                        prefix="目前正在盤點"
                        disabledLabel="尚未匯入盤點年度"
                        onBeforeSelect={pauseForYearSelection}
                        onAfterSelect={resumeAfterYearSelection}
                    />
                </Div>
            </View>
            <View style={styles.cameraFrame}>
                {shouldMountCamera ? (
                    usesExpoCamera ? (
                        <ScannerCamera
                            barcodeTypes={expoCameraBarcodeTypes}
                            zoom={activeZoomPreset.expoZoom}
                            enableTorch={torchEnabled}
                            onBarcodeScanned={navigate}
                            onError={handleExpoCameraError}
                            onReady={handleCameraReady}
                        />
                    ) : (
                        <VisionCameraScannerSlot
                            active
                            barcodeFormats={visionCameraBarcodeFormats}
                            enableTorch={torchEnabled}
                            zoom={activeZoomPreset.visionZoom}
                            onBarcodeScanned={navigate}
                            onError={handleVisionCameraError}
                            onReady={handleCameraReady}
                        />
                    )
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
                    <View style={styles.cameraLoadingOverlay}>
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
                        onPress={activateCamera}
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
            <View
                pointerEvents={isCameraReady ? "auto" : "none"}
                style={[styles.scannerControlPanel, !isCameraReady && styles.scannerControlPanelDisabled]}
            >
                <TouchableOpacity
                    activeOpacity={0.82}
                    disabled={!isCameraReady}
                    style={[
                        styles.torchButton,
                        torchEnabled && styles.torchButtonActive,
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
                        const selected = scannerZoomPreset === preset.id;

                        return (
                            <TouchableOpacity
                                key={preset.id}
                                activeOpacity={0.82}
                                disabled={!isCameraReady}
                                style={[
                                    styles.zoomPresetChip,
                                    selected && styles.zoomPresetChipSelected,
                                ]}
                                onPress={() => setScannerZoomPreset(preset.id)}
                            >
                                <Text fontSize="sm" fontWeight="bold" color={selected ? "white" : "gray800"}>
                                    {preset.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>
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
    loadingState: {
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
    },
    emptyImportState: {
        width: "100%",
        maxWidth: 360,
        alignItems: "center",
        justifyContent: "center",
        padding: 22,
        borderRadius: 24,
        backgroundColor: "#FFFFFF",
        shadowColor: "#64748B",
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 6,
    },
    emptyImportIconCircle: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
    },
    goSettingsButton: {
        minHeight: 48,
        marginTop: 22,
        paddingHorizontal: 18,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#2563EB",
        shadowColor: "#64748B",
        shadowOffset: {
            width: 0,
            height: 5,
        },
        shadowOpacity: 0.14,
        shadowRadius: 10,
        elevation: 4,
    },
    headerBlock: {
        alignItems: "center",
        paddingBottom: 18,
    },
    scannerTitleRow: {
        maxWidth: "100%",
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
    },
    scannerTitle: {
        flexShrink: 1,
        fontSize: 20,
        fontWeight: "bold",
        color: "#111827",
        textAlign: "center",
    },
    cameraSettingsButton: {
        width: 20,
        height: 20,
        marginLeft: 5,
        alignItems: "center",
        justifyContent: "center",
    },
    yearHintRow: {
        marginTop: 6,
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
        ...absoluteFill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#111827",
        borderRadius: 15,
    },
    cameraSleepOverlay: {
        ...absoluteFill,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(17, 24, 39, 0.88)",
        borderRadius: 15,
    },
    scanGuideOverlay: {
        ...absoluteFill,
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
    scannerControlPanelDisabled: {
        opacity: 0.55,
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
    text: {
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
    },
});
