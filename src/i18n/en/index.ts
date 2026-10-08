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
        },
        App: {
            AddLanguage: "Add Language ID",
            Undo: "Undo",
            Redo: "Redo",
            Discard: "Discard",
            Commit: "Apply",
        },
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
    },
} satisfies BaseTranslation;

export default en;
