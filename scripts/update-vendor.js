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
            '@hpcc-js',
            'wasm',
            'dist',
            'graphviz.umd.js',
        ),
        dest: path.join(vendorDir, 'graphviz.umd.js'),
    },
    {
        source: path.join(
            __dirname,
            '..',
            'node_modules',
            'd3',
            'dist',
            'd3.min.js',
        ),
        dest: path.join(vendorDir, 'd3.min.js'),
    },
    {
        source: path.join(
            __dirname,
            '..',
            'node_modules',
            'd3-graphviz',
            'build',
            'd3-graphviz.js',
        ),
        dest: path.join(vendorDir, 'd3-graphviz.js'),
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
