import assert from "node:assert";
import * as JSONC from "jsonc-parser";
import { RE2JS } from "re2js";
import * as vscode from "vscode";
import { type ZodError, z } from "zod";
import {
    type Color,
    type Comment,
    type ConfigFile,
    ConfigFileSchema,
    type Pattern as ConfigPattern,
    type Style as ConfigStyle,
    type Tag as ConfigTag,
    type ExtendsTags,
} from "./configFileSchema";

export type LoadConfigReturn =
    | { type: "config"; config: Config }
    | { type: "ioError"; error: Error | string }
    | { type: "jsoncError"; error: JSONC.ParseError[] }
    | { type: "zodError"; error: ZodError<z.output<typeof ConfigFileSchema>> };

export async function loadConfigUri(uri: vscode.Uri): Promise<LoadConfigReturn> {
    try {
        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const textDecoder = new TextDecoder("utf-8");
        const fileString = textDecoder.decode(fileBytes);
        return loadConfigJson(fileString);
    } catch (error) {
        if (error instanceof Error) {
            return {
                type: "ioError",
                error,
            };
        } else {
            return {
                type: "ioError",
                error: `${error}`,
            };
        }
    }
}

export function loadConfigJson(fileString: string): LoadConfigReturn {
    const jsoncErrors: JSONC.ParseError[] = [];
    const fileObject = JSONC.parse(fileString, jsoncErrors);
    if (jsoncErrors.length !== 0) {
        return { type: "jsoncError", error: jsoncErrors };
    }
    return loadConfigObject(fileObject);
}

export function loadConfigObject(fileObject: object): LoadConfigReturn {
    const configObject = ConfigFileSchema.safeParse(fileObject);
    if (configObject.success) {
        return { type: "config", config: normalizeConfig(configObject.data) };
    } else {
        return { type: "zodError", error: configObject.error };
    }
}

function normalizeColor(color: Color | undefined): string | vscode.ThemeColor | undefined {
    if (typeof color === "string") {
        return color;
    } else if (typeof color?.theme === "string") {
        return new vscode.ThemeColor(color.theme);
    }
    return undefined;
}

export interface TagDiagnostic {
    severity: "error" | "warning" | "information" | "hint";
    customMessage?: string;
}

export class Pattern {
    constructor(
        readonly regexp: RE2JS,
        readonly source: string,
        readonly isRegex: boolean
    ) {}

    static fromRegExp(regexp: string, caseInsensitive: boolean, dotAll: boolean): Pattern {
        return new Pattern(
            RE2JS.compile(regexp, Pattern.flags(caseInsensitive, dotAll)),
            regexp,
            true
        );
    }

    static fromLiteral(literal: string, caseInsensitive: boolean): Pattern {
        return new Pattern(
            RE2JS.compile(RE2JS.quote(literal), Pattern.flags(caseInsensitive)),
            literal,
            false
        );
    }

    private static flags(caseInsensitive: boolean, dotAll?: boolean): number {
        let flags = RE2JS.MULTILINE;
        if (caseInsensitive) {
            flags |= RE2JS.CASE_INSENSITIVE;
        }
        if (dotAll) {
            flags |= RE2JS.DOTALL;
        }
        return flags;
    }
}

function normalizePattern(configPattern: ConfigPattern): Pattern {
    if (configPattern.regexp !== undefined) {
        return Pattern.fromRegExp(
            configPattern.regexp,
            configPattern.caseInsensitive ?? false,
            configPattern.dotAll ?? false
        );
    } else {
        return Pattern.fromLiteral(configPattern.literal, configPattern.caseInsensitive ?? false);
    }
}

export interface Tag {
    pattern: Pattern;
    decorationStyle?: string;
    decorateCaptureGroup?: number | { name: string };
    diagnostic?: TagDiagnostic;
}

function normalizeTag(configTag: ConfigTag): Tag {
    return {
        pattern: normalizePattern(configTag.match),
        decorationStyle: configTag.decorationStyle,
        decorateCaptureGroup: configTag.decorateCaptureGroup,
        diagnostic: configTag.diagnostic,
    };
}

export interface Tags {
    extends: string[];
    tags: Tag[];
}

function normalizeTags(configTags: ExtendsTags): Tags {
    let $extends: string[] | undefined;
    let tags: Tag[] | undefined;
    if (Array.isArray(configTags)) {
        tags = configTags.map(normalizeTag);
    } else {
        if ("extends" in configTags) {
            $extends = configTags.extends;
        }
        if ("tags" in configTags) {
            tags = configTags.tags.map(normalizeTag);
        }
    }
    return {
        extends: $extends ?? [],
        tags: tags ?? [],
    };
}

export interface Style {
    backgroundColor?: string | vscode.ThemeColor;
    bold?: boolean;
    border?: string;
    foregroundColor?: string | vscode.ThemeColor;
    italic?: boolean;
    opacity?: number;
    textDecoration?: string;
}

function normalizeStyle(configStyle: ConfigStyle): Style {
    return {
        backgroundColor: normalizeColor(configStyle.backgroundColor),
        bold: configStyle.bold,
        border: configStyle.border,
        foregroundColor: normalizeColor(configStyle.foregroundColor),
        italic: configStyle.italic,
        opacity: configStyle.opacity,
        textDecoration: configStyle.textDecoration,
    };
}

export interface CommentToken {
    lineCommentStart?: Pattern;
    blockComment?: { start: Pattern; end: Pattern };
}

function normalizeCommentToken(configComment: Comment): CommentToken {
    let lineCommentStart: Pattern | undefined;
    let blockComment: { start: Pattern; end: Pattern; continuation?: Pattern } | undefined;
    if ("lineCommentStart" in configComment) {
        lineCommentStart = normalizePattern(configComment.lineCommentStart);
    }
    if ("blockCommentStart" in configComment) {
        blockComment = {
            start: normalizePattern(configComment.blockCommentStart),
            end: normalizePattern(configComment.blockCommentEnd),
        };
    }
    return {
        lineCommentStart,
        blockComment,
    };
}

export interface Config {
    tagGroups: Map<string, Tags>;
    tags: Map<string, Tags>;
    commentTokens: Map<string, CommentToken>;
    commentTags: Tags;
    styles: Map<string, Style>;
}

export function defaultConfig(): Config {
    return {
        tagGroups: new Map(),
        tags: new Map(),
        commentTokens: new Map(),
        commentTags: { extends: [], tags: [] },
        styles: new Map(),
    };
}

function normalizeConfig(configFile: ConfigFile): Config {
    const config = defaultConfig();
    if (configFile.tagGroups !== undefined) {
        config.tagGroups = new Map(
            Object.entries(configFile.tagGroups).map(([key, tags]) => [key, normalizeTags(tags)])
        );
    }
    if (configFile.tags !== undefined) {
        config.tags = new Map(
            Object.entries(configFile.tags).map(([key, tags]) => [key, normalizeTags(tags)])
        );
    }
    if (configFile.commentTokens !== undefined) {
        config.commentTokens = new Map(
            Object.entries(configFile.commentTokens).map(([key, comment]) => [
                key,
                normalizeCommentToken(comment),
            ])
        );
    }
    if (configFile.commentTags !== undefined) {
        config.commentTags = normalizeTags(configFile.commentTags);
    }
    if (configFile.styles !== undefined) {
        config.styles = new Map(
            Object.entries(configFile.styles).map(([key, style]) => [key, normalizeStyle(style)])
        );
    }
    return config;
}

export class LayeredConfig {
    globalConfig: Config = defaultConfig();
    readonly workspaceConfigs = new Map<string, Config>();
    private _effectiveGlobalConfig: HydratedConfig | undefined;
    private readonly effectiveWorkspaceConfigs = new Map<string, HydratedConfig>();

    clear(): void {
        this.globalConfig = defaultConfig();
        this.workspaceConfigs.clear();
        this.invalidateCache();
    }

    invalidateCache(): void {
        this._effectiveGlobalConfig = undefined;
        this.effectiveWorkspaceConfigs.clear();
    }

    get effectiveGlobalConfig(): HydratedConfig {
        if (this._effectiveGlobalConfig === undefined) {
            const config = hydrateConfig(this.globalConfig, "global", providers);
            const namespacedStyles = new Map<string, Style>();
            for (const [key, style] of config.styles) {
                namespacedStyles.set(`global:${key}`, style);
            }
            config.styles = namespacedStyles;
            LayeredConfig.restyleTags("global", config.tagGroups.values());
            LayeredConfig.restyleTags("global", config.tags.values());
            LayeredConfig.restyleTags("global", [config.commentTags]);
            this._effectiveGlobalConfig = config;
        }
        return this._effectiveGlobalConfig;
    }

    getEffectiveWorkspaceConfig(workspaceUri: vscode.Uri | string): HydratedConfig {
        const uriString =
            typeof workspaceUri === "string" ? workspaceUri : workspaceUri.toString(true);
        const cached = this.effectiveWorkspaceConfigs.get(uriString);
        if (cached !== undefined) {
            return cached;
        }
        const rawWorkspaceConfig = this.workspaceConfigs.get(uriString);
        if (rawWorkspaceConfig === undefined) {
            return this.effectiveGlobalConfig;
        }
        const workspaceConfig = hydrateConfig(
            rawWorkspaceConfig,
            "workspace",
            new Map([["global", this.effectiveGlobalConfig], ...providers.entries()])
        );
        const namespacedStyles = new Map<string, Style>();
        for (const [key, style] of workspaceConfig.styles) {
            namespacedStyles.set(`${uriString}:${key}`, style);
        }
        LayeredConfig.restyleTags(uriString, workspaceConfig.tagGroups.values());
        LayeredConfig.restyleTags(uriString, workspaceConfig.tags.values());
        LayeredConfig.restyleTags(uriString, [workspaceConfig.commentTags]);
        this.effectiveWorkspaceConfigs.set(uriString, workspaceConfig);
        return workspaceConfig;
    }

    *getStyles(): Iterable<[string, Style]> {
        yield* this.effectiveGlobalConfig.styles;
        yield* providers.values().flatMap((hydratedConfig) => hydratedConfig.styles);
        for (const workspaceKey of this.workspaceConfigs.keys()) {
            yield* this.getEffectiveWorkspaceConfig(workspaceKey).styles;
        }
    }

    *getTags(): Iterable<Tag> {
        yield* LayeredConfig.getTagsInner(this.effectiveGlobalConfig);
        for (const workspaceKey of this.workspaceConfigs.keys()) {
            yield* LayeredConfig.getTagsInner(this.getEffectiveWorkspaceConfig(workspaceKey));
        }
    }

    private static *getTagsInner(hydratedConfig: HydratedConfig): Iterable<Tag> {
        for (const hydratedTags of hydratedConfig.tags.values()) {
            yield* hydratedTags.map((hydratedTag) => hydratedTag.tag);
        }
        yield* hydratedConfig.commentTags.map((hydratedTag) => hydratedTag.tag);
    }

    private static restyleTags(
        newNamespace: string,
        hydratedTags: Iterable<Iterable<HydratedTag>>
    ): void {
        for (const tags of hydratedTags) {
            for (const tag of tags) {
                if (
                    tag.tag.decorationStyle !== undefined &&
                    !tag.tag.decorationStyle.startsWith("global:")
                ) {
                    tag.tag.decorationStyle = `${newNamespace}:${tag.tag.decorationStyle}`;
                }
            }
        }
    }
}

export interface HydratedTag {
    tag: Tag;
    origin: {
        key?: string | number;
        namespace?: string;
    }[];
}

export interface HydratedConfig {
    tagGroups: Map<string, HydratedTag[]>;
    tags: Map<string, HydratedTag[]>;
    commentTokens: Map<string, CommentToken>;
    commentTags: HydratedTag[];
    styles: Map<string, Style>;
    brokenLinks: {
        tagGroups: Map<string, string[]>;
        tags: Map<string, string[]>;
        commentTags: string[];
    };
}

function hydrateConfig(
    config: Config,
    namespace: string,
    knownConfigs: Map<string, HydratedConfig> = new Map()
): HydratedConfig {
    const knownReferences = new Map<string, HydratedTag[]>();
    for (const [namespaceKey, knownConfig] of knownConfigs.entries()) {
        for (const [key, tags] of knownConfig.tagGroups.entries()) {
            knownReferences.set(`${namespaceKey}:${key}`, tags);
        }
    }
    const brokenTagGroupsLinks = new Map<string, string[]>();
    const brokenTagLinks = new Map<string, string[]>();
    const brokenCommentTagLinks: string[] = [];
    const indegrees = new Map<string, number>();
    const graph = new Map<string, string[]>();
    for (const [key, tags] of config.tagGroups) {
        let indegree = 0;
        for (const dependency of tags.extends) {
            if (knownReferences.has(dependency)) {
                continue;
            }
            if (config.tagGroups.has(dependency)) {
                const dependents = graph.get(dependency) ?? [];
                dependents.push(key);
                graph.set(dependency, dependents);
                indegree++;
            } else {
                const brokenLinks = brokenTagGroupsLinks.get(key) ?? [];
                brokenLinks.push(dependency);
                brokenTagGroupsLinks.set(key, brokenLinks);
            }
        }
        indegrees.set(key, indegree);
    }
    const queue: string[] = [];
    for (const [key, degree] of indegrees.entries()) {
        if (degree === 0) {
            queue.push(key);
        }
    }
    const hydratedTagGroups = new Map<string, HydratedTag[]>();
    function hydrateTags(
        key: string,
        tags: Tags,
        brokenLinks: Map<string, string[]> | string[]
    ): HydratedTag[] {
        const merged: HydratedTag[] = [];
        for (const dep of tags.extends) {
            const depItems = hydratedTagGroups.get(dep) ?? knownReferences.get(dep);
            if (depItems === undefined) {
                if (brokenLinks instanceof Map) {
                    const broken = brokenLinks.get(key) ?? [];
                    broken.push(dep);
                    brokenLinks.set(key, broken);
                } else {
                    brokenLinks.push(dep);
                }
                continue;
            }
            merged.push(
                ...depItems.map((hydratedTag) => ({
                    tag: hydratedTag.tag,
                    origin: hydratedTag.origin.concat({
                        key,
                        namespace,
                    }),
                }))
            );
        }
        merged.push(
            ...tags.tags.map((tag) => ({
                tag,
                origin: [
                    {
                        key,
                        namespace,
                    },
                ],
            }))
        );
        return merged;
    }
    let processed = 0;
    for (let i = 0; i < queue.length; i++) {
        const key = queue[i];
        processed++;
        const tagGroup = config.tagGroups.get(key);
        assert(tagGroup !== undefined);
        const merged = hydrateTags(key, tagGroup, brokenTagGroupsLinks);
        hydratedTagGroups.set(key, merged);
        const children = graph.get(key);
        if (children !== undefined) {
            for (const child of children) {
                let degree = indegrees.get(child);
                assert(degree !== undefined);
                degree--;
                indegrees.set(child, degree);
                if (degree === 0) {
                    queue.push(child);
                }
            }
        }
    }
    assert(processed === config.tagGroups.size, "Cycle detected in tagGroups extends");
    const hydratedTags = new Map<string, HydratedTag[]>();
    for (const [language, tags] of config.tags) {
        hydratedTags.set(language, hydrateTags(language, tags, brokenTagLinks));
    }
    const hydratedCommentTags = hydrateTags("", config.commentTags, brokenCommentTagLinks);
    return {
        tagGroups: hydratedTagGroups,
        tags: hydratedTags,
        commentTokens: config.commentTokens,
        commentTags: hydratedCommentTags,
        styles: config.styles,
        brokenLinks: {
            tagGroups: brokenTagGroupsLinks,
            tags: brokenTagLinks,
            commentTags: brokenCommentTagLinks,
        },
    };
}

const providers: Map<string, HydratedConfig> = new Map();

let __reloadProvidersEmitter: vscode.EventEmitter<void> | undefined;

export function initConfigFile(reloadProvidersEmitter: vscode.EventEmitter<void>): void {
    __reloadProvidersEmitter = reloadProvidersEmitter;
}

export interface ProviderCommonOptions {
    namespace: string;
}

export interface ProviderUri {
    configUri: vscode.Uri;
}

export interface ProviderJson {
    configJson: string;
}

export interface ProviderObject {
    configObject: object;
}

export type ProviderConfig = ProviderUri | ProviderJson | ProviderObject;

export type ProviderRegistrationOptions = ProviderCommonOptions & ProviderConfig;

export async function contributeNamespace(
    callerContext: vscode.ExtensionContext,
    outputChannel: vscode.LogOutputChannel,
    providerOptions: ProviderRegistrationOptions
): Promise<vscode.Disposable> {
    const namespace = providerOptions.namespace;
    let configUri = vscode.Uri.joinPath(callerContext.extensionUri, "__virtual__");
    let configObject: LoadConfigReturn;
    if ("configUri" in providerOptions) {
        configUri = providerOptions.configUri;
        configObject = await loadConfigUri(configUri);
    } else if ("configJson" in providerOptions) {
        configObject = loadConfigJson(providerOptions.configJson);
    } else if ("configObject" in providerOptions) {
        configObject = loadConfigObject(providerOptions.configObject);
    } else {
        throw new Error("unreachable");
    }
    if (
        isValidOrPrintError(
            configObject,
            configUri,
            outputChannel,
            `${namespace} provider (${callerContext.extension.id})`
        )
    ) {
        providers.set(namespace, hydrateConfig(configObject.config, namespace, providers));
        const reloadProvidersEmitter = __reloadProvidersEmitter;
        assert(reloadProvidersEmitter !== undefined);
        reloadProvidersEmitter.fire();
        let disposed = false;
        const disposable = {
            dispose(): void {
                if (!disposed) {
                    providers.delete(namespace);
                    reloadProvidersEmitter.fire();
                    disposed = true;
                }
            },
        };
        callerContext.subscriptions.push(disposable);
        return disposable;
    }
    return {
        dispose(): void {},
    };
}

export function isValidOrPrintError(
    configObject: LoadConfigReturn,
    configUri: vscode.Uri,
    outputChannel: vscode.LogOutputChannel,
    scope: string
): configObject is Extract<LoadConfigReturn, { type: "config" }> {
    switch (configObject.type) {
        case "config":
            return true;
        case "ioError":
            outputChannel.error(
                "Error reading",
                scope,
                "provider file",
                `"${configUri.toString(true)}"`
            );
            outputChannel.error(configObject.error);
            break;
        case "jsoncError":
            outputChannel.error(
                "Error parsing",
                scope,
                "provider configuration file",
                `"${configUri.toString(true)}"`
            );
            for (const { error, offset, length } of configObject.error) {
                outputChannel.error(
                    JSONC.printParseErrorCode(error),
                    "at offset",
                    offset,
                    "; length",
                    length
                );
            }
            break;
        case "zodError":
            outputChannel.error(
                "Schema error in",
                scope,
                "provider configuration file",
                `"${configUri.toString(true)}"`
            );
            outputChannel.error(z.prettifyError(configObject.error));
            break;
    }
    const openConfiguration: vscode.MessageItem = { title: vscode.l10n.t("Open Configuration") };
    const moreDetails: vscode.MessageItem = { title: vscode.l10n.t("More Details") };
    vscode.window
        .showErrorMessage(
            vscode.l10n.t(
                "The {0} configuration file contains errors and could not be loaded.",
                scope
            ),
            openConfiguration,
            moreDetails
        )
        .then((action) => {
            if (action === openConfiguration) {
                vscode.window.showTextDocument(configUri);
            } else if (action === moreDetails) {
                outputChannel.show(true);
            }
        });
    return false;
}
