"use strict";

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

/**
 * KEK (Key Encryption Key) Framework
 * Provides optional encryption/decryption for TLS private keys using a master key
 */

const MASTER_KEY_PATH = '/run/nubo/mk.bin';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // 128 bits for CBC
const TAG_LENGTH = 0; // CBC doesn't use auth tags
const ENCRYPTED_HEADER = '-----BEGIN NUBO ENCRYPTED PRIVATE KEY-----';
const ENCRYPTED_FOOTER = '-----END NUBO ENCRYPTED PRIVATE KEY-----';

// Common private key headers to detect unencrypted keys
const PRIVATE_KEY_HEADERS = [
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----',
    '-----BEGIN DSA PRIVATE KEY-----',
    '-----BEGIN OPENSSH PRIVATE KEY-----'
];

let masterKeyCache = null;
let masterKeyAvailable = null;

/**
 * Check if master key file exists and is readable
 * @returns {Promise<boolean>}
 */
async function isMasterKeyAvailable() {
    if (masterKeyAvailable !== null) {
        return masterKeyAvailable;
    }
    
    try {
        await fsp.access(MASTER_KEY_PATH, fs.constants.R_OK);
        masterKeyAvailable = true;
        return true;
    } catch (error) {
        masterKeyAvailable = false;
        return false;
    }
}

/**
 * Read and cache the master key
 * @returns {Promise<Buffer>}
 */
async function getMasterKey() {
    if (masterKeyCache) {
        return masterKeyCache;
    }
    
    if (!(await isMasterKeyAvailable())) {
        throw new Error('Master key not available');
    }
    
    try {
        const keyData = await fsp.readFile(MASTER_KEY_PATH);
        if (keyData.length !== 32) {
            throw new Error('Master key must be exactly 32 bytes');
        }
        masterKeyCache = keyData;
        return masterKeyCache;
    } catch (error) {
        throw new Error(`Failed to read master key: ${error.message}`);
    }
}

/**
 * Check if key content is encrypted by examining headers
 * @param {string} keyContent - The key content as string
 * @returns {boolean}
 */
function isKeyEncrypted(keyContent) {
    if (!keyContent || typeof keyContent !== 'string') {
        return false;
    }
    
    const trimmed = keyContent.trim();
    return trimmed.startsWith(ENCRYPTED_HEADER);
}

/**
 * Check if key content appears to be a valid private key
 * @param {string} keyContent - The key content as string
 * @returns {boolean}
 */
function isValidPrivateKey(keyContent) {
    if (!keyContent || typeof keyContent !== 'string') {
        return false;
    }
    
    const trimmed = keyContent.trim();
    return PRIVATE_KEY_HEADERS.some(header => trimmed.startsWith(header));
}

/**
 * Encrypt private key content
 * @param {string} keyContent - Plain private key content
 * @returns {Promise<string>} Encrypted key content
 */
async function encryptPrivateKey(keyContent) {
    if (!keyContent || typeof keyContent !== 'string') {
        throw new Error('Invalid key content provided');
    }
    
    // if (!isValidPrivateKey(keyContent)) {
    //     throw new Error('Content does not appear to be a valid private key');
    // }
    
    if (isKeyEncrypted(keyContent)) {
        throw new Error('Key is already encrypted');
    }
    
    const masterKey = await getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipher(ALGORITHM, masterKey);
    
    let encrypted = cipher.update(keyContent, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Combine IV + encrypted data (no auth tag for CBC)
    const combined = Buffer.concat([iv, encrypted]);
    const base64Data = combined.toString('base64');
    
    // Format as PEM-like structure
    const lines = base64Data.match(/.{1,64}/g) || [];
    const formattedKey = [
        ENCRYPTED_HEADER,
        ...lines,
        ENCRYPTED_FOOTER
    ].join('\n') + '\n';
    
    return formattedKey;
}

/**
 * Decrypt private key content
 * @param {string} encryptedContent - Encrypted key content
 * @returns {Promise<string>} Decrypted key content
 */
async function decryptPrivateKey(encryptedContent) {
    if (!encryptedContent || typeof encryptedContent !== 'string') {
        throw new Error('Invalid encrypted content provided');
    }
    
    if (!isKeyEncrypted(encryptedContent)) {
        throw new Error('Content is not encrypted or invalid format');
    }
    
    const masterKey = await getMasterKey();
    
    // Extract base64 content between headers
    const lines = encryptedContent.split('\n');
    const contentLines = lines.filter(line => 
        line.trim() && 
        !line.includes('-----BEGIN') && 
        !line.includes('-----END')
    );
    
    if (contentLines.length === 0) {
        throw new Error('No encrypted data found');
    }
    
    const base64Data = contentLines.join('');
    const combined = Buffer.from(base64Data, 'base64');
    
    if (combined.length < IV_LENGTH) {
        throw new Error('Invalid encrypted data format');
    }
    
    // Extract components (no auth tag for CBC)
    const iv = combined.subarray(0, IV_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH);
    
    const decipher = crypto.createDecipher(ALGORITHM, masterKey);
    
    try {
        let decrypted = decipher.update(encrypted, null, 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        throw new Error('Failed to decrypt key: Invalid master key or corrupted data');
    }
}

/**
 * Smart key reader that automatically decrypts if needed and master key is available
 * @param {string} keyPath - Path to the key file
 * @returns {Promise<string>} Key content (decrypted if necessary)
 */
async function readPrivateKey(keyPath) {
    if (!keyPath) {
        throw new Error('Key path is required');
    }
    
    try {
        const keyContent = await fsp.readFile(keyPath, 'utf8');
        
        if (isKeyEncrypted(keyContent)) {
            if (await isMasterKeyAvailable()) {
                // Decrypt the key
                return await decryptPrivateKey(keyContent);
            } else {
                throw new Error('Key is encrypted but master key is not available');
            }
        }
        
        // Key is not encrypted, return as-is
        return keyContent;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Key file not found: ${keyPath}`);
        }
        throw error;
    }
}

/**
 * Encrypt a key file
 * @param {string} inputPath - Path to input key file
 * @param {string} outputPath - Path to output encrypted file (optional, defaults to input + .encrypted)
 * @returns {Promise<string>} Path to encrypted file
 */
async function encryptKeyFile(inputPath, outputPath) {
    if (!inputPath) {
        throw new Error('Input path is required');
    }
    
    const keyContent = await fsp.readFile(inputPath, 'utf8');
    const encryptedContent = await encryptPrivateKey(keyContent);
    
    const finalOutputPath = outputPath || `${inputPath}.encrypted`;
    await fsp.writeFile(finalOutputPath, encryptedContent, 'utf8');
    
    return finalOutputPath;
}

/**
 * Decrypt a key file
 * @param {string} inputPath - Path to input encrypted key file
 * @param {string} outputPath - Path to output decrypted file (optional, defaults to input without .encrypted)
 * @returns {Promise<string>} Path to decrypted file
 */
async function decryptKeyFile(inputPath, outputPath) {
    if (!inputPath) {
        throw new Error('Input path is required');
    }
    
    const encryptedContent = await fsp.readFile(inputPath, 'utf8');
    const decryptedContent = await decryptPrivateKey(encryptedContent);
    
    let finalOutputPath = outputPath;
    if (!finalOutputPath) {
        finalOutputPath = inputPath.endsWith('.encrypted') 
            ? inputPath.slice(0, -10)  // Remove .encrypted suffix
            : `${inputPath}.decrypted`;
    }
    
    await fsp.writeFile(finalOutputPath, decryptedContent, 'utf8');
    
    return finalOutputPath;
}

/**
 * Validate a key file
 * @param {string} keyPath - Path to key file
 * @returns {Promise<object>} Validation result
 */
async function validateKeyFile(keyPath) {
    try {
        const keyContent = await fsp.readFile(keyPath, 'utf8');
        const encrypted = isKeyEncrypted(keyContent);
        const masterKeyAvail = await isMasterKeyAvailable();
        
        let valid = false;
        let canDecrypt = false;
        let error = null;
        
        if (encrypted) {
            canDecrypt = masterKeyAvail;
            if (canDecrypt) {
                try {
                    await decryptPrivateKey(keyContent);
                    valid = true;
                } catch (err) {
                    error = err.message;
                }
            } else {
                error = 'Master key not available for decryption';
            }
        } else {
            valid = isValidPrivateKey(keyContent);
            if (!valid) {
                error = 'Content does not appear to be a valid private key';
            }
        }
        
        return {
            encrypted,
            valid,
            canDecrypt,
            masterKeyAvailable: masterKeyAvail,
            error
        };
    } catch (error) {
        return {
            encrypted: false,
            valid: false,
            canDecrypt: false,
            masterKeyAvailable: await isMasterKeyAvailable(),
            error: error.message
        };
    }
}

module.exports = {
    isMasterKeyAvailable,
    isKeyEncrypted,
    isValidPrivateKey,
    encryptPrivateKey,
    decryptPrivateKey,
    readPrivateKey,
    encryptKeyFile,
    decryptKeyFile,
    validateKeyFile
};
