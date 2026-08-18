import type {PropertyStatus} from "@/handlers/propertyStatusStore";

export const PROPERTY_STATUS_CARD_SHADOW_COLOR = "#98A2B3";

export type PropertyStatusColorSet = {
    cardBg: string;
    numberBg: string;
    numberColor: string;
    barcodeColor: string;
    nameColor: string;
};

export const PROPERTY_STATUS_COLORS: Record<PropertyStatus, PropertyStatusColorSet> = {
    unknown: {
        cardBg: "#DDEAF3",
        numberBg: "#C7D6E2",
        numberColor: "#2F4358",
        barcodeColor: "#2F4358",
        nameColor: "#5D6F80",
    },
    checked: {
        cardBg: "#E4F7EC",
        numberBg: "#BDE8CE",
        numberColor: "#166534",
        barcodeColor: "#166534",
        nameColor: "#3F6F55",
    },
    pending: {
        cardBg: "#FFF0E2",
        numberBg: "#FFD6A8",
        numberColor: "#9A4A12",
        barcodeColor: "#9A4A12",
        nameColor: "#7B5635",
    },
};
