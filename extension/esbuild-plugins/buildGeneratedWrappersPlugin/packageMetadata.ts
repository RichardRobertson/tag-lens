import * as fsAsync from "node:fs/promises";
import * as path from "node:path";
import { IndentedStringWriter } from "./indentedStringWriter.js";

/**
 * Generate constants for the package name and version if specified
 * @param packageName The name of the package from `package.json`
 * @param packageVersion The version of the package from `package.json`
 * @param directory The directory root to generate files to
 * @returns A promise that resolves when writing is complete
 */
export async function writePackageMetadataAsync(
    packageName: string | undefined,
    packageVersion: string | undefined,
    directory: string
): Promise<void> {
    const writer = new IndentedStringWriter();
    writer.writeGeneratedHeaderComment();

    if (packageName !== undefined) {
        writer.writeLine(`export const packageName = "${packageName}";`);
    }

    if (packageVersion !== undefined) {
        if (packageName !== undefined) {
            writer.writeLine();
        }
        writer.writeLine(`export const packageVersion = "${packageVersion}";`);
    }

    if (packageName !== undefined || packageVersion !== undefined) {
        await fsAsync.mkdir(directory, { recursive: true });
        await writer.writeFileAsync(path.join(directory, "./index.ts"));
    }
}
