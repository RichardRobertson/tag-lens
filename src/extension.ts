import * as commands from "@generated/commands";
import * as views from "@generated/views";
import * as vscode from "vscode";
import { TreeProvider } from "./treeProvider";

export function activate(context: vscode.ExtensionContext): void {
    console.log('Congratulations, your extension "tag-lens" is now active!');

    const treeProvider = new TreeProvider();

    context.subscriptions.push(
        vscode.commands.registerCommand(commands.rescanWorkspace, () => {
            vscode.window.showInformationMessage("Hello World from Tag Lens!");
        }),
        vscode.window.registerTreeDataProvider(views.treeView, treeProvider)
    );
}

export function deactivate(): void {}
