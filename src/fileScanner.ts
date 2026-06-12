import PQueue from "p-queue";
import * as vscode from "vscode";
import { type HydratedConfig, LayeredConfig } from "./configFile";
import type { TagMatch } from "./treeProvider";
import { concatIterables, re2jsMatchAllWithIndices } from "./util";

const fileQueue2: PQueue = new PQueue({ concurrency: 10 });

let globalAbortController: AbortController = new AbortController();

function createLinkedAbortController(signal: AbortSignal): AbortController {
    const newController = new AbortController();
    signal.addEventListener("abort", () => {
        newController.abort();
    });
    return newController;
}

let layeredConfig: LayeredConfig = new LayeredConfig();

const uriAbortMap: Map<string, AbortController> = new Map();

let treeHasFile: (uri: vscode.Uri) => boolean | Thenable<boolean> = () => false;
let setTreeFileMatches: (
    uri: vscode.Uri,
    document: vscode.TextDocument,
    matches: TagMatch[]
) => void | Thenable<void> = () => {};

export function initFileScanner(
    treeHasFileFn: (uri: vscode.Uri) => boolean | Thenable<boolean>,
    setTreeFileMatchesFn: (
        uri: vscode.Uri,
        document: vscode.TextDocument,
        matches: TagMatch[]
    ) => void | Thenable<void>
): void {
    treeHasFile = treeHasFileFn;
    setTreeFileMatches = setTreeFileMatchesFn;
}

export function fileScannerUpdateConfig(newConfig: LayeredConfig): void {
    layeredConfig = newConfig;
    clearQueue();
}

export function clearQueue(): void {
    globalAbortController.abort("clearQueue");
    globalAbortController = new AbortController();
    uriAbortMap.clear();
    fileQueue2.clear();
}

export function enqueueFile(uri: vscode.Uri, priority: boolean = false): void {
    const uriString = uri.toString(true);
    if (fileQueue2.sizeBy({ id: uriString }) !== 0) {
        if (priority) {
            fileQueue2.setPriority(uriString, 1);
        }
        return;
    }
    if (fileQueue2.runningTasks.some((value) => value.id === uriString)) {
        return;
    }
    const workspaceUriString = vscode.workspace.getWorkspaceFolder(uri)?.uri.toString(true) ?? "";
    let workspaceAbortController = uriAbortMap.get(workspaceUriString);
    if (workspaceAbortController === undefined) {
        workspaceAbortController = createLinkedAbortController(globalAbortController.signal);
        uriAbortMap.set(workspaceUriString, workspaceAbortController);
    }
    const fileAbortController = createLinkedAbortController(workspaceAbortController.signal);
    uriAbortMap.set(uriString, fileAbortController);
    fileQueue2.add(
        () =>
            processFile(fileAbortController.signal, uri, layeredConfig).finally(() => {
                uriAbortMap.delete(uriString);
            }),
        {
            id: uriString,
            priority: priority ? 1 : 0,
            signal: fileAbortController.signal,
        }
    );
}

export function cancelUri(uriString: string | undefined): void {
    if (uriString === undefined) {
        uriAbortMap.get("")?.abort("cancelWhere(undefined)");
    } else {
        uriAbortMap.get(uriString)?.abort(`cancelWhere(${uriString})`);
    }
}

async function processFile(
    abortSignal: AbortSignal,
    uri: vscode.Uri,
    layeredConfig: LayeredConfig
): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    if (abortSignal.aborted || (await treeHasFile(uri))) {
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
    if (matches.length !== 0 && !abortSignal.aborted) {
        await setTreeFileMatches(uri, document, matches);
    }
}
