import * as JSONC from "jsonc-parser";
import * as vscode from "vscode";
import z from "zod";
import { getOrInit, reorderKeys } from "./util";
import type { PartialDiscoveredCommentTokens } from "./webviewMessage";

const packageJsonLanguageContributionSchema = z.looseObject({
    name: z.string(),
    displayName: z.string().optional(),
    contributes: z.looseObject({
        languages: z.array(
            z.looseObject({
                id: z.string(),
                configuration: z.string().optional(),
            })
        ),
    }),
});

const languageConfigurationSchema = z.looseObject({
    comments: z.looseObject({
        lineComment: z
            .xor([
                z.string(),
                z.looseObject({
                    comment: z.string(),
                }),
            ])
            .optional(),
        blockComment: z.tuple([z.string(), z.string()]).optional(),
    }),
});

export async function getExtensionLanguageCommentTokens(): Promise<
    Record<string, Record<string, PartialDiscoveredCommentTokens>>
> {
    const decoder = new TextDecoder();
    const result: Record<string, Record<string, PartialDiscoveredCommentTokens>> = {};
    for (const extension of vscode.extensions.all) {
        const packageJSON = packageJsonLanguageContributionSchema.safeParse(extension.packageJSON);
        if (!packageJSON.success) {
            continue;
        }
        for (const language of packageJSON.data.contributes.languages) {
            if (language.configuration === undefined) {
                continue;
            }
            const languagePath = vscode.Uri.joinPath(
                extension.extensionUri,
                language.configuration
            );
            let languageConfiguration: z.output<typeof languageConfigurationSchema> | undefined;
            try {
                const fileBytes = await vscode.workspace.fs.readFile(languagePath);
                const fileString = decoder.decode(fileBytes);
                const fileObject = JSONC.parse(fileString);
                const validated = languageConfigurationSchema.safeParse(fileObject);
                if (validated.success) {
                    languageConfiguration = validated.data;
                } else {
                    continue;
                }
            } catch {
                continue;
            }
            const sources = getOrInit(result, language.id, () => ({}));
            const source = getOrInit(sources, extension.id, () => ({
                displayName: packageJSON.data.displayName,
            }));
            if (languageConfiguration.comments.lineComment !== undefined) {
                if (typeof languageConfiguration.comments.lineComment === "string") {
                    source.lineCommentStart = languageConfiguration.comments.lineComment;
                } else if (languageConfiguration.comments.lineComment !== undefined) {
                    source.lineCommentStart = languageConfiguration.comments.lineComment.comment;
                }
            }
            if (languageConfiguration.comments.blockComment !== undefined) {
                [source.blockCommentStart, source.blockCommentEnd] =
                    languageConfiguration.comments.blockComment;
            }
        }
    }
    return reorderKeys(result, reorderKeys);
}
