import {useCallback, useEffect, useRef, useState} from "react";
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Keyboard,
    type KeyboardEvent,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import {Stack} from "expo-router";
import {getStoredAppMemo, saveAppMemo} from "@/handlers/appMemo";

const INITIAL_FOCUS_DELAY_MS = 600;
const EDITOR_LINE_HEIGHT = 26;
const CARET_KEYBOARD_GAP = EDITOR_LINE_HEIGHT * 5;
const CARET_VIEWPORT_TOP_GAP = EDITOR_LINE_HEIGHT * 3;
const EDITOR_BOTTOM_PADDING_RATIO = 0.4;
const EDITOR_HEIGHT_SAFETY = 2;
const ANDROID_KEYBOARD_RESIZE_THRESHOLD = EDITOR_LINE_HEIGHT * 2;
const SELECTION_DRAG_MIN_SCROLL_PER_FRAME = 2;
const SELECTION_DRAG_MAX_SCROLL_PER_FRAME = EDITOR_LINE_HEIGHT * 0.7;
const SELECTION_DRAG_SCROLL_ACCELERATION = 0.18;
const CONTENT_TOP_PADDING = 22;
const MEMO_PLACEHOLDER = "請輸入備忘事項";

export default function MemoScreen() {
    const inputRef = useRef<TextInput>(null);
    const documentScrollRef = useRef<ScrollView>(null);
    const editorViewportRef = useRef<View>(null);
    const editorViewportPageYRef = useRef(0);
    const androidExpandedViewportHeightRef = useRef(0);
    const androidKeyboardVisibleRef = useRef(false);
    const keyboardTopRef = useRef<number | null>(null);
    const documentScrollOffsetRef = useRef(0);
    const editorViewportHeightRef = useRef(0);
    const latestSelectionRef = useRef({start: 0, end: 0});
    const selectionFocusRef = useRef(0);
    const caretBottomRef = useRef(0);
    const caretScrollFrameRef = useRef<number | null>(null);
    const selectionDragScrollFrameRef = useRef<number | null>(null);
    const selectionDragScrollVelocityRef = useRef(0);
    const editorTextHeightRef = useRef(EDITOR_LINE_HEIGHT);
    const editorNaturalHeightRef = useRef(EDITOR_LINE_HEIGHT);
    const pendingHeightReleaseOffsetRef = useRef<number | null>(null);
    const latestDraftRef = useRef("");
    const memoLoadedRef = useRef(false);
    const delayInitialFocusRef = useRef(false);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedText, setSavedText] = useState("");
    const [draftText, setDraftText] = useState("");
    const [editing, setEditing] = useState(false);
    const [initialAutoFocus, setInitialAutoFocus] = useState(false);
    const [keyboardOverlap, setKeyboardOverlap] = useState(0);
    const [androidKeyboardVisible, setAndroidKeyboardVisible] = useState(false);
    const [editorHeightFloor, setEditorHeightFloor] = useState(EDITOR_LINE_HEIGHT);
    const [caretPosition, setCaretPosition] = useState(0);
    const keyboardIsVisible = Platform.OS === "ios"
        ? keyboardOverlap > 0
        : androidKeyboardVisible;
    const editorBottomSpace = draftText.trim().length > 0
        ? Math.round(Dimensions.get("screen").height * EDITOR_BOTTOM_PADDING_RATIO)
        : 0;

    useEffect(() => {
        let active = true;

        void getStoredAppMemo()
            .then((text) => {
                if (!active) return;

                memoLoadedRef.current = true;
                latestDraftRef.current = text;
                latestSelectionRef.current = {start: text.length, end: text.length};
                selectionFocusRef.current = text.length;
                delayInitialFocusRef.current = !text.trim();
                setSavedText(text);
                setDraftText(text);
                setCaretPosition(text.length);
                setEditing(!text.trim());
            })
            .catch((error) => {
                console.error("讀取備忘錄失敗:", error);
                if (active) Alert.alert("讀取失敗", "無法讀取本機備忘錄。");
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (loading || !editing || !delayInitialFocusRef.current) return;

        const focusTimeout = setTimeout(() => {
            if (!delayInitialFocusRef.current) return;

            delayInitialFocusRef.current = false;
            setInitialAutoFocus(true);
        }, INITIAL_FOCUS_DELAY_MS);

        return () => clearTimeout(focusTimeout);
    }, [editing, loading]);

    const updateKeyboardOverlap = useCallback((keyboardTop: number) => {
        keyboardTopRef.current = keyboardTop;
        editorViewportRef.current?.measureInWindow((_x, pageY, _width, height) => {
            const viewportBottom = pageY + height;
            const coveredHeight = viewportBottom - keyboardTop;
            setKeyboardOverlap(coveredHeight > 0
                ? Math.ceil(coveredHeight)
                : 0);
        });
    }, []);

    const setAndroidKeyboardVisibility = useCallback((
        visible: boolean,
        keyboardTop?: number,
    ) => {
        androidKeyboardVisibleRef.current = visible;
        keyboardTopRef.current = visible
            ? keyboardTop
                ?? editorViewportPageYRef.current + editorViewportHeightRef.current
            : null;
        setAndroidKeyboardVisible((currentValue) => currentValue === visible
            ? currentValue
            : visible);
    }, []);

    const syncAndroidKeyboardFromViewport = useCallback((viewportHeight: number) => {
        if (Platform.OS !== "android" || viewportHeight <= 0) return;

        const expandedHeight = androidExpandedViewportHeightRef.current;
        const keyboardMetrics = Keyboard.metrics();
        const inputIsFocused = inputRef.current?.isFocused() ?? false;
        const viewportWasResized = expandedHeight > 0
            && viewportHeight < expandedHeight - ANDROID_KEYBOARD_RESIZE_THRESHOLD;
        const keyboardAppearsVisible = Keyboard.isVisible()
            || (
                inputIsFocused
                && (
                    viewportWasResized
                    || androidKeyboardVisibleRef.current
                        && viewportHeight < expandedHeight
                )
            );

        if (keyboardAppearsVisible) {
            setAndroidKeyboardVisibility(
                true,
                keyboardMetrics?.screenY
                    ?? editorViewportPageYRef.current + viewportHeight,
            );
            return;
        }

        androidExpandedViewportHeightRef.current = Math.max(expandedHeight, viewportHeight);
        setAndroidKeyboardVisibility(false);
    }, [setAndroidKeyboardVisibility]);

    const scrollEditorTo = useCallback((offset: number, animated = false) => {
        const nextOffset = Math.max(0, offset);
        documentScrollOffsetRef.current = nextOffset;
        documentScrollRef.current?.scrollTo({y: nextOffset, animated});
    }, []);

    const stopSelectionDragAutoScroll = useCallback(() => {
        selectionDragScrollVelocityRef.current = 0;
        if (selectionDragScrollFrameRef.current !== null) {
            cancelAnimationFrame(selectionDragScrollFrameRef.current);
            selectionDragScrollFrameRef.current = null;
        }
    }, []);

    const startSelectionDragAutoScroll = useCallback((velocity: number) => {
        if (caretScrollFrameRef.current !== null) {
            cancelAnimationFrame(caretScrollFrameRef.current);
            caretScrollFrameRef.current = null;
        }
        selectionDragScrollVelocityRef.current = velocity;
        if (selectionDragScrollFrameRef.current !== null) return;

        const scrollFrame = () => {
            const currentVelocity = selectionDragScrollVelocityRef.current;
            if (currentVelocity === 0) {
                selectionDragScrollFrameRef.current = null;
                return;
            }

            const viewportHeight = editorViewportHeightRef.current;
            const maxOffset = Math.max(
                0,
                editorNaturalHeightRef.current - viewportHeight,
            );
            const currentOffset = documentScrollOffsetRef.current;
            const nextOffset = Math.min(
                maxOffset,
                Math.max(0, currentOffset + currentVelocity),
            );

            if (Math.abs(nextOffset - currentOffset) < 0.5) {
                selectionDragScrollFrameRef.current = null;
                return;
            }

            scrollEditorTo(nextOffset);
            selectionDragScrollFrameRef.current = requestAnimationFrame(scrollFrame);
        };

        selectionDragScrollFrameRef.current = requestAnimationFrame(scrollFrame);
    }, [scrollEditorTo]);

    const updateSelectionDragAutoScroll = useCallback((touchPageY: number) => {
        const selection = latestSelectionRef.current;
        if (
            !editing
            || keyboardTopRef.current === null
            || selection.start === selection.end
        ) {
            stopSelectionDragAutoScroll();
            return;
        }

        const viewportHeight = editorViewportHeightRef.current;
        if (viewportHeight <= 0) return;

        const viewportTop = editorViewportPageYRef.current;
        const safeTop = viewportTop + CARET_VIEWPORT_TOP_GAP;
        const safeBottom = viewportTop + viewportHeight - CARET_KEYBOARD_GAP;
        let overflow = 0;
        let direction = 0;

        if (touchPageY < safeTop) {
            overflow = safeTop - touchPageY;
            direction = -1;
        } else if (touchPageY > safeBottom) {
            overflow = touchPageY - safeBottom;
            direction = 1;
        } else {
            stopSelectionDragAutoScroll();
            return;
        }

        const magnitude = Math.min(
            SELECTION_DRAG_MAX_SCROLL_PER_FRAME,
            SELECTION_DRAG_MIN_SCROLL_PER_FRAME
                + overflow * SELECTION_DRAG_SCROLL_ACCELERATION,
        );
        startSelectionDragAutoScroll(direction * magnitude);
    }, [editing, startSelectionDragAutoScroll, stopSelectionDragAutoScroll]);

    const syncEditorHeight = useCallback((
        bottomSpace: number,
        preserveViewport: boolean,
    ) => {
        const viewportHeight = editorViewportHeightRef.current;
        const naturalHeight = Math.max(
            viewportHeight,
            editorTextHeightRef.current,
        ) + bottomSpace;
        editorNaturalHeightRef.current = naturalHeight;

        const viewportFloor = preserveViewport && keyboardTopRef.current !== null
            ? documentScrollOffsetRef.current + editorViewportHeightRef.current
            : 0;
        if (viewportFloor === 0) {
            pendingHeightReleaseOffsetRef.current = null;
        }
        setEditorHeightFloor(Math.max(naturalHeight, viewportFloor));
    }, []);

    const releaseHeldEditorHeight = useCallback((offset: number) => {
        const viewportFloor = keyboardTopRef.current !== null
            ? offset + editorViewportHeightRef.current
            : 0;
        setEditorHeightFloor(
            Math.max(
                editorNaturalHeightRef.current,
                viewportFloor,
            ),
        );
    }, []);

    const keepCaretVisible = useCallback((caretBottom: number) => {
        caretBottomRef.current = caretBottom;
        if (keyboardTopRef.current === null) return;

        if (caretScrollFrameRef.current !== null) {
            cancelAnimationFrame(caretScrollFrameRef.current);
        }
        caretScrollFrameRef.current = requestAnimationFrame(() => {
            caretScrollFrameRef.current = null;
            if (keyboardTopRef.current === null) return;

            const viewportHeight = editorViewportHeightRef.current;
            if (viewportHeight <= 0) return;

            const currentOffset = documentScrollOffsetRef.current;
            const caretTop = Math.max(0, caretBottom - EDITOR_LINE_HEIGHT);
            const visibleTop = currentOffset + CARET_VIEWPORT_TOP_GAP;
            const visibleBottom = currentOffset
                + viewportHeight
                - CARET_KEYBOARD_GAP;

            let targetOffset = currentOffset;
            if (caretTop < visibleTop) {
                targetOffset = Math.max(
                    0,
                    caretTop - CARET_VIEWPORT_TOP_GAP,
                );
            } else if (caretBottom > visibleBottom) {
                targetOffset = Math.max(
                    0,
                    caretBottom - viewportHeight + CARET_KEYBOARD_GAP,
                );
            }

            if (Math.abs(targetOffset - currentOffset) < 1) return;

            pendingHeightReleaseOffsetRef.current = targetOffset;
            scrollEditorTo(targetOffset, true);
        });
    }, [scrollEditorTo]);

    useEffect(() => {
        if (Platform.OS !== "ios") return;

        const frameSubscription = Keyboard.addListener(
            "keyboardWillChangeFrame",
            (event: KeyboardEvent) => {
                Keyboard.scheduleLayoutAnimation(event);
                updateKeyboardOverlap(event.endCoordinates.screenY);
            },
        );
        const hideSubscription = Keyboard.addListener("keyboardWillHide", (event) => {
            Keyboard.scheduleLayoutAnimation(event);
            keyboardTopRef.current = null;
            setKeyboardOverlap(0);
        });
        return () => {
            frameSubscription.remove();
            hideSubscription.remove();
        };
    }, [updateKeyboardOverlap]);

    useEffect(() => {
        if (Platform.OS !== "android") return;

        const showSubscription = Keyboard.addListener(
            "keyboardDidShow",
            (event: KeyboardEvent) => {
                setAndroidKeyboardVisibility(true, event.endCoordinates.screenY);
                updateKeyboardOverlap(event.endCoordinates.screenY);
            },
        );
        const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
            setAndroidKeyboardVisibility(false);
            setKeyboardOverlap(0);
        });
        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, [setAndroidKeyboardVisibility, updateKeyboardOverlap]);

    useEffect(() => {
        if (!editing || !keyboardIsVisible) {
            stopSelectionDragAutoScroll();
            return;
        }

        keepCaretVisible(caretBottomRef.current);
    }, [editing, keepCaretVisible, keyboardIsVisible, stopSelectionDragAutoScroll]);

    useEffect(() => {
        syncEditorHeight(editorBottomSpace, editing);
    }, [editing, editorBottomSpace, syncEditorHeight]);

    useEffect(() => () => {
        if (caretScrollFrameRef.current !== null) {
            cancelAnimationFrame(caretScrollFrameRef.current);
        }
        stopSelectionDragAutoScroll();
    }, [stopSelectionDragAutoScroll]);

    const enqueueSave = useCallback((text: string): Promise<void> => {
        const operation = saveQueueRef.current
            .catch(() => undefined)
            .then(() => saveAppMemo(text));

        saveQueueRef.current = operation.catch(() => undefined);
        return operation;
    }, []);

    useEffect(() => {
        if (loading || draftText === savedText) return;

        const textToSave = draftText;
        const timeout = setTimeout(() => {
            void enqueueSave(textToSave)
                .then(() => {
                    if (latestDraftRef.current === textToSave) {
                        setSavedText(textToSave.trim() ? textToSave : "");
                    }
                })
                .catch((error) => console.error("背景儲存備忘錄失敗:", error));
        }, 400);

        return () => clearTimeout(timeout);
    }, [draftText, enqueueSave, loading, savedText]);

    useEffect(() => () => {
        if (!memoLoadedRef.current) return;

        void enqueueSave(latestDraftRef.current)
            .catch((error) => console.error("離開時儲存備忘錄失敗:", error));
    }, [enqueueSave]);

    const updateDraftText = useCallback((text: string) => {
        const previousLength = latestDraftRef.current.length;
        const wasTypingAtEnd = latestSelectionRef.current.start === previousLength
            && latestSelectionRef.current.end === previousLength;

        latestDraftRef.current = text;
        if (wasTypingAtEnd) {
            selectionFocusRef.current = text.length;
            setCaretPosition(text.length);
        }
        setDraftText(text);
    }, []);

    const save = useCallback(async (): Promise<void> => {
        if (saving) return;

        setSaving(true);
        try {
            const textToSave = latestDraftRef.current;
            await enqueueSave(textToSave);
            const nextText = textToSave.trim() ? textToSave : "";
            latestDraftRef.current = nextText;
            setSavedText(nextText);
            setDraftText(nextText);
            setEditing(false);
            setInitialAutoFocus(false);
            inputRef.current?.blur();
            Keyboard.dismiss();
        } catch (error) {
            console.error("儲存備忘錄失敗:", error);
            Alert.alert("儲存失敗", "無法儲存本機備忘錄，請稍後再試。");
        } finally {
            setSaving(false);
        }
    }, [enqueueSave, saving]);

    return (
        <View style={styles.container}>
            <Stack.Screen
                options={{
                    title: "備忘錄",
                    headerBackTitle: "設定",
                    headerRight: () => editing ? (
                        <TouchableOpacity
                            disabled={loading || saving}
                            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
                            onPress={() => { void save(); }}
                        >
                            <Text style={[styles.headerAction, saving && styles.headerActionDisabled]}>
                                {saving ? "" : "完成"}
                            </Text>
                        </TouchableOpacity>
                    ) : undefined,
                }}
            />

            {loading ? (
                <View style={styles.loadingState}>
                    <ActivityIndicator color="#B7791F" />
                </View>
            ) : (
                <View
                    ref={editorViewportRef}
                    collapsable={false}
                    style={[
                        styles.editorViewport,
                        editing
                        && keyboardOverlap > 0
                        && {paddingBottom: keyboardOverlap},
                    ]}
                    onLayout={() => {
                        editorViewportRef.current?.measureInWindow((_x, pageY) => {
                            editorViewportPageYRef.current = pageY;
                        });
                        if (Platform.OS === "ios") {
                            const keyboardTop = keyboardTopRef.current
                                ?? Keyboard.metrics()?.screenY;
                            if (keyboardTop !== undefined) {
                                updateKeyboardOverlap(keyboardTop);
                            }
                        } else if (Platform.OS === "android" && androidKeyboardVisibleRef.current) {
                            const keyboardTop = Keyboard.metrics()?.screenY
                                ?? keyboardTopRef.current;
                            if (keyboardTop !== null && keyboardTop !== undefined) {
                                updateKeyboardOverlap(keyboardTop);
                            }
                        }
                    }}
                >
                    <ScrollView
                        ref={documentScrollRef}
                        style={styles.editorScroller}
                        contentContainerStyle={styles.editorContent}
                        automaticallyAdjustKeyboardInsets={false}
                        keyboardDismissMode="interactive"
                        keyboardShouldPersistTaps="handled"
                        onLayout={(event) => {
                            const viewportHeight = event.nativeEvent.layout.height;
                            editorViewportHeightRef.current = viewportHeight;
                            syncAndroidKeyboardFromViewport(viewportHeight);
                            syncEditorHeight(editorBottomSpace, editing);
                            if (editing) {
                                keepCaretVisible(caretBottomRef.current);
                            }
                        }}
                        onScroll={(event) => {
                            const nextOffset = Math.max(
                                0,
                                event.nativeEvent.contentOffset.y,
                            );
                            documentScrollOffsetRef.current = nextOffset;

                            const pendingOffset = pendingHeightReleaseOffsetRef.current;
                            if (
                                pendingOffset !== null
                                && Math.abs(nextOffset - pendingOffset) < 1
                            ) {
                                pendingHeightReleaseOffsetRef.current = null;
                                releaseHeldEditorHeight(nextOffset);
                            }
                        }}
                        onMomentumScrollEnd={(event) => {
                            const offset = Math.max(
                                0,
                                event.nativeEvent.contentOffset.y,
                            );
                            documentScrollOffsetRef.current = offset;
                            pendingHeightReleaseOffsetRef.current = null;
                            releaseHeldEditorHeight(offset);
                        }}
                        scrollEventThrottle={16}
                    >
                        <View
                            style={[
                                styles.editorBody,
                                {minHeight: editorHeightFloor},
                            ]}
                        >
                            <Text
                                accessible={false}
                                pointerEvents="none"
                                style={styles.editorMeasure}
                                onLayout={(event) => {
                                    const nextTextHeight = Math.max(
                                        EDITOR_LINE_HEIGHT,
                                        Math.ceil(event.nativeEvent.layout.height),
                                    );
                                    editorTextHeightRef.current = nextTextHeight;
                                    syncEditorHeight(editorBottomSpace, editing);
                                }}
                            >
                                {`${draftText}\u200B`}
                            </Text>
                            {editorBottomSpace > 0 && (
                                <View
                                    pointerEvents="none"
                                    style={{height: editorBottomSpace}}
                                />
                            )}
                            {editing && (
                                <Text
                                    accessible={false}
                                    pointerEvents="none"
                                    style={[styles.editorMeasure, styles.caretMeasure]}
                                    onLayout={(event) => {
                                        keepCaretVisible(
                                            Math.max(
                                                EDITOR_LINE_HEIGHT,
                                                Math.ceil(event.nativeEvent.layout.height)
                                                - EDITOR_HEIGHT_SAFETY,
                                            ),
                                        );
                                    }}
                                >
                                    {`${draftText.slice(0, caretPosition)}\u200B`}
                                </Text>
                            )}
                            <TextInput
                                key={initialAutoFocus
                                    ? "initial-auto-focus"
                                    : "memo-editor"}
                                ref={inputRef}
                                autoFocus={initialAutoFocus}
                                multiline
                                scrollEnabled={false}
                                rejectResponderTermination={editing}
                                showSoftInputOnFocus={Platform.OS === "android" || editing}
                                caretHidden={!editing}
                                contextMenuHidden={!editing}
                                textAlignVertical="top"
                                value={draftText}
                                onChangeText={updateDraftText}
                                onPress={() => {
                                    if (!editing) setEditing(true);
                                }}
                                onFocus={() => {
                                    delayInitialFocusRef.current = false;
                                    if (!editing) setEditing(true);
                                }}
                                onTouchStart={stopSelectionDragAutoScroll}
                                onTouchMove={(event) => {
                                    updateSelectionDragAutoScroll(event.nativeEvent.pageY);
                                }}
                                onTouchEnd={stopSelectionDragAutoScroll}
                                onTouchCancel={stopSelectionDragAutoScroll}
                                onSelectionChange={(event) => {
                                    const nextSelection = event.nativeEvent.selection;
                                    const previousSelection = latestSelectionRef.current;
                                    const previousFocus = selectionFocusRef.current;
                                    let nextFocus = nextSelection.end;

                                    if (nextSelection.start !== nextSelection.end) {
                                        if (
                                            previousFocus === previousSelection.start
                                            && nextSelection.end === previousSelection.end
                                        ) {
                                            nextFocus = nextSelection.start;
                                        } else if (
                                            previousFocus === previousSelection.start
                                            && nextSelection.start === previousSelection.end
                                        ) {
                                            nextFocus = nextSelection.end;
                                        } else if (
                                            previousFocus === previousSelection.end
                                            && nextSelection.start === previousSelection.start
                                        ) {
                                            nextFocus = nextSelection.end;
                                        } else if (
                                            previousFocus === previousSelection.end
                                            && nextSelection.end === previousSelection.start
                                        ) {
                                            nextFocus = nextSelection.start;
                                        } else if (
                                            nextSelection.end === previousSelection.end
                                        ) {
                                            nextFocus = nextSelection.start;
                                        }
                                    }

                                    latestSelectionRef.current = nextSelection;
                                    selectionFocusRef.current = nextFocus;
                                    setCaretPosition(nextFocus);
                                }}
                                placeholder={MEMO_PLACEHOLDER}
                                placeholderTextColor="#98A2B3"
                                selectionColor="#D69E2E"
                                style={styles.editor}
                            />
                        </View>
                    </ScrollView>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#FFFFFF",
    },
    loadingState: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerAction: {
        color: "#B7791F",
        fontSize: 16,
        fontWeight: "600",
    },
    headerActionDisabled: {
        opacity: 0.55,
    },
    editorViewport: {
        flex: 1,
    },
    editorScroller: {
        flex: 1,
    },
    editorContent: {
        flexGrow: 1,
    },
    editorBody: {
        position: "relative",
        width: "100%",
    },
    editorMeasure: {
        width: "100%",
        minHeight: EDITOR_LINE_HEIGHT,
        paddingTop: CONTENT_TOP_PADDING - 3,
        paddingHorizontal: 20,
        paddingBottom: EDITOR_HEIGHT_SAFETY,
        color: "transparent",
        fontSize: 16,
        lineHeight: EDITOR_LINE_HEIGHT,
        includeFontPadding: false,
    },
    caretMeasure: {
        position: "absolute",
        top: 0,
        left: 0,
    },
    editor: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        paddingTop: CONTENT_TOP_PADDING - 3,
        paddingHorizontal: 20,
        paddingBottom: 0,
        color: "#1D2939",
        fontSize: 16,
        lineHeight: EDITOR_LINE_HEIGHT,
        includeFontPadding: false,
        borderWidth: 0,
    },
});
