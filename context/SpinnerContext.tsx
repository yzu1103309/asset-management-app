import React, { createContext, useContext, useRef, useState, ReactNode } from "react";
import {ActivityIndicator, View, StyleSheet} from "react-native";

export interface SpinnerContextProps {
    showSpinner: (options?: { locked?: boolean }) => void;
    hideSpinner: (options?: { force?: boolean }) => void;
}

const SpinnerContext = createContext<SpinnerContextProps | undefined>(undefined);

export const SpinnerProvider = ({ children }: { children: ReactNode }) => {
    const [loading, setLoading] = useState(false);
    const lockedRef = useRef(false);

    const showSpinner = (options?: { locked?: boolean }) => {
        if (options?.locked) lockedRef.current = true;
        setLoading(true);
    };
    const hideSpinner = (options?: { force?: boolean }) => {
        if (lockedRef.current && !options?.force) return;
        if (options?.force) lockedRef.current = false;
        setLoading(false);
    };
    // console.log("Spinner: ", loading )

    return (
        <SpinnerContext.Provider value={{ showSpinner, hideSpinner }}>
            {children}
            {loading && (
                <View pointerEvents="auto" style={styles.overlay}>
                    <View style={styles.spinnerContainer}>
                        <ActivityIndicator size="large" color="#85c1e9" />
                    </View>
                </View>
            )}
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
    overlay: {
        ...StyleSheet.absoluteFillObject, // 覆蓋整個螢幕
        backgroundColor: "rgba(255,255,255,0.6)",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 99999, // 確保永遠在最上層
    },
    spinnerContainer: {
        padding: 20,
        borderRadius: 10,
        // backgroundColor: "white",
    },
});
