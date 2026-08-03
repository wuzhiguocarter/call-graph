import { CallHierarchyNode } from './call'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { output } from './extension'
import {
    getSourceLocation,
    SourceLocation,
    writeNavigation,
} from './navigation'

/** where the class of a diagram node and its methods are declared */
interface ClassLocations {
    /** the first symbol the class was discovered through */
    class: SourceLocation
    /** by method name, before it is rendered as `+name()` */
    methods: Map<string, SourceLocation>
}

/**
 * Generate a Mermaid class diagram from a call hierarchy node
 * @param graph The call hierarchy node to generate the diagram from
 * @param path The path to save the generated mermaid file
 * @returns The generated Mermaid diagram object
 */
export function generateClassDiagram(graph: CallHierarchyNode, path: string) {
    const mermaid = new MermaidClassDiagram()

    // 存储类和接口信息
    const classes = new Map<string, ClassInfo>()
    // 存储关系信息
    const relationships = new Set<string>()
    // 存储被调用的方法
    const calledMethods = new Map<string, Set<string>>()
    // 存储类和方法的源码位置，用于点击跳转
    const locations = new Map<string, ClassLocations>()
    // 获取工作区根路径
    const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0].uri.fsPath || ''

    // Sets to track visited nodes and detect cycles
    const visited = new Set<string>()

    // Get the in-degree threshold from settings
    const inDegreeThreshold =
        vscode.workspace
            .getConfiguration()
            .get<number>('call-graph.inDegreeThreshold') || 5

    output.appendLine(
        `Generating Mermaid class diagram with in-degree threshold: ${inDegreeThreshold}...`,
    )

    // 构建类图并收集类和关系
    buildClassDiagram(
        graph,
        classes,
        relationships,
        calledMethods,
        locations,
        workspaceRoot,
        visited,
        inDegreeThreshold,
    )

    // 添加类和接口到图表，只包含被调用的方法
    classes.forEach((classInfo, className) => {
        // 过滤方法，只保留被其他类调用的方法
        if (calledMethods.has(className)) {
            const calledMethodsSet = calledMethods.get(className)!
            classInfo.methods = classInfo.methods.filter(method =>
                calledMethodsSet.has(method),
            )
        } else {
            // 如果这个类没有被其他类调用的方法，则清空方法列表
            classInfo.methods = []
        }

        mermaid.addClass(className, classInfo)
    })

    // 添加关系到图表
    relationships.forEach(relationship => {
        mermaid.addRelationship(relationship)
    })

    // Save the generated diagram to a file
    fs.writeFileSync(path, mermaid.toString())
    output.appendLine('Generated Mermaid class diagram: ' + path)
    writeNavigation(path, collectNavigation(classes, locations))

    return mermaid
}

/**
 * Map the classes of the diagram to the source they were built from. Only the
 * methods that survived filtering are rendered, so only those are navigable.
 */
function collectNavigation(
    classes: Map<string, ClassInfo>,
    locations: Map<string, ClassLocations>,
) {
    const nodes: Record<string, SourceLocation> = {}
    const members: Record<string, Record<string, SourceLocation>> = {}

    classes.forEach((classInfo, className) => {
        const known = locations.get(className)
        if (!known) return
        nodes[className] = known.class

        classInfo.methods.forEach(method => {
            const location = known.methods.get(method)
            // the label the member is rendered with, see `addClass`
            if (location) {
                members[className] = members[className] ?? {}
                members[className][`+${method}()`] = location
            }
        })
    })

    return { nodes, members }
}

/**
 * Class information for the class diagram
 */
interface ClassInfo {
    type: 'class' | 'interface'
    methods: string[]
    properties: string[]
    namespace?: string
}

/**
 * Build the class diagram structure
 */
function buildClassDiagram(
    node: CallHierarchyNode,
    classes: Map<string, ClassInfo>,
    relationships: Set<string>,
    calledMethods: Map<string, Set<string>>,
    locations: Map<string, ClassLocations>,
    workspaceRoot: string,
    visited: Set<string> = new Set(),
    inDegreeThreshold: number = 5,
) {
    /** remember where a class and one of its methods are declared */
    const rememberLocation = (
        name: string,
        method: string | null,
        item: vscode.CallHierarchyItem,
    ) => {
        const location = getSourceLocation(item)
        // the first symbol a class is discovered through wins, it is the one
        // closest to the entry of the graph
        const known = locations.get(name) ?? {
            class: location,
            methods: new Map<string, SourceLocation>(),
        }
        locations.set(name, known)
        if (method && !known.methods.has(method)) {
            known.methods.set(method, location)
        }
    }
    // Skip if already visited to prevent cycles
    if (visited.has(node.item.uri.fsPath + node.item.name)) {
        return
    }
    visited.add(node.item.uri.fsPath + node.item.name)

    // Get file path and class/method name
    const fullPath = node.item.uri.fsPath
    const relativePath = workspaceRoot
        ? path.relative(workspaceRoot, fullPath).replace(/\\/g, '/')
        : fullPath

    // Extract class and method information
    const { className, methodName } = extractClassAndMethod(
        node.item.name,
        relativePath,
    )

    // Skip if no class name could be determined
    if (!className) {
        return
    }

    // Add or update class information
    if (!classes.has(className)) {
        classes.set(className, {
            type: 'class', // Default to class, could be refined with more analysis
            methods: [],
            properties: [],
        })
    }

    // Add method to class if it exists
    if (methodName && !classes.get(className)!.methods.includes(methodName)) {
        classes.get(className)!.methods.push(methodName)
    }

    rememberLocation(className, methodName, node.item)

    // Process child nodes
    node.children.forEach(child => {
        // Apply in-degree filtering - skip nodes with high in-degree
        if (
            inDegreeThreshold > 0 &&
            child.inDegree &&
            child.inDegree > inDegreeThreshold
        ) {
            output.appendLine(
                `Skipping node due to high in-degree (${child.inDegree} > ${inDegreeThreshold}): ${child.item.name}`,
            )
            return
        }

        // Extract class and method information for the child
        const childFullPath = child.item.uri.fsPath
        const childRelativePath = workspaceRoot
            ? path.relative(workspaceRoot, childFullPath).replace(/\\/g, '/')
            : childFullPath

        const { className: childClassName, methodName: childMethodName } =
            extractClassAndMethod(child.item.name, childRelativePath)

        // a child skipped by the visited check or by filtering is still drawn
        // as a member of its class, so its position is recorded here as well
        if (childClassName) {
            rememberLocation(childClassName, childMethodName, child.item)
        }

        // Add relationship between classes if both exist
        if (className && childClassName && className !== childClassName) {
            // Add a dependency relationship
            relationships.add(`${className} ..> ${childClassName} : uses`)

            // Record that this method in the child class is being called
            if (childMethodName) {
                if (!calledMethods.has(childClassName)) {
                    calledMethods.set(childClassName, new Set())
                }
                calledMethods.get(childClassName)!.add(childMethodName)
            }
        }

        // Recursively process child nodes
        buildClassDiagram(
            child,
            classes,
            relationships,
            calledMethods,
            locations,
            workspaceRoot,
            visited,
            inDegreeThreshold,
        )
    })
}

/**
 * Extract class and method names from a function name and file path
 * Uses language-agnostic heuristics to work with multiple programming languages
 */
function extractClassAndMethod(
    fullName: string,
    filePath: string,
): { className: string; methodName: string | null } {
    // Try to extract class and method from the full name
    const parts = fullName.split('.')

    if (parts.length > 1) {
        // Check if any part follows PascalCase convention (likely a class)
        const potentialClassParts = []
        const methodName = parts[parts.length - 1]

        // Iterate through parts except the last one (which is likely the method)
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i]
            // Check if part starts with uppercase (PascalCase) - likely a class
            if (part.length > 0 && part[0] === part[0].toUpperCase()) {
                potentialClassParts.push(part)
            } else if (potentialClassParts.length === 0) {
                // If we haven't found a class part yet, this could be an instance
                // Look at the file path for clues about the class name
                const fileName = path.basename(filePath, path.extname(filePath))

                // Common naming patterns for files containing classes
                // e.g., user_service.ts might contain UserService class
                const fileNameParts = fileName.split(/[_\-.]/)
                const pascalCaseClassName = fileNameParts
                    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
                    .join('')

                return {
                    className: pascalCaseClassName,
                    methodName,
                }
            }
        }

        if (potentialClassParts.length > 0) {
            // If we found potential class parts, use them
            return {
                className: potentialClassParts.join('.'),
                methodName,
            }
        } else {
            // Fallback: use all parts except the last as the class name
            return {
                className: parts.slice(0, -1).join('.'),
                methodName,
            }
        }
    } else if (fullName.includes('::')) {
        // Handle C++ style namespace::Class::method
        const cppParts = fullName.split('::')
        return {
            className: cppParts.slice(0, -1).join('::'),
            methodName: cppParts[cppParts.length - 1],
        }
    } else {
        // No dots or :: in the name, try to infer class from file name
        const fileName = path.basename(filePath, path.extname(filePath))

        // Try to extract a class name from the file name using common conventions
        // e.g., user_service.ts → UserService, user.go → User
        const fileNameParts = fileName.split(/[_\-.]/)
        const pascalCaseClassName = fileNameParts
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))
            .join('')

        // Check if the method name itself might be a constructor
        if (
            fullName === pascalCaseClassName ||
            fullName === 'new' + pascalCaseClassName ||
            fullName === 'New' + pascalCaseClassName
        ) {
            // Go-style constructor
            return {
                className: pascalCaseClassName,
                methodName: 'constructor',
            }
        }

        return {
            className: pascalCaseClassName,
            methodName: fullName,
        }
    }
}

/**
 * Class to generate a Mermaid class diagram
 */
class MermaidClassDiagram {
    private _content = ''
    private _classes: string[] = []
    private _relationships: string[] = []

    constructor() {
        this._content = 'classDiagram\n'
    }

    /**
     * Add a class to the diagram
     * @param className The name of the class
     * @param classInfo Information about the class
     */
    addClass(className: string, classInfo: ClassInfo) {
        // Start with class definition
        let classDefinition = `    class ${className} {\n`

        // Add methods
        classInfo.methods.forEach(method => {
            classDefinition += `        +${method}()\n`
        })

        // Add properties
        classInfo.properties.forEach(property => {
            classDefinition += `        +${property}\n`
        })

        // Close class definition
        classDefinition += '    }'

        // Add to classes array
        this._classes.push(classDefinition)

        // If it's an interface, add the <<interface>> annotation
        if (classInfo.type === 'interface') {
            this._classes.push(`    ${className} : <<interface>>`)
        }
    }

    /**
     * Add a relationship to the diagram
     * @param relationship The relationship definition in Mermaid syntax
     */
    addRelationship(relationship: string) {
        this._relationships.push(`    ${relationship}`)
    }

    /**
     * Convert the diagram to a string
     */
    toString(): string {
        // Combine all classes and relationships
        return (
            this._content +
            this._classes.join('\n') +
            '\n' +
            this._relationships.join('\n') +
            '\n'
        )
    }
}
