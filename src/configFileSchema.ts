/** biome-ignore-all lint/nursery/useExplicitType: Zod object types don't exist before the object does. Type must be implied. */

import { z } from "zod";

export const TagDiagnosticSchema = z.object({
    severity: z.enum(["error", "warning", "information", "hint"]),
    customMessage: z.string().optional(),
});

export type TagDiagnostic = z.infer<typeof TagDiagnosticSchema>;

export const LiteralPatternSchema = z.object({
    literal: z.string(),
    caseInsensitive: z.boolean().optional(),
    regexp: z.never().optional(),
    dotAll: z.never().optional(),
});

export type LiteralPattern = z.infer<typeof LiteralPatternSchema>;

export const RegExpPatternSchema = z.object({
    regexp: z.string(),
    caseInsensitive: z.boolean().optional(),
    dotAll: z.boolean().optional(),
    literal: z.never().optional(),
});

export type RegExpPattern = z.infer<typeof RegExpPatternSchema>;

export const PatternSchema = z.xor([LiteralPatternSchema, RegExpPatternSchema]);

export type Pattern = z.infer<typeof PatternSchema>;

export const TagSchema = z.object({
    match: PatternSchema,
    decorationStyle: z.string().optional(),
    decorateCaptureGroup: z.xor([z.int(), z.object({ name: z.string() })]).optional(),
    diagnostic: TagDiagnosticSchema.optional(),
});

export type Tag = z.infer<typeof TagSchema>;

export const ColorSchema = z.xor([z.string(), z.object({ theme: z.string() })]);

export type Color = z.infer<typeof ColorSchema>;

export const StyleSchema = z
    .object({
        backgroundColor: ColorSchema,
        bold: z.boolean(),
        border: z.string(),
        foregroundColor: ColorSchema,
        italic: z.boolean(),
        opacity: z.number().min(0.0).max(1.0),
        textDecoration: z.string(),
    })
    .partial();

export type Style = z.infer<typeof StyleSchema>;

export const ExtendsSchema = z.object({
    extends: z.array(z.string()).meta({
        description:
            "An array of tag group names from this file or from well-known configurations such as `global:`",
    }),
});

export type Extends = z.infer<typeof ExtendsSchema>;

export const TagsSchema = z.object({
    tags: z.array(TagSchema),
});

export type Tags = z.infer<typeof TagsSchema>;

export const ExtendsAndTagsSchema = ExtendsSchema.extend(TagsSchema.shape);

export type ExtendsAndTags = z.infer<typeof ExtendsAndTagsSchema>;

export const ExtendsTagsSchema = z.union([
    z.array(TagSchema),
    ExtendsAndTagsSchema,
    ExtendsSchema,
    TagsSchema,
]);

export type ExtendsTags = z.infer<typeof ExtendsTagsSchema>;

export const LineCommentSchema = z.object({
    lineCommentStart: PatternSchema,
});

export type LineComment = z.infer<typeof LineCommentSchema>;

export const BlockCommentSchema = z.object({
    blockCommentStart: PatternSchema,
    blockCommentEnd: PatternSchema,
});

export type BlockComment = z.infer<typeof BlockCommentSchema>;

export const LineCommentAndBlockCommentSchema = LineCommentSchema.extend(BlockCommentSchema.shape);

export type LineCommentAndBlockComment = z.infer<typeof LineCommentAndBlockCommentSchema>;

export const CommentSchema = z.union([
    LineCommentAndBlockCommentSchema,
    LineCommentSchema,
    BlockCommentSchema,
]);

export type Comment = z.infer<typeof CommentSchema>;

export const ConfigFileSchema = z
    .object({
        $schema: z.string().meta({ description: "JSON Schema URI" }),
        tagGroups: z
            .record(z.string(), ExtendsTagsSchema)
            .meta({ description: "Record of named tag groups that can be referenced elsewhere" }),
        tags: z.record(z.string(), ExtendsTagsSchema).meta({
            description:
                'Record of language name keys (or `"*"` for all languages) to apply tags to',
        }),
        commentTokens: z.record(z.string(), CommentSchema).meta({
            description:
                'Record of language name keys (`"*"` not allowed here) to specify comment start and end tokens',
        }),
        commentTags: ExtendsTagsSchema.meta({
            description: "The tags to apply within comments matched by `commentTokens`",
        }),
        styles: z
            .record(z.string(), StyleSchema)
            .meta({ description: "Record of named styles that can be referenced by tags" }),
    })
    .partial();

export type ConfigFile = z.infer<typeof ConfigFileSchema>;
