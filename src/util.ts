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
