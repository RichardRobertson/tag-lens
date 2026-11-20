/// <reference types="node" />

import * as fsAsync from "node:fs/promises";
import type esbuild from "esbuild";
import z from "zod";
import { ConfigFileSchema } from "../src/configFileSchema";

export const buildJsonSchemaPlugin: esbuild.Plugin = {
    name: "build-json-schema",
    setup(build: esbuild.PluginBuild): void {
        build.onStart(() =>
            fsAsync.writeFile(
                "./schema/tag-lens.config.json",
                JSON.stringify(z.toJSONSchema(ConfigFileSchema), undefined, 4)
            )
        );
    },
};

export default buildJsonSchemaPlugin;
