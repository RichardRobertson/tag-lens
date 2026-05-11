import assert from "node:assert";
import * as JSONC from "jsonc-parser";
import * as vscode from "vscode";
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
import { escapeRegExp } from "./util";

export async function loadConfig(uri: vscode.Uri): Promise<Config> {
    const fileBytes = await vscode.workspace.fs.readFile(uri);
    const textDecoder = new TextDecoder("utf-8");
    const fileString = textDecoder.decode(fileBytes);
    const fileObject = JSONC.parse(fileString);
    return normalizeConfig(ConfigFileSchema.parse(fileObject));
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
    constructor(readonly regexp: RegExp) {}

    static fromRegExp(regexp: string, caseInsensitive: boolean, dotAll: boolean): Pattern {
        return new Pattern(new RegExp(regexp, Pattern.flags(caseInsensitive, dotAll)));
    }

    static fromLiteral(literal: string, caseInsensitive: boolean): Pattern {
        return new Pattern(new RegExp(escapeRegExp(literal), Pattern.flags(caseInsensitive)));
    }

    private static flags(caseInsensitive: boolean, dotAll?: boolean): string {
        let flags = "";
        if (caseInsensitive) {
            flags = "i";
        }
        if (dotAll) {
            flags += "s";
        }
        return flags;
    }

    get caseInsensitive(): boolean {
        return this.regexp.ignoreCase;
    }

    get dotAll(): boolean {
        return this.regexp.dotAll;
    }

    get source(): string {
        return this.regexp.source;
    }

    exec(text: string): RegExpExecArray | null {
        return this.regexp.exec(text);
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
    blockComment?: { start: Pattern; end: Pattern; continuation?: Pattern };
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
            continuation:
                configComment.continuation !== undefined
                    ? normalizePattern(configComment.continuation)
                    : undefined,
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
        this._effectiveGlobalConfig = undefined;
        this.effectiveWorkspaceConfigs.clear();
    }

    get effectiveGlobalConfig(): HydratedConfig {
        if (this._effectiveGlobalConfig === undefined) {
            const config = hydrateConfig(this.globalConfig, "global");
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
        const workspaceConfig = hydrateConfig(
            this.workspaceConfigs.get(uriString) ?? defaultConfig(),
            "workspace",
            new Map([["global", this.effectiveGlobalConfig]])
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
        for (const workspaceKey of this.workspaceConfigs.keys()) {
            yield* this.getEffectiveWorkspaceConfig(workspaceKey).styles;
        }
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
        scope?: string;
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
    scope: string,
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
                        scope,
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
                        scope,
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
