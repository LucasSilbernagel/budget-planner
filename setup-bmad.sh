#!/bin/bash

# BMAD Setup Script for Longhand Budget Project
# This script helps you install and configure BMAD Method

echo "=========================================="
echo "BMAD Method Setup for Longhand Budget"
echo "=========================================="
echo ""

# Check Node.js version
NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
REQUIRED_VERSION="20.12.0"

if [ -z "$NODE_VERSION" ]; then
    echo "❌ Node.js is not installed."
    echo "   Please install Node.js 20.12+ from https://nodejs.org/"
    exit 1
fi

# Compare versions
if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" = "$REQUIRED_VERSION" ] && [ "$NODE_VERSION" != "$REQUIRED_VERSION" ]; then
    echo "✅ Node.js version: v$NODE_VERSION (meets requirement: 20.12+)"
else
    echo "❌ Node.js version: v$NODE_VERSION (requires 20.12+)"
    echo "   Please upgrade Node.js from https://nodejs.org/"
    exit 1
fi

echo ""
echo "📦 Installing BMAD Method..."
echo ""

# Install BMAD
npx bmad-method install

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ BMAD Method installed successfully!"
    echo ""
    echo "=========================================="
    echo "Next Steps:"
    echo "=========================================="
    echo ""
    echo "1. Add your product document to: product-document.md"
    echo "2. Run the following command to get started:"
    echo ""
    echo "   bmad-help I have a product document for a budget planner. Where should I start?"
    echo ""
    echo "3. Or start with analysis phase:"
    echo "   bmad-product-brief"
    echo ""
    echo "4. Then create your PRD:"
    echo "   bmad-prd Create"
    echo ""
else
    echo "❌ BMAD installation failed."
    echo "   Check the error messages above and try again."
    exit 1
fi
