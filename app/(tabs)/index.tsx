import {Alert, FlatList, Keyboard, RefreshControl, StyleSheet, Text, TouchableOpacity, View} from "react-native";
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

const STATUS_BY_INDEX: PropertyStatus[] = ["unknown", "checked", "pending"];
const SEGMENT_VALUES = ["未清點", "已確認", "待處理"];

export default function I()
{
    const params = useLocalSearchParams();
    const select = params.select != null ? Number(params.select) : undefined;
    const insets = useSafeAreaInsets()
    const {showSpinner, hideSpinner} = useSpinner();
    const {selectedYear, refreshYears} = usePropertyYear();
    const [selected, setSelected] = useState(0);
    const [items, setItems] = useState<AnnualPropertyListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [input, setInput] = useState("");
    const [focusedInput, setFocusedInput] = useState(false);
    const refreshRequestRef = useRef(0);
    const deferredInput = useDeferredValue(input);
    const visibleItems = useMemo(() => sortAnnualPropertyListItems(searchPropertyItems(deferredInput, items)), [deferredInput, items]);
    const searchPlaceholder = `在「${SEGMENT_VALUES[selected] ?? "清單"}」中搜尋（財產編號、品名、項次）`;

    useEffect(() => {
        if (select !== undefined && select >= 0 && select < STATUS_BY_INDEX.length) {
            setSelected(select);
        }
    }, [select]);

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
                return;
            }

            const status = STATUS_BY_INDEX[selected] ?? "unknown";
            const nextItems = await getAnnualPropertyItems(year, status);
            if (refreshRequestRef.current !== requestId) return;

            setItems(nextItems);
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
        setLoading(true);
        setSelected(index);
        router.setParams({ select: String(index) });
    };

    const handleYearSelectionAccepted = useCallback((year: string) => {
        refreshRequestRef.current += 1;
        showSpinner();
        setItems([]);
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

    return (
        <View style={[styles.container, {paddingTop: insets.top + 15  }]}>
            <View style={styles.headerRow}>
                <Text style={styles.text}>財產清單</Text>
                <PropertyYearDropdown
                    containerStyle={styles.yearPickerEdge}
                    onSelectionAccepted={handleYearSelectionAccepted}
                    hideWhenDisabled
                />
            </View>
            <ExpoSegmentedControl
                values={SEGMENT_VALUES}
                selectedIndex={selected}
                onChange={handleChange}
                appearance="light"
            />
            {items.length > 0 && (
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
            <FlatList
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
    yearPickerEdge: {
        marginRight: 0,
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
        fontSize: 16,
    },
})
