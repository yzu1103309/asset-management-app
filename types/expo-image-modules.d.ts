declare module "expo-image-picker" {
    export type PermissionResponse = {
        granted: boolean;
        canAskAgain: boolean;
        status: string;
    };

    export type ImagePickerAsset = {
        uri: string;
        width?: number;
        height?: number;
        fileName?: string | null;
        fileSize?: number;
        mimeType?: string;
        type?: string;
    };

    export type ImagePickerResult =
        | {canceled: true; assets: null}
        | {canceled: false; assets: ImagePickerAsset[]};

    export type ImagePickerOptions = {
        mediaTypes?: string[];
        allowsEditing?: boolean;
        aspect?: [number, number];
        quality?: number;
        exif?: boolean;
        base64?: boolean;
    };

    export function requestCameraPermissionsAsync(): Promise<PermissionResponse>;
    export function requestMediaLibraryPermissionsAsync(writeOnly?: boolean): Promise<PermissionResponse>;
    export function launchCameraAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
    export function launchImageLibraryAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
}

declare module "expo-image-manipulator" {
    export const SaveFormat: {
        JPEG: "jpeg";
        PNG: "png";
        WEBP: "webp";
    };

    export type SaveOptions = {
        compress?: number;
        format?: "jpeg" | "png" | "webp";
        base64?: boolean;
    };

    export type ImageResult = {
        uri: string;
        width: number;
        height: number;
    };

    export type ImageRef = {
        saveAsync(options?: SaveOptions): Promise<ImageResult>;
    };

    export type ImageManipulatorContext = {
        resize(size: {width?: number | null; height?: number | null}): ImageManipulatorContext;
        renderAsync(): Promise<ImageRef>;
    };

    export const ImageManipulator: {
        manipulate(source: string): ImageManipulatorContext;
    };
}

declare module "expo-media-library" {
    export type PermissionResponse = {
        granted: boolean;
        canAskAgain?: boolean;
        status: string;
    };

    export function isAvailableAsync(): Promise<boolean>;
    export function requestPermissionsAsync(writeOnly?: boolean, granularPermissions?: string[]): Promise<PermissionResponse>;
    export function saveToLibraryAsync(localUri: string): Promise<void>;
}
