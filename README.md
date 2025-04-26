# call-graph

![call-graph](./images/call_graph_outgoing.png)
vscode extension for generate call graph in [graphviz dot language](https://www.graphviz.org/doc/info/lang.html), based on vscode call hierarchy language feature.

## Features

-   Generate call graph in graphviz dot language and preview
-   Save graph as dot or svg file
-   **NEW**: Click on graph elements to navigate directly to code definitions

## Quick start

1. Open your folder and select a entry function
2. Run `CallGraph.showOutgoingCallGraph` command using context menu or `Ctrl+Shift+P` to show outgoing calls
3. Or Run `CallGraph.showIncomingCallGraph` command using context menu or `Ctrl+Shift+P` to show incoming calls
4. Click on any node in the graph to navigate directly to its code definition
5. Click `save dot file` or `save as svg` in the bottom left corner to save the graph
6. Add `.callgraphignore` file in your project root directory to ignore some files or folders in workspace (the syntax is the same as `.gitignore`)

## Navigation Feature

The new navigation feature allows you to:
- Click on any node in the sequence diagram to jump directly to its code definition
- Nodes will be highlighted when you hover over them, indicating they are clickable
- When you click a node, VS Code will open the corresponding file and position the cursor at the exact location of the definition
- The code symbol will be briefly highlighted to help you locate it in the file

This feature makes it much easier to explore and understand code relationships by providing a direct link between the visual representation and the actual code.

## Configuration

You can configure `ignoreFile`(.callgraphignore by default), `maxDepth`. See the descriptions in setting.

## How it works

It depends `vscode.provideOutgoingCalls` and `vscode.provideIncomingCalls` built-in commands( the same with `Show Call Hierarchy` command, not available for some language server ).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## For more information

-   [GitHub Repository](https://github.com/beicause/call-graph)

## Donate

[Donate me via Paypal](https://paypal.me/beicause). Thank you for you support to this project and my open source works.

**Enjoy!**
