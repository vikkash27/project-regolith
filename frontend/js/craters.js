// ============================================
// Project Regolith — Lunar Crater Database
// Real south pole craters from LRO mission data
// ============================================
// 
// REFERENCES:
// [1] Mazarico et al. (2011) "Illumination conditions of the lunar polar regions 
//     using LOLA topography" Icarus 211(2), 1066-1081
// [2] Zuber et al. (2012) "Constraints on the volatile distribution within 
//     Shackleton crater at the lunar south pole" Nature 486, 378-381
// [3] Li et al. (2018) "Direct evidence of surface exposed water ice in the 
//     lunar polar regions" PNAS 115(36), 8907-8912
// [4] Paige et al. (2010) "Diviner Lunar Radiometer observations of cold traps 
//     in the Moon's south polar region" Science 330(6003), 479-482
// [5] Lemelin et al. (2014) "Improved calibration of reflectance data from the 
//     LRO Lunar Orbiter Laser Altimeter and implications for space weathering" Icarus 273, 315-328
// [6] Smith, R.G. (1980) "The Contract Net Protocol: High-Level Communication and 
//     Control in a Distributed Problem Solver" IEEE Trans. Computers C-29(12), 1104-1113
// [7] Gerkey & Matarić (2004) "A Formal Analysis and Taxonomy of Task Allocation 
//     in Multi-Robot Systems" Int. J. Robotics Research 23(9), 939-954
// [8] Carrier, Olhoeft & Mendell (1991) "Physical Properties of the Lunar Surface" 
//     Lunar Sourcebook Ch. 9, Cambridge Univ. Press
// [9] Heiken, Vaniman & French (1991) "Lunar Sourcebook: A User's Guide to the Moon"
//     Cambridge University Press
// [10] Wieczorek et al. (2006) "The Constitution and Structure of the Lunar Interior" 
//      Rev. Mineral. Geochem. 60(1), 221-364

export const CRATERS = [
    {
        id: 'shackleton',
        name: 'Shackleton',
        lat: -89.9,
        lon: 0.0,
        diameter_km: 21,
        depth_km: 4.2,
        description: 'Primary Artemis III candidate. Permanently shadowed interior with confirmed water ice deposits on the floor. Named after Ernest Shackleton.',
        difficulty: 'EXTREME',
        features: ['Permanently shadowed floor', 'Confirmed water ice [3]', 'Steep walls >30°', '4.2 km depth'],
        science: 'Zuber et al. (2012) showed the floor has elevated albedo consistent with ~22% ice by mass.',
        terrain_params: { rimHeight: 15, noiseScale: 0.03, boulderDensity: 0.8 },
        citation: 'Zuber et al., Nature 486, 378–381 (2012)',
    },
    {
        id: 'de_gerlache',
        name: 'de Gerlache',
        lat: -88.5,
        lon: -87.1,
        diameter_km: 32,
        depth_km: 3.5,
        description: 'Adjacent to Shackleton. Partially illuminated rim makes it ideal for solar-powered operations near permanently shadowed regions.',
        difficulty: 'HARD',
        features: ['Partial illumination on rim', 'Adjacent to Shackleton', 'Ice deposits on floor [3]'],
        science: 'Li et al. (2018) detected direct evidence of surface-exposed water ice using M³ data from Chandrayaan-1.',
        terrain_params: { rimHeight: 12, noiseScale: 0.025, boulderDensity: 0.6 },
        citation: 'Li et al., PNAS 115(36), 8907–8912 (2018)',
    },
    {
        id: 'cabeus',
        name: 'Cabeus',
        lat: -85.3,
        lon: -35.5,
        diameter_km: 98,
        depth_km: 4.0,
        description: 'LCROSS impact site (2009). NASA crashed a spent Centaur rocket into this crater, confirming ~5.6% water ice in the ejecta plume.',
        difficulty: 'MODERATE',
        features: ['LCROSS impact site', 'Confirmed 5.6% water ice', 'Large flat floor', 'Multiple sub-craters'],
        science: 'Colaprete et al. (2010) measured 5.6 ± 2.9% water ice by mass in the LCROSS ejecta plume from Cabeus.',
        terrain_params: { rimHeight: 10, noiseScale: 0.02, boulderDensity: 0.4 },
        citation: 'Colaprete et al., Science 330, 463–468 (2010)',
    },
    {
        id: 'faustini',
        name: 'Faustini',
        lat: -87.3,
        lon: 77.0,
        diameter_km: 39,
        depth_km: 3.8,
        description: 'Deep permanently shadowed crater with some of the coldest measured temperatures on the Moon (~35K). High potential for ancient volatiles.',
        difficulty: 'EXTREME',
        features: ['Permanent shadow', 'Temperature ~35K [4]', 'Ancient volatile deposits', 'Steep approach'],
        science: 'Paige et al. (2010) measured surface temperatures as low as 35K using the Diviner Lunar Radiometer.',
        terrain_params: { rimHeight: 14, noiseScale: 0.035, boulderDensity: 0.9 },
        citation: 'Paige et al., Science 330(6003), 479–482 (2010)',
    },
    {
        id: 'haworth',
        name: 'Haworth',
        lat: -87.4,
        lon: -5.0,
        diameter_km: 51,
        depth_km: 3.2,
        description: 'Large permanently shadowed crater adjacent to Shackleton. Radar observations suggest possible thick ice deposits.',
        difficulty: 'HARD',
        features: ['Permanent shadow', 'Radar-bright deposits', 'Adjacent to Shackleton', 'Relatively flat floor'],
        science: 'Thomson et al. (2012) reported Miniature Radio Frequency radar cross-section enhancements consistent with water ice.',
        terrain_params: { rimHeight: 11, noiseScale: 0.022, boulderDensity: 0.5 },
        citation: 'Thomson et al., GRL 39, L14201 (2012)',
    },
    {
        id: 'nobile',
        name: 'Nobile',
        lat: -85.2,
        lon: 53.5,
        diameter_km: 73,
        depth_km: 2.8,
        description: 'Named Artemis III candidate site. Offers mix of illuminated rim and shadowed interior craters for both solar power and ice access.',
        difficulty: 'MODERATE',
        features: ['Artemis III candidate', 'Mixed illumination', 'Nested craters', 'Moderate slopes'],
        science: 'Mazarico et al. (2011) showed favorable illumination geometry with >50% sunlight on northern rim.',
        terrain_params: { rimHeight: 9, noiseScale: 0.02, boulderDensity: 0.35 },
        citation: 'Mazarico et al., Icarus 211(2), 1066–1081 (2011)',
    },
    {
        id: 'amundsen',
        name: 'Amundsen',
        lat: -84.5,
        lon: 82.8,
        diameter_km: 105,
        depth_km: 2.5,
        description: 'One of the largest south pole craters with a prominent central peak. Named after Roald Amundsen. Interior partially shadowed.',
        difficulty: 'EASY',
        features: ['Central peak', 'Large flat floor', 'Partial shadow', 'Good landing sites'],
        science: 'De Rosa et al. (2012) identified this as a high-priority landing site due to flat terrain and scientific interest.',
        terrain_params: { rimHeight: 8, noiseScale: 0.015, boulderDensity: 0.25 },
        citation: 'De Rosa et al., Planet. Space Sci. 74(1), 224–246 (2012)',
    },
    {
        id: 'sverdrup',
        name: 'Sverdrup',
        lat: -88.5,
        lon: -145.0,
        diameter_km: 33,
        depth_km: 3.0,
        description: 'Far-side south pole crater in permanent shadow. Among the most volatile-rich locations detected by orbital instruments.',
        difficulty: 'EXTREME',
        features: ['Permanent shadow', 'Far side', 'High volatile content', 'No direct Earth comms'],
        science: 'Hayne et al. (2015) estimated significant ice deposits from neutron spectrometer and thermal models.',
        terrain_params: { rimHeight: 13, noiseScale: 0.032, boulderDensity: 0.75 },
        citation: 'Hayne et al., Icarus 255, 58–69 (2015)',
    },
];

// ---- Physics Constants (research-grounded) ----
export const LUNAR_PHYSICS = {
    gravity: 1.625,           // m/s² [10] Wieczorek et al. (2006)
    regolith_cohesion: 0.8,   // kPa [8] Carrier et al. (1991): 0.5-1.0 kPa
    friction_angle: 37,       // degrees [8] Carrier et al. (1991): 25-50°
    regolith_density: 1660,   // kg/m³ [9] Heiken et al. (1991) top 15cm
    thermal_conductivity: 0.01, // W/(m·K) [9] top regolith layer
    shadow_temp: 40,          // Kelvin [4] Paige et al. (2010)
    sunlit_temp: 200,         // Kelvin, typical south pole illuminated
    battery_cold_penalty: 0.02, // 2% capacity loss per °C below -20°C (Li-ion)
    solar_flux: 1361,         // W/m² at 1 AU
    rover_mass: 150,          // kg (medium-class rover)
    max_slope_traversable: 30, // degrees [8] for wheeled rover on regolith
};

// ---- Helper: lat/lon → 3D vector on sphere ----
export function latLonToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return {
        x: -radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.cos(phi),
        z: radius * Math.sin(phi) * Math.sin(theta),
    };
}

// ---- Helper: get surface normal at lat/lon on sphere ----
export function latLonToNormal(lat, lon) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return {
        x: -Math.sin(phi) * Math.cos(theta),
        y: Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta),
    };
}

// ---- Helper: difficulty color ----
export function difficultyColor(difficulty) {
    switch (difficulty) {
        case 'EASY': return '#2ed573';
        case 'MODERATE': return '#ffa502';
        case 'HARD': return '#ff6b6b';
        case 'EXTREME': return '#ff4757';
        default: return '#4a9eff';
    }
}
