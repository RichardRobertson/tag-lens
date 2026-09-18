// import "baukasten-ui/dist/baukasten-base.css";
// import "baukasten-ui/dist/baukasten-vscode.css";
import "./commentTokens.css";

import "@vscode-elements/elements/dist/vscode-badge";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-icon";
import "@vscode-elements/elements/dist/vscode-form-group";
import "@vscode-elements/elements/dist/vscode-form-helper";
import "@vscode-elements/elements/dist/vscode-scrollable";
import "@vscode-elements/elements/dist/vscode-split-layout";
import "@vscode-elements/elements/dist/vscode-textfield";
import type { VscodeTextfield } from "@vscode-elements/elements/dist/vscode-textfield";
import "@vscode-elements/elements/dist/vscode-tree";
import type { VscTreeSelectEvent } from "@vscode-elements/elements/dist/vscode-tree/vscode-tree";
import "@vscode-elements/elements/dist/vscode-tree-item";
import type { VscodeTreeItem } from "@vscode-elements/elements/dist/vscode-tree-item";

import { Fragment, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary, type FallbackProps, getErrorMessage } from "react-error-boundary";
import type { WebViewConfig, WebViewMessage } from "../webviewMessage";

const vscode = acquireVsCodeApi<WebViewConfig>();

// interface TokenSuggestionProps {
//     value?: string;
// }

// function TokenSuggestion({ value }: TokenSuggestionProps): React.JSX.Element {
//     if (value === undefined) {
//         return <span style={{ color: "var(--bk-color-foreground-disabled)" }}>(unset)</span>;
//     } else {
//         return <code>{value}</code>;
//     }
// }

// interface SuggestionProps {
//     source: string;
//     tokens: CommentTokens;
//     checked?: boolean;
//     icon: CodiconName;
// }

// function Suggestion({ source, tokens, checked, icon }: SuggestionProps): React.JSX.Element {
//     return (
//         <tr>
//             <td>
//                 <Radio value={source} checked={checked} />
//             </td>
//             <td>
//                 <Icon name={icon} />
//                 {source}
//             </td>
//             <td>
//                 <TokenSuggestion value={tokens.lineCommentStart} />
//             </td>
//             <td>
//                 <TokenSuggestion value={tokens.blockCommentStart} />
//             </td>
//             <td>
//                 <TokenSuggestion value={tokens.blockCommentEnd} />
//             </td>
//         </tr>
//     );
// }

// interface LanguageProps {
//     language: string;
//     current: CommentTokens;
//     discovered: Record<string, CommentTokens>;
// }

// function Language({ language, current, discovered }: LanguageProps): React.JSX.Element {
//     let checked = false;
//     function getFirstChecked(): boolean {
//         if (checked) {
//             return false;
//         }
//         checked = true;
//         return true;
//     }
//     return (
//         <tbody>
//             <tr>
//                 <th colSpan={5}>{language}</th>
//             </tr>
//             <RadioGroup name={language}>
//                 {current !== undefined && (
//                     <Suggestion
//                         key={"current"}
//                         source={"current"}
//                         checked={getFirstChecked()}
//                         icon={"settings"}
//                         tokens={current}
//                     />
//                 )}
//                 {Object.entries(discovered ?? {}).map(([source, tokens]) => (
//                     <Suggestion
//                         key={source}
//                         source={source}
//                         icon={"sparkle"}
//                         tokens={tokens}
//                         checked={getFirstChecked()}
//                     />
//                 ))}
//             </RadioGroup>
//         </tbody>
//     );
// }

enum TokenWarnings {
    None = 0,
    lineStartMatchesBlockStart = 1,
    lineStartMatchesBlockEnd = 2,
    blockStartEmpty = 4,
    blockEndEmpty = 8,
}

function App(): React.JSX.Element {
    const [config, setConfig] = useState(vscode.getState());
    useEffect(() => {
        vscode.setState(config);
    }, [config]);
    useEffect(() => {
        const listener = (event: MessageEvent<WebViewMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case "setConfig":
                    setConfig(message.config);
                    break;
                default:
                    throw new Error(`${message.type} should not be called from the extension side`);
            }
        };
        window.addEventListener("message", listener);
        vscode.postMessage({ type: "ready" });
        return () => {
            window.removeEventListener("message", listener);
        };
    }, []);
    const [searchValue, setSearchValue] = useState("");
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                setSearchValue("");
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);
    const itemRefs = useRef(new Map<string, HTMLDivElement>());
    function scrollToItem(key: string): void {
        const map = itemRefs.current;
        const node = map.get(key);
        if (node !== undefined) {
            node.classList.remove("highlight");
            node.scrollIntoView({
                behavior: "instant",
                block: "nearest",
            });
            node.classList.add("highlight");
        }
    }
    if (config === undefined) {
        return (
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100vh",
                }}
            >
                <vscode-icon
                    name="loading"
                    spin
                    spinDuration={1}
                    size={100}
                    style={{ color: "var(--vscode-focusBorder)" }}
                />
            </div>
        );
    }
    const sortedKeys = Object.keys(config.languages).sort();
    const warningKeys = Object.fromEntries(
        sortedKeys.flatMap<[string, Map<string | undefined, TokenWarnings>]>((key) => {
            const warnings = new Map<string | undefined, TokenWarnings>();
            // TODO check current text entry, add to warnings[undefined]
            const todo = {};
            for (const [
                source,
                { lineCommentStart, blockCommentStart, blockCommentEnd },
            ] of Object.entries(config.languages[key].discovered)) {
                let currentWarnings = TokenWarnings.None;
                if (lineCommentStart !== "") {
                    if (lineCommentStart === blockCommentStart) {
                        currentWarnings |= TokenWarnings.lineStartMatchesBlockStart;
                    }
                    if (lineCommentStart === blockCommentEnd) {
                        currentWarnings |= TokenWarnings.lineStartMatchesBlockEnd;
                    }
                }
                if (blockCommentStart === "" && blockCommentEnd !== "") {
                    currentWarnings |= TokenWarnings.blockStartEmpty;
                } else if (blockCommentStart !== "" && blockCommentEnd === "") {
                    currentWarnings |= TokenWarnings.blockEndEmpty;
                }
                if (currentWarnings !== TokenWarnings.None) {
                    warnings.set(source, currentWarnings);
                }
            }
            if (warnings.size === 0) {
                return [];
            } else {
                return [[key, warnings]];
            }
        })
    );
    const filteredKeys =
        searchValue === "" ? sortedKeys : sortedKeys.filter((key) => key.includes(searchValue));
    return (
        <div className="tokens-editor">
            <div className="tokens-header">
                <vscode-textfield
                    placeholder="Search language IDs"
                    value={searchValue}
                    onInput={(e: React.InputEvent<VscodeTextfield>) =>
                        setSearchValue(e.currentTarget.value)
                    }
                    style={{ width: "100%" }}
                >
                    {searchValue !== "" && (
                        <vscode-badge slot="content-after">
                            Matches {filteredKeys.length} language ID
                            {filteredKeys.length !== 1 && "s"}
                        </vscode-badge>
                    )}
                    <vscode-icon
                        slot="content-after"
                        name="clear-all"
                        title="clear search"
                        actionIcon
                        onClick={() => setSearchValue("")}
                    />
                </vscode-textfield>
            </div>
            <div className="tokens-body">
                <vscode-split-layout
                    minStart="200px"
                    initialHandlePosition="200px"
                    style={{ width: "100%" }}
                >
                    <div slot="start">
                        <vscode-scrollable style={{ height: "100%" }}>
                            <vscode-tree
                                onvsc-tree-select={(e: VscTreeSelectEvent) => {
                                    // HACK: https://github.com/vscode-elements/elements/issues/649
                                    const selectedItems = e.detail as unknown as VscodeTreeItem[];
                                    const [first] = selectedItems;
                                    const dataKey = first?.dataset.languageId;
                                    if (dataKey !== undefined) {
                                        scrollToItem(dataKey);
                                    }
                                }}
                            >
                                {filteredKeys.map((key) => (
                                    <vscode-tree-item key={key} data-language-id={key}>
                                        {key}
                                        {warningKeys[key] !== undefined && (
                                            <vscode-badge
                                                variant="activity-bar-counter"
                                                slot="decoration"
                                                className="warning"
                                            >
                                                {warningKeys[key].size}
                                            </vscode-badge>
                                        )}
                                    </vscode-tree-item>
                                ))}
                            </vscode-tree>
                        </vscode-scrollable>
                    </div>
                    <div slot="end">
                        <vscode-scrollable style={{ height: "100%" }}>
                            {sortedKeys.map((key, index) => (
                                <Fragment key={key}>
                                    {index !== 0 && <vscode-divider />}
                                    <div
                                        ref={(node: HTMLDivElement) => {
                                            const map = itemRefs.current;
                                            map.set(key, node);
                                            return () => {
                                                map.delete(key);
                                            };
                                        }}
                                    >
                                        <div className="config-header">{key}</div>
                                        <vscode-form-group variant="settings-group">
                                            <vscode-label htmlFor={`${key}-lineStart`}>
                                                Line comment start:
                                            </vscode-label>
                                            <vscode-textfield
                                                id={`${key}-lineStart`}
                                                placeholder="(unset)"
                                            />
                                        </vscode-form-group>
                                        <vscode-form-group variant="settings-group">
                                            <vscode-label htmlFor={`${key}-blockStart`}>
                                                Block comment start:
                                            </vscode-label>
                                            <vscode-textfield
                                                id={`${key}-blockStart`}
                                                placeholder="(unset)"
                                            />
                                        </vscode-form-group>
                                        <vscode-form-group variant="settings-group">
                                            <vscode-label htmlFor={`${key}-blockEnd`}>
                                                Block comment end:
                                            </vscode-label>
                                            <vscode-textfield
                                                id={`${key}-blockEnd`}
                                                placeholder="(unset)"
                                            />
                                        </vscode-form-group>
                                    </div>
                                </Fragment>
                            ))}
                        </vscode-scrollable>
                    </div>
                </vscode-split-layout>
                {/* <SplitPane>
                    <SplitPane.Pane preferredSize={200}>
                        <div className="column">
                            {searchValue !== "" && (
                                <div>
                                    {sortedKeys.filter((key) => key.includes(searchValue)).length}{" "}
                                    languages
                                </div>
                            )}
                            <Menu>
                                {sortedKeys
                                    .filter((key) => key.includes(searchValue))
                                    .map((key) => (
                                        <MenuItem
                                            key={key}
                                            onClick={() => scrollToItem(key)}
                                            rightContent={
                                                warningKeys[key] !== undefined && (
                                                    <Badge variant="warning" size="xs">
                                                        {warningKeys[key].size}
                                                    </Badge>
                                                )
                                            }
                                        >
                                            {key}
                                        </MenuItem>
                                    ))}
                            </Menu>
                        </div>
                    </SplitPane.Pane>
                    <SplitPane.Pane>
                        <div className="column">
                            {sortedKeys.map((key) => (
                                <div
                                    key={key}
                                    ref={(node: HTMLDivElement) => {
                                        const map = itemRefs.current;
                                        map.set(key, node);
                                        return () => {
                                            map.delete(key);
                                        };
                                    }}
                                >
                                    {key}
                                </div>
                            ))}
                        </div>
                    </SplitPane.Pane>
                </SplitPane> */}
            </div>
        </div>
    );
    // return (
    //     <div style={{ padding: "var(--bk-spacing-6)" }}>
    //         <h1>Comment Tokens</h1>
    //         <table>
    //             <thead>
    //                 <tr>
    //                     <th></th>
    //                     <th>Source</th>
    //                     <th>Line Comment Start</th>
    //                     <th>Block Comment Start</th>
    //                     <th>Block Comment End</th>
    //                 </tr>
    //             </thead>
    //             {Object.entries(config.languages).map(([language, { current, discovered }]) => (
    //                 <Language
    //                     key={language}
    //                     language={language}
    //                     current={current}
    //                     discovered={discovered}
    //                 />
    //             ))}
    //         </table>
    //     </div>
    // );
    // return (
    //     <div style={{ padding: "var(--bk-spacing-6)" }}>
    //         <Alert variant="info" title="Welcome">
    //             Your extension is now using Baukasten!
    //         </Alert>

    //         <Input
    //             // label="Name"
    //             placeholder="Enter your name"
    //             style={{ marginTop: "var(--bk-spacing-4)" }}
    //         />

    //         <Button variant="primary" style={{ marginTop: "var(--bk-spacing-4)" }}>
    //             Submit
    //         </Button>
    //     </div>
    // );
}

function getStackTrace(error: unknown): string {
    return error instanceof Error && error.stack !== undefined ? error.stack : "<no stack trace>";
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
    throw new Error("unreachable: root element missing");
}

const root = createRoot(rootElement);
root.render(
    <ErrorBoundary
        fallbackRender={({ error }: FallbackProps): React.JSX.Element => (
            <>
                <h1 style={{ color: "var(--bk-color-danger)" }}>{getErrorMessage(error)}</h1>
                <div>{getStackTrace(error)}</div>
            </>
        )}
    >
        <App />
    </ErrorBoundary>
);
