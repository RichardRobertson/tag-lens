import assert from "node:assert";
import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import * as JSONC from "jsonc-parser";
import * as vscode from "vscode";
import z from "zod";
import { initConfigFile, LayeredConfig, loadConfig, registerProvider } from "./configFile";
import { cancelUri, enqueueFile, fileScannerUpdateConfig, initFileScanner } from "./fileScanner";
import { FileNodeWrapper, TreeProvider } from "./treeProvider";
import { trace } from "./util";

export const openTagLinkCommand = "tag-lens.openTagLink";
const disabledWorkspaceFolderState = "tag-lens.disabledWorkspaceFolderState";

// biome-ignore lint/nursery/useExplicitType: Zod object types don't exist before the object does. Type must be implied.
const PackageJsonLanguageContributionSchema = z.looseObject({
    name: z.string(),
    contributes: z.looseObject({
        languages: z.array(
            z.looseObject({
                id: z.string(),
                configuration: z.string(),
            })
        ),
    }),
});

// biome-ignore lint/nursery/useExplicitType: Zod object types don't exist before the object does. Type must be implied.
const LanguageConfigurationSchema = z.looseObject({
    comments: z.looseObject({
        lineComment: z
            .xor([
                z.string(),
                z.looseObject({
                    comment: z.string(),
                }),
            ])
            .optional(),
        blockComment: z.tuple([z.string(), z.string()]).optional(),
    }),
});

type LanguageConfiguration = z.infer<typeof LanguageConfigurationSchema>;

interface ProviderRegistrationOptions {
    namespace: string;
    configUri: vscode.Uri;
}

export function activate(context: vscode.ExtensionContext): {
    registerProvider(options: ProviderRegistrationOptions): Promise<vscode.Disposable>;
} {
    const outputChannel = vscode.window.createOutputChannel(vscode.l10n.t("Tag Lens"), {
        log: true,
    });

    function enqueueFileLocal(uri: vscode.Uri, priority: boolean): void {
        enqueueFile(uri, priority);
    }

    const diagnostics = vscode.languages.createDiagnosticCollection("tag-lens");

    const treeProvider = new TreeProvider(diagnostics);

    initFileScanner(
        (uri) => treeProvider.hasNode(uri),
        (uri, document, matches) => treeProvider.setFileMatches(uri, document, matches)
    );

    const reloadProvidersEmitter = new vscode.EventEmitter<void>();

    initConfigFile(reloadProvidersEmitter);

    async function kickOffScan(): Promise<void> {
        const visibleEditorUris = vscode.window.visibleTextEditors.map<[vscode.Uri, string]>(
            (editor) => [editor.document.uri, editor.document.uri.toString(true)]
        );
        const disabledWorkspaceFolders = context.workspaceState.get(
            disabledWorkspaceFolderState,
            {} as Record<string, boolean>
        );
        for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
            if (disabledWorkspaceFolders[workspaceFolder.uri.toString(true)]) {
                continue;
            }
            for (const uri of await vscode.workspace.findFiles(
                new vscode.RelativePattern(workspaceFolder, "**/*")
            )) {
                const uriString = uri.toString(true);
                enqueueFileLocal(
                    uri,
                    visibleEditorUris.some(([_, editorUriString]) => editorUriString === uriString)
                );
            }
        }
        if (configuration.search.getLoose()) {
            for (const [editorUri, _] of visibleEditorUris) {
                enqueueFileLocal(editorUri, true);
            }
        }
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
        const actions: vscode.MessageItem[] = [
            { title: vscode.l10n.t("Open Configuration") },
            { title: vscode.l10n.t("More Details") },
        ];
        if (await uriExists(globalConfigUri)) {
            const configObject = await loadConfig(globalConfigUri);
            if (configObject.type === "config") {
                layeredConfig.globalConfig = configObject.config;
            } else {
                switch (configObject.type) {
                    case "jsoncError":
                        outputChannel.error(
                            "Error parsing global configuration file",
                            `"${globalConfigUri.toString(true)}"`
                        );
                        for (const { error, offset, length } of configObject.error) {
                            outputChannel.error(
                                JSONC.printParseErrorCode(error),
                                "at offset",
                                offset,
                                "; length",
                                length
                            );
                        }
                        break;
                    case "zodError":
                        outputChannel.error(
                            "Schema error in global configuration file",
                            `"${globalConfigUri.toString(true)}"`
                        );
                        outputChannel.error(z.prettifyError(configObject.error));
                        break;
                }
                vscode.window
                    .showErrorMessage(
                        vscode.l10n.t(
                            "The global configuration file contains errors and could not be loaded."
                        ),
                        ...actions
                    )
                    .then((action) => {
                        if (action === actions[0]) {
                            vscode.window.showTextDocument(globalConfigUri);
                        } else if (action === actions[1]) {
                            outputChannel.show(true);
                        }
                    });
            }
        }
        await Promise.all(
            workspaceAndConfigUris.map(async ({ baseUri, configUri }) => {
                if (await uriExists(configUri)) {
                    const configObject = await loadConfig(configUri);
                    if (configObject.type === "config") {
                        layeredConfig.workspaceConfigs.set(
                            baseUri.toString(true),
                            configObject.config
                        );
                    } else {
                        switch (configObject.type) {
                            case "jsoncError":
                                outputChannel.error(
                                    "Error parsing workspace configuration file",
                                    `"${configUri.toString(true)}"`
                                );
                                for (const { error, offset, length } of configObject.error) {
                                    outputChannel.error(
                                        JSONC.printParseErrorCode(error),
                                        "at offset",
                                        offset,
                                        "; length",
                                        length
                                    );
                                }
                                break;
                            case "zodError":
                                outputChannel.error(
                                    "Schema error in global configuration file",
                                    `"${configUri.toString(true)}"`
                                );
                                outputChannel.error(z.prettifyError(configObject.error));
                                break;
                        }
                        vscode.window
                            .showErrorMessage(
                                vscode.l10n.t(
                                    "A workspace configuration file contains errors and could not be loaded."
                                ),
                                ...actions
                            )
                            .then((action) => {
                                if (action === actions[0]) {
                                    vscode.window.showTextDocument(configUri);
                                } else if (action === actions[1]) {
                                    outputChannel.show(true);
                                }
                            });
                    }
                }
            })
        );
        treeProvider.clearAll();
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
            const fileNode = treeProvider.getNode(editor.document.uri);
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

    treeProvider.onDidChangeTreeData(decorateEditors);

    const treeView = vscode.window.createTreeView(views.treeView, {
        treeDataProvider: treeProvider,
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
            treeProvider.clearAll();
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
                    treeProvider.discardWorkspace(workspaceFolder);
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
                    treeProvider.clearFile(eUri);
                    cancelUri(eUriString);
                    enqueueIfAllowed(eUri);
                },
                100
            );
        }),
        vscode.workspace.onDidRenameFiles((e) => {
            for (const { oldUri, newUri } of e.files) {
                treeProvider.renameFile(oldUri, newUri);
            }
        }),
        vscode.workspace.onDidDeleteFiles((e) => {
            for (const uri of e.files) {
                treeProvider.clearFile(uri);
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
                treeProvider.updateShouldCompact();
            }
            if (e.affectsConfiguration(configuration.search.looseFullKey)) {
                if (configuration.search.getLoose()) {
                    for (const editor of vscode.window.visibleTextEditors) {
                        enqueueFileLocal(editor.document.uri, true);
                    }
                } else {
                    treeProvider.discardLoose();
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
            const decoder = new TextDecoder();
            let content =
                '{\n    // Tag Lens language comment token scan results\n    // User may copy and paste this to their global or workspace level configuration file\n    "commentTokens": {\n';
            let notFirst = false;
            for (const extension of vscode.extensions.all) {
                const packageJSON = PackageJsonLanguageContributionSchema.safeParse(
                    extension.packageJSON
                );
                if (!packageJSON.success) {
                    continue;
                }
                for (const language of packageJSON.data.contributes.languages) {
                    const languagePath = vscode.Uri.joinPath(
                        extension.extensionUri,
                        language.configuration
                    );
                    let languageConfiguration: LanguageConfiguration | undefined;
                    try {
                        const fileBytes = await vscode.workspace.fs.readFile(languagePath);
                        const fileString = decoder.decode(fileBytes);
                        const fileObject = JSONC.parse(fileString);
                        const validated = LanguageConfigurationSchema.safeParse(fileObject);
                        if (validated.success) {
                            languageConfiguration = validated.data;
                        } else {
                            continue;
                        }
                    } catch (_) {
                        continue;
                    }
                    if (notFirst) {
                        content += ",\n";
                    } else {
                        notFirst = true;
                    }
                    content += `        "${language.id}": {\n            // source extension: ${packageJSON.data.name}\n`;
                    let lineCommentStart: string | undefined;
                    if (languageConfiguration.comments.lineComment !== undefined) {
                        content += '            "lineCommentStart": {\n';
                        content += '                "literal": ';
                        if (typeof languageConfiguration.comments.lineComment === "string") {
                            content += JSON.stringify(languageConfiguration.comments.lineComment);
                            lineCommentStart = languageConfiguration.comments.lineComment;
                        } else if (languageConfiguration.comments.lineComment !== undefined) {
                            content += JSON.stringify(
                                languageConfiguration.comments.lineComment.comment
                            );
                            lineCommentStart = languageConfiguration.comments.lineComment.comment;
                        }
                        content += "\n            }";
                    }
                    if (languageConfiguration.comments.blockComment !== undefined) {
                        if (lineCommentStart !== undefined) {
                            content += ",\n";
                            if (
                                languageConfiguration.comments.blockComment.includes(
                                    lineCommentStart
                                )
                            ) {
                                content +=
                                    "            // SUSPICIOUS: block comment token matches line comment token\n";
                            }
                        }
                        content += '            "blockCommentStart": {\n';
                        content += '                "literal": ';
                        content += JSON.stringify(languageConfiguration.comments.blockComment[0]);
                        content += "\n            },\n";
                        content += '            "blockCommentEnd": {\n';
                        content += '                "literal": ';
                        content += JSON.stringify(languageConfiguration.comments.blockComment[1]);
                        content += "\n            }\n";
                    } else {
                        content += "\n";
                    }
                    content += "        }";
                }
            }
            content += "\n    }\n}\n";
            const document = await vscode.workspace.openTextDocument({
                language: "jsonc",
                content,
                encoding: "utf-8",
            });
            await vscode.window.showTextDocument(document);
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(treeProvider.onDidChangeWorkspaceFolders),
        reloadProvidersEmitter.event(() => {
            layeredConfig.invalidateCache();
            kickOffScan().catch((err) =>
                vscode.window.showErrorMessage(`Caught error from scan function: ${err}`)
            );
        }),
        reloadProvidersEmitter,
        globalConfigWatcher,
        workspaceConfigWatcher,
        treeView
    );
    return {
        registerProvider(options: ProviderRegistrationOptions): Promise<vscode.Disposable> {
            assert(typeof options.namespace === "string");
            assert(options.configUri instanceof vscode.Uri);
            return registerProvider(outputChannel, options.namespace, options.configUri);
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
