#!/bin/bash

# Terrain Texture Compression Script
# Uses ImageMagick to optimize PNG textures while preserving quality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/.backup"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MAX_SIZE=2048          # Max dimension for textures (set to 4096 to keep original size)
PNG_QUALITY=95         # PNG compression quality (higher = better quality, larger file)
CREATE_BACKUP=true     # Create backups before compressing

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Terrain Texture Compression Tool${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo -e "${RED}Error: ImageMagick is not installed.${NC}"
    echo "Install with: sudo apt install imagemagick"
    exit 1
fi

# Create backup directory if needed
if [ "$CREATE_BACKUP" = true ]; then
    mkdir -p "$BACKUP_DIR"
    echo -e "${YELLOW}Backups will be saved to: $BACKUP_DIR${NC}"
    echo ""
fi

# Function to get file size in bytes
get_size() {
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null
}

# Function to format bytes to human readable
format_size() {
    local bytes=$1
    if [ $bytes -ge 1048576 ]; then
        echo "$(echo "scale=1; $bytes / 1048576" | bc)M"
    elif [ $bytes -ge 1024 ]; then
        echo "$(echo "scale=1; $bytes / 1024" | bc)K"
    else
        echo "${bytes}B"
    fi
}

# Global variable to track saved bytes (avoids subshell issues)
LAST_SAVED=0

# Function to compress a single texture
compress_texture() {
    local file="$1"
    local filename=$(basename "$file")
    local dirname=$(basename "$(dirname "$file")")
    local display_name="$dirname/$filename"
    
    LAST_SAVED=0
    
    # Get original size
    local original_size=$(get_size "$file")
    
    # Determine texture type for optimal compression
    local is_normal=false
    local is_grayscale=false
    
    if [[ "$filename" == *"normal"* ]]; then
        is_normal=true
    elif [[ "$filename" == *"height"* ]] || [[ "$filename" == *"rough"* ]] || [[ "$filename" == *"ao"* ]] || [[ "$filename" == *"metal"* ]]; then
        is_grayscale=true
    fi
    
    # Get current dimensions
    local dimensions=$(identify -format "%wx%h" "$file" 2>/dev/null)
    local width=$(echo "$dimensions" | cut -d'x' -f1)
    local height=$(echo "$dimensions" | cut -d'x' -f2)
    
    # Build conversion command
    local convert_args=()
    
    # Resize if larger than MAX_SIZE
    if [ "$width" -gt "$MAX_SIZE" ] || [ "$height" -gt "$MAX_SIZE" ]; then
        convert_args+=("-resize" "${MAX_SIZE}x${MAX_SIZE}")
        echo -e "  ${YELLOW}Resizing from ${width}x${height} to max ${MAX_SIZE}x${MAX_SIZE}${NC}"
    fi
    
    # Strip metadata
    convert_args+=("-strip")
    
    # Optimize PNG compression
    # For normal maps, use higher quality settings
    if [ "$is_normal" = true ]; then
        convert_args+=("-quality" "95")
        convert_args+=("-define" "png:compression-filter=2")
        convert_args+=("-define" "png:compression-level=9")
        convert_args+=("-define" "png:compression-strategy=1")
    # For grayscale textures, optimize more aggressively
    elif [ "$is_grayscale" = true ]; then
        convert_args+=("-quality" "90")
        convert_args+=("-define" "png:compression-filter=5")
        convert_args+=("-define" "png:compression-level=9")
        convert_args+=("-define" "png:compression-strategy=1")
    # For color textures
    else
        convert_args+=("-quality" "95")
        convert_args+=("-define" "png:compression-filter=5")
        convert_args+=("-define" "png:compression-level=9")
        convert_args+=("-define" "png:compression-strategy=1")
    fi
    
    # Create backup
    if [ "$CREATE_BACKUP" = true ]; then
        local backup_subdir="$BACKUP_DIR/$dirname"
        mkdir -p "$backup_subdir"
        cp "$file" "$backup_subdir/$filename"
    fi
    
    # Create temp file and compress
    local temp_file=$(mktemp)
    convert "$file" "${convert_args[@]}" "$temp_file"
    
    # Get new size
    local new_size=$(get_size "$temp_file")
    
    # Only keep if smaller
    if [ "$new_size" -lt "$original_size" ]; then
        mv "$temp_file" "$file"
        local saved=$((original_size - new_size))
        local percent=$((saved * 100 / original_size))
        LAST_SAVED=$saved
        echo -e "  ${GREEN}✓ $(format_size $original_size) → $(format_size $new_size) (saved $(format_size $saved), ${percent}%)${NC}"
    else
        rm "$temp_file"
        echo -e "  ${BLUE}○ Already optimized ($(format_size $original_size))${NC}"
    fi
}

# Main processing
total_saved=0
file_count=0

echo -e "${BLUE}Processing textures...${NC}"
echo ""

# Find and process all PNG files
for texture_dir in "$SCRIPT_DIR"/*/; do
    if [ -d "$texture_dir" ] && [ "$(basename "$texture_dir")" != ".backup" ]; then
        dir_name=$(basename "$texture_dir")
        echo -e "${YELLOW}[$dir_name]${NC}"
        
        for file in "$texture_dir"*.png; do
            if [ -f "$file" ]; then
                filename=$(basename "$file")
                echo -e "  Processing: $filename"
                compress_texture "$file"
                total_saved=$((total_saved + LAST_SAVED))
                file_count=$((file_count + 1))
            fi
        done
        echo ""
    fi
done

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Compression complete!${NC}"
echo -e "  Files processed: $file_count"
echo -e "  Total saved: $(format_size $total_saved)"

if [ "$CREATE_BACKUP" = true ]; then
    echo ""
    echo -e "${YELLOW}Original files backed up to: $BACKUP_DIR${NC}"
    echo -e "To restore: cp -r $BACKUP_DIR/* $SCRIPT_DIR/"
fi
