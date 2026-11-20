<!-- https://mermaid.js.org/syntax/sequenceDiagram.html -->

# Normal process

- **Editor:** event source from opening and closing files
- **Extension:** process orchestrator
- **Scanner:** background/async task queue that operates on a prebuilt config object
- **Tree:** the data storage and cache

```mermaid
sequenceDiagram
    participant Editor@{ "type": "boundary" }
    participant EXT@{ "type": "control" } as Extension
    participant Scanner@{ "type": "queue" }
    participant Tree@{ "type": "database" }
    loop
        rect rgba(128, 128, 128, 0.25)
            alt config change
                rect rgba(128, 128, 128, 0.25)
                    EXT--)Scanner: Pause, cancel in-flight, and clear queue
                    Scanner->>Scanner: Cancel current and clear pending queue
                    Scanner->>Tree: Clear all cache
                    Scanner--)Scanner: Wait for resume
                    EXT--)Scanner: Resume with new config
                end
            else file watcher new/changed
                rect rgba(128, 128, 128, 0.25)
                    Editor--)Scanner: New background file or<br/>Changed background file
                    Scanner->>Scanner: Add file to tail of queue
                end
            else file watcher deleted
                rect rgba(128, 128, 128, 0.25)
                    Editor--)Scanner: Delete file
                    Scanner->>Scanner: Remove from queue
                    Scanner->>Tree: Remove from tree
                end
            else editor new/changed
                rect rgba(128, 128, 128, 0.25)
                    Editor--)Scanner: Opened editor or<br/>Modified editor
                    Scanner->>Scanner: Add file to head of queue
                end
            else else
                rect rgba(128, 128, 128, 0.25)
                    EXT->>Scanner: doOneWork
                    Scanner->>Scanner: Pop file URI
                    Scanner->>Tree: Invalidate cache for URI
                    Scanner--)Scanner: Read file contents
                    Scanner->>Scanner: Regex scan file contents
                    Scanner->>Tree: Assign matches
                end
            end
        end
    end
```

# Config update

- **User:** event source from command palette, hotkey, UI button, etc
- **Config File Watcher:** event source from create/change/delete config file path
- **Extension:** process orchestrator
- **Config:** the data storage and schema
- **Scanner:** background/async task queue that operates on a prebuilt config object

```mermaid
sequenceDiagram
    participant User@{ "type": "actor" }
    participant CFW@{ "type": "boundary" } as Config File Watcher
    participant EXT@{ "type": "control" } as Extension
    participant Config@{ "type": "database" }
    participant Scanner@{ "type": "queue" }
    activate EXT
    loop debounce sources
        rect rgba(128, 128, 128, 0.25)
            alt
                rect rgba(128, 128, 128, 0.25)
                    User->>EXT: Invoke
                end
            else
                rect rgba(128, 128, 128, 0.25)
                    CFW->>EXT: File change event
                end
            end
        end
    end
    EXT--)EXT: Debounce
    deactivate EXT
    EXT--)Scanner: Pause, cancel in-flight, and clear queue
    activate Scanner
    Scanner->>EXT: Quiesce
    loop until no additional file change event
        rect rgba(128, 128, 128, 0.25)
            EXT->>Config: Reload
            activate Config
            Config--)Config: Read file
            Config->>Config: Parse and validate with Zod
            Config->>EXT: New config object
            deactivate Config
            User--xEXT: Discard any pending invoke
            CFW->>EXT: Check pending file change event
        end
    end
    EXT->>Scanner: Resume with new config object
    deactivate Scanner
```

# Whole Extension

```mermaid
flowchart TD
    A[Initialize extension] --> B[Load regexes, comment tokens, policy]
    B --> C[Register event listeners]
    C --> D[Register open text documents]
    C --> E[Enumerate workspace files]
    D --> F[Update inventory and queues]
    E --> F

    F --> G{New event or pending work?}
    G -->|No| G
    G -->|Yes| H[Normalize event and coalesce duplicates]

    H --> I{Event type}
    I -->|Document edit| J[Increment document generation]
    I -->|Focus or open/close| K[Update document priority]
    I -->|Filesystem event| L[Reconcile file identity and state]
    I -->|Regex config change| M[Increment regex generation]
    I -->|Comment token change| N[Increment comment generation]
    I -->|Importance/range change| O[Increment policy generation]
    I -->|Scheduler wake up| T

    J --> P[Invalidate affected results and enqueue]
    K --> Q[Reprioritize pending work]
    L --> P
    M --> R[Invalidate all dependent results]
    N --> R
    O --> R
    R --> S[Queue affected documents]
    P --> T[Scheduler]
    Q --> T
    S --> T

    T --> U{Interactive work pending?}
    U -->|Yes| V[Select highest-priority open document]
    U -->|No| W[Select background document fairly]
    V --> X[Capture snapshot and generations]
    W --> X

    X --> Y[Run line-safe and whole-document regex paths]
    Y --> Z[Classify comment context and apply policy]
    Z --> AA{Snapshot and generations current?}
    AA -->|Yes| AB[Publish complete results]
    AA -->|No| AC[Discard stale output and requeue]

    AB --> G
    AC --> G
```
