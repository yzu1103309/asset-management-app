#!/bin/bash
set -e

# --- Step 0: check version number ---
while true; do
    echo "Confirm current version number"
    echo ExpoAppVersion: $(jq .expo.version app.json)
#    echo RuntimeVersion: $(jq .expo.runtimeVersion app.json)
    echo PackageVersion: $(jq .version package.json)

    echo
    read -p "Continue? [y/n] " user_confirm

    if [[ "$user_confirm" == "y" || "$user_confirm" == "Y" ]]; then
        echo
        break
    fi

    if [[ "$user_confirm" == "n" || "$user_confirm" == "N" ]]; then
        echo
        read -e -p "Enter correct version number: " correct_version

        if [[ -z "$correct_version" ]]; then
            echo "Version number cannot be empty."
            echo
            continue
        fi

        app_json_tmp=$(mktemp)
        package_json_tmp=$(mktemp)

        jq --arg version "$correct_version" '.expo.version = $version' app.json > "$app_json_tmp"
        jq --arg version "$correct_version" '.version = $version' package.json > "$package_json_tmp"

        mv "$app_json_tmp" app.json
        mv "$package_json_tmp" package.json

        echo "Updated app.json and package.json to version $correct_version."
        echo
        continue
    fi

    echo "Please answer y or n."
    echo
done

# --- Step 1: git add & commit in current repo ---
echo "Adding all changes..."
git add .

echo
git status
echo
read -p "Commit these changes? [y/n] " commit_choice

if [[ "$commit_choice" == "y" || "$commit_choice" == "Y" ]]; then
    read -e -p "Enter commit message: " commit_msg
    git commit -m "$commit_msg"
    git push
else
    echo "No commit made. Exiting."
    exit 0
fi

# --- Step 2: Ask if run EAS update ---
echo
read -p "Run 'eas update'? [y/n] " eas_choice

if [[ "$eas_choice" != "y" && "$eas_choice" != "Y" ]]; then
    echo "Skipped 'eas update'. Exiting."
    exit 0
fi

echo
echo "Running 'eas update'..."
EAS_OUTPUT=$(eas update --non-interactive --auto 2>&1)

echo "$EAS_OUTPUT"

# --- Step 3: Parse Runtime version and Update group ID ---
RUNTIME_VERSION=$(echo "$EAS_OUTPUT" | grep "Runtime version" | awk '{print $3}')
UPDATE_GROUP_ID=$(echo "$EAS_OUTPUT" | grep "Update group ID" | awk '{print $4}')

if [[ -z "$RUNTIME_VERSION" || -z "$UPDATE_GROUP_ID" ]]; then
    echo "Error: Cannot parse Runtime version or Update group ID from eas update output."
    exit 1
fi

echo
echo "Parsed Runtime version: $RUNTIME_VERSION"
echo "Parsed Update group ID: $UPDATE_GROUP_ID"
