// ============================================
// Project Regolith — Custom GLSL Shaders
// Photorealistic lunar regolith rendering
// ============================================

// ---- Crater Terrain Vertex Shader ----
// Applies heightmap displacement + computes world normals
export const craterVertexShader = /* glsl */ `
precision highp float;

uniform float uCraterRadius;
uniform float uCraterDepth;
uniform float uTime;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vDistFromCenter;
varying vec2 vUv;

// ---- Noise functions ----
// Simple hash for pseudo-random
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 2D value noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion (4 octaves)
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.17;
        amplitude *= 0.48;
    }
    return value;
}

// ---- Crater heightmap in GLSL ----
float craterHeightGLSL(vec2 pos) {
    float r = length(pos);
    float sigma = uCraterRadius * 0.45;

    // Main bowl
    float h = -uCraterDepth * exp(-(r * r) / (2.0 * sigma * sigma));

    // Rim uplift
    float rimSigma = uCraterRadius * 0.15;
    float rimCenter = uCraterRadius * 0.85;
    float rimDist = r - rimCenter;
    h += 12.0 * exp(-(rimDist * rimDist) / (2.0 * rimSigma * rimSigma));

    // Multi-scale roughness via FBM
    h += 3.0 * fbm(pos * 0.02);
    h += 1.5 * fbm(pos * 0.05 + 17.3);
    h += 0.8 * fbm(pos * 0.12 + 42.7);

    // Scattered boulders
    float boulderNoise = noise(pos * 0.008);
    if (boulderNoise > 0.72) {
        float boulderHeight = (boulderNoise - 0.72) * 25.0;
        h += boulderHeight * smoothstep(0.72, 0.85, boulderNoise);
    }

    // Small craterlets
    for (int i = 0; i < 3; i++) {
        vec2 center = vec2(
            hash(vec2(float(i) * 13.7, 7.3)) * uCraterRadius * 1.4 - uCraterRadius * 0.7,
            hash(vec2(float(i) * 23.1, 3.1)) * uCraterRadius * 1.4 - uCraterRadius * 0.7
        );
        float craterletR = length(pos - center);
        float craterletSize = 10.0 + hash(vec2(float(i), 0.0)) * 20.0;
        float craterletSigma = craterletSize * 0.4;
        h -= (craterletSize * 0.3) * exp(-(craterletR * craterletR) / (2.0 * craterletSigma * craterletSigma));
    }

    return h;
}

void main() {
    vUv = uv;
    vec3 pos = position;

    // Apply heightmap displacement (Y is up, plane was rotated)
    float h = craterHeightGLSL(pos.xz);
    pos.y = h;
    vHeight = h;
    vDistFromCenter = length(pos.xz);

    // Compute approximate normal via central differences
    float eps = 1.0;
    float hL = craterHeightGLSL(pos.xz + vec2(-eps, 0.0));
    float hR = craterHeightGLSL(pos.xz + vec2( eps, 0.0));
    float hD = craterHeightGLSL(pos.xz + vec2(0.0, -eps));
    float hU = craterHeightGLSL(pos.xz + vec2(0.0,  eps));
    vec3 computedNormal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));

    vWorldNormal = normalize(normalMatrix * computedNormal);
    vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// ---- Crater Terrain Fragment Shader ----
// Photorealistic regolith with PBR-like lighting
export const craterFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uTime;
uniform float uShadowBoundaryX;
uniform float uCraterDepth;
uniform float uCraterRadius;
uniform vec3 uCameraPosition;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vDistFromCenter;
varying vec2 vUv;

// ---- Noise ----
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
        value += amp * noise(p * freq);
        freq *= 2.13;
        amp *= 0.47;
    }
    return value;
}

// Micro-grain noise (very high frequency for regolith texture)
float microGrain(vec2 p) {
    return hash(floor(p * 50.0)) * 0.03;
}

// ---- Oren-Nayar diffuse (rough surface) ----
float orenNayar(vec3 N, vec3 L, vec3 V, float roughness) {
    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.0);
    float angleVN = acos(NdotV);
    float angleLN = acos(NdotL);

    float sigma2 = roughness * roughness;
    float A = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);
    float B = 0.45 * sigma2 / (sigma2 + 0.09);

    float alpha = max(angleVN, angleLN);
    float beta  = min(angleVN, angleLN);

    vec3 projL = normalize(L - N * NdotL);
    vec3 projV = normalize(V - N * NdotV);
    float cosPhiDiff = max(0.0, dot(projL, projV));

    return NdotL * (A + B * cosPhiDiff * sin(alpha) * tan(beta));
}

void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(uCameraPosition - vWorldPosition);
    vec3 L = normalize(uSunDirection);

    // ---- Base regolith color ----
    // Lunar regolith is grey with subtle brown/blue variations
    float heightNorm = clamp((vHeight + uCraterDepth) / (uCraterDepth + 15.0), 0.0, 1.0);

    // Base color: dark grey in depths, lighter grey on rim
    vec3 baseGrey = mix(
        vec3(0.08, 0.08, 0.09),   // deep crater floor
        vec3(0.32, 0.31, 0.29),   // rim / highlands
        heightNorm
    );

    // Subtle color variation from noise
    float colorNoise = fbm(vWorldPosition.xz * 0.015);
    vec3 warmTint = vec3(0.15, 0.12, 0.10);  // subtle brown (iron-rich)
    vec3 coolTint = vec3(0.10, 0.11, 0.14);  // subtle blue-grey (titanium-rich)
    vec3 regolithColor = baseGrey + mix(coolTint, warmTint, colorNoise) * 0.08;

    // Micro grain texture
    regolithColor += vec3(microGrain(vWorldPosition.xz)) * 0.5;

    // Slope-based darkening (steeper slopes = more dust accumulated differently)
    float slopeAngle = 1.0 - abs(dot(N, vec3(0.0, 1.0, 0.0)));
    regolithColor *= mix(1.0, 0.75, slopeAngle * slopeAngle);

    // ---- Lighting ----
    // Oren-Nayar diffuse for rough surface
    float roughness = 0.85;
    float diffuse = orenNayar(N, L, V, roughness);

    // Low-angle sun creates dramatic shadows in small crevices
    float selfShadow = smoothstep(-0.02, 0.08, dot(N, L));
    diffuse *= selfShadow;

    // Ambient (very dim — space has no atmosphere scattering)
    vec3 ambient = regolithColor * vec3(0.015, 0.018, 0.025);

    // Earth-shine (very subtle blue fill from above)
    float earthshine = max(dot(N, vec3(0.0, 1.0, 0.0)), 0.0) * 0.02;
    ambient += vec3(0.05, 0.08, 0.15) * earthshine;

    // Direct sun contribution
    vec3 directLight = regolithColor * uSunColor * uSunIntensity * diffuse;

    // ---- Opposition surge (back-scatter brightening when looking toward sun) ----
    float backscatter = pow(max(dot(V, L), 0.0), 8.0) * 0.15;
    directLight += regolithColor * backscatter;

    // ---- Rim lighting (low angle grazing light) ----
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 rimLight = vec3(0.15, 0.20, 0.35) * fresnel * max(dot(N, L), 0.0) * 0.5;

    // ---- Shadow zone ----
    float inShadow = smoothstep(uShadowBoundaryX + 5.0, uShadowBoundaryX - 5.0, vWorldPosition.x);

    // In shadow: only ambient + faint thermal glow
    vec3 shadowColor = ambient + vec3(0.003, 0.002, 0.008); // near total darkness

    // Final composition
    vec3 litColor = ambient + directLight + rimLight;
    vec3 finalColor = mix(litColor, shadowColor, inShadow);

    // ---- Tone mapping ----
    // Simple Reinhard
    finalColor = finalColor / (finalColor + vec3(1.0));

    // Gamma correction
    finalColor = pow(finalColor, vec3(1.0 / 2.2));

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ---- Shadow Overlay Shader ----
export const shadowVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const shadowFragmentShader = /* glsl */ `
precision highp float;

uniform float uShadowBoundaryX;
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    // Shadow edge with soft gradient
    float shadowIntensity = smoothstep(uShadowBoundaryX + 15.0, uShadowBoundaryX - 10.0, vWorldPos.x);

    // Edge glow effect (blue/purple at boundary)
    float edgeDist = abs(vWorldPos.x - uShadowBoundaryX);
    float edgeGlow = exp(-edgeDist * 0.15) * 0.6;
    float pulse = 0.8 + 0.2 * sin(uTime * 2.0 + vWorldPos.z * 0.1);
    edgeGlow *= pulse;

    vec3 shadowBase = vec3(0.0, 0.0, 0.02) * shadowIntensity;
    vec3 glowColor = vec3(0.15, 0.25, 0.8) * edgeGlow * shadowIntensity;

    float alpha = shadowIntensity * 0.75 + edgeGlow * 0.3;

    gl_FragColor = vec4(shadowBase + glowColor, alpha);
}
`;

// ---- Dust Particle Vertex Shader ----
export const dustVertexShader = /* glsl */ `
attribute float size;
attribute float alpha;
uniform float uTime;

varying float vAlpha;

void main() {
    vAlpha = alpha;
    vec3 pos = position;

    // Gentle float animation
    pos.y += sin(uTime * 0.5 + position.x * 0.1) * 0.5;
    pos.x += sin(uTime * 0.3 + position.z * 0.15) * 0.3;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const dustFragmentShader = /* glsl */ `
varying float vAlpha;

void main() {
    // Soft circular particle
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float soft = 1.0 - smoothstep(0.2, 0.5, dist);

    gl_FragColor = vec4(0.6, 0.58, 0.55, vAlpha * soft * 0.3);
}
`;
