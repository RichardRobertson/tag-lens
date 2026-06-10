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

interface Node<T> {
    previous?: Node<T>;
    next?: Node<T>;
    value: T;
}

export class WorkQueue<T, K extends string | number | symbol> {
    private head: Node<T> | undefined;
    private tail: Node<T> | undefined;
    private readonly map = new Map<K, Node<T>>();

    constructor(readonly keyFor: (value: T) => K) {}

    clear(): void {
        this.head = undefined;
        this.tail = undefined;
        this.map.clear();
    }

    enqueue(value: T, priority: boolean = false): void {
        const key = this.keyFor(value);
        const existingNode = this.map.get(key);
        if (existingNode !== undefined) {
            if (!priority || existingNode.previous === undefined) {
                return;
            }
            this.detach(existingNode);
            assert(this.head);
            this.insertNodeBefore(existingNode, this.head);
            return;
        }
        const newNode: Node<T> = { value };
        if (this.head === undefined || this.tail === undefined) {
            this.head = newNode;
            this.tail = newNode;
            this.map.set(key, newNode);
        } else if (priority) {
            this.insertNodeBefore(newNode, this.head);
        } else {
            this.insertNodeAfter(newNode, this.tail);
        }
    }

    cancel(value: T): boolean {
        const key = this.keyFor(value);
        const existingNode = this.map.get(key);
        if (existingNode === undefined) {
            return false;
        }
        this.remove(existingNode);
        return true;
    }

    cancelWhere(predicate: (value: T) => boolean): void {
        let current = this.head;
        while (current !== undefined) {
            if (predicate(current.value)) {
                const next = current.next;
                this.remove(current);
                current = next;
            } else {
                current = current.next;
            }
        }
    }

    pop(): T | undefined {
        if (this.head === undefined) {
            return undefined;
        }
        return this.remove(this.head);
    }

    count(): number {
        let count = 0;
        let current = this.head;
        while (current !== undefined) {
            count += 1;
            current = current.next;
        }
        return count;
    }

    isEmpty(): boolean {
        return this.head === undefined;
    }

    debugDump(): void {
        const result: K[] = [];
        let current = this.head;
        while (current !== undefined) {
            result.push(this.keyFor(current.value));
            current = current.next;
        }
        trace({ id: "WorkQueue.debugDump", result });
    }

    private detach(node: Node<T>): void {
        if (node === this.head) {
            this.head = node.next;
        }
        if (node === this.tail) {
            this.tail = node.previous;
        }
        const { previous, next } = node;
        if (previous !== undefined) {
            previous.next = next;
        }
        if (next !== undefined) {
            next.previous = previous;
        }
        node.previous = undefined;
        node.next = undefined;
    }

    private remove(node: Node<T>): T {
        this.detach(node);
        this.map.delete(this.keyFor(node.value));
        return node.value;
    }

    private insertNodeAfter(newNode: Node<T>, after: Node<T>): void {
        this.map.set(this.keyFor(newNode.value), newNode);
        if (after === this.tail) {
            this.tail = newNode;
        }
        const next = after.next;
        if (next !== undefined) {
            next.previous = newNode;
        }
        after.next = newNode;
        newNode.previous = after;
        newNode.next = next;
    }

    private insertNodeBefore(newNode: Node<T>, before: Node<T>): void {
        this.map.set(this.keyFor(newNode.value), newNode);
        if (before === this.head) {
            this.head = newNode;
        }
        const previous = before.previous;
        if (previous !== undefined) {
            previous.next = newNode;
        }
        before.previous = newNode;
        newNode.previous = previous;
        newNode.next = before;
    }
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
