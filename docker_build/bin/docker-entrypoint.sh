#!/bin/bash

# entry point for nubo docker add all needed commands here

# Copy master key if it exists and is readable by root
# This handles the case where /run/nubo is mounted as read-only
if [ -f /run/nubo/mk.bin ] && [ -r /run/nubo/mk.bin ]; then
    echo "KEK: Copying master key to writable location for nubo user access..."
    
    # Create directory if it doesn't exist
    mkdir -p /tmp/nubo
    
    # Copy the master key
    cp /run/nubo/mk.bin /tmp/nubo/mk.bin
    
    # Set ownership and permissions for nubo user
    chown nubo:nubo /tmp/nubo/mk.bin
    chmod 600 /tmp/nubo/mk.bin
    
    echo "KEK: Master key successfully copied to /tmp/nubo/mk.bin"
elif [ -f /run/nubo/mk.bin ]; then
    echo "KEK: Master key exists at /run/nubo/mk.bin but is not readable"
else
    echo "KEK: No master key found at /run/nubo/mk.bin (encrypted keys will not be supported)"
fi

exec "$@"
