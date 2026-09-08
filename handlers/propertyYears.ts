const ROC_YEAR_OFFSET = 1911;

export function propertyYearToWesternNumber(year: string | null | undefined): number | null {
    const trimmed = year?.trim();
    if (!trimmed) return null;

    const numericYear = Number(trimmed);
    if (!Number.isFinite(numericYear)) return null;

    return numericYear > ROC_YEAR_OFFSET ? numericYear : numericYear + ROC_YEAR_OFFSET;
}

export function isSamePropertyYear(a: string | null | undefined, b: string | null | undefined): boolean {
    const westernA = propertyYearToWesternNumber(a);
    const westernB = propertyYearToWesternNumber(b);

    return westernA !== null && westernA === westernB;
}

export function itemExistsInPropertyYear(sourceYears: string[], targetYear: string | null | undefined): boolean {
    return sourceYears.some((sourceYear) => isSamePropertyYear(sourceYear, targetYear));
}

export function comparePropertyYearsDescending(a: string, b: string): number {
    return (propertyYearToWesternNumber(b) ?? Number.NEGATIVE_INFINITY)
        - (propertyYearToWesternNumber(a) ?? Number.NEGATIVE_INFINITY);
}
