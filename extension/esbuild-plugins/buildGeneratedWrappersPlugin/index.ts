/// <reference types="node" />

import * as fsAsync from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type esbuild from "esbuild";
import z from "zod";
import { PackageConfigSchema } from "../../src/configSchema";
import { writeCommandsAsync } from "./commands";
import { writeConfigurationAsync } from "./configuration";
import { writePackageMetadataAsync } from "./packageMetadata";
import { writeViewsAsync } from "./views";
import { writeViewsContainersAsync } from "./viewsContainers";

const Command = z
    .looseObject({
        command: z.string(),
        title: z.string(),
        category: z.string(),
    })
    .partial();

export type Command = z.output<typeof Command>;

const View = z
    .looseObject({
        id: z.string(),
        name: z.string(),
    })
    .partial();

export type View = z.output<typeof View>;

const ViewsContainer = z
    .looseObject({
        id: z.string(),
        title: z.string(),
    })
    .partial();

export type ViewsContainer = z.output<typeof ViewsContainer>;

const Contributes = z
    .looseObject({
        commands: z.array(Command),
        configuration: z.unknown(),
        views: z.record(z.string(), z.array(View)),
        viewsContainers: z.record(z.string(), z.array(ViewsContainer)),
    })
    .partial();

const PackageJson = z
    .looseObject({
        name: z.string(),
        version: z.string(),
        contributes: Contributes,
    })
    .partial();

function preserveKeyOrder<T>(original: unknown, parsed: T): T {
    if (Array.isArray(original) && Array.isArray(parsed)) {
        return parsed.map((value, i) => preserveKeyOrder(original[i], value)) as T;
    }
    if (
        original !== null &&
        parsed !== null &&
        typeof original === "object" &&
        typeof parsed === "object" &&
        !Array.isArray(original) &&
        !Array.isArray(parsed)
    ) {
        const source = original as Record<string, unknown>;
        const target = parsed as Record<string, unknown>;
        const orderedKeys = [
            ...Object.keys(source).filter((key) => Object.hasOwn(target, key)),
            ...Object.keys(target).filter((key) => !Object.hasOwn(source, key)),
        ];
        return Object.fromEntries(
            orderedKeys.map((key) => [key, preserveKeyOrder(source[key], target[key])])
        ) as T;
    }
    return parsed;
}

export const buildGeneratedWrappersPlugin: esbuild.Plugin = {
    name: "buildGeneratedConfiguration",
    setup(build: esbuild.PluginBuild): void {
        build.onStart(async () => {
            const rawPackageJson = JSON.parse(await fsAsync.readFile("package.json", "utf-8"));
            const translations = JSON.parse(
                await fsAsync.readFile("package.nls.json", "utf-8")
            ) as Record<string, string>;
            const packageJson = preserveKeyOrder(rawPackageJson, PackageJson.parse(rawPackageJson));
            packageJson.contributes ??= {};
            const jsonSchema = PackageConfigSchema.toJSONSchema({ io: "input" });
            delete jsonSchema.$schema;
            delete jsonSchema.type;
            delete jsonSchema.additionalProperties;
            if (!isDeepStrictEqual(packageJson.contributes?.configuration, jsonSchema)) {
                packageJson.contributes.configuration = jsonSchema;
                const newPackageJson = JSON.stringify(packageJson, undefined, 4);
                await fsAsync.writeFile("package.json", newPackageJson);
            }
            await fsAsync.rm("generated", { force: true, recursive: true });
            await writePackageMetadataAsync(packageJson.name, packageJson.version, "generated");
            await writeConfigurationAsync(packageJson.name, "generated/configuration");
            if (packageJson.contributes.commands !== undefined) {
                await writeCommandsAsync(
                    packageJson.contributes.commands,
                    packageJson.name,
                    "generated/commands",
                    translations
                );
            }
            if (packageJson.contributes.views !== undefined) {
                await writeViewsAsync(
                    packageJson.contributes.views,
                    packageJson.name,
                    "generated/views",
                    translations
                );
            }
            if (packageJson.contributes.viewsContainers !== undefined) {
                await writeViewsContainersAsync(
                    packageJson.contributes.viewsContainers,
                    packageJson.name,
                    "generated/viewsContainers",
                    translations
                );
            }
        });
    },
};

export default buildGeneratedWrappersPlugin;
