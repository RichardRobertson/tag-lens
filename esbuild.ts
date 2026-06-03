import esbuild from "esbuild";

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
    const ctx = await esbuild.context({
        entryPoints: ["src/extension.ts"],
        bundle: true,
        format: "cjs",
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: "node",
        outfile: "dist/extension.js",
        external: ["vscode"],
        logLevel: "silent",
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
        mainFields: ["module", "main"],
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
