import type * as vscode from "vscode";
import z from "zod";

export const Pattern = z.strictObject({
    pattern: z.string().meta({
        title: "%tag-lens.configuration.patterns[*].pattern.title%",
        markdownDescription: "%tag-lens.configuration.patterns[*].pattern.markdownDescription%",
    }),
    literal: z.boolean().optional().meta({
        title: "%tag-lens.configuration.patterns[*].literal.title%",
        markdownDescription: "%tag-lens.configuration.patterns[*].literal.markdownDescription%",
    }),
    caseInsensitive: z.boolean().optional().meta({
        title: "%tag-lens.configuration.patterns[*].caseInsensitive.title%",
        markdownDescription:
            "%tag-lens.configuration.patterns[*].caseInsensitive.markdownDescription%",
    }),
    dotAll: z.boolean().optional().meta({
        title: "%tag-lens.configuration.patterns[*].dotAll.title%",
        markdownDescription: "%tag-lens.configuration.patterns[*].dotAll.markdownDescription%",
    }),
    disableUnicode: z.boolean().optional().meta({
        title: "%tag-lens.configuration.patterns[*].disableUnicode.title%",
        markdownDescription:
            "%tag-lens.configuration.patterns[*].disableUnicode.markdownDescription%",
    }),
});

export type Pattern = z.output<typeof Pattern>;

export const Patterns = z.record(z.string(), Pattern);

export type Patterns = z.output<typeof Patterns>;

export const CommentContext = z.enum(["any", "inComment", "outOfComment"]).meta({
    enumItemLabels: [
        "%tag-lens.configuration.rules[*].commentContext.any.itemLabel%",
        "%tag-lens.configuration.rules[*].commentContext.inComment.itemLabel%",
        "%tag-lens.configuration.rules[*].commentContext.outOfComment.itemLabel%",
    ],
    markdownEnumDescriptions: [
        "%tag-lens.configuration.rules[*].commentContext.any.markdownDescription%",
        "%tag-lens.configuration.rules[*].commentContext.inComment.markdownDescription%",
        "%tag-lens.configuration.rules[*].commentContext.outOfComment.markdownDescription%",
    ],
});

export type CommentContext = z.output<typeof CommentContext>;

export const Rule = z.strictObject({
    pattern: z.string().meta({
        title: "%tag-lens.configuration.rules[*].pattern.title%",
        markdownDescription: "%tag-lens.configuration.rules[*].pattern.markdownDescription%",
    }),
    commentContext: CommentContext.optional().meta({
        title: "%tag-lens.configuration.rules[*].commentContext.title%",
        markdownDescription: "%tag-lens.configuration.rules[*].commentContext.markdownDescription%",
    }),
    decorationStyle: z.string().optional().meta({
        title: "%tag-lens.configuration.rules[*].decorationStyle.title%",
        markdownDescription:
            "%tag-lens.configuration.rules[*].decorationStyle.markdownDescription%",
    }),
    diagnosticStyle: z.string().optional().meta({
        title: "%tag-lens.configuration.rules[*].diagnosticStyle.title%",
        markdownDescription:
            "%tag-lens.configuration.rules[*].diagnosticStyle.markdownDescription%",
    }),
    languages: z
        .union([
            z.literal("*"),
            z.strictObject({
                only: z.array(z.string()).meta({
                    title: "%tag-lens.configuration.rules[*].languages.only.title%",
                    markdownDescription:
                        "%tag-lens.configuration.rules[*].languages.only.markdownDescription%",
                }),
            }),
            z.strictObject({
                except: z.array(z.string()).meta({
                    title: "%tag-lens.configuration.rules[*].languages.except.title%",
                    markdownDescription:
                        "%tag-lens.configuration.rules[*].languages.except.markdownDescription%",
                }),
            }),
        ])
        .optional()
        .meta({
            title: "%tag-lens.configuration.rules[*].languages.title%",
            markdownDescription: "%tag-lens.configuration.rules[*].languages.markdownDescription%",
        }),
});

export type Rule = z.output<typeof Rule>;

export const Rules = z.record(z.string(), Rule);

export type Rules = z.output<typeof Rules>;

export const DiagnosticSeverity = z.toZod<vscode.DiagnosticSeverity>()(
    z
        .enum(["error", "warning", "information", "hint"])
        .transform((arg) => {
            switch (arg) {
                case "error":
                    return 0 as vscode.DiagnosticSeverity;
                case "warning":
                    return 1 as vscode.DiagnosticSeverity;
                case "information":
                    return 2 as vscode.DiagnosticSeverity;
                case "hint":
                    return 3 as vscode.DiagnosticSeverity;
            }
        })
        .meta({
            enumItemLabels: [
                "%tag-lens.configuration.diagnosticStyles[*].severity.error.itemLabel%",
                "%tag-lens.configuration.diagnosticStyles[*].severity.warning.itemLabel%",
                "%tag-lens.configuration.diagnosticStyles[*].severity.information.itemLabel%",
                "%tag-lens.configuration.diagnosticStyles[*].severity.hint.itemLabel%",
            ],
            markdownEnumDescriptions: [
                "%tag-lens.configuration.diagnosticStyles[*].severity.error.markdownDescription%",
                "%tag-lens.configuration.diagnosticStyles[*].severity.warning.markdownDescription%",
                "%tag-lens.configuration.diagnosticStyles[*].severity.information.markdownDescription%",
                "%tag-lens.configuration.diagnosticStyles[*].severity.hint.markdownDescription%",
            ],
        })
);

export type DiagnosticSeverity = z.output<typeof DiagnosticSeverity>;

export const DiagnosticStyle = z.strictObject({
    severity: DiagnosticSeverity.meta({
        title: "%tag-lens.configuration.diagnosticStyles[*].severity.title%",
        markdownDescription:
            "%tag-lens.configuration.diagnosticStyles[*].severity.markdownDescription%",
    }),
    customMessage: z.string().optional().meta({
        title: "%tag-lens.configuration.diagnosticStyles[*].customMessage.title%",
        markdownDescription:
            "%tag-lens.configuration.diagnosticStyles[*].customMessage.markdownDescription%",
    }),
});

export type DiagnosticStyle = z.output<typeof DiagnosticStyle>;

export const DiagnosticStyles = z.record(z.string(), DiagnosticStyle);

export type DiagnosticStyles = z.output<typeof DiagnosticStyles>;

let themeColorConstructor: (id: string) => vscode.ThemeColor = () => {
    throw new Error("conversion not implemeneted");
};

export function setThemeColorConstructor(f: (id: string) => vscode.ThemeColor): void {
    themeColorConstructor = f;
}

export const ThemeColor = z.toZod<vscode.ThemeColor>()(
    z
        .strictObject({
            themeColor: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themeColor.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themeColor.markdownDescription%",
            }),
        })
        .transform(({ themeColor }) => themeColorConstructor(themeColor))
);

export type ThemeColor = z.output<typeof ThemeColor>;

export const StringOrThemeColor = z.union([z.string(), ThemeColor]);

export type StringOrThemeColor = z.output<typeof StringOrThemeColor>;

let uriParse: (value: string) => vscode.Uri = () => {
    throw new Error("conversion not implemented");
};

export function setUriParse(f: (value: string, strict?: boolean | undefined) => vscode.Uri): void {
    uriParse = f;
}

export const Uri = z
    .strictObject({
        uri: z.url().meta({
            title: "%tag-lens.configuration.decorationStyles[*].uri.title%",
            markdownDescription:
                "%tag-lens.configuration.decorationStyles[*].uri.markdownDescription%",
        }),
    })
    .transform(({ uri }) => uriParse(uri));

export type Uri = z.output<typeof Uri>;

export const StringOrUri = z.union([z.string(), Uri]);

export type StringOrUri = z.output<typeof StringOrUri>;

export const DecorationRangeBehavior = z.toZod<vscode.DecorationRangeBehavior>()(
    z
        .enum(["openOpen", "closedClosed", "openClosed", "closedOpen"])
        .transform((arg) => {
            switch (arg) {
                case "openOpen":
                    return 0 as vscode.DecorationRangeBehavior;
                case "closedClosed":
                    return 1 as vscode.DecorationRangeBehavior;
                case "openClosed":
                    return 2 as vscode.DecorationRangeBehavior;
                case "closedOpen":
                    return 3 as vscode.DecorationRangeBehavior;
            }
        })
        .meta({
            enumItemLabels: [
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.openOpen.itemLabel%",
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.closedClosed.itemLabel%",
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.openClosed.itemLabel%",
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.closedOpen.itemLabel%",
            ],
            markdownEnumDescriptions: [
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.openOpen.markdownDescription%",
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.closedClosed.markdownDescription%",
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.openClosed.markdownDescription%",
                "%tag-lens.configuration.decorationStyles[*].decorationRangeBehavior.closedOpen.markdownDescription%",
            ],
        })
);

export type DecorationRangeBehavior = z.output<typeof DecorationRangeBehavior>;

export const OverviewRulerLane = z.toZod<vscode.OverviewRulerLane>()(
    z
        .enum(["left", "center", "right", "full"])
        .transform((arg) => {
            switch (arg) {
                case "left":
                    return 1 as vscode.OverviewRulerLane;
                case "center":
                    return 2 as vscode.OverviewRulerLane;
                case "right":
                    return 4 as vscode.OverviewRulerLane;
                case "full":
                    return 7 as vscode.OverviewRulerLane;
            }
        })
        .meta({
            enumItemLabels: [
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.left.itemLabel%",
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.center.itemLabel%",
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.right.itemLabel%",
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.full.itemLabel%",
            ],
            markdownEnumDescriptions: [
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.left.markdownDescription%",
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.center.markdownDescription%",
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.right.markdownDescription%",
                "%tag-lens.configuration.decorationStyles[*].overviewRulerLane.full.markdownDescription%",
            ],
        })
);

export type OverviewRulerLane = z.output<typeof OverviewRulerLane>;

export const ThemableDecorationAttachmentRenderOptions =
    z.toZod<vscode.ThemableDecorationAttachmentRenderOptions>()(
        z
            .strictObject({
                contentText: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.contentText.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.contentText.markdownDescription%",
                }),
                contentIconPath: StringOrUri.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.contentIconPath.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.contentIconPath.markdownDescription%",
                }),
                border: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.border.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.border.markdownDescription%",
                }),
                borderColor: StringOrThemeColor.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.borderColor.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.borderColor.markdownDescription%",
                }),
                fontStyle: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.fontStyle.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.fontStyle.markdownDescription%",
                }),
                fontWeight: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.fontWeight.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.fontWeight.markdownDescription%",
                }),
                textDecoration: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.textDecoration.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.textDecoration.markdownDescription%",
                }),
                color: StringOrThemeColor.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.color.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.color.markdownDescription%",
                }),
                backgroundColor: StringOrThemeColor.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.backgroundColor.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.backgroundColor.markdownDescription%",
                }),
                margin: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.margin.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.margin.markdownDescription%",
                }),
                width: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.width.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.width.markdownDescription%",
                }),
                height: z.string().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.height.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].themableDecorationAttachmentRenderOptions.height.markdownDescription%",
                }),
            })
            .partial()
    );

export type ThemableDecorationAttachmentRenderOptions = z.output<
    typeof ThemableDecorationAttachmentRenderOptions
>;

export const ThemableDecorationRenderOptions = z.toZod<vscode.ThemableDecorationRenderOptions>()(
    z
        .strictObject({
            backgroundColor: StringOrThemeColor.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.backgroundColor.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.backgroundColor.markdownDescription%",
            }),
            outline: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outline.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outline.markdownDescription%",
            }),
            outlineColor: StringOrThemeColor.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outlineColor.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outlineColor.markdownDescription%",
            }),
            outlineStyle: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outlineStyle.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outlineStyle.markdownDescription%",
            }),
            outlineWidth: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outlineWidth.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.outlineWidth.markdownDescription%",
            }),
            border: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.border.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.border.markdownDescription%",
            }),
            borderColor: StringOrThemeColor.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderColor.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderColor.markdownDescription%",
            }),
            borderRadius: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderRadius.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderRadius.markdownDescription%",
            }),
            borderSpacing: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderSpacing.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderSpacing.markdownDescription%",
            }),
            borderStyle: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderStyle.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderStyle.markdownDescription%",
            }),
            borderWidth: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderWidth.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.borderWidth.markdownDescription%",
            }),
            fontStyle: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.fontStyle.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.fontStyle.markdownDescription%",
            }),
            fontWeight: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.fontWeight.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.fontWeight.markdownDescription%",
            }),
            textDecoration: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.textDecoration.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.textDecoration.markdownDescription%",
            }),
            cursor: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.cursor.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.cursor.markdownDescription%",
            }),
            color: StringOrThemeColor.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.color.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.color.markdownDescription%",
            }),
            opacity: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.opacity.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.opacity.markdownDescription%",
            }),
            letterSpacing: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.letterSpacing.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.letterSpacing.markdownDescription%",
            }),
            gutterIconPath: StringOrUri.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.gutterIconPath.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.gutterIconPath.markdownDescription%",
            }),
            gutterIconSize: z.string().meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.gutterIconSize.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.gutterIconSize.markdownDescription%",
            }),
            overviewRulerColor: StringOrThemeColor.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.overviewRulerColor.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.overviewRulerColor.markdownDescription%",
            }),
            before: ThemableDecorationAttachmentRenderOptions.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.before.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.before.markdownDescription%",
            }),
            after: ThemableDecorationAttachmentRenderOptions.meta({
                title: "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.after.title%",
                markdownDescription:
                    "%tag-lens.configuration.decorationStyles[*].themableDecorationRenderOptions.after.markdownDescription%",
            }),
        })
        .partial()
);

export type ThemableDecorationRenderOptions = z.output<typeof ThemableDecorationRenderOptions>;

export const DecorationRenderOptions = z.toZod<vscode.DecorationRenderOptions>()(
    ThemableDecorationRenderOptions.extend(
        z
            .strictObject({
                isWholeLine: z.boolean().meta({
                    title: "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.isWholeLine.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.isWholeLine.markdownDescription%",
                }),
                rangeBehavior: DecorationRangeBehavior.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.rangeBehavior.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.rangeBehavior.markdownDescription%",
                }),
                overviewRulerLane: OverviewRulerLane.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.overviewRulerLane.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.overviewRulerLane.markdownDescription%",
                }),
                light: ThemableDecorationRenderOptions.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.light.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.light.markdownDescription%",
                }),
                dark: ThemableDecorationRenderOptions.meta({
                    title: "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.dark.title%",
                    markdownDescription:
                        "%tag-lens.configuration.decorationStyles[*].decorationRenderOptions.dark.markdownDescription%",
                }),
            })
            .partial().shape
    )
);

export type DecorationRenderOptions = z.output<typeof DecorationRenderOptions>;

export const DecorationStyles = z.record(z.string(), DecorationRenderOptions);

export type DecorationStyles = z.output<typeof DecorationStyles>;

export const CompactFolders = z.enum(["editor", "always", "never"]).meta({
    enumItemLabels: [
        "%tag-lens.configuration.compactFolders.editor.itemLabel%",
        "%tag-lens.configuration.compactFolders.always.itemLabel%",
        "%tag-lens.configuration.compactFolders.never.itemLabel%",
    ],
    markdownEnumDescriptions: [
        "%tag-lens.configuration.compactFolders.editor.markdownDescription%",
        "%tag-lens.configuration.compactFolders.always.markdownDescription%",
        "%tag-lens.configuration.compactFolders.never.markdownDescription%",
    ],
});

export type CompactFolders = z.output<typeof CompactFolders>;

export const CommentToken = z
    .strictObject({
        lineStart: Pattern.meta({
            title: "%tag-lens.configuration.commentTokens[*].lineStart.markdownDescription%",
            markdownDescription:
                "%tag-lens.configuration.commentTokens[*].lineStart.markdownDescription%",
        }),
        block: z.strictObject({
            blockStart: Pattern.meta({
                title: "%tag-lens.configuration.commentTokens[*].block.blockStart.markdownDescription%",
                markdownDescription:
                    "%tag-lens.configuration.commentTokens[*].block.blockEnd.markdownDescription%",
            }),
            blockEnd: Pattern.meta({
                title: "%tag-lens.configuration.commentTokens[*].block.blockEnd.markdownDescription%",
                markdownDescription:
                    "%tag-lens.configuration.commentTokens[*].block.blockEnd.markdownDescription%",
            }),
        }),
    })
    .partial();

export type CommentToken = z.output<typeof CommentToken>;

export const CommentTokens = z.record(z.string(), CommentToken);

export type CommentTokens = z.output<typeof CommentTokens>;

export const PackageConfigSchema = z
    .strictObject({
        "tag-lens.patterns": Patterns.optional().default({}).meta({
            order: 0,
            title: "%tag-lens.configuration.patterns.title%",
            markdownDescription: "%tag-lens.configuration.patterns.markdownDescription%",
        }),
        "tag-lens.decorationStyles": DecorationStyles.optional().default({}).meta({
            order: 1,
            title: "%tag-lens.configuration.decorationStyles.title%",
            markdownDescription: "%tag-lens.configuration.decorationStyles.markdownDescription%",
        }),
        "tag-lens.diagnosticStyles": DiagnosticStyles.optional().default({}).meta({
            order: 2,
            title: "%tag-lens.configuration.diagnosticStyles.title%",
            markdownDescription: "%tag-lens.configuration.diagnosticStyles.markdownDescription%",
        }),
        "tag-lens.rules": Rules.optional().default({}).meta({
            order: 3,
            title: "%tag-lens.configuration.rules.title%",
            markdownDescription: "%tag-lens.configuration.rules.markdownDescription%",
        }),
        "tag-lens.compactFolders": CompactFolders.optional().default("editor").meta({
            order: 4,
            title: "%tag-lens.configuration.compactFolders.title%",
            markdownDescription: "%tag-lens.configuration.compactFolders.markdownDescription%",
        }),
        "tag-lens.searchLoose": z.boolean().optional().default(true).meta({
            order: 5,
            title: "%tag-lens.configuration.searchLoose.title%",
            markdownDescription: "%tag-lens.configuration.searchLoose.markdownDescription%",
        }),
        "tag-lens.commentTokens": CommentTokens.optional().default({}).meta({
            order: 6,
            title: "%tag-lens.configuration.commentTokens.title%",
            markdownDescription: "%tag-lens.configuration.commentTokens.markdownDescription%",
        }),
    })
    .meta({
        title: "%tag-lens%",
    });

export type PackageConfigSchema = z.output<typeof PackageConfigSchema>;
