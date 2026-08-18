import AsyncStorage from "@react-native-async-storage/async-storage";
import {Directory, File, Paths} from "expo-file-system";
import {ImageManipulator, SaveFormat} from "expo-image-manipulator";
import {
    parseStoredPropertyItems,
    PROPERTY_ITEMS_STORAGE_KEY,
    type PropertyItem,
    type PropertyItemsByBarcode,
    type PropertyPhoto,
} from "./propertyItemStore.ts";

const PROPERTY_PHOTO_DIRECTORY_NAME = "property-photos";
const PROPERTY_PHOTO_MAX_SIDE = 1600;
const PROPERTY_PHOTO_JPEG_COMPRESS = 0.75;

type SourcePhoto = {
    uri: string;
    width?: number | null;
    height?: number | null;
};

function sanitizeFileNamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getPhotoDirectory(): Directory {
    const directory = new Directory(Paths.document, PROPERTY_PHOTO_DIRECTORY_NAME);
    if (!directory.exists) directory.create({intermediates: true});

    return directory;
}

function getResizeTarget(source: SourcePhoto): {width?: number; height?: number} | null {
    const width = source.width ?? 0;
    const height = source.height ?? 0;
    const maxSide = Math.max(width, height);
    if (!width || !height || maxSide <= PROPERTY_PHOTO_MAX_SIDE) return null;

    return width >= height
        ? {width: PROPERTY_PHOTO_MAX_SIDE}
        : {height: PROPERTY_PHOTO_MAX_SIDE};
}

export async function compressAndStorePropertyPhoto(
    source: SourcePhoto,
    barcode: string,
    entityIndex: number,
): Promise<PropertyPhoto> {
    const context = ImageManipulator.manipulate(source.uri);
    const resizeTarget = getResizeTarget(source);
    if (resizeTarget) context.resize(resizeTarget);

    const renderedImage = await context.renderAsync();
    const compressed = await renderedImage.saveAsync({
        format: SaveFormat.JPEG,
        compress: PROPERTY_PHOTO_JPEG_COMPRESS,
    });

    const createdAt = new Date().toISOString();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileName = `${sanitizeFileNamePart(barcode)}-${entityIndex}-${id}.jpg`;
    const sourceFile = new File(compressed.uri);
    const destinationFile = new File(getPhotoDirectory(), fileName);

    if (destinationFile.exists) destinationFile.delete();
    sourceFile.copy(destinationFile);

    try {
        if (sourceFile.exists) sourceFile.delete();
    } catch {
        // Cache cleanup failure is non-fatal.
    }

    return {
        id,
        uri: destinationFile.uri,
        fileName,
        mimeType: "image/jpeg",
        width: compressed.width,
        height: compressed.height,
        size: destinationFile.size,
        createdAt,
    };
}

export async function addPropertyItemPhoto(
    barcode: string,
    entityIndex: number,
    photo: PropertyPhoto,
): Promise<PropertyItem> {
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const bucket = storedItems[barcode] ?? [];
    const currentItem = bucket[entityIndex];
    if (!currentItem) {
        throw new Error("找不到要新增照片的財產項目。");
    }

    const updatedItem: PropertyItem = {
        ...currentItem,
        photos: [...(currentItem.photos ?? []), photo],
        updatedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify({
        ...storedItems,
        [barcode]: bucket.map((item, index) => index === entityIndex ? updatedItem : item),
    }));

    return updatedItem;
}

function deletePropertyPhotoFile(photo: PropertyPhoto): void {
    try {
        const file = new File(photo.uri);
        if (file.exists) file.delete();
    } catch (error) {
        console.warn("刪除財產照片檔案失敗:", photo.uri, error);
    }
}

async function updateStoredPropertyPhotoBucket(
    barcode: string,
    entityIndex: number,
    updater: (currentItem: PropertyItem, storedItems: PropertyItemsByBarcode) => PropertyItem,
): Promise<PropertyItem> {
    const storedItems = parseStoredPropertyItems(await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY));
    const bucket = storedItems[barcode] ?? [];
    const currentItem = bucket[entityIndex];
    if (!currentItem) {
        throw new Error("找不到要更新照片的財產項目。");
    }

    const updatedItem = updater(currentItem, storedItems);

    await AsyncStorage.setItem(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify({
        ...storedItems,
        [barcode]: bucket.map((item, index) => index === entityIndex ? updatedItem : item),
    }));

    return updatedItem;
}

export async function replacePropertyItemPhoto(
    barcode: string,
    entityIndex: number,
    photoId: string,
    nextPhoto: PropertyPhoto,
): Promise<PropertyItem> {
    return updateStoredPropertyPhotoBucket(barcode, entityIndex, (currentItem) => {
        const previousPhoto = currentItem.photos?.find((photo) => photo.id === photoId);
        if (previousPhoto) deletePropertyPhotoFile(previousPhoto);

        return {
            ...currentItem,
            photos: (currentItem.photos ?? []).map((photo) => photo.id === photoId ? nextPhoto : photo),
            updatedAt: new Date().toISOString(),
        };
    });
}

export async function removePropertyItemPhoto(
    barcode: string,
    entityIndex: number,
    photoId: string,
): Promise<PropertyItem> {
    return updateStoredPropertyPhotoBucket(barcode, entityIndex, (currentItem) => {
        const removedPhoto = currentItem.photos?.find((photo) => photo.id === photoId);
        if (removedPhoto) deletePropertyPhotoFile(removedPhoto);

        return {
            ...currentItem,
            photos: (currentItem.photos ?? []).filter((photo) => photo.id !== photoId),
            updatedAt: new Date().toISOString(),
        };
    });
}
