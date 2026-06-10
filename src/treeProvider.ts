import assert from "node:assert";
import { sep as pathSep } from "node:path";
import * as posix from "node:path/posix";
import * as configuration from "@generated/configuration";
import * as vscode from "vscode";
import type { Tag } from "./configFile";
import { openTagLinkCommand } from "./extension";
import { resolveTemplate, trace } from "./util";

interface WorkspaceNode {
    type: "workspace";
    children: string[];
}

interface FsNode {
    type: "folder" | "file";
    parent: string;
    children: string[];
}

interface RangeNode {
    type: "range";
    parent: string;
    range: vscode.Range;
    label: string;
    tag: Tag;
}

type Node = WorkspaceNode | FsNode | RangeNode;

abstract class NodeWrapper<N extends Node> {
    readonly node: N;

    constructor(
        readonly uriString: string,
        protected readonly nodeMap: Map<string, Node>
    ) {
        const node = nodeMap.get(uriString);
        this.assertNodeType(node);
        this.node = node;
    }

    protected abstract assertNodeType(node: Node | undefined): asserts node is N;

    abstract deleteNode(
        visitor?: (
            node: WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
        ) => void
    ): void;

    abstract fullPath(): Generator<
        WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
    >;

    *compactFullPath(): Generator<
        | WorkspaceNodeWrapper
        | FolderNodeWrapper
        | FolderNodeWrapper[]
        | FileNodeWrapper
        | RangeNodeWrapper
    > {
        let chain: FolderNodeWrapper[] | undefined;
        for (const pathItem of this.fullPath()) {
            if (pathItem instanceof FolderNodeWrapper) {
                if (
                    pathItem.node.children.length === 1 &&
                    pathItem.children().next().value instanceof FolderNodeWrapper
                ) {
                    chain ??= [];
                    chain.push(pathItem);
                } else {
                    if (chain !== undefined) {
                        chain.push(pathItem);
                        yield chain;
                        chain = undefined;
                    }
                }
            } else {
                if (chain !== undefined) {
                    yield chain;
                }
                yield pathItem;
            }
        }
    }

    compactParentKey(): string | string[] | undefined {
        if (this instanceof WorkspaceNodeWrapper) {
            return undefined;
        }
        const compactFullPath = [...this.compactFullPath()];
        const secondLast = compactFullPath[compactFullPath.length - 2];
        if (Array.isArray(secondLast)) {
            return secondLast.map((node) => node.uriString);
        } else {
            return secondLast.uriString;
        }
    }

    compactThisPathItem(): string | string[] {
        if (this instanceof WorkspaceNodeWrapper) {
            return this.uriString;
        }
        const compactFullPath = [...this.compactFullPath()];
        const last = compactFullPath[compactFullPath.length - 1];
        if (Array.isArray(last)) {
            return last.map((node) => node.uriString);
        } else {
            return last.uriString;
        }
    }
}

export class WorkspaceNodeWrapper extends NodeWrapper<WorkspaceNode> {
    *children(): Generator<FolderNodeWrapper | FileNodeWrapper> {
        for (const childKey of this.node.children) {
            const childNode = this.nodeMap.get(childKey);
            assert(childNode?.type === "folder" || childNode?.type === "file");
            switch (childNode.type) {
                case "folder":
                    yield new FolderNodeWrapper(childKey, this.nodeMap);
                    break;
                case "file":
                    yield new FileNodeWrapper(childKey, this.nodeMap);
                    break;
            }
        }
    }

    protected override assertNodeType(node: Node | undefined): asserts node is WorkspaceNode {
        assert(node?.type === "workspace");
    }

    override deleteNode(
        visitor?: (
            node: WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
        ) => void
    ): void {
        visitor?.call(undefined, this);
        for (const child of this.children()) {
            child.deleteNode(visitor);
        }
        this.nodeMap.delete(this.uriString);
    }

    override *fullPath(): Generator<
        WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
    > {
        yield this;
    }
}

export class FolderNodeWrapper extends NodeWrapper<FsNode> {
    *children(): Generator<FolderNodeWrapper | FileNodeWrapper> {
        for (const childKey of this.node.children) {
            const childNode = this.nodeMap.get(childKey);
            assert(childNode?.type === "folder" || childNode?.type === "file");
            switch (childNode.type) {
                case "folder":
                    yield new FolderNodeWrapper(childKey, this.nodeMap);
                    break;
                case "file":
                    yield new FileNodeWrapper(childKey, this.nodeMap);
                    break;
            }
        }
    }

    parent(): WorkspaceNodeWrapper | FolderNodeWrapper {
        const parentNode = this.nodeMap.get(this.node.parent);
        assert(parentNode?.type === "workspace" || parentNode?.type === "folder");
        switch (parentNode.type) {
            case "workspace":
                return new WorkspaceNodeWrapper(this.node.parent, this.nodeMap);
            case "folder":
                return new FolderNodeWrapper(this.node.parent, this.nodeMap);
        }
    }

    prune(): WorkspaceNodeWrapper | FolderNodeWrapper {
        let currentNode: FolderNodeWrapper = this;
        while (currentNode.node.children.length === 0) {
            const parentNode = currentNode.parent();
            currentNode.deleteNode();
            if (parentNode instanceof WorkspaceNodeWrapper) {
                return parentNode;
            }
            currentNode = parentNode;
        }
        return currentNode;
    }

    *getSkinnyChain(): Generator<FolderNodeWrapper> {
        yield this;
        let current: FolderNodeWrapper = this;
        while (current.node.children.length === 1) {
            const firstChild = current.children().next().value;
            if (firstChild instanceof FolderNodeWrapper) {
                current = firstChild;
                yield current;
            } else {
                break;
            }
        }
    }

    protected override assertNodeType(node: Node | undefined): asserts node is FsNode {
        assert(node?.type === "folder");
    }

    override deleteNode(
        visitor?: (
            node: WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
        ) => void
    ): void {
        visitor?.call(undefined, this);
        for (const child of this.children()) {
            child.deleteNode(visitor);
        }
        const parentNode = this.parent().node;
        parentNode.children.splice(parentNode.children.indexOf(this.uriString), 1);
        this.nodeMap.delete(this.uriString);
    }

    override *fullPath(): Generator<
        WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
    > {
        yield* this.parent().fullPath();
        yield this;
    }
}

export class FileNodeWrapper extends NodeWrapper<FsNode> {
    *children(): Generator<RangeNodeWrapper> {
        for (const childKey of this.node.children) {
            const childNode = this.nodeMap.get(childKey);
            assert(childNode?.type === "range");
            yield new RangeNodeWrapper(childKey, this.nodeMap);
        }
    }

    parent(): WorkspaceNodeWrapper | FolderNodeWrapper {
        const parentNode = this.nodeMap.get(this.node.parent);
        assert(parentNode?.type === "workspace" || parentNode?.type === "folder");
        switch (parentNode.type) {
            case "workspace":
                return new WorkspaceNodeWrapper(this.node.parent, this.nodeMap);
            case "folder":
                return new FolderNodeWrapper(this.node.parent, this.nodeMap);
        }
    }

    protected override assertNodeType(node: Node | undefined): asserts node is FsNode {
        assert(node?.type === "file");
    }

    override deleteNode(
        visitor?: (
            node: WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
        ) => void
    ): void {
        visitor?.call(undefined, this);
        for (const child of this.children()) {
            child.deleteNode(visitor);
        }
        const parentNode = this.parent().node;
        parentNode.children.splice(parentNode.children.indexOf(this.uriString), 1);
        this.nodeMap.delete(this.uriString);
    }

    override *fullPath(): Generator<
        WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
    > {
        yield* this.parent().fullPath();
        yield this;
    }
}

export class RangeNodeWrapper extends NodeWrapper<RangeNode> {
    parent(): FileNodeWrapper {
        const parentNode = this.nodeMap.get(this.node.parent);
        assert(parentNode?.type === "file");
        return new FileNodeWrapper(this.node.parent, this.nodeMap);
    }

    range(): vscode.Range {
        return this.node.range;
    }

    label(): string {
        return this.node.label;
    }

    tag(): Tag {
        return this.node.tag;
    }

    protected override assertNodeType(node: Node | undefined): asserts node is RangeNode {
        assert(node?.type === "range");
    }

    override deleteNode(
        visitor?: (
            node: WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
        ) => void
    ): void {
        visitor?.call(undefined, this);
        const parentNode = this.parent().node;
        parentNode.children.splice(parentNode.children.indexOf(this.uriString), 1);
        this.nodeMap.delete(this.uriString);
    }

    override *fullPath(): Generator<
        WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper
    > {
        yield* this.parent().fullPath();
        yield this;
    }
}

export interface TagMatch {
    tag: Tag;
    match: RegExpExecArray;
}

interface RealNode {
    type: "real";
    uriString: string;
}

interface SyntheticNode {
    type: "synthetic";
    uriStrings: string[];
}

type ProjectedNode = RealNode | SyntheticNode;

export class TreeProvider implements vscode.TreeDataProvider<string> {
    private readonly nodeMap = new Map<string, Node>();

    private readonly emitOnDidChangeTreeData = new vscode.EventEmitter<string | undefined>();

    private shouldCompact = true;

    constructor(private readonly diagnostics: vscode.DiagnosticCollection) {
        this.setupWorkspaceFolders();
        this.updateShouldCompact(false);
    }

    onDidChangeTreeData = this.emitOnDidChangeTreeData.event;

    getTreeItem(elementString: string): vscode.TreeItem | Thenable<vscode.TreeItem> {
        // trace({ id: "treeProvider.getChildren", element });
        const element: ProjectedNode = JSON.parse(elementString);
        try {
            const elementUriString =
                element.type === "real"
                    ? element.uriString
                    : element.uriStrings[element.uriStrings.length - 1];
            const node = this.nodeMap.get(elementUriString);
            if (node === undefined) {
                throw new Error(`Unknown node key ${JSON.stringify(element)}`);
            }
            const resourceUri = vscode.Uri.parse(elementUriString);
            const treeItem = new vscode.TreeItem(
                resourceUri,
                node.type === "range"
                    ? vscode.TreeItemCollapsibleState.None
                    : vscode.TreeItemCollapsibleState.Expanded
            );
            treeItem.description = true;
            treeItem.id = elementUriString;
            switch (node.type) {
                case "workspace":
                    if (elementUriString === "") {
                        treeItem.iconPath = new vscode.ThemeIcon("files");
                        treeItem.label = vscode.l10n.t("Loose Files");
                    } else {
                        treeItem.iconPath = new vscode.ThemeIcon("root-folder");
                    }
                    break;
                case "folder":
                    treeItem.iconPath = vscode.ThemeIcon.Folder;
                    if (element.type === "synthetic") {
                        treeItem.label = element.uriStrings
                            .map((uriString) => posix.basename(vscode.Uri.parse(uriString).path))
                            .join(pathSep);
                    }
                    break;
                case "file":
                    treeItem.command = {
                        command: "vscode.open",
                        title: "Open",
                        arguments: [resourceUri, { preview: true, preserveFocus: true }],
                    };
                    treeItem.iconPath = vscode.ThemeIcon.File;
                    break;
                case "range":
                    treeItem.command = {
                        command: openTagLinkCommand,
                        title: "Open",
                        arguments: [resourceUri, node.range],
                    };
                    treeItem.iconPath = new vscode.ThemeIcon("tag");
                    treeItem.label = node.label;
                    break;
            }
            return treeItem;
        } catch (err) {
            console.error(err);
            throw err;
        }
    }

    getChildren(elementString?: string): vscode.ProviderResult<string[]> {
        // trace({ id: "treeProvider.getChildren", element });
        const element: ProjectedNode | undefined =
            elementString === undefined ? undefined : JSON.parse(elementString);
        if (element === undefined) {
            const rootNodes: string[] = [JSON.stringify({ type: "real", uriString: "" })];
            for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
                rootNodes.push(
                    JSON.stringify({ type: "real", uriString: workspaceFolder.uri.toString(true) })
                );
            }
            return rootNodes;
        }
        const elementUriString =
            element.type === "real"
                ? element.uriString
                : element.uriStrings[element.uriStrings.length - 1];
        const node = this.nodeMap.get(elementUriString);
        if (node === undefined || node.type === "range") {
            return undefined;
        } else if (node.type === "file") {
            return node.children.map((uriString) =>
                JSON.stringify({
                    type: "real",
                    uriString,
                })
            );
        }
        if (!this.shouldCompact) {
            return node.children.map((uriString) =>
                JSON.stringify({
                    type: "real",
                    uriString,
                })
            );
        }
        const nodeWrapper = this.getNode(elementUriString);
        assert(
            nodeWrapper instanceof WorkspaceNodeWrapper || nodeWrapper instanceof FolderNodeWrapper
        );
        return [
            ...nodeWrapper.children().map((child) => {
                if (child instanceof FileNodeWrapper) {
                    return JSON.stringify({ type: "real", uriString: child.uriString });
                }
                const skinnyChain = [...child.getSkinnyChain()];
                if (skinnyChain.length === 1) {
                    return JSON.stringify({ type: "real", uriString: child.uriString });
                }
                return JSON.stringify({
                    type: "synthetic",
                    uriStrings: skinnyChain.map((link) => link.uriString),
                });
            }),
        ];
    }

    getParent?(elementString: string): vscode.ProviderResult<string> {
        const element: ProjectedNode = JSON.parse(elementString);
        const elementUriString =
            element.type === "real" ? element.uriString : element.uriStrings[0];
        if (!this.nodeMap.has(elementUriString)) {
            return undefined;
        }
        const node = this.getNode(elementUriString);
        if (node === undefined) {
            return undefined;
        }
        if (!this.shouldCompact) {
            return JSON.stringify({ type: "real", uriString: node.uriString });
        }
        const compactParentKey = node.compactParentKey();
        if (compactParentKey === undefined) {
            return undefined;
        }
        if (typeof compactParentKey === "string") {
            return JSON.stringify({ type: "real", uriString: compactParentKey });
        } else {
            return JSON.stringify({ type: "synthetic", uriStrings: compactParentKey });
        }
    }

    clearFile(uri: vscode.Uri): void {
        this.diagnostics.set(uri, undefined);
        const uriString = uri.toString(true);
        if (!this.nodeMap.has(uriString)) {
            return;
        }
        const fileNode = new FileNodeWrapper(uriString, this.nodeMap);
        let parentNode = fileNode.parent();
        fileNode.deleteNode();
        if (parentNode instanceof FolderNodeWrapper) {
            parentNode = parentNode.prune();
        }
    }

    setFileMatches(uri: vscode.Uri, ranges: RangeNode[]): void;
    setFileMatches(uri: vscode.Uri, document: vscode.TextDocument, matches: TagMatch[]): void;
    setFileMatches(
        uri: vscode.Uri,
        documentOrRanges: vscode.TextDocument | RangeNode[],
        matches?: TagMatch[]
    ): void {
        function addRangeNode(
            nodeMap: Map<string, Node>,
            uri: vscode.Uri,
            range: vscode.Range,
            label: string,
            tag: Tag
        ): void {
            const rangeString = `L${range.start.line}:${range.start.character}-L${range.end.line}:${range.end.character}`;
            const resourceUri = uri.with({
                fragment: rangeString,
            });
            const resourceUriString = resourceUri.toString(true);
            newNode.children.push(resourceUriString);
            nodeMap.set(resourceUriString, {
                type: "range",
                parent: uriString,
                range,
                label,
                tag,
            });
        }
        const uriString = uri.toString(true);
        // trace({ id: "treeProvider.setFileMatches", uriString });
        const [parentUriString, parentNode, notifyRootUriString] = this.ensurePath(uri);
        parentNode.children.push(uriString);
        const newNode: FsNode = {
            type: "file",
            parent: parentUriString,
            children: [],
        };
        const diagnostics: vscode.Diagnostic[] = [];
        if ("uri" in documentOrRanges) {
            const document = documentOrRanges;
            assert(matches);
            for (const { match, tag } of matches) {
                let range: vscode.Range | undefined;
                let label: string | undefined;
                if (tag.decorateCaptureGroup !== undefined) {
                    let indices: [number, number] | undefined;
                    if (typeof tag.decorateCaptureGroup === "number") {
                        indices = match.indices?.[tag.decorateCaptureGroup];
                        label = match[tag.decorateCaptureGroup];
                    } else {
                        indices = match.indices?.groups?.[tag.decorateCaptureGroup.name];
                        label = match.groups?.[tag.decorateCaptureGroup.name];
                    }
                    if (indices !== undefined) {
                        range = new vscode.Range(
                            document.positionAt(indices[0]),
                            document.positionAt(indices[1])
                        );
                    }
                }
                if (range === undefined || label === undefined) {
                    range = new vscode.Range(
                        document.positionAt(match.index),
                        document.positionAt(match.index + match[0].length)
                    );
                    label = match[0];
                }
                if (tag.diagnostic !== undefined) {
                    let severity: vscode.DiagnosticSeverity | undefined;
                    switch (tag.diagnostic.severity) {
                        case "error":
                            severity = vscode.DiagnosticSeverity.Error;
                            break;
                        case "warning":
                            severity = vscode.DiagnosticSeverity.Warning;
                            break;
                        case "information":
                            severity = vscode.DiagnosticSeverity.Information;
                            break;
                        case "hint":
                            severity = vscode.DiagnosticSeverity.Hint;
                            break;
                    }
                    diagnostics.push(
                        new vscode.Diagnostic(
                            range,
                            tag.diagnostic.customMessage === undefined
                                ? label
                                : resolveTemplate(tag.diagnostic.customMessage, match),
                            severity
                        )
                    );
                }
                addRangeNode(this.nodeMap, uri, range, label, tag);
            }
        } else {
            const ranges = documentOrRanges;
            for (const { range, label, tag } of ranges) {
                addRangeNode(this.nodeMap, uri, range, label, tag);
            }
        }
        this.diagnostics.set(uri, diagnostics);
        this.nodeMap.set(uriString, newNode);
        const notifyRootNode = this.getNode(notifyRootUriString);
        assert(notifyRootNode);
        const notifyRootPathItem = notifyRootNode.compactThisPathItem();
        if (typeof notifyRootPathItem === "string") {
            this.fireOnDidChangeTreeData({
                type: "real",
                uriString: notifyRootUriString,
            });
        } else {
            this.fireOnDidChangeTreeData({
                type: "synthetic",
                uriStrings: notifyRootPathItem,
            });
        }
    }

    onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent): void {
        for (const removed of e.removed) {
            const workspaceNode = new WorkspaceNodeWrapper(
                removed.uri.toString(true),
                this.nodeMap
            );
            workspaceNode.deleteNode();
        }
        for (const added of e.added) {
            this.nodeMap.set(added.uri.toString(true), { type: "workspace", children: [] });
        }
        this.fireOnDidChangeTreeData(undefined);
    }

    private ensurePath(uri: vscode.Uri): [string, WorkspaceNode | FsNode, string] {
        {
            const parentUri = uri.with({ path: posix.dirname(uri.path) });
            const parentUriString = parentUri.toString(true);
            const parentNode = this.nodeMap.get(parentUriString);
            if (parentNode !== undefined) {
                assert(parentNode.type === "workspace" || parentNode.type === "folder");
                return [parentUriString, parentNode, parentUriString];
            }
        }
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder === undefined) {
            const looseFilesNode = this.nodeMap.get("");
            assert(looseFilesNode?.type === "workspace");
            return ["", looseFilesNode, ""];
        }
        const workspaceUriString = workspaceFolder.uri.toString(true);
        const workspaceNode = this.nodeMap.get(workspaceUriString);
        assert(workspaceNode?.type === "workspace");
        const relative = posix.relative(workspaceFolder.uri.path, uri.path);
        const relativeSteps = relative.split("/");
        let currentUri = workspaceFolder.uri;
        let currentUriString = currentUri.toString(true);
        let currentNode: WorkspaceNode | FsNode = workspaceNode;
        let notifyRootUriString: string | undefined;
        for (let i = 0; i < relativeSteps.length - 1; i++) {
            const previousUriString = currentUriString;
            const previousNode = currentNode as WorkspaceNode | FsNode;
            currentUri = vscode.Uri.joinPath(currentUri, relativeSteps[i]);
            currentUriString = currentUri.toString(true);
            const nextNode = this.nodeMap.get(currentUriString);
            if (nextNode === undefined) {
                notifyRootUriString ??= previousUriString;
                currentNode = {
                    type: "folder",
                    parent: previousUriString,
                    children: [],
                };
                this.nodeMap.set(currentUriString, currentNode);
                previousNode.children.push(currentUriString);
            } else if (nextNode.type !== "workspace" && nextNode.type !== "folder") {
                throw new Error("Invalid tree nesting");
            } else {
                currentNode = nextNode;
            }
        }
        return [currentUriString, currentNode, notifyRootUriString ?? currentUriString];
    }

    getNode(
        uri: vscode.Uri
    ): WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper | undefined;
    getNode(
        uriString: string
    ): WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper | undefined;
    getNode(
        uriOrString: vscode.Uri | string
    ): WorkspaceNodeWrapper | FolderNodeWrapper | FileNodeWrapper | RangeNodeWrapper | undefined {
        const uriString =
            typeof uriOrString === "string" ? uriOrString : uriOrString.toString(true);
        const node = this.nodeMap.get(uriString);
        switch (node?.type) {
            case "workspace":
                return new WorkspaceNodeWrapper(uriString, this.nodeMap);
            case "folder":
                return new FolderNodeWrapper(uriString, this.nodeMap);
            case "file":
                return new FileNodeWrapper(uriString, this.nodeMap);
            case "range":
                return new RangeNodeWrapper(uriString, this.nodeMap);
            case undefined:
                return undefined;
        }
    }

    hasNode(uri: vscode.Uri): boolean;
    hasNode(uriString: string): boolean;
    hasNode(uriOrString: vscode.Uri | string): boolean {
        const uriString =
            typeof uriOrString === "string" ? uriOrString : uriOrString.toString(true);
        return this.nodeMap.has(uriString);
    }

    clearAll(): void {
        this.nodeMap.clear();
        this.diagnostics.clear();
        this.setupWorkspaceFolders();
        this.fireOnDidChangeTreeData(undefined);
    }

    private setupWorkspaceFolders(): void {
        this.nodeMap.set("", { type: "workspace", children: [] });
        for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
            this.nodeMap.set(workspaceFolder.uri.toString(true), {
                type: "workspace",
                children: [],
            });
        }
    }

    updateShouldCompact(notify: boolean = true): void {
        const previousValue = this.shouldCompact;
        const compactSetting = configuration.getCompactFolders();
        let shouldCompact = previousValue;
        switch (compactSetting) {
            case "editor": {
                const editorSetting = vscode.workspace
                    .getConfiguration("explorer")
                    .get<boolean>("compactFolders", true);
                shouldCompact = editorSetting;
                break;
            }
            case "always":
                shouldCompact = true;
                break;
            case "never":
                shouldCompact = false;
                break;
        }
        this.shouldCompact = shouldCompact;
        if (shouldCompact !== previousValue && notify) {
            this.fireOnDidChangeTreeData(undefined);
        }
    }

    renameFile(from: vscode.Uri, to: vscode.Uri): void {
        const fileNode = this.getNode(from);
        if (fileNode === undefined) {
            return;
        }
        assert(fileNode instanceof FileNodeWrapper);
        assert(!this.nodeMap.has(to.toString(true)));
        const rangeNodes = [
            ...fileNode.children().map<RangeNode>((rangeNodeWrapper) => rangeNodeWrapper.node),
        ];
        fileNode.deleteNode();
        const fromDiagnostics = this.diagnostics.get(from);
        this.diagnostics.set(to, fromDiagnostics);
        this.diagnostics.set(from, undefined);
        this.setFileMatches(to, rangeNodes);
    }

    discardLoose(): void {
        const looseFilesNode = this.getNode("");
        assert(looseFilesNode instanceof WorkspaceNodeWrapper);
        const children = [...looseFilesNode.children()];
        for (const child of children) {
            child.deleteNode((node) => {
                if (node instanceof FileNodeWrapper) {
                    const nodeUri = vscode.Uri.parse(node.uriString);
                    this.diagnostics.set(nodeUri, undefined);
                }
            });
        }
        this.fireOnDidChangeTreeData({ type: "real", uriString: "" });
    }

    discardWorkspace(workspaceFolder: vscode.WorkspaceFolder): void {
        const workspaceNode = this.getNode(workspaceFolder.uri);
        assert(workspaceNode instanceof WorkspaceNodeWrapper);
        const children = [...workspaceNode.children()];
        for (const child of children) {
            child.deleteNode((node) => {
                if (node instanceof FileNodeWrapper) {
                    const nodeUri = vscode.Uri.parse(node.uriString);
                    this.diagnostics.set(nodeUri, undefined);
                }
            });
        }
        this.fireOnDidChangeTreeData({ type: "real", uriString: workspaceNode.uriString });
    }

    fireOnDidChangeTreeData(element?: ProjectedNode): void {
        trace({
            id: "treeProvider.onDidChangeTreeData",
            element,
            stack: new Error().stack,
        });
        this.emitOnDidChangeTreeData.fire(
            element === undefined ? undefined : JSON.stringify(element)
        );
    }
}
