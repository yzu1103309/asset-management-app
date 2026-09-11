import {useEffect} from "react";
import {Alert} from "react-native";
import {Stack} from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Providers from "@/HOCs/Providers";
import {
  compareVersionStrings,
  formatVersionTag,
  getGithubReleaseApiUrl,
  getGithubReleaseUrl,
  getLatestVersionEntry,
  parseVersionRecordJson,
  VERSION_RECORD_URL,
} from "@/constants/versionRecord";

const CURRENT_APP_VERSION = require("@/app.json").expo.version as string;

async function fetchRemoteVersionRecord() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(VERSION_RECORD_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    return parseVersionRecordJson(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function githubReleaseTagExists(version: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(getGithubReleaseApiUrl(version), {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
      },
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function VersionUpdateChecker() {
  useEffect(() => {
    let mounted = true;

    void (async () => {
      const record = await fetchRemoteVersionRecord();
      if (!mounted || !record) return;

      const latest = getLatestVersionEntry(record);
      if (!latest || compareVersionStrings(latest.version, CURRENT_APP_VERSION) <= 0) return;

      const releaseExists = await githubReleaseTagExists(latest.version);
      if (!mounted || !releaseExists) return;

      const versionTag = formatVersionTag(latest.version);
      Alert.alert("發現新版本", `前往下載 ${versionTag}？`, [
        {text: "稍後", style: "cancel"},
        {
          text: "前往下載",
          onPress: () => {
            void WebBrowser.openBrowserAsync(getGithubReleaseUrl(latest.version));
          },
        },
      ]);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}

export default function RootLayout() {
  return (
      <Providers>
        <>
          <VersionUpdateChecker />
          <Stack>
            <Stack.Screen name="(tabs)" options={{headerShown: false, title: "主頁"}}/>
            <Stack.Screen name="stacks/details" options={{title: "財產詳細資訊", headerShown: false}}/>
          </Stack>
        </>
      </Providers>
  );
}
