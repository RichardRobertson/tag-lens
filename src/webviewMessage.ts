export interface WebViewReadyMessage {
    type: "ready";
}

export interface WebViewSetConfigMessage {
    type: "setConfig";
    config: WebViewConfig;
}

export interface WebViewCommentMessage {
    type: "commit";
}

export type WebViewMessage = WebViewReadyMessage | WebViewSetConfigMessage | WebViewCommentMessage;

export interface CommentTokens {
    aliases?: string[];
    displayName?: string;
    lineCommentStart?: string | undefined;
    blockCommentStart?: string | undefined;
    blockCommentEnd?: string | undefined;
}

export interface WebViewConfig {
    languages: Record<
        string,
        {
            current?: CommentTokens;
            discovered: Record<string, CommentTokens>;
        }
    >;
}
