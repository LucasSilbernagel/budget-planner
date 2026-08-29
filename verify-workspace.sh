#!/bin/bash

# Verify pnpm is installed
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm not found. Please install pnpm first."; exit 1; }

echo "=== Longhand Budget Monorepo Verification ==="
echo ""

echo "1. Checking pnpm workspaces configuration..."
if [ -f "pnpm-workspace.yaml" ]; then
    echo "   ✅ pnpm-workspace.yaml exists"
    echo "   Content:"
    cat pnpm-workspace.yaml | sed 's/^/      /'
else
    echo "   ❌ pnpm-workspace.yaml missing"
fi

echo ""
echo "2. Checking directory structure..."
for dir in apps/web packages/db packages/config packages/core; do
    if [ -d "$dir" ]; then
        echo "   ✅ $dir directory exists"
    else
        echo "   ❌ $dir directory missing"
    fi
done

echo ""
echo "3. Checking package.json files..."
for file in package.json apps/web/package.json packages/db/package.json packages/config/package.json packages/core/package.json; do
    if [ -f "$file" ]; then
        echo "   ✅ $file exists"
    else
        echo "   ❌ $file missing"
    fi
done

echo ""
echo "4. Checking TypeScript configuration..."
for file in tsconfig.json apps/web/tsconfig.json packages/db/tsconfig.json packages/config/tsconfig.json packages/core/tsconfig.json; do
    if [ -f "$file" ]; then
        echo "   ✅ $file exists"
    else
        echo "   ❌ $file missing"
    fi
done

echo ""
echo "5. Testing pnpm workspaces..."
echo "   Running: pnpm --filter web run dev"
pnpm --filter web run dev 2>&1 | sed 's/^/      /'

echo ""
echo "   Running: pnpm --filter db run dev"
pnpm --filter db run dev 2>&1 | sed 's/^/      /'

echo ""
echo "   Running: pnpm --filter config run dev"
pnpm --filter config run dev 2>&1 | sed 's/^/      /'

 echo ""
echo "   Running: pnpm --filter core run dev"
pnpm --filter core run dev 2>&1 | sed 's/^/      /'

echo ""
echo "6. Testing pnpm ls..."
pnpm ls --depth -1 2>&1 | sed 's/^/   /'

echo ""
echo "=== Verification Complete ==="
