import assert from "node:assert";
import type { RE2JS } from "re2js";

export function resolveTemplate(template: string, match: RegExpExecArray): string {
    const groups = match.groups ?? {};
    return template.replace(/\$(\$|&|`|'|<[^>]+>|\d+)/g, (token) => {
        switch (token) {
            case "$$":
                return "$";
            case "$&":
                return match[0];
            case "$`":
                return match.input.slice(0, match.index);
            case "$'":
                return match.input.slice(match.index + match[0].length);
        }
        if (/^\$\d+$/.test(token)) {
            return match[Number(token.slice(1))] ?? "";
        }
        if (token.startsWith("$<") && token.endsWith(">")) {
            const name = token.slice(2, -1);
            return groups[name] ?? "";
        }
        return token;
    });
}

export function* concatIterables<T>(...iterables: Iterable<T>[]): IterableIterator<T> {
    for (const iterable of iterables) {
        yield* iterable;
    }
}

const TraceIndex: unique symbol = Symbol("traceIndex");

let traceIndex = 0;

export function trace<T>(value: T): void {
    console.dir({ [TraceIndex]: traceIndex, ...value }, { depth: null });
    traceIndex++;
}

export function* re2jsMatchAllWithIndices(
    regex: RE2JS,
    input: string
): Generator<RegExpExecArray, void, unknown> {
    const m = regex.matcher(input);
    while (m.find()) {
        const group0 = m.group(0);
        assert(group0 !== null);
        const result: RegExpExecArray = [group0] as RegExpExecArray;
        const indices: RegExpIndicesArray = [[m.start(0), m.end(0)]];
        for (let i = 1; i <= m.groupCount(); i++) {
            const groupVal = m.group(i);
            if (groupVal === null) {
                // non-participating groups should be `undefined` according to ECMAScript spec, but TypeScript wants a string
                result.push(undefined as unknown as string);
                indices.push(undefined);
            } else {
                result.push(groupVal);
                indices.push([m.start(i), m.end(i)]);
            }
        }
        result.index = m.start(0);
        result.input = input;
        const namedGroups = regex.namedGroups();
        if (Object.keys(namedGroups).length > 0) {
            indices.groups = {};
            const parsedGroups: Record<string, string | null | undefined> = m.getNamedGroups();
            for (const key of Object.keys(parsedGroups)) {
                if (parsedGroups[key] === null) {
                    parsedGroups[key] = undefined;
                } else {
                    indices.groups[key] = [m.start(key), m.end(key)];
                }
            }
            result.groups = parsedGroups as Record<string, string>;
        } else {
            result.groups = undefined;
        }
        result.indices = indices;
        yield result;
    }
}
