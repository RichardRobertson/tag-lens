export type ScrollableProps = React.ComponentProps<"div">;

export function Scrollable({ ref, children, style, ...props }: ScrollableProps): React.JSX.Element {
    return (
        <div
            ref={ref}
            {...props}
            style={{
                overflow: "auto",
                ...style,
            }}
        >
            {children}
        </div>
    );
}
