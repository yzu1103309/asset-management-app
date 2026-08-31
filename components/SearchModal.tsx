import {useEffect, useMemo, useRef, useState} from "react";
import {
    ActivityIndicator,
    FlatList,
    InteractionManager,
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
import {
    getAnnualPropertyItems,
    getAvailablePropertyYears,
    sortAnnualPropertyListItems,
    type AnnualPropertyListItem,
} from "@/handlers/propertyList";
import {searchPropertyItems} from "@/handlers/propertySearch";
import {PROPERTY_STATUS_VALUES} from "@/handlers/propertyStatusStore";

type SearchModalProps = {
    visible: boolean;
    onClose: () => void;
    onNavigate: (shouldReopenOnReturn: boolean) => void;
};

function getLatestYear(years: string[]): string | null {
    return [...years].sort((a, b) => Number(b) - Number(a))[0] ?? null;
}

export default function SearchModal({visible, onClose, onNavigate}: SearchModalProps) {
    const insets = useSafeAreaInsets();
    const bottomModalSafeAreaPadding = getBottomModalSafeAreaPadding(insets.bottom);
    const [keyword, setKeyword] = useState("");
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

        const loadTask = InteractionManager.runAfterInteractions(() => {
            void (async () => {
                setLoading(true);
                setLoadError(null);

                try {
                    const latestYear = getLatestYear(await getAvailablePropertyYears());
                    if (!latestYear) {
                        if (mounted) {
                            setSourceYear(null);
                            setItems([]);
                        }
                        return;
                    }

                    const annualItems = (await Promise.all(
                        PROPERTY_STATUS_VALUES.map((status) => getAnnualPropertyItems(latestYear, status)),
                    )).flat();

                    if (mounted) {
                        setSourceYear(latestYear);
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
    }, [modalReadyForDataLoad, visible]);

    const trimmedKeyword = keyword.trim();
    const shouldAutoFocusInput = visible && keyword.length === 0;
    const results = useMemo(() => {
        if (!trimmedKeyword) return [];

        return searchPropertyItems(trimmedKeyword, items);
    }, [items, trimmedKeyword]);

    const clearKeyword = () => {
        setKeyword("");
        requestAnimationFrame(() => {
            inputRef.current?.focus?.();
        });
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
                            onChangeText={setKeyword}
                            fontSize="xl"
                            borderColor="gray400"
                            placeholder="輸入品名、項次或財產編號"
                            mb="sm"
                            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                            prefix={<Icon name="search" fontFamily="Feather" color="gray500" fontSize="lg" mr="sm" />}
                            suffix={keyword.length > 0 ? (
                                <TouchableOpacity onPress={clearKeyword} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                                    <Icon name="x-circle" fontFamily="Feather" color="gray500" fontSize="lg" />
                                </TouchableOpacity>
                            ) : undefined}
                        />

                        <View style={styles.resultHeader}>
                            <Text fontSize="md" fontWeight="bold" color="gray800">
                                搜尋結果
                            </Text>
                            <Text fontSize="sm" color="gray600">
                                {trimmedKeyword ? `${results.length} 筆` : "輸入關鍵字後即時搜尋"}
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
                        ) : !trimmedKeyword ? (
                            <View style={styles.centerState}>
                                <Icon name="search" fontFamily="Feather" color="gray500" fontSize={34} />
                                <Text mt="sm" color="gray600" fontSize="md" textAlign="center">
                                    可搜尋品名、項次，或輸入完整財產編號。
                                </Text>
                            </View>
                        ) : results.length === 0 ? (
                            <View style={styles.centerState}>
                                <Icon name="inbox" fontFamily="Feather" color="gray500" fontSize={34} />
                                <Text mt="sm" color="gray600" fontSize="md" textAlign="center">
                                    找不到符合的財產資料。
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
