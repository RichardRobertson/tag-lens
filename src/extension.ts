import assert from "node:assert";
import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import Handlebars from "handlebars";
import * as vscode from "vscode";
import z from "zod";
import { getExtensionLanguageCommentTokens } from "./commentTokens";
import {
    contributeNamespace,
    initConfigFile,
    isValidOrPrintError,
    LayeredConfig,
    loadConfigUri,
    type ProviderRegistrationOptions,
} from "./configFile";
import { cancelUri, enqueueFile, fileScannerUpdateConfig, initFileScanner } from "./fileScanner";
import { SourcesTreeProvider } from "./sourcesTreeProvider";
import { FileNodeWrapper, TagsTreeProvider } from "./treeProvider";
import { trace } from "./util";
import type { WebViewMessage } from "./webviewMessage";

export const openTagLinkCommand = "tag-lens.openTagLink";
const disabledWorkspaceFolderState = "tag-lens.disabledWorkspaceFolderState";

const webViewDataSchema = z.object({
    type: z.literal("apply"),
    data: z.record(z.string(), z.string()),
});

export async function activate(context: vscode.ExtensionContext): Promise<{
    contributeNamespace(
        callerContext: vscode.ExtensionContext,
        options: ProviderRegistrationOptions
    ): Promise<vscode.Disposable>;
}> {
    Handlebars.registerHelper("and", (a, b) => a && b);
    Handlebars.registerHelper("not", (value) => !value);
    const commentTokensTemplate = Handlebars.compile(
        new TextDecoder("utf-8").decode(
            await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(context.extensionUri, "resources", "commentTokens.handlebars")
            )
        )
    );

    const outputChannel = vscode.window.createOutputChannel(vscode.l10n.t("Tag Lens"), {
        log: true,
    });

    function enqueueFileLocal(uri: vscode.Uri, priority: boolean): void {
        enqueueFile(uri, priority);
    }

    const diagnostics = vscode.languages.createDiagnosticCollection("tag-lens");

    const tagsTreeProvider = new TagsTreeProvider(diagnostics);

    const sourcesTreeProvider = new SourcesTreeProvider();

    initFileScanner(
        (uri) => tagsTreeProvider.hasNode(uri),
        (uri, document, matches) => tagsTreeProvider.setFileMatches(uri, document, matches)
    );

    const reloadProvidersEmitter = new vscode.EventEmitter<void>();

    initConfigFile(reloadProvidersEmitter);

    async function kickOffScan(): Promise<void> {
        const todo = {};
        // const visibleEditorUris = vscode.window.visibleTextEditors.map<[vscode.Uri, string]>(
        //     (editor) => [editor.document.uri, editor.document.uri.toString(true)]
        // );
        // const disabledWorkspaceFolders = context.workspaceState.get(
        //     disabledWorkspaceFolderState,
        //     {} as Record<string, boolean>
        // );
        // for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
        //     if (disabledWorkspaceFolders[workspaceFolder.uri.toString(true)]) {
        //         continue;
        //     }
        //     for (const uri of await vscode.workspace.findFiles(
        //         new vscode.RelativePattern(workspaceFolder, "**/*")
        //     )) {
        //         const uriString = uri.toString(true);
        //         enqueueFileLocal(
        //             uri,
        //             visibleEditorUris.some(([_, editorUriString]) => editorUriString === uriString)
        //         );
        //     }
        // }
        // if (configuration.search.getLoose()) {
        //     for (const [editorUri, _] of visibleEditorUris) {
        //         enqueueFileLocal(editorUri, true);
        //     }
        // }
    }

    const lastPickedWorkspaceFolderState = "tag-lens.lastPickedWorkspaceFolder";

    const layeredConfig = new LayeredConfig();

    async function reloadConfig(): Promise<void> {
        layeredConfig.clear();
        const globalConfigUri = vscode.Uri.joinPath(
            context.globalStorageUri,
            "tag-lens.config.jsonc"
        );
        const workspaceAndConfigUris = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
            baseUri: folder.uri,
            configUri: vscode.Uri.joinPath(folder.uri, ".vscode", "tag-lens.config.jsonc"),
        }));
        if (await uriExists(globalConfigUri)) {
            const configObject = await loadConfigUri(globalConfigUri);
            if (isValidOrPrintError(configObject, globalConfigUri, outputChannel, "global")) {
                layeredConfig.globalConfig = configObject.config;
            }
        }
        await Promise.all(
            workspaceAndConfigUris.map(async ({ baseUri, configUri }) => {
                if (await uriExists(configUri)) {
                    const configObject = await loadConfigUri(configUri);
                    if (isValidOrPrintError(configObject, configUri, outputChannel, "workspace")) {
                        layeredConfig.workspaceConfigs.set(
                            baseUri.toString(true),
                            configObject.config
                        );
                    }
                }
            })
        );
        tagsTreeProvider.clearAll();
        fileScannerUpdateConfig(layeredConfig);
        buildStyles();
        await kickOffScan();
    }

    const reloadConfigDebounced = debounce(reloadConfig, 100);

    reloadConfigDebounced("activate");

    const globalConfigWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(context.globalStorageUri, "tag-lens.config.jsonc")
    );
    const workspaceConfigWatcher = vscode.workspace.createFileSystemWatcher(
        "**/.vscode/tag-lens.config.jsonc"
    );

    globalConfigWatcher.onDidChange(() => reloadConfigDebounced("globalConfigWatcher.onDidChange"));
    globalConfigWatcher.onDidCreate(() => reloadConfigDebounced("globalConfigWatcher.onDidCreate"));
    globalConfigWatcher.onDidDelete(() => reloadConfigDebounced("globalConfigWatcher.onDidDelete"));
    workspaceConfigWatcher.onDidChange(() =>
        reloadConfigDebounced("workspaceConfigWatcher.onDidChange")
    );
    workspaceConfigWatcher.onDidCreate(() =>
        reloadConfigDebounced("workspaceConfigWatcher.onDidCreate")
    );
    workspaceConfigWatcher.onDidDelete(() =>
        reloadConfigDebounced("workspaceConfigWatcher.onDidDelete")
    );

    const styles = new Map<string, vscode.TextEditorDecorationType>();

    function buildStyles(): void {
        for (const style of styles.values()) {
            style.dispose();
        }
        styles.clear();
        for (const [name, style] of layeredConfig.getStyles()) {
            const decoration: vscode.DecorationRenderOptions = {};
            if (style.backgroundColor !== undefined) {
                decoration.backgroundColor = style.backgroundColor;
            }
            if (style.bold) {
                decoration.fontWeight = "bold";
            }
            if (style.border !== undefined) {
                decoration.border = style.border;
            }
            if (style.foregroundColor !== undefined) {
                decoration.color = style.foregroundColor;
            }
            if (style.italic) {
                decoration.fontStyle = "italic";
            }
            if (style.opacity !== undefined && Number.isFinite(style.opacity)) {
                decoration.opacity = Math.min(1.0, Math.max(style.opacity, 0.0)).toString(10);
            }
            if (style.textDecoration !== undefined) {
                decoration.textDecoration = style.textDecoration;
            }
            styles.set(name, vscode.window.createTextEditorDecorationType(decoration));
        }
    }

    function decorateEditors(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            for (const style of styles.values()) {
                editor.setDecorations(style, []);
            }
            const fileNode = tagsTreeProvider.getNode(editor.document.uri);
            if (fileNode instanceof FileNodeWrapper) {
                const decorations = new Map<string, vscode.Range[]>();
                for (const tagNode of fileNode.children()) {
                    const tag = tagNode.tag();
                    if (tag.decorationStyle !== undefined) {
                        const ranges = decorations.get(tag.decorationStyle) ?? [];
                        ranges.push(tagNode.range());
                        decorations.set(tag.decorationStyle, ranges);
                    }
                }
                for (const [styleKey, ranges] of decorations.entries()) {
                    const style = styles.get(styleKey);
                    if (style !== undefined) {
                        editor.setDecorations(style, ranges);
                    } else {
                        vscode.window.showWarningMessage(
                            `style ${styleKey} was called for but not defined`
                        );
                    }
                }
            }
        }
    }

    tagsTreeProvider.onDidChangeTreeData(decorateEditors);

    const tagsTreeView = vscode.window.createTreeView(views.tagsTreeView, {
        treeDataProvider: tagsTreeProvider,
    });

    const sourcesTreeView = vscode.window.createTreeView(views.sourcesTreeView, {
        treeDataProvider: sourcesTreeProvider,
    });

    async function openOrCreateConfig(baseUri: vscode.Uri): Promise<void> {
        const configUri = vscode.Uri.joinPath(baseUri, "tag-lens.config.jsonc");
        if (await uriExists(configUri)) {
            const document = await vscode.workspace.openTextDocument(configUri);
            await vscode.window.showTextDocument(document);
            return;
        }
        const document = await vscode.workspace.openTextDocument(
            configUri.with({ scheme: "untitled" })
        );
        const editor = await vscode.window.showTextDocument(document);
        await editor.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), "{}\n");
        });
        editor.selection = new vscode.Selection(
            new vscode.Position(0, 1),
            new vscode.Position(0, 1)
        );
    }

    function enqueueIfAllowed(uri: vscode.Uri, priority: boolean = false): void {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder === undefined && configuration.search.getLoose()) {
            enqueueFileLocal(uri, priority);
        } else if (workspaceFolder !== undefined) {
            const disabledWorkspaceFolders = context.workspaceState.get(
                disabledWorkspaceFolderState,
                {} as Record<string, boolean>
            );
            if (!disabledWorkspaceFolders[workspaceFolder.uri.toString(true)]) {
                enqueueFileLocal(uri, priority);
            }
        }
    }

    async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders === undefined) {
            await vscode.window.showWarningMessage(vscode.l10n.t("No workspace open"));
            return;
        } else if (workspaceFolders.length === 0) {
            await vscode.window.showWarningMessage(vscode.l10n.t("No workspace folders available"));
            return;
        }
        const items: (vscode.QuickPickItem & { folder: vscode.WorkspaceFolder })[] =
            workspaceFolders.map((folder) => ({
                label: folder.name,
                description: folder.uri.toString(),
                folder,
            }));
        const lastPicked = context.workspaceState.get<string | undefined>(
            lastPickedWorkspaceFolderState
        );
        items.sort((a, b) => {
            if (a.folder.uri.toString(true) === lastPicked) {
                return -1;
            } else if (b.folder.uri.toString(true) === lastPicked) {
                return 1;
            }
            return 0;
        });
        let picked: (vscode.QuickPickItem & { folder: vscode.WorkspaceFolder }) | undefined;
        if (items.length === 1) {
            picked = items[0];
        } else {
            picked = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a workspace folder",
            });
        }
        return picked?.folder;
    }

    const debounceUriMap = new Map<string, NodeJS.Timeout>();

    function debounceByUri(uri: string, callback: () => void, delay: number): void {
        const existing = debounceUriMap.get(uri);
        if (existing) {
            clearTimeout(existing);
        }
        const handle = setTimeout(() => {
            debounceUriMap.delete(uri);
            callback();
        }, delay);
        debounceUriMap.set(uri, handle);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand(commands.rescanWorkspace, async () => {
            tagsTreeProvider.clearAll();
            await kickOffScan();
        }),
        vscode.commands.registerCommand(commands.toggleLooseFiles, async () => {
            const current = configuration.search.getLoose();
            await configuration.search.updateLoose(!current);
        }),
        vscode.commands.registerCommand(
            commands.toggleWorkspace,
            async (workspaceFolder?: vscode.WorkspaceFolder | string) => {
                if (typeof workspaceFolder === "string") {
                    const workspaceNode: { type: "real"; uriString: string } =
                        JSON.parse(workspaceFolder);
                    workspaceFolder = vscode.workspace.getWorkspaceFolder(
                        vscode.Uri.parse(workspaceNode.uriString)
                    );
                }
                if (workspaceFolder === undefined) {
                    const picked = await pickWorkspaceFolder();
                    if (picked === undefined) {
                        return;
                    }
                    workspaceFolder = picked;
                }
                const disabledWorkspaceFolders = context.workspaceState.get(
                    disabledWorkspaceFolderState,
                    {} as Record<string, boolean>
                );
                const workspaceFolderUriString = workspaceFolder.uri.toString(true);
                if (disabledWorkspaceFolders[workspaceFolderUriString]) {
                    delete disabledWorkspaceFolders[workspaceFolderUriString];
                    const visibleEditorUris = vscode.window.visibleTextEditors.map((editor) =>
                        editor.document.uri.toString(true)
                    );
                    for (const uri of await vscode.workspace.findFiles(
                        new vscode.RelativePattern(workspaceFolder, "**/*")
                    )) {
                        const uriString = uri.toString(true);
                        enqueueFileLocal(uri, visibleEditorUris.includes(uriString));
                    }
                } else {
                    disabledWorkspaceFolders[workspaceFolderUriString] = true;
                    cancelUri(workspaceFolderUriString);
                    tagsTreeProvider.discardWorkspace(workspaceFolder);
                }
                await context.workspaceState.update(
                    disabledWorkspaceFolderState,
                    disabledWorkspaceFolders
                );
            }
        ),
        vscode.workspace.onDidChangeTextDocument((e) => {
            const eUri = e.document.uri;
            const eUriString = eUri.toString(true);
            debounceByUri(
                eUriString,
                () => {
                    tagsTreeProvider.clearFile(eUri);
                    cancelUri(eUriString);
                    enqueueIfAllowed(eUri);
                },
                100
            );
        }),
        vscode.workspace.onDidRenameFiles((e) => {
            for (const { oldUri, newUri } of e.files) {
                tagsTreeProvider.renameFile(oldUri, newUri);
            }
        }),
        vscode.workspace.onDidDeleteFiles((e) => {
            for (const uri of e.files) {
                tagsTreeProvider.clearFile(uri);
            }
        }),
        vscode.workspace.onDidCreateFiles((e) => {
            for (const uri of e.files) {
                enqueueIfAllowed(uri);
            }
        }),
        vscode.window.onDidChangeVisibleTextEditors((editors) => {
            for (const editor of editors) {
                enqueueIfAllowed(editor.document.uri, true);
            }
        }),
        vscode.commands.registerCommand(
            openTagLinkCommand,
            async (uri: vscode.Uri, range: vscode.Range) => {
                const uriString = uri.with({ fragment: "" }).toString(true);
                const openTab = vscode.window.tabGroups.activeTabGroup.tabs.find(
                    (tab) =>
                        tab.input instanceof vscode.TabInputText &&
                        tab.input.uri.toString(true) === uriString
                );
                if (openTab) {
                    await vscode.window.showTextDocument(
                        (openTab.input as vscode.TabInputText).uri,
                        {
                            selection: range,
                            preview: openTab.isPreview,
                            viewColumn: openTab.group.viewColumn,
                        }
                    );
                } else {
                    await vscode.window.showTextDocument(uri, {
                        selection: range,
                        preview: true,
                    });
                }
            }
        ),
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (
                e.affectsConfiguration("explorer.compactFolders") ||
                e.affectsConfiguration(configuration.compactFoldersFullKey)
            ) {
                tagsTreeProvider.updateShouldCompact();
            }
            if (e.affectsConfiguration(configuration.search.looseFullKey)) {
                if (configuration.search.getLoose()) {
                    for (const editor of vscode.window.visibleTextEditors) {
                        enqueueFileLocal(editor.document.uri, true);
                    }
                } else {
                    tagsTreeProvider.discardLoose();
                    cancelUri(undefined);
                }
            }
        }),
        vscode.window.onDidChangeVisibleTextEditors(decorateEditors),
        vscode.commands.registerCommand(commands.openGlobalConfig, async () => {
            await vscode.workspace.fs.createDirectory(context.globalStorageUri);
            await openOrCreateConfig(context.globalStorageUri);
        }),
        vscode.commands.registerCommand(commands.openWorkspaceConfig, async () => {
            const picked = await pickWorkspaceFolder();
            if (picked !== undefined) {
                await context.workspaceState.update(
                    lastPickedWorkspaceFolderState,
                    picked.uri.toString(true)
                );
                const vscodeFolder = vscode.Uri.joinPath(picked.uri, ".vscode");
                await vscode.workspace.fs.createDirectory(vscodeFolder);
                await openOrCreateConfig(vscodeFolder);
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() =>
            reloadConfigDebounced("onDidChangeWorkspaceFolders")
        ),
        vscode.commands.registerCommand(commands.scanLanguageComments, async () => {
            const discoveryPromise = getExtensionLanguageCommentTokens().then(
                (discoveredTokens) => {
                    const currentTokens = configuration.getCommentTokens();
                    const languageIds = new Set([
                        ...Object.keys(discoveredTokens),
                        ...Object.keys(currentTokens),
                    ]);
                    const languages: Record<
                        string,
                        {
                            current?: configuration.CommentTokens[string];
                            discovered: configuration.CommentTokens;
                        }
                    > = Object.fromEntries(
                        languageIds.entries().map(([languageId]) => [
                            languageId,
                            {
                                current: currentTokens[languageId],
                                discovered: discoveredTokens[languageId] ?? {},
                            },
                        ])
                    );
                    return languages;
                }
            );
            const { promise: readyPromise, resolve: readyResolve } = Promise.withResolvers<void>();
            const panel = vscode.window.createWebviewPanel(
                "tag-lens.commentTokens",
                "Tag Lens: Comment Tokens",
                vscode.ViewColumn.Active,
                { enableScripts: true }
            );
            const panelMessageDisposable = panel.webview.onDidReceiveMessage(
                (message: WebViewMessage) => {
                    const todo = undefined;
                    switch (message.type) {
                        case "ready":
                            readyResolve();
                            break;
                        case "commit":
                            // TODO: apply the config built by the webview
                            break;
                        default:
                            throw new Error(
                                `${message.type} should not be called from the webview side`
                            );
                    }
                }
            );
            panel.webview.html = `<html>
                <head>
                    <link rel="stylesheel" href="${panel.webview.asWebviewUri(
                        vscode.Uri.joinPath(context.extensionUri, "dist", "codicons", "codicon.css")
                    )}" id="vscode-codicon-stylesheet" />
                    <script src="${panel.webview.asWebviewUri(
                        vscode.Uri.joinPath(
                            context.extensionUri,
                            "dist",
                            "webview",
                            "commentTokens.js"
                        )
                    )}" type="module" defer></script>
                    <link rel="stylesheet" href="${panel.webview.asWebviewUri(
                        vscode.Uri.joinPath(
                            context.extensionUri,
                            "dist",
                            "webview",
                            "commentTokens.css"
                        )
                    )}" />
                </head>
                <body>
                    <div id="root"></div>
                </body>
            </html>`;
            let panelDisposed = false;
            context.subscriptions.push({
                dispose(): void {
                    if (!panelDisposed) {
                        panel.dispose();
                        panelMessageDisposable.dispose();
                        panelDisposed = true;
                    }
                },
            });
            const [languages] = await Promise.all([discoveryPromise, readyPromise]);
            await panel.webview.postMessage({
                type: "setConfig",
                config: { languages },
            });
            // const panel = vscode.window.createWebviewPanel(
            //     "tag-lens.commentTokens",
            //     "Tag Lens: Comment Tokens",
            //     vscode.ViewColumn.Active,
            //     { enableScripts: true }
            // );
            // panel.webview.html = commentTokensTemplate({
            //     script: panel.webview.asWebviewUri(
            //         vscode.Uri.joinPath(context.extensionUri, "resources", "commentTokens.js")
            //     ),
            //     stylesheet: panel.webview.asWebviewUri(
            //         vscode.Uri.joinPath(context.extensionUri, "resources", "commentTokens.css")
            //     ),
            //     codicon: panel.webview.asWebviewUri(
            //         vscode.Uri.joinPath(context.extensionUri, "dist", "codicons", "codicon.css")
            //     ),
            //     languages,
            // });
            // let panelDisposed = false;
            // const panelDisposable = {
            //     dispose(): void {
            //         if (!panelDisposed) {
            //             panel.dispose();
            //             panelDisposed = true;
            //         }
            //     },
            // };
            // context.subscriptions.push(
            //     panelDisposable,
            //     panel.webview.onDidReceiveMessage((e) => {
            //         try {
            //             const message = webViewDataSchema.parse(e);
            //             const newCommentTags = Object.fromEntries(
            //                 [...languageIds]
            //                     .sort()
            //                     .filter((languageId) => message.data[languageId] !== "remove")
            //                     .map((languageId) => {
            //                         const languageChoice = message.data[languageId];
            //                         switch (languageChoice) {
            //                             case "current":
            //                                 return [
            //                                     languageId,
            //                                     languages[languageId].current ?? {},
            //                                 ];
            //                             case "custom": {
            //                                 const lineCommentStart =
            //                                     message.data[`${languageId}.lineCommentStart`];
            //                                 const blockCommentStart =
            //                                     message.data[`${languageId}.blockCommentStart`];
            //                                 const blockCommentEnd =
            //                                     message.data[`${languageId}.blockCommentEnd`];
            //                                 return [
            //                                     languageId,
            //                                     {
            //                                         lineCommentStart:
            //                                             lineCommentStart === ""
            //                                                 ? undefined
            //                                                 : lineCommentStart,
            //                                         blockCommentStart:
            //                                             blockCommentStart === ""
            //                                                 ? undefined
            //                                                 : blockCommentStart,
            //                                         blockCommentEnd:
            //                                             blockCommentEnd === ""
            //                                                 ? undefined
            //                                                 : blockCommentEnd,
            //                                     },
            //                                 ];
            //                             }
            //                             default:
            //                                 return [
            //                                     languageId,
            //                                     languages[languageId].discovered[
            //                                         message.data[languageId]
            //                                     ],
            //                                 ];
            //                         }
            //                     })
            //             );
            //             configuration.updateCommentTokens(
            //                 newCommentTags,
            //                 vscode.ConfigurationTarget.Global
            //             );
            //         } finally {
            //             panelDisposable.dispose();
            //         }
            //     })
            // );
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(tagsTreeProvider.onDidChangeWorkspaceFolders),
        reloadProvidersEmitter.event(() => {
            layeredConfig.invalidateCache();
            kickOffScan().catch((err) =>
                vscode.window.showErrorMessage(`Caught error from scan function: ${err}`)
            );
        }),
        reloadProvidersEmitter,
        globalConfigWatcher,
        workspaceConfigWatcher,
        tagsTreeView,
        sourcesTreeView
    );
    return {
        contributeNamespace(
            callerContext: vscode.ExtensionContext,
            options: ProviderRegistrationOptions
        ): Promise<vscode.Disposable> {
            assert(callerContext !== undefined);
            assert(options !== undefined);
            assert(typeof options.namespace === "string");
            assert(
                ("configUri" in options && options.configUri instanceof vscode.Uri) ||
                    ("configJson" in options && typeof options.configJson === "string") ||
                    ("configObject" in options && options.configObject !== undefined)
            );
            return contributeNamespace(callerContext, outputChannel, options);
        },
    };
}

export function deactivate(): void {}

function debounce(fn: () => Promise<void>, delay: number): Debounced {
    let timer: NodeJS.Timeout | undefined;
    const callers = new Set<string>();

    const debounced = (caller: string): void => {
        clearTimeout(timer);
        callers.add(caller);
        timer = setTimeout(() => {
            trace({ debounced: fn.name, callers });
            fn().catch((err) =>
                vscode.window.showErrorMessage(`Caught error from debounced function: ${err}`)
            );
        }, delay);
    };

    debounced.cancel = (): void => {
        clearTimeout(timer);
    };

    return debounced;
}

interface Debounced {
    (caller: string): void;
    cancel(): void;
}

function uriExists(uri: vscode.Uri): Thenable<boolean> {
    return vscode.workspace.fs.stat(uri).then(
        () => true,
        () => false
    );
}
