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

// ============================================
// CRATER EDUCATION DATA — Research-Grounded
// Real historical events, discoveries, and context
// ============================================
export const CRATER_EDUCATION = {
    shackleton: {
        timeline: [
            { year: '1994', event: 'Clementine Mission', detail: 'First radar evidence of possible ice in Shackleton\'s interior from bistatic radar experiment by Nozette et al.' },
            { year: '2009', event: 'LRO / LEND', detail: 'Lunar Reconnaissance Orbiter\'s Lunar Exploration Neutron Detector mapped enhanced hydrogen concentrations around Shackleton.' },
            { year: '2012', event: 'Zuber et al. Study', detail: 'Used LRO laser altimeter data to measure a floor albedo ~22% higher than surroundings, consistent with ~22% ice by mass in upper regolith.' },
            { year: '2018', event: 'Li et al. M3 Detection', detail: 'Moon Mineralogy Mapper (M3) on Chandrayaan-1 provided direct spectroscopic evidence of surface-exposed water ice.' },
            { year: '2024', event: 'Artemis III Target', detail: 'Selected as priority target for Artemis III, humanity\'s first crewed return to the Moon since Apollo 17.' }
        ],
        discoveries: [
            { title: 'Water Ice Confirmed', description: 'Floor albedo measurements by LRO\'s laser altimeter show elevated reflectance consistent with ~22% water ice by mass in the uppermost meter of regolith.', citation: 'Zuber et al., Nature 486, 378-381 (2012)' },
            { title: 'Permanently Shadowed', description: 'The crater interior has not received direct sunlight for approximately 2 billion years, making it one of the Moon\'s coldest regions. Temperatures approach 40K.', citation: 'Mazarico et al., Icarus 211(2), 1066-1081 (2011)' },
            { title: 'Steep Interior Walls', description: 'Walls slope at angles >30 degrees, presenting significant traverse challenges for wheeled rovers. The depth of 4.2 km creates a hostile operating environment.', citation: 'LRO LOLA topographic data' }
        ],
        context: {
            overview: 'Shackleton crater sits almost exactly at the lunar south pole (89.9\u00B0S). Named after Antarctic explorer Sir Ernest Shackleton, it is approximately 21 km in diameter and 4.2 km deep. Its permanently shadowed interior has been a prime target for water ice prospecting since the Clementine mission in 1994.',
            geology: 'The crater is an impact structure believed to be approximately 3.6 billion years old (Nectarian period). Its walls are composed of anorthosite with high albedo, while the floor contains accumulated regolith with trapped volatiles. The steep wall angle (>30\u00B0) and great depth create one of the most extreme environments on the Moon.',
            volatiles: 'Multiple missions have confirmed the presence of water ice. The Lunar Reconnaissance Orbiter measured floor albedo 22% higher than surrounding terrain, consistent with significant ice content (Zuber et al., 2012). The Moon Mineralogy Mapper provided direct spectroscopic confirmation of H2O ice on the surface (Li et al., 2018). Temperatures as low as 40K ensure long-term stability of these volatiles.',
            exploration_significance: 'Shackleton is the primary candidate for ISRU (In-Situ Resource Utilization) operations. Water ice can be processed into drinking water, breathable oxygen, and rocket propellant (liquid hydrogen and oxygen). The near-pole location also provides peaks of near-eternal sunlight on the crater rim, enabling continuous solar power generation \u2014 a critical requirement for sustained operations.'
        }
    },
    de_gerlache: {
        timeline: [
            { year: '2009', event: 'LRO Mapping', detail: 'Lunar Reconnaissance Orbiter provided first high-resolution topographic map of the crater at 50m/pixel.' },
            { year: '2018', event: 'Ice Detection', detail: 'Li et al. confirmed surface-exposed water ice in de Gerlache using M3 reflectance data from Chandrayaan-1.' },
            { year: '2024', event: 'Artemis Candidate', detail: 'Identified as secondary Artemis landing region due to favorable rim illumination and proximity to Shackleton.' }
        ],
        discoveries: [
            { title: 'Surface Water Ice', description: 'Moon Mineralogy Mapper data revealed diagnostic absorption features of water ice at 1.3, 1.5, and 2.0 micrometers within the permanently shadowed regions.', citation: 'Li et al., PNAS 115(36), 8907-8912 (2018)' },
            { title: 'Favorable Illumination', description: 'The northern rim receives sunlight for approximately 80% of the lunar year, making it the best solar power location near the south pole while maintaining close access to permanently shadowed ice deposits.', citation: 'Mazarico et al., Icarus 211(2), 1066-1081 (2011)' }
        ],
        context: {
            overview: 'De Gerlache crater (88.5\u00B0S) is a 32 km diameter crater adjacent to Shackleton. Named after Belgian explorer Adrien de Gerlache. Its unique value lies in the combination of permanently shadowed interior for ice access and well-illuminated rim for solar power.',
            geology: 'The crater features partially degraded walls indicating significant age (pre-Nectarian). The floor is relatively flat with accumulated regolith deposits. Its adjacency to Shackleton creates a connected permanently shadowed region spanning over 50 km.',
            volatiles: 'Li et al. (2018) confirmed surface water ice using Chandrayaan-1\'s M3 instrument. The ice signatures were strongest on cold-trapped areas of the crater floor, with estimated concentrations of 3-5% by mass in the upper few centimeters.',
            exploration_significance: 'De Gerlache represents perhaps the optimal trade-off for lunar south pole operations: its rim provides near-continuous solar power while the interior shields volatiles from sublimation. A base on the rim could support ice mining operations in the interior with minimal power infrastructure challenges.'
        }
    },
    cabeus: {
        timeline: [
            { year: '2009', event: 'LCROSS Impact', detail: 'NASA deliberately crashed the 2,300 kg Centaur upper stage into Cabeus at 2.5 km/s, followed by the shepherding spacecraft that flew through the ejecta plume to analyze its composition.' },
            { year: '2009', event: 'Water Confirmed', detail: 'LCROSS measurements detected 155 \u00B1 12 kg of water vapor and ice in the ejecta plume, confirming 5.6 \u00B1 2.9% water ice by mass in the impact area.' },
            { year: '2010', event: 'Volatile Analysis', detail: 'Colaprete et al. published comprehensive analysis showing not just water, but also mercury, calcium, magnesium, and other volatiles.' }
        ],
        discoveries: [
            { title: 'LCROSS Water Discovery', description: 'The LCROSS impact experiment confirmed 5.6 \u00B1 2.9% water ice by mass in the regolith of Cabeus, the first definitive in-situ measurement of lunar water.', citation: 'Colaprete et al., Science 330, 463-468 (2010)' },
            { title: 'Complex Volatile Chemistry', description: 'Beyond water, the LCROSS plume contained light hydrocarbons, sulfur compounds, carbon dioxide, and mercury \u2014 suggesting a complex volatile trapping history.', citation: 'Gladstone et al., Science 330, 472-476 (2010)' },
            { title: 'Accessible Terrain', description: 'Cabeus features a relatively flat floor at 98 km diameter, providing ample landing area and traverse paths for rovers despite being one of the largest south pole craters.', citation: 'LRO LOLA mission data' }
        ],
        context: {
            overview: 'Cabeus is a large (98 km diameter) crater at 85.3\u00B0S, famous as the site of the 2009 LCROSS impact experiment \u2014 humanity\'s first deliberate test of lunar ice mining. The result \u2014 5.6% water ice \u2014 transformed lunar exploration planning.',
            geology: 'The crater floor contains multiple sub-craters and is relatively flat for its size. The large diameter means the interior is only partially shadowed, with illumination patterns that change seasonally. Multiple accessible landing sites exist on the floor.',
            volatiles: 'LCROSS provided the most definitive measurement of lunar volatiles to date. The 5.6% water ice concentration, combined with other trapped volatiles, makes Cabeus one of the richest known volatile repositories. The water is believed to have been delivered by cometary impacts and cold-trapped over billions of years.',
            exploration_significance: 'As the only crater with ground-truth volatile measurements, Cabeus serves as the benchmark for all lunar ISRU planning. Its large size and moderate terrain make it the most accessible of the major volatile-bearing craters.'
        }
    },
    faustini: {
        timeline: [
            { year: '2009', event: 'LRO Diviner Measurements', detail: 'The Diviner thermal radiometer detected surface temperatures as low as 35K (-238\u00B0C), among the coldest measured anywhere in the solar system.' },
            { year: '2010', event: 'Cold Trap Mapping', detail: 'Paige et al. published comprehensive thermal maps showing Faustini contains some of the Moon\'s most stable cold traps.' }
        ],
        discoveries: [
            { title: 'Extreme Cold Traps', description: 'Diviner measured surface temperatures as low as 35K (-238\u00B0C), cold enough to trap not only water ice but also carbon dioxide, ammonia, and other volatiles for billions of years.', citation: 'Paige et al., Science 330(6003), 479-482 (2010)' },
            { title: 'Ancient Volatile Record', description: 'The extreme cold and permanent shadow mean Faustini may preserve a record of volatile delivery to the inner solar system spanning billions of years \u2014 effectively a time capsule.', citation: 'Paige et al., 2010; Hayne et al., 2015' }
        ],
        context: {
            overview: 'Faustini crater (87.3\u00B0S) is a 39 km diameter, 3.8 km deep crater known for some of the coldest temperatures ever measured on the Moon. Named after Italian explorer Arnaldo Faustini.',
            geology: 'The steep approach angles and significant depth make Faustini one of the most challenging craters to access. The permanently shadowed floor has remained untouched by direct sunlight for an estimated 2+ billion years.',
            volatiles: 'At 35K, Faustini can trap virtually any volatile species, including water, CO2, NH3, SO2, and organic molecules. This makes it a potential treasure trove of primordial solar system chemistry.',
            exploration_significance: 'While extremely difficult to access, Faustini represents the highest-value science target for understanding volatile delivery in the inner solar system. Robotic missions capable of surviving the extreme cold would return unprecedented data.'
        }
    },
    haworth: {
        timeline: [
            { year: '2010', event: 'Mini-RF Radar', detail: 'The Miniature Radio Frequency instrument on LRO detected anomalous radar returns from Haworth\'s floor, consistent with ice deposits.' },
            { year: '2012', event: 'Thomson et al. Study', detail: 'Published analysis of radar cross-section enhancements suggesting coherent ice deposits in permanently shadowed regions.' }
        ],
        discoveries: [
            { title: 'Radar-Bright Deposits', description: 'Mini-RF radar measurements show elevated circular polarization ratio (CPR) on the floor, consistent with volume scattering from buried ice.', citation: 'Thomson et al., GRL 39, L14201 (2012)' }
        ],
        context: {
            overview: 'Haworth (87.4\u00B0S) is a 51 km crater adjacent to Shackleton. Its relatively flat floor and radar evidence of ice make it a strong secondary target for south pole operations.',
            geology: 'The crater has partially degraded walls and a comparatively flat interior. Its adjacency to Shackleton means it shares the permanently shadowed thermal environment.',
            volatiles: 'Radar evidence suggests ice deposits may be distributed across the floor, potentially in layers buried beneath a thin regolith blanket.',
            exploration_significance: 'Haworth\'s larger size and flatter terrain compared to Shackleton make it potentially more accessible for long-duration surface operations, while still offering access to volatile deposits.'
        }
    },
    nobile: {
        timeline: [
            { year: '2011', event: 'Illumination Study', detail: 'Mazarico et al. showed that the northern rim receives >50% average annual sunlight, ideal for solar-powered operations.' },
            { year: '2022', event: 'VIPER Target', detail: 'NASA selected a region near Nobile as the landing site for the VIPER (Volatiles Investigating Polar Exploration Rover) mission.' }
        ],
        discoveries: [
            { title: 'Favorable Illumination', description: 'The northern rim receives sunlight for more than 50% of the lunar year, creating one of the best solar power locations for sustained south pole operations.', citation: 'Mazarico et al., Icarus 211(2), 1066-1081 (2011)' }
        ],
        context: {
            overview: 'Nobile (85.2\u00B0S) is a 73 km crater with a mix of illuminated rim areas and permanently shadowed interior craters. Named after Italian aeronautical engineer Umberto Nobile.',
            geology: 'Contains multiple nested smaller craters, creating a diverse terrain with both accessible sunlit areas and cold-trapped shadows.',
            volatiles: 'The nested crater geometry creates micro-environments where volatiles may be preserved at different concentrations, making it an excellent natural laboratory for studying volatile distribution.',
            exploration_significance: 'Selected as the VIPER mission target region. Its moderate difficulty and mixed illumination make it ideal for demonstrating ISRU technologies while maintaining solar power access.'
        }
    },
    amundsen: {
        timeline: [
            { year: '2012', event: 'Landing Site Study', detail: 'De Rosa et al. identified Amundsen as a high-priority landing site due to flat terrain and scientific interest in its central peak.' }
        ],
        discoveries: [
            { title: 'Central Peak', description: 'The prominent central peak provides access to deep crustal material excavated during the impact, offering a window into lunar interior composition.', citation: 'De Rosa et al., Planet. Space Sci. 74(1), 224-246 (2012)' }
        ],
        context: {
            overview: 'Amundsen (84.5\u00B0S) is one of the largest south pole craters at 105 km diameter. Named after Roald Amundsen, first to reach the South Pole on Earth. Its large size and gentle slopes make it the most accessible major south pole crater.',
            geology: 'Features a prominent central peak \u2014 evidence of the immense impact that formed it. The central peak exposes deep crustal rocks, providing geological access to material from several kilometers below the surface.',
            volatiles: 'Only partially shadowed, limiting volatile accumulation compared to deeper craters. However, some permanently shadowed areas exist near the southern wall.',
            exploration_significance: 'The easiest south pole crater to access, making it ideal for early missions. The central peak adds significant geological science value beyond volatile prospecting.'
        }
    },
    sverdrup: {
        timeline: [
            { year: '2015', event: 'Hayne et al. Study', detail: 'Thermal and neutron spectrometer models predicted significant ice deposits in Sverdrup based on favorable thermal environment.' }
        ],
        discoveries: [
            { title: 'High Volatile Potential', description: 'Thermal models combined with neutron spectrometer data indicate Sverdrup may contain some of the highest volatile concentrations at the south pole.', citation: 'Hayne et al., Icarus 255, 58-69 (2015)' }
        ],
        context: {
            overview: 'Sverdrup (88.5\u00B0S, far side) is a 33 km crater in permanent shadow on the lunar far side. Named after Norwegian explorer Otto Sverdrup. Its far-side location means no direct communication with Earth.',
            geology: 'Similar in size and depth to de Gerlache but located on the lunar far side. The permanent shadow and far-side location mean it is one of the least characterized south pole craters.',
            volatiles: 'Thermal models suggest conditions highly favorable for volatile trapping. The far-side location provides additional shielding from solar wind sputtering, potentially preserving more pristine volatile deposits.',
            exploration_significance: 'Sverdrup represents the frontier of lunar exploration \u2014 requiring relay satellites for communications and fully autonomous rover operations. It is the ultimate test case for autonomous swarm coordination.'
        }
    }
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
