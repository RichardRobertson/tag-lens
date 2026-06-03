import * as vscode from "vscode";
import type { HydratedConfig, LayeredConfig } from "./configFile";
import type { TagMatch } from "./treeProvider";
import { concatIterables, WorkQueue } from "./util";

const fileQueue: WorkQueue<vscode.Uri, string> = new WorkQueue<vscode.Uri, string>((uri) =>
    uri.toString(true)
);

let doOneWorkCancellationTokenSource: vscode.CancellationTokenSource | undefined;

export function cancel(): void {
    doOneWorkCancellationTokenSource?.cancel();
}

export function clearQueue(): void {
    fileQueue.clear();
}

export function enqueueFile(uri: vscode.Uri, priority: boolean = false): void {
    fileQueue.enqueue(uri, priority);
}

export function debugDumpQueue(): void {
    fileQueue.debugDump();
}

export async function doOneWork(
    layeredConfig: LayeredConfig,
    treeHasFile: (uri: vscode.Uri) => boolean | Thenable<boolean>,
    setTreeFileMatches: (
        uri: vscode.Uri,
        document: vscode.TextDocument,
        matches: TagMatch[]
    ) => void | Thenable<void>
): Promise<void> {
    if (doOneWorkCancellationTokenSource !== undefined) {
        throw new Error("Overlapping doOneWork call");
    }
    doOneWorkCancellationTokenSource = new vscode.CancellationTokenSource();
    const cancellationToken = doOneWorkCancellationTokenSource.token;
    try {
        const uri = fileQueue.pop();
        if (uri === undefined) {
            return;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        if (cancellationToken.isCancellationRequested) {
            return;
        }
        if (await treeHasFile(uri)) {
            return;
        }
        const workspace = vscode.workspace.getWorkspaceFolder(uri);
        let effectiveConfig: HydratedConfig | undefined;
        if (workspace === undefined) {
            effectiveConfig = layeredConfig.effectiveGlobalConfig;
        } else {
            effectiveConfig = layeredConfig.getEffectiveWorkspaceConfig(workspace.uri);
        }
        const text = document.getText();
        const tags = concatIterables(
            effectiveConfig.tags.get("*") ?? [],
            effectiveConfig.tags.get(document.languageId) ?? []
        );
        const matches: TagMatch[] = [];
        for (const { tag } of tags) {
            const regex = new RegExp(tag.pattern.regexp);
            for (const match of text.matchAll(regex)) {
                matches.push({ tag, match });
            }
        }
        const commentToken = effectiveConfig.commentTokens.get(document.languageId);
        if (commentToken !== undefined) {
            const commentSpans: { start: number; end: number }[] = [];
            if (commentToken.lineCommentStart !== undefined) {
                const lineCommentStartRegex = new RegExp(commentToken.lineCommentStart.regexp);
                for (const lineCommentStartMatch of text.matchAll(lineCommentStartRegex)) {
                    const start = lineCommentStartMatch.index + lineCommentStartMatch[0].length;
                    let end = text.indexOf(
                        "\n",
                        lineCommentStartMatch.index + lineCommentStartMatch[0].length
                    );
                    if (end === -1) {
                        end = text.length;
                    }
                    commentSpans.push({ start, end });
                }
            }
            if (commentToken.blockComment !== undefined) {
                const blockCommentStartRegex = new RegExp(commentToken.blockComment.start.regexp);
                const blockCommentEndRegex = new RegExp(commentToken.blockComment.end.regexp);
                const startIndices = [
                    ...text
                        .matchAll(blockCommentStartRegex)
                        .map((startMatch) => startMatch.index + startMatch[0].length),
                ];
                const endIndices = [
                    ...text.matchAll(blockCommentEndRegex).map((endMatch) => endMatch.index),
                ];
                let valid = false;
                if (startIndices.length === endIndices.length) {
                    valid = true;
                    for (let i = 0; i < startIndices.length; i++) {
                        if (startIndices[i] > endIndices[i]) {
                            valid = false;
                            break;
                        }
                    }
                }
                if (valid) {
                    for (let i = 0; i < startIndices.length; i += 2) {
                        commentSpans.push({
                            start: startIndices[i],
                            end: endIndices[i],
                        });
                    }
                }
            }
            commentSpans.sort((a, b) => a.start - b.start);
            for (const { tag } of effectiveConfig.commentTags) {
                const regex = new RegExp(tag.pattern.regexp);
                for (const match of text.matchAll(regex)) {
                    const index = match.index;
                    for (const commentSpan of commentSpans) {
                        if (commentSpan.start <= index && index < commentSpan.end) {
                            matches.push({ tag, match });
                            break;
                        }
                        if (commentSpan.start > index) {
                            break;
                        }
                    }
                }
            }
        }
        if (matches.length !== 0 && !cancellationToken.isCancellationRequested) {
            await setTreeFileMatches(uri, document, matches);
        }
    } finally {
        doOneWorkCancellationTokenSource.dispose();
        doOneWorkCancellationTokenSource = undefined;
    }
}
