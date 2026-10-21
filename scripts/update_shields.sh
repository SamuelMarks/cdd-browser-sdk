#!/usr/bin/env bash
set -e

cleanup() {
    rm -f coverage_output.txt doc_coverage_output.txt README.md.bak
}
trap cleanup EXIT

echo "Running tests and calculating coverage..."
npm run test:coverage > coverage_output.txt 2>&1 || true

COVERAGE=$(cat coverage_output.txt | grep "All files" | awk -F'|' '{print $2}' | tr -d ' ')
if [ -z "$COVERAGE" ]; then
    COVERAGE="0"
fi
COVERAGE_ROUNDED=$(printf "%.0f" "$COVERAGE")

echo "Running documentation coverage check..."
npm run check:docs > doc_coverage_output.txt 2>&1 || true
DOC_COVERAGE=$(cat doc_coverage_output.txt | grep "Doc coverage:" | sed -E 's/.*\(([0-9]+)%\).*/\1/')
if [ -z "$DOC_COVERAGE" ]; then
    DOC_COVERAGE="0"
fi

TEST_COLOR="success"
DOC_COLOR="success"

if [ "$COVERAGE_ROUNDED" -ne 100 ]; then
    TEST_COLOR="red"
fi

if [ "$DOC_COVERAGE" -ne 100 ]; then
    DOC_COLOR="red"
fi

# Update README.md (portable across GNU and BSD sed)
sed -i.bak -E "s/!\[Test Coverage\]\(https:\/\/img\.shields\.io\/badge\/coverage-[0-9.]+%25-[a-zA-Z0-9_]+\.svg\)/![Test Coverage](https:\/\/img.shields.io\/badge\/coverage-${COVERAGE_ROUNDED}%25-${TEST_COLOR}.svg)/g" README.md
sed -i.bak -E "s/!\[Doc Coverage\]\(https:\/\/img\.shields\.io\/badge\/docs-[0-9.]+%25-[a-zA-Z0-9_]+\.svg\)/![Doc Coverage](https:\/\/img.shields.io\/badge\/docs-${DOC_COVERAGE}%25-${DOC_COLOR}.svg)/g" README.md
rm -f README.md.bak

echo "Updated shields in README.md (Test: ${COVERAGE_ROUNDED}%, Doc: ${DOC_COVERAGE}%)"

if command -v git &> /dev/null; then
    git add README.md
fi

if [ "$COVERAGE_ROUNDED" -ne 100 ] || [ "$DOC_COVERAGE" -ne 100 ]; then
    echo "Coverage requirement not met (100% test and 100% doc coverage required)."
    cat coverage_output.txt
    cat doc_coverage_output.txt
    exit 1
fi
