import assert from "node:assert/strict";
import test from "node:test";
import {assertSupportedImportYear} from "../handlers/propertyImport.ts";

test("allows importing the initial, existing, or newer property years", () => {
    assert.doesNotThrow(() => assertSupportedImportYear([], "115"));
    assert.doesNotThrow(() => assertSupportedImportYear(["115"], "115"));
    assert.doesNotThrow(() => assertSupportedImportYear(["115"], "116"));
    assert.doesNotThrow(() => assertSupportedImportYear(["115", "116"], "115"));
});

test("rejects importing a year older than the initial imported property year", () => {
    assert.throws(
        () => assertSupportedImportYear(["115", "116"], "114"),
        /不支援匯入比初始年度 115 更舊/,
    );
});
