import assert from "node:assert";
import * as posix from "node:path/posix";
import * as configuration from "@generated/configuration";
import * as vscode from "vscode";
import { openTagLinkCommand } from "./extension";
import type { TagMatch } from "./searchProvider";
import { isParent } from "./uri";

export class TreeProvider implements vscode.TreeDataProvider<UriNode> {
    private rootNodes: WorkspaceNode[] = [];
    private untitledNode = WorkspaceNode.newUntitled();
    private externalNode = WorkspaceNode.newExternal();
    private treeInProgress = false;

    private readonly emitOnDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter();

    onDidChangeTreeData: vscode.Event<void> = this.emitOnDidChangeTreeData.event;

    getTreeItem(element: UriNode): UriNode {
        return element;
    }

    getChildren(element?: vscode.TreeItem): UriNode[] {
        if (element === undefined) {
            return [...this.rootNodes];
        } else if (element instanceof FolderNode || element instanceof FileNode) {
            return [...element.children()];
        } else {
            return [];
        }
    }

    async withNewTree(
        fn: (addTagMatch: typeof this.addTagMatch) => void | Promise<void>
    ): Promise<void> {
        if (this.treeInProgress) {
            throw new Error("tree in progress");
        }
        this.treeInProgress = true;
        this.beginNewTree();
        try {
            await fn(this.addTagMatch.bind(this));
        } finally {
            this.endNewTree();
            this.treeInProgress = false;
        }
    }

    private beginNewTree(): void {
        this.rootNodes = [];
        this.untitledNode.clear();
        this.externalNode.clear();
        for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
            this.rootNodes.push(
                new WorkspaceNode(workspaceFolder.uri, workspaceFolder.uri.toString())
            );
        }
    }

    private addTagMatch(tagMatch: TagMatch): void {
        let best: WorkspaceNode | undefined;
        for (const current of this.rootNodes) {
            if (!isParent(current.resourceUri, tagMatch.uri, { inclusive: true })) {
                continue;
            }
            if (
                best === undefined ||
                best.resourceUri.path.length > current.resourceUri.path.length
            ) {
                best = current;
            }
        }
        let file: FileNode | undefined;
        if (best === undefined) {
            if (tagMatch.uri.scheme === "untitled") {
                file = this.untitledNode.getOrCreateFile(tagMatch.uri);
            } else {
                file = this.externalNode.getOrCreateFile(tagMatch.uri);
            }
        } else {
            const relative = posix.relative(best.resourceUri.path, tagMatch.uri.path);
            const segments = relative.split("/");
            let current: FolderNode = best;
            let currentUri = best.resourceUri;
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                currentUri = currentUri.with({ path: posix.join(currentUri.path, segment) });
                if (i === segments.length - 1) {
                    file = current.getOrCreateFile(currentUri);
                } else {
                    current = current.getOrCreateFolder(currentUri);
                }
            }
        }
        assert(file);
        file.addChild(new TagNode(tagMatch.uri, tagMatch.range, tagMatch.label));
    }

    private endNewTree(): void {
        if (!this.externalNode.isEmpty()) {
            this.rootNodes.unshift(this.externalNode);
        }
        if (!this.untitledNode.isEmpty()) {
            this.rootNodes.unshift(this.untitledNode);
        }
        let compact = false;
        const compactSetting = configuration.getCompactFolders();
        switch (compactSetting) {
            case "editor": {
                const editorSetting = vscode.workspace
                    .getConfiguration("explorer")
                    .get<boolean>("compactFolders");
                if (editorSetting) {
                    compact = true;
                }
                break;
            }
            case "always":
                compact = true;
                break;
            case "never":
                compact = false;
                break;
        }
        if (compact) {
            const compactedRootNodes: WorkspaceNode[] = [];
            for (const rootNode of this.rootNodes) {
                compactedRootNodes.push(rootNode.visitCompact());
            }
            this.rootNodes = compactedRootNodes;
        }
        this.emitOnDidChangeTreeData.fire();
    }

    printChildren(): void {
        console.dir(this.rootNodes);
    }
}

abstract class UriNode extends vscode.TreeItem {
    override readonly resourceUri: vscode.Uri;
    override readonly id: string;
    override label: string | undefined;

    constructor(
        resourceUri: vscode.Uri,
        id: string,
        collapsibleState?: vscode.TreeItemCollapsibleState
    ) {
        super(resourceUri, collapsibleState);
        this.resourceUri = resourceUri;
        this.id = id;
        this.label = undefined;
    }

    visitCompact(): this {
        return this;
    }
}

abstract class ContainerNode<T extends UriNode> extends UriNode {
    protected readonly nodes: T[];

    constructor(
        resourceUri: vscode.Uri,
        id: string,
        iconPath?: string | vscode.IconPath,
        label?: string,
        children?: Iterable<T>
    ) {
        super(resourceUri, id, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = iconPath;
        this.label = label;
        if (children !== undefined) {
            this.nodes = Array.from(children);
        } else {
            this.nodes = [];
        }
    }

    children(): Iterable<T> {
        return this.nodes;
    }

    addChild(child: T): void {
        this.nodes.push(child);
    }

    getChildByUri(uri: vscode.Uri): T | undefined {
        for (const child of this.nodes) {
            if (isParent(child.resourceUri, uri, { inclusive: true })) {
                return child;
            }
        }
    }

    isEmpty(): boolean {
        return this.nodes.length === 0;
    }

    clear(): void {
        this.nodes.length = 0;
    }
}

class FolderNode extends ContainerNode<FolderNode | FileNode> {
    constructor(
        resourceUri: vscode.Uri,
        id?: string,
        iconPath?: string | vscode.IconPath,
        label?: string,
        children?: Iterable<FolderNode | FileNode>
    ) {
        super(
            resourceUri,
            id ?? resourceUri.toString(),
            iconPath ?? vscode.ThemeIcon.Folder,
            label,
            children
        );
    }

    labelOrBasename(): string {
        if (this.label !== undefined) {
            return this.label;
        }
        return posix.basename(this.resourceUri.path);
    }

    override visitCompact(): this {
        const visited: (FolderNode | FileNode)[] = [];
        for (const node of this.nodes.values()) {
            visited.push(node.visitCompact());
        }
        if (visited.length === 1 && visited[0] instanceof FolderNode) {
            const descendant = visited[0];
            return new FolderNode(
                descendant.resourceUri,
                undefined,
                undefined,
                posix.join(this.labelOrBasename(), descendant.labelOrBasename()),
                descendant.nodes
            ) as this;
        } else {
            return new FolderNode(
                this.resourceUri,
                undefined,
                undefined,
                this.label,
                visited
            ) as this;
        }
    }

    getOrCreateFolder(uri: vscode.Uri): FolderNode {
        for (const child of this.nodes) {
            if (child.resourceUri.toString(true) === uri.toString(true)) {
                assert(child instanceof FolderNode);
                return child;
            }
        }
        const newFolder = new FolderNode(uri);
        this.addChild(newFolder);
        return newFolder;
    }

    getOrCreateFile(uri: vscode.Uri): FileNode {
        for (const child of this.nodes) {
            if (child.resourceUri.toString(true) === uri.toString(true)) {
                assert(child instanceof FileNode);
                return child;
            }
        }
        const newFile = new FileNode(uri);
        this.addChild(newFile);
        return newFile;
    }
}

class WorkspaceNode extends FolderNode {
    constructor(
        resourceUri: vscode.Uri,
        id: string,
        iconPath?: string | vscode.IconPath,
        label?: string,
        children?: Iterable<FolderNode | FileNode>
    ) {
        super(resourceUri, id, iconPath ?? new vscode.ThemeIcon("root-folder"), label, children);
    }

    static newUntitled(): WorkspaceNode {
        return new WorkspaceNode(
            vscode.Uri.from({ scheme: "untitled" }),
            "untitled",
            new vscode.ThemeIcon("symbol-file"),
            vscode.l10n.t("Untitled")
        );
    }

    static newExternal(): WorkspaceNode {
        return new WorkspaceNode(
            vscode.Uri.from({ scheme: "" }),
            "external",
            new vscode.ThemeIcon("symbol-file"),
            vscode.l10n.t("External")
        );
    }

    override visitCompact(): this {
        const visited: (FolderNode | FileNode)[] = [];
        for (const node of this.nodes.values()) {
            visited.push(node.visitCompact());
        }
        return new WorkspaceNode(
            this.resourceUri,
            this.id,
            this.iconPath,
            this.label,
            visited
        ) as this;
    }
}

class FileNode extends ContainerNode<TagNode> {
    constructor(resourceUri: vscode.Uri) {
        super(resourceUri, resourceUri.toString(), vscode.ThemeIcon.File);
        this.command = {
            command: "vscode.open",
            title: "Open",
            arguments: [resourceUri, { preview: true, preserveFocus: true }],
        };
    }
}

class TagNode extends UriNode {
    constructor(resourceUri: vscode.Uri, range: vscode.Range, label: string) {
        const rangeString = `L${range.start.line}:${range.start.character}-L${range.end.line}:${range.end.character}`;
        resourceUri = resourceUri.with({
            fragment: rangeString,
        });
        super(resourceUri, resourceUri.toString(), vscode.TreeItemCollapsibleState.None);
        this.label = label;
        this.command = {
            command: openTagLinkCommand,
            title: "Open",
            arguments: [resourceUri, range],
        };
        this.iconPath = new vscode.ThemeIcon("tag");
        this.tooltip = rangeString;
    }
}
