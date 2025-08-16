// The MIT License
// Copyright © 2024 Gehtsiegarnixan
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
/*
I introduce a novel Height Blend method to address issues with existing techniques. 
Height interpolation, a common graphics technique, blends samples (usually texture 
colors) based on their height information. Heightmaps for each sample bias the 
blending weight, creating a natural texture transition. I propose a stable Height 
Blend criterion: a sample is fully visible at 100% weight and entirely hidden at 0%.

Initially, I tried to compare this method with others, but found existing techniques 
fail with extreme height values (0.0 or 1.0). Interestingly, I developed several 
unique methods, each with many variations, without much effort. So there are a lot 
more variations possible with different approaches and strengths. If you have stable 
height blend methods, please share them.

The shader demonstrates linear (2 value), barycentric (3 value), and bilinear (4 value) 
interpolation in three columns. Mouse control adjusts the contrast on the Y-axis and 
enlarges a column by moving the X-axis to a column center. Global constants provide 
additional control and alternate views.
*/

// Enable to show the weights (Alpha); disable to show blending with textures
#define SHOW_WEIGHTS

// Uncomment and set height values; heights should be in the range of 0-1
// Linear interpolation is XY, barycentric is XYZ, and bilinear is XYZW
//#define HEIGHT vec4(0.0, 1.0, 0.25, 0.75)

// Offsets linear weights based on height differences. Contrast value range is 0-inf, 
// but ~16 should probably be the max, as weight transitions become too steep
// See: https://www.desmos.com/calculator/gxhnhzu1cs
float heightWeight(float weight, vec2 heights, float contrast) {
    
    // Generate both weights
    vec2 weights = vec2(1. - weight, weight);
    
    // Generate the height weight
    // Bias (+1) can be closer to 0, but float errors may come up
    vec2 heightWeights = weights * pow(heights +1.0, vec2(contrast));

    // Normalize to sum 1 and return weight y since linear only needs one
    return heightWeights.y / (heightWeights.x + heightWeights.y);
}

// Offsets barycentric weights based on height differences
vec3 baryHeightWeight(vec3 weights, vec3 heights, float contrast) {
    
    // Generate the height weight
    vec3 heightWeights = weights * pow(heights +1.0, vec3(contrast));

    // Normalize to sum 1
    return heightWeights / (heightWeights.x + heightWeights.y + heightWeights.z);
}

// Offsets bilinear weights based on height differences
vec4 bilinearHeightWeight(vec4 weights, vec4 heights, float contrast) {
    
    // Generate the height weight
    vec4 heightWeights = weights * pow(heights +1.0, vec4(contrast));

    // Normalize to sum 1
    return heightWeights / (heightWeights.x + heightWeights.y + heightWeights.z + heightWeights.w);
}

// Demo of linear height tiling with height blending
vec3 heightBlend(vec2 gridUV, float contrast, vec2 detailUV) {

    // Calculate zigzag linear weight
    float weight = abs(fract(gridUV.y * 0.5) * 2.0 - 1.0);
        
    // So a small section is 0. and 1. to show the heighblend does not encroach on them
    weight = straightContrast(weight, 1.1); 
    
    // Optionally increase the contrast for nicer transitions
    // https://www.desmos.com/calculator/6c62nyvwou
    weight = smoothContrast(weight, 1.6);
    
    // Choose between using constant height values or sampling heightmaps
    #ifdef HEIGHT
        // Use constant height values
        vec2 heights = HEIGHT.xy;
        
    #else
        // Sample heightmaps
        float heightA = texture(iChannel0, detailUV).x;
        float heightB = texture(iChannel1, detailUV).x;
        
        // Combine heights
        vec2 heights = vec2(heightA, heightB);
    #endif

    // Offset weight with height bias by contrast
    float heightWeight = heightWeight(weight, heights, contrast);
    
    // Debug view of weights
    #ifdef SHOW_WEIGHTS
        // Apply a colormap for visual clarity
        return viridis(heightWeight);
    #endif

    // Sample albedo textures
    vec3 colorA = texture(iChannel0, detailUV).xyz;
    vec3 colorB = bone(texture(iChannel1, detailUV).x);

    // Interpolate between the textures based on the final weight
    return mix(colorA, colorB, heightWeight);
}

// Demo of Barycentric interpolation with bias from heightmaps
vec3 baryHeightBlend(vec2 gridUV, float contrast, vec2 detailUV) {

    // Calculate barycentric weights for a square pattern
    vec3 weights = baryWeights(gridUV);

    // So a small section is 0. and 1. to show the heighblend does not encroach on them
    weights = straightContrast(weights, 1.1); 

    // Optionally increase the contrast for nicer transitions
    weights = smoothContrast(weights, 1.6);

    // Choose between using constant height values or sampling heightmaps
    #ifdef HEIGHT
        // Use constant height values
        vec3 heights = HEIGHT.xyz;
        
    #else
        // Sample heightmaps
        float heightA = texture(iChannel0, detailUV).x;
        float heightB = texture(iChannel1, detailUV).x;
        float heightC = texture(iChannel2, detailUV).y;

        // Combine heights
        vec3 heights = vec3(heightA, heightB, heightC);
    #endif
    
    // Offset weight with height bias by contrast
    vec3 heightWeights = baryHeightWeight(weights, heights, contrast);
        
    // Debug view of weights
    #ifdef SHOW_WEIGHTS
        // Show weights / Alpha values
        return heightWeights;
    #endif

    // Sample albedo textures
    vec3 colorA = texture(iChannel0, detailUV).xyz;
    vec3 colorB = bone(texture(iChannel1, detailUV).x);
    vec3 colorC = texture(iChannel2, detailUV).xyz;

    // Interpolate between the textures based on the final weights
    return colorA * heightWeights.x + colorB * heightWeights.y + colorC * heightWeights.z;
}

// Demo of Bilinear interpolation with bias from heightmaps
vec3 bilinearHeightBlend(vec2 gridUV, float contrast, vec2 detailUV) {   

    // Calculate vanilla bilinear weights
    vec4 weights = bilinearWeights(gridUV);
    
    // So a small section is 0. and 1. to show the heighblend does not encroach on them
    weights = straightContrast(weights, 1.1); 
    
    // Optionally increase the contrast for nicer transitions
    weights = smoothContrast(weights, 1.6);
    
    // Choose between using constant height values or sampling heightmaps
    #ifdef HEIGHT
        // Use constant height values
        vec4 heights = HEIGHT;
        
    #else
        // Sample heightmaps
        float heightA = texture(iChannel0, detailUV).x;
        float heightB = texture(iChannel1, detailUV).x;
        float heightC = texture(iChannel2, detailUV).y;
        float heightD = texture(iChannel3, detailUV).x;
        
        // Combine heights
        vec4 heights = vec4(heightA, heightB, heightC, heightD);
    #endif
    
    // Generate biased weights using bilinear interpolation
    vec4 heightWeights = bilinearHeightWeight(weights, heights, contrast);
    
    // Debug view of weights
    #ifdef SHOW_WEIGHTS
        // Show weights / Alpha values
        return heightWeights.xyz;
    #endif
    
    // Sample albedo textures
    vec3 colorA = texture(iChannel0, detailUV).xyz;
    vec3 colorB = bone(texture(iChannel1, detailUV).x);
    vec3 colorC = texture(iChannel2, detailUV).xyz;
    vec3 colorD = texture(iChannel3, detailUV).xyz;
     
    // Interpolate between the textures
    vec3 color = colorA * heightWeights.x + 
                 colorB * heightWeights.y + 
                 colorC * heightWeights.z +
                 colorD * heightWeights.w;
    return color;
}

// Demo of Bilinear interpolation with bias from heightmaps
void mainImage(out vec4 fragColor, in vec2 fragCoord) {   

    // Calculate UVs for the x-axis of the window
    vec2 uv = fragCoord / iResolution.x;
    
    // Calculate UVs for the blend grids
    vec2 gridUV = uv * 6.0;
    
    // Calculate UVs for the detail texture
    vec2 detailUV = uv * 7.0;
    
    // Create a float to divide into sections for comparisons
    float comparisonX = uv.x * 3.0;

    // Enable mouse controls when clicked; otherwise, animate
    float pointer;
    float contrast;
    if (iMouse.x > 0.0) {
        // Mouse controls
        vec2 mouse = iMouse.xy / iResolution.xy;
        contrast = mix(0.0, 16.0, pow(mouse.y, 2.0));
        pointer = mouse.x * 3.0;
    } else {
        // Animation when no mouse input is used
        float myTime = iTime * 1.0;
        contrast = mix(0.0, 12.0, pow(sin(myTime) * 0.5 + 0.5, 2.0));
        // pointer = fract(iTime * 0.05) * 3.0;
    }
    
    // Create zigzag weights
    float weight = abs(fract(pointer - 0.5) * 2.0 - 1.0);
    
    // Make transitions dead zones for easier use
    weight = straightContrast(weight, 2.);
            
    // Define default edge locations for the columns
    vec2 columnEdges = vec2(1.0, 2.0); 
    
    // Mouse-controlled animations to zoom into the columns    
    vec2 zoomColumnEdges = columnEdges;
    if (pointer <= 1.0) {
        // Zoom into the left side        
        zoomColumnEdges = vec2(2.8, 2.9);
    } else if (pointer <= 2.0) {
        // Zoom into the center column
        zoomColumnEdges = vec2(0.1, 2.9);
    } else {
        // Zoom into the right column
        zoomColumnEdges = vec2(0.1, 0.2);
    }

    // Interpolate between default column edge positions and zoom
    columnEdges = mix(columnEdges, zoomColumnEdges, weight);    
    
    // Choose interpolation method based on the x-coordinate
    vec3 color;
    if (comparisonX <= columnEdges.x) {
        // Left side
        color = heightBlend(gridUV, contrast, detailUV);
                        
    } else if (comparisonX <= columnEdges.y) {
        // Center section
        color = baryHeightBlend(gridUV, contrast, detailUV);
        
    } else {
        // Right side        
        color = bilinearHeightBlend(gridUV, contrast, detailUV);
    }
    
    // Add lines between columns
    float borderThickness = 0.004;    
    color += step(abs(comparisonX - columnEdges.x), borderThickness);
    color += step(abs(comparisonX - columnEdges.y), borderThickness);
    
    // Add arrows pointing at the center of columns
    color += step(uv.y + abs(fract(comparisonX)-0.5), borderThickness*5.);
            
    // Set the output color
    fragColor = vec4(color, 1.0);
}