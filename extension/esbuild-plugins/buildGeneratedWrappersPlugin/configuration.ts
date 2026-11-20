import { pascalCase } from "change-case";
import { PackageConfigSchema } from "../../src/configSchema";
import { DecreaseIndent, IncreaseIndent } from "./indentedStringWriter";
import { toIdentifier } from "./strings";
import { TreeNode } from "./tree";

export async function writeConfigurationAsync(
    packageName: string | undefined,
    directory: string
): Promise<void> {
    let root = TreeNode.fromFlatList(
        Object.entries(PackageConfigSchema.shape),
        ([key]) => key,
        "configuration"
    );
    if (packageName !== undefined) {
        root = root.pruneRootIfSingleBranch(toIdentifier(packageName));
    }
    root.fixBranchLeafCollisions("configuration");
    await root.writeToModulesAsync(
        async (
            {
                parentPath,
                leafKey: configurationKey,
                leaf: [configurationFullKey, schema],
                leafIndex,
                childIndex,
            },
            writer
        ) => {
            const propertyNamePascal = pascalCase(configurationKey);
            if (leafIndex === 0) {
                if (childIndex !== 0) {
                    writer.writeLine();
                }
                writer.writeLine('import * as vscode from "vscode";');
                writer.writeLine(`import z from "zod";`);
                if (parentPath.length !== 1) {
                    writer.writeLines(
                        undefined,
                        `import type { Inspect } from "${"../".repeat(parentPath.length - 1)}index";`
                    );
                }
                writer.writeLines(
                    `import { PackageConfigSchema } from "${"../".repeat(parentPath.length + 1)}src/configSchema";`
                );
                const section = configurationFullKey.slice(
                    0,
                    configurationFullKey.lastIndexOf(".")
                );
                writer.writeLines(undefined, `export const section = "${section}" as const;`);
            }
            const originalKey = configurationFullKey.slice(
                configurationFullKey.lastIndexOf(".") + 1
            );
            writer.writeLines(
                undefined,
                `export const ${configurationKey}Key = "${originalKey}" as const;`,
                undefined,
                `export const ${configurationKey}FullKey = \`\${section}.\${${configurationKey}Key}\` as const;`,
                undefined,
                `export type ${propertyNamePascal} = NonNullable<z.output<typeof PackageConfigSchema.shape[typeof ${configurationKey}FullKey]>>;`,
                undefined,
                `export function get${propertyNamePascal}(scope?: vscode.ConfigurationScope | null): ${propertyNamePascal} {`,
                IncreaseIndent,
                `return vscode.workspace.getConfiguration(section, scope).get<${propertyNamePascal}>(${configurationKey}Key, ${JSON.stringify(schema.parse(undefined))});`,
                DecreaseIndent,
                "}",
                undefined,
                `export function update${propertyNamePascal}(value?: ${propertyNamePascal}, scope?: vscode.ConfigurationScope | null, configurationTarget?: boolean | vscode.ConfigurationTarget | null, overrideInLanguage?: boolean): Thenable<void> {`,
                IncreaseIndent,
                `return vscode.workspace.getConfiguration(section, scope).update(${configurationKey}Key, value, configurationTarget, overrideInLanguage);`,
                DecreaseIndent,
                "}",
                undefined,
                `export function inspect${propertyNamePascal}(scope?: vscode.ConfigurationScope | null): Inspect<${propertyNamePascal}> {`,
                IncreaseIndent,
                `const inspect = vscode.workspace.getConfiguration(section, scope).inspect<${propertyNamePascal}>(${configurationKey}Key);`,
                "if (inspect === undefined) {",
                IncreaseIndent,
                "throw new Error();",
                DecreaseIndent,
                "}",
                "return inspect;",
                DecreaseIndent,
                "}",
                undefined,
                `export function validate${propertyNamePascal}(scope?: vscode.ConfigurationScope | null): z.ZodSafeParseResult<${propertyNamePascal}> {`,
                IncreaseIndent,
                `return PackageConfigSchema.shape[${configurationKey}FullKey].safeParse(get${propertyNamePascal}(scope));`,
                DecreaseIndent,
                "}"
            );
        },
        directory,
        (branchContext, writer) => {
            if (branchContext.parentPath.length === 0) {
                writer.writeLines(...InterfaceInspect);
            }
        }
    );
}

/** A preformatted set of lines to define the result for the `inspect*` functions */
const InterfaceInspect: readonly (
    | string
    | typeof IncreaseIndent
    | typeof DecreaseIndent
    | undefined
)[] = [
    "export interface Inspect<T> {",
    IncreaseIndent,
    "/**",
    " * The fully qualified key of the configuration value",
    " */",
    "key: string;",
    undefined,
    "/**",
    " * The default value which is used when no other value is defined",
    " */",
    "defaultValue?: T;",
    undefined,
    "/**",
    " * The global or installation-wide value.",
    " */",
    "globalValue?: T;",
    undefined,
    "/**",
    " * The workspace-specific value.",
    " */",
    "workspaceValue?: T;",
    undefined,
    "/**",
    " * The workspace-folder-specific value.",
    " */",
    "workspaceFolderValue?: T;",
    undefined,
    "/**",
    " * Language specific default value when this configuration value is created for a {@link vscode.ConfigurationScope language scope}.",
    " */",
    "defaultLanguageValue?: T;",
    undefined,
    "/**",
    " * Language specific global value when this configuration value is created for a {@link vscode.ConfigurationScope language scope}.",
    " */",
    "globalLanguageValue?: T;",
    undefined,
    "/**",
    " * Language specific workspace value when this configuration value is created for a {@link vscode.ConfigurationScope language scope}.",
    " */",
    "workspaceLanguageValue?: T;",
    undefined,
    "/**",
    " * Language specific workspace-folder value when this configuration value is created for a {@link vscode.ConfigurationScope language scope}.",
    " */",
    "workspaceFolderLanguageValue?: T;",
    undefined,
    "/**",
    " * All language identifiers for which this configuration is defined.",
    " */",
    "languageIds?: string[];",
    DecreaseIndent,
    "}",
    undefined,
] as const;
