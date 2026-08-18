import { iconFontFamilyType } from "react-native-magnus/src/ui/icon/icon.type";

type Tab = {
    name: string;
    title: string;
    icon: string;
    icon_type: iconFontFamilyType;
    options: Record<string, unknown>;
};

const tabs:Tab[] = [
    {
        name: "index",
        title: "財產清單",
        icon: "book-open",
        icon_type: "Feather",
        options: {}
    },
    {
        name: "scanner",
        title: "財標掃描",
        icon: "barcode-scan",
        icon_type: "MaterialCommunityIcons",
        options: {}
    },
    {
        name: "settings",
        title: "設定與工具",
        icon: "briefcase",
        icon_type: "Feather",
        options: {}
    }
]

export {tabs}
