import { useEffect, useState } from "react";
import { htmlLangAttributeDetector } from "typesafe-i18n/detectors";

import TypesafeI18n from "../i18n/i18n-react";
import { detectLocale } from "../i18n/i18n-util";
import { loadLocaleAsync } from "../i18n/i18n-util.async";
import { Spinner } from "./Spinner";

type LoadedState = { state: "loading" } | { state: "loaded" } | { state: "error"; reason: unknown };

export interface I18nRootProps {
    children?: React.ReactNode;
}

export function I18nRoot({ children }: I18nRootProps): React.JSX.Element {
    const locale = detectLocale(htmlLangAttributeDetector);
    const [localesLoaded, setLocalesLoaded] = useState<LoadedState>({ state: "loading" });
    useEffect(() => {
        loadLocaleAsync(locale).then(
            () => setLocalesLoaded({ state: "loaded" }),
            (reason) => setLocalesLoaded({ state: "error", reason })
        );
    }, [locale]);
    if (localesLoaded.state === "error") {
        throw localesLoaded.reason;
    }
    return (
        <Spinner showSpinner={localesLoaded.state !== "loaded"}>
            <TypesafeI18n locale={locale}>{children}</TypesafeI18n>
        </Spinner>
    );
}
