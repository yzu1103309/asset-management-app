import AsyncStorage from "@react-native-async-storage/async-storage";
import Fuse from "fuse.js";
import type {PropertyItemEditableTextField} from "./updatePropertyItemDetails.ts";

export const PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY = "@ncu-property-checking/text-suggestions:v1";

const MAX_SUGGESTIONS_PER_FIELD = 50;
const DEFAULT_SUGGESTION_LIMIT = 6;

type StoredPropertyTextSuggestions = Record<PropertyItemEditableTextField, string[]>;

const EMPTY_SUGGESTIONS: StoredPropertyTextSuggestions = {
    locationDescription: [],
    note: [],
};

function normalizeSuggestion(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function parseStoredSuggestions(value: string | null): StoredPropertyTextSuggestions {
    if (!value) return {...EMPTY_SUGGESTIONS};

    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {...EMPTY_SUGGESTIONS};
        const source = parsed as Partial<Record<PropertyItemEditableTextField, unknown>>;

        return {
            locationDescription: Array.isArray(source.locationDescription)
                ? source.locationDescription.filter((item): item is string => typeof item === "string")
                : [],
            note: Array.isArray(source.note)
                ? source.note.filter((item): item is string => typeof item === "string")
                : [],
        };
    } catch {
        return {...EMPTY_SUGGESTIONS};
    }
}

function uniqueNormalizedSuggestions(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const trimmedValue = value.trim();
        const normalizedValue = normalizeSuggestion(trimmedValue);
        if (!normalizedValue || seen.has(normalizedValue)) continue;

        seen.add(normalizedValue);
        result.push(trimmedValue);
    }

    return result;
}

function isLooseCharacterMatch(query: string, candidate: string): boolean {
    const normalizedQuery = normalizeSuggestion(query);
    const normalizedCandidate = normalizeSuggestion(candidate);
    if (normalizedQuery.length < 2) return false;

    return [...normalizedQuery].every((character) => normalizedCandidate.includes(character));
}

export function addPropertyTextSuggestion(suggestions: string[], value: string, maxCount = MAX_SUGGESTIONS_PER_FIELD): string[] {
    return uniqueNormalizedSuggestions([value, ...suggestions]).slice(0, maxCount);
}

export function getSuggestedPropertyTextSuggestions(
    query: string,
    suggestions: string[],
    limit = DEFAULT_SUGGESTION_LIMIT,
): string[] {
    const candidates = uniqueNormalizedSuggestions(suggestions);
    const normalizedQuery = normalizeSuggestion(query);
    if (!normalizedQuery) return candidates.slice(0, limit);

    const normalizedCurrentText = normalizeSuggestion(query);
    const directMatches = candidates.filter((candidate) => {
        const normalizedCandidate = normalizeSuggestion(candidate);
        return normalizedCandidate !== normalizedCurrentText
            && (normalizedCandidate.includes(normalizedQuery) || isLooseCharacterMatch(normalizedQuery, normalizedCandidate));
    });
    const directMatchSet = new Set(directMatches.map(normalizeSuggestion));
    const fuzzyMatches = new Fuse(
        candidates
            .filter((candidate) => normalizeSuggestion(candidate) !== normalizedCurrentText)
            .filter((candidate) => !directMatchSet.has(normalizeSuggestion(candidate)))
            .map((value) => ({value})),
        {
            keys: ["value"],
            threshold: 0.42,
            ignoreLocation: true,
        },
    ).search(query).map((result) => result.item.value);

    return uniqueNormalizedSuggestions([...directMatches, ...fuzzyMatches]).slice(0, limit);
}

export async function getPropertyTextSuggestions(field: PropertyItemEditableTextField): Promise<string[]> {
    const storedSuggestions = parseStoredSuggestions(await AsyncStorage.getItem(PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY));
    return storedSuggestions[field];
}

export async function rememberPropertyTextSuggestion(
    field: PropertyItemEditableTextField,
    value: string,
): Promise<string[]> {
    const storedSuggestions = parseStoredSuggestions(await AsyncStorage.getItem(PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY));
    const nextSuggestions = addPropertyTextSuggestion(storedSuggestions[field], value);
    const nextStoredSuggestions: StoredPropertyTextSuggestions = {
        ...storedSuggestions,
        [field]: nextSuggestions,
    };

    await AsyncStorage.setItem(PROPERTY_TEXT_SUGGESTIONS_STORAGE_KEY, JSON.stringify(nextStoredSuggestions));

    return nextSuggestions;
}
