import { Tabs } from "expo-router";
import { useTheme } from "react-native-magnus";
import { tabs } from "@/constants/tabs";
import TabBarIcon from "@/components/TabBarIcon";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function () {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    // tabBar「內容區」想要的高度（不含 safe area）
    const BASE_HEIGHT = 58;

    // Android 有時 insets.bottom = 0，但還是可能被 gesture/系統列吃到
    // const ANDROID_FALLBACK_BOTTOM = 10;

    const bottomInset =
        Platform.OS === "android"
            ? (insets.bottom <= 20)? 20 : insets.bottom
            : 25;

    const topPadding = 8;

    return (
        <Tabs
            screenOptions={{
                sceneStyle: { backgroundColor: theme.colors?.white },
                tabBarStyle: {
                    backgroundColor: theme.colors?.gray200,

                    // ✅ 用 height 控制「你以為的高度」，padding 只是微調
                    height: BASE_HEIGHT + bottomInset + topPadding,

                    // ✅ icon/label 垂直位置會更可控
                    paddingTop: topPadding,
                    paddingBottom: bottomInset,

                    // （可選）更像 iOS/日系 UI：圓角 + 陰影/邊框
                    borderTopWidth: 0,
                    // 如果你想要分隔線，改成：
                    // borderTopWidth: 1,
                    // borderTopColor: theme.colors?.gray300,
                },
                tabBarItemStyle: {
                    // ✅ 讓每個 tab 的內容置中，不被 padding 影響到怪位移
                    paddingVertical: 2,
                },
            }}
        >
            {tabs.map((tab) => (
                <Tabs.Screen
                    key={tab.name}
                    name={tab.name}
                    options={{
                        ...tab.options,
                        headerShown: false,
                        title: tab.title,
                        tabBarIcon: ({ color }) => (
                            <TabBarIcon
                                name={tab.icon}
                                color={color}
                                family={tab.icon_type}
                            />
                        ),
                    }}
                />
            ))}
        </Tabs>
    );
}
