import * as JSONC from "jsonc-parser";
import * as vscode from "vscode";
import z from "zod";
import { reorderKeys } from "./util";
import type { CommentTokens } from "./webviewMessage";

const packageJsonLanguageContributionSchema = z.looseObject({
    name: z.string(),
    displayName: z.string().optional(),
    contributes: z.looseObject({
        languages: z.array(
            z.looseObject({
                id: z.string(),
                configuration: z.string().optional(),
                aliases: z.array(z.string()).optional(),
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
    Record<string, Record<string, CommentTokens>>
> {
    const decoder = new TextDecoder();
    const result: Record<string, Record<string, CommentTokens>> = {};
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
            if (result[language.id] === undefined) {
                result[language.id] = {};
            }
            result[language.id][extension.id] = {
                aliases: language.aliases,
                displayName: packageJSON.data.displayName,
            };
            if (languageConfiguration.comments.lineComment !== undefined) {
                if (typeof languageConfiguration.comments.lineComment === "string") {
                    result[language.id][extension.id].lineCommentStart =
                        languageConfiguration.comments.lineComment;
                } else if (languageConfiguration.comments.lineComment !== undefined) {
                    result[language.id][extension.id].lineCommentStart =
                        languageConfiguration.comments.lineComment.comment;
                }
            }
            if (languageConfiguration.comments.blockComment !== undefined) {
                [
                    result[language.id][extension.id].blockCommentStart,
                    result[language.id][extension.id].blockCommentEnd,
                ] = languageConfiguration.comments.blockComment;
            }
        }
    }
    return reorderKeys(result, reorderKeys);
}
