import * as vscode from "vscode";
import type { SearchProvider, SearchQuery, TagMatch } from ".";

export class FindFilesProvider implements SearchProvider {
    supports(_uri: vscode.Uri): boolean {
        return true;
    }

    async *search(
        folder: vscode.WorkspaceFolder,
        query: SearchQuery,
        token: vscode.CancellationToken
    ): AsyncIterable<TagMatch> {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "**/*"),
            undefined,
            query.maxResults,
            token
        );
        for (const file of files) {
            if (token.isCancellationRequested) {
                return;
            }
            let doc: vscode.TextDocument | undefined;
            try {
                doc = await vscode.workspace.openTextDocument(file);
            } catch (_) {
                continue;
            }
            for await (const tagMatch of searchTextDocument(query, file, doc, token)) {
                yield tagMatch;
            }
        }
    }
}

export async function* searchTextDocument(
    query: SearchQuery,
    file: vscode.Uri,
    doc: vscode.TextDocument,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    for (let line = 0; line < doc.lineCount; line++) {
        if (token.isCancellationRequested) {
            return;
        }
        const text = doc.lineAt(line).text;
        for (const pattern of query.patterns) {
            if (pattern.isRegex) {
                if (pattern.isMultiLineRegex) {
                    throw new Error("isMultiLineRegex not implemented");
                }
                const regex = new RegExp(pattern.value, "dg");
                for (const match of text.matchAll(regex)) {
                    if (match.indices === undefined) {
                        yield {
                            uri: file,
                            range: new vscode.Range(line, 0, line, text.length),
                        };
                    } else {
                        yield {
                            uri: file,
                            range: new vscode.Range(
                                line,
                                match.indices[0][0],
                                line,
                                match.indices[0][1]
                            ),
                        };
                    }
                }
            } else {
                const length = pattern.value.length;
                let start = text.indexOf(pattern.value);
                while (start !== -1) {
                    yield {
                        uri: file,
                        range: new vscode.Range(line, start, line, start + length),
                    };
                    start = text.indexOf(pattern.value, start + 1);
                }
            }
        }
    }
}
