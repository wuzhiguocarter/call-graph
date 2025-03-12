# call-graph

![](images/call_graph_outgoing.jpg)

vscode extension for generate call graph in [graphviz dot language](https://www.graphviz.org/doc/info/lang.html), based on vscode call hierarchy language feature.

## Features

-   Generate call graph in graphviz dot language and preview
-   Generate sequence diagrams using Mermaid syntax
-   Generate class diagrams using Mermaid syntax
-   Save graph as dot or svg file
-   Export sequence and class diagrams as SVG or download source code
-   Intelligent filtering of high in-degree nodes to reduce diagram complexity
-   Accurate representation of actual call sequence in sequence diagrams
-   Language-agnostic class detection for class diagrams (supports C++, Go, TypeScript, and more)

## Quick start

1. Open your folder and select a entry function
2. Run `CallGraph.showOutgoingCallGraph` command using context menu or `Ctrl+Shift+P` to show outgoing calls
3. Or Run `CallGraph.showIncomingCallGraph` command using context menu or `Ctrl+Shift+P` to show incoming calls
4. For sequence diagrams, use `CallGraph.showOutgoingSequenceDiagram` or `CallGraph.showIncomingSequenceDiagram`
5. For class diagrams, use `CallGraph.showOutgoingClassDiagram` or `CallGraph.showIncomingClassDiagram`
6. Click `save dot file` or `save as svg` in the bottom left corner to save the graph
7. For sequence and class diagrams, use the "Export SVG" or "Download Source Code" buttons
8. Add `.callgraphignore` file in your project root directory to ignore some files or folders in workspace (the syntax is the same as `.gitignore`)

## Configuration

You can configure `ignoreFile`(.callgraphignore by default), `maxDepth`, and `inDegreeThreshold`. See the descriptions in setting.

- `ignoreFile`: Path to the file that specifies paths to ignore (default: ${workspace}/.callgraphignore)
- `maxDepth`: The maximum depth of the call graph (default: 0, which means unlimited)
- `inDegreeThreshold`: Filter nodes with in-degree greater than this threshold in incoming call graphs (default: 5)

## Recent Updates

### Class Diagrams
- Added support for generating class diagrams using Mermaid syntax
- Class diagrams show relationships between classes based on function calls
- Only displays methods that are called by other classes for cleaner diagrams
- Language-agnostic implementation that works with multiple programming languages
- Export class diagrams as SVG or download the Mermaid source code

### Sequence Diagrams
- Added support for generating sequence diagrams using Mermaid syntax
- Sequence diagrams now accurately reflect the actual call order in your code
- Export sequence diagrams as SVG or download the Mermaid source code

### Node Filtering
- Improved filtering of high in-degree nodes to reduce diagram complexity
- Configurable threshold via the `inDegreeThreshold` setting

### UI Improvements
- Enhanced zoom and pan controls for better diagram navigation
- Added export functionality for both call graphs and sequence diagrams

## How it works

It depends `vscode.provideOutgoingCalls` and `vscode.provideIncomingCalls` built-in commands( the same with `Show Call Hierarchy` command, not available for some language server ).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## For more information

-   [GitHub Repository](https://github.com/beicause/call-graph)

## Donate

[Donate me via Paypal](https://paypal.me/beicause). Thank you for you support to this project and my open source works.

**Enjoy!**
