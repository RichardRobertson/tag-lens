import * as vscode from "vscode";
import { FindFilesProvider, searchTextDocument } from "./fallback";

export interface TagMatch {
    uri: vscode.Uri;
    range: vscode.Range;
}

export interface SearchQuery {
    patterns: Pattern[];
    maxResults?: number;
}

export interface Pattern {
    value: string;
    isRegex: boolean;
    isMultiLineRegex: boolean;
}

export interface SearchProvider {
    supports(uri: vscode.Uri): boolean;

    search(
        folder: vscode.WorkspaceFolder,
        query: SearchQuery,
        token: vscode.CancellationToken
    ): AsyncIterable<TagMatch>;
}

class SearchProviderFactory {
    private readonly providers: SearchProvider[] = [];
    readonly fallback: SearchProvider = new FindFilesProvider();

    register(provider: SearchProvider): void {
        this.providers.push(provider);
    }

    getProvider(folder: vscode.WorkspaceFolder): SearchProvider {
        const uri = folder.uri;
        return this.providers.find((p) => p.supports(uri)) ?? this.fallback;
    }
}

const factory: SearchProviderFactory = new SearchProviderFactory();

export async function* searchWorkspace(
    query: SearchQuery,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        const provider = factory.getProvider(folder);
        for await (const tagMatch of provider.search(folder, query, token)) {
            yield tagMatch;
        }
    }
}

export async function* searchUnsavedEditors(
    query: SearchQuery,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    for (const document of vscode.workspace.textDocuments) {
        if (document.isUntitled || document.isDirty) {
            for await (const tagMatch of searchTextDocument(query, document.uri, document, token)) {
                yield tagMatch;
            }
        }
    }
}

export async function* searchWorkspaceAndUnsavedEditors(
    query: SearchQuery,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    const seenUris = new Set<string>();
    for await (const tagMatch of searchUnsavedEditors(query, token)) {
        seenUris.add(tagMatch.uri.toString());
        yield tagMatch;
    }
    for await (const tagMatch of searchWorkspace(query, token)) {
        if (!seenUris.has(tagMatch.uri.toString())) {
            yield tagMatch;
        }
    }
}
