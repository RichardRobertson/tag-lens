import * as vscode from "vscode";
import type { HydratedConfig } from "./configFile";

export class SourcesTreeProvider implements vscode.TreeDataProvider<string> {
    private readonly emitOnDidChangeTreeData = new vscode.EventEmitter<string | undefined>();

    readonly onDidChangeTreeData = this.emitOnDidChangeTreeData.event;

    getTreeItem(_element: string): vscode.TreeItem | Thenable<vscode.TreeItem> {
        throw new Error("Method not implemented.");
    }

    getChildren(_element?: string | undefined): vscode.ProviderResult<string[]> {
        throw new Error("Method not implemented.");
    }

    getParent?(_element: string): vscode.ProviderResult<string> {
        throw new Error("Method not implemented.");
    }

    resolveTreeItem?(
        _item: vscode.TreeItem,
        _element: string,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error("Method not implemented.");
    }
}

export class SourcesTreeItem extends vscode.TreeItem {
    constructor(
        uri: vscode.Uri,
        readonly config: HydratedConfig
    ) {
        super(uri, vscode.TreeItemCollapsibleState.None);
    }
}
