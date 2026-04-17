import * as child_process from "node:child_process";
import { Readable } from "node:stream";
import { rgPath } from "@vscode/ripgrep";
import * as vscode from "vscode";
import type { SearchProvider, SearchQuery, TagMatch } from ".";

export class RipgrepProvider implements SearchProvider {
    supports(uri: vscode.Uri): boolean {
        return uri.scheme === "file";
    }

    async *search(
        folder: vscode.WorkspaceFolder,
        query: SearchQuery,
        token: vscode.CancellationToken
    ): AsyncIterable<TagMatch> {
        const args: string[] = ["--json", "--line_numbers"];
        if (query.maxResults !== undefined) {
            args.push("-m", query.maxResults.toString());
        }
        for (const pattern of query.patterns) {
            args.push("-e");
            if (pattern.isRegex) {
                args.push(pattern.value);
            } else {
                args.push(escapeRegExp(pattern.value));
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
                const uri = vscode.Uri.file(decode(jsonLine.path));
                const lineNumber = jsonLine.line_number;
                const lineText = decode(jsonLine.lines);
                const ranges = utf8RangesToCharRanges(
                    lineText,
                    jsonLine.submatches.flatMap((subMatch, index): ByteTarget[] => {
                        return [
                            { byte: subMatch.start, kind: "start", index },
                            { byte: subMatch.end, kind: "end", index },
                        ];
                    })
                );
                for (const [start, end] of ranges) {
                    yield { uri, range: new vscode.Range(lineNumber, start, lineNumber, end) };
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
    path: TextOrBytes;
    lines: TextOrBytes;
    line_number: number;
    submatches: SubMatch[];
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
