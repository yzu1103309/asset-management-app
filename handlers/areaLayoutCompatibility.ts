import type {AreaLayout} from "./areaLayout.ts";
import type {PropertyItemsByBarcode} from "./propertyItemStore.ts";

export type BoundAreaReference = {
    areaId: string | null;
    areaName: string | null;
    itemCount: number;
};

function normalizeText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();

    return trimmed ? trimmed : null;
}

function isNonNullable<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

export function collectBoundAreaReferences(itemsByBarcode: PropertyItemsByBarcode): BoundAreaReference[] {
    const references = new Map<string, BoundAreaReference>();

    for (const items of Object.values(itemsByBarcode)) {
        for (const item of items) {
            const areaId = normalizeText(item.location.areaId);
            const areaName = normalizeText(item.location.areaName);

            if (!areaId && !areaName) continue;

            const referenceKey = areaId ? `id:${areaId}` : `name:${areaName}`;
            const reference = references.get(referenceKey) ?? {
                areaId,
                areaName,
                itemCount: 0,
            };

            reference.itemCount += 1;
            references.set(referenceKey, reference);
        }
    }

    return [...references.values()];
}

export function findMissingAreaLayoutBindings(
    nextLayout: AreaLayout,
    itemsByBarcode: PropertyItemsByBarcode,
): BoundAreaReference[] {
    const nextAreaIds = new Set(nextLayout.areas.map((area) => normalizeText(area.id)).filter(isNonNullable));
    const nextAreaNames = new Set(nextLayout.areas.map((area) => normalizeText(area.name)).filter(isNonNullable));

    return collectBoundAreaReferences(itemsByBarcode).filter((reference) => {
        const idMatched = reference.areaId ? nextAreaIds.has(reference.areaId) : false;
        const nameMatched = reference.areaName ? nextAreaNames.has(reference.areaName) : false;

        return !idMatched && !nameMatched;
    });
}
