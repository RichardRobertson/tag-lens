import { pseudoLocalizeString } from "pseudo-localization";
import en from "../en";
import type { Translation } from "../i18n-types";

function pseudoLocalizeStringWithBraces(value: string): string {
    // Preserve typesafe-i18n plural shorthands and interpolation variables.
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

function pseudoLocalize<T>(value: T): T {
    if (typeof value === "string") {
        return pseudoLocalizeStringWithBraces(value) as T;
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
