import * as vscode from "vscode";

export class TreeProvider implements vscode.TreeDataProvider<string> {
    private readonly emitOnDidChangeTreeData: vscode.EventEmitter<
        // biome-ignore lint/suspicious/noConfusingVoidType: TreeDataProvider API
        string | void | string[] | null | undefined
    > = new vscode.EventEmitter();

    // biome-ignore lint/suspicious/noConfusingVoidType: TreeDataProvider API
    onDidChangeTreeData: vscode.Event<string | void | string[] | null | undefined> =
        this.emitOnDidChangeTreeData.event;

    getTreeItem(element: string): vscode.TreeItem | Thenable<vscode.TreeItem> {
        throw new Error("Method not implemented.");
    }

    getChildren(element?: string | undefined): vscode.ProviderResult<string[]> {
        throw new Error("Method not implemented.");
    }

    getParent?(element: string): vscode.ProviderResult<string> {
        throw new Error("Method not implemented.");
    }

    resolveTreeItem?(
        item: vscode.TreeItem,
        element: string,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TreeItem> {
        throw new Error("Method not implemented.");
    }
}
