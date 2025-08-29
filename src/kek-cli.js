#!/usr/bin/env node

"use strict";

const kek = require('./kek.js');
const fs = require('fs');
const path = require('path');

/**
 * KEK CLI Tool
 * Command line interface for encrypting/decrypting TLS private keys
 */

const USAGE = `
KEK (Key Encryption Key) CLI Tool
Usage: node kek-cli.js <command> [options]

Commands:
  encrypt <input-file> [output-file]    Encrypt a private key file
  decrypt <input-file> [output-file]    Decrypt an encrypted private key file
  check <input-file>                    Check if file is encrypted and validate
  status                                Show master key status

Examples:
  node kek-cli.js encrypt server.key
  node kek-cli.js encrypt server.key server_encrypted.key
  node kek-cli.js decrypt server.key.encrypted server.key
  node kek-cli.js check server.key
  node kek-cli.js status

Options:
  -h, --help                           Show this help message
  -v, --verbose                        Show detailed output
`;

class KEKCli {
    constructor() {
        this.verbose = false;
    }

    log(message) {
        console.log(message);
    }

    error(message) {
        console.error(`Error: ${message}`);
    }

    verboseLog(message) {
        if (this.verbose) {
            console.log(`[VERBOSE] ${message}`);
        }
    }

    async encryptCommand(args) {
        if (args.length < 1) {
            this.error('Input file path is required');
            this.log(USAGE);
            process.exit(1);
        }

        const inputFile = args[0];
        const outputFile = args[1];

        this.verboseLog(`Encrypting file: ${inputFile}`);

        try {
            // Check if master key is available
            const masterKeyAvail = await kek.isMasterKeyAvailable();
            if (!masterKeyAvail) {
                this.error('Master key not available at /run/nubo/mk.bin');
                this.log('Ensure the master key file exists and is readable.');
                process.exit(1);
            }

            // Check if input file exists
            if (!fs.existsSync(inputFile)) {
                this.error(`Input file does not exist: ${inputFile}`);
                process.exit(1);
            }

            const resultPath = await kek.encryptKeyFile(inputFile, outputFile);
            this.log(`✓ Successfully encrypted key file`);
            this.log(`  Input:  ${inputFile}`);
            this.log(`  Output: ${resultPath}`);

            if (this.verbose) {
                const validation = await kek.validateKeyFile(resultPath);
                this.verboseLog(`Encrypted file validation: ${JSON.stringify(validation, null, 2)}`);
            }

        } catch (error) {
            this.error(error.message);
            process.exit(1);
        }
    }

    async decryptCommand(args) {
        if (args.length < 1) {
            this.error('Input file path is required');
            this.log(USAGE);
            process.exit(1);
        }

        const inputFile = args[0];
        const outputFile = args[1];

        this.verboseLog(`Decrypting file: ${inputFile}`);

        try {
            // Check if master key is available
            const masterKeyAvail = await kek.isMasterKeyAvailable();
            if (!masterKeyAvail) {
                this.error('Master key not available at /run/nubo/mk.bin');
                this.log('Ensure the master key file exists and is readable.');
                process.exit(1);
            }

            // Check if input file exists
            if (!fs.existsSync(inputFile)) {
                this.error(`Input file does not exist: ${inputFile}`);
                process.exit(1);
            }

            const resultPath = await kek.decryptKeyFile(inputFile, outputFile);
            this.log(`✓ Successfully decrypted key file`);
            this.log(`  Input:  ${inputFile}`);
            this.log(`  Output: ${resultPath}`);

            if (this.verbose) {
                const validation = await kek.validateKeyFile(resultPath);
                this.verboseLog(`Decrypted file validation: ${JSON.stringify(validation, null, 2)}`);
            }

        } catch (error) {
            this.error(error.message);
            process.exit(1);
        }
    }

    async checkCommand(args) {
        if (args.length < 1) {
            this.error('Input file path is required');
            this.log(USAGE);
            process.exit(1);
        }

        const inputFile = args[0];

        this.verboseLog(`Checking file: ${inputFile}`);

        try {
            // Check if input file exists
            if (!fs.existsSync(inputFile)) {
                this.error(`Input file does not exist: ${inputFile}`);
                process.exit(1);
            }

            const validation = await kek.validateKeyFile(inputFile);
            
            this.log(`\nFile: ${inputFile}`);
            this.log(`Encrypted: ${validation.encrypted ? '✓ Yes' : '✗ No'}`);
            this.log(`Valid: ${validation.valid ? '✓ Yes' : '✗ No'}`);
            this.log(`Master Key Available: ${validation.masterKeyAvailable ? '✓ Yes' : '✗ No'}`);
            
            if (validation.encrypted) {
                this.log(`Can Decrypt: ${validation.canDecrypt ? '✓ Yes' : '✗ No'}`);
            }
            
            if (validation.error) {
                this.log(`Error: ${validation.error}`);
            }

            if (this.verbose) {
                this.verboseLog(`Full validation result: ${JSON.stringify(validation, null, 2)}`);
            }

            // Exit with non-zero code if file is invalid
            if (!validation.valid) {
                process.exit(1);
            }

        } catch (error) {
            this.error(error.message);
            process.exit(1);
        }
    }

    async statusCommand() {
        this.verboseLog('Checking system status');

        try {
            const masterKeyAvail = await kek.isMasterKeyAvailable();
            
            this.log('\nKEK System Status:');
            this.log(`Master Key: ${masterKeyAvail ? '✓ Available' : '✗ Not Available'}`);
            this.log(`Master Key Path: /run/nubo/mk.bin`);
            
            if (masterKeyAvail) {
                this.log('✓ System ready for key encryption/decryption operations');
            } else {
                this.log('⚠ Master key not available - only unencrypted keys can be used');
                this.log('  To enable encryption, ensure /run/nubo/mk.bin exists and contains a 32-byte key');
            }

            if (this.verbose) {
                // Try to get some additional system info
                const stats = fs.statSync('/run/nubo/mk.bin').catch(() => null);
                if (stats) {
                    this.verboseLog(`Master key file size: ${stats.size} bytes`);
                    this.verboseLog(`Master key file permissions: ${stats.mode.toString(8)}`);
                }
            }

        } catch (error) {
            this.error(error.message);
            process.exit(1);
        }
    }

    showHelp() {
        this.log(USAGE);
    }

    async run() {
        const args = process.argv.slice(2);

        if (args.length === 0) {
            this.showHelp();
            process.exit(1);
        }

        // Check for global options
        if (args.includes('-v') || args.includes('--verbose')) {
            this.verbose = true;
            // Remove verbose flags from args
            const verboseIndex = args.findIndex(arg => arg === '-v' || arg === '--verbose');
            if (verboseIndex !== -1) {
                args.splice(verboseIndex, 1);
            }
        }

        if (args.includes('-h') || args.includes('--help')) {
            this.showHelp();
            process.exit(0);
        }

        const command = args[0];
        const commandArgs = args.slice(1);

        this.verboseLog(`Executing command: ${command} with args: ${JSON.stringify(commandArgs)}`);

        switch (command) {
            case 'encrypt':
                await this.encryptCommand(commandArgs);
                break;

            case 'decrypt':
                await this.decryptCommand(commandArgs);
                break;

            case 'check':
                await this.checkCommand(commandArgs);
                break;

            case 'status':
                await this.statusCommand();
                break;

            default:
                this.error(`Unknown command: ${command}`);
                this.showHelp();
                process.exit(1);
        }
    }
}

// Only run if this file is executed directly
if (require.main === module) {
    const cli = new KEKCli();
    cli.run().catch(error => {
        console.error('Unexpected error:', error);
        process.exit(1);
    });
}

module.exports = KEKCli;
