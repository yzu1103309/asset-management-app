import React, {useCallback, useEffect, useRef, useState} from "react";
import {
    Alert,
    Animated,
    Easing,
    Image,
    LayoutAnimation,
    Linking,
    Modal,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View
} from "react-native";
import {type Href, router} from "expo-router";
import {Button, Icon, Text} from "react-native-magnus";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import {WebBrowserPresentationStyle} from "expo-web-browser";
import {inDevHandler} from "@/components/inDev";
import {usePrompt} from "@/hooks/usePrompt";
import {useSafeAreaActionSheet} from "@/hooks/useSafeAreaActionSheet";
import {clearAllLocalData} from "@/handlers/clearDatabase";
import {useSpinner} from "@/context/SpinnerContext";
import {MenuRow, Section} from "@/components/settings/SettingsRows";
import {
    compareVersionStrings,
    formatVersionTag,
    getDisplayVersionEntries,
    LOCAL_VERSION_RECORD,
    parseVersionRecordJson,
    VERSION_RECORD_URL,
    type VersionRecordEntry,
} from "@/constants/versionRecord";
import {File, type PickSingleFileOptions} from "expo-file-system";
import {getStoredPropertyItems, importPropertyFileBytes} from "@/handlers/propertyImport";
import {getPropertySpreadsheetSheetNames} from "@/handlers/propertySpreadsheetParser";
import {type AreaLayout, getStoredAreaLayout, parseDrawioAreaLayout, saveAreaLayout} from "@/handlers/areaLayout";
import {type BoundAreaReference, findMissingAreaLayoutBindings} from "@/handlers/areaLayoutCompatibility";
import AreaLayoutPreviewModal from "@/components/settings/AreaLayoutPreviewModal";
import {clearPropertyLabelQueue, getPropertyLabelQueue} from "@/handlers/propertyLabelQueue";
import {getPropertyLabelPrintItems, type PropertyLabelPrintItem} from "@/handlers/propertyLabelPrintHtml";
import {
    cleanupPropertyLabelPdf,
    createPropertyLabelPdf,
    type PropertyLabelPdfExportResult,
    type PropertyLabelPdfProgress,
    sharePropertyLabelPdf,
} from "@/handlers/propertyLabelPdf";
import {
    cleanupPropertyExcelFile,
    createPropertyExcelFile,
    type PropertyExcelExportResult,
    sharePropertyExcelFile,
} from "@/handlers/propertyExcelExport";
import {
    type BackupExportResult,
    type BackupProgress,
    cleanupBackupFile,
    createFullBackupFile,
    getExistingBackupTargetSummary,
    restoreFullBackupFile,
    shareBackupFile,
} from "@/handlers/propertyBackup";

type ProgressUpdate = BackupProgress | PropertyLabelPdfProgress;
type AllPropertyLabelExportScope = "all" | "latest";
type VersionRecordFetchResult = {
    entries: VersionRecordEntry[];
    usingLocal: boolean;
};
const USER_GUIDE_URL = "https://hackmd.io/@wilson920430/Skn7hDT_Ge";
const GITHUB_REPO_URL = "https://github.com/yzu1103309/asset-management-app";
const CONTACT_EMAIL = "yzu1103309@gmail.com";
const CURRENT_APP_VERSION = require("@/app.json").expo.version as string;
const LOCAL_VERSION_RECORD_ENTRIES = getDisplayVersionEntries(LOCAL_VERSION_RECORD, CURRENT_APP_VERSION);

async function fetchVersionRecordEntriesFromUrl(url: string): Promise<VersionRecordEntry[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(url, {
            cache: "no-store",
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`version_record request failed: ${response.status}`);

        const record = parseVersionRecordJson(await response.text());
        const entries = getDisplayVersionEntries(record, CURRENT_APP_VERSION);
        if (entries.length === 0) throw new Error("version_record has no visible entries.");

        return entries;
    } finally {
        clearTimeout(timeout);
    }
}

type ProgressOperation = ProgressUpdate & {
    title: string;
    completed?: boolean;
};

function getNestedValue(source: unknown, path: string[]): unknown {
    return path.reduce<unknown>((current, key) => {
        if (typeof current !== "object" || current === null || !(key in current)) return undefined;

        return (current as Record<string, unknown>)[key];
    }, source);
}

function getErrorMessage(error: unknown): string | undefined {
    return typeof error === "object"
        && error !== null
        && "message" in error
        && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : undefined;
}

type PickFileResultLike = {
    canceled: boolean;
    result: File | File[] | null;
};

function isPickFileResultLike(value: unknown): value is PickFileResultLike {
    return typeof value === "object"
        && value !== null
        && "canceled" in value
        && "result" in value;
}

function isFilePickerCancelError(error: unknown): boolean {
    const message = getErrorMessage(error) ?? String(error);
    return /cancel|cancelled|canceled|picker.*dismiss/i.test(message);
}

async function pickSingleFile(options?: PickSingleFileOptions): Promise<File | null> {
    try {
        const picked = await File.pickFileAsync(options);

        if (Array.isArray(picked)) return picked[0] ?? null;
        if (isPickFileResultLike(picked)) {
            if (picked.canceled) return null;

            const result = picked.result;
            return Array.isArray(result) ? result[0] ?? null : result;
        }

        return picked ?? null;
    } catch (error) {
        if (isFilePickerCancelError(error)) return null;
        throw error;
    }
}

function waitForNextModalFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
    });
}

function toSerializableError(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => toSerializableError(item, seen));
    }

    const result: Record<string, unknown> = {};
    Object.getOwnPropertyNames(value).forEach((key) => {
        result[key] = toSerializableError((value as Record<string, unknown>)[key], seen);
    });

    return result;
}

function stringifyGoogleDriveSyncError(error: unknown): string {
    try {
        const serialized = toSerializableError(error);
        const json = JSON.stringify(serialized, null, 2);
        if (json && json !== "{}") return json;
    } catch {
        // Fall back to String(error) below.
    }

    return String(error);
}

function confirmAction(title: string, message: string, confirmText: string, destructive = false): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: "取消", style: "cancel", onPress: () => resolve(false) },
            { text: confirmText, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
        ]);
    });
}

function confirmPropertyImportWithoutAreaLayout(): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(
            "尚未建立空間配置資訊",
            "建議先匯入空間配置圖，\n再建立財產資料庫。\n\n必須有空間配置資訊才能進行盤點\n是否繼續操作？",
            [
                {
                    text: "取消",
                    style: "cancel",
                    onPress: () => resolve(false),
                },
                {
                    text: "仍要匯入",
                    onPress: () => resolve(true),
                },
            ],
            {cancelable: true, onDismiss: () => resolve(false)},
        );
    });
}

function isSpreadsheetImportSource(bytes: Uint8Array, sourceName?: string): boolean {
    return /\.(xlsx|xls|xsl)$/i.test(sourceName?.toLowerCase() ?? "") || (bytes[0] === 0x50 && bytes[1] === 0x4b);
}

function spreadsheetSheetNameHasYear(sheetName: string): boolean {
    return /(?:^|\D)(\d{3,4})(?:\D|$)/.test(sheetName);
}

function promptSpreadsheetSingleSheetYearSystem(now = new Date()): Promise<string | null> {
    const westernYear = String(now.getFullYear());
    const minguoYear = String(now.getFullYear() - 1911);

    return new Promise((resolve) => {
        Alert.alert(
            "選擇匯入年度",
            "這個 Excel 只有一個分頁，\n且分頁並非以年度命名。\n\n將自動套用目前年份",
            [
                {
                    text: "取消",
                    style: "cancel",
                    onPress: () => resolve(null),
                },
                {
                    text: `使用西元年（${westernYear}）`,
                    onPress: () => resolve(westernYear),
                },
                {
                    text: `使用民國年（${minguoYear}）`,
                    onPress: () => resolve(minguoYear),
                },
            ],
            {cancelable: true, onDismiss: () => resolve(null)},
        );
    });
}

async function resolveSpreadsheetSingleSheetFallbackYear(bytes: Uint8Array, sourceName?: string): Promise<string | undefined | null> {
    if (!isSpreadsheetImportSource(bytes, sourceName)) return undefined;

    const sheetNames = getPropertySpreadsheetSheetNames(bytes, sourceName);
    if (sheetNames.length !== 1 || spreadsheetSheetNameHasYear(sheetNames[0])) return undefined;

    return promptSpreadsheetSingleSheetYearSystem();
}

function getAreaReferenceLabel(reference: BoundAreaReference): string {
    return reference.areaName
        ? `${reference.areaName}${reference.areaId ? `（${reference.areaId}）` : ""}`
        : reference.areaId ?? "未命名區域";
}

function getLabelConfirmItemKey(item: PropertyLabelPrintItem, index: number): string {
    return `${item.barcode}:${item.itemNumber}:${index}`;
}

function promptAllPropertyLabelExportScope(): Promise<AllPropertyLabelExportScope | null> {
    return new Promise((resolve) => {
        Alert.alert(
            "輸出所有財產標籤",
            "請選擇要輸出的財產範圍。",
            [
                {
                    text: "取消",
                    style: "cancel",
                    onPress: () => resolve(null),
                },
                {
                    text: "所有財產（包含已報廢）",
                    onPress: () => resolve("all"),
                },
                {
                    text: "僅最新年度存在之財產",
                    onPress: () => resolve("latest"),
                },
            ],
            {cancelable: true, onDismiss: () => resolve(null)},
        );
    });
}

export default function Settings()
{
    const insets = useSafeAreaInsets();
    const prompt = usePrompt();
    const { showActionSheetWithOptions } = useSafeAreaActionSheet();
    const { showSpinner, hideSpinner } = useSpinner();
    const [areaLayoutPreview, setAreaLayoutPreview] = useState<AreaLayout | null>(null);
    const [queuedLabelConfirmItems, setQueuedLabelConfirmItems] = useState<PropertyLabelPrintItem[] | null>(null);
    const [selectedQueuedLabelKeys, setSelectedQueuedLabelKeys] = useState<string[]>([]);
    const [backupOperation, setBackupOperation] = useState<ProgressOperation | null>(null);
    const [aboutModalVisible, setAboutModalVisible] = useState(false);
    const [versionRecordModalVisible, setVersionRecordModalVisible] = useState(false);
    const [versionRecordEntries, setVersionRecordEntries] = useState<VersionRecordEntry[]>(LOCAL_VERSION_RECORD_ENTRIES);
    const [expandedVersionRecordKeys, setExpandedVersionRecordKeys] = useState<Record<string, boolean>>({});
    const [versionRecordLoading, setVersionRecordLoading] = useState(false);
    const [versionRecordUsingLocal, setVersionRecordUsingLocal] = useState(true);
    const [backupDisplayedProgress, setBackupDisplayedProgress] = useState(1);
    const [backupProgressTrackWidth, setBackupProgressTrackWidth] = useState(0);
    const backupSpinValue = useRef(new Animated.Value(0)).current;
    const backupProgressValue = useRef(new Animated.Value(1)).current;
    const backupProgressTextTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const backupProgressAnimationVersionRef = useRef(0);
    const versionRecordRequestIdRef = useRef(0);
    const backupOperationVisible = backupOperation !== null;

    useEffect(() => {
        if (!backupOperationVisible) {
            backupSpinValue.stopAnimation();
            backupSpinValue.setValue(0);
            return;
        }

        backupSpinValue.setValue(0);
        const animation = Animated.loop(
            Animated.timing(backupSpinValue, {
                toValue: 1,
                duration: 900,
                easing: Easing.linear,
                useNativeDriver: true,
                isInteraction: false,
            }),
        );
        animation.start();

        return () => {
            animation.stop();
        };
    }, [backupOperationVisible, backupSpinValue]);

    const driveProgressBar = useCallback((progress: ProgressUpdate) => {
        const animationVersion = backupProgressAnimationVersionRef.current + 1;
        backupProgressAnimationVersionRef.current = animationVersion;
        const targetProgress = Math.min(100, Math.max(1, progress.progress));
        const activeTargetProgress = progress.targetProgress === undefined
            ? targetProgress
            : Math.min(100, Math.max(targetProgress, progress.targetProgress));
        const activeMillisecondsPerPercent = progress.millisecondsPerPercent ?? 800;

        backupProgressValue.stopAnimation((currentProgress) => {
            if (animationVersion !== backupProgressAnimationVersionRef.current) return;

            const current = Number(currentProgress);
            const animateToProgress = (
                nextProgress: number,
                duration: number,
                easing: (value: number) => number,
                onDone?: () => void,
            ) => {
                Animated.timing(backupProgressValue, {
                    toValue: nextProgress,
                    duration,
                    easing,
                    useNativeDriver: true,
                    isInteraction: false,
                }).start(({finished}) => {
                    if (finished && animationVersion === backupProgressAnimationVersionRef.current) onDone?.();
                });
            };

            if (progress.active) {
                const beginActiveProgress = Math.max(current, targetProgress);
                const runActiveProgress = () => {
                    const distance = Math.max(0, activeTargetProgress - beginActiveProgress);
                    if (distance <= 0) return;
                    animateToProgress(
                        activeTargetProgress,
                        distance * activeMillisecondsPerPercent,
                        Easing.linear,
                    );
                };

                if (current + 0.1 < targetProgress) {
                    const catchUpDistance = targetProgress - current;
                    animateToProgress(
                        targetProgress,
                        Math.max(220, Math.min(700, catchUpDistance * 55)),
                        Easing.out(Easing.cubic),
                        runActiveProgress,
                    );
                    return;
                }

                runActiveProgress();
                return;
            }

            const nextProgress = Math.max(current, targetProgress);
            const distance = Math.max(0, nextProgress - current);
            animateToProgress(
                nextProgress,
                progress.progress >= 100
                    ? Math.max(220, Math.min(520, distance * 45))
                    : Math.max(220, Math.min(700, distance * 55)),
                Easing.out(Easing.cubic),
            );
        });
    }, [backupProgressValue]);

    const clearProgressTextTimer = useCallback(() => {
        if (backupProgressTextTimerRef.current) {
            clearInterval(backupProgressTextTimerRef.current);
            backupProgressTextTimerRef.current = null;
        }
    }, []);

    const driveProgressText = useCallback((progress: ProgressUpdate) => {
        clearProgressTextTimer();

        const startProgress = Math.round(Math.min(100, Math.max(1, progress.progress)));
        const targetProgress = Math.round(Math.min(100, Math.max(startProgress, progress.targetProgress ?? progress.progress)));

        if (!progress.active) {
            setBackupDisplayedProgress(startProgress);
            return;
        }

        setBackupDisplayedProgress((current) => Math.max(current, startProgress));
        backupProgressTextTimerRef.current = setInterval(() => {
            setBackupDisplayedProgress((current) => {
                if (current >= targetProgress) {
                    clearProgressTextTimer();
                    return targetProgress;
                }

                return Math.min(targetProgress, current + 1);
            });
        }, progress.millisecondsPerPercent ?? 800);
    }, [clearProgressTextTimer]);

    const resetProgressVisuals = useCallback(() => {
        backupProgressAnimationVersionRef.current += 1;
        backupProgressValue.stopAnimation();
        backupProgressValue.setValue(1);
        clearProgressTextTimer();
        setBackupDisplayedProgress(1);
    }, [backupProgressValue, clearProgressTextTimer]);

    useEffect(() => {
        if (!backupOperation) clearProgressTextTimer();
    }, [backupOperation, clearProgressTextTimer]);

    useEffect(() => () => clearProgressTextTimer(), [clearProgressTextTimer]);

    const showComingSoon = async () => {
        await inDevHandler();
    };

    const openBrowserUrl = useCallback(async (url: string, label: string) => {
        try {
            await WebBrowser.openBrowserAsync(url, {presentationStyle: WebBrowserPresentationStyle.FULL_SCREEN});
        } catch (error) {
            console.error(`開啟${label}失敗:`, error);
            Alert.alert("無法開啟連結", "請稍後再試。");
        }
    }, []);

    const openUserGuide = useCallback(async () => {
        await openBrowserUrl(USER_GUIDE_URL, "詳細使用說明");
    }, [openBrowserUrl]);

    const openGithubRepository = useCallback(async () => {
        await openBrowserUrl(GITHUB_REPO_URL, "GitHub Repo");
    }, [openBrowserUrl]);

    const openContactEmail = useCallback(async () => {
        try {
            await Linking.openURL(`mailto:${CONTACT_EMAIL}`);
        } catch (error) {
            console.error("開啟聯絡信箱失敗:", error);
            Alert.alert("無法開啟信箱", "請稍後再試。");
        }
    }, []);

    const fetchVersionRecord = useCallback(async (): Promise<VersionRecordFetchResult> => {
        try {
            const entries = await fetchVersionRecordEntriesFromUrl(VERSION_RECORD_URL);
            return {entries, usingLocal: false};
        } catch {
            return {entries: LOCAL_VERSION_RECORD_ENTRIES, usingLocal: true};
        }
    }, []);

    const closeVersionRecordModal = useCallback(() => {
        versionRecordRequestIdRef.current += 1;
        setVersionRecordLoading(false);
        setVersionRecordModalVisible(false);
    }, []);

    const openVersionRecord = useCallback(() => {
        setVersionRecordEntries(LOCAL_VERSION_RECORD_ENTRIES);
        setExpandedVersionRecordKeys({});
        setVersionRecordUsingLocal(true);
        setVersionRecordLoading(true);
        setVersionRecordModalVisible(true);
    }, []);

    useEffect(() => {
        if (!versionRecordModalVisible) return;

        const requestId = versionRecordRequestIdRef.current + 1;
        versionRecordRequestIdRef.current = requestId;
        void (async () => {
            const result = await fetchVersionRecord();
            if (versionRecordRequestIdRef.current !== requestId) return;

            setVersionRecordEntries(result.entries);
            setVersionRecordUsingLocal(result.usingLocal);
            setVersionRecordLoading(false);
        })();

        return () => {
            versionRecordRequestIdRef.current += 1;
        };
    }, [fetchVersionRecord, versionRecordModalVisible]);

    const toggleVersionRecordEntry = useCallback((entry: VersionRecordEntry) => {
        const entryKey = `${entry.version}-${entry.date}`;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpandedVersionRecordKeys((current) => ({
            ...current,
            [entryKey]: !current[entryKey],
        }));
    }, []);

    const updateProgressOperation = useCallback((title: string, progress: ProgressUpdate) => {
        driveProgressBar(progress);
        driveProgressText(progress);
        setBackupOperation({title, ...progress, completed: progress.progress >= 100});
    }, [driveProgressBar, driveProgressText]);

    const handlePropertyImport = useCallback(async () => {
        const currentAreaLayout = await getStoredAreaLayout().catch(() => null);
        if (!currentAreaLayout && !(await confirmPropertyImportWithoutAreaLayout())) return;

        try {
            const file = await pickSingleFile();
            if (!file) return;

            const sourceName = file.name;
            const fileBytes = await file.bytes();
            const spreadsheetSingleSheetFallbackYear = await resolveSpreadsheetSingleSheetFallbackYear(fileBytes, sourceName);
            if (spreadsheetSingleSheetFallbackYear === null) return;

            showSpinner({locked: true});
            const result = await importPropertyFileBytes(fileBytes, sourceName, {
                spreadsheet: spreadsheetSingleSheetFallbackYear ? {singleSheetFallbackYear: spreadsheetSingleSheetFallbackYear} : undefined,
            });
            const sourceYearText = result.sourceYears.length === 1
                ? `${result.sourceYears[0]} 年度`
                : `${result.sourceYears.join(", ")} 年度`;
            const detail = [
                sourceYearText,
                `新增 ${result.createdCount} 筆`,
                result.updatedCount > 0 ? `更新 ${result.updatedCount} 筆` : undefined,
                // result.duplicateBarcodeCount > 0 ? `重複條碼 ${result.duplicateBarcodeCount} 筆已保留` : undefined,
                result.skippedRowCount > 0 ? `略過 ${result.skippedRowCount} 列` : undefined,
            ].filter(Boolean).join("\n");

            Alert.alert("匯入完成", detail);
        } catch (error) {
            const message = getErrorMessage(error) ?? "無法讀取或匯入此檔案。";
            if (/cancel/i.test(message)) return;

            console.error("財產資料匯入失敗:", error);
            Alert.alert("匯入失敗", message);
        } finally {
            hideSpinner({force: true});
        }
    }, [hideSpinner, showSpinner]);

    const handleAreaLayoutImport = useCallback(async () => {
        let spinnerShown = false;

        try {
            const file = await pickSingleFile({mimeTypes: ["application/xml", "text/xml", "text/plain", "*/*"]});
            if (!file) return;

            showSpinner({locked: true});
            spinnerShown = true;
            const sourceName = file.name;
            const layout = parseDrawioAreaLayout(await file.text(), sourceName);
            hideSpinner({force: true});
            spinnerShown = false;
            await waitForNextModalFrame();
            setAreaLayoutPreview(layout);
        } catch (error) {
            const message = getErrorMessage(error) ?? "無法讀取或解析此 drawio 檔案。";
            if (/cancel/i.test(message)) return;

            console.error("空間配置匯入失敗:", error);
            Alert.alert("匯入失敗", message);
        } finally {
            if (spinnerShown) hideSpinner({force: true});
        }
    }, [hideSpinner, showSpinner]);

    const confirmAreaLayoutImport = useCallback(async (layout: AreaLayout) => {
        try {
            const [currentLayout, itemsByBarcode] = await Promise.all([
                getStoredAreaLayout(),
                getStoredPropertyItems(),
            ]);
            const missingBindings = currentLayout ? findMissingAreaLayoutBindings(layout, itemsByBarcode) : [];

            if (missingBindings.length > 0) {
                const preview = missingBindings
                    .slice(0, 5)
                    .map((reference) => `• ${getAreaReferenceLabel(reference)}：${reference.itemCount} 件`)
                    .join("\n");
                const remainingCount = missingBindings.length > 5 ? `\n…另有 ${missingBindings.length - 5} 個區域` : "";
                const shouldReplace = await confirmAction(
                    "空間圖可能不相容",
                    [
                        "目前已有財產項目綁定到既有空間圖，但新圖缺少下列已使用區域。",
                        "",
                        preview + remainingCount,
                        "",
                        "如果仍然匯入，這些項目的位置可能無法在新圖中對應。",
                    ].join("\n"),
                    "仍然匯入",
                    true,
                );

                if (!shouldReplace) return;
            }

            showSpinner({locked: true});
            await saveAreaLayout(layout);
            setAreaLayoutPreview(null);
            Alert.alert("匯入完成", `已保留 ${layout.areas.length} 個區域。`);
        } catch (error) {
            console.error("保存空間配置失敗:", error);
            Alert.alert("保存失敗", "無法保存空間配置資料。");
        } finally {
            hideSpinner({force: true});
        }
    }, [hideSpinner, showSpinner]);

    const showActionSheetAsync = useCallback((options: string[], config?: { cancelButtonIndex?: number; destructiveButtonIndex?: number }) => {
        return new Promise<number | undefined>((resolve) => {
            showActionSheetWithOptions(
                { options, cancelButtonIndex: config?.cancelButtonIndex, destructiveButtonIndex: config?.destructiveButtonIndex },
                resolve
            );
        });
    }, [showActionSheetWithOptions]);

    const openDeveloperOptions = async () => {
        const answer = await prompt({
            title: "開發者選項",
            message: "請輸入開發者密鑰",
            placeholder: "Enter Pass Key",
            confirmText: "進入",
            confirmBtnColor: "red500",
        });

        if(answer === null)
            return

        if(answer === "DEV")
            router.push("/stacks/developer_options" as Href);
        else
            Alert.alert("Forbidden", "密鑰錯誤，無法開啟頁面")
    };

    const handleClearDatabase = useCallback(async () => {
        const selectedIndex = await showActionSheetAsync(
            ["清除所有本機資料", "取消"],
            { cancelButtonIndex: 1, destructiveButtonIndex: 0 }
        );
        if (selectedIndex !== 0) return;

        Alert.alert("確認清除資料庫", "這會清除本機所有財產清單與年度清點狀態。", [
            { text: "取消", style: "cancel" },
            {
                text: "清除",
                style: "destructive",
                onPress: () => {
                    void (async () => {
                        try {
                            showSpinner({ locked: true });
                            await clearAllLocalData();
                            Alert.alert("清除完成", "本機財產資料已清除。");
                        } catch (error) {
                            console.error("清除資料庫失敗:", error);
                            Alert.alert("清除失敗", "資料清除失敗。");
                        } finally {
                            hideSpinner({ force: true });
                        }
                    })();
                },
            },
        ]);
    }, [hideSpinner, showActionSheetAsync, showSpinner]);

    const exportPropertyLabelItems = useCallback(async (labels: PropertyLabelPrintItem[], mode: "all" | "queued"): Promise<boolean> => {
        let exportedPdf: PropertyLabelPdfExportResult | null = null;
        let shouldCleanupExportedPdf = false;
        let exported = false;

        try {
            if (labels.length === 0) {
                Alert.alert("沒有可輸出的資料", mode === "queued"
                    ? "待製作清單中的財產編號找不到對應資料。"
                    : "請先匯入財產資料。");
                return false;
            }

            const title = mode === "queued" ? "輸出待製作財產標籤" : "輸出所有財產標籤";
            resetProgressVisuals();
            setBackupOperation({title, message: "準備建立 PDF", progress: 1});
            exportedPdf = await createPropertyLabelPdf(
                labels,
                mode === "queued" ? "待製作" : "全部",
                (progress) => updateProgressOperation(title, progress),
            );
            shouldCleanupExportedPdf = true;
            clearProgressTextTimer();
            setBackupDisplayedProgress(100);
            setBackupOperation({title, message: "PDF 建立完成", progress: 100, completed: true});
            await new Promise((resolve) => setTimeout(resolve, 520));
            const shared = await sharePropertyLabelPdf(
                exportedPdf.uri,
                title,
            );
            shouldCleanupExportedPdf = shared;
            setBackupOperation(null);

            if (!shared) {
                Alert.alert("PDF 已建立", `已建立 ${exportedPdf.numberOfPages} 頁 PDF：\n${exportedPdf.fileName}\n${exportedPdf.uri}`);
            }
            exported = true;
        } catch (error) {
            console.error("輸出財產標籤 PDF 失敗:", error);
            Alert.alert("輸出失敗", "無法建立財產標籤 PDF，請稍後再試。");
        } finally {
            if (exportedPdf && shouldCleanupExportedPdf) {
                cleanupPropertyLabelPdf(exportedPdf);
            }
            setBackupOperation(null);
        }

        return exported;
    }, [clearProgressTextTimer, resetProgressVisuals, updateProgressOperation]);

    const handlePropertyLabelPdfExport = useCallback(async (mode: "all" | "queued") => {
        let labels: PropertyLabelPrintItem[] = [];
        let itemsByBarcode: Awaited<ReturnType<typeof getStoredPropertyItems>> | null = null;
        let queuedBarcodes: string[] | undefined;

        try {
            showSpinner({locked: true});
            const [storedItems, storedQueuedBarcodes] = await Promise.all([
                getStoredPropertyItems(),
                mode === "queued" ? getPropertyLabelQueue() : Promise.resolve(undefined),
            ]);
            itemsByBarcode = storedItems;
            queuedBarcodes = storedQueuedBarcodes;

            if (mode === "queued" && queuedBarcodes?.length === 0) {
                Alert.alert("沒有待製作標籤", "目前尚未加入任何待製作財產標籤。");
                return;
            }
        } catch (error) {
            console.error("讀取財產標籤資料失敗:", error);
            Alert.alert("讀取失敗", "無法讀取財產標籤資料，請稍後再試。");
            return;
        } finally {
            hideSpinner({force: true});
        }

        if (!itemsByBarcode) return;

        if (mode === "all") {
            const scope = await promptAllPropertyLabelExportScope();
            if (!scope) return;

            labels = getPropertyLabelPrintItems(itemsByBarcode, undefined, {latestYearOnly: scope === "latest"});
        } else {
            labels = getPropertyLabelPrintItems(itemsByBarcode, queuedBarcodes);
        }

        if (labels.length === 0) {
            Alert.alert("沒有可輸出的資料", mode === "queued"
                ? "待製作清單中的財產編號找不到對應資料。"
                : "請先匯入財產資料。");
            return;
        }

        if (mode === "queued") {
            setQueuedLabelConfirmItems(labels);
            setSelectedQueuedLabelKeys(labels.map(getLabelConfirmItemKey));
            return;
        }

        await exportPropertyLabelItems(labels, mode);
    }, [exportPropertyLabelItems, hideSpinner, showSpinner]);

    const toggleQueuedLabelConfirmItem = useCallback((key: string) => {
        setSelectedQueuedLabelKeys((current) => (
            current.includes(key)
                ? current.filter((item) => item !== key)
                : [...current, key]
        ));
    }, []);

    const closeQueuedLabelConfirmModal = useCallback(() => {
        setQueuedLabelConfirmItems(null);
        setSelectedQueuedLabelKeys([]);
    }, []);

    const toggleAllQueuedLabelConfirmItems = useCallback(() => {
        if (!queuedLabelConfirmItems) return;

        setSelectedQueuedLabelKeys((current) => {
            if (current.length === queuedLabelConfirmItems.length) return [];

            return queuedLabelConfirmItems.map(getLabelConfirmItemKey);
        });
    }, [queuedLabelConfirmItems]);

    const confirmQueuedLabelPdfExport = useCallback(async () => {
        if (!queuedLabelConfirmItems) return;

        const selectedKeySet = new Set(selectedQueuedLabelKeys);
        const selectedItems = queuedLabelConfirmItems.filter((item, index) => selectedKeySet.has(getLabelConfirmItemKey(item, index)));

        if (selectedItems.length === 0) {
            Alert.alert("尚未勾選項目", "請至少勾選一個財產標籤再輸出。");
            return;
        }

        closeQueuedLabelConfirmModal();
        const exported = await exportPropertyLabelItems(selectedItems, "queued");
        if (!exported) return;

        const shouldClearQueue = await confirmAction(
            "輸出完成",
            "是否清除待製作財產標籤清單？\n\n這會清除「全部待製作項目」，\n不只本次勾選項目。",
            "清除",
            true,
        );
        if (!shouldClearQueue) return;

        try {
            showSpinner({locked: true});
            await clearPropertyLabelQueue();
            Alert.alert("清除完成", "已清除待製作財產標籤清單。");
        } catch (error) {
            console.error("輸出後清除待製作財產標籤清單失敗:", error);
            Alert.alert("清除失敗", "無法清除待製作財產標籤清單，請稍後再試。");
        } finally {
            hideSpinner({force: true});
        }
    }, [closeQueuedLabelConfirmModal, exportPropertyLabelItems, hideSpinner, queuedLabelConfirmItems, selectedQueuedLabelKeys, showSpinner]);

    const handleClearPropertyLabelQueue = useCallback(async () => {
        let spinnerShown = false;

        try {
            const queue = await getPropertyLabelQueue();
            if (queue.length === 0) {
                Alert.alert("清單已是空的", "目前沒有待製作財產標籤。");
                return;
            }

            const shouldClear = await confirmAction(
                "清除待製作清單",
                `確定要清除待製作財產標籤清單？目前共有 ${queue.length} 筆條碼。`,
                "清除",
                true,
            );
            if (!shouldClear) return;

            showSpinner({locked: true});
            spinnerShown = true;
            await clearPropertyLabelQueue();
            Alert.alert("清除完成", "已清除待製作財產標籤清單。");
        } catch (error) {
            console.error("清除待製作財產標籤清單失敗:", error);
            Alert.alert("清除失敗", "無法清除待製作財產標籤清單，請稍後再試。");
        } finally {
            if (spinnerShown) hideSpinner({force: true});
        }
    }, [hideSpinner, showSpinner]);

    const handlePropertyExcelExport = useCallback(async () => {
        let exportedExcel: PropertyExcelExportResult | null = null;
        let shouldCleanupExportedExcel = false;
        let spinnerShown = false;

        try {
            showSpinner({locked: true});
            spinnerShown = true;
            exportedExcel = await createPropertyExcelFile();
            shouldCleanupExportedExcel = true;

            hideSpinner({force: true});
            spinnerShown = false;
            await waitForNextModalFrame();

            const shared = await sharePropertyExcelFile(exportedExcel.uri);
            shouldCleanupExportedExcel = shared;

            if (!shared) {
                Alert.alert(
                    "Excel 檔已建立",
                    `已匯出 ${exportedExcel.rowCount} 筆資料：\n${exportedExcel.fileName}\n${exportedExcel.uri}`,
                );
            }
        } catch (error) {
            const message = getErrorMessage(error) ?? "無法匯出 Excel 檔，請稍後再試。";
            console.error("匯出 Excel 檔失敗:", error);
            if (spinnerShown) {
                hideSpinner({force: true});
                spinnerShown = false;
                await waitForNextModalFrame();
            }
            Alert.alert("匯出失敗", message);
        } finally {
            if (exportedExcel && shouldCleanupExportedExcel) {
                cleanupPropertyExcelFile(exportedExcel);
            }
            if (spinnerShown) hideSpinner({force: true});
        }
    }, [hideSpinner, showSpinner]);

    const handleBackupExport = useCallback(async () => {
        let exportedBackup: BackupExportResult | null = null;
        let shouldCleanupBackup = false;

        try {
            const summary = await getExistingBackupTargetSummary();
            if (!summary.hasData) {
                Alert.alert("無法匯出備份", "目前財產資料庫是空的，請先匯入或建立財產資料後再匯出備份。");
                return;
            }

            resetProgressVisuals();
            setBackupOperation({title: "匯出備份", message: "準備備份資料", progress: 1});
            exportedBackup = await createFullBackupFile((progress) => updateProgressOperation("匯出備份", progress));
            shouldCleanupBackup = true;
            clearProgressTextTimer();
            setBackupDisplayedProgress(100);
            setBackupOperation({title: "匯出備份", message: "備份檔建立完成", progress: 100, completed: true});
            await new Promise((resolve) => setTimeout(resolve, 520));

            const shared = await shareBackupFile(exportedBackup.uri);
            shouldCleanupBackup = shared;
            setBackupOperation(null);

            if (!shared) {
                Alert.alert(
                    "備份檔已建立",
                    [
                        `已匯出 ${exportedBackup.storageKeyCount} 筆資料與 ${exportedBackup.photoCount} 張照片。`,
                        exportedBackup.encrypted ? "此備份已使用環境變數金鑰簡易加密。" : "未設定備份金鑰，內容僅做 base64 編碼與 hash 校驗。",
                        "",
                        exportedBackup.fileName,
                        exportedBackup.uri,
                    ].join("\n"),
                );
            }
        } catch (error) {
            const message = getErrorMessage(error) ?? "無法建立備份檔，請稍後再試。";
            console.error("匯出備份失敗:", error);
            Alert.alert("匯出失敗", message);
        } finally {
            if (exportedBackup && shouldCleanupBackup) cleanupBackupFile(exportedBackup.uri);
            setBackupOperation(null);
        }
    }, [clearProgressTextTimer, resetProgressVisuals, updateProgressOperation]);

    const confirmBackupRestoreOverwrite = useCallback(async (): Promise<boolean> => {
        const summary = await getExistingBackupTargetSummary();
        if (!summary.hasData) return true;

        const selectedIndex = await showActionSheetAsync(
            ["覆蓋現有資料並還原備份", "取消"],
            {cancelButtonIndex: 1, destructiveButtonIndex: 0},
        );
        if (selectedIndex !== 0) return false;

        return confirmAction(
            "最後確認覆蓋",
            [
                "匯入備份會刪除目前本機資料\n並以備份檔內容取代。",
                "",
                "此操作無法復原。",
            ].join("\n"),
            "覆蓋並還原",
            true,
        );
    }, [showActionSheetAsync]);

    const handleBackupImport = useCallback(async () => {
        try {
            const file = await pickSingleFile({mimeTypes: ["application/octet-stream", "application/json", "*/*"]});
            if (!file) return;

            if (!(await confirmBackupRestoreOverwrite())) return;

            resetProgressVisuals();
            setBackupOperation({title: "匯入備份", message: "準備讀取備份檔", progress: 1});
            const result = await restoreFullBackupFile(file, (progress) => updateProgressOperation("匯入備份", progress));

            Alert.alert(
                "還原完成",
                [
                    `已還原所有資料。`,
                    result.encrypted ? "通過加密備份校驗。" : "通過備份 hash 校驗。",
                ].join("\n"),
            );
        } catch (error) {
            const message = getErrorMessage(error) ?? "無法讀取或還原此備份檔。";
            if (/cancel/i.test(message)) return;

            console.error("匯入備份失敗:", error);
            Alert.alert("匯入失敗", message);
        } finally {
            setBackupOperation(null);
        }
    }, [confirmBackupRestoreOverwrite, resetProgressVisuals, updateProgressOperation]);

    const backupSpin = backupSpinValue.interpolate({
        inputRange: [0, 1],
        outputRange: ["0deg", "360deg"],
    });
    const backupProgressTranslateX = backupProgressValue.interpolate({
        inputRange: [0, 100],
        outputRange: [-(backupProgressTrackWidth || 320), 0],
    });

    return (
        <View style={styles.container}>
            <View style={[styles.header, {paddingTop: insets.top + 18}]}>
                <Text fontSize={28} fontWeight="bold" color="gray900">設定與工具</Text>
                {/*<Text mt="xs" fontSize="md" color="gray600" lineHeight={22}>*/}
                {/*    管理備份、書卡顯示、外部連結與應用程式資訊*/}
                {/*</Text>*/}
            </View>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.content]}
            >
                <Section title="建立資料">
                    <MenuRow
                        title="匯入空間配置圖檔"
                        description="請先使用 draw.io 繪製再匯入（.drawio）"
                        icon="block"
                        iconFamily="AntDesign"
                        color="orange500"
                        onPress={() => { void handleAreaLayoutImport(); }}
                    />
                    <MenuRow
                        title="匯入並建立財產資料庫"
                        description="請至財產系統匯出盤點單並匯入"
                        icon="database-import-outline"
                        iconFamily="MaterialCommunityIcons"
                        color="green500"
                        onPress={() => { void handlePropertyImport(); }}
                    />
                </Section>

                <Section title="財產標籤">
                    <MenuRow
                        title="輸出「待製作」之財產標籤"
                        description="僅輸出已加入清單的項目"
                        icon="tag"
                        iconFamily="FontAwesome"
                        color="blue500"
                        onPress={() => { void handlePropertyLabelPdfExport("queued"); }}
                    />
                    <MenuRow
                        title="輸出所有財產之標籤"
                        description="輸出所有財產的標籤列印檔"
                        icon="tags"
                        iconFamily="FontAwesome"
                        color="purple500"
                        onPress={() => { void handlePropertyLabelPdfExport("all"); }}
                    />
                    <MenuRow
                        title="清除待製作財產標籤之清單"
                        description="僅清除清單，不會刪除財產資料"
                        icon="trash-2"
                        iconFamily="Feather"
                        color="#B42318"
                        onPress={() => { void handleClearPropertyLabelQueue(); }}
                    />
                </Section>

                <Section title="軟體設定">
                    <MenuRow
                        title="掃描器設定"
                        description="選擇掃描器與可辨識的條碼格式"
                        icon="camera"
                        iconFamily="Ionicons"
                        color="blue500"
                        onPress={() => router.push("/stacks/camera_settings" as Href)}
                    />
                </Section>

                <Section title="匯出資料">
                    <MenuRow
                        title="匯出 Excel 檔"
                        description="匯出目前財產與清點資料"
                        icon="file-text"
                        iconFamily="Feather"
                        color="green500"
                        onPress={() => { void handlePropertyExcelExport(); }}
                    />
                </Section>

                <Section title="備份管理">
                    <MenuRow
                        title="匯出專用備份檔"
                        description="匯出資料、清點狀態與照片"
                        icon="file-zip"
                        iconFamily="Octicons"
                        color="blue500"
                        onPress={() => { void handleBackupExport(); }}
                    />
                    <MenuRow
                        title="匯入備份檔"
                        description="從備份檔完整還原資料與照片"
                        icon="file-symlink-file"
                        iconFamily="Octicons"
                        color="orange500"
                        onPress={() => { void handleBackupImport(); }}
                    />
                </Section>

                <Section title="說明與關於">
                    <MenuRow title="詳細使用說明" icon="help-circle" iconFamily="Feather" onPress={() => { void openUserGuide(); }} />
                    <MenuRow title="功能更新紀錄" icon="history" iconFamily="Octicons" onPress={openVersionRecord} />
                    <MenuRow title="關於此軟體" icon="info" iconFamily="Feather" onPress={() => setAboutModalVisible(true)} />
                </Section>

                <Section title="危險操作">
                    <MenuRow
                        title="清除所有本機資料"
                        description="清除財產清單與年度清點狀態"
                        icon="trash-2"
                        iconFamily="Feather"
                        color="#B42318"
                        onPress={() => { void handleClearDatabase(); }}
                    />
                </Section>
                <Text fontSize="md" color="gray600" textAlign="center">
                    版本 {require("@/app.json").expo.version}
                </Text>
            </ScrollView>
            <Modal
                visible={versionRecordModalVisible}
                transparent
                animationType="fade"
                onRequestClose={closeVersionRecordModal}
            >
                <View style={styles.centerModalBackdrop}>
                    <View style={styles.versionRecordModalPanel}>
                        <View style={styles.versionRecordHeader}>
                            <View style={styles.versionRecordHeaderIcon}>
                                <Icon name="history" fontFamily="Octicons" fontSize="xl" color="gray800" />
                            </View>
                            <View style={styles.versionRecordTitleBlock}>
                                <Text fontSize="xl" fontWeight="bold" color="gray900" numberOfLines={1}>
                                    功能更新紀錄
                                </Text>
                                {(versionRecordLoading || versionRecordUsingLocal) && (
                                    <Text mt={3} fontSize="sm" color="gray500" numberOfLines={1}>
                                        {versionRecordLoading ? "正在取得最新內容" : "目前顯示本機資料"}
                                    </Text>
                                )}
                            </View>
                            <TouchableOpacity
                                onPress={closeVersionRecordModal}
                                hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                                style={styles.versionRecordCloseButton}
                            >
                                <Icon name="x" fontFamily="Feather" fontSize="xl" color="gray700" />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.versionRecordScroll} contentContainerStyle={styles.versionRecordContent}>
                            {versionRecordEntries.map((entry) => {
                                const entryKey = `${entry.version}-${entry.date}`;
                                const expanded = expandedVersionRecordKeys[entryKey] === true;
                                const isCurrentVersion = compareVersionStrings(entry.version, CURRENT_APP_VERSION) === 0;

                                return (
                                    <View
                                        key={entryKey}
                                        style={[
                                            styles.versionRecordItem,
                                            isCurrentVersion && styles.versionRecordItemPrimary,
                                        ]}
                                    >
                                        <TouchableOpacity
                                            activeOpacity={0.76}
                                            onPress={() => toggleVersionRecordEntry(entry)}
                                            style={styles.versionRecordSummaryRow}
                                        >
                                            <View style={styles.versionRecordTitleColumn}>
                                                <Text mt={0} fontSize="lg" fontWeight="bold" color="gray900" style={styles.versionRecordItemTitle}>
                                                    {entry.title}
                                                </Text>
                                                <View style={styles.versionRecordDateRow}>
                                                    <Icon name="calendar" fontFamily="Feather" fontSize="xs" color="gray500" />
                                                    <Text ml={6} fontSize="xs" color="gray500">
                                                        {entry.date}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={styles.versionRecordBadgeColumn}>
                                                <View
                                                    style={[
                                                        styles.versionRecordVersionBadge,
                                                        isCurrentVersion && styles.versionRecordVersionBadgeCurrent,
                                                    ]}
                                                >
                                                    <Text fontSize="xs" fontWeight="bold" color={isCurrentVersion ? "#047857" : "#1D4ED8"}>
                                                        {isCurrentVersion ? `目前 ${formatVersionTag(entry.version)}` : formatVersionTag(entry.version)}
                                                    </Text>
                                                </View>
                                                <Icon
                                                    name={expanded ? "chevron-up" : "chevron-down"}
                                                    fontFamily="Feather"
                                                    fontSize="sm"
                                                    color="gray500"
                                                />
                                            </View>
                                        </TouchableOpacity>
                                        {expanded && (
                                            <View style={styles.versionRecordChanges}>
                                                {entry.changes.map((change, changeIndex) => (
                                                    <View key={`${entryKey}-${changeIndex}`} style={styles.versionRecordChangeRow}>
                                                        <Text fontSize="sm" color="gray700" style={styles.versionRecordChangeText}>
                                                            - {change}
                                                        </Text>
                                                    </View>
                                                ))}
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
            <Modal
                visible={aboutModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setAboutModalVisible(false)}
            >
                <View style={styles.centerModalBackdrop}>
                    <View style={styles.aboutModalPanel}>
                        <View style={styles.aboutModalHeader}>
                            <Image
                                source={require("@/assets/images/icon.png")}
                                style={styles.aboutAppIcon}
                                accessibilityLabel="Astalog app icon"
                            />
                            <View style={styles.aboutTitleBlock}>
                                <Text fontSize="2xl" fontWeight="bold" color="gray900" numberOfLines={1}>
                                    Astalog
                                </Text>
                                <Text mt={4} fontSize="md" color="gray600" numberOfLines={1}>
                                    Asset Cataloging App
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => setAboutModalVisible(false)}
                                hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                                style={styles.aboutCloseButton}
                            >
                                <Icon name="x" fontFamily="Feather" fontSize="xl" color="gray700" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.aboutStatement}>
                            <Text fontSize="lg" fontWeight="bold" color="gray900" mb="md" textAlign="center">
                                📲 電子化財產盤點
                            </Text>
                            <Text mt={4} fontSize="md" color="gray600" textAlign="center">
                                匯入清冊、掃描條碼、記錄位置與照片、建立關聯
                            </Text>
                            {/*<View style={styles.aboutFeatureGrid}>*/}
                            {/*    <View style={styles.aboutFeatureItem}>*/}
                            {/*        <Icon name="upload-cloud" fontFamily="Feather" fontSize="md" color="#2563EB" />*/}
                            {/*        <Text ml="xs" fontSize="sm" color="gray700" style={styles.aboutFeatureText}>清冊匯入</Text>*/}
                            {/*    </View>*/}
                            {/*    <View style={styles.aboutFeatureItem}>*/}
                            {/*        <Icon name="maximize" fontFamily="Feather" fontSize="md" color="#16A34A" />*/}
                            {/*        <Text ml="xs" fontSize="sm" color="gray700" style={styles.aboutFeatureText}>條碼盤點</Text>*/}
                            {/*    </View>*/}
                            {/*    <View style={styles.aboutFeatureItem}>*/}
                            {/*        <Icon name="map-pin" fontFamily="Feather" fontSize="md" color="#9333EA" />*/}
                            {/*        <Text ml="xs" fontSize="sm" color="gray700" style={styles.aboutFeatureText}>位置照片</Text>*/}
                            {/*    </View>*/}
                            {/*    <View style={styles.aboutFeatureItem}>*/}
                            {/*        <Icon name="tag" fontFamily="Feather" fontSize="md" color="#EA580C" />*/}
                            {/*        <Text ml="xs" fontSize="sm" color="gray700" style={styles.aboutFeatureText}>標籤輸出</Text>*/}
                            {/*    </View>*/}
                            {/*</View>*/}
                        </View>
                        <TouchableOpacity
                            activeOpacity={0.76}
                            onPress={() => { void openGithubRepository(); }}
                            style={styles.aboutLinkRow}
                        >
                            <Icon name="github" fontFamily="Feather" fontSize="xl" color="#111827" />
                            <View style={styles.aboutLinkText}>
                                <Text fontSize="sm" color="gray500">GitHub Repo</Text>
                                <Text mt={2} fontSize="md" fontWeight="bold" color="gray900" numberOfLines={1}>
                                    yzu1103309/asset-management-app
                                </Text>
                            </View>
                            <Icon name="external-link" fontFamily="Feather" fontSize="lg" color="gray500" />
                        </TouchableOpacity>
                        <View style={styles.aboutInfoRow}>
                            <Icon name="code" fontFamily="Feather" fontSize="lg" color="gray600" />
                            <Text ml="sm" fontSize="md" color="gray800" style={styles.aboutInfoText}>
                                Developer: © 2026 Oscar
                            </Text>
                        </View>
                        <TouchableOpacity activeOpacity={0.76} onPress={() => { void openContactEmail(); }} style={styles.aboutInfoRow}>
                            <Icon name="mail" fontFamily="Feather" fontSize="lg" color="gray600" />
                            <Text ml="sm" fontSize="md" color="gray800" style={styles.aboutInfoText}>
                                Contact: {CONTACT_EMAIL}
                            </Text>
                        </TouchableOpacity>
                        <Text mt={12} fontSize="sm" color="gray500" textAlign="center">
                            Version {require("@/app.json").expo.version}
                        </Text>
                    </View>
                </View>
            </Modal>
            <Modal
                visible={backupOperation !== null}
                transparent
                animationType="fade"
            >
                <View style={styles.centerModalBackdrop}>
                    <View style={styles.backupProgressPanel}>
                        {backupOperation && (
                            <>
                                {backupOperation.completed ? (
                                    <View style={[styles.backupProgressIcon, styles.backupProgressIconCompleted]}>
                                        <Icon name="check" fontFamily="Feather" fontSize={30} color="#16A34A" />
                                    </View>
                                ) : (
                                    <Animated.View style={[styles.backupProgressIcon, {transform: [{rotate: backupSpin}]}]}>
                                        <Icon name="refresh-cw" fontFamily="Feather" fontSize={28} color="#2563EB" />
                                    </Animated.View>
                                )}
                                <Text mt={14} fontSize="xl" fontWeight="bold" color="gray900" textAlign="center">
                                    {backupOperation.title}
                                </Text>
                                <Text mt={8} fontSize="md" color="gray700" textAlign="center" lineHeight={22}>
                                    {backupOperation.message}
                                </Text>
                                {!backupOperation.completed && (
                                    <>
                                        <View
                                            style={styles.backupProgressTrack}
                                            onLayout={(event) => setBackupProgressTrackWidth(event.nativeEvent.layout.width)}
                                        >
                                            <Animated.View
                                                style={[
                                                    styles.backupProgressBar,
                                                    {transform: [{translateX: backupProgressTranslateX}]},
                                                ]}
                                            />
                                        </View>
                                        <Text mt={8} fontSize="sm" color="gray600">
                                            {backupDisplayedProgress}%
                                        </Text>
                                    </>
                                )}
                            </>
                        )}
                    </View>
                </View>
            </Modal>
            <AreaLayoutPreviewModal
                visible={areaLayoutPreview !== null}
                layout={areaLayoutPreview}
                onCancel={() => setAreaLayoutPreview(null)}
                onConfirm={(layout) => { void confirmAreaLayoutImport(layout); }}
            />
            <Modal
                visible={queuedLabelConfirmItems !== null}
                transparent
                animationType="fade"
                onRequestClose={closeQueuedLabelConfirmModal}
            >
                <View style={styles.centerModalBackdrop}>
                    <View style={styles.labelConfirmModalPanel}>
                        <View style={styles.labelConfirmHeader}>
                            <View style={styles.labelConfirmTitleBlock}>
                                <Text fontSize="xl" fontWeight="bold" color="gray900">
                                    確認待製作標籤
                                </Text>
                                <Text mt={4} fontSize="sm" color="gray600">
                                    已勾選 {selectedQueuedLabelKeys.length} / {queuedLabelConfirmItems?.length ?? 0} 個項目
                                </Text>
                            </View>
                            <TouchableOpacity onPress={closeQueuedLabelConfirmModal} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                                <Icon name="x" fontFamily="Feather" fontSize="2xl" color="gray700" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.labelConfirmList} contentContainerStyle={styles.labelConfirmListContent}>
                            {queuedLabelConfirmItems?.map((item, index) => {
                                const key = getLabelConfirmItemKey(item, index);
                                const selected = selectedQueuedLabelKeys.includes(key);

                                return (
                                    <TouchableOpacity
                                        key={key}
                                        activeOpacity={0.75}
                                        onPress={() => toggleQueuedLabelConfirmItem(key)}
                                        style={[styles.labelConfirmItem, selected && styles.labelConfirmItemSelected]}
                                    >
                                        <View style={[styles.labelConfirmCheckBox, selected && styles.labelConfirmCheckBoxSelected]}>
                                            {selected && (
                                                <Icon name="check" fontFamily="Feather" fontSize="md" color="#FFFFFF" />
                                            )}
                                        </View>
                                        <View style={styles.labelConfirmItemText}>
                                            <Text fontSize="md" fontWeight="bold" color="gray900" numberOfLines={1}>
                                                {item.barcode}
                                            </Text>
                                            <Text mt={3} fontSize="sm" color="gray600" numberOfLines={2}>
                                                {item.propertyName}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>

                        <View style={styles.labelConfirmFooter}>
                            <Button
                                flex={1}
                                mr="xs"
                                bg="gray200"
                                color="gray800"
                                rounded={12}
                                onPress={toggleAllQueuedLabelConfirmItems}
                                prefix={<Icon name="check-square" fontFamily="Feather" fontSize="md" mr="xs" color="gray800" />}
                            >
                                {selectedQueuedLabelKeys.length === (queuedLabelConfirmItems?.length ?? 0) ? "全不選" : "全選"}
                            </Button>
                            <Button
                                flex={1}
                                ml="xs"
                                bg="blue500"
                                color="#FFFFFF"
                                rounded={12}
                                disabled={selectedQueuedLabelKeys.length === 0}
                                onPress={() => { void confirmQueuedLabelPdfExport(); }}
                                suffix={<Icon name="export" fontFamily="MaterialCommunityIcons" fontSize="md" ml="xs" color="#FFFFFF" />}
                            >
                                確認輸出
                            </Button>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#F5F6F8",
    },
    content: {
        paddingHorizontal: 18,
        paddingBottom: 30
    },
    scroll: {
        marginTop: 10,
        flex: 1,
    },
    header: {
        paddingHorizontal: 18,
        paddingBottom: 18,
        backgroundColor: "#F5F6F8",
    },
    cloudButtons: {
        flexDirection: "row",
        paddingHorizontal: 14,
        paddingBottom: 14,
    },
    googleConnectButtonText: {
        flexShrink: 1,
        textAlign: "center",
        includeFontPadding: true,
    },
    logModalBackdrop: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "rgba(15, 23, 42, 0.42)",
    },
    logModalPanel: {
        maxHeight: "82%",
        minHeight: "55%",
        paddingTop: 16,
        paddingHorizontal: 16,
        paddingBottom: 20,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        backgroundColor: "#FFFFFF",
    },
    logModalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: 12,
    },
    logTextScroll: {
        flex: 1,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        borderRadius: 8,
        backgroundColor: "#F8FAFC",
    },
    logTextContent: {
        padding: 12,
    },
    logText: {
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 18,
        color: "#0F172A",
    },
    centerModalBackdrop: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
        backgroundColor: "rgba(15, 23, 42, 0.42)",
    },
    versionRecordModalPanel: {
        width: "100%",
        maxWidth: 410,
        maxHeight: "78%",
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 16,
        backgroundColor: "#FFFFFF",
        shadowColor: "#475569",
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 8,
    },
    versionRecordHeader: {
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        paddingRight: 44,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#E5E7EB",
    },
    versionRecordHeaderIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
        // backgroundColor: "#EFF6FF",
    },
    versionRecordTitleBlock: {
        flex: 1,
        minWidth: 0,
        paddingLeft: 0,
    },
    versionRecordCloseButton: {
        position: "absolute",
        top: 2,
        right: 0,
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F3F4F6",
    },
    versionRecordScroll: {
        marginTop: 14,
    },
    versionRecordContent: {
        paddingBottom: 2,
    },
    versionRecordItem: {
        paddingHorizontal: 14,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: "#E5E7EB",
        borderRadius: 12,
        backgroundColor: "#FFFFFF",
        marginBottom: 12,
    },
    versionRecordItemPrimary: {
        borderColor: "#A7F3D0",
        backgroundColor: "#F0FDF4",
    },
    versionRecordSummaryRow: {
        minHeight: 58,
        flexDirection: "row",
        alignItems: "center",
    },
    versionRecordTitleColumn: {
        flex: 1,
        minWidth: 0,
        paddingRight: 12,
    },
    versionRecordBadgeColumn: {
        flexShrink: 0,
        minWidth: 118,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    versionRecordVersionBadge: {
        minHeight: 24,
        justifyContent: "center",
        paddingHorizontal: 9,
        borderRadius: 12,
        backgroundColor: "#DBEAFE",
    },
    versionRecordVersionBadgeCurrent: {
        backgroundColor: "#D1FAE5",
    },
    versionRecordItemTitle: {
        lineHeight: 24,
    },
    versionRecordDateRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 6,
    },
    versionRecordChanges: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#E5E7EB",
    },
    versionRecordChangeRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        marginBottom: 9,
    },
    versionRecordChangeDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginTop: 7,
        marginRight: 9,
        backgroundColor: "#2563EB",
    },
    versionRecordChangeText: {
        flex: 1,
        minWidth: 0,
        lineHeight: 21,
    },
    aboutModalPanel: {
        width: "100%",
        maxWidth: 390,
        borderRadius: 18,
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 20,
        backgroundColor: "#FFFFFF",
        shadowColor: "#475569",
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 8,
    },
    aboutModalHeader: {
        minHeight: 68,
        flexDirection: "row",
        alignItems: "center",
        paddingRight: 44,
    },
    aboutAppIcon: {
        width: 66,
        height: 66,
        borderRadius: 14,
        flexShrink: 0,
    },
    aboutTitleBlock: {
        flex: 1,
        minWidth: 0,
        paddingLeft: 14,
    },
    aboutCloseButton: {
        position: "absolute",
        top: 0,
        right: 0,
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F3F4F6",
    },
    aboutStatement: {
        marginTop: 18,
        paddingTop: 16,
        paddingBottom: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: "#E5E7EB",
    },
    aboutFeatureGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        paddingTop: 12,
    },
    aboutFeatureItem: {
        width: "50%",
        minHeight: 28,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 4,
    },
    aboutFeatureText: {
        flexShrink: 1,
        minWidth: 0,
    },
    aboutLinkRow: {
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: "#E5E7EB",
    },
    aboutLinkText: {
        flex: 1,
        minWidth: 0,
        paddingHorizontal: 12,
    },
    aboutInfoRow: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 12,
    },
    aboutInfoText: {
        flex: 1,
        minWidth: 0,
    },
    labelConfirmModalPanel: {
        width: "100%",
        maxHeight: "78%",
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 14,
        backgroundColor: "#FFFFFF",
        shadowColor: "#475569",
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 8,
    },
    labelConfirmHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        paddingBottom: 12,
    },
    labelConfirmTitleBlock: {
        flex: 1,
        paddingRight: 12,
    },
    labelConfirmList: {
        maxHeight: 430,
        borderRadius: 14,
        backgroundColor: "#F8FAFC",
    },
    labelConfirmListContent: {
        padding: 8,
    },
    labelConfirmItem: {
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 10,
        marginBottom: 8,
        borderRadius: 12,
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#E5E7EB",
    },
    labelConfirmItemSelected: {
        borderColor: "#93C5FD",
        backgroundColor: "#EFF6FF",
    },
    labelConfirmCheckBox: {
        width: 24,
        height: 24,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1.5,
        borderColor: "#CBD5E1",
        backgroundColor: "#FFFFFF",
    },
    labelConfirmCheckBoxSelected: {
        borderColor: "#2563EB",
        backgroundColor: "#2563EB",
    },
    labelConfirmItemText: {
        flex: 1,
        minWidth: 0,
        paddingLeft: 10,
    },
    labelConfirmFooter: {
        flexDirection: "row",
        paddingTop: 12,
    },
    backupProgressPanel: {
        width: "100%",
        maxWidth: 360,
        minHeight: 210,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 24,
        backgroundColor: "#FFFFFF",
        shadowColor: "#475569",
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.16,
        shadowRadius: 20,
        elevation: 8,
    },
    backupProgressIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#EFF6FF",
    },
    backupProgressIconCompleted: {
        backgroundColor: "#DCFCE7",
    },
    backupProgressTrack: {
        width: "100%",
        height: 8,
        marginTop: 16,
        borderRadius: 4,
        overflow: "hidden",
        backgroundColor: "#E5E7EB",
    },
    backupProgressBar: {
        width: "100%",
        height: "100%",
        borderRadius: 4,
        backgroundColor: "#2563EB",
    },
})
