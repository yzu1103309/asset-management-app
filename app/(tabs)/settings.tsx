import React, {useCallback, useEffect, useRef, useState} from "react";
import {Alert, Animated, Easing, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View} from "react-native";
import {type Href, router} from "expo-router";
import {Button, Icon, Text} from "react-native-magnus";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {MaterialIcons} from "@expo/vector-icons";
import Constants from "expo-constants";
import {inDevHandler} from "@/components/inDev";
import {usePrompt} from "@/hooks/usePrompt";
import {useSafeAreaActionSheet} from "@/hooks/useSafeAreaActionSheet";
import {clearAllLocalData} from "@/handlers/clearDatabase";
import {useSpinner} from "@/context/SpinnerContext";
import {MenuRow, Section, SettingRow} from "@/components/settings/SettingsRows";
import {File} from "expo-file-system";
import {getStoredPropertyItems, importPropertyFileBytes} from "@/handlers/propertyImport";
import {getPropertySpreadsheetSheetNames} from "@/handlers/propertySpreadsheetParser";
import {getStoredAreaLayout, parseDrawioAreaLayout, saveAreaLayout, type AreaLayout} from "@/handlers/areaLayout";
import {findMissingAreaLayoutBindings, type BoundAreaReference} from "@/handlers/areaLayoutCompatibility";
import AreaLayoutPreviewModal from "@/components/settings/AreaLayoutPreviewModal";
import {clearPropertyLabelQueue, getPropertyLabelQueue} from "@/handlers/propertyLabelQueue";
import {getPropertyLabelPrintItems, type PropertyLabelPrintItem} from "@/handlers/propertyLabelPrintHtml";
import {
    cleanupPropertyLabelPdf,
    createPropertyLabelPdf,
    sharePropertyLabelPdf,
    type PropertyLabelPdfExportResult,
    type PropertyLabelPdfProgress,
} from "@/handlers/propertyLabelPdf";
import {
    cleanupPropertyExcelFile,
    createPropertyExcelFile,
    sharePropertyExcelFile,
    type PropertyExcelExportResult,
} from "@/handlers/propertyExcelExport";
import {
    cleanupBackupFile,
    createFullBackupFile,
    getExistingBackupTargetSummary,
    restoreFullBackupFile,
    shareBackupFile,
    type BackupExportResult,
    type BackupProgress,
} from "@/handlers/propertyBackup";

type ProgressUpdate = BackupProgress | PropertyLabelPdfProgress;

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
    const [backupDisplayedProgress, setBackupDisplayedProgress] = useState(1);
    const [backupProgressTrackWidth, setBackupProgressTrackWidth] = useState(0);
    const backupSpinValue = useRef(new Animated.Value(0)).current;
    const backupProgressValue = useRef(new Animated.Value(1)).current;
    const backupProgressTextTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const backupProgressAnimationVersionRef = useRef(0);
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

    const updateProgressOperation = useCallback((title: string, progress: ProgressUpdate) => {
        driveProgressBar(progress);
        driveProgressText(progress);
        setBackupOperation({title, ...progress, completed: progress.progress >= 100});
    }, [driveProgressBar, driveProgressText]);

    const handlePropertyImport = useCallback(async () => {
        const currentAreaLayout = await getStoredAreaLayout().catch(() => null);
        if (!currentAreaLayout && !(await confirmPropertyImportWithoutAreaLayout())) return;

        try {
            const selectedFile = await File.pickFileAsync();
            const file = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;

            if (!file) return;

            // SDK 54 exposes `name` at runtime, but its inherited File type does not declare it.
            const sourceName = (file as File & {name?: string}).name;
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
        try {
            showSpinner({locked: true});
            const selectedFile = await File.pickFileAsync();
            const file = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;

            if (!file) return;

            const sourceName = (file as File & {name?: string}).name;
            const layout = parseDrawioAreaLayout(await file.text(), sourceName);
            setAreaLayoutPreview(layout);
        } catch (error) {
            const message = getErrorMessage(error) ?? "無法讀取或解析此 drawio 檔案。";
            if (/cancel/i.test(message)) return;

            console.error("空間配置匯入失敗:", error);
            Alert.alert("匯入失敗", message);
        } finally {
            hideSpinner({force: true});
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

        try {
            showSpinner({locked: true});
            const [itemsByBarcode, queuedBarcodes] = await Promise.all([
                getStoredPropertyItems(),
                mode === "queued" ? getPropertyLabelQueue() : Promise.resolve(undefined),
            ]);

            if (mode === "queued" && queuedBarcodes?.length === 0) {
                Alert.alert("沒有待製作標籤", "目前尚未加入任何待製作財產標籤。");
                return;
            }

            labels = getPropertyLabelPrintItems(itemsByBarcode, queuedBarcodes);
            if (labels.length === 0) {
                Alert.alert("沒有可輸出的資料", mode === "queued"
                    ? "待製作清單中的財產編號找不到對應資料。"
                    : "請先匯入財產資料。");
                return;
            }
        } catch (error) {
            console.error("讀取財產標籤資料失敗:", error);
            Alert.alert("讀取失敗", "無法讀取財產標籤資料，請稍後再試。");
            return;
        } finally {
            hideSpinner({force: true});
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

        try {
            showSpinner({locked: true});
            exportedExcel = await createPropertyExcelFile();
            shouldCleanupExportedExcel = true;

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
            Alert.alert("匯出失敗", message);
        } finally {
            if (exportedExcel && shouldCleanupExportedExcel) {
                cleanupPropertyExcelFile(exportedExcel);
            }
            hideSpinner({force: true});
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
            const selectedFile = await File.pickFileAsync();
            const file = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;
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
                    <MenuRow title="詳細使用說明" icon="help-circle" iconFamily="Feather" onPress={showComingSoon} />
                    <MenuRow title="功能更新紀錄" icon="history" iconFamily="Octicons" onPress={showComingSoon} />
                    <MenuRow title="關於此軟體" icon="info" iconFamily="Feather" onPress={showComingSoon} />
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
                                                {item.itemNumber}｜{item.propertyName}
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
