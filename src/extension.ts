import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import * as vscode from "vscode";
import { search } from "./searchProvider";
import { TreeProvider } from "./treeProvider";

export const openTagLinkCommand = "tag-lens.openTagLink";

export function activate(context: vscode.ExtensionContext): void {
    const styles = new Map<string, vscode.TextEditorDecorationType>();

    function buildStyles(): void {
        for (const style of styles.values()) {
            style.dispose();
        }
        styles.clear();
        for (const [name, style] of Object.entries(configuration.getStyles())) {
            const decoration: vscode.DecorationRenderOptions = {};
            if (style.backgroundColor !== undefined) {
                if (typeof style.backgroundColor === "string") {
                    decoration.backgroundColor = style.backgroundColor;
                } else if (style.backgroundColor.theme !== undefined) {
                    decoration.backgroundColor = new vscode.ThemeColor(style.backgroundColor.theme);
                }
            }
            if (style.bold) {
                decoration.fontWeight = "bold";
            }
            if (style.border !== undefined) {
                decoration.border = style.border;
            }
            if (style.foregroundColor !== undefined) {
                if (typeof style.foregroundColor === "string") {
                    decoration.color = style.foregroundColor;
                } else if (style.foregroundColor.theme !== undefined) {
                    decoration.color = new vscode.ThemeColor(style.foregroundColor.theme);
                }
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

    buildStyles();

    function decorateEditors(force: boolean): void {
        if (!force && treeProvider.treeInProgress) {
            return;
        }
        const tags = configuration.getTags();
        for (const editor of vscode.window.visibleTextEditors) {
            for (const style of styles.values()) {
                editor.setDecorations(style, []);
            }
            const fileNode = treeProvider.getFile(editor.document.uri);
            if (fileNode !== undefined) {
                const decorations = new Map<string, vscode.Range[]>();
                for (const tagNode of fileNode.children()) {
                    const tag = tags[tagNode.tagIndex];
                    if (tag.decorationStyle !== undefined) {
                        const ranges = decorations.get(tag.decorationStyle) ?? [];
                        ranges.push(tagNode.range);
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

    const diagnostics = vscode.languages.createDiagnosticCollection("tag-lens");

    const treeProvider = new TreeProvider(diagnostics);
    treeProvider.onDidChangeTreeData(() => decorateEditors(true));

    const treeView = vscode.window.createTreeView(views.treeView, {
        treeDataProvider: treeProvider,
    });

    let scanCancellationTokenSource: vscode.CancellationTokenSource | undefined;

    async function scan(): Promise<void> {
        if (scanCancellationTokenSource !== undefined) {
            scanCancellationTokenSource.cancel();
            scanCancellationTokenSource.dispose();
        }
        scanDebounced.cancel();
        try {
            await vscode.window.withProgress(
                {
                    location: { viewId: views.treeView },
                    cancellable: true,
                    title: vscode.l10n.t("Scanning workspace"),
                },
                async (_progress, token) => {
                    const stackedTokenSource = new vscode.CancellationTokenSource();
                    scanCancellationTokenSource = stackedTokenSource;
                    token.onCancellationRequested(() => {
                        scanDebounced.cancel();
                        stackedTokenSource.cancel();
                        stackedTokenSource.dispose();
                    });
                    treeView.badge = {
                        tooltip: vscode.l10n.t("Scanning workspace"),
                        value: 1,
                    };
                    const tags = configuration.getTags();
                    await treeProvider.withNewTree(async (addTagMatch) => {
                        for await (const tagMatch of search({ tags }, stackedTokenSource.token)) {
                            addTagMatch(tagMatch, tags);
                        }
                    });
                    treeView.badge = undefined;
                }
            );
        } finally {
            scanCancellationTokenSource?.dispose();
            scanCancellationTokenSource = undefined;
        }
    }

    const scanDebounced = debounce(scan, 1000);

    context.subscriptions.push(
        vscode.commands.registerCommand(commands.rescanWorkspace, scan),
        vscode.workspace.onDidChangeTextDocument(scanDebounced),
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
            if (e.affectsConfiguration(configuration.stylesFullKey)) {
                buildStyles();
                decorateEditors(false);
            } else if (e.affectsConfiguration(configuration.section)) {
                scanDebounced();
            }
        }),
        vscode.window.onDidChangeVisibleTextEditors(() => decorateEditors(false)),
        treeView
    );

    scanDebounced();
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
