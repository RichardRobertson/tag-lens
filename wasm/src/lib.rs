use regex_cursor::{
    Input,
    engines::meta::Regex,
    regex_automata::{PatternID, dfa::Automaton},
};
use ropey::Rope;
use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

thread_local! {
    static OPEN_DOCUMENTS: RefCell<HashMap<String, Document>> = Default::default();
    static EXPRESSIONS: RefCell<HashMap<LanguageId, HydratedPattern>> = Default::default();
    static EXPRESSIONS_GENERATION: Cell<u32> = Default::default();
    static COMMENT_TOKENS: RefCell<HashMap<String, CommentIteratorData>> = Default::default();
    static COMMENTS_GENERATION: Cell<u32> = Default::default();
}

#[derive(Clone, Debug, Default)]
struct Document {
    body: Rope,
    dirty: bool,
    language: String,
}

#[wasm_bindgen(typescript_custom_section)]
const CUSTOM_TYPES: &'static str = "import type * as vscode from \"vscode\";";

#[derive(Clone, Copy, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VSPosition {
    pub line: usize,
    pub character: usize,
}

#[derive(Clone, Copy, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VsRange {
    pub start: VSPosition,
    pub end: VSPosition,
}

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(type = "vscode.TextDocumentContentChangeEvent")]
pub struct VsTextDocumentContentChangeEvent {
    pub range: VsRange,
    pub range_length: usize,
    pub range_offset: usize,
    pub text: String,
}

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[repr(transparent)]
pub struct VsTextDocumentContentChangeEvents(Vec<VsTextDocumentContentChangeEvent>);

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    /// The regular expression pattern to match
    pub pattern: String,
    /// Escapes the source pattern to match literally without regular expression semantics
    ///
    /// `false` by default (meaning the pattern is read as a standard regular expression)
    #[serde(default)]
    pub literal: bool,
    /// Adds the `(?i)` flag to the final regular expression
    ///
    /// `false` by default (meaning letters are case sensitive)
    #[serde(default)]
    pub case_insensitive: bool,
    /// Adds the `(?s)` flag to the final regular expression
    ///
    /// `false` by default (meaning `.` does not match new lines)
    #[serde(default)]
    pub dot_all: bool,
    /// Adds the `(?-u)` flag to the final regular expression
    ///
    /// `false` by default (meaning Unicode is enabled)
    #[serde(default)]
    pub disable_unicode: bool,
}

impl Pattern {
    pub fn pattern(&self) -> Cow<'_, str> {
        match self.literal {
            true => Cow::Owned(regex_syntax::escape(&self.pattern)),
            false => Cow::Borrowed(&self.pattern),
        }
    }

    /// Returns a static string containing a potential combination of `i`, `s`, and `-u`  flags
    pub fn flags(&self) -> &'static str {
        match (self.case_insensitive, self.dot_all, self.disable_unicode) {
            (true, true, true) => "is-u",
            (true, true, false) => "is",
            (true, false, true) => "i-u",
            (true, false, false) => "i",
            (false, true, true) => "s-u",
            (false, true, false) => "s",
            (false, false, true) => "-u",
            (false, false, false) => "",
        }
    }

    pub fn try_to_dfa(
        &self,
    ) -> Result<
        regex_cursor::regex_automata::dfa::dense::DFA<Vec<u32>>,
        Box<regex_cursor::regex_automata::dfa::dense::BuildError>,
    > {
        regex_cursor::regex_automata::dfa::dense::DFA::new(&self.pattern()).map_err(Box::new)
    }

    pub fn with_flags(&self) -> Cow<'_, str> {
        let flags = self.flags();
        if flags.is_empty() {
            self.pattern()
        } else {
            Cow::Owned(format!("(?{}:{})", self.flags(), self.pattern()))
        }
    }

    pub fn can_compile_and_not_match_empty(
        &self,
    ) -> Result<bool, Box<regex_cursor::regex_automata::dfa::dense::BuildError>> {
        Ok(!self.try_to_dfa()?.has_empty())
    }

    /// Extends the pattern with `"[^\r\n]*"`
    pub fn to_eol(&self) -> Self {
        Self {
            pattern: format!("{}[^\r\n]*", self.pattern()),
            literal: false,
            ..*self
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub start: usize,
    pub end: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// The rule that was matched
    pub rule: RuleKey,
    /// Whether this match is inside a comment span
    pub in_comment: bool,
    /// The capture group ranges where `groups[0]` is the full match
    pub groups: Vec<Group>,
}

#[derive(Clone, Debug, serde::Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[repr(transparent)]
pub struct Matches(Vec<Match>);

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BlockTokens {
    pub block_start: Pattern,
    pub block_end: Pattern,
}

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CommentTokens {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_start: Option<Pattern>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block: Option<BlockTokens>,
}

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(hashmap_as_object)]
#[repr(transparent)]
pub struct CommentTokensConfig(HashMap<String, CommentTokens>);

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum LanguageApplicability {
    #[default]
    #[serde(rename = "*")]
    All,
    Only(HashSet<String>),
    Except(HashSet<String>),
}

#[derive(Clone, Debug, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub pattern: PatternKey,
    #[serde(default)]
    pub languages: LanguageApplicability,
}

#[derive(Clone, Debug, Default, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(hashmap_as_object)]
pub struct RulesConfig {
    pub patterns: HashMap<PatternKey, Pattern>,
    pub rules: HashMap<RuleKey, Rule>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[repr(transparent)]
pub struct RuleKey(pub u32);

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
enum LanguageId {
    SpecificLanguage(String),
    #[default]
    Other,
}

#[derive(Clone, Debug)]
struct HydratedPattern {
    regex: Regex,
    rule_keys: Vec<RuleKey>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[repr(transparent)]
pub struct PatternKey(pub u32);

#[derive(Clone, Debug, thiserror::Error)]
pub enum SetRulesError {
    #[error("pattern [{pattern_id:?}] can match empty string")]
    PatternCanMatchEmptyString { pattern_id: PatternKey },
    #[error("pattern [{pattern_id:?}] compilation error: {err}")]
    PatternCompilationError {
        pattern_id: PatternKey,
        err: Box<regex_cursor::regex_automata::dfa::dense::BuildError>,
    },
    #[error("pattern [{pattern_id:?}] not found")]
    MissingPatternKey { pattern_id: PatternKey },
    #[error("thread access error: {err}")]
    ThreadAccessError {
        #[from]
        err: Box<std::thread::AccessError>,
    },
    #[error("canceled")]
    Canceled,
}

const REGEX_COMPILE_YIELD_TIMEOUT: Duration = Duration::from_millis(8);

pub async fn set_rules<F, Fut>(config: RulesConfig, mut yielder: F) -> Result<(), SetRulesError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    let generation = EXPRESSIONS_GENERATION
        .try_with(|generation_cell| {
            let new_generation = generation_cell.get().wrapping_add(1);
            generation_cell.set(new_generation);
            new_generation
        })
        .map_err(Box::new)?;
    EXPRESSIONS
        .try_with(|expressions_cell| {
            expressions_cell.borrow_mut().clear();
        })
        .map_err(Box::new)?;
    let RulesConfig { patterns, rules } = config;
    let mut last_yield_time = Instant::now();
    for (&pattern_id, pattern) in patterns.iter() {
        if !pattern
            .can_compile_and_not_match_empty()
            .map_err(|err| SetRulesError::PatternCompilationError { pattern_id, err })?
        {
            return Err(SetRulesError::PatternCanMatchEmptyString { pattern_id });
        }
        if last_yield_time.elapsed() >= REGEX_COMPILE_YIELD_TIMEOUT {
            yielder().await;
            if EXPRESSIONS_GENERATION
                .try_with(|generation_cell| generation_cell.get())
                .map_err(Box::new)?
                != generation
            {
                return Err(SetRulesError::Canceled);
            }
            last_yield_time = Instant::now();
        }
    }
    let (default, language_specific) = {
        let mut default = HashSet::new();
        let mut language_specific: HashMap<String, HashSet<RuleKey>> = HashMap::new();
        for (&rule_key, rule) in rules.iter() {
            match &rule.languages {
                LanguageApplicability::All => {
                    default.insert(rule_key);
                }
                LanguageApplicability::Only(languages) => {
                    for language in languages.iter() {
                        language_specific
                            .entry(language.clone())
                            .or_default()
                            .insert(rule_key);
                    }
                }
                LanguageApplicability::Except(languages) => {
                    default.insert(rule_key);
                    for language in languages {
                        language_specific.entry(language.clone()).or_default();
                    }
                }
            }
        }
        for specific in language_specific.values_mut() {
            specific.extend(default.iter().cloned());
        }
        for (rule_key, rule) in rules.iter() {
            if let LanguageApplicability::Except(languages) = &rule.languages {
                for language in languages {
                    if let Some(specific) = language_specific.get_mut(language) {
                        specific.remove(rule_key);
                    }
                }
            }
        }
        (default, language_specific)
    };
    fn hydrate_pattern(
        patterns: &HashMap<PatternKey, Pattern>,
        rules: &HashMap<RuleKey, Rule>,
        rule_ids: HashSet<RuleKey>,
    ) -> Result<HydratedPattern, SetRulesError> {
        let mut rule_keys = Vec::with_capacity(rule_ids.len());
        let mut regex_sources = Vec::with_capacity(rule_ids.len());
        for rule_id in rule_ids {
            let pattern_id = rules[&rule_id].pattern;
            match patterns.get(&pattern_id) {
                Some(pattern) => {
                    regex_sources.push(pattern.with_flags());
                }
                None => {
                    return Err(SetRulesError::MissingPatternKey { pattern_id });
                }
            };
            rule_keys.push(rule_id);
        }
        Ok(HydratedPattern {
            regex: Regex::new_many(&regex_sources)
                .expect("already know patterns can be compiled from emptiness check above"),
            rule_keys,
        })
    }
    let mut expressions = HashMap::new();
    last_yield_time = Instant::now();
    for (language, language_specific) in language_specific {
        expressions.insert(
            LanguageId::SpecificLanguage(language.clone()),
            hydrate_pattern(
                &patterns,
                &rules,
                default.union(&language_specific).cloned().collect(),
            )?,
        );
        if last_yield_time.elapsed() >= REGEX_COMPILE_YIELD_TIMEOUT {
            yielder().await;
            if EXPRESSIONS_GENERATION
                .try_with(|generation_cell| generation_cell.get())
                .map_err(Box::new)?
                != generation
            {
                return Err(SetRulesError::Canceled);
            }
            last_yield_time = Instant::now();
        }
    }
    expressions.insert(
        LanguageId::Other,
        hydrate_pattern(&patterns, &rules, default)?,
    );
    EXPRESSIONS
        .try_with(|expressions_cell| {
            expressions_cell.borrow_mut().extend(expressions);
        })
        .map_err(Box::new)?;
    Ok(())
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum SetCommentTokensError {
    #[error("language comments for {language:?} can match empty string")]
    LanguageCommentCanMatchEmptyString { language: String },
    #[error("language comments for {language:?} compilation error: {err}")]
    LanguageCommentCompilationError { language: String, err: String },
    #[error("thread access error: {err}")]
    ThreadAccessError {
        #[from]
        err: Box<std::thread::AccessError>,
    },
    #[error("canceled")]
    Canceled,
}

pub async fn set_comment_tokens<F, Fut>(
    tokens: HashMap<String, CommentTokens>,
    mut yielder: F,
) -> Result<(), SetCommentTokensError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    fn validate_cannot_match_empty(
        regex: Regex,
        language: &str,
    ) -> Result<Regex, SetCommentTokensError> {
        if regex.is_match(Input::new("")) {
            Err(SetCommentTokensError::LanguageCommentCanMatchEmptyString {
                language: language.to_owned(),
            })
        } else {
            Ok(regex)
        }
    }
    let generation = COMMENTS_GENERATION
        .try_with(|generation_cell| {
            let new_generation = generation_cell.get().wrapping_add(1);
            generation_cell.set(new_generation);
            new_generation
        })
        .map_err(Box::new)?;
    COMMENT_TOKENS
        .try_with(|comment_tokens_cell| {
            comment_tokens_cell.borrow_mut().clear();
        })
        .map_err(Box::new)?;
    let mut comment_tokens = HashMap::new();
    let mut last_yield_time = Instant::now();
    for (language, tokens) in tokens {
        let iterator_data = match tokens {
            CommentTokens {
                line_start: None,
                block: None,
            } => continue,
            CommentTokens {
                line_start: Some(line_start),
                block: None,
            } => CommentIteratorData::Line {
                line_start: match Regex::new(&line_start.to_eol().with_flags()) {
                    Ok(regex) => validate_cannot_match_empty(regex, &language)?,
                    Err(err) => {
                        return Err(SetCommentTokensError::LanguageCommentCompilationError {
                            language,
                            err: err.to_string(),
                        });
                    }
                },
            },
            CommentTokens {
                line_start: None,
                block:
                    Some(BlockTokens {
                        block_start,
                        block_end,
                    }),
            } => CommentIteratorData::Block {
                block_start: match Regex::new(&block_start.with_flags()) {
                    Ok(regex) => validate_cannot_match_empty(regex, &language)?,
                    Err(err) => {
                        return Err(SetCommentTokensError::LanguageCommentCompilationError {
                            language,
                            err: err.to_string(),
                        });
                    }
                },
                block_end: match Regex::new(&block_end.with_flags()) {
                    Ok(regex) => validate_cannot_match_empty(regex, &language)?,
                    Err(err) => {
                        return Err(SetCommentTokensError::LanguageCommentCompilationError {
                            language,
                            err: err.to_string(),
                        });
                    }
                },
            },
            CommentTokens {
                line_start: Some(line_start),
                block:
                    Some(BlockTokens {
                        block_start,
                        block_end,
                    }),
            } => CommentIteratorData::Both {
                openers: match Regex::new_many(&[
                    line_start.to_eol().with_flags(),
                    block_start.with_flags(),
                ]) {
                    Ok(regex) => validate_cannot_match_empty(regex, &language)?,
                    Err(err) => {
                        return Err(SetCommentTokensError::LanguageCommentCompilationError {
                            language,
                            err: err.to_string(),
                        });
                    }
                },
                block_end: match Regex::new(&block_end.with_flags()) {
                    Ok(regex) => validate_cannot_match_empty(regex, &language)?,
                    Err(err) => {
                        return Err(SetCommentTokensError::LanguageCommentCompilationError {
                            language,
                            err: err.to_string(),
                        });
                    }
                },
                block_pattern_id: PatternID::must(1),
            },
        };
        comment_tokens.insert(language, iterator_data);
        if last_yield_time.elapsed() >= REGEX_COMPILE_YIELD_TIMEOUT {
            yielder().await;
            if COMMENTS_GENERATION
                .try_with(|generation_cell| generation_cell.get())
                .map_err(Box::new)?
                != generation
            {
                return Err(SetCommentTokensError::Canceled);
            }
            last_yield_time = Instant::now();
        }
    }
    COMMENT_TOKENS
        .try_with(|comment_tokens_cell| {
            comment_tokens_cell.borrow_mut().extend(comment_tokens);
        })
        .map_err(Box::new)?;
    Ok(())
}

#[derive(Clone, Debug)]
enum CommentIteratorData {
    Line {
        line_start: Regex,
    },
    Block {
        block_start: Regex,
        block_end: Regex,
    },
    Both {
        openers: Regex,
        block_end: Regex,
        block_pattern_id: PatternID,
    },
}

#[derive(Clone, Debug)]
struct CommentIterator<'d, 'i> {
    input: Input<regex_cursor::RopeyCursor<'i>>,
    data: &'d CommentIteratorData,
}

impl CommentIterator<'_, '_> {
    fn block_shared(
        &mut self,
        openers: &Regex,
        block_end: &Regex,
        block_pattern_id: PatternID,
    ) -> Option<<Self as Iterator>::Item> {
        let found_start = openers.search(self.input.clone())?;
        self.input.set_start(found_start.end());
        if found_start.pattern() == block_pattern_id {
            match block_end.search(self.input.clone()) {
                Some(found_end) => {
                    self.input.set_start(found_end.end());
                    Some(found_start.start()..found_end.end())
                }
                None => {
                    self.input.set_start(self.input.end());
                    Some(found_start.start()..self.input.end())
                }
            }
        } else {
            Some(found_start.range())
        }
    }
}

impl Iterator for CommentIterator<'_, '_> {
    type Item = std::ops::Range<usize>;

    fn next(&mut self) -> Option<Self::Item> {
        match self.data {
            CommentIteratorData::Line { line_start } => {
                let found = line_start.find(self.input.clone())?;
                self.input.set_start(found.end());
                Some(found.range())
            }
            CommentIteratorData::Block {
                block_start,
                block_end,
            } => self.block_shared(block_start, block_end, PatternID::must(0)),
            CommentIteratorData::Both {
                openers,
                block_end,
                block_pattern_id,
            } => self.block_shared(openers, block_end, *block_pattern_id),
        }
    }
}

pub fn scan_text(
    body: &Rope,
    language: &str,
    include_text: bool,
    utf16_offsets: bool,
) -> Vec<Match> {
    struct OptionalIterator<I>(Option<I>);

    impl<I, II> Iterator for OptionalIterator<I>
    where
        I: Iterator<Item = II>,
    {
        type Item = II;

        fn next(&mut self) -> Option<Self::Item> {
            let result = self.0.as_mut()?.next();
            if result.is_none() {
                self.0 = None;
            }
            result
        }
    }

    EXPRESSIONS.with_borrow(|expressions| {
        COMMENT_TOKENS.with_borrow(|comment_tokens| {
            let pattern = expressions
                .get(&LanguageId::SpecificLanguage(language.to_owned()))
                .unwrap_or_else(|| &expressions[&LanguageId::Other]);
            let comment_regex = comment_tokens.get(language);
            let mut comment_spans_iter = OptionalIterator(comment_regex.map(|comment_regex| {
                // comment_regex.find_iter(Input::new(body)).map(|m| m.range())
                CommentIterator {
                    input: Input::new(body),
                    data: comment_regex,
                }
            }))
            .peekable();
            let mut matches = Vec::new();
            for found in pattern.regex.captures_iter(Input::new(body)) {
                let found_span = found.get_match().expect("missing match").range();
                while comment_spans_iter
                    .peek()
                    .is_some_and(|comment_span| comment_span.end <= found_span.start)
                {
                    comment_spans_iter.next();
                }
                matches.push(Match {
                    rule: pattern.rule_keys
                        [found.pattern().expect("missing pattern id").as_usize()],
                    in_comment: comment_spans_iter.peek().is_some_and(|comment_span| {
                        comment_span.start <= found_span.start && found_span.end <= comment_span.end
                    }),
                    groups: (0..found.group_len())
                        .map(|index| {
                            let range = found.get_group(index).expect("missing group").range();
                            Group {
                                start: match utf16_offsets {
                                    true => body.char_to_utf16_cu(body.byte_to_char(range.start)),
                                    false => range.start,
                                },
                                end: match utf16_offsets {
                                    true => body.char_to_utf16_cu(body.byte_to_char(range.end)),
                                    false => range.end,
                                },
                                text: include_text.then(|| body.slice(range).to_string()),
                            }
                        })
                        .collect(),
                });
            }
            matches
        })
    })
}

pub fn set_document<P, B, L>(path: P, body: B, language: L)
where
    P: Into<String>,
    B: Into<Rope>,
    L: Into<String>,
{
    let path = path.into();
    let body = body.into();
    let language = language.into();
    OPEN_DOCUMENTS.with_borrow_mut(|open_documents| {
        open_documents.insert(
            path,
            Document {
                body,
                dirty: true,
                language,
            },
        );
    })
}

#[derive(Clone, Debug, thiserror::Error)]
#[error("path not found {path:?}")]
pub struct PathNotFoundError {
    pub path: String,
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum UpdateDocumentError {
    #[error(transparent)]
    PathNotFound(#[from] PathNotFoundError),
    #[error("change indices out of range {path:?}: {ropey_error}")]
    RangeError {
        path: String,
        ropey_error: ropey::Error,
    },
}

pub fn update_document(
    path: &str,
    changes: &[VsTextDocumentContentChangeEvent],
) -> Result<(), UpdateDocumentError> {
    OPEN_DOCUMENTS.with_borrow_mut(|open_documents| {
        let document = open_documents
            .get_mut(path)
            .ok_or_else(|| PathNotFoundError {
                path: path.to_owned(),
            })?;
        document.dirty = true;
        let entry_rope = &mut document.body;
        for change in changes {
            let start = entry_rope.utf16_cu_to_char(change.range_offset);
            let end = entry_rope.utf16_cu_to_char(change.range_offset + change.range_length);
            entry_rope.try_remove(start..end).map_err(|ropey_error| {
                UpdateDocumentError::RangeError {
                    path: path.to_owned(),
                    ropey_error,
                }
            })?;
            entry_rope
                .try_insert(start, &change.text)
                .map_err(|ropey_error| UpdateDocumentError::RangeError {
                    path: path.to_owned(),
                    ropey_error,
                })?;
        }
        Ok(())
    })
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum ScanDocumentError {
    #[error(transparent)]
    PathNotFound(#[from] PathNotFoundError),
}

pub fn scan_document(
    path: &str,
    include_text: bool,
    utf16_offsets: bool,
) -> Result<Vec<Match>, ScanDocumentError> {
    OPEN_DOCUMENTS.with_borrow_mut(|open_documents| {
        let document = open_documents
            .get_mut(path)
            .ok_or_else(|| PathNotFoundError {
                path: path.to_owned(),
            })?;
        Ok(scan_text(
            &document.body,
            &document.language,
            include_text,
            utf16_offsets,
        ))
    })
}

pub fn close_document(path: &str) {
    OPEN_DOCUMENTS.with_borrow_mut(|open_documents| {
        open_documents.remove(path);
    })
}

pub fn is_pattern_valid(pattern: Pattern) -> bool {
    pattern
        .can_compile_and_not_match_empty()
        .unwrap_or_default()
}

#[derive(serde::Serialize, Tsify)]
#[tsify(type_params = "T")]
pub enum ResultJs<T> {
    Ok(T),
    Err(String),
}

#[derive(serde::Serialize, Tsify)]
#[repr(transparent)]
pub struct ResultJsVoid(ResultJs<()>);

impl ResultJsVoid {
    fn new<E>(result: Result<(), E>) -> Ts<Self>
    where
        E: ToString,
    {
        match result {
            Ok(()) => Self(ResultJs::Ok(())),
            Err(e) => Self(ResultJs::Err(e.to_string())),
        }
        .into_ts()
        .expect("to JSON should never fail")
    }

    fn new_err<E>(error: E) -> Ts<Self>
    where
        E: ToString,
    {
        Self(ResultJs::Err(error.to_string()))
            .into_ts()
            .expect("to JSON should never fail")
    }
}

#[derive(serde::Serialize, Tsify)]
#[repr(transparent)]
pub struct ResultJsMatches(ResultJs<Matches>);

impl ResultJsMatches {
    fn new<E>(result: Result<Vec<Match>, E>) -> Ts<Self>
    where
        E: ToString,
    {
        match result {
            Ok(matches) => Self(ResultJs::Ok(Matches(matches))),
            Err(e) => Self(ResultJs::Err(e.to_string())),
        }
        .into_ts()
        .expect("to JSON should never fail")
    }
}

#[wasm_bindgen(js_name = "setRules")]
pub async fn set_rules_js(config: Ts<RulesConfig>) -> Ts<ResultJsVoid> {
    let config = match config.to_rust() {
        Ok(config) => config,
        Err(error) => {
            return ResultJsVoid::new_err(error);
        }
    };
    ResultJsVoid::new(set_rules(config, || gloo_timers::future::TimeoutFuture::new(0)).await)
}

#[wasm_bindgen(js_name = "setCommentTokens")]
pub async fn set_comment_tokens_js(tokens: Ts<CommentTokensConfig>) -> Ts<ResultJsVoid> {
    let tokens = match tokens.to_rust() {
        Ok(tokens) => tokens,
        Err(error) => {
            return ResultJsVoid::new_err(error);
        }
    };
    ResultJsVoid::new(
        set_comment_tokens(tokens.0, || gloo_timers::future::TimeoutFuture::new(0)).await,
    )
}

#[wasm_bindgen(js_name = "scanText")]
pub fn scan_text_js(body: &str, language: &str, include_text: bool) -> Ts<Matches> {
    let body = body.into();
    Matches(scan_text(&body, language, include_text, true))
        .into_ts()
        .expect("to JSON should never fail")
}

#[wasm_bindgen(js_name = "setDocument")]
pub fn set_document_js(path: &str, body: &str, language: &str) {
    set_document(path, body, language);
}

#[wasm_bindgen(js_name = "updateDocument")]
pub fn update_document_js(
    path: &str,
    changes: Ts<VsTextDocumentContentChangeEvents>,
) -> Ts<ResultJsVoid> {
    let changes = match changes.to_rust() {
        Ok(changes) => changes,
        Err(error) => {
            return ResultJsVoid::new_err(error);
        }
    };
    ResultJsVoid::new(update_document(path, &changes.0))
}

#[wasm_bindgen(js_name = "scanDocument")]
pub fn scan_document_js(path: &str, include_text: bool) -> Ts<ResultJsMatches> {
    ResultJsMatches::new(scan_document(path, include_text, true))
}

#[wasm_bindgen(js_name = "closeDocument")]
pub fn close_document_js(path: &str) {
    close_document(path);
}

#[wasm_bindgen(js_name = "isPatternValid")]
pub fn is_pattern_valid_js(pattern: Ts<Pattern>) -> bool {
    pattern.to_rust().is_ok_and(|pattern| {
        pattern
            .can_compile_and_not_match_empty()
            .unwrap_or_default()
    })
}

#[wasm_bindgen(start, private)]
fn init_js() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[cfg(test)]
mod tests {
    use std::fmt::Write;

    use rand::{RngExt, seq::IndexedRandom};

    use super::*;

    const INCLUDE_TEXT: bool = true;
    const UTF16_OFFSETS: bool = true;

    #[test]
    fn scan_text_test_10() {
        scan_text_test_::<10>();
    }

    #[test]
    fn scan_text_test_100() {
        scan_text_test_::<100>();
    }

    #[test]
    fn scan_text_test_1_000() {
        scan_text_test_::<1_000>();
    }

    #[test]
    fn scan_text_test_10_000() {
        scan_text_test_::<10_000>();
    }

    #[test]
    fn scan_text_test_100_000() {
        scan_text_test_::<100_000>();
    }

    #[test]
    fn scan_text_test_1_000_000() {
        scan_text_test_::<1_000_000>();
    }

    fn scan_text_test_<const N: usize>() {
        let (comment_tokens, rules, expected_spans, body) = generate_synthetic_source(
            "//",
            "/*",
            "*/",
            &["BUG", "FIXME", "HACK", "TODO", "XXX", "[ ]", "[x]"],
            N,
            35,
            30,
            25,
        );
        scan_text_test(comment_tokens, rules, &expected_spans, &body);
        println!();
    }

    #[allow(clippy::too_many_arguments)]
    fn generate_synthetic_source(
        line_comment_start: &str,
        block_comment_start: &str,
        block_comment_end: &str,
        terms: &[&str],
        line_count: usize,
        comment_percentage: u8,
        term_percentage: u8,
        block_comment_percentage: u8,
    ) -> (
        HashMap<String, CommentTokens>,
        RulesConfig,
        Vec<SyntheticSpan>,
        String,
    ) {
        assert!(!line_comment_start.is_empty());
        assert!(!block_comment_start.is_empty());
        assert!(!block_comment_end.is_empty());
        assert!(!terms.is_empty());
        assert_ne!(line_count, 0);
        const PHRASES: &[&str] = &[
            "initialize the runtime context",
            "resolve the dependency graph",
            "update the current transaction",
            "validate the configuration value",
            "process the incoming payload",
            "calculate the next sequence number",
            "load the resource descriptor",
            "return the normalized result",
            "apply the transformation rule",
            "synchronize the local state",
            "dispatch the pending operation",
            "compare the expected value",
            "build the execution context",
            "flush the buffered output",
            "read the metadata record",
        ];
        const IDENTIFIERS: &[&str] = &[
            "context",
            "payload",
            "descriptor",
            "result",
            "transaction",
            "sequence",
            "metadata",
            "handler",
            "resource",
            "operation",
            "configuration",
            "state",
        ];
        let mut term_spans = Vec::new();
        let mut inside_block = false;
        let mut text = String::new();
        let mut rng = rand::rng();
        fn random_term(
            text: &mut String,
            rng: &mut dyn rand::Rng,
            term_spans: &mut Vec<SyntheticSpan>,
            in_comment: bool,
            term_percentage: u8,
            terms: &[&str],
        ) {
            if rng.random_range(0..100) < term_percentage {
                let term_index = rng.random_range(0..terms.len());
                let term = terms[term_index];
                write!(text, " ").unwrap();
                let term_start = text.len();
                write!(text, "{term}").unwrap();
                term_spans.push(SyntheticSpan {
                    term: term_index as _,
                    in_comment,
                    file_offset: term_start,
                });
            }
        }
        for i in 1..=line_count {
            if !inside_block
                && rng.random_range(0..100) < block_comment_percentage
                && i != line_count
            {
                inside_block = true;
                write!(
                    &mut text,
                    "{block_comment_start} synthetic block begins at line {i}"
                )
                .unwrap();
                random_term(
                    &mut text,
                    &mut rng,
                    &mut term_spans,
                    true,
                    term_percentage,
                    terms,
                );
            } else if inside_block {
                write!(&mut text, " * {}", PHRASES.choose(&mut rng).unwrap()).unwrap();
                random_term(
                    &mut text,
                    &mut rng,
                    &mut term_spans,
                    true,
                    term_percentage,
                    terms,
                );
                if rng.random_range(0..100) < 30 || i == line_count {
                    write!(&mut text, " {block_comment_end}").unwrap();
                    inside_block = false;
                }
            } else {
                write!(
                    &mut text,
                    "{} = invoke operation \"{}\";",
                    IDENTIFIERS.choose(&mut rng).unwrap(),
                    PHRASES.choose(&mut rng).unwrap()
                )
                .unwrap();
                random_term(
                    &mut text,
                    &mut rng,
                    &mut term_spans,
                    false,
                    term_percentage,
                    terms,
                );
                if rng.random_range(0..100) < comment_percentage {
                    write!(
                        &mut text,
                        " {line_comment_start} {}",
                        PHRASES.choose(&mut rng).unwrap()
                    )
                    .unwrap();
                    random_term(
                        &mut text,
                        &mut rng,
                        &mut term_spans,
                        true,
                        term_percentage,
                        terms,
                    );
                }
            }
            writeln!(&mut text).unwrap();
        }
        (
            [(
                "c".to_owned(),
                CommentTokens {
                    line_start: Some(Pattern {
                        pattern: line_comment_start.to_owned(),
                        literal: true,
                        ..Default::default()
                    }),
                    block: Some(BlockTokens {
                        block_start: Pattern {
                            pattern: block_comment_start.to_owned(),
                            literal: true,
                            ..Default::default()
                        },
                        block_end: Pattern {
                            pattern: block_comment_end.to_owned(),
                            literal: true,
                            ..Default::default()
                        },
                    }),
                },
            )]
            .into_iter()
            .collect(),
            RulesConfig {
                patterns: terms
                    .iter()
                    .enumerate()
                    .map(|(index, &term)| {
                        (
                            PatternKey(index as _),
                            Pattern {
                                pattern: term.to_owned(),
                                literal: true,
                                ..Default::default()
                            },
                        )
                    })
                    .collect(),
                rules: (0..terms.len())
                    .map(|index| {
                        (
                            RuleKey(index as _),
                            Rule {
                                pattern: PatternKey(index as _),
                                languages: LanguageApplicability::All,
                            },
                        )
                    })
                    .collect(),
            },
            term_spans,
            text,
        )
    }

    #[derive(Clone, Debug)]
    struct SyntheticSpan {
        term: u32,
        in_comment: bool,
        file_offset: usize,
    }

    fn scan_text_test(
        comment_tokens: HashMap<String, CommentTokens>,
        rules: RulesConfig,
        expected_spans: &[SyntheticSpan],
        body: &str,
    ) {
        let start_instant = std::time::Instant::now();
        futures::executor::block_on(set_rules(rules, || async {})).unwrap();
        futures::executor::block_on(set_comment_tokens(comment_tokens, || async {})).unwrap();

        let mut new_instant = std::time::Instant::now();
        println!("config loaded total {:?}", new_instant - start_instant);
        let mut previous_instant = new_instant;

        let body = Rope::from_str(body);

        new_instant = std::time::Instant::now();
        println!(
            "rope built total {:?} delta {:?}",
            new_instant - start_instant,
            new_instant - previous_instant
        );
        previous_instant = new_instant;

        let matches = scan_text(&body, "c", INCLUDE_TEXT, UTF16_OFFSETS);

        new_instant = std::time::Instant::now();
        println!(
            "matches scanned total {:?} delta {:?}",
            new_instant - start_instant,
            new_instant - previous_instant
        );
        previous_instant = new_instant;

        for (index, found) in matches.into_iter().enumerate() {
            let expected_span = &expected_spans[index];
            assert_eq!(
                (
                    index,
                    &expected_span.term,
                    expected_span.in_comment,
                    expected_span.file_offset
                ),
                (
                    index,
                    &found.rule.0,
                    found.in_comment,
                    found.groups[0].start
                ),
                "tag: {:?}, line: {:?}",
                found.groups[0].text,
                body.line(body.byte_to_line(found.groups[0].start))
            );
        }

        new_instant = std::time::Instant::now();
        println!(
            "matches confirmed total {:?} delta {:?}",
            new_instant - start_instant,
            new_instant - previous_instant
        );
    }
}
