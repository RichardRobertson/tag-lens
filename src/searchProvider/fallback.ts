import * as vscode from "vscode";
import { makeMatch, type SearchProvider, type SearchQuery, type TagMatch } from ".";

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
        for (let tagIndex = 0; tagIndex < query.tags.length; tagIndex++) {
            const tag = query.tags[tagIndex];
            if (tag.pattern === undefined) {
                continue;
            }
            if (tag.isRegex) {
                if (tag.isRegexMultiLine) {
                    throw new Error("isRegexMultiLine not implemented");
                }
                const regex = new RegExp(tag.pattern, "g");
                for (const match of text.matchAll(regex)) {
                    yield {
                        uri: file,
                        range: new vscode.Range(
                            line,
                            match.index,
                            line,
                            match.index + match[0].length
                        ),
                        match,
                        tagIndex,
                    };
                }
            } else {
                const length = tag.pattern.length;
                let start = text.indexOf(tag.pattern);
                while (start !== -1) {
                    yield {
                        uri: file,
                        range: new vscode.Range(line, start, line, start + length),
                        match: makeMatch(tag.pattern, start, text),
                        tagIndex,
                    };
                    start = text.indexOf(tag.pattern, start + 1);
                }
            }
        }
    }
}
