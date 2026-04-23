import * as commands from "@generated/commands";
import * as configuration from "@generated/configuration";
import * as views from "@generated/views";
import { debounce } from "ts-debounce";
import * as vscode from "vscode";
import { searchWorkspaceAndUnsavedEditors } from "./searchProvider";
import { TreeProvider } from "./treeProvider";

export const openTagLinkCommand = "tag-lens.openTagLink";

export function activate(context: vscode.ExtensionContext): void {
    console.log('Congratulations, your extension "tag-lens" is now active!');

    const treeProvider = new TreeProvider();

    const treeView = vscode.window.createTreeView(views.treeView, {
        treeDataProvider: treeProvider,
    });

    async function scan(): Promise<void> {
        scanDebounced.cancel();
        await vscode.window.withProgress(
            {
                location: { viewId: views.treeView },
                cancellable: true,
                title: vscode.l10n.t("tag-lens.commands.rescanWorkspace.title"),
            },
            async (_progress, token) => {
                token.onCancellationRequested(scanDebounced.cancel);
                treeView.badge = {
                    tooltip: vscode.l10n.t(`tag-lens.views.${views.treeView}.badge.tooltip`),
                    value: 1,
                };
                await treeProvider.withNewTree(async (addTagMatch) => {
                    for await (const tagMatch of searchWorkspaceAndUnsavedEditors(
                        { tags: configuration.getTags() },
                        token
                    )) {
                        addTagMatch(tagMatch);
                    }
                });
                treeView.badge = undefined;
            }
        );
    }

    const scanDebounced = debounce(scan, 1000);

    context.subscriptions.push(
        vscode.commands.registerCommand(commands.rescanWorkspace, scan),
        vscode.workspace.onDidChangeTextDocument(() => scanDebounced),
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
        treeView
    );

    scanDebounced().then(undefined, (err) => {
        if (err !== undefined) {
            vscode.window.showErrorMessage(err.toString());
        }
    });
}

export function deactivate(): void {}
