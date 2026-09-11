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
import {getPropertyItemsByBarcode} from "@/handlers/propertyList";
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

const CAMERA_IDLE_TIMEOUT_MS = 60 * 1000;
const CAMERA_READY_RETRY_MS = 1500;
const CAMERA_READY_MAX_RETRIES = 2;
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
type CancelableTask = {cancel: () => void};
type IdleApi = typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: {timeout?: number}) => number;
    cancelIdleCallback?: (handle: number) => void;
};

function runWhenIdle(callback: () => void): CancelableTask {
    const idleApi = globalThis as IdleApi;
    if (typeof idleApi.requestIdleCallback === "function") {
        const handle = idleApi.requestIdleCallback(callback, {timeout: 300});
        return {cancel: () => idleApi.cancelIdleCallback?.(handle)};
    }

    const timeout = setTimeout(callback, 16);
    return {cancel: () => clearTimeout(timeout)};
}

function getItemSourceYears(items: Awaited<ReturnType<typeof getPropertyItemsByBarcode>>): string[] {
    return [...new Set(items.flatMap((item) => item.sourceYears))].sort(comparePropertyYearsDescending);
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
    sessionKey: number;
    selectedLens?: string;
    zoom: number;
    enableTorch: boolean;
    onAvailableLensesChanged: (lenses: string[]) => void;
    onBarcodeScanned: (isbn: string) => void;
    onReady: () => void;
};

const ScannerCamera = memo(function ScannerCamera({
    barcodeTypes,
    sessionKey,
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
                barcodeTypes,
            }}
            onAvailableLensesChanged={({lenses}) => onAvailableLensesChanged(lenses)}
            onBarcodeScanned={(scanningResult) => onBarcodeScanned(scanningResult.data)}
            selectedLens={selectedLens}
            zoom={zoom}
            enableTorch={enableTorch}
            autofocus="on"
            onCameraReady={onReady}
        />
    );
});

type VisionCameraScannerProps = {
    active: boolean;
    barcodeFormats: VisionCameraBarcodeFormat[];
    enableTorch: boolean;
    zoom: number;
    onBarcodeScanned: (value: string) => void;
    onError: (error: Error) => void;
    onReady: () => void;
};

let visionCameraModulePromise: Promise<{default: ComponentType<VisionCameraScannerProps>}> | null = null;

function loadVisionCameraScanner() {
    visionCameraModulePromise ??= import("@/components/scanner/VisionCameraScanner");
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
    const [cameraSessionKey, setCameraSessionKey] = useState(0);
    const [autoSelectedLens, setAutoSelectedLens] = useState<string | undefined>(undefined);
    const [scannerZoomPreset, setScannerZoomPreset] = useState<ScannerZoomPresetId>("standard");
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const {availableYears, selectedYear, loading: yearsLoading, refreshYears} = usePropertyYear();
    const [scanned, setScanned] = useState("")
    const reopenSearchOnFocusRef = useRef(false);
    const searchOpenRequestIdRef = useRef(0);
    const pauseCameraTaskRef = useRef<CancelableTask | null>(null);
    const resumeCameraTaskRef = useRef<CancelableTask | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleAlertVisibleRef = useRef(false);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const scannerFocusedRef = useRef(false);
    const permissionMissingLogKeyRef = useRef<string | null>(null);
    const barcodeScanHandlingRef = useRef(false);
    const cameraReadyRetryCountRef = useRef(0);
    const visionFallbackShownRef = useRef(false);
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

        resumeCameraTaskRef.current = runWhenIdle(() => {
            setIsCameraActive(true);
            if (restartSession) {
                setCameraSessionKey((key) => key + 1);
            }
            resumeCameraTaskRef.current = null;
        });
    }, []);

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
    }, [activateCamera, hasImportedPropertyYears, isAppActive, isCameraActive, isScannerFocused, modalVisible, pauseCamera, permission?.granted, yearsLoading]);

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

    const refreshAvailableYears = useCallback(async () => {
        await refreshYears();
    }, [refreshYears]);

    const pauseForYearSelection = useCallback(() => {
        pauseCamera("year_dropdown_opened");
    }, [pauseCamera]);

    const resumeAfterYearSelection = useCallback(() => {
        if (scannerFocusedRef.current && !modalVisible) {
            queueCameraActivation("year_dropdown_closed", false);
        }
    }, [modalVisible, queueCameraActivation]);

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

    useFocusEffect(
        useCallback(() => {
            let focusActive = true;
            const shouldReopenSearch = reopenSearchOnFocusRef.current;

            console.log("Reopen search on focus:", shouldReopenSearch)
            scannerFocusedRef.current = true;
            visionFallbackShownRef.current = false;
            setIsScannerFocused(true);
            void refreshAvailableYears();
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
                pauseCamera("scanner_focus_reopen_search");
            }
            setScanned("")

            return () => {
                focusActive = false;
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
        }, [pauseCamera, refreshAvailableYears])
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

    const shouldMountCamera = !scannerSettingsLoading && !!permission?.granted && hasImportedPropertyYears && !yearsLoading && isAppActive && isScannerFocused && !modalVisible && isCameraActive;

    useEffect(() => {
        if (scannerSettingsLoading || !isScannerFocused || modalVisible || !hasImportedPropertyYears) return;

        const task = runWhenIdle(() => {
            queueCameraActivation("scanner_provider_ready");
        });
        return task.cancel;
    }, [hasImportedPropertyYears, isScannerFocused, modalVisible, queueCameraActivation, scannerSettingsLoading]);

    useEffect(() => {
        const task = runWhenIdle(() => {
            if (shouldMountCamera) {
                setIsCameraLoading(true);
            } else {
                cameraReadyRetryCountRef.current = 0;
                setIsCameraLoading(false);
                setTorchEnabled(false);
            }
        });

        return task.cancel;
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

    // on barcode scanned logic
    useEffect(() => {
        (async () => {
            if (scanned)
            {
                router.navigate({
                    pathname: "/stacks/details",
                    params: selectedYear
                        ? {barcode: scanned, year: selectedYear}
                        : {barcode: scanned},
                });
            }
        })()
    }, [scanned, selectedYear]);

    const navigate = useCallback((isbn: string) => {
        if (barcodeScanHandlingRef.current) return;

        barcodeScanHandlingRef.current = true;
        clearCameraIdleTimer();

        void (async () => {
            let shouldReleaseScanner = true;

            try {
                if (selectedYear) {
                    const scannedItems = await getPropertyItemsByBarcode(isbn);
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
                        setScanned(isbn);
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

                setScanned(isbn);
            } catch (error) {
                console.error("檢查掃描財產年度失敗:", error);
                setScanned(isbn);
            } finally {
                if (shouldReleaseScanner) {
                    setTimeout(() => {
                        barcodeScanHandlingRef.current = false;
                    }, 600);
                }
            }
        })();
    }, [selectedYear]);

    const handleVisionCameraError = useCallback((error: Error) => {
        if (visionFallbackShownRef.current) return;

        visionFallbackShownRef.current = true;
        console.error("VisionCamera 啟動失敗:", error);
        setRuntimeProviderOverride("expo-camera");
        queueCameraActivation("vision_camera_fallback");
        Alert.alert(
            "VisionCamera 無法使用",
            "已暫時改用 Expo Camera。安裝或更新相機套件後，需要重新建立 App。",
        );
    }, [queueCameraActivation]);

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
        const preferredLens = resolvePreferredBackLens(lenses);
        setAutoSelectedLens(preferredLens);
    }, [resolvePreferredBackLens]);

    const handleCameraReady = useCallback(() => {
        cameraReadyRetryCountRef.current = 0;
        setIsCameraLoading(false);
    }, []);

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
                            sessionKey={cameraSessionKey}
                            selectedLens={autoSelectedLens}
                            zoom={activeZoomPreset.expoZoom}
                            enableTorch={torchEnabled}
                            onAvailableLensesChanged={handleAvailableLensesChanged}
                            onBarcodeScanned={navigate}
                            onReady={handleCameraReady}
                        />
                    ) : (
                        <VisionCameraScannerSlot
                            key={cameraSessionKey}
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
                        const selected = scannerZoomPreset === preset.id;

                        return (
                            <TouchableOpacity
                                key={preset.id}
                                activeOpacity={0.82}
                                style={[styles.zoomPresetChip, selected && styles.zoomPresetChipSelected]}
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
    text: {
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
    },
});
