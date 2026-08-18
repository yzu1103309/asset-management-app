import {Alert, FlatList, Keyboard, Modal, RefreshControl, StyleSheet, Text, TouchableOpacity, View} from "react-native";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import {Picker as RNPicker} from "@react-native-picker/picker";
import {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from "react";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {router, useFocusEffect, useLocalSearchParams} from "expo-router";
import {Div, Icon, Input} from "react-native-magnus";
import ItemCard from "@/components/main/ItemCard";
import {
    getAnnualPropertyItems,
    getAvailablePropertyYears,
    sortAnnualPropertyListItems,
    type AnnualPropertyListItem,
} from "@/handlers/propertyList";
import type {PropertyStatus} from "@/handlers/propertyStatusStore";
import {searchPropertyItems} from "@/handlers/propertySearch";
import {useSpinner} from "@/context/SpinnerContext";

const STATUS_BY_INDEX: PropertyStatus[] = ["unknown", "checked", "pending"];
const SEGMENT_VALUES = ["未清點", "已確認", "待處理"];

function YearPicker({
    availableYears,
    selectedYear,
    onSelectYear,
}: {
    availableYears: string[];
    selectedYear: string | null;
    onSelectYear: (year: string) => void;
}) {
    const [modalVisible, setModalVisible] = useState(false);
    const [draftYear, setDraftYear] = useState(selectedYear ?? availableYears[0] ?? "");

    useEffect(() => {
        if (modalVisible) {
            setDraftYear(selectedYear ?? availableYears[0] ?? "");
        }
    }, [availableYears, modalVisible, selectedYear]);

    if (availableYears.length === 0) {
        return (
            <View style={[styles.yearPickerButton, styles.yearPickerButtonDisabled]}>
                <Text style={[styles.yearPickerButtonText, styles.yearPickerButtonTextDisabled]}>
                    尚未匯入
                </Text>
            </View>
        );
    }

    const confirmSelection = () => {
        setModalVisible(false);
        if (draftYear) onSelectYear(draftYear);
    };

    return (
        <>
            <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setModalVisible(true)}
                style={styles.yearPickerButton}
            >
                <Text style={styles.yearPickerButtonText}>
                    {selectedYear ? `${selectedYear} 年度` : "選擇年度"}
                </Text>
                <Icon name="chevron-down" fontFamily="Feather" color="#2581eb" fontSize="lg" ml="xs" />
            </TouchableOpacity>

            <Modal
                transparent
                visible={modalVisible}
                animationType="fade"
                onRequestClose={() => setModalVisible(false)}
            >
                <TouchableOpacity
                    activeOpacity={1}
                    style={styles.yearPickerModalBackdrop}
                    onPress={() => setModalVisible(false)}
                >
                    <View
                        style={styles.yearPickerModalPanel}
                        onStartShouldSetResponder={() => true}
                    >
                        <View style={styles.yearPickerModalHeader}>
                            <Text style={styles.yearPickerModalTitle}>選擇年度</Text>
                            <Text style={styles.yearPickerModalSubtitle}>選擇要查看的年度清單與盤點狀態</Text>
                        </View>

                        <View style={styles.yearPickerContainer}>
                            <RNPicker
                                selectedValue={draftYear}
                                onValueChange={(value) => {
                                    if (typeof value === "string") setDraftYear(value);
                                }}
                                style={styles.yearPicker}
                                itemStyle={styles.yearPickerItem}
                            >
                                {availableYears.map((year) => (
                                    <RNPicker.Item key={year} label={`${year} 年度`} value={year} />
                                ))}
                            </RNPicker>
                        </View>

                        <View style={styles.yearPickerModalActions}>
                            <TouchableOpacity
                                activeOpacity={0.78}
                                onPress={() => setModalVisible(false)}
                                style={[styles.yearPickerModalActionButton, styles.yearPickerModalCancelButton]}
                            >
                                <Text style={styles.yearPickerModalCancel}>取消</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.78}
                                onPress={confirmSelection}
                                style={[styles.yearPickerModalActionButton, styles.yearPickerModalDoneButton]}
                            >
                                <Text style={styles.yearPickerModalDone}>完成</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableOpacity>
            </Modal>
        </>
    );
}

export default function I()
{
    const params = useLocalSearchParams();
    const select = params.select != null ? Number(params.select) : undefined;
    const insets = useSafeAreaInsets()
    const {showSpinner, hideSpinner} = useSpinner();
    const [selected, setSelected] = useState(0);
    const [availableYears, setAvailableYears] = useState<string[]>([]);
    const [selectedYear, setSelectedYear] = useState<string | null>(null);
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
            const years = await getAvailablePropertyYears();
            const preferredYear = requestedYear ?? selectedYear;
            const year = preferredYear && years.includes(preferredYear) ? preferredYear : years[0] ?? null;
            if (refreshRequestRef.current !== requestId) return;

            setAvailableYears(years);
            setSelectedYear(year);

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
    }, [hideSpinner, selected, selectedYear, showSpinner]);

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

    const selectYear = (year: string) => {
        if (year === selectedYear) return;

        refreshRequestRef.current += 1;
        showSpinner();
        setItems([]);
        setLoading(true);
        setSelectedYear(year);
        void refresh(false, year, true);
    };

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
                router.push({pathname: "/stacks/details", params: {barcode: item.barcode, entityIndex: String(item.entityIndex), status: item.status}});
            }}
        />
    ), []);

    return (
        <View style={[styles.container, {paddingTop: insets.top + 15  }]}>
            <View style={styles.headerRow}>
                <Text style={styles.text}>財產清單</Text>
                <YearPicker
                    availableYears={availableYears}
                    selectedYear={selectedYear}
                    onSelectYear={selectYear}
                />
            </View>
            <SegmentedControl
                values={SEGMENT_VALUES}
                selectedIndex={selected}
                onChange={handleChange}
                appearance="light"
            >
            </SegmentedControl>
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
    yearPickerButton: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 2,
    },
    yearPickerButtonDisabled: {
        opacity: 0.55,
    },
    yearPickerButtonText: {
        color: "#2581eb",
        fontSize: 16,
        fontWeight: "800",
    },
    yearPickerButtonTextDisabled: {
        color: "#98A2B3",
    },
    yearPickerModalBackdrop: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 22,
        backgroundColor: "rgba(15, 23, 42, 0.35)",
    },
    yearPickerModalPanel: {
        width: "100%",
        maxWidth: 420,
        paddingTop: 20,
        paddingHorizontal: 18,
        paddingBottom: 18,
        borderRadius: 18,
        backgroundColor: "white",
    },
    yearPickerModalHeader: {
        alignItems: "center",
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#EAECF0",
    },
    yearPickerModalTitle: {
        color: "#101828",
        fontSize: 20,
        fontWeight: "800",
    },
    yearPickerModalSubtitle: {
        marginTop: 6,
        color: "#667085",
        fontSize: 14,
        textAlign: "center",
    },
    yearPickerModalActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingTop: 10,
    },
    yearPickerModalActionButton: {
        flex: 1,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
    },
    yearPickerModalCancelButton: {
        backgroundColor: "#F2F4F7",
    },
    yearPickerModalDoneButton: {
        backgroundColor: "#2563EB",
    },
    yearPickerModalCancel: {
        color: "#344054",
        fontSize: 16,
        fontWeight: "800",
    },
    yearPickerModalDone: {
        color: "white",
        fontSize: 16,
        fontWeight: "800",
    },
    yearPickerContainer: {
        height: 150,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    yearPicker: {
        width: "100%",
        height: 150,
        color: "#00b7ff",
    },
    yearPickerItem: {
        color: "#2563EB",
        fontSize: 16,
        fontWeight: "800",
        height: 150,
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
