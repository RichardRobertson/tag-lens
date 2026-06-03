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
    alt
    EXT--)Scanner: Pause, cancel in-flight, and clear queue
    Scanner->>Scanner: Cancel current and clear pending queue
    Scanner->>Tree: Clear all cache
    Scanner--)Scanner: Wait for resume
    EXT--)Scanner: Resume with new config
    else
    Editor--)Scanner: New background file or<br/>Changed background file
    Scanner->>Scanner: Add file to tail of queue
    else
    Editor--)Scanner: Delete file
    Scanner->>Scanner: Remove from queue
    Scanner->>Tree: Remove from tree
    else
    Editor--)Scanner: Opened editor or<br/>Modified editor
    Scanner->>Scanner: Add file to head of queue
    else
    EXT->>Scanner: doOneWork
    Scanner->>Scanner: Pop file URI
    Scanner->>Tree: Invalidate cache for URI
    Scanner--)Scanner: Read file contents
    Scanner->>Scanner: Regex scan file contents
    Scanner->>Tree: Assign matches
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
    alt
    User->>EXT: Invoke
    else
    CFW->>EXT: File change event
    end
    end
    EXT--)EXT: Debounce
    deactivate EXT
    EXT--)Scanner: Pause, cancel in-flight, and clear queue
    activate Scanner
    Scanner->>EXT: Quiesce
    loop until no additional file change event
    EXT->>Config: Reload
    activate Config
    Config--)Config: Read file
    Config->>Config: Parse and validate with Zod
    Config->>EXT: New config object
    deactivate Config
    User--xEXT: Discard any pending invoke
    CFW->>EXT: Check pending file change event
    end
    EXT->>Scanner: Resume with new config object
    deactivate Scanner
```
