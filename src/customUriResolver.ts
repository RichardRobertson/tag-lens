import assert from "node:assert";
import type { UUID } from "node:crypto";
import * as posix from "node:path/posix";
import { RE2JS } from "re2js";
import * as vscode from "vscode";
import z from "zod";

const zUUID = z.uuid({ version: "v4" }).transform((arg) => arg as UUID);

const uriMap: Map<UUID, Resolvable> = new Map();

export class UserContribution {
    static readonly schema = z.object({
        type: z.literal("user"),
    });

    readonly type = "user";

    constructor({ type }: z.output<typeof UserContribution.schema>) {
        assert(type === "user");
    }

    toJSON(): z.input<typeof UserContribution.schema> {
        return { type: "user" };
    }

    static parse(data: unknown): UserContribution {
        const validated = UserContribution.schema.parse(data);
        return new UserContribution(validated);
    }
}

export class WorkspaceContribution {
    static readonly schema = z.object({
        type: z.literal("workspace"),
        workspace: z.url().transform((uri) => vscode.Uri.parse(uri, true)),
    });

    readonly type = "workspace";
    readonly workspace: vscode.Uri;

    constructor({ type, workspace }: z.output<typeof WorkspaceContribution.schema>) {
        assert(type === "workspace");
        this.workspace = workspace;
    }

    toJSON(): z.input<typeof WorkspaceContribution.schema> {
        return {
            type: "workspace",
            workspace: this.workspace.toString(true),
        };
    }

    static parse(data: unknown): WorkspaceContribution {
        const validated = WorkspaceContribution.schema.parse(data);
        return new WorkspaceContribution(validated);
    }
}

export class ExtensionContribution {
    static readonly schema = z.object({
        type: z.literal("extension"),
        id: z.string(),
    });

    readonly type = "extension";
    readonly id: string;

    constructor({ type, id }: z.output<typeof ExtensionContribution.schema>) {
        assert(type === "extension");
        this.id = id;
    }

    toJSON(): z.input<typeof ExtensionContribution.schema> {
        return {
            type: "extension",
            id: this.id,
        };
    }

    static parse(data: unknown): ExtensionContribution {
        const validated = ExtensionContribution.schema.parse(data);
        return new ExtensionContribution(validated);
    }
}

export type ContributionSource = UserContribution | WorkspaceContribution | ExtensionContribution;

abstract class ResolvableBase {
    static readonly scheme = "taglens";

    static readonly contributionSourceSchema = z.discriminatedUnion("type", [
        UserContribution.schema.transform((data) => new UserContribution(data)),
        WorkspaceContribution.schema.transform((data) => new WorkspaceContribution(data)),
        ExtensionContribution.schema.transform((data) => new ExtensionContribution(data)),
    ]);

    static readonly schema = z.object({
        id: zUUID,
        contributionSource: ResolvableBase.contributionSourceSchema,
        label: z.string().optional(),
    });

    readonly id: UUID;
    readonly contributionSource: ContributionSource;
    readonly label?: string;

    constructor({ id, contributionSource, label }: z.output<typeof ResolvableBase.schema>) {
        this.id = id;
        this.contributionSource = contributionSource;
        this.label = label;
    }

    get uri(): vscode.Uri {
        let authority: string;
        let path = `/${this.id}`;
        switch (this.contributionSource.type) {
            case "user":
                authority = "user";
                break;
            case "workspace":
                authority = "workspace";
                path = `/${ResolvableBase.minimalEncodeURIComponent(this.contributionSource.workspace.toString(true))}$path`;
                break;
            case "extension":
                authority = this.contributionSource.id;
                break;
        }
        return vscode.Uri.from({
            scheme: ResolvableBase.scheme,
            authority,
            path,
            fragment: this.label,
        });
    }

    private static readonly replacements: Record<string, string> = {
        "#": "%23",
        "%": "%25",
        "?": "%3F",
    };

    private static minimalEncodeURIComponent(value: string): string {
        return value.replace(/[#%?]/, (char) => ResolvableBase.replacements[char]);
    }

    static getContribution(uri: vscode.Uri): {
        contributionSource: ContributionSource;
        id: UUID;
    } {
        assert(uri.scheme === ResolvableBase.scheme);
        if (uri.authority === "user") {
            return {
                contributionSource: new UserContribution({ type: "user" }),
                id: uri.path.slice(1) as UUID,
            };
        } else if (uri.authority === "workspace") {
            const workspace = posix.dirname(uri.path).slice(1);
            const id = posix.basename(uri.path) as UUID;
            return {
                contributionSource: new WorkspaceContribution({
                    type: "workspace",
                    workspace: vscode.Uri.parse(decodeURIComponent(workspace), true),
                }),
                id,
            };
        } else {
            return {
                contributionSource: new ExtensionContribution({
                    type: "extension",
                    id: uri.authority,
                }),
                id: uri.path.slice(1) as UUID,
            };
        }
    }
}

export class Pattern extends ResolvableBase {
    static override readonly schema = super.schema.extend({
        source: z.string(),
        isRegex: z.boolean(),
        caseInsensitive: z.boolean().optional(),
        dotAll: z.boolean().optional(),
    });

    readonly regex: RE2JS;
    readonly source: string;
    readonly isRegex: boolean;
    readonly caseInsensitive: boolean;
    readonly dotAll: boolean;

    constructor({
        id,
        contributionSource,
        label,
        source,
        isRegex,
        caseInsensitive = false,
        dotAll = false,
    }: z.output<typeof Pattern.schema>) {
        super({ id, contributionSource, label });
        this.source = source;
        this.isRegex = isRegex;
        this.caseInsensitive = caseInsensitive;
        this.dotAll = dotAll;
        let flags = RE2JS.MULTILINE;
        if (caseInsensitive) {
            flags |= RE2JS.CASE_INSENSITIVE;
        }
        if (dotAll) {
            flags |= RE2JS.DOTALL;
        }
        this.regex = RE2JS.compile(isRegex ? source : RE2JS.quote(source), flags);
    }

    toJSON(): z.input<typeof Pattern.schema> {
        return {
            id: this.id,
            contributionSource: this.contributionSource.toJSON(),
            source: this.source,
            isRegex: this.isRegex,
            caseInsensitive: this.caseInsensitive,
            dotAll: this.dotAll,
        };
    }

    static parse(data: unknown): Pattern {
        const validated = Pattern.schema.parse(data);
        return new Pattern(validated);
    }
}

class ThemeColor {
    static readonly schema = z
        .object({
            id: z.string(),
        })
        .transform(({ id }) => new vscode.ThemeColor(id));

    constructor(readonly value: vscode.ThemeColor) {}

    toJSON(): z.input<typeof ThemeColor.schema> {
        return { id: this.value.id };
    }

    static parse(data: unknown): ThemeColor {
        const validated = ThemeColor.schema.parse(data);
        return new ThemeColor(validated);
    }
}

class StringOrThemeColor {
    static readonly schema = z.union([z.string(), ThemeColor.schema]);

    constructor(readonly value: string | vscode.ThemeColor) {}

    toJSON(): z.input<typeof StringOrThemeColor.schema> {
        if (typeof this.value === "string") {
            return this.value;
        }
        return new ThemeColor(this.value).toJSON();
    }

    static parse(data: unknown): StringOrThemeColor {
        const validated = StringOrThemeColor.schema.parse(data);
        return new StringOrThemeColor(validated);
    }
}

class Uri {
    static readonly schema = z
        .object({
            uri: z.url(),
        })
        .transform(({ uri }) => vscode.Uri.parse(uri, true));

    constructor(readonly value: vscode.Uri) {}

    toJSON(): z.input<typeof Uri.schema> {
        return {
            uri: this.value.toString(true),
        };
    }

    static parse(data: unknown): Uri {
        const validated = Uri.schema.parse(data);
        return new Uri(validated);
    }
}

class StringOrUri {
    static readonly schema = z.union([z.string(), Uri.schema]);

    constructor(readonly value: string | vscode.Uri) {}

    toJSON(): z.input<typeof StringOrUri.schema> {
        if (typeof this.value === "string") {
            return this.value;
        }
        return new Uri(this.value).toJSON();
    }

    static fromJSON(data: unknown): StringOrUri {
        const validated = StringOrUri.schema.parse(data);
        return new StringOrUri(validated);
    }
}

class ThemableDecorationAttachmentRenderOptions {
    static readonly schema = z
        .object({
            contextText: z.string(),
            contentIconPath: StringOrUri.schema,
            border: z.string(),
            borderColor: StringOrThemeColor.schema,
            fontStyle: z.string(),
            fontWeight: z.string(),
            textDecoration: z.string(),
            color: StringOrThemeColor.schema,
            backgroundColor: StringOrThemeColor.schema,
            margin: z.string(),
            width: z.string(),
            height: z.string(),
        })
        .partial();

    constructor(readonly value: vscode.ThemableDecorationAttachmentRenderOptions) {}

    toJSON(): z.input<typeof ThemableDecorationAttachmentRenderOptions.schema> {
        return {
            ...this.value,
            contentIconPath:
                this.value.contentIconPath === undefined
                    ? undefined
                    : new StringOrUri(this.value.contentIconPath).toJSON(),
            borderColor:
                this.value.borderColor === undefined
                    ? undefined
                    : new StringOrThemeColor(this.value.borderColor).toJSON(),
            color:
                this.value.color === undefined
                    ? undefined
                    : new StringOrThemeColor(this.value.color).toJSON(),
            backgroundColor:
                this.value.backgroundColor === undefined
                    ? undefined
                    : new StringOrThemeColor(this.value.backgroundColor).toJSON(),
        };
    }

    static fromJSON(data: unknown): ThemableDecorationAttachmentRenderOptions {
        const validated = ThemableDecorationAttachmentRenderOptions.schema.parse(data);
        return new ThemableDecorationAttachmentRenderOptions(validated);
    }
}

class ThemableDecorationRenderOptions {
    static readonly schema = z
        .object({
            backgroundColor: StringOrThemeColor.schema,
            outline: z.string(),
            outlineColor: StringOrThemeColor.schema,
            outlineStyle: z.string(),
            outlineWidth: z.string(),
            border: z.string(),
            borderColor: StringOrThemeColor.schema,
            borderRadius: z.string(),
            borderSpacing: z.string(),
            borderStyle: z.string(),
            borderWidth: z.string(),
            fontStyle: z.string(),
            fontWeight: z.string(),
            textDecoration: z.string(),
            cursor: z.string(),
            color: StringOrThemeColor.schema,
            opacity: z.string(),
            letterSpacing: z.string(),
            gutterIconPath: StringOrUri.schema,
            gutterIconSize: z.string(),
            overviewRulerColor: StringOrThemeColor.schema,
            before: ThemableDecorationAttachmentRenderOptions.schema,
            after: ThemableDecorationAttachmentRenderOptions.schema,
        })
        .partial();

    constructor(readonly value: vscode.ThemableDecorationRenderOptions) {}

    toJSON(): z.input<typeof ThemableDecorationRenderOptions.schema> {
        return {
            ...this.value,
            backgroundColor:
                this.value.backgroundColor === undefined
                    ? undefined
                    : new StringOrThemeColor(this.value.backgroundColor).toJSON(),
            outlineColor:
                this.value.outlineColor === undefined
                    ? undefined
                    : new StringOrThemeColor(this.value.outlineColor).toJSON(),
            borderColor:
                this.value.borderColor === undefined
                    ? undefined
                    : new StringOrThemeColor(this.value.borderColor).toJSON(),
            color:
                this.value.color === undefined
                    ? undefined
                    : new StringOrThemeColor(this.value.color).toJSON(),
            gutterIconPath:
                this.value.gutterIconPath === undefined
                    ? undefined
                    : new StringOrUri(this.value.gutterIconPath).toJSON(),
            before:
                this.value.before === undefined
                    ? undefined
                    : new ThemableDecorationAttachmentRenderOptions(this.value.before).toJSON(),
            after:
                this.value.after === undefined
                    ? undefined
                    : new ThemableDecorationAttachmentRenderOptions(this.value.after).toJSON(),
        };
    }

    static parse(data: unknown): ThemableDecorationRenderOptions {
        const validated = ThemableDecorationRenderOptions.schema.parse(data);
        return new ThemableDecorationRenderOptions(validated);
    }
}

class DecorationRenderOptions {
    static readonly schema = ThemableDecorationRenderOptions.schema
        .extend({
            isWholeLine: z.boolean(),
            rangeBehavior: z.enum(vscode.DecorationRangeBehavior),
            overviewRulerLane: z.enum(vscode.OverviewRulerLane),
            light: ThemableDecorationRenderOptions.schema,
            dark: ThemableDecorationRenderOptions.schema,
        })
        .partial();

    constructor(readonly value: vscode.DecorationRenderOptions) {}

    toJSON(): z.input<typeof DecorationRenderOptions.schema> {
        return {
            ...new ThemableDecorationRenderOptions(this.value).toJSON(),
            isWholeLine: this.value.isWholeLine,
            rangeBehavior: this.value.rangeBehavior,
            overviewRulerLane: this.value.overviewRulerLane,
            light:
                this.value.light === undefined
                    ? undefined
                    : new ThemableDecorationRenderOptions(this.value.light).toJSON(),
            dark:
                this.value.dark === undefined
                    ? undefined
                    : new ThemableDecorationRenderOptions(this.value.dark).toJSON(),
        };
    }

    static parse(data: unknown): DecorationRenderOptions {
        const validated = DecorationRenderOptions.schema.parse(data);
        return new DecorationRenderOptions(validated);
    }
}

export class Style extends ResolvableBase {
    static override readonly schema = super.schema.extend(DecorationRenderOptions.schema.shape);

    readonly style: vscode.DecorationRenderOptions;

    constructor({ id, contributionSource, label, ...style }: z.output<typeof Style.schema>) {
        super({ id, contributionSource, label });
        this.style = style;
    }

    toJSON(): z.input<typeof Style.schema> {
        return {
            id: this.id,
            contributionSource: this.contributionSource.toJSON(),
            ...new DecorationRenderOptions(this.style).toJSON(),
        };
    }

    static parse(data: unknown): Style {
        const validated = Style.schema.parse(data);
        return new Style(validated);
    }
}

export class Diagnostic extends ResolvableBase {
    static override readonly schema = super.schema.extend({
        severity: z.enum(vscode.DiagnosticSeverity),
        customMessage: z.string().optional(),
    });

    readonly severity: vscode.DiagnosticSeverity;
    readonly customMessage?: string;

    constructor({
        id,
        contributionSource,
        label,
        severity,
        customMessage,
    }: z.output<typeof Diagnostic.schema>) {
        super({ id, contributionSource, label });
        this.severity = severity;
        this.customMessage = customMessage;
    }

    toJSON(): z.input<typeof Diagnostic.schema> {
        return {
            id: this.id,
            contributionSource: this.contributionSource.toJSON(),
            severity: this.severity,
            customMessage: this.customMessage,
        };
    }

    static parse(data: unknown): Diagnostic {
        const validated = Diagnostic.schema.parse(data);
        return new Diagnostic(validated);
    }
}

export class Template extends ResolvableBase {
    static readonly contextSchema = z.object({
        style: zUUID.optional(),
        diagnostic: zUUID.optional(),
    });

    static readonly tagSchema = z.object({
        pattern: zUUID,
        always: Template.contextSchema.optional(),
        insideComments: Template.contextSchema.optional(),
        outsideComments: Template.contextSchema.optional(),
    });

    static override readonly schema = super.schema.extend({
        tags: z.array(Template.tagSchema),
    });

    readonly tags: readonly z.output<typeof Template.tagSchema>[];

    constructor({ id, contributionSource, label, tags }: z.output<typeof Template.schema>) {
        super({ id, contributionSource, label });
        this.tags = tags;
    }

    toJSON(): z.input<typeof Template.schema> {
        return {
            id: this.id,
            contributionSource: this.contributionSource.toJSON(),
            tags: [...this.tags],
        };
    }

    static parse(data: unknown): Template {
        const validated = Template.schema.parse(data);
        return new Template(validated);
    }
}

export type Resolvable = Pattern | Style | Diagnostic | Template;

export function register(value: Resolvable): vscode.Disposable {
    const { id } = value;
    if (uriMap.has(id)) {
        throw new Error(`UUID ${JSON.stringify(id)} already in use`);
    }
    uriMap.set(id, value);
    let disposed = false;
    return {
        dispose(): void {
            if (!disposed) {
                uriMap.delete(id);
                disposed = true;
            }
        },
    };
}

export function resolve(uri: vscode.Uri): Resolvable {
    assert(uri.scheme === "taglens");
    const id = uri.path.slice(1) as UUID;
    const value = uriMap.get(id);
    if (value === undefined) {
        throw vscode.FileSystemError.FileNotFound(uri);
    }
    assert(uri.authority === value.uri.authority);
    return value;
}

export function iterPatterns(): IteratorObject<Pattern> {
    return uriMap.values().filter((value) => value instanceof Pattern);
}

export function iterStyles(): IteratorObject<Style> {
    return uriMap.values().filter((value) => value instanceof Style);
}

export function iterDiagnostics(): IteratorObject<Diagnostic> {
    return uriMap.values().filter((value) => value instanceof Diagnostic);
}

export function iterTemplates(): IteratorObject<Template> {
    return uriMap.values().filter((value) => value instanceof Template);
}

// this class handles showing `taglens:` URIs as JSON
export class TagLensTextDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private readonly emitOnDidChange = new vscode.EventEmitter<vscode.Uri>();

    onDidChange = this.emitOnDidChange.event;

    provideTextDocumentContent(
        uri: vscode.Uri,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<string> {
        const item = resolve(uri);
        if (item === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return JSON.stringify(item);
    }
}
