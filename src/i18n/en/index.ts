import type { BaseTranslation } from "../i18n-types.js";

// biome-ignore lint/nursery/useExplicitType: typesafe-i18n style
const en = {
    TokenWarnings: {
        LineStartMatchesBlockStart: "Line comment start matches block comment start",
        LineStartMatchesBlockEnd: "Line comment start matches block comment end",
        BlockStartEmpty:
            "Block comment start is empty when a value was provided for block comment end",
        BlockEndEmpty:
            "Block comment end is empty when a value was provided for block comment start",
        AllEmpty: "No comment tokens provided",
    },
    CommentTokens: {
        LanguageEditor: {
            Discovered: {
                LineStart: "Line:",
                BlockStart: "Block start:",
                BlockEnd: "Block end:",
                Use: "Start with this",
            },
            LineStart: "Line comment start:",
            BlockStart: "Block comment start:",
            BlockEnd: "Block comment end:",
            Delete: "Delete",
            UnsetPlaceholder: "(unset)",
            RevertToken: "revert to saved",
        },
        App: {
            AddLanguage: "Add Language ID",
            Undo: "Undo Delete",
            Discard: "Discard",
            Commit: "Save",
            SearchBadge: "Matches {count:number} language ID{{s}}",
            SearchPlaceholder: "Search language IDs",
            ClearSearch: "clear search",
            AddTitle: "Add Language ID",
            AddPrompt: "Language ID",
        },
        WebViewTitle: "Tag Lens: Comment Tokens",
        ConfigurationHasErrorsOutputChannelHeader:
            "One or more languages had errors, and the configuration has not been modified:",
        ConfigurationHasErrorsMessage:
            "One or more languages had errors, and the configuration has not been modified.",
        ConfigurationHasEmptyOutputChannelHeader:
            "One or more languages had no tokens specified, and they will be trimmed from the configuration:",
        ConfigurationHasEmptyMessage:
            "One or more languages had no tokens specified, and they will be trimmed from the configuration.",
        ConfirmDiscardChanges: "Are you sure you want to discard all changes?",
    },
    TagsTreeProvider: {
        LooseFiles: "Loose Files",
    },
    ConfigFile: {
        OpenConfiguration: "Open Configuration",
        MoreDetails: "More Details",
        Error: "The {filename:string} configuration file contains errors and could not be loaded.",
    },
    Extension: {
        OutputChannelTitle: "Tag Lens",
        Warnings: {
            NoWorkspaceOpen: "No workspace open",
            NoWorkspaceFolders: "No workspace folders available",
        },
        SelectWorkspacePlaceholder: "Select a workspace folder",
    },
    GenericButtons: {
        ShowDetails: "Show Details",
        Yes: "Yes",
        No: "No",
    },
} satisfies BaseTranslation;

export default en;
