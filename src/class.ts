import { CallHierarchyNode } from './call'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { output } from './extension'

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

    // --- TESTING GLOBAL HIERARCHY ---
    // Fetch all classes and interfaces (simulate for now or call if async is okay here)
    // For testing, let's create a dummy map. In a real scenario, this would be populated
    // by fetchAllClassesAndInterfaces.
    const globalClassesForTest = new Map<string, ClassInfo>()
    globalClassesForTest.set('MyNamespace.MyClass', {
        type: 'class',
        methods: ['doSomething'],
        properties: ['myProp'],
        namespace: 'MyNamespace',
        superClass: 'MyNamespace.BaseClass',
        interfaces: ['MyNamespace.MyInterface', 'AnotherInterface'],
    })
    globalClassesForTest.set('MyNamespace.BaseClass', {
        type: 'class',
        methods: ['baseMethod'],
        properties: [],
        namespace: 'MyNamespace',
    })
    globalClassesForTest.set('MyNamespace.MyInterface', {
        type: 'interface',
        methods: ['myInterfaceMethod'],
        properties: [],
        namespace: 'MyNamespace',
    })
    globalClassesForTest.set('AnotherInterface', {
        type: 'interface',
        methods: [],
        properties: [],
    })
    globalClassesForTest.set('MyNamespace.DerivedFromBase', {
      type: 'class',
      methods: [],
      properties: [],
      namespace: 'MyNamespace',
      superClass: 'MyNamespace.BaseClass'
    })


    // Add classes from the global fetch to the diagram (if not already added by call hierarchy)
    globalClassesForTest.forEach((classInfo, className) => {
        if (!classes.has(className)) { // Avoid duplicating class definitions
            mermaid.addClass(className, classInfo)
        }
        // Add inheritance and implementation relationships
        if (classInfo.superClass) {
            mermaid.addInheritance(className, classInfo.superClass)
        }
        if (classInfo.interfaces) {
            classInfo.interfaces.forEach(interfaceName => {
                mermaid.addImplementation(className, interfaceName)
            })
        }
    })
    // --- END TESTING GLOBAL HIERARCHY ---

    // Save the generated diagram to a file
    fs.writeFileSync(path, mermaid.toString())
    output.appendLine('Generated Mermaid class diagram: ' + path)

    return mermaid
}

/**
 * Class information for the class diagram
 */
interface ClassInfo {
    type: 'class' | 'interface'
    methods: MethodInfo[] // Updated from string[]
    properties: string[] // Could become PropertyInfo[] if needed
    namespace?: string
    superClass?: string
    interfaces?: string[]
    uri: string // URI of the file, fsPath
    classRange?: vscode.Range // Range of the class declaration itself
    // name?: string; // Removed temporary simple name storage
}

interface MethodInfo {
    name: string;
    range: vscode.Range;
    selectionRange: vscode.Range;
    // The URI is available from the parent ClassInfo
}

/**
 * Build the class diagram structure
 */
function buildClassDiagram(
    node: CallHierarchyNode,
    classes: Map<string, ClassInfo>,
    relationships: Set<string>,
    calledMethods: Map<string, Set<string>>,
    workspaceRoot: string,
    visited: Set<string> = new Set(),
    inDegreeThreshold: number = 5,
) {
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
export function extractClassAndMethod( // Export this function
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

export async function fetchAllClassesAndInterfaces(
    workspaceRoot: string, // This might not be strictly needed if findFiles uses global patterns
    token?: vscode.CancellationToken,
): Promise<Map<string, ClassInfo>> {
    const classMap = new Map<string, ClassInfo>()

    const configuration = vscode.workspace.getConfiguration('call-graph.globalDiagram');
    const includePattern = configuration.get<string>('include', '**/*.ts');
    const excludeSetting = configuration.get<string>('exclude', '**/node_modules/**,**/*.spec.ts,**/*.test.ts');
    // vscode.workspace.findFiles exclude patterns are a single string, comma-separated, or a RelativePattern.
    // If excludeSetting is null or empty, pass null to findFiles.
    const excludePattern = excludeSetting && excludeSetting.trim() !== '' ? excludeSetting : null;


    const files = await vscode.workspace.findFiles(includePattern, excludePattern, undefined /*maxResults*/, token);
    if (token?.isCancellationRequested) return classMap;

    for (const file of files) {
        if (token?.isCancellationRequested) break;
        try {
            const document = await vscode.workspace.openTextDocument(file);
            await parseFileContent(document, classMap, workspaceRoot); // workspaceRoot is used by parseFileContent for context
        } catch (e) {
            output.appendLine(`Error opening or parsing file ${file.fsPath}: ${e}`);
        }
    }
    if (token?.isCancellationRequested) return classMap;

    // Second pass: Populate methods using DocumentSymbolProvider
    for (const [qualifiedName, classInfo] of classMap.entries()) {
        if (token?.isCancellationRequested) break;
        try {
            const uri = vscode.Uri.file(classInfo.uri);
            // executeDocumentSymbolProvider itself does not directly accept a CancellationToken in its signature.
            // However, the operation is part of a larger cancellable process.
            const symbols: vscode.DocumentSymbol[] | undefined =
                await vscode.languages.executeDocumentSymbolProvider(uri);

            if (symbols) {
                const simpleClassName = qualifiedName.split('.').pop() || qualifiedName;
                populateMethodsFromSymbols(classInfo, symbols, simpleClassName);
            }
        } catch (e) {
            output.appendLine(`Error fetching symbols for ${classInfo.uri}: ${e}`);
        }
    }

    return classMap
}

// Helper function to find a symbol by name (simple match, might need refinement for overloaded methods etc.)
function findSymbol(symbols: vscode.DocumentSymbol[], name: string, kind: vscode.SymbolKind): vscode.DocumentSymbol | undefined {
    for (const s of symbols) {
        if (s.name === name && s.kind === kind) {
            return s;
        }
        if (s.children.length > 0) {
            const found = findSymbol(s.children, name, kind);
            if (found) return found;
        }
    }
    return undefined;
}


function populateMethodsFromSymbols(
    classInfo: ClassInfo,
    symbols: vscode.DocumentSymbol[],
    simpleClassName: string, // The non-qualified name of the class
    ) {
    const classSymbol = findSymbol(symbols, simpleClassName, vscode.SymbolKind.Class) ||
                        findSymbol(symbols, simpleClassName, vscode.SymbolKind.Interface);

    if (classSymbol) {
        classInfo.classRange = classSymbol.range; // Store class range
        for (const childSymbol of classSymbol.children) {
            if (childSymbol.kind === vscode.SymbolKind.Method || childSymbol.kind === vscode.SymbolKind.Function) {
                classInfo.methods.push({
                    name: childSymbol.name,
                    range: childSymbol.range,
                    selectionRange: childSymbol.selectionRange,
                });
            } else if (childSymbol.kind === vscode.SymbolKind.Property) {
                // Optionally populate properties here if needed
                // classInfo.properties.push(childSymbol.name);
            }
        }
    }
}


async function parseFileContent( // Made async
    document: vscode.TextDocument, // Changed from text: string
    classMap: Map<string, ClassInfo>,
    workspaceRoot: string,
    // filePath: string, // filePath is document.uri.fsPath
) {
    const text = document.getText();
    const filePath = document.uri.fsPath;
    // Regular expression to find class and interface definitions
    // This regex captures:
    // 1. Optional namespace
    // 2. "class" or "interface" keyword
    // 3. Class/Interface name
    // 4. Optional "extends" clause and the parent class name
    // 5. Optional "implements" clause and the implemented interface names
    const classInterfaceRegex =
        /(class|interface)\s+([\w.]+)(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w.,\s]+))?/g
    let match

    // This is a simplified way to get the namespace.
    // It finds the last declared namespace before the current match.
    // This might not be perfectly accurate for complex nested structures or multiple namespaces in a file.
    const namespaceRegex = /namespace\s+([\w.]+)\s*{/g
    let lastNamespace: string | undefined
    let nsMatch
    // Store all namespace declarations with their start indices
    const namespacesInFile: { name: string; startIndex: number; endIndex: number }[] = []
    while((nsMatch = namespaceRegex.exec(text)) !== null) {
        // Find the corresponding closing brace for the namespace
        let openBraces = 1
        let endIndex = nsMatch.index + nsMatch[0].length
        for (let i = endIndex; i < text.length; i++) {
            if (text[i] === '{') {
                openBraces++
            } else if (text[i] === '}') {
                openBraces--
                if (openBraces === 0) {
                    endIndex = i
                    break
                }
            }
        }
        namespacesInFile.push({ name: nsMatch[1], startIndex: nsMatch.index, endIndex })
    }


    while ((match = classInterfaceRegex.exec(text)) !== null) {
        const type = match[1] as 'class' | 'interface'
        const name = match[2]
        const superClass = match[3]
        const implementedInterfaces = match[4]
            ? match[4].split(',').map(s => s.trim())
            : []

        let currentNamespace: string | undefined
        // Check if this class/interface is inside any of the found namespaces
        for (const ns of namespacesInFile) {
            if (match.index > ns.startIndex && match.index < ns.endIndex) {
                currentNamespace = ns.name
                // TODO: Handle nested namespaces if necessary, e.g., append to parent namespace
                break
            }
        }

        let qualifiedName = name
        if (currentNamespace) {
            qualifiedName = `${currentNamespace}.${name}`
        }

        // TODO: Extract methods and properties if possible
        // For now, initialize with empty arrays
        // Store the simple name for symbol matching if needed, or parse it from qualifiedName
        const simpleName = name; // This is the regex-captured name, assumed to be simple

        const classInfo: ClassInfo = {
            type,
            methods: [], // Will be populated by populateMethodsFromSymbols
            properties: [],
            namespace: currentNamespace,
            superClass,
            interfaces: implementedInterfaces,
            uri: filePath, // Store the file URI
            // name: simpleName, // This was temporary, removed.
        };

        classMap.set(qualifiedName, classInfo)
    }
}

/**
 * Class to generate a Mermaid class diagram
 */
export class MermaidClassDiagram {
    private _content = ''
    private _classes: string[] = []
    private _relationships: string[] = []

    constructor() {
        this._content = 'classDiagram\n'
    }

    /**
     * Add an inheritance relationship to the diagram (e.g., Parent <|-- Child)
     * @param childClass The name of the child class
     * @param parentClass The name of the parent class
     */
    addInheritance(childClass: string, parentClass: string) {
        this._relationships.push(`    ${parentClass} <|-- ${childClass}`)
    }

    /**
     * Add an interface implementation relationship to the diagram (e.g., Interface <|.. Class)
     * @param implementingClass The name of the implementing class
     * @param interfaceName The name of the interface
     */
    addImplementation(implementingClass: string, interfaceName: string) {
        this._relationships.push(`    ${interfaceName} <|.. ${implementingClass}`)
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
