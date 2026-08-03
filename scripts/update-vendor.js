#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// Ensure vendor directory exists
const vendorDir = path.join(__dirname, '..', 'static', 'vendor')
if (!fs.existsSync(vendorDir)) {
    fs.mkdirSync(vendorDir, { recursive: true })
}

// Files to copy
const files = [
    {
        source: path.join(
            __dirname,
            '..',
            'node_modules',
            'mermaid',
            'dist',
            'mermaid.min.js',
        ),
        dest: path.join(vendorDir, 'mermaid.min.js'),
    },
]

console.log('Updating vendor files...')

files.forEach(file => {
    if (fs.existsSync(file.source)) {
        fs.copyFileSync(file.source, file.dest)
        console.log(`✓ Copied ${path.basename(file.dest)}`)
    } else {
        console.error(`✗ Source file not found: ${file.source}`)
        process.exit(1)
    }
})

console.log('Vendor files updated successfully!')
