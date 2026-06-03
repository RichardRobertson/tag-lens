import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import * as JSONC from "jsonc-parser";
import * as vscode from "vscode";
import z from "zod";
import { LayeredConfig, loadConfig } from "./configFile";
import { debugDumpQueue, doOneWork, enqueueFile } from "./fileScanner";
import { FileNodeWrapper, TreeProvider } from "./treeProvider";

export const openTagLinkCommand = "tag-lens.openTagLink";

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

export function activate(context: vscode.ExtensionContext): void {
    const diagnostics = vscode.languages.createDiagnosticCollection("tag-lens");

    const treeProvider = new TreeProvider(diagnostics);

    async function kickOffScan(): Promise<void> {
        const visibleEditorUris = vscode.window.visibleTextEditors.map<[vscode.Uri, string]>(
            (editor) => [editor.document.uri, editor.document.uri.toString(true)]
        );
        if (configuration.search.getWorkspace()) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
                for (const uri of await vscode.workspace.findFiles(
                    new vscode.RelativePattern(workspaceFolder, "**/*")
                )) {
                    const uriString = uri.toString(true);
                    enqueueFile(
                        uri,
                        visibleEditorUris.some(
                            ([_, editorUriString]) => editorUriString === uriString
                        )
                    );
                }
            }
        }
        if (configuration.search.getExternal()) {
            for (const [editorUri, _] of visibleEditorUris) {
                enqueueFile(editorUri, true);
            }
        }
        debugDumpQueue();
    }

    function tickFileScanner(): void {
        doOneWork(
            layeredConfig,
            (uri) => treeProvider.getNode(uri) !== undefined,
            (uri, document, matches) => {
                treeProvider.setFileMatches(uri, document, matches);
            }
        ).catch((err) => vscode.window.showErrorMessage(`Caught error from doOneWork: ${err}`));
    }

    const lastPickedWorkspaceFolderState = "tag-lens.lastPickedWorkspaceFolder";

    const layeredConfig = new LayeredConfig();

    async function reloadConfig(): Promise<void> {
        layeredConfig.clear();
        const globalConfigUri = vscode.Uri.joinPath(
            context.globalStorageUri,
            "tag-lens.config.jsonc"
        );
        const workspaceConfigUris = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
            baseUri: folder.uri,
            configUri: vscode.Uri.joinPath(folder.uri, ".vscode", "tag-lens.config.jsonc"),
        }));
        if (await uriExists(globalConfigUri)) {
            layeredConfig.globalConfig = await loadConfig(globalConfigUri);
        }
        await Promise.all(
            workspaceConfigUris.map(async (workspaceConfigUri) => {
                if (await uriExists(workspaceConfigUri.configUri)) {
                    layeredConfig.workspaceConfigs.set(
                        workspaceConfigUri.baseUri.toString(true),
                        await loadConfig(workspaceConfigUri.configUri)
                    );
                }
            })
        );
        treeProvider.clearAll();
        buildStyles();
        await kickOffScan();
    }

    const reloadConfigDebounced = debounce(reloadConfig, 100);

    reloadConfigDebounced();

    const globalConfigWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(context.globalStorageUri, "tag-lens.config.jsonc")
    );
    const workspaceConfigWatcher = vscode.workspace.createFileSystemWatcher(
        "**/.vscode/tag-lens.config.jsonc"
    );

    globalConfigWatcher.onDidChange(reloadConfigDebounced);
    globalConfigWatcher.onDidCreate(reloadConfigDebounced);
    globalConfigWatcher.onDidDelete(reloadConfigDebounced);
    workspaceConfigWatcher.onDidChange(reloadConfigDebounced);
    workspaceConfigWatcher.onDidCreate(reloadConfigDebounced);
    workspaceConfigWatcher.onDidDelete(reloadConfigDebounced);

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

    // let scanCancellationTokenSource: vscode.CancellationTokenSource | undefined;

    // async function scan(): Promise<void> {
    //     if (scanCancellationTokenSource !== undefined) {
    //         scanCancellationTokenSource.cancel();
    //         scanCancellationTokenSource.dispose();
    //     }
    //     scanDebounced.cancel();
    //     try {
    //         await vscode.window.withProgress(
    //             {
    //                 location: { viewId: views.treeView },
    //                 cancellable: true,
    //                 title: vscode.l10n.t("Scanning workspace"),
    //             },
    //             async (_progress, token) => {
    //                 const stackedTokenSource = new vscode.CancellationTokenSource();
    //                 scanCancellationTokenSource = stackedTokenSource;
    //                 token.onCancellationRequested(() => {
    //                     scanDebounced.cancel();
    //                     stackedTokenSource.cancel();
    //                     stackedTokenSource.dispose();
    //                 });
    //                 treeView.badge = {
    //                     tooltip: vscode.l10n.t("Scanning workspace"),
    //                     value: 1,
    //                 };
    //                 // const tags = [...layeredConfig.getTags()];
    //                 // await treeProvider.withNewTree(async (addTagMatch) => {
    //                 //     for await (const tagMatch of search({ tags }, stackedTokenSource.token)) {
    //                 //         addTagMatch(tagMatch, tags);
    //                 //     }
    //                 // });
    //                 treeProvider.clearAll();
    //                 for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    //                     // const workspaceConfig = layeredConfig.getEffectiveWorkspaceConfig(
    //                     //     workspaceFolder.uri
    //                     // );
    //                     for (const fileUri of await vscode.workspace.findFiles(
    //                         new vscode.RelativePattern(workspaceFolder, "**/*"),
    //                         undefined,
    //                         undefined,
    //                         token
    //                     )) {
    //                         treeProvider.setFileMatches(
    //                             fileUri,
    //                             await vscode.workspace.openTextDocument(fileUri),
    //                             []
    //                         );
    //                     }
    //                 }
    //                 // treeProvider.fireOnDidChangeTreeData();
    //                 treeView.badge = undefined;
    //             }
    //         );
    //     } finally {
    //         scanCancellationTokenSource?.dispose();
    //         scanCancellationTokenSource = undefined;
    //     }
    // }

    // const scanDebounced = debounce(scan, 1000);

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
        const isExternal = vscode.workspace.getWorkspaceFolder(uri) === undefined;
        if (
            (isExternal && configuration.search.getExternal()) ||
            (!isExternal && configuration.search.getWorkspace())
        ) {
            enqueueFile(uri, priority);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand(commands.rescanWorkspace, async () => {
            treeProvider.clearAll();
            await kickOffScan();
        }),
        vscode.workspace.onDidChangeTextDocument((e) => {
            enqueueIfAllowed(e.document.uri);
        }),
        vscode.workspace.onDidRenameFiles((e) => {
            for (const { oldUri, newUri } of e.files) {
                // TODO optimize with treeProvider.renameFile(oldUri, newUri);
                treeProvider.clearFile(oldUri);
                enqueueIfAllowed(newUri);
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
            // if (e.affectsConfiguration(configuration.section)) {
            //     scanDebounced();
            // }
        }),
        vscode.window.onDidChangeVisibleTextEditors(decorateEditors),
        vscode.commands.registerCommand(commands.openGlobalConfig, async () => {
            await vscode.workspace.fs.createDirectory(context.globalStorageUri);
            await openOrCreateConfig(context.globalStorageUri);
        }),
        vscode.commands.registerCommand(commands.openWorkspaceConfig, async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders === undefined) {
                await vscode.window.showWarningMessage(vscode.l10n.t("No workspace open"));
                return;
            } else if (workspaceFolders.length === 0) {
                await vscode.window.showWarningMessage(
                    vscode.l10n.t("No workspace folders available")
                );
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
            if (picked !== undefined) {
                await context.workspaceState.update(
                    lastPickedWorkspaceFolderState,
                    picked.folder.uri.toString(true)
                );
                const vscodeFolder = vscode.Uri.joinPath(picked.folder.uri, ".vscode");
                await vscode.workspace.fs.createDirectory(vscodeFolder);
                await openOrCreateConfig(vscodeFolder);
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(reloadConfigDebounced),
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
        globalConfigWatcher,
        workspaceConfigWatcher,
        treeView
    );

    // scanDebounced();

    kickOffScan().catch((err) =>
        vscode.window.showErrorMessage(`Caught error from \`kickOffScan\`: ${err}`)
    );

    tickFileScanner();
}

export function deactivate(): void {}

function debounce(fn: () => Promise<void>, delay: number): Debounced {
    let timer: NodeJS.Timeout | undefined;

    const debounced = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
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
    (): void;
    cancel(): void;
}

function uriExists(uri: vscode.Uri): Thenable<boolean> {
    return vscode.workspace.fs.stat(uri).then(
        () => true,
        () => false
    );
}
