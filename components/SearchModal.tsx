import {useDeferredValue, useEffect, useMemo, useRef, useState} from "react";
import {
    ActivityIndicator,
    FlatList,
    Keyboard,
    Platform,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from "react-native";
import {router} from "expo-router";
import Modal from "react-native-modal";
import {Icon, Input, Text} from "react-native-magnus";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {centeredEdgeToEdgeModalProps} from "@/constants/centeredModal";
import {getBottomModalSafeAreaPadding} from "@/constants/bottomModalSafeArea";
import ItemCard from "@/components/main/ItemCard";
import PropertyTagFilterBar from "@/components/PropertyTagFilterBar";
import {
    getAnnualPropertyItems,
    sortAnnualPropertyListItems,
    type AnnualPropertyListItem,
} from "@/handlers/propertyList";
import {filterPropertyItemsByTags, searchPropertyItems} from "@/handlers/propertySearch";
import {PROPERTY_STATUS_VALUES} from "@/handlers/propertyStatusStore";
import {usePropertyYear} from "@/context/PropertyYearContext";
import {getVisiblePropertyTagCategories, mergePropertyTagCategories} from "@/handlers/propertyTagging";

type SearchModalProps = {
    visible: boolean;
    onClose: () => void;
    onNavigate: (shouldReopenOnReturn: boolean) => void;
};
type CancelableTask = {cancel: () => void};
type IdleApi = typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: {timeout?: number}) => number;
    cancelIdleCallback?: (handle: number) => void;
};
let persistedSearchKeyword = "";

function runWhenIdle(callback: () => void): CancelableTask {
    const idleApi = globalThis as IdleApi;
    if (typeof idleApi.requestIdleCallback === "function") {
        const handle = idleApi.requestIdleCallback(callback, {timeout: 300});
        return {cancel: () => idleApi.cancelIdleCallback?.(handle)};
    }

    const timeout = setTimeout(callback, 16);
    return {cancel: () => clearTimeout(timeout)};
}

export default function SearchModal({visible, onClose, onNavigate}: SearchModalProps) {
    const insets = useSafeAreaInsets();
    const {selectedYear} = usePropertyYear();
    const bottomModalSafeAreaPadding = getBottomModalSafeAreaPadding(insets.bottom);
    const [keyword, setKeyword] = useState(() => persistedSearchKeyword);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [items, setItems] = useState<AnnualPropertyListItem[]>([]);
    const [sourceYear, setSourceYear] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [modalReadyForDataLoad, setModalReadyForDataLoad] = useState(false);
    const pendingNavigationRef = useRef<AnnualPropertyListItem | null>(null);
    const inputRef = useRef<any>(null);

    useEffect(() => {
        if (!visible || !modalReadyForDataLoad) {
            return;
        }

        let mounted = true;

        const loadTask = runWhenIdle(() => {
            void (async () => {
                setLoading(true);
                setLoadError(null);

                try {
                    if (!selectedYear) {
                        if (mounted) {
                            setSourceYear(null);
                            setItems([]);
                        }
                        return;
                    }

                    const annualItems = (await Promise.all(
                        PROPERTY_STATUS_VALUES.map((status) => getAnnualPropertyItems(selectedYear, status)),
                    )).flat();

                    if (mounted) {
                        setSourceYear(selectedYear);
                        setItems(sortAnnualPropertyListItems(annualItems));
                    }
                } catch (error) {
                    console.error("讀取搜尋資料失敗:", error);
                    if (mounted) {
                        setSourceYear(null);
                        setItems([]);
                        setLoadError("無法讀取財產資料，請稍後再試。");
                    }
                } finally {
                    if (mounted) setLoading(false);
                }
            })();
        });

        return () => {
            mounted = false;
            loadTask.cancel();
        };
    }, [modalReadyForDataLoad, selectedYear, visible]);

    const deferredKeyword = useDeferredValue(keyword);
    const trimmedKeyword = keyword.trim();
    const shouldAutoFocusInput = visible && keyword.length === 0;
    const allTagCategories = useMemo(() => mergePropertyTagCategories(
        items.flatMap((item) => item.tags ?? []),
    ), [items]);
    const activeSelectedTags = useMemo(() => (
        selectedTags.filter((tag) => allTagCategories.includes(tag))
    ), [allTagCategories, selectedTags]);
    const tagFilteredItems = useMemo(() => (
        filterPropertyItemsByTags(items, activeSelectedTags)
    ), [activeSelectedTags, items]);
    const tagCategories = useMemo(() => mergePropertyTagCategories(
        activeSelectedTags,
        tagFilteredItems.flatMap((item) => item.tags ?? []),
    ), [activeSelectedTags, tagFilteredItems]);
    const visibleTagCategories = useMemo(() => (
        getVisiblePropertyTagCategories(tagCategories, activeSelectedTags, deferredKeyword)
    ), [activeSelectedTags, deferredKeyword, tagCategories]);
    const results = useMemo(() => {
        return searchPropertyItems(deferredKeyword, tagFilteredItems);
    }, [deferredKeyword, tagFilteredItems]);
    const hasActiveFilters = trimmedKeyword.length > 0 || activeSelectedTags.length > 0;

    const updateKeyword = (nextKeyword: string) => {
        persistedSearchKeyword = nextKeyword;
        setKeyword(nextKeyword);
    };

    const clearKeyword = () => {
        updateKeyword("");
        requestAnimationFrame(() => {
            inputRef.current?.focus?.();
        });
    };

    const toggleTag = (tag: string) => {
        const selecting = !selectedTags.includes(tag);
        setSelectedTags((current) => (
            current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
        ));
        if (selecting) updateKeyword("");
    };

    const closeModal = () => {
        Keyboard.dismiss();
        pendingNavigationRef.current = null;
        onClose();
    };

    const navigateToItem = (item: AnnualPropertyListItem) => {
        Keyboard.dismiss();
        pendingNavigationRef.current = item;
        onNavigate(true);
    };

    const renderResult = ({item}: {item: AnnualPropertyListItem}) => (
        <ItemCard
            itemNumber={item.itemNumber}
            barcode={item.barcode}
            propertyName={item.propertyName}
            location={item.location}
            note={item.note}
            tags={item.tags}
            status={item.status}
            onPress={() => navigateToItem(item)}
        />
    );

    return (
        <Modal
            isVisible={visible}
            animationIn="slideInUp"
            animationOut="slideOutDown"
            animationInTiming={150}
            animationOutTiming={150}
            useNativeDriver
            useNativeDriverForBackdrop
            hideModalContentWhileAnimating
            hasBackdrop
            backdropOpacity={0.45}
            backdropTransitionOutTiming={1}
            onBackdropPress={closeModal}
            onBackButtonPress={closeModal}
            swipeDirection="down"
            onSwipeComplete={closeModal}
            propagateSwipe
            avoidKeyboard={Platform.OS === "ios"}
            style={styles.modal}
            onModalShow={() => setModalReadyForDataLoad(true)}
            onModalHide={() => {
                setModalReadyForDataLoad(false);
                const pendingItem = pendingNavigationRef.current;
                if (!pendingItem) return;

                pendingNavigationRef.current = null;
                router.navigate({
                    pathname: "/stacks/details",
                    params: {
                        barcode: pendingItem.barcode,
                        entityIndex: String(pendingItem.entityIndex),
                        status: pendingItem.status,
                        ...(selectedYear ? {year: selectedYear} : {}),
                    },
                });
            }}
            {...centeredEdgeToEdgeModalProps}
        >
            <View style={styles.androidKeyboardAvoidingView}>
                <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                    <View style={[styles.modalInnerContainer, {paddingBottom: 10 + bottomModalSafeAreaPadding}]}>
                        <View style={styles.header}>
                            <View style={styles.headerCopy}>
                                <Text fontSize="2xl" fontWeight="bold" color="gray900">
                                    搜尋財產資料
                                </Text>
                                <Text mt={3} fontSize="md" color="gray600">
                                    {sourceYear ? `搜尋 ${sourceYear} 年度資料` : "請先匯入財產資料"}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={closeModal} hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                                <Icon name="close" color="gray700" fontSize="2xl" fontFamily="AntDesign" />
                            </TouchableOpacity>
                        </View>

                        <Input
                            ref={inputRef}
                            autoFocus={shouldAutoFocusInput}
                            value={keyword}
                            onChangeText={updateKeyword}
                            fontSize="xl"
                            borderColor="gray400"
                            placeholder="輸入編號、品名、備註、分類等進行搜尋"
                            mb="sm"
                            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                            prefix={<Icon name="search" fontFamily="Feather" color="gray500" fontSize="lg" mr="sm" />}
                            suffix={keyword.length > 0 ? (
                                <TouchableOpacity onPress={clearKeyword} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                                    <Icon name="x-circle" fontFamily="Feather" color="gray500" fontSize="lg" />
                                </TouchableOpacity>
                            ) : undefined}
                        />

                        {tagCategories.length > 0 && (
                            <PropertyTagFilterBar
                                tags={visibleTagCategories}
                                selectedTags={activeSelectedTags}
                                onToggle={toggleTag}
                            />
                        )}

                        <View style={styles.resultHeader}>
                            <Text fontSize="md" fontWeight="bold" color="gray800">
                                {hasActiveFilters ? "搜尋結果" : "所有財產"}
                            </Text>
                            <Text fontSize="sm" color="gray600">
                                {`${results.length} 筆`}
                            </Text>
                        </View>

                        {loading ? (
                            <View style={styles.centerState}>
                                <ActivityIndicator color="#2563EB" />
                                <Text mt="sm" color="gray600" fontSize="md">
                                    讀取資料中...
                                </Text>
                            </View>
                        ) : loadError ? (
                            <View style={styles.centerState}>
                                <Icon name="alert-circle" fontFamily="Feather" color="red500" fontSize={34} />
                                <Text mt="sm" color="red500" fontSize="md" textAlign="center">
                                    {loadError}
                                </Text>
                            </View>
                        ) : !sourceYear ? (
                            <View style={styles.centerState}>
                                <Icon name="database" fontFamily="Feather" color="gray500" fontSize={34} />
                                <Text mt="sm" color="gray600" fontSize="md" textAlign="center">
                                    尚未匯入財產資料。
                                </Text>
                            </View>
                        ) : results.length === 0 ? (
                            <View style={styles.centerState}>
                                <Icon name="inbox" fontFamily="Feather" color="gray500" fontSize={34} />
                                <Text mt="sm" color="gray600" fontSize="md" textAlign="center">
                                    {hasActiveFilters ? "找不到符合的財產資料。" : "目前沒有財產資料。"}
                                </Text>
                            </View>
                        ) : (
                            <FlatList
                                data={results}
                                keyExtractor={(item) => `${item.barcode}:${item.entityIndex}:${item.status}`}
                                renderItem={renderResult}
                                keyboardShouldPersistTaps="handled"
                                showsVerticalScrollIndicator={false}
                                style={styles.resultsList}
                                contentContainerStyle={[styles.resultsContent, {paddingBottom: 20 + bottomModalSafeAreaPadding}]}
                            />
                        )}
                    </View>
                </TouchableWithoutFeedback>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modal: {
        justifyContent: "flex-end",
        margin: 0,
    },
    androidKeyboardAvoidingView: {
        width: "100%",
        flex: 1,
        justifyContent: "flex-end",
    },
    modalInnerContainer: {
        width: "100%",
        height: "90%",
        backgroundColor: "white",
        paddingTop: 25,
        paddingHorizontal: 20,
        paddingBottom: 10,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
    },
    header: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    headerCopy: {
        flexShrink: 1,
    },
    resultHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 4,
        paddingVertical: 10,
    },
    resultsList: {
        flex: 1,
        marginHorizontal: -4,
    },
    resultsContent: {
        paddingHorizontal: 4,
        paddingBottom: 20,
    },
    centerState: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
    },
});
