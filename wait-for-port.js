#!/usr/bin/env node

import { Socket } from 'net';

// Parse command-line arguments
const port = parseInt(process.argv[2]) || 5173;
const maxAttempts = parseInt(process.argv[3]) || 300;
const host = process.argv[4] || '127.0.0.1';

let attempts = 0;

function checkPort() {
    return new Promise((resolve) => {
        const socket = new Socket();
        socket.setTimeout(500);
        
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        
        socket.on('error', () => {
            resolve(false);
        });
        
        socket.connect(port, host);
    });
}

async function waitForPort() {
    console.log(`Waiting for ${host}:${port}`);
    setTimeout(() => {}, 500);
    
    while (attempts < maxAttempts) {
        const isOpen = await checkPort();
        if (isOpen) {
            console.log('\nPort is ready');
            process.exit(0);
        }
        attempts++;
        console.log('.');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.error(`\nTimeout waiting for port ${port} on ${host}`);
    process.exit(1);
}

waitForPort();
