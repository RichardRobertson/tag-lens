import * as child_process from "node:child_process";
import { Readable } from "node:stream";
import { rgPath } from "@vscode/ripgrep";
import * as vscode from "vscode";
import { makeMatch, type SearchProvider, type SearchQuery, type TagMatch } from ".";

export class RipgrepProvider implements SearchProvider {
    supports(uri: vscode.Uri): boolean {
        return uri.scheme === "file";
    }

    async *search(
        folder: vscode.WorkspaceFolder,
        query: SearchQuery,
        token: vscode.CancellationToken
    ): AsyncIterable<TagMatch> {
        const args: string[] = ["--json", "--line-number"];
        if (query.maxResults !== undefined) {
            args.push("-m", query.maxResults.toString());
        }
        for (const tag of query.tags) {
            if (tag.pattern === undefined) {
                continue;
            }
            args.push("-e");
            if (tag.isRegex) {
                args.push(tag.pattern);
            } else {
                args.push(escapeRegExp(tag.pattern));
            }
        }
        args.push(folder.uri.fsPath);
        const rg = child_process.spawn(rgPath, args, { stdio: ["ignore", "pipe", "ignore"] });
        token.onCancellationRequested(() => {
            rg.kill();
        });
        for await (const line of streamLines(rg.stdout)) {
            const jsonLine = JSON.parse(line) as RipgrepMatch;
            if (jsonLine.type === "match") {
                const uri = vscode.Uri.file(decode(jsonLine.data.path));
                const lineNumber = jsonLine.data.line_number - 1;
                const lineText = decode(jsonLine.data.lines);
                const ranges = utf8RangesToCharRanges(
                    lineText,
                    jsonLine.data.submatches.flatMap((subMatch, index): ByteTarget[] => {
                        return [
                            { byte: subMatch.start, kind: "start", index },
                            { byte: subMatch.end, kind: "end", index },
                        ];
                    })
                );
                outer: for (const [start, end] of ranges) {
                    const sliceText = lineText.slice(start, end);
                    for (let tagIndex = 0; tagIndex < query.tags.length; tagIndex++) {
                        const tag = query.tags[tagIndex];
                        if (tag.pattern === undefined) {
                            continue;
                        }
                        if (tag.isRegex) {
                            const regex = new RegExp(tag.pattern);
                            const match = regex.exec(sliceText);
                            if (match !== null) {
                                match.index = start;
                                yield {
                                    uri,
                                    range: new vscode.Range(lineNumber, start, lineNumber, end),
                                    match,
                                    tagIndex,
                                };
                                continue outer;
                            }
                        } else if (sliceText === tag.pattern) {
                            yield {
                                uri,
                                range: new vscode.Range(lineNumber, start, lineNumber, end),
                                match: makeMatch(tag.pattern, start, lineText),
                                tagIndex,
                            };
                            continue outer;
                        }
                    }
                    console.warn("Match returned from ripgrep that did not match any tags");
                }
            }
        }
    }
}

interface ByteTarget {
    byte: number;
    kind: "start" | "end";
    index: number;
}

function utf8RangesToCharRanges(line: string, targets: ByteTarget[]): [number, number][] {
    targets.sort((a, b) => a.byte - b.byte);
    const starts: number[] = [];
    const ends: number[] = [];
    let bytePos = 0;
    let charIndex = 0;
    let targetsIndex = 0;
    for (let i = 0; i < line.length; i++) {
        const cp = line.codePointAt(i);
        if (cp === undefined) {
            break;
        }
        const byteLen = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
        while (targetsIndex < targets.length && bytePos >= targets[targetsIndex].byte) {
            const target = targets[targetsIndex];
            if (target.kind === "start") {
                starts[target.index] = charIndex;
            } else {
                ends[target.index] = charIndex;
            }
            targetsIndex++;
        }
        bytePos += byteLen;
        charIndex++;
        if (cp > 0xffff) {
            i++;
        }
    }
    while (targetsIndex < targets.length) {
        const target = targets[targetsIndex];
        const pos = charIndex;

        if (target.kind === "start") {
            starts[target.index] = pos;
        } else {
            ends[target.index] = pos;
        }

        targetsIndex++;
    }
    const result: [number, number][] = [];
    for (let i = 0; i < starts.length; i++) {
        result.push([starts[i] ?? 0, ends[i] ?? line.length]);
    }
    return result;
}

async function* streamLines(stream: Readable): AsyncIterable<string> {
    const webStream = Readable.toWeb(stream);
    const textStream = webStream.pipeThrough(new TextDecoderStream());
    let buffer = "";
    for await (const chunk of textStream) {
        buffer += chunk;
        let start = 0;
        while (true) {
            const idx = buffer.indexOf("\n", start);
            if (idx === -1) {
                break;
            }
            let line = buffer.slice(start, idx);
            if (line.endsWith("\r")) {
                line = line.slice(0, -1);
            }
            yield line;
            start = idx + 1;
        }
        buffer = buffer.slice(start);
    }
    if (buffer.length > 0) {
        if (buffer.endsWith("\r")) {
            buffer = buffer.slice(0, -1);
        }
        yield buffer;
    }
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RipgrepMatch {
    type: "match";
    data: {
        path: TextOrBytes;
        lines: TextOrBytes;
        line_number: number;
        submatches: SubMatch[];
    };
}

interface SubMatch {
    match: TextOrBytes;
    start: number;
    end: number;
}

type TextOrBytes = Text | Bytes;

// normal string
interface Text {
    text: string;
}

// base64 string of non-UTF-8 bytes
interface Bytes {
    bytes: string;
}

function decode(value: TextOrBytes): string {
    if ("text" in value) {
        return value.text;
    } else {
        // HACK
        return Buffer.from(value.bytes, "base64").toString();
    }
}
