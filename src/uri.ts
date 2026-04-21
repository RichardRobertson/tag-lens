import { normalize } from "node:path/posix";
import type { Uri } from "vscode";

export function isParent(parent: Uri, child: Uri, options?: { inclusive?: boolean }): boolean {
    if (parent.scheme !== child.scheme || parent.authority !== child.authority) {
        return false;
    }
    const parentPath = normalize(parent.path);
    const childPath = normalize(child.path);
    if (options?.inclusive && parentPath === childPath) {
        return true;
    }
    if (!childPath.startsWith(parentPath)) {
        return false;
    }
    return childPath[parentPath.length] === "/";
}
