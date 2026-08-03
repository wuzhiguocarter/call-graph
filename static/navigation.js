/**
 * Makes the elements of a rendered diagram jump to the source they were drawn
 * for. The extension writes a `<diagram>.map.json` next to every diagram, this
 * script pairs its entries with the elements mermaid rendered.
 *
 * Shared by the call graph, sequence, class and type hierarchy templates.
 */
;(function () {
    // a click that ends more than this many pixels away from where it started
    // is a pan of the diagram, not a click on an element
    const DRAG_THRESHOLD = 4
    const SVG_NS = 'http://www.w3.org/2000/svg'

    /**
     * Bind every navigable element of a rendered diagram
     * @param {SVGElement} svg the rendered diagram
     * @param {object} map the navigation data written next to the diagram
     * @param {(location: object) => void} reveal opens a source location
     */
    function bindDiagramNavigation(svg, map, reveal) {
        if (!svg || !map) return

        let pressed = null
        svg.addEventListener('mousedown', event => {
            pressed = { x: event.clientX, y: event.clientY }
        })
        const isPan = event =>
            pressed !== null &&
            (Math.abs(event.clientX - pressed.x) > DRAG_THRESHOLD ||
                Math.abs(event.clientY - pressed.y) > DRAG_THRESHOLD)

        const bind = (element, location, describe) => {
            if (!element || !location) return
            element.style.cursor = 'pointer'
            if (describe) describe(element, location)
            element.addEventListener('click', event => {
                if (isPan(event)) return
                event.stopPropagation()
                reveal(location)
            })
        }

        /** an svg tooltip, shown while hovering the element */
        const withSvgTitle = (element, location) => {
            const title = document.createElementNS(SVG_NS, 'title')
            title.textContent = location.name
            element.appendChild(title)
        }

        bindNodes(svg, map, bind, withSvgTitle)
        bindSequence(svg, map, bind, withSvgTitle)
    }

    /**
     * Flowchart and class diagram nodes. Mermaid renders them as
     * `<g class="node" id="<render id>-flowchart-<node id>-<index>">` and
     * `<g class="node" id="<render id>-classId-<class id>-<index>">`.
     */
    function bindNodes(svg, map, bind, withSvgTitle) {
        svg.querySelectorAll('g.node[id]').forEach(node => {
            // the leading `.*` anchors on the last marker, the render id of a
            // flowchart ends with `-flowchart` as well
            const match = node.id.match(/.*-(?:flowchart|classId)-(.+)-\d+$/)
            if (!match) return
            const id = match[1]

            // the methods of a class box are bound first, so that a click on a
            // method row wins over the class it belongs to
            const members = (map.members || {})[id]
            if (members) {
                node.querySelectorAll('.nodeLabel').forEach(label => {
                    const location = members[(label.textContent || '').trim()]
                    bind(label, location, (element, target) =>
                        element.setAttribute('title', target.name),
                    )
                })
            }

            bind(node, (map.nodes || {})[id], withSvgTitle)
        })
    }

    /**
     * Sequence diagram participants and messages. Participants are rendered in
     * declaration order as `<g id="root-N">` with a `<line id="actorN">`
     * lifeline, messages are rendered in the order they are drawn.
     */
    function bindSequence(svg, map, bind, withSvgTitle) {
        ;(map.participants || []).forEach((location, index) => {
            bind(svg.querySelector(`#root-${index}`), location, withSvgTitle)
            bind(
                svg.querySelector(`line#actor${index}`),
                location,
                withSvgTitle,
            )
        })

        const messages = svg.querySelectorAll('text.messageText')
        ;(map.messages || []).forEach((location, index) => {
            // no svg title here, a title inside a text element is not rendered
            // consistently across browsers
            bind(messages[index], location)
        })
    }

    /**
     * Load the navigation data of a diagram and bind it
     * @param {SVGElement} svg the rendered diagram
     * @param {string} mapUri where the extension wrote the navigation data
     * @param {(location: object) => void} reveal opens a source location
     */
    function loadDiagramNavigation(svg, mapUri, reveal) {
        return fetch(mapUri)
            .then(response => (response.ok ? response.json() : null))
            .then(map => bindDiagramNavigation(svg, map, reveal))
            .catch(error =>
                console.error('Error loading navigation data:', error),
            )
    }

    window.bindDiagramNavigation = bindDiagramNavigation
    window.loadDiagramNavigation = loadDiagramNavigation
})()
