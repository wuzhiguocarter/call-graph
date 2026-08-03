# Change Log

## [1.6.0] 2026-08-03

-   Added click to source: every diagram element jumps to the code it was drawn for
    -   Call graph: a node opens its function
    -   Class diagram: a class box opens the symbol it was inferred from, a method row opens that method
    -   Type hierarchy: a node opens the declaration of the type
    -   Sequence diagram: a participant or its lifeline opens its file, a message opens the function that is called
    -   The position is written to a `<diagram>.map.json` next to the diagram, so a restored panel stays navigable
    -   Panning the diagram no longer counts as a click, so dragging never jumps away
-   The sequence and class diagram views now use the bundled Mermaid library instead of loading 11.4.1 from a CDN, so every view renders offline and with the same version

## [1.5.0] 2026-08-03

-   Render incoming and outgoing call graphs with Mermaid instead of Graphviz
    -   Call graphs are generated as a Mermaid `flowchart LR`, with one subgraph per file and one edge per call
    -   The call graph view got the same toolbar as the other diagram views: zoom, best fit, SVG export and Mermaid source download
    -   `save dot file` is gone, the diagram source is now downloaded as a `.mmd` file
    -   Dropped the D3, d3-graphviz and Graphviz WASM dependencies, the bundled Mermaid library replaces them and keeps the view working without network access

## [1.4.0] 2026-08-02

-   Added type hierarchy diagrams
    -   New commands: "Show supertype hierarchy" and "Show subtype hierarchy"
    -   Built on the `vscode.provideSupertypes` / `vscode.provideSubtypes` language feature, so inheritance is reported by the language server instead of being inferred from call relations
    -   Generalization (`extends`) is drawn as a solid arrow, realization (`implements`) as a dashed one; interfaces, enums and structs are marked with a stereotype
    -   Honours the existing `maxDepth` and `ignoreFile` settings
-   Fixed "Can't resolve entry function" being raised whenever the cursor was not exactly on a symbol name
    -   The entry symbol is now retried once for a language server that is still starting up, then resolved from the enclosing function or type
    -   The error message explains what to do, and the unresolved position is written to the CallGraph output channel
-   Fixed restored webview panels always rendering with the call graph template, which broke sequence and class diagrams after a window reload
-   Fixed the webview panel serializers never being disposed
-   Added a unit test suite covering type hierarchy traversal, diagram generation and entry resolution, and wired it into CI
-   Updated the CI and release workflows to Node 22, since Node 20 reached end of life in April 2026

## [1.3.2] 2025-10-31

-   Bundled the D3 and Graphviz libraries locally so call graphs render without network access

## [1.3.1] 2025-03-21

-   Updated the Mermaid library to 11.4.1

## [1.3.0] 2025-03-12

-   Added class diagram generation and visualization feature
    -   New commands: "Show outgoing class diagram" and "Show incoming class diagram"
    -   Generate class diagrams based on function call relationships
    -   Interactive diagram viewing with SVG and Mermaid file export options
    -   Consistent UI with sequence diagram feature

## [1.2.9] 2025-03-11

-   Improved sequence diagram accuracy with source position-based ordering
    -   Enhanced call hierarchy nodes to track source code positions
    -   Implemented sorting of function calls based on their position in source code
    -   Fixed issue where sequence diagrams didn't reflect actual call order
-   Updated README with recent feature changes and improvements

## [1.2.8] 2025-03-08

-   Fixed participant name formatting in Mermaid sequence diagrams
    -   Removed extra quotation marks in participant names
-   Improved file export functionality for sequence diagrams
    -   Added proper handling for SVG export and source code download
    -   Updated to use VSCode's save dialog for file operations

## [1.2.6] 2025-03-06

-   Added Mermaid sequence diagram generation feature
    -   Generate sequence diagrams based on function call order from AST traversal
    -   New commands: "Show outgoing sequence diagram" and "Show incoming sequence diagram"
    -   Interactive diagram viewing with SVG and Mermaid file export options
-   Updated repository URLs
-   Renamed extension to "callviz" for marketplace uniqueness

## [1.2.5] 2025-03-06

-   Same features as v1.2.4 with version bump for deployment

## [1.2.4] 2025-03-05

-   add `call-graph.inDegreeThreshold` setting to filter nodes with in-degree greater than the threshold in incoming call graphs.
-   fix issue with duplicate edges appearing between the same nodes in the graph visualization.

## [1.2.3] 2024-12-19

-   fix the issue that can't run any commands from v1.2.2 ([#31](https://github.com/beicause/call-graph/issues/31)).

## [1.2.2] 2024-11-25

**IMPORTANT:** This version is not working and can't run any commands ([#31](https://github.com/beicause/call-graph/issues/31)), please update to v1.2.3.

-   fix the issue that svg is not saved correctly.
-   use proper size and view box when saving as svg.

## [1.2.1] 2024-05-30

-   `call-graph.saveDir` setting is removed, replaced by showing a save dialog.
-   beautify the save buttons in preview panel.
-   update the extension icon.

## [1.2.0] 2024-05-27

-   add `call-graph.maxDepth` setting for both incoming and outgoing call graphs.

## [1.1.5] 2024-03-20

-   fix .callgraphignore not working in windows
-   use uri path instead of file system path to fix incorrect displaying '\\' in graph label in windows

## [1.1.4] 2024-03-18

-   fix the file path label in graph, now it's the corresponding file system path instead of encoded Uri.
-   now the saved svg fits its original size, not moved or scaled.

## [1.1.3] 2023-10-26

-   use [node-ignore](https://www.npmjs.com/package/ignore) for .callgraphignore to fix relative issues([#17](https://github.com/beicause/call-graph/pull/17))
-   restrict this extensions to only search in the current workspace

## [1.1.2] 2022-8-29

-   add incoming call graph
-   add .callgraphignore config

## [1.1.1] 2022-5-20

-   fix svg and dot file exporting on Windows([#3](https://github.com/beicause/call-graph/issues/3))
-   add config `call-graph.saveDir`

## [1.1.0] 2022-4-12

-   use webview panel instead of browser for previewing, so many configs are removed.
-   support saving svg and dot file to workspace.

## [1.0.0] 2022-3-28

-   Initial release
