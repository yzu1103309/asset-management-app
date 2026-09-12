import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {StyleSheet, View} from "react-native";
import {Camera, useCameraDevice, type CameraRef} from "react-native-vision-camera";
import {
    useBarcodeScannerOutput,
    type Barcode,
    type TargetBarcodeFormat,
} from "react-native-vision-camera-barcode-scanner";

const CAMERA_DEVICE_DISCOVERY_TIMEOUT_MS = 8 * 1000;

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
    const [isPreviewStarted, setIsPreviewStarted] = useState(false);
    const cameraRef = useRef<CameraRef>(null);
    const zoomOperationRef = useRef<Promise<void>>(Promise.resolve());
    const torchOperationRef = useRef<Promise<void>>(Promise.resolve());
    const requestedZoomRef = useRef(1);
    const requestedTorchRef = useRef<"off" | "on">("off");
    const readyReportedRef = useRef(false);
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
    const handlePreviewStarted = useCallback(() => {
        setIsPreviewStarted(true);
    }, []);
    const reportReady = useCallback(() => {
        if (readyReportedRef.current) return;

        readyReportedRef.current = true;
        onReady();
    }, [onReady]);

    useEffect(() => {
        if (device || !active) return;

        const timeout = setTimeout(() => {
            onError(new Error("VisionCamera 找不到可用的後置相機。"));
        }, CAMERA_DEVICE_DISCOVERY_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, [active, device, onError]);

    useEffect(() => {
        if (!active || !isPreviewStarted) return;
        if (requestedZoomRef.current === effectiveZoom) {
            reportReady();
            return;
        }

        requestedZoomRef.current = effectiveZoom;
        let effectActive = true;
        const operation = zoomOperationRef.current.then(async () => {
            if (!effectActive) return;
            const controller = cameraRef.current?.controller;
            if (!controller) throw new Error("VisionCamera 控制器尚未就緒。");

            await controller.setZoom(effectiveZoom);
            if (effectActive) reportReady();
        });
        zoomOperationRef.current = operation.catch((error: unknown) => {
            if (effectActive) onError(error instanceof Error ? error : new Error(String(error)));
        });

        return () => {
            effectActive = false;
        };
    }, [active, effectiveZoom, isPreviewStarted, onError, reportReady]);

    useEffect(() => {
        if (!active || !isPreviewStarted || !readyReportedRef.current || !device?.hasTorch) return;

        const nextTorchMode = enableTorch ? "on" : "off";
        if (requestedTorchRef.current === nextTorchMode) return;

        requestedTorchRef.current = nextTorchMode;
        let effectActive = true;
        const operation = torchOperationRef.current.then(async () => {
            if (!effectActive) return;
            const controller = cameraRef.current?.controller;
            if (!controller) throw new Error("VisionCamera 控制器尚未就緒。");

            await controller.setTorchMode(nextTorchMode);
        });
        torchOperationRef.current = operation.catch((error: unknown) => {
            if (effectActive) onError(error instanceof Error ? error : new Error(String(error)));
        });

        return () => {
            effectActive = false;
        };
    }, [active, device?.hasTorch, enableTorch, isPreviewStarted, onError]);

    if (!device) return <View style={styles.placeholder} />;

    return (
        <Camera
            ref={cameraRef}
            style={styles.camera}
            device={device}
            isActive={active}
            outputs={outputs}
            enableDistortionCorrection={false}
            enableNativeTapToFocusGesture
            resizeMode="cover"
            onPreviewStarted={handlePreviewStarted}
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
