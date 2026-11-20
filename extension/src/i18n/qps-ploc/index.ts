import { pseudoLocalizeString } from "pseudo-localization";
import en from "../en-US";
import type { Translation } from "../i18n-types";

function pseudoLocalizeStringWithBraces(value: string): string {
    const protectedPattern = /(\{\{[^{}]*\}\}|\{[^{}]+\})/g;
    return value
        .split(protectedPattern)
        .map((part) => {
            if (
                (part.startsWith("{{") && part.endsWith("}}")) ||
                (part.startsWith("{") && part.endsWith("}"))
            ) {
                return part;
            }

            return pseudoLocalizeString(part);
        })
        .join("");
}

export function pseudoLocalize<T>(
    value: T,
    transform: (value: string) => string = pseudoLocalizeStringWithBraces
): T {
    if (typeof value === "string") {
        return transform(value) as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => pseudoLocalize(item)) as T;
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, pseudoLocalize(item)])
        ) as T;
    }
    return value;
}

const qpsPLoc = pseudoLocalize(en) as Translation;

export default qpsPLoc;
