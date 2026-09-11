import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
    compareVersionStrings,
    formatDisplayVersionRecord,
    getDisplayVersionEntries,
    getGithubReleaseApiUrl,
    getGithubReleaseUrl,
    getLatestVersionEntry,
    LOCAL_VERSION_RECORD,
    parseVersionRecordJson,
    type VersionRecordFile,
} from "../constants/versionRecord.ts";

test("local version record fallback matches constants version_record JSON", () => {
    const fileRecord = parseVersionRecordJson(readFileSync("constants/version_record.json", "utf8"));

    assert.deepEqual(LOCAL_VERSION_RECORD, fileRecord);
});

test("formats version records up to the current app version with current version first", () => {
    const record: VersionRecordFile = {
        schemaVersion: 1,
        app: "Astalog",
        updatedAt: "2026-09-11",
        versions: [
            {version: "0.0.9.0", date: "2026-09-01", title: "舊版", changes: ["舊功能"]},
            {version: "0.2.0.0", date: "2026-09-12", title: "未來版", changes: ["新版本"]},
            {version: "0.1.0.0", date: "2026-09-11", title: "目前版", changes: ["目前功能"]},
        ],
    };
    const entries = getDisplayVersionEntries(record, "0.1.0.0");

    assert.deepEqual(entries.map((entry) => entry.version), ["0.1.0.0", "0.0.9.0"]);
    assert.match(formatDisplayVersionRecord(record, "0.1.0.0"), /^v0\.1\.0\.0 - 目前版/);
});

test("finds newer versions for update prompts", () => {
    const latest = getLatestVersionEntry({
        schemaVersion: 1,
        app: "Astalog",
        updatedAt: "2026-09-11",
        versions: [
            {version: "0.1.0.0", date: "2026-09-11", title: "目前版", changes: []},
            {version: "0.1.1.0", date: "2026-09-12", title: "新版", changes: []},
        ],
    });

    assert.equal(latest?.version, "0.1.1.0");
    assert.equal(compareVersionStrings(latest?.version ?? "", "0.1.0.0") > 0, true);
    assert.equal(getGithubReleaseUrl("0.1.1.0"), "https://github.com/yzu1103309/asset-management-app/releases/tag/v0.1.1.0");
    assert.equal(getGithubReleaseApiUrl("0.1.1.0"), "https://api.github.com/repos/yzu1103309/asset-management-app/releases/tags/v0.1.1.0");
});
