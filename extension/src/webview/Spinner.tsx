import "@vscode-elements/elements/dist/vscode-progress-ring";

export interface SpinnerProps {
    showSpinner?: boolean;
    children?: React.ReactNode;
}

export function Spinner({ showSpinner, children }: SpinnerProps): React.JSX.Element {
    if (showSpinner) {
        return (
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100vh",
                }}
            >
                <vscode-progress-ring />
            </div>
        );
    } else {
        return <>{children}</>;
    }
}
