import crypto from "node:crypto";
import * as vscode from "vscode";
import type z from "zod";
import { CompositeDisposable } from "./util";

export function createWebView<
    ToWebViewMessage extends z.ZodType,
    FromWebViewMessage extends z.ZodType,
>(
    context: vscode.ExtensionContext,
    viewType: string,
    title: string,
    fileBaseName: string,
    toWebViewMessageSchema: ToWebViewMessage,
    fromWebViewMessageSchema: FromWebViewMessage,
    onMessage: (message: z.output<FromWebViewMessage>) => void
): {
    disposable: CompositeDisposable;
    postMessage: (message: z.output<ToWebViewMessage>) => Thenable<boolean>;
} {
    const disposable = new CompositeDisposable();
    const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist", "codicons"),
            vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
        ],
    });
    disposable.push(
        panel,
        panel.webview.onDidReceiveMessage((message: unknown) =>
            onMessage(fromWebViewMessageSchema.parse(message))
        )
    );
    const nonce = crypto.randomBytes(16).toBase64();
    panel.webview.html = `<html>
        <head>
            <meta http-equiv="Content-Security-Policy" content="
                default-src 'none';
                style-src ${panel.webview.cspSource};
                font-src ${panel.webview.cspSource};
                connect-src ${panel.webview.cspSource};
                script-src 'nonce-${nonce}';
            ">
            <link rel="stylesheet" href="${panel.webview.asWebviewUri(
                vscode.Uri.joinPath(context.extensionUri, "dist", "codicons", "codicon.css")
            )}" id="vscode-codicon-stylesheet" />
            <link rel="stylesheet" href="${panel.webview.asWebviewUri(
                vscode.Uri.joinPath(context.extensionUri, "dist", "webview", `${fileBaseName}.css`)
            )}" />
            <script nonce="${nonce}" src="${panel.webview.asWebviewUri(
                vscode.Uri.joinPath(context.extensionUri, "dist", "webview", `${fileBaseName}.js`)
            )}" type="module" defer></script>
        </head>
        <body>
            <div id="root"></div>
        </body>
    </html>`;
    return {
        disposable,
        postMessage(message: z.output<ToWebViewMessage>): Thenable<boolean> {
            return panel.webview.postMessage(toWebViewMessageSchema.parse(message));
        },
    };
}
