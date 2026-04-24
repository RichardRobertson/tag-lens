import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import { debounce } from "ts-debounce";
import * as vscode from "vscode";
import { search } from "./searchProvider";
import { TreeProvider } from "./treeProvider";

export const openTagLinkCommand = "tag-lens.openTagLink";

export function activate(context: vscode.ExtensionContext): void {
    const treeProvider = new TreeProvider();

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
                    await treeProvider.withNewTree(async (addTagMatch) => {
                        for await (const tagMatch of search(
                            { tags: configuration.getTags() },
                            stackedTokenSource.token
                        )) {
                            addTagMatch(tagMatch);
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
        vscode.workspace.onDidChangeTextDocument(async () => {
            await scanDebounced();
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
            if (e.affectsConfiguration(configuration.section)) {
                await scanDebounced();
            }
        }),
        treeView
    );

    scanDebounced().then(undefined, (err) => {
        if (err !== undefined) {
            vscode.window.showErrorMessage(err.toString());
        }
    });
}

export function deactivate(): void {}
