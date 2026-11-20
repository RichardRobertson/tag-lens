import type { Command } from "./index.js";
import { toIdentifier, translate } from "./strings.js";
import { TreeNode } from "./tree.js";

/**
 * Generate nested modules of constants for the given commands
 * @param commands The commands to declare constants for
 * @param packageName The name of the package these were read from - this name is trimmed from the root if it is common across all declared commands
 * @param directory The directory root to generate files to
 * @param translations The values read from `package.nls.json`
 * @returns A promise that resolves when writing is complete
 */
export async function writeCommandsAsync(
    commands: Command[],
    packageName: string | undefined,
    directory: string,
    translations?: Record<string, string>
): Promise<void> {
    let root = TreeNode.fromFlatList(
        commands,
        (command, index) => command.command ?? `command${index}`,
        "command"
    );
    if (packageName !== undefined) {
        root = root.pruneRootIfSingleBranch(toIdentifier(packageName));
    }
    root.fixBranchLeafCollisions("command");
    await root.writeToModulesAsync(
        ({ leafKey: commandKey, leaf: { command, title, category }, childIndex }, writer) => {
            title = translate(title, translations);
            category = translate(category, translations);
            if (childIndex !== 0) {
                writer.writeLine();
            }
            if (title !== undefined && category !== undefined) {
                writer.writeLine(`/** ${title} (${category}) */`);
            } else if (title !== undefined) {
                writer.writeLine(`/** ${title} */`);
            } else if (category !== undefined) {
                writer.writeLine(`/** (${category}) */`);
            }
            writer.writeLine(`export const ${commandKey} = "${command}";`);
        },
        directory
    );
}
