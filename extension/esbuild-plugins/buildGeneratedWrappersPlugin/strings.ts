import { isIdentifierName } from "@babel/helper-validator-identifier";
import { camelCase } from "change-case";

/**
 * Lookup a placeholder from the given translations map
 * @param placeholder The key to use in `translations`
 * @param translations The map of translation keys to human readable strings
 * @returns A string found from `translations`, or the original `placeholder` value
 */
export function translate(
    placeholder: string,
    translations: Record<string, string> | undefined
): string;

/**
 * Lookup a placeholder from the given translations map
 * @param placeholder The key to use in `translations`, or `undefined`
 * @param translations The map of translation keys to human readable strings
 * @returns A string found from `translations`, or the original `placeholder` value, or `undefined` if `placeholder === undefined`
 */
export function translate(
    placeholder: undefined,
    translations: Record<string, string> | undefined
): undefined;

/**
 * Lookup a placeholder from the given translations map
 * @param placeholder The key to use in `translations`, or `undefined`
 * @param translations The map of translation keys to human readable strings
 * @returns A string found from `translations`, or the original `placeholder` value, or `undefined` if `placeholder === undefined`
 */
export function translate(
    placeholder: string | undefined,
    translations: Record<string, string> | undefined
): string | undefined;

export function translate(
    placeholder: string | undefined,
    translations: Record<string, string> | undefined
): string | undefined {
    if (
        placeholder !== undefined &&
        translations !== undefined &&
        placeholder.startsWith("%") &&
        placeholder.endsWith("%") &&
        Object.hasOwn(translations, placeholder.slice(1, -1))
    ) {
        return translations[placeholder.slice(1, -1)];
    } else {
        return placeholder;
    }
}

/**
 * Tries to make a string a valid identifier
 * @param ident The starting string
 * @returns `ident` if it is already a valid identifier; otherwise converted to camel case to remove kebab case
 * @throws if `ident.length === 0`
 * @throws if `ident` is still not a valid identifier after camel case conversion
 */
export function toIdentifier(ident: string): string {
    const original = ident;
    if (ident.length === 0) {
        throw new Error("zero length identifier");
    }
    if (isIdentifierName(ident)) {
        return ident;
    }
    ident = camelCase(ident);
    if (isIdentifierName(ident)) {
        return ident;
    }
    // TODO try more things?
    throw new Error(`could not convert "${original}" to identifier`);
}
