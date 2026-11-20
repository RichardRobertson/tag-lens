import "./commentTokens.css";

import "@vscode-elements/elements/dist/vscode-badge";
import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-button-group";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-icon";
import "@vscode-elements/elements/dist/vscode-form-group";
import "@vscode-elements/elements/dist/vscode-form-helper";
import "@vscode-elements/elements/dist/vscode-progress-ring";
import "@vscode-elements/elements/dist/vscode-split-layout";
import "@vscode-elements/elements/dist/vscode-textfield";
import type { VscodeTextfield } from "@vscode-elements/elements/dist/vscode-textfield";
import "@vscode-elements/elements/dist/vscode-tree";
import type { VscTreeSelectEvent } from "@vscode-elements/elements/dist/vscode-tree/vscode-tree";
import "@vscode-elements/elements/dist/vscode-tree-item";
import type { VscodeTreeItem } from "@vscode-elements/elements/dist/vscode-tree-item";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { useI18nContext } from "../i18n/i18n-react";

import {
    type CommentTokens,
    type DiscoveredCommentTokens,
    enumContainsFlag,
    type FromWebView,
    isDefinedAndNonEmpty,
    type PartialCommentTokens,
    type PartialDiscoveredCommentTokens,
    TokenWarnings,
    ToWebView,
    validateCommentTokens,
} from "../webviewMessage";

import { ErrorBoundaryRoot } from "./ErrorBoundaryRoot";
import { I18nRoot } from "./I18nRoot";
import { Scrollable } from "./Scrollable";
import { Spinner } from "./Spinner";

interface WebViewState {
    state: "loading" | "ready";
    baselineConfig: Record<string, PartialCommentTokens>;
    discovered: Record<string, Record<string, DiscoveredCommentTokens>>;
    editing: Record<string, CommentTokens>;
    searchValue: string;
    leftScrollPos: number;
    rightScrollPos: number;
    undoStack: [key: string, tokens: CommentTokens][];
}

const vscode = acquireVsCodeApi<WebViewState>();

interface TokenSuggestionProps {
    value?: string;
}

function TokenSuggestion({ value }: TokenSuggestionProps): React.JSX.Element {
    const { LL } = useI18nContext();
    if (isDefinedAndNonEmpty(value)) {
        return (
            <code>
                {value
                    .replaceAll(" ", "\u2420")
                    .replaceAll("\t", "\u2409")
                    .replaceAll("\n", "\u240a")
                    .replaceAll("\r", "\u240d")}
            </code>
        );
    } else {
        return (
            <span style={{ color: "var(--vscode-disabledForeground)" }}>
                {LL.CommentTokens.LanguageEditor.UnsetPlaceholder()}
            </span>
        );
    }
}

function stringEffectivelyEqual(a: string | undefined, b: string | undefined): boolean {
    return (a ?? "") === (b ?? "");
}

interface WarningsListProps {
    warnings: TokenWarnings;
}

function WarningsList({ warnings }: WarningsListProps): React.JSX.Element | null {
    const { LL } = useI18nContext();
    if (warnings === TokenWarnings.None) {
        return null;
    }
    const warningStrings: [TokenWarnings, string][] = [];
    if (enumContainsFlag(warnings, TokenWarnings.LineStartMatchesBlockStart)) {
        warningStrings.push([
            TokenWarnings.LineStartMatchesBlockStart,
            LL.TokenWarnings.LineStartMatchesBlockStart(),
        ]);
    }
    if (enumContainsFlag(warnings, TokenWarnings.LineStartMatchesBlockEnd)) {
        warningStrings.push([
            TokenWarnings.LineStartMatchesBlockEnd,
            LL.TokenWarnings.LineStartMatchesBlockEnd(),
        ]);
    }
    if (enumContainsFlag(warnings, TokenWarnings.BlockStartEmpty)) {
        warningStrings.push([TokenWarnings.BlockStartEmpty, LL.TokenWarnings.BlockStartEmpty()]);
    }
    if (enumContainsFlag(warnings, TokenWarnings.BlockEndEmpty)) {
        warningStrings.push([TokenWarnings.BlockEndEmpty, LL.TokenWarnings.BlockEndEmpty()]);
    }
    if (enumContainsFlag(warnings, TokenWarnings.AllEmpty)) {
        warningStrings.push([TokenWarnings.AllEmpty, LL.TokenWarnings.AllEmpty()]);
    }
    return (
        <ul className="warning">
            {warningStrings.map(([key, text]) => (
                <li key={key}>{text}</li>
            ))}
        </ul>
    );
}

interface LanguageEditorProps {
    languageId: string;
    baseline?: PartialCommentTokens;
    editing: CommentTokens;
    discovered?: Record<string, DiscoveredCommentTokens>;
    onChange(value: CommentTokens): void;
    onDelete(): void;
}

function LanguageEditor({
    languageId,
    baseline,
    editing,
    discovered,
    onChange,
    onDelete,
}: LanguageEditorProps): React.JSX.Element {
    const { LL } = useI18nContext();
    const warnings = validateCommentTokens(editing);
    const warnLineStart: TokenWarnings =
        warnings &
        (TokenWarnings.LineStartMatchesBlockStart | TokenWarnings.LineStartMatchesBlockEnd);
    const warnBlockStart: TokenWarnings =
        warnings & (TokenWarnings.LineStartMatchesBlockStart | TokenWarnings.BlockStartEmpty);
    const warnBlockEnd: TokenWarnings =
        warnings & (TokenWarnings.LineStartMatchesBlockEnd | TokenWarnings.BlockEndEmpty);
    return (
        <>
            <div className="config-header spread">
                <span>{languageId}</span>
                <vscode-button icon="trash" onClick={onDelete}>
                    {LL.CommentTokens.LanguageEditor.Delete()}
                </vscode-button>
            </div>
            {discovered !== undefined &&
                Object.entries(discovered).map(([extensionId, tokens]) => {
                    return (
                        <vscode-form-group variant="settings-group" key={extensionId}>
                            <vscode-label htmlFor={`${extensionId}:${languageId}`}>
                                {tokens.displayName === undefined
                                    ? `<${extensionId}>`
                                    : `${tokens.displayName} <${extensionId}>`}
                            </vscode-label>
                            <vscode-form-helper>
                                <p>
                                    <span className="pair">
                                        {LL.CommentTokens.LanguageEditor.Discovered.LineStart()}{" "}
                                        <TokenSuggestion value={tokens.lineCommentStart} />
                                    </span>{" "}
                                    <span className="pair">
                                        {LL.CommentTokens.LanguageEditor.Discovered.BlockStart()}{" "}
                                        <TokenSuggestion value={tokens.blockCommentStart} />
                                    </span>{" "}
                                    <span className="pair">
                                        {LL.CommentTokens.LanguageEditor.Discovered.BlockEnd()}{" "}
                                        <TokenSuggestion value={tokens.blockCommentEnd} />
                                    </span>
                                </p>
                                <WarningsList warnings={validateCommentTokens(tokens)} />
                            </vscode-form-helper>
                            <vscode-button
                                id={`${extensionId}:${languageId}`}
                                onClick={() =>
                                    onChange({
                                        lineCommentStart: tokens.lineCommentStart ?? "",
                                        blockCommentStart: tokens.blockCommentStart ?? "",
                                        blockCommentEnd: tokens.blockCommentEnd ?? "",
                                    })
                                }
                            >
                                {LL.CommentTokens.LanguageEditor.Discovered.Use()}
                            </vscode-button>
                        </vscode-form-group>
                    );
                })}
            <vscode-form-group variant="settings-group">
                <vscode-label htmlFor={`${languageId}-lineStart`}>
                    {LL.CommentTokens.LanguageEditor.LineStart()}
                </vscode-label>
                {warnLineStart !== TokenWarnings.None && (
                    <vscode-form-helper>
                        <WarningsList warnings={warnLineStart} />
                    </vscode-form-helper>
                )}
                <vscode-textfield
                    id={`${languageId}-lineStart`}
                    placeholder={LL.CommentTokens.LanguageEditor.UnsetPlaceholder()}
                    value={editing?.lineCommentStart}
                    className="mono"
                    invalid={warnLineStart !== TokenWarnings.None}
                    onInput={(e: React.InputEvent<VscodeTextfield>) =>
                        onChange({
                            ...editing,
                            lineCommentStart: e.currentTarget.value,
                        })
                    }
                >
                    {baseline !== undefined &&
                        editing !== undefined &&
                        !stringEffectivelyEqual(
                            baseline.lineCommentStart,
                            editing.lineCommentStart
                        ) && (
                            <vscode-icon
                                slot="content-after"
                                name="discard"
                                actionIcon
                                title={LL.CommentTokens.LanguageEditor.RevertToken()}
                                onClick={() =>
                                    onChange({
                                        ...editing,
                                        lineCommentStart: baseline?.lineCommentStart ?? "",
                                    })
                                }
                            />
                        )}
                </vscode-textfield>
            </vscode-form-group>
            <vscode-form-group variant="settings-group">
                <vscode-label htmlFor={`${languageId}-blockStart`}>
                    {LL.CommentTokens.LanguageEditor.BlockStart()}
                </vscode-label>
                {warnBlockStart !== TokenWarnings.None && (
                    <vscode-form-helper>
                        <WarningsList warnings={warnBlockStart} />
                    </vscode-form-helper>
                )}
                <vscode-textfield
                    id={`${languageId}-blockStart`}
                    placeholder={LL.CommentTokens.LanguageEditor.UnsetPlaceholder()}
                    value={editing?.blockCommentStart}
                    className="mono"
                    invalid={warnBlockStart !== TokenWarnings.None}
                    required={editing.blockCommentEnd !== ""}
                    onInput={(e: React.InputEvent<VscodeTextfield>) =>
                        onChange({
                            ...editing,
                            blockCommentStart: e.currentTarget.value,
                        })
                    }
                >
                    {baseline !== undefined &&
                        !stringEffectivelyEqual(
                            baseline.blockCommentStart,
                            editing.blockCommentStart
                        ) && (
                            <vscode-icon
                                slot="content-after"
                                name="discard"
                                title={LL.CommentTokens.LanguageEditor.RevertToken()}
                                actionIcon
                                onClick={() =>
                                    onChange({
                                        ...editing,
                                        blockCommentStart: baseline?.blockCommentStart ?? "",
                                    })
                                }
                            />
                        )}
                </vscode-textfield>
            </vscode-form-group>
            <vscode-form-group variant="settings-group">
                <vscode-label htmlFor={`${languageId}-blockEnd`}>
                    {LL.CommentTokens.LanguageEditor.BlockEnd()}
                </vscode-label>
                {warnBlockEnd !== TokenWarnings.None && (
                    <vscode-form-helper>
                        <WarningsList warnings={warnBlockEnd} />
                    </vscode-form-helper>
                )}
                <vscode-textfield
                    id={`${languageId}-blockEnd`}
                    placeholder={LL.CommentTokens.LanguageEditor.UnsetPlaceholder()}
                    value={editing?.blockCommentEnd}
                    className="mono"
                    invalid={warnBlockEnd !== TokenWarnings.None}
                    required={editing.blockCommentStart !== ""}
                    onInput={(e: React.InputEvent<VscodeTextfield>) =>
                        onChange({
                            ...editing,
                            blockCommentEnd: e.currentTarget.value,
                        })
                    }
                >
                    {baseline !== undefined &&
                        editing !== undefined &&
                        !stringEffectivelyEqual(
                            baseline.blockCommentEnd,
                            editing.blockCommentEnd
                        ) && (
                            <vscode-icon
                                slot="content-after"
                                name="discard"
                                actionIcon
                                title={LL.CommentTokens.LanguageEditor.RevertToken()}
                                onClick={() =>
                                    onChange({
                                        ...editing,
                                        blockCommentEnd: baseline?.blockCommentEnd ?? "",
                                    })
                                }
                            />
                        )}
                </vscode-textfield>
            </vscode-form-group>
        </>
    );
}

function getWarningsCount(editing: CommentTokens): number {
    let count = 0;
    const warnings = validateCommentTokens(editing);
    if (enumContainsFlag(warnings, TokenWarnings.LineStartMatchesBlockStart)) {
        count++;
    }
    if (enumContainsFlag(warnings, TokenWarnings.LineStartMatchesBlockEnd)) {
        count++;
    }
    if (enumContainsFlag(warnings, TokenWarnings.BlockStartEmpty)) {
        count++;
    }
    if (enumContainsFlag(warnings, TokenWarnings.BlockEndEmpty)) {
        count++;
    }
    if (enumContainsFlag(warnings, TokenWarnings.AllEmpty)) {
        count++;
    }
    return count;
}

function normalizeConfig(
    baselineConfig: Record<string, PartialCommentTokens>,
    discovered: Record<string, Record<string, PartialDiscoveredCommentTokens>>
): {
    baselineConfig: Record<string, CommentTokens>;
    discovered: Record<string, Record<string, DiscoveredCommentTokens>>;
    editing: Record<string, CommentTokens>;
} {
    function normalizeTokens(tokens: PartialCommentTokens): CommentTokens;
    function normalizeTokens(tokens: PartialDiscoveredCommentTokens): DiscoveredCommentTokens;
    function normalizeTokens(
        tokens: PartialCommentTokens | PartialDiscoveredCommentTokens
    ): CommentTokens | DiscoveredCommentTokens {
        if ("displayName" in tokens) {
            return {
                lineCommentStart: tokens.lineCommentStart ?? "",
                blockCommentStart: tokens.blockCommentStart ?? "",
                blockCommentEnd: tokens.blockCommentEnd ?? "",
                displayName: tokens.displayName,
            };
        }
        return {
            lineCommentStart: tokens.lineCommentStart ?? "",
            blockCommentStart: tokens.blockCommentStart ?? "",
            blockCommentEnd: tokens.blockCommentEnd ?? "",
        };
    }
    const normalizedBaseline = Object.fromEntries(
        Object.entries(baselineConfig).map(([languageId, tokens]) => [
            languageId,
            normalizeTokens(tokens),
        ])
    );
    const normalizedDiscovered = Object.fromEntries(
        Object.entries(discovered).map(([languageId, sources]) => [
            languageId,
            Object.fromEntries(
                Object.entries(sources).map(([extensionId, tokens]) => [
                    extensionId,
                    normalizeTokens(tokens),
                ])
            ),
        ])
    );
    const editing = Object.fromEntries([
        ...Object.entries(normalizedDiscovered).map(([languageId]) => [
            languageId,
            { lineCommentStart: "", blockCommentStart: "", blockCommentEnd: "" },
        ]),
        ...Object.entries(normalizedBaseline).map(([languageId, tokens]) => [
            languageId,
            { ...tokens },
        ]),
    ]);
    return {
        baselineConfig: normalizedBaseline,
        discovered: normalizedDiscovered,
        editing,
    };
}

export function App(): React.JSX.Element {
    const { LL } = useI18nContext();
    const [appState, setAppState] = useState(() => {
        const state = vscode.getState() || {
            state: "loading",
            baselineConfig: {},
            discovered: {},
            editing: {},
            leftScrollPos: 0,
            rightScrollPos: 0,
            searchValue: "",
            undoStack: [],
        };
        return state;
    });
    useEffect(() => {
        vscode.setState(appState);
    }, [appState]);
    const scrollToItemRef = useRef<(key: string) => void>(() => {});
    useEffect(() => {
        const listener = (event: MessageEvent<ToWebView.Message>): void => {
            const message = ToWebView.Message.parse(event.data);
            switch (message.type) {
                case "setConfig":
                    setAppState({
                        ...normalizeConfig(message.baselineConfig, message.discovered),
                        state: "ready",
                        searchValue: "",
                        leftScrollPos: 0,
                        rightScrollPos: 0,
                        undoStack: [],
                    });
                    break;
                case "inputResponse": {
                    const input = message.input;
                    setAppState((oldState) => {
                        if (input in oldState.editing) {
                            return oldState;
                        } else {
                            return {
                                ...oldState,
                                editing: {
                                    ...oldState.editing,
                                    [input]: {
                                        lineCommentStart: "",
                                        blockCommentStart: "",
                                        blockCommentEnd: "",
                                    },
                                },
                            };
                        }
                    });
                    requestAnimationFrame(() => {
                        scrollToItemRef.current(input);
                    });
                    break;
                }
            }
        };
        window.addEventListener("message", listener);
        vscode.postMessage({ type: "ready" } satisfies FromWebView.Message);
        return () => {
            window.removeEventListener("message", listener);
        };
    }, []);
    const leftScrollableRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (appState.state === "loading" || appState.leftScrollPos === 0) {
            return;
        }
        const frame = requestAnimationFrame(() => {
            const scrollable = leftScrollableRef.current;
            if (scrollable !== null) {
                scrollable.scrollTop = appState.leftScrollPos;
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [appState]);
    const rightScrollableRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (appState.state === "loading" || appState.rightScrollPos === 0) {
            return;
        }
        const frame = requestAnimationFrame(() => {
            const scrollable = rightScrollableRef.current;
            if (scrollable !== null) {
                scrollable.scrollTop = appState.rightScrollPos;
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [appState]);
    const itemRefs = useRef(new Map<string, HTMLDivElement>());
    const pendingHighlightRef = useRef<HTMLDivElement>(null);
    function scrollToItem(key: string): void {
        const scrollable = rightScrollableRef.current;
        if (scrollable === null) {
            return;
        }
        const map = itemRefs.current;
        const node = map.get(key);
        if (node !== undefined) {
            node.classList.remove("highlight");
            const elementRect = node.getBoundingClientRect();
            const containerRect = scrollable.getBoundingClientRect();
            const fullyVisible =
                elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
            if (fullyVisible) {
                node.classList.add("highlight");
                return;
            }
            pendingHighlightRef.current = node;
            node.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
            });
        }
    }
    scrollToItemRef.current = scrollToItem;
    const sortedItems = Object.entries(appState.editing).sort(([a], [b]) => a.localeCompare(b));
    const filteredItems = isDefinedAndNonEmpty(appState.searchValue)
        ? sortedItems.filter(([key]) => key.includes(appState.searchValue))
        : sortedItems;
    return (
        <Spinner showSpinner={appState.state === "loading"}>
            <div className="tokens-editor">
                <div className="tokens-header">
                    <vscode-textfield
                        placeholder={LL.CommentTokens.App.SearchPlaceholder()}
                        value={appState.searchValue}
                        onInput={(e: React.InputEvent<VscodeTextfield>) => {
                            const target = e.currentTarget;
                            setAppState((oldState) => ({ ...oldState, searchValue: target.value }));
                        }}
                        style={{ width: "100%" }}
                    >
                        {appState.searchValue !== "" && (
                            <>
                                <vscode-badge slot="content-after">
                                    {LL.CommentTokens.App.SearchBadge({
                                        count: filteredItems.length,
                                    })}
                                </vscode-badge>
                                <vscode-icon
                                    slot="content-after"
                                    name="clear-all"
                                    title={LL.CommentTokens.App.ClearSearch()}
                                    actionIcon
                                    onClick={() => {
                                        setAppState((oldState) => ({
                                            ...oldState,
                                            searchValue: "",
                                        }));
                                    }}
                                />
                            </>
                        )}
                    </vscode-textfield>
                    <div className="spread">
                        <vscode-button-group>
                            <vscode-button
                                icon="add"
                                onClick={() => {
                                    vscode.postMessage({
                                        type: "inputRequest",
                                        title: LL.CommentTokens.App.AddTitle(),
                                        prompt: LL.CommentTokens.App.AddPrompt(),
                                    } satisfies FromWebView.Message);
                                }}
                            >
                                {LL.CommentTokens.App.AddLanguage()}
                            </vscode-button>
                            <vscode-button
                                icon="discard"
                                disabled={appState.undoStack.length === 0}
                                onClick={() => {
                                    setAppState((oldState) => {
                                        const newState = { ...oldState };
                                        const [undoItem, ...undoStack] = newState.undoStack;
                                        if (undoItem === undefined) {
                                            throw new Error(
                                                "unreachable: `undoItem` not defined in undo"
                                            );
                                        }
                                        const [languageId, tokens] = undoItem;
                                        requestAnimationFrame(() =>
                                            scrollToItemRef.current(languageId)
                                        );
                                        newState.editing = {
                                            ...newState.editing,
                                            [languageId]: { ...tokens },
                                        };
                                        newState.undoStack = undoStack;
                                        return newState;
                                    });
                                }}
                            >
                                {LL.CommentTokens.App.Undo()}
                            </vscode-button>
                        </vscode-button-group>
                        <vscode-button-group>
                            <vscode-button
                                icon="close"
                                onClick={() => {
                                    vscode.postMessage({
                                        type: "discard",
                                    } satisfies FromWebView.Message);
                                }}
                            >
                                {LL.CommentTokens.App.Discard()}
                            </vscode-button>
                            <vscode-button
                                icon="save"
                                onClick={() => {
                                    vscode.postMessage({
                                        type: "commit",
                                        editedConfig: appState.editing,
                                    } satisfies FromWebView.Message);
                                }}
                            >
                                {LL.CommentTokens.App.Commit()}
                            </vscode-button>
                        </vscode-button-group>
                    </div>
                </div>
                <div className="tokens-body">
                    <vscode-split-layout
                        minStart="200px"
                        initialHandlePosition="200px"
                        style={{ width: "100%" }}
                    >
                        <div slot="start">
                            <Scrollable
                                ref={leftScrollableRef}
                                style={{ height: "100%" }}
                                onScrollEnd={(e: React.UIEvent<HTMLDivElement, UIEvent>) => {
                                    const leftScrollPos = e.currentTarget.scrollTop;
                                    setAppState((oldState) => ({ ...oldState, leftScrollPos }));
                                }}
                            >
                                <vscode-tree
                                    onvsc-tree-select={(e: VscTreeSelectEvent) => {
                                        // HACK: https://github.com/vscode-elements/elements/issues/649
                                        const selectedItems =
                                            e.detail as unknown as VscodeTreeItem[];
                                        const [first] = selectedItems;
                                        const dataKey = first?.dataset.languageId;
                                        if (dataKey !== undefined) {
                                            scrollToItem(dataKey);
                                        }
                                    }}
                                >
                                    {filteredItems.map(([languageId, tokens]) => {
                                        const warningsCount = getWarningsCount(tokens);
                                        const isNew =
                                            appState.baselineConfig[languageId] === undefined;
                                        return (
                                            <vscode-tree-item
                                                key={languageId}
                                                data-language-id={languageId}
                                            >
                                                {languageId}
                                                {warningsCount !== 0 && (
                                                    <vscode-badge
                                                        variant="activity-bar-counter"
                                                        slot="decoration"
                                                        className="warning"
                                                    >
                                                        {warningsCount}
                                                    </vscode-badge>
                                                )}
                                                {isNew && (
                                                    <vscode-icon name="sparkle" slot="decoration" />
                                                )}
                                            </vscode-tree-item>
                                        );
                                    })}
                                </vscode-tree>
                            </Scrollable>
                        </div>
                        <div slot="end">
                            <Scrollable
                                ref={rightScrollableRef}
                                style={{ height: "100%" }}
                                onScrollEnd={(e: React.UIEvent<HTMLDivElement, UIEvent>) => {
                                    const rightScrollPos = e.currentTarget.scrollTop;
                                    setAppState((oldState) => ({ ...oldState, rightScrollPos }));
                                    const pendingHighlight = pendingHighlightRef.current;
                                    if (pendingHighlight !== null) {
                                        pendingHighlight.classList.add("highlight");
                                    }
                                }}
                            >
                                {sortedItems.map(([languageId, configItem], index) => (
                                    <Fragment key={languageId}>
                                        {index !== 0 && <vscode-divider />}
                                        <div
                                            ref={(node: HTMLDivElement) => {
                                                const map = itemRefs.current;
                                                map.set(languageId, node);
                                                return () => {
                                                    map.delete(languageId);
                                                };
                                            }}
                                        >
                                            <LanguageEditor
                                                languageId={languageId}
                                                editing={configItem}
                                                baseline={appState.baselineConfig[languageId]}
                                                discovered={appState.discovered[languageId]}
                                                onChange={(value: CommentTokens) => {
                                                    const newState = { ...appState };
                                                    const entry = newState.editing[languageId];
                                                    if (entry === undefined) {
                                                        throw new Error(
                                                            "unreachable: `entry` not defined within language editor"
                                                        );
                                                    }
                                                    entry.lineCommentStart = value.lineCommentStart;
                                                    entry.blockCommentStart =
                                                        value.blockCommentStart;
                                                    entry.blockCommentEnd = value.blockCommentEnd;
                                                    setAppState(newState);
                                                }}
                                                onDelete={() =>
                                                    setAppState((oldState) => {
                                                        const newState = { ...oldState };
                                                        const {
                                                            [languageId]: deleted,
                                                            ...editingMinusLanguage
                                                        } = newState.editing;
                                                        if (deleted === undefined) {
                                                            throw new Error(
                                                                "unreachable: `deleted` not defined within language editor"
                                                            );
                                                        }
                                                        newState.editing = editingMinusLanguage;
                                                        newState.undoStack = [
                                                            [languageId, deleted],
                                                            ...newState.undoStack,
                                                        ];
                                                        return newState;
                                                    })
                                                }
                                            />
                                        </div>
                                    </Fragment>
                                ))}
                            </Scrollable>
                        </div>
                    </vscode-split-layout>
                </div>
            </div>
        </Spinner>
    );
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
    throw new Error("unreachable: root element missing");
}

const root = createRoot(rootElement);
root.render(
    <ErrorBoundaryRoot>
        <I18nRoot>
            <App />
        </I18nRoot>
    </ErrorBoundaryRoot>
);
