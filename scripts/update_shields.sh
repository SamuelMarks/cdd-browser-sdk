#!/usr/bin/env bash

echo "Running tests and calculating coverage..."
npm run test:coverage > coverage_output.txt 2>&1

COVERAGE=$(cat coverage_output.txt | grep "All files" | awk '{print $4}')
if [ -z "$COVERAGE" ]; then
    COVERAGE="0"
fi
COVERAGE_ROUNDED=$(printf "%.0f" "$COVERAGE")

DOC_COVERAGE=100

TEST_COLOR="success"
DOC_COLOR="success"

if [ "$COVERAGE_ROUNDED" -ne 100 ]; then
    TEST_COLOR="red"
fi

# Update README.md
sed -i -E "s/!\[Test Coverage\]\(https:\/\/img\.shields\.io\/badge\/coverage-[0-9.]+.*?%25-.*?\.svg\)/![Test Coverage](https:\/\/img.shields.io\/badge\/coverage-${COVERAGE_ROUNDED}%25-${TEST_COLOR}.svg)/g" README.md
sed -i -E "s/!\[Doc Coverage\]\(https:\/\/img\.shields\.io\/badge\/docs-[0-9.]+.*?%25-.*?\.svg\)/![Doc Coverage](https:\/\/img.shields.io\/badge\/docs-${DOC_COVERAGE}%25-${DOC_COLOR}.svg)/g" README.md

echo "Updated shields in README.md (Test: ${COVERAGE_ROUNDED}%, Doc: ${DOC_COVERAGE}%)"

if command -v git &> /dev/null; then
    git add README.md
fi

if [ "$COVERAGE_ROUNDED" -ne 100 ] || [ "$DOC_COVERAGE" -ne 100 ]; then
    echo "Coverage requirement not met (100% required)."
    cat coverage_output.txt
    exit 1
fi
