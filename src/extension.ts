import assert from "node:assert";
import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import * as vscode from "vscode";
import {
    contributeNamespace,
    initConfigFile,
    isValidOrPrintError,
    LayeredConfig,
    loadConfigUri,
    type ProviderRegistrationOptions,
} from "./configFile";
import { getExtensionLanguageCommentTokens } from "./discoverCommentTokens";
import { cancelUri, enqueueFile, fileScannerUpdateConfig, initFileScanner } from "./fileScanner";
import { L } from "./i18n/i18n-node";
import type { Locales, TranslationFunctions } from "./i18n/i18n-types";
import { SourcesTreeProvider } from "./sourcesTreeProvider";
import { FileNodeWrapper, TagsTreeProvider } from "./treeProvider";
import { trace } from "./util";
import { createWebView } from "./webview";
import {
    enumContainsFlag,
    FromWebView,
    type PartialCommentTokens,
    TokenWarnings,
    ToWebView,
    validateCommentTokens,
} from "./webviewMessage";

export const LL: TranslationFunctions = L[vscode.env.language as Locales] ?? L.en;

export const openTagLinkCommand = "tag-lens.openTagLink";
const disabledWorkspaceFolderState = "tag-lens.disabledWorkspaceFolderState";

export async function activate(context: vscode.ExtensionContext): Promise<{
    contributeNamespace(
        callerContext: vscode.ExtensionContext,
        options: ProviderRegistrationOptions
    ): Promise<vscode.Disposable>;
}> {
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
            await vscode.window.showWarningMessage(LL.Extension.Warnings.NoWorkspaceOpen());
            return;
        } else if (workspaceFolders.length === 0) {
            await vscode.window.showWarningMessage(LL.Extension.Warnings.NoWorkspaceFolders());
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
                placeHolder: LL.Extension.SelectWorkspacePlaceholder(),
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
            const { promise: readyPromise, resolve: readyResolve } = Promise.withResolvers<void>();
            const { disposable: panelDisposable, postMessage } = createWebView(
                context,
                "tag-lens.commentTokens",
                LL.CommentTokens.WebViewTitle(),
                "commentTokens",
                ToWebView.Message,
                FromWebView.Message,
                (message) => {
                    switch (message.type) {
                        case "ready":
                            readyResolve();
                            return;
                        case "commit": {
                            const empties: string[] = [];
                            const invalids: [string, TokenWarnings][] = [];
                            const editedConfig = message.editedConfig as Record<
                                string,
                                PartialCommentTokens
                            >;
                            for (const [languageId, tokens] of Object.entries(editedConfig)) {
                                if (tokens.lineCommentStart === "") {
                                    delete tokens.lineCommentStart;
                                }
                                if (tokens.blockCommentStart === "") {
                                    delete tokens.blockCommentStart;
                                }
                                if (tokens.blockCommentEnd === "") {
                                    delete tokens.blockCommentEnd;
                                }
                                const warnings = validateCommentTokens(tokens);
                                if (warnings === TokenWarnings.None) {
                                    continue;
                                }
                                if (warnings === TokenWarnings.AllEmpty) {
                                    empties.push(languageId);
                                } else {
                                    invalids.push([languageId, warnings]);
                                }
                            }
                            if (invalids.length !== 0) {
                                outputChannel.error(
                                    LL.CommentTokens.ConfigurationHasErrorsOutputChannelHeader()
                                );
                                for (const [languageId, warnings] of invalids) {
                                    outputChannel.error(`    ${languageId}`);
                                    if (
                                        enumContainsFlag(
                                            warnings,
                                            TokenWarnings.LineStartMatchesBlockStart
                                        )
                                    ) {
                                        outputChannel.error(
                                            `        ${LL.TokenWarnings.LineStartMatchesBlockStart()}`
                                        );
                                    }
                                    if (
                                        enumContainsFlag(
                                            warnings,
                                            TokenWarnings.LineStartMatchesBlockEnd
                                        )
                                    ) {
                                        outputChannel.error(
                                            `        ${LL.TokenWarnings.LineStartMatchesBlockEnd()}`
                                        );
                                    }
                                    if (enumContainsFlag(warnings, TokenWarnings.BlockStartEmpty)) {
                                        outputChannel.error(
                                            `        ${LL.TokenWarnings.BlockStartEmpty()}`
                                        );
                                    }
                                    if (enumContainsFlag(warnings, TokenWarnings.BlockEndEmpty)) {
                                        outputChannel.error(
                                            `        ${LL.TokenWarnings.BlockEndEmpty()}`
                                        );
                                    }
                                }
                                vscode.window
                                    .showErrorMessage(
                                        LL.CommentTokens.ConfigurationHasErrorsMessage(),
                                        LL.GenericButtons.ShowDetails()
                                    )
                                    .then((selected) => {
                                        if (selected !== undefined) {
                                            outputChannel.show();
                                        }
                                    });
                                return;
                            }
                            if (empties.length !== 0) {
                                outputChannel.warn(
                                    LL.CommentTokens.ConfigurationHasEmptyOutputChannelHeader()
                                );
                                for (const languageId of empties) {
                                    outputChannel.warn(`    ${languageId}`);
                                    delete editedConfig[languageId];
                                }
                                vscode.window
                                    .showWarningMessage(
                                        LL.CommentTokens.ConfigurationHasEmptyMessage(),
                                        LL.GenericButtons.ShowDetails()
                                    )
                                    .then((selected) => {
                                        if (selected !== undefined) {
                                            outputChannel.show();
                                        }
                                    });
                            }
                            configuration.updateCommentTokens(
                                editedConfig,
                                vscode.ConfigurationTarget.Global
                            );
                            panelDisposable.dispose();
                            return;
                        }
                        case "discard": {
                            const items: vscode.MessageItem[] = [
                                { title: LL.GenericButtons.Yes() },
                                { title: LL.GenericButtons.No() },
                            ] as const;
                            vscode.window
                                .showInformationMessage(
                                    LL.CommentTokens.ConfirmDiscardChanges(),
                                    { modal: true },
                                    ...items
                                )
                                .then((value) => {
                                    if (value === items[0]) {
                                        panelDisposable.dispose();
                                    }
                                });
                            return;
                        }
                        case "inputRequest": {
                            vscode.window
                                .showInputBox({ prompt: message.prompt, title: message.title })
                                .then((input) => {
                                    if (input !== undefined) {
                                        postMessage({ type: "inputResponse", input });
                                    }
                                });
                            return;
                        }
                    }
                }
            );
            context.subscriptions.push(panelDisposable);
            const [discovered] = await Promise.all([
                getExtensionLanguageCommentTokens(),
                readyPromise,
            ]);
            await postMessage({
                type: "setConfig",
                baselineConfig: configuration.getCommentTokens(),
                discovered: discovered,
            });
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
