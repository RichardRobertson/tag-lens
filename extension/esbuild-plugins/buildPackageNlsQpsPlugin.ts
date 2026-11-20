/// <reference types="node" />

import * as fsAsync from "node:fs/promises";
import type esbuild from "esbuild";
import { pseudoLocalizeString } from "pseudo-localization";
import { pseudoLocalize } from "../src/i18n/qps-ploc/index";

export const buildPackageNlsQpsPlugin: esbuild.Plugin = {
    name: "build-package-nls-qps",
    setup(build: esbuild.PluginBuild): void {
        build.onStart(async () => {
            function pseudoLocalizeStringWithMarkdownLinks(value: string): string {
                const protectedPattern = /(\[[^\]]+\])(\([^)]+\))|(`#[^#]+#`)/g;
                return value
                    .split(protectedPattern)
                    .map((part) => {
                        if (part === undefined) {
                            return "";
                        }
                        if (part.startsWith("[") && part.endsWith("]")) {
                            return `[${pseudoLocalizeString(part.slice(1, -1))}]`;
                        } else if (
                            (part.startsWith("(") && part.endsWith(")")) ||
                            (part.startsWith("`#") && part.endsWith("#`"))
                        ) {
                            return part;
                        }
                        return pseudoLocalizeString(part);
                    })
                    .join("");
            }

            const baseNls: Record<string, string> = JSON.parse(
                (await fsAsync.readFile("package.nls.json")).toString("utf-8")
            );
            const qpsNls = pseudoLocalize(baseNls, pseudoLocalizeStringWithMarkdownLinks);
            await fsAsync.writeFile("package.nls.qps.json", JSON.stringify(qpsNls, undefined, 4));
        });
    },
};

export default buildPackageNlsQpsPlugin;
