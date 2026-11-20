import type { ViewsContainer } from "./index.js";
import { toIdentifier, translate } from "./strings.js";
import { PropagatedKey, propagateKey, TreeNode } from "./tree.js";

/**
 * Generate nested modules of constants for the given view containers
 * @param viewsContainers The view containers to declare constants for
 * @param packageName The name of the package these were read from - this name is trimmed from the root if it is common across all declared view containers
 * @param directory The directory root to generate files to
 * @param translations The values read from `package.nls.json`
 * @returns A promise that resolves when writing is complete
 */
export async function writeViewsContainersAsync(
    viewsContainers: Record<string, ViewsContainer[]>,
    packageName: string | undefined,
    directory: string,
    translations?: Record<string, string>
): Promise<void> {
    let root = TreeNode.fromFlatList(
        propagateKey(viewsContainers),
        (view, index) => view.id ?? `view${index}`,
        "viewsContainer"
    );
    if (packageName !== undefined) {
        root = root.pruneRootIfSingleBranch(toIdentifier(packageName));
    }
    root.fixBranchLeafCollisions("view");
    await root.writeToModulesAsync(
        (
            { leafKey: viewKey, leaf: { id, title, [PropagatedKey]: container }, childIndex },
            writer
        ) => {
            if (childIndex !== 0) {
                writer.writeLine();
            }
            if (title === undefined) {
                writer.writeLine(`/** **Container**: ${container} */`);
            } else {
                writer.writeLines(
                    "/**",
                    ` * **Container**: ${container}`,
                    " *",
                    ` * **Title**: ${translate(title, translations)}`,
                    " */"
                );
            }
            writer.writeLine(`export const ${viewKey} = "${id}";`);
        },
        directory
    );
}
