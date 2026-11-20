import type { View } from "./index.js";
import { toIdentifier, translate } from "./strings.js";
import { PropagatedKey, propagateKey, TreeNode } from "./tree.js";

/**
 * Generate nested modules of constants for the given views
 * @param views The views to declare constants for
 * @param packageName The name of the package these were read from - this name is trimmed from the root if it is common across all declared views
 * @param directory The directory root to generate files to
 * @param translations The values read from `package.nls.json`
 * @returns A promise that resolves when writing is complete
 */
export async function writeViewsAsync(
    views: Record<string, View[]>,
    packageName: string | undefined,
    directory: string,
    translations?: Record<string, string>
): Promise<void> {
    let root = TreeNode.fromFlatList(
        propagateKey(views),
        (view, index) => view.id ?? `view${index}`,
        "view"
    );
    if (packageName !== undefined) {
        root = root.pruneRootIfSingleBranch(toIdentifier(packageName));
    }
    root.fixBranchLeafCollisions("view");
    await root.writeToModulesAsync(
        (
            { leafKey: viewKey, leaf: { id, name, [PropagatedKey]: container }, childIndex },
            writer
        ) => {
            if (childIndex !== 0) {
                writer.writeLine();
            }
            if (name === undefined) {
                writer.writeLine(`/** **Container**: ${container} */`);
            } else {
                writer.writeLines(
                    "/**",
                    ` * **Container**: ${container}`,
                    " *",
                    ` * **Name**: ${translate(name, translations)}`,
                    " */"
                );
            }
            writer.writeLine(`export const ${viewKey} = "${id}";`);
        },
        directory
    );
}
