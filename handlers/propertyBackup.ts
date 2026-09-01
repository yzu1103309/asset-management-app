import AsyncStorage from "@react-native-async-storage/async-storage";
import {Directory, File, Paths} from "expo-file-system";
import * as Sharing from "expo-sharing";
import Constants from "expo-constants";
import {Platform} from "react-native";
import {AREA_LAYOUT_STORAGE_KEY} from "./areaLayout.ts";
import {PROPERTY_ITEMS_STORAGE_KEY, parseStoredPropertyItems, type PropertyItemsByBarcode, type PropertyPhoto} from "./propertyItemStore.ts";
import {PROPERTY_LABEL_QUEUE_STORAGE_KEY} from "./propertyLabelQueue.ts";
import {PROPERTY_STATUS_VALUES} from "./propertyStatusStore.ts";
import {PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY} from "./propertyTextSuggestions.ts";

const BACKUP_MAGIC = "astalog-full-backup";
const BACKUP_VERSION = 1;
const BACKUP_FILE_EXTENSION = "bast";
const PROPERTY_PHOTO_DIRECTORY_NAME = "property-photos";
const APP_STORAGE_PREFIX = "@ncu-property-checking/";
const PROPERTY_STATUS_STORAGE_KEY_PATTERN = new RegExp(`^\\d{3,4}_(${PROPERTY_STATUS_VALUES.join("|")})$`);
const KNOWN_STORAGE_KEYS = new Set([
    PROPERTY_ITEMS_STORAGE_KEY,
    AREA_LAYOUT_STORAGE_KEY,
    PROPERTY_LABEL_QUEUE_STORAGE_KEY,
    PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY,
]);
const BACKUP_KEY = process.env.EXPO_PUBLIC_ASTALOG_BACKUP_KEY ?? "";
const BASE64_CHUNK_BYTE_LENGTH = 192 * 1024;
const BASE64_CHUNK_CHAR_LENGTH = (BASE64_CHUNK_BYTE_LENGTH / 3) * 4;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const SHA256_INITIAL_HASHES = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export type BackupProgress = {
    message: string;
    progress: number;
    targetProgress?: number;
    millisecondsPerPercent?: number;
    active?: boolean;
    current?: number;
    total?: number;
};

export type BackupExportResult = {
    uri: string;
    fileName: string;
    storageKeyCount: number;
    photoCount: number;
    encrypted: boolean;
};

export type BackupRestoreResult = {
    storageKeyCount: number;
    photoCount: number;
    encrypted: boolean;
    createdAt: string;
};

export type ExistingBackupTargetSummary = {
    storageKeyCount: number;
    photoCount: number;
    propertyItemCount: number;
    hasData: boolean;
};

type StoredTextEntry = {
    key: string;
    valueBase64: string;
    sha256: string;
    byteLength: number;
};

type StoredFileEntry = {
    relativePath: string;
    contentBase64: string;
    sha256?: string;
    md5?: string;
    byteLength: number;
};

type BackupPhotoFile = {
    file: File;
    relativePath: string;
};

type BackupReadableFile = {
    text: () => Promise<string>;
};

type BackupPayload = {
    schemaVersion: number;
    createdAt: string;
    appVersion: string | null;
    platform: string;
    storage: StoredTextEntry[];
    files: StoredFileEntry[];
};

type BackupEnvelope = {
    magic: typeof BACKUP_MAGIC;
    version: number;
    createdAt: string;
    appVersion: string | null;
    encrypted: boolean;
    integrityMode: "entry-hash-v1";
    payloadEncoding: "base64-json" | "base64-xor-sha256-stream";
    payload: string;
    payloadSha256?: string;
    contentSha256?: string;
    keyedManifestSha256?: string;
    nonce?: string;
};

function isBackupStorageKey(key: string): boolean {
    return KNOWN_STORAGE_KEYS.has(key) || key.startsWith(APP_STORAGE_PREFIX) || PROPERTY_STATUS_STORAGE_KEY_PATTERN.test(key);
}

function getBackupKey(): string {
    return BACKUP_KEY.trim();
}

function getAppVersion(): string | null {
    return Constants.expoConfig?.version ?? null;
}

function getFileMd5(file: File): string | undefined {
    try {
        return typeof file.md5 === "string" && file.md5.length > 0 ? file.md5 : undefined;
    } catch {
        return undefined;
    }
}

function createPayloadManifest(payload: BackupPayload, payloadLength: number): string {
    return JSON.stringify({
        schemaVersion: payload.schemaVersion,
        createdAt: payload.createdAt,
        appVersion: payload.appVersion,
        platform: payload.platform,
        payloadLength,
        storage: payload.storage.map((entry) => ({
            key: entry.key,
            sha256: entry.sha256,
            byteLength: entry.byteLength,
        })),
        files: payload.files.map((entry) => ({
            relativePath: entry.relativePath,
            md5: entry.md5,
            sha256: entry.sha256,
            byteLength: entry.byteLength,
            contentLength: entry.contentBase64.length,
        })),
    });
}

async function stringifyBackupPayload(payload: BackupPayload): Promise<string> {
    const chunks: string[] = [
        "{\"schemaVersion\":",
        String(payload.schemaVersion),
        ",\"createdAt\":",
        JSON.stringify(payload.createdAt),
        ",\"appVersion\":",
        JSON.stringify(payload.appVersion),
        ",\"platform\":",
        JSON.stringify(payload.platform),
        ",\"storage\":[",
    ];

    for (let index = 0; index < payload.storage.length; index += 1) {
        const entry = payload.storage[index];
        if (index > 0) chunks.push(",");
        chunks.push(
            "{\"key\":",
            JSON.stringify(entry.key),
            ",\"valueBase64\":\"",
            entry.valueBase64,
            "\",\"sha256\":",
            JSON.stringify(entry.sha256),
            ",\"byteLength\":",
            String(entry.byteLength),
            "}",
        );
        if (index % 8 === 0) await yieldToUi();
    }

    chunks.push("],\"files\":[");
    for (let index = 0; index < payload.files.length; index += 1) {
        const entry = payload.files[index];
        if (index > 0) chunks.push(",");
        chunks.push(
            "{\"relativePath\":",
            JSON.stringify(entry.relativePath),
            ",\"contentBase64\":\"",
            entry.contentBase64,
            "\"",
        );
        if (entry.sha256 !== undefined) chunks.push(",\"sha256\":", JSON.stringify(entry.sha256));
        if (entry.md5 !== undefined) chunks.push(",\"md5\":", JSON.stringify(entry.md5));
        chunks.push(
            ",\"byteLength\":",
            String(entry.byteLength),
            "}",
        );
        await yieldToUi();
    }

    chunks.push("]}");
    await yieldToUi();

    return chunks.join("");
}

function stringifyBackupEnvelope(envelope: BackupEnvelope): string {
    const chunks = [
        "{\"magic\":",
        JSON.stringify(envelope.magic),
        ",\"version\":",
        String(envelope.version),
        ",\"createdAt\":",
        JSON.stringify(envelope.createdAt),
        ",\"appVersion\":",
        JSON.stringify(envelope.appVersion),
        ",\"encrypted\":",
        envelope.encrypted ? "true" : "false",
        ",\"integrityMode\":",
        JSON.stringify(envelope.integrityMode),
        ",\"payloadEncoding\":",
        JSON.stringify(envelope.payloadEncoding),
        ",\"payload\":\"",
        envelope.payload,
        "\"",
    ];

    if (envelope.payloadSha256 !== undefined) chunks.push(",\"payloadSha256\":", JSON.stringify(envelope.payloadSha256));
    if (envelope.contentSha256 !== undefined) chunks.push(",\"contentSha256\":", JSON.stringify(envelope.contentSha256));
    if (envelope.keyedManifestSha256 !== undefined) chunks.push(",\"keyedManifestSha256\":", JSON.stringify(envelope.keyedManifestSha256));
    if (envelope.nonce !== undefined) chunks.push(",\"nonce\":", JSON.stringify(envelope.nonce));
    chunks.push("}");

    return chunks.join("");
}

function padDatePart(value: number): string {
    return String(value).padStart(2, "0");
}

function formatBackupFileTimestamp(date: Date): string {
    return [
        date.getFullYear(),
        padDatePart(date.getMonth() + 1),
        padDatePart(date.getDate()),
        padDatePart(date.getHours()),
        padDatePart(date.getMinutes()),
        padDatePart(date.getSeconds()),
    ].join("");
}

function getTextEndProgress(hasPhotos: boolean): number {
    return hasPhotos ? 20 : 90;
}

function getPhotoStepProgress(index: number, total: number): {start: number; end: number} {
    const safeTotal = Math.max(total, 1);
    const start = 20 + (Math.max(index, 0) / safeTotal) * 70;
    const end = Math.min(90, 20 + ((Math.max(index, 0) + 1) / safeTotal) * 70);

    return {start, end};
}

function bytesToBase64(bytes: Uint8Array): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let output = "";
    let index = 0;

    for (; index + 2 < bytes.length; index += 3) {
        const block = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
        output += alphabet[(block >> 18) & 63]
            + alphabet[(block >> 12) & 63]
            + alphabet[(block >> 6) & 63]
            + alphabet[block & 63];
    }

    if (index < bytes.length) {
        const first = bytes[index];
        const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
        const block = (first << 16) | (second << 8);
        output += alphabet[(block >> 18) & 63] + alphabet[(block >> 12) & 63];
        output += index + 1 < bytes.length ? alphabet[(block >> 6) & 63] : "=";
        output += "=";
    }

    return output;
}

function base64ToBytes(value: string): Uint8Array {
    const normalized = value.replace(/\s/g, "");
    if (normalized.length % 4 !== 0) throw new Error("備份檔案 base64 內容格式不正確。");

    const lookup = new Map<string, number>();
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").forEach((char, index) => {
        lookup.set(char, index);
    });

    const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
    const output = new Uint8Array((normalized.length / 4) * 3 - padding);
    let outputIndex = 0;

    for (let index = 0; index < normalized.length; index += 4) {
        const chars = normalized.slice(index, index + 4);
        const values = chars.split("").map((char) => {
            if (char === "=") return 0;
            const decoded = lookup.get(char);
            if (decoded === undefined) throw new Error("備份檔案 base64 內容格式不正確。");
            return decoded;
        });
        const block = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];

        if (outputIndex < output.length) output[outputIndex++] = (block >> 16) & 255;
        if (outputIndex < output.length) output[outputIndex++] = (block >> 8) & 255;
        if (outputIndex < output.length) output[outputIndex++] = block & 255;
    }

    return output;
}

function textToBase64(value: string): string {
    return bytesToBase64(TEXT_ENCODER.encode(value));
}

async function textToBase64Async(value: string): Promise<string> {
    return bytesToBase64Async(TEXT_ENCODER.encode(value));
}

function base64ToText(value: string): string {
    return TEXT_DECODER.decode(base64ToBytes(value));
}

async function base64ToTextAsync(value: string): Promise<string> {
    return TEXT_DECODER.decode(await base64ToBytesAsync(value));
}

async function bytesToBase64Async(bytes: Uint8Array): Promise<string> {
    if (bytes.length <= BASE64_CHUNK_BYTE_LENGTH) return bytesToBase64(bytes);

    const chunks: string[] = [];
    let offset = 0;

    while (offset < bytes.length) {
        const candidateEnd = Math.min(bytes.length, offset + BASE64_CHUNK_BYTE_LENGTH);
        const end = candidateEnd < bytes.length
            ? candidateEnd - ((candidateEnd - offset) % 3)
            : candidateEnd;

        if (end <= offset) {
            chunks.push(bytesToBase64(bytes.subarray(offset)));
            break;
        }

        chunks.push(bytesToBase64(bytes.subarray(offset, end)));
        offset = end;
        await yieldToUi();
    }

    return chunks.join("");
}

async function base64ToBytesAsync(value: string): Promise<Uint8Array> {
    const normalized = value.replace(/\s/g, "");
    if (normalized.length <= BASE64_CHUNK_CHAR_LENGTH) return base64ToBytes(normalized);

    const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
    const output = new Uint8Array((normalized.length / 4) * 3 - padding);
    let outputIndex = 0;
    let offset = 0;

    while (offset < normalized.length) {
        const candidateEnd = Math.min(normalized.length, offset + BASE64_CHUNK_CHAR_LENGTH);
        const end = candidateEnd < normalized.length
            ? candidateEnd - ((candidateEnd - offset) % 4)
            : candidateEnd;
        const chunkBytes = base64ToBytes(normalized.slice(offset, end));

        output.set(chunkBytes, outputIndex);
        outputIndex += chunkBytes.length;
        offset = end;
        await yieldToUi();
    }

    return output;
}

function hexToBytes(value: string): Uint8Array {
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rightRotate(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    const bitLength = bytes.length * 8;
    const zeroPadding = (64 - ((bytes.length + 1 + 8) % 64)) % 64;
    const padded = new Uint8Array(bytes.length + 1 + zeroPadding + 8);
    const words = new Uint32Array(64);
    const hashes = [...SHA256_INITIAL_HASHES];

    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const dataView = new DataView(padded.buffer);
    dataView.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
    dataView.setUint32(padded.length - 4, bitLength >>> 0, false);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
            words[index] = dataView.getUint32(offset + index * 4, false);
        }
        for (let index = 16; index < 64; index += 1) {
            const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
            const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = hashes;
        for (let index = 0; index < 64; index += 1) {
            const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + s1 + ch + SHA256_K[index] + words[index]) >>> 0;
            const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        hashes[0] = (hashes[0] + a) >>> 0;
        hashes[1] = (hashes[1] + b) >>> 0;
        hashes[2] = (hashes[2] + c) >>> 0;
        hashes[3] = (hashes[3] + d) >>> 0;
        hashes[4] = (hashes[4] + e) >>> 0;
        hashes[5] = (hashes[5] + f) >>> 0;
        hashes[6] = (hashes[6] + g) >>> 0;
        hashes[7] = (hashes[7] + h) >>> 0;

        if (offset > 0 && offset % (64 * 512) === 0) await yieldToUi();
    }

    return hashes.map((hash) => hash.toString(16).padStart(8, "0")).join("");
}

async function sha256(value: string): Promise<string> {
    return sha256Bytes(TEXT_ENCODER.encode(value));
}

function getRandomBytes(byteCount: number): Uint8Array {
    const bytes = new Uint8Array(byteCount);
    if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes);

    for (let index = 0; index < byteCount; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
    }

    return bytes;
}

async function xorWithBackupKey(bytes: Uint8Array, key: string, nonce: string): Promise<Uint8Array> {
    const keyBytes = hexToBytes(await sha256(`${key}:${nonce}`));
    const output = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
        output[index] = bytes[index] ^ keyBytes[index % keyBytes.length];
        if (index > 0 && index % BASE64_CHUNK_BYTE_LENGTH === 0) await yieldToUi();
    }
    return output;
}

async function yieldToUi(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function yieldToUiFrame(): Promise<void> {
    await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => {
                setTimeout(resolve, 0);
            });
            return;
        }

        setTimeout(resolve, 16);
    });
}

function getPhotoDirectory(create = true): Directory {
    const directory = new Directory(Paths.document, PROPERTY_PHOTO_DIRECTORY_NAME);
    if (create && !directory.exists) directory.create({intermediates: true});
    return directory;
}

function sanitizeBackupFileNamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getPhotoFileName(photo: PropertyPhoto): string {
    return sanitizeBackupFileNamePart(photo.fileName || `${photo.id}.jpg`);
}

function getRestoredPhotoUri(fileName: string): string {
    return new File(getPhotoDirectory(), fileName).uri;
}

function rewritePhotoUris(itemsByBarcode: PropertyItemsByBarcode): PropertyItemsByBarcode {
    return Object.fromEntries(
        Object.entries(itemsByBarcode).map(([barcode, items]) => [
            barcode,
            items.map((item) => ({
                ...item,
                photos: item.photos?.map((photo) => {
                    const fileName = getPhotoFileName(photo);
                    return {
                        ...photo,
                        fileName,
                        uri: getRestoredPhotoUri(fileName),
                    };
                }),
            })),
        ]),
    );
}

function collectStoredPhotoFiles(itemsByBarcode: PropertyItemsByBarcode): BackupPhotoFile[] {
    const filesByRelativePath = new Map<string, BackupPhotoFile>();
    const photoDirectory = getPhotoDirectory(false);

    for (const items of Object.values(itemsByBarcode)) {
        for (const item of items) {
            for (const photo of item.photos ?? []) {
                const fileName = getPhotoFileName(photo);
                const relativePath = `${PROPERTY_PHOTO_DIRECTORY_NAME}/${fileName}`;
                const primaryFile = getExistingFile(photo.uri);
                const fallbackFile = getExistingFile(new File(photoDirectory, fileName).uri);
                const sourceFile = primaryFile ?? fallbackFile;

                if (!sourceFile) {
                    throw new Error(`找不到財產照片檔案：${fileName}。請先移除失效照片後再匯出備份。`);
                }

                filesByRelativePath.set(relativePath, {file: sourceFile, relativePath});
            }
        }
    }

    return [...filesByRelativePath.values()];
}

function getExistingFile(uri: string): File | null {
    try {
        const file = new File(uri);
        return file.exists ? file : null;
    } catch {
        return null;
    }
}

function getSafeRestorePhotoFileName(relativePath: string): string {
    const prefix = `${PROPERTY_PHOTO_DIRECTORY_NAME}/`;
    if (!relativePath.startsWith(prefix)) throw new Error("備份檔包含不支援的照片路徑。");

    const fileName = relativePath.slice(prefix.length);
    if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
        throw new Error("備份檔包含不支援的照片檔名。");
    }

    return sanitizeBackupFileNamePart(fileName);
}

async function createBackupEnvelope(payload: BackupPayload): Promise<BackupEnvelope> {
    const payloadJson = await stringifyBackupPayload(payload);
    const backupKey = getBackupKey();
    let payloadText = await textToBase64Async(payloadJson);
    let payloadEncoding: BackupEnvelope["payloadEncoding"] = "base64-json";
    let nonce: string | undefined;

    if (backupKey) {
        nonce = bytesToHex(getRandomBytes(16));
        const encryptedPayloadBytes = await xorWithBackupKey(TEXT_ENCODER.encode(payloadJson), backupKey, nonce);
        payloadText = await bytesToBase64Async(encryptedPayloadBytes);
        payloadEncoding = "base64-xor-sha256-stream";
    }

    const envelope: BackupEnvelope = {
        magic: BACKUP_MAGIC,
        version: BACKUP_VERSION,
        createdAt: payload.createdAt,
        appVersion: payload.appVersion,
        encrypted: Boolean(backupKey),
        integrityMode: "entry-hash-v1",
        payloadEncoding,
        payload: payloadText,
        nonce,
    };
    const manifestSha256 = await sha256(createPayloadManifest(payload, payloadText.length));

    if (backupKey) {
        envelope.keyedManifestSha256 = await sha256(`${backupKey}:${manifestSha256}`);
    }

    return envelope;
}

async function readBackupEnvelope(file: BackupReadableFile): Promise<BackupEnvelope> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(await file.text());
    } catch {
        throw new Error("備份檔案不是有效的 JSON。");
    }

    if (typeof parsed !== "object" || parsed === null) throw new Error("備份檔案格式不正確。");
    const envelope = parsed as Partial<BackupEnvelope>;

    if (envelope.magic !== BACKUP_MAGIC || envelope.version !== BACKUP_VERSION) {
        throw new Error("這不是支援版本的 Astalog 備份檔。");
    }
    if (typeof envelope.payload !== "string") {
        throw new Error("備份檔案缺少必要內容。");
    }
    if (envelope.integrityMode !== "entry-hash-v1") {
        throw new Error("備份檔案校驗模式不支援。");
    }

    return envelope as BackupEnvelope;
}

async function decodeBackupPayload(envelope: BackupEnvelope): Promise<BackupPayload> {
    const backupKey = getBackupKey();
    if (envelope.encrypted) {
        if (!backupKey) throw new Error("此備份檔需要 EXPO_PUBLIC_ASTALOG_BACKUP_KEY 才能還原。");
        if (!envelope.nonce) throw new Error("加密備份檔缺少 nonce。");
    }

    const payloadBytes = envelope.encrypted
        ? await xorWithBackupKey(await base64ToBytesAsync(envelope.payload), backupKey, envelope.nonce ?? "")
        : await base64ToBytesAsync(envelope.payload);
    const payloadJson = TEXT_DECODER.decode(payloadBytes);

    let payload: unknown;
    try {
        payload = JSON.parse(payloadJson);
    } catch {
        throw new Error("備份檔 payload 無法解析。");
    }

    if (typeof payload !== "object" || payload === null || (payload as Partial<BackupPayload>).schemaVersion !== BACKUP_VERSION) {
        throw new Error("備份檔 payload 版本不支援。");
    }

    if (backupKey && envelope.keyedManifestSha256) {
        const manifestSha256 = await sha256(createPayloadManifest(payload as BackupPayload, envelope.payload.length));
        const keyedManifestSha256 = await sha256(`${backupKey}:${manifestSha256}`);
        if (keyedManifestSha256 !== envelope.keyedManifestSha256) throw new Error("備份金鑰不正確，無法還原此備份檔。");
    }

    return payload as BackupPayload;
}

async function validateStorageEntry(entry: StoredTextEntry): Promise<string> {
    const value = base64ToText(entry.valueBase64);
    if ((await sha256(value)) !== entry.sha256) throw new Error(`備份資料 ${entry.key} hash 不一致。`);
    return value;
}

async function validateFileEntry(entry: StoredFileEntry): Promise<void> {
    if (entry.sha256 && (await sha256(entry.contentBase64)) !== entry.sha256) {
        throw new Error(`備份照片 ${entry.relativePath} hash 不一致。`);
    }
    if (!entry.sha256 && !entry.md5) {
        throw new Error(`備份照片 ${entry.relativePath} 缺少校驗資訊。`);
    }
}

export async function getExistingBackupTargetSummary(): Promise<ExistingBackupTargetSummary> {
    const keys = (await AsyncStorage.getAllKeys()).filter(isBackupStorageKey);
    const propertyItemsValue = await AsyncStorage.getItem(PROPERTY_ITEMS_STORAGE_KEY);
    const propertyItemCount = Object.values(parseStoredPropertyItems(propertyItemsValue))
        .reduce((total, items) => total + items.length, 0);
    let photoCount = 0;

    try {
        const photoDirectory = getPhotoDirectory(false);
        photoCount = photoDirectory.exists ? photoDirectory.list().filter((entry) => entry instanceof File).length : 0;
    } catch {
        photoCount = 0;
    }

    return {
        storageKeyCount: keys.length,
        photoCount,
        propertyItemCount,
        hasData: propertyItemCount > 0,
    };
}

export async function createFullBackupFile(onProgress?: (progress: BackupProgress) => void): Promise<BackupExportResult> {
    onProgress?.({message: "讀取本機資料", progress: 1});
    const allKeys = (await AsyncStorage.getAllKeys()).filter(isBackupStorageKey).sort();
    const keyValuePairs = allKeys.length > 0 ? await AsyncStorage.multiGet(allKeys) : [];
    const propertyItemsValue = keyValuePairs.find(([key]) => key === PROPERTY_ITEMS_STORAGE_KEY)?.[1] ?? null;
    const itemsByBarcode = parseStoredPropertyItems(propertyItemsValue);
    const photoFiles = collectStoredPhotoFiles(itemsByBarcode);
    const textEndProgress = getTextEndProgress(photoFiles.length > 0);
    const storage: StoredTextEntry[] = [];
    const files: StoredFileEntry[] = [];

    onProgress?.({
        message: "編碼文字資料",
        progress: 1,
        targetProgress: textEndProgress,
        millisecondsPerPercent: 300,
        active: true,
        current: 0,
        total: keyValuePairs.length,
    });
    await yieldToUiFrame();
    for (let index = 0; index < keyValuePairs.length; index += 1) {
        const [key, value] = keyValuePairs[index];
        if (value === null) continue;
        const valueBytes = TEXT_ENCODER.encode(value);

        storage.push({
            key,
            valueBase64: await bytesToBase64Async(valueBytes),
            sha256: await sha256Bytes(valueBytes),
            byteLength: valueBytes.byteLength,
        });
        if (index % 8 === 0) await yieldToUi();
    }
    onProgress?.({message: "文字資料備份完成", progress: textEndProgress, current: keyValuePairs.length, total: keyValuePairs.length});

    for (let index = 0; index < photoFiles.length; index += 1) {
        const {file, relativePath} = photoFiles[index];
        const {start, end} = getPhotoStepProgress(index, photoFiles.length);

        onProgress?.({
            message: "正在備份圖片",
            progress: start,
            targetProgress: end,
            millisecondsPerPercent: 500,
            active: true,
            current: index + 1,
            total: photoFiles.length,
        });
        await yieldToUiFrame();
        const contentBase64 = await file.base64();
        const md5 = getFileMd5(file);
        const sha256Value = md5 ? undefined : await sha256(contentBase64);
        files.push({
            relativePath,
            contentBase64,
            md5,
            sha256: sha256Value,
            byteLength: file.size,
        });
        onProgress?.({message: "正在備份圖片", progress: end, current: index + 1, total: photoFiles.length});
        await yieldToUi();
    }

    onProgress?.({
        message: getBackupKey() ? "加密並建立備份檔" : "建立備份檔",
        progress: 90,
        targetProgress: 100,
        millisecondsPerPercent: 300,
        active: true,
    });
    await yieldToUiFrame();
    const createdAtDate = new Date();
    const createdAt = createdAtDate.toISOString();
    const envelope = await createBackupEnvelope({
        schemaVersion: BACKUP_VERSION,
        createdAt,
        appVersion: getAppVersion(),
        platform: Platform.OS,
        storage,
        files,
    });
    const fileName = `Astalog-${formatBackupFileTimestamp(createdAtDate)}-Backup.${BACKUP_FILE_EXTENSION}`;
    const backupFile = new File(Paths.cache, fileName);
    if (backupFile.exists) backupFile.delete();
    backupFile.create({overwrite: true});
    backupFile.write(stringifyBackupEnvelope(envelope));
    onProgress?.({message: "備份檔建立完成", progress: 100});

    return {
        uri: backupFile.uri,
        fileName,
        storageKeyCount: storage.length,
        photoCount: files.length,
        encrypted: envelope.encrypted,
    };
}

export async function shareBackupFile(uri: string): Promise<boolean> {
    if (!(await Sharing.isAvailableAsync())) return false;

    await Sharing.shareAsync(uri, {
        dialogTitle: "匯出 Astalog 備份檔",
        mimeType: "application/octet-stream",
        UTI: "public.data",
    });

    return true;
}

export function cleanupBackupFile(uri: string): void {
    try {
        const file = new File(uri);
        if (file.exists) file.delete();
    } catch {
        // Cache cleanup failure is non-fatal.
    }
}

export async function restoreFullBackupFile(file: BackupReadableFile, onProgress?: (progress: BackupProgress) => void): Promise<BackupRestoreResult> {
    onProgress?.({
        message: "讀取備份檔",
        progress: 1,
        targetProgress: 10,
        millisecondsPerPercent: 300,
        active: true,
    });
    await yieldToUiFrame();
    const envelope = await readBackupEnvelope(file);
    const payload = await decodeBackupPayload(envelope);
    onProgress?.({message: "讀取備份檔", progress: 10});
    const storageValues = new Map<string, string>();
    const hasPhotos = payload.files.length > 0;
    const textEndProgress = getTextEndProgress(hasPhotos);

    onProgress?.({
        message: "驗證文字資料",
        progress: 10,
        targetProgress: textEndProgress,
        millisecondsPerPercent: 500,
        active: true,
        current: 0,
        total: payload.storage.length,
    });
    await yieldToUiFrame();
    for (let index = 0; index < payload.storage.length; index += 1) {
        const entry = payload.storage[index];
        storageValues.set(entry.key, await validateStorageEntry(entry));
        if (index % 8 === 0) await yieldToUi();
    }
    onProgress?.({message: "文字資料驗證完成", progress: textEndProgress, current: payload.storage.length, total: payload.storage.length});

    for (let index = 0; index < payload.files.length; index += 1) {
        const {start, end} = getPhotoStepProgress(index, payload.files.length * 2);
        onProgress?.({
            message: "正在還原與檢查圖片",
            progress: start,
            targetProgress: end,
            active: true,
            current: index + 1,
            total: payload.files.length * 2,
        });
        await yieldToUiFrame();
        await validateFileEntry(payload.files[index]);
        onProgress?.({message: "正在還原與檢查圖片", progress: end, current: index + 1, total: payload.files.length * 2});
        await yieldToUi();
    }

    const propertyItemsValue = storageValues.get(PROPERTY_ITEMS_STORAGE_KEY);
    if (propertyItemsValue !== undefined) {
        const rewrittenItems = rewritePhotoUris(parseStoredPropertyItems(propertyItemsValue));
        storageValues.set(PROPERTY_ITEMS_STORAGE_KEY, JSON.stringify(rewrittenItems));
    }

    onProgress?.({message: "清除現有本機資料", progress: hasPhotos ? 55 : 99});
    const currentKeys = (await AsyncStorage.getAllKeys()).filter(isBackupStorageKey);
    if (currentKeys.length > 0) await AsyncStorage.multiRemove(currentKeys);

    const photoDirectory = getPhotoDirectory(false);
    if (photoDirectory.exists) photoDirectory.delete();
    getPhotoDirectory(true);

    for (let index = 0; index < payload.files.length; index += 1) {
        const entry = payload.files[index];
        const fileName = getSafeRestorePhotoFileName(entry.relativePath);
        const destinationFile = new File(getPhotoDirectory(), fileName);
        const {start, end} = getPhotoStepProgress(payload.files.length + index, payload.files.length * 2);

        onProgress?.({
            message: "正在還原與檢查圖片",
            progress: start,
            targetProgress: end,
            active: true,
            current: payload.files.length + index + 1,
            total: payload.files.length * 2,
        });
        await yieldToUiFrame();
        if (destinationFile.exists) destinationFile.delete();
        destinationFile.create({overwrite: true});
        destinationFile.write(await base64ToBytesAsync(entry.contentBase64));

        if (destinationFile.size !== entry.byteLength) throw new Error(`照片 ${fileName} 還原後大小不一致。`);
        if (entry.md5) {
            const restoredMd5 = getFileMd5(destinationFile);
            if (restoredMd5 !== entry.md5) throw new Error(`照片 ${fileName} 還原後 md5 不一致。`);
        } else if (entry.sha256) {
            const restoredContentBase64 = await bytesToBase64Async(await destinationFile.bytes());
            if ((await sha256(restoredContentBase64)) !== entry.sha256) throw new Error(`照片 ${fileName} 還原後 hash 不一致。`);
        }
        onProgress?.({message: "正在還原與檢查圖片", progress: end, current: payload.files.length + index + 1, total: payload.files.length * 2});
        await yieldToUi();
    }

    onProgress?.({message: "寫入本機資料", progress: 99});
    const nextStoragePairs = [...storageValues.entries()].filter(([key]) => isBackupStorageKey(key));
    if (nextStoragePairs.length > 0) await AsyncStorage.multiSet(nextStoragePairs);

    onProgress?.({message: "檢查還原結果", progress: 99});
    const restoredPairs = nextStoragePairs.length > 0 ? await AsyncStorage.multiGet(nextStoragePairs.map(([key]) => key)) : [];
    for (const [key, expectedValue] of nextStoragePairs) {
        if (restoredPairs.find(([storedKey]) => storedKey === key)?.[1] !== expectedValue) {
            throw new Error(`資料 ${key} 還原後檢查失敗。`);
        }
    }

    onProgress?.({message: "還原完成", progress: 100});

    return {
        storageKeyCount: nextStoragePairs.length,
        photoCount: payload.files.length,
        encrypted: envelope.encrypted,
        createdAt: payload.createdAt,
    };
}
