import z from "zod";

export const CommentTokens = z.strictObject({
    lineCommentStart: z.string(),
    blockCommentStart: z.string(),
    blockCommentEnd: z.string(),
});

export type CommentTokens = z.output<typeof CommentTokens>;

export const PartialCommentTokens = CommentTokens.partial();

export type PartialCommentTokens = z.output<typeof PartialCommentTokens>;

export const DiscoveredCommentTokens = CommentTokens.extend({
    displayName: z.string().optional(),
});

export type DiscoveredCommentTokens = z.output<typeof DiscoveredCommentTokens>;

export const PartialDiscoveredCommentTokens = DiscoveredCommentTokens.partial();

export type PartialDiscoveredCommentTokens = z.output<typeof PartialDiscoveredCommentTokens>;

export namespace FromWebView {
    export const ReadyMessage = z.strictObject({ type: z.literal("ready") });

    export type ReadyMessage = z.output<typeof ReadyMessage>;

    export const DiscardMessage = z.strictObject({ type: z.literal("discard") });

    export type DiscardMessage = z.output<typeof DiscardMessage>;

    export const CommitMessage = z.strictObject({
        type: z.literal("commit"),
        editedConfig: z.record(z.string(), CommentTokens),
    });

    export type CommitMessage = z.output<typeof CommitMessage>;

    export const Message = z.discriminatedUnion("type", [
        ReadyMessage,
        DiscardMessage,
        CommitMessage,
    ]);

    export type Message = z.output<typeof Message>;
}

export namespace ToWebView {
    export const SetConfigMessage = z.strictObject({
        type: z.literal("setConfig"),
        baselineConfig: z.record(z.string(), PartialCommentTokens),
        discovered: z.record(z.string(), z.record(z.string(), PartialDiscoveredCommentTokens)),
    });

    export type SetConfigMessage = z.output<typeof SetConfigMessage>;

    export const Message = z.discriminatedUnion("type", [SetConfigMessage]);

    export type Message = z.output<typeof Message>;
}

export function isDefinedAndNonEmpty(value: string | undefined | null): value is string {
    return value !== undefined && value !== null && value !== "";
}

export enum TokenWarnings {
    None = 0,
    LineStartMatchesBlockStart = 1,
    LineStartMatchesBlockEnd = 2,
    BlockStartEmpty = 4,
    BlockEndEmpty = 8,
    AllEmpty = 16,
}

export function validateCommentTokens({
    lineCommentStart,
    blockCommentStart,
    blockCommentEnd,
}: PartialCommentTokens): TokenWarnings {
    let warnings = TokenWarnings.None;
    const lineCommentStartHasValue = isDefinedAndNonEmpty(lineCommentStart);
    const blockCommentStartHasValue = isDefinedAndNonEmpty(blockCommentStart);
    const blockCommentEndHasValue = isDefinedAndNonEmpty(blockCommentEnd);
    if (lineCommentStartHasValue) {
        if (lineCommentStart === blockCommentStart) {
            warnings |= TokenWarnings.LineStartMatchesBlockStart;
        }
        if (lineCommentStart === blockCommentEnd) {
            warnings |= TokenWarnings.LineStartMatchesBlockEnd;
        }
    }
    if (!blockCommentStartHasValue && blockCommentEndHasValue) {
        warnings |= TokenWarnings.BlockStartEmpty;
    } else if (blockCommentStartHasValue && !blockCommentEndHasValue) {
        warnings |= TokenWarnings.BlockEndEmpty;
    }
    if (!lineCommentStartHasValue && !blockCommentStartHasValue && !blockCommentEndHasValue) {
        warnings |= TokenWarnings.AllEmpty;
    }
    return warnings;
}

export function enumContainsFlag<T extends number>(value: T, flag: T): boolean {
    return (value & flag) !== 0;
}
