import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import * as vscode from "vscode";
import { search } from "./searchProvider";
import { TreeProvider } from "./treeProvider";

export const openTagLinkCommand = "tag-lens.openTagLink";

export function activate(context: vscode.ExtensionContext): void {
    const diagnostics = vscode.languages.createDiagnosticCollection("tag-lens");

    const treeProvider = new TreeProvider(diagnostics);

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
            if (e.affectsConfiguration(configuration.section)) {
                scanDebounced();
            }
        }),
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
