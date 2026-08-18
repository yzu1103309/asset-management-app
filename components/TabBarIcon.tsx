import {Icon} from "react-native-magnus";
import {iconFontFamilyType} from "react-native-magnus/src/ui/icon/icon.type";

type paramType = {name: string, color: string, family: iconFontFamilyType}

export default function TabBarIcon({name, color, family}:paramType)
{
    return (
        <Icon name={name} fontSize="2xl" color={color} fontFamily={family} />
    )
}
