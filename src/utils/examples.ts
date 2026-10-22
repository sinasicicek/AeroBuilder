/**
 * Ready-made example projects. Each one was checked with the analysis and the
 * weight & balance model (no validation errors, balances without ballast
 * unless stated), so users can start from something that flies.
 * Names and descriptions live in the locale files (ex_<id>_name / ex_<id>_desc).
 * Dimensions are in cm.
 */
import type { AircraftDimensions, AircraftType, AirfoilType, ControlSurfaces, FuselageType, PropellerType, TailType } from './calculations';
import type { ComponentSettings } from './components';

export interface ExampleProject {
  id: string;
  /** Tag i18n keys (`tag_*`) or literal labels such as "3S" / "FPV". */
  tags: string[];
  state: {
    dimensions: AircraftDimensions;
    unit: 'cm';
    aircraftType: AircraftType;
    airfoil: AirfoilType;
    fuselageStyle: FuselageType;
    /** Tail configuration (undefined = conventional). */
    tailType?: TailType;
    propeller: PropellerType;
    controls: ControlSurfaces;
    components: ComponentSettings;
    propCutout: boolean;
  };
}

const CONV_CS: ControlSurfaces = { aileronStart: 50, aileronEnd: 95, aileronChord: 25, elevatorChord: 30, rudderChord: 40, fwStaticMargin: 6, convStaticMargin: 12 };

export const EXAMPLES: ExampleProject[] = [
  {
    id: 'trainer100',
    tags: ['tag_beginner', '3S'],
    state: {
      dimensions: { wingspan: 100, rootChord: 20, tipChord: 15, sweepOffset: 5, dihedral: 5, hStabSpan: 32, hStabChord: 9, vStabSpan: 15, vStabChord: 10, fuselageLength: 80, noseLength: 15, wingToTailDistance: 32, fuselageWidth: 7, fuselageHeight: 8 },
      unit: 'cm', aircraftType: 'conventional', airfoil: 'clarky', fuselageStyle: 'trainer', propeller: 'prop_9x47',
      controls: CONV_CS, components: { servo: 'sg90', battery: 'auto' }, propCutout: false,
    },
  },
  {
    id: 'trainer140',
    tags: ['tag_beginner', 'tag_high_wing'],
    state: {
      dimensions: { wingspan: 140, rootChord: 26, tipChord: 20, sweepOffset: 5, dihedral: 4, hStabSpan: 44, hStabChord: 11.5, vStabSpan: 20, vStabChord: 14, fuselageLength: 112, noseLength: 25, wingToTailDistance: 42, fuselageWidth: 9, fuselageHeight: 10 },
      unit: 'cm', aircraftType: 'conventional', airfoil: 'clarky', fuselageStyle: 'trainer', propeller: 'prop_11x55',
      controls: CONV_CS, components: { servo: 'sg90', battery: 'auto' }, propCutout: false,
    },
  },
  {
    id: 'sport110',
    tags: ['tag_intermediate', 'tag_aerobatics'],
    state: {
      dimensions: { wingspan: 110, rootChord: 24, tipChord: 17, sweepOffset: 5, dihedral: 2, hStabSpan: 38, hStabChord: 10.5, vStabSpan: 17, vStabChord: 13, fuselageLength: 92, noseLength: 19, wingToTailDistance: 35, fuselageWidth: 7.5, fuselageHeight: 8.5 },
      unit: 'cm', aircraftType: 'conventional', airfoil: 'naca0012', fuselageStyle: 'sport', propeller: 'prop_10x47',
      controls: { ...CONV_CS, aileronStart: 40, aileronChord: 26, elevatorChord: 35, rudderChord: 45 },
      components: { servo: 'mg90s', battery: 'auto' }, propCutout: false,
    },
  },
  {
    id: 'glider160',
    tags: ['tag_glider', 'tag_slow'],
    state: {
      dimensions: { wingspan: 160, rootChord: 22, tipChord: 13, sweepOffset: 4, dihedral: 6, hStabSpan: 40, hStabChord: 10.5, vStabSpan: 18, vStabChord: 13, fuselageLength: 90, noseLength: 24, wingToTailDistance: 28, fuselageWidth: 6, fuselageHeight: 7 },
      unit: 'cm', aircraftType: 'conventional', airfoil: 'naca4412', fuselageStyle: 'sport', propeller: 'prop_9x47',
      controls: { ...CONV_CS, aileronStart: 55, aileronChord: 22, convStaticMargin: 15 },
      components: { servo: 'sg90', battery: 'auto' }, propCutout: false,
    },
  },
  {
    id: 'zagi90',
    tags: ['tag_flying_wing', 'tag_fast'],
    state: {
      dimensions: { wingspan: 90, rootChord: 26, tipChord: 13, sweepOffset: 30, dihedral: 2, hStabSpan: 0, hStabChord: 0, vStabSpan: 8, vStabChord: 6, fuselageLength: 30, noseLength: 0, wingToTailDistance: 0, fuselageWidth: 0, fuselageHeight: 0 },
      unit: 'cm', aircraftType: 'flying_wing', airfoil: 'mh45', fuselageStyle: 'trainer', propeller: 'prop_8x45P',
      controls: { aileronStart: 30, aileronEnd: 95, aileronChord: 22, elevatorChord: 0, rudderChord: 0, fwStaticMargin: 5, convStaticMargin: 12 },
      components: { servo: 'sg90', battery: 'auto' }, propCutout: true,
    },
  },
  {
    id: 'wing120',
    tags: ['tag_flying_wing', 'FPV'],
    state: {
      dimensions: { wingspan: 120, rootChord: 30, tipChord: 17, sweepOffset: 42, dihedral: 1, hStabSpan: 0, hStabChord: 0, vStabSpan: 12, vStabChord: 9, fuselageLength: 32, noseLength: 0, wingToTailDistance: 0, fuselageWidth: 0, fuselageHeight: 0 },
      unit: 'cm', aircraftType: 'flying_wing', airfoil: 'mh45', fuselageStyle: 'trainer', propeller: 'prop_8x45P',
      controls: { aileronStart: 30, aileronEnd: 95, aileronChord: 20, elevatorChord: 0, rudderChord: 0, fwStaticMargin: 6, convStaticMargin: 12 },
      components: { servo: 'sg90', battery: '3s2200' }, propCutout: true,
    },
  },
];
