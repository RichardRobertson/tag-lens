import * as vscode from "vscode";
import type { HydratedConfig, LayeredConfig } from "./configFile";
import type { TagMatch } from "./treeProvider";
import { concatIterables, re2jsMatchAllWithIndices, trace, WorkQueue } from "./util";

const fileQueue: WorkQueue<vscode.Uri, string> = new WorkQueue<vscode.Uri, string>((uri) =>
    uri.toString(true)
);

export function clearQueue(): void {
    fileQueue.clear();
}

export function enqueueFile(uri: vscode.Uri, priority: boolean = false): void {
    fileQueue.enqueue(uri, priority);
}

export function debugDumpQueue(): void {
    fileQueue.debugDump();
}

export function hasPendingWork(): boolean {
    return !fileQueue.isEmpty();
}

interface Task {
    cancellationTokenSource: vscode.CancellationTokenSource;
    promise: Promise<void>;
    subscription?: vscode.Disposable;
    uri: vscode.Uri;
}

let task: Task | undefined;

type Tail2<T extends unknown[]> = T extends [unknown, unknown, ...infer Rest] ? Rest : never;

export function doOneWork(
    outerToken: vscode.CancellationToken | undefined,
    ...args: Tail2<Parameters<typeof doOneWorkImpl>>
): Promise<void> {
    if (task !== undefined) {
        throw new Error("Overlapped process");
    }
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    const subscription = outerToken?.onCancellationRequested(() =>
        cancellationTokenSource.cancel()
    );
    const uri = fileQueue.pop();
    if (uri === undefined) {
        return Promise.resolve();
    }
    task = {
        cancellationTokenSource,
        promise: doOneWorkImpl(cancellationTokenSource.token, uri, ...args).finally(() => {
            cancellationTokenSource.dispose();
            subscription?.dispose();
            task = undefined;
        }),
        subscription,
        uri,
    };
    return task.promise;
}

export function cancel(): Promise<void> {
    if (task === undefined) {
        throw new Error("No running process");
    }
    task.cancellationTokenSource.cancel();
    return task.promise;
}

export function wait(): Promise<void> {
    if (task === undefined) {
        throw new Error("No running process");
    }
    return task.promise;
}

export function cancelWhere(predicate: (uri: vscode.Uri) => boolean): void {
    fileQueue.cancelWhere(predicate);
    if (task !== undefined && predicate(task.uri)) {
        task.cancellationTokenSource.cancel();
    }
}

async function doOneWorkImpl(
    cancellationToken: vscode.CancellationToken,
    uri: vscode.Uri,
    layeredConfig: LayeredConfig,
    treeHasFile: (uri: vscode.Uri) => boolean | Thenable<boolean>,
    setTreeFileMatches: (
        uri: vscode.Uri,
        document: vscode.TextDocument,
        matches: TagMatch[]
    ) => void | Thenable<void>
): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    if (cancellationToken.isCancellationRequested) {
        trace({ id: "doOneWorkImpl:cancellationToken" });
        return;
    }
    if (await treeHasFile(uri)) {
        trace({ id: "doOneWorkImpl:treeHasFile", uriString: uri.toString(true) });
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
        const regex = tag.pattern.regexp;
        for (const match of re2jsMatchAllWithIndices(regex, text)) {
            matches.push({ tag, match });
        }
    }
    const commentToken = effectiveConfig.commentTokens.get(document.languageId);
    if (commentToken !== undefined) {
        const commentSpans: { start: number; end: number }[] = [];
        if (commentToken.lineCommentStart !== undefined) {
            const lineCommentStartRegex = commentToken.lineCommentStart.regexp;
            for (const lineCommentStartMatch of re2jsMatchAllWithIndices(
                lineCommentStartRegex,
                text
            )) {
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
            const blockCommentStartRegex = commentToken.blockComment.start.regexp;
            const blockCommentEndRegex = commentToken.blockComment.end.regexp;
            const startIndices = [
                ...re2jsMatchAllWithIndices(blockCommentStartRegex, text).map(
                    (startMatch) => startMatch.index + startMatch[0].length
                ),
            ];
            const endIndices = [
                ...re2jsMatchAllWithIndices(blockCommentEndRegex, text).map(
                    (endMatch) => endMatch.index
                ),
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
            const regex = tag.pattern.regexp;
            for (const match of re2jsMatchAllWithIndices(regex, text)) {
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
    trace({
        id: "doOneWorkImpl:finish",
        uriString: uri.toString(true),
        matchesLength: matches.length,
    });
    if (matches.length !== 0 && !cancellationToken.isCancellationRequested) {
        await setTreeFileMatches(uri, document, matches);
    }
}
