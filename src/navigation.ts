import * as fs from 'fs'
import * as vscode from 'vscode'
import { output } from './extension'

/** a position in the workspace a diagram element points at */
export interface SourceLocation {
    /** the uri of the file, as `vscode.Uri.toString()` */
    uri: string
    line: number
    character: number
    /** what the webview shows while hovering the element */
    name: string
}

/**
 * Where the elements of a diagram live in the workspace. Every diagram kind
 * fills the fields it can be navigated by, the webview binds what it finds.
 */
export interface DiagramNavigation {
    /** mermaid node id of a flowchart or class diagram, `node_0` or `type_0` */
    nodes?: Record<string, SourceLocation>
    /** class id, then rendered member label such as `+parse()` */
    members?: Record<string, Record<string, SourceLocation>>
    /** sequence diagram participants, in declaration order */
    participants?: SourceLocation[]
    /** sequence diagram messages, in the order they are drawn */
    messages?: SourceLocation[]
}

/** the file the navigation data of a diagram is written to */
export const getNavigationPath = (diagramPath: string) =>
    diagramPath.replace(/\.mmd$/, '') + '.map.json'

/**
 * Resolve the position a symbol should be revealed at. The selection range
 * covers the name of the symbol, which reads better than its whole body.
 */
export const getSourceLocation = (item: {
    name: string
    uri: vscode.Uri
    range: vscode.Range
    selectionRange?: vscode.Range
}): SourceLocation => {
    const position = (item.selectionRange ?? item.range).start
    return {
        uri: item.uri.toString(),
        line: position.line,
        character: position.character,
        name: item.name,
    }
}

/**
 * Write the navigation data next to the diagram it belongs to
 * @param diagramPath The path of the generated mermaid file
 * @param navigation The elements of the diagram that are navigable
 */
export const writeNavigation = (
    diagramPath: string,
    navigation: DiagramNavigation,
) => {
    const navigationPath = getNavigationPath(diagramPath)
    fs.writeFileSync(navigationPath, JSON.stringify(navigation))
    output.appendLine('Generated navigation data: ' + navigationPath)
}
