import * as configuration from "@generated/configuration";
import * as vscode from "vscode";
import { FindFilesProvider, searchTextDocument } from "./fallback";
import { RipgrepProvider } from "./ripgrep";

export interface TagMatch {
    uri: vscode.Uri;
    range: vscode.Range;
    match: RegExpExecArray;
    tagIndex: number;
}

export interface SearchQuery {
    tags: configuration.Tags;
    maxResults?: number;
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
factory.register(new RipgrepProvider());

async function* searchWorkspace(
    query: SearchQuery,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    const unsavedUris = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
        if (
            !unsavedUris.has(document.uri.toString(true)) &&
            document.isDirty &&
            vscode.workspace.getWorkspaceFolder(document.uri) !== undefined
        ) {
            unsavedUris.add(document.uri.toString(true));
            for await (const tagMatch of searchTextDocument(query, document.uri, document, token)) {
                yield tagMatch;
            }
        }
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        const provider = factory.getProvider(folder);
        for await (const tagMatch of provider.search(folder, query, token)) {
            if (!unsavedUris.has(tagMatch.uri.toString(true))) {
                yield tagMatch;
            }
        }
    }
}

async function* searchUntitledEditors(
    query: SearchQuery,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    for (const document of vscode.workspace.textDocuments) {
        if (document.isUntitled) {
            for await (const tagMatch of searchTextDocument(query, document.uri, document, token)) {
                yield tagMatch;
            }
        }
    }
}

async function* searchExternalEditors(
    query: SearchQuery,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    for (const document of vscode.workspace.textDocuments) {
        if (
            !document.isUntitled &&
            vscode.workspace.getWorkspaceFolder(document.uri) === undefined
        ) {
            for await (const tagMatch of searchTextDocument(query, document.uri, document, token)) {
                yield tagMatch;
            }
        }
    }
}

export async function* search(
    query: SearchQuery,
    token: vscode.CancellationToken
): AsyncIterable<TagMatch> {
    if (!token.isCancellationRequested && configuration.search.getUntitled()) {
        yield* searchUntitledEditors(query, token);
    }
    if (!token.isCancellationRequested && configuration.search.getExternal()) {
        yield* searchExternalEditors(query, token);
    }
    if (!token.isCancellationRequested && configuration.search.getWorkspace()) {
        yield* searchWorkspace(query, token);
    }
}

export function makeMatch(match: string, index: number, input: string): RegExpExecArray {
    const arr = [match] as RegExpExecArray;
    arr.index = index;
    arr.input = input;
    return arr;
}
