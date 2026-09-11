import {memo, useCallback, useEffect, useMemo} from "react";
import {StyleSheet, View} from "react-native";
import {Camera, useCameraDevice} from "react-native-vision-camera";
import {
    useBarcodeScannerOutput,
    type Barcode,
    type TargetBarcodeFormat,
} from "react-native-vision-camera-barcode-scanner";

type VisionCameraScannerProps = {
    active: boolean;
    barcodeFormats: TargetBarcodeFormat[];
    enableTorch: boolean;
    zoom: number;
    onBarcodeScanned: (value: string) => void;
    onError: (error: Error) => void;
    onReady: () => void;
};

const VisionCameraScanner = memo(function VisionCameraScanner({
    active,
    barcodeFormats,
    enableTorch,
    zoom,
    onBarcodeScanned,
    onError,
    onReady,
}: VisionCameraScannerProps) {
    const device = useCameraDevice("back", {physicalDevices: ["wide-angle"]});
    const handleBarcodes = useCallback((barcodes: Barcode[]) => {
        const value = barcodes
            .map((barcode) => barcode.rawValue ?? barcode.displayValue)
            .find((candidate) => typeof candidate === "string" && candidate.length > 0);
        if (value !== undefined) onBarcodeScanned(value);
    }, [onBarcodeScanned]);
    const barcodeOutput = useBarcodeScannerOutput({
        barcodeFormats,
        outputResolution: "full",
        onBarcodeScanned: handleBarcodes,
        onError,
    });
    const outputs = useMemo(() => [barcodeOutput], [barcodeOutput]);
    const effectiveZoom = device
        ? Math.min(device.maxZoom, Math.max(device.minZoom, zoom))
        : zoom;

    useEffect(() => {
        if (device || !active) return;

        const timeout = setTimeout(() => {
            onError(new Error("VisionCamera 找不到可用的後置相機。"));
        }, 1200);
        return () => clearTimeout(timeout);
    }, [active, device, onError]);

    if (!device) return <View style={styles.placeholder} />;

    return (
        <Camera
            style={styles.camera}
            device={device}
            isActive={active}
            outputs={outputs}
            zoom={effectiveZoom}
            torchMode={device.hasTorch ? (enableTorch ? "on" : "off") : undefined}
            enableDistortionCorrection={false}
            enableLowLightBoost={device.supportsLowLightBoost}
            enableNativeTapToFocusGesture
            resizeMode="cover"
            onPreviewStarted={onReady}
            onError={onError}
        />
    );
});

export default VisionCameraScanner;

const styles = StyleSheet.create({
    camera: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    placeholder: {
        flex: 1,
        backgroundColor: "#111827",
    },
});
