import * as fsAsync from "node:fs/promises";
import * as path from "node:path";
import { IndentedStringWriter } from "./indentedStringWriter";
import { toIdentifier } from "./strings";

/**
 * Represents a tree nested structure with string key branches and leaves
 *
 * Branches and leaves are allowed to share names
 *
 * @template TLeaf the type of the leaf nodes
 */
export class TreeNode<TLeaf> {
    constructor(
        readonly key: string,
        private readonly branches: Record<string, TreeNode<TLeaf>> = {},
        private readonly leaves: Record<string, TLeaf> = {}
    ) {}

    /**
     * Converts an array to a try by extracting a dotted key from each element
     * @param flatList The array to convert
     * @param extractDottedKey A function to extract a dotted key from an element
     * @param context A string context for error message output if duplicate leaf keys are found
     * @returns A {@link TreeNode} with the elements of `flatList` arranged to match the extracted key paths
     */
    static fromFlatList<TLeaf>(
        flatList: TLeaf[],
        extractDottedKey: (item: TLeaf, index: number) => string,
        context: string
    ): TreeNode<TLeaf> {
        const root = new TreeNode<TLeaf>("");
        for (let i = 0; i < flatList.length; i++) {
            const dottedKey = extractDottedKey(flatList[i], i);
            const dotSplit = dottedKey.split(".").map(toIdentifier);
            const dotSplitLast =
                dotSplit.pop() ??
                (() => {
                    throw new Error("unreachable");
                })();
            const branch = root.getOrCreateBranches(...dotSplit);
            if (branch.hasLeaf(dotSplitLast)) {
                console.warn(`[WARN] duplicate ${context} key ${dottedKey}`);
                continue;
            }
            branch.setLeaf(dotSplitLast, flatList[i]);
        }
        return root;
    }

    /**
     * Check whether a given branch exists
     * @param key The key to check
     * @returns `true` if the branch exists on this node; otherwise `false`
     */
    hasBranch(key: string): boolean {
        return Object.hasOwn(this.branches, key);
    }

    /**
     * Check whether a given leaf exists
     * @param key The key to check
     * @returns `true` if the leaf exists on this node; otherwise `false`
     */
    hasLeaf(key: string): boolean {
        return Object.hasOwn(this.leaves, key);
    }

    /**
     * Get a reference to a child branch, creating it if necessary
     * @param key The branch key to get or create
     * @returns The child branch
     */
    getOrCreateBranch(key: string): TreeNode<TLeaf> {
        if (this.hasBranch(key)) {
            return this.branches[key];
        }
        const newBranch = new TreeNode<TLeaf>(key);
        this.branches[key] = newBranch;
        return newBranch;
    }

    /**
     * Get a reference to a child branch recursively, creating it if necessary
     * @param keys The nested path keys to get or create
     * @returns The child branch
     *
     * @example
     * These two calls produce the same node
     *
     * ```
     * node.getOrCreateBranch("one").getOrCreateBranch("two").getOrCreateBranch("three");
     * node.getOrCreateBranches("one", "two", "three");
     * ```
     */
    getOrCreateBranches(...keys: string[]): TreeNode<TLeaf> {
        let current: TreeNode<TLeaf> = this;
        for (const key of keys) {
            current = current.getOrCreateBranch(key);
        }
        return current;
    }

    /**
     * Get a reference to a child leaf
     * @param key The leaf key to get
     * @returns A {@link TLeaf} or `undefined` if it does not exist
     */
    getLeaf(key: string): TLeaf | undefined {
        return this.leaves[key];
    }

    /**
     * Set a leaf value on this node
     * @param key The leaf key to set
     * @param leaf The value to set
     */
    setLeaf(key: string, leaf: TLeaf): void {
        this.leaves[key] = leaf;
    }

    /**
     * Remove a leaf from this node by key and return it
     * @param key The leaf key to remove
     * @returns The {@link TLeaf} or `undefined` if it did not exist
     */
    takeLeaf(key: string): TLeaf | undefined {
        const leaf = this.leaves[key];
        delete this.leaves[key];
        return leaf;
    }

    /**
     * Remove a branch from this node by key and return it
     * @param key The branch key to remove
     * @returns The {@link TreeNode} or `undefined` if it did not exist
     */
    takeBranch(key: string): TreeNode<TLeaf> | undefined {
        const branch = this.branches[key];
        delete this.branches[key];
        return branch;
    }

    /**
     * Iterate all child branches and leaves depth first
     * @param onStartBranch A function to run when entering a branch
     * @param onLeaf A function to run on each leaf
     * @param onEndBranch A function to run when leaving a branch
     * @param parentPath The chain of parent nodes from the root of iteration
     * @param childIndex The index of this child with the parent node
     * @returns A promise that resolves when iteration is complete
     */
    async visitAsync<TContext = undefined>(
        onStartBranch: (branchContext: BranchContext<TContext>) => void | Promise<void>,
        onLeaf: (leafContext: LeafContext<TLeaf, TContext>) => void | Promise<void>,
        onEndBranch: (branchContext: BranchContext<TContext>) => void | Promise<void>,
        parentPath: BranchContext<TContext>[] = [],
        childIndex: number = 0
    ): Promise<void> {
        const branchContext: BranchContext<TContext> = {
            parentPath: parentPath,
            branchKey: this.key,
            childIndex: childIndex,
        };
        await onStartBranch(branchContext);
        const thisPath = parentPath.concat(branchContext);
        let localChildIndex = 0;
        for (const branchKey of Object.keys(this.branches)) {
            await this.branches[branchKey].visitAsync(
                onStartBranch,
                onLeaf,
                onEndBranch,
                thisPath,
                localChildIndex
            );
            localChildIndex++;
        }
        let leafIndex = 0;
        for (const leafKey of Object.keys(this.leaves)) {
            await onLeaf({
                parentPath: thisPath,
                leafKey: leafKey,
                leafIndex: leafIndex,
                childIndex: localChildIndex,
                leaf: this.leaves[leafKey],
            });
            localChildIndex++;
            leafIndex++;
        }
        await onEndBranch(branchContext);
    }

    /**
     * Check if any child leaves have the same name as a sibling branch and repair them if possible
     *
     * If a leaf `node.getLeaf("key")` and sibling branch `node.getBranch("key")` have the same name,
     * the leaf value is moved to `node.getBranch("key").setLeaf("self", value)`
     *
     * @param context A string context for error message output if collisions keys are found
     * @param parentPath The chain of parent nodes from the root of iteration
     */
    fixBranchLeafCollisions(context: string, parentPath: string[] = []): void {
        for (const key of Object.keys(this.branches)) {
            const childBranch = this.branches[key];
            if (Object.hasOwn(this.leaves, key)) {
                if (Object.hasOwn(childBranch.leaves, "self")) {
                    const fullPath = parentPath.concat(key).join(".");
                    throw new Error(
                        `[ERROR] collision on "${fullPath}" and "${fullPath}.self" ${context} node`
                    );
                }
                const leaf = this.leaves[key];
                delete this.leaves[key];
                childBranch.leaves.self = leaf;
            }
            childBranch.fixBranchLeafCollisions(context, parentPath.concat(key));
        }
    }

    /**
     * Checks if this node has a single branch named `key` and no leaves
     *
     * Does not modify current object
     *
     * @param key The branch key to check for
     * @returns A copy of the single branch `node.getBranch(key)` renamed to an empty string; otherwise `this`
     */
    pruneRootIfSingleBranch(key: string): TreeNode<TLeaf> {
        const keys = Object.keys(this.branches);
        if (
            Object.keys(this.leaves).length === 0 &&
            key !== undefined &&
            keys.length === 1 &&
            keys[0] === key
        ) {
            const branch = this.branches[key];
            return new TreeNode<TLeaf>("", branch.branches, branch.leaves);
        }
        return this;
    }

    /**
     * Iterate all child branches and leaves depth first, with the intent of writing nested module files
     * @param onLeaf A function to run on each leaf
     * @param directory The directory root to generate files to
     * @param onStartBranch A function to run when entering a branch
     * @param onEndBranch A function to run when leaving a branch
     * @returns A promise that resolves when iteration is complete
     */
    async writeToModulesAsync(
        onLeaf: (
            leafContext: LeafContext<TLeaf, IndentedStringWriter>,
            writer: IndentedStringWriter
        ) => void | Promise<void>,
        directory: string,
        onStartBranch?: (
            branchContext: BranchContext<IndentedStringWriter>,
            writer: IndentedStringWriter
        ) => void | Promise<void>,
        onEndBranch?: (
            branchContext: BranchContext<IndentedStringWriter>,
            writer: IndentedStringWriter
        ) => void | Promise<void>
    ): Promise<void> {
        await this.visitAsync<IndentedStringWriter>(
            async (branchContext) => {
                const parentPath = branchContext.parentPath.map((item) => item.branchKey);
                const branchKey = branchContext.branchKey;
                const thisDir = path.join(directory, ...parentPath, branchKey);
                await fsAsync.mkdir(thisDir, { recursive: true });
                branchContext.context = new IndentedStringWriter();
                branchContext.context.writeGeneratedHeaderComment();
                if (branchContext.parentPath.length !== 0) {
                    const parentWriter = branchContext.parentPath[parentPath.length - 1].context;
                    if (parentWriter !== undefined) {
                        if (branchContext.childIndex !== 0) {
                            parentWriter.writeLine();
                        }
                        parentWriter.writeLines(
                            `import * as ${branchKey} from "./${branchKey}/index.js";`,
                            undefined,
                            `export { ${branchKey} };`
                        );
                    }
                }
                if (onStartBranch !== undefined) {
                    await onStartBranch(branchContext, branchContext.context);
                }
            },
            async (leafContext) => {
                const writer = leafContext.parentPath[leafContext.parentPath.length - 1].context;
                if (writer !== undefined) {
                    await onLeaf(leafContext, writer);
                }
            },
            async (branchContext) => {
                const writer = branchContext.context;
                if (writer !== undefined) {
                    if (onEndBranch !== undefined) {
                        await onEndBranch(branchContext, writer);
                    }
                    const parentPath = branchContext.parentPath.map((item) => item.branchKey);
                    const branchKey = branchContext.branchKey;
                    const fullPath = path.join(directory, ...parentPath, branchKey);
                    const indexPath = path.join(fullPath, "./index.ts");
                    await writer.writeFileAsync(indexPath);
                }
            }
        );
    }
}

/** Used for {@link propagateKey} to uniquely identify the key which was provided for the value */
export const PropagatedKey: unique symbol = Symbol();

/**
 * Maps a collection of arrays to a flat array including the outer collection key for each value
 * @template T The type of the values in the inner arrays
 * @param collection The string keyed collection of arrays
 * @returns An array of every value in the nested arrays along with the outer collection key
 * @example
 * ```
 * collection = {
 *   one: [
 *     {a: 0},
 *     {b: 1}
 *   ],
 *   two: [
 *     {c: 2},
 *     {d: 3}
 *   ]
 * }
 * ```
 *
 * becomes
 *
 * ```
 * result = [
 *   {a: 0, [PropagatedKey]: "one"},
 *   {b: 1, [PropagatedKey]: "one"},
 *   {c: 2, [PropagatedKey]: "two"},
 *   {d: 3, [PropagatedKey]: "two"},
 * ]
 * ```
 */
export function propagateKey<T extends {}>(
    collection: Record<string, T[]>
): (T & { [PropagatedKey]: string })[] {
    return Object.keys(collection).flatMap((key) =>
        collection[key].map((value) => Object.assign({ [PropagatedKey]: key }, value))
    );
}

/**
 * Indicates the current branch when iterating via {@link TreeNode.visitAsync}
 * @template TContext The type of the context object attached to this iteration
 */
export interface BranchContext<TContext = undefined> {
    /** The chain of parent nodes from the root of iteration */
    parentPath: BranchContext<TContext>[];

    /** The key of the current branch */
    branchKey: string;

    /** The index of this branch relative to all its siblings */
    childIndex: number;

    /** The context object attached to this iteration */
    context?: TContext;
}

/**
 * Indicates the current leaf when iterating via {@link TreeNode.visitAsync}
 * @template TContext The type of the context object attached to this iteration
 */
export interface LeafContext<TLeaf, TContext = undefined> {
    /** The chain of parent nodes from the root of iteration */
    parentPath: BranchContext<TContext>[];

    /** The key of the current leaf */
    leafKey: string;

    /** The index of this leaf relative to its sibling leaves */
    leafIndex: number;

    /** The index of this leaf relative to all its siblings including branches */
    childIndex: number;

    /** The value of this leaf */
    leaf: TLeaf;
}
