import { ErrorBoundary, type FallbackProps, getErrorMessage } from "react-error-boundary";

function getStackTrace(error: unknown): string {
    return error instanceof Error && error.stack !== undefined ? error.stack : "<no stack trace>";
}

export interface RootProps {
    children?: React.ReactNode;
}

export function Root({ children }: RootProps): React.JSX.Element {
    return (
        <ErrorBoundary
            fallbackRender={({ error }: FallbackProps): React.JSX.Element => (
                <>
                    <h1 style={{ color: "var(--vscode-errorForeground)" }}>
                        {getErrorMessage(error)}
                    </h1>
                    <pre>{getStackTrace(error)}</pre>
                </>
            )}
        >
            {children}
        </ErrorBoundary>
    );
}
