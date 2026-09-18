/// <reference types="node" />

import esbuild from "esbuild";
import copy from "esbuild-plugin-copy";

const production: boolean = process.argv.includes("--production");
const watch: boolean = process.argv.includes("--watch");

const esbuildProblemMatcherPlugin: esbuild.Plugin = {
    name: "esbuild-problem-matcher",

    setup(build: esbuild.PluginBuild): void {
        build.onStart(() => {
            console.log("[watch] build started");
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location?.file}:${location?.line}:${location?.column}:`);
            });
            console.log("[watch] build finished");
        });
    },
};

async function main(): Promise<void> {
    const [extensionCtx, reactCtx] = await Promise.all([
        esbuild.context({
            entryPoints: ["src/extension.ts"],
            bundle: true,
            format: "cjs",
            minify: production,
            sourcemap: !production,
            sourcesContent: false,
            platform: "node",
            outfile: "dist/extension.cjs",
            external: ["vscode"],
            logLevel: "silent",
            plugins: [
                /* add to the end of plugins array */
                esbuildProblemMatcherPlugin,
                copy({
                    assets: {
                        from: ["./node_modules/@vscode/codicons/dist/*"],
                        to: ["codicons"],
                    },
                }),
            ],
            mainFields: ["module", "main"],
        }),
        esbuild.context({
            entryPoints: ["src/webview/commentTokens.tsx"],
            tsconfig: "src/webview/tsconfig.json",
            bundle: true,
            format: "esm",
            minify: production,
            sourcemap: !production,
            sourcesContent: false,
            platform: "browser",
            outfile: "dist/webview/commentTokens.js",
            logLevel: "silent",
            plugins: [esbuildProblemMatcherPlugin],
        }),
    ]);
    if (watch) {
        await Promise.all([extensionCtx.watch(), reactCtx.watch()]);
    } else {
        try {
            await Promise.all([extensionCtx.rebuild(), reactCtx.rebuild()]);
        } finally {
            await Promise.all([extensionCtx.dispose(), reactCtx.dispose()]);
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
