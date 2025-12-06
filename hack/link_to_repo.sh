#!/bin/bash
# link_to_repo.sh - Link Claude Code setup to another repository
# Usage: ./hack/link_to_repo.sh /path/to/other-repo [--full|--minimal]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
TARGET_REPO=""
MODE="minimal"

show_help() {
    echo "Usage: $0 TARGET_REPO [--full|--minimal]"
    echo ""
    echo "Options:"
    echo "  --minimal    Link only core .claude and spec_metadata.sh (default)"
    echo "  --full       Link everything including worktree and Linear scripts"
    echo "  --help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 ~/projects/myapp"
    echo "  $0 ~/projects/myapp --full"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            show_help
            exit 0
            ;;
        --full)
            MODE="full"
            shift
            ;;
        --minimal)
            MODE="minimal"
            shift
            ;;
        *)
            if [ -z "$TARGET_REPO" ]; then
                TARGET_REPO=$1
            else
                echo -e "${RED}Error: Unknown argument: $1${NC}"
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate target repo
if [ -z "$TARGET_REPO" ]; then
    show_help
    exit 1
fi

if [ ! -d "$TARGET_REPO" ]; then
    echo -e "${RED}Error: $TARGET_REPO does not exist${NC}"
    exit 1
fi

# Get absolute path to humanlayer repo
HUMANLAYER_DIR=$(cd "$(dirname "$0")/.." && pwd)

# Change to target repo
cd "$TARGET_REPO"

echo -e "${BLUE}🔗 Linking Claude Code setup from $HUMANLAYER_DIR${NC}"
echo -e "${BLUE}   Mode: $MODE${NC}"
echo ""

# Function to create symlink with feedback
link_file() {
    local source=$1
    local target=$2
    local description=$3

    if [ -e "$target" ]; then
        if [ -L "$target" ]; then
            echo -e "${YELLOW}⚠️  $description already linked, skipping${NC}"
        else
            echo -e "${YELLOW}⚠️  $description already exists (not a symlink), skipping${NC}"
        fi
    else
        ln -s "$source" "$target"
        echo -e "${GREEN}✅ Linked $description${NC}"
    fi
}

# Create .claude directory if needed
mkdir -p .claude

# Link .claude contents (except settings.json)
link_file "$HUMANLAYER_DIR/.claude/agents" ".claude/agents" ".claude/agents"
link_file "$HUMANLAYER_DIR/.claude/commands" ".claude/commands" ".claude/commands"

# Create hack directory if needed
mkdir -p hack

# Link essential script
link_file "$HUMANLAYER_DIR/hack/spec_metadata.sh" "hack/spec_metadata.sh" "spec_metadata.sh"

# Full mode: link additional scripts
if [ "$MODE" = "full" ]; then
    echo ""
    echo -e "${BLUE}📦 Linking additional scripts (full mode)...${NC}"

    link_file "$HUMANLAYER_DIR/hack/create_worktree.sh" "hack/create_worktree.sh" "create_worktree.sh"
    link_file "$HUMANLAYER_DIR/hack/cleanup_worktree.sh" "hack/cleanup_worktree.sh" "cleanup_worktree.sh"
    link_file "$HUMANLAYER_DIR/hack/linear" "hack/linear" "linear integration"
fi

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Add symlinks to .gitignore:"
echo "     echo '.claude/agents' >> .gitignore"
echo "     echo '.claude/commands' >> .gitignore"
echo "     echo 'hack/spec_metadata.sh' >> .gitignore"
if [ "$MODE" = "full" ]; then
    echo "     echo 'hack/create_worktree.sh' >> .gitignore"
    echo "     echo 'hack/cleanup_worktree.sh' >> .gitignore"
    echo "     echo 'hack/linear' >> .gitignore"
fi
echo ""
echo "  2. Initialize thoughts system:"
echo "     humanlayer thoughts init"
echo "     humanlayer thoughts sync"
echo ""
echo -e "${YELLOW}Note: Changes to humanlayer repo will auto-update this repo via symlinks${NC}"
