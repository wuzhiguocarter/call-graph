import * as fs from 'fs'
import * as vscode from 'vscode'
import { TypeDirection, TypeHierarchyNode } from './type'
import { output } from './extension'
import {
    getSourceLocation,
    SourceLocation,
    writeNavigation,
} from './navigation'

/**
 * Generate a Mermaid class diagram describing an inheritance hierarchy
 * @param graph The type hierarchy node to generate the diagram from
 * @param direction Whether the children of a node are its supertypes or subtypes
 * @param path The path to save the generated mermaid file
 * @returns The generated Mermaid diagram object
 */
export function generateTypeDiagram(
    graph: TypeHierarchyNode,
    direction: TypeDirection,
    path: string,
) {
    const diagram = new MermaidTypeDiagram()
    const visited = new Set<TypeHierarchyNode>()

    const walk = (node: TypeHierarchyNode) => {
        if (visited.has(node)) return
        visited.add(node)
        diagram.addType(node.item)

        node.children.forEach(child => {
            diagram.addType(child.item)
            // a supertype query returns the base types as children, so the edge
            // has to be flipped to keep the diagram pointing from base to derived
            const [base, derived] =
                direction === 'Super'
                    ? [child.item, node.item]
                    : [node.item, child.item]
            diagram.addInheritance(base, derived)
            walk(child)
        })
    }
    walk(graph)

    fs.writeFileSync(path, diagram.toString())
    output.appendLine('Generated Mermaid type diagram: ' + path)
    writeNavigation(path, { nodes: diagram.getLocations() })

    return diagram
}

/**
 * Escape a type name for use as a Mermaid label. Mermaid renders labels as
 * HTML, so generic parameters such as `List<T>` would be swallowed as tags.
 */
const escapeLabel = (name: string) =>
    name
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/["\\]/g, '\\$&')

/**
 * Mermaid stereotype shown inside the class box, classes have none
 */
const STEREOTYPES: Partial<Record<vscode.SymbolKind, string>> = {
    [vscode.SymbolKind.Interface]: 'interface',
    [vscode.SymbolKind.Enum]: 'enumeration',
    [vscode.SymbolKind.Struct]: 'struct',
}

/**
 * Class to generate a Mermaid class diagram from a type hierarchy
 */
class MermaidTypeDiagram {
    private _ids = new Map<string, string>()
    private _declared = new Set<string>()
    private _types: string[] = []
    private _relations = new Set<string>()
    private _locations: Record<string, SourceLocation> = {}

    /**
     * The source position of every type, by its mermaid id, so that the
     * webview can reveal the declaration a node was drawn for
     */
    getLocations(): Record<string, SourceLocation> {
        return this._locations
    }

    /**
     * Map an item to a stable identifier, since type names may contain
     * generics or namespace separators that Mermaid does not accept
     */
    private getSafeId(item: vscode.TypeHierarchyItem): string {
        const key = `${item.name}|${item.uri.toString()}|${item.range.start.line}`
        const known = this._ids.get(key)
        if (known) return known

        const id = `type_${this._ids.size}`
        this._ids.set(key, id)
        return id
    }

    /**
     * Add a type to the diagram, ignoring types that were already declared
     * @param item The type hierarchy item to declare
     */
    addType(item: vscode.TypeHierarchyItem) {
        const id = this.getSafeId(item)
        if (this._declared.has(id)) return
        this._declared.add(id)
        this._locations[id] = getSourceLocation(item)

        const label = escapeLabel(item.name)
        const stereotype = STEREOTYPES[item.kind]
        this._types.push(
            stereotype
                ? `    class ${id}["${label}"] {\n        <<${stereotype}>>\n    }`
                : `    class ${id}["${label}"]`,
        )
    }

    /**
     * Add an inheritance edge, drawn as realization when a class implements
     * an interface and as generalization otherwise
     * @param base The base type
     * @param derived The type extending or implementing the base type
     */
    addInheritance(
        base: vscode.TypeHierarchyItem,
        derived: vscode.TypeHierarchyItem,
    ) {
        const arrow =
            base.kind === vscode.SymbolKind.Interface &&
            derived.kind !== vscode.SymbolKind.Interface
                ? '<|..'
                : '<|--'
        this._relations.add(
            `    ${this.getSafeId(base)} ${arrow} ${this.getSafeId(derived)}`,
        )
    }

    /**
     * Convert the diagram to a string
     */
    toString(): string {
        return ['classDiagram', ...this._types, ...this._relations, ''].join(
            '\n',
        )
    }
}
