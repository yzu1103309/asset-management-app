import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import {ActivityIndicator, Platform, View, StyleSheet} from "react-native";
import {FullWindowOverlay} from "react-native-screens";

export interface SpinnerContextProps {
    showSpinner: (options?: { locked?: boolean }) => void;
    hideSpinner: (options?: { force?: boolean }) => void;
}

const SpinnerContext = createContext<SpinnerContextProps | undefined>(undefined);
const SPINNER_SHOW_DELAY_MS = 90;

const absoluteFill = {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

function SpinnerOverlay() {
    const content = (
        <View pointerEvents="auto" style={styles.overlay}>
            <View style={styles.spinnerContainer}>
                <ActivityIndicator size="large" color="#85c1e9" />
            </View>
        </View>
    );

    if (Platform.OS === "ios") {
        return (
            <FullWindowOverlay>
                {content}
            </FullWindowOverlay>
        );
    }

    return content;
}

export const SpinnerProvider = ({ children }: { children: ReactNode }) => {
    const [loading, setLoading] = useState(false);
    const lockedRef = useRef(false);
    const loadingRef = useRef(false);
    const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearShowTimer = () => {
        if (!showTimerRef.current) return;

        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
    };
    const setLoadingState = (nextLoading: boolean) => {
        if (loadingRef.current === nextLoading) return;

        loadingRef.current = nextLoading;
        setLoading(nextLoading);
    };

    const showSpinner = (options?: { locked?: boolean }) => {
        if (options?.locked) lockedRef.current = true;
        if (loadingRef.current) return;

        clearShowTimer();
        showTimerRef.current = setTimeout(() => {
            showTimerRef.current = null;
            setLoadingState(true);
        }, SPINNER_SHOW_DELAY_MS);
    };
    const hideSpinner = (options?: { force?: boolean }) => {
        if (lockedRef.current && !options?.force) return;
        if (options?.force) lockedRef.current = false;
        clearShowTimer();
        setLoadingState(false);
    };
    // console.log("Spinner: ", loading )

    useEffect(() => () => {
        if (!showTimerRef.current) return;

        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
    }, []);

    return (
        <SpinnerContext.Provider value={{ showSpinner, hideSpinner }}>
            <View style={styles.root}>
                {children}
                {loading && <SpinnerOverlay />}
            </View>
        </SpinnerContext.Provider>
    );
};

// Custom hook to use the spinner
export const useSpinner = () => {
    const context = useContext(SpinnerContext);
    if (!context) {
        throw new Error("useSpinner must be used within a SpinnerProvider");
    }
    return context;
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    overlay: {
        ...absoluteFill,
        backgroundColor: "rgba(255,255,255,0.6)",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 99999,
        elevation: 99999,
    },
    spinnerContainer: {
        padding: 20,
        borderRadius: 10,
        // backgroundColor: "white",
    },
});
