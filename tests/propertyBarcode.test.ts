import assert from "node:assert/strict";
import test from "node:test";
import {findPropertyBarcodeLookupMatch} from "../handlers/propertyBarcode.ts";

const propertyBuckets = {
    "3140306-03-544": ["gpu"],
    "3140101-03-40745": ["computer"],
    "60101-202-544": ["drive"],
};

test("finds exact property barcode matches first", () => {
    assert.deepEqual(findPropertyBarcodeLookupMatch(propertyBuckets, "3140306-03-544"), {
        barcode: "3140306-03-544",
        matchType: "exact",
    });
});

test("finds padded tail matches with the same prefix", () => {
    assert.deepEqual(findPropertyBarcodeLookupMatch(propertyBuckets, "3140306-03-00544"), {
        barcode: "3140306-03-544",
        matchType: "same-prefix-padded-tail",
    });
});

test("finds unique padded tail matches when imported and physical prefixes differ", () => {
    const buckets = {
        "3140306-03-544": ["gpu"],
        "3140101-03-40745": ["computer"],
    };

    assert.deepEqual(findPropertyBarcodeLookupMatch(buckets, "3140106-03-00544"), {
        barcode: "3140306-03-544",
        matchType: "unique-padded-tail",
    });
});

test("does not resolve ambiguous padded tail matches", () => {
    assert.equal(findPropertyBarcodeLookupMatch(propertyBuckets, "3140106-03-00544"), null);
});
