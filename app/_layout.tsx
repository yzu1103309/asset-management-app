import { Stack } from "expo-router";
import Providers from "@/HOCs/Providers";

export default function RootLayout() {
  return (
      <Providers>
        <Stack>
          <Stack.Screen name="(tabs)" options={{headerShown: false, title: "主頁"}}/>
          <Stack.Screen name="stacks/details" options={{title: "財產詳細資訊", headerShown: false}}/>
        </Stack>
      </Providers>
  );
}
