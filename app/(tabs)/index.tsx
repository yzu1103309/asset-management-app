import {Alert, Animated, FlatList, Keyboard, RefreshControl, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View} from "react-native";
import ExpoSegmentedControl from "@expo/ui/community/segmented-control";
import {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from "react";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {router, useFocusEffect, useLocalSearchParams} from "expo-router";
import {Div, Icon, Input} from "react-native-magnus";
import ItemCard from "@/components/main/ItemCard";
import {
    getAnnualPropertyItems,
    sortAnnualPropertyListItems,
    type AnnualPropertyListItem,
} from "@/handlers/propertyList";
import type {PropertyStatus} from "@/handlers/propertyStatusStore";
import {searchPropertyItems} from "@/handlers/propertySearch";
import {useSpinner} from "@/context/SpinnerContext";
import PropertyYearDropdown from "@/components/PropertyYearDropdown";
import {usePropertyYear} from "@/context/PropertyYearContext";
import {
    getAreaShapeFromStyle,
    getStoredAreaLayout,
    isAreaDashedFromStyle,
    isAreaRoundedFromStyle,
    type AreaLayout,
    type AreaLayoutArea,
} from "@/handlers/areaLayout";

const STATUS_BY_INDEX: PropertyStatus[] = ["unknown", "checked", "pending"];
const SEGMENT_VALUES = ["未清點", "已確認", "待處理"];

function itemIsInArea(item: AnnualPropertyListItem, area: AreaLayoutArea): boolean {
    if (item.location?.areaId === area.id) return true;

    const areaName = area.name.trim();
    return Boolean(areaName) && item.location?.areaName?.trim() === areaName;
}

function AreaLayoutOverview({
    layout,
    items,
    selectedAreaId,
    disabled,
    onSelectArea,
}: {
    layout: AreaLayout | null;
    items: AnnualPropertyListItem[];
    selectedAreaId: string | null;
    disabled: boolean;
    onSelectArea: (areaId: string) => void;
}) {
    const {width: windowWidth, height: windowHeight} = useWindowDimensions();
    const previewMargin = 10;
    const previewSize = useMemo(() => {
        if (!layout || layout.areas.length === 0) {
            return {scale: 1, width: 0, height: 0, minX: 0, minY: 0, margin: previewMargin};
        }

        const minX = Math.min(...layout.areas.map((area) => area.x));
        const minY = Math.min(...layout.areas.map((area) => area.y));
        const maxX = Math.max(...layout.areas.map((area) => area.x + area.width));
        const maxY = Math.max(...layout.areas.map((area) => area.y + area.height));
        const layoutWidth = Math.max(maxX - minX, 1);
        const layoutHeight = Math.max(maxY - minY, 1);
        const availableWidth = windowWidth - 52;
        const maxHeight = windowHeight * 0.38;
        const availableDrawingWidth = Math.max(availableWidth - previewMargin * 2, 1);
        const availableDrawingHeight = Math.max(maxHeight - previewMargin * 2, 1);
        const scale = Math.min(availableDrawingWidth / layoutWidth, availableDrawingHeight / layoutHeight, 1);

        return {
            scale,
            width: layoutWidth * scale + previewMargin * 2,
            height: layoutHeight * scale + previewMargin * 2,
            minX,
            minY,
            margin: previewMargin,
        };
    }, [layout, previewMargin, windowHeight, windowWidth]);

    const itemCountsByAreaId = useMemo(() => new Map(
        (layout?.areas ?? []).map((area) => [area.id, items.filter((item) => itemIsInArea(item, area)).length]),
    ), [items, layout]);

    if (!layout || layout.areas.length === 0) {
        return (
            <View style={styles.areaLayoutEmpty}>
                <Text style={styles.areaLayoutEmptyText}>尚未匯入空間配置圖</Text>
                <Text style={styles.areaLayoutEmptyHint}>請先到設定頁繪製並匯入配置圖</Text>
            </View>
        );
    }

    return (
        <View style={styles.areaLayoutSection}>
            {/*<Text style={styles.areaLayoutHint}>點選區域以查看該位置的財產</Text>*/}
            <View style={styles.areaLayoutFrame}>
                <View style={[styles.areaLayoutCanvas, {width: previewSize.width, height: previewSize.height}]}>
                    {layout.areas.map((area) => {
                        const selected = area.id === selectedAreaId;
                        const itemCount = itemCountsByAreaId.get(area.id) ?? 0;
                        const scaledWidth = area.width * previewSize.scale;
                        const scaledHeight = area.height * previewSize.scale;
                        const shape = area.shape ?? getAreaShapeFromStyle(area.style);
                        const rounded = area.rounded ?? isAreaRoundedFromStyle(area.style);

                        return (
                            <TouchableOpacity
                                key={area.id}
                                activeOpacity={0.82}
                                disabled={disabled}
                                onPress={() => onSelectArea(area.id)}
                                style={[
                                    styles.areaLayoutBox,
                                    selected && styles.areaLayoutBoxSelected,
                                    {
                                        left: (area.x - previewSize.minX) * previewSize.scale + previewSize.margin,
                                        top: (area.y - previewSize.minY) * previewSize.scale + previewSize.margin,
                                        width: scaledWidth,
                                        height: scaledHeight,
                                        borderRadius: shape === "ellipse"
                                            ? Math.min(scaledWidth, scaledHeight) / 2
                                            : rounded ? 8 : 0,
                                        borderStyle: (area.dashed ?? isAreaDashedFromStyle(area.style)) ? "dashed" : "solid",
                                    },
                                ]}
                            >
                                {itemCount > 0 && <Text style={styles.areaLayoutCountText}>{itemCount}</Text>}
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>
        </View>
    );
}

export default function I()
{
    const params = useLocalSearchParams();
    const select = params.select != null ? Number(params.select) : undefined;
    const insets = useSafeAreaInsets()
    const {showSpinner, hideSpinner} = useSpinner();
    const {selectedYear, refreshYears} = usePropertyYear();
    const [selected, setSelected] = useState(0);
    const [items, setItems] = useState<AnnualPropertyListItem[]>([]);
    const [areaItems, setAreaItems] = useState<AnnualPropertyListItem[]>([]);
    const [areaLayout, setAreaLayout] = useState<AreaLayout | null>(null);
    const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
    const [displayedAreaId, setDisplayedAreaId] = useState<string | null>(null);
    const [areaItemsTransitioning, setAreaItemsTransitioning] = useState(false);
    const [viewMode, setViewMode] = useState<"list" | "area">("list");
    const [contentViewMode, setContentViewMode] = useState<"list" | "area">("list");
    const [viewModeTransitioning, setViewModeTransitioning] = useState(false);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [input, setInput] = useState("");
    const [focusedInput, setFocusedInput] = useState(false);
    const refreshRequestRef = useRef(0);
    const viewModeOpacity = useRef(new Animated.Value(1)).current;
    const viewModeTranslateY = useRef(new Animated.Value(0)).current;
    const shouldAnimateContentInRef = useRef(false);
    const areaItemsOpacity = useRef(new Animated.Value(1)).current;
    const areaItemsTranslateY = useRef(new Animated.Value(0)).current;
    const shouldAnimateAreaItemsInRef = useRef(false);
    const deferredInput = useDeferredValue(input);
    const visibleItems = useMemo(() => sortAnnualPropertyListItems(searchPropertyItems(deferredInput, items)), [deferredInput, items]);
    const selectedArea = useMemo(
        () => areaLayout?.areas.find((area) => area.id === selectedAreaId) ?? null,
        [areaLayout, selectedAreaId],
    );
    const displayedArea = useMemo(
        () => areaLayout?.areas.find((area) => area.id === displayedAreaId) ?? null,
        [areaLayout, displayedAreaId],
    );
    const selectedAreaItems = useMemo(() => displayedArea
        ? sortAnnualPropertyListItems(areaItems.filter((item) => itemIsInArea(item, displayedArea)))
        : [], [areaItems, displayedArea]);
    const searchPlaceholder = `在「${SEGMENT_VALUES[selected] ?? "清單"}」中搜尋（財產編號、品名、項次）`;

    useEffect(() => {
        if (select !== undefined && select >= 0 && select < STATUS_BY_INDEX.length) {
            setSelected(select);
        }
    }, [select]);

    useEffect(() => {
        if (!shouldAnimateContentInRef.current) return;

        shouldAnimateContentInRef.current = false;
        Animated.parallel([
            Animated.timing(viewModeOpacity, {
                toValue: 1,
                duration: 210,
                useNativeDriver: true,
            }),
            Animated.timing(viewModeTranslateY, {
                toValue: 0,
                duration: 210,
                useNativeDriver: true,
            }),
        ]).start(() => setViewModeTransitioning(false));
    }, [contentViewMode, viewModeOpacity, viewModeTranslateY]);

    useEffect(() => {
        if (!shouldAnimateAreaItemsInRef.current) return;

        shouldAnimateAreaItemsInRef.current = false;
        Animated.parallel([
            Animated.timing(areaItemsOpacity, {
                toValue: 1,
                duration: 180,
                useNativeDriver: true,
            }),
            Animated.timing(areaItemsTranslateY, {
                toValue: 0,
                duration: 180,
                useNativeDriver: true,
            }),
        ]).start(() => setAreaItemsTransitioning(false));
    }, [areaItemsOpacity, areaItemsTranslateY, displayedAreaId]);

    useEffect(() => {
        const selectedAreaStillExists = areaLayout?.areas.some((area) => area.id === selectedAreaId) ?? false;
        if (selectedAreaId && !selectedAreaStillExists) setSelectedAreaId(null);

        const displayedAreaStillExists = areaLayout?.areas.some((area) => area.id === displayedAreaId) ?? false;
        if (displayedAreaId && !displayedAreaStillExists) setDisplayedAreaId(null);
    }, [areaLayout, displayedAreaId, selectedAreaId]);

    const refresh = useCallback(async (showRefreshing = false, requestedYear?: string | null, clearBeforeLoad = false) => {
        const requestId = refreshRequestRef.current + 1;
        refreshRequestRef.current = requestId;

        if (showRefreshing) setRefreshing(true);
        else {
            showSpinner();
            setLoading(true);
            if (clearBeforeLoad) setItems([]);
        }

        try {
            const {selectedYear: year} = await refreshYears(requestedYear ?? selectedYear);
            if (refreshRequestRef.current !== requestId) return;

            if (!year) {
                setItems([]);
                setAreaItems([]);
                setAreaLayout(null);
                return;
            }

            const status = STATUS_BY_INDEX[selected] ?? "unknown";
            const [nextItems, statusItems, nextAreaLayout] = await Promise.all([
                getAnnualPropertyItems(year, status),
                Promise.all(STATUS_BY_INDEX.map((statusValue) => getAnnualPropertyItems(year, statusValue))),
                getStoredAreaLayout(),
            ]);
            if (refreshRequestRef.current !== requestId) return;

            setItems(nextItems);
            setAreaItems(statusItems.flat());
            setAreaLayout(nextAreaLayout);
        } catch (error) {
            if (refreshRequestRef.current !== requestId) return;
            console.error("讀取財產清單失敗:", error);
            Alert.alert("讀取失敗", "無法讀取本機財產清單。");
        } finally {
            if (refreshRequestRef.current === requestId) {
                setLoading(false);
                setRefreshing(false);
                if (!showRefreshing) hideSpinner();
            }
        }
    }, [hideSpinner, refreshYears, selected, selectedYear, showSpinner]);

    useFocusEffect(
        useCallback(() => {
            void refresh();
        }, [refresh])
    );

    const handleChange = (e: {nativeEvent: {selectedSegmentIndex: number}}) => {
        const index = e.nativeEvent.selectedSegmentIndex;
        refreshRequestRef.current += 1;
        showSpinner();
        setItems([]);
        setAreaItems([]);
        setLoading(true);
        setSelected(index);
        router.setParams({ select: String(index) });
    };

    const handleYearSelectionAccepted = useCallback((year: string) => {
        refreshRequestRef.current += 1;
        showSpinner();
        setItems([]);
        setAreaItems([]);
        setLoading(true);
        void refresh(false, year, true);
    }, [refresh, showSpinner]);

    const handleClear = () => {
        setInput("");
        Keyboard.dismiss();
    };

    const renderItem = useCallback(({item}: {item: AnnualPropertyListItem}) => (
        <ItemCard
            itemNumber={item.itemNumber}
            barcode={item.barcode}
            propertyName={item.propertyName}
            location={item.location}
            note={item.note}
            status={item.status}
            onPress={() => {
                router.push({
                    pathname: "/stacks/details",
                    params: {
                        barcode: item.barcode,
                        entityIndex: String(item.entityIndex),
                        status: item.status,
                        ...(selectedYear ? {year: selectedYear} : {}),
                    },
                });
            }}
        />
    ), [selectedYear]);

    const renderAreaItem = useCallback(({item}: {item: AnnualPropertyListItem}) => (
        <Animated.View
            pointerEvents={areaItemsTransitioning ? "none" : "auto"}
            style={{opacity: areaItemsOpacity, transform: [{translateY: areaItemsTranslateY}]}}
        >
            {renderItem({item})}
        </Animated.View>
    ), [areaItemsOpacity, areaItemsTransitioning, areaItemsTranslateY, renderItem]);

    const handleSelectArea = useCallback((areaId: string) => {
        if (areaItemsTransitioning) return;

        const nextAreaId = selectedAreaId === areaId ? null : areaId;
        setSelectedAreaId(nextAreaId);
        setAreaItemsTransitioning(true);
        Animated.sequence([
            Animated.delay(90),
            Animated.parallel([
                Animated.timing(areaItemsOpacity, {
                    toValue: 0,
                    duration: 110,
                    useNativeDriver: true,
                }),
                Animated.timing(areaItemsTranslateY, {
                    toValue: -5,
                    duration: 110,
                    useNativeDriver: true,
                }),
            ]),
        ]).start(({finished}) => {
            if (!finished) {
                areaItemsOpacity.setValue(1);
                areaItemsTranslateY.setValue(0);
                setAreaItemsTransitioning(false);
                return;
            }

            shouldAnimateAreaItemsInRef.current = true;
            areaItemsTranslateY.setValue(7);
            setDisplayedAreaId(nextAreaId);
        });
    }, [areaItemsOpacity, areaItemsTransitioning, areaItemsTranslateY, selectedAreaId]);

    const toggleViewMode = useCallback(() => {
        if (viewModeTransitioning) return;

        setViewModeTransitioning(true);
        const nextViewMode = viewMode === "list" ? "area" : "list";
        setViewMode(nextViewMode);
        Animated.sequence([
            Animated.delay(90),
            Animated.parallel([
                Animated.timing(viewModeOpacity, {
                    toValue: 0,
                    duration: 120,
                    useNativeDriver: true,
                }),
                Animated.timing(viewModeTranslateY, {
                    toValue: -6,
                    duration: 120,
                    useNativeDriver: true,
                }),
            ]),
        ]).start(({finished}) => {
            if (!finished) {
                viewModeOpacity.setValue(1);
                viewModeTranslateY.setValue(0);
                setViewMode(contentViewMode);
                setViewModeTransitioning(false);
                return;
            }

            shouldAnimateContentInRef.current = true;
            viewModeTranslateY.setValue(8);
            setContentViewMode(nextViewMode);
        });
    }, [contentViewMode, viewMode, viewModeOpacity, viewModeTransitioning, viewModeTranslateY]);

    return (
        <View style={[styles.container, {paddingTop: insets.top + 15  }]}>
            <View style={styles.headerRow}>
                <View style={styles.headerTitleRow}>
                    <Text style={styles.text}>{viewMode === "area" ? "區域配置" : "財產清單"}</Text>
                    <TouchableOpacity
                        activeOpacity={0.7}
                        disabled={viewModeTransitioning || areaItemsTransitioning}
                        hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                        onPress={toggleViewMode}
                        style={styles.viewModeButton}
                    >
                        <Icon
                            name={viewMode === "list" ? "map" : "checklist"}
                            fontFamily={viewMode === "list" ? "Feather" : "Octicons"}
                            color="blue600"
                            fontSize="lg"
                        />
                    </TouchableOpacity>
                </View>
                <PropertyYearDropdown
                    containerStyle={styles.yearPickerEdge}
                    onSelectionAccepted={handleYearSelectionAccepted}
                    hideWhenDisabled
                />
            </View>
            <Animated.View style={[styles.viewModeContent, {opacity: viewModeOpacity, transform: [{translateY: viewModeTranslateY}]}]}>
                {contentViewMode === "list" && <ExpoSegmentedControl
                    values={SEGMENT_VALUES}
                    selectedIndex={selected}
                    onChange={handleChange}
                    appearance="light"
                />}
                {contentViewMode === "list" && items.length > 0 && (
                    <Div row alignItems="center" mt="lg" mb="md">
                        <Input
                            flex={1}
                            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                            value={input}
                            focusBorderColor="blue400"
                            px="lg"
                            pl={18}
                            fontSize="md"
                            mx={3}
                            onChange={(e) => setInput(e.nativeEvent.text)}
                            rounded="circle"
                            borderWidth={1.5}
                            placeholder={searchPlaceholder}
                            onFocus={() => setFocusedInput(true)}
                            onBlur={() => setFocusedInput(false)}
                            suffix={
                                focusedInput || input.length > 0 ? (
                                    <TouchableOpacity onPress={handleClear} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                                        <Icon name="close-circle" color="gray500" fontSize="xl" fontFamily="Ionicons" mx="sm" />
                                    </TouchableOpacity>
                                ) : (
                                    <Icon mx="xs" mb={2} name="search" color="gray500" fontSize="md" fontFamily="FontAwesome" />
                                )
                            }
                        />
                    </Div>
                )}
                {contentViewMode === "list" ? (
                    <FlatList
                        key="property-list"
                        data={visibleItems}
                        keyExtractor={(item) => `${item.barcode}:${item.entityIndex}`}
                        renderItem={renderItem}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[styles.listContent, visibleItems.length === 0 && styles.emptyListContent]}
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(true); }} />}
                        ListEmptyComponent={(
                            <View style={styles.emptyState}>
                                <Text style={styles.emptyText}>
                                    {loading ? "讀取中..." : input.trim() ? "沒有符合搜尋條件的財產資料" : "沒有符合此狀態的財產資料"}
                                </Text>
                            </View>
                        )}
                    />
                ) : (
                    <>
                        <AreaLayoutOverview
                            layout={areaLayout}
                            items={areaItems}
                            selectedAreaId={selectedAreaId}
                            disabled={areaItemsTransitioning}
                            onSelectArea={handleSelectArea}
                        />
                        <Text style={styles.selectedAreaTitle}>
                            {selectedArea ? `「${selectedArea.name || "未命名區域"}」的財產` : "請點擊選取想查看區域"}
                        </Text>
                        <FlatList
                            key="area-layout-list"
                            data={selectedAreaItems}
                            keyExtractor={(item) => `${item.barcode}:${item.entityIndex}`}
                            renderItem={renderAreaItem}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={[styles.areaListContent, selectedAreaItems.length === 0 && styles.areaEmptyListContent]}
                            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(true); }} />}
                            ListEmptyComponent={(
                                <Animated.View style={[styles.areaItemsEmptyState, {opacity: areaItemsOpacity, transform: [{translateY: areaItemsTranslateY}]}]}>
                                    <Text style={styles.emptyText}>
                                        {loading ? "讀取中..." : selectedArea ? "此區域目前沒有放置財產" : "點選配置圖中的區域，\n即可查看放置在該處的財產"}
                                    </Text>
                                </Animated.View>
                            )}
                        />
                    </>
                )}
            </Animated.View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 16,
        backgroundColor: "white",
    },
    text: {
        fontSize: 30,
        fontWeight: 'bold',
        color: 'black',
        marginLeft: 3
    },
    headerRow: {
        minHeight: 42,
        marginBottom: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitleRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    yearPickerEdge: {
        marginRight: 0,
    },
    viewModeButton: {
        marginLeft: 10,
        padding: 6,
        borderRadius: 18,
        backgroundColor: "#EFF6FF",
    },
    viewModeContent: {
        flex: 1,
    },
    listContent: {
        paddingTop: 5,
        paddingBottom: 28,
    },
    emptyListContent: {
        flexGrow: 1,
    },
    emptyState: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    emptyText: {
        color: "#667085",
        fontSize: 14,
        textAlign: "center",
    },
    areaListContent: {
        paddingTop: 2,
        paddingBottom: 28,
    },
    areaEmptyListContent: {
        flexGrow: 1,
    },
    areaLayoutSection: {
        marginTop: 6,
        marginBottom: 18,
    },
    areaLayoutHint: {
        marginBottom: 9,
        color: "#667085",
        fontSize: 14,
        textAlign: "center",
    },
    areaLayoutFrame: {
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: 14,
        backgroundColor: "#F8FAFC",
    },
    areaLayoutCanvas: {
        position: "relative",
        backgroundColor: "#F8FAFC",
    },
    areaLayoutBox: {
        position: "absolute",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(71, 85, 105, 0.7)",
        backgroundColor: "rgba(255, 255, 255, 0.76)",
    },
    areaLayoutBoxSelected: {
        backgroundColor: "rgba(34, 197, 94, 0.32)",
    },
    areaLayoutCountText: {
        color: "#111827",
        fontSize: 10,
        // fontWeight: "700",
    },
    areaLayoutEmpty: {
        minHeight: 150,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 18,
        borderRadius: 14,
        backgroundColor: "#F8FAFC",
    },
    areaLayoutEmptyText: {
        color: "#B42318",
        fontSize: 16,
        fontWeight: "700",
    },
    areaLayoutEmptyHint: {
        marginTop: 6,
        color: "#B54708",
        fontSize: 14,
    },
    selectedAreaTitle: {
        marginBottom: 15,
        // marginLeft: 6,
        color: "#344054",
        fontSize: 16,
        fontWeight: "700",
        textAlign: "center",
    },
    areaItemsEmptyState: {
        minHeight: 120,
        alignItems: "center",
        justifyContent: "center",
    },
})
