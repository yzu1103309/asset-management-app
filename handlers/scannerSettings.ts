import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, {ExecutionEnvironment} from "expo-constants";
import {Platform} from "react-native";
import type {BarcodeType} from "expo-camera";

export const SCANNER_SETTINGS_STORAGE_KEY = "@ncu-property-checking/scanner-settings:v1";

export type ScannerProvider = "vision-camera" | "expo-camera";
export type ScannerBarcodeFormat =
    | "qr"
    | "code39"
    | "code128"
    | "code93"
    | "codabar"
    | "ean13"
    | "ean8"
    | "upcA"
    | "upcE"
    | "itf"
    | "pdf417"
    | "aztec"
    | "dataMatrix";

export type VisionCameraBarcodeFormat =
    | "aztec"
    | "codabar"
    | "code-128"
    | "code-39"
    | "code-93"
    | "data-matrix"
    | "ean-13"
    | "ean-8"
    | "itf"
    | "pdf-417"
    | "qr-code"
    | "upc-a"
    | "upc-e";

export type ScannerSettings = {
    provider: ScannerProvider;
    enabledFormats: ScannerBarcodeFormat[];
};

export type ScannerBarcodeFormatDefinition = {
    id: ScannerBarcodeFormat;
    label: string;
    description: string;
    expoCameraType: BarcodeType;
    visionCameraType: VisionCameraBarcodeFormat;
};

export const SCANNER_BARCODE_FORMATS: readonly ScannerBarcodeFormatDefinition[] = [
    {id: "qr", label: "QR Code", description: "二維條碼", expoCameraType: "qr", visionCameraType: "qr-code"},
    {id: "code39", label: "Code 39", description: "財產標籤常用格式", expoCameraType: "code39", visionCameraType: "code-39"},
    {id: "code128", label: "Code 128", description: "高密度一維條碼", expoCameraType: "code128", visionCameraType: "code-128"},
    {id: "code93", label: "Code 93", description: "緊湊型一維條碼", expoCameraType: "code93", visionCameraType: "code-93"},
    {id: "codabar", label: "Codabar", description: "圖書與物流常用格式", expoCameraType: "codabar", visionCameraType: "codabar"},
    {id: "ean13", label: "EAN-13", description: "13 位商品條碼", expoCameraType: "ean13", visionCameraType: "ean-13"},
    {id: "ean8", label: "EAN-8", description: "8 位商品條碼", expoCameraType: "ean8", visionCameraType: "ean-8"},
    {id: "upcA", label: "UPC-A", description: "12 位商品條碼", expoCameraType: "upc_a", visionCameraType: "upc-a"},
    {id: "upcE", label: "UPC-E", description: "壓縮型商品條碼", expoCameraType: "upc_e", visionCameraType: "upc-e"},
    {id: "itf", label: "ITF", description: "交錯式二之五條碼", expoCameraType: "itf14", visionCameraType: "itf"},
    {id: "pdf417", label: "PDF417", description: "堆疊式二維條碼", expoCameraType: "pdf417", visionCameraType: "pdf-417"},
    {id: "aztec", label: "Aztec", description: "Aztec 二維條碼", expoCameraType: "aztec", visionCameraType: "aztec"},
    {id: "dataMatrix", label: "Data Matrix", description: "小型二維條碼", expoCameraType: "datamatrix", visionCameraType: "data-matrix"},
] as const;

const FORMAT_IDS = new Set<ScannerBarcodeFormat>(SCANNER_BARCODE_FORMATS.map(({id}) => id));
const DEFAULT_ENABLED_FORMATS: ScannerBarcodeFormat[] = ["qr", "code39"];

export function isExpoGo(): boolean {
    return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export function canUseVisionCamera(): boolean {
    return !isExpoGo() && (Platform.OS === "android" || Platform.OS === "ios");
}

export function getAvailableScannerProviders(): ScannerProvider[] {
    return canUseVisionCamera()
        ? ["vision-camera", "expo-camera"]
        : ["expo-camera"];
}

export function getDefaultScannerSettings(): ScannerSettings {
    return {
        provider: "vision-camera",
        enabledFormats: [...DEFAULT_ENABLED_FORMATS],
    };
}

export function parseStoredScannerSettings(value: string | null): ScannerSettings {
    if (!value) return getDefaultScannerSettings();

    try {
        const parsed = JSON.parse(value) as Partial<ScannerSettings>;
        const provider: ScannerProvider = parsed.provider === "expo-camera" ? "expo-camera" : "vision-camera";
        const enabledFormats = Array.isArray(parsed.enabledFormats)
            ? [...new Set(parsed.enabledFormats.filter((format): format is ScannerBarcodeFormat => (
                typeof format === "string" && FORMAT_IDS.has(format as ScannerBarcodeFormat)
            )))]
            : [];

        return {
            provider,
            enabledFormats: enabledFormats.length > 0 ? enabledFormats : [...DEFAULT_ENABLED_FORMATS],
        };
    } catch {
        return getDefaultScannerSettings();
    }
}

export function resolveScannerProvider(preferredProvider: ScannerProvider): ScannerProvider {
    return preferredProvider === "vision-camera" && canUseVisionCamera()
        ? "vision-camera"
        : "expo-camera";
}

export function getExpoCameraBarcodeTypes(enabledFormats: ScannerBarcodeFormat[]): BarcodeType[] {
    const enabled = new Set(enabledFormats);
    return SCANNER_BARCODE_FORMATS
        .filter(({id}) => enabled.has(id))
        .map(({expoCameraType}) => expoCameraType);
}

export function getVisionCameraBarcodeFormats(enabledFormats: ScannerBarcodeFormat[]): VisionCameraBarcodeFormat[] {
    const enabled = new Set(enabledFormats);
    return SCANNER_BARCODE_FORMATS
        .filter(({id}) => enabled.has(id))
        .map(({visionCameraType}) => visionCameraType);
}

export async function getStoredScannerSettings(): Promise<ScannerSettings> {
    return parseStoredScannerSettings(await AsyncStorage.getItem(SCANNER_SETTINGS_STORAGE_KEY));
}

export async function saveScannerSettings(settings: ScannerSettings): Promise<void> {
    const normalized = parseStoredScannerSettings(JSON.stringify(settings));
    await AsyncStorage.setItem(SCANNER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
}
