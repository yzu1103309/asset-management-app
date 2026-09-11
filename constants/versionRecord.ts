import localVersionRecord from "./version_record.json" with {type: "json"};

export const VERSION_RECORD_URL = "https://raw.githubusercontent.com/yzu1103309/asset-management-app/refs/heads/main/constants/version_record.json";
export const GITHUB_RELEASE_BASE_URL = "https://github.com/yzu1103309/asset-management-app/releases/tag";
export const GITHUB_RELEASE_API_BASE_URL = "https://api.github.com/repos/yzu1103309/asset-management-app/releases/tags";

export type VersionRecordEntry = {
    version: string;
    date: string;
    title: string;
    changes: string[];
};

export type VersionRecordFile = {
    schemaVersion: 1;
    app: "Astalog";
    updatedAt: string;
    versions: VersionRecordEntry[];
};

export const LOCAL_VERSION_RECORD = localVersionRecord as VersionRecordFile;

function normalizeVersion(version: string): string {
    return version.trim().replace(/^v/i, "");
}

function getVersionSegments(version: string): number[] {
    return normalizeVersion(version)
        .split(/[.-]/)
        .map((segment) => Number.parseInt(segment, 10))
        .map((segment) => Number.isFinite(segment) ? segment : 0);
}

export function compareVersionStrings(left: string, right: string): number {
    const leftSegments = getVersionSegments(left);
    const rightSegments = getVersionSegments(right);
    const length = Math.max(leftSegments.length, rightSegments.length);

    for (let index = 0; index < length; index += 1) {
        const difference = (leftSegments[index] ?? 0) - (rightSegments[index] ?? 0);
        if (difference !== 0) return difference;
    }

    return 0;
}

function isRecordEntry(value: unknown): value is VersionRecordEntry {
    return typeof value === "object"
        && value !== null
        && "version" in value
        && typeof value.version === "string"
        && "date" in value
        && typeof value.date === "string"
        && "title" in value
        && typeof value.title === "string"
        && "changes" in value
        && Array.isArray(value.changes)
        && value.changes.every((change) => typeof change === "string");
}

export function parseVersionRecordJson(json: string): VersionRecordFile {
    const parsed: unknown = JSON.parse(json);

    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("version_record must be a JSON object.");
    }

    const record = parsed as Partial<VersionRecordFile>;
    if (record.schemaVersion !== 1 || record.app !== "Astalog" || typeof record.updatedAt !== "string" || !Array.isArray(record.versions)) {
        throw new Error("version_record schema is invalid.");
    }

    if (!record.versions.every(isRecordEntry)) {
        throw new Error("version_record versions are invalid.");
    }

    return {
        schemaVersion: 1,
        app: "Astalog",
        updatedAt: record.updatedAt,
        versions: record.versions,
    };
}

export function getDisplayVersionEntries(record: VersionRecordFile, currentVersion: string): VersionRecordEntry[] {
    return record.versions
        .filter((entry) => compareVersionStrings(entry.version, currentVersion) <= 0)
        .sort((left, right) => compareVersionStrings(right.version, left.version));
}

export function getLatestVersionEntry(record: VersionRecordFile): VersionRecordEntry | null {
    return [...record.versions].sort((left, right) => compareVersionStrings(right.version, left.version))[0] ?? null;
}

export function formatVersionTag(version: string): string {
    return `v${normalizeVersion(version)}`;
}

export function getGithubReleaseUrl(version: string): string {
    return `${GITHUB_RELEASE_BASE_URL}/${formatVersionTag(version)}`;
}

export function getGithubReleaseApiUrl(version: string): string {
    return `${GITHUB_RELEASE_API_BASE_URL}/${encodeURIComponent(formatVersionTag(version))}`;
}

export function formatVersionRecordEntries(entries: VersionRecordEntry[]): string {
    return entries
        .map((entry) => [
            `${formatVersionTag(entry.version)} - ${entry.title}`,
            entry.date,
            ...entry.changes.map((change) => `- ${change}`),
        ].join("\n"))
        .join("\n\n");
}

export function formatDisplayVersionRecord(record: VersionRecordFile, currentVersion: string): string {
    return formatVersionRecordEntries(getDisplayVersionEntries(record, currentVersion));
}
