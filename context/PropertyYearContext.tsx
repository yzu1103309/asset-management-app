import {Alert} from "react-native";
import React, {createContext, ReactNode, useCallback, useContext, useRef, useState} from "react";
import {getAvailablePropertyYears} from "@/handlers/propertyList";

type PropertyYearRefreshResult = {
    availableYears: string[];
    selectedYear: string | null;
};

type PropertyYearContextProps = {
    availableYears: string[];
    selectedYear: string | null;
    loading: boolean;
    refreshYears: (preferredYear?: string | null) => Promise<PropertyYearRefreshResult>;
    requestSelectYear: (year: string, options?: {confirm?: boolean}) => Promise<boolean>;
};

const PropertyYearContext = createContext<PropertyYearContextProps | undefined>(undefined);
const ROC_YEAR_OFFSET = 1911;

function normalizeYearValue(year: string): string[] {
    const trimmed = year.trim();
    const numericYear = Number(trimmed);
    if (!Number.isFinite(numericYear)) return [trimmed];

    return [trimmed, String(numericYear)];
}

function getCurrentYearLabels(date = new Date()) {
    const westernYear = date.getFullYear();
    const rocYear = westernYear - ROC_YEAR_OFFSET;

    return {
        westernYear: String(westernYear),
        rocYear: String(rocYear),
    };
}

function isCurrentSystemPropertyYear(year: string, date = new Date()) {
    const {westernYear, rocYear} = getCurrentYearLabels(date);
    const currentYearValues = new Set([westernYear, rocYear]);

    return normalizeYearValue(year).some((value) => currentYearValues.has(value));
}

function confirmYearSwitch(nextYear: string): Promise<boolean> {
    const {westernYear, rocYear} = getCurrentYearLabels();

    return new Promise((resolve) => {
        Alert.alert(
            "確認切換年度",
            `目前系統年份為 ${westernYear}（民國 ${rocYear}） 年\n確定要切換到 ${nextYear} 年度？`,
            [
                {text: "取消", style: "cancel", onPress: () => resolve(false)},
                {text: "切換", onPress: () => resolve(true)},
            ],
            {cancelable: true, onDismiss: () => resolve(false)},
        );
    });
}

export function PropertyYearProvider({children}: {children: ReactNode}) {
    const [availableYears, setAvailableYears] = useState<string[]>([]);
    const [selectedYear, setSelectedYear] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const availableYearsRef = useRef<string[]>([]);
    const selectedYearRef = useRef<string | null>(null);

    const setYearState = useCallback((years: string[], year: string | null) => {
        availableYearsRef.current = years;
        selectedYearRef.current = year;
        setAvailableYears(years);
        setSelectedYear(year);
    }, []);

    const refreshYears = useCallback(async (preferredYear?: string | null): Promise<PropertyYearRefreshResult> => {
        setLoading(true);

        try {
            const years = await getAvailablePropertyYears();
            const requestedYear = preferredYear ?? selectedYearRef.current;
            const year = requestedYear && years.includes(requestedYear) ? requestedYear : years[0] ?? null;

            setYearState(years, year);
            return {availableYears: years, selectedYear: year};
        } catch (error) {
            console.error("讀取可用盤點年度失敗:", error);
            setYearState([], null);
            return {availableYears: [], selectedYear: null};
        } finally {
            setLoading(false);
        }
    }, [setYearState]);

    const requestSelectYear = useCallback(async (year: string, options?: {confirm?: boolean}) => {
        if (!availableYearsRef.current.includes(year)) return false;

        const currentYear = selectedYearRef.current;
        if (year === currentYear) return true;
        if (options?.confirm !== false && !isCurrentSystemPropertyYear(year) && !(await confirmYearSwitch(year))) {
            return false;
        }

        selectedYearRef.current = year;
        setSelectedYear(year);
        return true;
    }, []);

    return (
        <PropertyYearContext.Provider value={{availableYears, selectedYear, loading, refreshYears, requestSelectYear}}>
            {children}
        </PropertyYearContext.Provider>
    );
}

export function usePropertyYear() {
    const context = useContext(PropertyYearContext);
    if (!context) {
        throw new Error("usePropertyYear must be used within a PropertyYearProvider");
    }

    return context;
}
