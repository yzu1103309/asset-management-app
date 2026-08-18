import {View, Text, Alert} from "react-native";
import React from "react";

export default function InDev(
    {children}: {children?: React.ReactNode}
)
{
    return (
        <View style={{flex: 1, justifyContent: "center", alignItems: "center"}}>
            <Text style={{fontSize: 16, fontWeight: "bold", marginVertical: 20}}>🛠️ 此功能開發中，敬請期待！</Text>
            {children}
        </View>
    )
}

export const inDevHandler = async () => {
    Alert.alert('🛠️ 開發中', '此功能尚未完成，敬請期待！',
        [{
            text: 'OK!',
        }]
    )
    // handleDismiss()
}
