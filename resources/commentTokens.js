const vscode = acquireVsCodeApi();

document.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    vscode.postMessage({
        type: "apply",
        data: Object.fromEntries(new FormData(form)),
    });
});
